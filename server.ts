import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { createRequire } from 'module';
import {
  detectPlatformFromUrl,
  queryTrendingFeed,
  searchVideosAcrossPlatforms,
  SearchSortOption,
  translateTitlesBatch,
  TrendingPlatformId,
  VideoPlatform,
} from './server/trending';
import {
  AiProviderId,
  analyzeCharactersFivePartProfiles,
  analyzeSampleVideoAndLearnStyle,
  appendStudioUploadChunk,
  BrollSourceId,
  CharacterFivePartProfile,
  completeStudioChunkedUpload,
  deleteLearnedVideoStyle,
  deleteStudioCharacterLibraryItem,
  deleteStudioProjectProfile,
  DerivativeAspectRatio,
  DerivativeBlueprint,
  derivativeJobs,
  DerivativeMusicMode,
  DerivativeOutputLanguage,
  DerivativeSourceInput,
  DerivativeStylePreset,
  DerivativeVisualMode,
  DerivativeVoiceId,
  DerivativeVoiceMode,
  detectOfflineTtsEngine,
  generateSceneVideoWithOmniFlash,
  generateStudioImage,
  generateStudioMusicWithLyria,
  getStudioAsset,
  importRenderedJobAsLibraryAsset,
  initStudioChunkedUpload,
  analyzeReferenceVideosToIdeaPrompt,
  expandStudioIdeaWithAi,
  installAndWarmupVieNeu,
  learnAndCreateIndependentBatch,
  learnVideosAndCreateBlueprint,
  listLearnedVideoStyles,
  listStudioCharacterLibrary,
  listStudioLibraryVideos,
  listStudioProjectProfiles,
  listVieNeuVoices,
  saveStudioCharacterLibraryItem,
  saveStudioProjectProfile,
  saveUploadedStudioAudio,
  saveUploadedStudioVideo,
  saveUploadedStudioVideoFromDisk,
  searchPublicFreeMusicFromWikimedia,
  startDerivativeVideoJob,
  StudioCreationMode,
  StudioScriptMode,
  StudioVideoStyle,
  synthesizeGeminiVoicePreview,
  synthesizeOfflineVoicePreview,
  testAiProviderConnection,
} from './server/derivative';
import {
  addMuse2ApiAccount,
  autoStartLocalMuse2ApiOnServerBoot,
  deleteMuse2ApiAccount,
  getMuse2ApiStatus,
  keepaliveAllMuse2ApiAccounts,
  keepaliveMuse2ApiAccount,
  listMuse2ApiAccounts,
  listMuse2ApiMedia,
  listMuse2ApiTasks,
  patchMuse2ApiAccount,
  quotaMuse2ApiAccount,
  setMuse2ApiRuntimeOverride,
  startLocalMuse2ApiProcess,
  stopLocalMuse2ApiProcess,
  testMuse2ApiAccount,
} from './server/muse2api';
import {
  addGeminiAccount,
  deleteGeminiAccount,
  getGeminiPoolSummary,
  listGeminiAccountsPublic,
  setChairmanGeminiAccount,
  testGeminiAccountConnection,
  updateGeminiAccount,
} from './server/geminiPool';
import {
  chatWithXingchi,
  fetchXingchiModels,
  generateImageWithXingchi,
  getXingchiPublicStatus,
  importXingchiTomlConfig,
  testXingchiConnection,
  updateXingchiConfig,
} from './server/xingchiApi';
import {
  chatWithAlibabaModelStudio,
  fetchAlibabaModels,
  getAlibabaModelStudioStatus,
  testAlibabaModelStudioConnection,
  updateAlibabaConfig,
} from './server/alibabaModelStudio';
import {
  analyzeAndDirectWithChairman,
  commandIncidentAction,
  controlProductionRun,
  controlTask,
  createEmptyProductionSession,
  createManualBackup,
  createManualTask,
  executeChairmanPlanOption,
  getBackupExportFilePath,
  getCommandCenterState,
  getGoogleFlowScriptBundle,
  handoffSessionToCloud,
  importGoogleFlowSceneVideo,
  initCommandCenter,
  reportCommandCenterIncident,
  resolveArtifactDiskPath,
  resolveSceneQaManual,
  restoreBackupById,
  restoreProjectMemorySnapshot,
  searchCommandCenterArchive,
  selectProductionRun,
  sendCommandCenterChat,
  setRunVideoEngine,
  startProductionOrchestration,
  subscribeCommandCenterEvents,
  triggerSceneVideoNow,
  unstickProductionRun,
  updateChairmanConfig,
  syncStudioDirectiveToCommandCenter,
  testMuseAgentConnection,
  updateCloudConfig,
  updateMuseAgentConfig,
  updateSessionWorkforceConfig,
  uploadCommandCenterAttachment,
} from './server/commandCenter';
import {
  extractBearerToken,
  fetchSessionDriveAndSheetReport,
  generateAppsScriptBridgeCode,
  getAppsScriptSessionStatus,
  getPublicWorkspaceConfig,
  handleAppsScriptDispatch,
  initializeWorkspaceSync,
  pullQueuedCommandsFromGoogleSheets,
  pushSessionToGoogleWorkspace,
  verifyAppsScriptSecret,
} from './server/googleWorkspaceSync';
import {
  autoDistributeAndRunSessions,
  bulkUpdateSessionVideoSource,
  checkAllAiReadiness,
  claimNextFlowJobFromCenter,
  createSessionFromStudio,
  deleteCoordinationSession,
  extractGoogleBearerToken,
  extractOptionalGoogleBearerToken,
  failFlowBridgeTask,
  getActiveWorkerTelemetry,
  getCoordinationCenterState,
  initCoordinationWorkspace,
  pauseMultipleSessions,
  pauseSessionRun,
  postMeetingRoomMessage,
  readLiveSessionFromGoogleSheets,
  regenerateSceneImageAndContinue,
  resolveCoordinationArtifactPath,
  retryCoordinationTask,
  runSingleCoordinationTask,
  selectCoordinationSession,
  startAllQueuedSessionsSequential,
  startParallelSessionsRun,
  startSessionSequentialRun,
  subscribeCoordinationEvents,
  syncSessionToGoogleWorkspace,
  updateSessionVideoSource,
  uploadFlowClipForTask,
} from './server/coordinationCenter';
import {
  buildFlowBridgeExtensionFiles,
  getFlowBridgeStatus,
  recordFlowBridgeHeartbeat,
  rotateFlowBridgeToken,
  verifyFlowBridgeToken,
  writeFlowBridgeExtensionToWorkspace,
} from './server/flowBridge';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver') as {
  ZipArchive: new (options?: { zlib?: { level?: number } }) => import('archiver').Archiver;
};

const appUrlEnv = String(process.env.APP_URL || '').trim();
const isHostedAiStudio =
  Boolean(process.env.K_SERVICE) ||
  (Boolean(appUrlEnv) && appUrlEnv !== 'MY_APP_URL' && appUrlEnv.startsWith('http'));
const PORT = isHostedAiStudio ? 3000 : Number(process.env.PORT) || 6868;
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'bili-downloads');
const RAW_CACHE_DIR = path.join(DOWNLOAD_DIR, 'raw_cache');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_CACHE_DIR)) {
  fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });
}

// Clean up any abandoned temp files in C:\...\Temp\bili-downloads from previous closed runs
function cleanupStaleFilesOnStartup(): void {
  try {
    for (const entry of fs.readdirSync(DOWNLOAD_DIR)) {
      if (entry === 'raw_cache') continue;
      const fullPath = path.join(DOWNLOAD_DIR, entry);
      try {
        const st = fs.statSync(fullPath);
        if (st.isFile()) {
          fs.unlink(fullPath, () => {});
        }
      } catch {
        // ignore
      }
    }
    const staleRawCutoff = Date.now() - 60 * 60 * 1000;
    for (const entry of fs.readdirSync(RAW_CACHE_DIR)) {
      const dirPath = path.join(RAW_CACHE_DIR, entry);
      try {
        const st = fs.statSync(dirPath);
        const metaExists = fs.existsSync(path.join(dirPath, 'meta.json'));
        if (st.isDirectory() && (!metaExists || st.mtimeMs < staleRawCutoff)) {
          fs.rm(dirPath, { recursive: true, force: true }, () => {});
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
cleanupStaleFilesOnStartup();

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let cachedBuvidCookie = '';
let cachedBuvidExpiresAt = 0;

async function getBuvidCookie(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedBuvidCookie && Date.now() < cachedBuvidExpiresAt) {
    return cachedBuvidCookie;
  }
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://www.bilibili.com/',
      },
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      if (json.code === 0 && json.data?.b_3) {
        const b3 = json.data.b_3;
        const b4 = json.data.b_4 || '';
        const bNut = Math.floor(Date.now() / 1000);
        cachedBuvidCookie = `buvid3=${b3}; buvid4=${b4}; b_nut=${bNut}`;
        cachedBuvidExpiresAt = Date.now() + 30 * 60 * 1000;
        return cachedBuvidCookie;
      }
    }
  } catch {
    // ignore spi fetch error and fall back
  }
  return cachedBuvidCookie;
}

async function getBiliHeaders(
  sessdata?: string,
  forceRefreshCookies = false
): Promise<Record<string, string>> {
  const buvid = await getBuvidCookie(forceRefreshCookies);
  const cookies: string[] = [];
  if (buvid) cookies.push(buvid);
  if (sessdata && sessdata.trim()) {
    cookies.push(`SESSDATA=${sessdata.trim()}`);
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    Accept: 'application/json, text/plain, */*',
  };
  if (cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ');
  }
  return headers;
}

async function fetchBiliJson(url: string, sessdata?: string): Promise<any> {
  let headers = await getBiliHeaders(sessdata, false);
  let res = await fetch(url, { headers });

  if (res.status === 412) {
    headers = await getBiliHeaders(sessdata, true);
    res = await fetch(url, { headers });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bilibili từ chối yêu cầu (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Phản hồi từ Bilibili không hợp lệ');
  }
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

let cachedWbiKeys: { imgKey: string; subKey: string; expiresAt: number } | null = null;

async function getWbiKeys(sessdata?: string): Promise<{ imgKey: string; subKey: string }> {
  if (cachedWbiKeys && Date.now() < cachedWbiKeys.expiresAt) {
    return { imgKey: cachedWbiKeys.imgKey, subKey: cachedWbiKeys.subKey };
  }
  const navJson = await fetchBiliJson('https://api.bilibili.com/x/web-interface/nav', sessdata);
  const imgUrl: string = navJson?.data?.wbi_img?.img_url || '';
  const subUrl: string = navJson?.data?.wbi_img?.sub_url || '';
  const imgKey = imgUrl.split('/').pop()?.split('.')[0] || '';
  const subKey = subUrl.split('/').pop()?.split('.')[0] || '';
  if (!imgKey || !subKey) {
    throw new Error('Không thể lấy khóa WBI từ Bilibili');
  }
  cachedWbiKeys = { imgKey, subKey, expiresAt: Date.now() + 30 * 60 * 1000 };
  return { imgKey, subKey };
}

function encWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string
): string {
  const orig = imgKey + subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((n) => orig[n] || '').join('').slice(0, 32);
  const currTime = Math.round(Date.now() / 1000);
  const chrFilter = /[!'()*]/g;
  const allParams: Record<string, string | number> = { ...params, wts: currTime };
  const query = Object.keys(allParams)
    .sort()
    .map((key) => {
      const val = String(allParams[key]).replace(chrFilter, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

function extractSpaceMid(urlStr: string): string | null {
  const match = urlStr.match(/space\.bilibili\.com\/(?:[a-z]{2,5}\/)?(\d+)/i);
  return match ? match[1] : null;
}

function parseLengthToSeconds(lengthStr: string): number {
  if (!lengthStr) return 0;
  const parts = lengthStr.split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

const QN_LABELS: Record<number, string> = {
  127: '8K (4320P)',
  126: 'Dolby Vision',
  125: 'HDR',
  120: '4K (2160P)',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  64: '720P',
  32: '480P',
  16: '360P',
};

interface JobState {
  jobId: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  progress: number;
  speedBytesPerSec: number;
  downloadedBytes: number;
  totalBytes: number;
  fileSize?: number;
  fileName: string;
  filePath?: string;
  rawCacheKey?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, JobState>();

interface PreparedZipState {
  zipId: string;
  zipPath: string;
  zipName: string;
  zipSize: number;
  createdAt: number;
}
const preparedZips = new Map<string, PreparedZipState>();

function deleteJobTempOutputFile(job: JobState | undefined): void {
  if (!job) return;
  if (job.filePath && fs.existsSync(job.filePath)) {
    const target = job.filePath;
    job.filePath = undefined;
    fs.unlink(target, () => {});
  }
}

function cleanupRawCacheIfUnused(cacheKey: string | undefined, finishedJobId: string): void {
  if (!cacheKey) return;
  const stillInUse = Array.from(jobs.values()).some(
    (j) =>
      j.jobId !== finishedJobId &&
      j.rawCacheKey === cacheKey &&
      (j.status === 'queued' || j.status === 'downloading' || j.status === 'processing')
  );
  if (stillInUse) return;
  const dirPath = getRawCacheDir(cacheKey);
  if (fs.existsSync(dirPath)) {
    fs.rm(dirPath, { recursive: true, force: true }, () => {});
  }
}

// Periodically clean up old jobs (> 30 min), prepared zips (> 20 min), and failed raw caches (> 60 min)
setInterval(() => {
  const jobCutoff = Date.now() - 30 * 60 * 1000;
  const zipCutoff = Date.now() - 20 * 60 * 1000;
  const rawCacheCutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < jobCutoff && job.status !== 'downloading' && job.status !== 'processing') {
      deleteJobTempOutputFile(job);
      jobs.delete(id);
    }
  }
  for (const [zipId, zip] of preparedZips.entries()) {
    if (zip.createdAt < zipCutoff) {
      if (fs.existsSync(zip.zipPath)) {
        fs.unlink(zip.zipPath, () => {});
      }
      preparedZips.delete(zipId);
    }
  }
  try {
    if (fs.existsSync(RAW_CACHE_DIR)) {
      for (const entry of fs.readdirSync(RAW_CACHE_DIR)) {
        const dirPath = path.join(RAW_CACHE_DIR, entry);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.isDirectory() && stat.mtimeMs < rawCacheCutoff) {
            fs.rm(dirPath, { recursive: true, force: true }, () => {});
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}, 5 * 60 * 1000);

interface RawCacheMeta {
  ready: boolean;
  updatedAt: number;
  files: Record<string, string>;
  width?: number;
  height?: number;
}

function getRawCacheDir(cacheKey: string): string {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return path.join(RAW_CACHE_DIR, safeKey);
}

function readValidRawCache(cacheKey: string): { cacheDir: string; meta: RawCacheMeta } | null {
  try {
    const cacheDir = getRawCacheDir(cacheKey);
    const metaPath = path.join(cacheDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as RawCacheMeta;
    if (!meta?.ready || !meta.files || typeof meta.files !== 'object') return null;
    const entries = Object.values(meta.files);
    if (entries.length === 0) return null;
    for (const filePath of entries) {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const st = fs.statSync(filePath);
      if (st.size <= 0) return null;
    }
    const now = new Date();
    fs.utimesSync(cacheDir, now, now);
    return { cacheDir, meta };
  } catch {
    return null;
  }
}

function writeRawCacheMeta(
  cacheKey: string,
  meta: Omit<RawCacheMeta, 'ready' | 'updatedAt'>
): void {
  const cacheDir = getRawCacheDir(cacheKey);
  fs.mkdirSync(cacheDir, { recursive: true });
  const payload: RawCacheMeta = {
    ...meta,
    ready: true,
    updatedAt: Date.now(),
  };
  const tmpMeta = path.join(cacheDir, `meta_${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmpMeta, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmpMeta, path.join(cacheDir, 'meta.json'));
}

function sanitizeFilename(name: string, maxLen = 140): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function resolveDownloadVideoId(
  bvid?: string,
  sourceUrl?: string,
  platform?: VideoPlatform
): string {
  const rawBvid = String(bvid || '').trim();
  const cleanFromUrl = (() => {
    const u = String(sourceUrl || '').trim();
    if (!u) return '';
    if (platform === 'bilibili' || /bilibili\.com|b23\.tv/i.test(u)) {
      const bili = extractBiliIdentifier(u);
      if (bili.bvid) return bili.bvid;
      if (bili.aid) return `av${bili.aid}`;
    }
    if (platform === 'facebook' || isFacebookUrl(u)) {
      const fbMatch =
        u.match(/\/(?:reel|reels|videos)\/(\d{5,})/i) ||
        u.match(/[?&](?:v|story_fbid)=(\d{5,})/i) ||
        u.match(/fb\.watch\/([A-Za-z0-9_-]+)/i);
      if (fbMatch?.[1]) return fbMatch[1];
    }
    if (platform === 'youtube' || /youtube\.com|youtu\.be/i.test(u)) {
      const ytId = extractYouTubeVideoId(u);
      if (ytId) return ytId;
    }
    return '';
  })();

  let candidate = rawBvid;
  if (/^bili_(BV[1-9A-HJ-NP-Za-km-z]{10}|av\d+)$/i.test(candidate)) {
    candidate = candidate.replace(/^bili_/i, '');
  } else if (/^yt_([A-Za-z0-9_-]{6,})$/i.test(candidate)) {
    candidate = candidate.replace(/^yt_/i, '');
  } else if (/^fb_(\d{5,})$/i.test(candidate)) {
    candidate = candidate.replace(/^fb_/i, '');
  }

  if (!candidate) {
    candidate = cleanFromUrl;
  } else if (
    cleanFromUrl &&
    (platform === 'facebook' || isFacebookUrl(sourceUrl || '')) &&
    /^[a-f0-9]{10}$/i.test(candidate)
  ) {
    candidate = cleanFromUrl;
  } else if (
    cleanFromUrl &&
    (platform === 'bilibili' || /bilibili\.com|b23\.tv/i.test(sourceUrl || '')) &&
    !/^(BV[1-9A-HJ-NP-Za-km-z]{10}|av\d+)$/i.test(candidate)
  ) {
    candidate = cleanFromUrl;
  }

  return sanitizeFilename(candidate, 48).replace(/\s+/g, '');
}

function buildFormattedDownloadBaseName(opts: {
  bvid?: string;
  sourceUrl?: string;
  platform?: VideoPlatform;
  title?: string;
  partTitle?: string;
}): string {
  const cleanId = resolveDownloadVideoId(opts.bvid, opts.sourceUrl, opts.platform);
  const rawJoinedTitle = opts.partTitle ? `${opts.title || ''} - ${opts.partTitle}` : opts.title || '';

  let cleanedTitle = sanitizeFilename(rawJoinedTitle, 200);
  if (cleanId) {
    const escapedId = cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleanedTitle = cleanedTitle.replace(new RegExp(`^\\[${escapedId}\\]\\s*`), '').trim();
  }

  if (!cleanId) {
    return cleanedTitle.slice(0, 140) || 'video';
  }

  const prefix = `[${cleanId}]`;
  const maxTitleLen = Math.max(20, 140 - prefix.length);
  const finalTitle = cleanedTitle ? sanitizeFilename(cleanedTitle, maxTitleLen) : 'video';
  return `${prefix}${finalTitle}`;
}

async function resolveShortUrl(rawUrl: string): Promise<string> {
  if (!rawUrl.includes('b23.tv')) return rawUrl;
  try {
    const res = await fetch(rawUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    });
    return res.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

function extractBiliIdentifier(urlStr: string): { bvid?: string; aid?: number; page?: number } {
  const bvMatch = urlStr.match(/BV[1-9A-HJ-NP-Za-km-z]{10}/);
  const avMatch = urlStr.match(/av(\d+)/i);
  let page: number | undefined;
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://www.bilibili.com/video/${urlStr}`);
    const pParam = u.searchParams.get('p');
    if (pParam && /^\d+$/.test(pParam)) {
      page = parseInt(pParam, 10);
    }
  } catch {
    // ignore URL parse error for bare IDs
  }
  return {
    bvid: bvMatch ? bvMatch[0] : undefined,
    aid: avMatch ? parseInt(avMatch[1], 10) : undefined,
    page,
  };
}

function getCandidateUrls(streamObj: any): string[] {
  if (!streamObj) return [];
  const raw: string[] = [];
  const primary = streamObj.baseUrl || streamObj.base_url || streamObj.url;
  if (primary) raw.push(primary);
  const backups = streamObj.backupUrl || streamObj.backup_url || [];
  if (Array.isArray(backups)) {
    for (const b of backups) {
      if (typeof b === 'string' && b) raw.push(b);
    }
  }
  const unique = Array.from(new Set(raw));
  // Prioritize international Akamai mirrors over mainland COS/OSS mirrors that return HTTP 567
  return unique.sort((a, b) => {
    const aAkam = a.includes('akamaized') || a.includes('mirrorakam') ? 0 : 1;
    const bAkam = b.includes('akamaized') || b.includes('mirrorakam') ? 0 : 1;
    return aAkam - bAkam;
  });
}

async function downloadSingleStreamWithRetry(
  candidates: string[],
  destPath: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number, speed: number) => void
): Promise<void> {
  let lastError: Error | null = null;

  for (let round = 0; round < Math.max(2, candidates.length * 2); round++) {
    const url = candidates[round % candidates.length];
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(new Error('Mất phản hồi từ máy chủ tải video')), 30_000);
    };

    try {
      resetStallTimer();
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        lastError = new Error(`HTTP ${res.status} khi tải luồng dữ liệu`);
        if (res.body) await res.body.cancel().catch(() => {});
        if (stallTimer) clearTimeout(stallTimer);
        continue;
      }

      const total = Number(res.headers.get('content-length') || 0);
      let downloaded = 0;
      const startTime = Date.now();
      const reader = res.body.getReader();
      const writer = fs.createWriteStream(destPath);

      try {
        while (true) {
          resetStallTimer();
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            const canContinue = writer.write(value);
            if (!canContinue) {
              await new Promise<void>((resolve) => writer.once('drain', resolve));
            }
            const elapsedSec = Math.max((Date.now() - startTime) / 1000, 0.1);
            onProgress(downloaded, total, Math.round(downloaded / elapsedSec));
          }
        }
        if (total > 0 && downloaded < total) {
          throw new Error(`Tải thiếu dữ liệu (${downloaded}/${total} bytes)`);
        }
        return;
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
        writer.end();
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }
    } catch (err: any) {
      if (stallTimer) clearTimeout(stallTimer);
      lastError = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, Math.min(2500, 500 * (round + 1))));
    }
  }

  throw lastError || new Error('Không thể tải luồng dữ liệu video');
}

async function downloadFileWithProgress(
  urls: string | string[],
  destPath: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number, speed: number) => void
): Promise<void> {
  const candidates = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('Không có đường dẫn tải dữ liệu hợp lệ');
  }

  // Probe whether CDN supports byte-range requests so long videos can download via 4 parallel connections
  let totalSize = 0;
  let supportsRange = false;
  let workingCandidates = [...candidates];

  for (const url of candidates) {
    try {
      const probe = await fetch(url, {
        headers: { ...headers, Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (probe.body) {
        await probe.body.cancel().catch(() => {});
      }
      if (probe.status === 206) {
        const cr = probe.headers.get('content-range') || '';
        const m = cr.match(/bytes\s+\d+-\d+\/(\d+)/i);
        if (m) {
          const parsedTotal = Number(m[1]);
          if (Number.isFinite(parsedTotal) && parsedTotal > 0) {
            totalSize = parsedTotal;
            supportsRange = true;
            // Prioritize working mirror first
            workingCandidates = [url, ...candidates.filter((c) => c !== url)];
            break;
          }
        }
      } else if (probe.ok) {
        const cl = Number(probe.headers.get('content-length') || 0);
        if (cl > 0) totalSize = cl;
        break;
      }
    } catch {
      // try next mirror
    }
  }

  const MIN_PARALLEL_SIZE = 4 * 1024 * 1024; // 4 MiB
  if (!supportsRange || totalSize < MIN_PARALLEL_SIZE) {
    return downloadSingleStreamWithRetry(workingCandidates, destPath, headers, onProgress);
  }

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB chunks
  const CONCURRENT_WORKERS = 4;
  const chunks: { index: number; start: number; end: number }[] = [];
  for (let start = 0, index = 0; start < totalSize; start += CHUNK_SIZE, index++) {
    chunks.push({
      index,
      start,
      end: Math.min(totalSize - 1, start + CHUNK_SIZE - 1),
    });
  }

  const chunkReceived = new Array<number>(chunks.length).fill(0);
  let totalDownloaded = 0;
  let nextChunkCursor = 0;
  const startTime = Date.now();
  let lastProgressEmit = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressEmit < 150) return;
    lastProgressEmit = now;
    const elapsedSec = Math.max((now - startTime) / 1000, 0.1);
    onProgress(totalDownloaded, totalSize, Math.round(totalDownloaded / elapsedSec));
  };

  const fh = await fs.promises.open(destPath, 'w');
  try {
    await fh.truncate(totalSize);

    const downloadOneChunk = async (chunk: { index: number; start: number; end: number }) => {
      const expectedTotal = chunk.end - chunk.start + 1;
      let lastErr: Error | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        if (chunkReceived[chunk.index] >= expectedTotal) return;
        const resumeStart = chunk.start + chunkReceived[chunk.index];
        const mirrorUrl = workingCandidates[(chunk.index + attempt) % workingCandidates.length];
        const controller = new AbortController();
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const resetStall = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(
            () => controller.abort(new Error(`Đoạn #${chunk.index + 1} bị treo kết nối`)),
            25_000
          );
        };

        try {
          resetStall();
          const res = await fetch(mirrorUrl, {
            headers: {
              ...headers,
              Range: `bytes=${resumeStart}-${chunk.end}`,
            },
            signal: controller.signal,
          });

          if (res.status !== 206 || !res.body) {
            if (res.body) await res.body.cancel().catch(() => {});
            throw new Error(`HTTP ${res.status} khi tải đoạn #${chunk.index + 1}`);
          }

          const reader = res.body.getReader();
          let writeOffset = resumeStart;

          while (true) {
            resetStall();
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              const remainingAllowed = chunk.end - writeOffset + 1;
              if (remainingAllowed <= 0) break;
              const sliceLen = Math.min(value.byteLength, remainingAllowed);
              await fh.write(value, 0, sliceLen, writeOffset);
              writeOffset += sliceLen;
              chunkReceived[chunk.index] += sliceLen;
              totalDownloaded += sliceLen;
              emitProgress(false);
            }
          }

          if (stallTimer) clearTimeout(stallTimer);
          if (chunkReceived[chunk.index] >= expectedTotal) {
            return;
          }
          lastErr = new Error(`Đoạn #${chunk.index + 1} chưa đủ dữ liệu`);
        } catch (err: any) {
          if (stallTimer) clearTimeout(stallTimer);
          lastErr = err instanceof Error ? err : new Error(String(err));
          await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
        }
      }

      throw lastErr || new Error(`Không thể tải đoạn #${chunk.index + 1}`);
    };

    const workerCount = Math.min(CONCURRENT_WORKERS, chunks.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextChunkCursor < chunks.length) {
          const idx = nextChunkCursor++;
          await downloadOneChunk(chunks[idx]);
        }
      })
    );

    emitProgress(true);
  } finally {
    await fh.close();
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const importantLines: string[] = [];
    let lineBuf = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);

      lineBuf += text;
      const lines = lineBuf.split(/\r?\n|\r/);
      lineBuf = lines.pop() || '';
      for (const ln of lines) {
        const t = ln.trim();
        if (!t) continue;
        if (!/^frame=\s*\d+/.test(t) && !/^size=\s*\d+/.test(t)) {
          importantLines.push(t);
          if (importantLines.length > 25) importantLines.shift();
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const detail =
          importantLines.length > 0 ? importantLines.slice(-8).join(' | ') : stderr.slice(-500).trim();
        reject(new Error(`FFmpeg lỗi (code ${code}): ${detail.slice(-700)}`));
      }
    });
    proc.on('error', (err) => reject(err));
  });
}

type HwH264Encoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv';

const CPU_ENCODE_THREADS = Math.max(2, Math.min(8, Math.floor(os.cpus().length * 0.65) || 2));

// Serialize heavy video re-encodes so concurrent downloads don't fight over 1 iGPU/VCN or peg CPU at 99%
let ffmpegEncodeQueueTail: Promise<void> = Promise.resolve();
function withFfmpegEncodeLock<T>(task: () => Promise<T>): Promise<T> {
  const prev = ffmpegEncodeQueueTail;
  let release!: () => void;
  ffmpegEncodeQueueTail = new Promise<void>((res) => {
    release = res;
  });
  return prev.then(task).finally(() => release());
}

function getHwH264CodecArgs(encoder: HwH264Encoder): string[] {
  if (encoder === 'h264_amf') {
    return [
      '-c:v',
      'h264_amf',
      '-usage',
      'transcoding',
      '-quality',
      'balanced',
      '-rc',
      'cqp',
      '-qp_i',
      '19',
      '-qp_p',
      '21',
      '-bf',
      '0',
      '-pix_fmt',
      'yuv420p',
    ];
  }
  if (encoder === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0', '-pix_fmt', 'yuv420p'];
  }
  // h264_qsv
  return ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '20', '-pix_fmt', 'yuv420p'];
}

let detectedHwEncoderPromise: Promise<HwH264Encoder | null> | null = null;

function detectAvailableHwH264Encoder(): Promise<HwH264Encoder | null> {
  if (detectedHwEncoderPromise) return detectedHwEncoderPromise;

  detectedHwEncoderPromise = (async () => {
    const candidates: HwH264Encoder[] = ['h264_nvenc', 'h264_amf', 'h264_qsv'];
    for (const enc of candidates) {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'color=c=black:s=256x256:d=0.1',
            '-frames:v',
            '1',
            ...getHwH264CodecArgs(enc),
            '-f',
            'null',
            '-',
          ],
          { stdio: ['ignore', 'ignore', 'ignore'] }
        );
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(false);
        }, 6000);
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      if (ok) {
        console.log(`[FFmpeg] Hardware acceleration enabled: ${enc} (CPU fallback threads=${CPU_ENCODE_THREADS})`);
        return enc;
      }
    }
    console.log(`[FFmpeg] No GPU encoder detected, using libx264 CPU (threads=${CPU_ENCODE_THREADS})`);
    return null;
  })();

  return detectedHwEncoderPromise;
}

async function runH264EncodeWithFallback(
  prefixArgs: string[],
  suffixArgs: string[],
  finalPath: string
): Promise<void> {
  return withFfmpegEncodeLock(async () => {
    const hwEncoder = await detectAvailableHwH264Encoder();
    if (hwEncoder) {
      try {
        await runFfmpeg([...prefixArgs, ...getHwH264CodecArgs(hwEncoder), ...suffixArgs, finalPath]);
        return;
      } catch (hwErr: any) {
        console.warn(
          `[FFmpeg] ${hwEncoder} failed (${hwErr?.message || 'unknown'}), falling back to libx264 CPU`
        );
        if (fs.existsSync(finalPath)) {
          try {
            fs.unlinkSync(finalPath);
          } catch {
            // ignore
          }
        }
      }
    }

    await runFfmpeg([
      ...prefixArgs,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-threads',
      String(CPU_ENCODE_THREADS),
      '-pix_fmt',
      'yuv420p',
      ...suffixArgs,
      finalPath,
    ]);
  });
}

type WatermarkMode = 'auto' | 'none' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

function probeVideoDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const [w, h] = out.trim().split('x').map(Number);
        if (w > 0 && h > 0) return resolve({ width: w, height: h });
      }
      resolve(null);
    });
    proc.on('error', () => resolve(null));
  });
}

function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', (code) => {
      resolve(code === 0 && out.trim().length > 0);
    });
    proc.on('error', () => resolve(false));
  });
}

function probeStreamCodecs(filePath: string): Promise<{ vcodec: string; acodec: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', () => {
      let vcodec = '';
      let acodec = '';
      for (const line of out.split(/\r?\n/)) {
        const [codecName, codecType] = line.trim().split(',');
        // ffprobe csv order matches -show_entries? Actually codec_name,codec_type or codec_type,codec_name depending on version; check both
        if (codecName === 'video' && codecType && !vcodec) vcodec = codecType;
        else if (codecName === 'audio' && codecType && !acodec) acodec = codecType;
        else if (codecType === 'video' && codecName && !vcodec) vcodec = codecName;
        else if (codecType === 'audio' && codecName && !acodec) acodec = codecName;
      }
      resolve({ vcodec, acodec });
    });
    proc.on('error', () => resolve({ vcodec: '', acodec: '' }));
  });
}

let ytDlpPathPromise: Promise<string> | null = null;

async function ensureYtDlpPath(): Promise<string> {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binDir = path.join(os.tmpdir(), 'bili-bin');
  const localBin = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  const legacyLinuxBin = '/tmp/bin/yt-dlp';

  if (fs.existsSync(localBin)) {
    return localBin;
  }
  if (!isWin && fs.existsSync(legacyLinuxBin)) {
    return legacyLinuxBin;
  }

  if (!ytDlpPathPromise) {
    ytDlpPathPromise = (async () => {
      // Try system yt-dlp first
      const systemFound = await new Promise<boolean>((resolve) => {
        const p = spawn('yt-dlp', ['--version'], { stdio: 'ignore', windowsHide: true });
        p.on('close', (code) => resolve(code === 0));
        p.on('error', () => resolve(false));
      });
      if (systemFound) return 'yt-dlp';

      fs.mkdirSync(binDir, { recursive: true });
      const assetName = isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp_linux';
      const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`, {
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Không thể tải công cụ yt-dlp (HTTP ${res.status})`);
      }
      const tmpPart = `${localBin}.tmp`;
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(tmpPart, buf);
      if (!isWin) {
        fs.chmodSync(tmpPart, 0o755);
      }
      fs.renameSync(tmpPart, localBin);
      return localBin;
    })().catch((err) => {
      ytDlpPathPromise = null;
      throw err;
    });
  }
  return ytDlpPathPromise;
}

function writeYtCookiesFile(prefix: string, rawCookies?: string): string | null {
  const trimmed = (rawCookies || '').trim();
  if (!trimmed) return null;

  let content = '';
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      if (Array.isArray(list) && list.length > 0) {
        const lines = ['# Netscape HTTP Cookie File'];
        for (const item of list) {
          const name = String(item?.name || '').trim();
          const value = String(item?.value ?? '').trim();
          const domain = String(item?.domain || '').trim();
          if (!name || !domain) continue;
          const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const pathVal = String(item?.path || '/');
          const secureVal = item?.secure ? 'TRUE' : 'FALSE';
          const expVal = item?.expirationDate ? String(Math.floor(Number(item.expirationDate))) : '0';
          lines.push(`${domain}\t${includeSubdomains}\t${pathVal}\t${secureVal}\t${expVal}\t${name}\t${value}`);
        }
        if (lines.length > 1) {
          content = lines.join('\n');
        }
      }
    } catch {
      // fall through to Netscape / header parsing
    }
  }

  if (!content && (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t'))) {
    content = trimmed.startsWith('#') ? trimmed : `# Netscape HTTP Cookie File\n${trimmed}`;
  } else if (!content) {
    // Convert browser Cookie header string (k=v; k2=v2) to Netscape cookies.txt
    const headerClean = trimmed.replace(/^cookie:\s*/i, '');
    const lines = ['# Netscape HTTP Cookie File'];
    for (const part of headerClean.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!name) continue;
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
      lines.push(`.google.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
      lines.push(`.tiktok.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
      lines.push(`.facebook.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
    if (lines.length === 1) return null;
    content = lines.join('\n');
  }

  const cookiePath = path.join(DOWNLOAD_DIR, `${prefix}_yt_cookies.txt`);
  fs.writeFileSync(cookiePath, content + '\n', 'utf8');
  return cookiePath;
}

function isYouTubeUrl(urlStr: string): boolean {
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(urlStr);
}

function extractYouTubeVideoId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shortsMatch = u.pathname.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // ignore
  }
  return null;
}

function parseYtdlpSizeToBytes(numStr: string, unit: string): number {
  const n = parseFloat(numStr);
  if (!Number.isFinite(n)) return 0;
  const u = unit.toLowerCase();
  if (u.startsWith('k')) return Math.round(n * 1024);
  if (u.startsWith('m')) return Math.round(n * 1024 * 1024);
  if (u.startsWith('g')) return Math.round(n * 1024 * 1024 * 1024);
  return Math.round(n);
}

function runYtDlpJson(ytDlpBin: string, args: string[], timeoutMs = 45_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Hết thời gian chờ phản hồi từ nền tảng video'));
    }, timeoutMs);

    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout));
          return;
        } catch {
          // fall through
        }
      }
      const errMsg = stderr.trim() || `yt-dlp thất bại (code ${code})`;
      reject(new Error(errMsg));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseUploadDateToUnix(uploadDate?: string): number {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return 0;
  const y = parseInt(uploadDate.slice(0, 4), 10);
  const m = parseInt(uploadDate.slice(4, 6), 10) - 1;
  const d = parseInt(uploadDate.slice(6, 8), 10);
  return Math.floor(Date.UTC(y, m, d) / 1000);
}

async function inspectYouTubeUrl(rawUrl: string, ytCookies?: string): Promise<any[]> {
  const ytDlpBin = await ensureYtDlpPath();
  const tempCookiePath = writeYtCookiesFile(`inspect_${crypto.randomBytes(4).toString('hex')}`, ytCookies);
  const cookieArgs = tempCookiePath ? ['--cookies', tempCookiePath] : [];

  const defaultYtQualities = [
    { qn: 120, label: '4K (2160P)' },
    { qn: 116, label: '1080P60' },
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];

  try {
    const normalizedUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const videoId = extractYouTubeVideoId(normalizedUrl);
    const isPlaylistOrChannel =
      !videoId ||
      /youtube\.com\/(?:playlist\b|@|channel\/|c\/|user\/)/i.test(normalizedUrl);

    if (isPlaylistOrChannel) {
      const json = await runYtDlpJson(
        ytDlpBin,
        ['--flat-playlist', '--playlist-end', '150', '-J', '--no-warnings', ...cookieArgs, normalizedUrl],
        60_000
      );
      const entries: any[] = Array.isArray(json?.entries) ? json.entries : [];
      const fallbackAuthor = json?.uploader || json?.channel || json?.title || 'YouTube';
      const results: any[] = [];

      for (const entry of entries) {
        if (!entry || !entry.id) continue;
        if (entry.title === '[Private video]' || entry.title === '[Deleted video]') continue;
        const vid = String(entry.id);
        const thumbs: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
        const pic =
          thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

        results.push({
          id: `yt_${vid}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: vid,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: entry.title || vid,
          partTitle: '',
          author: entry.uploader || entry.channel || fallbackAuthor,
          duration: Math.round(Number(entry.duration || 0)),
          views: Number(entry.view_count || 0),
          pubdate: parseUploadDateToUnix(entry.upload_date),
          pic,
          sourceUrl:
            typeof entry.url === 'string' && entry.url.startsWith('http')
              ? entry.url
              : `https://www.youtube.com/watch?v=${vid}`,
          availableQualities: defaultYtQualities,
        });
      }

      if (results.length === 0) {
        throw new Error('Không tìm thấy video công khai nào trong danh sách phát hoặc kênh YouTube này.');
      }
      return results;
    }

    // Single video: try yt-dlp -J first, fallback to oEmbed if datacenter IP is challenged without cookies
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const info = await runYtDlpJson(
        ytDlpBin,
        ['--no-playlist', '--js-runtimes', 'node', '-J', '--no-warnings', ...cookieArgs, normalizedUrl],
        25_000
      );
      const formats: any[] = Array.isArray(info?.formats) ? info.formats : [];
      const maxHeights = new Set<number>();
      let hasHighFps1080 = false;
      for (const f of formats) {
        if (f?.vcodec && f.vcodec !== 'none' && Number(f.height) > 0) {
          const h = Number(f.height);
          maxHeights.add(h);
          if (h >= 1080 && Number(f.fps) > 45) hasHighFps1080 = true;
        }
      }
      const qualities: { qn: number; label: string }[] = [];
      if ([...maxHeights].some((h) => h >= 2160)) qualities.push({ qn: 120, label: '4K (2160P)' });
      if (hasHighFps1080) qualities.push({ qn: 116, label: '1080P60' });
      if ([...maxHeights].some((h) => h >= 1080)) qualities.push({ qn: 80, label: '1080P' });
      if ([...maxHeights].some((h) => h >= 720)) qualities.push({ qn: 64, label: '720P' });
      if ([...maxHeights].some((h) => h >= 480)) qualities.push({ qn: 32, label: '480P' });
      if ([...maxHeights].some((h) => h >= 360)) qualities.push({ qn: 16, label: '360P' });

      return [
        {
          id: `yt_${videoId}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: videoId,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: info.title || videoId,
          partTitle: '',
          author: info.uploader || info.channel || 'YouTube',
          duration: Math.round(Number(info.duration || 0)),
          views: Number(info.view_count || 0),
          pubdate: parseUploadDateToUnix(info.upload_date),
          pic: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          sourceUrl: normalizedUrl,
          availableQualities: qualities.length > 0 ? qualities : defaultYtQualities,
        },
      ];
    } catch {
      // Fallback to YouTube oEmbed API (works even without cookies)
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
        { headers: { 'User-Agent': USER_AGENT } }
      );
      if (!oembedRes.ok) {
        throw new Error('Không thể lấy thông tin video YouTube (hãy kiểm tra liên kết hoặc thêm YouTube Cookies).');
      }
      const oembed = (await oembedRes.json()) as any;
      return [
        {
          id: `yt_${videoId}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: videoId,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: oembed.title || videoId,
          partTitle: '',
          author: oembed.author_name || 'YouTube',
          duration: 0,
          views: 0,
          pubdate: 0,
          pic: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          sourceUrl: normalizedUrl,
          availableQualities: defaultYtQualities,
        },
      ];
    }
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      fs.unlink(tempCookiePath, () => {});
    }
  }
}

async function inspectGenericYtDlpUrl(
  rawUrl: string,
  platform: VideoPlatform,
  rawCookies?: string
): Promise<any[]> {
  const ytDlpBin = await ensureYtDlpPath();
  const tempCookiePath = writeYtCookiesFile(`generic_${crypto.randomBytes(4).toString('hex')}`, rawCookies);
  const cookieArgs = tempCookiePath ? ['--cookies', tempCookiePath] : [];
  const defaultQualities = [
    { qn: 120, label: '4K (2160P)' },
    { qn: 116, label: '1080P60' },
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];

  try {
    const normalizedUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const info = await runYtDlpJson(
      ytDlpBin,
      ['--no-playlist', '-J', '--no-warnings', ...cookieArgs, normalizedUrl],
      28_000
    );
    const vid = String(info?.id || crypto.createHash('md5').update(normalizedUrl).digest('hex').slice(0, 10));
    return [
      {
        id: `${platform}_${vid}_${crypto.randomBytes(3).toString('hex')}`,
        platform,
        bvid: vid,
        aid: 0,
        cid: 0,
        page: 1,
        totalPages: 1,
        title: info?.title || info?.fulltitle || vid,
        partTitle: '',
        author: info?.uploader || info?.creator || info?.channel || platform,
        duration: Math.round(Number(info?.duration || 0)),
        views: Number(info?.view_count || 0),
        pubdate: parseUploadDateToUnix(info?.upload_date) || Number(info?.timestamp || 0),
        pic: info?.thumbnail || '',
        sourceUrl: normalizedUrl,
        availableQualities: defaultQualities,
      },
    ];
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      fs.unlink(tempCookiePath, () => {});
    }
  }
}

function isFacebookUrl(urlStr: string): boolean {
  return /(?:facebook\.com|fb\.watch|(?:^|\/)fb\.com\/)/i.test(urlStr);
}

function buildFacebookCookieHeader(rawCookies?: string): string {
  const trimmed = (rawCookies || '').trim();
  if (!trimmed) return '';
  const pairs: string[] = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      for (const item of list) {
        const domain = String(item?.domain || '').toLowerCase();
        if (domain && !domain.includes('facebook.com') && !domain.includes('fb.com')) continue;
        const name = String(item?.name || '').trim();
        const value = String(item?.value ?? '').trim();
        if (name) pairs.push(`${name}=${value}`);
      }
      if (pairs.length > 0) return pairs.join('; ');
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const cols = l.split('\t');
      if (cols.length >= 7) {
        const domain = (cols[0] || '').toLowerCase();
        if (domain.includes('facebook.com') || domain.includes('fb.com')) {
          const name = cols[5].trim();
          const value = cols.slice(6).join('\t').trim();
          if (name) pairs.push(`${name}=${value}`);
        }
      }
    }
    return pairs.join('; ');
  }

  return trimmed.replace(/^cookie:\s*/i, '');
}

function normalizeFacebookUrl(rawUrl: string): string {
  const withProto = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  try {
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    if (
      host === 'm.facebook.com' ||
      host === 'mbasic.facebook.com' ||
      host === 'web.facebook.com' ||
      host === 'touch.facebook.com' ||
      host === 'l.facebook.com'
    ) {
      u.hostname = 'www.facebook.com';
    }
    const stripParams = [
      'mibextid',
      'rdid',
      'share_url',
      'fs',
      '__tn__',
      'ref',
      'refsrc',
      'paipv',
      'eav',
    ];
    for (const p of stripParams) u.searchParams.delete(p);
    for (const key of Array.from(u.searchParams.keys())) {
      if (key.startsWith('__cft__')) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return withProto;
  }
}

async function resolveFacebookShareUrl(rawUrl: string, rawCookies?: string): Promise<string> {
  const normalized = normalizeFacebookUrl(rawUrl);
  if (!/(?:fb\.watch|facebook\.com\/share\/|fb\.com\/)/i.test(normalized)) {
    return normalized;
  }
  try {
    const fbCookie = buildFacebookCookieHeader(rawCookies);
    const res = await fetch(normalized, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(fbCookie ? { Cookie: fbCookie } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.url && res.url.startsWith('http') && !res.url.includes('/login')) {
      return normalizeFacebookUrl(res.url);
    }
  } catch {
    // ignore redirect failure and pass original normalized URL to yt-dlp
  }
  return normalized;
}

function unescapeFbJsonString(s: string): string {
  return s
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractFacebookIdFromUrl(urlStr: string): string {
  const m =
    urlStr.match(/\/(?:reel|reels|videos)\/(\d{5,})/i) ||
    urlStr.match(/[?&](?:v|story_fbid)=(\d{5,})/i) ||
    urlStr.match(/fb\.watch\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  return crypto.createHash('md5').update(urlStr).digest('hex').slice(0, 10);
}

async function extractFacebookFallbackFromHtml(
  urlStr: string,
  rawCookies?: string
): Promise<{
  id: string;
  title: string;
  author: string;
  pic: string;
  duration: number;
  hdUrl?: string;
  sdUrl?: string;
  loginRequired?: boolean;
} | null> {
  const fbCookie = buildFacebookCookieHeader(rawCookies);
  const normalized = normalizeFacebookUrl(urlStr);
  const candidates = [normalized];
  if (normalized.includes('www.facebook.com')) {
    candidates.push(normalized.replace('www.facebook.com', 'mbasic.facebook.com'));
  }

  for (const target of candidates) {
    try {
      const res = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          ...(fbCookie ? { Cookie: fbCookie } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html) continue;

      const isLoginWall =
        res.url.includes('/login') ||
        (/id="login_form"|name="login"|Log into Facebook|Đăng nhập Facebook/i.test(html) &&
          !/(?:browser_native_hd_url|browser_native_sd_url|playable_url|og:video)/i.test(html));

      const matchFirst = (patterns: RegExp[]): string => {
        for (const p of patterns) {
          const m = html.match(p);
          if (m?.[1]) return unescapeFbJsonString(m[1]).trim();
        }
        return '';
      };

      const hdUrl = matchFirst([
        /"browser_native_hd_url"\s*:\s*"([^"]+)"/i,
        /"playable_url_quality_hd"\s*:\s*"([^"]+)"/i,
        /"hd_src_no_ratelimit"\s*:\s*"([^"]+)"/i,
        /"hd_src"\s*:\s*"([^"]+)"/i,
      ]);

      const sdUrl = matchFirst([
        /"browser_native_sd_url"\s*:\s*"([^"]+)"/i,
        /"playable_url"\s*:\s*"([^"]+)"/i,
        /"sd_src_no_ratelimit"\s*:\s*"([^"]+)"/i,
        /"sd_src"\s*:\s*"([^"]+)"/i,
        /<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
      ]);

      const rawTitle = matchFirst([
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
        /<title>([^<]+)<\/title>/i,
      ]);
      const rawPic = matchFirst([
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /"preferred_thumbnail"\s*:\s*\{[^}]*"image"\s*:\s*\{[^}]*"uri"\s*:\s*"([^"]+)"/i,
      ]);
      const rawAuthor = matchFirst([
        /"ownerName"\s*:\s*"([^"]+)"/i,
        /"author_name"\s*:\s*"([^"]+)"/i,
        /"actors"\s*:\s*\[\s*\{\s*"__typename"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"([^"]+)"/i,
      ]);
      const durMsMatch = html.match(/"playable_duration_in_ms"\s*:\s*(\d+)/i);
      const duration = durMsMatch ? Math.round(Number(durMsMatch[1]) / 1000) : 0;

      if (hdUrl || sdUrl) {
        const cleanTitle = decodeHtmlEntities(rawTitle)
          .replace(/\s*\|\s*Facebook$/i, '')
          .trim();
        const vid = extractFacebookIdFromUrl(res.url || normalized);
        return {
          id: vid,
          title: cleanTitle || `Facebook Video ${vid}`,
          author: decodeHtmlEntities(rawAuthor) || 'Facebook',
          pic: decodeHtmlEntities(rawPic),
          duration,
          hdUrl: hdUrl ? decodeHtmlEntities(hdUrl) : undefined,
          sdUrl: sdUrl ? decodeHtmlEntities(sdUrl) : undefined,
          loginRequired: false,
        };
      }

      if (isLoginWall) {
        return {
          id: extractFacebookIdFromUrl(normalized),
          title: '',
          author: 'Facebook',
          pic: '',
          duration: 0,
          loginRequired: true,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

interface FbExtractedVideoEntry {
  id: string;
  title: string;
  author: string;
  pic: string;
  duration: number;
  pubdate: number;
  sourceUrl: string;
  maxHeight: number;
}

function parseFacebookCookiesList(
  rawCookies?: string
): { name: string; value: string; domain: string; path: string }[] {
  const trimmed = (rawCookies || '').trim();
  if (!trimmed) return [];
  const out: { name: string; value: string; domain: string; path: string }[] = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      for (const item of list) {
        const domain = String(item?.domain || '.facebook.com').toLowerCase();
        if (domain && !domain.includes('facebook.com') && !domain.includes('fb.com')) continue;
        const name = String(item?.name || '').trim();
        const value = String(item?.value ?? '').trim();
        if (name) {
          out.push({
            name,
            value,
            domain: domain.startsWith('.') ? domain : `.${domain}`,
            path: String(item?.path || '/'),
          });
        }
      }
      if (out.length > 0) return out;
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const cols = l.split('\t');
      if (cols.length >= 7) {
        const domain = (cols[0] || '').toLowerCase();
        if (domain.includes('facebook.com') || domain.includes('fb.com')) {
          const name = cols[5].trim();
          const value = cols.slice(6).join('\t').trim();
          if (name) {
            out.push({
              name,
              value,
              domain: domain.startsWith('.') ? domain : `.${domain}`,
              path: cols[2]?.trim() || '/',
            });
          }
        }
      }
    }
    if (out.length > 0) return out;
  }

  const header = trimmed.replace(/^cookie:\s*/i, '');
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (name) {
      out.push({ name, value, domain: '.facebook.com', path: '/' });
    }
  }
  return out;
}

function collectFacebookVideosFromJsonObject(
  parsed: any,
  upsertVideo: (entry: {
    id: string;
    title?: string;
    author?: string;
    pic?: string;
    duration?: number;
    pubdate?: number;
    sourceUrl?: string;
    maxHeight?: number;
  }) => void,
  pageAuthor: string
): void {
  const extractPublishTimeFromTracking = (tracking: unknown): number => {
    if (typeof tracking !== 'string' || !tracking.includes('publish_time')) return 0;
    const m = tracking.match(/"publish_time"\s*:\s*(\d{9,11})/);
    return m ? Number(m[1]) : 0;
  };

  const stack: any[] = [parsed];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i -= 1) {
        if (cur[i] && typeof cur[i] === 'object') stack.push(cur[i]);
      }
      continue;
    }

    // Pattern A: Facebook Reels node (short_form_video_context)
    const sfvc = cur.short_form_video_context;
    if (sfvc && typeof sfvc === 'object' && sfvc.video?.id) {
      const vid = String(sfvc.video.id);
      const pb = sfvc.playback_video || {};
      const shareUrl =
        sfvc.shareable_url ||
        sfvc.if_should_change_url_for_reels?.shareable_url ||
        pb.permalink_url ||
        `https://www.facebook.com/reel/${vid}`;
      const pic =
        sfvc.video.first_frame_thumbnail ||
        pb.thumbnailImage?.uri ||
        pb.preferred_thumbnail?.image?.uri ||
        '';
      const dur =
        Number(pb.length_in_second || 0) ||
        Number(sfvc.video.playable_duration_in_ms || 0) / 1000;
      const pubdate =
        Number(cur.creation_time || 0) || extractPublishTimeFromTracking(cur.tracking);
      const title =
        cur.message?.text ||
        cur.translated_message_for_viewer?.text ||
        cur.savable_title?.text ||
        sfvc.video?.title ||
        '';
      upsertVideo({
        id: vid,
        title,
        author: sfvc.video?.owner?.name || cur.actors?.[0]?.name || pageAuthor,
        pic,
        duration: dur,
        pubdate,
        sourceUrl: shareUrl,
        maxHeight: Number(pb.height || 0),
      });
    }

    // Pattern B: General Facebook Video / Videos tab node
    const rawVid = cur.id || cur.video_id;
    if (
      typeof rawVid === 'string' &&
      /^\d{7,}$/.test(rawVid) &&
      (cur.playable_duration_in_ms ||
        cur.length_in_second ||
        cur.videoDeliveryLegacyFields ||
        cur.videoDeliveryResponseFragment ||
        cur.first_frame_thumbnail ||
        cur.permalink_url ||
        cur.__typename === 'Video')
    ) {
      const dur =
        Number(cur.length_in_second || 0) ||
        Number(cur.playable_duration_in_ms || 0) / 1000;
      const pic =
        cur.first_frame_thumbnail ||
        cur.thumbnailImage?.uri ||
        cur.preferred_thumbnail?.image?.uri ||
        cur.image?.uri ||
        '';
      const title =
        cur.savable_title?.text ||
        cur.message?.text ||
        cur.title?.text ||
        (typeof cur.name === 'string' ? cur.name : '');
      const perm =
        (typeof cur.permalink_url === 'string' && cur.permalink_url) ||
        (typeof cur.url === 'string' && cur.url.includes('facebook.com') ? cur.url : '');
      upsertVideo({
        id: rawVid,
        title,
        author: cur.owner?.name || pageAuthor,
        pic,
        duration: dur,
        pubdate: Number(cur.publish_time || cur.creation_time || 0),
        sourceUrl: perm,
        maxHeight: Number(cur.height || 0),
      });
    }

    for (const val of Object.values(cur)) {
      if (val && typeof val === 'object') stack.push(val);
    }
  }
}

function buildFbListItemsFromMap(
  videoMap: Map<string, FbExtractedVideoEntry>,
  pageAuthor: string,
  maxItems = 100
): any[] {
  const defaultFbQualities = [
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];

  return Array.from(videoMap.values())
    .slice(0, maxItems)
    .map((v) => {
      const labelPrefix = v.sourceUrl.includes('/reel/') ? 'Facebook Reel' : 'Facebook Video';
      const qualities =
        v.maxHeight > 0 && v.maxHeight < 720
          ? [
              { qn: 32, label: '480P' },
              { qn: 16, label: '360P' },
            ]
          : defaultFbQualities;
      return {
        id: `fb_${v.id}_${crypto.randomBytes(3).toString('hex')}`,
        platform: 'facebook',
        bvid: v.id,
        aid: 0,
        cid: 0,
        page: 1,
        totalPages: 1,
        title: v.title || `${labelPrefix} ${v.id}`,
        partTitle: '',
        author: v.author || pageAuthor,
        duration: v.duration,
        views: 0,
        pubdate: v.pubdate,
        pic: v.pic,
        sourceUrl: v.sourceUrl,
        availableQualities: qualities,
      };
    });
}

function findChromiumBrowserBinary(): string | null {
  const envCandidates = [process.env.CHROME_PATH, process.env.EDGE_PATH].filter(
    (v): v is string => Boolean(v && v.trim())
  );
  for (const p of envCandidates) {
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const winPaths = [
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ].filter(Boolean);
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

interface FbPaginationDocIds {
  reelsDocId: string;
  allVideosDocId: string;
  latestVideosDocId: string;
  fetchedAt: number;
}

let cachedFbDocIds: FbPaginationDocIds | null = null;

async function resolveFacebookPaginationDocIds(html: string): Promise<{
  reelsDocId: string;
  allVideosDocId: string;
  latestVideosDocId: string;
}> {
  const now = Date.now();
  if (cachedFbDocIds && now - cachedFbDocIds.fetchedAt < 30 * 60 * 1000) {
    return {
      reelsDocId: cachedFbDocIds.reelsDocId,
      allVideosDocId: cachedFbDocIds.allVideosDocId,
      latestVideosDocId: cachedFbDocIds.latestVideosDocId,
    };
  }

  let reelsDocId = '29259931620295125';
  let allVideosDocId = '29643863005208862';
  let latestVideosDocId = '28893630133641002';

  const targetUrls = new Set<string>();
  for (const pm of html.matchAll(
    /<(?:link|script)[^>]+(?:href|src)="(https:\/\/static\.xx\.fbcdn\.net\/rsrc\.php\/[^"]+\.js[^"]*)"/g
  )) {
    targetUrls.add(pm[1].replace(/&amp;/g, '&'));
  }

  // Also resolve JS bundles mapped to Reels/Videos root components via rsrcMap/compMap
  const rsrcMap: Record<string, any> = {};
  const compMap: Record<string, any> = {};
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html)) !== null) {
    const b = sm[1]?.trim();
    if (!b || !b.startsWith('{') || (!b.includes('rsrcMap') && !b.includes('compMap'))) continue;
    try {
      const stack: any[] = [JSON.parse(b)];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (cur.rsrcMap && typeof cur.rsrcMap === 'object') Object.assign(rsrcMap, cur.rsrcMap);
        if (cur.compMap && typeof cur.compMap === 'object') Object.assign(compMap, cur.compMap);
        for (const v of Array.isArray(cur) ? cur : Object.values(cur)) {
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    } catch {
      // ignore malformed script JSON
    }
  }

  for (const compName of [
    'ProfileCometCollectionRoot.react',
    'CometProfilePlusVideosRoot.react',
    'ProfileCometRoot.react',
  ]) {
    const rList: string[] = Array.isArray(compMap[compName]?.r) ? compMap[compName].r : [];
    for (const rk of rList) {
      const entry = rsrcMap[rk];
      if (entry?.type === 'js' && typeof entry.src === 'string') {
        targetUrls.add(entry.src);
      }
    }
  }

  const urlsToFetch = Array.from(targetUrls).slice(0, 28);
  let foundAny = false;
  await Promise.all(
    urlsToFetch.map(async (jsUrl) => {
      try {
        const r = await fetch(jsUrl, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const js = await r.text();
        const reelsM = js.match(
          /"ProfileCometAppCollectionReelsRendererPaginationQuery_facebookRelayOperation",\s*\[\],\s*\(function\([^)]*\)\{[^}]{0,60}="(\d{10,25})"/
        );
        if (reelsM?.[1]) {
          reelsDocId = reelsM[1];
          foundAny = true;
        }
        const allVidM = js.match(
          /"PagesCometChannelTabAllVideosCardImplPaginationQuery_facebookRelayOperation",\s*\[\],\s*\(function\([^)]*\)\{[^}]{0,60}="(\d{10,25})"/
        );
        if (allVidM?.[1]) {
          allVideosDocId = allVidM[1];
          foundAny = true;
        }
        const latestVidM = js.match(
          /"CometChannelTabLatestVideosCardPaginationQuery_facebookRelayOperation",\s*\[\],\s*\(function\([^)]*\)\{[^}]{0,60}="(\d{10,25})"/
        );
        if (latestVidM?.[1]) {
          latestVideosDocId = latestVidM[1];
          foundAny = true;
        }
      } catch {
        // ignore single bundle fetch failure
      }
    })
  );

  if (foundAny) {
    cachedFbDocIds = { reelsDocId, allVideosDocId, latestVideosDocId, fetchedAt: now };
  }
  return { reelsDocId, allVideosDocId, latestVideosDocId };
}

async function extractFacebookListViaBrowserCdp(
  urlStr: string,
  rawCookies?: string,
  maxItems = 100
): Promise<{
  items: any[];
  pageAuthor: string;
}> {
  const browserBin = findChromiumBrowserBinary();
  if (!browserBin || typeof (globalThis as any).WebSocket !== 'function') {
    return { items: [], pageAuthor: 'Facebook' };
  }

  const normalized = normalizeFacebookUrl(urlStr);
  const isReelTab = /(?:reels(?:_tab)?|owner_reels)/i.test(normalized);
  const tempProfileDir = path.join(
    os.tmpdir(),
    `bilibatch_fb_cdp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  );
  fs.mkdirSync(tempProfileDir, { recursive: true });

  let browserProc: ReturnType<typeof spawn> | null = null;
  let ws: any = null;

  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${tempProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--disable-background-networking',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,900',
      'about:blank',
    ];

    browserProc = spawn(browserBin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    const debugPort = await new Promise<number | null>((resolve) => {
      let resolved = false;
      let errBuf = '';
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 10_000);

      browserProc?.stderr?.on('data', (chunk: Buffer) => {
        errBuf += chunk.toString();
        const m = errBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//i);
        if (m?.[1] && !resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      browserProc?.on('exit', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
    });

    if (!debugPort) {
      return { items: [], pageAuthor: 'Facebook' };
    }

    const targetsRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(4000),
    });
    const targets: any[] = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0];
    if (!pageTarget?.webSocketDebuggerUrl) {
      return { items: [], pageAuthor: 'Facebook' };
    }

    const WsCtor = (globalThis as any).WebSocket;
    ws = new WsCtor(pageTarget.webSocketDebuggerUrl);

    let msgId = 0;
    const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
    const gqlRequestIds = new Set<string>();
    const videoMap = new Map<string, FbExtractedVideoEntry>();
    let pageAuthor = 'Facebook';

    const upsertVideo = (entry: {
      id: string;
      title?: string;
      author?: string;
      pic?: string;
      duration?: number;
      pubdate?: number;
      sourceUrl?: string;
      maxHeight?: number;
    }) => {
      if (!entry.id || !/^\d{6,}$/.test(entry.id)) return;
      const prev = videoMap.get(entry.id);
      const cleanTitle = (entry.title || '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      videoMap.set(entry.id, {
        id: entry.id,
        title: (prev?.title && prev.title.length >= cleanTitle.length ? prev.title : cleanTitle) || '',
        author: entry.author || prev?.author || pageAuthor,
        pic: entry.pic || prev?.pic || '',
        duration: Math.max(prev?.duration || 0, Math.round(entry.duration || 0)),
        pubdate: Math.max(prev?.pubdate || 0, Math.round(entry.pubdate || 0)),
        sourceUrl:
          (entry.sourceUrl && entry.sourceUrl.includes('/reel/') ? entry.sourceUrl : '') ||
          prev?.sourceUrl ||
          entry.sourceUrl ||
          (isReelTab
            ? `https://www.facebook.com/reel/${entry.id}`
            : `https://www.facebook.com/watch/?v=${entry.id}`),
        maxHeight: Math.max(prev?.maxHeight || 0, Math.round(entry.maxHeight || 0)),
      });
    };

    const sendCdp = (method: string, params: Record<string, any> = {}, timeoutMs = 8000) =>
      new Promise<any>((resolve, reject) => {
        if (!ws || ws.readyState !== 1) {
          reject(new Error('CDP socket closed'));
          return;
        }
        const id = ++msgId;
        const t = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(t);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(t);
            reject(e);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
      ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.addEventListener('error', (err: any) => {
        clearTimeout(t);
        reject(err);
      });
    });

    ws.addEventListener('message', (evt: any) => {
      try {
        const msg = JSON.parse(String(evt.data || ''));
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
          else p.resolve(msg.result);
          return;
        }
        if (msg.method === 'Network.responseReceived') {
          const rUrl = String(msg.params?.response?.url || '');
          if (rUrl.includes('/api/graphql')) {
            gqlRequestIds.add(String(msg.params.requestId));
          }
        } else if (msg.method === 'Network.loadingFinished') {
          const reqId = String(msg.params?.requestId || '');
          if (gqlRequestIds.has(reqId)) {
            gqlRequestIds.delete(reqId);
            sendCdp('Network.getResponseBody', { requestId: reqId }, 5000)
              .then((bodyRes) => {
                const rawBody = String(bodyRes?.body || '').replace(/^for\s*\(;;\);/, '');
                for (const line of rawBody.split(/\r?\n/)) {
                  const trimmedLine = line.trim();
                  if (!trimmedLine.startsWith('{')) continue;
                  try {
                    const parsed = JSON.parse(trimmedLine);
                    collectFacebookVideosFromJsonObject(parsed, upsertVideo, pageAuthor);
                  } catch {
                    // ignore partial line
                  }
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        // ignore malformed message
      }
    });

    await sendCdp('Network.enable');
    await sendCdp('Page.enable');
    await sendCdp('Runtime.enable');

    const cookieList = parseFacebookCookiesList(rawCookies);
    if (cookieList.length > 0) {
      await sendCdp('Network.setCookies', {
        cookies: cookieList.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: true,
          httpOnly: false,
        })),
      }).catch(() => {});
    }

    await sendCdp('Page.navigate', { url: normalized }, 15_000);
    await new Promise((r) => setTimeout(r, 2800));

    let stagnantRounds = 0;
    const maxScrollRounds = 12;

    for (let round = 0; round < maxScrollRounds; round += 1) {
      const beforeCount = videoMap.size;

      const domEval = await sendCdp(
        'Runtime.evaluate',
        {
          returnByValue: true,
          expression: `(() => {
            try {
              const title = (document.title || '')
                .replace(/\\s*(?:\\||-|–)\\s*Facebook$/i, '')
                .replace(/(?:'s|’s)?\\s*(?:Reels|Videos)$/i, '')
                .trim();
              document.querySelectorAll('[aria-label="Close"], [aria-label="Đóng"], div[role="dialog"] [aria-label="Close"]').forEach(el => {
                try { el.click(); } catch {}
              });
              document.querySelectorAll('div[role="dialog"]').forEach(el => {
                if (/login|đăng nhập|log in|see more/i.test(el.innerText || '')) {
                  el.remove();
                }
              });
              document.documentElement.style.overflow = 'auto';
              if (document.body) document.body.style.overflow = 'auto';
              const items = [];
              const anchors = document.querySelectorAll('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/?v="]');
              anchors.forEach(a => {
                const href = a.href || '';
                const m = href.match(/\\/(?:reel|videos)\\/(\\d{6,})/) || href.match(/[?&]v=(\\d{6,})/);
                if (!m) return;
                const img = a.querySelector('img');
                const aria = (a.getAttribute('aria-label') || a.innerText || (img && img.alt) || '').trim();
                items.push({
                  id: m[1],
                  href: href.split('?')[0],
                  pic: img ? (img.currentSrc || img.src || '') : '',
                  title: aria
                });
              });
              window.scrollTo(0, document.body.scrollHeight);
              window.scrollBy(0, 2000);
              return { title, items };
            } catch (e) {
              return { title: '', items: [] };
            }
          })()`,
        },
        6000
      ).catch(() => null);

      const domVal = domEval?.result?.value;
      if (domVal?.title && pageAuthor === 'Facebook') {
        pageAuthor = domVal.title;
      }
      if (Array.isArray(domVal?.items)) {
        for (const it of domVal.items) {
          upsertVideo({
            id: String(it.id),
            title: String(it.title || ''),
            pic: String(it.pic || ''),
            sourceUrl: String(it.href || ''),
            author: pageAuthor,
          });
        }
      }

      if (videoMap.size >= maxItems) break;

      await new Promise((r) => setTimeout(r, 1500));

      if (videoMap.size === beforeCount) {
        stagnantRounds += 1;
        if (stagnantRounds >= 3) break;
      } else {
        stagnantRounds = 0;
      }
    }

    await new Promise((r) => setTimeout(r, 500));

    return {
      items: buildFbListItemsFromMap(videoMap, pageAuthor, maxItems),
      pageAuthor,
    };
  } catch {
    return { items: [], pageAuthor: 'Facebook' };
  } finally {
    try {
      if (ws) ws.close();
    } catch {
      // ignore
    }
    try {
      if (browserProc && !browserProc.killed) browserProc.kill();
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (fs.existsSync(tempProfileDir)) {
          fs.rmSync(tempProfileDir, { recursive: true, force: true });
        }
      } catch {
        // ignore Windows temp lock
      }
    }, 1000);
  }
}

async function extractFacebookListFromHtml(
  urlStr: string,
  rawCookies?: string
): Promise<{
  items: any[];
  loginRequired: boolean;
  isGlobalReelsFeed: boolean;
}> {
  const fbCookie = buildFacebookCookieHeader(rawCookies);
  const normalized = normalizeFacebookUrl(urlStr);
  const isGlobalReelsFeed = /facebook\.com\/reels?(?:\/)?(?:[?#]|$)/i.test(normalized);
  const isReelTab = /(?:reels(?:_tab)?|owner_reels)/i.test(normalized);

  const candidates = [normalized];
  if (normalized.includes('sk=reels') && !normalized.includes('sk=reels_tab')) {
    candidates.push(normalized.replace('sk=reels', 'sk=reels_tab'));
  }

  let sawLoginWall = false;

  for (const target of candidates) {
    try {
      const res = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          ...(fbCookie ? { Cookie: fbCookie } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;

      const setCookieHeader =
        typeof (res.headers as any).getSetCookie === 'function'
          ? (res.headers as any).getSetCookie().map((c: string) => c.split(';')[0]).join('; ')
          : '';
      const combinedCookieHeader = [fbCookie, setCookieHeader].filter(Boolean).join('; ');

      const finalUrl = res.url || target;
      if (finalUrl.includes('/login')) {
        sawLoginWall = true;
        continue;
      }

      const html = await res.text();
      if (!html) continue;

      const rawTitle =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
        '';
      const pageAuthor =
        decodeHtmlEntities(rawTitle)
          .replace(/\s*(?:\||-|–)\s*Facebook$/i, '')
          .replace(/(?:'s|’s)?\s*(?:Reels|Videos)$/i, '')
          .trim() || 'Facebook';

      const videoMap = new Map<string, FbExtractedVideoEntry>();

      const upsertVideo = (entry: {
        id: string;
        title?: string;
        author?: string;
        pic?: string;
        duration?: number;
        pubdate?: number;
        sourceUrl?: string;
        maxHeight?: number;
      }) => {
        if (!entry.id || !/^\d{6,}$/.test(entry.id)) return;
        const prev = videoMap.get(entry.id);
        const cleanTitle = (entry.title || '')
          .replace(/\r?\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        videoMap.set(entry.id, {
          id: entry.id,
          title: (prev?.title && prev.title.length >= cleanTitle.length ? prev.title : cleanTitle) || '',
          author: entry.author || prev?.author || pageAuthor,
          pic: entry.pic || prev?.pic || '',
          duration: Math.max(prev?.duration || 0, Math.round(entry.duration || 0)),
          pubdate: Math.max(prev?.pubdate || 0, Math.round(entry.pubdate || 0)),
          sourceUrl:
            (entry.sourceUrl && entry.sourceUrl.includes('/reel/') ? entry.sourceUrl : '') ||
            prev?.sourceUrl ||
            entry.sourceUrl ||
            (isReelTab
              ? `https://www.facebook.com/reel/${entry.id}`
              : `https://www.facebook.com/watch/?v=${entry.id}`),
          maxHeight: Math.max(prev?.maxHeight || 0, Math.round(entry.maxHeight || 0)),
        });
      };

      let reelsCollectionId = '';
      let reelsEndCursor = '';
      let reelsHasNextPage = false;

      let videosPageId = '';
      let allVideosEndCursor = '';
      let allVideosHasNextPage = false;
      let latestVideosEndCursor = '';
      let latestVideosHasNextPage = false;

      const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let scriptMatch: RegExpExecArray | null;
      while ((scriptMatch = scriptRegex.exec(html)) !== null) {
        const body = scriptMatch[1]?.trim();
        if (!body || !body.startsWith('{')) continue;
        if (
          !body.includes('short_form_video_context') &&
          !body.includes('aggregated_fb_shorts') &&
          !body.includes('all_videos') &&
          !body.includes('latest_videos') &&
          !body.includes('playable_duration_in_ms') &&
          !body.includes('videoDeliveryLegacyFields') &&
          !body.includes('videoDeliveryResponseFragment')
        ) {
          continue;
        }
        try {
          const parsed = JSON.parse(body);
          collectFacebookVideosFromJsonObject(parsed, upsertVideo, pageAuthor);

          if (
            (!reelsCollectionId && body.includes('aggregated_fb_shorts')) ||
            (!allVideosEndCursor && body.includes('all_videos')) ||
            (!latestVideosEndCursor && body.includes('latest_videos'))
          ) {
            const stack: any[] = [parsed];
            while (stack.length > 0) {
              const cur = stack.pop();
              if (!cur || typeof cur !== 'object') continue;
              if (!reelsCollectionId && cur.id && cur.aggregated_fb_shorts?.page_info) {
                reelsCollectionId = String(cur.id);
                reelsEndCursor = String(cur.aggregated_fb_shorts.page_info.end_cursor || '');
                reelsHasNextPage = Boolean(cur.aggregated_fb_shorts.page_info.has_next_page);
              }
              if (!allVideosEndCursor && cur.id && cur.all_videos?.page_info?.end_cursor) {
                videosPageId = String(cur.id);
                allVideosEndCursor = String(cur.all_videos.page_info.end_cursor || '');
                allVideosHasNextPage = Boolean(cur.all_videos.page_info.has_next_page);
              }
              if (!latestVideosEndCursor && cur.id && cur.latest_videos?.page_info?.end_cursor) {
                if (!videosPageId) videosPageId = String(cur.id);
                latestVideosEndCursor = String(cur.latest_videos.page_info.end_cursor || '');
                latestVideosHasNextPage = Boolean(cur.latest_videos.page_info.has_next_page);
              }
              for (const v of Array.isArray(cur) ? cur : Object.values(cur)) {
                if (v && typeof v === 'object') stack.push(v);
              }
            }
          }
        } catch {
          // ignore malformed script JSON block
        }
      }

      // GraphQL pagination works BOTH logged-out (using lsd) and logged-in (using fb_dtsg + lsd + c_user) for up to 100 Reels/Videos
      const fbDtsg =
        html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ||
        html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/)?.[1] ||
        '';
      const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] || '';
      const cUser = combinedCookieHeader.match(/(?:^|;\s*)c_user=(\d+)/)?.[1] || '0';
      const hasAuthOrLsd = Boolean(lsd || fbDtsg);
      const canPaginateReels = Boolean(hasAuthOrLsd && reelsCollectionId && reelsHasNextPage && reelsEndCursor);
      const canPaginateVideos = Boolean(
        hasAuthOrLsd &&
          videosPageId &&
          ((allVideosHasNextPage && allVideosEndCursor) || (latestVideosHasNextPage && latestVideosEndCursor))
      );

      if ((canPaginateReels || canPaginateVideos) && videoMap.size < 100) {
        try {
          const { reelsDocId, allVideosDocId, latestVideosDocId } = await resolveFacebookPaginationDocIds(html);
          const pvVars: Record<string, boolean> = {};
          for (const m of html.matchAll(/"(__relay_internal__pv__[^"]+)"\s*:\s*(true|false)/g)) {
            pvVars[m[1]] = m[2] === 'true';
          }
          const rev = html.match(/"client_revision":(\d+)/)?.[1] || '';
          const hs = html.match(/"haste_session":"([^"]+)"/)?.[1] || '';

          const postFbGraphql = async (
            friendlyName: string,
            docId: string,
            variables: Record<string, any>
          ): Promise<any | null> => {
            const form = new URLSearchParams();
            if (cUser !== '0') form.set('av', cUser);
            form.set('__user', cUser);
            form.set('__a', '1');
            form.set('__comet_req', '15');
            if (hs) form.set('__hs', hs);
            if (rev) form.set('__rev', rev);
            form.set('dpr', '1');
            if (fbDtsg) form.set('fb_dtsg', fbDtsg);
            if (lsd) form.set('lsd', lsd);
            if (fbDtsg && lsd) {
              const jazoest = '2' + Array.from(lsd).reduce((s, ch) => s + ch.charCodeAt(0), 0);
              form.set('jazoest', jazoest);
            }
            form.set('fb_api_caller_class', 'RelayModern');
            form.set('fb_api_req_friendly_name', friendlyName);
            form.set('server_timestamps', 'true');
            form.set('variables', JSON.stringify(variables));
            form.set('doc_id', docId);

            const gRes = await fetch('https://www.facebook.com/api/graphql/', {
              method: 'POST',
              headers: {
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(lsd ? { 'X-FB-LSD': lsd } : {}),
                'X-FB-Friendly-Name': friendlyName,
                'X-ASBD-ID': '129477',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                Origin: 'https://www.facebook.com',
                Referer: finalUrl,
                ...(combinedCookieHeader ? { Cookie: combinedCookieHeader } : {}),
              },
              body: form.toString(),
              signal: AbortSignal.timeout(12_000),
            });
            if (!gRes.ok) return null;
            const gText = (await gRes.text()).replace(/^for\s*\(;;\);/, '');
            const firstLine = gText.split(/\r?\n/).find((l) => l.trim().startsWith('{'));
            if (!firstLine) return null;
            const gJson = JSON.parse(firstLine);
            if (gJson?.error || (Array.isArray(gJson?.errors) && gJson.errors.length > 0 && !gJson?.data)) {
              return null;
            }
            return gJson;
          };

          // 1) Paginate Reels tab (aggregated_fb_shorts) — works both logged-out and logged-in
          if (canPaginateReels) {
            let cursor = reelsEndCursor;
            let hasNext: boolean = reelsHasNextPage;
            let stagnantPages = 0;

            for (let page = 0; page < 10 && hasNext && cursor && videoMap.size < 100; page += 1) {
              const beforeSize = videoMap.size;
              const gJson = await postFbGraphql(
                'ProfileCometAppCollectionReelsRendererPaginationQuery',
                reelsDocId,
                {
                  count: 10,
                  cursor,
                  id: reelsCollectionId,
                  renderLocation: null,
                  scale: 1,
                  useDefaultActor: false,
                  ...pvVars,
                }
              );
              const agg = gJson?.data?.node?.aggregated_fb_shorts;
              if (!agg || !Array.isArray(agg.edges) || agg.edges.length === 0) break;

              collectFacebookVideosFromJsonObject(agg, upsertVideo, pageAuthor);
              cursor = String(agg.page_info?.end_cursor || '');
              hasNext = Boolean(agg.page_info?.has_next_page);
              if (videoMap.size === beforeSize) {
                stagnantPages += 1;
                if (stagnantPages >= 2) break;
              } else {
                stagnantPages = 0;
              }
              if (hasNext && cursor && videoMap.size < 100) {
                await new Promise((r) => setTimeout(r, 140));
              }
            }
          }

          // 2) Paginate Videos tab (all_videos / latest_videos)
          if (canPaginateVideos && videoMap.size < 100) {
            const videoStreams: {
              name: string;
              docId: string;
              cursor: string;
              hasNext: boolean;
              field: 'all_videos' | 'latest_videos';
            }[] = [];
            if (allVideosHasNextPage && allVideosEndCursor) {
              videoStreams.push({
                name: 'PagesCometChannelTabAllVideosCardImplPaginationQuery',
                docId: allVideosDocId,
                cursor: allVideosEndCursor,
                hasNext: allVideosHasNextPage,
                field: 'all_videos',
              });
            }
            if (latestVideosHasNextPage && latestVideosEndCursor) {
              videoStreams.push({
                name: 'CometChannelTabLatestVideosCardPaginationQuery',
                docId: latestVideosDocId,
                cursor: latestVideosEndCursor,
                hasNext: latestVideosHasNextPage,
                field: 'latest_videos',
              });
            }

            for (const stream of videoStreams) {
              let cursor = stream.cursor;
              let hasNext = stream.hasNext;
              let stagnantPages = 0;
              for (let page = 0; page < 10 && hasNext && cursor && videoMap.size < 100; page += 1) {
                const beforeSize = videoMap.size;
                const gJson = await postFbGraphql(stream.name, stream.docId, {
                  alwaysIncludeAudioRooms: false,
                  count: 9,
                  cursor,
                  id: videosPageId,
                  pageID: videosPageId,
                  scale: 1,
                  showReactions: false,
                  useDefaultActor: false,
                  ...pvVars,
                });
                const conn =
                  gJson?.data?.node?.[stream.field] ||
                  gJson?.data?.page?.[stream.field] ||
                  gJson?.data?.[stream.field];
                if (!conn || !Array.isArray(conn.edges) || conn.edges.length === 0) break;

                collectFacebookVideosFromJsonObject(conn, upsertVideo, pageAuthor);
                cursor = String(conn.page_info?.end_cursor || '');
                hasNext = Boolean(conn.page_info?.has_next_page);
                if (videoMap.size === beforeSize) {
                  stagnantPages += 1;
                  if (stagnantPages >= 2) break;
                } else {
                  stagnantPages = 0;
                }
                if (hasNext && cursor && videoMap.size < 100) {
                  await new Promise((r) => setTimeout(r, 140));
                }
              }
            }
          }
        } catch {
          // ignore pagination error and keep SSR items
        }
      }

      // Regex fallback in case Facebook served non-JSON script wrapper
      if (videoMap.size === 0) {
        const unesc = html.replace(/\\\//g, '/');
        const reelLinkRe = /facebook\.com\/reel\/(\d{7,})/gi;
        let m: RegExpExecArray | null;
        while ((m = reelLinkRe.exec(unesc)) !== null) {
          upsertVideo({
            id: m[1],
            sourceUrl: `https://www.facebook.com/reel/${m[1]}`,
          });
          if (videoMap.size >= 100) break;
        }
      }

      if (videoMap.size > 0) {
        return {
          items: buildFbListItemsFromMap(videoMap, pageAuthor, 100),
          loginRequired: false,
          isGlobalReelsFeed,
        };
      }

      if (/id="login_form"|name="login"|Log in or sign up|Log into Facebook|Đăng nhập Facebook/i.test(html)) {
        sawLoginWall = true;
      }
    } catch {
      // try next candidate
    }
  }

  return {
    items: [],
    loginRequired: sawLoginWall,
    isGlobalReelsFeed,
  };
}

function buildQualitiesFromYtdlpFormats(formats: any[] | undefined): { qn: number; label: string }[] {
  const defaultQualities = [
    { qn: 120, label: '4K (2160P)' },
    { qn: 116, label: '1080P60' },
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];
  if (!Array.isArray(formats) || formats.length === 0) return defaultQualities;

  const maxHeights = new Set<number>();
  let hasHighFps1080 = false;
  for (const f of formats) {
    if (f?.vcodec && f.vcodec !== 'none' && Number(f.height) > 0) {
      const h = Number(f.height);
      maxHeights.add(h);
      if (h >= 1080 && Number(f.fps) > 45) hasHighFps1080 = true;
    }
  }
  const qualities: { qn: number; label: string }[] = [];
  if ([...maxHeights].some((h) => h >= 2160)) qualities.push({ qn: 120, label: '4K (2160P)' });
  if (hasHighFps1080) qualities.push({ qn: 116, label: '1080P60' });
  if ([...maxHeights].some((h) => h >= 1080)) qualities.push({ qn: 80, label: '1080P' });
  if ([...maxHeights].some((h) => h >= 720)) qualities.push({ qn: 64, label: '720P' });
  if ([...maxHeights].some((h) => h >= 480)) qualities.push({ qn: 32, label: '480P' });
  if ([...maxHeights].some((h) => h >= 360)) qualities.push({ qn: 16, label: '360P' });
  return qualities.length > 0 ? qualities : defaultQualities;
}

async function inspectFacebookUrl(rawUrl: string, rawCookies?: string): Promise<any[]> {
  let ytDlpBin: string | null = null;
  try {
    ytDlpBin = await ensureYtDlpPath();
  } catch {
    ytDlpBin = null;
  }
  const tempCookiePath = writeYtCookiesFile(`fb_${crypto.randomBytes(4).toString('hex')}`, rawCookies);
  const cookieArgs = tempCookiePath ? ['--cookies', tempCookiePath] : [];
  const defaultFbQualities = [
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];

  try {
    const resolvedUrl = await resolveFacebookShareUrl(rawUrl, rawCookies);
    const isSingleVideoId =
      /\/(?:reel|reels|videos)\/\d{5,}/i.test(resolvedUrl) ||
      /[?&](?:v|story_fbid)=\d{5,}/i.test(resolvedUrl);

    // Detect bare Facebook Page or Profile URLs (e.g. facebook.com/natgeo, facebook.com/profile.php?id=12345, facebook.com/people/Name/12345)
    let listTargetUrl = resolvedUrl;
    let isBarePageOrProfile = false;
    if (!isSingleVideoId) {
      try {
        const parsedFb = new URL(resolvedUrl);
        const pathParts = parsedFb.pathname.split('/').filter(Boolean);
        const isProfilePhp = pathParts.length === 1 && pathParts[0].toLowerCase() === 'profile.php';
        const isPeopleProfile =
          pathParts.length >= 3 &&
          pathParts[0].toLowerCase() === 'people' &&
          /^\d{6,}$/.test(pathParts[2]);
        const currentSk = (parsedFb.searchParams.get('sk') || '').toLowerCase();

        if (
          isProfilePhp &&
          parsedFb.searchParams.get('id') &&
          !parsedFb.searchParams.get('v') &&
          !parsedFb.searchParams.get('story_fbid')
        ) {
          if (!currentSk) {
            parsedFb.searchParams.set('sk', 'reels_tab');
            listTargetUrl = parsedFb.toString();
            isBarePageOrProfile = true;
          } else if (currentSk === 'reels') {
            parsedFb.searchParams.set('sk', 'reels_tab');
            listTargetUrl = parsedFb.toString();
          }
        } else if (
          isPeopleProfile &&
          !parsedFb.searchParams.get('v') &&
          !parsedFb.searchParams.get('story_fbid')
        ) {
          if (!currentSk) {
            parsedFb.searchParams.set('sk', 'reels_tab');
            listTargetUrl = parsedFb.toString();
            isBarePageOrProfile = true;
          } else if (currentSk === 'reels') {
            parsedFb.searchParams.set('sk', 'reels_tab');
            listTargetUrl = parsedFb.toString();
          }
        } else if (
          pathParts.length === 1 &&
          !/^(?:profile\.php|people|watch|reel|reels|video|videos|share|story\.php|permalink\.php|photo|photo\.php|photos|posts|events|groups|marketplace|gaming|login|help|privacy|policies|sharer|plugins|dialog|l\.php|flx|r\.php|home\.php)$/i.test(
            pathParts[0]
          ) &&
          !parsedFb.searchParams.get('v') &&
          !parsedFb.searchParams.get('story_fbid')
        ) {
          listTargetUrl = `https://www.facebook.com/${pathParts[0]}/reels`;
          isBarePageOrProfile = true;
        }
      } catch {
        // ignore URL parse error
      }
    }

    const isPageOrList =
      !isSingleVideoId &&
      (isBarePageOrProfile ||
        /facebook\.com\/(?:[^/?#]+\/(?:videos|reels(?:_tab)?|owner_reels)(?:\/)?(?:[?#]|$)|groups\/[^/?#]+\/(?:videos|reels(?:_tab)?)(?:\/)?(?:[?#]|$)|people\/[^/?#]+\/\d{6,}(?:\/)?(?:[?#]|$)|profile\.php\?[^#]*\bsk=(?:videos|reels(?:_tab)?)\b|reels?(?:\/)?(?:[?#]|$)|watch\/latest)/i.test(
          listTargetUrl
        ));

    if (isPageOrList) {
      const mergeFbItemLists = (...lists: any[][]): any[] => {
        const merged = new Map<string, any>();
        for (const list of lists) {
          for (const it of list) {
            const key = String(it.bvid || it.id);
            const prev = merged.get(key);
            if (!prev) {
              merged.set(key, it);
            } else {
              merged.set(key, {
                ...prev,
                title: prev.title && !/^Facebook (?:Reel|Video) \d+$/.test(prev.title) ? prev.title : it.title,
                pic: prev.pic || it.pic,
                duration: prev.duration || it.duration,
                pubdate: prev.pubdate || it.pubdate,
                author: prev.author && prev.author !== 'Facebook' ? prev.author : it.author,
              });
            }
          }
        }
        return Array.from(merged.values()).slice(0, 100);
      };

      const htmlList = await extractFacebookListFromHtml(listTargetUrl, rawCookies);
      if (htmlList.items.length >= 25) {
        return htmlList.items;
      }

      // If /videos tab hit Facebook's anonymous rate-limit (returning only ~9 SSR items),
      // also fetch the sibling /reels tab (which paginates up to 100 videos even without cookies) and merge.
      let combinedHtmlItems = htmlList.items;
      let siblingUrl = '';
      if (/\/videos(?:\/)?(?:[?#]|$)/i.test(listTargetUrl)) {
        siblingUrl = listTargetUrl.replace(/\/videos(\/)?(?=[?#]|$)/i, '/reels');
      } else if (/[?&]sk=videos\b/i.test(listTargetUrl)) {
        siblingUrl = listTargetUrl.replace(/([?&])sk=videos\b/i, '$1sk=reels_tab');
      } else if (isBarePageOrProfile && /\/reels(?:\/)?(?:[?#]|$)/i.test(listTargetUrl)) {
        siblingUrl = listTargetUrl.replace(/\/reels(\/)?(?=[?#]|$)/i, '/videos');
      } else if (isBarePageOrProfile && /[?&]sk=reels_tab\b/i.test(listTargetUrl)) {
        siblingUrl = listTargetUrl.replace(/([?&])sk=reels_tab\b/i, '$1sk=videos');
      }

      if (siblingUrl && siblingUrl !== listTargetUrl) {
        try {
          const siblingList = await extractFacebookListFromHtml(siblingUrl, rawCookies);
          if (siblingList.items.length > 0) {
            combinedHtmlItems = mergeFbItemLists(combinedHtmlItems, siblingList.items);
            if (combinedHtmlItems.length >= 25) {
              return combinedHtmlItems;
            }
          }
        } catch {
          // ignore sibling tab failure
        }
      }

      // Use local Edge/Chrome headless CDP scroll to paginate beyond Facebook's initial ~10 SSR items
      const cdpList = await extractFacebookListViaBrowserCdp(listTargetUrl, rawCookies, 100);
      if (cdpList.items.length > 0 || combinedHtmlItems.length > 0) {
        const mergedItems = mergeFbItemLists(combinedHtmlItems, cdpList.items);
        if (mergedItems.length > 0) {
          return mergedItems;
        }
      }

      if (ytDlpBin) {
        try {
          const listJson = await runYtDlpJson(
            ytDlpBin,
            ['--flat-playlist', '--playlist-end', '100', '-J', '--no-warnings', ...cookieArgs, resolvedUrl],
            45_000
          );
        const entries: any[] = Array.isArray(listJson?.entries) ? listJson.entries : [];
        const fallbackAuthor = listJson?.uploader || listJson?.channel || listJson?.title || 'Facebook';
        const results: any[] = [];
        for (const entry of entries) {
          if (!entry) continue;
          const entryUrl =
            (typeof entry.webpage_url === 'string' && entry.webpage_url.startsWith('http') && entry.webpage_url) ||
            (typeof entry.url === 'string' && entry.url.startsWith('http') && entry.url) ||
            (entry.id ? `https://www.facebook.com/watch/?v=${entry.id}` : '');
          if (!entryUrl) continue;
          const vid = String(entry.id || extractFacebookIdFromUrl(entryUrl));
          const thumbs: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
          const pic = entry.thumbnail || thumbs[thumbs.length - 1]?.url || '';
          results.push({
            id: `fb_${vid}_${crypto.randomBytes(3).toString('hex')}`,
            platform: 'facebook',
            bvid: vid,
            aid: 0,
            cid: 0,
            page: 1,
            totalPages: 1,
            title: entry.title || entry.fulltitle || `Facebook Video ${vid}`,
            partTitle: '',
            author: entry.uploader || entry.creator || entry.channel || fallbackAuthor,
            duration: Math.round(Number(entry.duration || 0)),
            views: Number(entry.view_count || 0),
            pubdate: parseUploadDateToUnix(entry.upload_date) || Number(entry.timestamp || 0),
            pic,
            sourceUrl: entryUrl,
            availableQualities: defaultFbQualities,
          });
        }
          if (results.length > 0) return results;
        } catch {
          // fall through to clear list error below
        }
      }

      if (htmlList.isGlobalReelsFeed && !buildFacebookCookieHeader(rawCookies)) {
        throw new Error(
          'Vui lòng dán link tab Reels của một Trang/Cá nhân cụ thể (ví dụ: https://www.facebook.com/<ten_trang>/reels) hoặc dán Cookie Facebook trong Cài đặt → tab Facebook.'
        );
      }
      if (htmlList.loginRequired) {
        throw new Error(
          'Trang Facebook Reels/Videos này yêu cầu đăng nhập để lấy danh sách video. Vui lòng vào Cài đặt → tab Facebook và dán cookie facebook.com rồi thử lại.'
        );
      }
      throw new Error(
        'Không lấy được danh sách video từ trang Reels/Videos này. Hãy kiểm tra liên kết (ví dụ: https://www.facebook.com/<ten_trang>/reels) hoặc dán Cookie Facebook trong Cài đặt → tab Facebook nếu trang yêu cầu đăng nhập.'
      );
    }

    try {
      if (!ytDlpBin) {
        throw new Error('yt-dlp tạm chưa sẵn sàng');
      }
      const ytArgs = isSingleVideoId
        ? ['-J', '--no-warnings', '--no-playlist', ...cookieArgs, resolvedUrl]
        : ['-J', '--no-warnings', '--playlist-end', '30', ...cookieArgs, resolvedUrl];
      const info = await runYtDlpJson(ytDlpBin, ytArgs, isSingleVideoId ? 22_000 : 35_000);

      if (Array.isArray(info?.entries) && info.entries.length > 0) {
        const fallbackAuthor = info?.uploader || info?.channel || info?.title || 'Facebook';
        const results: any[] = [];
        for (let idx = 0; idx < info.entries.length; idx += 1) {
          const entry = info.entries[idx];
          if (!entry) continue;
          const entryUrl = normalizeFacebookUrl(
            (typeof entry.webpage_url === 'string' && entry.webpage_url.startsWith('http') && entry.webpage_url) ||
              (typeof entry.url === 'string' && entry.url.startsWith('http') && entry.url) ||
              resolvedUrl
          );
          const vid = String(entry.id || `${extractFacebookIdFromUrl(resolvedUrl)}_${idx + 1}`);
          const thumbs: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
          const pic = entry.thumbnail || thumbs[thumbs.length - 1]?.url || '';
          results.push({
            id: `fb_${vid}_${crypto.randomBytes(3).toString('hex')}`,
            platform: 'facebook',
            bvid: vid,
            aid: 0,
            cid: 0,
            page: idx + 1,
            totalPages: info.entries.length,
            title: entry.title || entry.fulltitle || info?.title || `Facebook Video ${vid}`,
            partTitle: info.entries.length > 1 ? `Clip ${idx + 1}` : '',
            author: entry.uploader || entry.creator || entry.channel || fallbackAuthor,
            duration: Math.round(Number(entry.duration || 0)),
            views: Number(entry.view_count || 0),
            pubdate: parseUploadDateToUnix(entry.upload_date) || Number(entry.timestamp || 0),
            pic,
            sourceUrl: entryUrl,
            availableQualities: buildQualitiesFromYtdlpFormats(entry.formats),
          });
        }
        if (results.length > 0) return results;
      }

      const vid = String(info?.id || extractFacebookIdFromUrl(resolvedUrl));
      const thumbs: any[] = Array.isArray(info?.thumbnails) ? info.thumbnails : [];
      const pic = info?.thumbnail || thumbs[thumbs.length - 1]?.url || '';
      return [
        {
          id: `fb_${vid}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'facebook',
          bvid: vid,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: info?.title || info?.fulltitle || `Facebook Video ${vid}`,
          partTitle: '',
          author: info?.uploader || info?.creator || info?.channel || 'Facebook',
          duration: Math.round(Number(info?.duration || 0)),
          views: Number(info?.view_count || 0),
          pubdate: parseUploadDateToUnix(info?.upload_date) || Number(info?.timestamp || 0),
          pic,
          sourceUrl: normalizeFacebookUrl(info?.webpage_url || resolvedUrl),
          availableQualities: buildQualitiesFromYtdlpFormats(info?.formats),
        },
      ];
    } catch (ytDlpErr: any) {
      const fbFallback = await extractFacebookFallbackFromHtml(resolvedUrl, rawCookies);
      if (fbFallback && (fbFallback.hdUrl || fbFallback.sdUrl)) {
        return [
          {
            id: `fb_${fbFallback.id}_${crypto.randomBytes(3).toString('hex')}`,
            platform: 'facebook',
            bvid: fbFallback.id,
            aid: 0,
            cid: 0,
            page: 1,
            totalPages: 1,
            title: fbFallback.title,
            partTitle: '',
            author: fbFallback.author,
            duration: fbFallback.duration,
            views: 0,
            pubdate: 0,
            pic: fbFallback.pic,
            sourceUrl: resolvedUrl,
            availableQualities: fbFallback.hdUrl ? defaultFbQualities : [{ qn: 32, label: '480P' }, { qn: 16, label: '360P' }],
          },
        ];
      }

      const errMsg = String(ytDlpErr?.message || '');
      if (
        fbFallback?.loginRequired ||
        /login|cookie|registered users|Private video|Cannot parse data|This video isn't available/i.test(errMsg)
      ) {
        throw new Error(
          'Video Facebook này yêu cầu đăng nhập hoặc thuộc nhóm riêng tư. Vui lòng vào Cài đặt → tab Facebook và dán cookie facebook.com rồi thử lại.'
        );
      }
      throw new Error(
        `Không thể trích xuất video Facebook (${errMsg.slice(-180) || 'vui lòng kiểm tra liên kết hoặc thêm Cookie Facebook'}).`
      );
    }
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      fs.unlink(tempCookiePath, () => {});
    }
  }
}

function buildAtempoFilter(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0 + 1e-4) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-4) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${Number(remaining.toFixed(4))}`);
  return filters.join(',');
}

function buildDelogoFilter(
  mode: WatermarkMode | undefined,
  width: number,
  height: number
): string | null {
  if (!mode || mode === 'none' || width < 64 || height < 64) return null;

  const boxW = Math.max(32, Math.round(width * 0.30));
  const boxH = Math.max(20, Math.round(height * 0.12));
  const marginX = Math.max(4, Math.round(width * 0.02));
  const marginY = Math.max(4, Math.round(height * 0.02));

  let x = marginX;
  let y = marginY;

  if (mode === 'top-right') {
    x = Math.max(2, width - boxW - marginX);
    y = marginY;
  } else if (mode === 'top-left') {
    x = marginX;
    y = marginY;
  } else if (mode === 'bottom-right') {
    x = Math.max(2, width - boxW - marginX);
    y = Math.max(2, height - boxH - marginY);
  } else if (mode === 'bottom-left') {
    x = marginX;
    y = Math.max(2, height - boxH - marginY);
  }

  const clampedW = Math.min(boxW, width - x - 2);
  const clampedH = Math.min(boxH, height - y - 2);
  if (clampedW <= 4 || clampedH <= 4) return null;

  return `delogo=x=${x}:y=${y}:w=${clampedW}:h=${clampedH}`;
}

function sampleGrayFrames(filePath: string, sampleW: number, sampleH: number): Promise<Buffer[]> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i',
      filePath,
      '-vf',
      `fps=0.4,scale=${sampleW}:${sampleH},format=gray`,
      '-vframes',
      '6',
      '-f',
      'rawvideo',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('close', () => {
      const full = Buffer.concat(chunks);
      const frameSize = sampleW * sampleH;
      const frames: Buffer[] = [];
      for (let offset = 0; offset + frameSize <= full.length; offset += frameSize) {
        frames.push(full.subarray(offset, offset + frameSize));
      }
      resolve(frames);
    });
    proc.on('error', () => resolve([]));
  });
}

async function detectWatermarkDelogoFilter(
  filePath: string,
  width: number,
  height: number
): Promise<string | null> {
  if (width < 64 || height < 64) return null;
  const SW = 640;
  const SH = 360;
  const frames = await sampleGrayFrames(filePath, SW, SH);
  if (frames.length < 3) return null;

  // Check that the center of the video has actual motion (avoid false positives on still-image videos)
  let centerDiffSum = 0;
  let centerCount = 0;
  for (let y = 100; y < 260; y += 4) {
    for (let x = 180; x < 460; x += 4) {
      const idx = y * SW + x;
      for (let t = 1; t < frames.length; t++) {
        centerDiffSum += Math.abs(frames[t][idx] - frames[t - 1][idx]);
        centerCount++;
      }
    }
  }
  const avgCenterMotion = centerCount > 0 ? centerDiffSum / centerCount : 0;
  if (avgCenterMotion < 2.2) {
    return null;
  }

  const cornerW = Math.round(SW * 0.38);
  const cornerH = Math.round(SH * 0.18);
  const corners = [
    { x0: 2, y0: 2, x1: cornerW, y1: cornerH }, // top-left
    { x0: SW - cornerW, y0: 2, x1: SW - 2, y1: cornerH }, // top-right
    { x0: 2, y0: SH - cornerH, x1: cornerW, y1: SH - 2 }, // bottom-left
    { x0: SW - cornerW, y0: SH - cornerH, x1: SW - 2, y1: SH - 2 }, // bottom-right
  ];

  const filters: string[] = [];

  for (const c of corners) {
    const rowHits = new Int32Array(SH);
    const grid = new Uint8Array(SW * SH);
    let strongHits = 0;
    const regionArea = (c.x1 - c.x0) * (c.y1 - c.y0);

    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) {
        const idx = y * SW + x;
        let diffSum = 0;
        let edgeSum = 0;
        for (let t = 0; t < frames.length; t++) {
          if (t > 0) {
            diffSum += Math.abs(frames[t][idx] - frames[t - 1][idx]);
          }
          const gx = Math.abs(frames[t][idx + 1] - frames[t][idx]);
          const gy = Math.abs(frames[t][idx + SW] - frames[t][idx]);
          edgeSum += (gx + gy) * 0.5;
        }
        const avgDiff = diffSum / (frames.length - 1);
        const avgEdge = edgeSum / frames.length;

        if (avgEdge >= 13 && avgDiff <= 9) {
          strongHits++;
        }
        if (avgEdge >= 9.5 && avgDiff <= 10) {
          grid[idx] = 1;
          rowHits[y]++;
        }
      }
    }

    if (strongHits >= 35 && strongHits <= regionArea * 0.45) {
      let peakY = -1;
      let maxR = 0;
      for (let y = c.y0; y < c.y1; y++) {
        if (rowHits[y] > maxR) {
          maxR = rowHits[y];
          peakY = y;
        }
      }
      if (peakY < 0 || maxR < 3) continue;

      let minY = peakY;
      let gap = 0;
      for (let y = peakY - 1; y >= c.y0; y--) {
        if (rowHits[y] >= 3) {
          minY = y;
          gap = 0;
        } else if (++gap > 4) {
          break;
        }
      }

      let maxY = peakY;
      gap = 0;
      for (let y = peakY + 1; y < c.y1; y++) {
        if (rowHits[y] >= 3) {
          maxY = y;
          gap = 0;
        } else if (++gap > 4) {
          break;
        }
      }

      const bandColHits = new Int32Array(SW);
      for (let x = c.x0; x < c.x1; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (grid[y * SW + x]) bandColHits[x]++;
        }
      }

      let minX = -1;
      let maxX = -1;
      for (let x = c.x0; x < c.x1; x++) {
        if (bandColHits[x] >= 1) {
          // Verify at least 1 other hit within +/- 10px to ignore isolated noise
          let nearby = 0;
          for (let nx = Math.max(c.x0, x - 10); nx <= Math.min(c.x1 - 1, x + 10); nx++) {
            if (nx !== x && bandColHits[nx] >= 1) {
              nearby++;
              break;
            }
          }
          if (nearby > 0) {
            if (minX < 0) minX = x;
            maxX = x;
          }
        }
      }
      if (minX < 0 || maxX <= minX) continue;

      if (maxX > minX && maxY > minY) {
        const padX = 8;
        const padY = 6;
        const sx0 = Math.max(1, minX - padX);
        const sy0 = Math.max(1, minY - padY);
        const sx1 = Math.min(SW - 1, maxX + padX);
        const sy1 = Math.min(SH - 1, maxY + padY);

        const fx = Math.max(2, Math.round((sx0 / SW) * width));
        const fy = Math.max(2, Math.round((sy0 / SH) * height));
        const fw = Math.min(
          Math.round(width * 0.36),
          width - fx - 2,
          Math.max(20, Math.round(((sx1 - sx0) / SW) * width))
        );
        const fh = Math.min(
          Math.round(height * 0.14),
          height - fy - 2,
          Math.max(16, Math.round(((sy1 - sy0) / SH) * height))
        );

        if (fw > 4 && fh > 4) {
          filters.push(`delogo=x=${fx}:y=${fy}:w=${fw}:h=${fh}`);
        }
      }
    }
  }

  return filters.length > 0 ? filters.join(',') : null;
}

interface CustomLogoParam {
  enabled?: boolean;
  dataUrl?: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
  scalePercent?: number;
  opacity?: number;
  margin?: number;
}

interface VideoTransformParam {
  speed?: number;
  mirror?: 'none' | 'horizontal' | 'vertical';
  zoomPercent?: number;
}

function normalizeVideoTransform(raw?: VideoTransformParam) {
  const speedRaw = typeof raw?.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : 1;
  const speed = Math.min(2.0, Math.max(0.5, Number(speedRaw.toFixed(2))));
  const mirror: 'none' | 'horizontal' | 'vertical' =
    raw?.mirror === 'horizontal' || raw?.mirror === 'vertical' ? raw.mirror : 'none';
  const zoomRaw =
    typeof raw?.zoomPercent === 'number' && Number.isFinite(raw.zoomPercent) ? raw.zoomPercent : 100;
  const zoomPercent = Math.min(150, Math.max(50, Math.round(zoomRaw)));

  return {
    speed,
    mirror,
    zoomPercent,
    hasSpeed: Math.abs(speed - 1) > 0.005,
    hasMirror: mirror !== 'none',
    hasZoom: Math.abs(zoomPercent - 100) >= 1,
  };
}

async function renderVideoWithFfmpeg(opts: {
  videoPath: string;
  separateAudioPath?: string;
  hasAudioStream: boolean;
  format: 'mp4' | 'mkv' | 'webm';
  finalPath: string;
  delogoFilter: string | null;
  dims: { width: number; height: number } | null;
  customLogoFile: string | null;
  customLogo?: CustomLogoParam;
  transform: ReturnType<typeof normalizeVideoTransform>;
  forceMp4Transcode?: boolean;
}) {
  const {
    videoPath,
    separateAudioPath,
    hasAudioStream,
    format,
    finalPath,
    delogoFilter,
    dims,
    customLogoFile,
    customLogo,
    transform,
    forceMp4Transcode,
  } = opts;

  const inputs: string[] = ['-i', videoPath];
  let audioInputIdx = 0;
  if (separateAudioPath && hasAudioStream) {
    audioInputIdx = 1;
    inputs.push('-i', separateAudioPath);
  }

  let logoInputIdx: number | null = null;
  if (customLogoFile && dims) {
    logoInputIdx = inputs.length / 2;
    inputs.push('-i', customLogoFile);
  }

  // Build video filter steps in exact order: reset PTS -> delogo -> mirror -> zoom (preserving WxH) -> even dims -> speed
  const vSteps: string[] = ['setpts=PTS-STARTPTS'];
  if (delogoFilter) {
    vSteps.push(delogoFilter);
  }
  if (transform.mirror === 'horizontal') {
    vSteps.push('hflip');
  } else if (transform.mirror === 'vertical') {
    vSteps.push('vflip');
  }
  if (transform.hasZoom && dims) {
    const frameW = Math.max(2, Math.floor(dims.width / 2) * 2);
    const frameH = Math.max(2, Math.floor(dims.height / 2) * 2);
    const z = transform.zoomPercent / 100;
    const sw = Math.max(2, Math.floor((frameW * z) / 2) * 2);
    const sh = Math.max(2, Math.floor((frameH * z) / 2) * 2);

    if (sw < frameW || sh < frameH) {
      vSteps.push(`scale=${sw}:${sh},pad=${frameW}:${frameH}:(ow-iw)/2:(oh-ih)/2:black`);
    } else if (sw > frameW || sh > frameH) {
      vSteps.push(`scale=${sw}:${sh},crop=${frameW}:${frameH}:(iw-ow)/2:(ih-oh)/2`);
    }
  } else {
    // Guarantee even dimensions for libx264 / yuv420p compatibility on non-standard resolutions
    vSteps.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  if (transform.hasSpeed) {
    vSteps.push(`setpts=PTS/${transform.speed}`);
  }

  const hasCustomFilterOps =
    Boolean(delogoFilter) ||
    transform.hasMirror ||
    transform.hasZoom ||
    transform.hasSpeed ||
    logoInputIdx !== null;

  if (!hasCustomFilterOps) {
    // No video filters and speed == 1.0
    if (format === 'mp4') {
      if (forceMp4Transcode) {
        await runH264EncodeWithFallback(
          [...inputs, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'],
          [
            ...(hasAudioStream ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
            '-max_muxing_queue_size',
            '4096',
          ],
          finalPath
        );
      } else {
        await runFfmpeg([
          ...inputs,
          '-c',
          'copy',
          '-max_muxing_queue_size',
          '4096',
          '-movflags',
          '+faststart',
          finalPath,
        ]);
      }
      return;
    }
    if (format === 'mkv') {
      await runFfmpeg([...inputs, '-c', 'copy', '-max_muxing_queue_size', '4096', finalPath]);
      return;
    }
    // webm still needs transcode from H264/HEVC/AAC
    await runFfmpeg([
      ...inputs,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '30',
      '-b:v',
      '0',
      '-deadline',
      'realtime',
      '-cpu-used',
      '4',
      '-threads',
      '0',
      ...(hasAudioStream ? ['-c:a', 'libopus'] : ['-an']),
      '-max_muxing_queue_size',
      '4096',
      finalPath,
    ]);
    return;
  }

  // Construct filter_complex for video (and audio when speed changes)
  const filterParts: string[] = [];
  if (logoInputIdx !== null && dims) {
    const targetLogoWidth = Math.max(
      24,
      Math.floor((dims.width * ((customLogo?.scalePercent || 15) / 100)) / 2) * 2
    );
    const margin = customLogo?.margin || 24;
    let overlayPos = `W-w-${margin}:H-h-${margin}`;
    if (customLogo?.position === 'top-right') overlayPos = `W-w-${margin}:${margin}`;
    else if (customLogo?.position === 'top-left') overlayPos = `${margin}:${margin}`;
    else if (customLogo?.position === 'bottom-left') overlayPos = `${margin}:H-h-${margin}`;
    else if (customLogo?.position === 'center') overlayPos = `(W-w)/2:(H-h)/2`;

    const logoOpacity = typeof customLogo?.opacity === 'number' ? customLogo.opacity : 0.85;
    filterParts.push(
      `[${logoInputIdx}:v]scale=${targetLogoWidth}:-2,format=rgba,colorchannelmixer=aa=${logoOpacity}[wm]`
    );

    filterParts.push(`[0:v]${vSteps.join(',')}[vbase]`);
    filterParts.push(`[vbase][wm]overlay=${overlayPos}:eof_action=repeat,format=yuv420p[vout]`);
  } else {
    filterParts.push(`[0:v]${vSteps.join(',')},format=yuv420p[vout]`);
  }

  const audioMapAndCodecArgs: string[] = [];
  if (hasAudioStream) {
    if (transform.hasSpeed) {
      filterParts.push(
        `[${audioInputIdx}:a]asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}[aout]`
      );
      audioMapAndCodecArgs.push('-map', '[aout]');
      if (format === 'webm') {
        audioMapAndCodecArgs.push('-c:a', 'libopus');
      } else {
        audioMapAndCodecArgs.push('-c:a', 'aac', '-b:a', '192k');
      }
    } else {
      audioMapAndCodecArgs.push('-map', `${audioInputIdx}:a`);
      if (format === 'webm') {
        audioMapAndCodecArgs.push('-c:a', 'libopus');
      } else {
        audioMapAndCodecArgs.push('-c:a', 'copy');
      }
    }
  }

  const filterComplex = filterParts.join(';');

  if (format === 'mp4' || format === 'mkv') {
    await runH264EncodeWithFallback(
      [...inputs, '-filter_complex', filterComplex, '-map', '[vout]', ...audioMapAndCodecArgs],
      ['-max_muxing_queue_size', '4096'],
      finalPath
    );
  } else {
    await runFfmpeg([
      ...inputs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      ...audioMapAndCodecArgs,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '30',
      '-b:v',
      '0',
      '-deadline',
      'realtime',
      '-cpu-used',
      '4',
      '-threads',
      '0',
      '-max_muxing_queue_size',
      '4096',
      finalPath,
    ]);
  }
}

async function processDownloadJob(
  jobId: string,
  params: {
    bvid: string;
    cid: number;
    title: string;
    partTitle?: string;
    qn: number;
    format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
    watermark?: WatermarkMode;
    sessdata?: string;
    customLogo?: CustomLogoParam;
    videoTransform?: VideoTransformParam;
  }
) {
  const job = jobs.get(jobId);
  if (!job) return;

  const tempFiles: string[] = [];
  const headers = await getBiliHeaders(params.sessdata);
  const transform = normalizeVideoTransform(params.videoTransform);
  let hasCachedRawSource = false;

  try {
    job.status = 'downloading';
    job.progress = 2;

    const targetQn = params.qn > 0 ? params.qn : 120;
    const isAudioOnly = params.format === 'mp3' || params.format === 'm4a';

    let customLogoFile: string | null = null;
    if (!isAudioOnly && params.customLogo?.enabled && params.customLogo.dataUrl) {
      try {
        const commaIdx = params.customLogo.dataUrl.indexOf(',');
        const rawBase64 = commaIdx >= 0 ? params.customLogo.dataUrl.slice(commaIdx + 1) : params.customLogo.dataUrl;
        const logoBuffer = Buffer.from(rawBase64, 'base64');
        if (logoBuffer.length > 0) {
          customLogoFile = path.join(DOWNLOAD_DIR, `${jobId}_custom_logo.png`);
          await fs.promises.writeFile(customLogoFile, logoBuffer);
          tempFiles.push(customLogoFile);
        }
      } catch (logoErr) {
        console.error('Failed to write custom logo:', logoErr);
      }
    }

    let resolvedCid = params.cid;
    if (!resolvedCid || resolvedCid <= 0) {
      const viewJson = await fetchBiliJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(params.bvid)}`,
        params.sessdata
      );
      if (viewJson.code !== 0 || !viewJson.data?.cid) {
        throw new Error(viewJson.message || 'Không thể lấy thông tin CID của video');
      }
      resolvedCid = viewJson.data.cid;
    }

    const finalPath = path.join(DOWNLOAD_DIR, `${jobId}.${params.format}`);
    const avCacheKey = `bili_${params.bvid}_cid${resolvedCid}_qn${targetQn}_${isAudioOnly ? 'audio' : 'av'}`;
    const durlCacheKey = `bili_${params.bvid}_cid${resolvedCid}_qn${targetQn}_durl`;

    // Check if completed raw source streams are already cached on disk (skip download on retry!)
    const cachedAv = readValidRawCache(avCacheKey);
    const cachedDurl = !cachedAv ? readValidRawCache(durlCacheKey) : null;

    if (cachedAv && isAudioOnly && cachedAv.meta.files.audio) {
      job.rawCacheKey = avCacheKey;
      const audioPath = cachedAv.meta.files.audio;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes = fs.statSync(audioPath).size;
      job.downloadedBytes = job.totalBytes;

      const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
      if (params.format === 'mp3') {
        await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
      } else if (transform.hasSpeed) {
        await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
      } else {
        await runFfmpeg(['-i', audioPath, '-vn', '-c:a', 'copy', finalPath]);
      }
    } else if (cachedAv && !isAudioOnly && cachedAv.meta.files.video) {
      job.rawCacheKey = avCacheKey;
      const videoPath = cachedAv.meta.files.video;
      const audioPath = cachedAv.meta.files.audio;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes =
        fs.statSync(videoPath).size + (audioPath && fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0);
      job.downloadedBytes = job.totalBytes;

      let delogoFilter: string | null = null;
      const needsDims =
        (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

      let dims: { width: number; height: number } | null = null;
      if (needsDims) {
        dims = await probeVideoDimensions(videoPath);
        if (!dims && cachedAv.meta.width && cachedAv.meta.height) {
          dims = { width: cachedAv.meta.width, height: cachedAv.meta.height };
        }
        if (!dims && (customLogoFile || transform.hasZoom)) {
          dims = { width: 1920, height: 1080 };
        }
      }

      if (dims && params.watermark && params.watermark !== 'none') {
        if (params.watermark === 'auto') {
          delogoFilter = await detectWatermarkDelogoFilter(videoPath, dims.width, dims.height);
        } else {
          delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
        }
      }

      await renderVideoWithFfmpeg({
        videoPath,
        separateAudioPath: audioPath && fs.existsSync(audioPath) ? audioPath : undefined,
        hasAudioStream: Boolean(audioPath && fs.existsSync(audioPath)),
        format: params.format as 'mp4' | 'mkv' | 'webm',
        finalPath,
        delogoFilter,
        dims,
        customLogoFile,
        customLogo: params.customLogo,
        transform,
      });
    } else if (cachedDurl && cachedDurl.meta.files.raw) {
      job.rawCacheKey = durlCacheKey;
      const rawPath = cachedDurl.meta.files.raw;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes = fs.statSync(rawPath).size;
      job.downloadedBytes = job.totalBytes;

      const hasAudioStream = await probeHasAudio(rawPath);
      if (isAudioOnly) {
        if (!hasAudioStream) throw new Error('Video này không có luồng âm thanh');
        const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
        if (params.format === 'mp3') {
          await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
        } else if (transform.hasSpeed) {
          await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
        } else {
          await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
        }
      } else {
        let delogoFilter: string | null = null;
        let dims: { width: number; height: number } | null = null;
        const needsDims =
          (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

        if (needsDims) {
          dims = await probeVideoDimensions(rawPath);
          if (!dims && (customLogoFile || transform.hasZoom)) {
            dims = { width: 1920, height: 1080 };
          }
          if (dims && params.watermark && params.watermark !== 'none') {
            if (params.watermark === 'auto') {
              delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
            } else {
              delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
            }
          }
        }

        await renderVideoWithFfmpeg({
          videoPath: rawPath,
          hasAudioStream,
          format: params.format as 'mp4' | 'mkv' | 'webm',
          finalPath,
          delogoFilter,
          dims,
          customLogoFile,
          customLogo: params.customLogo,
          transform,
        });
      }
    } else {
      // Try DASH first for best quality & separate audio stream (fnval=4048 & try_look=1 unlocks up to 1080P for guests)
      const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(
        params.bvid
      )}&cid=${resolvedCid}&qn=${targetQn}&fnval=4048&fourk=1&try_look=1`;

      const playJson = await fetchBiliJson(playUrlApi, params.sessdata);

      if (playJson.code !== 0 || !playJson.data) {
        throw new Error(playJson.message || 'Không thể lấy luồng video từ Bilibili');
      }

      const data = playJson.data;

      if (data.dash && (data.dash.video?.length || data.dash.audio?.length)) {
        const videos: any[] = data.dash.video || [];
        const audios: any[] = data.dash.audio || [];

        // Pick best matching video stream <= targetQn (or closest), sorted by highest bandwidth
        const sortedVideos = [...videos].sort(
          (a, b) => b.id - a.id || (b.bandwidth || 0) - (a.bandwidth || 0)
        );
        let selectedVideo =
          sortedVideos.find((v) => v.id === targetQn) ||
          sortedVideos.find((v) => v.id <= targetQn) ||
          sortedVideos[sortedVideos.length - 1];

        // Prefer highest-bandwidth AVC (codec id 7) when multiple streams share same quality for MP4 compatibility
        if (selectedVideo) {
          const sameIdStreams = sortedVideos.filter((v) => v.id === selectedVideo.id);
          const avc = sameIdStreams.find((v) => v.codecid === 7);
          if (avc) selectedVideo = avc;
        }

        const selectedAudio =
          audios.length > 0 ? [...audios].sort((a, b) => b.bandwidth - a.bandwidth)[0] : null;

        const cacheDir = getRawCacheDir(avCacheKey);
        job.rawCacheKey = avCacheKey;
        fs.mkdirSync(cacheDir, { recursive: true });
        const audioPath = path.join(cacheDir, 'audio.m4s');
        const videoPath = path.join(cacheDir, 'video.m4s');

        if (isAudioOnly) {
          const audioUrls = getCandidateUrls(selectedAudio);
          if (audioUrls.length === 0) throw new Error('Video này không có luồng âm thanh tách rời');
          const audioPart = path.join(cacheDir, `audio_${jobId.slice(0, 8)}.part`);
          tempFiles.push(audioPart);

          await downloadFileWithProgress(audioUrls, audioPart, headers, (dl, total, speed) => {
            job.downloadedBytes = dl;
            job.totalBytes = total;
            job.speedBytesPerSec = speed;
            job.progress = total > 0 ? Math.min(78, Math.round((dl / total) * 78)) : 40;
          });

          fs.renameSync(audioPart, audioPath);
          writeRawCacheMeta(avCacheKey, { files: { audio: audioPath } });
          hasCachedRawSource = true;

          job.status = 'processing';
          job.progress = 85;

          const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
          if (params.format === 'mp3') {
            await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
          } else if (transform.hasSpeed) {
            await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
          } else {
            await runFfmpeg(['-i', audioPath, '-vn', '-c:a', 'copy', finalPath]);
          }
        } else {
          const videoUrls = getCandidateUrls(selectedVideo);
          const audioUrls = getCandidateUrls(selectedAudio);
          if (videoUrls.length === 0) throw new Error('Không tìm thấy luồng hình ảnh phù hợp');

          const videoPart = path.join(cacheDir, `video_${jobId.slice(0, 8)}.part`);
          tempFiles.push(videoPart);
          await downloadFileWithProgress(videoUrls, videoPart, headers, (dl, total, speed) => {
            job.downloadedBytes = dl;
            job.totalBytes = total;
            job.speedBytesPerSec = speed;
            job.progress = total > 0 ? Math.min(60, Math.round((dl / total) * 60)) : 30;
          });
          fs.renameSync(videoPart, videoPath);

          const cachedFiles: Record<string, string> = { video: videoPath };
          if (audioUrls.length > 0) {
            const audioPart = path.join(cacheDir, `audio_${jobId.slice(0, 8)}.part`);
            tempFiles.push(audioPart);
            await downloadFileWithProgress(audioUrls, audioPart, headers, (dl, total, speed) => {
              job.speedBytesPerSec = speed;
              const audioPct = total > 0 ? Math.round((dl / total) * 20) : 10;
              job.progress = Math.min(80, 60 + audioPct);
            });
            fs.renameSync(audioPart, audioPath);
            cachedFiles.audio = audioPath;
          }

          writeRawCacheMeta(avCacheKey, {
            files: cachedFiles,
            width: Number(selectedVideo?.width) || undefined,
            height: Number(selectedVideo?.height) || undefined,
          });
          hasCachedRawSource = true;

          job.status = 'processing';
          job.progress = 85;

          let delogoFilter: string | null = null;
          const needsDims =
            (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

          let dims: { width: number; height: number } | null = null;
          if (needsDims) {
            dims = await probeVideoDimensions(videoPath);
            if (!dims && selectedVideo?.width && selectedVideo?.height) {
              dims = { width: Number(selectedVideo.width), height: Number(selectedVideo.height) };
            }
            if (!dims && (customLogoFile || transform.hasZoom)) {
              dims = { width: 1920, height: 1080 };
            }
          }

          if (dims && params.watermark && params.watermark !== 'none') {
            if (params.watermark === 'auto') {
              delogoFilter = await detectWatermarkDelogoFilter(videoPath, dims.width, dims.height);
            } else {
              delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
            }
          }

          await renderVideoWithFfmpeg({
            videoPath,
            separateAudioPath: audioUrls.length > 0 ? audioPath : undefined,
            hasAudioStream: audioUrls.length > 0,
            format: params.format as 'mp4' | 'mkv' | 'webm',
            finalPath,
            delogoFilter,
            dims,
            customLogoFile,
            customLogo: params.customLogo,
            transform,
          });
        }
      } else if (data.durl?.length) {
        const durlCandidates = getCandidateUrls(data.durl[0]);
        const cacheDir = getRawCacheDir(durlCacheKey);
        job.rawCacheKey = durlCacheKey;
        fs.mkdirSync(cacheDir, { recursive: true });
        const rawPath = path.join(cacheDir, 'raw.mp4');
        const rawPart = path.join(cacheDir, `raw_${jobId.slice(0, 8)}.part`);
        tempFiles.push(rawPart);

        await downloadFileWithProgress(durlCandidates, rawPart, headers, (dl, total, speed) => {
          job.downloadedBytes = dl;
          job.totalBytes = total;
          job.speedBytesPerSec = speed;
          job.progress = total > 0 ? Math.min(80, Math.round((dl / total) * 80)) : 40;
        });

        fs.renameSync(rawPart, rawPath);
        writeRawCacheMeta(durlCacheKey, { files: { raw: rawPath } });
        hasCachedRawSource = true;

        job.status = 'processing';
        job.progress = 85;

        const hasAudioStream = await probeHasAudio(rawPath);

        if (isAudioOnly) {
          if (!hasAudioStream) {
            throw new Error('Video này không có luồng âm thanh');
          }
          const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
          if (params.format === 'mp3') {
            await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
          } else if (transform.hasSpeed) {
            await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
          } else {
            await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
          }
        } else {
          let delogoFilter: string | null = null;
          let dims: { width: number; height: number } | null = null;
          const needsDims =
            (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

          if (needsDims) {
            dims = await probeVideoDimensions(rawPath);
            if (!dims && (customLogoFile || transform.hasZoom)) {
              dims = { width: 1920, height: 1080 };
            }
            if (dims && params.watermark && params.watermark !== 'none') {
              if (params.watermark === 'auto') {
                delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
              } else {
                delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
              }
            }
          }

          await renderVideoWithFfmpeg({
            videoPath: rawPath,
            hasAudioStream,
            format: params.format as 'mp4' | 'mkv' | 'webm',
            finalPath,
            delogoFilter,
            dims,
            customLogoFile,
            customLogo: params.customLogo,
            transform,
          });
        }
      } else {
        throw new Error('Không có luồng phát khả dụng cho video này');
      }
    }

    const stat = fs.statSync(finalPath);
    job.filePath = finalPath;
    job.fileSize = stat.size;
    job.progress = 100;
    job.status = 'completed';
    // FFmpeg succeeded: immediately remove raw temporary video/audio files from C:\Temp\bili-downloads\raw_cache
    cleanupRawCacheIfUnused(job.rawCacheKey, jobId);
  } catch (err: any) {
    job.status = 'error';
    const rawMsg = err?.message || 'Lỗi không xác định trong quá trình tải';
    job.error = hasCachedRawSource
      ? `Đã giữ lại video gốc đã tải (bấm Thử lại để xuất lại không cần tải lại từ đầu): ${rawMsg}`
      : rawMsg;
  } finally {
    for (const tmp of tempFiles) {
      if (fs.existsSync(tmp)) {
        fs.unlink(tmp, () => {});
      }
    }
  }
}

async function processYouTubeDownloadJob(
  jobId: string,
  params: {
    platform?: VideoPlatform;
    sourceUrl: string;
    bvid: string;
    title: string;
    qn: number;
    format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
    watermark?: WatermarkMode;
    ytCookies?: string;
    customLogo?: CustomLogoParam;
    videoTransform?: VideoTransformParam;
  }
) {
  const job = jobs.get(jobId);
  if (!job) return;
  const effectivePlatform: VideoPlatform =
    params.platform || (isFacebookUrl(params.sourceUrl) ? 'facebook' : 'youtube');
  const platformDisplayName =
    effectivePlatform === 'facebook'
      ? 'Facebook'
      : effectivePlatform === 'youtube'
      ? 'YouTube'
      : effectivePlatform.charAt(0).toUpperCase() + effectivePlatform.slice(1);

  const tempFiles: string[] = [];
  const transform = normalizeVideoTransform(params.videoTransform);
  let hasCachedRawSource = false;

  try {
    job.status = 'downloading';
    job.progress = 2;

    const isAudioOnly = params.format === 'mp3' || params.format === 'm4a';

    let customLogoFile: string | null = null;
    if (!isAudioOnly && params.customLogo?.enabled && params.customLogo.dataUrl) {
      try {
        const commaIdx = params.customLogo.dataUrl.indexOf(',');
        const rawBase64 =
          commaIdx >= 0 ? params.customLogo.dataUrl.slice(commaIdx + 1) : params.customLogo.dataUrl;
        const logoBuffer = Buffer.from(rawBase64, 'base64');
        if (logoBuffer.length > 0) {
          customLogoFile = path.join(DOWNLOAD_DIR, `${jobId}_custom_logo.png`);
          await fs.promises.writeFile(customLogoFile, logoBuffer);
          tempFiles.push(customLogoFile);
        }
      } catch (logoErr) {
        console.error('Failed to write custom logo:', logoErr);
      }
    }

    const ytKey = params.bvid || crypto.createHash('md5').update(params.sourceUrl).digest('hex').slice(0, 12);
    const cacheKey = `yt_${ytKey}_qn${params.qn}_${isAudioOnly ? 'audio' : params.format === 'mp4' ? 'avc' : 'best'}`;
    job.rawCacheKey = cacheKey;
    const cached = readValidRawCache(cacheKey);
    let rawPath = '';

    if (cached?.meta.files.raw) {
      rawPath = cached.meta.files.raw;
      hasCachedRawSource = true;
      job.totalBytes = fs.statSync(rawPath).size;
      job.downloadedBytes = job.totalBytes;
      job.progress = 80;
    } else {
      const ytDlpBin = await ensureYtDlpPath();
      const cookiePath = writeYtCookiesFile(jobId, params.ytCookies);
      if (cookiePath) tempFiles.push(cookiePath);
      const cookieArgs = cookiePath ? ['--cookies', cookiePath] : [];

      const qnToHeight: Record<number, number> = {
        120: 2160,
        116: 1080,
        112: 1080,
        80: 1080,
        64: 720,
        32: 480,
        16: 360,
      };
      const maxH = qnToHeight[params.qn] || 0;

      const cacheDir = getRawCacheDir(cacheKey);
      fs.mkdirSync(cacheDir, { recursive: true });
      const stem = `raw_${jobId.slice(0, 8)}`;
      const rawPrefix = path.join(cacheDir, stem);

      let formatSelector = 'bestaudio/best';
      const mergeArgs: string[] = [];
      if (!isAudioOnly) {
        const hFilter = maxH > 0 ? `[height<=${maxH}]` : '';
        if (params.format === 'mp4') {
          formatSelector = `bestvideo[vcodec^=avc1]${hFilter}+bestaudio[ext=m4a]/bestvideo${hFilter}+bestaudio/best${hFilter}/best`;
        } else {
          formatSelector = `bestvideo${hFilter}+bestaudio/best${hFilter}/best`;
        }
        mergeArgs.push('--merge-output-format', 'mkv');
      }

      const rawTargetUrl = params.sourceUrl || `https://www.youtube.com/watch?v=${params.bvid}`;
      const targetUrl =
        effectivePlatform === 'facebook'
          ? await resolveFacebookShareUrl(rawTargetUrl, params.ytCookies)
          : rawTargetUrl;
      const ytArgs = [
        '--no-playlist',
        '--js-runtimes',
        'node',
        '--no-warnings',
        '--newline',
        '--concurrent-fragments',
        '4',
        '--http-chunk-size',
        '10M',
        '--retries',
        '10',
        '--fragment-retries',
        '10',
        '--socket-timeout',
        '25',
        '--retry-sleep',
        '2',
        '-f',
        formatSelector,
        ...mergeArgs,
        ...cookieArgs,
        '-o',
        `${rawPrefix}.%(ext)s`,
        targetUrl,
      ];

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ytDlpBin, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          let stdoutBuf = '';

          proc.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString();
            const lines = stdoutBuf.split(/\r?\n/);
            stdoutBuf = lines.pop() || '';
            for (const line of lines) {
              const pctMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)([KMG]i?B)/i);
              if (pctMatch) {
                const pct = parseFloat(pctMatch[1]);
                const totalB = parseYtdlpSizeToBytes(pctMatch[2], pctMatch[3]);
                job.progress = Math.min(78, Math.max(2, Math.round((pct / 100) * 78)));
                if (totalB > 0) {
                  job.totalBytes = totalB;
                  job.downloadedBytes = Math.round((pct / 100) * totalB);
                }
              }
              const spdMatch = line.match(/\bat\s+([\d.]+)([KMG]i?B)\/s/i);
              if (spdMatch) {
                job.speedBytesPerSec = parseYtdlpSizeToBytes(spdMatch[1], spdMatch[2]);
              }
            }
          });

          proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 4000) stderr = stderr.slice(-4000);
          });

          proc.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else if (/Sign in to confirm you.?re not a bot/i.test(stderr)) {
              reject(
                new Error(
                  'YouTube yêu cầu xác minh chống bot. Vui lòng bấm "Cookie / Đăng nhập" trên thanh trên cùng -> tab YouTube Cookies và dán cookies.txt của bạn rồi bấm Thử lại.'
                )
              );
            } else if (
              effectivePlatform === 'facebook' &&
              /login|cookie|registered users|Private video|Cannot parse data/i.test(stderr)
            ) {
              reject(
                new Error(
                  'Facebook yêu cầu đăng nhập hoặc cookie để tải video này. Vui lòng vào Cài đặt -> tab Facebook và dán cookie facebook.com rồi bấm Thử lại.'
                )
              );
            } else {
              reject(new Error(`Lỗi tải ${platformDisplayName} (code ${code}): ${stderr.slice(-260).trim()}`));
            }
          });
          proc.on('error', (err) => reject(err));
        });
      } catch (dlErr) {
        // Clean partial files on failed yt-dlp attempt
        for (const f of fs.readdirSync(cacheDir)) {
          if (f.startsWith(stem)) {
            fs.unlink(path.join(cacheDir, f), () => {});
          }
        }

        // For Facebook, try direct HTML HD/SD stream extraction as a resilient fallback
        let recoveredViaFacebookFallback = false;
        if (effectivePlatform === 'facebook') {
          try {
            const fbFallback = await extractFacebookFallbackFromHtml(targetUrl, params.ytCookies);
            const candidates = (
              maxH > 0 && maxH <= 480
                ? [fbFallback?.sdUrl, fbFallback?.hdUrl]
                : [fbFallback?.hdUrl, fbFallback?.sdUrl]
            ).filter((u): u is string => Boolean(u));
            if (candidates.length > 0) {
              const fbCookie = buildFacebookCookieHeader(params.ytCookies);
              await downloadFileWithProgress(
                candidates,
                `${rawPrefix}.mp4`,
                {
                  'User-Agent': USER_AGENT,
                  Referer: 'https://www.facebook.com/',
                  ...(fbCookie ? { Cookie: fbCookie } : {}),
                },
                (downloaded, total, speed) => {
                  job.downloadedBytes = downloaded;
                  if (total > 0) {
                    job.totalBytes = total;
                    job.progress = Math.min(78, Math.max(4, Math.round((downloaded / total) * 78)));
                  }
                  job.speedBytesPerSec = speed;
                }
              );
              recoveredViaFacebookFallback = true;
            }
          } catch {
            // fall through and rethrow original error
          }
        }

        if (!recoveredViaFacebookFallback) {
          throw dlErr;
        }
      }

      const dirEntries = fs.readdirSync(cacheDir);
      const matchedRaw = dirEntries.find((f) => f.startsWith(`${stem}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
      if (!matchedRaw) {
        throw new Error(`Không tìm thấy tệp sau khi tải từ ${platformDisplayName}`);
      }
      const ext = path.extname(matchedRaw) || '.mkv';
      const stableRawPath = path.join(cacheDir, `source${ext}`);
      fs.renameSync(path.join(cacheDir, matchedRaw), stableRawPath);
      rawPath = stableRawPath;
      writeRawCacheMeta(cacheKey, { files: { raw: rawPath } });
      hasCachedRawSource = true;
    }

    job.status = 'processing';
    job.progress = 85;

    const finalPath = path.join(DOWNLOAD_DIR, `${jobId}.${params.format}`);

    if (isAudioOnly) {
      const hasAudio = await probeHasAudio(rawPath);
      if (!hasAudio) throw new Error(`Video ${platformDisplayName} này không có luồng âm thanh`);
      const codecs = await probeStreamCodecs(rawPath);
      const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
      if (params.format === 'mp3') {
        await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
      } else if (transform.hasSpeed || codecs.acodec !== 'aac') {
        await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
      } else {
        await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
      }
    } else {
      const hasAudioStream = await probeHasAudio(rawPath);
      const codecs = await probeStreamCodecs(rawPath);
      const needsDims =
        (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

      let dims: { width: number; height: number } | null = null;
      let delogoFilter: string | null = null;

      if (needsDims) {
        dims = await probeVideoDimensions(rawPath);
        if (!dims && (customLogoFile || transform.hasZoom)) {
          dims = { width: 1920, height: 1080 };
        }
        if (dims && params.watermark && params.watermark !== 'none') {
          if (params.watermark === 'auto') {
            delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
          } else {
            delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
          }
        }
      }

      const forceMp4Transcode =
        params.format === 'mp4' &&
        ((codecs.vcodec !== 'h264' && codecs.vcodec !== 'hevc') ||
          (hasAudioStream && codecs.acodec !== 'aac'));

      await renderVideoWithFfmpeg({
        videoPath: rawPath,
        hasAudioStream,
        format: params.format as 'mp4' | 'mkv' | 'webm',
        finalPath,
        delogoFilter,
        dims,
        customLogoFile,
        customLogo: params.customLogo,
        transform,
        forceMp4Transcode,
      });
    }

    const stat = fs.statSync(finalPath);
    job.filePath = finalPath;
    job.fileSize = stat.size;
    job.progress = 100;
    job.status = 'completed';
    // FFmpeg succeeded: immediately remove raw temporary source file from C:\Temp\bili-downloads\raw_cache
    cleanupRawCacheIfUnused(job.rawCacheKey, jobId);
  } catch (err: any) {
    job.status = 'error';
    const rawMsg = err?.message || `Lỗi không xác định khi tải video ${platformDisplayName}`;
    job.error = hasCachedRawSource
      ? `Đã giữ lại video gốc đã tải (bấm Thử lại để xuất lại không cần tải lại từ đầu): ${rawMsg}`
      : rawMsg;
  } finally {
    for (const tmp of tempFiles) {
      if (fs.existsSync(tmp)) {
        fs.unlink(tmp, () => {});
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const ALLOWED_IMAGE_PROXY_SUFFIXES = [
    'hdslb.com',
    'bilibili.com',
    'douyinpic.com',
    'douyin.com',
    'byteimg.com',
    'bytedance.com',
    'ibyteimg.com',
    'byteoversea.com',
    'ibytedtos.com',
    'pstatp.com',
    'snssdk.com',
    'yximgs.com',
    'kwimgs.com',
    'kuaishou.com',
    'sinaimg.cn',
    'weibo.com',
    'xhscdn.com',
    'xiaohongshu.com',
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'tiktokcdn-eu.com',
    'tiktokv.com',
    'ttwstatic.com',
    'tiktok.com',
    'fbcdn.net',
    'fbsbx.com',
    'facebook.com',
    'ytimg.com',
    'ggpht.com',
    'googleusercontent.com',
    'vimeocdn.com',
    'twimg.com',
    'cdninstagram.com',
    'instagram.com',
    'muscdn.com',
    'akamaized.net',
    'cloudfront.net',
  ];

  const validateAllowedImageUrl = (raw: string): { ok: true; url: URL; referer: string } | { ok: false } => {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false };
      if (parsed.username || parsed.password) return { ok: false };
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
        return { ok: false };
      }
      // Reject IPv4/IPv6 literals directly
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
        return { ok: false };
      }
      const allowed = ALLOWED_IMAGE_PROXY_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      );
      if (!allowed) return { ok: false };

      let referer = '';
      if (host.endsWith('hdslb.com') || host.endsWith('bilibili.com')) {
        referer = 'https://www.bilibili.com/';
      } else if (
        host.endsWith('douyinpic.com') ||
        host.endsWith('douyin.com') ||
        host.endsWith('byteimg.com') ||
        host.endsWith('ibyteimg.com')
      ) {
        referer = 'https://www.douyin.com/';
      } else if (host.endsWith('yximgs.com') || host.endsWith('kwimgs.com') || host.endsWith('kuaishou.com')) {
        referer = 'https://www.kuaishou.com/';
      } else if (host.endsWith('sinaimg.cn') || host.endsWith('weibo.com')) {
        referer = 'https://weibo.com/';
      } else if (host.endsWith('xhscdn.com') || host.endsWith('xiaohongshu.com')) {
        referer = 'https://www.xiaohongshu.com/';
      } else if (
        host.includes('tiktokcdn') ||
        host.endsWith('tiktokv.com') ||
        host.endsWith('ttwstatic.com') ||
        host.endsWith('tiktok.com')
      ) {
        referer = 'https://www.tiktok.com/';
      } else if (host.endsWith('fbcdn.net') || host.endsWith('fbsbx.com') || host.endsWith('facebook.com')) {
        referer = 'https://www.facebook.com/';
      }
      return { ok: true, url: parsed, referer };
    } catch {
      return { ok: false };
    }
  };

  // Proxy Bilibili & multi-platform thumbnails safely
  app.get('/api/bilibili/proxy-image', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const initialCheck = validateAllowedImageUrl(rawUrl);
    if (!initialCheck.ok) {
      return res.status(400).send('Invalid or unsupported image URL');
    }
    try {
      let current = initialCheck;
      let response: globalThis.Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        const resp = await fetch(current.url.toString(), {
          headers: {
            'User-Agent': USER_AGENT,
            ...(current.referer ? { Referer: current.referer } : {}),
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location');
          if (!loc) {
            return res.status(502).send('Invalid redirect');
          }
          const nextAbs = new URL(loc, current.url).toString();
          const nextCheck = validateAllowedImageUrl(nextAbs);
          if (!nextCheck.ok) {
            return res.status(403).send('Redirect target not allowed');
          }
          current = nextCheck;
          continue;
        }
        response = resp;
        break;
      }

      if (!response || !response.ok || !response.body) {
        return res.status(response?.status || 502).send('Image fetch failed');
      }
      const rawContentType = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (!rawContentType.startsWith('image/')) {
        return res.status(415).send('Unsupported content type');
      }
      res.setHeader('Content-Type', rawContentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      await pipeline(Readable.fromWeb(response.body as any), res);
    } catch {
      res.status(502).send('Failed to proxy image');
    }
  });

  // Trending Videos & Hot Topics across global social platforms
  const handleTrendingRequest = async (req: express.Request, res: express.Response) => {
    try {
      const source = req.method === 'POST' ? req.body || {} : req.query || {};
      const platform = (String(source.platform || 'all') as TrendingPlatformId);
      const category = String(source.category || 'all');
      const duration = (String(source.duration || 'all') as 'all' | 'short' | 'medium' | 'long');
      const orientation = (String(source.orientation || 'all') as 'all' | 'vertical' | 'horizontal');
      const sort = (String(source.sort || 'best') as 'best' | 'rising' | 'views' | 'engagement' | 'newest');
      const q = String(source.q || '');
      const region = (['VN', 'GLOBAL', 'CN'].includes(String(source.region)) ? String(source.region) : 'VN') as
        | 'VN'
        | 'GLOBAL'
        | 'CN';
      const refresh = source.refresh === '1' || source.refresh === true;
      const sessdata = typeof source.sessdata === 'string' ? source.sessdata : undefined;
      const extraCookies = typeof source.extraCookies === 'string' ? source.extraCookies : undefined;

      const data = await queryTrendingFeed({
        platform,
        category,
        duration,
        orientation,
        sort,
        q,
        region,
        refresh,
        sessdata,
        extraCookies,
      });

      res.json(data);
    } catch (err: any) {
      console.error('Trending API error:', err);
      res.status(500).json({ error: err?.message || 'Không thể tải danh sách xu hướng' });
    }
  };

  app.get('/api/trending', handleTrendingRequest);
  app.post('/api/trending', handleTrendingRequest);

  app.post('/api/trending/translate', async (req, res) => {
    try {
      const { titles } = (req.body || {}) as { titles?: { id: string; text: string }[] };
      if (!Array.isArray(titles) || titles.length === 0) {
        return res.json({ translations: {} });
      }
      const translations = await translateTitlesBatch(titles);
      res.json({ translations });
    } catch {
      res.json({ translations: {} });
    }
  });

  // Independent Multi-Platform Video Search API
  const handleSearchRequest = async (req: express.Request, res: express.Response) => {
    try {
      const source = req.method === 'POST' ? req.body || {} : req.query || {};
      const q = String(source.q || '').trim();
      if (!q) {
        return res.json({ query: '', videos: [], platformStatuses: [], updatedAt: Date.now() });
      }
      const platform = String(source.platform || 'all') as TrendingPlatformId;
      const duration = String(source.duration || 'all') as 'all' | 'short' | 'medium' | 'long';
      const orientation = String(source.orientation || 'all') as 'all' | 'vertical' | 'horizontal';
      const sort = String(source.sort || 'relevance') as SearchSortOption;
      const region = (['VN', 'GLOBAL', 'CN'].includes(String(source.region)) ? String(source.region) : 'VN') as
        | 'VN'
        | 'GLOBAL'
        | 'CN';
      const page = Math.max(1, parseInt(String(source.page || '1'), 10) || 1);
      const refresh = source.refresh === '1' || source.refresh === true;
      const sessdata = typeof source.sessdata === 'string' ? source.sessdata : undefined;
      const extraCookies = typeof source.extraCookies === 'string' ? source.extraCookies : undefined;

      const data = await searchVideosAcrossPlatforms({
        q,
        platform,
        duration,
        orientation,
        sort,
        region,
        page,
        refresh,
        sessdata,
        extraCookies,
      });
      res.json(data);
    } catch (err: any) {
      console.error('Search API error:', err);
      res.status(500).json({ error: err?.message || 'Không thể tìm kiếm video' });
    }
  };

  app.get('/api/search', handleSearchRequest);
  app.post('/api/search', handleSearchRequest);

  // AI Video Content Learning & Derivative Video Studio
  const downloadSourceVideoForDerivative = async (
    source: DerivativeSourceInput,
    outPath: string,
    sessdata?: string,
    ytCookies?: string
  ): Promise<{ ok: boolean; reason?: string }> => {
    const drvCacheKey = `drv_src_${crypto.createHash('md5').update(source.sourceUrl).digest('hex').slice(0, 16)}`;

    // 1. Reuse cached derivative source clip if available
    const existingCache = readValidRawCache(drvCacheKey);
    if (existingCache?.meta.files.raw && fs.existsSync(existingCache.meta.files.raw)) {
      try {
        fs.copyFileSync(existingCache.meta.files.raw, outPath);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
          return { ok: true };
        }
      } catch {
        // ignore cache copy failure and download fresh
      }
    }

    const saveClipToCache = (filePath: string) => {
      try {
        const cacheDir = getRawCacheDir(drvCacheKey);
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachedRaw = path.join(cacheDir, 'source.mp4');
        fs.copyFileSync(filePath, cachedRaw);
        writeRawCacheMeta(drvCacheKey, { files: { raw: cachedRaw } });
      } catch {
        // non-fatal cache write error
      }
    };

    // 2. Native fast path for Bilibili sources (try_look=1 + Akamai CDN mirrors)
    if (source.platform === 'bilibili') {
      const bvidMatch = source.sourceUrl.match(/(BV[0-9A-Za-z]+)/) || source.id.match(/(BV[0-9A-Za-z]+)/);
      if (bvidMatch) {
        const tmpFiles: string[] = [];
        try {
          const bvid = bvidMatch[1];
          const viewJson = await fetchBiliJson(
            `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
            sessdata
          );
          const cid = viewJson?.data?.cid;
          if (viewJson?.code === 0 && cid) {
            const playJson = await fetchBiliJson(
              `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(
                bvid
              )}&cid=${cid}&qn=64&fnval=4048&try_look=1`,
              sessdata
            );
            const data = playJson?.data;
            const biliHeaders: Record<string, string> = {
              'User-Agent': USER_AGENT,
              Referer: 'https://www.bilibili.com/',
              ...(sessdata?.trim() ? { Cookie: `SESSDATA=${sessdata.trim()}` } : {}),
            };

            if (playJson?.code === 0 && data?.dash?.video?.length) {
              const sortedVideos = [...data.dash.video].sort(
                (a: any, b: any) => b.id - a.id || (b.bandwidth || 0) - (a.bandwidth || 0)
              );
              let pickedVid =
                sortedVideos.find((v: any) => v.id === 64 && v.codecid === 7) ||
                sortedVideos.find((v: any) => v.id <= 64 && v.codecid === 7) ||
                sortedVideos.find((v: any) => v.id <= 64) ||
                sortedVideos[sortedVideos.length - 1];
              const audios = data.dash.audio || [];
              const pickedAud =
                audios.length > 0 ? [...audios].sort((a: any, b: any) => b.bandwidth - a.bandwidth)[0] : null;
              const vidUrls = getCandidateUrls(pickedVid);
              const audUrls = getCandidateUrls(pickedAud);

              if (vidUrls.length > 0) {
                const vTmp = `${outPath}.vid.m4s`;
                tmpFiles.push(vTmp);
                await downloadFileWithProgress(vidUrls, vTmp, biliHeaders, () => {});
                if (audUrls.length > 0) {
                  const aTmp = `${outPath}.aud.m4s`;
                  tmpFiles.push(aTmp);
                  await downloadFileWithProgress(audUrls, aTmp, biliHeaders, () => {});
                  await runFfmpeg(['-i', vTmp, '-i', aTmp, '-c', 'copy', '-movflags', '+faststart', outPath]);
                } else {
                  await runFfmpeg(['-i', vTmp, '-c', 'copy', '-movflags', '+faststart', outPath]);
                }
                if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
                  saveClipToCache(outPath);
                  return { ok: true };
                }
              }
            } else if (playJson?.code === 0 && data?.durl?.length) {
              const durlUrls = getCandidateUrls(data.durl[0]);
              if (durlUrls.length > 0) {
                const dTmp = `${outPath}.durl.tmp`;
                tmpFiles.push(dTmp);
                await downloadFileWithProgress(durlUrls, dTmp, biliHeaders, () => {});
                await runFfmpeg(['-i', dTmp, '-c', 'copy', '-movflags', '+faststart', outPath]);
                if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
                  saveClipToCache(outPath);
                  return { ok: true };
                }
              }
            }
          }
        } catch {
          // Fall through to yt-dlp fallback
        } finally {
          for (const f of tmpFiles) {
            if (fs.existsSync(f)) fs.unlink(f, () => {});
          }
        }
      }
    }

    // 3. yt-dlp extraction (with --js-runtimes node for YouTube EJS challenges + retries + stderr capture)
    const ytDlpBin = await ensureYtDlpPath();
    const tempCookiePath = writeYtCookiesFile(`drv_${crypto.randomBytes(4).toString('hex')}`, ytCookies);
    const outDir = path.dirname(outPath);
    const dlStem = `drv_dl_${crypto.randomBytes(4).toString('hex')}`;
    const outPrefix = path.join(outDir, dlStem);

    const args: string[] = [
      '--no-playlist',
      '--js-runtimes',
      'node',
      '--no-warnings',
      '--concurrent-fragments',
      '4',
      '--retries',
      '5',
      '--fragment-retries',
      '5',
      '--socket-timeout',
      '25',
      '-f',
      'best[height<=720][ext=mp4]/bestvideo[vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=480]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      `${outPrefix}.%(ext)s`,
    ];
    if (tempCookiePath) {
      args.push('--cookies', tempCookiePath);
    }
    if (source.platform === 'bilibili') {
      args.push('--add-header', 'Referer:https://www.bilibili.com/');
      if (sessdata?.trim()) {
        args.push('--add-header', `Cookie:SESSDATA=${sessdata.trim()}`);
      }
    }
    args.push(source.sourceUrl);

    const cleanupPrefixFiles = () => {
      try {
        for (const entry of fs.readdirSync(outDir)) {
          if (entry.startsWith(`${dlStem}.`)) {
            fs.unlink(path.join(outDir, entry), () => {});
          }
        }
      } catch {
        // ignore cleanup error
      }
    };

    try {
      const result = await new Promise<{ code: number; stderr: string; timedOut: boolean }>((resolve) => {
        const proc = spawn(ytDlpBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let timedOut = false;

        proc.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, 95_000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, stderr, timedOut });
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ code: 1, stderr: err?.message || 'Không khởi chạy được yt-dlp', timedOut: false });
        });
      });

      if (result.code === 0) {
        const matched = fs
          .readdirSync(outDir)
          .find((f) => f.startsWith(`${dlStem}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (matched) {
          const downloadedPath = path.join(outDir, matched);
          if (fs.statSync(downloadedPath).size > 20_000) {
            fs.renameSync(downloadedPath, outPath);
            cleanupPrefixFiles();
            saveClipToCache(outPath);
            return { ok: true };
          }
        }
      }

      cleanupPrefixFiles();
      const errText = result.stderr.trim();

      if (result.timedOut) {
        return { ok: false, reason: 'Quá thời gian tải video nguồn (>95 giây)' };
      }
      if (/Sign in to confirm you.?re not a bot|Use --cookies/i.test(errText)) {
        return {
          ok: false,
          reason: tempCookiePath
            ? 'Cookie YouTube hiện tại đã hết hạn hoặc bị yêu cầu xác minh lại (hãy cập nhật Cookie mới)'
            : 'YouTube chặn IP máy chủ (yêu cầu xác minh chống bot). Hãy dán YouTube Cookies trong "Cookie / Đăng nhập" hoặc chạy trên máy cá nhân',
        };
      }
      if (/HTTP Error 403|403 Forbidden/i.test(errText)) {
        return { ok: false, reason: 'Nguồn video từ chối truy cập (HTTP 403 — có thể cần Cookie hoặc đổi mạng)' };
      }
      if (/Video unavailable|Private video|This video is unavailable|Premieres/i.test(errText)) {
        return { ok: false, reason: 'Video nguồn không khả dụng hoặc ở chế độ riêng tư' };
      }

      const lastErrLine = errText
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .pop()
        ?.replace(/^ERROR:\s*/i, '')
        .slice(0, 170);

      return {
        ok: false,
        reason: lastErrLine || 'Không trích xuất được luồng video trực tiếp',
      };
    } finally {
      if (tempCookiePath && fs.existsSync(tempCookiePath)) {
        fs.unlink(tempCookiePath, () => {});
      }
    }
  };

  // Server Capabilities & AI Provider Connection Check
  app.get('/api/config/capabilities', async (_req, res) => {
    const checkBinVersion = (cmd: string, args: string[]) =>
      new Promise<{ available: boolean; version: string }>((resolve) => {
        try {
          const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve({ available: false, version: '' });
          }, 4000);
          proc.stdout.on('data', (d) => {
            out += d.toString();
          });
          proc.on('close', (code) => {
            clearTimeout(timer);
            const firstLine = out.split(/\r?\n/)[0]?.trim() || '';
            resolve({ available: code === 0 && Boolean(firstLine), version: firstLine.slice(0, 64) });
          });
          proc.on('error', () => {
            clearTimeout(timer);
            resolve({ available: false, version: '' });
          });
        } catch {
          resolve({ available: false, version: '' });
        }
      });

    let ytDlpCheck = { available: false, version: '' };
    try {
      const bin = await ensureYtDlpPath();
      ytDlpCheck = await checkBinVersion(bin, ['--version']);
    } catch {
      ytDlpCheck = { available: false, version: '' };
    }

    const ffmpegCheck = await checkBinVersion('ffmpeg', ['-version']);
    const offlineTtsCheck = await detectOfflineTtsEngine();
    const muse2apiStatus = await getMuse2ApiStatus().catch(() => null);

    res.json({
      aiProviders: {
        gemini: {
          configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
          model: 'gemini-4-hydrogen',
          ttsModel: 'gemini-3.8-flash-lite-tts',
          source: process.env.GEMINI_API_KEY?.trim() ? 'env' : 'none',
        },
        openai: {
          configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
          model: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
          source: process.env.OPENAI_API_KEY?.trim() ? 'env' : 'none',
        },
        meta: {
          configured: Boolean(process.env.META_API_KEY?.trim()),
          model: (process.env.META_MODEL || 'Llama-4-Scout-17B-16E-Instruct-FP8').trim(),
          baseUrl: (process.env.META_BASE_URL || 'https://api.llama.com/compat/v1').trim(),
          source: process.env.META_API_KEY?.trim() ? 'env' : 'none',
        },
        muse2api: {
          configured: Boolean(muse2apiStatus?.ready),
          reachable: Boolean(muse2apiStatus?.reachable),
          status: muse2apiStatus?.status || 'offline',
          model: 'muse-spark / muse-image / muse-video',
          baseUrl: muse2apiStatus?.baseUrl || 'http://127.0.0.1:18610',
          accountsCount: muse2apiStatus?.accountsCount || 0,
          healthyAccounts: muse2apiStatus?.healthyAccounts || 0,
          source: muse2apiStatus?.keySource || 'none',
        },
        xingchi: (() => {
          const xc = getXingchiPublicStatus();
          return {
            configured: xc.configured,
            enabled: xc.enabled,
            status: xc.status,
            model: xc.selectedModel,
            reviewModel: xc.reviewModel,
            protocol: xc.protocol,
            webSearch: xc.webSearch,
            disableResponseStorage: xc.disableResponseStorage,
            imageGeneration: xc.imageGeneration,
            baseUrl: xc.baseUrl,
            source: xc.keySource,
          };
        })(),
        alibaba: (() => {
          const ali = getAlibabaModelStudioStatus();
          return {
            configured: ali.configured,
            enabled: ali.enabled,
            status: ali.status,
            model: ali.selectedModel,
            imageModel: ali.imageModel,
            videoModel: ali.videoModel,
            region: ali.region,
            baseUrl: ali.baseUrl,
            source: ali.keySource,
          };
        })(),
      },
      paidModels: {
        omniVideoModel: 'gemini-omni-1.2-flash',
        muse2apiImageModel: 'muse-image',
        muse2apiVideoModel: 'muse-video',
        qwenImageModel: getAlibabaModelStudioStatus().imageModel,
        qwenVideoModel: getAlibabaModelStudioStatus().videoModel,
        imageModel: 'gemini-3.1-flash-lite-image',
        imageProModel: 'gemini-nano-banana-2.1',
        musicClipModel: 'lyria-3-clip-preview',
        musicProModel: 'lyria-3-pro-preview',
        proScriptModel: 'gemini-4-argon',
      },
      brollProviders: {
        wikimedia: { configured: true, freeNoKey: true },
        pexels: { configured: Boolean(process.env.PEXELS_API_KEY?.trim()) },
        pixabay: { configured: Boolean(process.env.PIXABAY_API_KEY?.trim()) },
      },
      localTools: {
        ffmpeg: ffmpegCheck,
        ytDlp: ytDlpCheck,
        node: { available: true, version: process.version },
        offlineTts: offlineTtsCheck,
      },
    });
  });

  app.post('/api/config/test-ai', async (req, res) => {
    try {
      const rawProvider = String(req.body?.provider || 'gemini');
      const provider: AiProviderId =
        rawProvider === 'openai' ||
        rawProvider === 'meta' ||
        rawProvider === 'muse2api' ||
        rawProvider === 'xingchi' ||
        rawProvider === 'alibaba'
          ? rawProvider
          : 'gemini';
      const result = await testAiProviderConnection(provider);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err?.message || 'Kiểm tra kết nối thất bại.' });
    }
  });

  // ==========================================
  // STUDIO MEDIA & AI CREATOR ENDPOINTS
  // ==========================================

  app.post('/api/studio/uploads/init', (req, res) => {
    try {
      const { kind = 'video', fileName = 'uploaded_video.mp4' } = (req.body || {}) as {
        kind?: 'video' | 'audio';
        fileName?: string;
      };
      const session = initStudioChunkedUpload(kind === 'audio' ? 'audio' : 'video', String(fileName || 'uploaded_file'));
      res.json(session);
    } catch (err: any) {
      console.error('Studio chunk init error:', err);
      res.status(500).json({ error: err?.message || 'Không thể khởi tạo phiên tải tệp.' });
    }
  });

  app.post(
    '/api/studio/uploads/:uploadId/chunk',
    express.raw({ type: '*/*', limit: '16mb' }),
    (req, res) => {
      try {
        const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (chunk.byteLength === 0) {
          return res.status(400).json({ error: 'Đoạn dữ liệu tải lên bị rỗng.' });
        }
        const status = appendStudioUploadChunk(req.params.uploadId, chunk);
        res.json({ ok: true, ...status });
      } catch (err: any) {
        console.error('Studio chunk append error:', err);
        res.status(400).json({ error: err?.message || 'Không thể ghi đoạn dữ liệu tải lên.' });
      }
    }
  );

  app.post('/api/studio/uploads/:uploadId/complete', async (req, res) => {
    try {
      const asset = await completeStudioChunkedUpload(req.params.uploadId);
      res.json({ asset });
    } catch (err: any) {
      console.error('Studio chunk complete error:', err);
      res.status(500).json({ error: err?.message || 'Không thể hoàn tất xử lý tệp tải lên.' });
    }
  });

  app.post(
    '/api/studio/upload-video',
    express.raw({ type: '*/*', limit: '200mb' }),
    async (req, res) => {
      try {
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buf.byteLength < 1024) {
          return res.status(400).json({ error: 'Tệp video tải lên rỗng hoặc quá nhỏ.' });
        }
        const rawNameHeader = String(req.headers['x-file-name'] || req.query.name || 'uploaded_video.mp4');
        let fileName = 'uploaded_video.mp4';
        try {
          fileName = decodeURIComponent(rawNameHeader);
        } catch {
          fileName = rawNameHeader;
        }
        const asset = await saveUploadedStudioVideo(buf, fileName);
        res.json({ asset });
      } catch (err: any) {
        console.error('Studio video upload error:', err);
        res.status(500).json({ error: err?.message || 'Không thể xử lý video tải lên.' });
      }
    }
  );

  app.post(
    '/api/studio/upload-audio',
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req, res) => {
      try {
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buf.byteLength < 512) {
          return res.status(400).json({ error: 'Tệp âm thanh tải lên rỗng hoặc quá nhỏ.' });
        }
        const rawNameHeader = String(req.headers['x-file-name'] || req.query.name || 'uploaded_music.mp3');
        let fileName = 'uploaded_music.mp3';
        try {
          fileName = decodeURIComponent(rawNameHeader);
        } catch {
          fileName = rawNameHeader;
        }
        const asset = await saveUploadedStudioAudio(buf, fileName);
        res.json({ asset });
      } catch (err: any) {
        console.error('Studio audio upload error:', err);
        res.status(500).json({ error: err?.message || 'Không thể xử lý tệp âm thanh tải lên.' });
      }
    }
  );

  app.get('/api/studio/assets/:assetId', (req, res) => {
    const asset = getStudioAsset(req.params.assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Tư liệu Studio không tồn tại hoặc đã hết hạn.' });
    }
    const stat = fs.statSync(asset.filePath);
    const total = stat.size;
    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
        if (start < total && end >= start) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', end - start + 1);
          fs.createReadStream(asset.filePath, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.setHeader('Content-Length', total);
    fs.createReadStream(asset.filePath).pipe(res);
  });

  app.get('/api/studio/projects', (_req, res) => {
    try {
      res.json({ projects: listStudioProjectProfiles() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không đọc được danh sách dự án.' });
    }
  });

  app.post('/api/studio/projects', async (req, res) => {
    try {
      const project = saveStudioProjectProfile(req.body || {});
      void syncStudioDirectiveToCommandCenter({
        sourceAction: 'save_project',
        title: project.name,
        ideaOrCommand: project.description || `Hồ sơ dự án Studio "${project.name}"`,
        videoStyle: project.videoStyle,
        allowFreeCostumeChange: project.allowFreeCostumeChange === true,
        characterRefs: project.characterRefs,
        visualBible: project.visualStyleBible,
        settingBible: project.settingBible,
        costumeBible: project.costumeBible,
        continuityBible: project.continuityBible,
      }).catch(() => {});
      res.json({ project, projects: listStudioProjectProfiles() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không lưu được hồ sơ dự án.' });
    }
  });

  app.delete('/api/studio/projects/:id', (req, res) => {
    try {
      const removed = deleteStudioProjectProfile(req.params.id);
      res.json({ ok: removed, projects: listStudioProjectProfiles() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không xóa được hồ sơ dự án.' });
    }
  });

  app.get('/api/studio/character-library', (_req, res) => {
    try {
      res.json({ characters: listStudioCharacterLibrary() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không đọc được thư viện nhân vật.' });
    }
  });

  app.post('/api/studio/character-library', (req, res) => {
    try {
      const character = saveStudioCharacterLibraryItem(req.body || {});
      res.json({ character, characters: listStudioCharacterLibrary() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không lưu được nhân vật vào thư viện.' });
    }
  });

  app.delete('/api/studio/character-library/:id', (req, res) => {
    try {
      const removed = deleteStudioCharacterLibraryItem(req.params.id);
      res.json({ ok: removed, characters: listStudioCharacterLibrary() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không xóa được nhân vật khỏi thư viện.' });
    }
  });

  app.get('/api/studio/library-videos', (_req, res) => {
    try {
      res.json({ videos: listStudioLibraryVideos() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không lấy được thư viện video dự án.' });
    }
  });

  app.post('/api/studio/library-videos/import-job', async (req, res) => {
    try {
      const { jobId = '' } = (req.body || {}) as { jobId?: string };
      if (!String(jobId).trim()) {
        return res.status(400).json({ error: 'Thiếu jobId để nạp vào tham chiếu.' });
      }
      const asset = await importRenderedJobAsLibraryAsset(String(jobId).trim());
      res.json({ asset });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không nạp được video từ thư viện.' });
    }
  });

  app.get('/api/studio/learned-styles', (_req, res) => {
    try {
      res.json({ styles: listLearnedVideoStyles() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không đọc được danh sách phong cách đã học.' });
    }
  });

  app.post('/api/studio/learned-styles/analyze', async (req, res) => {
    const tempCleanupPaths: string[] = [];
    try {
      const {
        sourceUrl = '',
        localAssetId = '',
        styleName = '',
        aiProvider = 'gemini',
        useProModel = false,
        ytCookies = '',
        sessdata = '',
      } = (req.body || {}) as {
        sourceUrl?: string;
        localAssetId?: string;
        styleName?: string;
        aiProvider?: AiProviderId;
        useProModel?: boolean;
        ytCookies?: string;
        sessdata?: string;
      };

      const trimmedUrl = String(sourceUrl || '').trim();
      const trimmedAssetId = String(localAssetId || '').trim();
      let targetVideoPath = '';
      let sourceLabel = '';

      if (trimmedAssetId) {
        const asset = getStudioAsset(trimmedAssetId);
        if (!asset) {
          return res.status(404).json({ error: 'Video tải lên không tồn tại hoặc đã hết hạn. Vui lòng chọn lại file.' });
        }
        targetVideoPath = asset.filePath;
        sourceLabel = asset.fileName;
      } else {
        if (!trimmedUrl || !/^https?:\/\/\S+/i.test(trimmedUrl)) {
          return res.status(400).json({ error: 'Vui lòng nhập link video mẫu hợp lệ (http/https) hoặc chọn file video trên máy.' });
        }
        const ytDlpBin = await ensureYtDlpPath();
        const sampleWorkDir = path.join(DOWNLOAD_DIR, `style_sample_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
        fs.mkdirSync(sampleWorkDir, { recursive: true });
        tempCleanupPaths.push(sampleWorkDir);

        const combinedCookies = ytCookies?.trim() || (sessdata?.trim() ? `SESSDATA=${sessdata.trim()}` : '');
        const cookiePath = writeYtCookiesFile(`style_${Date.now()}`, combinedCookies);
        if (cookiePath) tempCleanupPaths.push(cookiePath);
        const cookieArgs = cookiePath ? ['--cookies', cookiePath] : [];

        const platform = detectPlatformFromUrl(trimmedUrl);
        const effectiveUrl =
          platform === 'facebook' ? await resolveFacebookShareUrl(trimmedUrl, combinedCookies) : trimmedUrl;

        const outStem = path.join(sampleWorkDir, 'sample');
        const ytArgs = [
          '--no-playlist',
          '--js-runtimes',
          'node',
          '--no-warnings',
          '--socket-timeout',
          '25',
          '--retries',
          '4',
          '--max-filesize',
          '120M',
          '-f',
          'bv*[height<=480]+ba/b[height<=480]/b',
          '--merge-output-format',
          'mp4',
          ...cookieArgs,
          '-o',
          `${outStem}.%(ext)s`,
          effectiveUrl,
        ];

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ytDlpBin, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          const timer = setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch {
              // ignore
            }
            reject(new Error('Quá thời gian tải video mẫu (90s). Hãy thử video ngắn hơn hoặc chọn file trực tiếp từ máy.'));
          }, 90_000);
          proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 2500) stderr = stderr.slice(-2500);
          });
          proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(stderr.trim().slice(-240) || `Không tải được video mẫu (yt-dlp mã ${code})`));
          });
          proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });

        const downloadedFiles = fs
          .readdirSync(sampleWorkDir)
          .filter((f) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(f));
        if (downloadedFiles.length === 0) {
          throw new Error('Không tìm thấy tệp video sau khi tải về.');
        }
        targetVideoPath = path.join(sampleWorkDir, downloadedFiles[0]);
        try {
          const u = new URL(trimmedUrl);
          sourceLabel = `${u.hostname.replace(/^www\./, '')}${u.pathname.slice(0, 32)}`;
        } catch {
          sourceLabel = trimmedUrl.slice(0, 60);
        }
      }

      const validProvider: AiProviderId =
        aiProvider === 'openai' ||
        aiProvider === 'meta' ||
        aiProvider === 'muse2api' ||
        aiProvider === 'xingchi' ||
        aiProvider === 'alibaba'
          ? aiProvider
          : 'gemini';

      const style = await analyzeSampleVideoAndLearnStyle({
        videoPath: targetVideoPath,
        sourceLabel,
        sourceUrl: trimmedUrl || undefined,
        styleName: String(styleName || '').trim(),
        aiProvider: validProvider,
        useProModel: Boolean(useProModel),
      });

      res.json({ style, styles: listLearnedVideoStyles() });
    } catch (err: any) {
      console.error('Learn video style error:', err);
      const msg = String(err?.message || 'Không thể phân tích phong cách từ video mẫu.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    } finally {
      for (const p of tempCleanupPaths) {
        try {
          fs.rmSync(p, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  });

  app.delete('/api/studio/learned-styles/:id', (req, res) => {
    try {
      const ok = deleteLearnedVideoStyle(req.params.id);
      res.json({ ok, styles: listLearnedVideoStyles() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể xóa phong cách đã học.' });
    }
  });

  app.post('/api/studio/analyze-characters', async (req, res) => {
    try {
      const {
        characters = [],
        videoStyle,
        customStylePrompt = '',
        ideaContext = '',
        aiProvider = 'gemini',
      } = (req.body || {}) as {
        characters?: {
          id: string;
          name: string;
          dataUrl?: string;
          description?: string;
          ageGroup?: 'auto' | 'child' | 'youth' | 'adult_male' | 'adult_female' | 'middle_aged' | 'elderly';
          gender?: 'auto' | 'male' | 'female';
          syncProfile?: CharacterFivePartProfile;
        }[];
        videoStyle?: StudioVideoStyle;
        customStylePrompt?: string;
        ideaContext?: string;
        aiProvider?: AiProviderId;
      };
      if (!Array.isArray(characters) || characters.length === 0) {
        return res.status(400).json({ error: 'Vui lòng tải lên hoặc tạo ít nhất 1 nhân vật để phân tích.' });
      }
      const validProvider: AiProviderId =
        aiProvider === 'openai' ||
        aiProvider === 'meta' ||
        aiProvider === 'muse2api' ||
        aiProvider === 'xingchi' ||
        aiProvider === 'alibaba'
          ? aiProvider
          : 'gemini';
      const result = await analyzeCharactersFivePartProfiles({
        characters,
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        ideaContext: String(ideaContext || ''),
        aiProvider: validProvider,
      });
      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể phân tích hồ sơ 5 thành phần nhân vật.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.post('/api/studio/generate-image', async (req, res) => {
    try {
      const {
        mode = 'scene',
        prompt = '',
        aspectRatio = '16:9',
        quality = 'standard',
        engine = 'gemini',
        videoStyle,
        customStylePrompt = '',
        characterBible = '',
        settingBible = '',
        visualStyleBible = '',
        costumeBible = '',
        continuityBible = '',
        sceneIndex,
        totalScenes,
        sceneTitle = '',
        charactersInScene = '',
        settingDetail = '',
        actionDetail = '',
        dialogue = '',
        sceneSummary = '',
        costume = '',
        cameraAngle = '',
        vfxNotes = '',
        selectedCharacterIds,
        characterRefs = [],
        allowFreeCostumeChange = false,
      } = (req.body || {}) as {
        mode?: 'character' | 'scene';
        prompt?: string;
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
        allowFreeCostumeChange?: boolean;
        characterRefs?: {
          id?: string;
          dataUrl: string;
          name?: string;
          description?: string;
          syncProfile?: CharacterFivePartProfile;
        }[];
      };
      if (!String(prompt).trim()) {
        return res.status(400).json({ error: 'Vui lòng nhập mô tả để AI tạo hình ảnh.' });
      }
      const result = await generateStudioImage({
        mode: mode === 'character' ? 'character' : 'scene',
        prompt: String(prompt),
        aspectRatio,
        quality: quality === 'pro' ? 'pro' : 'standard',
        engine:
          engine === 'muse2api'
            ? 'muse2api'
            : engine === 'qwen'
            ? 'qwen'
            : engine === 'xingchi'
            ? 'xingchi'
            : 'gemini',
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        characterBible: String(characterBible || ''),
        settingBible: String(settingBible || ''),
        visualStyleBible: String(visualStyleBible || ''),
        costumeBible: String(costumeBible || ''),
        continuityBible: String(continuityBible || ''),
        sceneIndex: typeof sceneIndex === 'number' ? sceneIndex : undefined,
        totalScenes: typeof totalScenes === 'number' ? totalScenes : undefined,
        sceneTitle: String(sceneTitle || ''),
        charactersInScene: String(charactersInScene || ''),
        settingDetail: String(settingDetail || ''),
        actionDetail: String(actionDetail || ''),
        dialogue: String(dialogue || ''),
        sceneSummary: String(sceneSummary || ''),
        costume: String(costume || ''),
        cameraAngle: String(cameraAngle || ''),
        vfxNotes: String(vfxNotes || ''),
        selectedCharacterIds: Array.isArray(selectedCharacterIds) ? selectedCharacterIds : undefined,
        characterRefs: Array.isArray(characterRefs) ? characterRefs : [],
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
      });
      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể tạo ảnh AI.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.post('/api/studio/generate-scene-video', async (req, res) => {
    try {
      const {
        prompt = '',
        aspectRatio = '16:9',
        durationSec = 8,
        engine = 'gemini',
        videoStyle,
        customStylePrompt = '',
        characterBible = '',
        settingBible = '',
        visualStyleBible = '',
        costumeBible = '',
        continuityBible = '',
        sceneIndex,
        totalScenes,
        sceneTitle = '',
        settingDetail = '',
        cameraMovement = '',
        cameraEquipment = '',
        charactersInScene = '',
        actionDetail = '',
        dialogue = '',
        narration = '',
        videoTimeline = '',
        enableVoiceover = true,
        sceneSummary = '',
        costume = '',
        cameraAngle = '',
        vfxNotes = '',
        selectedCharacterIds,
        sceneImageDataUrl,
        characterRefs = [],
        allowFreeCostumeChange = false,
        musicMode,
        musicStyle,
        musicPrompt = '',
        musicVolume,
        musicInstrumentalOnly = true,
        musicDirective = '',
      } = (req.body || {}) as {
        prompt?: string;
        aspectRatio?: DerivativeAspectRatio;
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
        allowFreeCostumeChange?: boolean;
        musicMode?: DerivativeMusicMode;
        musicStyle?: string;
        musicPrompt?: string;
        musicVolume?: number;
        musicInstrumentalOnly?: boolean;
        musicDirective?: string;
        characterRefs?: {
          id?: string;
          dataUrl: string;
          name?: string;
          description?: string;
          syncProfile?: CharacterFivePartProfile;
        }[];
      };
      if (!String(prompt).trim()) {
        return res.status(400).json({ error: 'Thiếu mô tả phân cảnh để dựng clip AI.' });
      }
      const result = await generateSceneVideoWithOmniFlash({
        engine: engine === 'muse2api' ? 'muse2api' : engine === 'qwen' ? 'qwen' : 'gemini',
        prompt: String(prompt),
        aspectRatio: aspectRatio === '9:16' ? '9:16' : aspectRatio === '1:1' ? '1:1' : '16:9',
        durationSec: Number(durationSec) || 8,
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        characterBible: String(characterBible || ''),
        settingBible: String(settingBible || ''),
        visualStyleBible: String(visualStyleBible || ''),
        costumeBible: String(costumeBible || ''),
        continuityBible: String(continuityBible || ''),
        sceneIndex: typeof sceneIndex === 'number' ? sceneIndex : undefined,
        totalScenes: typeof totalScenes === 'number' ? totalScenes : undefined,
        sceneTitle: String(sceneTitle || ''),
        settingDetail: String(settingDetail || ''),
        cameraMovement: String(cameraMovement || ''),
        cameraEquipment: String(cameraEquipment || ''),
        charactersInScene: String(charactersInScene || ''),
        actionDetail: String(actionDetail || ''),
        dialogue: String(dialogue || ''),
        narration: String(narration || ''),
        videoTimeline: String(videoTimeline || ''),
        enableVoiceover: enableVoiceover !== false,
        sceneSummary: String(sceneSummary || ''),
        costume: String(costume || ''),
        cameraAngle: String(cameraAngle || ''),
        vfxNotes: String(vfxNotes || ''),
        selectedCharacterIds: Array.isArray(selectedCharacterIds) ? selectedCharacterIds : undefined,
        sceneImageDataUrl,
        characterRefs: Array.isArray(characterRefs) ? characterRefs : [],
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        musicMode,
        musicStyle: typeof musicStyle === 'string' ? musicStyle : undefined,
        musicPrompt: String(musicPrompt || ''),
        musicVolume: typeof musicVolume === 'number' ? Math.max(0, Math.min(0.9, musicVolume)) : undefined,
        musicInstrumentalOnly: musicInstrumentalOnly !== false,
        musicDirective: String(musicDirective || ''),
      });
      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể tạo clip video AI.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.post('/api/studio/generate-music', async (req, res) => {
    try {
      const {
        prompt = '',
        mode = 'clip',
        styleId = 'auto_context',
        instrumentalOnly = true,
      } = (req.body || {}) as {
        prompt?: string;
        mode?: 'clip' | 'pro';
        styleId?: string;
        instrumentalOnly?: boolean;
      };
      const result = await generateStudioMusicWithLyria({
        prompt: String(prompt || ''),
        mode: mode === 'pro' ? 'pro' : 'clip',
        styleId: String(styleId || 'auto_context'),
        instrumentalOnly: instrumentalOnly !== false,
      });
      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể sáng tác nhạc nền bằng Lyria AI.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.get('/api/studio/public-music', async (req, res) => {
    try {
      const q = String(req.query.q || 'ambient instrumental music');
      const tracks = await searchPublicFreeMusicFromWikimedia(q);
      res.json({ tracks });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không tìm được nhạc nền công cộng.' });
    }
  });

  app.post('/api/studio/expand-idea', async (req, res) => {
    try {
      const {
        seedIdea = '',
        settingHint = '',
        videoStyle = 'cinematic',
        customStylePrompt = '',
        scriptMode = 'series',
        ideaCount = 3,
        targetDurationSec = 60,
        outputLanguage = 'vi',
        characterSummary = '',
        characterRefsMeta = [],
        allowFreeCostumeChange = false,
        aiProvider = 'gemini',
        useProModel = false,
      } = (req.body || {}) as {
        seedIdea?: string;
        settingHint?: string;
        videoStyle?: StudioVideoStyle;
        customStylePrompt?: string;
        scriptMode?: StudioScriptMode;
        ideaCount?: number;
        targetDurationSec?: number;
        outputLanguage?: DerivativeOutputLanguage;
        characterSummary?: string;
        characterRefsMeta?: {
          id: string;
          name: string;
          description?: string;
          ageGroup?: 'auto' | 'child' | 'youth' | 'adult_male' | 'adult_female' | 'middle_aged' | 'elderly';
          gender?: 'auto' | 'male' | 'female';
          voiceId?: Exclude<DerivativeVoiceId, 'none'>;
          syncProfile?: CharacterFivePartProfile;
        }[];
        allowFreeCostumeChange?: boolean;
        aiProvider?: AiProviderId;
        useProModel?: boolean;
      };

      const validProvider: AiProviderId =
        aiProvider === 'openai' ||
        aiProvider === 'meta' ||
        aiProvider === 'muse2api' ||
        aiProvider === 'xingchi' ||
        aiProvider === 'alibaba'
          ? aiProvider
          : 'gemini';

      const clampedIdeaCount = Math.max(1, Math.min(15, Math.round(Number(ideaCount || 3))));
      const result = await expandStudioIdeaWithAi({
        seedIdea: String(seedIdea || ''),
        settingHint: String(settingHint || ''),
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        scriptMode: scriptMode === 'independent_batch' ? 'independent_batch' : 'series',
        ideaCount: clampedIdeaCount,
        targetDurationSec: Number(targetDurationSec || 60),
        outputLanguage,
        characterSummary: String(characterSummary || ''),
        characterRefsMeta: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        aiProvider: validProvider,
        useProModel: Boolean(useProModel),
      });

      void syncStudioDirectiveToCommandCenter({
        sourceAction: 'expand_idea',
        mode: 'creative',
        title: String(seedIdea || '').trim().slice(0, 60) || 'Ý tưởng Studio mới',
        ideaOrCommand: result?.expandedIdea || String(seedIdea || ''),
        videoStyle,
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        characterRefs: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
        settingBible: String(settingHint || ''),
      }).catch(() => {});

      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể triển khai ý tưởng lúc này.');
      res.status(msg.includes('Vui lòng') ? 400 : msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.post('/api/studio/analyze-video-idea', async (req, res) => {
    try {
      const {
        videos = [],
        outputLanguage = 'vi',
        videoStyle = 'cinematic',
        customStylePrompt = '',
        characterSummary = '',
        allowFreeCostumeChange = false,
        aiProvider = 'gemini',
        useProModel = false,
      } = (req.body || {}) as {
        videos?: DerivativeSourceInput[];
        outputLanguage?: DerivativeOutputLanguage;
        videoStyle?: StudioVideoStyle;
        customStylePrompt?: string;
        characterSummary?: string;
        allowFreeCostumeChange?: boolean;
        aiProvider?: AiProviderId;
        useProModel?: boolean;
      };

      const safeVideos = Array.isArray(videos) ? videos.slice(0, 8) : [];
      if (safeVideos.length === 0) {
        return res.status(400).json({
          error: 'Vui lòng tải lên hoặc chọn ít nhất 1 video tham chiếu trước khi nhờ AI xem video.',
        });
      }

      const validProvider: AiProviderId =
        aiProvider === 'openai' ||
        aiProvider === 'meta' ||
        aiProvider === 'muse2api' ||
        aiProvider === 'xingchi' ||
        aiProvider === 'alibaba'
          ? aiProvider
          : 'gemini';

      const result = await analyzeReferenceVideosToIdeaPrompt({
        videos: safeVideos,
        outputLanguage,
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        characterSummary: String(characterSummary || ''),
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        aiProvider: validProvider,
        useProModel: Boolean(useProModel),
      });

      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể xem và phân tích video tham chiếu lúc này.');
      res
        .status(msg.includes('Vui lòng') ? 400 : msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500)
        .json({ error: msg });
    }
  });

  app.post('/api/derivative/learn', async (req, res) => {
    try {
      const {
        mode = 'derivative',
        scriptMode = 'series',
        productionFormat = 'dialogue_film',
        videoCount = 3,
        ideaCount,
        perVideoDurations,
        ideaPrompt = '',
        query = '',
        videos = [],
        stylePreset = 'none',
        videoStyle = 'cinematic',
        customStylePrompt = '',
        aspectRatio = '9:16',
        targetDurationSec,
        sceneDurationSec,
        targetDuration = 'short',
        desiredSceneCount,
        outputLanguage = 'vi',
        useProModel = false,
        characterSummary = '',
        characterRefsMeta = [],
        characterBible = '',
        settingBible = '',
        visualStyleBible = '',
        costumeBible = '',
        continuityBible = '',
        customInstruction = '',
        enableVoiceover = true,
        allowFreeCostumeChange = false,
        preserveExactIdea = false,
        directFromSelectedIdea = false,
        selectedIdeaTitle = '',
        prePlannedIdeas,
        aiProvider = 'gemini',
      } = (req.body || {}) as {
        mode?: StudioCreationMode;
        scriptMode?: StudioScriptMode;
        productionFormat?: 'dialogue_film' | 'narration_story';
        videoCount?: number;
        ideaCount?: number;
        perVideoDurations?: number[];
        ideaPrompt?: string;
        query?: string;
        videos?: DerivativeSourceInput[];
        stylePreset?: DerivativeStylePreset;
        videoStyle?: StudioVideoStyle;
        customStylePrompt?: string;
        aspectRatio?: DerivativeAspectRatio;
        targetDurationSec?: number;
        sceneDurationSec?: number;
        targetDuration?: 'short' | 'medium';
        desiredSceneCount?: number;
        outputLanguage?: DerivativeOutputLanguage;
        useProModel?: boolean;
        characterSummary?: string;
        characterRefsMeta?: {
          id: string;
          name: string;
          description?: string;
          ageGroup?: 'auto' | 'child' | 'youth' | 'adult_male' | 'adult_female' | 'middle_aged' | 'elderly';
          gender?: 'auto' | 'male' | 'female';
          voiceId?: Exclude<DerivativeVoiceId, 'none'>;
          syncProfile?: CharacterFivePartProfile;
        }[];
        characterBible?: string;
        settingBible?: string;
        visualStyleBible?: string;
        costumeBible?: string;
        continuityBible?: string;
        customInstruction?: string;
        enableVoiceover?: boolean;
        allowFreeCostumeChange?: boolean;
        preserveExactIdea?: boolean;
        directFromSelectedIdea?: boolean;
        selectedIdeaTitle?: string;
        prePlannedIdeas?: {
          title: string;
          summary?: string;
          detail?: string;
          suggestedSetting?: string;
        }[];
        aiProvider?: AiProviderId;
      };

      const studioMode: StudioCreationMode = mode === 'creative' ? 'creative' : 'derivative';
      const resolvedScriptMode: StudioScriptMode =
        scriptMode === 'independent_batch' ? 'independent_batch' : 'series';
      const resolvedProductionFormat: 'dialogue_film' | 'narration_story' =
        productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';
      const safeVideos = Array.isArray(videos) ? videos.slice(0, 8) : [];

      if (studioMode === 'creative') {
        if (!String(ideaPrompt || query || customInstruction || '').trim()) {
          return res.status(400).json({ error: 'Vui lòng nhập ý tưởng hoặc mô tả chủ đề để Studio Sáng Tạo lên kịch bản.' });
        }
      } else if (safeVideos.length === 0) {
        return res.status(400).json({ error: 'Vui lòng chọn hoặc tải lên ít nhất 1 video tham chiếu để AI học nội dung.' });
      }

      const validProvider: AiProviderId =
        aiProvider === 'openai' ||
        aiProvider === 'meta' ||
        aiProvider === 'muse2api' ||
        aiProvider === 'xingchi' ||
        aiProvider === 'alibaba'
          ? aiProvider
          : 'gemini';
      const resolvedAspectRatio: DerivativeAspectRatio =
        aspectRatio === '16:9' ? '16:9' : aspectRatio === '1:1' ? '1:1' : '9:16';

      if (resolvedScriptMode === 'independent_batch' && !directFromSelectedIdea) {
        const cleanPrePlanned = Array.isArray(prePlannedIdeas)
          ? prePlannedIdeas
              .filter(
                (it) =>
                  it &&
                  (String(it.title || '').trim() ||
                    String(it.summary || '').trim() ||
                    String(it.detail || '').trim())
              )
              .slice(0, 15)
          : undefined;
        const count =
          cleanPrePlanned && cleanPrePlanned.length > 0
            ? cleanPrePlanned.length
            : Math.max(1, Math.min(15, Math.round(Number(videoCount || ideaCount || 3))));
        const cleanUnitDur =
          typeof targetDurationSec === 'number' && Number.isFinite(targetDurationSec)
            ? Math.max(10, Math.min(900, Math.round(targetDurationSec)))
            : undefined;
        const cleanDurations = Array.isArray(perVideoDurations)
          ? perVideoDurations.map((d) => Math.max(10, Math.min(900, Math.round(Number(d) || cleanUnitDur || 30))))
          : undefined;
        const batchResult = await learnAndCreateIndependentBatch({
          mode: studioMode,
          productionFormat: resolvedProductionFormat,
          ideaPrompt: String(ideaPrompt || ''),
          selectedIdeaTitle: String(selectedIdeaTitle || ''),
          query: String(query || ''),
          videos: safeVideos,
          videoCount: count,
          perVideoDurations: cleanDurations,
          targetDurationSec: cleanUnitDur,
          desiredSceneCount: typeof desiredSceneCount === 'number' ? desiredSceneCount : undefined,
          stylePreset,
          videoStyle,
          customStylePrompt: String(customStylePrompt || ''),
          aspectRatio: resolvedAspectRatio,
          outputLanguage,
          useProModel: Boolean(useProModel),
          characterSummary: String(characterSummary || ''),
          characterRefsMeta: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
          characterBible: String(characterBible || ''),
          settingBible: String(settingBible || ''),
          visualStyleBible: String(visualStyleBible || ''),
          costumeBible: String(costumeBible || ''),
          continuityBible: String(continuityBible || ''),
          customInstruction: String(customInstruction || ''),
          enableVoiceover: enableVoiceover !== false,
          allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
          aiProvider: validProvider,
          prePlannedIdeas: cleanPrePlanned,
        });
        void syncStudioDirectiveToCommandCenter({
          sourceAction: 'learn_script',
          mode: studioMode,
          title: batchResult.blueprints[0]?.derivativeTitle,
          ideaOrCommand: String(ideaPrompt || query || customInstruction || '').trim(),
          productionFormat: resolvedProductionFormat,
          aspectRatio: resolvedAspectRatio,
          videoStyle,
          allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
          characterRefs: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
          visualBible: String(visualStyleBible || ''),
          settingBible: String(settingBible || ''),
          costumeBible: String(costumeBible || ''),
          continuityBible: String(continuityBible || ''),
          blueprint: batchResult.blueprints[0],
        }).catch(() => {});
        return res.json({
          blueprint: batchResult.blueprints[0],
          blueprints: batchResult.blueprints,
          sharedSpiritNote: batchResult.sharedSpiritNote,
          coreMotif: batchResult.coreMotif,
        });
      }

      const blueprint = await learnVideosAndCreateBlueprint({
        mode: studioMode,
        scriptMode: directFromSelectedIdea ? resolvedScriptMode : 'series',
        productionFormat: resolvedProductionFormat,
        ideaPrompt: String(ideaPrompt || ''),
        selectedIdeaTitle: String(selectedIdeaTitle || ''),
        preserveExactIdea: Boolean(preserveExactIdea || directFromSelectedIdea),
        query: String(query || ''),
        videos: safeVideos,
        stylePreset,
        videoStyle,
        customStylePrompt: String(customStylePrompt || ''),
        aspectRatio: resolvedAspectRatio,
        targetDurationSec: typeof targetDurationSec === 'number' ? targetDurationSec : undefined,
        sceneDurationSec:
          resolvedScriptMode === 'series' && typeof sceneDurationSec === 'number' && Number.isFinite(sceneDurationSec)
            ? Math.max(5, Math.min(300, Math.round(sceneDurationSec)))
            : undefined,
        targetDuration: targetDuration === 'medium' ? 'medium' : 'short',
        desiredSceneCount:
          typeof desiredSceneCount === 'number'
            ? desiredSceneCount
            : resolvedScriptMode === 'series' && typeof ideaCount === 'number' && Number.isFinite(ideaCount)
            ? Math.max(1, Math.min(15, Math.round(ideaCount)))
            : undefined,
        outputLanguage,
        useProModel: Boolean(useProModel),
        characterSummary: String(characterSummary || ''),
        characterRefsMeta: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
        characterBible: String(characterBible || ''),
        settingBible: String(settingBible || ''),
        visualStyleBible: String(visualStyleBible || ''),
        costumeBible: String(costumeBible || ''),
        continuityBible: String(continuityBible || ''),
        customInstruction: String(customInstruction || ''),
        enableVoiceover: enableVoiceover !== false,
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        aiProvider: validProvider,
      });

      void syncStudioDirectiveToCommandCenter({
        sourceAction: 'learn_script',
        mode: studioMode,
        title: blueprint?.derivativeTitle,
        ideaOrCommand: String(ideaPrompt || query || customInstruction || '').trim(),
        productionFormat: resolvedProductionFormat,
        aspectRatio: resolvedAspectRatio,
        videoStyle,
        allowFreeCostumeChange: Boolean(allowFreeCostumeChange),
        characterRefs: Array.isArray(characterRefsMeta) ? characterRefsMeta : [],
        visualBible: String(visualStyleBible || ''),
        settingBible: String(settingBible || ''),
        costumeBible: String(costumeBible || ''),
        continuityBible: String(continuityBible || ''),
        blueprint,
      }).catch(() => {});

      res.json({ blueprint, blueprints: [blueprint] });
    } catch (err: any) {
      console.error('Derivative learn error:', err);
      const msg = String(err?.message || 'Không thể phân tích & lập kịch bản video.');
      res.status(msg.includes('503') ? 503 : msg.includes('429') ? 429 : 500).json({ error: msg });
    }
  });

  app.get('/api/tts/offline/voices', async (_req, res) => {
    try {
      const data = await listVieNeuVoices();
      res.json({ ok: true, ...data });
    } catch (err: any) {
      res.status(500).json({ ok: false, available: false, voices: [], error: err?.message || 'Không lấy được danh sách giọng VieNeu-TTS.' });
    }
  });

  app.post('/api/tts/offline/setup', async (_req, res) => {
    try {
      const result = await installAndWarmupVieNeu();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Không thể cài đặt thư viện VieNeu-TTS Offline.' });
    }
  });

  app.post('/api/tts/offline/preview', async (req, res) => {
    try {
      const { text = '', voice = '' } = (req.body || {}) as { text?: string; voice?: string };
      const wavBuf = await synthesizeOfflineVoicePreview(String(text || ''), String(voice || ''));
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', String(wavBuf.byteLength));
      res.setHeader('Cache-Control', 'no-store');
      res.send(wavBuf);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tổng hợp giọng đọc thử VieNeu-TTS.' });
    }
  });

  app.post('/api/tts/gemini/preview', async (req, res) => {
    try {
      const {
        text = '',
        voice = 'Kore',
        voiceStyle = '',
        characterName = '',
      } = (req.body || {}) as {
        text?: string;
        voice?: string;
        voiceStyle?: string;
        characterName?: string;
      };
      const wavBuf = await synthesizeGeminiVoicePreview({
        text: String(text || ''),
        voice: String(voice || 'Kore'),
        voiceStyle: String(voiceStyle || ''),
        characterName: String(characterName || ''),
      });
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', String(wavBuf.byteLength));
      res.setHeader('Cache-Control', 'no-store');
      res.send(wavBuf);
    } catch (err: any) {
      const msg = String(err?.message || 'Không thể tổng hợp giọng đọc thử Gemini.');
      const status =
        msg.includes('trống') || msg.includes('Chưa cấu hình') || msg.includes('403') || msg.includes('API')
          ? 400
          : msg.includes('429')
          ? 429
          : msg.includes('503')
          ? 503
          : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/derivative/generate', async (req, res) => {
    try {
      const {
        blueprint,
        sources,
        visualMode = 'muse2api_video',
        voice = 'Kore',
        voiceMode,
        voiceStyle = '',
        offlineVoice = '',
        keepSourceAudio = false,
        brollSource = 'wikimedia',
        musicMode = 'none',
        musicStyle = 'auto_context',
        musicInstrumentalOnly = true,
        musicAssetId,
        publicMusicUrl,
        musicPrompt = '',
        musicVolume = 0.22,
        characterRefs = [],
        sessdata,
        ytCookies,
      } = (req.body || {}) as {
        blueprint?: DerivativeBlueprint;
        sources?: DerivativeSourceInput[];
        visualMode?: DerivativeVisualMode;
        voice?: DerivativeVoiceId;
        voiceMode?: DerivativeVoiceMode;
        voiceStyle?: string;
        offlineVoice?: string;
        keepSourceAudio?: boolean;
        brollSource?: BrollSourceId;
        musicMode?: DerivativeMusicMode;
        musicStyle?: string;
        musicInstrumentalOnly?: boolean;
        musicAssetId?: string;
        publicMusicUrl?: string;
        musicPrompt?: string;
        musicVolume?: number;
        characterRefs?: {
          id?: string;
          dataUrl: string;
          name?: string;
          description?: string;
          ageGroup?: 'auto' | 'child' | 'youth' | 'adult_male' | 'adult_female' | 'middle_aged' | 'elderly';
          gender?: 'auto' | 'male' | 'female';
          voiceMode?: 'default' | 'ai_online' | 'offline_system';
          voiceId?: Exclude<DerivativeVoiceId, 'none'>;
          offlineVoice?: string;
          voiceStyle?: string;
          syncProfile?: CharacterFivePartProfile;
        }[];
        sessdata?: string;
        ytCookies?: string;
      };

      if (!blueprint || !Array.isArray(blueprint.scenes) || blueprint.scenes.length === 0) {
        return res.status(400).json({ error: 'Thiếu kịch bản phân cảnh để dựng video.' });
      }
      const safeSources = Array.isArray(sources) ? sources.slice(0, 8) : [];
      if (blueprint.mode !== 'creative' && safeSources.length === 0) {
        const hasSelfContainedVisuals = blueprint.scenes.some(
          (sc) => Boolean(sc.sceneImageDataUrl || sc.omniClipAssetId)
        );
        if (!hasSelfContainedVisuals && visualMode === 'remix') {
          return res.status(400).json({ error: 'Thiếu danh sách video nguồn tham chiếu hoặc ảnh/clip phân cảnh.' });
        }
      }

      const validVisualMode: DerivativeVisualMode =
        visualMode === 'gemini_omni' ||
        visualMode === 'storyboard_motion' ||
        visualMode === 'muse2api_video' ||
        visualMode === 'qwen_video'
          ? visualMode
          : 'remix';

      const job = startDerivativeVideoJob({
        blueprint,
        sources: safeSources,
        visualMode: validVisualMode,
        voice: voice || 'Kore',
        voiceMode,
        voiceStyle,
        offlineVoice: String(offlineVoice || '').trim() || undefined,
        keepSourceAudio: Boolean(keepSourceAudio),
        brollSource,
        musicMode,
        musicStyle,
        musicInstrumentalOnly: musicInstrumentalOnly !== false,
        musicAssetId,
        publicMusicUrl,
        musicPrompt,
        musicVolume: Math.max(0, Math.min(0.9, Number(musicVolume ?? 0.22))),
        characterRefs: Array.isArray(characterRefs) ? characterRefs : [],
        downloadSourceVideo: (src, outPath) =>
          downloadSourceVideoForDerivative(src, outPath, sessdata, ytCookies),
      });

      void syncStudioDirectiveToCommandCenter({
        sourceAction: 'generate_video',
        mode: blueprint.mode === 'derivative' ? 'derivative' : 'creative',
        title: blueprint.derivativeTitle,
        ideaOrCommand: blueprint.ideaPrompt || blueprint.learnedSummary || '',
        productionFormat: blueprint.productionFormat,
        aspectRatio: blueprint.aspectRatio,
        videoStyle: blueprint.videoStyle,
        allowFreeCostumeChange: blueprint.allowFreeCostumeChange === true,
        characterRefs: Array.isArray(characterRefs) ? characterRefs : [],
        visualBible: blueprint.visualStyleBible,
        settingBible: blueprint.settingBible,
        costumeBible: blueprint.costumeBible,
        continuityBible: blueprint.continuityBible,
        blueprint,
      }).catch(() => {});

      res.json({
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        stepLabel: job.stepLabel,
        fileName: job.fileName,
      });
    } catch (err: any) {
      console.error('Derivative generate error:', err);
      res.status(500).json({ error: err?.message || 'Không thể khởi tạo tác vụ tạo video phái sinh.' });
    }
  });

  // ==========================================
  // MUSE2API PROXY & ACCOUNT POOL ENDPOINTS
  // ==========================================
  app.get('/api/muse2api/status', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const status = await getMuse2ApiStatus(force);
      if (force) {
        void checkAllAiReadiness(true).catch(() => {});
      }
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ reachable: false, ready: false, status: 'offline', error: err?.message || 'Lỗi kiểm tra Muse2API.' });
    }
  });

  app.post('/api/muse2api/config', async (req, res) => {
    try {
      const rawUrl = String(req.body?.baseUrl || '').trim();
      let normalizedUrl = '';
      if (rawUrl) {
        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return res.status(400).json({ error: 'Địa chỉ Muse2API không đúng định dạng URL (ví dụ: http://127.0.0.1:18610 hoặc https://muse.domain.com).' });
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'URL Muse2API chỉ chấp nhận giao thức http:// hoặc https://.' });
        }
        normalizedUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
      }
      setMuse2ApiRuntimeOverride({ baseUrl: normalizedUrl });
      const status = await getMuse2ApiStatus(true);
      const readiness = await checkAllAiReadiness(true);
      const state = await getCoordinationCenterState(false);
      res.json({ ok: true, status, readiness, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu cấu hình Muse2API.' });
    }
  });

  app.post('/api/muse2api/process/start', async (_req, res) => {
    try {
      const result = await startLocalMuse2ApiProcess();
      await checkAllAiReadiness(true).catch(() => {});
      const state = await getCoordinationCenterState(false).catch(() => null);
      res.status(result.ok ? 200 : 400).json({ ...result, state });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err?.message || 'Không thể khởi chạy Muse2API.' });
    }
  });

  app.post('/api/muse2api/process/stop', async (_req, res) => {
    const result = stopLocalMuse2ApiProcess();
    await checkAllAiReadiness(true).catch(() => {});
    const state = await getCoordinationCenterState(false).catch(() => null);
    res.json({ ...result, state });
  });

  app.get('/api/muse2api/accounts', async (_req, res) => {
    try {
      const data = await listMuse2ApiAccounts();
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Không lấy được danh sách tài khoản Muse2API.' });
    }
  });

  app.post('/api/muse2api/accounts', async (req, res) => {
    try {
      const { label, cookieHeader, batch } = (req.body || {}) as {
        label?: string;
        cookieHeader?: string;
        batch?: string;
      };
      const data = await addMuse2ApiAccount({ label, cookieHeader, batch });
      void checkAllAiReadiness(true).catch(() => {});
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thêm được tài khoản Muse2API.' });
    }
  });

  app.post('/api/muse2api/accounts/keepalive', async (_req, res) => {
    try {
      const data = await keepaliveAllMuse2ApiAccounts();
      void checkAllAiReadiness(true).catch(() => {});
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Không thể gia hạn đồng loạt tài khoản Muse2API.' });
    }
  });

  app.post('/api/muse2api/accounts/:id/test', async (req, res) => {
    try {
      const data = await testMuse2ApiAccount(req.params.id);
      void checkAllAiReadiness(true).catch(() => {});
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err?.message || 'Kiểm tra tài khoản thất bại.' });
    }
  });

  app.post('/api/muse2api/accounts/:id/keepalive', async (req, res) => {
    try {
      const data = await keepaliveMuse2ApiAccount(req.params.id);
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err?.message || 'Gia hạn phiên thất bại.' });
    }
  });

  app.post('/api/muse2api/accounts/:id/quota', async (req, res) => {
    try {
      const data = await quotaMuse2ApiAccount(req.params.id);
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err?.message || 'Không tra cứu được hạn mức Muse.ai.' });
    }
  });

  app.patch('/api/muse2api/accounts/:id', async (req, res) => {
    try {
      const { label, enabled } = (req.body || {}) as { label?: string; enabled?: boolean };
      const data = await patchMuse2ApiAccount(req.params.id, { label, enabled });
      void checkAllAiReadiness(true).catch(() => {});
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Cập nhật tài khoản thất bại.' });
    }
  });

  app.delete('/api/muse2api/accounts/:id', async (req, res) => {
    try {
      const data = await deleteMuse2ApiAccount(req.params.id);
      void checkAllAiReadiness(true).catch(() => {});
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Xóa tài khoản thất bại.' });
    }
  });

  app.get('/api/muse2api/tasks', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
      const data = await listMuse2ApiTasks(limit);
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Không lấy được lịch sử tác vụ Muse2API.' });
    }
  });

  app.get('/api/muse2api/media', async (_req, res) => {
    try {
      const data = await listMuse2ApiMedia();
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Không lấy được danh sách tệp media Muse2API.' });
    }
  });

  // ==========================================
  // PHÒNG ĐIỀU HÀNH AI MUSE (AI MUSE COMMAND CENTER)
  // ==========================================
  app.get('/api/command-center/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let closed = false;
    const writeEvent = (eventType: string, payload: unknown) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // client disconnected
      }
    };

    const unsubscribe = subscribeCommandCenterEvents((evt) => {
      writeEvent(evt.type, evt.data);
    });

    const keepaliveTimer = setInterval(() => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 20000);

    try {
      const initial = await getCommandCenterState(false);
      writeEvent('state:sync', initial);
    } catch {
      // ignore initial sync error
    }

    req.on('close', () => {
      closed = true;
      clearInterval(keepaliveTimer);
      unsubscribe();
    });
  });

  app.get('/api/command-center/state', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const state = await getCommandCenterState(force);
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tải trạng thái Phòng Điều Hành AI Muse.' });
    }
  });

  app.post('/api/command-center/agents/:id', async (req, res) => {
    try {
      const state = await updateMuseAgentConfig(req.params.id as any, req.body || {});
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể cập nhật cấu hình Muse AI.' });
    }
  });

  app.post('/api/command-center/agents/:id/pause', async (req, res) => {
    try {
      const state = await updateMuseAgentConfig(req.params.id as any, { paused: true });
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạm dừng Muse AI.' });
    }
  });

  app.post('/api/command-center/agents/:id/resume', async (req, res) => {
    try {
      const state = await updateMuseAgentConfig(req.params.id as any, { paused: false });
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tiếp tục Muse AI.' });
    }
  });

  app.post('/api/command-center/agents/:id/test', async (req, res) => {
    try {
      const result = await testMuseAgentConnection(req.params.id as any);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Kiểm tra kết nối Muse AI thất bại.' });
    }
  });

  app.post('/api/command-center/studio-sync', async (req, res) => {
    try {
      const body = req.body || {};
      const state = await syncStudioDirectiveToCommandCenter({
        sourceAction: 'manual_dispatch',
        ...body,
      });
      // When Studio dispatches a production order, create an isolated session in the new AI Coordination Center
      let coordinationSession: any = null;
      const action = String(body.sourceAction || 'manual_dispatch');
      if (action === 'manual_dispatch' || action === 'generate_video' || body.createCoordinationSession === true) {
        const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
        coordinationSession = await createSessionFromStudio(
          {
            title: body.title,
            ideaOrCommand: body.ideaOrCommand,
            videoSource: body.videoSource,
            aspectRatio: body.aspectRatio,
            videoStyle: body.videoStyle,
            allowFreeCostumeChange: body.allowFreeCostumeChange,
            visualBible: body.visualBible,
            settingBible: body.settingBible,
            costumeBible: body.costumeBible,
            continuityBible: body.continuityBible,
            characterRefs: body.characterRefs,
            blueprint: body.blueprint,
            sourceAction: 'studio_dispatch',
            musicConfig: body.musicConfig,
          },
          googleToken
        );
      }
      res.json({ ...state, coordinationSession });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể đồng bộ chỉ thị từ Studio.' });
    }
  });

  app.post('/api/command-center/productions/create', async (req, res) => {
    try {
      const state = await createEmptyProductionSession(req.body?.title);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạo phiên sản xuất mới.' });
    }
  });

  app.post('/api/command-center/productions/start', async (req, res) => {
    try {
      const state = await startProductionOrchestration(req.body || {});
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể khởi động dây chuyền sản xuất.' });
    }
  });

  // ---- Gemini API Pool Management (Multi-Key + Chairman) ----
  app.get('/api/gemini-accounts', (_req, res) => {
    try {
      res.json({
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tải danh sách Gemini API.' });
    }
  });

  app.post('/api/gemini-accounts', (req, res) => {
    try {
      const account = addGeminiAccount({
        label: String(req.body?.label || ''),
        apiKey: String(req.body?.apiKey || ''),
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        preferredModel: typeof req.body?.preferredModel === 'string' ? req.body.preferredModel : undefined,
        setAsChairman: req.body?.setAsChairman === true,
      });
      res.json({
        account,
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể thêm tài khoản Gemini API.' });
    }
  });

  app.patch('/api/gemini-accounts/:id', (req, res) => {
    try {
      const account = updateGeminiAccount(req.params.id, {
        label: typeof req.body?.label === 'string' ? req.body.label : undefined,
        apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        preferredModel: typeof req.body?.preferredModel === 'string' ? req.body.preferredModel : undefined,
      });
      res.json({
        account,
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể cập nhật tài khoản Gemini API.' });
    }
  });

  app.delete('/api/gemini-accounts/:id', (req, res) => {
    try {
      deleteGeminiAccount(req.params.id);
      res.json({
        ok: true,
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể xóa tài khoản Gemini API.' });
    }
  });

  app.post('/api/gemini-accounts/:id/test', async (req, res) => {
    try {
      const result = await testGeminiAccountConnection(req.params.id);
      res.json({
        ...result,
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Kiểm tra kết nối Gemini API thất bại.' });
    }
  });

  app.post('/api/gemini-accounts/:id/set-chairman', (req, res) => {
    try {
      const account = setChairmanGeminiAccount(req.params.id);
      res.json({
        account,
        accounts: listGeminiAccountsPublic(),
        summary: getGeminiPoolSummary(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể đổi Chỉ huy trưởng Gemini.' });
    }
  });

  // ==========================================
  // XINGCHI API GATEWAY (https://api.xingchiapi.com)
  // ==========================================
  app.get('/api/xingchi/status', (_req, res) => {
    try {
      res.json(getXingchiPublicStatus());
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tải trạng thái kết nối Xingchi API.' });
    }
  });

  app.patch('/api/xingchi/config', (req, res) => {
    try {
      const rawProtocol = req.body?.protocol;
      const protocol =
        rawProtocol === 'responses' || rawProtocol === 'openai' || rawProtocol === 'anthropic'
          ? rawProtocol
          : undefined;
      const status = updateXingchiConfig({
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        protocol,
        selectedModel: typeof req.body?.selectedModel === 'string' ? req.body.selectedModel : undefined,
        reviewModel: typeof req.body?.reviewModel === 'string' ? req.body.reviewModel : undefined,
        webSearch:
          req.body?.webSearch === 'live' || req.body?.webSearch === 'off'
            ? req.body.webSearch
            : undefined,
        disableResponseStorage:
          typeof req.body?.disableResponseStorage === 'boolean'
            ? req.body.disableResponseStorage
            : undefined,
        imageGeneration:
          typeof req.body?.imageGeneration === 'boolean' ? req.body.imageGeneration : undefined,
        apiKeyModelDiscovery:
          typeof req.body?.apiKeyModelDiscovery === 'boolean'
            ? req.body.apiKeyModelDiscovery
            : undefined,
        httpHeaders:
          req.body?.httpHeaders && typeof req.body.httpHeaders === 'object'
            ? req.body.httpHeaders
            : undefined,
        timeoutSec: req.body?.timeoutSec !== undefined ? Number(req.body.timeoutSec) : undefined,
      });
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu cấu hình Xingchi API.' });
    }
  });

  app.post('/api/xingchi/import-toml', (req, res) => {
    try {
      const result = importXingchiTomlConfig(String(req.body?.toml || ''));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Không thể phân tích cấu hình TOML.' });
    }
  });

  app.get('/api/xingchi/models', async (_req, res) => {
    try {
      const result = await fetchXingchiModels();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Không thể tải danh sách model Xingchi API.' });
    }
  });

  app.post('/api/xingchi/test', async (req, res) => {
    try {
      const rawProtocol = req.body?.protocol;
      const protocol =
        rawProtocol === 'responses' || rawProtocol === 'openai' || rawProtocol === 'anthropic'
          ? rawProtocol
          : undefined;
      const result = await testXingchiConnection({
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        protocol,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Kiểm tra kết nối Xingchi API thất bại.' });
    }
  });

  app.post('/api/xingchi/chat', async (req, res) => {
    try {
      const rawProtocol = req.body?.protocol;
      const protocol =
        rawProtocol === 'responses' || rawProtocol === 'openai' || rawProtocol === 'anthropic'
          ? rawProtocol
          : undefined;
      const result = await chatWithXingchi({
        prompt: String(req.body?.prompt || ''),
        systemPrompt: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        protocol,
        useWebSearch: typeof req.body?.useWebSearch === 'boolean' ? req.body.useWebSearch : undefined,
        maxTokens: req.body?.maxTokens !== undefined ? Number(req.body.maxTokens) : undefined,
        temperature: req.body?.temperature !== undefined ? Number(req.body.temperature) : undefined,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Gửi yêu cầu thử tới Xingchi API thất bại.' });
    }
  });

  app.post('/api/xingchi/image-test', async (req, res) => {
    try {
      const aspectRatio =
        req.body?.aspectRatio === '16:9' || req.body?.aspectRatio === '9:16'
          ? req.body.aspectRatio
          : '1:1';
      const result = await generateImageWithXingchi({
        prompt: String(req.body?.prompt || '').trim() || 'Cinematic golden hour coffee cup on wooden table, ultra detailed',
        aspectRatio,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      });
      res.json({ ok: true, ...result, status: getXingchiPublicStatus() });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: err?.message || 'Thử tạo ảnh qua Xingchi API thất bại.',
        status: getXingchiPublicStatus(),
      });
    }
  });

  // ==========================================
  // ALIBABA CLOUD MODEL STUDIO (DASHSCOPE / QWEN)
  // ==========================================
  app.get('/api/alibaba/status', (_req, res) => {
    try {
      res.json(getAlibabaModelStudioStatus());
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tải trạng thái Alibaba Cloud Model Studio.' });
    }
  });

  app.patch('/api/alibaba/config', (req, res) => {
    try {
      const status = updateAlibabaConfig({
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        region:
          req.body?.region === 'us' || req.body?.region === 'cn' || req.body?.region === 'intl'
            ? req.body.region
            : undefined,
        selectedModel: typeof req.body?.selectedModel === 'string' ? req.body.selectedModel : undefined,
        imageModel: typeof req.body?.imageModel === 'string' ? req.body.imageModel : undefined,
        videoModel: typeof req.body?.videoModel === 'string' ? req.body.videoModel : undefined,
        timeoutSec: req.body?.timeoutSec !== undefined ? Number(req.body.timeoutSec) : undefined,
      });
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu cấu hình Alibaba Cloud Model Studio.' });
    }
  });

  app.get('/api/alibaba/models', async (req, res) => {
    try {
      const regionParam =
        req.query?.region === 'us' || req.query?.region === 'cn' || req.query?.region === 'intl'
          ? req.query.region
          : undefined;
      const result = await fetchAlibabaModels(regionParam);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Không thể tải danh sách model Alibaba Cloud.' });
    }
  });

  app.post('/api/alibaba/test', async (req, res) => {
    try {
      const result = await testAlibabaModelStudioConnection({
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        region:
          req.body?.region === 'us' || req.body?.region === 'cn' || req.body?.region === 'intl'
            ? req.body.region
            : undefined,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Kiểm tra kết nối Alibaba Cloud thất bại.' });
    }
  });

  app.post('/api/alibaba/chat', async (req, res) => {
    try {
      const result = await chatWithAlibabaModelStudio({
        prompt: String(req.body?.prompt || ''),
        systemPrompt: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        region:
          req.body?.region === 'us' || req.body?.region === 'cn' || req.body?.region === 'intl'
            ? req.body.region
            : undefined,
        maxTokens: req.body?.maxTokens !== undefined ? Number(req.body.maxTokens) : undefined,
        temperature: req.body?.temperature !== undefined ? Number(req.body.temperature) : undefined,
      });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Gọi thử Alibaba Model Studio thất bại.' });
    }
  });

  app.post('/api/command-center/productions/:runId/select', async (req, res) => {
    try {
      const state = await selectProductionRun(req.params.runId);
      res.json(state);
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Không tìm thấy phiên sản xuất.' });
    }
  });

  app.post('/api/command-center/productions/:runId/workforce', async (req, res) => {
    try {
      const state = await updateSessionWorkforceConfig(req.params.runId, {
        aiWorkforceMode: req.body?.aiWorkforceMode,
        selectedGeminiAccountIds: Array.isArray(req.body?.selectedGeminiAccountIds)
          ? req.body.selectedGeminiAccountIds
          : undefined,
        chairmanGeminiAccountId:
          typeof req.body?.chairmanGeminiAccountId === 'string' ? req.body.chairmanGeminiAccountId : undefined,
      });
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể cập nhật lực lượng AI cho phiên.' });
    }
  });

  app.post('/api/command-center/productions/:runId/handoff-cloud', async (req, res) => {
    try {
      const result = await handoffSessionToCloud(req.params.runId, {
        selectedGeminiAccountIds: Array.isArray(req.body?.selectedGeminiAccountIds)
          ? req.body.selectedGeminiAccountIds
          : undefined,
        chairmanGeminiAccountId:
          typeof req.body?.chairmanGeminiAccountId === 'string' ? req.body.chairmanGeminiAccountId : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Chuyển giao phiên lên Đám mây thất bại.' });
    }
  });

  app.post('/api/command-center/productions/:runId/video-engine', async (req, res) => {
    try {
      const engine = req.body?.engine;
      if (engine !== 'gemini' && engine !== 'google_flow' && engine !== 'muse' && engine !== 'qwen') {
        return res.status(400).json({ error: 'Nguồn tạo video không hợp lệ (gemini | google_flow | muse | qwen).' });
      }
      const state = await setRunVideoEngine(req.params.runId, engine);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể đổi nguồn tạo video.' });
    }
  });

  app.post('/api/command-center/productions/:runId/unstick', async (req, res) => {
    try {
      const result = await unstickProductionRun(req.params.runId === 'active' ? undefined : req.params.runId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể gỡ treo đội AI.' });
    }
  });

  app.get('/api/command-center/productions/:runId/flow-bundle', async (req, res) => {
    try {
      const bundle = await getGoogleFlowScriptBundle(req.params.runId === 'active' ? undefined : req.params.runId);
      res.json(bundle);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể xuất gói kịch bản Google Flow.' });
    }
  });

  app.post('/api/command-center/scenes/:sceneId/generate-video-now', async (req, res) => {
    try {
      const engine = req.body?.engine;
      if (engine !== 'gemini' && engine !== 'google_flow' && engine !== 'muse' && engine !== 'qwen') {
        return res.status(400).json({ error: 'Nguồn tạo video không hợp lệ (gemini | google_flow | muse | qwen).' });
      }
      const result = await triggerSceneVideoNow({
        runId: typeof req.body?.runId === 'string' ? req.body.runId : undefined,
        sceneId: req.params.sceneId,
        engine,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạo video ngay cho phân cảnh này.' });
    }
  });

  app.post('/api/command-center/scenes/:sceneId/upload-flow-video', async (req, res) => {
    try {
      const result = await importGoogleFlowSceneVideo({
        runId: typeof req.body?.runId === 'string' ? req.body.runId : undefined,
        sceneId: req.params.sceneId,
        videoDataUrl: String(req.body?.videoDataUrl || ''),
        fileName: typeof req.body?.fileName === 'string' ? req.body.fileName : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể nhập video từ Google Flow.' });
    }
  });

  app.post('/api/command-center/productions/:runId/:action', async (req, res) => {
    try {
      const action = req.params.action;
      if (action !== 'pause' && action !== 'resume' && action !== 'cancel') {
        return res.status(400).json({ error: 'Thao tác không hợp lệ.' });
      }
      const state = await controlProductionRun(req.params.runId, action);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể điều khiển phiên sản xuất.' });
    }
  });

  app.post('/api/command-center/attachments', async (req, res) => {
    try {
      const result = await uploadCommandCenterAttachment(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tải tệp đính kèm.' });
    }
  });

  app.post('/api/command-center/tasks', async (req, res) => {
    try {
      const state = await createManualTask(req.body || {});
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể giao nhiệm vụ mới.' });
    }
  });

  app.post('/api/command-center/tasks/:taskId/:action', async (req, res) => {
    try {
      const action = req.params.action;
      if (action !== 'retry' && action !== 'cancel' && action !== 'run_now') {
        return res.status(400).json({ error: 'Thao tác tác vụ không hợp lệ.' });
      }
      const state = await controlTask(req.params.taskId, action);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể xử lý tác vụ.' });
    }
  });

  app.post('/api/command-center/qa/:sceneId/:action', async (req, res) => {
    try {
      const action = req.params.action;
      if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ error: 'Hành động QA không hợp lệ.' });
      }
      const state = await resolveSceneQaManual(req.params.sceneId, action, req.body?.instruction);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể cập nhật QA phân cảnh.' });
    }
  });

  app.post('/api/command-center/chat', async (req, res) => {
    try {
      const result = await sendCommandCenterChat(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể gửi tin nhắn tới đội ngũ Muse AI.' });
    }
  });

  app.post('/api/command-center/incidents', async (req, res) => {
    try {
      const result = await reportCommandCenterIncident(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tiếp nhận báo cáo sự cố tới Muse AI 01.' });
    }
  });

  app.post('/api/command-center/incidents/:incidentId/command', async (req, res) => {
    try {
      const action = req.body?.action;
      if (action !== 'directive' && action !== 'reopen' && action !== 'escalate' && action !== 'resolve') {
        return res.status(400).json({ error: 'Hành động xử lý sự cố không hợp lệ.' });
      }
      const state = await commandIncidentAction({
        incidentId: req.params.incidentId,
        action,
        message: req.body?.message,
        targetAgentId: req.body?.targetAgentId,
      });
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể thực thi chỉ đạo sự cố.' });
    }
  });

  app.post('/api/command-center/chairman/config', async (req, res) => {
    try {
      const state = await updateChairmanConfig(req.body || {});
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu cấu hình Chủ tịch Điều hành AI.' });
    }
  });

  app.post('/api/command-center/chairman/analyze', async (req, res) => {
    try {
      const incidentId = typeof req.body?.incidentId === 'string' ? req.body.incidentId.trim() : undefined;
      const runId = typeof req.body?.runId === 'string' ? req.body.runId.trim() : undefined;
      const userRequest = typeof req.body?.userRequest === 'string' ? req.body.userRequest.trim() : undefined;
      const result = await analyzeAndDirectWithChairman({
        incidentId: incidentId || undefined,
        runId: runId || undefined,
        userRequest: userRequest || undefined,
        trigger: incidentId ? 'incident_analysis' : 'executive_order',
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Chủ tịch Điều hành AI chưa thể lập phương án lúc này.' });
    }
  });

  app.post('/api/command-center/chairman/execute', async (req, res) => {
    try {
      const optionId = typeof req.body?.optionId === 'string' ? req.body.optionId.trim() : '';
      if (!optionId) {
        return res.status(400).json({ error: 'Thiếu mã phương án cần thực thi.' });
      }
      const result = await executeChairmanPlanOption({
        briefingId: typeof req.body?.briefingId === 'string' ? req.body.briefingId.trim() : undefined,
        incidentId: typeof req.body?.incidentId === 'string' ? req.body.incidentId.trim() : undefined,
        optionId,
        customNote: typeof req.body?.customNote === 'string' ? req.body.customNote.trim() : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể thực thi phương án của Chủ tịch AI.' });
    }
  });

  app.get('/api/command-center/search', (req, res) => {
    try {
      const results = searchCommandCenterArchive({
        query: String(req.query.query || ''),
        agentId: String(req.query.agentId || 'all'),
        projectId: String(req.query.projectId || 'all'),
        dateFrom: String(req.query.dateFrom || ''),
        dateTo: String(req.query.dateTo || ''),
      });
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi tìm kiếm kho lưu trữ.' });
    }
  });

  app.post('/api/command-center/backups', async (req, res) => {
    try {
      const state = await createManualBackup(req.body?.summary);
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tạo bản sao lưu.' });
    }
  });

  app.post('/api/command-center/backups/:backupId/restore', async (req, res) => {
    try {
      const state = await restoreBackupById(req.params.backupId);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể khôi phục từ bản sao lưu.' });
    }
  });

  app.get('/api/command-center/backups/:backupId/export', (req, res) => {
    const fp = getBackupExportFilePath(req.params.backupId);
    if (!fp) return res.status(404).json({ error: 'Không tìm thấy file backup.' });
    res.download(fp, path.basename(fp));
  });

  app.post('/api/command-center/project-memory/snapshots/:snapshotId/restore', async (req, res) => {
    try {
      const state = await restoreProjectMemorySnapshot(req.params.snapshotId);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể khôi phục phiên bản Project Memory.' });
    }
  });

  app.post('/api/command-center/cloud-config', async (req, res) => {
    try {
      const state = await updateCloudConfig(req.body || {});
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu cấu hình Cloud.' });
    }
  });

  app.get('/api/command-center/artifacts/:filename', (req, res) => {
    const fp = resolveArtifactDiskPath(req.params.filename);
    if (!fp) return res.status(404).json({ error: 'Không tìm thấy tệp artifact.' });
    res.sendFile(fp);
  });

  // ── Google Sheets & Google Drive Session Sync + 24/7 Apps Script Bridge ──
  app.get('/api/workspace/config', (_req, res) => {
    res.json(getPublicWorkspaceConfig());
  });

  app.post('/api/workspace/init', async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const config = await initializeWorkspaceSync({
        token,
        existingSpreadsheetId: req.body?.existingSpreadsheetId,
        spreadsheetTitle: req.body?.spreadsheetTitle,
      });
      res.json(config);
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể khởi tạo Google Sheets & Drive.',
      });
    }
  });

  app.post('/api/workspace/sessions/:runId/push', async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const result = await pushSessionToGoogleWorkspace({
        token,
        runId: req.params.runId,
        uploadMediaToDrive: req.body?.uploadMediaToDrive !== false,
      });
      res.json(result);
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể đồng bộ phiên lên Google Sheets & Drive.',
      });
    }
  });

  app.post('/api/workspace/sheets/pull-and-execute', async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const result = await pullQueuedCommandsFromGoogleSheets({ token });
      res.json(result);
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể đọc lệnh từ Google Sheets.',
      });
    }
  });

  app.get('/api/workspace/sessions/:runId/report', async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const report = await fetchSessionDriveAndSheetReport({
        token,
        runId: req.params.runId === 'all' ? undefined : req.params.runId,
      });
      res.json(report);
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể tải báo cáo từ Google Sheets & Drive.',
      });
    }
  });

  app.get('/api/workspace/apps-script', (req, res) => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
      const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000');
      const baseUrl =
        process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : `${proto}://${host}`;
      res.json(generateAppsScriptBridgeCode(baseUrl));
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạo mã Apps Script.' });
    }
  });

  app.post('/api/workspace/webhook/dispatch', async (req, res) => {
    try {
      if (!verifyAppsScriptSecret(String(req.headers['x-workspace-bridge-secret'] || ''))) {
        return res.status(401).json({ error: 'Sai khóa bảo mật Apps Script Bridge.' });
      }
      const result = await handleAppsScriptDispatch(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tiếp nhận lệnh tự động.' });
    }
  });

  app.get('/api/workspace/webhook/status/:runId', (req, res) => {
    try {
      if (!verifyAppsScriptSecret(String(req.headers['x-workspace-bridge-secret'] || ''))) {
        return res.status(401).json({ error: 'Sai khóa bảo mật Apps Script Bridge.' });
      }
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
      const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000');
      const baseUrl =
        process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : `${proto}://${host}`;
      res.json(getAppsScriptSessionStatus(req.params.runId, baseUrl));
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Không tìm thấy phiên sản xuất.' });
    }
  });

  // ── Brand-New AI Coordination Center (Trung Tâm Điều Phối AI · Sheets & Drive · Independent Sources) ──
  app.get('/api/coordination/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (eventName: string, data: any) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // ignore closed socket
      }
    };

    try {
      const initial = await getCoordinationCenterState(false);
      writeEvent('state:sync', initial);
    } catch {
      // ignore initial error
    }

    const unsub = subscribeCoordinationEvents((nextState) => {
      writeEvent('state:sync', nextState);
    });
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  app.get('/api/coordination/state', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const state = await getCoordinationCenterState(force);
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tải trạng thái Trung Tâm Điều Phối AI.' });
    }
  });

  app.post('/api/coordination/readiness/check', async (_req, res) => {
    try {
      const readiness = await checkAllAiReadiness(true);
      const state = await getCoordinationCenterState(false);
      res.json({ readiness, state });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể kiểm tra trạng thái sẵn sàng của các AI.' });
    }
  });

  app.post('/api/coordination/workspace/init', async (req, res) => {
    try {
      const token = extractGoogleBearerToken(req.headers.authorization);
      const workspace = await initCoordinationWorkspace({
        token,
        existingSpreadsheetId: req.body?.existingSpreadsheetId,
        spreadsheetTitle: req.body?.spreadsheetTitle,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ workspace, state });
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể khởi tạo Sổ Google Sheets & Google Drive.',
      });
    }
  });

  app.post('/api/coordination/sessions', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const session = await createSessionFromStudio(
        {
          ...(req.body || {}),
          sourceAction: req.body?.sourceAction || 'manual_order',
        },
        googleToken
      );
      const state = await getCoordinationCenterState(false);
      res.json({ session, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lập phiên làm việc mới.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/select', (req, res) => {
    try {
      const state = selectCoordinationSession(req.params.sessionId);
      res.json(state);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể chọn phiên làm việc.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/source', async (req, res) => {
    try {
      const raw = String(req.body?.videoSource || '').trim();
      if (raw !== 'gemini' && raw !== 'qwen' && raw !== 'muse' && raw !== 'google_flow') {
        return res.status(400).json({ error: 'Nguồn sáng tạo video không hợp lệ.' });
      }
      const session = updateSessionVideoSource(req.params.sessionId, raw);
      const state = await getCoordinationCenterState(false);
      res.json({ session, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể đổi nguồn sáng tạo video.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/sync-workspace', async (req, res) => {
    try {
      const token = extractGoogleBearerToken(req.headers.authorization);
      const result = await syncSessionToGoogleWorkspace({
        token,
        sessionId: req.params.sessionId,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể đồng bộ phiên lên Google Sheets & Drive.',
      });
    }
  });

  app.get('/api/coordination/sessions/:sessionId/sheets-live', async (req, res) => {
    try {
      const token = extractGoogleBearerToken(req.headers.authorization);
      const data = await readLiveSessionFromGoogleSheets({
        token,
        sessionId: req.params.sessionId,
      });
      res.json(data);
    } catch (err: any) {
      res.status(err?.status === 401 ? 401 : 400).json({
        error: err?.message || 'Không thể đọc dữ liệu trực tiếp từ Google Sheets.',
      });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/run', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const session = await startSessionSequentialRun({
        sessionId: req.params.sessionId,
        googleToken,
        retryErrors: req.body?.retryErrors === true,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ session, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể bắt đầu chạy phiên.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/pause', async (req, res) => {
    try {
      const session = pauseSessionRun(req.params.sessionId);
      const state = await getCoordinationCenterState(false);
      res.json({ session, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạm dừng phiên.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/tasks/:taskCode/run', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const task = await runSingleCoordinationTask({
        sessionId: req.params.sessionId,
        taskCode: req.params.taskCode,
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ task, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể thực thi tác vụ này.' });
    }
  });

  app.post(
    '/api/coordination/sessions/:sessionId/tasks/:taskCode/upload-flow',
    express.raw({ type: '*/*', limit: '250mb' }),
    async (req, res) => {
      try {
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buffer.byteLength === 0) {
          return res.status(400).json({ error: 'Tệp video Google Flow rỗng.' });
        }
        const fileName = String(req.headers['x-file-name'] || 'flow_clip.mp4');
        const mimeType = String(req.headers['content-type'] || '');
        const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
        const task = await uploadFlowClipForTask({
          sessionId: req.params.sessionId,
          taskCode: req.params.taskCode,
          fileName: decodeURIComponent(fileName),
          mimeType,
          buffer,
          googleToken,
        });
        const state = await getCoordinationCenterState(false);
        res.json({ task, state });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || 'Không thể nạp clip Google Flow.' });
      }
    }
  );

  app.delete('/api/coordination/sessions/:sessionId', (req, res) => {
    try {
      const state = deleteCoordinationSession(req.params.sessionId);
      res.json({ ok: true, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể xóa phiên làm việc.' });
    }
  });

  app.post('/api/coordination/sessions/bulk-source', async (req, res) => {
    try {
      const raw = String(req.body?.videoSource || '').trim();
      if (raw !== 'gemini' && raw !== 'qwen' && raw !== 'muse' && raw !== 'google_flow') {
        return res.status(400).json({ error: 'Nguồn sáng tạo video không hợp lệ.' });
      }
      const sessionIds = Array.isArray(req.body?.sessionIds)
        ? req.body.sessionIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [];
      if (sessionIds.length === 0) {
        return res.status(400).json({ error: 'Chưa chọn phiên nào để đổi nguồn.' });
      }
      const result = bulkUpdateSessionVideoSource({
        sessionIds,
        videoSource: raw,
        resetFailedTasks: req.body?.resetFailedTasks === true,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể đổi nguồn hàng loạt.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/tasks/:taskCode/retry', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const rawSource = typeof req.body?.overrideVideoSource === 'string' ? req.body.overrideVideoSource.trim() : '';
      const validSource =
        rawSource === 'gemini' || rawSource === 'qwen' || rawSource === 'muse' || rawSource === 'google_flow'
          ? rawSource
          : undefined;
      const result = await retryCoordinationTask({
        sessionId: req.params.sessionId,
        taskCode: req.params.taskCode,
        overrideVideoSource: validSource,
        autoContinueSession: req.body?.autoContinueSession !== false,
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể chạy lại tác vụ này.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/scenes/:sceneIndex/regenerate-image', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const sceneIndex = Number(req.params.sceneIndex);
      if (!Number.isFinite(sceneIndex) || sceneIndex < 1) {
        return res.status(400).json({ error: 'Số thứ tự phân cảnh không hợp lệ.' });
      }
      const rawSource = typeof req.body?.overrideVideoSource === 'string' ? req.body.overrideVideoSource.trim() : '';
      const validSource =
        rawSource === 'gemini' || rawSource === 'qwen' || rawSource === 'muse' || rawSource === 'google_flow'
          ? rawSource
          : undefined;
      const result = await regenerateSceneImageAndContinue({
        sessionId: req.params.sessionId,
        sceneIndex,
        customPromptNote: typeof req.body?.customPromptNote === 'string' ? req.body.customPromptNote : undefined,
        overrideVideoSource: validSource,
        autoResumeVideo: req.body?.autoResumeVideo !== false,
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạo lại ảnh phân cảnh.' });
    }
  });

  app.post('/api/coordination/queue/run-all', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const result = await startAllQueuedSessionsSequential({
        googleToken,
        retryErrors: req.body?.retryErrors === true,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể chạy song song hàng đợi kịch bản.' });
    }
  });

  app.post('/api/coordination/queue/run-parallel', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const sessionIds = Array.isArray(req.body?.sessionIds)
        ? req.body.sessionIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : undefined;
      const result = await startParallelSessionsRun({
        sessionIds,
        googleToken,
        retryErrors: req.body?.retryErrors === true,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể kích hoạt chạy song song các phiên.' });
    }
  });

  app.post('/api/coordination/queue/distribute-run', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const sessionIds = Array.isArray(req.body?.sessionIds)
        ? req.body.sessionIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : undefined;
      const providers = Array.isArray(req.body?.providers)
        ? req.body.providers
            .map((x: any) => String(x || '').trim())
            .filter((x: string) => x === 'gemini' || x === 'qwen' || x === 'muse' || x === 'google_flow')
        : undefined;
      const result = await autoDistributeAndRunSessions({
        sessionIds,
        providers,
        includeErrorSessions: req.body?.includeErrorSessions === true,
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể chia tải tự động và chạy song song.' });
    }
  });

  app.post('/api/coordination/queue/pause-all', async (req, res) => {
    try {
      const sessionIds = Array.isArray(req.body?.sessionIds)
        ? req.body.sessionIds.map((x: any) => String(x || '').trim()).filter(Boolean)
        : undefined;
      const result = pauseMultipleSessions(sessionIds);
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể tạm dừng các phiên đang chạy.' });
    }
  });

  app.get('/api/coordination/workers', (_req, res) => {
    res.json(getActiveWorkerTelemetry());
  });

  // ========================================================
  // GOOGLE FLOW AUTO-BRIDGE API (CHROME EXTENSION BRIDGE)
  // ========================================================
  app.use('/api/flow-bridge', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Flow-Bridge-Token, X-Session-Id, X-Task-Code, X-File-Name, X-Mime-Type'
    );
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  app.get('/api/flow-bridge/status', async (_req, res) => {
    try {
      const state = await getCoordinationCenterState(false);
      res.json(getFlowBridgeStatus(state));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không lấy được trạng thái Flow Auto-Bridge.' });
    }
  });

  app.post('/api/flow-bridge/rotate-token', async (_req, res) => {
    try {
      rotateFlowBridgeToken();
      const state = await getCoordinationCenterState(false);
      res.json(getFlowBridgeStatus(state));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Không thể tạo mới Bridge Token.' });
    }
  });

  app.get('/api/flow-bridge/extension.zip', (req, res) => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
      const host = String(req.headers['x-forwarded-host'] || req.get('host') || `127.0.0.1:${PORT}`).split(',')[0].trim();
      const queryUrl = typeof req.query.appUrl === 'string' ? req.query.appUrl.trim() : '';
      const resolvedAppUrl = /^https?:\/\//i.test(queryUrl) ? queryUrl : `${proto}://${host}`;

      const files = buildFlowBridgeExtensionFiles(resolvedAppUrl);
      try {
        writeFlowBridgeExtensionToWorkspace(resolvedAppUrl);
      } catch {
        // workspace mirror is optional
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="google-flow-auto-bridge-extension.zip"');
      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on('error', (err: Error) => {
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      archive.pipe(res);
      for (const [fileName, content] of Object.entries(files)) {
        archive.append(Buffer.from(content, 'utf8'), { name: `google-flow-auto-bridge/${fileName}` });
      }
      void archive.finalize();
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Không thể đóng gói Chrome Extension Flow Bridge.' });
      }
    }
  });

  app.post('/api/flow-bridge/heartbeat', async (req, res) => {
    const token = String(req.headers['x-flow-bridge-token'] || '');
    if (!verifyFlowBridgeToken(token)) {
      return res.status(401).json({ error: 'Bridge Token không hợp lệ.' });
    }
    recordFlowBridgeHeartbeat({
      extensionVersion: req.body?.extensionVersion,
      activeTabUrl: req.body?.activeTabUrl,
      flowTabReady: req.body?.flowTabReady === true,
      busyJobId: typeof req.body?.busyJobId === 'string' ? req.body.busyJobId : '',
    });
    const state = await getCoordinationCenterState(false);
    const snap = getFlowBridgeStatus(state);
    res.json({ ok: true, pendingJobsCount: snap.pendingJobsCount, status: snap.status });
  });

  app.post('/api/flow-bridge/claim', (req, res) => {
    const token = String(req.headers['x-flow-bridge-token'] || '');
    if (!verifyFlowBridgeToken(token)) {
      return res.status(401).json({ error: 'Bridge Token không hợp lệ.' });
    }
    const job = claimNextFlowJobFromCenter(typeof req.body?.workerId === 'string' ? req.body.workerId : undefined);
    res.json({ ok: true, job });
  });

  app.post('/api/flow-bridge/complete', express.raw({ type: '*/*', limit: '250mb' }), async (req, res) => {
    try {
      const token = String(req.headers['x-flow-bridge-token'] || '');
      if (!verifyFlowBridgeToken(token)) {
        return res.status(401).json({ error: 'Bridge Token không hợp lệ.' });
      }
      const sessionId = decodeURIComponent(String(req.headers['x-session-id'] || '')).trim();
      const taskCode = decodeURIComponent(String(req.headers['x-task-code'] || '')).trim();
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] || 'flow_output.mp4')).trim();
      const mimeType = String(req.headers['x-mime-type'] || req.headers['content-type'] || '').trim();
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      if (!sessionId || !taskCode) {
        return res.status(400).json({ error: 'Thiếu X-Session-Id hoặc X-Task-Code.' });
      }
      if (buffer.byteLength < 512) {
        return res.status(400).json({ error: 'Tệp kết quả từ Google Flow quá nhỏ hoặc rỗng.' });
      }

      const task = await uploadFlowClipForTask({
        sessionId,
        taskCode,
        fileName,
        mimeType,
        buffer,
        fromBridge: true,
        autoContinue: true,
      });
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể lưu kết quả từ Flow Auto-Bridge.' });
    }
  });

  app.post('/api/flow-bridge/fail', (req, res) => {
    const token = String(req.headers['x-flow-bridge-token'] || '');
    if (!verifyFlowBridgeToken(token)) {
      return res.status(401).json({ error: 'Bridge Token không hợp lệ.' });
    }
    const sessionId = String(req.body?.sessionId || '').trim();
    const taskCode = String(req.body?.taskCode || '').trim();
    const error = String(req.body?.error || 'Google Flow gặp lỗi.').trim();
    if (!sessionId || !taskCode) {
      return res.status(400).json({ error: 'Thiếu sessionId hoặc taskCode.' });
    }
    const task = failFlowBridgeTask({ sessionId, taskCode, error });
    res.json({ ok: true, task });
  });

  app.post('/api/coordination/meeting', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const result = await postMeetingRoomMessage({
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : 'GLOBAL',
        content: String(req.body?.content || ''),
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể gửi tin nhắn trong Phòng họp.' });
    }
  });

  app.post('/api/coordination/sessions/:sessionId/meeting', async (req, res) => {
    try {
      const googleToken = extractOptionalGoogleBearerToken(req.headers.authorization);
      const result = await postMeetingRoomMessage({
        sessionId: req.params.sessionId,
        content: String(req.body?.content || ''),
        googleToken,
      });
      const state = await getCoordinationCenterState(false);
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Không thể gửi tin nhắn trong Phòng họp.' });
    }
  });

  app.get('/api/coordination/artifacts/:sessionId/:filename', (req, res) => {
    const fp = resolveCoordinationArtifactPath(req.params.sessionId, req.params.filename);
    if (!fp) return res.status(404).json({ error: 'Không tìm thấy tệp dữ liệu phiên.' });
    res.sendFile(fp);
  });

  app.get('/api/derivative/jobs/:jobId', (req, res) => {
    const job = derivativeJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Tác vụ video phái sinh không tồn tại hoặc đã hết hạn.' });
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      stepLabel: job.stepLabel,
      fileName: job.fileName,
      fileSize: job.fileSize,
      durationSec: job.durationSec,
      resolution: job.resolution,
      error: job.error,
      warnings: job.warnings,
    });
  });

  app.get('/api/derivative/jobs/:jobId/file', (req, res) => {
    const job = derivativeJobs.get(req.params.jobId);
    if (!job || job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) {
      return res.status(404).json({ error: 'Tệp video phái sinh chưa sẵn sàng hoặc đã bị xóa.' });
    }

    const stat = fs.statSync(job.outputPath);
    const total = stat.size;
    const isDownload = req.query.download === '1';
    const encodedName = encodeURIComponent(job.fileName || 'derivative.mp4');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    }

    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
        if (start < total && end >= start) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          fs.createReadStream(job.outputPath, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.setHeader('Content-Length', String(total));
    fs.createReadStream(job.outputPath).pipe(res);
  });

  // Inspect one or multiple Bilibili / YouTube URLs
  app.post('/api/bilibili/inspect', async (req, res) => {
    try {
      const { urls, expandPages = false, sessdata, ytCookies } = (req.body || {}) as {
        urls?: string[];
        expandPages?: boolean;
        sessdata?: string;
        ytCookies?: string;
      };

      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Vui lòng nhập ít nhất một liên kết video.' });
      }

      const items: any[] = [];
      const errors: { url: string; message: string }[] = [];
      let suggestedFolder = '';
      const pickSuggestedFolder = (urlStr: string) => {
        if (suggestedFolder) return;
        const ytHandle = urlStr.match(/youtube\.com\/(@[^/?#\s]+)/i)?.[1];
        if (ytHandle) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(ytHandle));
          } catch {
            suggestedFolder = sanitizeFilename(ytHandle);
          }
          return;
        }
        const biliMid = extractSpaceMid(urlStr);
        if (biliMid) {
          suggestedFolder = sanitizeFilename(biliMid);
          return;
        }
        const ytLegacy = urlStr.match(/youtube\.com\/(?:channel|c|user)\/([^/?#\s]+)/i)?.[1];
        if (ytLegacy) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(ytLegacy));
          } catch {
            suggestedFolder = sanitizeFilename(ytLegacy);
          }
          return;
        }
        const fbGroup = urlStr.match(/facebook\.com\/groups\/([^/?#\s]+)/i)?.[1];
        if (fbGroup) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(fbGroup));
          } catch {
            suggestedFolder = sanitizeFilename(fbGroup);
          }
          return;
        }
        const fbPage = urlStr.match(/facebook\.com\/(?!watch\b|reel\b|reels\b|share\b|groups\b|video\.php\b|story\.php\b|profile\.php\b)([^/?#\s]+)/i)?.[1];
        if (fbPage) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(fbPage));
          } catch {
            suggestedFolder = sanitizeFilename(fbPage);
          }
        }
      };

    for (const rawInput of urls.slice(0, 100)) {
      const trimmed = rawInput.trim();
      if (!trimmed) continue;

      try {
        pickSuggestedFolder(trimmed);
        if (isYouTubeUrl(trimmed)) {
          const ytItems = await inspectYouTubeUrl(trimmed, ytCookies);
          items.push(...ytItems);
          continue;
        }

        if (isFacebookUrl(trimmed)) {
          const fbItems = await inspectFacebookUrl(trimmed, ytCookies);
          items.push(...fbItems);
          continue;
        }

        const detectedPlatform = detectPlatformFromUrl(trimmed);
        if (detectedPlatform !== 'bilibili' && detectedPlatform !== 'other') {
          const genericItems = await inspectGenericYtDlpUrl(trimmed, detectedPlatform, ytCookies);
          items.push(...genericItems);
          continue;
        }

        const resolvedUrl = await resolveShortUrl(trimmed);
        pickSuggestedFolder(resolvedUrl);
        const spaceMid = extractSpaceMid(resolvedUrl);

        if (spaceMid) {
          let fetchedFromMedialist = false;
          let oid = '';
          let pageRound = 0;
          const maxRounds = 10; // up to 300 videos per channel inspect

          while (pageRound < maxRounds) {
            const medialistUrl = `https://api.bilibili.com/x/v2/medialist/resource/list?type=1&biz_id=${encodeURIComponent(
              spaceMid
            )}&mobi_app=web&ps=30${oid ? `&oid=${encodeURIComponent(oid)}` : ''}`;

            const mlJson = await fetchBiliJson(medialistUrl, sessdata);
            if (mlJson.code !== 0 || !Array.isArray(mlJson.data?.media_list)) {
              break;
            }

            const mediaList: any[] = mlJson.data.media_list;
            if (mediaList.length === 0) break;
            fetchedFromMedialist = true;

            for (const m of mediaList) {
              const bvidVal = m.bv_id || m.bvid;
              if (!bvidVal) continue;
              const firstPage = Array.isArray(m.pages) && m.pages[0] ? m.pages[0] : null;
              items.push({
                id: `${bvidVal}_space_${crypto.randomBytes(3).toString('hex')}`,
                bvid: bvidVal,
                aid: m.id || 0,
                cid: firstPage?.id || 0,
                page: 1,
                totalPages: m.page || 1,
                title: m.title || bvidVal,
                partTitle: '',
                author: m.upper?.name || `UID ${spaceMid}`,
                duration: m.duration || 0,
                views: Number(m.cnt_info?.play ?? 0),
                pubdate: Number(m.pubtime || m.ctime || 0),
                pic: (m.cover || '').replace(/^http:/, 'https:'),
                sourceUrl: `https://www.bilibili.com/video/${bvidVal}`,
                availableQualities: [
                  { qn: 120, label: '4K (2160P)' },
                  { qn: 116, label: '1080P60' },
                  { qn: 80, label: '1080P' },
                  { qn: 64, label: '720P' },
                  { qn: 32, label: '480P' },
                  { qn: 16, label: '360P' },
                ],
              });
            }

            if (!mlJson.data.has_more) break;
            const lastItem = mediaList[mediaList.length - 1];
            if (!lastItem?.id || String(lastItem.id) === oid) break;
            oid = String(lastItem.id);
            pageRound++;
          }

          if (!fetchedFromMedialist) {
            // Fallback to WBI arc/search if medialist is unavailable
            const { imgKey, subKey } = await getWbiKeys(sessdata);
            const pageSize = 30;
            const maxPages = 10;
            let pn = 1;
            let totalCount = 0;

            while (pn <= maxPages) {
              const qs = encWbi(
                { mid: spaceMid, ps: pageSize, tid: 0, pn, order: 'pubdate' },
                imgKey,
                subKey
              );
              const arcJson = await fetchBiliJson(
                `https://api.bilibili.com/x/space/wbi/arc/search?${qs}`,
                sessdata
              );

              if (arcJson.code !== 0 || !arcJson.data?.list?.vlist) {
                if (pn === 1) {
                  errors.push({
                    url: trimmed,
                    message: arcJson.message || 'Không thể lấy danh sách video của kênh này.',
                  });
                }
                break;
              }

              const vlist: any[] = arcJson.data.list.vlist;
              totalCount = arcJson.data.page?.count || vlist.length;
              if (vlist.length === 0) break;

              for (const v of vlist) {
                items.push({
                  id: `${v.bvid}_space_${crypto.randomBytes(3).toString('hex')}`,
                  bvid: v.bvid,
                  aid: v.aid || 0,
                  cid: 0,
                  page: 1,
                  totalPages: 1,
                  title: v.title || v.bvid,
                  partTitle: '',
                  author: v.author || `UID ${spaceMid}`,
                  duration: parseLengthToSeconds(v.length),
                  views: Number(v.play ?? 0),
                  pubdate: Number(v.created ?? 0),
                  pic: (v.pic || '').replace(/^http:/, 'https:'),
                  sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
                  availableQualities: [
                    { qn: 120, label: '4K (2160P)' },
                    { qn: 116, label: '1080P60' },
                    { qn: 80, label: '1080P' },
                    { qn: 64, label: '720P' },
                    { qn: 32, label: '480P' },
                    { qn: 16, label: '360P' },
                  ],
                });
              }

              if (pn * pageSize >= totalCount) break;
              pn++;
            }
          }
          continue;
        }

        const { bvid, aid, page } = extractBiliIdentifier(resolvedUrl);

        if (!bvid && !aid) {
          errors.push({ url: trimmed, message: 'Không nhận diện được mã BV, av hoặc kênh hợp lệ.' });
          continue;
        }

        const viewEndpoint = bvid
          ? `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
          : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;

        const viewJson = await fetchBiliJson(viewEndpoint, sessdata);

        if (viewJson.code !== 0 || !viewJson.data) {
          errors.push({
            url: trimmed,
            message: viewJson.message || 'Không tìm thấy video hoặc video đã bị ẩn.',
          });
          continue;
        }

        const v = viewJson.data;
        const pages: any[] = Array.isArray(v.pages) && v.pages.length > 0 ? v.pages : [{ cid: v.cid, page: 1, part: v.title, duration: v.duration }];

        // Fetch available qualities using first target cid
        const firstCid = pages[0].cid;
        let availableQualities: { qn: number; label: string }[] = [
          { qn: 80, label: '1080P' },
          { qn: 64, label: '720P' },
          { qn: 32, label: '480P' },
          { qn: 16, label: '360P' },
        ];

        try {
          const playJson = await fetchBiliJson(
            `https://api.bilibili.com/x/player/playurl?bvid=${v.bvid}&cid=${firstCid}&qn=120&fnval=4048&fourk=1&try_look=1`,
            sessdata
          );
          if (playJson.code === 0 && playJson.data?.accept_quality) {
            const qns: number[] = playJson.data.accept_quality;
            const descs: string[] = playJson.data.accept_description || [];
            availableQualities = qns.map((qn, idx) => ({
              qn,
              label: QN_LABELS[qn] || descs[idx] || `${qn}P`,
            }));
          }
        } catch {
          // keep fallback qualities
        }

        const targetPages =
          expandPages && !page
            ? pages
            : [pages.find((p) => p.page === (page || 1)) || pages[0]];

        for (const p of targetPages) {
          items.push({
            id: `${v.bvid}_${p.cid}_${crypto.randomBytes(3).toString('hex')}`,
            bvid: v.bvid,
            aid: v.aid,
            cid: p.cid,
            page: p.page,
            totalPages: pages.length,
            title: v.title,
            partTitle: pages.length > 1 ? p.part || `P${p.page}` : '',
            author: v.owner?.name || 'Bilibili Creator',
            duration: p.duration || v.duration || 0,
            views: Number(v.stat?.view ?? 0),
            pubdate: Number(v.pubdate || v.ctime || 0),
            pic: v.pic?.replace(/^http:/, 'https:') || '',
            sourceUrl: `https://www.bilibili.com/video/${v.bvid}${pages.length > 1 ? `?p=${p.page}` : ''}`,
            availableQualities,
          });
        }
      } catch (err: any) {
        errors.push({ url: trimmed, message: err?.message || 'Lỗi kết nối tới Bilibili' });
      }
    }

    if (!suggestedFolder && items.length > 0 && items[0]?.author) {
      suggestedFolder = sanitizeFilename(String(items[0].author));
    }

    res.json({ items, errors, suggestedFolder });
    } catch (fatalErr: any) {
      console.error('Inspect fatal error:', fatalErr);
      if (!res.headersSent) {
        res.status(500).json({ error: fatalErr?.message || 'Lỗi máy chủ khi phân tích liên kết' });
      }
    }
  });

  // Start a download job
  app.post('/api/bilibili/download', (req, res) => {
    const {
      platform,
      sourceUrl,
      bvid,
      cid,
      title,
      partTitle,
      qn,
      format,
      watermark,
      sessdata,
      ytCookies,
      customLogo,
      videoTransform,
    } = req.body as {
      platform?: VideoPlatform;
      sourceUrl?: string;
      bvid: string;
      cid: number;
      title: string;
      partTitle?: string;
      qn: number;
      format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
      watermark?: WatermarkMode;
      sessdata?: string;
      ytCookies?: string;
      customLogo?: CustomLogoParam;
      videoTransform?: VideoTransformParam;
    };

    if (!bvid && !sourceUrl) {
      return res.status(400).json({ error: 'Thiếu thông tin video' });
    }

    const detectedFromUrl = sourceUrl ? detectPlatformFromUrl(sourceUrl) : 'bilibili';
    const effectivePlatform = platform || detectedFromUrl;

    const jobId = crypto.randomUUID();
    const baseName = buildFormattedDownloadBaseName({
      bvid,
      sourceUrl,
      platform: effectivePlatform,
      title,
      partTitle,
    });
    const fileName = `${baseName}.${format}`;

    jobs.set(jobId, {
      jobId,
      status: 'queued',
      progress: 0,
      speedBytesPerSec: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      fileName,
      createdAt: Date.now(),
    });

    // Run asynchronously: Bilibili uses native DASH downloader; YouTube, Facebook & other global platforms use yt-dlp + FFmpeg
    if (effectivePlatform !== 'bilibili' && (sourceUrl || effectivePlatform === 'youtube')) {
      processYouTubeDownloadJob(jobId, {
        platform: effectivePlatform,
        sourceUrl: sourceUrl || `https://www.youtube.com/watch?v=${bvid}`,
        bvid,
        title,
        qn,
        format,
        watermark,
        ytCookies,
        customLogo,
        videoTransform,
      });
    } else {
      processDownloadJob(jobId, {
        bvid,
        cid,
        title,
        partTitle,
        qn,
        format,
        watermark,
        sessdata,
        customLogo,
        videoTransform,
      });
    }

    res.json({ jobId, fileName });
  });

  // Poll job status
  app.get('/api/bilibili/jobs/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Không tìm thấy tác vụ tải xuống' });
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      speedBytesPerSec: job.speedBytesPerSec,
      downloadedBytes: job.downloadedBytes,
      totalBytes: job.totalBytes,
      fileSize: job.fileSize,
      fileName: job.fileName,
      error: job.error,
    });
  });

  const resolveJobFile = (jobId: string) => {
    const job = jobs.get(jobId);
    let filePath = job?.filePath;
    let fileName = job?.fileName || `bilibili_${jobId.slice(0, 8)}.mp4`;

    if (!filePath || !fs.existsSync(filePath)) {
      const exts = ['.mp4', '.mkv', '.webm', '.mp3', '.m4a'];
      for (const ext of exts) {
        const candidate = path.join(DOWNLOAD_DIR, `${jobId}${ext}`);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          fileName = job?.fileName || `bilibili_${jobId.slice(0, 8)}${ext}`;
          break;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const fileSize = fs.statSync(filePath).size;
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
    };
    return {
      filePath,
      fileName,
      fileSize,
      contentType: mimeMap[ext] || 'application/octet-stream',
    };
  };

  // File metadata for chunked downloads (bypasses 32MB single-response proxy limit)
  app.get('/api/bilibili/jobs/:jobId/file-info', (req, res) => {
    const info = resolveJobFile(req.params.jobId);
    if (!info) {
      return res.status(404).json({
        error: 'Tệp video này không còn trên máy chủ (phiên cũ đã hết hạn). Bạn vui lòng bấm nút Thử lại để tải mới.',
      });
    }
    res.json({
      fileSize: info.fileSize,
      fileName: info.fileName,
      contentType: info.contentType,
    });
  });

  // Download completed file (full or byte-range chunk via ?offset=&limit=)
  app.get('/api/bilibili/jobs/:jobId/file', (req, res) => {
    const info = resolveJobFile(req.params.jobId);
    if (!info) {
      return res.status(404).json({
        error: 'Tệp video này không còn trên máy chủ (phiên cũ đã hết hạn). Bạn vui lòng bấm nút Thử lại để tải mới.',
      });
    }

    const hasOffset = req.query.offset !== undefined || req.query.limit !== undefined;
    if (hasOffset) {
      const offsetRaw = Number(req.query.offset ?? 0);
      const limitRaw = Number(req.query.limit ?? 8 * 1024 * 1024);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(20 * 1024 * 1024, Math.floor(limitRaw))
        : 8 * 1024 * 1024;

      if (offset >= info.fileSize) {
        return res.status(416).json({ error: 'Vị trí đọc vượt quá kích thước tệp' });
      }

      const end = Math.min(info.fileSize - 1, offset + limit - 1);
      const chunkLen = end - offset + 1;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(chunkLen));
      res.setHeader('X-Total-Size', String(info.fileSize));
      res.setHeader('Cache-Control', 'no-store');

      const stream = fs.createReadStream(info.filePath, { start: offset, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Không thể đọc đoạn dữ liệu tệp video' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    const ext = path.extname(info.fileName) || '.mp4';
    const encodedName = encodeURIComponent(info.fileName).replace(
      /['()*!]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bilibili_download${ext}"; filename*=UTF-8''${encodedName}`
    );
    res.sendFile(info.filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Không thể gửi tệp video từ máy chủ' });
      }
    });
  });

  // Immediately delete temp output file on disk once browser finished saving it to user's destination
  app.post('/api/bilibili/jobs/:jobId/ack-saved', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (job) {
      deleteJobTempOutputFile(job);
      cleanupRawCacheIfUnused(job.rawCacheKey, job.jobId);
    }
    res.json({ ok: true });
  });

  // Bulk cleanup temp files when user removes items or clears queue
  app.post('/api/bilibili/jobs/cleanup', (req, res) => {
    const { jobIds } = (req.body || {}) as { jobIds?: string[] };
    if (Array.isArray(jobIds)) {
      for (const id of jobIds) {
        const job = jobs.get(id);
        if (job && job.status !== 'downloading' && job.status !== 'processing') {
          deleteJobTempOutputFile(job);
          cleanupRawCacheIfUnused(job.rawCacheKey, job.jobId);
        }
      }
    }
    res.json({ ok: true });
  });

  // Clean up temporary ZIP file after download finishes
  app.post('/api/bilibili/batch-zip/:zipId/cleanup', (req, res) => {
    const zip = preparedZips.get(req.params.zipId);
    if (zip) {
      if (fs.existsSync(zip.zipPath)) {
        fs.unlink(zip.zipPath, () => {});
      }
      preparedZips.delete(req.params.zipId);
    }
    res.json({ ok: true });
  });

  // Prepare batch ZIP on disk so large archives (>32MB) can be downloaded cleanly in chunks
  app.post('/api/bilibili/batch-zip/prepare', async (req, res) => {
    try {
      const { jobIds, folderName } = (req.body || {}) as { jobIds?: string[]; folderName?: string };
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: 'Không có tệp nào để nén ZIP' });
      }

      const readyFiles = jobIds
        .map((id) => ({ id, info: resolveJobFile(id) }))
        .filter((entry): entry is { id: string; info: NonNullable<ReturnType<typeof resolveJobFile>> } => Boolean(entry.info));

      if (readyFiles.length === 0) {
        return res.status(404).json({ error: 'Chưa có tệp hoàn tất nào' });
      }

      const safeFolder = folderName ? sanitizeFilename(folderName) : '';
      const zipBaseName = safeFolder || 'BiliBatch_Downloads';
      const zipId = crypto.randomUUID();
      const zipPath = path.join(DOWNLOAD_DIR, `zip_${zipId}.zip`);

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({ zlib: { level: 1 } });

        output.on('close', () => resolve());
        output.on('error', (err) => reject(err));
        archive.on('error', (err: Error) => reject(err));
        archive.pipe(output);

        const usedNames = new Set<string>();
        for (const { id, info } of readyFiles) {
          let name = info.fileName;
          if (usedNames.has(name)) {
            const ext = path.extname(name);
            const stem = path.basename(name, ext);
            name = `${stem}_${id.slice(0, 4)}${ext}`;
          }
          usedNames.add(name);
          const entryPath = safeFolder ? `${safeFolder}/${name}` : name;
          archive.file(info.filePath, { name: entryPath });
        }

        archive.finalize();
      });

      const zipSize = fs.statSync(zipPath).size;
      const zipName = `${zipBaseName}.zip`;
      preparedZips.set(zipId, {
        zipId,
        zipPath,
        zipName,
        zipSize,
        createdAt: Date.now(),
      });

      res.json({ zipId, zipName, zipSize });
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Lỗi tạo tệp ZIP' });
      }
    }
  });

  app.get('/api/bilibili/batch-zip/:zipId', (req, res) => {
    const zip = preparedZips.get(req.params.zipId);
    if (!zip || !fs.existsSync(zip.zipPath)) {
      return res.status(404).json({ error: 'Tệp ZIP không tồn tại hoặc đã hết hạn' });
    }

    const hasOffset = req.query.offset !== undefined || req.query.limit !== undefined;
    if (hasOffset) {
      const offsetRaw = Number(req.query.offset ?? 0);
      const limitRaw = Number(req.query.limit ?? 8 * 1024 * 1024);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(20 * 1024 * 1024, Math.floor(limitRaw))
        : 8 * 1024 * 1024;

      if (offset >= zip.zipSize) {
        return res.status(416).json({ error: 'Vị trí đọc vượt quá kích thước tệp ZIP' });
      }

      const end = Math.min(zip.zipSize - 1, offset + limit - 1);
      const chunkLen = end - offset + 1;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(chunkLen));
      res.setHeader('X-Total-Size', String(zip.zipSize));
      res.setHeader('Cache-Control', 'no-store');

      const stream = fs.createReadStream(zip.zipPath, { start: offset, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Không thể đọc đoạn dữ liệu tệp ZIP' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="BiliBatch_Downloads.zip"; filename*=UTF-8''${encodeURIComponent(zip.zipName)}`
    );
    res.sendFile(zip.zipPath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Không thể gửi tệp ZIP từ máy chủ' });
      }
    });
  });

  // Batch ZIP download (kept for compatibility)
  app.post('/api/bilibili/batch-zip', (req, res) => {
    const { jobIds, folderName } = req.body as { jobIds?: string[]; folderName?: string };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'Không có tệp nào để nén ZIP' });
    }

    const readyJobs = jobIds
      .map((id) => jobs.get(id))
      .filter((j): j is JobState => Boolean(j && j.status === 'completed' && j.filePath && fs.existsSync(j.filePath)));

    if (readyJobs.length === 0) {
      return res.status(404).json({ error: 'Chưa có tệp hoàn tất nào' });
    }

    const safeFolder = folderName ? sanitizeFilename(folderName) : '';
    const zipBaseName = safeFolder || 'BiliBatch_Downloads';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="BiliBatch_Downloads.zip"; filename*=UTF-8''${encodeURIComponent(zipBaseName + '.zip')}`
    );

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err: Error) => {
      if (!res.headersSent) res.status(500).send(err.message);
    });
    archive.pipe(res);

    const usedNames = new Set<string>();
    for (const j of readyJobs) {
      let name = j.fileName;
      if (usedNames.has(name)) {
        const ext = path.extname(name);
        const stem = path.basename(name, ext);
        name = `${stem}_${j.jobId.slice(0, 4)}${ext}`;
      }
      usedNames.add(name);
      const entryPath = safeFolder ? `${safeFolder}/${name}` : name;
      archive.file(j.filePath!, { name: entryPath });
    }

    archive.finalize();
  });

  const runExec = (
    cmd: string,
    args: string[],
    timeoutMs = 20_000
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const useCmdWrapper = process.platform === 'win32' && cmd === 'npm';
      const actualCmd = useCmdWrapper ? 'cmd.exe' : cmd;
      const actualArgs = useCmdWrapper ? ['/d', '/s', '/c', 'npm', ...args] : args;
      const proc = spawn(actualCmd, actualArgs, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`Lệnh ${cmd} quá thời gian chờ`));
      }, timeoutMs);

      proc.stdout.on('data', (c) => {
        stdout += c.toString();
      });
      proc.stderr.on('data', (c) => {
        stderr += c.toString();
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  const parseSemverParts = (v: string): [number, number, number] => {
    const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
    if (!m) return [1, 0, 9];
    return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
  };

  const compareSemver = (a: string, b: string): number => {
    const pa = parseSemverParts(a);
    const pb = parseSemverParts(b);
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1;
      if (pa[i] < pb[i]) return -1;
    }
    return 0;
  };

  const incrementPatchVersion = (v: string): string => {
    const [maj, min, pat] = parseSemverParts(v);
    return `${maj}.${min}.${pat + 1}`;
  };

  const readRuntimeVersionOverride = (cwd: string): { version: string; commit: string } | null => {
    try {
      const overridePath = path.join(cwd, '.update-backup', 'runtime-version.json');
      if (fs.existsSync(overridePath)) {
        const parsed = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        if (typeof parsed?.version === 'string' && parsed.version.trim()) {
          return {
            version: parsed.version.trim(),
            commit: typeof parsed?.commit === 'string' ? parsed.commit.trim() : '',
          };
        }
      }
    } catch {
      // ignore override read error
    }
    return null;
  };

  const writeRuntimeVersionOverride = (cwd: string, version: string, commit: string) => {
    try {
      const overridePath = path.join(cwd, '.update-backup', 'runtime-version.json');
      fs.mkdirSync(path.dirname(overridePath), { recursive: true });
      fs.writeFileSync(
        overridePath,
        JSON.stringify({ version, commit, updatedAt: Date.now() }, null, 2),
        'utf8'
      );
    } catch {
      // ignore override write error
    }
  };

  const readLocalAppVersion = (cwd: string, currentCommit?: string): string => {
    let pkgVersion = '1.0.9';
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (typeof parsed?.version === 'string' && parsed.version.trim()) {
          pkgVersion = parsed.version.trim();
        }
      }
    } catch {
      // ignore package.json read error
    }

    const override = readRuntimeVersionOverride(cwd);
    if (
      override &&
      (!currentCommit || !override.commit || override.commit === currentCommit) &&
      compareSemver(override.version, pkgVersion) > 0
    ) {
      return override.version;
    }
    return pkgVersion;
  };

  interface ReleaseUpdateEntry {
    version: string;
    date: string;
    title: string;
    changes: string[];
    commit?: string;
  }

  const formatCommitDateVi = (isoOrGitDate: string): string => {
    const parsed = new Date(isoOrGitDate);
    if (Number.isNaN(parsed.getTime())) return isoOrGitDate.slice(0, 10);
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const readRecentUpdatesChangelog = async (
    cwd: string,
    includeGitHistory: boolean,
    localVersion: string
  ): Promise<ReleaseUpdateEntry[]> => {
    let entries: ReleaseUpdateEntry[] = [];
    try {
      const changelogPath = path.join(cwd, 'src', 'changelog.json');
      if (fs.existsSync(changelogPath)) {
        const parsed = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
        if (Array.isArray(parsed)) {
          entries = parsed
            .filter((item) => item && typeof item.version === 'string' && typeof item.date === 'string')
            .map((item) => ({
              version: String(item.version).trim(),
              date: String(item.date).trim(),
              title: String(item.title || '').trim() || `Phiên bản V${item.version}`,
              changes: Array.isArray(item.changes)
                ? item.changes.map((c: unknown) => String(c || '').trim()).filter(Boolean)
                : [],
              commit: typeof item.commit === 'string' ? item.commit.trim() : undefined,
            }));
        }
      }
    } catch {
      // ignore changelog read failure
    }

    if (includeGitHistory && fs.existsSync(path.join(cwd, '.git'))) {
      try {
        const logRes = await runExec(
          'git',
          ['log', '-n', '3', '--pretty=format:%h%x09%ci%x09%s'],
          6000
        );
        if (logRes.code === 0 && logRes.stdout) {
          const gitRows = logRes.stdout
            .split(/\r?\n/)
            .map((line) => line.split('\t'))
            .filter((parts) => parts.length >= 3);

          // Attach short commit hash to matching version entries, or prepend git commit if version isn't in changelog yet
          if (entries.length > 0 && gitRows[0]) {
            const [latestHash, latestDateRaw, latestSubject] = gitRows[0];
            if (entries[0].version === localVersion && !entries[0].commit) {
              entries[0] = { ...entries[0], commit: latestHash };
            } else if (compareSemver(localVersion, entries[0].version) > 0) {
              entries.unshift({
                version: localVersion,
                date: formatCommitDateVi(latestDateRaw),
                title: latestSubject || `Cập nhật phiên bản V${localVersion}`,
                changes: latestSubject ? [latestSubject] : [`Cập nhật mới nhất lên V${localVersion}.`],
                commit: latestHash,
              });
            }
          } else if (entries.length === 0) {
            entries = gitRows.map(([hash, dateRaw, subject], idx) => ({
              version: idx === 0 ? localVersion : '1.0.x',
              date: formatCommitDateVi(dateRaw),
              title: subject || `Cập nhật (${hash})`,
              changes: subject ? [subject] : [],
              commit: hash,
            }));
          }
        }
      } catch {
        // ignore git log error
      }
    }

    return entries.slice(0, 3);
  };

  app.get('/api/system/update-status', async (_req, res) => {
    const supervisorActive = process.env.BILIBATCH_SUPERVISOR === '1';
    const cwd = process.cwd();
    let localVersion = readLocalAppVersion(cwd);
    try {
      if (!fs.existsSync(path.join(cwd, '.git'))) {
        const recentUpdates = await readRecentUpdatesChangelog(cwd, false, localVersion);
        return res.json({
          supported: false,
          localVersion,
          recentUpdates,
          supervisorActive,
          reason: 'Thư mục hiện tại chưa được kết nối GitHub (.git).',
        });
      }

      const remoteRes = await runExec('git', ['remote', 'get-url', 'origin'], 8000).catch(() => null);
      if (!remoteRes || remoteRes.code !== 0 || !remoteRes.stdout) {
        const recentUpdates = await readRecentUpdatesChangelog(cwd, true, localVersion);
        return res.json({
          supported: false,
          localVersion,
          recentUpdates,
          supervisorActive,
          reason: 'Chưa gắn địa chỉ GitHub (remote origin) cho thư mục dự án.',
        });
      }

      const branchRes = await runExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000);
      const branch =
        branchRes.code === 0 && branchRes.stdout && branchRes.stdout !== 'HEAD'
          ? branchRes.stdout
          : 'main';
      const commitRes = await runExec('git', ['rev-parse', '--short', 'HEAD'], 8000);
      const currentCommit = commitRes.code === 0 ? commitRes.stdout : '';
      localVersion = readLocalAppVersion(cwd, currentCommit);
      const recentUpdates = await readRecentUpdatesChangelog(cwd, true, localVersion);

      const fetchRes = await runExec('git', ['fetch', 'origin', branch, '--quiet'], 18_000).catch(
        (err: any) => ({ code: 1, stdout: '', stderr: err?.message || 'Lỗi kết nối GitHub' })
      );

      if (fetchRes.code !== 0) {
        return res.json({
          supported: true,
          hasUpdate: false,
          localVersion,
          recentUpdates,
          currentCommit,
          branch,
          remoteUrl: remoteRes.stdout,
          supervisorActive,
          fetchError: fetchRes.stderr || 'Không thể kết nối GitHub',
        });
      }

      const countRes = await runExec(
        'git',
        ['rev-list', '--count', `HEAD..origin/${branch}`],
        8000
      );
      const behindCount = countRes.code === 0 ? parseInt(countRes.stdout, 10) || 0 : 0;

      const latestMsgRes = await runExec(
        'git',
        ['log', '-1', '--pretty=%s', `origin/${branch}`],
        8000
      );
      const latestDateRes = await runExec(
        'git',
        ['log', '-1', '--pretty=%ci', `origin/${branch}`],
        8000
      );
      const latestHashRes = await runExec(
        'git',
        ['rev-parse', '--short', `origin/${branch}`],
        8000
      );
      const remotePkgRes = await runExec(
        'git',
        ['show', `origin/${branch}:package.json`],
        8000
      ).catch(() => null);
      let remoteVersion = '';
      if (remotePkgRes && remotePkgRes.code === 0 && remotePkgRes.stdout) {
        try {
          const remotePkg = JSON.parse(remotePkgRes.stdout);
          if (typeof remotePkg?.version === 'string' && remotePkg.version.trim()) {
            remoteVersion = remotePkg.version.trim();
          }
        } catch {
          // ignore
        }
      }

      const latestCommit = latestHashRes.code === 0 ? latestHashRes.stdout : '';
      const effectiveRemoteVersion =
        behindCount > 0
          ? remoteVersion && compareSemver(remoteVersion, localVersion) > 0
            ? remoteVersion
            : incrementPatchVersion(localVersion)
          : remoteVersion || localVersion;

      res.json({
        supported: true,
        hasUpdate: behindCount > 0,
        behindCount,
        localVersion,
        remoteVersion: effectiveRemoteVersion || undefined,
        recentUpdates,
        currentCommit,
        remoteCommit: latestCommit,
        latestCommit,
        latestMessage: latestMsgRes.code === 0 ? latestMsgRes.stdout : '',
        latestDate: latestDateRes.code === 0 ? latestDateRes.stdout : '',
        branch,
        remoteUrl: remoteRes.stdout,
        supervisorActive,
      });
    } catch (err: any) {
      const recentUpdates = await readRecentUpdatesChangelog(cwd, false, localVersion);
      res.json({
        supported: false,
        localVersion,
        recentUpdates,
        supervisorActive,
        reason: err?.message || 'Không thể kiểm tra trạng thái Git',
      });
    }
  });

  app.post('/api/system/connect-github', async (req, res) => {
    try {
      const rawRepoUrl = String(req.body?.repoUrl || '').trim();
      const rawBranch = String(req.body?.branch || '').trim() || 'main';

      if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(rawRepoUrl)) {
        return res.status(400).json({
          ok: false,
          error: 'Địa chỉ kho GitHub không hợp lệ. Vui lòng nhập dạng https://github.com/ten-tai-khoan/ten-repo',
        });
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(rawBranch) || rawBranch.includes('..')) {
        return res.status(400).json({
          ok: false,
          error: 'Tên nhánh Git không hợp lệ (ví dụ: main hoặc master).',
        });
      }

      const normalizedUrl = rawRepoUrl.replace(/\/+$/, '').replace(/\.git$/, '') + '.git';
      const cwd = process.cwd();

      if (!fs.existsSync(path.join(cwd, '.git'))) {
        const initRes = await runExec('git', ['init'], 10_000);
        if (initRes.code !== 0) {
          return res.status(500).json({
            ok: false,
            error: initRes.stderr || 'Không thể khởi tạo Git trong thư mục dự án.',
          });
        }
      }

      const existingOrigin = await runExec('git', ['remote', 'get-url', 'origin'], 8000).catch(() => null);
      const remoteCmd =
        existingOrigin && existingOrigin.code === 0
          ? ['remote', 'set-url', 'origin', normalizedUrl]
          : ['remote', 'add', 'origin', normalizedUrl];
      const setRemoteRes = await runExec('git', remoteCmd, 8000);
      if (setRemoteRes.code !== 0) {
        return res.status(400).json({
          ok: false,
          error: setRemoteRes.stderr || 'Không thể cấu hình remote origin cho GitHub.',
        });
      }

      const fetchRes = await runExec('git', ['fetch', 'origin', rawBranch, '--quiet'], 18_000).catch(
        (err: any) => ({ code: 1, stdout: '', stderr: err?.message || 'Không thể kết nối GitHub' })
      );
      if (fetchRes.code !== 0) {
        return res.status(400).json({
          ok: false,
          error:
            fetchRes.stderr ||
            `Không thể tải thông tin từ kho GitHub (nhánh ${rawBranch}). Vui lòng kiểm tra lại link repo và tên nhánh.`,
        });
      }

      res.json({
        ok: true,
        remoteUrl: normalizedUrl,
        branch: rawBranch,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Không thể kết nối kho GitHub.',
      });
    }
  });

  app.post('/api/system/self-update', async (req, res) => {
    try {
      const forceReset = Boolean(req.body?.force);
      const hasActiveJobs = Array.from(jobs.values()).some(
        (j) => j.status === 'downloading' || j.status === 'processing'
      );
      if (hasActiveJobs) {
        return res.status(409).json({
          error: 'Đang có video đang tải hoặc xử lý FFmpeg. Vui lòng đợi tải xong rồi mới cập nhật.',
        });
      }

      const cwd = process.cwd();
      if (!fs.existsSync(path.join(cwd, '.git'))) {
        return res.status(400).json({ error: 'Thư mục này chưa kết nối GitHub (.git).' });
      }

      const branchRes = await runExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000);
      const branch =
        branchRes.code === 0 && branchRes.stdout && branchRes.stdout !== 'HEAD'
          ? branchRes.stdout
          : 'main';

      const prevCommitRes = await runExec('git', ['rev-parse', '--short', 'HEAD'], 8000);
      const prevCommit = prevCommitRes.code === 0 ? prevCommitRes.stdout : '';
      const prevEffectiveVersion = readLocalAppVersion(cwd, prevCommit);

      const pkgPath = path.join(cwd, 'package.json');
      const prevPkg = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf8') : '';

      const fetchRes = await runExec('git', ['fetch', 'origin', branch], 30_000);
      if (fetchRes.code !== 0) {
        return res.status(502).json({
          error: `Không thể kết nối GitHub: ${fetchRes.stderr || 'git fetch thất bại'}`,
        });
      }

      const backupDir = path.join(cwd, '.update-backup', String(Date.now()));
      const moveCollidingPathsToBackup = (relPaths: string[]): string[] => {
        const moved: string[] = [];
        for (const rawRel of relPaths) {
          const rel = rawRel.trim().replace(/\\/g, '/');
          if (!rel || rel.startsWith('/') || rel.includes('..') || rel.startsWith('.git/')) continue;
          const absSrc = path.resolve(cwd, rel);
          if (!absSrc.startsWith(path.resolve(cwd) + path.sep) || !fs.existsSync(absSrc)) continue;
          try {
            const absDst = path.resolve(backupDir, rel);
            fs.mkdirSync(path.dirname(absDst), { recursive: true });
            fs.renameSync(absSrc, absDst);
            moved.push(rel);
          } catch {
            // ignore move failure
          }
        }
        return moved;
      };

      const parseUntrackedConflictPaths = (stderrText: string): string[] => {
        const lines = String(stderrText || '').split(/\r?\n/);
        const results: string[] = [];
        let capture = false;
        for (const line of lines) {
          if (
            line.includes('untracked working tree files would be overwritten') ||
            line.includes('Untracked working tree file')
          ) {
            capture = true;
            const singleMatch = line.match(/Untracked working tree file ['"](.+?)['"]/);
            if (singleMatch?.[1]) results.push(singleMatch[1]);
            continue;
          }
          if (capture) {
            if (line.includes('Please move or remove') || line.includes('Aborting')) {
              capture = false;
              continue;
            }
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('error:') && !trimmed.startsWith('fatal:')) {
              results.push(trimmed);
            }
          }
        }
        return results;
      };

      // Stash local tracked edits (staged or unstaged) so pull --ff-only won't be blocked
      const statusTrackedRes = await runExec(
        'git',
        ['status', '--porcelain', '--untracked-files=no'],
        8000
      );
      if (statusTrackedRes.code === 0 && statusTrackedRes.stdout) {
        await runExec('git', ['stash', 'push', '-m', 'bilibatch-auto-update'], 10_000).catch(() => {});
      }

      // Detect untracked local files that collide with files tracked on origin/<branch>
      const [untrackedRes, remoteTreeRes] = await Promise.all([
        runExec('git', ['ls-files', '--others', '--exclude-standard'], 8000),
        runExec('git', ['ls-tree', '-r', '--name-only', `origin/${branch}`], 8000),
      ]);
      if (untrackedRes.code === 0 && remoteTreeRes.code === 0 && untrackedRes.stdout && remoteTreeRes.stdout) {
        const remoteSet = new Set(remoteTreeRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
        const colliding = untrackedRes.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((f) => f && remoteSet.has(f));
        if (colliding.length > 0) {
          moveCollidingPathsToBackup(colliding);
        }
      }

      let pullRes = await runExec('git', ['pull', '--ff-only', 'origin', branch], 30_000);
      if (pullRes.code !== 0) {
        const extraUntracked = parseUntrackedConflictPaths(pullRes.stderr);
        if (extraUntracked.length > 0) {
          moveCollidingPathsToBackup(extraUntracked);
          pullRes = await runExec('git', ['pull', '--ff-only', 'origin', branch], 30_000);
        }
      }

      if (pullRes.code !== 0 && forceReset) {
        const resetRes = await runExec('git', ['reset', '--hard', `origin/${branch}`], 30_000);
        if (resetRes.code !== 0) {
          const resetConflicts = parseUntrackedConflictPaths(resetRes.stderr);
          if (resetConflicts.length > 0) {
            moveCollidingPathsToBackup(resetConflicts);
            pullRes = await runExec('git', ['reset', '--hard', `origin/${branch}`], 30_000);
          } else {
            pullRes = resetRes;
          }
        } else {
          pullRes = resetRes;
        }
      }

      if (pullRes.code !== 0) {
        return res.status(500).json({
          canForceReset: true,
          branch,
          error: `Không thể tự gộp code mới (${pullRes.stderr || 'git pull thất bại'}). Bạn hãy bấm "Ghi đè xung đột & Cập nhật" bên dưới hoặc chạy "git reset --hard origin/${branch}" trong thư mục dự án.`,
        });
      }

      const nextPkg = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf8') : '';
      const extractPkgDepsFingerprint = (raw: string): string => {
        try {
          const parsed = JSON.parse(raw || '{}');
          return JSON.stringify({
            dependencies: parsed.dependencies || {},
            devDependencies: parsed.devDependencies || {},
            optionalDependencies: parsed.optionalDependencies || {},
            overrides: parsed.overrides || {},
          });
        } catch {
          return raw;
        }
      };

      let npmInstalled = false;
      if (extractPkgDepsFingerprint(prevPkg) !== extractPkgDepsFingerprint(nextPkg)) {
        const npmArgs = ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--prefer-offline'];
        let npmRes = await runExec('npm', npmArgs, 180_000);
        if (npmRes.code !== 0 && /nospc|enospc|no space left/i.test(`${npmRes.stderr}\n${npmRes.stdout}`)) {
          await runExec('npm', ['cache', 'clean', '--force'], 30_000).catch(() => {});
          npmRes = await runExec('npm', npmArgs, 180_000);
        }
        if (npmRes.code !== 0) {
          const combinedErr = `${npmRes.stderr}\n${npmRes.stdout}`;
          if (/nospc|enospc|no space left/i.test(combinedErr)) {
            return res.status(500).json({
              error:
                'Ổ đĩa máy tính (thường là ổ C) đã hết dung lượng trống (npm nospc). Hãy dọn ổ C / xóa C:\\Users\\...\\AppData\\Local\\npm-cache hoặc thư mục %TEMP%, chừa trống tối thiểu 2-3 GB rồi bấm cập nhật lại.',
            });
          }
          return res.status(500).json({
            error: `Đã tải code mới nhưng cài thư viện npm lỗi: ${npmRes.stderr.slice(-240)}`,
          });
        }
        npmInstalled = true;
      }

      const newCommitRes = await runExec('git', ['rev-parse', '--short', 'HEAD'], 8000);
      const newCommit = newCommitRes.code === 0 ? newCommitRes.stdout : '';
      const newMsgRes = await runExec('git', ['log', '-1', '--pretty=%s', 'HEAD'], 8000);
      const supervisorActive = process.env.BILIBATCH_SUPERVISOR === '1';

      let newVersion = readLocalAppVersion(cwd, newCommit);
      if (newCommit && prevCommit && newCommit !== prevCommit && compareSemver(newVersion, prevEffectiveVersion) <= 0) {
        newVersion = incrementPatchVersion(prevEffectiveVersion);
        writeRuntimeVersionOverride(cwd, newVersion, newCommit);
      }

      res.json({
        ok: true,
        updated: true,
        npmInstalled,
        commit: newCommit,
        newVersion,
        message: newMsgRes.code === 0 ? newMsgRes.stdout : '',
        restarting: supervisorActive,
      });

      if (supervisorActive) {
        setTimeout(() => {
          console.log('Self-update completed. Stopping child services & restarting...');
          stopLocalMuse2ApiProcess();
          process.exit(42);
        }, 600);
      }
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Lỗi không xác định khi cập nhật từ GitHub' });
      }
    }
  });

  // Ensure unmatched /api/* routes return JSON 404 instead of Vite SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Không tìm thấy API endpoint' });
  });

  // Ensure Express errors on /api/* (e.g., invalid JSON body, payload too large) return JSON
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      return res.status(status).json({
        error: err?.message || 'Lỗi xử lý trên máy chủ',
      });
    }
    next(err);
  });

  const httpServer = http.createServer(app);
  // Prevent intermittent browser NetworkError / ECONNRESET behind reverse proxies (Cloud Run LB keeps idle sockets 60s)
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 300_000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BiliBatch server running at http://localhost:${PORT}`);
    initCommandCenter();
    void autoStartLocalMuse2ApiOnServerBoot();
    // Pre-warm yt-dlp asynchronously so first Facebook/YouTube/TikTok link parses immediately without cold-download delay
    void ensureYtDlpPath().catch(() => {});
  });

  const handleShutdown = () => {
    stopLocalMuse2ApiProcess();
    process.exit(0);
  };
  process.once('SIGINT', handleShutdown);
  process.once('SIGTERM', handleShutdown);
}

startServer();
