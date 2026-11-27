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
import {
  hasAnyEnabledGeminiAccount,
  listHealthyGeminiWorkerAccounts,
  recordGeminiAccountUsage,
  resolveChairmanGeminiAccount,
} from './geminiPool';
import {
  callXingchiCompletion,
  generateImageWithXingchi,
  getXingchiRuntimeConfig,
  testXingchiConnection,
} from './xingchiApi';
import {
  generateImageViaAlibabaQwen,
  generateVideoBufferViaAlibabaQwen,
  getAlibabaModelStudioStatus,
  getAlibabaRuntimeConfig,
  recordAlibabaUsage,
  testAlibabaModelStudioConnection,
} from './alibabaModelStudio';
import {
  buildCinematicFilmmakingScriptDirective,
  CINEMATIC_FILMMAKING_SKILL,
  enhancePromptWithCinematicSkill,
  getCinematicShotRoleForScene,
} from './skills/cinematicFilmmakingSkill';
import {
  ALLOWED_ACCESSORIES_LIST_VI,
  auditAndNormalizeBlueprintServer,
  buildReferenceCharacterLockRules,
  buildShortDramaScreenplayRules,
  compileProductionModelPrompt,
  CREATIVE_CONTEXT_CHARACTER_BOUNDARY_RULES,
  LockedCharacterProfileSeed,
  RuleEngineQcReport,
  SHORT_DRAMA_IDEA_EXPANSION_RULES,
} from './skills/shortDramaProductionRules';

export type StudioCreationMode = 'creative' | 'derivative';
export type StudioScriptMode = 'series' | 'independent_batch';
export type StudioProductionFormat = 'dialogue_film' | 'narration_story';
export type CharacterAgeGroup =
  | 'auto'
  | 'child'
  | 'youth'
  | 'adult_male'
  | 'adult_female'
  | 'middle_aged'
  | 'elderly';
export type CharacterGenderHint = 'auto' | 'male' | 'female';
export type BuiltInStudioVideoStyle =
  | 'professional'
  | 'cinematic'
  | 'cinematic_filmmaking'
  | 'anime'
  | 'stickman'
  | '3d_animation'
  | 'documentary'
  | 'comic'
  | 'vlog'
  | 'custom';

export type StudioVideoStyle = BuiltInStudioVideoStyle | `learned:${string}`;

export interface LearnedVideoStyle {
  id: string;
  name: string;
  sourceLabel: string;
  sourceUrl?: string;
  promptDirective: string;
  visualToneVi: string;
  artStyleAndLinework: string;
  colorPalette: string;
  lightingStyle: string;
  cameraAndComposition: string;
  characterRendering: string;
  sampleFrames?: string[];
  usedProvider?: AiProviderId;
  usedModel?: string;
  createdAt: number;
}

export type DerivativeVisualMode =
  | 'remix'
  | 'storyboard_motion'
  | 'gemini_omni'
  | 'muse2api_video'
  | 'qwen_video';
export type DerivativeStylePreset = 'none' | 'summary_fast' | 'storytelling_review' | 'top_list' | 'tips_tutorial';
export type GeminiTtsVoiceId =
  | 'Kore'
  | 'Puck'
  | 'Zephyr'
  | 'Charon'
  | 'Fenrir'
  | 'Aoede'
  | 'Leda'
  | 'Orus'
  | 'Callirrhoe'
  | 'Autonoe'
  | 'Enceladus'
  | 'Iapetus'
  | 'Umbriel'
  | 'Algieba'
  | 'Despina'
  | 'Erinome'
  | 'Algenib'
  | 'Rasalgethi'
  | 'Laomedeia'
  | 'Achernar'
  | 'Alnilam'
  | 'Schedar'
  | 'Gacrux'
  | 'Pulcherrima'
  | 'Achird'
  | 'Zubenelgenubi'
  | 'Vindemiatrix'
  | 'Sadachbia'
  | 'Sadaltager'
  | 'Sulafat';
export type DerivativeVoiceId = 'none' | GeminiTtsVoiceId;
export type DerivativeVoiceMode = 'ai_online' | 'offline_system' | 'none';
export type DerivativeMusicMode = 'none' | 'auto_adaptive' | 'ai_lyria' | 'public_free' | 'uploaded';
export type DerivativeAspectRatio = '9:16' | '16:9' | '1:1';
export type DerivativeOutputLanguage = 'vi' | 'en' | 'zh' | 'vi_en';
export type AiProviderId = 'gemini' | 'openai' | 'meta' | 'muse2api' | 'xingchi' | 'alibaba';
export type BrollSourceId = 'wikimedia' | 'auto' | 'pexels' | 'pixabay' | 'none';

export interface CharacterVoiceProfile {
  characterName: string;
  ageGroup: Exclude<CharacterAgeGroup, 'auto'>;
  gender: Exclude<CharacterGenderHint, 'auto'>;
  voiceId: Exclude<DerivativeVoiceId, 'none'>;
  vocalToneNote: string;
}

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

export interface CharacterFivePartProfile {
  face: string;
  physique: string;
  costume: string;
  voice: string;
  distinguishingMarks: string;
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
  cameraEquipment?: string;
  shotStyle?: string;
  dialogue?: string;
  narration: string;
  videoTimeline?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  continuityNote?: string;
  sceneEndState?: string;
  visualNote?: string;
  vfxNotes?: string;
  soundLayersNote?: string;
  brollKeywordEn?: string;
  musicMoodEn?: string;
  selectedCharacterIds?: string[];
  sceneImageDataUrl?: string;
  sceneImageSource?: 'uploaded' | 'ai';
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
  productionFormat?: StudioProductionFormat;
  batchIndex?: number;
  batchTotal?: number;
  sharedSpiritNote?: string;
  targetDurationSec?: number;
  ideaPrompt?: string;
  videoStyle?: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  costumeLockWarnings?: string[];
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  adaptiveMusicPrompt?: string;
  characterVoiceProfiles?: CharacterVoiceProfile[];
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
  qcReport?: RuleEngineQcReport;
  usedProvider?: AiProviderId;
  usedModel?: string;
}

export type DerivativeSceneStageStatus =
  | 'pending'
  | 'reused'
  | 'running'
  | 'completed'
  | 'error'
  | 'skipped';

export interface DerivativeSceneProgress {
  sceneIndex: number;
  sceneNumber: number;
  sceneTitle: string;
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  stageLabel: string;
  imageStatus: DerivativeSceneStageStatus;
  imageSource?: 'step2_reused' | 'generated' | 'none';
  imagePreviewUrl?: string;
  videoStatus: DerivativeSceneStageStatus;
  videoAssetId?: string;
  videoPreviewUrl?: string;
  audioStatus: DerivativeSceneStageStatus;
  renderStatus: DerivativeSceneStageStatus;
  error?: string;
  failedStage?: 'image' | 'video' | 'audio' | 'render';
  updatedAt: number;
}

export interface DerivativeJobRecord {
  jobId: string;
  status:
    | 'queued'
    | 'learning'
    | 'downloading'
    | 'tts'
    | 'rendering'
    | 'partial_error'
    | 'completed'
    | 'error';
  progress: number;
  stepLabel: string;
  visualMode?: DerivativeVisualMode;
  scenes: DerivativeSceneProgress[];
  workDir: string;
  outputPath?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  resolution?: string;
  error?: string;
  warnings: string[];
  createdAt: number;
  paramsSnapshot?: StartDerivativeJobParams;
  isRunning?: boolean;
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

export function getGeminiClient(
  apiKeyOverride?: string,
  options?: { apiVersion?: 'v1' | 'v1beta' }
): GoogleGenAI {
  const apiKey =
    apiKeyOverride?.trim() ||
    resolveChairmanGeminiAccount()?.apiKey ||
    process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Chưa phát hiện tài khoản Gemini API khả dụng trên máy chủ. Hãy thêm API Key trong Cài đặt > Kết nối API Gemini hoặc Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(options?.apiVersion ? { apiVersion: options.apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getGeminiBetaClient(apiKeyOverride?: string): GoogleGenAI {
  return getGeminiClient(apiKeyOverride, { apiVersion: 'v1beta' });
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

export function shouldFallbackGeminiModel(err: any): boolean {
  return isTransientGemini503Error(err) || isGeminiRateLimit429Error(err);
}

const geminiModelCooldownUntil = new Map<string, number>();

export function markGeminiModelOverloaded(model: string, err: any, cooldownMs = 75_000): void {
  if (isTransientGemini503Error(err) || isGeminiRateLimit429Error(err)) {
    geminiModelCooldownUntil.set(model, Date.now() + cooldownMs);
  }
}

export function prioritizeGeminiCandidateModels(baseCandidates: string[]): string[] {
  const now = Date.now();
  const healthy: string[] = [];
  const cooled: string[] = [];
  for (const m of baseCandidates) {
    const until = geminiModelCooldownUntil.get(m) || 0;
    if (until > now) cooled.push(m);
    else healthy.push(m);
  }
  if (healthy.length > 0) return [...healthy, ...cooled];
  const liteIdx = cooled.indexOf('gemini-3.1-flash-lite');
  if (liteIdx > 0) {
    const copy = [...cooled];
    const [lite] = copy.splice(liteIdx, 1);
    return [lite, ...copy];
  }
  return cooled;
}

export async function retryWithGeminiBackoff<T>(
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

export function formatGeminiError(err: any): string {
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

function extractFirstBalancedJsonObject(str: string): string {
  const firstBrace = str.indexOf('{');
  if (firstBrace < 0) return str;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < str.length; i += 1) {
    const ch = str[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return str.slice(firstBrace, i + 1);
      }
    }
  }
  return str.slice(firstBrace);
}

function repairJsonOutsideStrings(input: string): string {
  const out: string[] = [];
  let i = 0;
  const len = input.length;
  let lastSig = '';

  const peekNextNonWs = (startIdx: number): string => {
    let k = startIdx;
    while (k < len) {
      const c = input[k];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        k += 1;
        continue;
      }
      if (c === '/' && input[k + 1] === '/') {
        const nl = input.indexOf('\n', k + 2);
        k = nl < 0 ? len : nl + 1;
        continue;
      }
      if (c === '/' && input[k + 1] === '*') {
        const end = input.indexOf('*/', k + 2);
        k = end < 0 ? len : end + 2;
        continue;
      }
      return c;
    }
    return '';
  };

  while (i < len) {
    const ch = input[i];

    // Copy double-quoted string verbatim
    if (ch === '"') {
      out.push('"');
      i += 1;
      let escaped = false;
      while (i < len) {
        const sc = input[i];
        out.push(sc);
        i += 1;
        if (escaped) {
          escaped = false;
        } else if (sc === '\\') {
          escaped = true;
        } else if (sc === '"') {
          break;
        }
      }
      lastSig = '"';
      continue;
    }

    // Strip // line comments outside strings
    if (ch === '/' && input[i + 1] === '/') {
      const nl = input.indexOf('\n', i + 2);
      i = nl < 0 ? len : nl;
      continue;
    }

    // Strip /* block comments */ outside strings
    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }

    // Convert single-quoted string '...' to "..."
    if (ch === "'") {
      out.push('"');
      i += 1;
      let escaped = false;
      while (i < len) {
        const sc = input[i];
        i += 1;
        if (escaped) {
          escaped = false;
          if (sc === "'") out.push("'");
          else out.push('\\' + sc);
          continue;
        }
        if (sc === '\\') {
          escaped = true;
          continue;
        }
        if (sc === "'") {
          break;
        }
        if (sc === '"') {
          out.push('\\"');
        } else if (sc === '\n') {
          out.push('\\n');
        } else if (sc === '\r') {
          out.push('\\r');
        } else if (sc === '\t') {
          out.push('\\t');
        } else {
          out.push(sc);
        }
      }
      out.push('"');
      lastSig = '"';
      continue;
    }

    // Strip trailing or duplicate commas outside strings
    if (ch === ',') {
      const nextSig = peekNextNonWs(i + 1);
      if (nextSig === '}' || nextSig === ']' || nextSig === ',' || nextSig === '') {
        i += 1;
        continue;
      }
      out.push(',');
      lastSig = ',';
      i += 1;
      continue;
    }

    // Quote unquoted object keys after '{' or ','
    if ((lastSig === '{' || lastSig === ',') && /[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_$-]/.test(input[j])) j += 1;
      const ident = input.slice(i, j);
      if (ident !== 'true' && ident !== 'false' && ident !== 'null' && peekNextNonWs(j) === ':') {
        out.push(`"${ident}"`);
        lastSig = '"';
        i = j;
        continue;
      }
    }

    out.push(ch);
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      lastSig = ch;
    }
    i += 1;
  }

  return out.join('');
}

function escapeUnescapedInnerQuotesInStrings(input: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  const len = input.length;

  for (let i = 0; i < len; i += 1) {
    const ch = input[i];
    if (!inString) {
      out.push(ch);
      if (ch === '"') inString = true;
      continue;
    }
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      // Valid closing quote is followed (ignoring spaces) by ':', ',', '}', ']', or EOF
      let k = i + 1;
      while (k < len && (input[k] === ' ' || input[k] === '\t' || input[k] === '\r' || input[k] === '\n')) {
        k += 1;
      }
      const next = k < len ? input[k] : '';
      if (next === ':' || next === ',' || next === '}' || next === ']' || next === '') {
        inString = false;
        out.push('"');
      } else {
        out.push('\\"');
      }
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}

function insertMissingCommasOutsideStrings(input: string): string {
  const out: string[] = [];
  const len = input.length;
  let i = 0;
  let lastSig = '';
  let lastWasKey = false;
  let expectingValueAfterColon = false;

  const peekNext = (idx: number): string => {
    let k = idx;
    while (k < len && (input[k] === ' ' || input[k] === '\t' || input[k] === '\r' || input[k] === '\n')) k += 1;
    return k < len ? input[k] : '';
  };

  while (i < len) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      out.push(ch);
      i += 1;
      continue;
    }

    const prevClosedValue =
      (lastSig === '"' && !lastWasKey) ||
      lastSig === '}' ||
      lastSig === ']' ||
      lastSig === 'num' ||
      lastSig === 'lit';

    if (prevClosedValue && (ch === '"' || ch === '{' || ch === '[')) {
      out.push(',');
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let esc = false;
      while (i < len) {
        const sc = input[i];
        i += 1;
        if (esc) esc = false;
        else if (sc === '\\') esc = true;
        else if (sc === '"') break;
      }
      out.push(input.slice(start, i));
      lastWasKey = peekNext(i) === ':';
      lastSig = '"';
      expectingValueAfterColon = false;
      continue;
    }

    if (ch === ':') {
      out.push(ch);
      lastSig = ':';
      lastWasKey = false;
      expectingValueAfterColon = true;
      i += 1;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || (ch === '-' && i + 1 < len && input[i + 1] >= '0' && input[i + 1] <= '9')) {
      const numMatch = input.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (numMatch) {
        out.push(numMatch[0]);
        i += numMatch[0].length;
        lastSig = 'num';
        lastWasKey = false;
        expectingValueAfterColon = false;
        continue;
      }
    }

    if (input.startsWith('true', i) || input.startsWith('null', i)) {
      out.push(input.slice(i, i + 4));
      i += 4;
      lastSig = 'lit';
      lastWasKey = false;
      expectingValueAfterColon = false;
      continue;
    }
    if (input.startsWith('false', i)) {
      out.push('false');
      i += 5;
      lastSig = 'lit';
      lastWasKey = false;
      expectingValueAfterColon = false;
      continue;
    }

    out.push(ch);
    lastSig = ch;
    lastWasKey = false;
    if (ch !== ':' && expectingValueAfterColon && (ch === '{' || ch === '[')) {
      expectingValueAfterColon = false;
    }
    i += 1;
  }

  return out.join('');
}

export function parseAiBlueprintJsonSafe(rawText: string): any {
  const stripped = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const candidateBase = extractFirstBalancedJsonObject(stripped);
  const sanitized = sanitizeJsonControlChars(candidateBase);

  const candidatesToTry = [sanitized];
  try {
    return JSON.parse(sanitized);
  } catch (initialErr) {
    // Pass 1: string-aware cleanup (trailing commas, comments, single quotes, unquoted keys)
    const repairedOutside = repairJsonOutsideStrings(sanitized);
    if (repairedOutside !== sanitized) {
      candidatesToTry.push(repairedOutside);
      try {
        return JSON.parse(repairedOutside);
      } catch {
        // continue
      }
    }

    // Pass 2: missing commas + outer repair
    const withCommas = repairJsonOutsideStrings(insertMissingCommasOutsideStrings(repairedOutside));
    if (withCommas !== repairedOutside) {
      candidatesToTry.push(withCommas);
      try {
        return JSON.parse(withCommas);
      } catch {
        // continue
      }
    }

    // Pass 3: escape likely unescaped inner double quotes inside dialogue/string values (both after and before outside repair)
    const withEscapedQuotes = repairJsonOutsideStrings(
      insertMissingCommasOutsideStrings(escapeUnescapedInnerQuotesInStrings(repairedOutside))
    );
    candidatesToTry.push(withEscapedQuotes);
    try {
      return JSON.parse(withEscapedQuotes);
    } catch {
      // continue
    }

    const preEscaped = repairJsonOutsideStrings(
      insertMissingCommasOutsideStrings(repairJsonOutsideStrings(escapeUnescapedInnerQuotesInStrings(sanitized)))
    );
    if (preEscaped !== withEscapedQuotes) {
      candidatesToTry.push(preEscaped);
      try {
        return JSON.parse(preEscaped);
      } catch {
        // continue to truncation recovery below
      }
    }

    // Strategy 1 & 2: truncation repair on the cleanest repaired candidate
    const bestBase = withCommas || repairedOutside || sanitized;
    const stack: ('{' | '[')[] = [];
    const safeCommaCuts: { cutPos: number; stack: ('{' | '[')[] }[] = [];
    let inString = false;
    let escaped = false;
    let stringStart = -1;

    for (let i = 0; i < bestBase.length; i += 1) {
      const ch = bestBase[i];
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

    if (inString && stringStart >= 0 && stack.length > 0) {
      let head = bestBase;
      const tailLen = bestBase.length - stringStart - 1;
      if (tailLen > 750) {
        let cutAt = stringStart + 650;
        const spaceIdx = bestBase.lastIndexOf(' ', cutAt);
        if (spaceIdx > stringStart + 350) {
          cutAt = spaceIdx;
        }
        head = bestBase.slice(0, cutAt);
      }
      head = trimTrailingBackslashes(head);
      const closedCandidate = `${head}"${closeContainerStack(stack)}`;
      try {
        return JSON.parse(repairJsonOutsideStrings(closedCandidate));
      } catch {
        // Fall through to Strategy 2
      }
    }

    for (let idx = safeCommaCuts.length - 1; idx >= 0 && idx >= safeCommaCuts.length - 25; idx -= 1) {
      const cut = safeCommaCuts[idx];
      const repaired = `${bestBase.slice(0, cut.cutPos)}${closeContainerStack(cut.stack)}`;
      try {
        return JSON.parse(repairJsonOutsideStrings(repaired));
      } catch {
        // Keep backing up to an earlier valid cut boundary
      }
    }

    const rawMsg = initialErr instanceof Error ? initialErr.message : String(initialErr);
    const posMatch = rawMsg.match(/position\s+(\d+)/i);
    const pos = posMatch ? Math.max(0, Math.min(sanitized.length, Number(posMatch[1]))) : -1;
    let snippet = '';
    if (pos >= 0) {
      const start = Math.max(0, pos - 65);
      const end = Math.min(sanitized.length, pos + 65);
      snippet = sanitized.slice(start, end).replace(/\s+/g, ' ').trim();
    } else if (sanitized.length > 0) {
      snippet = sanitized.slice(0, 120).replace(/\s+/g, ' ').trim();
    }
    throw new Error(
      `Lỗi cú pháp JSON từ AI (${rawMsg})${snippet ? ` | Đoạn lỗi gần vị trí ${pos >= 0 ? pos : 0}: "${snippet}"` : ''}`
    );
  }
}

function resolveOpenAiCompatibleConfig(provider: 'openai' | 'meta' | 'xingchi' | 'alibaba') {
  if (provider === 'openai') {
    return {
      label: 'OpenAI ChatGPT',
      envName: 'OPENAI_API_KEY',
      apiKey: process.env.OPENAI_API_KEY?.trim() || '',
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
    };
  }
  if (provider === 'xingchi') {
    const xc = getXingchiRuntimeConfig();
    return {
      label: 'Xingchi API (api.xingchiapi.com)',
      envName: 'XINGCHI_API_KEY',
      apiKey: xc.enabled ? xc.apiKey : '',
      baseUrl: xc.v1BaseUrl,
      model: xc.model,
    };
  }
  if (provider === 'alibaba') {
    const ali = getAlibabaRuntimeConfig();
    return {
      label: 'Alibaba Cloud Model Studio (Qwen)',
      envName: 'DASHSCOPE_API_KEY',
      apiKey: ali.enabled ? ali.apiKey : '',
      baseUrl: ali.baseUrl,
      model: ali.model,
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
  provider: 'openai' | 'meta' | 'xingchi' | 'alibaba';
  contexts: EnrichedVideoContext[];
  promptText: string;
  desiredScenes: number;
  avgSceneDur: number;
  wordsMin: number;
  wordsMax: number;
  enableVoiceover: boolean;
  isDerivative: boolean;
  productionFormat?: StudioProductionFormat;
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
  "characterBible": "Character Reference: Mô tả cực chi tiết ngoại hình cố định từng nhân vật (tên, độ tuổi cụ thể, giới tính, khuôn mặt, tóc, dáng, đặc điểm nhận diện)",
  "settingBible": "Environment Reference: Hồ sơ bối cảnh, địa điểm, kiến trúc, thời gian & môi trường xuyên suốt",
  "visualStyleBible": "Visual Style Reference: Phong cách hình ảnh, chất liệu, ống kính & bảng màu xuyên suốt",
  "costumeBible": "Costume Reference: Trang phục & phụ kiện chuẩn giữ nguyên giữa các cảnh",
  "continuityBible": "Story Continuity: Quy tắc mạch liên tục câu chuyện & trạng thái chuyển cảnh",
  "adaptiveMusicPrompt": "Mô tả tiếng Anh ngắn gọn nhạc nền phù hợp toàn bộ bối cảnh & cảm xúc phim (VD: warm cinematic piano and gentle acoustic strings building emotionally)",
  "characterVoiceProfiles": [
    {
      "characterName": "Tên chính xác của nhân vật",
      "ageGroup": "child | youth | adult_male | adult_female | middle_aged | elderly",
      "gender": "male | female",
      "voiceId": "Tên giọng Gemini phù hợp từ danh sách 30 giọng (khác nhau cho từng nhân vật)",
      "vocalToneNote": "Mô tả cao độ & sắc thái giọng phù hợp độ tuổi (VD: Giọng trẻ em trong sáng / Giọng người già trầm chậm rãi)"
    }
  ],${refBlock}
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
      "dialogue": "Lời thoại nhân vật theo mẫu 'Tên nhân vật: Câu nói' (để trống nếu là phim thuyết minh không thoại)",
      "narration": "${
        params.enableVoiceover
          ? `Nội dung lồng tiếng / thuyết minh tự nhiên (${params.wordsMin}-${params.wordsMax} chữ)`
          : ''
      }",
      "onScreenText": "Chữ phụ đề ngắn tối đa 12 chữ",
      "continuityNote": "Tiếp nối trực tiếp từ trạng thái cuối phân cảnh trước",
      "sceneEndState": "Trạng thái cuối cùng của nhân vật/vị trí/hành động khi kết thúc cảnh này",
      "imagePrompt": "Prompt hình ảnh CỰC KỲ CHI TIẾT mô tả đầy đủ nhân vật (ngoại hình + trang phục cố định), bối cảnh, hành động đóng khung, góc máy, ánh sáng, phong cách hình ảnh đồng nhất",
      "videoPrompt": "Prompt video CỰC KỲ CHI TIẾT mô tả hành động liên tục, chuyển động nhân vật, chuyển động camera, ánh sáng, bối cảnh & trang phục đồng nhất với imagePrompt",
      "vfxNotes": "Mô tả kỹ xảo & vật liệu vật lý thực tế nếu có (volumetric light shafts, dust motes, brushed metal reflection, caustics, foreground wipe...)",
      "soundLayersNote": "Ghi chú 4 lớp âm thanh (MUS nhạc nền / AMB môi trường / BIO nhịp thở-tim / DET tiếng đạo cụ & điểm Silence Drop)",
      "brollKeywordEn": "2-4 English keywords for Wikimedia Commons stock video lookup",
      "musicMoodEn": "2-5 English mood keywords for adaptive background music matching this scene"
    }
  ]
}
BẮT BUỘC mảng "scenes" có ĐÚNG ${params.desiredScenes} phân cảnh đánh số sceneIndex lần lượt từ 1 đến ${params.desiredScenes} và nối tiếp liền mạch nhau.`;

  if (params.provider === 'xingchi') {
    const thumbDataUrls = params.contexts
      .slice(0, 4)
      .filter((ctx) => ctx.thumbnail && ctx.thumbnail.buffer.byteLength < 600_000)
      .map(
        (ctx) =>
          `data:${ctx.thumbnail!.mimeType};base64,${ctx.thumbnail!.buffer.toString('base64')}`
      );
    const xcRes = await callXingchiCompletion({
      prompt: `${params.promptText}\n\n${schemaInstruction}`,
      systemPrompt:
        'Bạn là Đạo diễn sáng tạo nội dung video chuyên nghiệp. Luôn phản hồi duy nhất JSON thuần túy tiếng Việt đúng schema được yêu cầu.',
      imageDataUrls: thumbDataUrls,
      jsonMode: true,
      temperature: 0.7,
      timeoutMs: 85_000,
    });
    return parseAiBlueprintJsonSafe(xcRes.text);
  }

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

  const startedAt = Date.now();
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

  const latencyMs = Math.max(1, Date.now() - startedAt);
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (params.provider === 'alibaba') {
      recordAlibabaUsage(false, { latencyMs, statusCode: res.status, errorMsg: errBody });
    }
    throw new Error(
      `${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`
    );
  }
  if (params.provider === 'alibaba') {
    recordAlibabaUsage(true, { latencyMs });
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

  if (provider === 'xingchi') {
    const res = await testXingchiConnection();
    return {
      ok: res.ok,
      model: res.model,
      message: res.ok
        ? `${res.message}${res.reply ? ` · Phản hồi: "${res.reply.slice(0, 40)}"` : ''}`
        : res.message,
    };
  }

  if (provider === 'alibaba') {
    const res = await testAlibabaModelStudioConnection();
    return {
      ok: res.ok,
      model: res.model,
      message: res.ok
        ? `${res.message}${res.reply ? ` · Phản hồi: "${res.reply.slice(0, 40)}"` : ''}`
        : res.message,
    };
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
  BuiltInStudioVideoStyle,
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
  cinematic_filmmaking: {
    labelVi: CINEMATIC_FILMMAKING_SKILL.nameVi,
    promptDirective: CINEMATIC_FILMMAKING_SKILL.promptDirectiveEn,
    visualToneVi: CINEMATIC_FILMMAKING_SKILL.visualToneVi,
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
  custom: {
    labelVi: 'Tự viết phong cách',
    promptDirective:
      'Custom director visual style following the exact aesthetic, color palette, lighting, and camera specifications provided',
    visualToneVi: 'Phong cách tùy chỉnh theo mô tả riêng của người dùng',
  },
};

const LEARNED_STYLES_FILE = path.join(process.cwd(), 'data', 'learned_video_styles.json');

function ensureLearnedStylesFile(): void {
  const dir = path.dirname(LEARNED_STYLES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LEARNED_STYLES_FILE)) {
    fs.writeFileSync(LEARNED_STYLES_FILE, '[]', 'utf8');
  }
}

export function listLearnedVideoStyles(): LearnedVideoStyle[] {
  try {
    ensureLearnedStylesFile();
    const raw = fs.readFileSync(LEARNED_STYLES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getLearnedVideoStyleById(idOrValue: string): LearnedVideoStyle | undefined {
  const cleanId = String(idOrValue || '').replace(/^learned:/, '').trim();
  if (!cleanId) return undefined;
  return listLearnedVideoStyles().find((s) => s.id === cleanId);
}

export function saveLearnedVideoStyle(input: Partial<LearnedVideoStyle>): LearnedVideoStyle {
  const list = listLearnedVideoStyles();
  const name = String(input.name || '').trim() || `Phong cách mẫu #${list.length + 1}`;
  const id = String(input.id || '').trim() || `stl_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const record: LearnedVideoStyle = {
    id,
    name: name.slice(0, 80),
    sourceLabel: String(input.sourceLabel || 'Video mẫu').trim().slice(0, 140),
    ...(input.sourceUrl ? { sourceUrl: String(input.sourceUrl).trim() } : {}),
    promptDirective: String(input.promptDirective || '').trim(),
    visualToneVi: String(input.visualToneVi || '').trim(),
    artStyleAndLinework: String(input.artStyleAndLinework || '').trim(),
    colorPalette: String(input.colorPalette || '').trim(),
    lightingStyle: String(input.lightingStyle || '').trim(),
    cameraAndComposition: String(input.cameraAndComposition || '').trim(),
    characterRendering: String(input.characterRendering || '').trim(),
    sampleFrames: Array.isArray(input.sampleFrames) ? input.sampleFrames.slice(0, 4) : [],
    usedProvider: input.usedProvider,
    usedModel: input.usedModel,
    createdAt: input.createdAt || Date.now(),
  };
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }
  ensureLearnedStylesFile();
  fs.writeFileSync(LEARNED_STYLES_FILE, JSON.stringify(list.slice(0, 50), null, 2), 'utf8');
  return record;
}

export function deleteLearnedVideoStyle(idOrValue: string): boolean {
  const cleanId = String(idOrValue || '').replace(/^learned:/, '').trim();
  const list = listLearnedVideoStyles();
  const next = list.filter((s) => s.id !== cleanId);
  if (next.length === list.length) return false;
  ensureLearnedStylesFile();
  fs.writeFileSync(LEARNED_STYLES_FILE, JSON.stringify(next, null, 2), 'utf8');
  return true;
}

export function resolveVideoStyleMeta(
  videoStyle?: StudioVideoStyle,
  customStylePrompt?: string
): {
  styleKey: StudioVideoStyle;
  labelVi: string;
  promptDirective: string;
  visualToneVi: string;
  learnedStyle?: LearnedVideoStyle;
} {
  const raw = String(videoStyle || 'cinematic').trim();
  if (raw.startsWith('learned:')) {
    const learned = getLearnedVideoStyleById(raw);
    if (learned) {
      return {
        styleKey: `learned:${learned.id}`,
        labelVi: learned.name,
        promptDirective: learned.promptDirective || learned.visualToneVi,
        visualToneVi: learned.visualToneVi || learned.promptDirective,
        learnedStyle: learned,
      };
    }
  }
  if (raw === 'custom') {
    const custom = String(customStylePrompt || '').trim();
    const base = STUDIO_VIDEO_STYLE_META.custom;
    return {
      styleKey: 'custom',
      labelVi: base.labelVi,
      promptDirective: custom || base.promptDirective,
      visualToneVi: custom || base.visualToneVi,
    };
  }
  const builtInKey: BuiltInStudioVideoStyle =
    raw in STUDIO_VIDEO_STYLE_META ? (raw as BuiltInStudioVideoStyle) : 'cinematic';
  return {
    styleKey: builtInKey,
    ...STUDIO_VIDEO_STYLE_META[builtInKey],
  };
}

export async function analyzeSampleVideoAndLearnStyle(params: {
  videoPath: string;
  sourceLabel: string;
  sourceUrl?: string;
  styleName?: string;
  aiProvider?: AiProviderId;
  useProModel?: boolean;
}): Promise<LearnedVideoStyle> {
  if (!fs.existsSync(params.videoPath)) {
    throw new Error('Không tìm thấy tệp video mẫu để phân tích.');
  }
  const durationSec = Math.max(0.5, await probeDurationSeconds(params.videoPath, STUDIO_ASSETS_DIR));
  const workId = `learnstyle_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const tmpDir = path.join(STUDIO_ASSETS_DIR, workId);
  fs.mkdirSync(tmpDir, { recursive: true });

  const frameBuffers: Buffer[] = [];
  const sampleFrameThumbs: string[] = [];
  let clipBuffer: Buffer | null = null;

  try {
    // 1. Extract up to 16 evenly spaced frames across the video
    const frameCount = durationSec < 3 ? 6 : durationSec < 8 ? 10 : 16;
    for (let i = 0; i < frameCount; i += 1) {
      const fraction = 0.05 + (0.9 * i) / Math.max(1, frameCount - 1);
      const seekSec = Math.max(0.05, Math.min(Math.max(0.1, durationSec - 0.15), durationSec * fraction));
      const framePath = path.join(tmpDir, `f_${String(i).padStart(2, '0')}.jpg`);
      const res = await spawnPromise(
        'ffmpeg',
        ['-y', '-ss', seekSec.toFixed(2), '-i', params.videoPath, '-vframes', '1', '-vf', 'scale=512:-2', '-q:v', '4', framePath],
        tmpDir,
        15_000
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (res.code === 0 && fs.existsSync(framePath)) {
        const buf = fs.readFileSync(framePath);
        if (buf.byteLength > 400) {
          frameBuffers.push(buf);
          if (sampleFrameThumbs.length < 4 && (i === 0 || i === Math.floor(frameCount / 3) || i === Math.floor((2 * frameCount) / 3) || i === frameCount - 1)) {
            const thumbPath = path.join(tmpDir, `th_${i}.jpg`);
            const thRes = await spawnPromise(
              'ffmpeg',
              ['-y', '-i', framePath, '-vf', 'scale=220:-2', '-q:v', '6', thumbPath],
              tmpDir,
              8000
            ).catch(() => ({ code: 1 }));
            if (thRes.code === 0 && fs.existsSync(thumbPath)) {
              sampleFrameThumbs.push(`data:image/jpeg;base64,${fs.readFileSync(thumbPath).toString('base64')}`);
            } else {
              sampleFrameThumbs.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
            }
          }
        }
      }
    }

    if (frameBuffers.length === 0) {
      throw new Error('Không trích xuất được khung hình từ video mẫu (tệp có thể bị lỗi hoặc thiếu FFmpeg).');
    }

    // 2. Extract 1 short low-res muted clip (up to 6s) for motion/camera pacing analysis on Gemini
    if (durationSec >= 2) {
      const clipStart = Math.max(0, Math.min(durationSec - 2, durationSec * 0.25));
      const clipDur = Math.min(6, Math.max(2, durationSec - clipStart));
      const clipPath = path.join(tmpDir, 'sample_clip.mp4');
      const clipRes = await spawnPromise(
        'ffmpeg',
        [
          '-y',
          '-ss',
          clipStart.toFixed(2),
          '-t',
          clipDur.toFixed(2),
          '-i',
          params.videoPath,
          '-an',
          '-vf',
          'scale=360:-2,fps=12',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '31',
          '-movflags',
          '+faststart',
          clipPath,
        ],
        tmpDir,
        35_000
      ).catch(() => ({ code: 1 }));
      if (clipRes.code === 0 && fs.existsSync(clipPath)) {
        const buf = fs.readFileSync(clipPath);
        if (buf.byteLength > 2000 && buf.byteLength <= 4_200_000) {
          clipBuffer = buf;
        }
      }
    }

    const userProvidedName = String(params.styleName || '').trim();
    const analysisPrompt = `Bạn là Chuyên gia Chỉ đạo Nghệ thuật & Phân tích Phong cách Hình ảnh Video (Visual Style Director).
NHIỆM VỤ: Phân tích kỹ ${frameBuffers.length} khung hình rải đều${clipBuffer ? ' cùng đoạn clip ngắn' : ''} của video mẫu để TRÍCH XUẤT CÔNG THỨC PHONG CÁCH THỊ GIÁC (Visual Style DNA), sao cho khi áp dụng vào các nhân vật & câu chuyện HOÀN TOÀN MỚI sẽ ra đúng chất ảnh/nét vẽ, bảng màu, ánh sáng, tỷ lệ nhân vật và cách quay giống video mẫu.

NGUYÊN TẮC BẮT BUỘC:
- KHÔNG kể lại nội dung câu chuyện cụ thể hay tên nhân vật riêng của video mẫu vào "promptDirective".
- CHỈ trích xuất thuần túy: chất liệu hình ảnh (2D vector, hoạt hình đầu tròn tối giản, anime cel-shaded, 3D Pixar/Unreal, điện ảnh 35mm, quay điện thoại vlog...), độ dày nét viền / kết cấu bề mặt, bảng màu & độ tương phản, kiểu ánh sáng & bóng đổ, đặc trưng tỷ lệ đầu-thân/mắt/biểu cảm nhân vật, và góc quay/bố cục/nhịp chuyển động máy.
${userProvidedName ? `- Tên phong cách người dùng đặt: "${userProvidedName}" (giữ nguyên tên này cho "suggestedName").` : '- Hãy tự đặt "suggestedName" thật ngắn gọn, súc tích bằng Tiếng Việt (2–6 từ, ví dụ: "Hoạt hình đầu tròn tối giản", "Cổ trang Anime huyền ảo", "Điện ảnh Neon tương phản cao").'}

TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ (không markdown, không giải thích thừa):
{
  "suggestedName": "${userProvidedName || 'Tên phong cách ngắn gọn bằng Tiếng Việt'}",
  "artStyleAndLinework": "Mô tả chi tiết nét vẽ / chất ảnh / kỹ thuật dựng hình bằng Tiếng Việt (1-2 câu)",
  "colorPalette": "Mô tả bảng màu chủ đạo, sắc độ và độ tương phản bằng Tiếng Việt (1 câu)",
  "lightingStyle": "Mô tả ánh sáng, bóng đổ và không khí thị giác bằng Tiếng Việt (1 câu)",
  "cameraAndComposition": "Mô tả góc máy, bố cục khung hình và chuyển động máy bằng Tiếng Việt (1 câu)",
  "characterRendering": "Mô tả phong cách tạo hình nhân vật: tỷ lệ đầu/cơ thể, mắt, nét biểu cảm, trang phục bằng Tiếng Việt (1 câu)",
  "visualToneVi": "Tóm tắt hoàn chỉnh phong cách hình ảnh này bằng Tiếng Việt (2 câu ngắn gọn để hiển thị & đưa vào Visual Style Bible)",
  "promptDirective": "Detailed, production-ready ENGLISH visual style prompt (65-115 words) specifying exact rendering medium, linework/texture, color grading, lighting setup, character proportions/styling, and cinematography style — strictly style-only, zero specific plot or named characters from the sample video."
}`;

    let parsed: any = {};
    let usedProvider: AiProviderId = params.aiProvider || 'gemini';
    let usedModel = 'gemini-4-hydrogen';

    // Prefer OpenAI Vision only if explicitly requested and OpenAI key exists; otherwise use Gemini multimodal (supports both 16 frames + short MP4 clip)
    if (usedProvider === 'openai' && process.env.OPENAI_API_KEY?.trim()) {
      const cfg = resolveOpenAiCompatibleConfig('openai');
      usedModel = cfg.model;
      const contentParts: any[] = [{ type: 'text', text: analysisPrompt }];
      for (const fb of frameBuffers.slice(0, 12)) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${fb.toString('base64')}`, detail: 'low' },
        });
      }
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: 'Return a single valid JSON object matching the requested schema.' },
            { role: 'user', content: contentParts },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`);
      }
      const json = (await res.json()) as any;
      parsed = parseAiBlueprintJsonSafe(String(json?.choices?.[0]?.message?.content || '{}'));
    } else {
      usedProvider = 'gemini';
      const ai = getGeminiClient();
      const parts: any[] = frameBuffers.map((fb) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data: fb.toString('base64'),
        },
      }));
      if (clipBuffer) {
        parts.push({
          inlineData: {
            mimeType: 'video/mp4',
            data: clipBuffer.toString('base64'),
          },
        });
      }
      parts.push({ text: analysisPrompt });

      const candidateModels = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let lastErr: any;
      for (const candidateModel of candidateModels) {
        try {
          const activeParts =
            candidateModel === 'gemini-3.1-flash-lite'
              ? [...frameBuffers.slice(0, 8).map((fb) => ({ inlineData: { mimeType: 'image/jpeg', data: fb.toString('base64') } })), { text: analysisPrompt }]
              : parts;
          const response = await retryWithGeminiBackoff(
            () =>
              ai.models.generateContent({
                model: candidateModel,
                contents: { parts: activeParts },
                config: {
                  httpOptions: { timeout: 60_000 },
                  maxOutputTokens: 2048,
                  ...(candidateModel.startsWith('gemini-4-')
                    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                    : {}),
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    required: [
                      'suggestedName',
                      'artStyleAndLinework',
                      'colorPalette',
                      'lightingStyle',
                      'cameraAndComposition',
                      'characterRendering',
                      'visualToneVi',
                      'promptDirective',
                    ],
                    properties: {
                      suggestedName: { type: Type.STRING },
                      artStyleAndLinework: { type: Type.STRING },
                      colorPalette: { type: Type.STRING },
                      lightingStyle: { type: Type.STRING },
                      cameraAndComposition: { type: Type.STRING },
                      characterRendering: { type: Type.STRING },
                      visualToneVi: { type: Type.STRING },
                      promptDirective: { type: Type.STRING },
                    },
                  },
                },
              }),
            [1200, 2600]
          );
          parsed = parseAiBlueprintJsonSafe((response?.text ?? '{}').trim());
          if (String(parsed?.promptDirective || '').trim()) {
            usedModel = candidateModel;
            break;
          }
        } catch (err: any) {
          lastErr = err;
          if (!shouldFallbackGeminiModel(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }
      if (!String(parsed?.promptDirective || '').trim() && lastErr) {
        throw new Error(formatGeminiError(lastErr));
      }
    }

    const finalPromptDirective = String(parsed?.promptDirective || '').trim();
    if (!finalPromptDirective) {
      throw new Error('AI chưa trích xuất được mô tả phong cách hợp lệ từ video mẫu.');
    }

    return saveLearnedVideoStyle({
      name: userProvidedName || String(parsed?.suggestedName || '').trim() || `Phong cách ${params.sourceLabel.slice(0, 28)}`,
      sourceLabel: params.sourceLabel,
      sourceUrl: params.sourceUrl,
      promptDirective: finalPromptDirective,
      visualToneVi: String(parsed?.visualToneVi || '').trim() || finalPromptDirective,
      artStyleAndLinework: String(parsed?.artStyleAndLinework || '').trim(),
      colorPalette: String(parsed?.colorPalette || '').trim(),
      lightingStyle: String(parsed?.lightingStyle || '').trim(),
      cameraAndComposition: String(parsed?.cameraAndComposition || '').trim(),
      characterRendering: String(parsed?.characterRendering || '').trim(),
      sampleFrames: sampleFrameThumbs,
      usedProvider,
      usedModel,
    });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
}

export function buildSceneTimelineFallback(sc: Partial<DerivativeScene>): string {
  const dur = Math.max(4, Math.min(120, Math.round(Number(sc.durationSec || 8))));
  const t1End = Math.max(2, Math.min(dur - 2, Math.round(dur * 0.3)));
  const t2Start = Math.min(dur - 1, t1End + 1);
  const t2End = Math.max(t2Start, Math.min(dur - 1, Math.round(dur * 0.7)));
  const t3Start = Math.min(dur, t2End + 1);

  const angle = (sc.cameraAngle || 'Toàn cảnh / Trung cảnh').trim();
  const move = (sc.cameraMovement || 'Đẩy máy chậm (Slow dolly-in)').trim();
  const setting = (sc.settingDetail || 'Không gian đồng bộ theo bối cảnh').trim();
  const chars = (sc.charactersInScene || 'Nhân vật').trim();
  const action = (sc.actionDetail || sc.sceneSummary || 'Nhân vật thực hiện hành động chính của cảnh').trim();
  const dialogue = (sc.dialogue || '').trim();
  const endState = (sc.sceneEndState || 'Giữ trọn biểu cảm và chuyển động chuyển tiếp sang cảnh sau').trim();

  const lines: string[] = [
    `1s - ${t1End}s: [Góc quay: ${angle} | Camera: ${move}] Mở khung hình giới thiệu bối cảnh (${setting}) và sự xuất hiện của ${chars}.`,
  ];

  if (dialogue) {
    lines.push(
      `${t2Start}s - ${t2End}s: [Cận cảnh / Trung cảnh đối thoại] ${chars} trực tiếp nói lời thoại với khẩu hình khớp chính xác (lip-sync): "${dialogue}" kết hợp hành động: ${action}.`
    );
  } else {
    lines.push(
      `${t2Start}s - ${t2End}s: [Chuyển động chính | ${move}] ${chars} thực hiện rõ hành động: ${action}.`
    );
  }

  if (t3Start <= dur) {
    lines.push(
      `${t3Start}s - ${dur}s: [Theo sát chuyển động | ${move}] Hoàn tất nhịp hành động hướng tới trạng thái cuối: ${endState}.`
    );
  }

  return lines.join('\n');
}

export function formatCharacterSyncProfilesForScene(
  scene: Partial<DerivativeScene>,
  characterRefs?: StudioCharacterRefInput[]
): string {
  if (!Array.isArray(characterRefs) || characterRefs.length === 0) return '';
  const selectedIds = new Set(Array.isArray(scene.selectedCharacterIds) ? scene.selectedCharacterIds : []);
  const corpus = normalizeCharacterMatchText(
    [scene.charactersInScene || '', scene.dialogue || '', scene.sceneSummary || '', scene.actionDetail || ''].join(' | ')
  );
  const matched = characterRefs.filter((c) => {
    if (selectedIds.size > 0 && c.id && selectedIds.has(c.id)) return true;
    const aliases = extractCharacterAliases(c.name || '');
    return aliases.some((al) => corpus.includes(al));
  });
  const targets = matched.length > 0 ? matched : characterRefs.slice(0, 2);
  const blocks = targets
    .map((c, idx) => {
      const cname = (c.name || `Nhân vật #${idx + 1}`).trim();
      const sp = c.syncProfile;
      if (!sp) return c.description?.trim() ? `${cname}: ${c.description.trim()}` : '';
      const fields = [
        sp.face?.trim() ? `Gương mặt: ${sp.face.trim()}` : '',
        sp.physique?.trim() ? `Vóc dáng: ${sp.physique.trim()}` : '',
        sp.costume?.trim() ? `Trang phục: ${sp.costume.trim()}` : '',
        sp.voice?.trim() ? `Giọng nói: ${sp.voice.trim()}` : '',
        sp.distinguishingMarks?.trim() ? `Đặc điểm nhận dạng: ${sp.distinguishingMarks.trim()}` : '',
      ].filter(Boolean);
      if (fields.length === 0) return c.description?.trim() ? `${cname}: ${c.description.trim()}` : '';
      return `${cname} (${fields.join('; ')})`;
    })
    .filter(Boolean);
  return blocks.join(' | ');
}

function buildLockedCharacterSeedsAndBibles(params: {
  characterRefsMeta?: StudioCharacterRefMetaInput[];
  characterRefs?: StudioCharacterRefInput[];
  characterBible?: string;
  costumeBible?: string;
}): {
  seeds: LockedCharacterProfileSeed[];
  canonicalCharacterBible: string;
  canonicalCostumeBible: string;
} {
  const sourceList: Array<{
    id?: string;
    name?: string;
    description?: string;
    syncProfile?: CharacterFivePartProfile;
    ageGroup?: CharacterAgeGroup;
    gender?: CharacterGenderHint;
  }> =
    Array.isArray(params.characterRefsMeta) && params.characterRefsMeta.length > 0
      ? params.characterRefsMeta
      : Array.isArray(params.characterRefs)
      ? params.characterRefs
      : [];

  const seeds: LockedCharacterProfileSeed[] = sourceList.map((c, idx) => {
    const sp = c.syncProfile;
    const name = String(c.name || `Nhân vật ${idx + 1}`).trim();
    const desc = String(c.description || '').trim();
    return {
      id: c.id,
      name,
      description: desc || undefined,
      syncProfile: {
        face: sp?.face?.trim() || desc || undefined,
        physique: sp?.physique?.trim() || undefined,
        costume: sp?.costume?.trim() || undefined,
        voice: sp?.voice?.trim() || undefined,
        distinguishingMarks: sp?.distinguishingMarks?.trim() || undefined,
      },
    };
  });

  const charIdentityLines = seeds
    .map((s) => {
      const sp = s.syncProfile || {};
      const parts = [
        sp.face ? `Gương mặt/tóc: ${sp.face}` : '',
        sp.physique ? `Vóc dáng: ${sp.physique}` : '',
        sp.distinguishingMarks ? `Nhận dạng: ${sp.distinguishingMarks}` : '',
        !sp.face && s.description ? s.description : '',
      ].filter(Boolean);
      return parts.length > 0 ? `${s.name}: ${parts.join('; ')}` : '';
    })
    .filter(Boolean);

  const charCostumeLines = seeds
    .map((s) => {
      const cst = s.syncProfile?.costume?.trim();
      return cst ? `${s.name}: ${cst}` : '';
    })
    .filter(Boolean);

  const canonicalCharacterBible =
    String(params.characterBible || '').trim() || charIdentityLines.join(' | ');
  const canonicalCostumeBible =
    charCostumeLines.length > 0
      ? charCostumeLines.join(' | ')
      : String(params.costumeBible || '').trim();

  return {
    seeds,
    canonicalCharacterBible,
    canonicalCostumeBible,
  };
}

export function compileConsistentScenePrompt(params: {
  scene: Partial<DerivativeScene>;
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  characterRefs?: StudioCharacterRefInput[];
  enableVoiceover?: boolean;
  totalScenes?: number;
  mediaType?: 'image' | 'video';
  hasAttachedRefs?: boolean;
  targetEngine?: 'muse2api' | 'gemini';
  allowFreeCostumeChange?: boolean;
}): string {
  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const resolvedStyle = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const styleKey = resolvedStyle.styleKey;
  const styleMeta = resolvedStyle;
  const sc = params.scene;
  const mediaType = params.mediaType || 'image';
  const parts: string[] = [];

  const sceneNumLabel = sc.sceneIndex
    ? `Scene ${String(sc.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}`
    : 'Scene';

  // 1. Style directive + Scene Core Plot (sceneSummary) FIRST so truncation never drops what happens
  parts.push(`Visual Style Reference: ${styleMeta.promptDirective}.`);
  if (sc.sceneSummary?.trim()) {
    parts.push(`Primary Scene Content / Main Plot Event (MUST depict faithfully): ${sc.sceneSummary.trim()}.`);
  }
  if (sc.sceneTitle?.trim()) {
    parts.push(`${sceneNumLabel} Title: ${sc.sceneTitle.trim()}.`);
  }

  // 2. For VIDEO prompts: Per-second Timeline + Lip-Sync Character Dialogue immediately after plot summary
  const dur = Math.max(3, Math.round(Number(sc.durationSec || 8)));
  if (mediaType === 'video') {
    const timelineText = (sc.videoTimeline || '').trim() || buildSceneTimelineFallback(sc);
    parts.push(`Per-Second Scene Timeline (${dur}s): ${timelineText.replace(/\n+/g, ' | ')}.`);
    if (sc.dialogue?.trim()) {
      parts.push(
        `Character Direct Spoken Dialogue & Lip-Sync (MUST show the character speaking these exact lines on camera with synchronized lip movements and expressive voice, NOT third-person narrator voiceover): ${sc.dialogue.trim()}.`
      );
    }
    if (params.enableVoiceover !== false && sc.narration?.trim()) {
      const narr = sc.narration.trim();
      const dial = (sc.dialogue || '').trim();
      if (!dial || narr !== dial) {
        parts.push(`Narrator Background Context (keep strictly separate from on-screen character dialogue): ${narr}.`);
      }
    }
  }

  if (sc.actionDetail?.trim()) {
    parts.push(`Action: ${sc.actionDetail.trim()}.`);
  }
  if (sc.charactersInScene?.trim()) {
    parts.push(`Characters Present: ${sc.charactersInScene.trim()}.`);
  }
  const perCharSyncText = formatCharacterSyncProfilesForScene(sc, params.characterRefs);
  if (perCharSyncText) {
    parts.push(`Per-Character 5-Part Sync Profiles: ${perCharSyncText}.`);
  }
  if (sc.settingDetail?.trim()) {
    parts.push(`Environment/Setting: ${sc.settingDetail.trim()}.`);
  }
  if (sc.costume?.trim()) {
    parts.push(
      allowFreeCostumeChange
        ? `Costume in Scene (scene-specific wardrobe allowed): ${sc.costume.trim()}.`
        : `Locked Costume in Scene (STRICT 100% LOCK — do NOT add outerwear, change colors, or redesign): ${sc.costume.trim()}.`
    );
  }

  const primaryPrompt =
    mediaType === 'video'
      ? sc.videoPrompt?.trim() || sc.imagePrompt?.trim() || sc.visualNote?.trim()
      : sc.imagePrompt?.trim() || sc.visualNote?.trim() || sc.videoPrompt?.trim();

  if (primaryPrompt) {
    parts.push(`${mediaType === 'video' ? 'Detailed Real-Time Video Prompt' : 'Detailed Image Prompt'}: ${primaryPrompt}.`);
  }

  if (sc.cameraAngle?.trim()) {
    parts.push(`Camera Angle: ${sc.cameraAngle.trim()}.`);
  }
  if (sc.cameraMovement?.trim()) {
    parts.push(`Camera Movement: ${sc.cameraMovement.trim()}.`);
  }
  if (sc.cameraEquipment?.trim()) {
    parts.push(`Camera Equipment & Lens: ${sc.cameraEquipment.trim()}.`);
  }
  if (sc.lighting?.trim()) {
    parts.push(`Lighting: ${sc.lighting.trim()}.`);
  }
  if (sc.shotStyle?.trim()) {
    parts.push(`Shot Style: ${sc.shotStyle.trim()}.`);
  }
  if (sc.continuityNote?.trim()) {
    parts.push(`Continuity From Previous Scene: ${sc.continuityNote.trim()}.`);
  }
  if (mediaType === 'video') {
    const durNote = sc.durationSec ? `${Math.round(sc.durationSec)}s continuous real-time action` : 'continuous real-time action';
    parts.push(`Motion & Continuity (${durNote}): smooth natural motion without jarring cuts, coherent physical continuity.`);
    if (sc.sceneEndState?.trim()) {
      parts.push(`Ending State: ${sc.sceneEndState.trim()}.`);
    }
  }

  // 3. Append 5-part synchronization bibles cleanly after the scene plot & timeline
  if (styleMeta.learnedStyle) {
    if (styleMeta.learnedStyle.characterRendering) {
      parts.push(`Learned Character Rendering Style: ${styleMeta.learnedStyle.characterRendering}.`);
    }
    if (styleMeta.learnedStyle.colorPalette) {
      parts.push(`Learned Color Palette: ${styleMeta.learnedStyle.colorPalette}.`);
    }
  }
  if (params.visualStyleBible?.trim()) {
    parts.push(`Color & Aesthetic Lock: ${params.visualStyleBible.trim()}.`);
  }
  if (params.characterBible?.trim()) {
    parts.push(`Character Reference (MUST keep face, hair, age, body 100% identical): ${params.characterBible.trim()}.`);
  }
  if (params.costumeBible?.trim()) {
    parts.push(
      allowFreeCostumeChange
        ? `Costume Context (IDENTITY LOCK: keep face, hair & physique 100% identical while outfit follows scene prompt): ${params.costumeBible.trim()}.`
        : `STRICT COSTUME LOCK (DO NOT alter, add, remove, or redesign reference outfits/accessories regardless of weather/setting): ${params.costumeBible.trim()}.`
    );
  }
  if (params.settingBible?.trim()) {
    parts.push(`Environment Reference: ${params.settingBible.trim()}.`);
  }
  if (params.continuityBible?.trim()) {
    parts.push(`Story Continuity Anchor: ${params.continuityBible.trim()}.`);
  }
  const compiledBase = parts.join(' ');
  const styledCompiled =
    styleKey === 'cinematic_filmmaking'
      ? enhancePromptWithCinematicSkill({
          basePrompt: compiledBase,
          mediaType,
          sceneIndex: sc.sceneIndex,
          totalScenes: params.totalScenes,
        })
      : compiledBase;

  return compileProductionModelPrompt({
    rawCompiledPrompt: styledCompiled,
    mode: 'scene',
    mediaType,
    hasAttachedRefs: Boolean(params.hasAttachedRefs),
    cameraAngle: sc.cameraAngle,
    vfxNotes: sc.vfxNotes,
    targetEngine: params.targetEngine || 'gemini',
    characterBible: params.characterBible,
    costumeBible: params.costumeBible,
    allowFreeCostumeChange,
  }).prompt;
}

export interface StudioCharacterRefInput {
  id?: string;
  name?: string;
  dataUrl: string;
  description?: string;
  syncProfile?: CharacterFivePartProfile;
  source?: 'uploaded' | 'ai_generated';
  ageGroup?: CharacterAgeGroup;
  gender?: CharacterGenderHint;
  voiceMode?: 'default' | 'ai_online' | 'offline_system';
  voiceId?: Exclude<DerivativeVoiceId, 'none'>;
  offlineVoice?: string;
  voiceStyle?: string;
  accentLock?: 'vn_north';
}

export interface StudioCharacterRefMetaInput {
  id: string;
  name: string;
  description?: string;
  syncProfile?: CharacterFivePartProfile;
  ageGroup?: CharacterAgeGroup;
  gender?: CharacterGenderHint;
  voiceId?: Exclude<DerivativeVoiceId, 'none'>;
}

export interface IndependentConceptOverride {
  title: string;
  premise: string;
  coreMotif?: string;
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

export interface ExpandedCreativeIdeaItem {
  id: string;
  index: number;
  title: string;
  summary: string;
  detail: string;
  suggestedSetting?: string;
}

function resolveDesiredSceneCount(
  desiredTotalSec: number,
  explicitSceneCount?: number,
  _scriptMode: StudioScriptMode = 'series'
): number {
  if (typeof explicitSceneCount === 'number' && Number.isFinite(explicitSceneCount) && explicitSceneCount >= 1) {
    return Math.max(1, Math.min(24, Math.round(explicitSceneCount)));
  }
  // 1 setting = configured duration naturally (e.g. 10s -> 1 single 10s scene, not fragmented 3-4s clips)
  if (desiredTotalSec <= 15) return 1;
  if (desiredTotalSec <= 25) return 2;
  if (desiredTotalSec <= 35) return 3;
  if (desiredTotalSec <= 45) return 4;
  if (desiredTotalSec <= 75) return 6;
  if (desiredTotalSec <= 135) return 10;
  if (desiredTotalSec <= 210) return 12;
  if (desiredTotalSec <= 360) return 16;
  return 20;
}

export async function expandStudioIdeaWithAi(params: {
  seedIdea: string;
  settingHint?: string;
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  scriptMode?: StudioScriptMode;
  ideaCount?: number;
  targetDurationSec?: number;
  outputLanguage?: DerivativeOutputLanguage;
  characterSummary?: string;
  characterRefsMeta?: StudioCharacterRefMetaInput[];
  allowFreeCostumeChange?: boolean;
  aiProvider?: AiProviderId;
  useProModel?: boolean;
}): Promise<{
  ideas: ExpandedCreativeIdeaItem[];
  expandedIdea: string;
  suggestedSetting?: string;
  usedProvider: AiProviderId;
  usedModel: string;
}> {
  const seed = String(params.seedIdea || '').trim();
  if (!seed) {
    throw new Error('Vui lòng nhập tóm tắt ý tưởng ban đầu trước khi nhờ AI triển khai.');
  }

  const ideaCount = Math.max(1, Math.min(15, Math.round(Number(params.ideaCount || 3))));
  const provider: AiProviderId =
    params.aiProvider === 'openai' ||
    params.aiProvider === 'meta' ||
    params.aiProvider === 'muse2api' ||
    params.aiProvider === 'xingchi' ||
    params.aiProvider === 'alibaba'
      ? params.aiProvider
      : 'gemini';

  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const lockBundle = buildLockedCharacterSeedsAndBibles({
    characterRefsMeta: Array.isArray(params.characterRefsMeta) ? params.characterRefsMeta : [],
  });
  const lockRulesText =
    lockBundle.seeds.length > 0
      ? buildReferenceCharacterLockRules({
          allowFreeCostumeChange,
          characters: lockBundle.seeds,
          fallbackCostumeBible: lockBundle.canonicalCostumeBible,
        })
      : '';

  const styleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';
  const durationSec = Math.max(10, Math.min(900, Math.round(Number(params.targetDurationSec || 60))));
  const totalCombinedSec = ideaCount * durationSec;
  const modeLabel =
    params.scriptMode === 'independent_batch'
      ? `Lô nhiều video độc lập (${ideaCount} kịch bản độc lập phái sinh cùng mô-típ gốc, mỗi video ${durationSec}s, tổng lô ${totalCombinedSec}s)`
      : `Series liên hoàn (1 kịch bản tổng thể chia thành ${ideaCount} phân cảnh liên tiếp, mỗi phân cảnh ${durationSec}s, tổng video ${totalCombinedSec}s)`;

  const expandPrompt = `Bạn là Giám đốc Sáng tạo & Biên kịch Bối cảnh Video AI chuyên nghiệp.
NHIỆM VỤ: Từ "Tóm tắt ý tưởng ban đầu" của người dùng, hãy sáng tạo ĐÚNG ${ideaCount} Ý TƯỞNG RIÊNG BIỆT, RÕ RÀNG, HẤP DẪN để người dùng chọn 1 ý tưởng bất kỳ và chuyển thẳng thành prompt kịch bản hoàn chỉnh.

DỮ LIỆU ĐẦU VÀO:
- Tóm tắt ý tưởng / chủ đề ban đầu: "${seed}"
- Số lượng ý tưởng BẮT BUỘC phải tạo: ĐÚNG ${ideaCount} ý tưởng (không thừa, không thiếu)
${params.settingHint?.trim() ? `- Gợi ý bối cảnh từ người dùng: "${params.settingHint.trim()}"` : ''}
${params.characterSummary?.trim() ? `- Danh sách tên nhân vật tham chiếu (CHỈ gọi đúng tên, KHÔNG mô tả lại ngoại hình/trang phục chính): ${params.characterSummary.trim()}` : ''}
- Phong cách quay & hình ảnh: ${styleMeta.labelVi} (${styleMeta.visualToneVi})
- Hình thức triển khai dự kiến: ${modeLabel}
- Thời lượng dự kiến: ${params.scriptMode === 'independent_batch' ? `${durationSec} giây / video độc lập` : `${durationSec} giây / phân cảnh (tổng ${totalCombinedSec} giây cho ${ideaCount} phân cảnh liên tiếp)`}
- Ngôn ngữ đầu ra: ${OUTPUT_LANG_LABELS[outputLang]}
${CREATIVE_CONTEXT_CHARACTER_BOUNDARY_RULES}
${lockRulesText ? `\n${lockRulesText}` : ''}

YÊU CẦU BẮT BUỘC CHO TỪNG Ý TƯỞNG TRONG DANH SÁCH (${ideaCount} Ý TƯỞNG):
1. TẤT CẢ ${ideaCount} ý tưởng PHẢI tuân thủ chặt chẽ chủ đề, thể loại, tinh thần và định hướng ban đầu của người dùng ("${seed}") — KHÔNG đi lạc đề.
${
  params.scriptMode === 'independent_batch' && ideaCount > 1
    ? `2. QUY TẮC LÔ NHIỀU VIDEO ĐỘC LẬP PHÁI SINH CÙNG MÔ-TÍP:
   - Cả ${ideaCount} ý tưởng đều PHẢI xoay quanh CÙNG MỘT MÔ-TÍP CỐT TRUYỆN & CẤU TRÚC TÌNH HUỐNG CỐT LÕI của ý tưởng gốc ("${seed}"), KHÔNG được sáng tạo sang các câu chuyện ngẫu nhiên khác mô-típ chỉ vì cùng thể loại.
   - Thay đổi rõ rệt nhân vật/nghề nghiệp, phương tiện/cách tiếp cận, bối cảnh cụ thể, ngoại hình/hành vi bất thường và diễn biến kết thúc để mỗi ý tưởng là 1 video độc lập trọn vẹn trong ${durationSec} giây (không liên kết nối tiếp thành tập 1-2-3).`
    : `2. Mỗi ý tưởng PHẢI có nội dung, tình huống cụ thể, nút thắt và cao trào riêng biệt (KHÔNG trùng lặp máy móc giữa các ý tưởng).
   ${
     ideaCount === 1
       ? '- Vì người dùng chọn 1 ý tưởng, hãy triển khai sâu sắc, trọn vẹn đúng ý tưởng gốc thành bản phác thảo hoàn chỉnh (Mở đầu gây tò mò -> Diễn biến cao trào -> Kết thúc ấn tượng).'
       : `- Với ${ideaCount} ý tưởng, mỗi ý tưởng là 1 phương án kịch bản độc lập hoàn chỉnh, hấp dẫn ngay từ tiêu đề và phần tóm tắt 2-3 câu.`
   }`
}
3. MÔ TẢ CHÍNH XÁC BỐI CẢNH & HÀNH ĐỘNG THEO RANH GIỚI BẮT BUỘC:
   - Tập trung sâu vào: không gian & kiến trúc, cảnh quan/môi trường/thời tiết, ánh sáng/màu sắc/không khí, vị trí/tư thế/hành động nhân vật, góc máy/bố cục/chuyển động camera và đạo cụ/phụ kiện độc lập được phép (${ALLOWED_ACCESSORIES_LIST_VI}).
   - NGHIÊM CẤM TỰ MÔ TẢ NGOẠI HÌNH & TRANG PHỤC CHÍNH của nhân vật tham chiếu (không tự bịa khuôn mặt, màu da, kiểu tóc, vóc dáng hay quần áo chính).
4. Mỗi phần tử gồm:
   - "title": Tiêu đề ngắn gọn, gợi tò mò (KHÔNG tự ghi tiền tố "Ý tưởng 01:", hệ thống sẽ tự đánh số).
   - "summary": Đoạn tóm tắt tình huống cốt lõi 2–3 câu súc tích, rõ nhân vật/bối cảnh/sự kiện bất ngờ.
   - "detail": Triển khai chi tiết diễn biến (Mở đầu - Cao trào - Bước ngoặt - Kết thúc), không gian, ánh sáng, nhịp quay và hành động (khoảng 100–180 chữ) để khi người dùng bấm "Tạo prompt kịch bản", AI giữ nguyên 100% cốt truyện này.
   - "suggestedSetting": 1 câu ngắn mô tả không gian, thời điểm & ánh sáng chủ đạo của riêng ý tưởng này.
${SHORT_DRAMA_IDEA_EXPANSION_RULES}

TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ VỚI MẢNG "ideas" CÓ ĐÚNG ${ideaCount} PHẦN TỬ (không markdown, không giải thích thừa):
{
  "ideas": [
    {
      "title": "Tiêu đề ngắn gọn của ý tưởng #1",
      "summary": "Tóm tắt cốt truyện và tình huống cốt lõi 2-3 câu rõ ràng, hấp dẫn...",
      "detail": "Triển khai chi tiết diễn biến mở đầu - cao trào - kết thúc, bối cảnh, ánh sáng, hành động và góc quay...",
      "suggestedSetting": "Mô tả ngắn 1 câu về không gian & tông ánh sáng chủ đạo"
    }
  ]
}`;

  let parsed: any = {};
  let usedModel = 'gemini-4-hydrogen';
  const dynamicMaxTokens = Math.min(12288, Math.max(2400, 1400 + ideaCount * 650));

  try {
    if (provider === 'muse2api') {
      const st = await getMuse2ApiStatus();
      if (!st.reachable || !st.ready) {
        throw new Error(
          st.error ||
            'Muse2API chưa sẵn sàng hoặc chưa có tài khoản muse.ai hợp lệ. Hãy kiểm tra phần Quản lý Muse2API trong Cấu hình.'
        );
      }
      usedModel = 'muse-spark (Muse2API)';
      const raw = await chatWithMuse2ApiSpark([
        {
          role: 'system',
          content: `Chỉ trả về 1 đối tượng JSON thuần túy gồm mảng "ideas" có đúng ${ideaCount} phần tử (title, summary, detail, suggestedSetting), không giải thích ngoài JSON.`,
        },
        { role: 'user', content: expandPrompt },
      ]);
      parsed = parseAiBlueprintJsonSafe(raw);
    } else if (provider === 'xingchi') {
      const xcRes = await callXingchiCompletion({
        prompt: expandPrompt,
        systemPrompt: `Chỉ trả về JSON hợp lệ theo schema với đúng ${ideaCount} phần tử trong mảng "ideas".`,
        jsonMode: true,
        temperature: 0.78,
        timeoutMs: 70_000,
      });
      usedModel = xcRes.model;
      parsed = parseAiBlueprintJsonSafe(xcRes.text);
    } else if (provider === 'openai' || provider === 'meta' || provider === 'alibaba') {
      const cfg = resolveOpenAiCompatibleConfig(provider);
      if (!cfg.apiKey) {
        throw new Error(`Chưa cấu hình ${cfg.envName} trong Settings > Secrets hoặc tệp .env.`);
      }
      usedModel = cfg.model;
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            {
              role: 'system',
              content: `Chỉ trả về JSON hợp lệ theo schema với đúng ${ideaCount} phần tử trong mảng "ideas".`,
            },
            { role: 'user', content: expandPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.78,
        }),
        signal: AbortSignal.timeout(65_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`);
      }
      const data = (await res.json()) as any;
      parsed = parseAiBlueprintJsonSafe(String(data?.choices?.[0]?.message?.content || '{}'));
    } else {
      const ai = getGeminiClient();
      const baseCandidates = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      const candidateModels = prioritizeGeminiCandidateModels(baseCandidates);
      let lastErr: any;
      for (let mIdx = 0; mIdx < candidateModels.length; mIdx += 1) {
        const candidateModel = candidateModels[mIdx];
        const isLastCandidate = mIdx === candidateModels.length - 1;
        const callTimeoutMs = isLastCandidate ? 45_000 : 28_000;
        try {
          const response = await retryWithGeminiBackoff(
            () =>
              ai.models.generateContent({
                model: candidateModel,
                contents: [{ text: expandPrompt }],
                config: {
                  httpOptions: { timeout: callTimeoutMs },
                  maxOutputTokens: dynamicMaxTokens,
                  ...(candidateModel.startsWith('gemini-4-')
                    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                    : {}),
                  systemInstruction: `Luôn trả về ĐÚNG ${ideaCount} phần tử trong mảng "ideas" của JSON. Mỗi ý tưởng phải bám sát chủ đề ban đầu nhưng có tình huống & diễn biến riêng biệt, không trùng lặp.`,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    required: ['ideas'],
                    properties: {
                      ideas: {
                        type: Type.ARRAY,
                        minItems: String(ideaCount),
                        maxItems: String(ideaCount),
                        items: {
                          type: Type.OBJECT,
                          required: ['title', 'summary', 'detail'],
                          properties: {
                            title: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            detail: { type: Type.STRING },
                            suggestedSetting: { type: Type.STRING },
                          },
                        },
                      },
                    },
                  },
                },
              }),
            isLastCandidate ? [800] : []
          );
          const candidateParsed = parseAiBlueprintJsonSafe((response?.text ?? '{}').trim());
          if (
            (Array.isArray(candidateParsed?.ideas) && candidateParsed.ideas.length > 0) ||
            String(candidateParsed?.expandedIdea || '').trim()
          ) {
            parsed = candidateParsed;
            usedModel = candidateModel;
            break;
          }
        } catch (err: any) {
          lastErr = err;
          markGeminiModelOverloaded(candidateModel, err);
          if (!shouldFallbackGeminiModel(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }
      if (
        !(Array.isArray(parsed?.ideas) && parsed.ideas.length > 0) &&
        !String(parsed?.expandedIdea || '').trim() &&
        lastErr
      ) {
        throw lastErr;
      }
    }
  } catch (err: any) {
    if (provider === 'gemini') {
      throw new Error(formatGeminiError(err));
    }
    throw new Error(String(err?.message || err || 'AI không thể triển khai ý tưởng lúc này.'));
  }

  const rawIdeas: any[] = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  const normalizedIdeas: ExpandedCreativeIdeaItem[] = rawIdeas
    .filter((item) => item && (String(item.title || '').trim() || String(item.summary || '').trim() || String(item.detail || '').trim()))
    .slice(0, ideaCount)
    .map((item, idx) => {
      const cleanTitle = String(item.title || '')
        .replace(/^Ý\s*tưởng\s*\d+\s*[:.\-–—]\s*/i, '')
        .trim();
      const summary = String(item.summary || '').trim();
      const detail = String(item.detail || summary || '').trim();
      return {
        id: `idea_${Date.now()}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
        index: idx + 1,
        title: cleanTitle || `Phương án ${String(idx + 1).padStart(2, '0')} · ${seed.slice(0, 48)}`,
        summary: summary || detail.slice(0, 220),
        detail: detail || summary,
        suggestedSetting: String(item.suggestedSetting || '').trim() || undefined,
      };
    });

  // Backward-compatibility fallback if an OpenAI-compatible provider returned legacy { expandedIdea }
  if (normalizedIdeas.length === 0 && String(parsed?.expandedIdea || '').trim()) {
    const legacyText = String(parsed.expandedIdea).trim();
    normalizedIdeas.push({
      id: `idea_${Date.now()}_1_${crypto.randomBytes(2).toString('hex')}`,
      index: 1,
      title: seed.slice(0, 64),
      summary: legacyText.slice(0, 220),
      detail: legacyText,
      suggestedSetting: String(parsed?.suggestedSetting || '').trim() || undefined,
    });
  }

  if (normalizedIdeas.length === 0) {
    throw new Error('AI chưa trả về danh sách ý tưởng hợp lệ. Vui lòng thử lại.');
  }

  // Guarantee exact requested count cleanly if a provider slightly under-returned
  while (normalizedIdeas.length < ideaCount) {
    const base = normalizedIdeas[normalizedIdeas.length % normalizedIdeas.length];
    const nextNum = normalizedIdeas.length + 1;
    normalizedIdeas.push({
      id: `idea_${Date.now()}_${nextNum}_${crypto.randomBytes(2).toString('hex')}`,
      index: nextNum,
      title: `${base.title} (Góc tiếp cận #${String(nextNum).padStart(2, '0')})`,
      summary: base.summary,
      detail: `${base.detail} Khai thác góc nhìn tình huống mới và bước ngoặt bất ngờ khác biệt ở phần cao trào trong cùng chủ đề "${seed}".`,
      suggestedSetting: base.suggestedSetting,
    });
  }

  const first = normalizedIdeas[0];
  const expandedIdea = `${first.title}\n\n${first.summary}${first.detail && first.detail !== first.summary ? `\n\n${first.detail}` : ''}`;

  return {
    ideas: normalizedIdeas,
    expandedIdea,
    suggestedSetting: first.suggestedSetting || String(parsed?.suggestedSetting || '').trim() || undefined,
    usedProvider: provider,
    usedModel,
  };
}

async function extractDenseVideoFrames(
  asset: StudioAssetRecord,
  maxFrames = 8
): Promise<{ timestampLabel: string; mimeType: string; base64: string }[]> {
  if (!asset.filePath || !fs.existsSync(asset.filePath)) return [];
  const duration = Math.max(1, Number(asset.durationSec || 0));
  const frameCount = Math.max(3, Math.min(maxFrames, duration <= 12 ? 5 : duration <= 35 ? 7 : maxFrames));
  const results: { timestampLabel: string; mimeType: string; base64: string }[] = [];

  for (let i = 0; i < frameCount; i += 1) {
    const frac = frameCount === 1 ? 0.5 : 0.06 + (0.88 * i) / (frameCount - 1);
    const seekSec = Math.max(0.1, Math.min(Math.max(0.2, duration - 0.15), duration * frac));
    const frameOut = path.join(
      STUDIO_ASSETS_DIR,
      `watch_${asset.assetId}_${Date.now()}_${i}_${crypto.randomBytes(2).toString('hex')}.jpg`
    );
    try {
      const frameRes = await spawnPromise(
        'ffmpeg',
        ['-y', '-ss', seekSec.toFixed(2), '-i', asset.filePath, '-vframes', '1', '-vf', 'scale=720:-2', '-q:v', '4', frameOut],
        STUDIO_ASSETS_DIR,
        15_000
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (frameRes.code === 0 && fs.existsSync(frameOut)) {
        const jpgBuf = fs.readFileSync(frameOut);
        if (jpgBuf.byteLength > 500) {
          const mm = String(Math.floor(seekSec / 60)).padStart(2, '0');
          const ss = String(Math.floor(seekSec % 60)).padStart(2, '0');
          results.push({
            timestampLabel: `${mm}:${ss}`,
            mimeType: 'image/jpeg',
            base64: jpgBuf.toString('base64'),
          });
        }
      }
    } finally {
      try {
        if (fs.existsSync(frameOut)) fs.unlinkSync(frameOut);
      } catch {
        // ignore cleanup error
      }
    }
  }
  return results;
}

export async function analyzeReferenceVideosToIdeaPrompt(params: {
  videos: DerivativeSourceInput[];
  outputLanguage?: DerivativeOutputLanguage;
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  characterSummary?: string;
  allowFreeCostumeChange?: boolean;
  aiProvider?: AiProviderId;
  useProModel?: boolean;
}): Promise<{
  detailedPrompt: string;
  suggestedSetting?: string;
  sceneHighlights: string[];
  watchedVideoCount: number;
  usedProvider: AiProviderId;
  usedModel: string;
}> {
  const safeVideos = Array.isArray(params.videos) ? params.videos.slice(0, 8) : [];
  if (safeVideos.length === 0) {
    throw new Error('Vui lòng tải lên hoặc chọn ít nhất 1 video tham chiếu trước khi nhờ AI xem và phân tích.');
  }

  const provider: AiProviderId =
    params.aiProvider === 'openai' ||
    params.aiProvider === 'meta' ||
    params.aiProvider === 'muse2api' ||
    params.aiProvider === 'xingchi' ||
    params.aiProvider === 'alibaba'
      ? params.aiProvider
      : 'gemini';

  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';
  const styleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const contexts = await gatherSourceContexts(safeVideos);

  // Prepare multimodal parts: native video inlineData (Gemini, <= 14MB) + dense chronological keyframes fallback
  const geminiNativeParts: any[] = [];
  const keyframeParts: any[] = [];
  const openAiImageUrls: string[] = [];
  let hasNativeVideoBytes = false;
  let totalFramesAttached = 0;

  for (let i = 0; i < contexts.length; i += 1) {
    const ctx = contexts[i];
    const src = ctx.source;
    const label = `Video tham chiếu #${i + 1}: "${src.translatedTitle || src.title}" (${
      src.duration > 0 ? `${Math.round(src.duration)}s` : 'không rõ thời lượng'
    })`;

    if (src.localAssetId) {
      const asset = getStudioAsset(src.localAssetId);
      let attachedNativeForThis = false;
      if (provider === 'gemini' && asset?.filePath && fs.existsSync(asset.filePath) && contexts.length <= 2) {
        try {
          const stat = fs.statSync(asset.filePath);
          if (stat.size > 1024 && stat.size <= 14 * 1024 * 1024) {
            const videoBuf = fs.readFileSync(asset.filePath);
            geminiNativeParts.push({ text: `[Tệp video gốc đầy đủ — ${label}]` });
            geminiNativeParts.push({
              inlineData: {
                mimeType: asset.mimeType || 'video/mp4',
                data: videoBuf.toString('base64'),
              },
            });
            hasNativeVideoBytes = true;
            attachedNativeForThis = true;
          }
        } catch {
          // fall back to dense keyframes below
        }
      }

      const denseFrames = asset
        ? await extractDenseVideoFrames(asset, contexts.length === 1 ? 8 : 5)
        : [];

      if (denseFrames.length > 0) {
        keyframeParts.push({ text: `[Chuỗi ${denseFrames.length} khung hình theo trình tự thời gian của ${label}]` });
        if (!attachedNativeForThis) {
          geminiNativeParts.push({ text: `[Chuỗi ${denseFrames.length} khung hình theo trình tự thời gian của ${label}]` });
        }
        for (const f of denseFrames) {
          const labelPart = { text: `[Mốc ${f.timestampLabel}]` };
          const imgPart = { inlineData: { mimeType: f.mimeType, data: f.base64 } };
          keyframeParts.push(labelPart, imgPart);
          if (!attachedNativeForThis) {
            geminiNativeParts.push(labelPart, imgPart);
          }
          if (openAiImageUrls.length < 8) {
            openAiImageUrls.push(`data:${f.mimeType};base64,${f.base64}`);
          }
          totalFramesAttached += 1;
        }
      } else if (src.keyframes && src.keyframes.length > 0) {
        keyframeParts.push({ text: `[Khung hình đại diện của ${label}]` });
        if (!attachedNativeForThis) {
          geminiNativeParts.push({ text: `[Khung hình đại diện của ${label}]` });
        }
        for (const kf of src.keyframes.slice(0, 4)) {
          const parsedKf = parseDataUrlToBuffer(kf);
          if (parsedKf) {
            const imgPart = {
              inlineData: { mimeType: parsedKf.mimeType, data: parsedKf.buffer.toString('base64') },
            };
            keyframeParts.push(imgPart);
            if (!attachedNativeForThis) geminiNativeParts.push(imgPart);
            if (openAiImageUrls.length < 8) openAiImageUrls.push(kf);
            totalFramesAttached += 1;
          }
        }
      }
    } else if (ctx.thumbnail) {
      const labelPart = { text: `[Ảnh đại diện ${label}]` };
      const imgPart = {
        inlineData: {
          mimeType: ctx.thumbnail.mimeType,
          data: ctx.thumbnail.buffer.toString('base64'),
        },
      };
      keyframeParts.push(labelPart, imgPart);
      geminiNativeParts.push(labelPart, imgPart);
      if (openAiImageUrls.length < 8) {
        openAiImageUrls.push(`data:${ctx.thumbnail.mimeType};base64,${ctx.thumbnail.buffer.toString('base64')}`);
      }
      totalFramesAttached += 1;
    }
  }

  const dossierLines = contexts.map((ctx) => {
    const s = ctx.source;
    return [
      `=== VIDEO THAM CHIẾU #${ctx.index + 1} ===`,
      `- Nguồn: ${s.localAssetId ? 'Video người dùng tải lên' : s.platformLabel}`,
      `- Tiêu đề: ${s.translatedTitle ? `${s.translatedTitle} (Gốc: ${s.title})` : s.title}`,
      `- Thời lượng: ${s.duration > 0 ? `${Math.round(s.duration)} giây` : 'Chưa rõ'}`,
      ctx.tags.length > 0 ? `- Tags: ${ctx.tags.join(', ')}` : '',
      ctx.description ? `- Mô tả: ${ctx.description.slice(0, 600)}` : '',
      ctx.captionsText ? `- Lời thoại / Âm thanh trích xuất:\n${ctx.captionsText.slice(0, 2200)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  const watchPrompt = `Bạn là Chuyên gia Phân tích Phim & Biên kịch Video AI.
NHIỆM VỤ: Hãy XEM KỸ toàn bộ hình ảnh, diễn biến, chuyển động, không gian, ánh sáng và âm thanh/lời thoại trong ${contexts.length} video tham chiếu đính kèm, rồi viết một BẢN PROMPT MÔ TẢ CHI TIẾT CÁC BỐI CẢNH VÀ TÌNH TIẾT XUẤT HIỆN TRONG VIDEO.
Bản mô tả này sẽ được dùng trực tiếp làm dữ liệu "Tóm tắt ý tưởng ban đầu" để bước tiếp theo AI triển khai ý tưởng và viết kịch bản phái sinh.

THÔNG TIN BỔ SUNG:
- Ngôn ngữ đầu ra BẮT BUỘC: ${OUTPUT_LANG_LABELS[outputLang]}
- Phong cách định hướng hiện tại: ${styleMeta.labelVi} (${styleMeta.visualToneVi})
${params.characterSummary?.trim() ? `- Lưu ý nhân vật đồng bộ (nếu dùng lại nhân vật tham chiếu, CHỈ tập trung mô tả bối cảnh, hành động, tình tiết và vai trò trong video nguồn): ${params.characterSummary.trim()}` : ''}

TƯ LIỆU KÈM THEO TỪ VIDEO:
${dossierLines.join('\n\n')}

YÊU CẦU CHẤT LƯỢNG BẮT BUỘC CHO "detailedPrompt":
1. Viết mạch lạc, súc tích nhưng CỰC KỲ CHI TIẾT (khoảng 180–350 chữ) theo đúng trình tự diễn biến thật xuất hiện trong video — KHÔNG bịa đặt chi tiết không liên quan.
2. Bao gồm đầy đủ 5 lớp nội dung rõ ràng trong "detailedPrompt":
   - Chủ đề, thể loại & mô-típ cốt truyện cốt lõi của video.
   - Bối cảnh không gian cụ thể: địa điểm, kiến trúc/cảnh vật, thời điểm (ngày/đêm), thời tiết, tông ánh sáng, màu sắc và bầu không khí.
   - Nhân vật/đối tượng xuất hiện & hành vi/biểu cảm đặc trưng trong từng khoảnh khắc.
   - Trình tự từng bối cảnh & tình tiết nổi bật (Mở đầu → Diễn biến → Cao trào/Bước ngoặt → Kết thúc), các đạo cụ/phương tiện/vật thể quan trọng và nội dung lời thoại/thông điệp chính (nếu có).
   - Góc máy, chuyển động camera và nhịp độ dựng phim đặc trưng.
3. Điền thêm:
   - "suggestedSetting": 1 câu ngắn gọn tóm tắt bối cảnh không gian & tông ánh sáng chủ đạo của video.
   - "sceneHighlights": Mảng 3–6 câu ngắn tóm tắt từng mốc bối cảnh/tình tiết nối tiếp xuất hiện trong video (VD: "01. Mở đầu trên con đường vắng ban đêm...").

TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ (không markdown, không giải thích thừa):
{
  "detailedPrompt": "Đoạn prompt mô tả cực kỳ chi tiết các bối cảnh, nhân vật, hành vi và tình tiết theo đúng diễn biến xuất hiện trong video...",
  "suggestedSetting": "1 câu tóm tắt không gian, thời điểm & tông ánh sáng chủ đạo",
  "sceneHighlights": [
    "Mốc cảnh 1: ...",
    "Mốc cảnh 2: ...",
    "Mốc cảnh 3: ..."
  ]
}`;

  let parsed: any = {};
  let usedModel = 'gemini-4-hydrogen';

  try {
    if (provider === 'muse2api') {
      const st = await getMuse2ApiStatus();
      if (!st.reachable || !st.ready) {
        throw new Error(
          st.error ||
            'Muse2API chưa sẵn sàng hoặc chưa có tài khoản muse.ai hợp lệ. Hãy kiểm tra phần Quản lý Muse2API trong Cấu hình.'
        );
      }
      usedModel = 'muse-spark (Muse2API)';
      const raw = await chatWithMuse2ApiSpark([
        {
          role: 'system',
          content:
            'Chỉ trả về 1 đối tượng JSON thuần túy hợp lệ gồm detailedPrompt, suggestedSetting, sceneHighlights, không giải thích ngoài JSON.',
        },
        { role: 'user', content: watchPrompt },
      ]);
      parsed = parseAiBlueprintJsonSafe(raw);
    } else if (provider === 'xingchi') {
      const xcRes = await callXingchiCompletion({
        prompt: watchPrompt,
        systemPrompt:
          'Chỉ trả về 1 đối tượng JSON hợp lệ gồm detailedPrompt, suggestedSetting và sceneHighlights.',
        imageDataUrls: openAiImageUrls.slice(0, 6),
        jsonMode: true,
        timeoutMs: 75_000,
      });
      usedModel = xcRes.model;
      parsed = parseAiBlueprintJsonSafe(xcRes.text);
    } else if (provider === 'openai' || provider === 'meta' || provider === 'alibaba') {
      const cfg = resolveOpenAiCompatibleConfig(provider);
      if (!cfg.apiKey) {
        throw new Error(`Chưa cấu hình ${cfg.envName} trong Settings > Secrets hoặc tệp .env.`);
      }
      usedModel = cfg.model;
      const userContent: any =
        openAiImageUrls.length > 0
          ? [
              { type: 'text', text: watchPrompt },
              ...openAiImageUrls.slice(0, 6).map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ]
          : watchPrompt;

      const sendOpenAiReq = async (contentPayload: any) =>
        fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              {
                role: 'system',
                content:
                  'Chỉ trả về 1 đối tượng JSON hợp lệ gồm detailedPrompt, suggestedSetting và sceneHighlights.',
              },
              { role: 'user', content: contentPayload },
            ],
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(70_000),
        });

      let res = await sendOpenAiReq(userContent);
      // Fallback to text-only if the selected OpenAI-compatible text model does not support image_url parts
      if (!res.ok && Array.isArray(userContent)) {
        res = await sendOpenAiReq(watchPrompt);
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`);
      }
      const data = (await res.json()) as any;
      parsed = parseAiBlueprintJsonSafe(String(data?.choices?.[0]?.message?.content || '{}'));
    } else {
      const ai = getGeminiClient();
      const baseCandidates = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      const candidateModels = prioritizeGeminiCandidateModels(baseCandidates);
      let lastErr: any;

      const runGeminiWatch = async (
        candidateModel: string,
        mediaParts: any[],
        timeoutMs: number,
        retryDelays: number[]
      ) =>
        retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model: candidateModel,
              contents: { parts: [...mediaParts, { text: watchPrompt }] },
              config: {
                httpOptions: { timeout: timeoutMs },
                maxOutputTokens: 4096,
                ...(candidateModel.startsWith('gemini-4-')
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                systemInstruction:
                  'Xem thật kỹ toàn bộ video/khung hình tham chiếu và trả về JSON thuần túy gồm detailedPrompt (mô tả chi tiết bối cảnh & tình tiết), suggestedSetting và sceneHighlights.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  required: ['detailedPrompt', 'suggestedSetting', 'sceneHighlights'],
                  properties: {
                    detailedPrompt: { type: Type.STRING },
                    suggestedSetting: { type: Type.STRING },
                    sceneHighlights: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
              },
            }),
          retryDelays
        );

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx += 1) {
        const candidateModel = candidateModels[mIdx];
        const isLastCandidate = mIdx === candidateModels.length - 1;
        const callTimeoutMs = hasNativeVideoBytes ? 75_000 : isLastCandidate ? 50_000 : 32_000;
        const retryDelays = isLastCandidate ? [800] : [];
        try {
          let response;
          try {
            response = await runGeminiWatch(candidateModel, geminiNativeParts, callTimeoutMs, retryDelays);
          } catch (nativeErr: any) {
            // If native video inline bytes rejected or timed out, retry cleanly with dense keyframes on the same model
            if (hasNativeVideoBytes && keyframeParts.length > 0) {
              response = await runGeminiWatch(candidateModel, keyframeParts, 45_000, retryDelays);
            } else {
              throw nativeErr;
            }
          }
          parsed = parseAiBlueprintJsonSafe(response.text || '{}');
          usedModel = `${candidateModel}${hasNativeVideoBytes ? ' (Video+Vision)' : totalFramesAttached > 0 ? ` (${totalFramesAttached} frames)` : ''}`;
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          markGeminiModelOverloaded(candidateModel, err);
          if (!shouldFallbackGeminiModel(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
          if (isLastCandidate) throw err;
        }
      }
      if (lastErr) throw lastErr;
    }
  } catch (err: any) {
    if (provider === 'gemini') {
      throw new Error(formatGeminiError(err));
    }
    throw new Error(String(err?.message || err || 'AI không thể xem và phân tích video tham chiếu lúc này.'));
  }

  const detailedPrompt = String(parsed?.detailedPrompt || '').trim();
  if (!detailedPrompt) {
    throw new Error('AI chưa trích xuất được mô tả chi tiết từ video tham chiếu. Vui lòng thử lại.');
  }

  const sceneHighlights = Array.isArray(parsed?.sceneHighlights)
    ? parsed.sceneHighlights.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    detailedPrompt,
    suggestedSetting: String(parsed?.suggestedSetting || '').trim() || undefined,
    sceneHighlights,
    watchedVideoCount: contexts.length,
    usedProvider: provider,
    usedModel,
  };
}

export async function learnVideosAndCreateBlueprint(params: {
  mode?: StudioCreationMode;
  scriptMode?: StudioScriptMode;
  productionFormat?: StudioProductionFormat;
  ideaPrompt?: string;
  query?: string;
  videos?: DerivativeSourceInput[];
  stylePreset?: DerivativeStylePreset;
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  aspectRatio: DerivativeAspectRatio;
  targetDurationSec?: number;
  sceneDurationSec?: number;
  targetDuration?: 'short' | 'medium';
  desiredSceneCount?: number;
  outputLanguage?: DerivativeOutputLanguage;
  useProModel?: boolean;
  characterSummary?: string;
  characterRefsMeta?: StudioCharacterRefMetaInput[];
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  customInstruction?: string;
  enableVoiceover?: boolean;
  allowFreeCostumeChange?: boolean;
  preserveExactIdea?: boolean;
  selectedIdeaTitle?: string;
  aiProvider?: AiProviderId;
  preGatheredContexts?: EnrichedVideoContext[];
  conceptOverride?: IndependentConceptOverride;
}): Promise<DerivativeBlueprint> {
  const studioMode: StudioCreationMode = params.mode === 'creative' ? 'creative' : 'derivative';
  const scriptMode: StudioScriptMode = params.scriptMode === 'independent_batch' ? 'independent_batch' : 'series';
  const productionFormat: StudioProductionFormat =
    params.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';
  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const characterRefsMeta = Array.isArray(params.characterRefsMeta) ? params.characterRefsMeta : [];
  const lockBundle = buildLockedCharacterSeedsAndBibles({
    characterRefsMeta,
    characterBible: params.conceptOverride?.characterBible || params.characterBible,
    costumeBible: params.conceptOverride?.costumeBible || params.costumeBible,
  });
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
    params.aiProvider === 'openai' ||
    params.aiProvider === 'meta' ||
    params.aiProvider === 'muse2api' ||
    params.aiProvider === 'xingchi' ||
    params.aiProvider === 'alibaba'
      ? params.aiProvider
      : 'gemini';

  const videoStyleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const videoStyle = videoStyleMeta.styleKey;

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
  const lockedSceneDur =
    !params.conceptOverride &&
    scriptMode === 'series' &&
    typeof params.sceneDurationSec === 'number' &&
    Number.isFinite(params.sceneDurationSec) &&
    params.sceneDurationSec >= 5
      ? Math.max(5, Math.min(300, Math.round(params.sceneDurationSec)))
      : null;

  const desiredScenes = resolveDesiredSceneCount(
    Math.max(10, Math.min(3600, Math.round(rawSec))),
    params.desiredSceneCount,
    params.conceptOverride ? 'independent_batch' : scriptMode
  );

  const desiredTotalSec = lockedSceneDur
    ? Math.max(10, Math.min(3600, lockedSceneDur * desiredScenes))
    : Math.max(10, Math.min(900, Math.round(rawSec)));

  const avgSceneDur = lockedSceneDur
    ? lockedSceneDur
    : Math.max(4, Math.min(120, Math.round(desiredTotalSec / desiredScenes)));
  const wordsMin = Math.max(6, Math.min(160, Math.round(avgSceneDur * 1.8)));
  const wordsMax = Math.max(wordsMin + 5, Math.min(210, Math.round(avgSceneDur * 2.5)));
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

  const preserveExactIdea = params.preserveExactIdea === true && !params.conceptOverride;
  const selectedIdeaTitle = String(params.selectedIdeaTitle || '').trim();

  const modeHeader =
    studioMode === 'creative'
      ? preserveExactIdea
        ? `NGUỒN ĐẦU VÀO: PHÁT TRIỂN KỊCH BẢN TRỰC TIẾP TỪ Ý TƯỞNG NGƯỜI DÙNG ĐÃ CHỌN (BẮT BUỘC BẢO TOÀN 100%).
${selectedIdeaTitle ? `Tiêu đề ý tưởng đã chọn: "${selectedIdeaTitle}"\n` : ''}Nội dung gốc BẮT BUỘC PHẢI GIỮ NGUYÊN: "${ideaText}".
NGUYÊN TẮC TỐI THƯỢNG (KHÔNG ĐƯỢC VI PHẠM):
- Bám sát 100% và bảo toàn trọn vẹn ý tưởng đã chọn: giữ nguyên cốt truyện, tình huống cốt lõi, nhân vật/vai trò, không gian bối cảnh, chủ đề và tinh thần sáng tạo ban đầu.
- NGHIÊM CẤM tự ý sáng tạo lại thành một câu chuyện khác, NGHIÊM CẤM thay đổi tình huống mở đầu/cao trào cốt lõi đã chốt.
- Nhiệm vụ duy nhất là chuyển hóa chính xác ý tưởng gốc này thành kịch bản phân cảnh chi tiết, lời thoại/thuyết minh, chỉ đạo máy quay, ánh sáng và prompt hình ảnh/video hoàn chỉnh.`
        : `NGUỒN ĐẦU VÀO: STUDIO SÁNG TẠO TỪ Ý TƯỞNG VĂN BẢN.
Ý tưởng / Chủ đề người dùng nhập: "${ideaText}".`
      : preserveExactIdea && ideaText
      ? `NGUỒN ĐẦU VÀO: TẠO KỊCH BẢN PHÁI SINH TRỰC TIẾP TỪ Ý TƯỞNG ĐÃ CHỌN & ${contexts.length} VIDEO THAM CHIẾU (BẮT BUỘC BẢO TOÀN 100% Ý TƯỞNG ĐÃ CHỌN).
${selectedIdeaTitle ? `Tiêu đề ý tưởng đã chọn: "${selectedIdeaTitle}"\n` : ''}Nội dung ý tưởng BẮT BUỘC GIỮ NGUYÊN: "${ideaText}".
NGUYÊN TẮC BẮT BUỘC:
- Phân tích chi tiết 9 chiều video tham chiếu vào object "referenceAnalysis" để giữ chuẩn phong cách quay dựng, ánh sáng, nhịp độ.
- ĐỒNG THỜI BÁM SÁT 100% VÀ BẢO TOÀN TRỌN VẸN ý tưởng người dùng vừa chọn ở trên (giữ nguyên cốt truyện, tình huống, nhân vật/vai trò và diễn biến), TUYỆT ĐỐI KHÔNG tự ý đổi sang câu chuyện khác.`
      : `NGUỒN ĐẦU VÀO: TẠO VIDEO PHÁI SINH TỪ ${contexts.length} VIDEO THAM CHIẾU.
Định hướng mở rộng từ người dùng: "${ideaText || 'Phân tích chuyên sâu video tham chiếu để phát triển kịch bản sáng tạo mới'}".
NGUYÊN TẮC BẮT BUỘC VỚI VIDEO PHÁI SINH:
- Trước tiên phải phân tích chi tiết 9 chiều video tham chiếu vào object "referenceAnalysis" (nội dung & chủ đề chính, cốt truyện & diễn biến, nhân vật & đặc điểm nhận dạng, bối cảnh & không gian, phong cách hình ảnh, góc máy & chuyển động camera, ánh sáng & màu sắc, nhịp độ dựng phim, lời thoại/âm thanh).
- Video phái sinh PHẢI là nội dung SÁNG TẠO MỚI có giá trị riêng, tuyệt đối KHÔNG sao chép nguyên xi từng cảnh trong video gốc; chỉ kế thừa tinh thần, chủ đề hoặc phong cách đã chọn.`;

  const scriptModeDirective = params.conceptOverride
    ? `CHẾ ĐỘ KỊCH BẢN: VIDEO PHÁI SINH ĐỘC LẬP #${params.conceptOverride.batchIndex}/${params.conceptOverride.batchTotal} (MỖI VIDEO DÀI ĐÚNG ${desiredTotalSec} GIÂY, PHÁI SINH CÙNG Ý TƯỞNG GỐC & MÔ-TÍP CỐT TRUYỆN).
NGUYÊN TẮC BẮT BUỘC:
- Đây là MỘT KỊCH BẢN VIDEO ĐỘC LẬP hoàn chỉnh dài ĐÚNG ${desiredTotalSec} giây (có mở đầu, diễn biến và kết thúc trọn vẹn trong ${desiredTotalSec}s), KHÔNG phải tập nối tiếp hay cắt nhỏ của các video khác.
- MÔ-TÍP CỐT TRUYỆN & CẤU TRÚC TÌNH HUỐNG LÕI BẮT BUỘC PHẢI GIỮ NGUYÊN: "${params.conceptOverride.coreMotif || params.conceptOverride.sharedSpiritNote || ideaText}".
- Triển khai CHÍNH XÁC biến thể phái sinh cho Video #${params.conceptOverride.batchIndex} dưới đây (KHÔNG tự ý bỏ mô-típ gốc sang câu chuyện ngẫu nhiên):
  + Tiêu đề định hướng: "${params.conceptOverride.title}"
  + Tình huống & diễn biến phái sinh riêng: "${params.conceptOverride.premise}"
  + Nhân vật riêng của video này: "${params.conceptOverride.characterBible}"
  + Bối cảnh riêng của video này: "${params.conceptOverride.settingBible}"
- Tuyệt đối KHÔNG lặp lại tình tiết cụ thể của các video phái sinh khác trong lô: ${params.conceptOverride.avoidTitles?.join(' | ') || 'Không trùng lặp'}.
- Vẫn giữ tinh thần, chủ đề, cấu trúc tình huống cốt lõi và phong cách hình ảnh "${videoStyleMeta.labelVi}" đồng nhất với ý tưởng gốc.`
    : scriptMode === 'independent_batch' && preserveExactIdea
    ? `CHẾ ĐỘ KỊCH BẢN: TẠO PROMPT KỊCH BẢN TRỰC TIẾP TỪ Ý TƯỞNG ĐÃ CHỌN (01 VIDEO ĐỘC LẬP DÀI ĐÚNG ${desiredTotalSec} GIÂY · ${desiredScenes} PHÂN CẢNH).
NGUYÊN TẮC BẮT BUỘC:
- Giữ nguyên 100% ý tưởng mà người dùng vừa bấm chọn — TUYỆT ĐỐI KHÔNG sáng tạo lại ý tưởng mới hay đổi sang cốt truyện khác.
- Chuyển hóa chính xác ý tưởng này thành 01 kịch bản hoàn chỉnh dài ĐÚNG ${desiredTotalSec} giây (${desiredScenes} phân cảnh, tổng durationSec = ${desiredTotalSec}s) với mở đầu, diễn biến và điểm nhấn trọn vẹn.
- Nhân vật chính, ngoại hình, trang phục và đặc điểm nhận dạng PHẢI duy trì đồng nhất 100%.`
    : `CHẾ ĐỘ KỊCH BẢN: SERIES LIÊN HOÀN — 01 KỊCH BẢN TỔNG THỂ DUY NHẤT CHIA THÀNH ĐÚNG ${desiredScenes} PHÂN CẢNH LIÊN TIẾP (MỖI PHÂN CẢNH DÀI ĐÚNG ${avgSceneDur} GIÂY · TỔNG THỜI LƯỢNG ${desiredTotalSec} GIÂY).
NGUYÊN TẮC KIẾN TRÚC BẮT BUỘC:
- QUY TRÌNH 2 BƯỚC NỘI BỘ: Trước hết xây dựng 01 kịch bản tổng thể duy nhất bám sát 100% ý tưởng gốc (KHÔNG tạo lại ý tưởng khác, KHÔNG chia thành nhiều câu chuyện rời rạc); sau đó phân bổ kịch bản đó thành ĐÚNG ${desiredScenes} phân cảnh liên tiếp đánh số 1..${desiredScenes}.
- MỖI PHÂN CẢNH BẮT BUỘC CÓ durationSec = ${avgSceneDur} giây → TỔNG THỜI LƯỢNG VIDEO = ${desiredScenes} × ${avgSceneDur}s = ${desiredTotalSec} giây.
- LIÊN KẾT NỘI DUNG XUYÊN SUỐT:
  + Phân cảnh 01 (${avgSceneDur}s): Mở đầu câu chuyện, giới thiệu nhân vật và tình huống gốc.
  ${desiredScenes > 2 ? `+ Các phân cảnh giữa (02 → ${String(desiredScenes - 1).padStart(2, '0')}, mỗi cảnh ${avgSceneDur}s): Tiếp nối trực tiếp sự kiện ở phân cảnh liền trước, phát triển và đẩy cao tình huống logic.` : ''}
  ${desiredScenes >= 2 ? `+ Phân cảnh ${String(desiredScenes).padStart(2, '0')} (${avgSceneDur}s): Tiếp nối trực tiếp phân cảnh trước đó, tạo cao trào hoặc kết thúc trọn vẹn câu chuyện.` : ''}
- Nhân vật chính, ngoại hình, trang phục và đặc điểm nhận dạng PHẢI duy trì đồng nhất 100% xuyên suốt cả ${desiredScenes} phân cảnh.`;

  const narrativeStyleDirective =
    activeStylePreset === 'none'
      ? 'Kiểu dẫn chuyện: TẮT (Không ép công thức dẫn chuyện mẫu — triển khai mạch truyện/ngôn ngữ tự nhiên bám sát ý tưởng và thể loại).'
      : `Kiểu dẫn chuyện: ${STYLE_LABELS[activeStylePreset]}.`;

  const perCharSyncDetails = characterRefsMeta
    .map((ref, idx) => {
      const sp = ref.syncProfile;
      const fields = sp
        ? [
            sp.face ? `Gương mặt & tóc (KHÓA CỐ ĐỊNH): ${sp.face}` : '',
            sp.physique ? `Vóc dáng & tỷ lệ (KHÓA CỐ ĐỊNH): ${sp.physique}` : '',
            sp.costume
              ? `Trang phục & phụ kiện (${allowFreeCostumeChange ? 'mặc định ban đầu — được phép đổi theo cảnh' : 'KHÓA TUYỆT ĐỐI 100%'}): ${sp.costume}`
              : '',
            sp.voice ? `Giọng nói: ${sp.voice}` : '',
            sp.distinguishingMarks ? `Đặc điểm nhận dạng (KHÓA CỐ ĐỊNH): ${sp.distinguishingMarks}` : '',
          ].filter(Boolean)
        : [];
      const extraDesc = ref.description?.trim() ? `Mô tả tham chiếu: ${ref.description.trim()}` : '';
      const allParts = [...fields, extraDesc].filter(Boolean);
      if (allParts.length === 0) return '';
      return `  * Nhân vật #${idx + 1} "${ref.name || `Nhân vật ${idx + 1}`}": ${allParts.join(' | ')}`;
    })
    .filter(Boolean)
    .join('\n');

  const referenceLockRulesBlock =
    lockBundle.seeds.length > 0 || lockBundle.canonicalCostumeBible
      ? buildReferenceCharacterLockRules({
          allowFreeCostumeChange,
          characters: lockBundle.seeds,
          fallbackCostumeBible: lockBundle.canonicalCostumeBible,
        })
      : '';

  const lockedProjectAnchors = [
    lockBundle.canonicalCharacterBible
      ? `- Character Reference (Nhân vật chuẩn — KHÓA CỐ ĐỊNH): ${lockBundle.canonicalCharacterBible}`
      : '',
    perCharSyncDetails
      ? `- Hồ sơ đồng bộ 5 thành phần RIÊNG BIỆT theo từng nhân vật (BẮT BUỘC giữ nguyên từng đặc điểm đã khóa khi nhân vật đó xuất hiện):\n${perCharSyncDetails}`
      : '',
    params.conceptOverride?.settingBible || params.settingBible?.trim()
      ? `- Environment Reference (Bối cảnh chuẩn): ${params.conceptOverride?.settingBible || params.settingBible?.trim()}`
      : '',
    params.conceptOverride?.visualStyleBible || params.visualStyleBible?.trim()
      ? `- Visual Style Reference (Phong cách & bảng màu chuẩn): ${params.conceptOverride?.visualStyleBible || params.visualStyleBible?.trim()}`
      : '',
    lockBundle.canonicalCostumeBible
      ? `- Costume Reference (${allowFreeCostumeChange ? 'Trang phục khởi điểm' : 'Trang phục KHÓA TUYỆT ĐỐI theo ảnh tham chiếu'}): ${lockBundle.canonicalCostumeBible}`
      : '',
    params.conceptOverride?.continuityBible || params.continuityBible?.trim()
      ? `- Story Continuity (Quy tắc liên tục): ${params.conceptOverride?.continuityBible || params.continuityBible?.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const productionFormatDirective =
    productionFormat === 'narration_story'
      ? `CHẾ ĐỘ SẢN XUẤT VIDEO BẮT BUỘC: PHIM THUYẾT MINH KỂ CHUYỆN (Narration Storytelling).
NGUYÊN TẮC BẮT BUỘC:
- Triển khai kịch bản theo mạch kể chuyện bằng GIỌNG NGƯỜI DẪN CHUYỆN duy nhất xuyên suốt (điền đầy đủ "narration" truyền cảm, tự nhiên cho từng phân cảnh; không cần chia thoại rời rạc, trừ trích dẫn ngắn nếu thật sự cần thì để "dialogue": "").
- Hình ảnh & chuyển động máy quay ưu tiên tự động minh họa sống động diễn biến lời kể.
- Bắt buộc điền "adaptiveMusicPrompt" (mô tả nhạc nền tổng thể bằng tiếng Anh) và "musicMoodEn" ở từng phân cảnh (2-5 từ tiếng Anh mô tả không khí âm nhạc chuyển biến theo bối cảnh/cảm xúc cảnh đó) để AI tự ghép nhạc nền tự nhiên, linh động.`
      : `CHẾ ĐỘ SẢN XUẤT VIDEO BẮT BUỘC: PHIM CÓ LỜI THOẠI (Dialogue & Synced Character Film).
NGUYÊN TẮC BẮT BUỘC:
- Các phân cảnh giao tiếp/hành động PHẢI có lời thoại rõ người nói trong "dialogue" theo đúng cú pháp "Tên nhân vật: Câu thoại" (nhiều câu thoại cách nhau bởi dấu xuống dòng \\n).
- Ghi chính xác tên từng nhân vật xuất hiện trong "charactersInScene" để khớp với dữ liệu Tab Nhân vật đồng bộ (nếu có) — giữ nguyên gương mặt, vóc dáng, giọng nói${allowFreeCostumeChange ? '' : ' và trang phục'} giữa mọi cảnh.
- BẮT BUỘC điền đầy đủ mảng "characterVoiceProfiles" phân tích từng nhân vật xuất hiện trong phim: ghi rõ độ tuổi/nhóm tuổi ("child" = Trẻ em | "youth" = Thanh niên | "adult_male" = Đàn ông | "adult_female" = Đàn bà | "middle_aged" = Người trung niên | "elderly" = Người già), giới tính ("male" | "female"), chọn voiceId Gemini khác nhau phù hợp độ tuổi (TUYỆT ĐỐI không gán 1 giọng chung cho tất cả nhân vật), và ghi chú cao độ/âm sắc trong "vocalToneNote".`;

  const promptText = `Bạn là Hệ thống Đạo diễn AI Thống Nhất — chuyên biên kịch & thiết kế hồ sơ sản xuất video hoàn chỉnh.
${modeHeader}
${scriptModeDirective}
${productionFormatDirective}
${narrativeStyleDirective}
Phong cách hình ảnh & quay dựng BẮT BUỘC: ${videoStyleMeta.labelVi} (${videoStyleMeta.visualToneVi} | Prompt style: ${videoStyleMeta.promptDirective}).
Ngôn ngữ lời thoại & phụ đề BẮT BUỘC: ${OUTPUT_LANG_LABELS[outputLang]}.
Tỷ lệ khung hình mục tiêu: ${params.aspectRatio}.
Tùy chọn Lồng tiếng (Voiceover): ${
    enableVoiceover
      ? productionFormat === 'narration_story'
        ? `BẬT LỒNG TIẾNG THUYẾT MINH — Tạo nội dung "narration" kể chuyện tự nhiên (${wordsMin}-${wordsMax} chữ/cảnh) với 1 giọng người dẫn chuyện xuyên suốt.`
        : `BẬT LỒNG TIẾNG & LỜI THOẠI — Tạo lời thoại nhân vật "dialogue" tự nhiên theo đúng nhân vật và điền "narration" (${wordsMin}-${wordsMax} chữ/cảnh) khi cần dẫn mạch truyện.`
      : 'TẮT LỒNG TIẾNG — BẮT BUỘC đặt "narration": "" (chuỗi rỗng) cho TẤT CẢ mọi phân cảnh, KHÔNG tạo dữ liệu giọng thuyết minh thừa; tập trung diễn đạt qua hình ảnh, hành động, lời thoại nhân vật (nếu có) và phụ đề ngắn.'
  }
Tổng thời lượng mục tiêu BẮT BUỘC: ĐÚNG ${targetMinutesLabel} chia thành ĐÚNG ${desiredScenes} phân cảnh đánh số lần lượt 1..${desiredScenes} (${lockedSceneDur ? `mỗi phân cảnh BẮT BUỘC dài ĐÚNG ${lockedSceneDur}s` : `trung bình ~${avgSceneDur}s/cảnh`}).
QUY TẮC THỜI LƯỢNG & BỐI CẢNH:
- Mỗi phân cảnh PHẢI có thời lượng ${lockedSceneDur ? `CHÍNH XÁC ${lockedSceneDur} giây` : `tương ứng trọn vẹn ~${avgSceneDur}s/cảnh`}. Nếu thiết lập 10 giây và tạo 1 phân cảnh thì viết 1 phân cảnh duy nhất dài 10 giây với hành động liên tục theo thời gian thực, TUYỆT ĐỐI KHÔNG tự ý xé lẻ thành nhiều đoạn vụn 3-4 giây.
- Tổng "durationSec" của tất cả ${desiredScenes} phân cảnh cộng lại BẮT BUỘC bằng ĐÚNG ${desiredTotalSec} giây.
${params.characterSummary?.trim() ? `DANH SÁCH NHÂN VẬT THAM CHIẾU ĐÃ KHÓA (BẮT BUỘC dùng ĐÚNG tên nhân vật dưới đây trong "charactersInScene", "dialogue", "characterVoiceProfiles", "imagePrompt" và "videoPrompt" để hệ thống ánh xạ đúng ảnh & giọng nói):\n${params.characterSummary.trim()}\nQUY TẮC GIỌNG NÓI NHÂN VẬT: Tất cả nhân vật dùng giọng đọc tiếng Việt chuẩn miền Bắc Việt Nam (Hà Nội) — lựa chọn cao độ & âm sắc đúng theo ĐỘ TUỔI và GIỚI TÍNH từng nhân vật, giữ nhất quán xuyên suốt.` : ''}
${lockedProjectAnchors ? `\nHỒ SƠ DỰ ÁN ĐÃ KHÓA (BẮT BUỘC GIỮ NGUYÊN ĐỒNG BỘ):\n${lockedProjectAnchors}` : ''}
${referenceLockRulesBlock ? `\n${referenceLockRulesBlock}` : ''}
${
  lockBundle.seeds.length > 0
    ? `\nCHẾ ĐỘ KHÓA CỨNG NHÂN VẬT BƯỚC 2 ĐANG KÍCH HOẠT TỰ ĐỘNG:
- Ảnh tham chiếu & hồ sơ nhân vật đồng bộ là DỮ LIỆU CHUẨN BẤT BIẾN (khóa cứng khuôn mặt, kiểu tóc, màu tóc, màu da, vóc dáng, tỷ lệ cơ thể${allowFreeCostumeChange ? '' : ', và trang phục chính'}).
- Trong "imagePrompt" và "videoPrompt" của từng phân cảnh: TUYỆT ĐỐI KHÔNG tự sáng tạo lại hay ghi đè khuôn mặt, màu da, kiểu tóc, vóc dáng${allowFreeCostumeChange ? '' : ' hay trang phục chính'} đã khóa; chỉ mô tả bối cảnh, hành động, góc máy, ánh sáng và phụ kiện độc lập được phép (${ALLOWED_ACCESSORIES_LIST_VI}).`
    : ''
}
${videoStyle === 'cinematic_filmmaking' ? buildCinematicFilmmakingScriptDirective(desiredScenes, avgSceneDur) : ''}
${buildShortDramaScreenplayRules(productionFormat)}
${params.customInstruction?.trim() ? `Yêu cầu bổ sung từ đạo diễn: ${params.customInstruction.trim()}` : ''}

TIÊU CHUẨN CHẤT LƯỢNG BẮT BUỘC (KHÔNG ĐƯỢC VIẾT SƠ SÀI):
1. Xây dựng BỘ DỮ LIỆU ĐỒNG BỘ 5 THÀNH PHẦN (Mục 2.6):
   - \`characterBible\` (Character Reference): Mô tả cực chi tiết nhân dạng cố định từng nhân vật (tên, độ tuổi cụ thể, giới tính, gương mặt, màu/kiểu tóc, vóc dáng, đặc điểm nhận diện).
   - \`settingBible\` (Environment Reference): Mô tả chi tiết không gian, kiến trúc, thời gian, bối cảnh chủ đạo.
   - \`visualStyleBible\` (Visual Style Reference): Phong cách hình ảnh, chất liệu kết xuất, bảng màu & ngôn ngữ ánh sáng xuyên suốt.
   - \`costumeBible\` (Costume Reference): Trang phục, màu sắc vải & phụ kiện cố định từng nhân vật.
   - \`continuityBible\` (Story Continuity): Mạch cốt truyện liên tục, giọng nói nhất quán & quy tắc nối tiếp hành động giữa các cảnh.
2. Đánh số thứ tự ĐÚNG ${desiredScenes} phân cảnh (\`sceneIndex\`: 1..${desiredScenes}) với ĐẦY ĐỦ 19 TRƯỜNG DỮ LIỆU CHUYÊN SÂU:
   - \`sceneTitle\`: Tên phân cảnh ngắn gọn (3-8 chữ).
   - \`sceneSummary\`: Mô tả nội dung diễn biến chính của phân cảnh.
   - \`durationSec\`: Thời lượng phân cảnh bằng số giây (~${avgSceneDur}s; tổng bằng ~${desiredTotalSec}s).
   - \`charactersInScene\`: Liệt kê CHÍNH XÁC tên từng nhân vật xuất hiện trong cảnh (phải trùng khớp tên trong danh sách nhân vật tham chiếu nếu có).
   - \`settingDetail\`: Bối cảnh chi tiết — không gian, địa điểm, vật thể môi trường, thời gian đồng bộ \`settingBible\`.
   - \`actionDetail\`: Hành động nhân vật diễn ra liên tục theo thời gian thực suốt thời lượng cảnh (mô tả chuyển động tự nhiên, liền mạch).
   - \`costume\`: Trang phục & phụ kiện cụ thể của từng nhân vật đồng bộ \`costumeBible\`.
   - \`cameraAngle\`: Góc quay cụ thể (Cận cảnh, Trung cảnh, Toàn cảnh, Góc thấp, Góc cao, Qua vai...).
   - \`cameraMovement\`: Kiểu quay / chuyển động máy mượt mà (Tracking shot, Slow dolly-in, Steadicam orbit, Crane, Pan...).
   - \`cameraEquipment\`: Thiết bị quay & ống kính (VD: ARRI Alexa Mini LF + ống kính 35mm anamorphic + gimbal DJI Ronin RS4, hoặc Sony FX3 50mm f/1.4 Steadicam).
   - \`lighting\`: Ánh sáng & sắc độ màu chi tiết (Ánh sáng tự nhiên, Điện ảnh rim light, Studio key light, Golden hour, Neon...).
   - \`shotStyle\`: Phong cách quay (Điện ảnh 35mm, Tài liệu, Anime 2D, Hoạt hình 3D, Vlog, Thương mại...).
   - \`dialogue\`: Lời thoại nhân vật trực tiếp nói trên hình theo mẫu "Tên nhân vật: Câu thoại" (để "" nếu cảnh không thoại). TUYỆT ĐỐI KHÔNG tự ý chuyển lời thoại trực tiếp của nhân vật thành giọng đọc thuyết minh người dẫn chuyện.
   - \`narration\`: ${enableVoiceover ? `Nội dung thuyết minh / dẫn chuyện tách biệt khỏi lời thoại nhân vật (${wordsMin}-${wordsMax} chữ, để "" nếu cảnh chỉ có nhân vật tự thoại)` : 'BẮT BUỘC để chuỗi rỗng "" vì đã tắt lồng tiếng'}.
   - \`videoTimeline\`: BẮT BUỘC tạo Timeline chi tiết theo từng khoảng giây trong suốt thời lượng phân cảnh (~${avgSceneDur}s). Chia thành 2-4 mốc giây liên tiếp (VD: "1s - 3s: [Góc quay | Chuyển động camera] Mô tả không gian & hành động...\\n4s - 6s: [Cận cảnh nhân vật] Nhân vật X nói lời thoại '...' (đồng bộ khẩu hình lip-sync)...\\n7s - ${avgSceneDur}s: [Tracking shot] Diễn biến & chuyển động kết cảnh..."). Mỗi khoảng thời gian PHẢI ghi rõ hành động, lời thoại (nếu có), góc quay và chuyển động camera.
   - \`onScreenText\`: BẮT BUỘC để chuỗi rỗng "" (KHÔNG tạo chữ hiển thị trên màn hình).
   - \`continuityNote\`: Nối tiếp trực tiếp từ trạng thái cuối của phân cảnh trước (\`sceneEndState\` của Scene trước).
   - \`sceneEndState\`: Trạng thái cuối cùng khi kết thúc cảnh này (vị trí nhân vật, biểu cảm, đạo cụ, thời điểm) để Scene tiếp theo nối vào hợp lý.
   - \`imagePrompt\`: Prompt hình ảnh CỰC KỲ CHI TIẾT (tối thiểu 3 câu giàu dữ liệu thị giác: nêu rõ tên + ngoại hình + trang phục cố định của TỪNG nhân vật trong cảnh, bối cảnh, góc quay, phong cách quay, ánh sáng, thiết bị quay & ống kính, tư thế hành động mở đầu cảnh) để AI tạo ảnh đồng bộ đa nhân vật chuẩn xác.
   - \`videoPrompt\`: Prompt video CỰC KỲ CHI TIẾT (tối thiểu 3 câu mô tả hành động nhân vật diễn ra liên tục theo đúng \`videoTimeline\` trong suốt ${avgSceneDur}s, đồng bộ khẩu hình khi nhân vật nói lời thoại, chuyển động tự nhiên liền mạch, góc quay, bối cảnh, phong cách quay, ánh sáng, thiết bị quay & quỹ đạo máy quay ĐỒNG NHẤT 100% với \`imagePrompt\`).
   - \`vfxNotes\`: Ghi chú kỹ xảo & vật liệu vật lý thực tế (VD: volumetric light shafts, floating dust motes, caustics, rain droplets on lens, foreground wipe — để trống nếu cảnh thuần tự nhiên).
   - \`soundLayersNote\`: Ghi chú 4 lớp âm thanh (MUS nhạc nền / AMB môi trường / BIO tiếng thở-tim / DET tiếng đạo cụ & điểm Silence Drop trước cao trào).
   - \`brollKeywordEn\`: 2-4 từ khóa tiếng Anh tìm tư liệu minh họa.
   - \`musicMoodEn\`: 2-5 từ khóa tiếng Anh mô tả tâm trạng & thể loại nhạc nền phù hợp nhất với bối cảnh phân cảnh này.
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
  "continuityBible": "Story Continuity xuyên suốt",
  "adaptiveMusicPrompt": "Mô tả tiếng Anh nhạc nền phù hợp toàn bộ bối cảnh & cảm xúc phim",
  "characterVoiceProfiles": [
    {
      "characterName": "Tên chính xác của nhân vật",
      "ageGroup": "child | youth | adult_male | adult_female | middle_aged | elderly",
      "gender": "male | female",
      "voiceId": "Tên giọng Gemini phù hợp độ tuổi (VD: Leda/Zephyr/Orus/Kore/Charon/Algenib)",
      "vocalToneNote": "Mô tả cao độ & sắc thái giọng phù hợp độ tuổi"
    }
  ],${museRefBlock}
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
      "cameraAngle": "Góc quay cụ thể",
      "cameraMovement": "Kiểu quay cụ thể",
      "cameraEquipment": "Thiết bị quay & ống kính (VD: ARRI Alexa Mini LF 35mm + gimbal)",
      "lighting": "Ánh sáng cụ thể",
      "costume": "Trang phục cụ thể đồng bộ",
      "shotStyle": "Phong cách quay",
      "dialogue": "Lời thoại nhân vật nói trực tiếp trên hình (Tên: Câu nói)",
      "narration": "${enableVoiceover ? `Thuyết minh giọng dẫn tách biệt với lời thoại (${wordsMin}-${wordsMax} chữ)` : ''}",
      "videoTimeline": "Timeline từng khoảng giây (VD: 1s - 3s: [Toàn cảnh | Slow dolly-in]...\\n4s - 6s: [Cận cảnh] Nhân vật nói thoại lip-sync...\\n7s - ${avgSceneDur}s: [Tracking shot]...)",
      "onScreenText": "",
      "continuityNote": "Liên kết từ trạng thái cuối cảnh trước",
      "sceneEndState": "Trạng thái cuối cảnh này",
      "imagePrompt": "Prompt hình ảnh cực chi tiết: nhân vật, trang phục, bối cảnh, góc quay, phong cách quay, ánh sáng, thiết bị quay",
      "videoPrompt": "Prompt video cực chi tiết: hành động liên tục theo từng mốc giây trong videoTimeline, đồng bộ lip-sync lời thoại, camera & thiết bị quay đồng bộ imagePrompt",
      "vfxNotes": "Kỹ xảo & vật liệu vật lý thực tế (volumetric light shafts, dust motes, metallic reflection, foreground wipe...)",
      "soundLayersNote": "4 lớp âm thanh (MUS/AMB/BIO/DET & điểm Silence Drop)",
      "brollKeywordEn": "2-4 English keywords",
      "musicMoodEn": "2-5 English keywords describing scene background music mood"
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
    } else if (provider === 'openai' || provider === 'meta' || provider === 'xingchi' || provider === 'alibaba') {
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
        productionFormat,
      });
    } else {
      const ai = getGeminiClient();
      const baseCandidates = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      const candidateModels = prioritizeGeminiCandidateModels(baseCandidates);

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
        adaptiveMusicPrompt: { type: Type.STRING },
        characterVoiceProfiles: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ['characterName', 'ageGroup', 'gender', 'voiceId'],
            properties: {
              characterName: { type: Type.STRING },
              ageGroup: { type: Type.STRING },
              gender: { type: Type.STRING },
              voiceId: { type: Type.STRING },
              vocalToneNote: { type: Type.STRING },
            },
          },
        },
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
          ...(desiredScenes <= 15
            ? {
                minItems: String(desiredScenes),
                maxItems: String(desiredScenes),
              }
            : {}),
          description: `BẮT BUỘC trả về ĐÚNG ${desiredScenes} phân cảnh tách biệt đánh số sceneIndex lần lượt từ 1 đến ${desiredScenes}${lockedSceneDur ? `, mỗi phân cảnh durationSec = ${lockedSceneDur}` : ''}.`,
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
              'cameraEquipment',
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
              cameraEquipment: { type: Type.STRING },
              lighting: { type: Type.STRING },
              costume: { type: Type.STRING },
              shotStyle: { type: Type.STRING },
              dialogue: { type: Type.STRING },
              narration: { type: Type.STRING },
              videoTimeline: { type: Type.STRING },
              onScreenText: { type: Type.STRING },
              continuityNote: { type: Type.STRING },
              sceneEndState: { type: Type.STRING },
              imagePrompt: { type: Type.STRING },
              videoPrompt: { type: Type.STRING },
              vfxNotes: { type: Type.STRING },
              soundLayersNote: { type: Type.STRING },
              brollKeywordEn: { type: Type.STRING },
              musicMoodEn: { type: Type.STRING },
            },
          },
        },
      };

      const callGeminiBlueprint = async (
        candidateModel: string,
        activeParts: any[],
        withSchema: boolean,
        timeoutMs: number
      ) => {
        return ai.models.generateContent({
          model: candidateModel,
          contents: { parts: activeParts },
          config: {
            httpOptions: { timeout: timeoutMs },
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

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx += 1) {
        const candidateModel = candidateModels[mIdx];
        const isLastCandidate = mIdx === candidateModels.length - 1;
        const callTimeoutMs = isLastCandidate
          ? Math.min(55_000, Math.max(38_000, 26_000 + desiredScenes * 1400))
          : Math.min(34_000, Math.max(22_000, 16_000 + desiredScenes * 1200));
        const backoffDelays = isLastCandidate ? [900, 1800] : [];
        const activeParts = candidateModel === 'gemini-3.1-flash-lite' ? compactParts : parts;
        const mStart = Date.now();
        console.log(`[Studio AI] Calling ${candidateModel} (scenes=${desiredScenes}, mode=${studioMode}, timeout=${callTimeoutMs}ms)...`);
        try {
          let response;
          try {
            response = await retryWithGeminiBackoff(
              () => callGeminiBlueprint(candidateModel, activeParts, true, callTimeoutMs),
              backoffDelays
            );
          } catch (schemaErr: any) {
            const msg = String(schemaErr?.message || schemaErr || '').toLowerCase();
            if (msg.includes('too many states') || msg.includes('invalid_argument')) {
              console.warn(`[Studio AI] Schema constraint too large on ${candidateModel}, retrying JSON-only without responseSchema...`);
              response = await retryWithGeminiBackoff(
                () => callGeminiBlueprint(candidateModel, activeParts, false, callTimeoutMs),
                backoffDelays
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
            !isLastCandidate
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
          markGeminiModelOverloaded(candidateModel, err);
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
            productionFormat,
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

    // Enforce Priority 1 & 2: Reference character identity is always locked; costume is strictly locked unless allowFreeCostumeChange === true
    const lockedCharBase = String(lockBundle.canonicalCharacterBible || params.characterBible || '').trim();
    const characterBible = lockedCharBase
      ? lockedCharBase
      : String(parsed?.characterBible || params.characterSummary || '').trim();
    const settingBible = String(params.settingBible || parsed?.settingBible || '').trim();
    const visualStyleBible = String(
      parsed?.visualStyleBible || params.visualStyleBible || videoStyleMeta.visualToneVi
    ).trim();
    const lockedCostumeBase = String(lockBundle.canonicalCostumeBible || params.costumeBible || '').trim();
    const costumeBible =
      !allowFreeCostumeChange && lockedCostumeBase
        ? lockedCostumeBase
        : String(parsed?.costumeBible || lockedCostumeBase || '').trim();
    const continuityBible = String(parsed?.continuityBible || params.continuityBible || '').trim();

    const rawScenes: any[] = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const targetSliceCount = lockedSceneDur ? desiredScenes : Math.min(24, Math.max(rawScenes.length, desiredScenes));
    const scenes: DerivativeScene[] = rawScenes.slice(0, targetSliceCount).map((sc, i) => {
      const idx =
        contexts.length > 0
          ? Math.max(0, Math.min(contexts.length - 1, Math.round(Number(sc?.sourceVideoIndex ?? i % contexts.length))))
          : 0;
      const dur = lockedSceneDur
        ? lockedSceneDur
        : desiredScenes === 1
        ? desiredTotalSec
        : Math.max(2, Math.min(120, Number(sc?.durationSec || avgSceneDur)));
      const startPct = Math.max(0, Math.min(80, Math.round(Number(sc?.sourceStartPercent ?? (i * 18) % 70))));
      const sceneTitle = String(sc?.sceneTitle || sc?.onScreenText || `Phân cảnh ${i + 1}`).trim();
      const sceneSummary = String(sc?.sceneSummary || sc?.actionDetail || '').trim();
      const charactersInScene = String(sc?.charactersInScene || '').trim();
      const actionDetail = String(sc?.actionDetail || '').trim();
      const settingDetail = String(sc?.settingDetail || '').trim();
      const skillRole =
        videoStyle === 'cinematic_filmmaking'
          ? getCinematicShotRoleForScene(i + 1, Math.max(1, rawScenes.length))
          : null;
      const cameraAngle = String(sc?.cameraAngle || skillRole?.angleVi || '').trim();
      const cameraMovement = String(sc?.cameraMovement || skillRole?.movementVi || '').trim();
      const cameraEquipment = String(sc?.cameraEquipment || skillRole?.equipmentVi || '').trim();
      const lighting = String(sc?.lighting || skillRole?.lightingVi || '').trim();
      const costume = String(sc?.costume || '').trim();
      const shotStyle = String(sc?.shotStyle || skillRole?.shotStyleVi || videoStyleMeta.labelVi).trim();
      const dialogue = String(sc?.dialogue || '').trim();
      const continuityNote = String(sc?.continuityNote || '').trim();
      const sceneEndState = String(sc?.sceneEndState || '').trim();
      const fallbackCombined = [
        charactersInScene ? `Nhân vật: ${charactersInScene}` : '',
        costume ? `Trang phục: ${costume}` : '',
        actionDetail,
        settingDetail,
        cameraAngle,
        cameraEquipment ? `Thiết bị quay: ${cameraEquipment}` : '',
        lighting,
        shotStyle,
      ]
        .filter(Boolean)
        .join('. ');
      const imagePrompt = String(sc?.imagePrompt || sc?.visualNote || fallbackCombined).trim();
      const videoPrompt = String(
        sc?.videoPrompt ||
          [
            imagePrompt,
            cameraMovement ? `Kiểu quay: ${cameraMovement}` : '',
            cameraEquipment ? `Thiết bị quay: ${cameraEquipment}` : '',
            actionDetail,
          ]
            .filter(Boolean)
            .join('. ')
      ).trim();

      const sceneCorpus = normalizeCharacterMatchText(
        [charactersInScene, dialogue, actionDetail, sceneSummary, imagePrompt].join(' | ')
      );
      const matchedCharacterIds =
        characterRefsMeta.length > 0
          ? characterRefsMeta
              .filter((ref) => {
                const aliases = extractCharacterAliases(ref.name || '');
                return aliases.some((al) =>
                  al.length <= 2
                    ? new RegExp(`(?:^|\\s)${escapeRegexLiteral(al)}(?:$|\\s|:)`, 'i').test(sceneCorpus)
                    : sceneCorpus.includes(al)
                );
              })
              .map((ref) => ref.id)
          : undefined;

      const sceneDraftForTimeline: Partial<DerivativeScene> = {
        durationSec: dur,
        cameraAngle,
        cameraMovement,
        settingDetail,
        charactersInScene,
        actionDetail,
        sceneSummary,
        dialogue,
        sceneEndState,
      };
      const videoTimeline =
        String(sc?.videoTimeline || '').trim() || buildSceneTimelineFallback(sceneDraftForTimeline);

      return {
        id: `scene_${i + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sceneIndex: i + 1,
        sceneTitle,
        sceneSummary,
        durationSec: dur,
        sourceVideoIndex: idx,
        sourceStartPercent: startPct,
        onScreenText: '',
        charactersInScene,
        settingDetail,
        actionDetail,
        cameraAngle,
        cameraMovement,
        cameraEquipment,
        lighting,
        costume,
        shotStyle,
        dialogue,
        narration: enableVoiceover ? String(sc?.narration || '').trim() : '',
        videoTimeline,
        imagePrompt,
        videoPrompt,
        continuityNote,
        sceneEndState,
        visualNote: imagePrompt,
        vfxNotes: String(sc?.vfxNotes || '').trim() || undefined,
        soundLayersNote: String(sc?.soundLayersNote || '').trim() || undefined,
        brollKeywordEn: String(sc?.brollKeywordEn || '').trim(),
        musicMoodEn: String(sc?.musicMoodEn || '').trim() || undefined,
        ...(matchedCharacterIds && matchedCharacterIds.length > 0
          ? { selectedCharacterIds: matchedCharacterIds }
          : {}),
      };
    });

    const validAgeGroups = new Set<Exclude<CharacterAgeGroup, 'auto'>>([
      'child',
      'youth',
      'adult_male',
      'adult_female',
      'middle_aged',
      'elderly',
    ]);
    const rawVoiceProfiles: any[] = Array.isArray(parsed?.characterVoiceProfiles)
      ? parsed.characterVoiceProfiles
      : [];
    const characterVoiceProfiles: CharacterVoiceProfile[] = rawVoiceProfiles
      .filter((vp) => vp && String(vp.characterName || '').trim())
      .map((vp) => {
        const charName = String(vp.characterName).trim();
        const rawAge = String(vp.ageGroup || '').trim() as Exclude<CharacterAgeGroup, 'auto'>;
        const rawGender = String(vp.gender || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
        const classified = classifyCharacterAgeAndGender({
          name: charName,
          explicitAgeGroup: validAgeGroups.has(rawAge) ? rawAge : undefined,
          explicitGender: vp.gender ? rawGender : undefined,
          scriptContext: `${characterBible} ${vp.vocalToneNote || ''}`,
        });
        const assignedVoice = vp.voiceId && GEMINI_VOICE_IDS_SET.has(String(vp.voiceId).trim())
          ? (String(vp.voiceId).trim() as Exclude<DerivativeVoiceId, 'none'>)
          : AGE_GROUP_VOICE_CAST_POOLS[classified.ageGroup].voices[0];
        return {
          characterName: charName,
          ageGroup: classified.ageGroup,
          gender: classified.gender,
          voiceId: assignedVoice,
          vocalToneNote:
            String(vp.vocalToneNote || '').trim() || AGE_GROUP_VOICE_CAST_POOLS[classified.ageGroup].labelVi,
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

    const voiceCastPoolsMap: Record<string, string[]> = Object.fromEntries(
      Object.entries(AGE_GROUP_VOICE_CAST_POOLS).map(([k, v]) => [k, v.voices])
    );
    const baseScenesForAudit: DerivativeScene[] =
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
              onScreenText: '',
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
          ];

    const qcAudit = auditAndNormalizeBlueprintServer({
      scenes: baseScenesForAudit,
      characterVoiceProfiles,
      characterRefsMeta: characterRefsMeta.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        syncProfile: c.syncProfile,
      })),
      productionFormat,
      enableVoiceover,
      voiceCastPools: voiceCastPoolsMap,
      allowFreeCostumeChange,
      lockedCostumeBible: costumeBible,
      ideaOrScriptCorpus: [
        ideaText,
        params.customInstruction || '',
        params.conceptOverride?.premise || '',
      ]
        .filter(Boolean)
        .join('\n'),
    });

    return {
      mode: studioMode,
      scriptMode: params.conceptOverride ? 'independent_batch' : scriptMode,
      productionFormat,
      batchIndex: params.conceptOverride?.batchIndex,
      batchTotal: params.conceptOverride?.batchTotal,
      sharedSpiritNote: params.conceptOverride?.sharedSpiritNote,
      targetDurationSec: desiredTotalSec,
      ideaPrompt: ideaText,
      videoStyle,
      allowFreeCostumeChange,
      ...(qcAudit.costumeLockWarnings.length > 0
        ? { costumeLockWarnings: qcAudit.costumeLockWarnings }
        : {}),
      characterBible,
      settingBible,
      visualStyleBible,
      costumeBible,
      continuityBible,
      adaptiveMusicPrompt: String(parsed?.adaptiveMusicPrompt || '').trim() || undefined,
      characterVoiceProfiles: qcAudit.characterVoiceProfiles.length > 0 ? qcAudit.characterVoiceProfiles : undefined,
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
      scenes: qcAudit.scenes,
      qcReport: qcAudit.qcReport,
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
  selectedIdeaTitle?: string;
  contexts: EnrichedVideoContext[];
  videoCount: number;
  unitDurationSec?: number;
  videoStyleMeta: { labelVi: string; promptDirective: string; visualToneVi: string };
  stylePreset: DerivativeStylePreset;
  outputLang: DerivativeOutputLanguage;
  provider: AiProviderId;
  useProModel?: boolean;
  customInstruction?: string;
  characterSummary?: string;
  characterRefsMeta?: StudioCharacterRefMetaInput[];
  allowFreeCostumeChange?: boolean;
  costumeBible?: string;
}): Promise<{ sharedSpiritNote: string; coreMotif: string; concepts: PlannedIndependentConcept[] }> {
  const dossierText = params.contexts
    .map(
      (ctx) =>
        `Video tham chiếu #${ctx.index + 1}: "${ctx.source.translatedTitle || ctx.source.title}" (${ctx.source.platformLabel})\n` +
        (ctx.description ? `Mô tả: ${ctx.description.slice(0, 350)}\n` : '') +
        (ctx.captionsText ? `Lời thoại trích xuất: ${ctx.captionsText.slice(0, 450)}` : '')
    )
    .join('\n\n');

  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const lockBundle = buildLockedCharacterSeedsAndBibles({
    characterRefsMeta: params.characterRefsMeta,
    costumeBible: params.costumeBible,
  });
  const lockNote =
    lockBundle.seeds.length > 0
      ? buildReferenceCharacterLockRules({
          allowFreeCostumeChange,
          characters: lockBundle.seeds,
          fallbackCostumeBible: lockBundle.canonicalCostumeBible,
        })
      : '';

  const unitDurSec = Math.max(10, Math.min(900, Math.round(Number(params.unitDurationSec || 30))));
  const totalBatchSec = params.videoCount * unitDurSec;

  const planPrompt = `Bạn là Giám đốc Sáng tạo Hệ thống Video Phái Sinh Hàng Loạt (Same-Motif Derivative Batch).
NHIỆM VỤ: Từ Ý TƯỞNG GỐC dưới đây, hãy tạo ĐÚNG ${params.videoCount} KỊCH BẢN VIDEO PHÁI SINH ĐỘC LẬP DỰA TRÊN CÙNG MỘT Ý TƯỞNG GỐC & CÙNG MÔ-TÍP CỐT TRUYỆN.
CÔNG THỨC THỜI LƯỢNG BẮT BUỘC:
- Số kịch bản độc lập: ĐÚNG ${params.videoCount} video.
- Thời lượng mỗi video độc lập: ĐÚNG ${unitDurSec} giây (tổng thời lượng cả lô = ${params.videoCount} × ${unitDurSec}s = ${totalBatchSec} giây).
- Mỗi video PHẢI có mở đầu, diễn biến và điểm nhấn trọn vẹn phù hợp chính xác với thời lượng ${unitDurSec} giây.

NGUYÊN TẮC BẮT BUỘC (TUYỆT ĐỐI KHÔNG ĐƯỢC VI PHẠM):
1. PHÂN TÍCH & KHÓA CỨNG MÔ-TÍP CỐT LÕI ("coreMotif"):
   - Giữ nguyên chủ đề, thể loại, mô-típ cốt truyện và cấu trúc tình huống cốt lõi của ý tưởng gốc.
   - KHÔNG phải chia nhỏ thành Tập 1, Tập 2, Tập 3 nối tiếp nhau.
   - NGHIÊM CẤM hiểu "nhiều video độc lập" là sáng tạo nhiều câu chuyện ngẫu nhiên khác mô-típ chỉ vì cùng thể loại!
   - VÍ DỤ CHUẨN MỰC:
     * Ý tưởng gốc: "Một người lái xe máy đi qua đoạn đường vắng ban đêm, bất ngờ gặp một đoàn người có ngoại hình kỳ dị đang thực hiện hành vi bất thường."
     * Mô-típ lõi PHẢI GIỮ ở TẤT CẢ các video: "Một người di chuyển trên cung đường/không gian vắng ban đêm và chạm trán một nhóm/đoàn người có ngoại hình & hành vi kỳ dị".
     * Biến thể 01 ĐÚNG: Người lái ô tô đi qua đường núi vắng gặp đoàn người mặc đồ cổ đứng quay lưng giữa đường; bấm còi thì tất cả đồng loạt quay đầu.
     * Biến thể 02 ĐÚNG: Shipper chạy xe máy vào đường làng nửa đêm gặp đoàn người đi lùi và cười kỳ quái.
     * Biến thể 03 ĐÚNG: Tài xế taxi qua đường vắng phát hiện nhóm người đứng chờ xe với cử chỉ bất thường.
     * Biến thể SAI (CẤM TUYỆT ĐỐI): Chuyển sang câu chuyện căn nhà ma, chiếc gương bị nguyền rủa hoặc lớp học bỏ hoang (lệch mô-típ gốc!).
2. CÁC YẾU TỐ ĐƯỢC PHÉP & BẮT BUỘC THAY ĐỔI ĐỂ MỖI VIDEO ĐỘC LẬP, HẤP DẪN, KHÔNG TRÙNG LẶP MÁY MÓC:
   - ${
     lockBundle.seeds.length > 0
       ? allowFreeCostumeChange
         ? 'Khi dùng nhân vật tham chiếu đã chọn, giữ nguyên khuôn mặt/tóc/vóc dáng/nhận dạng; thay đổi vai trò tình huống, phương tiện, bối cảnh cụ thể, hành vi đối tượng chạm trán và cách giải quyết ở mỗi video.'
         : 'Khi dùng nhân vật tham chiếu đã khóa, giữ nguyên 100% nhận dạng & trang phục cố định; thay đổi phương tiện/cách tiếp cận, địa điểm cụ thể, biểu hiện/hành vi bất thường của tình huống chạm trán và cái kết ở mỗi video.'
       : 'Thay đổi rõ rệt NHÂN VẬT CHÍNH (nghề nghiệp, vai trò, độ tuổi, tâm lý) và PHƯƠNG TIỆN / CÁCH TIẾP CẬN giữa từng video.'
   }
   - Thay đổi BỐI CẢNH CỤ THỂ (đường đèo núi, đường làng, đường ven sông sương mù, quốc lộ vắng, ngõ nhỏ vùng ven...).
   - Thay đổi NGOẠI HÌNH & HÀNH VI KỲ LẠ / BIỂU HIỆN CỤ THỂ của tình huống cốt lõi.
   - Thay đổi DIỄN BIẾN CAO TRÀO, BƯỚC NGOẶT VÀ CÁCH GIẢI QUYẾT TÌNH HUỐNG để mỗi video là một câu chuyện trọn vẹn độc lập trong ${unitDurSec} giây.
3. TẤT CẢ ${params.videoCount} video đều đồng nhất về chủ đề, mô-típ cốt truyện, cảm xúc chủ đạo và phong cách hình ảnh (${params.videoStyleMeta.labelVi}) để dễ sản xuất hàng loạt theo chuỗi nội dung thống nhất.

ĐẦU VÀO:
- Nguồn: ${params.studioMode === 'creative' ? 'Ý tưởng gốc đã chọn' : `${params.contexts.length} video tham chiếu`}
${params.selectedIdeaTitle?.trim() ? `- Tiêu đề ý tưởng gốc: "${params.selectedIdeaTitle.trim()}"` : ''}
- Ý tưởng gốc BẮT BUỘC PHẢI BÁM MÔ-TÍP: "${params.ideaText || 'Khai thác mô-típ & tinh thần từ video tham chiếu'}"
- Thời lượng mỗi video độc lập: ${unitDurSec} giây
- Phong cách nội dung: ${STYLE_LABELS[params.stylePreset]}
- Phong cách hình ảnh thống nhất: ${params.videoStyleMeta.labelVi} (${params.videoStyleMeta.visualToneVi})
- Ngôn ngữ đầu ra: ${OUTPUT_LANG_LABELS[params.outputLang]}
${params.characterSummary?.trim() ? `- Gợi ý nhân vật tham khảo: ${params.characterSummary.trim()}` : ''}
${params.customInstruction?.trim() ? `- Yêu cầu thêm: ${params.customInstruction.trim()}` : ''}
${lockNote ? `\n${lockNote}` : ''}
${dossierText ? `\nTƯ LIỆU THAM CHIẾU:\n${dossierText}` : ''}

TRẢ VỀ JSON HỢP LỆ VỚI ĐÚNG ${params.videoCount} PHẦN TỬ TRONG MẢNG "concepts":
{
  "coreMotif": "Tóm tắt chính xác 1 câu về mô-típ cốt truyện & cấu trúc tình huống cốt lõi chung mà TẤT CẢ ${params.videoCount} video phái sinh phải tuân thủ",
  "sharedSpiritNote": "Mô tả ngắn gọn chủ đề, mô-típ cốt lõi và phong cách nghệ thuật thống nhất gắn kết cả ${params.videoCount} video",
  "concepts": [
    {
      "title": "Tiêu đề riêng hấp dẫn cho Video phái sinh #1 (nêu rõ nhân vật/tình huống biến thể, không đánh số Tập 1)",
      "premise": "Tóm tắt cốt truyện phái sinh độc lập (2-3 câu): giữ đúng mô-típ lõi nhưng nêu rõ nhân vật/phương tiện mới, bối cảnh cụ thể mới, hành vi/biểu hiện riêng và cao trào-kết thúc riêng",
      "characterBible": "Vai trò, ngoại hình & trang phục cụ thể của nhân vật riêng trong video phái sinh này",
      "settingBible": "Bối cảnh không gian cụ thể, thời điểm & tông màu ánh sáng riêng của video phái sinh này",
      "hookFormula": "Cách mở đầu giữ chân khán giả cho video phái sinh này",
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
  } else if (params.provider === 'xingchi') {
    const xcRes = await callXingchiCompletion({
      prompt: planPrompt,
      systemPrompt: 'Chỉ trả về JSON thuần túy hợp lệ đúng schema.',
      jsonMode: true,
      temperature: 0.85,
      timeoutMs: 80_000,
    });
    parsed = parseAiBlueprintJsonSafe(xcRes.text);
  } else if (params.provider === 'openai' || params.provider === 'meta' || params.provider === 'alibaba') {
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

    const baseCandidates = params.useProModel
      ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
      : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    const candidateModels = prioritizeGeminiCandidateModels(baseCandidates);

    let lastErr: any;
    for (let mIdx = 0; mIdx < candidateModels.length; mIdx += 1) {
      const candidateModel = candidateModels[mIdx];
      const isLastCandidate = mIdx === candidateModels.length - 1;
      const callTimeoutMs = isLastCandidate ? 38_000 : 22_000;
      const backoffDelays = isLastCandidate ? [900, 1800] : [];
      try {
        const response = await retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model: candidateModel,
              contents: { parts },
              config: {
                httpOptions: { timeout: callTimeoutMs },
                maxOutputTokens: 12288,
                ...(candidateModel.startsWith('gemini-4-')
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                systemInstruction:
                  `Luôn trả về ĐÚNG ${params.videoCount} video phái sinh độc lập trong mảng concepts của JSON. TẤT CẢ phải xoay quanh CÙNG MỘT mô-típ cốt truyện & cấu trúc tình huống lõi của ý tưởng gốc (coreMotif), KHÔNG tạo truyện ngẫu nhiên khác mô-típ và KHÔNG viết thành các tập nối tiếp; chỉ thay đổi nhân vật, phương tiện, bối cảnh cụ thể, hành vi và diễn biến giải quyết ở mỗi video.`,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  required: ['coreMotif', 'sharedSpiritNote', 'concepts'],
                  properties: {
                    coreMotif: { type: Type.STRING },
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
          backoffDelays
        );
        const candidateConceptParsed = parseAiBlueprintJsonSafe((response?.text ?? '{}').trim());
        if (
          (!Array.isArray(candidateConceptParsed?.concepts) || candidateConceptParsed.concepts.length === 0) &&
          !isLastCandidate
        ) {
          lastErr = new Error('AI trả về danh sách ý tưởng rỗng.');
          continue;
        }
        parsed = candidateConceptParsed;
        break;
      } catch (err: any) {
        lastErr = err;
        markGeminiModelOverloaded(candidateModel, err);
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

  const coreMotif = String(
    parsed?.coreMotif || params.selectedIdeaTitle || params.ideaText || 'Mô-típ tình huống cốt lõi từ nguồn tham chiếu'
  ).trim();

  return {
    coreMotif,
    sharedSpiritNote: String(
      parsed?.sharedSpiritNote ||
        `Mô-típ cốt lõi: ${coreMotif} · Phong cách ${params.videoStyleMeta.labelVi}`
    ).trim(),
    concepts,
  };
}

export async function learnAndCreateIndependentBatch(params: {
  mode?: StudioCreationMode;
  productionFormat?: StudioProductionFormat;
  ideaPrompt?: string;
  selectedIdeaTitle?: string;
  query?: string;
  videos?: DerivativeSourceInput[];
  videoCount: number;
  perVideoDurations?: number[];
  targetDurationSec?: number;
  desiredSceneCount?: number;
  stylePreset?: DerivativeStylePreset;
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  aspectRatio: DerivativeAspectRatio;
  outputLanguage?: DerivativeOutputLanguage;
  useProModel?: boolean;
  characterSummary?: string;
  characterRefsMeta?: StudioCharacterRefMetaInput[];
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  customInstruction?: string;
  enableVoiceover?: boolean;
  allowFreeCostumeChange?: boolean;
  aiProvider?: AiProviderId;
  prePlannedIdeas?: {
    title: string;
    summary?: string;
    detail?: string;
    suggestedSetting?: string;
  }[];
}): Promise<{ sharedSpiritNote: string; coreMotif: string; blueprints: DerivativeBlueprint[] }> {
  const studioMode: StudioCreationMode = params.mode === 'creative' ? 'creative' : 'derivative';
  const productionFormat: StudioProductionFormat =
    params.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';
  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const videosList = Array.isArray(params.videos) ? params.videos : [];
  const ideaText = (params.ideaPrompt || params.query || '').trim();
  const activeStylePreset: DerivativeStylePreset =
    params.stylePreset && params.stylePreset in STYLE_LABELS ? params.stylePreset : 'none';
  const prePlanned = Array.isArray(params.prePlannedIdeas)
    ? params.prePlannedIdeas
        .filter((it) => it && (String(it.title || '').trim() || String(it.summary || '').trim() || String(it.detail || '').trim()))
        .slice(0, 15)
    : [];

  if (studioMode === 'creative') {
    if (!ideaText && !params.customInstruction?.trim() && prePlanned.length === 0) {
      throw new Error('Vui lòng nhập ý tưởng hoặc mô tả chủ đề để Studio Sáng Tạo lên danh sách video.');
    }
  } else if (videosList.length === 0) {
    throw new Error('Vui lòng chọn hoặc tải lên ít nhất 1 video tham chiếu để AI phân tích tinh thần & chủ đề.');
  }

  const provider: AiProviderId =
    params.aiProvider === 'openai' ||
    params.aiProvider === 'meta' ||
    params.aiProvider === 'muse2api' ||
    params.aiProvider === 'xingchi' ||
    params.aiProvider === 'alibaba'
      ? params.aiProvider
      : 'gemini';

  const videoStyleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const videoStyle = videoStyleMeta.styleKey;
  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';
  const count =
    prePlanned.length > 0
      ? prePlanned.length
      : Math.max(1, Math.min(15, Math.round(Number(params.videoCount || 3))));
  const defaultDur = Math.max(10, Math.min(900, Math.round(Number(params.targetDurationSec || 30))));

  const contexts = videosList.length > 0 ? await gatherSourceContexts(videosList) : [];

  // If user already expanded ideas in Step 1 and chose to compile those exact ideas, DO NOT re-invent new concepts!
  const plan =
    prePlanned.length > 0
      ? {
          coreMotif: ideaText || prePlanned[0].title || 'Giữ nguyên danh sách ý tưởng đã triển khai',
          sharedSpiritNote: `Giữ nguyên ${prePlanned.length} ý tưởng đã triển khai · Phong cách ${videoStyleMeta.labelVi}`,
          concepts: prePlanned.map((it, idx) => {
            const title = String(it.title || `Ý tưởng ${String(idx + 1).padStart(2, '0')}`).trim();
            const premise = [String(it.summary || '').trim(), String(it.detail || '').trim()]
              .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i)
              .join('\n');
            return {
              title,
              premise: premise || title,
              characterBible: '',
              settingBible: String(it.suggestedSetting || '').trim(),
              hookFormula: 'Mở đầu trực diện bám sát ý tưởng đã chọn',
              derivativeHook: title.slice(0, 60),
            };
          }),
        }
      : await planIndependentVideoConcepts({
          studioMode,
          ideaText,
          selectedIdeaTitle: params.selectedIdeaTitle,
          contexts,
          videoCount: count,
          unitDurationSec: defaultDur,
          videoStyleMeta,
          stylePreset: activeStylePreset,
          outputLang,
          provider,
          useProModel: params.useProModel,
          customInstruction: params.customInstruction,
          characterSummary: params.characterSummary,
          characterRefsMeta: params.characterRefsMeta,
          allowFreeCostumeChange,
          costumeBible: params.costumeBible,
        });

  // Top up cleanly if the model returned slightly fewer concepts than requested
  while (plan.concepts.length < count) {
    const base = plan.concepts[plan.concepts.length % Math.max(1, plan.concepts.length)];
    const n = plan.concepts.length + 1;
    plan.concepts.push({
      title: `${base.title} (Biến thể phái sinh #${n})`,
      premise: `Video phái sinh độc lập giữ đúng mô-típ cốt lõi (${plan.coreMotif}), thay đổi sang nhân vật, phương tiện, bối cảnh cụ thể và diễn biến giải quyết tình huống mới mẻ khác với các video trước.`,
      characterBible: '',
      settingBible: '',
      hookFormula: base.hookFormula,
      derivativeHook: '',
    });
  }

  const selectedConcepts = plan.concepts.slice(0, count);
  const allTitles = selectedConcepts.map((c) => c.title);
  const blueprints: DerivativeBlueprint[] = new Array(selectedConcepts.length);
  const concurrency = provider === 'muse2api' ? 1 : selectedConcepts.length >= 3 ? 3 : 2;

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
          productionFormat,
          ideaPrompt: prePlanned.length > 0 ? `${concept.title}\n\n${concept.premise}` : ideaText,
          selectedIdeaTitle: concept.title,
          preserveExactIdea: prePlanned.length > 0,
          query: params.query,
          videos: videosList,
          stylePreset: activeStylePreset,
          videoStyle,
          customStylePrompt: params.customStylePrompt,
          aspectRatio: params.aspectRatio,
          targetDurationSec: vidDur,
          desiredSceneCount: params.desiredSceneCount,
          outputLanguage: outputLang,
          useProModel: params.useProModel,
          characterSummary: params.characterSummary,
          characterRefsMeta: params.characterRefsMeta,
          characterBible:
            !allowFreeCostumeChange && params.characterBible?.trim()
              ? params.characterBible
              : concept.characterBible || params.characterBible,
          settingBible: concept.settingBible || params.settingBible,
          visualStyleBible: params.visualStyleBible,
          costumeBible: params.costumeBible,
          continuityBible: params.continuityBible,
          customInstruction: params.customInstruction,
          enableVoiceover: params.enableVoiceover,
          allowFreeCostumeChange,
          aiProvider: provider,
          preGatheredContexts: contexts,
          conceptOverride: {
            title: concept.title,
            premise: concept.premise,
            coreMotif: plan.coreMotif,
            characterBible:
              !allowFreeCostumeChange && params.characterBible?.trim()
                ? params.characterBible
                : concept.characterBible,
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

  return { sharedSpiritNote: plan.sharedSpiritNote, coreMotif: plan.coreMotif, blueprints };
}

// ==========================================
// STUDIO SHARED PROJECT PROFILES & VIDEO LIBRARY
// ==========================================

export interface StudioProjectProfileRecord {
  id: string;
  name: string;
  description?: string;
  videoStyle: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  characterBible: string;
  settingBible: string;
  visualStyleBible: string;
  costumeBible: string;
  continuityBible: string;
  characterRefs: StudioCharacterRefInput[];
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
  const validStyle: StudioVideoStyle = resolveVideoStyleMeta(input.videoStyle).styleKey;

  const record: StudioProjectProfileRecord = {
    id,
    name: name.slice(0, 80),
    description: String(input.description || '').trim().slice(0, 240),
    videoStyle: validStyle,
    allowFreeCostumeChange: input.allowFreeCostumeChange === true,
    characterBible: String(input.characterBible || '').trim(),
    settingBible: String(input.settingBible || '').trim(),
    visualStyleBible: String(input.visualStyleBible || '').trim(),
    costumeBible: String(input.costumeBible || '').trim(),
    continuityBible: String(input.continuityBible || '').trim(),
    characterRefs: Array.isArray(input.characterRefs) ? input.characterRefs.slice(0, 8) : [],
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

// ==========================================
// STUDIO PERSISTENT CHARACTER LIBRARY
// ==========================================

export interface StudioCharacterLibraryRecord extends StudioCharacterRefInput {
  id: string;
  name: string;
  dataUrl: string;
  description?: string;
  source: 'uploaded' | 'ai_generated';
  createdAt: number;
  updatedAt: number;
}

const STUDIO_CHARACTER_LIBRARY_FILE = path.join(process.cwd(), 'data', 'studio_character_library.json');

function ensureStudioCharacterLibraryFile(): void {
  const dir = path.dirname(STUDIO_CHARACTER_LIBRARY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STUDIO_CHARACTER_LIBRARY_FILE)) {
    fs.writeFileSync(STUDIO_CHARACTER_LIBRARY_FILE, '[]', 'utf8');
  }
}

export function listStudioCharacterLibrary(): StudioCharacterLibraryRecord[] {
  try {
    ensureStudioCharacterLibraryFile();
    const raw = fs.readFileSync(STUDIO_CHARACTER_LIBRARY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStudioCharacterLibraryItem(
  input: Partial<StudioCharacterLibraryRecord>
): StudioCharacterLibraryRecord {
  const list = listStudioCharacterLibrary();
  const dataUrl = String(input.dataUrl || '').trim();
  if (!dataUrl || (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('http://') && !dataUrl.startsWith('https://') && !dataUrl.startsWith('/'))) {
    throw new Error('Thiếu ảnh nhân vật hợp lệ để lưu vào thư viện.');
  }

  const rawId = String(input.id || '').trim();
  const existingIdx = rawId ? list.findIndex((item) => item.id === rawId) : -1;
  const existing = existingIdx >= 0 ? list[existingIdx] : null;
  const id = existing?.id || rawId || `charlib_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  const cleanName = String(input.name ?? existing?.name ?? '').trim().slice(0, 80) || 'Nhân vật chưa đặt tên';
  const cleanDesc =
    input.description !== undefined
      ? String(input.description || '').trim().slice(0, 600)
      : existing?.description || '';

  const rawSync = input.syncProfile !== undefined ? input.syncProfile : existing?.syncProfile;
  const cleanSyncProfile =
    rawSync && typeof rawSync === 'object'
      ? {
          face: String(rawSync.face || '').trim().slice(0, 400),
          physique: String(rawSync.physique || '').trim().slice(0, 400),
          costume: String(rawSync.costume || '').trim().slice(0, 400),
          voice: String(rawSync.voice || '').trim().slice(0, 400),
          distinguishingMarks: String(rawSync.distinguishingMarks || '').trim().slice(0, 400),
        }
      : undefined;

  const record: StudioCharacterLibraryRecord = {
    id,
    name: cleanName,
    dataUrl,
    ...(cleanDesc ? { description: cleanDesc } : {}),
    source: input.source === 'ai_generated' ? 'ai_generated' : existing?.source || 'uploaded',
    ...(input.ageGroup || existing?.ageGroup ? { ageGroup: input.ageGroup ?? existing?.ageGroup } : {}),
    ...(input.gender || existing?.gender ? { gender: input.gender ?? existing?.gender } : {}),
    ...(input.voiceMode || existing?.voiceMode ? { voiceMode: input.voiceMode ?? existing?.voiceMode } : {}),
    ...(input.voiceId || existing?.voiceId ? { voiceId: input.voiceId ?? existing?.voiceId } : {}),
    ...(input.offlineVoice || existing?.offlineVoice ? { offlineVoice: input.offlineVoice ?? existing?.offlineVoice } : {}),
    ...(input.voiceStyle || existing?.voiceStyle ? { voiceStyle: input.voiceStyle ?? existing?.voiceStyle } : {}),
    accentLock: 'vn_north',
    ...(cleanSyncProfile ? { syncProfile: cleanSyncProfile } : {}),
    createdAt: existing?.createdAt || (typeof input.createdAt === 'number' && input.createdAt > 0 ? input.createdAt : now),
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    list[existingIdx] = record;
  } else {
    list.unshift(record);
  }
  ensureStudioCharacterLibraryFile();
  const tmpFile = `${STUDIO_CHARACTER_LIBRARY_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(list.slice(0, 120), null, 2), 'utf8');
  fs.renameSync(tmpFile, STUDIO_CHARACTER_LIBRARY_FILE);
  return record;
}

export function deleteStudioCharacterLibraryItem(id: string): boolean {
  const targetId = String(id || '').trim();
  if (!targetId) return false;
  const list = listStudioCharacterLibrary();
  const next = list.filter((item) => item.id !== targetId);
  if (next.length === list.length) return false;
  ensureStudioCharacterLibraryFile();
  const tmpFile = `${STUDIO_CHARACTER_LIBRARY_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmpFile, STUDIO_CHARACTER_LIBRARY_FILE);
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

function normalizeCharacterMatchText(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCharacterAliases(name: string): string[] {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const aliases = new Set<string>();
  const normFull = normalizeCharacterMatchText(raw);
  if (normFull.length >= 2) aliases.add(normFull);
  const beforeParen = normalizeCharacterMatchText(raw.split('(')[0].split('-')[0].split(':')[0]);
  if (beforeParen.length >= 2) aliases.add(beforeParen);

  const stopTokens = new Set([
    'nhan',
    'vat',
    'chinh',
    'phu',
    'mau',
    'anh',
    'character',
    'ref',
    'image',
    'img',
    'photo',
    'nguoi',
    'ban',
  ]);
  for (const tok of beforeParen.split(/\s+/)) {
    if (tok.length >= 2 && !stopTokens.has(tok) && !/^\d+$/.test(tok)) {
      aliases.add(tok);
    }
  }
  return Array.from(aliases);
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function selectAndMapCharacterRefsForScene(params: {
  characterRefs?: StudioCharacterRefInput[];
  selectedCharacterIds?: string[];
  prompt: string;
  charactersInScene?: string;
  actionDetail?: string;
  dialogue?: string;
  sceneSummary?: string;
  costume?: string;
  hasSceneKeyframe?: boolean;
}): Promise<{
  selectedRefs: StudioCharacterRefInput[];
  mappingDirective: string;
}> {
  const validRefs = (params.characterRefs || [])
    .filter((r) => Boolean(r && r.dataUrl && String(r.dataUrl).trim()))
    .slice(0, 8);

  if (validRefs.length === 0) {
    return { selectedRefs: [], mappingDirective: '' };
  }

  const refStartNum = params.hasSceneKeyframe ? 2 : 1;

  const formatRefProfile = (r: StudioCharacterRefInput): string => {
    const sp = r.syncProfile;
    if (!sp) return r.description?.trim() ? `Đặc điểm: ${r.description.trim()}` : '';
    const bits = [
      sp.face?.trim() ? `Gương mặt: ${sp.face.trim()}` : '',
      sp.physique?.trim() ? `Vóc dáng: ${sp.physique.trim()}` : '',
      sp.costume?.trim() ? `Trang phục: ${sp.costume.trim()}` : '',
      sp.voice?.trim() ? `Giọng nói: ${sp.voice.trim()}` : '',
      sp.distinguishingMarks?.trim() ? `Đặc điểm nhận dạng: ${sp.distinguishingMarks.trim()}` : '',
    ].filter(Boolean);
    if (bits.length > 0) return bits.join('; ');
    return r.description?.trim() ? `Đặc điểm: ${r.description.trim()}` : '';
  };

  const buildMappingDirective = (refs: StudioCharacterRefInput[]) => {
    if (refs.length === 0) return '';
    if (params.hasSceneKeyframe) {
      const refMap = refs
        .map((r, idx) => {
          const imgNum = refStartNum + idx;
          const name = (r.name || `Nhân vật #${idx + 1}`).trim();
          const shortFace = r.syncProfile?.face?.trim() || r.description?.trim() || '';
          const shortCostume = r.syncProfile?.costume?.trim() || '';
          const cue = [shortFace ? `face/hair: ${shortFace.slice(0, 80)}` : '', shortCostume ? `outfit: ${shortCostume.slice(0, 70)}` : '']
            .filter(Boolean)
            .join('; ');
          return `Image #${imgNum} = "${name}" identity anchor ONLY${cue ? ` (${cue})` : ''}`;
        })
        .join('; ');
      return `IMAGE ROLE MAP: Image #1 is the EXACT STARTING FRAME (t=0.0s) of this scene — animate DIRECTLY from Image #1 without replacing the person or background. ${refMap} (reference ONLY for facial/outfit consistency, NEVER cut to a portrait or use as an ending frame).`;
    }
    if (refs.length === 1) {
      const r = refs[0];
      const name = (r.name || 'Nhân vật chính').trim();
      const profileStr = formatRefProfile(r);
      const desc = profileStr ? ` (${profileStr})` : '';
      return `[QUY TẮC ĐỒNG BỘ NHÂN VẬT THAM CHIẾU]: Ảnh tham chiếu #1 tương ứng với nhân vật "${name}"${desc}. Phải giữ chính xác 100% khuôn mặt, vóc dáng, kiểu tóc, trang phục và đặc điểm nhận dạng từ Ảnh tham chiếu #1.`;
    }
    const lines = refs.map((r, idx) => {
      const name = (r.name || `Nhân vật #${idx + 1}`).trim();
      const profileStr = formatRefProfile(r);
      const desc = profileStr ? ` — Hồ sơ 5 thành phần: ${profileStr}` : '';
      return `- Ảnh tham chiếu #${idx + 1} tương ứng CHÍNH XÁC với nhân vật "${name}"${desc}: BẮT BUỘC giữ nguyên khuôn mặt, vóc dáng, ngoại hình, kiểu tóc, trang phục và đặc điểm nhận dạng từ Ảnh #${idx + 1}.`;
    });
    return `[QUY TẮC ĐỒNG BỘ ĐA NHÂN VẬT (${refs.length} ẢNH THAM CHIẾU) — TUYỆT ĐỐI KHÔNG CHỈ DÙNG ẢNH #1]:
Trong phân cảnh này có ${refs.length} nhân vật cần đồng bộ và ĐẦY ĐỦ ${refs.length} ảnh tham chiếu của từng nhân vật đã được đính kèm theo đúng thứ tự:
${lines.join('\n')}
KHÔNG ĐƯỢC phép tự sáng tạo khuôn mặt/vóc dáng/trang phục khác cho các nhân vật còn lại. Phải hiển thị đúng nhận dạng từng nhân vật theo đúng số thứ tự ảnh tham chiếu tương ứng.`;
  };

  if (Array.isArray(params.selectedCharacterIds) && params.selectedCharacterIds.length > 0) {
    const idSet = new Set(params.selectedCharacterIds.map((id) => String(id).trim()).filter(Boolean));
    const explicitlySelected = validRefs.filter((r) => r.id && idSet.has(String(r.id).trim()));
    if (explicitlySelected.length > 0) {
      return {
        selectedRefs: explicitlySelected,
        mappingDirective: buildMappingDirective(explicitlySelected),
      };
    }
  }

  if (validRefs.length === 1) {
    return { selectedRefs: validRefs, mappingDirective: buildMappingDirective(validRefs) };
  }

  const sceneCorpus = normalizeCharacterMatchText(
    [
      params.charactersInScene || '',
      params.dialogue || '',
      params.actionDetail || '',
      params.sceneSummary || '',
      params.costume || '',
      params.prompt || '',
    ].join(' | ')
  );

  // Check if text explicitly indicates "all characters" or multiple people together
  const allMentionedHint =
    /(?:tat ca|ca hai|ca 2|ca 3|ca nhom|hai nguoi|ba nguoi|cung nhau|both characters|all characters|everyone|together)/i.test(
      sceneCorpus
    );

  const deterministicMatches: number[] = [];
  validRefs.forEach((ref, idx) => {
    const aliases = extractCharacterAliases(ref.name || '');
    const matched = aliases.some((al) => {
      if (al.length <= 2) {
        return new RegExp(`(?:^|\\s)${escapeRegexLiteral(al)}(?:$|\\s|:)`, 'i').test(sceneCorpus);
      }
      return sceneCorpus.includes(al);
    });
    if (matched) deterministicMatches.push(idx);
  });

  // Use Gemini semantic matcher when 2+ character refs exist and text matching might miss aliases/pronouns
  let selectedIndices: number[] = deterministicMatches;
  const shouldAskSemanticMapper =
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    (deterministicMatches.length === 0 ||
      (deterministicMatches.length < validRefs.length &&
        (allMentionedHint ||
          Boolean(params.charactersInScene && params.charactersInScene.split(/[,;&+/]|\bvà\b|\bwith\b|\band\b/i).length > deterministicMatches.length))));

  if (shouldAskSemanticMapper) {
    try {
      const ai = getGeminiClient();
      const charListText = validRefs
        .map(
          (r, idx) =>
            `${idx}: Tên="${r.name || `Nhân vật ${idx + 1}`}"${r.description ? ` | Mô tả ngoại hình/vai trò="${r.description}"` : ''}`
        )
        .join('\n');
      const analyzePrompt = `Phân tích danh sách nhân vật xuất hiện trong phân cảnh dưới đây để ánh xạ với ảnh tham chiếu đã tải lên.

DANH SÁCH ẢNH NHÂN VẬT THAM CHIẾU:
${charListText}

THÔNG TIN PHÂN CẢNH:
- Trường Nhân vật trong cảnh: ${params.charactersInScene || '(không ghi rõ)'}
- Lời thoại: ${params.dialogue || '(không có)'}
- Hành động / Diễn biến: ${params.actionDetail || params.sceneSummary || ''}
- Prompt phân cảnh: ${params.prompt}

YÊU CẦU: Trả về JSON dạng {"matchedIndices": [0, ...]} liệt kê CHỈ SỐ (index 0..${validRefs.length - 1}) của TẤT CẢ nhân vật có xuất hiện trong phân cảnh này. Nếu phân cảnh mô tả nhiều nhân vật (hoặc không loại trừ ai rõ ràng), phải liệt kê ĐẦY ĐỦ tất cả nhân vật xuất hiện.`;

      const resp = await retryWithGeminiBackoff(
        () =>
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: analyzePrompt,
            config: {
              httpOptions: { timeout: 12_000 },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                required: ['matchedIndices'],
                properties: {
                  matchedIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                },
              },
            },
          }),
        [800]
      );
      const parsed = parseAiBlueprintJsonSafe((resp.text || '{}').trim());
      if (Array.isArray(parsed?.matchedIndices)) {
        const aiIndices = parsed.matchedIndices
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isInteger(n) && n >= 0 && n < validRefs.length);
        selectedIndices = Array.from(new Set([...deterministicMatches, ...aiIndices])).sort((a, b) => a - b);
      }
    } catch {
      // Fall back gracefully below
    }
  }

  // Fail-safe for multi-ref consistency: if 0 matched (e.g. scene prompt used pronouns or file-name refs),
  // include ALL uploaded character references so multi-character scenes never drop references!
  const finalRefs =
    selectedIndices.length > 0
      ? selectedIndices.map((idx) => validRefs[idx])
      : validRefs;

  return {
    selectedRefs: finalRefs,
    mappingDirective: buildMappingDirective(finalRefs),
  };
}

export async function generateStudioImage(params: {
  mode: 'character' | 'scene';
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  quality?: 'standard' | 'pro';
  engine?: 'gemini' | 'muse2api' | 'qwen' | 'xingchi';
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  sceneIndex?: number;
  totalScenes?: number;
  sceneTitle?: string;
  charactersInScene?: string;
  settingDetail?: string;
  actionDetail?: string;
  dialogue?: string;
  sceneSummary?: string;
  costume?: string;
  cameraAngle?: string;
  vfxNotes?: string;
  selectedCharacterIds?: string[];
  characterRefs?: StudioCharacterRefInput[];
  museAccountId?: string;
  geminiApiKey?: string;
  allowFreeCostumeChange?: boolean;
}): Promise<{ dataUrl: string; model: string }> {
  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const aspectRatio = params.aspectRatio || (params.mode === 'character' ? '1:1' : '16:9');
  const styleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);

  const sceneNarrativeAnchor =
    params.mode === 'scene'
      ? [
          params.sceneSummary?.trim()
            ? `MAIN SCENE CONTENT & PLOT EVENT TO DEPICT (HIGHEST PRIORITY — strictly illustrate this exact narrative moment): ${params.sceneSummary.trim()}.`
            : '',
          params.sceneTitle?.trim() ? `Scene Title: ${params.sceneTitle.trim()}.` : '',
          params.actionDetail?.trim() ? `Exact Character Action & Pose: ${params.actionDetail.trim()}.` : '',
          params.charactersInScene?.trim() ? `Characters Appearing: ${params.charactersInScene.trim()}.` : '',
          params.settingDetail?.trim() ? `Scene Setting & Location: ${params.settingDetail.trim()}.` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';

  const styleBlock = [
    `Art & Video Style Directive (STRICTLY ENFORCE): ${styleMeta.promptDirective}.`,
    styleMeta.learnedStyle?.characterRendering
      ? `Learned Character Design Proportions & Linework: ${styleMeta.learnedStyle.characterRendering}.`
      : '',
    styleMeta.learnedStyle?.lightingStyle
      ? `Learned Lighting & Atmosphere: ${styleMeta.learnedStyle.lightingStyle}.`
      : '',
    params.visualStyleBible?.trim() ? `Visual Style & Color Palette: ${params.visualStyleBible.trim()}.` : '',
    params.sceneIndex
      ? `Sequential Storyboard Frame: Scene ${String(params.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const bibleTailBlock = [
    params.characterBible?.trim()
      ? `Locked Character Reference (MUST keep exact facial features, hair, proportions consistent): ${params.characterBible.trim()}.`
      : '',
    params.costumeBible?.trim()
      ? allowFreeCostumeChange
        ? `Costume Guidance (adapt outfit strictly as directed by scene prompt while keeping character face, hair & physique identical): ${params.costumeBible.trim()}.`
        : `Locked Costume Reference (STRICT 100% LOCK — DO NOT alter outfit, colors, sleeves, outerwear, or accessories): ${params.costumeBible.trim()}.`
      : '',
    params.settingBible?.trim() ? `Locked Environment Reference: ${params.settingBible.trim()}.` : '',
    params.continuityBible?.trim() ? `Story Continuity Rule: ${params.continuityBible.trim()}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { selectedRefs, mappingDirective } =
    params.mode === 'character'
      ? { selectedRefs: [] as StudioCharacterRefInput[], mappingDirective: '' }
      : await selectAndMapCharacterRefsForScene({
          characterRefs: params.characterRefs,
          selectedCharacterIds: params.selectedCharacterIds,
          prompt: params.prompt,
          charactersInScene: params.charactersInScene,
          actionDetail: params.actionDetail,
          dialogue: params.dialogue,
          sceneSummary: params.sceneSummary,
          costume: params.costume,
        });

  const buildScenePrompt = (refs: StudioCharacterRefInput[], mapping: string) => {
    let basePrompt = '';
    if (params.mode === 'character') {
      basePrompt = `${styleBlock} ${bibleTailBlock} Create a clean, consistent studio character turnaround / portrait reference sheet suitable for reusing identically across all video scenes. Character description: ${params.prompt}. Neutral clean studio lighting, soft even key light, uncluttered neutral backdrop, crisp framing, no overlaid watermarks, subtitles, or UI text.`;
    } else if (refs.length > 0) {
      const refNames = refs.map((r, i) => `#${i + 1}: ${r.name || `Nhân vật ${i + 1}`}`).join(', ');
      const lockClause = allowFreeCostumeChange
        ? `strictly preserving the exact character identities, faces, hairstyles, hair colors, body proportions & distinguishing marks of ALL attached character reference photos (${refNames}) while adapting outfits strictly as directed by the scene prompt`
        : `strictly preserving the exact character identities, faces, hairstyles, hair colors, body proportions, AND exact outfits, garment colors & accessories of ALL attached character reference photos (${refNames}) with ZERO unauthorized wardrobe changes`;
      basePrompt = `${sceneNarrativeAnchor} ${mapping} Create a cohesive storyboard illustration depicting the EXACT Main Scene Content above while ${lockClause}. ${styleBlock} Detailed visual instructions: ${params.prompt}. ${bibleTailBlock} No overlaid subtitles, speech bubbles, or watermarks.`;
    } else {
      basePrompt = `${sceneNarrativeAnchor} Create a crisp, cohesive storyboard illustration depicting the EXACT Main Scene Content above. ${styleBlock} Detailed visual instructions: ${params.prompt}. ${bibleTailBlock} No overlaid subtitles, text, or watermarks.`;
    }
    const styled =
      params.mode === 'scene' && params.videoStyle === 'cinematic_filmmaking'
        ? enhancePromptWithCinematicSkill({
            basePrompt,
            mediaType: 'image',
            sceneIndex: params.sceneIndex,
            totalScenes: params.totalScenes,
          })
        : basePrompt;
    return compileProductionModelPrompt({
      rawCompiledPrompt: styled,
      mode: params.mode,
      mediaType: 'image',
      hasAttachedRefs: refs.length > 0,
      cameraAngle: params.cameraAngle,
      vfxNotes: params.vfxNotes,
      targetEngine: params.engine === 'muse2api' ? 'muse2api' : 'gemini',
      characterBible: params.characterBible,
      costumeBible: params.costumeBible,
      allowFreeCostumeChange,
    }).prompt;
  };

  if (params.engine === 'muse2api') {
    const finalMusePrompt = buildScenePrompt(selectedRefs, mappingDirective);
    const res = await generateImageViaMuse2Api({
      prompt: finalMusePrompt,
      aspectRatio,
      referenceImageDataUrl: selectedRefs[0]?.dataUrl,
      referenceImages: selectedRefs.map((r) => r.dataUrl),
      accountId: params.museAccountId,
    });
    return { dataUrl: res.dataUrl, model: 'muse-image (Muse2API)' };
  }

  if (params.engine === 'qwen') {
    const finalQwenPrompt = buildScenePrompt(selectedRefs, mappingDirective);
    const res = await generateImageViaAlibabaQwen({
      prompt: finalQwenPrompt,
      aspectRatio,
      referenceImages: selectedRefs.map((r) => r.dataUrl),
    });
    return { dataUrl: res.dataUrl, model: `${res.model} (Alibaba Qwen)` };
  }

  if (params.engine === 'xingchi') {
    const finalXingchiPrompt = buildScenePrompt(selectedRefs, mappingDirective);
    const res = await generateImageWithXingchi({
      prompt: finalXingchiPrompt,
      aspectRatio,
      referenceImages: selectedRefs.map((r) => r.dataUrl),
    });
    return { dataUrl: res.dataUrl, model: res.model };
  }

  const ai = getGeminiClient(params.geminiApiKey);
  const parts: any[] = [];
  selectedRefs.forEach((ref, idx) => {
    const parsed = parseDataUrlToBuffer(ref.dataUrl);
    if (parsed) {
      const charName = (ref.name || `Nhân vật #${idx + 1}`).trim();
      const charDesc = ref.description?.trim() ? ` (${ref.description.trim()})` : '';
      parts.push({
        text: `[Ảnh tham chiếu #${idx + 1} -> Nhân vật "${charName}"${charDesc}]`,
      });
      parts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.buffer.toString('base64'),
        },
      });
    }
  });

  const finalPrompt = buildScenePrompt(selectedRefs, mappingDirective);
  parts.push({ text: finalPrompt });

  const candidateModels =
    params.quality === 'pro'
      ? ['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image']
      : ['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1'];

  let lastErr: any;
  for (const model of candidateModels) {
    const runGenerateImage = (client: GoogleGenAI) =>
      retryWithGeminiBackoff(
        () =>
          client.models.generateContent({
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

    try {
      let response;
      try {
        response = await runGenerateImage(ai);
      } catch (v1Err: any) {
        const msg = String(v1Err?.message || v1Err || '').toLowerCase();
        if (msg.includes('404') || msg.includes('not_found') || msg.includes('v1beta')) {
          response = await runGenerateImage(getGeminiBetaClient(params.geminiApiKey));
        } else {
          throw v1Err;
        }
      }

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

export interface AnalyzedCharacterProfileResult {
  id: string;
  name: string;
  syncProfile: CharacterFivePartProfile;
  suggestedDescription: string;
  suggestedAgeGroup?: Exclude<CharacterAgeGroup, 'auto'>;
  suggestedGender?: Exclude<CharacterGenderHint, 'auto'>;
}

function buildFallbackFivePartProfile(char: {
  name?: string;
  description?: string;
  ageGroup?: CharacterAgeGroup;
  gender?: CharacterGenderHint;
  syncProfile?: CharacterFivePartProfile;
}): CharacterFivePartProfile {
  const existing = char.syncProfile;
  const ageHint =
    char.ageGroup && char.ageGroup !== 'auto'
      ? AGE_GROUP_VOICE_CAST_POOLS[char.ageGroup]?.labelVi || char.ageGroup
      : 'Phù hợp tạo hình trong ảnh mẫu';
  const desc = (char.description || '').trim();
  const baseName = (char.name || 'Nhân vật').trim();
  return {
    face:
      existing?.face?.trim() ||
      (desc
        ? `Gương mặt, kiểu tóc và thần thái của ${baseName} bám sát ảnh mẫu (${desc.slice(0, 120)})`
        : `Gương mặt, đường nét mắt mũi miệng và kiểu tóc của ${baseName} cố định theo ảnh tham chiếu`),
    physique: existing?.physique?.trim() || `Tỷ lệ cơ thể, chiều cao và dáng đứng của ${baseName} (${ageHint})`,
    costume: existing?.costume?.trim() || (desc ? `Trang phục & phụ kiện đồng bộ theo ảnh mẫu của ${baseName}` : `Trang phục nguyên bản của ${baseName} giữ đồng bộ mọi cảnh`),
    voice: existing?.voice?.trim() || `Giọng nói chuẩn tiếng Việt miền Bắc phù hợp độ tuổi ${ageHint} của ${baseName}`,
    distinguishingMarks:
      existing?.distinguishingMarks?.trim() || `Thần thái biểu cảm và dấu hiệu nhận diện riêng biệt của ${baseName}`,
  };
}

export async function analyzeCharactersFivePartProfiles(params: {
  characters: {
    id: string;
    name: string;
    dataUrl?: string;
    description?: string;
    ageGroup?: CharacterAgeGroup;
    gender?: CharacterGenderHint;
    syncProfile?: CharacterFivePartProfile;
  }[];
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  ideaContext?: string;
  aiProvider?: AiProviderId;
}): Promise<{ profiles: AnalyzedCharacterProfileResult[]; usedModel: string }> {
  const list = Array.isArray(params.characters) ? params.characters.slice(0, 8) : [];
  if (list.length === 0) {
    return { profiles: [], usedModel: 'none' };
  }

  const styleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const provider: AiProviderId =
    params.aiProvider === 'openai' ||
    params.aiProvider === 'meta' ||
    params.aiProvider === 'muse2api' ||
    params.aiProvider === 'xingchi' ||
    params.aiProvider === 'alibaba'
      ? params.aiProvider
      : 'gemini';

  const charRosterText = list
    .map(
      (c, idx) =>
        `#${idx + 1} | id="${c.id}" | Tên="${c.name || `Nhân vật ${idx + 1}`}" | Mô tả sẵn="${c.description || ''}" | Nhóm tuổi="${c.ageGroup || 'auto'}"`
    )
    .join('\n');

  const analysisInstruction = `Bạn là Đạo diễn Thiết kế Nhân vật AI. Hãy quan sát TẤT CẢ ${list.length} nhân vật được cung cấp dưới đây (ảnh tham chiếu được đính kèm theo đúng thứ tự #1..#${list.length}) và lập HỒ SƠ ĐỒNG BỘ 5 THÀNH PHẦN ĐỘC LẬP CHO TỪNG NHÂN VẬT RIÊNG BIỆT.

QUY TẮC BẮT BUỘC:
- PHẢI trả về ĐẦY ĐỦ ĐÚNG ${list.length} phần tử trong mảng "profiles", tương ứng CHÍNH XÁC từng "id" đã liệt kê dưới đây (tuyệt đối KHÔNG gộp chung, KHÔNG bỏ sót nhân vật nào).
- Nếu nhiều nhân vật giống thể loại (VD: cùng trang phục cảnh sát hoặc cùng phong cách anime), vẫn PHẢI chỉ rõ nét khác biệt riêng của từng người (kiểu tóc, tuổi tác, ngũ quan, vóc dáng, phụ kiện, sắc thái giọng nói).
- Phong cách dự án: ${styleMeta.labelVi} (${styleMeta.visualToneVi}).
${params.ideaContext?.trim() ? `- Bối cảnh / Ý tưởng dự án: ${params.ideaContext.trim()}\n` : ''}
DANH SÁCH NHÂN VẬT CẦN PHÂN TÍCH:
${charRosterText}

TRẢ VỀ DUY NHẤT JSON HỢP LỆ THEO MẪU:
{
  "profiles": [
    {
      "id": "Đúng id của nhân vật",
      "name": "Tên nhân vật",
      "ageGroup": "child | youth | adult_male | adult_female | middle_aged | elderly",
      "gender": "male | female",
      "face": "Mô tả cực chi tiết gương mặt, đường nét mắt/mũi/miệng, màu da, râu/son, kiểu & màu tóc",
      "physique": "Mô tả chi tiết vóc dáng, chiều cao ước lượng, dáng người, tư thế đặc trưng",
      "costume": "Mô tả chi tiết trang phục đang mặc, màu sắc chất liệu, giày/phụ kiện cố định",
      "voice": "Mô tả chi tiết chất giọng tiếng Việt miền Bắc (Hà Nội) phù hợp ngoại hình & độ tuổi (cao độ, tốc độ, âm sắc)",
      "distinguishingMarks": "Đặc điểm nhận dạng nổi bật nhất để AI phân biệt nhân vật này với các nhân vật khác (vết sẹo, kính, khuyên, nốt ruồi, huy hiệu, phong thái...)"
    }
  ]
}`;

  const parsedMap = new Map<string, any>();
  let usedModel = 'fallback-profile';

  const ingestParsed = (parsed: any) => {
    const arr = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    arr.forEach((item: any, idx: number) => {
      if (!item || typeof item !== 'object') return;
      const byId = list.find((c) => c.id === String(item.id || '').trim());
      const byName = !byId
        ? list.find((c) => normalizeCharacterMatchText(c.name) === normalizeCharacterMatchText(String(item.name || '')))
        : undefined;
      const targetChar = byId || byName || (arr.length === list.length ? list[idx] : undefined);
      if (targetChar && !parsedMap.has(targetChar.id)) {
        parsedMap.set(targetChar.id, item);
      }
    });
  };

  if (provider === 'muse2api') {
    const st = await getMuse2ApiStatus().catch(() => null);
    if (st?.ready) {
      usedModel = 'muse-spark (Muse2API)';
      const rawReply = await chatWithMuse2ApiSpark([
        {
          role: 'system',
          content:
            'Bạn là Đạo diễn thiết kế nhân vật. Luôn trả về duy nhất 1 JSON object hợp lệ với mảng profiles chứa đủ tất cả nhân vật theo id.',
        },
        { role: 'user', content: analysisInstruction },
      ]);
      ingestParsed(parseAiBlueprintJsonSafe(rawReply));
    }
  } else if (provider === 'xingchi') {
    const xc = getXingchiRuntimeConfig();
    if (xc.enabled && xc.apiKey) {
      try {
        const photoUrls = list.map((c) => c.dataUrl).filter((u): u is string => Boolean(u));
        const charHeader = list
          .map((c, idx) => `- Ảnh #${idx + 1}: id="${c.id}", Tên="${c.name}"`)
          .join('\n');
        const xcRes = await callXingchiCompletion({
          prompt: `${analysisInstruction}\n\nDanh sách nhân vật kèm ảnh:\n${charHeader}`,
          systemPrompt:
            'Bạn là Đạo diễn thiết kế nhân vật. Luôn trả về duy nhất 1 JSON object hợp lệ với mảng profiles chứa đủ tất cả nhân vật theo id.',
          imageDataUrls: photoUrls,
          jsonMode: true,
          temperature: 0.4,
          timeoutMs: 55_000,
        });
        usedModel = xcRes.model;
        ingestParsed(parseAiBlueprintJsonSafe(xcRes.text));
      } catch {
        // Fall through to Gemini fallback below if configured
      }
    }
  } else if (provider === 'openai' || provider === 'meta' || provider === 'alibaba') {
    const cfg = resolveOpenAiCompatibleConfig(provider);
    if (cfg.apiKey) {
      usedModel = cfg.model;
      const content: any[] = [{ type: 'text', text: analysisInstruction }];
      list.forEach((c, idx) => {
        if (c.dataUrl) {
          content.push({ type: 'text', text: `[Ảnh nhân vật #${idx + 1} | id="${c.id}" | Tên="${c.name}"]` });
          content.push({ type: 'image_url', image_url: { url: c.dataUrl } });
        }
      });
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        ingestParsed(parseAiBlueprintJsonSafe(String(data?.choices?.[0]?.message?.content || '{}')));
      }
    }
  }

  // Default & fallback Gemini Vision multi-character analyzer
  if (parsedMap.size < list.length && process.env.GEMINI_API_KEY?.trim()) {
    const ai = getGeminiClient();
    const parts: any[] = [];
    list.forEach((c, idx) => {
      const parsed = c.dataUrl ? parseDataUrlToBuffer(c.dataUrl) : null;
      if (parsed) {
        parts.push({ text: `[Ảnh nhân vật #${idx + 1} | id="${c.id}" | Tên="${c.name || `Nhân vật ${idx + 1}`}"]` });
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.buffer.toString('base64') } });
      }
    });
    parts.push({ text: analysisInstruction });

    const candidateModels = prioritizeGeminiCandidateModels(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
    for (const model of candidateModels) {
      try {
        const resp = await retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model,
              contents: { parts },
              config: {
                httpOptions: { timeout: 35_000 },
                responseMimeType: 'application/json',
                ...(model.startsWith('gemini-4-') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
                responseSchema: {
                  type: Type.OBJECT,
                  required: ['profiles'],
                  properties: {
                    profiles: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        required: ['id', 'name', 'face', 'physique', 'costume', 'voice', 'distinguishingMarks'],
                        properties: {
                          id: { type: Type.STRING },
                          name: { type: Type.STRING },
                          ageGroup: { type: Type.STRING },
                          gender: { type: Type.STRING },
                          face: { type: Type.STRING },
                          physique: { type: Type.STRING },
                          costume: { type: Type.STRING },
                          voice: { type: Type.STRING },
                          distinguishingMarks: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
            }),
          [800]
        );
        ingestParsed(parseAiBlueprintJsonSafe((resp.text || '{}').trim()));
        usedModel = model;
        if (parsedMap.size >= list.length) break;
      } catch (err: any) {
        markGeminiModelOverloaded(model, err);
      }
    }

    // Individual retry for any missing character ID so 100% of uploaded characters get their own distinct profile
    for (const c of list) {
      if (parsedMap.has(c.id)) continue;
      const parsedImg = c.dataUrl ? parseDataUrlToBuffer(c.dataUrl) : null;
      if (!parsedImg) continue;
      try {
        const singleParts: any[] = [
          {
            text: `Phân tích duy nhất nhân vật id="${c.id}" tên="${c.name || 'Nhân vật'}" (${c.description || ''}) thành JSON 5 trường: id, name, ageGroup, gender, face, physique, costume, voice, distinguishingMarks.`,
          },
          { inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.buffer.toString('base64') } },
        ];
        const singleResp = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: { parts: singleParts },
          config: {
            httpOptions: { timeout: 18_000 },
            responseMimeType: 'application/json',
          },
        });
        const one = parseAiBlueprintJsonSafe((singleResp.text || '{}').trim());
        if (one?.face || one?.costume) {
          parsedMap.set(c.id, one);
        }
      } catch {
        // Fallback below guarantees non-empty distinct profile
      }
    }
  }

  const validAgeGroups = new Set<Exclude<CharacterAgeGroup, 'auto'>>([
    'child',
    'youth',
    'adult_male',
    'adult_female',
    'middle_aged',
    'elderly',
  ]);

  const profiles: AnalyzedCharacterProfileResult[] = list.map((c) => {
    const raw = parsedMap.get(c.id);
    const fb = buildFallbackFivePartProfile(c);
    const syncProfile: CharacterFivePartProfile = {
      face: String(raw?.face || '').trim() || fb.face,
      physique: String(raw?.physique || '').trim() || fb.physique,
      costume: String(raw?.costume || '').trim() || fb.costume,
      voice: String(raw?.voice || '').trim() || fb.voice,
      distinguishingMarks: String(raw?.distinguishingMarks || '').trim() || fb.distinguishingMarks,
    };
    const rawAge = String(raw?.ageGroup || '').trim() as Exclude<CharacterAgeGroup, 'auto'>;
    const rawGender = String(raw?.gender || '').trim().toLowerCase();
    const suggestedAgeGroup = validAgeGroups.has(rawAge) ? rawAge : undefined;
    const suggestedGender = rawGender === 'female' ? 'female' : rawGender === 'male' ? 'male' : undefined;
    const suggestedDescription = [
      `Mặt: ${syncProfile.face}`,
      `Dáng: ${syncProfile.physique}`,
      `Trang phục: ${syncProfile.costume}`,
      `Nhận dạng: ${syncProfile.distinguishingMarks}`,
    ].join(' | ');
    return {
      id: c.id,
      name: String(c.name || raw?.name || '').trim() || 'Nhân vật',
      syncProfile,
      suggestedDescription,
      suggestedAgeGroup,
      suggestedGender,
    };
  });

  return { profiles, usedModel };
}

export async function generateSceneVideoWithOmniFlash(params: {
  prompt: string;
  aspectRatio: DerivativeAspectRatio;
  durationSec?: number;
  engine?: 'gemini' | 'muse2api' | 'qwen';
  videoStyle?: StudioVideoStyle;
  customStylePrompt?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  sceneIndex?: number;
  totalScenes?: number;
  sceneTitle?: string;
  settingDetail?: string;
  cameraMovement?: string;
  cameraEquipment?: string;
  charactersInScene?: string;
  actionDetail?: string;
  dialogue?: string;
  narration?: string;
  videoTimeline?: string;
  enableVoiceover?: boolean;
  sceneSummary?: string;
  costume?: string;
  cameraAngle?: string;
  vfxNotes?: string;
  selectedCharacterIds?: string[];
  sceneImageDataUrl?: string;
  characterRefs?: StudioCharacterRefInput[];
  museAccountId?: string;
  geminiApiKey?: string;
  allowFreeCostumeChange?: boolean;
  strictSingleFrameLock?: boolean;
  musicMode?: DerivativeMusicMode;
  musicStyle?: string;
  musicPrompt?: string;
  musicVolume?: number; // 0..0.9 (max 90%) or 0..90
  musicInstrumentalOnly?: boolean;
  musicDirective?: string;
}): Promise<{ assetId: string; previewUrl: string; durationSec: number; hasAudio: boolean; model: string }> {
  const allowFreeCostumeChange = params.allowFreeCostumeChange === true;
  const clampedDur = Math.max(3, Math.min(15, Math.round(params.durationSec || 8)));
  const styleMeta = resolveVideoStyleMeta(params.videoStyle, params.customStylePrompt);
  const hasSceneKeyframe = Boolean(params.sceneImageDataUrl);
  const strictSingleFrameLock = Boolean(hasSceneKeyframe && params.strictSingleFrameLock);

  const { selectedRefs: rawSelectedRefs, mappingDirective } = await selectAndMapCharacterRefsForScene({
    characterRefs: params.characterRefs,
    selectedCharacterIds: params.selectedCharacterIds,
    prompt: params.prompt,
    charactersInScene: params.charactersInScene,
    actionDetail: params.actionDetail,
    dialogue: params.dialogue,
    sceneSummary: params.sceneSummary,
    costume: params.costume,
    hasSceneKeyframe,
  });

  // When a verified scene keyframe exists:
  // - strictSingleFrameLock attaches ONLY the scene keyframe (pure I2V — zero portrait background hijack)
  // - standard mode attaches at most 2 scene-matched character identity anchors after Image #1
  const attachedCharRefs = strictSingleFrameLock
    ? []
    : rawSelectedRefs.slice(0, hasSceneKeyframe ? 2 : 3);

  const effectiveTimeline =
    (params.videoTimeline || '').trim() ||
    buildSceneTimelineFallback({
      durationSec: clampedDur,
      cameraAngle: params.cameraAngle,
      cameraMovement: params.cameraMovement,
      settingDetail: params.settingDetail,
      charactersInScene: params.charactersInScene,
      actionDetail: params.actionDetail,
      sceneSummary: params.sceneSummary,
      dialogue: params.dialogue,
    });

  const lockPhrase = allowFreeCostumeChange
    ? 'keep the EXACT same person(s), face, facial structure, age, ethnicity, hair, and physique identical (never swap to a stranger)'
    : 'keep the EXACT same person(s), face, facial structure, age, ethnicity, hair, physique, AND exact main outfit identical (never swap to a stranger or change main clothing)';

  // CRITICAL: Put FIRST-FRAME LOCK + IMAGE ROLE MAP at CHARACTER 0 so Muse2API (1440-char cap) and Omni Flash NEVER truncate or bury the identity lock!
  const firstFrameLockLead = hasSceneKeyframe
    ? strictSingleFrameLock
      ? `FIRST-FRAME LOCK (STRICT PURE IMAGE-TO-VIDEO): Image #1 is the EXACT starting frame (t=0.0s). Animate DIRECTLY from Image #1 with natural continuous motion, ${lockPhrase}. Preserve the EXACT face, hairstyle, clothing, lighting, camera framing, and environment already shown in Image #1 — DO NOT invent or substitute a different actor, DO NOT cut away to a new face.`
      : `FIRST-FRAME LOCK (CRITICAL): Image #1 is the EXACT starting frame (t=0.0s). Animate DIRECTLY from Image #1 with seamless continuous motion, ${lockPhrase}. Preserve the exact subject face, hair, outfit, lighting, and setting from Image #1 — NEVER replace the character with a stranger, NEVER redesign face/clothes, NEVER cut to a studio portrait. ${mappingDirective}`
    : `CHARACTER IDENTITY LOCK (CRITICAL): ${lockPhrase}. ${mappingDirective}`;

  const resolvedMusicDirective =
    String(params.musicDirective || '').trim() ||
    buildVideoMusicPromptDirective({
      musicMode: params.musicMode,
      musicStyle: params.musicStyle,
      musicPrompt: params.musicPrompt,
      musicVolume: params.musicVolume,
      instrumentalOnly: params.musicInstrumentalOnly,
    });

  const priorityLeadLines = [
    firstFrameLockLead,
    params.sceneIndex
      ? `Scene ${String(params.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}${params.sceneTitle?.trim() ? ` - ${params.sceneTitle.trim()}` : ''}.`
      : '',
    params.actionDetail?.trim() ? `Action: ${params.actionDetail.trim()}.` : '',
    `Timeline (${clampedDur}s): ${effectiveTimeline.replace(/\n+/g, ' | ')}.`,
    params.dialogue?.trim()
      ? `Direct Spoken Dialogue & Lip-Sync (the visible character from Image #1 opens mouth and speaks aloud with synchronized lips and natural voice): ${params.dialogue.trim()}.`
      : '',
    resolvedMusicDirective,
    [params.cameraAngle?.trim(), params.cameraMovement?.trim(), params.cameraEquipment?.trim()]
      .filter(Boolean)
      .join(' · ')
      ? `Camera: ${[params.cameraAngle?.trim(), params.cameraMovement?.trim(), params.cameraEquipment?.trim()].filter(Boolean).join(' · ')}.`
      : '',
    params.settingDetail?.trim() ? `Setting: ${params.settingDetail.trim()}.` : '',
    `Visual Style: ${styleMeta.promptDirective}.`,
    params.enableVoiceover !== false && params.narration?.trim()
      ? `Separate Narrator Voiceover Context: ${params.narration.trim()}.`
      : '',
    params.sceneSummary?.trim() ? `Scene Plot: ${params.sceneSummary.trim()}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const trailingBibles = [
    styleMeta.learnedStyle?.cameraAndComposition
      ? `Learned Camera & Motion Style: ${styleMeta.learnedStyle.cameraAndComposition}.`
      : '',
    params.visualStyleBible?.trim() ? `Visual Style Reference: ${params.visualStyleBible.trim()}.` : '',
    params.characterBible?.trim() ? `Character Reference: ${params.characterBible.trim()}.` : '',
    params.costumeBible?.trim()
      ? allowFreeCostumeChange
        ? `Costume Guidance: ${params.costumeBible.trim()}.`
        : `STRICT COSTUME LOCK: ${params.costumeBible.trim()}.`
      : '',
    params.settingBible?.trim() ? `Environment Reference: ${params.settingBible.trim()}.` : '',
    params.continuityBible?.trim() ? `Story Continuity: ${params.continuityBible.trim()}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const baseVideoPrompt = hasSceneKeyframe
    ? `${priorityLeadLines} Motion details: ${params.prompt}. ${trailingBibles} Smooth real-time physics, consistent face from start to end, strictly NO on-screen text, NO subtitles, NO captions, NO overlaid titles or watermarks.`
    : `${priorityLeadLines} High-definition cohesive video scene with continuous real-time action: ${params.prompt}. ${trailingBibles} Cohesive lighting, strictly NO on-screen text, NO subtitles, NO captions, NO overlaid titles or watermarks.`;

  const styledVideoPrompt =
    params.videoStyle === 'cinematic_filmmaking'
      ? enhancePromptWithCinematicSkill({
          basePrompt: baseVideoPrompt,
          mediaType: 'video',
          sceneIndex: params.sceneIndex,
          totalScenes: params.totalScenes,
        })
      : baseVideoPrompt;
  const promptText = compileProductionModelPrompt({
    rawCompiledPrompt: styledVideoPrompt,
    mode: 'scene',
    mediaType: 'video',
    hasAttachedRefs: Boolean(hasSceneKeyframe || attachedCharRefs.length > 0),
    cameraAngle: params.cameraAngle,
    vfxNotes: params.vfxNotes,
    targetEngine: params.engine === 'muse2api' ? 'muse2api' : 'gemini',
    characterBible: params.characterBible,
    costumeBible: params.costumeBible,
    allowFreeCostumeChange,
  }).prompt;

  if (params.engine === 'muse2api') {
    // CRITICAL FOR MUSE2API (muse-video / Seedance):
    // When a verified scene keyframe exists, passing ONLY the scene keyframe (or strictly Image #1 first) avoids portrait-jump & stranger morphing.
    // Specifically: if strictSingleFrameLock is ON, pass ONLY [sceneImageDataUrl]; otherwise pass [sceneImageDataUrl, ...attachedCharRefs.slice(0, 1)] so single-character scenes stay locked to Image #1.
    const museCharExtraRefs = strictSingleFrameLock
      ? []
      : hasSceneKeyframe
      ? attachedCharRefs.slice(0, 1).map((r) => r.dataUrl)
      : attachedCharRefs.map((r) => r.dataUrl);
    const museRefList = Array.from(
      new Set([
        ...(params.sceneImageDataUrl ? [params.sceneImageDataUrl] : []),
        ...museCharExtraRefs,
      ])
    );
    const { buffer, mimeType, ext } = await generateVideoBufferViaMuse2Api({
      prompt: promptText,
      aspectRatio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
      durationSec: Math.min(12, clampedDur),
      referenceImageDataUrl: museRefList[0],
      referenceImages: museRefList,
      accountId: params.museAccountId,
    });

    const assetId = `musevid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const outPath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
    fs.writeFileSync(outPath, buffer);
    const [probedDur, hasAudio] = await Promise.all([
      probeDurationSeconds(outPath, STUDIO_ASSETS_DIR),
      probeHasAudioStream(outPath, STUDIO_ASSETS_DIR),
    ]);
    const finalDur = probedDur || Math.min(12, clampedDur);

    studioAssets.set(assetId, {
      assetId,
      filePath: outPath,
      fileName: `${assetId}${ext}`,
      mimeType,
      durationSec: finalDur,
      createdAt: Date.now(),
    });

    return {
      assetId,
      previewUrl: `/api/studio/assets/${assetId}`,
      durationSec: Math.round(finalDur * 10) / 10,
      hasAudio,
      model: 'muse-video (Muse2API)',
    };
  }

  if (params.engine === 'qwen') {
    const qwenDur = Math.min(10, clampedDur);
    const firstFrameDataUrl = params.sceneImageDataUrl || attachedCharRefs[0]?.dataUrl;
    const { buffer, mimeType, ext, model: qwenModel } = await generateVideoBufferViaAlibabaQwen({
      prompt: promptText,
      aspectRatio: params.aspectRatio,
      durationSec: qwenDur,
      firstFrameDataUrl,
    });

    const assetId = `qwenvid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const outPath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
    fs.writeFileSync(outPath, buffer);
    const [probedDur, hasAudio] = await Promise.all([
      probeDurationSeconds(outPath, STUDIO_ASSETS_DIR),
      probeHasAudioStream(outPath, STUDIO_ASSETS_DIR),
    ]);
    const finalDur = probedDur || qwenDur;

    studioAssets.set(assetId, {
      assetId,
      filePath: outPath,
      fileName: `${assetId}${ext}`,
      mimeType,
      durationSec: finalDur,
      createdAt: Date.now(),
    });

    return {
      assetId,
      previewUrl: `/api/studio/assets/${assetId}`,
      durationSec: Math.round(finalDur * 10) / 10,
      hasAudio,
      model: `${qwenModel} (Alibaba Qwen)`,
    };
  }

  // gemini-omni-1.2-flash requires v1beta under @google/genai 3.x (whose default apiVersion is v1)
  const ai = getGeminiBetaClient(params.geminiApiKey);
  const inputParts: any[] = [];

  // Interleave explicit text labels BEFORE each image so Gemini Omni Flash NEVER treats Image #2 as an ending frame or blends/swaps faces!
  if (params.sceneImageDataUrl) {
    const parsed = parseDataUrlToBuffer(params.sceneImageDataUrl);
    if (parsed) {
      inputParts.push({
        type: 'text',
        text: '[IMAGE #1 — MANDATORY EXACT STARTING FRAME (t=0.0s)]: Begin the video verbatim from this exact keyframe image. Keep the exact person(s), face, hair, clothing, lighting, and setting from IMAGE #1 throughout the clip — animate natural movement and dialogue directly from IMAGE #1 without replacing the actor.',
      });
      inputParts.push({
        type: 'image',
        mime_type: parsed.mimeType,
        data: parsed.buffer.toString('base64'),
      });
    }
  }
  for (let i = 0; i < attachedCharRefs.length; i++) {
    const ref = attachedCharRefs[i];
    const parsed = parseDataUrlToBuffer(ref.dataUrl);
    if (parsed) {
      const imgIdx = (hasSceneKeyframe ? 2 : 1) + i;
      const charName = (ref.name || `Character ${i + 1}`).trim();
      inputParts.push({
        type: 'text',
        text: hasSceneKeyframe
          ? `[IMAGE #${imgIdx} — CHARACTER IDENTITY ANCHOR ONLY for "${charName}" (NOT AN ENDING FRAME — DO NOT CUT TO THIS BACKGROUND)]: Use ONLY to keep "${charName}"'s face, hairstyle, and outfit 100% consistent while animating IMAGE #1.`
          : `[IMAGE #${imgIdx} — CHARACTER REFERENCE for "${charName}"]: Reproduce "${charName}"'s exact face, hairstyle, physique, and outfit in the scene.`,
      });
      inputParts.push({
        type: 'image',
        mime_type: parsed.mimeType,
        data: parsed.buffer.toString('base64'),
      });
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
      const effectiveKey = (
        params.geminiApiKey ||
        resolveChairmanGeminiAccount()?.apiKey ||
        process.env.GEMINI_API_KEY ||
        ''
      ).trim();
      const dl = await fetch(videoPart.uri, {
        headers: { 'x-goog-api-key': effectiveKey },
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
    const [probedDur, hasAudio] = await Promise.all([
      probeDurationSeconds(outPath, STUDIO_ASSETS_DIR),
      probeHasAudioStream(outPath, STUDIO_ASSETS_DIR),
    ]);
    const finalDur = probedDur || clampedDur;

    studioAssets.set(assetId, {
      assetId,
      filePath: outPath,
      fileName: `${assetId}.mp4`,
      mimeType: 'video/mp4',
      durationSec: finalDur,
      createdAt: Date.now(),
    });

    return {
      assetId,
      previewUrl: `/api/studio/assets/${assetId}`,
      durationSec: Math.round(finalDur * 10) / 10,
      hasAudio,
      model: 'gemini-omni-1.2-flash',
    };
  } catch (err: any) {
    throw new Error(formatGeminiError(err));
  }
}

export const AI_MUSIC_STYLE_DIRECTIVES: Record<
  string,
  { labelVi: string; promptEn: string; wikimediaQueries: string[] }
> = {
  auto_context: {
    labelVi: 'AI tự chọn theo kịch bản',
    promptEn: 'Adaptive modern background soundtrack tailored smoothly to the story mood and pacing',
    wikimediaQueries: ['cinematic instrumental piano', 'ambient acoustic guitar'],
  },
  country: {
    labelVi: 'Nhạc đồng quê (Country / Acoustic)',
    promptEn:
      'Warm acoustic country folk background music with fingerpicked steel-string guitar, gentle banjo, subtle harmonica, light brushed drums, warm sunlit countryside atmosphere',
    wikimediaQueries: ['country acoustic guitar instrumental', 'folk banjo guitar'],
  },
  remix: {
    labelVi: 'Nhạc Remix / EDM sôi động',
    promptEn:
      'High-energy modern EDM remix background track with punchy bassline, bright synth leads, rhythmic house beat, crisp drops and energetic club groove',
    wikimediaQueries: ['electronic dance house instrumental', 'upbeat synth beat'],
  },
  chamber: {
    labelVi: 'Nhạc thính phòng (Chamber / Cổ điển)',
    promptEn:
      'Elegant classical chamber music ensemble with expressive violin, warm cello, viola harmonies and grand piano in refined concert hall acoustics',
    wikimediaQueries: ['chamber music string quartet', 'classical violin cello piano'],
  },
  kids_fun: {
    labelVi: 'Nhạc thiếu nhi vui nhộn',
    promptEn:
      'Playful cheerful kids cartoon background music with bouncy ukulele, bright marimba, xylophone melody, glockenspiel bells, happy claps, joyful upbeat tempo',
    wikimediaQueries: ['cheerful playful ukulele marimba', 'happy upbeat cartoon music'],
  },
  cinematic: {
    labelVi: 'Điện ảnh hùng tráng (Cinematic)',
    promptEn:
      'Epic emotional cinematic orchestral film score with sweeping strings, warm brass swells, piano motif and inspiring dramatic percussion',
    wikimediaQueries: ['cinematic orchestral soundtrack', 'epic symphony strings'],
  },
  lofi_chill: {
    labelVi: 'Lo-fi Chill / Thư giãn',
    promptEn:
      'Cozy lo-fi chillhop background beat with warm Rhodes electric piano chords, mellow jazz guitar, soft dusty drums and relaxing groove',
    wikimediaQueries: ['chill jazz piano instrumental', 'ambient lo-fi mellow'],
  },
  viet_folk: {
    labelVi: 'Dân ca / Nhạc cụ dân tộc Việt',
    promptEn:
      'Traditional Vietnamese folk instrumental music featuring bamboo flute sao truc, delicate dan tranh zither, warm dan bau and gentle wooden percussion, poetic serene melody',
    wikimediaQueries: ['asian bamboo flute instrumental', 'traditional zither folk'],
  },
  bolero_romantic: {
    labelVi: 'Trữ tình / Acoustic lãng mạn',
    promptEn:
      'Tender romantic acoustic ballad background music with warm nylon-string guitar, gentle piano arpeggios, soft sustained strings and nostalgic emotional flow',
    wikimediaQueries: ['romantic acoustic guitar ballad', 'emotional solo piano'],
  },
  pop_upbeat: {
    labelVi: 'Pop trẻ trung / Năng động',
    promptEn:
      'Bright upbeat modern pop instrumental background music with clean funky electric guitar, catchy synth pluck melody and tight energetic drums',
    wikimediaQueries: ['upbeat pop instrumental guitar', 'modern bright background'],
  },
  suspense_mystery: {
    labelVi: 'Kịch tính / Trinh thám hồi hộp',
    promptEn:
      'Suspenseful cinematic mystery thriller underscore with low pulsing cello ostinato, subtle ticking percussion and dark atmospheric tension pads',
    wikimediaQueries: ['suspense dark cello mystery', 'dramatic thriller underscore'],
  },
};

export function buildAiMusicPrompt(params: {
  styleId?: string;
  prompt?: string;
  instrumentalOnly?: boolean;
  contextTitle?: string;
}): { finalPrompt: string; styleLabelVi: string } {
  const styleKey = String(params.styleId || '').trim();
  const preset = styleKey && styleKey !== 'custom' ? AI_MUSIC_STYLE_DIRECTIVES[styleKey] : undefined;
  const userPrompt = String(params.prompt || '').trim();
  const parts: string[] = [];

  if (preset) {
    parts.push(`Music Style & Arrangement: ${preset.promptEn}.`);
  }
  if (userPrompt) {
    parts.push(`Additional Creative Direction: ${userPrompt}.`);
  }
  if (!preset && !userPrompt) {
    parts.push(
      `Generate an uplifting modern cinematic background music track suitable for video storytelling${
        params.contextTitle ? ` titled "${params.contextTitle}"` : ''
      }.`
    );
  }
  if (params.instrumentalOnly !== false) {
    parts.push('Strictly instrumental background music only, NO vocals, NO singing, NO spoken words, clean smooth mix suitable under video narration.');
  }

  return {
    finalPrompt: parts.join(' '),
    styleLabelVi: preset?.labelVi || (userPrompt ? 'Phong cách tùy chỉnh' : 'AI sáng tạo'),
  };
}

export function buildVideoMusicPromptDirective(params: {
  musicMode?: string;
  musicStyle?: string;
  musicPrompt?: string;
  musicVolume?: number; // accepts 0..0.9 or 0..90
  instrumentalOnly?: boolean;
}): string {
  if (params.musicMode !== 'ai_lyria' && params.musicMode !== 'auto_adaptive') {
    return '';
  }
  const rawVol = Number(params.musicVolume ?? 0.25);
  const volPct = Math.max(0, Math.min(90, Math.round(rawVol <= 1 ? rawVol * 100 : rawVol)));
  if (volPct <= 0) return '';

  const styleKey = String(params.musicStyle || '').trim();
  const preset = styleKey && styleKey !== 'custom' ? AI_MUSIC_STYLE_DIRECTIVES[styleKey] : undefined;
  const userNote = String(params.musicPrompt || '').trim();
  const parts: string[] = [];

  if (preset) {
    parts.push(`${preset.labelVi} (${preset.promptEn})`);
  }
  if (userNote) {
    parts.push(userNote);
  }
  if (parts.length === 0) {
    parts.push('Natural background music matching the scene mood and pacing');
  }

  const vocalRule =
    params.instrumentalOnly !== false
      ? 'Strictly instrumental background music only (NO vocals, NO singing, NO lyrics).'
      : 'Musical arrangement may blend freely with the chosen style.';

  return `Background Music (Generate directly in native video audio): ${parts.join(' · ')}. ${vocalRule} Background music volume level: ${volPct}% balanced smoothly with scene dialogue and ambient audio.`;
}

export async function generateStudioMusicWithLyria(params: {
  prompt: string;
  mode?: 'clip' | 'pro';
  styleId?: string;
  instrumentalOnly?: boolean;
}): Promise<{ assetId: string; previewUrl: string; mimeType: string; lyrics: string; durationSec: number; model: string; styleLabel?: string }> {
  const ai = getGeminiBetaClient();
  const musicModels =
    params.mode === 'pro' ? ['lyria-3-pro-preview', 'lyria-3-clip-preview'] : ['lyria-3-clip-preview'];
  const { finalPrompt: musicPrompt, styleLabelVi } = buildAiMusicPrompt({
    styleId: params.styleId,
    prompt: params.prompt,
    instrumentalOnly: params.instrumentalOnly,
  });

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
        styleLabel: styleLabelVi,
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

export async function probeDurationSeconds(filePath: string, cwd: string): Promise<number> {
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

export async function probeHasAudioStream(filePath: string, cwd: string): Promise<boolean> {
  try {
    const res = await spawnPromise(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath],
      cwd,
      12_000
    );
    return res.stdout.trim().includes('audio');
  } catch {
    return false;
  }
}

type ConcreteAgeGroup = Exclude<CharacterAgeGroup, 'auto'>;

const AGE_GROUP_VOICE_CAST_POOLS: Record<
  ConcreteAgeGroup,
  {
    labelVi: string;
    defaultGender: 'male' | 'female';
    voices: Exclude<DerivativeVoiceId, 'none'>[];
    pitchDirective: string;
  }
> = {
  child: {
    labelVi: 'Trẻ em',
    defaultGender: 'female',
    voices: ['Leda', 'Laomedeia', 'Zephyr', 'Puck'],
    pitchDirective:
      'VOCAL AGE & PITCH (Trẻ em): Young child voice with high, bright, clear, innocent pitch and lively natural childlike cadence.',
  },
  youth: {
    labelVi: 'Thanh niên',
    defaultGender: 'female',
    voices: ['Zephyr', 'Sadachbia', 'Autonoe', 'Puck', 'Fenrir', 'Kore'],
    pitchDirective:
      'VOCAL AGE & PITCH (Thanh niên): Youthful young-adult voice, fresh, energetic, agile and natural modern cadence.',
  },
  adult_male: {
    labelVi: 'Đàn ông',
    defaultGender: 'male',
    voices: ['Orus', 'Iapetus', 'Schedar', 'Achird', 'Alnilam', 'Algieba'],
    pitchDirective:
      'VOCAL AGE & PITCH (Đàn ông): Adult male voice with natural balanced mid-low resonance, clear steady male timbre fitting an adult man.',
  },
  adult_female: {
    labelVi: 'Đàn bà',
    defaultGender: 'female',
    voices: ['Kore', 'Aoede', 'Erinome', 'Despina', 'Pulcherrima', 'Sulafat'],
    pitchDirective:
      'VOCAL AGE & PITCH (Đàn bà): Adult female voice with warm, clear, expressive feminine pitch fitting an adult woman.',
  },
  middle_aged: {
    labelVi: 'Người trung niên',
    defaultGender: 'male',
    voices: ['Charon', 'Rasalgethi', 'Sadaltager', 'Gacrux', 'Umbriel', 'Sulafat'],
    pitchDirective:
      'VOCAL AGE & PITCH (Người trung niên): Mature middle-aged voice with composed, calm, grounded lower-mid timbre and poise.',
  },
  elderly: {
    labelVi: 'Người già',
    defaultGender: 'male',
    voices: ['Algenib', 'Enceladus', 'Gacrux', 'Vindemiatrix', 'Charon'],
    pitchDirective:
      'VOCAL AGE & PITCH (Người già): Elderly senior voice with deep, weathered mature timbre, unhurried gentle slow cadence fitting an older person.',
  },
};

const GEMINI_FEMALE_VOICES = new Set<string>([
  'Kore', 'Zephyr', 'Aoede', 'Leda', 'Callirrhoe', 'Autonoe', 'Despina',
  'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix',
  'Sadachbia', 'Sulafat',
]);

function classifyCharacterAgeAndGender(params: {
  name: string;
  description?: string;
  explicitAgeGroup?: CharacterAgeGroup;
  explicitGender?: CharacterGenderHint;
  scriptContext?: string;
}): { ageGroup: ConcreteAgeGroup; gender: 'male' | 'female' } {
  const corpus = normalizeCharacterMatchText(
    [params.name, params.description || '', params.scriptContext || ''].join(' ')
  );

  // Detect gender first from hints or Vietnamese pronouns/descriptors
  let gender: 'male' | 'female' =
    params.explicitGender === 'male'
      ? 'male'
      : params.explicitGender === 'female'
      ? 'female'
      : /\b(nu|dan ba|phu nu|co gai|be gai|em gai|chi|me|ba|co|di|mo|thim|vo|nu sinh|thieu nu|woman|female|girl|mother|grandma|lady)\b/.test(
          corpus
        )
      ? 'female'
      : /\b(nam|dan ong|trai|chang trai|be trai|em trai|anh|bo|cha|ong|chu|bac trai|chong|nam sinh|man|male|boy|father|grandpa|gentleman)\b/.test(
          corpus
        )
      ? 'male'
      : 'female';

  if (params.explicitAgeGroup && params.explicitAgeGroup !== 'auto') {
    if (params.explicitAgeGroup === 'adult_male') gender = 'male';
    if (params.explicitAgeGroup === 'adult_female') gender = 'female';
    return { ageGroup: params.explicitAgeGroup, gender };
  }

  // Check explicit numeric age if mentioned near name/description
  const ageMatch = corpus.match(/\b(\d{1,2})\s*(?:tuoi|t|yo|years old)\b/);
  if (ageMatch) {
    const yrs = Number(ageMatch[1]);
    if (yrs > 0 && yrs <= 12) return { ageGroup: 'child', gender };
    if (yrs >= 13 && yrs <= 24) return { ageGroup: 'youth', gender };
    if (yrs >= 25 && yrs <= 44) return { ageGroup: gender === 'male' ? 'adult_male' : 'adult_female', gender };
    if (yrs >= 45 && yrs <= 62) return { ageGroup: 'middle_aged', gender };
    if (yrs >= 63) return { ageGroup: 'elderly', gender };
  }

  if (
    /\b(tre em|be|em be|nhoc|cau be|co be|thieu nhi|hoc sinh tieu hoc|mau giao|child|kid|toddler)\b/.test(corpus)
  ) {
    return { ageGroup: 'child', gender };
  }
  if (
    /\b(cu|ong lao|ba lao|nguoi gia|cu ong|cu ba|lao|cao nien|ong noi|ba noi|ong ngoai|ba ngoai|elderly|senior|old man|old woman|grandpa|grandma)\b/.test(
      corpus
    )
  ) {
    return { ageGroup: 'elderly', gender };
  }
  if (/\b(trung nien|bac|trung tuoi|giam doc lon tuoi|phu huynh|middle aged|middle-aged)\b/.test(corpus)) {
    return { ageGroup: 'middle_aged', gender };
  }
  if (/\b(thanh nien|sinh vien|chang trai|co gai tre|thieu nu|thieu nien|gen z|youth|young adult|teen)\b/.test(corpus)) {
    return { ageGroup: 'youth', gender };
  }
  if (gender === 'male') {
    return { ageGroup: 'adult_male', gender: 'male' };
  }
  return { ageGroup: 'adult_female', gender: 'female' };
}

function buildAdaptiveMusicSearchQueries(blueprint: DerivativeBlueprint): string[] {
  const rawMoods = [
    blueprint.adaptiveMusicPrompt || '',
    ...blueprint.scenes.map((s) => s.musicMoodEn || ''),
  ]
    .map((q) => sanitizeStockQuery(q))
    .filter((q) => q.length >= 3);

  const styleFallbacks: Record<string, string[]> = {
    cinematic: ['cinematic orchestral instrumental', 'emotional film score piano'],
    cinematic_filmmaking: ['dramatic cinema soundtrack instrumental', 'orchestral film strings'],
    documentary: ['documentary ambient acoustic guitar', 'calm minimalist piano'],
    anime: ['upbeat melodic piano instrumental', 'gentle anime acoustic'],
    vlog: ['cheerful acoustic guitar instrumental', 'light upbeat chill background'],
    professional: ['modern corporate ambient instrumental', 'clean electronic minimalist'],
  };

  return Array.from(
    new Set([
      ...rawMoods,
      ...(styleFallbacks[blueprint.videoStyle || 'cinematic'] || styleFallbacks.cinematic),
      'ambient instrumental music',
      'classical piano solo',
    ])
  ).slice(0, 6);
}

export const NORTHERN_VIETNAMESE_ACCENT_DIRECTIVE =
  'MANDATORY ACCENT LOCK: Speak strictly in authentic Northern Vietnamese (Hà Nội / miền Bắc Việt Nam) accent and pronunciation, with crisp Standard Hanoi vowels, clear differentiation of hỏi and ngã tones, natural Northern cadence, and zero Southern or Central dialect inflection.';

const GEMINI_VOICE_IDS_SET = new Set<string>([
  'Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

export function sanitizeGeminiVoiceId(raw?: string): Exclude<DerivativeVoiceId, 'none'> {
  const cleaned = String(raw || '').trim();
  if (cleaned && GEMINI_VOICE_IDS_SET.has(cleaned)) {
    return cleaned as Exclude<DerivativeVoiceId, 'none'>;
  }
  return 'Kore';
}

export function buildNorthernVietnameseTtsStyle(baseStyle?: string, characterName?: string): string {
  const parts = [NORTHERN_VIETNAMESE_ACCENT_DIRECTIVE];
  if (characterName?.trim()) {
    parts.push(`Character speaker identity: ${characterName.trim()}.`);
  }
  const cleanStyle = String(baseStyle || '').trim();
  if (cleanStyle) {
    parts.push(cleanStyle);
  }
  return parts.join(' ');
}

interface TtsCandidateKey {
  accountId?: string;
  label: string;
  apiKey: string;
}

function collectGeminiTtsCandidateKeys(): TtsCandidateKey[] {
  const keys: TtsCandidateKey[] = [];
  const seen = new Set<string>();
  const add = (apiKeyRaw: string | undefined, label: string, accountId?: string) => {
    const apiKey = String(apiKeyRaw || '').trim();
    if (!apiKey || seen.has(apiKey)) return;
    seen.add(apiKey);
    keys.push({ accountId, label, apiKey });
  };

  for (const acc of listHealthyGeminiWorkerAccounts({ includeChairman: true })) {
    add(acc.apiKey, acc.label || acc.id, acc.id);
  }
  const chairman = resolveChairmanGeminiAccount();
  if (chairman?.apiKey) {
    add(chairman.apiKey, chairman.label || 'Gemini Chủ tịch', chairman.id);
  }
  add(process.env.GEMINI_API_KEY, 'ENV GEMINI_API_KEY');
  return keys;
}

export function hasAnyGeminiTtsKey(): boolean {
  return (
    hasAnyEnabledGeminiAccount() ||
    Boolean(resolveChairmanGeminiAccount()?.apiKey?.trim()) ||
    Boolean(process.env.GEMINI_API_KEY?.trim())
  );
}

export async function synthesizeGeminiVoicePreview(params: {
  text: string;
  voice?: string;
  voiceStyle?: string;
  characterName?: string;
}): Promise<Buffer> {
  const cleanText = String(params.text || '').trim().slice(0, 450);
  if (!cleanText) {
    throw new Error('Nội dung đọc thử trống.');
  }
  if (!hasAnyGeminiTtsKey()) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY hoặc tài khoản Gemini Pool để tổng hợp giọng đọc thử Gemini.');
  }
  const voiceId = sanitizeGeminiVoiceId(params.voice);
  const lockedStyle = buildNorthernVietnameseTtsStyle(
    params.voiceStyle || 'Clear, expressive Northern Vietnamese voice',
    params.characterName
  );
  const tmpWav = path.join(os.tmpdir(), `gemini_tts_preview_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.wav`);
  try {
    const result = await synthesizeSceneVoiceWavWithDetail(null, cleanText, voiceId, lockedStyle, tmpWav);
    if (!result.ok || !fs.existsSync(tmpWav)) {
      throw new Error(result.error || `Gemini TTS không trả về âm thanh cho giọng ${voiceId}.`);
    }
    return fs.readFileSync(tmpWav);
  } finally {
    fs.rmSync(tmpWav, { force: true });
  }
}

async function synthesizeSceneVoiceWav(
  ai: GoogleGenAI | null,
  text: string,
  voice: Exclude<DerivativeVoiceId, 'none'>,
  stylePrompt: string,
  outWavPath: string
): Promise<boolean> {
  const res = await synthesizeSceneVoiceWavWithDetail(ai, text, voice, stylePrompt, outWavPath);
  return res.ok;
}

function ensureWavBuffer(rawBuf: Buffer, mimeType?: string): Buffer {
  if (rawBuf.length >= 12 && rawBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
    return rawBuf;
  }
  const rateMatch = String(mimeType || '').match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Math.max(8000, Math.min(48000, Number(rateMatch[1]) || 24000)) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + rawBuf.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(rawBuf.length, 40);
  return Buffer.concat([header, rawBuf]);
}

async function synthesizeSceneVoiceWavWithDetail(
  _ai: GoogleGenAI | null,
  text: string,
  voice: Exclude<DerivativeVoiceId, 'none'>,
  stylePrompt: string,
  outWavPath: string
): Promise<{ ok: boolean; error?: string; engineUsed?: string }> {
  const cleanText = text.trim();
  if (!cleanText) return { ok: false, error: 'Nội dung đọc trống.' };

  const candidateKeys = collectGeminiTtsCandidateKeys();
  if (candidateKeys.length === 0) {
    return {
      ok: false,
      error: 'Chưa cấu hình GEMINI_API_KEY hoặc tài khoản Gemini Pool để tạo giọng đọc AI.',
    };
  }

  const resolvedVoice = sanitizeGeminiVoiceId(voice);
  const lockedStyle = stylePrompt.includes('Northern Vietnamese')
    ? stylePrompt
    : buildNorthernVietnameseTtsStyle(stylePrompt);
  const voicesToTry: Exclude<DerivativeVoiceId, 'none'>[] =
    resolvedVoice === 'Kore' ? ['Kore'] : [resolvedVoice, 'Kore'];
  const generateContentModels = [
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-2.5-flash-preview-tts',
  ];
  const interactionModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

  let lastError = '';

  for (const keyEntry of candidateKeys) {
    const aiBeta = new GoogleGenAI({
      apiKey: keyEntry.apiKey,
      apiVersion: 'v1beta',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    let keyFatal = false;

    // 1. Primary path: unary generateContent (returns complete WAV directly on gemini-3.8-*-tts)
    for (const tryVoice of voicesToTry) {
      if (keyFatal) break;
      for (const betaModel of generateContentModels) {
        try {
          const directivePrompt = betaModel.startsWith('gemini-2.5')
            ? `Read the following text aloud strictly with an authentic Northern Vietnamese (Hà Nội / miền Bắc Việt Nam) accent, standard Hanoi pronunciation and tones, natural cadence (${lockedStyle}):\n"${cleanText}"`
            : cleanText;
          const response = await retryWithGeminiBackoff(
            () =>
              aiBeta.models.generateContent({
                model: betaModel,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      betaModel.startsWith('gemini-3.8')
                        ? ({
                            text: cleanText,
                            speechMetadata: { style: lockedStyle },
                          } as any)
                        : { text: directivePrompt },
                    ],
                  },
                ],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: tryVoice },
                    },
                  },
                },
              }),
            [1000, 2200]
          );
          const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
          const b64 = part?.inlineData?.data;
          if (b64) {
            const wav = ensureWavBuffer(Buffer.from(b64, 'base64'), part?.inlineData?.mimeType);
            if (wav.length > 44) {
              fs.writeFileSync(outWavPath, wav);
              if (keyEntry.accountId) recordGeminiAccountUsage(keyEntry.accountId, true);
              return { ok: true, engineUsed: `Gemini TTS (${betaModel} · ${tryVoice})` };
            }
          }
        } catch (err: any) {
          const msg = String(err?.message || err || '');
          lastError = formatGeminiError(err);
          if (
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('API_KEY_INVALID') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('403') ||
            msg.includes('401') ||
            msg.includes('429')
          ) {
            if (keyEntry.accountId) recordGeminiAccountUsage(keyEntry.accountId, false, { errorMsg: lastError });
            keyFatal = true;
            break;
          }
          if (msg.includes('404') || /not found/i.test(msg)) {
            continue;
          }
          const isVoiceRejection = /voice|speech_config|prebuiltVoiceConfig|invalid/i.test(msg) && msg.includes('400');
          if (isVoiceRejection) {
            break;
          }
        }
      }
    }

    if (keyFatal) continue;

    // 2. Secondary path: Interactions API for gemini-3.8-*-tts
    for (const tryVoice of voicesToTry) {
      if (keyFatal) break;
      for (const ttsModel of interactionModels) {
        try {
          const interaction = await retryWithGeminiBackoff(
            () =>
              aiBeta.interactions.create({
                model: ttsModel,
                input: [
                  {
                    type: 'text',
                    text: cleanText,
                    annotations: [
                      {
                        type: 'speech_metadata',
                        style: lockedStyle,
                      },
                    ],
                  },
                ],
                response_format: { type: 'audio' },
                generation_config: {
                  speech_config: [{ voice: tryVoice }],
                },
              }),
            [1000, 2200]
          );

          const audio = interaction.output_audio;
          if (audio?.data) {
            const wav = ensureWavBuffer(Buffer.from(audio.data, 'base64'), audio.mime_type);
            if (wav.length > 44) {
              fs.writeFileSync(outWavPath, wav);
              if (keyEntry.accountId) recordGeminiAccountUsage(keyEntry.accountId, true);
              return { ok: true, engineUsed: `Gemini TTS (${ttsModel} · ${tryVoice})` };
            }
          }
        } catch (err: any) {
          const msg = String(err?.message || err || '');
          lastError = formatGeminiError(err);
          if (
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('API_KEY_INVALID') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('403') ||
            msg.includes('401') ||
            msg.includes('429')
          ) {
            if (keyEntry.accountId) recordGeminiAccountUsage(keyEntry.accountId, false, { errorMsg: lastError });
            keyFatal = true;
            break;
          }
          if (msg.includes('404') || /not found/i.test(msg)) {
            continue;
          }
          const isVoiceRejection = /voice|speech_config|invalid/i.test(msg) && msg.includes('400');
          if (isVoiceRejection) {
            break;
          }
          if (!isTransientGemini503Error(err)) {
            break;
          }
        }
      }
    }
  }

  return { ok: false, error: lastError || 'Không thể tổng hợp giọng đọc Gemini TTS.' };
}

export async function synthesizeNarrationAudioForText(params: {
  text: string;
  outWavPath: string;
  mode?: 'ai_online' | 'offline_system';
  voice?: DerivativeVoiceId | string;
  voiceStyle?: string;
  offlineVoice?: string;
  characterName?: string;
}): Promise<{ ok: boolean; engineUsed?: string; error?: string; fellBackTo?: 'ai_online' | 'offline_system' }> {
  const cleanText = String(params.text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    return { ok: false, error: 'Nội dung lời thoại trống.' };
  }
  const mode: 'ai_online' | 'offline_system' = params.mode === 'offline_system' ? 'offline_system' : 'ai_online';
  const voiceId = sanitizeGeminiVoiceId(params.voice === 'none' ? 'Kore' : params.voice);
  const lockedStyle = buildNorthernVietnameseTtsStyle(
    params.voiceStyle || 'Clear, engaging Northern Vietnamese storyteller narrator with natural pacing',
    params.characterName
  );
  const offlineEngine = await detectOfflineTtsEngine();
  const hasOnline = hasAnyGeminiTtsKey();
  const errors: string[] = [];

  if (mode === 'offline_system') {
    if (offlineEngine.available) {
      try {
        const ok = await synthesizeOfflineVoiceWav(cleanText, params.outWavPath, params.offlineVoice || voiceId);
        if (ok && fs.existsSync(params.outWavPath) && fs.statSync(params.outWavPath).size > 44) {
          return { ok: true, engineUsed: offlineEngine.engine || 'Offline TTS' };
        }
      } catch (err: any) {
        errors.push(`Offline TTS: ${err?.message || String(err)}`);
      }
    } else {
      errors.push('Offline TTS (VieNeu-TTS) chưa cài đặt trên máy chủ.');
    }

    if (hasOnline) {
      const onlineRes = await synthesizeSceneVoiceWavWithDetail(null, cleanText, voiceId, lockedStyle, params.outWavPath);
      if (onlineRes.ok && fs.existsSync(params.outWavPath) && fs.statSync(params.outWavPath).size > 44) {
        return {
          ok: true,
          engineUsed: onlineRes.engineUsed || 'Gemini AI TTS',
          fellBackTo: 'ai_online',
        };
      }
      if (onlineRes.error) errors.push(`Gemini TTS: ${onlineRes.error}`);
    }
    return { ok: false, error: errors.join(' | ') || 'Không thể tổng hợp giọng đọc.' };
  }

  // mode === 'ai_online'
  if (hasOnline) {
    const onlineRes = await synthesizeSceneVoiceWavWithDetail(null, cleanText, voiceId, lockedStyle, params.outWavPath);
    if (onlineRes.ok && fs.existsSync(params.outWavPath) && fs.statSync(params.outWavPath).size > 44) {
      return { ok: true, engineUsed: onlineRes.engineUsed || 'Gemini AI TTS' };
    }
    if (onlineRes.error) errors.push(`Gemini TTS: ${onlineRes.error}`);
  } else {
    errors.push('Chưa cấu hình GEMINI_API_KEY hoặc tài khoản Gemini Pool.');
  }

  if (offlineEngine.available) {
    try {
      const ok = await synthesizeOfflineVoiceWav(cleanText, params.outWavPath, params.offlineVoice || voiceId);
      if (ok && fs.existsSync(params.outWavPath) && fs.statSync(params.outWavPath).size > 44) {
        return {
          ok: true,
          engineUsed: offlineEngine.engine || 'Offline TTS',
          fellBackTo: 'offline_system',
        };
      }
    } catch (err: any) {
      errors.push(`Offline TTS: ${err?.message || String(err)}`);
    }
  }

  return { ok: false, error: errors.join(' | ') || 'Không thể tổng hợp giọng đọc.' };
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
  musicStyle?: string;
  musicInstrumentalOnly?: boolean;
  musicAssetId?: string;
  publicMusicUrl?: string;
  musicPrompt?: string;
  musicVolume?: number;
  characterRefs?: StudioCharacterRefInput[];
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

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} quá thời gian chờ (${Math.round(timeoutMs / 1000)}s).`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveDefaultImageEngineForVisualMode(
  visualMode: DerivativeVisualMode
): 'gemini' | 'muse2api' | 'qwen' {
  if (visualMode === 'muse2api_video') return 'muse2api';
  if (visualMode === 'qwen_video') return 'qwen';
  return 'gemini';
}

function saveSceneImageToWorkDir(workDir: string, sceneIdx: number, dataUrl: string): string | null {
  const parsedImg = parseDataUrlToBuffer(dataUrl);
  if (!parsedImg) return null;
  const ext = parsedImg.mimeType.includes('png')
    ? 'png'
    : parsedImg.mimeType.includes('webp')
    ? 'webp'
    : 'jpg';
  for (const oldExt of ['png', 'jpg', 'jpeg', 'webp']) {
    if (oldExt !== ext) {
      const oldPath = path.join(workDir, `scene_img_${sceneIdx}.${oldExt}`);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // ignore
        }
      }
    }
  }
  const imgPath = path.join(workDir, `scene_img_${sceneIdx}.${ext}`);
  fs.writeFileSync(imgPath, parsedImg.buffer);
  return imgPath;
}

export function getDerivativeJobSceneImagePath(jobId: string, sceneIdx: number): string | null {
  if (!jobId || !Number.isInteger(sceneIdx) || sceneIdx < 0 || sceneIdx >= 48) return null;
  const job = derivativeJobs.get(jobId);
  if (!job || !job.workDir) return null;
  const baseDir = path.resolve(job.workDir);
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const candidate = path.resolve(baseDir, `scene_img_${sceneIdx}.${ext}`);
    if (candidate.startsWith(baseDir + path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getDerivativeJobPublicView(job: DerivativeJobRecord) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    stepLabel: job.stepLabel,
    visualMode: job.visualMode,
    scenes: job.scenes,
    fileName: job.fileName,
    fileSize: job.fileSize,
    durationSec: job.durationSec,
    resolution: job.resolution,
    error: job.error,
    warnings: job.warnings,
  };
}

function initSceneProgressList(
  jobId: string,
  scenes: DerivativeScene[],
  visualMode: DerivativeVisualMode,
  workDir: string
): DerivativeSceneProgress[] {
  const now = Date.now();
  return scenes.map((sc, i) => {
    let hasStep2Img = false;
    if (sc.sceneImageDataUrl) {
      const saved = saveSceneImageToWorkDir(workDir, i, sc.sceneImageDataUrl);
      hasStep2Img = Boolean(saved);
    }
    const existingVideoAsset = sc.omniClipAssetId ? getStudioAsset(sc.omniClipAssetId) : undefined;
    const hasExistingVideo = Boolean(existingVideoAsset && fs.existsSync(existingVideoAsset.filePath));

    let progress = 5;
    let stageLabel = 'Chờ khởi tạo tiến trình...';
    if (hasExistingVideo) {
      progress = 70;
      stageLabel = 'Đã có video sẵn — chờ dựng & ghép MP4';
    } else if (hasStep2Img) {
      progress = 25;
      stageLabel =
        visualMode === 'storyboard_motion'
          ? 'Đã có ảnh Bước 2 — chờ dựng chuyển động MP4'
          : 'Đã có ảnh từ Bước 2 — chuyển thẳng sang tạo video';
    } else if (visualMode === 'storyboard_motion') {
      stageLabel = 'Chờ tạo ảnh phân cảnh';
    } else if (visualMode === 'gemini_omni' || visualMode === 'muse2api_video' || visualMode === 'qwen_video') {
      stageLabel = 'Chờ tạo video phân cảnh';
    } else {
      stageLabel = 'Chờ trích xuất tư liệu nguồn';
    }

    return {
      sceneIndex: i,
      sceneNumber: sc.sceneIndex || i + 1,
      sceneTitle: sc.sceneTitle || `Phân cảnh #${i + 1}`,
      progress,
      status: 'pending',
      stageLabel,
      imageStatus: hasStep2Img ? 'reused' : 'pending',
      imageSource: hasStep2Img ? 'step2_reused' : 'none',
      imagePreviewUrl: hasStep2Img ? `/api/derivative/jobs/${jobId}/scene-image/${i}?t=${now}` : undefined,
      videoStatus: hasExistingVideo ? 'reused' : 'pending',
      videoAssetId: hasExistingVideo ? sc.omniClipAssetId : undefined,
      videoPreviewUrl: hasExistingVideo ? `/api/studio/assets/${sc.omniClipAssetId}` : undefined,
      audioStatus: 'pending',
      renderStatus: 'pending',
      updatedAt: now,
    };
  });
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

  // Keep an isolated mutable copy of scenes so per-scene retries & resumes persist cleanly
  const clonedScenes = params.blueprint.scenes.slice(0, 24).map((sc) => ({ ...sc }));
  const snapshot: StartDerivativeJobParams = {
    ...params,
    blueprint: {
      ...params.blueprint,
      scenes: clonedScenes,
    },
  };

  const initialScenes = initSceneProgressList(jobId, clonedScenes, params.visualMode, workDir);

  const job: DerivativeJobRecord = {
    jobId,
    status: 'queued',
    progress: 5,
    stepLabel: 'Đang khởi tạo tiến trình tạo video phái sinh...',
    visualMode: params.visualMode,
    scenes: initialScenes,
    workDir,
    fileName,
    warnings: [],
    createdAt: Date.now(),
    paramsSnapshot: snapshot,
    isRunning: false,
  };
  derivativeJobs.set(jobId, job);

  void runDerivativePipeline(job, snapshot).catch((err: any) => {
    job.isRunning = false;
    job.status = 'error';
    job.error = formatGeminiError(err);
    job.stepLabel = 'Tạo video thất bại';
  });

  return job;
}

async function runDerivativePipeline(
  job: DerivativeJobRecord,
  params: StartDerivativeJobParams,
  opts?: { allowFallbackOnError?: boolean }
): Promise<void> {
  if (job.isRunning) return;
  job.isRunning = true;
  try {
  const allowFallbackOnError = opts?.allowFallbackOnError === true;
  const { blueprint, visualMode, voice, keepSourceAudio, downloadSourceVideo } = params;
  const sources = Array.isArray(params.sources) ? params.sources : [];
  const scenes = blueprint.scenes.slice(0, 24);
  if (scenes.length === 0) {
    throw new Error('Kịch bản không có phân cảnh nào để dựng video.');
  }
  if (!Array.isArray(job.scenes) || job.scenes.length !== scenes.length) {
    job.scenes = initSceneProgressList(job.jobId, scenes, visualMode, job.workDir);
  }
  const touchScene = (idx: number, patch: Partial<DerivativeSceneProgress>) => {
    const cur = job.scenes[idx];
    if (!cur) return;
    Object.assign(cur, patch, { updatedAt: Date.now() });
  };

  const isVertical = blueprint.aspectRatio === '9:16';
  const isSquare = blueprint.aspectRatio === '1:1';
  const targetW = isSquare ? 1080 : isVertical ? 1080 : 1920;
  const targetH = isSquare ? 1080 : isVertical ? 1920 : 1080;
  job.resolution = `${targetW}x${targetH}`;

  const productionFormat: StudioProductionFormat =
    blueprint.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';

  const effectiveVoiceMode: DerivativeVoiceMode =
    blueprint.enableVoiceover === false
      ? 'none'
      : params.voiceMode || (voice === 'none' ? 'none' : 'ai_online');

  interface VoiceSegmentSpec {
    text: string;
    mode: 'ai_online' | 'offline_system';
    voiceId: Exclude<DerivativeVoiceId, 'none'>;
    offlineVoice?: string;
    voiceStyle: string;
  }

  interface ResolvedJobVoice {
    mode: 'ai_online' | 'offline_system';
    voiceId: Exclude<DerivativeVoiceId, 'none'>;
    offlineVoice?: string;
    voiceStyle: string;
    ageGroup: ConcreteAgeGroup;
  }

  const allCharRefs = Array.isArray(params.characterRefs) ? params.characterRefs : [];
  const defaultNarratorVoiceId: Exclude<DerivativeVoiceId, 'none'> =
    voice === 'none' ? 'Kore' : sanitizeGeminiVoiceId(voice);
  const defaultRenderVoiceMode: 'ai_online' | 'offline_system' =
    effectiveVoiceMode === 'offline_system' ? 'offline_system' : 'ai_online';

  // Lock consistent, distinct age/gender-appropriate voices per character across the entire film
  const characterVoiceRegistry = new Map<string, ResolvedJobVoice>();
  const usedCastVoices = new Set<string>();

  const pickDistinctPoolVoice = (
    ageGroup: ConcreteAgeGroup,
    gender: 'male' | 'female'
  ): Exclude<DerivativeVoiceId, 'none'> => {
    const pool = AGE_GROUP_VOICE_CAST_POOLS[ageGroup];
    const genderFiltered = pool.voices.filter((v) =>
      gender === 'female' ? GEMINI_FEMALE_VOICES.has(v) : !GEMINI_FEMALE_VOICES.has(v)
    );
    const orderedCandidates = [...genderFiltered, ...pool.voices];
    const unused = orderedCandidates.find((v) => !usedCastVoices.has(v));
    const chosen = unused || orderedCandidates[usedCastVoices.size % orderedCandidates.length] || defaultNarratorVoiceId;
    usedCastVoices.add(chosen);
    return chosen;
  };

  const registerCharacterVoice = (opts: {
    key: string;
    name: string;
    charRef?: StudioCharacterRefInput;
    profile?: CharacterVoiceProfile;
    contextHint?: string;
  }): ResolvedJobVoice => {
    const normKey = normalizeCharacterMatchText(opts.key);
    if (normKey && characterVoiceRegistry.has(normKey)) {
      return characterVoiceRegistry.get(normKey)!;
    }

    const { ageGroup, gender } = classifyCharacterAgeAndGender({
      name: opts.name,
      description: opts.charRef?.description,
      explicitAgeGroup:
        opts.charRef?.ageGroup && opts.charRef.ageGroup !== 'auto'
          ? opts.charRef.ageGroup
          : opts.profile?.ageGroup,
      explicitGender:
        opts.charRef?.gender && opts.charRef.gender !== 'auto'
          ? opts.charRef.gender
          : opts.profile?.gender,
      scriptContext: [blueprint.characterBible || '', opts.profile?.vocalToneNote || '', opts.contextHint || ''].join(' '),
    });

    const poolMeta = AGE_GROUP_VOICE_CAST_POOLS[ageGroup];
    let resolvedVoiceId: Exclude<DerivativeVoiceId, 'none'>;
    let resolvedMode: 'ai_online' | 'offline_system' = defaultRenderVoiceMode;

    if (opts.charRef?.voiceMode && opts.charRef.voiceMode !== 'default' && opts.charRef.voiceId) {
      resolvedVoiceId = sanitizeGeminiVoiceId(opts.charRef.voiceId);
      resolvedMode = opts.charRef.voiceMode === 'offline_system' ? 'offline_system' : 'ai_online';
      usedCastVoices.add(resolvedVoiceId);
    } else if (opts.profile?.voiceId && GEMINI_VOICE_IDS_SET.has(opts.profile.voiceId) && !usedCastVoices.has(opts.profile.voiceId)) {
      resolvedVoiceId = sanitizeGeminiVoiceId(opts.profile.voiceId);
      usedCastVoices.add(resolvedVoiceId);
    } else {
      resolvedVoiceId = pickDistinctPoolVoice(ageGroup, gender);
    }

    const combinedStyle = buildNorthernVietnameseTtsStyle(
      [
        poolMeta.pitchDirective,
        opts.profile?.vocalToneNote || '',
        opts.charRef?.voiceStyle?.trim() || params.voiceStyle?.trim() || '',
      ]
        .filter(Boolean)
        .join(' '),
      opts.name
    );

    const resolved: ResolvedJobVoice = {
      mode: resolvedMode,
      voiceId: resolvedVoiceId,
      offlineVoice: opts.charRef?.offlineVoice || params.offlineVoice || `${resolvedVoiceId} Bắc Hà Nội`,
      voiceStyle: combinedStyle,
      ageGroup,
    };

    if (normKey) {
      characterVoiceRegistry.set(normKey, resolved);
    }
    if (opts.charRef?.id) {
      characterVoiceRegistry.set(`id:${opts.charRef.id}`, resolved);
    }
    for (const al of extractCharacterAliases(opts.name)) {
      if (!characterVoiceRegistry.has(al)) {
        characterVoiceRegistry.set(al, resolved);
      }
    }
    return resolved;
  };

  if (productionFormat === 'dialogue_film') {
    const profiles = Array.isArray(blueprint.characterVoiceProfiles) ? blueprint.characterVoiceProfiles : [];
    for (const ref of allCharRefs) {
      const matchedProfile = profiles.find((vp) => {
        const vpNorm = normalizeCharacterMatchText(vp.characterName);
        return extractCharacterAliases(ref.name || '').some((al) => vpNorm.includes(al) || al.includes(vpNorm));
      });
      registerCharacterVoice({
        key: ref.id ? `id:${ref.id}` : ref.name || 'Nhân vật',
        name: ref.name || 'Nhân vật',
        charRef: ref,
        profile: matchedProfile,
      });
    }
    for (const vp of profiles) {
      const vpNorm = normalizeCharacterMatchText(vp.characterName);
      if (vpNorm && !characterVoiceRegistry.has(vpNorm)) {
        registerCharacterVoice({
          key: vp.characterName,
          name: vp.characterName,
          profile: vp,
        });
      }
    }
    // Pre-scan dialogue speaker names so every speaker gets an immutable locked voice before rendering
    for (const sc of scenes) {
      const lines = String(sc.dialogue || '')
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const colonMatch = line.match(/^([^:：]{1,36})[:：]\s*(.+)$/);
        if (colonMatch) {
          const spk = colonMatch[1].trim();
          const normSpk = normalizeCharacterMatchText(spk);
          if (normSpk && !characterVoiceRegistry.has(normSpk)) {
            const matchedRef = allCharRefs.find((r) =>
              extractCharacterAliases(r.name || '').some((al) => normSpk === al || normSpk.includes(al) || al.includes(normSpk))
            );
            registerCharacterVoice({
              key: spk,
              name: spk,
              charRef: matchedRef,
              contextHint: [sc.charactersInScene || '', sc.sceneSummary || ''].join(' '),
            });
          }
        }
      }
    }
  }

  const lookupCharacterVoice = (speakerRaw?: string, fallbackRef?: StudioCharacterRefInput, sceneHint?: string): ResolvedJobVoice | undefined => {
    if (fallbackRef?.id && characterVoiceRegistry.has(`id:${fallbackRef.id}`)) {
      return characterVoiceRegistry.get(`id:${fallbackRef.id}`);
    }
    const normSpeaker = normalizeCharacterMatchText(speakerRaw || fallbackRef?.name || '');
    if (normSpeaker) {
      if (characterVoiceRegistry.has(normSpeaker)) {
        return characterVoiceRegistry.get(normSpeaker);
      }
      for (const [k, val] of characterVoiceRegistry.entries()) {
        if (!k.startsWith('id:') && (normSpeaker.includes(k) || k.includes(normSpeaker))) {
          return val;
        }
      }
      return registerCharacterVoice({
        key: speakerRaw || fallbackRef?.name || 'Nhân vật',
        name: speakerRaw || fallbackRef?.name || 'Nhân vật',
        charRef: fallbackRef,
        contextHint: sceneHint,
      });
    }
    return undefined;
  };

  const buildNarratorVoiceSegment = (text: string, fallbackMode: 'ai_online' | 'offline_system'): VoiceSegmentSpec => ({
    text,
    mode: fallbackMode,
    voiceId: defaultNarratorVoiceId,
    offlineVoice: params.offlineVoice || `${defaultNarratorVoiceId} Bắc Hà Nội`,
    voiceStyle: buildNorthernVietnameseTtsStyle(
      params.voiceStyle?.trim() || 'Clear, engaging Northern Vietnamese storyteller narrator with natural pacing'
    ),
  });

  const buildSceneVoiceSegments = (
    sc: DerivativeScene,
    fallbackMode: 'ai_online' | 'offline_system',
    hasNativeLipSyncAudio = false
  ): VoiceSegmentSpec[] => {
    const segs: VoiceSegmentSpec[] = [];
    const dialogueRaw = String(sc.dialogue || '').trim();
    const narrationRaw = String(sc.narration || '').trim();
    const captionRaw = String(sc.onScreenText || (sc as any).caption || '').trim();

    if (productionFormat === 'narration_story') {
      // Narration Story Mode: single unified narrator voice across the entire video
      const spokenText =
        narrationRaw ||
        (hasNativeLipSyncAudio ? '' : dialogueRaw.replace(/^[^:：]{1,36}[:：]\s*/gm, '').trim()) ||
        captionRaw;
      if (spokenText) {
        segs.push(buildNarratorVoiceSegment(spokenText, fallbackMode));
      }
      return segs;
    }

    // Dialogue Film Mode: use selectedCharacterIds first, then charactersInScene, with locked age/gender voices
    const explicitSceneRefs =
      Array.isArray(sc.selectedCharacterIds) && sc.selectedCharacterIds.length > 0
        ? allCharRefs.filter((r) => r.id && sc.selectedCharacterIds!.includes(r.id))
        : [];
    const sceneMatchedChars =
      explicitSceneRefs.length > 0
        ? explicitSceneRefs
        : allCharRefs.filter((r) => {
            const sceneCharsNorm = normalizeCharacterMatchText(sc.charactersInScene || '');
            return extractCharacterAliases(r.name || '').some((al) => sceneCharsNorm.includes(al));
          });
    const soleSceneChar = sceneMatchedChars.length === 1 ? sceneMatchedChars[0] : undefined;

    // If Muse2API/Omni video clip already carries native lip-synced speech for this dialogue scene, do NOT overwrite or double-voice it with TTS.
    if (dialogueRaw && !hasNativeLipSyncAudio) {
      const lines = dialogueRaw
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const colonMatch = line.match(/^([^:：]{1,36})[:：]\s*(.+)$/);
        if (colonMatch) {
          const speakerName = colonMatch[1].trim();
          const speech = colonMatch[2].trim();
          const matchedRef =
            allCharRefs.find((r) => {
              const ns = normalizeCharacterMatchText(speakerName);
              return extractCharacterAliases(r.name || '').some((al) => ns === al || ns.includes(al) || al.includes(ns));
            }) || soleSceneChar;
          const resolvedVoice = lookupCharacterVoice(speakerName, matchedRef, sc.charactersInScene);
          if (speech) {
            segs.push(
              resolvedVoice
                ? {
                    text: speech,
                    mode: resolvedVoice.mode,
                    voiceId: resolvedVoice.voiceId,
                    offlineVoice: resolvedVoice.offlineVoice,
                    voiceStyle: resolvedVoice.voiceStyle,
                  }
                : buildNarratorVoiceSegment(speech, fallbackMode)
            );
          }
        } else {
          const fallbackSpeaker = soleSceneChar?.name || sc.charactersInScene?.split(/[,;&/]/)[0]?.trim();
          const resolvedVoice = lookupCharacterVoice(fallbackSpeaker, soleSceneChar, sc.sceneSummary);
          segs.push(
            resolvedVoice
              ? {
                  text: line,
                  mode: resolvedVoice.mode,
                  voiceId: resolvedVoice.voiceId,
                  offlineVoice: resolvedVoice.offlineVoice,
                  voiceStyle: resolvedVoice.voiceStyle,
                }
              : buildNarratorVoiceSegment(line, fallbackMode)
          );
        }
      }
    }

    if (narrationRaw) {
      const normNarr = normalizeCharacterMatchText(narrationRaw);
      const normDial = normalizeCharacterMatchText(dialogueRaw);
      if (!normDial || (normNarr !== normDial && !normDial.includes(normNarr))) {
        const colonMatch = narrationRaw.match(/^([^:：]{1,36})[:：]\s*(.+)$/);
        if (colonMatch) {
          const speakerName = colonMatch[1].trim();
          const speech = colonMatch[2].trim();
          const resolvedVoice = lookupCharacterVoice(speakerName, soleSceneChar, sc.charactersInScene);
          if (speech && resolvedVoice) {
            segs.push({
              text: speech,
              mode: resolvedVoice.mode,
              voiceId: resolvedVoice.voiceId,
              offlineVoice: resolvedVoice.offlineVoice,
              voiceStyle: resolvedVoice.voiceStyle,
            });
          } else {
            segs.push(buildNarratorVoiceSegment(narrationRaw, fallbackMode));
          }
        } else {
          segs.push(buildNarratorVoiceSegment(narrationRaw, fallbackMode));
        }
      }
    }
    if (segs.length === 0 && captionRaw) {
      segs.push(buildNarratorVoiceSegment(captionRaw, fallbackMode));
    }
    return segs;
  };

  // 1. Gather AI scene visuals & probe native lip-sync audio BEFORE TTS so lip-sync dialogue isn't duplicated or overwritten
  const sceneAudioPaths: (string | null)[] = new Array(scenes.length).fill(null);
  const sceneTargetDurations: number[] = scenes.map((s) => Math.max(2.0, Number(s.durationSec || 6)));
  const totalPlannedSec = sceneTargetDurations.reduce((a, b) => a + b, 0);

  const downloadedSourceVideos = new Map<number, { path: string; duration: number; isBroll?: boolean }>();
  const sceneOmniVideos = new Map<number, { path: string; duration: number; hasAudio: boolean }>();
  const sceneCustomImages = new Map<number, string>();
  const sceneBrollVideos = new Map<number, { path: string; duration: number }>();
  const thumbnailPaths = new Map<number, string>();
  const usedBrollUrls = new Set<string>();
  const failedSourceReasons = new Map<number, string>();

  job.status = 'downloading';
  job.progress = 8;
  job.stepLabel = 'Đang chuẩn bị tư liệu hình ảnh & clip phân cảnh AI...';

  // Step 1a: Reuse all existing Step 2 scene images & already-generated video clips (never regenerate Step 2 images!)
  for (let i = 0; i < scenes.length; i += 1) {
    const sc = scenes[i];
    if (sc.sceneImageDataUrl) {
      const imgPath = saveSceneImageToWorkDir(job.workDir, i, sc.sceneImageDataUrl);
      if (imgPath) {
        sceneCustomImages.set(i, imgPath);
        const existingSp = job.scenes[i];
        const nextSource = existingSp?.imageSource === 'generated' ? 'generated' : 'step2_reused';
        touchScene(i, {
          imageStatus: nextSource === 'generated' ? 'completed' : 'reused',
          imageSource: nextSource,
          imagePreviewUrl: `/api/derivative/jobs/${job.jobId}/scene-image/${i}?t=${Date.now()}`,
          progress: Math.max(existingSp?.progress || 0, 25),
        });
      }
    }
    if (sc.omniClipAssetId) {
      const asset = getStudioAsset(sc.omniClipAssetId);
      if (asset && fs.existsSync(asset.filePath)) {
        const hasAudio = await probeHasAudioStream(asset.filePath, job.workDir);
        sceneOmniVideos.set(i, { path: asset.filePath, duration: asset.durationSec || 8, hasAudio });
        const existingSp = job.scenes[i];
        touchScene(i, {
          videoStatus: existingSp?.videoStatus === 'completed' ? 'completed' : 'reused',
          videoAssetId: sc.omniClipAssetId,
          videoPreviewUrl: `/api/studio/assets/${sc.omniClipAssetId}`,
          progress: Math.max(existingSp?.progress || 0, 72),
          stageLabel: 'Đã có video sẵn — chờ dựng & ghép MP4',
        });
      }
    }
  }

  // Step 1a-extra: In storyboard_motion mode, generate images ONLY for scenes that do NOT yet have a Step 2 image or video
  if (visualMode === 'storyboard_motion') {
    const imgEngine = resolveDefaultImageEngineForVisualMode(visualMode);
    const customStyleHint = blueprint.videoStyle === 'custom' ? blueprint.visualStyleBible || '' : '';
    const allowFreeCostumeChange = blueprint.allowFreeCostumeChange === true;
    for (let i = 0; i < scenes.length; i += 1) {
      const sc = scenes[i];
      if (sceneCustomImages.has(i) || sceneOmniVideos.has(i)) {
        touchScene(i, {
          status: 'running',
          progress: Math.max(job.scenes[i]?.progress || 0, 55),
          stageLabel: sceneOmniVideos.has(i)
            ? 'Đã có video sẵn — chờ dựng & ghép MP4'
            : 'Dùng ảnh từ Bước 2 — chờ dựng chuyển động MP4',
        });
        continue;
      }
      job.stepLabel = `Đang tạo ảnh phân cảnh ${i + 1}/${scenes.length}...`;
      job.progress = 10 + Math.round(((i + 1) / scenes.length) * 26);
      touchScene(i, {
        status: 'running',
        imageStatus: 'running',
        progress: 20,
        error: undefined,
        failedStage: undefined,
        stageLabel: 'Đang tạo ảnh phân cảnh AI...',
      });
      try {
        const consistentPrompt = compileConsistentScenePrompt({
          scene: sc,
          videoStyle: blueprint.videoStyle,
          customStylePrompt: customStyleHint,
          characterBible: blueprint.characterBible,
          settingBible: blueprint.settingBible,
          visualStyleBible: blueprint.visualStyleBible,
          costumeBible: blueprint.costumeBible,
          continuityBible: blueprint.continuityBible,
          characterRefs: params.characterRefs,
          enableVoiceover: effectiveVoiceMode !== 'none',
          totalScenes: scenes.length,
          mediaType: 'image',
          allowFreeCostumeChange,
        });
        const imgRes = await withHardTimeout(
          generateStudioImage({
            mode: 'scene',
            prompt: consistentPrompt,
            aspectRatio: blueprint.aspectRatio,
            engine: imgEngine,
            videoStyle: blueprint.videoStyle,
            customStylePrompt: customStyleHint,
            characterBible: blueprint.characterBible,
            settingBible: blueprint.settingBible,
            visualStyleBible: blueprint.visualStyleBible,
            costumeBible: blueprint.costumeBible,
            continuityBible: blueprint.continuityBible,
            sceneIndex: sc.sceneIndex || i + 1,
            totalScenes: scenes.length,
            sceneTitle: sc.sceneTitle,
            charactersInScene: sc.charactersInScene,
            settingDetail: sc.settingDetail,
            actionDetail: sc.actionDetail,
            dialogue: sc.dialogue,
            sceneSummary: sc.sceneSummary,
            costume: sc.costume,
            cameraAngle: sc.cameraAngle,
            vfxNotes: sc.vfxNotes,
            selectedCharacterIds: sc.selectedCharacterIds,
            characterRefs: params.characterRefs,
            allowFreeCostumeChange,
          }),
          95_000,
          `Tạo ảnh phân cảnh #${i + 1}`
        );
        sc.sceneImageDataUrl = imgRes.dataUrl;
        sc.sceneImageSource = 'ai';
        const savedPath = saveSceneImageToWorkDir(job.workDir, i, imgRes.dataUrl);
        if (savedPath) sceneCustomImages.set(i, savedPath);
        touchScene(i, {
          status: 'running',
          imageStatus: 'completed',
          imageSource: 'generated',
          imagePreviewUrl: `/api/derivative/jobs/${job.jobId}/scene-image/${i}?t=${Date.now()}`,
          progress: 55,
          error: undefined,
          failedStage: undefined,
          stageLabel: 'Đã tạo ảnh phân cảnh · chờ dựng chuyển động MP4',
        });
      } catch (imgErr: any) {
        const errMsg = formatGeminiError(imgErr);
        touchScene(i, {
          status: 'error',
          imageStatus: 'error',
          failedStage: 'image',
          error: errMsg,
          stageLabel: 'Lỗi tạo ảnh phân cảnh',
        });
        job.warnings.push(`Phân cảnh #${i + 1}: Lỗi tạo ảnh (${errMsg}).`);
      }
    }
  }

  // Step 1b: Generate missing AI video clips if visualMode === 'gemini_omni' | 'muse2api_video' | 'qwen_video'
  // Always reuse Step 2 scene images (both AI-generated and uploaded) directly as keyframes to generate video!
  if (visualMode === 'gemini_omni' || visualMode === 'muse2api_video' || visualMode === 'qwen_video') {
    const useMuseVideo = visualMode === 'muse2api_video';
    const useQwenVideo = visualMode === 'qwen_video';
    const hasMissingScenes = scenes.some((_, idx) => !sceneOmniVideos.has(idx));
    let canGenerateWithSelectedEngine = true;
    let engineUnavailableReason = '';

    if (useMuseVideo && hasMissingScenes) {
      const museStatus = await getMuse2ApiStatus().catch(() => null);
      if (!museStatus?.ready) {
        canGenerateWithSelectedEngine = false;
        const reason =
          museStatus?.error ||
          (!museStatus?.reachable
            ? 'Muse2API chưa bật hoặc không kết nối được tới dịch vụ'
            : 'Muse2API chưa có tài khoản muse.ai hợp lệ');
        engineUnavailableReason = `Muse2API chưa sẵn sàng (${reason}).`;
        job.warnings.push(
          `Chế độ Muse2API chưa sẵn sàng (${reason}). Hãy kiểm tra Muse2API trong Cài đặt hoặc bỏ qua cảnh lỗi để dùng ảnh dự phòng.`
        );
      }
    }

    if (useQwenVideo && hasMissingScenes) {
      const alibabaStatus = getAlibabaModelStudioStatus();
      if (!alibabaStatus.configured) {
        canGenerateWithSelectedEngine = false;
        engineUnavailableReason =
          'AI Qwen Video chưa sẵn sàng (chưa đặt khóa DASHSCOPE_API_KEY hoặc đang tắt trong Cài đặt).';
        job.warnings.push(engineUnavailableReason);
      }
    }

    if (!canGenerateWithSelectedEngine && !allowFallbackOnError) {
      for (let i = 0; i < scenes.length; i += 1) {
        if (sceneOmniVideos.has(i)) continue;
        touchScene(i, {
          status: 'error',
          videoStatus: 'error',
          failedStage: 'video',
          error: engineUnavailableReason,
          stageLabel: 'Nguồn tạo video chưa sẵn sàng',
        });
      }
    } else if (canGenerateWithSelectedEngine) {
      const engineLabel = useQwenVideo
        ? 'AI Qwen (Alibaba Model Studio)'
        : useMuseVideo
        ? 'Muse2API (muse-video)'
        : 'Gemini Omni Flash';
      const sceneVideoTimeoutMs = useMuseVideo ? 240_000 : 180_000;

      for (let i = 0; i < scenes.length; i += 1) {
        const sc = scenes[i];
        if (sceneOmniVideos.has(i)) {
          touchScene(i, {
            status: 'running',
            videoStatus: job.scenes[i]?.videoStatus === 'completed' ? 'completed' : 'reused',
            progress: Math.max(job.scenes[i]?.progress || 0, 72),
            error: undefined,
            failedStage: undefined,
            stageLabel: 'Đã có video sẵn — chờ dựng & ghép MP4',
          });
          continue;
        }

        const hasStep2Img = Boolean(sc.sceneImageDataUrl);
        job.stepLabel = hasStep2Img
          ? `Phân cảnh ${i + 1}/${scenes.length}: Dùng ảnh Bước 2 → Đang tạo video bằng ${engineLabel}...`
          : `Đang tạo video phân cảnh ${i + 1}/${scenes.length} bằng ${engineLabel}...`;
        job.progress = 10 + Math.round(((i + 1) / scenes.length) * 26);

        touchScene(i, {
          status: 'running',
          videoStatus: 'running',
          progress: hasStep2Img ? 42 : 35,
          error: undefined,
          failedStage: undefined,
          stageLabel: hasStep2Img
            ? `Dùng ảnh Bước 2 → Đang tạo video (${engineLabel})...`
            : `Đang tạo video phân cảnh (${engineLabel})...`,
        });

        try {
          const customStyleHint = blueprint.videoStyle === 'custom' ? blueprint.visualStyleBible || '' : '';
          const allowFreeCostumeChange = blueprint.allowFreeCostumeChange === true;
          const consistentPrompt = compileConsistentScenePrompt({
            scene: sc,
            videoStyle: blueprint.videoStyle,
            customStylePrompt: customStyleHint,
            characterBible: blueprint.characterBible,
            settingBible: blueprint.settingBible,
            visualStyleBible: blueprint.visualStyleBible,
            costumeBible: blueprint.costumeBible,
            continuityBible: blueprint.continuityBible,
            characterRefs: params.characterRefs,
            enableVoiceover: effectiveVoiceMode !== 'none',
            totalScenes: scenes.length,
            mediaType: 'video',
            allowFreeCostumeChange,
          });
          const clipRes = await withHardTimeout(
            generateSceneVideoWithOmniFlash({
              engine: useQwenVideo ? 'qwen' : useMuseVideo ? 'muse2api' : 'gemini',
              prompt: consistentPrompt,
              aspectRatio: blueprint.aspectRatio,
              durationSec: Math.min(useQwenVideo ? 10 : useMuseVideo ? 12 : 15, Math.max(4, Math.round(sceneTargetDurations[i]))),
              videoStyle: blueprint.videoStyle,
              customStylePrompt: customStyleHint,
              characterBible: blueprint.characterBible,
              settingBible: blueprint.settingBible,
              visualStyleBible: blueprint.visualStyleBible,
              costumeBible: blueprint.costumeBible,
              continuityBible: blueprint.continuityBible,
              sceneIndex: sc.sceneIndex || i + 1,
              totalScenes: scenes.length,
              sceneTitle: sc.sceneTitle,
              settingDetail: sc.settingDetail,
              cameraMovement: sc.cameraMovement,
              cameraEquipment: sc.cameraEquipment,
              charactersInScene: sc.charactersInScene,
              actionDetail: sc.actionDetail,
              dialogue: sc.dialogue,
              narration: effectiveVoiceMode !== 'none' ? sc.narration : '',
              videoTimeline: sc.videoTimeline,
              enableVoiceover: effectiveVoiceMode !== 'none',
              sceneSummary: sc.sceneSummary,
              costume: sc.costume,
              cameraAngle: sc.cameraAngle,
              vfxNotes: sc.vfxNotes,
              selectedCharacterIds: sc.selectedCharacterIds,
              sceneImageDataUrl: sc.sceneImageDataUrl,
              characterRefs: params.characterRefs,
              allowFreeCostumeChange,
              musicMode: params.musicMode,
              musicStyle: params.musicStyle,
              musicPrompt: params.musicPrompt,
              musicVolume: params.musicVolume,
              musicInstrumentalOnly: params.musicInstrumentalOnly,
            }),
            sceneVideoTimeoutMs,
            `Tạo video phân cảnh #${i + 1}`
          );
          const asset = getStudioAsset(clipRes.assetId);
          if (asset) {
            sc.omniClipAssetId = clipRes.assetId;
            sc.omniClipPreviewUrl = `/api/studio/assets/${clipRes.assetId}`;
            sceneOmniVideos.set(i, {
              path: asset.filePath,
              duration: asset.durationSec || 8,
              hasAudio: clipRes.hasAudio,
            });
            touchScene(i, {
              status: 'running',
              videoStatus: 'completed',
              videoAssetId: clipRes.assetId,
              videoPreviewUrl: `/api/studio/assets/${clipRes.assetId}`,
              progress: 75,
              error: undefined,
              failedStage: undefined,
              stageLabel: 'Đã xong video phân cảnh · chờ dựng & ghép MP4',
            });
          } else {
            throw new Error('Máy chủ không tìm thấy tệp video vừa tạo trên đĩa.');
          }
        } catch (clipErr: any) {
          // Isolate error to this scene ONLY so remaining scenes continue without hanging the entire pipeline
          const errMsg = formatGeminiError(clipErr);
          touchScene(i, {
            status: 'error',
            videoStatus: 'error',
            failedStage: 'video',
            error: errMsg,
            stageLabel: 'Lỗi tạo video phân cảnh',
          });
          job.warnings.push(`Phân cảnh #${i + 1}: Không tạo được video AI (${errMsg}).`);
        }
      }
    }
  }

  // Checkpoint: if any scene failed image/video generation and user didn't request fallback, pause cleanly into partial_error
  // so user can retry ONLY the failed scenes (image/video/full) or resume without losing completed scenes!
  const failedMediaScenes = job.scenes.filter((s) => s.status === 'error');
  if (failedMediaScenes.length > 0 && !allowFallbackOnError) {
    for (let i = 0; i < job.scenes.length; i += 1) {
      if (job.scenes[i].status !== 'error') {
        touchScene(i, {
          status: 'completed',
          stageLabel: 'Đã hoàn tất phân cảnh này · đang chờ các cảnh lỗi để ghép MP4',
        });
      }
    }
    const okCount = scenes.length - failedMediaScenes.length;
    job.status = 'partial_error';
    job.progress = Math.max(15, Math.round((okCount / Math.max(1, scenes.length)) * 70));
    job.error = `Có ${failedMediaScenes.length}/${scenes.length} phân cảnh gặp lỗi (${okCount} phân cảnh đã xong và được giữ nguyên). Hãy bấm tạo lại ảnh/video ở phân cảnh lỗi rồi bấm "Khởi tạo lại tiến trình & Xuất MP4".`;
    job.stepLabel = `Tạm dừng: ${failedMediaScenes.length}/${scenes.length} phân cảnh cần xử lý lỗi trước khi ghép MP4`;
    return;
  }

  // 2. Voiceover generation (Online AI TTS + Offline VieNeu TTS with Per-Character Voice Routing & Lip-Sync Preservation)
  const hasPerCharAudio =
    effectiveVoiceMode !== 'none' &&
    Array.isArray(params.characterRefs) &&
    params.characterRefs.some((c) => c.voiceMode && c.voiceMode !== 'default');

  if (effectiveVoiceMode !== 'none' && (effectiveVoiceMode === 'ai_online' || effectiveVoiceMode === 'offline_system')) {
    job.status = 'tts';
    job.progress = 38;
    const offlineEngine = await detectOfflineTtsEngine();
    const defaultMode: 'ai_online' | 'offline_system' =
      effectiveVoiceMode === 'offline_system' ? 'offline_system' : 'ai_online';

    job.stepLabel = hasPerCharAudio
      ? `Đang tổng hợp giọng đọc đồng bộ từng nhân vật (0/${scenes.length} cảnh)...`
      : defaultMode === 'offline_system' && offlineEngine.engineId === 'vieneu'
      ? `Đang tổng hợp giọng tiếng Việt VieNeu-TTS (0/${scenes.length} cảnh)...`
      : `Đang tạo giọng đọc thuyết minh (0/${scenes.length} cảnh)...`;

    // Always synthesize script narration & dialogue (AI video clips typically carry ambient SFX/music, not Vietnamese voiceover)
    const sceneSegments = scenes.map((sc) => buildSceneVoiceSegments(sc, defaultMode, false));

    // Batch VieNeu segments cleanly when no Gemini mixing needed or for all offline_system segments
    const offlineBatchList: { key: string; sceneIdx: number; segIdx: number; text: string; out: string; voice?: string }[] = [];
    if (offlineEngine.engineId === 'vieneu') {
      sceneSegments.forEach((segs, sIdx) => {
        segs.forEach((seg, gIdx) => {
          if (seg.mode === 'offline_system' && seg.text.trim()) {
            offlineBatchList.push({
              key: `${sIdx}:${gIdx}`,
              sceneIdx: sIdx,
              segIdx: gIdx,
              text: seg.text,
              out: path.join(job.workDir, `voice_${sIdx}_seg_${gIdx}.wav`),
              voice: seg.offlineVoice,
            });
          }
        });
      });
    }

    const offlineBatchDone = new Set<string>();
    if (offlineBatchList.length > 0 && offlineEngine.engineId === 'vieneu') {
      const byVoice = new Map<string, typeof offlineBatchList>();
      for (const item of offlineBatchList) {
        const vk = item.voice || params.offlineVoice || '';
        const list = byVoice.get(vk) || [];
        list.push(item);
        byVoice.set(vk, list);
      }
      for (const [voiceKey, groupItems] of byVoice.entries()) {
        try {
          const resMap = await synthesizeOfflineVoiceBatchVieNeu(
            groupItems.map((it, idx) => ({ index: idx, text: it.text, out: it.out, voice: it.voice })),
            voiceKey
          );
          groupItems.forEach((it, idx) => {
            if (resMap.get(idx) && fs.existsSync(it.out)) {
              offlineBatchDone.add(it.key);
            }
          });
        } catch {
          // fallback per segment below
        }
      }
    }

    let fallbackWarnedOnline = false;
    let fallbackWarnedOffline = false;

    for (let i = 0; i < scenes.length; i += 1) {
      const segs = sceneSegments[i];
      if (segs.length === 0) {
        touchScene(i, { audioStatus: 'skipped' });
        continue;
      }

      touchScene(i, {
        audioStatus: 'running',
        stageLabel: 'Đang tổng hợp giọng đọc thuyết minh cho phân cảnh...',
      });

      const producedSegFiles: string[] = [];
      let lastSegErr = '';
      for (let g = 0; g < segs.length; g += 1) {
        const seg = segs[g];
        const segWav = path.join(job.workDir, `voice_${i}_seg_${g}.wav`);
        let ok = offlineBatchDone.has(`${i}:${g}`) && fs.existsSync(segWav) && fs.statSync(segWav).size > 44;

        if (!ok) {
          const synth = await synthesizeNarrationAudioForText({
            text: seg.text,
            outWavPath: segWav,
            mode: seg.mode,
            voice: seg.voiceId,
            voiceStyle: seg.voiceStyle,
            offlineVoice: seg.offlineVoice || params.offlineVoice || seg.voiceId,
          });
          ok = synth.ok;
          if (!ok && synth.error) {
            lastSegErr = synth.error;
          }
          if (ok && synth.fellBackTo === 'ai_online' && !fallbackWarnedOnline) {
            fallbackWarnedOnline = true;
            job.warnings.push('Giọng đọc Offline chưa sẵn sàng — đã tự động chuyển sang Gemini AI Voice để đảm bảo video có thuyết minh.');
          }
          if (ok && synth.fellBackTo === 'offline_system' && !fallbackWarnedOffline) {
            fallbackWarnedOffline = true;
            job.warnings.push(`Gemini TTS tạm bận — đã tự chuyển sang giọng Offline (${offlineEngine.engine}).`);
          }
        }
        if (ok && fs.existsSync(segWav) && fs.statSync(segWav).size > 44) {
          producedSegFiles.push(segWav);
        }
      }

      const finalSceneWav = path.join(job.workDir, `voice_${i}.wav`);
      if (producedSegFiles.length === 1) {
        fs.copyFileSync(producedSegFiles[0], finalSceneWav);
      } else if (producedSegFiles.length > 1) {
        const segConcatTxt = path.join(job.workDir, `voice_${i}_concat.txt`);
        fs.writeFileSync(
          segConcatTxt,
          producedSegFiles.map((f) => `file '${path.basename(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n',
          'utf8'
        );
        const concatRes = await spawnPromise(
          'ffmpeg',
          ['-y', '-f', 'concat', '-safe', '0', '-i', path.basename(segConcatTxt), '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', path.basename(finalSceneWav)],
          job.workDir,
          45_000
        );
        if (concatRes.code !== 0 || !fs.existsSync(finalSceneWav)) {
          fs.copyFileSync(producedSegFiles[0], finalSceneWav);
        }
      }

      if (fs.existsSync(finalSceneWav) && fs.statSync(finalSceneWav).size > 44) {
        sceneAudioPaths[i] = finalSceneWav;
        const audioDur = await probeDurationSeconds(finalSceneWav, job.workDir);
        if (audioDur > 0.5) {
          sceneTargetDurations[i] = Math.max(sceneTargetDurations[i], audioDur + 0.45);
        }
        touchScene(i, {
          audioStatus: 'completed',
          progress: Math.max(job.scenes[i]?.progress || 0, 80),
        });
      } else {
        touchScene(i, { audioStatus: 'error' });
        job.warnings.push(
          `Cảnh ${i + 1}: Không tạo được giọng đọc thuyết minh${lastSegErr ? ` (${lastSegErr.slice(0, 180)})` : ''}.`
        );
      }

      job.stepLabel = `Đã xử lý giọng đọc (${i + 1}/${scenes.length} cảnh)...`;
      job.progress = 38 + Math.round(((i + 1) / scenes.length) * 14);
    }
  } else {
    for (let i = 0; i < scenes.length; i += 1) {
      touchScene(i, { audioStatus: 'skipped' });
    }
    job.progress = 48;
  }

  job.status = 'downloading';
  job.stepLabel = 'Đang kiểm tra tư liệu nguồn & B-roll dự phòng...';

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
    ((visualMode === 'muse2api_video' || visualMode === 'gemini_omni' || visualMode === 'qwen_video') &&
      hasUncoveredScenes);

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
    } else if (musicMode === 'auto_adaptive') {
      job.stepLabel = 'AI đang tự sáng tạo & chọn nhạc nền phù hợp phong cách...';
      const styleMeta =
        params.musicStyle && params.musicStyle !== 'custom' && params.musicStyle !== 'auto_context'
          ? AI_MUSIC_STYLE_DIRECTIVES[params.musicStyle]
          : undefined;
      const adaptiveQueries = Array.from(
        new Set([...(styleMeta?.wikimediaQueries || []), ...buildAdaptiveMusicSearchQueries(blueprint)])
      ).slice(0, 6);
      const adaptivePrompt =
        params.musicPrompt?.trim() ||
        blueprint.adaptiveMusicPrompt?.trim() ||
        `Natural instrumental soundtrack fitting mood: ${adaptiveQueries[0] || blueprint.derivativeTitle}`;

      if (process.env.GEMINI_API_KEY?.trim()) {
        try {
          const track = await generateStudioMusicWithLyria({
            prompt: adaptivePrompt,
            styleId: params.musicStyle,
            instrumentalOnly: params.musicInstrumentalOnly !== false,
            mode: totalPlannedSec > 45 ? 'pro' : 'clip',
          });
          const rec = getStudioAsset(track.assetId);
          if (rec) bgmLocalPath = rec.filePath;
        } catch {
          // Safe fallback to Wikimedia Commons mood-matched music if Lyria is unavailable on current API key
        }
      }

      if (!bgmLocalPath) {
        for (const q of adaptiveQueries) {
          try {
            const tracks = await searchPublicFreeMusicFromWikimedia(q);
            const picked = tracks[0];
            if (!picked?.url) continue;
            const dl = await fetch(picked.url, {
              headers: { 'User-Agent': WIKIMEDIA_UA },
              signal: AbortSignal.timeout(25_000),
            });
            if (dl.ok) {
              const buf = Buffer.from(await dl.arrayBuffer());
              if (buf.byteLength > 10_000) {
                const bgmOut = path.join(job.workDir, 'auto_adaptive_bgm.audio');
                fs.writeFileSync(bgmOut, buf);
                bgmLocalPath = bgmOut;
                break;
              }
            }
          } catch {
            // Try next mood query
          }
        }
      }
      if (!bgmLocalPath) {
        job.warnings.push('Không tải được nhạc nền tự động phù hợp — giữ nguyên giọng kể chuyện tự nhiên.');
      }
    } else if (musicMode === 'ai_lyria') {
      // Prompt-embedded AI background music: the video-generating AI server natively generates BGM from the scene prompt.
      // Only attach an external audio file if the user explicitly passed a pre-generated musicAssetId (handled above).
      bgmLocalPath = null;
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

    touchScene(i, {
      status: 'running',
      renderStatus: 'running',
      progress: 86,
      stageLabel: 'Đang dựng phân cảnh bằng FFmpeg...',
    });

    try {
    const outScenePath = path.join(job.workDir, `scene_${i}.mp4`);
    const audioWav = sceneAudioPaths[i];
    const omniClip = sceneOmniVideos.get(i);
    const brollClip = sceneBrollVideos.get(i);
    const customImg = sceneCustomImages.get(i);
    const srcVideo: { path: string; duration: number; isBroll?: boolean; hasOmniNativeAudio?: boolean } | undefined = omniClip
      ? { path: omniClip.path, duration: omniClip.duration, hasOmniNativeAudio: omniClip.hasAudio }
      : customImg
      ? undefined
      : brollClip
      ? { path: brollClip.path, duration: brollClip.duration, isBroll: true }
      : visualMode === 'storyboard_motion' || srcIdx < 0
      ? undefined
      : downloadedSourceVideos.get(srcIdx);
    const thumbFile = customImg || (srcIdx >= 0 ? thumbnailPaths.get(srcIdx) : undefined);

    const needsOmniPad = Boolean(srcVideo?.hasOmniNativeAudio && srcVideo.duration < sceneDur - 0.15);
    const padSuffix = needsOmniPad
      ? `,tpad=stop_mode=clone:stop_duration=${(sceneDur - (srcVideo?.duration || 0) + 0.35).toFixed(2)}`
      : '';
    const baseCanvasFilter =
      `[0:v]split[bg][fg];` +
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=18:2,setsar=1[bgblur];` +
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
      `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[vout]`;
    const canvasFilter =
      `[0:v]split[bg][fg];` +
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=18:2,setsar=1[bgblur];` +
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
      `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,fps=30${padSuffix},format=yuv420p[vout]`;

    let args: string[] = [];

    if (srcVideo) {
      const needsLoop = !srcVideo.hasOmniNativeAudio && srcVideo.duration < sceneDur - 0.1;
      const startSec = needsLoop || srcVideo.hasOmniNativeAudio || srcVideo.duration <= sceneDur + 0.5
        ? 0
        : Math.max(0, Math.min(srcVideo.duration - sceneDur - 0.5, (sc.sourceStartPercent / 100) * srcVideo.duration));
      const inputArgs = needsLoop
        ? ['-stream_loop', '-1', '-i', srcVideo.path]
        : srcVideo.hasOmniNativeAudio
        ? ['-i', srcVideo.path]
        : ['-ss', startSec.toFixed(2), '-t', sceneDur.toFixed(2), '-i', srcVideo.path];

      if (srcVideo.hasOmniNativeAudio && audioWav) {
        args = [
          '-y',
          ...inputArgs,
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[0:a]aresample=44100,apad,volume=0.18[aclip];[1:a]aresample=44100,apad,volume=1.35[anarr];[aclip][anarr]amix=inputs=2:duration=longest:dropout_transition=0.2:normalize=0[aout]`,
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
      } else if (srcVideo.hasOmniNativeAudio) {
        args = [
          '-y',
          ...inputArgs,
          '-filter_complex',
          `${canvasFilter};[0:a]aresample=44100,apad,volume=1.05[aout]`,
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
      } else if (audioWav && keepSourceAudio && !srcVideo.isBroll && (await probeHasAudioStream(srcVideo.path, job.workDir))) {
        args = [
          '-y',
          ...inputArgs,
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[0:a]aresample=44100,apad,volume=0.15[abg];[1:a]aresample=44100,apad,volume=1.35[avoice];[abg][avoice]amix=inputs=2:duration=longest:dropout_transition=0.2:normalize=0[aout]`,
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
        `${baseCanvasFilter};[1:a]aresample=44100,apad[aout]`,
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
      caption: '',
    });
    cursorSec += actualDur;
    sceneVideoFiles.push(path.basename(outScenePath));
    touchScene(i, {
      status: 'completed',
      renderStatus: 'completed',
      progress: 95,
      error: undefined,
      failedStage: undefined,
      stageLabel: 'Đã dựng xong · chờ ghép MP4 cuối',
    });
    } catch (renderErr: any) {
      const errMsg = formatGeminiError(renderErr);
      touchScene(i, {
        status: 'error',
        renderStatus: 'error',
        failedStage: 'render',
        error: errMsg,
        stageLabel: 'Lỗi dựng FFmpeg phân cảnh',
      });
      job.warnings.push(`Phân cảnh #${i + 1}: ${errMsg}`);
    }
  }

  const failedRenderScenes = job.scenes.filter((s) => s.renderStatus === 'error');
  if (failedRenderScenes.length > 0 || sceneVideoFiles.length === 0) {
    job.status = 'partial_error';
    job.error = `Có ${failedRenderScenes.length}/${scenes.length} phân cảnh gặp lỗi khi dựng FFmpeg. Hãy tạo lại ảnh/video ở phân cảnh lỗi rồi bấm "Khởi tạo lại tiến trình & Xuất MP4".`;
    job.stepLabel = 'Tạm dừng: có phân cảnh lỗi ở bước dựng FFmpeg';
    return;
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
  const musicVol = Math.max(0, Math.min(0.9, Number(params.musicVolume ?? 0.22)));

  const hasBgm = Boolean(bgmLocalPath && fs.existsSync(bgmLocalPath) && musicVol > 0);
  const duckRatio = musicVol >= 0.55 ? 2 : 3.5;
  const buildBgmAssArgs = (useSidechainDucking: boolean): string[] => [
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
    bgmLocalPath || '',
    '-filter_complex',
    useSidechainDucking
      ? `[0:a]aresample=44100,asplit=2[avoice][asc];[1:a]aresample=44100,volume=${musicVol.toFixed(2)}[abgm];[abgm][asc]sidechaincompress=threshold=0.04:ratio=${duckRatio}:attack=35:release=350[aduck];[avoice][aduck]amix=inputs=2:duration=first:dropout_transition=0.3:normalize=0[aout]`
      : `[0:a]aresample=44100[avoice];[1:a]aresample=44100,volume=${musicVol.toFixed(2)}[abgm];[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0.3:normalize=0[aout]`,
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

  let finalArgs: string[] = [];
  if (hasBgm) {
    finalArgs = buildBgmAssArgs(true);
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

  if (hasBgm && (finalRes.code !== 0 || !fs.existsSync(finalOutPath))) {
    finalRes = await spawnPromise('ffmpeg', buildBgmAssArgs(false), job.workDir, 600_000);
  }

  // Fallback without libass if libass fails
  if (finalRes.code !== 0 || !fs.existsSync(finalOutPath)) {
    job.warnings.push('FFmpeg không áp dụng được phụ đề libass, đã xuất video kèm đầy đủ âm thanh/nhạc nền.');
    const noAssArgs = hasBgm && bgmLocalPath
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
          `[0:a]aresample=44100[avoice];[1:a]aresample=44100,volume=${musicVol.toFixed(2)}[abgm];[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0.3:normalize=0[aout]`,
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

  for (let i = 0; i < job.scenes.length; i += 1) {
    if (job.scenes[i].status !== 'error') {
      touchScene(i, {
        status: 'completed',
        progress: 100,
        stageLabel: 'Hoàn tất & đã xuất MP4',
      });
    }
  }

  job.outputPath = finalOutPath;
  job.fileSize = stat.size;
  job.durationSec = Math.round(totalDuration * 10) / 10;
  job.status = 'completed';
  job.progress = 100;
  job.error = undefined;
  job.stepLabel = 'Hoàn tất video phái sinh!';
  } finally {
    job.isRunning = false;
  }
}

export async function retryDerivativeJobScene(
  jobId: string,
  sceneIdx: number,
  action: 'image' | 'video' | 'full',
  opts?: { imageEngine?: 'gemini' | 'muse2api' | 'qwen' | 'xingchi' }
): Promise<{
  ok: boolean;
  error?: string;
  job: ReturnType<typeof getDerivativeJobPublicView>;
  sceneImageDataUrl?: string;
  videoAssetId?: string;
  videoPreviewUrl?: string;
}> {
  const job = derivativeJobs.get(jobId);
  if (!job || !job.paramsSnapshot) {
    throw new Error('Tác vụ dựng video không tồn tại hoặc đã hết hạn.');
  }
  if (job.isRunning) {
    throw new Error('Tiến trình tổng đang chạy — vui lòng chờ bước hiện tại hoàn tất trước khi tạo lại riêng phân cảnh.');
  }

  const params = job.paramsSnapshot;
  const scenes = params.blueprint.scenes;
  if (!Number.isInteger(sceneIdx) || sceneIdx < 0 || sceneIdx >= scenes.length) {
    throw new Error('Chỉ số phân cảnh không hợp lệ.');
  }

  const sc = scenes[sceneIdx];
  const sp = job.scenes[sceneIdx];
  if (!sp) {
    throw new Error('Không tìm thấy trạng thái tiến trình của phân cảnh này.');
  }
  if (sp.status === 'running') {
    throw new Error(`Phân cảnh #${sceneIdx + 1} đang chạy, vui lòng đợi hoàn tất.`);
  }

  const blueprint = params.blueprint;
  const customStyleHint = blueprint.videoStyle === 'custom' ? blueprint.visualStyleBible || '' : '';
  const allowFreeCostumeChange = blueprint.allowFreeCostumeChange === true;
  const effectiveVoiceMode: DerivativeVoiceMode =
    blueprint.enableVoiceover === false
      ? 'none'
      : params.voiceMode || (params.voice === 'none' ? 'none' : 'ai_online');

  const updateSp = (patch: Partial<DerivativeSceneProgress>) => {
    Object.assign(sp, patch, { updatedAt: Date.now() });
  };

  let producedImageDataUrl: string | undefined;
  let producedVideoAssetId: string | undefined;
  let producedVideoPreviewUrl: string | undefined;

  const runRegenerateImage = async () => {
    const imgEngine = opts?.imageEngine || resolveDefaultImageEngineForVisualMode(params.visualMode);
    updateSp({
      status: 'running',
      imageStatus: 'running',
      progress: 22,
      error: undefined,
      failedStage: undefined,
      stageLabel: 'Đang tạo lại ảnh phân cảnh...',
    });

    const consistentPrompt = compileConsistentScenePrompt({
      scene: sc,
      videoStyle: blueprint.videoStyle,
      customStylePrompt: customStyleHint,
      characterBible: blueprint.characterBible,
      settingBible: blueprint.settingBible,
      visualStyleBible: blueprint.visualStyleBible,
      costumeBible: blueprint.costumeBible,
      continuityBible: blueprint.continuityBible,
      characterRefs: params.characterRefs,
      enableVoiceover: effectiveVoiceMode !== 'none',
      totalScenes: scenes.length,
      mediaType: 'image',
      allowFreeCostumeChange,
    });

    const imgRes = await withHardTimeout(
      generateStudioImage({
        mode: 'scene',
        prompt: consistentPrompt,
        aspectRatio: blueprint.aspectRatio,
        engine: imgEngine,
        videoStyle: blueprint.videoStyle,
        customStylePrompt: customStyleHint,
        characterBible: blueprint.characterBible,
        settingBible: blueprint.settingBible,
        visualStyleBible: blueprint.visualStyleBible,
        costumeBible: blueprint.costumeBible,
        continuityBible: blueprint.continuityBible,
        sceneIndex: sc.sceneIndex || sceneIdx + 1,
        totalScenes: scenes.length,
        sceneTitle: sc.sceneTitle,
        charactersInScene: sc.charactersInScene,
        settingDetail: sc.settingDetail,
        actionDetail: sc.actionDetail,
        dialogue: sc.dialogue,
        sceneSummary: sc.sceneSummary,
        costume: sc.costume,
        cameraAngle: sc.cameraAngle,
        vfxNotes: sc.vfxNotes,
        selectedCharacterIds: sc.selectedCharacterIds,
        characterRefs: params.characterRefs,
        allowFreeCostumeChange,
      }),
      95_000,
      `Tạo lại ảnh phân cảnh #${sceneIdx + 1}`
    );

    sc.sceneImageDataUrl = imgRes.dataUrl;
    sc.sceneImageSource = 'ai';
    // Clear stale video clip if user explicitly regenerated the scene image
    if (action === 'image') {
      sc.omniClipAssetId = undefined;
      sc.omniClipPreviewUrl = undefined;
    }
    saveSceneImageToWorkDir(job.workDir, sceneIdx, imgRes.dataUrl);
    producedImageDataUrl = imgRes.dataUrl;

    updateSp({
      imageStatus: 'completed',
      imageSource: 'generated',
      imagePreviewUrl: `/api/derivative/jobs/${job.jobId}/scene-image/${sceneIdx}?t=${Date.now()}`,
      videoStatus: action === 'image' ? 'pending' : sp.videoStatus,
      videoAssetId: action === 'image' ? undefined : sp.videoAssetId,
      videoPreviewUrl: action === 'image' ? undefined : sp.videoPreviewUrl,
      progress: action === 'image' ? 45 : 38,
      status: action === 'image' ? 'completed' : 'running',
      error: undefined,
      failedStage: undefined,
      stageLabel:
        action === 'image'
          ? 'Đã tạo lại ảnh phân cảnh — sẵn sàng tạo video hoặc ghép MP4'
          : 'Đã tạo lại ảnh · đang chuyển sang tạo video...',
    });
  };

  const runRegenerateVideo = async () => {
    const useQwenVideo = params.visualMode === 'qwen_video';
    const useMuseVideo = params.visualMode === 'muse2api_video';
    const videoEngine: 'gemini' | 'muse2api' | 'qwen' = useQwenVideo
      ? 'qwen'
      : useMuseVideo
      ? 'muse2api'
      : 'gemini';
    const timeoutMs = useMuseVideo ? 240_000 : 180_000;

    updateSp({
      status: 'running',
      videoStatus: 'running',
      progress: 55,
      error: undefined,
      failedStage: undefined,
      stageLabel: sc.sceneImageDataUrl
        ? 'Đang tạo lại video từ ảnh phân cảnh...'
        : 'Đang tạo lại video phân cảnh AI...',
    });

    const consistentPrompt = compileConsistentScenePrompt({
      scene: sc,
      videoStyle: blueprint.videoStyle,
      customStylePrompt: customStyleHint,
      characterBible: blueprint.characterBible,
      settingBible: blueprint.settingBible,
      visualStyleBible: blueprint.visualStyleBible,
      costumeBible: blueprint.costumeBible,
      continuityBible: blueprint.continuityBible,
      characterRefs: params.characterRefs,
      enableVoiceover: effectiveVoiceMode !== 'none',
      totalScenes: scenes.length,
      mediaType: 'video',
      allowFreeCostumeChange,
    });

    const targetDur = Math.max(2.0, Number(sc.durationSec || 6));
    const clipRes = await withHardTimeout(
      generateSceneVideoWithOmniFlash({
        engine: videoEngine,
        prompt: consistentPrompt,
        aspectRatio: blueprint.aspectRatio,
        durationSec: Math.min(useQwenVideo ? 10 : useMuseVideo ? 12 : 15, Math.max(4, Math.round(targetDur))),
        videoStyle: blueprint.videoStyle,
        customStylePrompt: customStyleHint,
        characterBible: blueprint.characterBible,
        settingBible: blueprint.settingBible,
        visualStyleBible: blueprint.visualStyleBible,
        costumeBible: blueprint.costumeBible,
        continuityBible: blueprint.continuityBible,
        sceneIndex: sc.sceneIndex || sceneIdx + 1,
        totalScenes: scenes.length,
        sceneTitle: sc.sceneTitle,
        settingDetail: sc.settingDetail,
        cameraMovement: sc.cameraMovement,
        cameraEquipment: sc.cameraEquipment,
        charactersInScene: sc.charactersInScene,
        actionDetail: sc.actionDetail,
        dialogue: sc.dialogue,
        narration: effectiveVoiceMode !== 'none' ? sc.narration : '',
        videoTimeline: sc.videoTimeline,
        enableVoiceover: effectiveVoiceMode !== 'none',
        sceneSummary: sc.sceneSummary,
        costume: sc.costume,
        cameraAngle: sc.cameraAngle,
        vfxNotes: sc.vfxNotes,
        selectedCharacterIds: sc.selectedCharacterIds,
        sceneImageDataUrl: sc.sceneImageDataUrl,
        characterRefs: params.characterRefs,
        allowFreeCostumeChange,
        musicMode: params.musicMode,
        musicStyle: params.musicStyle,
        musicPrompt: params.musicPrompt,
        musicVolume: params.musicVolume,
        musicInstrumentalOnly: params.musicInstrumentalOnly,
      }),
      timeoutMs,
      `Tạo lại video phân cảnh #${sceneIdx + 1}`
    );

    const asset = getStudioAsset(clipRes.assetId);
    if (!asset) {
      throw new Error('Máy chủ không tìm thấy tệp video vừa tạo trên đĩa.');
    }

    sc.omniClipAssetId = clipRes.assetId;
    sc.omniClipPreviewUrl = `/api/studio/assets/${clipRes.assetId}`;
    producedVideoAssetId = clipRes.assetId;
    producedVideoPreviewUrl = sc.omniClipPreviewUrl;

    updateSp({
      status: 'completed',
      videoStatus: 'completed',
      videoAssetId: clipRes.assetId,
      videoPreviewUrl: sc.omniClipPreviewUrl,
      progress: 80,
      error: undefined,
      failedStage: undefined,
      stageLabel: 'Đã tạo lại video — sẵn sàng ghép xuất MP4',
    });
  };

  try {
    if (action === 'image') {
      await runRegenerateImage();
    } else if (action === 'video') {
      await runRegenerateVideo();
    } else {
      // 'full': preserve Step 2 image if present & valid (unless image itself failed), then generate video
      if (!sc.sceneImageDataUrl || sp.failedStage === 'image') {
        await runRegenerateImage();
      }
      if (params.visualMode !== 'storyboard_motion') {
        await runRegenerateVideo();
      }
    }

    const remainingErrors = job.scenes.filter((s) => s.status === 'error').length;
    if (remainingErrors === 0 && (job.status === 'partial_error' || job.status === 'error')) {
      job.error = undefined;
      job.stepLabel = 'Tất cả phân cảnh đã sẵn sàng — bấm "Khởi tạo lại tiến trình & Xuất MP4" để ghép xuất video.';
    }

    return {
      ok: true,
      job: getDerivativeJobPublicView(job),
      sceneImageDataUrl: producedImageDataUrl,
      videoAssetId: producedVideoAssetId,
      videoPreviewUrl: producedVideoPreviewUrl,
    };
  } catch (err: any) {
    const errMsg = formatGeminiError(err);
    const failedStage: 'image' | 'video' =
      action === 'image' || (action === 'full' && !sc.sceneImageDataUrl) ? 'image' : 'video';
    updateSp({
      status: 'error',
      imageStatus: failedStage === 'image' ? 'error' : sp.imageStatus,
      videoStatus: failedStage === 'video' ? 'error' : sp.videoStatus,
      failedStage,
      error: errMsg,
      stageLabel: failedStage === 'image' ? 'Lỗi tạo lại ảnh phân cảnh' : 'Lỗi tạo lại video phân cảnh',
    });
    return {
      ok: false,
      error: errMsg,
      job: getDerivativeJobPublicView(job),
    };
  }
}

export function resumeDerivativeJobPipeline(
  jobId: string,
  opts?: { allowFallbackOnError?: boolean }
): DerivativeJobRecord {
  const job = derivativeJobs.get(jobId);
  if (!job || !job.paramsSnapshot) {
    throw new Error('Tác vụ dựng video không tồn tại hoặc đã hết hạn.');
  }
  if (job.isRunning) {
    return job;
  }

  for (let i = 0; i < job.scenes.length; i += 1) {
    const sp = job.scenes[i];
    if (sp.status === 'error') {
      sp.status = 'pending';
      sp.error = undefined;
      sp.failedStage = undefined;
      if (sp.imageStatus === 'error') sp.imageStatus = 'pending';
      if (sp.videoStatus === 'error') sp.videoStatus = 'pending';
      if (sp.renderStatus === 'error') sp.renderStatus = 'pending';
      sp.stageLabel = opts?.allowFallbackOnError
        ? 'Dùng tư liệu dự phòng để ghép MP4...'
        : 'Đang khởi tạo lại tiến trình phân cảnh...';
      sp.updatedAt = Date.now();
    }
  }

  job.status = 'queued';
  job.error = undefined;
  job.stepLabel = opts?.allowFallbackOnError
    ? 'Đang bỏ qua cảnh lỗi (dùng ảnh/tư liệu dự phòng) & ghép xuất MP4...'
    : 'Đang khởi tạo lại tiến trình (giữ nguyên các phân cảnh đã xong) & ghép xuất MP4...';

  void runDerivativePipeline(job, job.paramsSnapshot, opts).catch((err: any) => {
    job.isRunning = false;
    job.status = 'error';
    job.error = formatGeminiError(err);
    job.stepLabel = 'Tạo video thất bại';
  });

  return job;
}
