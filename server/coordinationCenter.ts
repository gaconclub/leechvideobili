import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  AiEngineReadinessItem,
  CoordinationCenterState,
  CoordinationReferenceItem,
  CoordinationSceneSpec,
  CoordinationSession,
  CoordinationSessionStatus,
  CoordinationTaskRow,
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
  generateSceneVideoWithOmniFlash,
  generateStudioImage,
  getStudioAsset,
  type StudioCharacterRefInput,
} from './derivative';
import { getAlibabaModelStudioStatus } from './alibabaModelStudio';
import { getMuse2ApiStatus } from './muse2api';
import {
  getGeminiPoolSummary,
  hasAnyEnabledGeminiAccount,
  pickWorkerGeminiAccount,
} from './geminiPool';

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
    const muse = await getMuse2ApiStatus();
    const latencyMs = Math.max(1, Date.now() - t0);
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

  // 4) Google Flow (Veo Manual/Bundle Source)
  results.push({
    id: 'google_flow',
    name: 'Google Flow (Veo Độc lập)',
    role: 'Xuất gói prompt chuẩn & Nạp clip MP4 từng cảnh',
    independentSource: 'google_flow',
    status: 'ready',
    activeModel: 'Flow Veo Prompt + Upload Clip',
    accountSummary: 'Hoạt động độc lập 100%',
    detail: 'Luôn sẵn sàng. Tách biệt hoàn toàn, không tự gọi Gemini/Muse/Qwen tạo video.',
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
      instructions: sc.videoPrompt || sc.videoTimeline || sc.actionDetail || sc.title,
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

  const tasks = buildTasksForSession({
    sessionId,
    videoSource,
    scenes,
    references,
  });

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
    content: `Đã khóa nguồn sáng tạo video độc lập cho phiên ${sessionId} sang: ${sourceLabel}. Chỉ duy nhất nguồn này thực thi các tác vụ chưa hoàn thành — không chồng lấn nguồn khác.`,
  });

  return session;
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
    scene.cameraAngle || scene.cameraMovement
      ? `Góc máy & chuyển động: ${[scene.cameraAngle, scene.cameraMovement].filter(Boolean).join(' · ')}`
      : '',
    scene.lighting ? `Ánh sáng: ${scene.lighting}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function assembleFinalFilmWithFfmpeg(
  session: CoordinationSession,
  clipPaths: string[]
): Promise<{ fileName: string; localUrl: string }> {
  const dir = getSessionArtifactDir(session.sessionId);
  const outFileName = `final_${sanitizeIdSegment(session.sessionId, 'film')}.mp4`;
  const outPath = path.resolve(dir, outFileName);
  if (!outPath.startsWith(ARTIFACTS_ROOT + path.sep)) {
    throw new Error('Đường dẫn xuất phim không hợp lệ.');
  }

  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outPath);
    return { fileName: outFileName, localUrl: artifactUrlFor(session.sessionId, outFileName) };
  }

  const targetW = session.aspectRatio === '9:16' ? 720 : 1280;
  const targetH = session.aspectRatio === '9:16' ? 1280 : 720;
  const normalizedPaths: string[] = [];

  for (let i = 0; i < clipPaths.length; i += 1) {
    const normPath = path.resolve(dir, `norm_${String(i + 1).padStart(2, '0')}.mp4`);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        clipPaths[i],
        '-f',
        'lavfi',
        '-t',
        '15',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-vf',
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
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
    normalizedPaths.push(normPath);
  }

  const concatListPath = path.resolve(dir, 'concat_list.txt');
  fs.writeFileSync(
    concatListPath,
    normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8'
  );

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
      '128k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { timeout: 180_000 }
  );

  return { fileName: outFileName, localUrl: artifactUrlFor(session.sessionId, outFileName) };
}

export async function runSingleCoordinationTask(params: {
  sessionId: string;
  taskCode: string;
  googleToken?: string;
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
  if (previousStatus === 'LOI') {
    task.retryCount = (task.retryCount || 0) + 1;
  }
  task.updatedAt = Date.now();
  session.updatedAt = Date.now();
  recomputeSessionStatus(session);
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: task.videoSourceLock,
    senderName: task.assignedAiLabel,
    senderRole: `Bước ${task.step} · ${task.stepLabel}`,
    kind: 'claim',
    taskCode: task.taskCode,
    content: `[${task.taskCode}] Nhận nhiệm vụ từ bảng điều phối phiên ${session.sessionId} và nạp dữ liệu tham chiếu (${task.inputRefIds.join(', ') || 'không'}).`,
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
        const flowPrompt = buildGoogleFlowPrompt(session, scene, refSummary);
        const promptSaved = saveBufferArtifact(
          session.sessionId,
          `${task.taskCode}_prompt.txt`,
          Buffer.from(flowPrompt, 'utf8')
        );
        task.flowPrompt = flowPrompt;
        task.localOutputFileName = promptSaved.fileName;
        task.localOutputUrl = promptSaved.localUrl;
        task.resultSummary = `Đã chuẩn bị prompt Google Flow cho Cảnh #${scene.sceneIndex} (${charRefs.length} nhân vật tham chiếu).`;
        task.status = 'HOAN_THANH';
        task.completedAt = Date.now();
        task.updatedAt = Date.now();
      } else {
        const engineMap: Record<Exclude<IndependentVideoSource, 'google_flow'>, 'gemini' | 'qwen' | 'muse2api'> = {
          gemini: 'gemini',
          qwen: 'qwen',
          muse: 'muse2api',
        };
        const lockedEngine = engineMap[task.videoSourceLock];
        const geminiWorker = lockedEngine === 'gemini' ? pickWorkerGeminiAccount() : null;

        const imgRes = await generateStudioImage({
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
          geminiApiKey: geminiWorker?.apiKey,
          allowFreeCostumeChange: session.allowFreeCostumeChange,
        });

        const saved = saveBase64ImageArtifact(session.sessionId, `${task.taskCode}_keyframe`, imgRes.dataUrl);
        if (!saved) {
          throw new Error(`Engine ${lockedEngine} trả về định dạng ảnh không hợp lệ.`);
        }
        task.localOutputFileName = saved.fileName;
        task.localOutputUrl = saved.localUrl;
        task.resultSummary = `Đã tạo ảnh phân cảnh #${scene.sceneIndex} bằng ${imgRes.model} (độc lập · ${charRefs.length} ảnh nhân vật).`;
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
        task.resultSummary = `Đã sẵn sàng prompt Google Flow cho Cảnh #${scene.sceneIndex}. Hãy sao chép prompt, tạo video trên Google Flow rồi tải tệp MP4 lên ngay tại dòng này.`;
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
        const geminiWorker = lockedEngine === 'gemini' ? pickWorkerGeminiAccount() : null;

        const vidRes = await generateSceneVideoWithOmniFlash({
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
          geminiApiKey: geminiWorker?.apiKey,
          allowFreeCostumeChange: session.allowFreeCostumeChange,
          strictSingleFrameLock: true,
        });

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
        task.resultSummary = `Đã tạo xong video Cảnh #${scene.sceneIndex} (${vidRes.durationSec}s) bằng ${vidRes.model} từ ${imgTask?.taskCode || 'ảnh phân cảnh'}.`;
        task.status = 'HOAN_THANH';
        task.completedAt = Date.now();
        task.updatedAt = Date.now();
      }
    }

    // ── STEP 3: Direct Final Film Assembly (No cross-check / QA loop) ──
    else if (isFinalTask) {
      const videoTasks = session.tasks
        .filter((t) => t.taskCode.includes('-VID-'))
        .sort((a, b) => (a.sceneIndex || 0) - (b.sceneIndex || 0));
      const clipPaths: string[] = [];
      for (const vt of videoTasks) {
        if (vt.status !== 'HOAN_THANH' || !vt.localOutputFileName) continue;
        const fp = resolveCoordinationArtifactPath(session.sessionId, vt.localOutputFileName);
        if (fp) clipPaths.push(fp);
      }
      if (clipPaths.length === 0) {
        throw new Error('Chưa có clip phân cảnh nào hoàn thành để ghép phim MP4.');
      }
      const assembled = await assembleFinalFilmWithFfmpeg(session, clipPaths);
      task.localOutputFileName = assembled.fileName;
      task.localOutputUrl = assembled.localUrl;
      session.finalVideoLocalUrl = assembled.localUrl;
      task.resultSummary = `Đã ghép trực tiếp ${clipPaths.length} clip thành phim MP4 hoàn chỉnh.`;
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

  activeSessionRunners.add(session.sessionId);
  session.status = 'DANG_CHAY';
  session.lastError = undefined;
  session.updatedAt = Date.now();
  saveState(true);

  pushMeetingMessage({
    sessionId: session.sessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Khởi động dây chuyền tuần tự',
    kind: 'report',
    content: `Bắt đầu chạy tuần tự các tác vụ phiên ${session.sessionId} theo Sổ Điều Phối. Nguồn video khóa độc lập: ${SOURCE_LABELS[session.videoSource]}.`,
  });

  // Execute sequentially in background so HTTP request responds immediately while SSE streams every step
  void (async () => {
    try {
      while (!pauseRequestedSessions.has(session.sessionId)) {
        const nextTask = session.tasks.find((t) => {
          if (t.status !== 'CHO_NHAN') return false;
          return t.dependsOnTaskCodes.every((depCode) => {
            const dep = session.tasks.find((x) => x.taskCode === depCode);
            return dep?.status === 'HOAN_THANH';
          });
        });
        if (!nextTask) break;

        await runSingleCoordinationTask({
          sessionId: session.sessionId,
          taskCode: nextTask.taskCode,
          googleToken: params.googleToken,
        });
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
    content: `Đã nhận lệnh tạm dừng phiên ${sessionId}. Hệ thống sẽ dừng an toàn sau khi bước hiện tại hoàn tất.`,
  });

  return session;
}

export async function uploadFlowClipForTask(params: {
  sessionId: string;
  taskCode: string;
  fileName: string;
  buffer: Buffer;
  googleToken?: string;
}): Promise<CoordinationTaskRow> {
  const st = loadState();
  const session = st.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) throw new Error('Không tìm thấy phiên làm việc.');
  const task = session.tasks.find((t) => t.taskCode === params.taskCode);
  if (!task) throw new Error(`Không tìm thấy tác vụ ${params.taskCode}.`);

  const ext = path.extname(params.fileName || '.mp4').toLowerCase();
  const safeExt = ext === '.webm' || ext === '.mov' ? ext : '.mp4';
  const saved = saveBufferArtifact(session.sessionId, `${task.taskCode}_flow${safeExt}`, params.buffer);
  task.localOutputFileName = saved.fileName;
  task.localOutputUrl = saved.localUrl;
  task.status = 'HOAN_THANH';
  task.errorReason = undefined;
  task.completedAt = Date.now();
  task.updatedAt = Date.now();
  task.resultSummary = `Đã tiếp nhận video từ Google Flow (${(params.buffer.byteLength / (1024 * 1024)).toFixed(2)} MB) cho ${task.taskCode}.`;
  recomputeSessionStatus(session);
  session.updatedAt = Date.now();
  saveState(true);

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
    senderName: 'Google Flow · Veo (Độc lập)',
    senderRole: 'Bước 3 · Nạp clip hoàn tất',
    kind: 'completed',
    taskCode: task.taskCode,
    content: `[${task.taskCode}] ${task.resultSummary}`,
    referenceLink: task.driveOutputUrl || task.localOutputUrl,
  });

  return task;
}

// ==========================================
// 5. LIVE MEETING ROOM (PHÒNG HỌP TRỰC TIẾP)
// ==========================================

export async function postMeetingRoomMessage(params: {
  sessionId: string;
  content: string;
  googleToken?: string;
}): Promise<{ userMessage: MeetingRoomMessage; replyMessage: MeetingRoomMessage }> {
  const st = loadState();
  const cleanText = String(params.content || '').trim().slice(0, 2000);
  if (!cleanText) throw new Error('Vui lòng nhập nội dung trao đổi.');

  const session = st.sessions.find((s) => s.sessionId === params.sessionId) || st.sessions[0];
  const targetSessionId = session?.sessionId || 'GLOBAL';

  const userMessage = pushMeetingMessage({
    sessionId: targetSessionId,
    senderId: 'user',
    senderName: 'Quản trị viên',
    senderRole: 'Chỉ đạo trực tiếp',
    kind: 'user',
    content: cleanText,
  });

  // Deterministic, factual status reply grounded strictly in this session's ledger (zero hallucination!)
  let replyContent = '';
  if (!session) {
    replyContent =
      'Hiện chưa có phiên làm việc nào. Hãy đẩy kịch bản từ phòng Studio hoặc bấm "Tạo phiên mới" để lập bảng nhiệm vụ Google Sheets.';
  } else {
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
      `• Hồ sơ tham chiếu đã khóa: ${session.references.length} mục (${session.references.filter((r) => r.kind === 'character').length} nhân vật)${session.driveFolderUrl ? ` · Google Drive đã liên kết` : ' · Đang lưu cục bộ (chưa đồng bộ Drive)'}.`,
    ];

    if (failed.length > 0) {
      lines.push(
        `• Chi tiết tác vụ lỗi: ${failed.map((f) => `${f.taskCode} (${f.errorReason || 'không rõ lý do'})`).join('; ')}`
      );
    } else if (waitingFlow.length > 0) {
      lines.push(
        `• Đang chờ tải video Google Flow lên cho: ${waitingFlow.map((w) => w.taskCode).join(', ')}.`
      );
    } else if (queued.length > 0) {
      const nextRunnable = queued.find((q) =>
        q.dependsOnTaskCodes.every((d) => session.tasks.find((x) => x.taskCode === d)?.status === 'HOAN_THANH')
      );
      if (nextRunnable) {
        lines.push(`• Tác vụ kế tiếp đủ điều kiện nhận việc: ${nextRunnable.taskCode} (${nextRunnable.title}).`);
      }
    } else if (done.length === session.tasks.length) {
      lines.push('• Toàn bộ các bước đã hoàn tất và đã ghép xong phim hoàn chỉnh.');
    }
    replyContent = lines.join('\n');
  }

  const replyMessage = pushMeetingMessage({
    sessionId: targetSessionId,
    senderId: 'coordinator',
    senderName: 'Trung Tâm Điều Phối AI',
    senderRole: 'Báo cáo trực tiếp từ Sổ Sheets',
    kind: 'coordinator',
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

  return { userMessage, replyMessage };
}
