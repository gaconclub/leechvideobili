import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import type {
  AiEngineReadinessItem,
  CoordinationCenterState,
  CoordinationReferenceItem,
  CoordinationSceneSpec,
  CoordinationSession,
  CoordinationSessionStatus,
  CoordinationTaskRow,
  CoordinationVoiceConfig,
  CoordinationWorkspaceConfig,
  IndependentVideoSource,
  MeetingRoomMessage,
} from '../src/types/coordinationCenter';
import type {
  DerivativeAspectRatio,
  StudioCharacterRef,
  StudioVideoStyle,
} from '../src/types/bilibili';
import {
  AI_MUSIC_STYLE_DIRECTIVES,
  buildVideoMusicPromptDirective,
  generateSceneVideoWithOmniFlash,
  generateStudioImage,
  getStudioAsset,
  synthesizeNarrationAudioForText,
  type StudioCharacterRefInput,
} from './derivative';
import { getAlibabaModelStudioStatus } from './alibabaModelStudio';
import { getMuse2ApiStatus, listHealthyMuse2ApiAccounts } from './muse2api';
import {
  getGeminiPoolSummary,
  hasAnyEnabledGeminiAccount,
  listHealthyGeminiWorkerAccounts,
  pickWorkerGeminiAccount,
  recordGeminiAccountUsage,
} from './geminiPool';
import {
  claimNextFlowBridgeJob,
  getFlowBridgeStatus,
  isFlowBridgeOnline,
  markFlowBridgeJobDone,
  markFlowBridgeJobFailed,
  type FlowBridgeClaimedJob,
} from './flowBridge';

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'coordination_center.json');
const ARTIFACTS_ROOT = path.resolve(DATA_DIR, 'coordination_artifacts');

const SHEET_TABS = {
  SESSIONS: 'Phien_Lam_Viec',
  REFERENCES: 'Du_Lieu_Tham_Chieu',
  TASKS: 'Bang_Nhiem_Vu_AI',
  MEETING: 'Phong_Hop_Tien_Do',
} as const;

const SOURCE_LABELS: Record<IndependentVideoSource, string> = {
  gemini: 'Gemini AI (Độc lập)',
  qwen: 'AI Qwen · Alibaba (Độc lập)',
  muse: 'Muse AI · Muse2API (Độc lập)',
  google_flow: 'Google Flow · Veo (Độc lập)',
};

type SseListener = (state: CoordinationCenterState) => void;
const sseListeners = new Set<SseListener>();
const activeTaskLocks = new Set<string>();
const activeSessionRunners = new Set<string>();
const pauseRequestedSessions = new Set<string>();

// Independent per-provider & per-account parallel worker pools so multiple scenes within a script
// AND multiple sessions execute concurrently across all ready accounts (Gemini keys, Muse accounts, Qwen, Google Flow)
// without overloading any single account.
export interface ProviderAccountWorker {
  source: IndependentVideoSource;
  accountId: string;
  accountLabel: string;
  apiKey?: string;
  museAccountId?: string;
}

let cachedMuseHealthyCount = 1;
const busyAccountKeys = new Set<string>();
const accountRoundRobinCursor: Record<IndependentVideoSource, number> = {
  gemini: 0,
  qwen: 0,
  muse: 0,
  google_flow: 0,
};

const providerActiveCounts: Record<IndependentVideoSource, number> = {
  gemini: 0,
  qwen: 0,
  muse: 0,
  google_flow: 0,
};
const accountWaiters: Record<IndependentVideoSource, Array<() => void>> = {
  gemini: [],
  qwen: [],
  muse: [],
  google_flow: [],
};

function getProviderConcurrencyLimit(source: IndependentVideoSource): number {
  if (source === 'gemini') {
    try {
      const pool = getGeminiPoolSummary();
      const healthy = pool.healthy || pool.enabled || 1;
      return Math.max(1, Math.min(8, healthy));
    } catch {
      return 2;
    }
  }
  if (source === 'muse') {
    return Math.max(1, Math.min(8, cachedMuseHealthyCount));
  }
  if (source === 'qwen') return 2;
  if (source === 'google_flow') return 3;
  return 1;
}

export async function resolveReadyWorkersForSource(
  source: IndependentVideoSource
): Promise<ProviderAccountWorker[]> {
  if (source === 'gemini') {
    const accounts = listHealthyGeminiWorkerAccounts({ includeChairman: true });
    if (accounts.length > 0) {
      return accounts.map((a) => ({
        source: 'gemini',
        accountId: a.id,
        accountLabel: a.label,
        apiKey: a.apiKey,
      }));
    }
    const fallback = pickWorkerGeminiAccount();
    if (fallback) {
      return [
        {
          source: 'gemini',
          accountId: fallback.id,
          accountLabel: fallback.label,
          apiKey: fallback.apiKey,
        },
      ];
    }
    return [{ source: 'gemini', accountId: 'gemini-default', accountLabel: 'Gemini Mặc định' }];
  }

  if (source === 'muse') {
    const museAccounts = await listHealthyMuse2ApiAccounts();
    if (museAccounts.length > 0) {
      cachedMuseHealthyCount = Math.max(1, Math.min(8, museAccounts.length));
      return museAccounts.map((a) => ({
        source: 'muse',
        accountId: a.id,
        accountLabel: a.label,
        museAccountId: a.id,
      }));
    }
    cachedMuseHealthyCount = 1;
    return [{ source: 'muse', accountId: 'muse-default', accountLabel: 'Muse2API Mặc định' }];
  }

  if (source === 'qwen') {
    return [
      { source: 'qwen', accountId: 'qwen-slot-1', accountLabel: 'Qwen Luồng #1' },
      { source: 'qwen', accountId: 'qwen-slot-2', accountLabel: 'Qwen Luồng #2' },
    ];
  }

  return [
    { source: 'google_flow', accountId: 'flow-slot-1', accountLabel: 'Google Flow Luồng #1' },
    { source: 'google_flow', accountId: 'flow-slot-2', accountLabel: 'Google Flow Luồng #2' },
    { source: 'google_flow', accountId: 'flow-slot-3', accountLabel: 'Google Flow Luồng #3' },
  ];
}

async function acquireDedicatedAccountWorker(
  source: IndependentVideoSource,
  shouldAbort?: () => boolean
): Promise<ProviderAccountWorker | null> {
  while (true) {
    if (shouldAbort?.()) return null;
    const workers = await resolveReadyWorkersForSource(source);
    if (workers.length === 0) return null;

    const startIdx = accountRoundRobinCursor[source] % workers.length;
    let picked: ProviderAccountWorker | null = null;
    for (let offset = 0; offset < workers.length; offset += 1) {
      const cand = workers[(startIdx + offset) % workers.length];
      const leaseKey = `${source}:${cand.accountId}`;
      if (!busyAccountKeys.has(leaseKey)) {
        picked = cand;
        accountRoundRobinCursor[source] = (startIdx + offset + 1) % 1_000_000;
        break;
      }
    }

    if (picked) {
      busyAccountKeys.add(`${source}:${picked.accountId}`);
      providerActiveCounts[source] += 1;
      return picked;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        resolve();
      };
      const fallbackTimer = setTimeout(done, 1500);
      accountWaiters[source].push(done);
    });
  }
}

function releaseDedicatedAccountWorker(worker: ProviderAccountWorker): void {
  const leaseKey = `${worker.source}:${worker.accountId}`;
  if (busyAccountKeys.delete(leaseKey)) {
    providerActiveCounts[worker.source] = Math.max(0, providerActiveCounts[worker.source] - 1);
  }
  const nextAccWaiter = accountWaiters[worker.source].shift();
  if (nextAccWaiter) nextAccWaiter();
}

async function withDedicatedAccountWorker<T>(
  source: IndependentVideoSource,
  fn: (worker: ProviderAccountWorker) => Promise<T>,
  shouldAbort?: () => boolean
): Promise<T | undefined> {
  const worker = await acquireDedicatedAccountWorker(source, shouldAbort);
  if (!worker) return undefined;
  try {
    return await fn(worker);
  } finally {
    releaseDedicatedAccountWorker(worker);
  }
}

export function getActiveWorkerTelemetry(): {
  activeSessionIds: string[];
  providerSlots: Record<IndependentVideoSource, { active: number; limit: number; waiting: number }>;
} {
  return {
    activeSessionIds: Array.from(activeSessionRunners),
    providerSlots: {
      gemini: {
        active: providerActiveCounts.gemini,
        limit: getProviderConcurrencyLimit('gemini'),
        waiting: accountWaiters.gemini.length,
      },
      qwen: {
        active: providerActiveCounts.qwen,
        limit: getProviderConcurrencyLimit('qwen'),
        waiting: accountWaiters.qwen.length,
      },
      muse: {
        active: providerActiveCounts.muse,
        limit: getProviderConcurrencyLimit('muse'),
        waiting: accountWaiters.muse.length,
      },
      google_flow: {
        active: providerActiveCounts.google_flow,
        limit: getProviderConcurrencyLimit('google_flow'),
        waiting: accountWaiters.google_flow.length,
      },
    },
  };
}

let stateCache: CoordinationCenterState | null = null;
let ffmpegCheckCache: { checkedAt: number; available: boolean; version?: string } | null = null;

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function fmtViTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('vi-VN');
}

function sanitizeIdSegment(raw: string, fallback = 'item'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  return cleaned || fallback;
}

function getSessionArtifactDir(sessionId: string): string {
  const safeSession = sanitizeIdSegment(sessionId, 'session');
  const resolved = path.resolve(ARTIFACTS_ROOT, safeSession);
  if (!resolved.startsWith(ARTIFACTS_ROOT + path.sep)) {
    throw new Error('Đường dẫn thư mục phiên không hợp lệ.');
  }
  ensureDir(resolved);
  return resolved;
}

export function resolveCoordinationArtifactPath(sessionId: string, filename: string): string | null {
  const safeSession = sanitizeIdSegment(sessionId, '');
  const safeFile = path.basename(String(filename || '').trim());
  if (!safeSession || !safeFile || safeFile.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(safeFile)) {
    return null;
  }
  const resolved = path.resolve(ARTIFACTS_ROOT, safeSession, safeFile);
  if (!resolved.startsWith(ARTIFACTS_ROOT + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }
  return resolved;
}

function artifactUrlFor(sessionId: string, fileName: string): string {
  return `/api/coordination/artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; ext: string; buffer: Buffer } | null {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const ext =
    mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? 'jpg'
      : mimeType.includes('webp')
      ? 'webp'
      : 'png';
  return {
    mimeType,
    ext,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function readLocalFileAsDataUrl(sessionId: string, fileName?: string): string | null {
  if (!fileName) return null;
  const fp = resolveCoordinationArtifactPath(sessionId, fileName);
  if (!fp) return null;
  const ext = path.extname(fp).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
      ? 'image/webp'
      : ext === '.png'
      ? 'image/png'
      : 'application/octet-stream';
  if (!mime.startsWith('image/')) return null;
  const buf = fs.readFileSync(fp);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function saveBase64ImageArtifact(sessionId: string, baseName: string, dataUrl: string): {
  fileName: string;
  filePath: string;
  localUrl: string;
  mimeType: string;
} | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const dir = getSessionArtifactDir(sessionId);
  const fileName = `${sanitizeIdSegment(baseName, 'img')}.${parsed.ext}`;
  const filePath = path.resolve(dir, fileName);
  if (!filePath.startsWith(ARTIFACTS_ROOT + path.sep)) return null;
  fs.writeFileSync(filePath, parsed.buffer);
  return {
    fileName,
    filePath,
    localUrl: artifactUrlFor(sessionId, fileName),
    mimeType: parsed.mimeType,
  };
}

function saveBufferArtifact(
  sessionId: string,
  fileNameRaw: string,
  buffer: Buffer
): { fileName: string; filePath: string; localUrl: string } {
  const dir = getSessionArtifactDir(sessionId);
  const fileName = sanitizeIdSegment(fileNameRaw, `file_${Date.now()}.bin`);
  const filePath = path.resolve(dir, fileName);
  if (!filePath.startsWith(ARTIFACTS_ROOT + path.sep)) {
    throw new Error('Tên tệp artifact không hợp lệ.');
  }
  fs.writeFileSync(filePath, buffer);
  return {
    fileName,
    filePath,
    localUrl: artifactUrlFor(sessionId, fileName),
  };
}

function createInitialState(): CoordinationCenterState {
  return {
    readiness: [],
    readinessCheckedAt: 0,
    workspace: {},
    activeSessionId: null,
    sessions: [],
    meetingMessages: [],
    updatedAt: Date.now(),
  };
}

function loadState(): CoordinationCenterState {
  if (stateCache) return stateCache;
  ensureDir(DATA_DIR);
  ensureDir(ARTIFACTS_ROOT);
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<CoordinationCenterState>;
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      // Reset any orphaned DANG_LAM tasks from a server restart back to CHO_NHAN with note
      for (const s of sessions) {
        if (s.status === 'DANG_CHAY') {
          s.status = 'TAM_DUNG';
        }
        for (const t of s.tasks || []) {
          if (t.status === 'DANG_LAM') {
            t.status = 'CHO_NHAN';
            t.errorReason = 'Máy chủ khởi động lại giữa chừng — tác vụ đã về trạng thái Chờ nhận để chạy tiếp an toàn.';
          }
        }
      }
      stateCache = {
        readiness: Array.isArray(parsed.readiness) ? parsed.readiness : [],
        readinessCheckedAt: Number(parsed.readinessCheckedAt || 0),
        workspace: parsed.workspace && typeof parsed.workspace === 'object' ? parsed.workspace : {},
        activeSessionId: parsed.activeSessionId || sessions[0]?.sessionId || null,
        sessions,
        meetingMessages: Array.isArray(parsed.meetingMessages) ? parsed.meetingMessages.slice(-400) : [],
        updatedAt: Number(parsed.updatedAt || Date.now()),
      };
      return stateCache;
    } catch {
      // fall through to fresh state
    }
  }
  stateCache = createInitialState();
  saveState();
  return stateCache;
}

function saveState(broadcast = true): void {
  if (!stateCache) return;
  stateCache.updatedAt = Date.now();
  ensureDir(DATA_DIR);
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stateCache, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
  if (broadcast) {
    for (const listener of sseListeners) {
      try {
        listener(stateCache);
      } catch {
        // ignore listener failure
      }
    }
  }
}

export function subscribeCoordinationEvents(listener: SseListener): () => void {
  sseListeners.add(listener);
  return () => {
    sseListeners.delete(listener);
  };
}

function pushMeetingMessage(input: Omit<MeetingRoomMessage, 'id' | 'createdAt'>): MeetingRoomMessage {
  const st = loadState();
  const msg: MeetingRoomMessage = {
    id: `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    createdAt: Date.now(),
    ...input,
  };
  st.meetingMessages = [...st.meetingMessages, msg].slice(-400);
  saveState(true);
  return msg;
}

function recomputeSessionStatus(session: CoordinationSession): void {
  const tasks = session.tasks;
  if (tasks.length === 0) {
    session.status = 'CHO_CHAY';
    return;
  }
  const hasRunning = tasks.some((t) => t.status === 'DANG_LAM');
  if (hasRunning) {
    session.status = 'DANG_CHAY';
    return;
  }
  const allDone = tasks.every((t) => t.status === 'HOAN_THANH');
  if (allDone) {
    session.status = 'HOAN_THANH';
    session.lastError = undefined;
    return;
  }
  const hasFlowWait = tasks.some((t) => t.status === 'CHO_NHAP_FLOW');
  const hasError = tasks.some((t) => t.status === 'LOI');
  if (hasError) {
    session.status = 'CO_LOI';
    const firstErr = tasks.find((t) => t.status === 'LOI');
    session.lastError = firstErr?.errorReason || 'Có tác vụ bị lỗi trong bảng điều phối.';
    return;
  }
  if (hasFlowWait) {
    session.status = 'CHO_FLOW';
    return;
  }
  if (pauseRequestedSessions.has(session.sessionId)) {
    session.status = 'TAM_DUNG';
    return;
  }
  const anyDone = tasks.some((t) => t.status === 'HOAN_THANH');
  session.status = anyDone ? 'TAM_DUNG' : 'CHO_CHAY';
}

// ==========================================
// 1. REAL-TIME AI READINESS CHECKER
// ==========================================

async function checkFfmpegAvailable(): Promise<{ available: boolean; version?: string }> {
  if (ffmpegCheckCache && Date.now() - ffmpegCheckCache.checkedAt < 60_000) {
    return ffmpegCheckCache;
  }
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'], { timeout: 5_000 });
    const firstLine = String(stdout || '').split(/\r?\n/)[0]?.trim() || 'ffmpeg sẵn sàng';
    ffmpegCheckCache = { checkedAt: Date.now(), available: true, version: firstLine.slice(0, 80) };
  } catch {
    ffmpegCheckCache = { checkedAt: Date.now(), available: false };
  }
  return ffmpegCheckCache;
}

export async function checkAllAiReadiness(force = false): Promise<AiEngineReadinessItem[]> {
  const st = loadState();
  if (!force && st.readiness.length > 0 && Date.now() - st.readinessCheckedAt < 25_000) {
    return st.readiness;
  }

  const now = Date.now();
  const results: AiEngineReadinessItem[] = [];

  // 1) Gemini AI
  try {
    const t0 = Date.now();
    const pool = getGeminiPoolSummary();
    const hasEnv = Boolean(process.env.GEMINI_API_KEY?.trim());
    const hasEnabled = hasAnyEnabledGeminiAccount() || hasEnv;
    results.push({
      id: 'gemini',
      name: 'Gemini AI',
      role: 'Kịch bản · Ảnh phân cảnh · Video Omni Flash',
      independentSource: 'gemini',
      status: hasEnabled ? 'ready' : 'unconfigured',
      latencyMs: Math.max(1, Date.now() - t0),
      activeModel: 'gemini-3.1-flash-image / Veo & Omni',
      accountSummary: `${pool.enabled || (hasEnv ? 1 : 0)} khóa đang bật (${pool.healthy || (hasEnv ? 1 : 0)} khỏe)`,
      detail: hasEnabled
        ? 'Sẵn sàng chạy độc lập toàn bộ luồng tạo ảnh & video bằng Gemini.'
        : 'Chưa có GEMINI_API_KEY hoặc tài khoản Gemini bật trong Cài đặt.',
      checkedAt: now,
    });
  } catch (err: any) {
    results.push({
      id: 'gemini',
      name: 'Gemini AI',
      role: 'Kịch bản · Ảnh phân cảnh · Video AI',
      independentSource: 'gemini',
      status: 'error',
      detail: err?.message || 'Lỗi kiểm tra trạng thái Gemini AI.',
      checkedAt: now,
    });
  }

  // 2) Alibaba ModelStudio / AI Qwen
  try {
    const qwen = getAlibabaModelStudioStatus();
    const qwenReady = Boolean(qwen.enabled && qwen.hasKey);
    results.push({
      id: 'qwen',
      name: 'AI Qwen (Alibaba ModelStudio)',
      role: 'Ảnh Qwen-Image · Video Wan I2V/T2V',
      independentSource: 'qwen',
      status: qwenReady
        ? qwen.status === 'error' || qwen.status === 'auth_error'
          ? 'error'
          : 'ready'
        : 'unconfigured',
      latencyMs: qwen.lastLatencyMs,
      activeModel: `${qwen.imageModel || 'qwen-image-plus'} / ${qwen.videoModel || 'wan2.5-i2v-preview'}`,
      accountSummary: qwen.hasKey ? `${qwen.regionLabel} · ${qwen.maskedKey}` : 'Chưa có DASHSCOPE_API_KEY',
      detail: qwenReady
        ? qwen.lastError
          ? `Có cảnh báo gần nhất: ${qwen.lastError}`
          : 'Sẵn sàng chạy độc lập bằng Alibaba ModelStudio (Qwen & Wan).'
        : 'Chưa bật hoặc chưa cấu hình DASHSCOPE_API_KEY trong Cài đặt AI.',
      checkedAt: now,
    });
  } catch (err: any) {
    results.push({
      id: 'qwen',
      name: 'AI Qwen (Alibaba ModelStudio)',
      role: 'Ảnh Qwen-Image · Video Wan I2V/T2V',
      independentSource: 'qwen',
      status: 'error',
      detail: err?.message || 'Lỗi kiểm tra cấu hình AI Qwen.',
      checkedAt: now,
    });
  }

  // 3) Muse AI (Muse2API)
  try {
    const t0 = Date.now();
    const muse = await getMuse2ApiStatus(force);
    const latencyMs = Math.max(1, Date.now() - t0);
    if (muse.ready) {
      cachedMuseHealthyCount = Math.max(1, Math.min(8, muse.healthyAccounts || muse.accountsCount || 1));
    }
    results.push({
      id: 'muse',
      name: 'Muse AI (Muse2API)',
      role: 'Tạo ảnh muse-image · Tạo video muse-video',
      independentSource: 'muse',
      status: muse.ready ? 'ready' : muse.reachable ? 'error' : 'offline',
      latencyMs,
      activeModel: 'muse-image / muse-video',
      accountSummary: `${muse.healthyAccounts}/${muse.accountsCount} tài khoản khỏe · ${muse.baseUrl}`,
      detail: muse.ready
        ? 'Muse2API trực tuyến, sẵn sàng chạy độc lập theo đúng lệnh của phiên.'
        : muse.error ||
          (muse.reachable
            ? 'Muse2API đang chạy nhưng chưa có tài khoản khỏe/hợp lệ.'
            : 'Muse2API chưa kết nối. Chỉ cần bật nếu bạn chọn nguồn video là Muse AI.'),
      checkedAt: now,
    });
  } catch (err: any) {
    results.push({
      id: 'muse',
      name: 'Muse AI (Muse2API)',
      role: 'Tạo ảnh muse-image · Tạo video muse-video',
      independentSource: 'muse',
      status: 'offline',
      detail: err?.message || 'Không thể kết nối tới dịch vụ Muse2API.',
      checkedAt: now,
    });
  }

  // 4) Google Flow (Veo Auto-Bridge + Manual Fallback)
  const flowBridge = getFlowBridgeStatus(st);
  results.push({
    id: 'google_flow',
    name: 'Google Flow (Veo · Auto-Bridge)',
    role: flowBridge.connected
      ? 'Tự động tạo Ảnh & Video trên Google Flow qua Chrome Extension'
      : 'Tạo Ảnh & Video Google Flow (cài Extension để chạy tự động 100%)',
    independentSource: 'google_flow',
    status: 'ready',
    activeModel: flowBridge.connected
      ? `Flow Auto-Bridge (${flowBridge.extensionVersion || 'v1.1'}) · ${flowBridge.flowTabReady ? 'Tab Flow sẵn sàng' : 'Chờ mở tab Flow'}`
      : 'Flow Prompt + Upload (Chưa bật Extension)',
    accountSummary: flowBridge.connected
      ? `Extension TRỰC TUYẾN · ${flowBridge.stats.completedImages} ảnh / ${flowBridge.stats.completedVideos} video`
      : 'Chưa kết nối Extension Chrome',
    detail: flowBridge.connected
      ? flowBridge.flowTabReady
        ? 'Chrome Extension đang trực tuyến và tab labs.google/fx sẵn sàng — bấm Chạy để tự động tạo ảnh & video bằng credit Flow.'
        : 'Chrome Extension đang trực tuyến — hãy mở tab https://labs.google/fx/tools/flow trên Chrome để tự động chạy.'
      : 'Có thể tải Chrome Extension Flow Auto-Bridge ngay bên dưới để tạo ảnh & video tự động 100% không cần copy prompt.',
    checkedAt: now,
  });

  // 5) FFmpeg Assembler
  const ff = await checkFfmpegAvailable();
  results.push({
    id: 'ffmpeg',
    name: 'FFmpeg Ghép Phim',
    role: 'Ghép các phân cảnh đã tạo thành phim MP4 hoàn chỉnh',
    status: ff.available ? 'ready' : 'offline',
    activeModel: ff.version || 'ffmpeg',
    detail: ff.available
      ? 'Sẵn sàng ghép thẳng các cảnh đã hoàn thành thành tệp MP4 cuối cùng.'
      : 'Không tìm thấy ffmpeg trên máy chủ — không thể ghép video cuối.',
    checkedAt: now,
  });

  st.readiness = results;
  st.readinessCheckedAt = now;
  saveState(true);
  return results;
}

export async function getCoordinationCenterState(forceHealth = false): Promise<CoordinationCenterState> {
  const st = loadState();
  if (forceHealth || st.readiness.length === 0) {
    await checkAllAiReadiness(forceHealth);
  }
  return loadState();
}

// ==========================================
// 2. GOOGLE SHEETS & GOOGLE DRIVE LEDGER
// ==========================================

export function extractGoogleBearerToken(authHeader?: string): string {
  const raw = String(authHeader || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error('Thiếu mã xác thực Google Workspace. Vui lòng đăng nhập bằng Google trước.');
  }
  return match[1].trim();
}

export function extractOptionalGoogleBearerToken(authHeader?: string): string | undefined {
  const raw = String(authHeader || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

async function googleApiJson<T = any>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      json?.error?.message || json?.error_description || `Google API HTTP ${res.status}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

async function verifyDriveItemExists(token: string, fileId?: string): Promise<boolean> {
  if (!fileId) return false;
  try {
    const meta = await googleApiJson<{ id?: string; trashed?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
      token
    );
    return Boolean(meta?.id && !meta.trashed);
  } catch {
    return false;
  }
}

async function createDriveFolder(
  token: string,
  name: string,
  parentId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const body: Record<string, any> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const created = await googleApiJson<{ id: string; name: string; webViewLink?: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    token,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  return {
    id: created.id,
    name: created.name || name,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function ensureRootDriveFolder(token: string): Promise<{ id: string; name: string; url: string }> {
  const st = loadState();
  if (st.workspace.rootFolderId && (await verifyDriveItemExists(token, st.workspace.rootFolderId))) {
    return {
      id: st.workspace.rootFolderId,
      name: st.workspace.rootFolderName || 'Trung_Tam_Dieu_Phoi_AI',
      url: st.workspace.rootFolderUrl || `https://drive.google.com/drive/folders/${st.workspace.rootFolderId}`,
    };
  }
  const created = await createDriveFolder(token, 'Trung_Tam_Dieu_Phoi_AI');
  st.workspace.rootFolderId = created.id;
  st.workspace.rootFolderName = created.name;
  st.workspace.rootFolderUrl = created.webViewLink;
  saveState(true);
  return { id: created.id, name: created.name, url: created.webViewLink };
}

async function ensureSessionDriveFolder(
  token: string,
  session: CoordinationSession
): Promise<{ folderId: string; folderName: string; folderUrl: string }> {
  if (session.driveFolderId && (await verifyDriveItemExists(token, session.driveFolderId))) {
    return {
      folderId: session.driveFolderId,
      folderName: session.driveFolderName || session.sessionId,
      folderUrl: session.driveFolderUrl || `https://drive.google.com/drive/folders/${session.driveFolderId}`,
    };
  }
  const root = await ensureRootDriveFolder(token);
  const cleanTitle = String(session.title || 'Phien_San_Xuat')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 56);
  const created = await createDriveFolder(token, `${session.sessionId} - ${cleanTitle}`, root.id);
  session.driveFolderId = created.id;
  session.driveFolderName = created.name;
  session.driveFolderUrl = created.webViewLink;
  saveState(true);
  return {
    folderId: created.id,
    folderName: created.name,
    folderUrl: created.webViewLink,
  };
}

async function uploadBufferToDrive(params: {
  token: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string; webViewLink: string }> {
  const boundary = `coord_drive_${crypto.randomBytes(8).toString('hex')}`;
  const metadata = JSON.stringify({
    name: params.fileName,
    parents: [params.folderId],
  });
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    'utf8'
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([preamble, params.buffer, epilogue]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    }
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      json?.error?.message || `Không tải được tệp "${params.fileName}" lên Google Drive (HTTP ${res.status})`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return {
    id: json.id,
    webViewLink: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`,
  };
}

async function ensureLedgerSheetStructure(
  token: string,
  spreadsheetId: string
): Promise<{ title: string }> {
  const meta = await googleApiJson<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
    token
  );
  const existingTabs = (meta.sheets || []).map((s) => s.properties?.title || '').filter(Boolean);
  const requiredTabs = [
    SHEET_TABS.SESSIONS,
    SHEET_TABS.REFERENCES,
    SHEET_TABS.TASKS,
    SHEET_TABS.MEETING,
  ];
  const missingTabs = requiredTabs.filter((t) => !existingTabs.includes(t));
  if (missingTabs.length > 0) {
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTabs.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      }
    );
  }

  const headers: Record<string, string[]> = {
    [SHEET_TABS.SESSIONS]: [
      'session_id',
      'ten_phien',
      'nguon_video_doc_lap',
      'trang_thai',
      'so_phan_canh',
      'tien_do_pct',
      'drive_folder_url',
      'video_hoan_chinh_url',
      'thoi_gian_tao',
      'cap_nhat_cuoi',
      'ghi_chu_loi',
    ],
    [SHEET_TABS.REFERENCES]: [
      'key',
      'session_id',
      'ref_id',
      'loai_tham_chieu',
      'ten',
      'mo_ta_chi_tiet',
      'drive_file_id',
      'drive_url',
      'cap_nhat_luc',
    ],
    [SHEET_TABS.TASKS]: [
      'key',
      'session_id',
      'task_code',
      'buoc',
      'scene_index',
      'nhiem_vu',
      'nguon_ai_khoa',
      'ai_dam_nhan',
      'phu_thuoc_task',
      'tham_chieu_dau_vao',
      'trang_thai',
      'ket_qua_tom_tat',
      'drive_output_url',
      'ly_do_loi',
      'lan_thu',
      'bat_dau',
      'hoan_thanh',
    ],
    [SHEET_TABS.MEETING]: [
      'key',
      'session_id',
      'thoi_gian',
      'nguoi_gui',
      'vai_tro',
      'loai_tin',
      'task_code',
      'noi_dung',
      'link_tham_chieu',
    ],
  };

  for (const tab of requiredTabs) {
    const check = await googleApiJson<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1:Q1`)}`,
      token
    );
    if (!check.values || !check.values[0]?.[0]) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=USER_ENTERED`,
        token,
        {
          method: 'PUT',
          body: JSON.stringify({ values: [headers[tab]] }),
        }
      );
    }
  }

  return { title: meta.properties?.title || 'Trung Tâm Điều Phối AI — Sổ Điều Phối & Tham Chiếu' };
}

export async function initCoordinationWorkspace(params: {
  token: string;
  existingSpreadsheetId?: string;
  spreadsheetTitle?: string;
}): Promise<CoordinationWorkspaceConfig> {
  const st = loadState();
  const root = await ensureRootDriveFolder(params.token);

  let sheetId = String(params.existingSpreadsheetId || '').trim();
  const urlMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) sheetId = urlMatch[1];

  if (!sheetId) {
    const title =
      String(params.spreadsheetTitle || '').trim() ||
      'Trung Tâm Điều Phối AI — Sổ Phiên & Dữ Liệu Tham Chiếu';
    const created = await googleApiJson<{
      spreadsheetId: string;
      spreadsheetUrl?: string;
      properties?: { title?: string };
    }>('https://sheets.googleapis.com/v4/spreadsheets', params.token, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title },
        sheets: [
          { properties: { title: SHEET_TABS.SESSIONS } },
          { properties: { title: SHEET_TABS.REFERENCES } },
          { properties: { title: SHEET_TABS.TASKS } },
          { properties: { title: SHEET_TABS.MEETING } },
        ],
      }),
    });
    sheetId = created.spreadsheetId;
    st.workspace.spreadsheetId = sheetId;
    st.workspace.spreadsheetTitle = created.properties?.title || title;
    st.workspace.spreadsheetUrl =
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}?addParents=${encodeURIComponent(root.id)}&fields=id,parents`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${params.token}` },
          signal: AbortSignal.timeout(15_000),
        }
      );
    } catch {
      // non-fatal move error
    }
  } else {
    st.workspace.spreadsheetId = sheetId;
    st.workspace.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  }

  const verified = await ensureLedgerSheetStructure(params.token, sheetId);
  st.workspace.spreadsheetTitle = verified.title;
  st.workspace.lastSyncedAt = Date.now();
  saveState(true);
  return st.workspace;
}

async function upsertRowsByKeyInTab(params: {
  token: string;
  spreadsheetId: string;
  tabName: string;
  keyColIndex: number;
  rows: string[][];
}): Promise<void> {
  if (params.rows.length === 0) return;
  const existingRes = await googleApiJson<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(`${params.tabName}!A2:Q`)}`,
    params.token
  );
  const existingRows = Array.isArray(existingRes.values) ? existingRes.values : [];
  const keyToRowNumber = new Map<string, number>();
  existingRows.forEach((row, idx) => {
    const key = String(row[params.keyColIndex] || '').trim();
    if (key) keyToRowNumber.set(key, idx + 2);
  });

  const updates: { range: string; values: string[][] }[] = [];
  const appends: string[][] = [];

  for (const row of params.rows) {
    const key = String(row[params.keyColIndex] || '').trim();
    const rowNum = key ? keyToRowNumber.get(key) : undefined;
    if (rowNum) {
      updates.push({
        range: `${params.tabName}!A${rowNum}`,
        values: [row],
      });
    } else {
      appends.push(row);
    }
  }

  if (updates.length > 0) {
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values:batchUpdate`,
      params.token,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        }),
      }
    );
  }

  if (appends.length > 0) {
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(`${params.tabName}!A:Q`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      params.token,
      {
        method: 'POST',
        body: JSON.stringify({ values: appends }),
      }
    );
  }
}

export async function syncSessionToGoogleWorkspace(params: {
  token: string;
  sessionId: string;
  silentMeetingNote?: boolean;
}): Promise<{
  session: CoordinationSession;
  workspace: CoordinationWorkspaceConfig;
  uploadedFilesCount: number;
}> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) {
    throw new Error(`Không tìm thấy phiên làm việc "${params.sessionId}".`);
  }
  if (!st.workspace.spreadsheetId) {
    await initCoordinationWorkspace({ token: params.token });
  }
  const spreadsheetId = st.workspace.spreadsheetId!;
  await ensureLedgerSheetStructure(params.token, spreadsheetId);
  const driveFolder = await ensureSessionDriveFolder(params.token, session);

  let uploadedFilesCount = 0;

  // 1) Upload reference artifacts (character images & script JSON) to Drive if not uploaded yet
  for (const ref of session.references) {
    if (ref.driveFileId && ref.driveUrl) continue;
    if (ref.localFileName) {
      const fp = resolveCoordinationArtifactPath(session.sessionId, ref.localFileName);
      if (fp) {
        const ext = path.extname(fp).toLowerCase();
        const mime =
          ext === '.json'
            ? 'application/json'
            : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
        const uploaded = await uploadBufferToDrive({
          token: params.token,
          folderId: driveFolder.folderId,
          fileName: `${ref.refId}_${ref.localFileName}`,
          mimeType: mime,
          buffer: fs.readFileSync(fp),
        });
        ref.driveFileId = uploaded.id;
        ref.driveUrl = uploaded.webViewLink;
        ref.updatedAt = Date.now();
        uploadedFilesCount += 1;
      }
    }
  }

  // 2) Upload task outputs (scene images, scene videos, final film) to Drive if not uploaded yet
  for (const task of session.tasks) {
    if (task.driveFileId && task.driveOutputUrl) continue;
    if (!task.localOutputFileName) continue;
    const fp = resolveCoordinationArtifactPath(session.sessionId, task.localOutputFileName);
    if (!fp) continue;
    const ext = path.extname(fp).toLowerCase();
    const mime =
      ext === '.mp4'
        ? 'video/mp4'
        : ext === '.webm'
        ? 'video/webm'
        : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
        ? 'image/webp'
        : ext === '.json'
        ? 'application/json'
        : 'image/png';
    const uploaded = await uploadBufferToDrive({
      token: params.token,
      folderId: driveFolder.folderId,
      fileName: `${task.taskCode}_${task.localOutputFileName}`,
      mimeType: mime,
      buffer: fs.readFileSync(fp),
    });
    task.driveFileId = uploaded.id;
    task.driveOutputUrl = uploaded.webViewLink;
    task.updatedAt = Date.now();
    uploadedFilesCount += 1;
    if (task.taskCode.endsWith('-FINAL')) {
      session.finalVideoDriveUrl = uploaded.webViewLink;
    }
  }

  // Refresh inputDriveLinks on every task from references & upstream tasks
  const refDriveById = new Map(session.references.map((r) => [r.refId, r.driveUrl || '']));
  const taskDriveByCode = new Map(session.tasks.map((t) => [t.taskCode, t.driveOutputUrl || '']));
  for (const task of session.tasks) {
    const links: string[] = [];
    for (const rid of task.inputRefIds) {
      const u = refDriveById.get(rid);
      if (u) links.push(u);
    }
    for (const dep of task.dependsOnTaskCodes) {
      const u = taskDriveByCode.get(dep);
      if (u) links.push(u);
    }
    task.inputDriveLinks = Array.from(new Set(links));
  }

  // 3) Upsert Tab 1: Phien_Lam_Viec
  const completedCount = session.tasks.filter((t) => t.status === 'HOAN_THANH').length;
  const pct = session.tasks.length > 0 ? Math.round((completedCount / session.tasks.length) * 100) : 0;
  await upsertRowsByKeyInTab({
    token: params.token,
    spreadsheetId,
    tabName: SHEET_TABS.SESSIONS,
    keyColIndex: 0,
    rows: [
      [
        session.sessionId,
        session.title,
        SOURCE_LABELS[session.videoSource],
        session.status,
        String(session.scenes.length),
        `${pct}%`,
        driveFolder.folderUrl,
        session.finalVideoDriveUrl || '',
        fmtViTime(session.createdAt),
        fmtViTime(Date.now()),
        session.lastError || '',
      ],
    ],
  });

  // 4) Upsert Tab 2: Du_Lieu_Tham_Chieu
  await upsertRowsByKeyInTab({
    token: params.token,
    spreadsheetId,
    tabName: SHEET_TABS.REFERENCES,
    keyColIndex: 0,
    rows: session.references.map((r) => [
      `${session.sessionId}|${r.refId}`,
      session.sessionId,
      r.refId,
      r.kind,
      r.name,
      r.detail.slice(0, 1500),
      r.driveFileId || '',
      r.driveUrl || '',
      fmtViTime(r.updatedAt),
    ]),
  });

  // 5) Upsert Tab 3: Bang_Nhiem_Vu_AI
  await upsertRowsByKeyInTab({
    token: params.token,
    spreadsheetId,
    tabName: SHEET_TABS.TASKS,
    keyColIndex: 0,
    rows: session.tasks.map((t) => [
      `${session.sessionId}|${t.taskCode}`,
      session.sessionId,
      t.taskCode,
      `Bước ${t.step}: ${t.stepLabel}`,
      t.sceneIndex ? `Cảnh ${t.sceneIndex}` : '-',
      t.title,
      SOURCE_LABELS[t.videoSourceLock],
      t.assignedAiLabel,
      t.dependsOnTaskCodes.join(', ') || 'Không',
      [...t.inputRefIds, ...t.inputDriveLinks].filter(Boolean).join(' | ').slice(0, 1500),
      t.status,
      (t.resultSummary || '').slice(0, 1000),
      t.driveOutputUrl || '',
      (t.errorReason || '').slice(0, 1000),
      String(t.retryCount || 0),
      fmtViTime(t.startedAt),
      fmtViTime(t.completedAt),
    ]),
  });

  // 6) Upsert Tab 4: Phong_Hop_Tien_Do
  const sessionMsgs = st.meetingMessages.filter((m) => m.sessionId === session.sessionId).slice(-80);
  await upsertRowsByKeyInTab({
    token: params.token,
    spreadsheetId,
    tabName: SHEET_TABS.MEETING,
    keyColIndex: 0,
    rows: sessionMsgs.map((m) => [
      `${session.sessionId}|${m.id}`,
      session.sessionId,
      fmtViTime(m.createdAt),
      m.senderName,
      m.senderRole,
      m.kind,
      m.taskCode || '',
      m.content.slice(0, 1500),
      m.referenceLink || '',
    ]),
  });

  session.lastSheetsSyncAt = Date.now();
  st.workspace.lastSyncedAt = Date.now();
  saveState(true);

  if (!params.silentMeetingNote) {
    pushMeetingMessage({
      sessionId: session.sessionId,
      senderId: 'workspace_sync',
      senderName: 'Sổ Google Sheets & Drive',
      senderRole: 'Đồng bộ dữ liệu tham chiếu',
      kind: 'sync',
      content: `Đã đồng bộ phiên ${session.sessionId} lên Google Sheets (4 bảng) và tải ${uploadedFilesCount} tệp mới lên Google Drive. Mọi AI đều có thể truy xuất dữ liệu tham chiếu khớp phiên.`,
      referenceLink: st.workspace.spreadsheetUrl,
    });
  }

  return { session, workspace: st.workspace, uploadedFilesCount };
}

export async function readLiveSessionFromGoogleSheets(params: {
  token: string;
  sessionId: string;
}): Promise<{
  spreadsheetUrl?: string;
  tasks: Record<string, string>[];
  references: Record<string, string>[];
}> {
  const st = loadState();
  if (!st.workspace.spreadsheetId) {
    throw new Error('Chưa kết nối tệp Google Sheets nào.');
  }
  const sheetId = st.workspace.spreadsheetId;
  const [taskRes, refRes] = await Promise.all([
    googleApiJson<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${SHEET_TABS.TASKS}!A1:Q`)}`,
      params.token
    ),
    googleApiJson<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${SHEET_TABS.REFERENCES}!A1:I`)}`,
      params.token
    ),
  ]);

  const mapRows = (values?: string[][], sessionCol = 1) => {
    if (!Array.isArray(values) || values.length < 2) return [];
    const header = values[0];
    return values
      .slice(1)
      .filter((r) => !params.sessionId || params.sessionId === 'all' || r[sessionCol] === params.sessionId)
      .map((r) => {
        const obj: Record<string, string> = {};
        header.forEach((h, i) => {
          obj[h] = String(r[i] || '');
        });
        return obj;
      });
  };

  return {
    spreadsheetUrl: st.workspace.spreadsheetUrl,
    tasks: mapRows(taskRes.values, 1),
    references: mapRows(refRes.values, 1),
  };
}

// ==========================================
// 3. STUDIO ORDER INTAKE -> ISOLATED SESSION
// ==========================================

function buildTasksForSession(params: {
  sessionId: string;
  videoSource: IndependentVideoSource;
  scenes: CoordinationSceneSpec[];
  references: CoordinationReferenceItem[];
  musicDirective?: string;
}): CoordinationTaskRow[] {
  const now = Date.now();
  const sourceLabel = SOURCE_LABELS[params.videoSource];
  const allRefIds = params.references.map((r) => r.refId);
  const charRefIds = params.references.filter((r) => r.kind === 'character').map((r) => r.refId);
  const bibleRefIds = params.references.filter((r) => r.kind !== 'character').map((r) => r.refId);

  const tasks: CoordinationTaskRow[] = [];

  // Step 1: Scene keyframe images (starts immediately — reference package is already saved on session creation, no cross-check gate)
  for (const sc of params.scenes) {
    const code = `T01-IMG-S${String(sc.sceneIndex).padStart(2, '0')}`;
    tasks.push({
      taskCode: code,
      sessionId: params.sessionId,
      step: 1,
      stepLabel: 'Tạo ảnh phân cảnh',
      sceneIndex: sc.sceneIndex,
      sceneId: sc.sceneId,
      title: `Ảnh phân cảnh #${sc.sceneIndex}: ${sc.title}`,
      instructions: sc.imagePrompt || sc.actionDetail || sc.title,
      videoSourceLock: params.videoSource,
      assignedAiLabel:
        params.videoSource === 'google_flow'
          ? 'Google Flow · Chuẩn bị khung hình'
          : `${sourceLabel} · Ảnh`,
      dependsOnTaskCodes: [],
      inputRefIds: [...charRefIds, ...bibleRefIds],
      inputDriveLinks: [],
      status: 'CHO_NHAN',
      retryCount: 0,
      updatedAt: now,
    });
  }

  // Step 2: Scene videos (each uses its own Step 1 scene image directly)
  const videoTaskCodes: string[] = [];
  for (const sc of params.scenes) {
    const imgCode = `T01-IMG-S${String(sc.sceneIndex).padStart(2, '0')}`;
    const vidCode = `T02-VID-S${String(sc.sceneIndex).padStart(2, '0')}`;
    videoTaskCodes.push(vidCode);
    tasks.push({
      taskCode: vidCode,
      sessionId: params.sessionId,
      step: 2,
      stepLabel: 'Tạo video phân cảnh',
      sceneIndex: sc.sceneIndex,
      sceneId: sc.sceneId,
      title: `Video phân cảnh #${sc.sceneIndex} (${sc.durationSec}s): ${sc.title}`,
      instructions: [
        sc.videoPrompt || sc.videoTimeline || sc.actionDetail || sc.title,
        params.musicDirective || '',
      ]
        .filter(Boolean)
        .join(' | '),
      videoSourceLock: params.videoSource,
      assignedAiLabel: sourceLabel,
      dependsOnTaskCodes: [imgCode],
      inputRefIds: [...charRefIds, ...bibleRefIds],
      inputDriveLinks: [],
      status: 'CHO_NHAN',
      retryCount: 0,
      updatedAt: now,
    });
  }

  // Step 3: Direct FFmpeg Final Film Assembly (no cross-check / QA loop)
  tasks.push({
    taskCode: 'T03-FINAL',
    sessionId: params.sessionId,
    step: 3,
    stepLabel: 'Ghép phim MP4',
    title: `Ghép ${params.scenes.length} phân cảnh thành phim MP4 hoàn chỉnh`,
    instructions: `Ghép trực tiếp các clip ${videoTaskCodes.join(', ')} theo đúng thứ tự phân cảnh bằng FFmpeg và lưu bản hoàn chỉnh lên Google Drive + Sheets.`,
    videoSourceLock: params.videoSource,
    assignedAiLabel: 'FFmpeg Ghép Phim',
    dependsOnTaskCodes: videoTaskCodes,
    inputRefIds: ['REF-SCRIPT'],
    inputDriveLinks: [],
    status: 'CHO_NHAN',
    retryCount: 0,
    updatedAt: now,
  });

  return tasks;
}

export async function createSessionFromStudio(
  payload: {
    title?: string;
    ideaOrCommand?: string;
    videoSource?: IndependentVideoSource;
    aspectRatio?: DerivativeAspectRatio;
    videoStyle?: StudioVideoStyle;
    allowFreeCostumeChange?: boolean;
    visualBible?: string;
    settingBible?: string;
    costumeBible?: string;
    continuityBible?: string;
    characterRefs?: StudioCharacterRef[];
    blueprint?: any;
    sourceAction?: 'studio_dispatch' | 'manual_order';
    productionFormat?: 'dialogue_film' | 'narration_story';
    voiceConfig?: Partial<CoordinationVoiceConfig>;
    musicConfig?: {
      musicMode?: 'none' | 'auto_adaptive' | 'ai_lyria' | 'public_free' | 'uploaded';
      musicStyle?: string;
      musicPrompt?: string;
      musicVolume?: number;
      musicAssetId?: string;
      publicMusicUrl?: string;
      instrumentalOnly?: boolean;
    };
  },
  optionalGoogleToken?: string
): Promise<CoordinationSession> {
  const st = loadState();
  const now = Date.now();
  const d = new Date(now);
  const dateStamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const sessionId = `SES-${dateStamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  const rawSource = payload.videoSource;
  const videoSource: IndependentVideoSource =
    rawSource === 'qwen' || rawSource === 'muse' || rawSource === 'google_flow' || rawSource === 'gemini'
      ? rawSource
      : 'gemini';

  const title =
    String(payload.title || payload.blueprint?.derivativeTitle || '').trim().slice(0, 100) ||
    `Phiên sản xuất ${dateStamp}`;
  const aspectRatio: DerivativeAspectRatio = payload.aspectRatio === '9:16' ? '9:16' : '16:9';
  const videoStyle: StudioVideoStyle = payload.videoStyle || payload.blueprint?.videoStyle || 'cinematic';
  const allowFreeCostumeChange = Boolean(
    payload.allowFreeCostumeChange ?? payload.blueprint?.allowFreeCostumeChange
  );

  const visualBible = String(payload.visualBible || payload.blueprint?.visualStyleBible || '').trim();
  const settingBible = String(payload.settingBible || payload.blueprint?.settingBible || '').trim();
  const costumeBible = String(payload.costumeBible || payload.blueprint?.costumeBible || '').trim();
  const continuityBible = String(payload.continuityBible || payload.blueprint?.continuityBible || '').trim();
  const scriptSummary = String(
    payload.ideaOrCommand || payload.blueprint?.learnedSummary || title
  ).trim();

  // Build immutable scene list
  const rawScenes: any[] = Array.isArray(payload.blueprint?.scenes) ? payload.blueprint.scenes : [];
  const scenes: CoordinationSceneSpec[] =
    rawScenes.length > 0
      ? rawScenes.map((sc: any, idx: number) => ({
          sceneId: String(sc.id || `scene_${idx + 1}`),
          sceneIndex: Number(sc.sceneIndex || idx + 1),
          title: String(sc.title || `Phân cảnh ${idx + 1}`).trim(),
          durationSec: Math.max(3, Math.min(15, Math.round(Number(sc.durationSec || 8)))),
          narration: String(sc.narration || sc.voiceoverText || '').trim(),
          dialogue: String(sc.dialogue || '').trim(),
          charactersInScene: String(sc.charactersInScene || '').trim(),
          selectedCharacterIds: Array.isArray(sc.selectedCharacterIds) ? sc.selectedCharacterIds : undefined,
          settingDetail: String(sc.settingDetail || '').trim(),
          actionDetail: String(sc.actionDetail || sc.visualPrompt || '').trim(),
          costume: String(sc.costume || '').trim(),
          cameraAngle: String(sc.cameraAngle || '').trim(),
          cameraMovement: String(sc.cameraMovement || '').trim(),
          lighting: String(sc.lighting || '').trim(),
          vfxNotes: String(sc.vfxNotes || '').trim(),
          videoTimeline: String(sc.videoTimeline || sc.visualPrompt || '').trim(),
          imagePrompt: String(sc.imagePrompt || sc.visualPrompt || sc.actionDetail || sc.narration || sc.title || '').trim(),
          videoPrompt: String(sc.videoPrompt || sc.videoTimeline || sc.visualPrompt || sc.actionDetail || sc.title || '').trim(),
        }))
      : [
          {
            sceneId: 'scene_1',
            sceneIndex: 1,
            title: title,
            durationSec: 8,
            narration: scriptSummary,
            dialogue: '',
            charactersInScene: (payload.characterRefs || []).map((c) => c.name).filter(Boolean).join(', '),
            settingDetail: settingBible,
            actionDetail: scriptSummary,
            costume: costumeBible,
            cameraAngle: 'Medium shot',
            cameraMovement: 'Smooth cinematic tracking',
            lighting: 'Natural cinematic lighting',
            vfxNotes: '',
            videoTimeline: scriptSummary,
            imagePrompt: scriptSummary,
            videoPrompt: scriptSummary,
          },
        ];

  // Persist reference package to disk inside data/coordination_artifacts/<sessionId>/
  const references: CoordinationReferenceItem[] = [];

  const scriptPayload = {
    sessionId,
    title,
    videoSource,
    aspectRatio,
    videoStyle,
    scriptSummary,
    visualBible,
    settingBible,
    costumeBible,
    continuityBible,
    scenes,
  };
  const scriptSaved = saveBufferArtifact(
    sessionId,
    'script_reference.json',
    Buffer.from(JSON.stringify(scriptPayload, null, 2), 'utf8')
  );
  references.push({
    refId: 'REF-SCRIPT',
    sessionId,
    kind: 'script',
    name: `Kịch bản gốc (${scenes.length} phân cảnh)`,
    detail: scriptSummary.slice(0, 1200),
    localUrl: scriptSaved.localUrl,
    localFileName: scriptSaved.fileName,
    updatedAt: now,
  });

  if (visualBible) {
    references.push({
      refId: 'REF-VISUAL',
      sessionId,
      kind: 'visual_bible',
      name: 'Hồ sơ Hình ảnh (Visual Bible)',
      detail: visualBible,
      updatedAt: now,
    });
  }
  if (settingBible) {
    references.push({
      refId: 'REF-SETTING',
      sessionId,
      kind: 'setting_bible',
      name: 'Hồ sơ Bối cảnh (Setting Bible)',
      detail: settingBible,
      updatedAt: now,
    });
  }
  if (costumeBible) {
    references.push({
      refId: 'REF-COSTUME',
      sessionId,
      kind: 'costume_bible',
      name: 'Hồ sơ Trang phục (Costume Bible)',
      detail: costumeBible,
      updatedAt: now,
    });
  }
  if (continuityBible) {
    references.push({
      refId: 'REF-CONTINUITY',
      sessionId,
      kind: 'continuity_bible',
      name: 'Hồ sơ Liên kết (Continuity Bible)',
      detail: continuityBible,
      updatedAt: now,
    });
  }

  const charRefs = Array.isArray(payload.characterRefs) ? payload.characterRefs.slice(0, 8) : [];
  for (let i = 0; i < charRefs.length; i += 1) {
    const ch = charRefs[i];
    const refId = `REF-CHAR-${String(i + 1).padStart(2, '0')}`;
    const rawImg = ch.dataUrl || (ch as any).imageDataUrl || '';
    const savedImg = rawImg ? saveBase64ImageArtifact(sessionId, `${refId}_${ch.name || 'char'}`, rawImg) : null;
    const sp = ch.syncProfile;
    const detailParts = [
      ch.description ? `Mô tả: ${ch.description}` : '',
      sp?.face ? `Mặt: ${sp.face}` : '',
      sp?.physique ? `Dáng: ${sp.physique}` : '',
      sp?.costume ? `Trang phục: ${sp.costume}` : '',
      sp?.voice ? `Giọng: ${sp.voice}` : '',
      sp?.distinguishingMarks ? `Nhận dạng: ${sp.distinguishingMarks}` : '',
    ].filter(Boolean);

    references.push({
      refId,
      sessionId,
      kind: 'character',
      name: ch.name || `Nhân vật #${i + 1}`,
      detail: detailParts.join(' | ') || `Nhân vật tham chiếu #${i + 1}`,
      characterId: ch.id,
      syncProfile: ch.syncProfile,
      localUrl: savedImg?.localUrl,
      localFileName: savedImg?.fileName,
      updatedAt: now,
    });
  }

  const rawMusic = payload.musicConfig;
  const normalizedMusicMode =
    rawMusic?.musicMode === 'auto_adaptive' ||
    rawMusic?.musicMode === 'ai_lyria' ||
    rawMusic?.musicMode === 'public_free' ||
    rawMusic?.musicMode === 'uploaded'
      ? rawMusic.musicMode
      : 'none';
  const normalizedMusicVolume = Math.max(
    0,
    Math.min(0.9, Number(rawMusic?.musicVolume ?? 0.25))
  );
  const musicDirective = buildVideoMusicPromptDirective({
    musicMode: normalizedMusicMode,
    musicStyle: rawMusic?.musicStyle || 'auto_context',
    musicPrompt: String(rawMusic?.musicPrompt || '').trim(),
    musicVolume: normalizedMusicVolume,
    instrumentalOnly: rawMusic?.instrumentalOnly !== false,
  });

  const tasks = buildTasksForSession({
    sessionId,
    videoSource,
    scenes,
    references,
    musicDirective,
  });

  const rawVoice = payload.voiceConfig;
  const resolvedEnableVoiceover =
    rawVoice?.enableVoiceover !== undefined
      ? Boolean(rawVoice.enableVoiceover)
      : payload.blueprint?.enableVoiceover !== false;
  const resolvedVoiceMode: CoordinationVoiceConfig['voiceMode'] = !resolvedEnableVoiceover
    ? 'none'
    : rawVoice?.voiceMode === 'offline_system'
      ? 'offline_system'
      : rawVoice?.voiceMode === 'none'
        ? 'none'
        : 'ai_online';
  const resolvedProductionFormat: 'dialogue_film' | 'narration_story' =
    rawVoice?.productionFormat === 'narration_story' ||
    payload.productionFormat === 'narration_story' ||
    payload.blueprint?.productionFormat === 'narration_story'
      ? 'narration_story'
      : 'dialogue_film';

  const session: CoordinationSession = {
    sessionId,
    title,
    createdAt: now,
    updatedAt: now,
    sourceAction: payload.sourceAction || 'studio_dispatch',
    videoSource,
    aspectRatio,
    videoStyle,
    allowFreeCostumeChange,
    status: 'CHO_CHAY',
    scriptSummary,
    visualBible,
    settingBible,
    costumeBible,
    continuityBible,
    scenes,
    references,
    tasks,
    voiceConfig: {
      enableVoiceover: resolvedVoiceMode !== 'none',
      voiceMode: resolvedVoiceMode,
      voice: rawVoice?.voice || 'Kore',
      voiceStyle: String(rawVoice?.voiceStyle || '').trim() || undefined,
      offlineVoice: String(rawVoice?.offlineVoice || '').trim() || undefined,
      productionFormat: resolvedProductionFormat,
    },
    musicConfig:
      normalizedMusicMode !== 'none'
        ? {
            musicMode: normalizedMusicMode,
            musicStyle: rawMusic?.musicStyle || 'auto_context',
            musicPrompt: String(rawMusic?.musicPrompt || '').trim(),
            musicVolume: normalizedMusicVolume,
            musicAssetId: rawMusic?.musicAssetId || undefined,
            publicMusicUrl: rawMusic?.publicMusicUrl || undefined,
            instrumentalOnly: rawMusic?.instrumentalOnly !== false,
          }
        : undefined,
  };

  st.sessions = [session, ...st.sessions].slice(0, 40);
  st.activeSessionId = sessionId;
  saveState(true);

  pushMeetingMessage({
    sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Tiếp nhận lệnh từ Studio',
    kind: 'report',
    content: `Đã lập phiên mới ${sessionId} ("${title}") gồm ${scenes.length} phân cảnh, ${charRefs.length} ảnh nhân vật tham chiếu và ${tasks.length} tác vụ tuần tự. Nguồn video khóa độc lập: ${SOURCE_LABELS[videoSource]}.`,
  });

  if (optionalGoogleToken && st.workspace.spreadsheetId) {
    try {
      await syncSessionToGoogleWorkspace({ token: optionalGoogleToken, sessionId });
    } catch (syncErr: any) {
      pushMeetingMessage({
        sessionId,
        senderId: 'workspace_sync',
        senderName: 'Sổ Google Sheets & Drive',
        senderRole: 'Cảnh báo đồng bộ',
        kind: 'error',
        content: `Chưa thể tự đồng bộ phiên ${sessionId} lên Google Sheets ngay lúc này (${syncErr?.message || 'lỗi kết nối'}). Bạn có thể bấm "Đồng bộ Google Sheets & Drive" sau khi đăng nhập Google.`,
      });
    }
  }

  return session;
}

export function selectCoordinationSession(sessionId: string): CoordinationCenterState {
  const st = loadState();
  if (st.sessions.some((s) => s.sessionId === sessionId)) {
    st.activeSessionId = sessionId;
    saveState(true);
  }
  return st;
}

export function updateSessionVideoSource(
  sessionId: string,
  videoSource: IndependentVideoSource
): CoordinationSession {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === sessionId);
  if (!session) throw new Error('Không tìm thấy phiên làm việc.');
  if (activeSessionRunners.has(sessionId) || session.tasks.some((t) => t.status === 'DANG_LAM')) {
    throw new Error('Phiên đang chạy. Hãy tạm dừng trước khi đổi nguồn sáng tạo video độc lập.');
  }
  session.videoSource = videoSource;
  const sourceLabel = SOURCE_LABELS[videoSource];
  for (const t of session.tasks) {
    if (t.status !== 'HOAN_THANH') {
      t.videoSourceLock = videoSource;
      if (t.taskCode.includes('-IMG-')) {
        t.assignedAiLabel =
          videoSource === 'google_flow'
            ? 'Google Flow · Chuẩn bị khung hình'
            : `${sourceLabel} · Ảnh`;
      } else if (t.taskCode.includes('-VID-')) {
        t.assignedAiLabel = sourceLabel;
      }
      t.updatedAt = Date.now();
    }
  }
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Khóa nguồn độc lập',
    kind: 'report',
    content: `Đã khóa nguồn sáng tạo video độc lập cho phiên ${sessionId} sang: ${sourceLabel}. Chỉ duy nhất nguồn này thực thi các tác vụ chưa hoàn thành — các ảnh Bước 1 đã hoàn thành được giữ nguyên làm mốc cố định.`,
  });

  return session;
}

export function bulkUpdateSessionVideoSource(params: {
  sessionIds: string[];
  videoSource: IndependentVideoSource;
  resetFailedTasks?: boolean;
}): {
  updatedSessionIds: string[];
  skippedRunningSessionIds: string[];
  preservedDoneTasksTotal: number;
} {
  const st = loadState();
  const sourceLabel = SOURCE_LABELS[params.videoSource];
  const updatedSessionIds: string[] = [];
  const skippedRunningSessionIds: string[] = [];
  let preservedDoneTasksTotal = 0;

  const uniqueIds = Array.from(new Set((params.sessionIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  for (const sid of uniqueIds) {
    const session = st.sessions.find((s) => s.sessionId === sid);
    if (!session) continue;
    if (activeSessionRunners.has(sid) || session.tasks.some((t) => t.status === 'DANG_LAM')) {
      skippedRunningSessionIds.push(sid);
      continue;
    }
    session.videoSource = params.videoSource;
    for (const t of session.tasks) {
      if (t.status === 'HOAN_THANH') {
        preservedDoneTasksTotal += 1;
        continue;
      }
      t.videoSourceLock = params.videoSource;
      if (t.taskCode.includes('-IMG-')) {
        t.assignedAiLabel =
          params.videoSource === 'google_flow'
            ? 'Google Flow · Chuẩn bị khung hình'
            : `${sourceLabel} · Ảnh`;
      } else if (t.taskCode.includes('-VID-')) {
        t.assignedAiLabel = sourceLabel;
      }
      if (params.resetFailedTasks && t.status === 'LOI') {
        t.status = 'CHO_NHAN';
        t.errorReason = undefined;
      }
      t.updatedAt = Date.now();
    }
    if (params.resetFailedTasks) {
      session.lastError = undefined;
    }
    recomputeSessionStatus(session);
    session.updatedAt = Date.now();
    updatedSessionIds.push(sid);
  }

  if (updatedSessionIds.length > 0) {
    saveState(true);
    pushMeetingMessage({
      sessionId: updatedSessionIds.length === 1 ? updatedSessionIds[0] : 'GLOBAL',
      senderId: 'coordinator',
      senderName: 'Trung Tâm Điều Phối AI',
      senderRole: 'Chuyển nguồn hàng loạt',
      kind: 'report',
      content: `Đã chuyển nguồn độc lập sang ${sourceLabel} cho ${updatedSessionIds.length} phiên (${updatedSessionIds.join(', ')}). Giữ nguyên ${preservedDoneTasksTotal} bước đã hoàn thành làm mốc cố định.${skippedRunningSessionIds.length > 0 ? ` Bỏ qua ${skippedRunningSessionIds.length} phiên đang chạy.` : ''}`,
    });
  }

  return { updatedSessionIds, skippedRunningSessionIds, preservedDoneTasksTotal };
}

export function deleteCoordinationSession(sessionId: string): CoordinationCenterState {
  const st = loadState();
  if (activeSessionRunners.has(sessionId)) {
    throw new Error('Phiên đang chạy. Hãy tạm dừng trước khi xóa.');
  }
  st.sessions = st.sessions.filter((s) => s.sessionId !== sessionId);
  st.meetingMessages = st.meetingMessages.filter((m) => m.sessionId !== sessionId);
  if (st.activeSessionId === sessionId) {
    st.activeSessionId = st.sessions[0]?.sessionId || null;
  }
  try {
    const dir = path.resolve(ARTIFACTS_ROOT, sanitizeIdSegment(sessionId, '__none__'));
    if (dir.startsWith(ARTIFACTS_ROOT + path.sep) && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup errors
  }
  saveState(true);
  return st;
}

// ==========================================
// 4. SEQUENTIAL, REFERENCE-LOCKED EXECUTION
// ==========================================

function loadSessionCharacterRefs(session: CoordinationSession): StudioCharacterRefInput[] {
  const out: StudioCharacterRefInput[] = [];
  for (const ref of session.references) {
    if (ref.kind !== 'character') continue;
    const dataUrl = readLocalFileAsDataUrl(session.sessionId, ref.localFileName);
    if (!dataUrl) continue;
    out.push({
      id: ref.characterId || ref.refId,
      name: ref.name,
      dataUrl,
      description: ref.detail,
      syncProfile: ref.syncProfile,
    });
  }
  return out;
}

function buildGoogleFlowPrompt(session: CoordinationSession, scene: CoordinationSceneSpec, refSummary: string): string {
  const musicLine = session.musicConfig
    ? buildVideoMusicPromptDirective({
        musicMode: session.musicConfig.musicMode,
        musicStyle: session.musicConfig.musicStyle,
        musicPrompt: session.musicConfig.musicPrompt,
        musicVolume: session.musicConfig.musicVolume,
        instrumentalOnly: session.musicConfig.instrumentalOnly,
      })
    : '';
  return [
    `[PHIÊN ${session.sessionId} · CẢNH ${scene.sceneIndex}/${session.scenes.length} · ${scene.durationSec}s · ${session.aspectRatio}]`,
    `Tiêu đề cảnh: ${scene.title}`,
    scene.charactersInScene ? `Nhân vật: ${scene.charactersInScene}` : '',
    refSummary ? `Tham chiếu nhân vật & bối cảnh: ${refSummary}` : '',
    scene.settingDetail ? `Bối cảnh: ${scene.settingDetail}` : '',
    scene.costume ? `Trang phục khóa: ${scene.costume}` : '',
    scene.actionDetail ? `Diễn biến hành động: ${scene.actionDetail}` : '',
    scene.videoTimeline ? `Timeline từng giây:\n${scene.videoTimeline}` : '',
    scene.dialogue ? `Lời thoại: ${scene.dialogue}` : '',
    musicLine,
    scene.cameraAngle || scene.cameraMovement
      ? `Góc máy & chuyển động: ${[scene.cameraAngle, scene.cameraMovement].filter(Boolean).join(' · ')}`
      : '',
    scene.lighting ? `Ánh sáng: ${scene.lighting}` : '',
    'Không chèn chữ hiển thị trên màn hình (Strictly NO on-screen text, no captions, no titles).',
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveSessionBgmPath(
  session: CoordinationSession,
  dir: string
): Promise<{ bgmPath: string; label: string; volume: number } | null> {
  const cfg = session.musicConfig;
  if (!cfg || cfg.musicMode === 'none') return null;
  const vol = Math.max(0, Math.min(0.9, Number(cfg.musicVolume ?? 0.25)));
  if (vol <= 0) return null;

  const stylePreset = cfg.musicStyle ? AI_MUSIC_STYLE_DIRECTIVES[cfg.musicStyle] : undefined;
  const styleLabel = stylePreset?.labelVi || (cfg.musicPrompt ? 'AI tùy chỉnh' : 'Nhạc nền AI');

  // For AI prompt-embedded music ('ai_lyria' / 'auto_adaptive'), the video AI server natively generates BGM from the prompt —
  // only mix external FFmpeg BGM when the user explicitly attached an uploaded audio file or public_free URL.
  if (cfg.musicMode === 'uploaded' && cfg.musicAssetId) {
    const rec = getStudioAsset(cfg.musicAssetId);
    if (rec && fs.existsSync(rec.filePath)) {
      return { bgmPath: rec.filePath, label: 'Nhạc tải lên', volume: vol };
    }
  } else if (cfg.musicMode === 'public_free' && cfg.publicMusicUrl) {
    try {
      const dl = await fetch(cfg.publicMusicUrl, { signal: AbortSignal.timeout(25_000) });
      if (dl.ok) {
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.byteLength > 10_000) {
          const out = path.resolve(dir, 'session_bgm.audio');
          fs.writeFileSync(out, buf);
          return { bgmPath: out, label: styleLabel, volume: vol };
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extractSpokenTextForCoordinationScene(
  scene: CoordinationSceneSpec | undefined,
  productionFormat: 'dialogue_film' | 'narration_story'
): string {
  if (!scene) return '';
  const narration = String(scene.narration || '').trim();
  const dialogue = String(scene.dialogue || '').trim();
  const stripSpeakerLabels = (txt: string) =>
    txt
      .split(/\n+/)
      .map((line) => line.replace(/^[^:：]{1,36}[:：]\s*/, '').trim())
      .filter(Boolean)
      .join('. ');

  if (productionFormat === 'narration_story') {
    return narration || stripSpeakerLabels(dialogue);
  }
  const cleanDialogue = stripSpeakerLabels(dialogue);
  if (narration && cleanDialogue) {
    const nNorm = narration.toLowerCase().replace(/\s+/g, ' ');
    const dNorm = cleanDialogue.toLowerCase().replace(/\s+/g, ' ');
    if (nNorm === dNorm || nNorm.includes(dNorm)) return narration;
    if (dNorm.includes(nNorm)) return cleanDialogue;
    return `${narration}. ${cleanDialogue}`;
  }
  return narration || cleanDialogue;
}

async function probeMediaDurationSec(filePath: string): Promise<number> {
  try {
    const probe = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 10_000 }
    );
    const val = Number(String(probe.stdout || '').trim());
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

async function assembleFinalFilmWithFfmpeg(
  session: CoordinationSession,
  clipEntries: { clipPath: string; scene?: CoordinationSceneSpec; sceneIndex: number }[]
): Promise<{
  fileName: string;
  localUrl: string;
  bgmSummary?: string;
  voiceSummary?: string;
  voiceWarnings?: string[];
}> {
  const dir = getSessionArtifactDir(session.sessionId);
  const outFileName = `final_${sanitizeIdSegment(session.sessionId, 'film')}.mp4`;
  const outPath = path.resolve(dir, outFileName);
  if (!outPath.startsWith(ARTIFACTS_ROOT + path.sep)) {
    throw new Error('Đường dẫn xuất phim không hợp lệ.');
  }

  const bgm = await resolveSessionBgmPath(session, dir).catch(() => null);

  // Synthesize Vietnamese script narration / dialogue voiceover per scene (enabled by default unless explicitly muted)
  const voiceCfg = session.voiceConfig;
  const voiceEnabled =
    voiceCfg?.enableVoiceover !== false && voiceCfg?.voiceMode !== 'none';
  const voiceMode: 'ai_online' | 'offline_system' =
    voiceCfg?.voiceMode === 'offline_system' ? 'offline_system' : 'ai_online';
  const productionFormat: 'dialogue_film' | 'narration_story' =
    voiceCfg?.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';

  const sceneVoicePaths: (string | null)[] = new Array(clipEntries.length).fill(null);
  const sceneVoiceDurations: number[] = new Array(clipEntries.length).fill(0);
  const voiceWarnings: string[] = [];
  let spokenScenesTotal = 0;
  let voicedScenesCount = 0;

  if (voiceEnabled) {
    for (let i = 0; i < clipEntries.length; i += 1) {
      const entry = clipEntries[i];
      const spokenText = extractSpokenTextForCoordinationScene(entry.scene, productionFormat);
      if (!spokenText) continue;
      spokenScenesTotal += 1;
      const voiceWavPath = path.resolve(
        dir,
        `voice_scene_${String(entry.sceneIndex).padStart(2, '0')}.wav`
      );
      if (!voiceWavPath.startsWith(ARTIFACTS_ROOT + path.sep)) continue;

      const ttsRes = await synthesizeNarrationAudioForText({
        text: spokenText,
        outWavPath: voiceWavPath,
        mode: voiceMode,
        voice: voiceCfg?.voice || 'Kore',
        voiceStyle: voiceCfg?.voiceStyle,
        offlineVoice: voiceCfg?.offlineVoice,
      });
      if (ttsRes.ok && fs.existsSync(voiceWavPath) && fs.statSync(voiceWavPath).size > 44) {
        sceneVoicePaths[i] = voiceWavPath;
        sceneVoiceDurations[i] = await probeMediaDurationSec(voiceWavPath);
        voicedScenesCount += 1;
      } else {
        voiceWarnings.push(
          `Cảnh #${entry.sceneIndex}: Chưa tạo được giọng đọc thuyết minh${ttsRes.error ? ` (${ttsRes.error.slice(0, 140)})` : ''}.`
        );
      }
    }
  }

  const anyVoiceSynthesized = voicedScenesCount > 0;
  const voiceSummary =
    voicedScenesCount > 0
      ? `lồng tiếng thuyết minh ${voicedScenesCount}/${spokenScenesTotal} phân cảnh`
      : spokenScenesTotal > 0 && voiceEnabled
        ? `chưa tạo được giọng đọc (0/${spokenScenesTotal} cảnh)`
        : undefined;

  if (clipEntries.length === 1 && !bgm && !anyVoiceSynthesized) {
    fs.copyFileSync(clipEntries[0].clipPath, outPath);
    return {
      fileName: outFileName,
      localUrl: artifactUrlFor(session.sessionId, outFileName),
      voiceSummary,
      voiceWarnings: voiceWarnings.length > 0 ? voiceWarnings : undefined,
    };
  }

  const targetW = session.aspectRatio === '9:16' ? 720 : 1280;
  const targetH = session.aspectRatio === '9:16' ? 1280 : 720;
  const normalizedPaths: string[] = [];

  for (let i = 0; i < clipEntries.length; i += 1) {
    const entry = clipEntries[i];
    const normPath = path.resolve(dir, `norm_${String(i + 1).padStart(2, '0')}.mp4`);
    let clipHasAudio = false;
    try {
      const probe = await execFileAsync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', entry.clipPath],
        { timeout: 10_000 }
      );
      clipHasAudio = Boolean(String(probe.stdout || '').trim());
    } catch {
      clipHasAudio = false;
    }

    const voiceWavPath = sceneVoicePaths[i];
    const voiceDur = sceneVoiceDurations[i] || 0;
    const clipDur = await probeMediaDurationSec(entry.clipPath);
    const targetDur =
      voiceWavPath && voiceDur > 0.2
        ? Math.max(clipDur || 5, voiceDur + 0.35)
        : clipDur || 5;
    const needsPad = Boolean(voiceWavPath && clipDur > 0 && clipDur < targetDur - 0.15);
    const padFilter = needsPad
      ? `,tpad=stop_mode=clone:stop_duration=${(targetDur - clipDur + 0.35).toFixed(2)}`
      : '';
    const vFilter = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=24${padFilter},format=yuv420p[vout]`;

    if (voiceWavPath) {
      const audioFilter = clipHasAudio
        ? `[0:a]aresample=44100,apad,volume=0.18[aclip];[1:a]aresample=44100,apad,volume=1.35[avoice];[aclip][avoice]amix=inputs=2:duration=longest:dropout_transition=0.2:normalize=0[aout]`
        : `[1:a]aresample=44100,apad,volume=1.35[aout]`;

      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          entry.clipPath,
          '-i',
          voiceWavPath,
          '-filter_complex',
          `${vFilter};${audioFilter}`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          targetDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
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
          '-movflags',
          '+faststart',
          normPath,
        ],
        { timeout: 150_000 }
      );
    } else {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          entry.clipPath,
          '-f',
          'lavfi',
          '-t',
          '60',
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-vf',
          `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`,
          '-map',
          '0:v:0',
          '-map',
          clipHasAudio ? '0:a:0' : '1:a:0',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-shortest',
          '-movflags',
          '+faststart',
          normPath,
        ],
        { timeout: 120_000 }
      );
    }
    normalizedPaths.push(normPath);
  }

  const concatListPath = path.resolve(dir, 'concat_list.txt');
  fs.writeFileSync(
    concatListPath,
    normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8'
  );

  if (bgm) {
    const volPct = Math.round(bgm.volume * 100);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-stream_loop',
        '-1',
        '-i',
        bgm.bgmPath,
        '-filter_complex',
        `[0:a]aresample=44100[avoice];[1:a]aresample=44100,volume=${bgm.volume.toFixed(2)}[abgm];[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0.3:normalize=0[aout]`,
        '-map',
        '0:v',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '21',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { timeout: 240_000 }
    );
    return {
      fileName: outFileName,
      localUrl: artifactUrlFor(session.sessionId, outFileName),
      bgmSummary: `trộn nhạc nền (${bgm.label} · âm lượng ${volPct}%)`,
      voiceSummary,
      voiceWarnings: voiceWarnings.length > 0 ? voiceWarnings : undefined,
    };
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { timeout: 180_000 }
  );

  return {
    fileName: outFileName,
    localUrl: artifactUrlFor(session.sessionId, outFileName),
    voiceSummary,
    voiceWarnings: voiceWarnings.length > 0 ? voiceWarnings : undefined,
  };
}

export async function runSingleCoordinationTask(params: {
  sessionId: string;
  taskCode: string;
  googleToken?: string;
  assignedWorker?: ProviderAccountWorker;
}): Promise<CoordinationTaskRow> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error(`Không tìm thấy phiên ${params.sessionId}.`);

  const task = session.tasks.find((t) => t.taskCode === params.taskCode);
  if (!task) throw new Error(`Không tìm thấy tác vụ ${params.taskCode} trong phiên ${params.sessionId}.`);

  const lockKey = `${session.sessionId}:${task.taskCode}`;
  if (activeTaskLocks.has(lockKey)) {
    throw new Error(`Tác vụ ${task.taskCode} đang được thực thi — chặn trùng lặp nhiệm vụ.`);
  }

  // Strictly verify upstream dependencies
  const unmetDeps = task.dependsOnTaskCodes.filter((depCode) => {
    const dep = session.tasks.find((t) => t.taskCode === depCode);
    return !dep || dep.status !== 'HOAN_THANH';
  });
  if (unmetDeps.length > 0) {
    throw new Error(
      `Không thể chạy ${task.taskCode} vì tác vụ tiền đề chưa hoàn thành: ${unmetDeps.join(', ')}.`
    );
  }

  activeTaskLocks.add(lockKey);
  const previousStatus = task.status;
  task.status = 'DANG_LAM';
  task.startedAt = Date.now();
  task.errorReason = undefined;
  if (params.assignedWorker) {
    task.assignedAccountId = params.assignedWorker.accountId;
    task.assignedAccountLabel = params.assignedWorker.accountLabel;
  }
  if (previousStatus === 'LOI') {
    task.retryCount = (task.retryCount || 0) + 1;
  }
  task.updatedAt = Date.now();
  session.updatedAt = Date.now();
  recomputeSessionStatus(session);
  saveState(true);

  const workerTag = params.assignedWorker?.accountLabel
    ? ` · Tài khoản: ${params.assignedWorker.accountLabel}`
    : '';

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: task.videoSourceLock,
    senderName: task.assignedAiLabel,
    senderRole: `Bước ${task.step} · ${task.stepLabel}${workerTag}`,
    kind: 'claim',
    taskCode: task.taskCode,
    content: `[${task.taskCode}] Nhận nhiệm vụ từ bảng điều phối phiên ${session.sessionId}${workerTag} và nạp dữ liệu tham chiếu (${task.inputRefIds.join(', ') || 'không'}).`,
  });

  if (params.googleToken && st.workspace.spreadsheetId) {
    await syncSessionToGoogleWorkspace({
      token: params.googleToken,
      sessionId: session.sessionId,
      silentMeetingNote: true,
    }).catch(() => {});
  }

  try {
    const isRefTask = task.taskCode.endsWith('-REF');
    const isImgTask = task.taskCode.includes('-IMG-');
    const isVidTask = task.taskCode.includes('-VID-');
    const isFinalTask = task.taskCode.endsWith('-FINAL');

    // Legacy T01-REF compatibility (completes immediately without cross-check)
    if (isRefTask) {
      const charCount = session.references.filter((r) => r.kind === 'character').length;
      task.resultSummary = `Đã lưu sẵn ${session.references.length} mục tham chiếu (${charCount} nhân vật) cho phiên ${session.sessionId}.`;
      task.status = 'HOAN_THANH';
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    }

    // ── STEP 1: Generate Scene Keyframe Image (Strict Single-Source Isolation) ──
    else if (isImgTask) {
      const scene = session.scenes.find((s) => s.sceneId === task.sceneId || s.sceneIndex === task.sceneIndex);
      if (!scene) {
        throw new Error(`Không tìm thấy thông tin phân cảnh #${task.sceneIndex} trong hồ sơ phiên ${session.sessionId}.`);
      }
      const charRefs = loadSessionCharacterRefs(session);

      if (task.videoSourceLock === 'google_flow') {
        const refSummary = session.references
          .filter((r) => r.kind === 'character')
          .map((r) => `${r.name}: ${r.detail}`)
          .join('; ');
        const flowImgPrompt = [
          `[CREATE SCENE KEYFRAME IMAGE · ${session.aspectRatio}]`,
          `Scene #${scene.sceneIndex}: ${scene.title}`,
          scene.imagePrompt || scene.actionDetail || scene.title,
          refSummary ? `Character visual lock: ${refSummary}` : '',
          scene.settingDetail ? `Setting: ${scene.settingDetail}` : '',
          scene.cameraAngle ? `Camera framing: ${scene.cameraAngle}` : '',
          'Photorealistic cinematic still frame, no on-screen text, no watermark.',
        ]
          .filter(Boolean)
          .join('\n');
        task.flowPrompt = flowImgPrompt;
        if (isFlowBridgeOnline()) {
          task.status = 'CHO_NHAP_FLOW';
          task.resultSummary = `Đã đưa Cảnh #${scene.sceneIndex} vào hàng đợi Flow Auto-Bridge để Chrome Extension tự động tạo Ảnh trên Google Flow (${charRefs.length} nhân vật tham chiếu).`;
          task.updatedAt = Date.now();
        } else {
          const promptSaved = saveBufferArtifact(
            session.sessionId,
            `${task.taskCode}_prompt.txt`,
            Buffer.from(flowImgPrompt, 'utf8')
          );
          task.localOutputFileName = promptSaved.fileName;
          task.localOutputUrl = promptSaved.localUrl;
          task.status = 'CHO_NHAP_FLOW';
          task.resultSummary = `Đang chờ Flow Auto-Bridge (Chrome Extension) tự tạo Ảnh Cảnh #${scene.sceneIndex} — hoặc tải ảnh lên thủ công ngay tại đây.`;
          task.updatedAt = Date.now();
        }
      } else {
        const engineMap: Record<Exclude<IndependentVideoSource, 'google_flow'>, 'gemini' | 'qwen' | 'muse2api'> = {
          gemini: 'gemini',
          qwen: 'qwen',
          muse: 'muse2api',
        };
        const lockedEngine = engineMap[task.videoSourceLock];
        const geminiWorker =
          lockedEngine === 'gemini'
            ? params.assignedWorker?.apiKey
              ? {
                  id: params.assignedWorker.accountId,
                  label: params.assignedWorker.accountLabel,
                  apiKey: params.assignedWorker.apiKey,
                }
              : pickWorkerGeminiAccount()
            : null;
        const museAccountId =
          lockedEngine === 'muse2api' ? params.assignedWorker?.museAccountId : undefined;
        const activeAccLabel =
          params.assignedWorker?.accountLabel || geminiWorker?.label || undefined;
        if (geminiWorker && !task.assignedAccountLabel) {
          task.assignedAccountId = geminiWorker.id;
          task.assignedAccountLabel = geminiWorker.label;
        }

        const tStart = Date.now();
        let imgRes: Awaited<ReturnType<typeof generateStudioImage>>;
        try {
          imgRes = await generateStudioImage({
            mode: 'scene',
            prompt: scene.imagePrompt || scene.actionDetail || scene.title,
            aspectRatio: session.aspectRatio,
            quality: 'standard',
            engine: lockedEngine,
            videoStyle: session.videoStyle,
            characterBible: session.references
              .filter((r) => r.kind === 'character')
              .map((r) => `${r.name}: ${r.detail}`)
              .join('\n'),
            settingBible: session.settingBible,
            visualStyleBible: session.visualBible,
            costumeBible: session.costumeBible,
            continuityBible: session.continuityBible,
            sceneIndex: scene.sceneIndex,
            totalScenes: session.scenes.length,
            sceneTitle: scene.title,
            charactersInScene: scene.charactersInScene,
            settingDetail: scene.settingDetail,
            actionDetail: scene.actionDetail,
            dialogue: scene.dialogue,
            sceneSummary: scene.narration || scene.actionDetail,
            costume: scene.costume,
            cameraAngle: scene.cameraAngle,
            vfxNotes: scene.vfxNotes,
            selectedCharacterIds: scene.selectedCharacterIds,
            characterRefs: charRefs,
            museAccountId,
            geminiApiKey: geminiWorker?.apiKey,
            allowFreeCostumeChange: session.allowFreeCostumeChange,
          });
          if (lockedEngine === 'gemini' && geminiWorker?.id) {
            recordGeminiAccountUsage(geminiWorker.id, true, { latencyMs: Date.now() - tStart });
          }
        } catch (imgErr: any) {
          if (lockedEngine === 'gemini' && geminiWorker?.id) {
            recordGeminiAccountUsage(geminiWorker.id, false, {
              latencyMs: Date.now() - tStart,
              errorMsg: String(imgErr?.message || imgErr || ''),
            });
          }
          throw imgErr;
        }

        const saved = saveBase64ImageArtifact(session.sessionId, `${task.taskCode}_keyframe`, imgRes.dataUrl);
        if (!saved) {
          throw new Error(`Engine ${lockedEngine} trả về định dạng ảnh không hợp lệ.`);
        }
        task.localOutputFileName = saved.fileName;
        task.localOutputUrl = saved.localUrl;
        task.resultSummary = `Đã tạo ảnh phân cảnh #${scene.sceneIndex} bằng ${imgRes.model}${
          activeAccLabel ? ` · TK: ${activeAccLabel}` : ''
        } (${charRefs.length} ảnh nhân vật).`;
        task.status = 'HOAN_THANH';
        task.completedAt = Date.now();
        task.updatedAt = Date.now();
      }
    }

    // ── STEP 2: Generate Scene Video (Strict Single-Source Isolation) ──
    else if (isVidTask) {
      const scene = session.scenes.find((s) => s.sceneId === task.sceneId || s.sceneIndex === task.sceneIndex);
      if (!scene) {
        throw new Error(`Không tìm thấy thông tin phân cảnh #${task.sceneIndex} trong hồ sơ phiên ${session.sessionId}.`);
      }
      const imgTask = session.tasks.find(
        (t) => t.taskCode.includes('-IMG-') && (t.sceneId === scene.sceneId || t.sceneIndex === scene.sceneIndex)
      );
      const charRefs = loadSessionCharacterRefs(session);

      if (task.videoSourceLock === 'google_flow') {
        const refSummary = session.references
          .filter((r) => r.kind === 'character')
          .map((r) => `${r.name}: ${r.detail}`)
          .join('; ');
        task.flowPrompt = buildGoogleFlowPrompt(session, scene, refSummary);
        task.status = 'CHO_NHAP_FLOW';
        task.resultSummary = isFlowBridgeOnline()
          ? `Đã đưa Video Cảnh #${scene.sceneIndex} vào hàng đợi Flow Auto-Bridge — Chrome Extension sẽ tự động tạo video Veo và gửi MP4 về App.`
          : `Đã sẵn sàng prompt Google Flow cho Cảnh #${scene.sceneIndex}. Bật Chrome Extension Flow Auto-Bridge để tự chạy hoặc tải tệp MP4 lên ngay tại dòng này.`;
        task.updatedAt = Date.now();
      } else {
        const keyframeDataUrl = readLocalFileAsDataUrl(session.sessionId, imgTask?.localOutputFileName);
        if (!keyframeDataUrl) {
          throw new Error(
            `Thiếu ảnh phân cảnh đầu vào (${imgTask?.taskCode || `Cảnh #${scene.sceneIndex}`}) trong phiên ${session.sessionId}. Hãy chạy bước tạo ảnh trước.`
          );
        }

        const engineMap: Record<Exclude<IndependentVideoSource, 'google_flow'>, 'gemini' | 'qwen' | 'muse2api'> = {
          gemini: 'gemini',
          qwen: 'qwen',
          muse: 'muse2api',
        };
        const lockedEngine = engineMap[task.videoSourceLock];
        const geminiWorker =
          lockedEngine === 'gemini'
            ? params.assignedWorker?.apiKey
              ? {
                  id: params.assignedWorker.accountId,
                  label: params.assignedWorker.accountLabel,
                  apiKey: params.assignedWorker.apiKey,
                }
              : pickWorkerGeminiAccount()
            : null;
        const museAccountId =
          lockedEngine === 'muse2api' ? params.assignedWorker?.museAccountId : undefined;
        const activeAccLabel =
          params.assignedWorker?.accountLabel || geminiWorker?.label || undefined;
        if (geminiWorker && !task.assignedAccountLabel) {
          task.assignedAccountId = geminiWorker.id;
          task.assignedAccountLabel = geminiWorker.label;
        }

        const tStart = Date.now();
        let vidRes: Awaited<ReturnType<typeof generateSceneVideoWithOmniFlash>>;
        try {
          vidRes = await generateSceneVideoWithOmniFlash({
            prompt: scene.videoPrompt || scene.actionDetail || scene.title,
            aspectRatio: session.aspectRatio,
            durationSec: scene.durationSec,
            engine: lockedEngine,
            videoStyle: session.videoStyle,
            characterBible: session.references
              .filter((r) => r.kind === 'character')
              .map((r) => `${r.name}: ${r.detail}`)
              .join('\n'),
            settingBible: session.settingBible,
            visualStyleBible: session.visualBible,
            costumeBible: session.costumeBible,
            continuityBible: session.continuityBible,
            sceneIndex: scene.sceneIndex,
            totalScenes: session.scenes.length,
            sceneTitle: scene.title,
            settingDetail: scene.settingDetail,
            cameraMovement: scene.cameraMovement,
            charactersInScene: scene.charactersInScene,
            actionDetail: scene.actionDetail,
            dialogue: scene.dialogue,
            narration: scene.narration,
            videoTimeline: scene.videoTimeline,
            sceneSummary: scene.narration || scene.actionDetail,
            costume: scene.costume,
            cameraAngle: scene.cameraAngle,
            vfxNotes: scene.vfxNotes,
            selectedCharacterIds: scene.selectedCharacterIds,
            sceneImageDataUrl: keyframeDataUrl,
            characterRefs: charRefs,
            museAccountId,
            geminiApiKey: geminiWorker?.apiKey,
            allowFreeCostumeChange: session.allowFreeCostumeChange,
            strictSingleFrameLock: true,
            musicMode: session.musicConfig?.musicMode,
            musicStyle: session.musicConfig?.musicStyle,
            musicPrompt: session.musicConfig?.musicPrompt,
            musicVolume: session.musicConfig?.musicVolume,
            musicInstrumentalOnly: session.musicConfig?.instrumentalOnly,
          });
          if (lockedEngine === 'gemini' && geminiWorker?.id) {
            recordGeminiAccountUsage(geminiWorker.id, true, { latencyMs: Date.now() - tStart });
          }
        } catch (vidErr: any) {
          if (lockedEngine === 'gemini' && geminiWorker?.id) {
            recordGeminiAccountUsage(geminiWorker.id, false, {
              latencyMs: Date.now() - tStart,
              errorMsg: String(vidErr?.message || vidErr || ''),
            });
          }
          throw vidErr;
        }

        const studioAsset = getStudioAsset(vidRes.assetId);
        if (!studioAsset || !fs.existsSync(studioAsset.filePath)) {
          throw new Error(`Không tìm thấy tệp video kết quả (${vidRes.assetId}) trên đĩa sau khi tạo.`);
        }
        const savedVid = saveBufferArtifact(
          session.sessionId,
          `${task.taskCode}_scene${String(scene.sceneIndex).padStart(2, '0')}.mp4`,
          fs.readFileSync(studioAsset.filePath)
        );
        task.localOutputFileName = savedVid.fileName;
        task.localOutputUrl = savedVid.localUrl;
        task.resultSummary = `Đã tạo xong video Cảnh #${scene.sceneIndex} (${vidRes.durationSec}s) bằng ${vidRes.model}${
          activeAccLabel ? ` · TK: ${activeAccLabel}` : ''
        } từ ${imgTask?.taskCode || 'ảnh phân cảnh'}.`;
        task.status = 'HOAN_THANH';
        task.completedAt = Date.now();
        task.updatedAt = Date.now();
      }
    }

    // ── STEP 3: Direct Final Film Assembly + Script Narration Voiceover ──
    else if (isFinalTask) {
      const videoTasks = session.tasks
        .filter((t) => t.taskCode.includes('-VID-'))
        .sort((a, b) => (a.sceneIndex || 0) - (b.sceneIndex || 0));
      const clipEntries: { clipPath: string; scene?: CoordinationSceneSpec; sceneIndex: number }[] = [];
      for (const vt of videoTasks) {
        if (vt.status !== 'HOAN_THANH' || !vt.localOutputFileName) continue;
        const fp = resolveCoordinationArtifactPath(session.sessionId, vt.localOutputFileName);
        if (!fp) continue;
        const matchedScene =
          session.scenes.find((s) => s.sceneIndex === vt.sceneIndex || (vt.sceneId && s.sceneId === vt.sceneId)) ||
          session.scenes[clipEntries.length];
        clipEntries.push({
          clipPath: fp,
          scene: matchedScene,
          sceneIndex: vt.sceneIndex || matchedScene?.sceneIndex || clipEntries.length + 1,
        });
      }
      if (clipEntries.length === 0) {
        throw new Error('Chưa có clip phân cảnh nào hoàn thành để ghép phim MP4.');
      }
      const assembled = await assembleFinalFilmWithFfmpeg(session, clipEntries);
      task.localOutputFileName = assembled.fileName;
      task.localOutputUrl = assembled.localUrl;
      session.finalVideoLocalUrl = assembled.localUrl;
      const summaryParts = [assembled.voiceSummary, assembled.bgmSummary].filter(Boolean);
      task.resultSummary = summaryParts.length > 0
        ? `Đã ghép ${clipEntries.length} clip (${summaryParts.join(' · ')}) thành phim MP4 hoàn chỉnh.`
        : `Đã ghép trực tiếp ${clipEntries.length} clip thành phim MP4 hoàn chỉnh.`;
      if (assembled.voiceWarnings && assembled.voiceWarnings.length > 0) {
        pushMeetingMessage({
          sessionId: session.sessionId,
          senderId: 'coordinator',
          senderName: 'Lồng tiếng Thuyết minh',
          senderRole: 'Cảnh báo giọng đọc',
          kind: 'report',
          taskCode: task.taskCode,
          content: assembled.voiceWarnings.join(' | '),
        });
      }
      task.status = 'HOAN_THANH';
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
    }

    recomputeSessionStatus(session);
    session.updatedAt = Date.now();
    saveState(true);

    // Sync result & upload artifact to Google Sheets / Drive if signed in
    if (params.googleToken && st.workspace.spreadsheetId) {
      await syncSessionToGoogleWorkspace({
        token: params.googleToken,
        sessionId: session.sessionId,
        silentMeetingNote: true,
      }).catch(() => {});
    }

    pushMeetingMessage({
      sessionId: session.sessionId,
      senderId: task.videoSourceLock,
      senderName: task.assignedAiLabel,
      senderRole: `Bước ${task.step} · ${task.stepLabel}`,
      kind: task.status === 'CHO_NHAP_FLOW' ? 'report' : 'completed',
      taskCode: task.taskCode,
      content: `[${task.taskCode}] ${task.resultSummary || 'Hoàn thành nhiệm vụ.'}`,
      referenceLink: task.driveOutputUrl || task.localOutputUrl,
    });

    return task;
  } catch (err: any) {
    const reason = String(err?.message || 'Lỗi không xác định khi thực thi tác vụ.');
    task.status = 'LOI';
    task.errorReason = reason;
    task.updatedAt = Date.now();
    session.lastError = `[${task.taskCode}] ${reason}`;
    recomputeSessionStatus(session);
    session.updatedAt = Date.now();
    saveState(true);

    pushMeetingMessage({
      sessionId: session.sessionId,
      senderId: task.videoSourceLock,
      senderName: task.assignedAiLabel,
      senderRole: `Bước ${task.step} · Báo lỗi`,
      kind: 'error',
      taskCode: task.taskCode,
      content: `[${task.taskCode}] Thực thi thất bại — Đã ghi rõ lý do vào Sổ Điều Phối: ${reason}`,
    });

    if (params.googleToken && st.workspace.spreadsheetId) {
      await syncSessionToGoogleWorkspace({
        token: params.googleToken,
        sessionId: session.sessionId,
        silentMeetingNote: true,
      }).catch(() => {});
    }

    return task;
  } finally {
    activeTaskLocks.delete(lockKey);
  }
}

export async function startSessionSequentialRun(params: {
  sessionId: string;
  googleToken?: string;
  retryErrors?: boolean;
}): Promise<CoordinationSession> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error(`Không tìm thấy phiên ${params.sessionId}.`);

  if (activeSessionRunners.has(session.sessionId)) {
    return session;
  }

  pauseRequestedSessions.delete(session.sessionId);
  if (params.retryErrors) {
    for (const t of session.tasks) {
      if (t.status === 'LOI') {
        t.status = 'CHO_NHAN';
        t.errorReason = undefined;
        t.updatedAt = Date.now();
      }
    }
  }

  const hasRunnableOrQueued = session.tasks.some((t) => t.status === 'CHO_NHAN');
  if (!hasRunnableOrQueued) {
    recomputeSessionStatus(session);
    saveState(true);
    return session;
  }

  const readyWorkers = await resolveReadyWorkersForSource(session.videoSource);
  const sortedScenes = [...session.scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);

  interface ScenePipelineJob {
    sceneIndex: number;
    imgTask?: CoordinationTaskRow;
    vidTask?: CoordinationTaskRow;
    source: IndependentVideoSource;
  }

  const pendingPipelines: ScenePipelineJob[] = [];
  for (const sc of sortedScenes) {
    const imgTask = session.tasks.find(
      (t) => t.taskCode.includes('-IMG-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
    );
    const vidTask = session.tasks.find(
      (t) => t.taskCode.includes('-VID-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
    );
    const needImg = Boolean(imgTask && imgTask.status === 'CHO_NHAN');
    const needVidNow = Boolean(
      vidTask &&
        vidTask.status === 'CHO_NHAN' &&
        (!imgTask || imgTask.status === 'HOAN_THANH' || imgTask.status === 'CHO_NHAN')
    );
    if (needImg || needVidNow) {
      pendingPipelines.push({
        sceneIndex: sc.sceneIndex,
        imgTask,
        vidTask,
        source: (needImg ? imgTask?.videoSourceLock : vidTask?.videoSourceLock) || session.videoSource,
      });
    }
  }

  const workerCount = Math.max(1, Math.min(Math.max(1, readyWorkers.length), Math.max(1, pendingPipelines.length)));
  const workerLabelsPreview = readyWorkers
    .slice(0, 6)
    .map((w) => w.accountLabel)
    .join(', ');
  session.parallelDispatchSummary =
    pendingPipelines.length > 0
      ? workerCount > 1
        ? `Điều phối đa tài khoản (${workerCount}/${readyWorkers.length} TK sẵn sàng) · Ảnh → Video ngay`
        : `Luồng trực tiếp (${readyWorkers[0]?.accountLabel || SOURCE_LABELS[session.videoSource]}) · Ảnh → Video ngay`
      : undefined;

  activeSessionRunners.add(session.sessionId);
  session.status = 'DANG_CHAY';
  session.lastError = undefined;
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: workerCount > 1 ? `Điều phối đa tài khoản (${workerCount} luồng)` : 'Khởi động luồng sản xuất',
    kind: 'report',
    content:
      workerCount > 1
        ? `Bắt đầu phiên ${session.sessionId} ("${session.title}") trên nguồn ${SOURCE_LABELS[session.videoSource]}. Phát hiện ${readyWorkers.length} tài khoản sẵn sàng (${workerLabelsPreview}) → mở ${workerCount} luồng SONG SONG cho ${pendingPipelines.length} phân cảnh: mỗi tài khoản tạo Ảnh xong sẽ chuyển sang tạo Video ngay lập tức (không chờ các cảnh khác).`
        : `Bắt đầu chạy luồng phiên ${session.sessionId} ("${session.title}") trên nguồn ${SOURCE_LABELS[session.videoSource]} (${workerLabelsPreview || '1 tài khoản'}): từng phân cảnh sẽ tạo Ảnh rồi chuyển sang tạo Video ngay lập tức.`,
  });

  // Execute scenes in PARALLEL across all ready accounts within the selected source.
  // Each leased account handles a complete scene pipeline (Step 1 Image -> immediately Step 2 Video),
  // then picks up the next pending scene without waiting for other scenes. Once all scenes finish, Step 3 FFmpeg runs.
  void (async () => {
    try {
      const isPaused = () => pauseRequestedSessions.has(session.sessionId);

      // Complete any legacy T01-REF task first
      for (const refTask of session.tasks.filter((t) => t.taskCode.endsWith('-REF') && t.status === 'CHO_NHAN')) {
        if (isPaused()) break;
        await runSingleCoordinationTask({
          sessionId: session.sessionId,
          taskCode: refTask.taskCode,
          googleToken: params.googleToken,
        });
      }

      // Atomic scene queue shared across concurrent per-account workers
      let nextSceneCursor = 0;

      const runScenePipelineWorker = async () => {
        while (!isPaused()) {
          const myIdx = nextSceneCursor;
          if (myIdx >= pendingPipelines.length) break;
          nextSceneCursor += 1;

          const item = pendingPipelines[myIdx];
          const primarySource = item.imgTask?.status === 'CHO_NHAN'
            ? item.imgTask.videoSourceLock
            : item.vidTask?.videoSourceLock || item.source;

          let deferredVidTask: CoordinationTaskRow | null = null;

          await withDedicatedAccountWorker(
            primarySource,
            async (worker) => {
              if (isPaused()) return;

              // Step 1: Scene Image
              if (item.imgTask && item.imgTask.status === 'CHO_NHAN') {
                await runSingleCoordinationTask({
                  sessionId: session.sessionId,
                  taskCode: item.imgTask.taskCode,
                  googleToken: params.googleToken,
                  assignedWorker: worker,
                });
              }

              if (isPaused()) return;

              // Step 2: IMMEDIATELY transition to Scene Video right after Image completes (zero wait for other scenes!)
              const imgReady = !item.imgTask || item.imgTask.status === 'HOAN_THANH';
              if (imgReady && item.vidTask && item.vidTask.status === 'CHO_NHAN') {
                if (item.vidTask.videoSourceLock === worker.source) {
                  await runSingleCoordinationTask({
                    sessionId: session.sessionId,
                    taskCode: item.vidTask.taskCode,
                    googleToken: params.googleToken,
                    assignedWorker: worker,
                  });
                } else {
                  deferredVidTask = item.vidTask;
                }
              }
            },
            isPaused
          );

          // If this scene's Video task was explicitly overridden to a different source than its Image, run it immediately on that source
          if (deferredVidTask && !isPaused()) {
            const vidTarget: CoordinationTaskRow = deferredVidTask;
            await withDedicatedAccountWorker(
              vidTarget.videoSourceLock,
              async (vidWorker) => {
                if (isPaused()) return;
                if (vidTarget.status === 'CHO_NHAN') {
                  await runSingleCoordinationTask({
                    sessionId: session.sessionId,
                    taskCode: vidTarget.taskCode,
                    googleToken: params.googleToken,
                    assignedWorker: vidWorker,
                  });
                }
              },
              isPaused
            );
          }
        }
      };

      if (pendingPipelines.length > 0 && !isPaused()) {
        await Promise.all(Array.from({ length: workerCount }, () => runScenePipelineWorker()));
      }

      // Step 3: Run any remaining runnable tasks (e.g., T03-FINAL FFmpeg assembly) once all scene videos are HOAN_THANH
      while (!isPaused()) {
        const nextTask = session.tasks.find((t) => {
          if (t.status !== 'CHO_NHAN') return false;
          return t.dependsOnTaskCodes.every((depCode) => {
            const dep = session.tasks.find((x) => x.taskCode === depCode);
            return dep?.status === 'HOAN_THANH';
          });
        });
        if (!nextTask) break;

        const isMediaGenStep =
          nextTask.taskCode.includes('-IMG-') || nextTask.taskCode.includes('-VID-');
        if (isMediaGenStep) {
          await withDedicatedAccountWorker(
            nextTask.videoSourceLock,
            async (worker) => {
              if (isPaused()) return;
              await runSingleCoordinationTask({
                sessionId: session.sessionId,
                taskCode: nextTask.taskCode,
                googleToken: params.googleToken,
                assignedWorker: worker,
              });
            },
            isPaused
          );
        } else {
          await runSingleCoordinationTask({
            sessionId: session.sessionId,
            taskCode: nextTask.taskCode,
            googleToken: params.googleToken,
          });
        }
      }
    } finally {
      activeSessionRunners.delete(session.sessionId);
      recomputeSessionStatus(session);
      session.updatedAt = Date.now();
      saveState(true);
    }
  })();

  return session;
}

export async function retryCoordinationTask(params: {
  sessionId: string;
  taskCode: string;
  overrideVideoSource?: IndependentVideoSource;
  autoContinueSession?: boolean;
  googleToken?: string;
}): Promise<{ session: CoordinationSession; task: CoordinationTaskRow }> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error(`Không tìm thấy phiên ${params.sessionId}.`);
  const task = session.tasks.find((t) => t.taskCode === params.taskCode);
  if (!task) throw new Error(`Không tìm thấy tác vụ ${params.taskCode}.`);
  if (activeSessionRunners.has(session.sessionId) || task.status === 'DANG_LAM') {
    throw new Error(`Phiên ${session.sessionId} đang chạy. Hãy tạm dừng trước khi đổi nguồn/chạy lại tác vụ.`);
  }

  // Verify upstream dependencies are still satisfied (e.g., Step 1 image is HOAN_THANH)
  for (const depCode of task.dependsOnTaskCodes) {
    const dep = session.tasks.find((t) => t.taskCode === depCode);
    if (!dep || dep.status !== 'HOAN_THANH') {
      throw new Error(`Tác vụ ${task.taskCode} cần hoàn thành tiền đề ${depCode} trước.`);
    }
  }

  const nextSource = params.overrideVideoSource || task.videoSourceLock;
  if (params.overrideVideoSource) {
    const sourceLabel = SOURCE_LABELS[nextSource];
    session.videoSource = nextSource;
    // Preserve ALL completed tasks (especially Step 1 images!) and only update unfinished tasks
    for (const t of session.tasks) {
      if (t.status !== 'HOAN_THANH' || t.taskCode === task.taskCode) {
        t.videoSourceLock = nextSource;
        if (t.taskCode.includes('-IMG-')) {
          t.assignedAiLabel =
            nextSource === 'google_flow' ? 'Google Flow · Chuẩn bị khung hình' : `${sourceLabel} · Ảnh`;
        } else if (t.taskCode.includes('-VID-')) {
          t.assignedAiLabel = sourceLabel;
        }
        t.updatedAt = Date.now();
      }
    }
  }

  task.status = 'CHO_NHAN';
  task.errorReason = undefined;
  task.flowPrompt = undefined;
  task.updatedAt = Date.now();
  session.lastError = undefined;

  // If this is a video task and final task had errored/completed earlier, unlock final task too
  if (task.taskCode.includes('-VID-')) {
    const finalTask = session.tasks.find((t) => t.taskCode.endsWith('-FINAL'));
    if (finalTask && (finalTask.status === 'LOI' || finalTask.status === 'HOAN_THANH')) {
      finalTask.status = 'CHO_NHAN';
      finalTask.errorReason = undefined;
      finalTask.updatedAt = Date.now();
    }
  }

  recomputeSessionStatus(session);
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Chạy lại tác vụ (giữ mốc đã xong)',
    kind: 'report',
    taskCode: task.taskCode,
    content: params.overrideVideoSource
      ? `Giữ nguyên các ảnh Bước 1 đã hoàn thành, chuyển [${task.taskCode}] sang nguồn ${SOURCE_LABELS[nextSource]} và kích hoạt chạy lại ngay.`
      : `Đã mở lại tác vụ [${task.taskCode}] trên nguồn ${SOURCE_LABELS[nextSource]} và kích hoạt chạy lại.`,
  });

  if (params.autoContinueSession !== false) {
    await startSessionSequentialRun({
      sessionId: session.sessionId,
      googleToken: params.googleToken,
      retryErrors: false,
    });
  } else {
    const isMediaGenStep = task.taskCode.includes('-IMG-') || task.taskCode.includes('-VID-');
    if (isMediaGenStep) {
      await withDedicatedAccountWorker(task.videoSourceLock, (worker) =>
        runSingleCoordinationTask({
          sessionId: session.sessionId,
          taskCode: task.taskCode,
          googleToken: params.googleToken,
          assignedWorker: worker,
        })
      );
    } else {
      await runSingleCoordinationTask({
        sessionId: session.sessionId,
        taskCode: task.taskCode,
        googleToken: params.googleToken,
      });
    }
  }

  return { session, task };
}

export async function regenerateSceneImageAndContinue(params: {
  sessionId: string;
  sceneIndex: number;
  customPromptNote?: string;
  overrideVideoSource?: IndependentVideoSource;
  autoResumeVideo?: boolean;
  googleToken?: string;
}): Promise<{
  session: CoordinationSession;
  imgTask: CoordinationTaskRow;
  vidTask?: CoordinationTaskRow;
}> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error(`Không tìm thấy phiên ${params.sessionId}.`);
  if (activeSessionRunners.has(session.sessionId)) {
    throw new Error(`Phiên ${session.sessionId} đang chạy. Hãy tạm dừng phiên trước khi tạo lại ảnh phân cảnh.`);
  }

  const scene = session.scenes.find((sc) => sc.sceneIndex === params.sceneIndex);
  if (!scene) throw new Error(`Không tìm thấy Phân cảnh #${params.sceneIndex} trong phiên ${session.sessionId}.`);

  const imgTask = session.tasks.find(
    (t) => t.taskCode.includes('-IMG-') && (t.sceneIndex === scene.sceneIndex || t.sceneId === scene.sceneId)
  );
  if (!imgTask) {
    throw new Error(`Không tìm thấy tác vụ Ảnh phân cảnh cho Cảnh #${params.sceneIndex}.`);
  }
  const vidTask = session.tasks.find(
    (t) => t.taskCode.includes('-VID-') && (t.sceneIndex === scene.sceneIndex || t.sceneId === scene.sceneId)
  );
  const finalTask = session.tasks.find((t) => t.taskCode.endsWith('-FINAL'));

  const cleanNote = String(params.customPromptNote || '').trim();
  if (cleanNote) {
    const basePrompt = String(scene.imagePrompt || scene.actionDetail || scene.title || '').trim();
    if (!basePrompt.includes(cleanNote)) {
      scene.imagePrompt = `${basePrompt}\n[Điều chỉnh bổ sung khi tạo lại ảnh]: ${cleanNote}`.trim();
    }
  }

  if (params.overrideVideoSource) {
    const sourceLabel = SOURCE_LABELS[params.overrideVideoSource];
    session.videoSource = params.overrideVideoSource;
    imgTask.videoSourceLock = params.overrideVideoSource;
    imgTask.assignedAiLabel =
      params.overrideVideoSource === 'google_flow'
        ? 'Google Flow · Chuẩn bị khung hình'
        : `${sourceLabel} · Ảnh`;
    if (vidTask) {
      vidTask.videoSourceLock = params.overrideVideoSource;
      vidTask.assignedAiLabel = sourceLabel;
    }
  }

  const now = Date.now();
  // Reset Step 1 image so AI generates a brand-new reference keyframe
  imgTask.status = 'CHO_NHAN';
  imgTask.errorReason = undefined;
  imgTask.resultSummary = undefined;
  imgTask.localOutputFileName = undefined;
  imgTask.localOutputUrl = undefined;
  imgTask.driveOutputUrl = undefined;
  imgTask.completedAt = undefined;
  imgTask.updatedAt = now;

  // Reset Step 2 video & Step 3 final assembly so they cleanly run on the new image
  if (vidTask) {
    vidTask.status = 'CHO_NHAN';
    vidTask.errorReason = undefined;
    vidTask.resultSummary = undefined;
    vidTask.flowPrompt = undefined;
    vidTask.localOutputFileName = undefined;
    vidTask.localOutputUrl = undefined;
    vidTask.driveOutputUrl = undefined;
    vidTask.completedAt = undefined;
    vidTask.updatedAt = now;
  }
  if (finalTask && finalTask.status !== 'CHO_NHAN') {
    finalTask.status = 'CHO_NHAN';
    finalTask.errorReason = undefined;
    finalTask.resultSummary = undefined;
    finalTask.completedAt = undefined;
    finalTask.updatedAt = now;
  }

  session.lastError = undefined;
  recomputeSessionStatus(session);
  session.updatedAt = now;
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Tạo lại ảnh phân cảnh',
    kind: 'report',
    taskCode: imgTask.taskCode,
    content: `Đã kích hoạt tạo lại Ảnh Phân cảnh #${scene.sceneIndex} (${imgTask.taskCode})${cleanNote ? ` với ghi chú điều chỉnh: "${cleanNote}"` : ''} và đặt lại ${vidTask ? vidTask.taskCode : 'bước Video'} để tiếp tục tiến trình sản xuất mới.${params.autoResumeVideo === false ? ' (Chỉ tạo ảnh mới)' : ' (Tự động chạy tiếp sang Video → Ghép phim)'}`,
  });

  if (params.autoResumeVideo === false) {
    await withDedicatedAccountWorker(imgTask.videoSourceLock, (worker) =>
      runSingleCoordinationTask({
        sessionId: session.sessionId,
        taskCode: imgTask.taskCode,
        googleToken: params.googleToken,
        assignedWorker: worker,
      })
    );
  } else {
    await startSessionSequentialRun({
      sessionId: session.sessionId,
      googleToken: params.googleToken,
      retryErrors: false,
    });
  }

  return { session, imgTask, vidTask };
}

export function isSequentialQueueBatchRunning(): boolean {
  return activeSessionRunners.size > 0;
}

export async function startParallelSessionsRun(params?: {
  sessionIds?: string[];
  googleToken?: string;
  retryErrors?: boolean;
}): Promise<{
  startedSessionIds: string[];
  queuedSessionIds: string[];
  alreadyRunningSessionIds: string[];
}> {
  const st = loadState();
  const requestedSet =
    params?.sessionIds && params.sessionIds.length > 0
      ? new Set(params.sessionIds.map((id) => String(id || '').trim()).filter(Boolean))
      : null;

  const candidates = [...st.sessions]
    .reverse()
    .filter((s) => {
      if (requestedSet && !requestedSet.has(s.sessionId)) return false;
      if (s.status === 'HOAN_THANH') return false;
      if (params?.retryErrors) {
        return s.tasks.some((t) => t.status === 'CHO_NHAN' || t.status === 'LOI');
      }
      return s.tasks.some((t) => t.status === 'CHO_NHAN');
    });

  const startedSessionIds: string[] = [];
  const alreadyRunningSessionIds: string[] = [];

  for (const sess of candidates) {
    if (activeSessionRunners.has(sess.sessionId)) {
      alreadyRunningSessionIds.push(sess.sessionId);
      continue;
    }
    await startSessionSequentialRun({
      sessionId: sess.sessionId,
      googleToken: params?.googleToken,
      retryErrors: params?.retryErrors === true,
    });
    startedSessionIds.push(sess.sessionId);
  }

  if (startedSessionIds.length > 1) {
    const summaryBySource: Record<string, number> = {};
    for (const sid of startedSessionIds) {
      const sess = st.sessions.find((s) => s.sessionId === sid);
      if (sess) {
        const lbl = SOURCE_LABELS[sess.videoSource];
        summaryBySource[lbl] = (summaryBySource[lbl] || 0) + 1;
      }
    }
    const distText = Object.entries(summaryBySource)
      .map(([k, v]) => `${k}: ${v} phiên`)
      .join(' · ');
    pushMeetingMessage({
      sessionId: 'GLOBAL',
      senderId: 'coordinator',
      senderName: 'Trung Tâm Điều Phối AI',
      senderRole: 'Chạy đa luồng song song',
      kind: 'report',
      content: `Đã mở ${startedSessionIds.length} luồng sản xuất SONG SONG độc lập (${distText}). Nếu 1 phiên gặp sự cố hoặc chờ nạp Flow, các phiên khác vẫn tiếp tục chạy bình thường không bị chặn.`,
    });
  }

  return {
    startedSessionIds,
    queuedSessionIds: [...startedSessionIds, ...alreadyRunningSessionIds],
    alreadyRunningSessionIds,
  };
}

export async function startAllQueuedSessionsSequential(params?: {
  googleToken?: string;
  retryErrors?: boolean;
}): Promise<{ queuedSessionIds: string[]; alreadyRunning: boolean; startedSessionIds: string[] }> {
  const res = await startParallelSessionsRun({
    googleToken: params?.googleToken,
    retryErrors: params?.retryErrors,
  });
  return {
    queuedSessionIds: res.queuedSessionIds,
    startedSessionIds: res.startedSessionIds,
    alreadyRunning: res.startedSessionIds.length === 0 && res.alreadyRunningSessionIds.length > 0,
  };
}

export async function autoDistributeAndRunSessions(params?: {
  sessionIds?: string[];
  providers?: IndependentVideoSource[];
  includeErrorSessions?: boolean;
  googleToken?: string;
}): Promise<{
  assignments: Array<{
    sessionId: string;
    title: string;
    videoSource: IndependentVideoSource;
    preservedDoneTasks: number;
  }>;
  startedSessionIds: string[];
  activeProviders: IndependentVideoSource[];
}> {
  let st = loadState();
  if (st.readiness.length === 0) {
    await checkAllAiReadiness(false).catch(() => {});
    st = loadState();
  }

  const validProviders: IndependentVideoSource[] = ['gemini', 'qwen', 'muse', 'google_flow'];
  let activeProviders: IndependentVideoSource[] = [];

  if (params?.providers && params.providers.length > 0) {
    activeProviders = Array.from(
      new Set(
        params.providers
          .map((p) => String(p || '').trim() as IndependentVideoSource)
          .filter((p): p is IndependentVideoSource => validProviders.includes(p))
      )
    );
  } else {
    const readyMap = new Map(st.readiness.map((r) => [r.id, r.status]));
    // Prefer fast healthy APIs first: Gemini -> Qwen -> Google Flow -> Muse (only if ready)
    const order: IndependentVideoSource[] = ['gemini', 'qwen', 'google_flow', 'muse'];
    for (const p of order) {
      const status = readyMap.get(p);
      if (status === 'ready') {
        activeProviders.push(p);
      }
    }
    // Always allow google_flow as fallback if nothing else is ready
    if (activeProviders.length === 0) {
      activeProviders = ['google_flow'];
    }
  }

  // Build weighted round-robin ring so Gemini with multiple healthy keys takes proportional share
  const weightedRing: IndependentVideoSource[] = [];
  for (const p of activeProviders) {
    const weight =
      p === 'gemini'
        ? Math.max(2, Math.min(4, Math.ceil(getProviderConcurrencyLimit('gemini') / 2)))
        : p === 'qwen'
        ? 2
        : 1;
    for (let i = 0; i < weight; i += 1) {
      weightedRing.push(p);
    }
  }

  const requestedSet =
    params?.sessionIds && params.sessionIds.length > 0
      ? new Set(params.sessionIds.map((id) => String(id || '').trim()).filter(Boolean))
      : null;

  const targets = [...st.sessions]
    .reverse()
    .filter((s) => {
      if (requestedSet && !requestedSet.has(s.sessionId)) return false;
      if (s.status === 'HOAN_THANH' || activeSessionRunners.has(s.sessionId)) return false;
      if (params?.includeErrorSessions) {
        return s.tasks.some((t) => t.status === 'CHO_NHAN' || t.status === 'LOI');
      }
      return s.status !== 'CO_LOI' && s.tasks.some((t) => t.status === 'CHO_NHAN');
    });

  const assignments: Array<{
    sessionId: string;
    title: string;
    videoSource: IndependentVideoSource;
    preservedDoneTasks: number;
  }> = [];

  targets.forEach((sess, idx) => {
    const chosenSource = weightedRing[idx % weightedRing.length];
    const sourceLabel = SOURCE_LABELS[chosenSource];
    let preservedDoneTasks = 0;
    sess.videoSource = chosenSource;
    for (const t of sess.tasks) {
      if (t.status === 'HOAN_THANH') {
        preservedDoneTasks += 1;
        continue;
      }
      t.videoSourceLock = chosenSource;
      if (t.taskCode.includes('-IMG-')) {
        t.assignedAiLabel =
          chosenSource === 'google_flow' ? 'Google Flow · Chuẩn bị khung hình' : `${sourceLabel} · Ảnh`;
      } else if (t.taskCode.includes('-VID-')) {
        t.assignedAiLabel = sourceLabel;
      }
      if (params?.includeErrorSessions && t.status === 'LOI') {
        t.status = 'CHO_NHAN';
        t.errorReason = undefined;
      }
      t.updatedAt = Date.now();
    }
    if (params?.includeErrorSessions) {
      sess.lastError = undefined;
    }
    recomputeSessionStatus(sess);
    sess.updatedAt = Date.now();
    assignments.push({
      sessionId: sess.sessionId,
      title: sess.title,
      videoSource: chosenSource,
      preservedDoneTasks,
    });
  });

  if (assignments.length === 0) {
    return { assignments: [], startedSessionIds: [], activeProviders };
  }

  saveState(true);

  const groupedSummary = activeProviders
    .map((p) => {
      const list = assignments.filter((a) => a.videoSource === p);
      if (list.length === 0) return '';
      return `• ${SOURCE_LABELS[p]} (${list.length} phiên): ${list.map((x) => x.sessionId).join(', ')}`;
    })
    .filter(Boolean)
    .join('\n');

  pushMeetingMessage({
    sessionId: 'GLOBAL',
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Chia tải đa luồng & Chạy song song',
    kind: 'report',
    content: `Đã chia tải tự động ${assignments.length} phiên sang các AI đang sẵn sàng (giữ nguyên toàn bộ Ảnh Bước 1 đã hoàn thành) và kích hoạt chạy song song:\n${groupedSummary}`,
  });

  const runRes = await startParallelSessionsRun({
    sessionIds: assignments.map((a) => a.sessionId),
    googleToken: params?.googleToken,
    retryErrors: Boolean(params?.includeErrorSessions),
  });

  return {
    assignments,
    startedSessionIds: runRes.startedSessionIds,
    activeProviders,
  };
}

export function pauseSessionRun(sessionId: string): CoordinationSession {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === sessionId);
  if (!session) throw new Error('Không tìm thấy phiên làm việc.');
  pauseRequestedSessions.add(sessionId);
  if (!activeSessionRunners.has(sessionId)) {
    session.status = 'TAM_DUNG';
  }
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Tạm dừng phiên',
    kind: 'report',
    content: `Đã nhận lệnh tạm dừng riêng phiên ${sessionId} (không ảnh hưởng các phiên khác đang chạy song song).`,
  });

  return session;
}

export function pauseMultipleSessions(sessionIds?: string[]): { pausedSessionIds: string[] } {
  const st = loadState();
  const targets =
    sessionIds && sessionIds.length > 0
      ? sessionIds.filter((id) => st.sessions.some((s) => s.sessionId === id))
      : Array.from(activeSessionRunners);

  const pausedSessionIds: string[] = [];
  for (const sid of targets) {
    try {
      pauseSessionRun(sid);
      pausedSessionIds.push(sid);
    } catch {
      // ignore missing
    }
  }
  return { pausedSessionIds };
}

export async function uploadFlowClipForTask(params: {
  sessionId: string;
  taskCode: string;
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
  fromBridge?: boolean;
  autoContinue?: boolean;
  googleToken?: string;
}): Promise<CoordinationTaskRow> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error('Không tìm thấy phiên làm việc.');
  const task = session.tasks.find((t) => t.taskCode === params.taskCode);
  if (!task) throw new Error(`Không tìm thấy tác vụ ${params.taskCode}.`);

  const isImgTask = task.taskCode.includes('-IMG-');
  const mime = String(params.mimeType || '').toLowerCase();
  const ext = path.extname(params.fileName || '').toLowerCase();

  let safeExt: string;
  if (isImgTask) {
    if (ext === '.jpg' || ext === '.jpeg' || mime.includes('jpeg')) safeExt = '.jpg';
    else if (ext === '.webp' || mime.includes('webp')) safeExt = '.webp';
    else safeExt = '.png';
  } else {
    if (ext === '.webm' || mime.includes('webm')) safeExt = '.webm';
    else if (ext === '.mov' || mime.includes('quicktime')) safeExt = '.mov';
    else safeExt = '.mp4';
  }

  const saved = saveBufferArtifact(session.sessionId, `${task.taskCode}_flow${safeExt}`, params.buffer);
  task.localOutputFileName = saved.fileName;
  task.localOutputUrl = saved.localUrl;
  task.status = 'HOAN_THANH';
  task.errorReason = undefined;
  task.completedAt = Date.now();
  task.updatedAt = Date.now();
  const sizeMb = (params.buffer.byteLength / (1024 * 1024)).toFixed(2);
  task.resultSummary = isImgTask
    ? `Đã tiếp nhận ảnh phân cảnh từ ${params.fromBridge ? 'Google Flow Auto-Bridge' : 'Google Flow'} (${sizeMb} MB) cho ${task.taskCode}.`
    : `Đã tiếp nhận video từ ${params.fromBridge ? 'Google Flow Auto-Bridge' : 'Google Flow'} (${sizeMb} MB) cho ${task.taskCode}.`;
  recomputeSessionStatus(session);
  session.updatedAt = Date.now();
  saveState(true);

  if (params.fromBridge) {
    markFlowBridgeJobDone(isImgTask ? 'image' : 'video', session.sessionId, task.taskCode, params.buffer.byteLength);
  }

  if (params.googleToken && st.workspace.spreadsheetId) {
    await syncSessionToGoogleWorkspace({
      token: params.googleToken,
      sessionId: session.sessionId,
      silentMeetingNote: true,
    }).catch(() => {});
  }

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'google_flow',
    senderName: params.fromBridge ? 'Google Flow Auto-Bridge' : 'Google Flow · Veo (Độc lập)',
    senderRole: isImgTask ? 'Bước 1 · Nhận ảnh Flow hoàn tất' : 'Bước 2 · Nhận clip Flow hoàn tất',
    kind: 'completed',
    taskCode: task.taskCode,
    content: `[${task.taskCode}] ${task.resultSummary}`,
    referenceLink: task.driveOutputUrl || task.localOutputUrl,
  });

  // Automatically advance session to Step 2 Video (if Step 1 Image just completed) or Step 3 Final MP4 Assembly!
  if (params.autoContinue !== false) {
    const hasNextRunnable = session.tasks.some((t) => {
      if (t.status !== 'CHO_NHAN') return false;
      return t.dependsOnTaskCodes.every((depCode) => {
        const dep = session.tasks.find((x) => x.taskCode === depCode);
        return dep?.status === 'HOAN_THANH';
      });
    });
    if (hasNextRunnable && !activeSessionRunners.has(session.sessionId)) {
      await startSessionSequentialRun({
        sessionId: session.sessionId,
        googleToken: params.googleToken,
        retryErrors: false,
      }).catch(() => {});
    }
  }

  return task;
}

export function claimNextFlowJobFromCenter(workerId?: string): FlowBridgeClaimedJob | null {
  const st = loadState();
  return claimNextFlowBridgeJob({
    state: st,
    workerId,
    loadArtifactDataUrl: (sessionId, fileName) => readLocalFileAsDataUrl(sessionId, fileName) || undefined,
  });
}

export function failFlowBridgeTask(params: {
  sessionId: string;
  taskCode: string;
  error: string;
}): CoordinationTaskRow | null {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  const task = session?.tasks.find((t) => t.taskCode === params.taskCode);
  const reason = String(params.error || 'Google Flow Auto-Bridge báo lỗi không xác định.').slice(0, 400);
  markFlowBridgeJobFailed(params.sessionId, params.taskCode, reason);

  if (!session || !task) return null;
  task.status = 'LOI';
  task.errorReason = reason;
  task.updatedAt = Date.now();
  session.lastError = `[${task.taskCode}] ${reason}`;
  recomputeSessionStatus(session);
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'google_flow',
    senderName: 'Google Flow Auto-Bridge',
    senderRole: `Bước ${task.step} · Báo lỗi`,
    kind: 'error',
    taskCode: task.taskCode,
    content: `[${task.taskCode}] Flow Auto-Bridge gặp sự cố: ${reason}`,
  });

  return task;
}

// ==========================================
// 5. LIVE MEETING ROOM (PHÒNG HỌP TRỰC TIẾP · AI CONVERSATION)
// ==========================================

function buildFactualLedgerReport(st: CoordinationCenterState, session?: CoordinationSession): string {
  const readinessLines = st.readiness.map(
    (r) => `  - ${r.name}: ${r.status}${r.accountSummary ? ` (${r.accountSummary})` : ''} — ${r.detail}`
  );

  if (!session) {
    return [
      `Hiện tại Trung Tâm Điều Phối AI đang có ${st.sessions.length} phiên làm việc.`,
      readinessLines.length > 0 ? `Tình trạng sẵn sàng của các AI:\n${readinessLines.join('\n')}` : '',
      'Hãy đẩy kịch bản từ phòng Studio AI hoặc bấm "Tạo phiên nhanh" để lập bảng nhiệm vụ tuần tự.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const done = session.tasks.filter((t) => t.status === 'HOAN_THANH');
  const running = session.tasks.filter((t) => t.status === 'DANG_LAM');
  const failed = session.tasks.filter((t) => t.status === 'LOI');
  const waitingFlow = session.tasks.filter((t) => t.status === 'CHO_NHAP_FLOW');
  const queued = session.tasks.filter((t) => t.status === 'CHO_NHAN');
  const pct = session.tasks.length > 0 ? Math.round((done.length / session.tasks.length) * 100) : 0;

  const lines = [
    `Báo cáo thực tế phiên ${session.sessionId} ("${session.title}"):`,
    `• Nguồn video khóa độc lập: ${SOURCE_LABELS[session.videoSource]}`,
    `• Tiến độ bảng nhiệm vụ: ${done.length}/${session.tasks.length} hoàn thành (${pct}%) | Đang làm: ${running.length} | Chờ nhận: ${queued.length} | Chờ nhập Flow: ${waitingFlow.length} | Lỗi: ${failed.length}`,
    `• Hồ sơ tham chiếu: ${session.references.length} mục (${session.references.filter((r) => r.kind === 'character').length} nhân vật)${session.driveFolderUrl ? ' · Đã liên kết Google Drive' : ' · Đang lưu cục bộ'}.`,
  ];

  if (failed.length > 0) {
    lines.push(
      `• Chi tiết lỗi: ${failed.map((f) => `${f.taskCode} (${f.errorReason || 'không rõ lý do'})`).join('; ')}`
    );
  } else if (waitingFlow.length > 0) {
    lines.push(`• Đang chờ tải video Google Flow lên cho: ${waitingFlow.map((w) => w.taskCode).join(', ')}.`);
  } else if (queued.length > 0) {
    const nextRunnable = queued.find((q) =>
      q.dependsOnTaskCodes.every((d) => session.tasks.find((x) => x.taskCode === d)?.status === 'HOAN_THANH')
    );
    if (nextRunnable) {
      lines.push(`• Tác vụ kế tiếp sẵn sàng chạy: ${nextRunnable.taskCode} (${nextRunnable.title}).`);
    }
  } else if (done.length === session.tasks.length && session.tasks.length > 0) {
    lines.push('• Toàn bộ các bước đã hoàn tất và đã ghép xong phim hoàn chỉnh.');
  }
  return lines.join('\n');
}

function buildMeetingContextSnapshot(st: CoordinationCenterState, focusSession?: CoordinationSession): string {
  const readinessBlock = st.readiness
    .map(
      (r) =>
        `- ${r.name} [${r.status}]${r.accountSummary ? ` | ${r.accountSummary}` : ''} | ${r.detail}`
    )
    .join('\n');

  const workspaceBlock = st.workspace.spreadsheetId
    ? `Google Sheets đã kết nối: "${st.workspace.spreadsheetTitle || st.workspace.spreadsheetId}" (${st.workspace.spreadsheetUrl || ''}) · Drive gốc: ${st.workspace.rootFolderName || 'Trung_Tam_Dieu_Phoi_AI'}`
    : 'Chưa kết nối Google Sheets & Google Drive (đang lưu sổ cục bộ an toàn).';

  const sessionsOverview =
    st.sessions.length === 0
      ? 'Chưa có kịch bản/phiên nào trong hàng đợi.'
      : st.sessions
          .slice(0, 15)
          .map((s, idx) => {
            const done = s.tasks.filter((t) => t.status === 'HOAN_THANH').length;
            const err = s.tasks.filter((t) => t.status === 'LOI').length;
            const running = s.tasks.filter((t) => t.status === 'DANG_LAM').length;
            return `${idx + 1}. [${s.sessionId}] "${s.title}" | Trạng thái: ${s.status} | Nguồn: ${SOURCE_LABELS[s.videoSource]} | ${s.scenes.length} phân cảnh | Tiến độ: ${done}/${s.tasks.length} xong, ${running} đang chạy, ${err} lỗi${s.lastError ? ` | Lỗi gần nhất: ${s.lastError}` : ''}`;
          })
          .join('\n');

  let focusBlock = 'Không có phiên cụ thể nào đang chọn.';
  if (focusSession) {
    const sceneLines = focusSession.scenes.map((sc) => {
      const imgTask = focusSession.tasks.find((t) => t.taskCode.includes('-IMG-') && t.sceneIndex === sc.sceneIndex);
      const vidTask = focusSession.tasks.find((t) => t.taskCode.includes('-VID-') && t.sceneIndex === sc.sceneIndex);
      return `  • Phân cảnh #${sc.sceneIndex} "${sc.title}" (${sc.durationSec}s): Ảnh [${imgTask?.status || 'N/A'}${imgTask?.errorReason ? ` - Lỗi: ${imgTask.errorReason}` : ''}] → Video [${vidTask?.status || 'N/A'}${vidTask?.errorReason ? ` - Lỗi: ${vidTask.errorReason}` : ''}]`;
    });
    const finalTask = focusSession.tasks.find((t) => t.taskCode.endsWith('-FINAL'));
    const chars = focusSession.references
      .filter((r) => r.kind === 'character')
      .map((r) => `${r.name}${r.detail ? ` (${r.detail.slice(0, 100)})` : ''}`);
    focusBlock = [
      `Phiên đang tập trung: ${focusSession.sessionId} — "${focusSession.title}"`,
      `Nguồn video khóa độc lập: ${SOURCE_LABELS[focusSession.videoSource]} | Trạng thái: ${focusSession.status} | Tỷ lệ: ${focusSession.aspectRatio}`,
      `Nhân vật tham chiếu (${chars.length}): ${chars.join('; ') || 'Không có'}`,
      `Chi tiết từng phân cảnh:\n${sceneLines.join('\n')}`,
      finalTask
        ? `Bước ghép phim cuối [${finalTask.taskCode}]: ${finalTask.status}${finalTask.errorReason ? ` (Lỗi: ${finalTask.errorReason})` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '=== TÌNH TRẠNG SẴN SÀNG CÁC AI ===',
    readinessBlock || 'Chưa có dữ liệu kiểm tra.',
    '',
    '=== GOOGLE SHEETS & DRIVE ===',
    workspaceBlock,
    '',
    `=== DANH SÁCH TẤT CẢ KỊCH BẢN TRONG TRUNG TÂM ĐIỀU PHỐI (${st.sessions.length} phiên) ===`,
    sessionsOverview,
    '',
    '=== CHI TIẾT PHIÊN ĐANG CHỌN ===',
    focusBlock,
  ].join('\n');
}

const COORDINATOR_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'bulk_change_source',
    description:
      'Đổi nguồn AI sản xuất độc lập (gemini | qwen | muse | google_flow) cho một hoặc nhiều phiên làm việc. Luôn giữ nguyên các bước Ảnh Bước 1 đã HOAN_THANH làm mốc cố định.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Danh sách mã phiên cần đổi nguồn (ví dụ: ["SES-20261125-93D1", "SES-20261125-5A08"]).',
        },
        videoSource: {
          type: Type.STRING,
          enum: ['gemini', 'qwen', 'muse', 'google_flow'],
          description: 'Nguồn AI mới cần gán độc lập cho các tác vụ chưa hoàn thành.',
        },
        resetFailedTasks: {
          type: Type.BOOLEAN,
          description: 'Nếu true, đặt lại các tác vụ đang LOI về CHO_NHAN để sẵn sàng chạy lại bằng nguồn mới.',
        },
      },
      required: ['sessionIds', 'videoSource'],
    },
  },
  {
    name: 'auto_distribute_and_run',
    description:
      'Tự động chia tải các phiên đang chờ (và tùy chọn cả phiên đang lỗi) sang các nguồn AI đang sẵn sàng (Gemini, Qwen, Google Flow, Muse) rồi khởi chạy SONG SONG đa luồng ngay lập tức.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Tùy chọn: chỉ chia tải các mã phiên này. Để trống nếu áp dụng cho tất cả phiên đang chờ.',
        },
        providers: {
          type: Type.ARRAY,
          items: { type: Type.STRING, enum: ['gemini', 'qwen', 'muse', 'google_flow'] },
          description: 'Tùy chọn: danh sách nguồn AI muốn phân bổ (ví dụ ["gemini", "qwen", "google_flow"]). Để trống để tự chọn tất cả AI đang ready.',
        },
        includeErrorSessions: {
          type: Type.BOOLEAN,
          description: 'Nếu true, bao gồm cả các phiên đang CO_LOI để đổi nguồn & chạy lại phần chưa xong.',
        },
      },
    },
  },
  {
    name: 'start_parallel_sessions',
    description:
      'Kích hoạt chạy SONG SONG đa luồng cho các phiên cụ thể hoặc tất cả phiên đang chờ mà không để 1 phiên lỗi chặn các phiên khác.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Danh sách mã phiên cần kích hoạt. Để trống sẽ chạy song song tất cả phiên chưa hoàn thành.',
        },
        retryErrors: {
          type: Type.BOOLEAN,
          description: 'Nếu true, tự động reset các tác vụ LOI về CHO_NHAN trước khi chạy.',
        },
      },
    },
  },
  {
    name: 'retry_scene_task',
    description:
      'Chạy lại 1 tác vụ cụ thể (ví dụ T02-VID-S01 đang lỗi), có thể đổi sang nguồn AI khác (gemini | qwen | muse | google_flow) mà VẪN GIỮ NGUYÊN Ảnh Bước 1 đã hoàn thành, rồi tự chạy tiếp bước ghép phim.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: { type: Type.STRING, description: 'Mã phiên (ví dụ SES-20261125-93D1).' },
        taskCode: { type: Type.STRING, description: 'Mã tác vụ cần chạy lại (ví dụ T02-VID-S01).' },
        overrideVideoSource: {
          type: Type.STRING,
          enum: ['gemini', 'qwen', 'muse', 'google_flow'],
          description: 'Tùy chọn đổi nguồn AI cho bước này và các bước chưa xong còn lại của phiên.',
        },
        autoContinueSession: {
          type: Type.BOOLEAN,
          description: 'Mặc định true: chạy xong bước này sẽ tự động chạy tiếp các bước sau (như ghép MP4).',
        },
      },
      required: ['sessionId', 'taskCode'],
    },
  },
  {
    name: 'regenerate_scene_image',
    description:
      'Tạo lại Ảnh Phân cảnh Bước 1 (khi gặp lỗi khóa nhân vật / mâu thuẫn logic hành động / sai tham chiếu) và đặt lại bước Video + Ghép phim của phân cảnh đó để chạy tiến trình mới.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: { type: Type.STRING, description: 'Mã phiên chứa phân cảnh cần tạo lại ảnh.' },
        sceneIndex: { type: Type.INTEGER, description: 'Số thứ tự phân cảnh (1, 2, 3...).' },
        customPromptNote: {
          type: Type.STRING,
          description: 'Ghi chú điều chỉnh thêm vào prompt tạo ảnh để sửa lỗi ngoại hình/hành động.',
        },
        overrideVideoSource: {
          type: Type.STRING,
          enum: ['gemini', 'qwen', 'muse', 'google_flow'],
          description: 'Tùy chọn đổi nguồn AI khi tạo lại ảnh & video.',
        },
        autoResumeVideo: {
          type: Type.BOOLEAN,
          description: 'Mặc định true: tạo ảnh mới xong sẽ tự động chạy tiếp bước tạo Video và ghép phim.',
        },
      },
      required: ['sessionId', 'sceneIndex'],
    },
  },
  {
    name: 'pause_sessions',
    description: 'Tạm dừng an toàn một hoặc nhiều phiên đang chạy (hoặc toàn bộ phiên đang chạy nếu không truyền sessionIds).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Danh sách mã phiên cần tạm dừng. Để trống sẽ tạm dừng mọi phiên đang chạy.',
        },
      },
    },
  },
];

async function executeCoordinatorToolCall(
  name: string,
  args: Record<string, any>,
  googleToken?: string
): Promise<Record<string, any>> {
  const validSources: IndependentVideoSource[] = ['gemini', 'qwen', 'muse', 'google_flow'];
  const asSource = (v: any): IndependentVideoSource | undefined => {
    const s = String(v || '').trim() as IndependentVideoSource;
    return validSources.includes(s) ? s : undefined;
  };
  const asStringList = (v: any): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

  try {
    if (name === 'bulk_change_source') {
      const videoSource = asSource(args.videoSource);
      const sessionIds = asStringList(args.sessionIds);
      if (!videoSource || sessionIds.length === 0) {
        return { ok: false, error: 'Thiếu sessionIds hoặc videoSource không hợp lệ.' };
      }
      const res = bulkUpdateSessionVideoSource({
        sessionIds,
        videoSource,
        resetFailedTasks: args.resetFailedTasks === true,
      });
      return { ok: true, videoSource, ...res };
    }

    if (name === 'auto_distribute_and_run') {
      const sessionIds = asStringList(args.sessionIds);
      const providers = asStringList(args.providers)
        .map((p) => asSource(p))
        .filter((p): p is IndependentVideoSource => Boolean(p));
      const res = await autoDistributeAndRunSessions({
        sessionIds: sessionIds.length > 0 ? sessionIds : undefined,
        providers: providers.length > 0 ? providers : undefined,
        includeErrorSessions: args.includeErrorSessions === true,
        googleToken,
      });
      return { ok: true, ...res };
    }

    if (name === 'start_parallel_sessions') {
      const sessionIds = asStringList(args.sessionIds);
      const res = await startParallelSessionsRun({
        sessionIds: sessionIds.length > 0 ? sessionIds : undefined,
        retryErrors: args.retryErrors === true,
        googleToken,
      });
      return { ok: true, ...res };
    }

    if (name === 'retry_scene_task') {
      const sessionId = String(args.sessionId || '').trim();
      const taskCode = String(args.taskCode || '').trim();
      if (!sessionId || !taskCode) {
        return { ok: false, error: 'Thiếu sessionId hoặc taskCode.' };
      }
      const res = await retryCoordinationTask({
        sessionId,
        taskCode,
        overrideVideoSource: asSource(args.overrideVideoSource),
        autoContinueSession: args.autoContinueSession !== false,
        googleToken,
      });
      return {
        ok: true,
        sessionId: res.session.sessionId,
        sessionStatus: res.session.status,
        videoSource: res.session.videoSource,
        taskCode: res.task.taskCode,
        taskStatus: res.task.status,
      };
    }

    if (name === 'regenerate_scene_image') {
      const sessionId = String(args.sessionId || '').trim();
      const sceneIndex = Number(args.sceneIndex);
      if (!sessionId || !Number.isFinite(sceneIndex) || sceneIndex < 1) {
        return { ok: false, error: 'Thiếu sessionId hoặc sceneIndex không hợp lệ.' };
      }
      const res = await regenerateSceneImageAndContinue({
        sessionId,
        sceneIndex,
        customPromptNote: typeof args.customPromptNote === 'string' ? args.customPromptNote : undefined,
        overrideVideoSource: asSource(args.overrideVideoSource),
        autoResumeVideo: args.autoResumeVideo !== false,
        googleToken,
      });
      return {
        ok: true,
        sessionId: res.session.sessionId,
        sessionStatus: res.session.status,
        imgTaskCode: res.imgTask.taskCode,
        vidTaskCode: res.vidTask?.taskCode || null,
      };
    }

    if (name === 'pause_sessions') {
      const sessionIds = asStringList(args.sessionIds);
      const res = pauseMultipleSessions(sessionIds.length > 0 ? sessionIds : undefined);
      return { ok: true, ...res };
    }

    return { ok: false, error: `Công cụ không tồn tại: ${name}` };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || 'Lỗi thực thi lệnh điều phối.') };
  }
}

export async function postMeetingRoomMessage(params: {
  sessionId?: string;
  content: string;
  googleToken?: string;
}): Promise<{ userMessage: MeetingRoomMessage; replyMessage: MeetingRoomMessage; executedTools?: string[] }> {
  const st = loadState();
  const cleanText = String(params.content || '').trim().slice(0, 2000);
  if (!cleanText) throw new Error('Vui lòng nhập nội dung trao đổi.');

  const requestedId = String(params.sessionId || '').trim();
  const isExplicitGlobal = !requestedId || requestedId.toUpperCase() === 'GLOBAL';
  const session = isExplicitGlobal
    ? st.sessions.find((s) => s.sessionId === st.activeSessionId) || st.sessions[0]
    : st.sessions.find((s) => s.sessionId === requestedId) ||
      st.sessions.find((s) => s.sessionId === st.activeSessionId) ||
      st.sessions[0];
  const targetSessionId = !isExplicitGlobal && session ? session.sessionId : session?.sessionId || 'GLOBAL';

  // Ensure readiness snapshot exists for accurate answers & auto-distribution
  if (st.readiness.length === 0) {
    await checkAllAiReadiness(false).catch(() => {});
  }

  const userMessage = pushMeetingMessage({
    sessionId: targetSessionId,
    senderId: 'user',
    senderName: 'Quản trị viên',
    senderRole: 'Chỉ đạo trực tiếp',
    kind: 'user',
    content: cleanText,
  });

  // Gather recent conversation history for natural multi-turn chat
  const recentHistory = st.meetingMessages
    .filter((m) => m.id !== userMessage.id && (isExplicitGlobal || m.sessionId === targetSessionId || m.sessionId === 'GLOBAL'))
    .slice(-10)
    .map((m) => `[${m.senderName} · ${m.senderRole}]: ${m.content}`)
    .join('\n');

  const snapshot = buildMeetingContextSnapshot(loadState(), session);
  const telemetry = getActiveWorkerTelemetry();
  const telemetryLine = `Luồng đa nhiệm đang chạy: ${telemetry.activeSessionIds.length} phiên (${telemetry.activeSessionIds.join(', ') || 'không có'}) | Slot song song: Gemini ${telemetry.providerSlots.gemini.active}/${telemetry.providerSlots.gemini.limit}, Qwen ${telemetry.providerSlots.qwen.active}/${telemetry.providerSlots.qwen.limit}, Google Flow ${telemetry.providerSlots.google_flow.active}/${telemetry.providerSlots.google_flow.limit}, Muse ${telemetry.providerSlots.muse.active}/${telemetry.providerSlots.muse.limit}.`;

  const workerAccount = pickWorkerGeminiAccount();
  const apiKey = workerAccount?.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || '';

  let replyContent = '';
  let replyRole = 'Điều phối viên AI (Quyền thực thi trực tiếp)';
  const executedTools: string[] = [];

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: 'v1beta', headers: { 'User-Agent': 'aistudio-build' } },
      });

      const systemInstruction = [
        'Bạn là ĐIỀU PHỐI VIÊN AI CẤP CAO có QUYỀN THỰC THI TRỰC TIẾP (Function Calling) trên Sổ Điều Phối trong "Phòng họp trực tiếp — Trung Tâm Điều Phối AI".',
        'Bạn KHÔNG còn là trợ lý chỉ-đọc nữa: bạn có 6 công cụ thực thi thật để thay đổi nguồn AI, chia tải đa luồng, kích hoạt chạy song song nhiều phiên cùng lúc, chạy lại tác vụ lỗi (vẫn giữ mốc Ảnh Bước 1 đã xong), tạo lại ảnh phân cảnh và tạm dừng phiên.',
        'Nguyên tắc tuyệt đối:',
        '1. Khi Quản trị viên ra lệnh hành động (ví dụ: chuyển nguồn, chạy song song, chia tải sang Gemini/Qwen/Google Flow, xử lý phiên lỗi, tạo lại ảnh phân cảnh, tạm dừng...), PHẢI GỌI NGAY các công cụ (tools) tương ứng để thực thi thật trên hệ thống. Có thể gọi nhiều công cụ liên tiếp trong cùng một lượt.',
        '2. TUYỆT ĐỐI KHÔNG BAO GIỜ giả vờ hoặc nói đã thực hiện hành động nếu bạn CHƯA thực sự gọi công cụ và nhận kết quả ok: true trả về. Mọi số liệu, mã phiên và trạng thái báo cáo lại PHẢI căn cứ 100% vào dữ liệu thực tế & kết quả trả về từ công cụ.',
        '3. Khi xử lý phiên lỗi ở Bước 2 Video (ví dụ Muse quá thời gian chờ) mà Ảnh Bước 1 đã HOAN_THANH: dùng retry_scene_task với overrideVideoSource (hoặc bulk_change_source + start_parallel_sessions) để GIỮ NGUYÊN Ảnh Bước 1 và chạy tiếp bước Video trên nguồn khỏe hơn (Gemini / Qwen / Google Flow).',
        '4. Khi ảnh phân cảnh gặp mâu thuẫn khóa nhân vật hoặc sai logic hành động: dùng regenerate_scene_image để tạo lại Ảnh Bước 1 và tự động chạy tiếp sang Video.',
        '5. Hệ thống hỗ trợ chạy ĐA LUỒNG SONG SONG giữa các phiên theo từng nguồn AI (Gemini có thể chạy song song nhiều phiên theo số khóa khỏe, Qwen song song, Google Flow song song) — 1 phiên lỗi KHÔNG BAO GIỜ chặn các phiên khác.',
        '6. Trả lời bằng tiếng Việt ngắn gọn, rõ ràng, trung thực, gạch đầu dòng các lệnh đã thực thi thành công và trạng thái mới nhất.',
      ].join('\n');

      const initialUserPrompt = [
        'DỮ LIỆU HỆ THỐNG HIỆN TẠI (trực tiếp từ Trung Tâm Điều Phối AI):',
        snapshot,
        telemetryLine,
        recentHistory ? `\nLỊCH SỬ TRAO ĐỔI GẦN ĐÂY TRONG PHÒNG HỌP:\n${recentHistory}` : '',
        `\nQUẢN TRỊ VIÊN VỪA CHỈ ĐẠO:\n${cleanText}`,
      ]
        .filter(Boolean)
        .join('\n');

      const candidateModels = ['gemini-4-hydrogen', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
      let lastModelErr: any = null;

      for (const modelName of candidateModels) {
        try {
          const contents: any[] = [{ role: 'user', parts: [{ text: initialUserPrompt }] }];
          let finalText = '';

          for (let round = 0; round < 4; round += 1) {
            const response = await ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: COORDINATOR_TOOL_DECLARATIONS }],
              },
            });

            const calls = response.functionCalls;
            if (calls && calls.length > 0) {
              const modelContent = response.candidates?.[0]?.content;
              if (modelContent) {
                contents.push(modelContent);
              }
              const responseParts: any[] = [];
              for (const call of calls) {
                const toolName = String(call.name || '');
                const toolArgs = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, any>;
                const toolResult = await executeCoordinatorToolCall(toolName, toolArgs, params.googleToken);
                executedTools.push(toolName);
                responseParts.push({
                  functionResponse: {
                    id: call.id,
                    name: toolName,
                    response: { result: toolResult },
                  },
                });
              }
              contents.push({ role: 'user', parts: responseParts });
              continue;
            }

            finalText = String(response.text || '').trim();
            break;
          }

          if (finalText) {
            replyContent = finalText;
            replyRole =
              executedTools.length > 0
                ? `Điều phối viên AI (${modelName}) · Đã thực thi ${executedTools.length} lệnh`
                : `Điều phối viên AI (${modelName})`;
            break;
          }
        } catch (modelErr: any) {
          lastModelErr = modelErr;
          const msg = String(modelErr?.message || '');
          const isRetryable =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('429') ||
            msg.includes('404') ||
            msg.includes('NOT_FOUND') ||
            msg.includes('high demand') ||
            msg.includes('overloaded');
          if (!isRetryable) throw modelErr;
        }
      }
      if (!replyContent && lastModelErr) {
        throw lastModelErr;
      }
    } catch (err: any) {
      const errNote = String(err?.message || 'Lỗi kết nối Gemini').slice(0, 180);
      replyRole = 'Báo cáo trực tiếp từ Sổ Điều Phối';
      replyContent = `${buildFactualLedgerReport(loadState(), session)}\n\n(Ghi chú: AI hội thoại Gemini tạm thời gặp lỗi: ${errNote})`;
    }
  } else {
    replyRole = 'Báo cáo trực tiếp từ Sổ Điều Phối';
    replyContent = `${buildFactualLedgerReport(loadState(), session)}\n\n(Lưu ý: Chưa cấu hình GEMINI_API_KEY hoặc tài khoản Gemini trong Cài đặt nên phòng họp đang trả lời bằng báo cáo số liệu trực tiếp.)`;
  }

  if (!replyContent) {
    replyRole = 'Báo cáo trực tiếp từ Sổ Điều Phối';
    replyContent = buildFactualLedgerReport(loadState(), session);
  }

  const replyMessage = pushMeetingMessage({
    sessionId: targetSessionId,
    senderId: 'coordinator',
    senderName: 'Điều phối viên AI',
    senderRole: replyRole,
    kind: executedTools.length > 0 ? 'completed' : 'coordinator',
    content: replyContent,
    referenceLink: st.workspace.spreadsheetUrl,
  });

  if (params.googleToken && session && st.workspace.spreadsheetId) {
    await syncSessionToGoogleWorkspace({
      token: params.googleToken,
      sessionId: session.sessionId,
      silentMeetingNote: true,
    }).catch(() => {});
  }

  return { userMessage, replyMessage, executedTools };
}
