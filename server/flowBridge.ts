import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { CoordinationCenterState, CoordinationSession, CoordinationTaskRow } from '../src/types/coordinationCenter';

const DATA_DIR = path.join(process.cwd(), 'data');
const BRIDGE_CONFIG_FILE = path.join(DATA_DIR, 'flow_bridge_config.json');
const EXTENSION_EXPORT_DIR = path.join(process.cwd(), 'flow-bridge-extension');

export interface FlowBridgeConfig {
  token: string;
  createdAt: number;
  updatedAt: number;
}

export interface FlowBridgeLogEntry {
  id: string;
  at: number;
  level: 'info' | 'success' | 'error';
  message: string;
  taskCode?: string;
  sessionId?: string;
}

export interface FlowBridgeActiveLease {
  jobId: string;
  sessionId: string;
  taskCode: string;
  kind: 'image' | 'video';
  claimedAt: number;
  expiresAt: number;
  workerId: string;
}

export interface FlowBridgeStatusSnapshot {
  connected: boolean;
  status: 'online' | 'busy' | 'offline';
  token: string;
  maskedToken: string;
  lastHeartbeatAt: number | null;
  extensionVersion: string;
  activeTabUrl: string;
  flowTabReady: boolean;
  activeLease: FlowBridgeActiveLease | null;
  pendingJobsCount: number;
  stats: {
    completedImages: number;
    completedVideos: number;
    failedJobs: number;
  };
  recentLogs: FlowBridgeLogEntry[];
}

export interface FlowBridgeClaimedJob {
  jobId: string;
  sessionId: string;
  sessionTitle: string;
  taskCode: string;
  kind: 'image' | 'video';
  sceneIndex: number;
  sceneTitle: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  durationSec: number;
  prompt: string;
  referenceImages: Array<{
    name: string;
    role: 'keyframe' | 'character';
    mimeType: string;
    dataUrl: string;
  }>;
}

const HEARTBEAT_TTL_MS = 28_000;
const JOB_LEASE_TTL_MS = 8 * 60_000;

let bridgeConfigCache: FlowBridgeConfig | null = null;
let lastHeartbeatAt: number | null = null;
let extensionVersion = '';
let activeTabUrl = '';
let flowTabReady = false;
let activeLease: FlowBridgeActiveLease | null = null;
const bridgeStats = {
  completedImages: 0,
  completedVideos: 0,
  failedJobs: 0,
};
const bridgeLogs: FlowBridgeLogEntry[] = [];

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateSecureToken(): string {
  return `fb_${crypto.randomBytes(20).toString('hex')}`;
}

function maskToken(token: string): string {
  if (!token || token.length < 10) return '••••••••';
  return `${token.slice(0, 7)}••••••${token.slice(-4)}`;
}

export function getFlowBridgeConfig(): FlowBridgeConfig {
  if (bridgeConfigCache) return bridgeConfigCache;
  try {
    if (fs.existsSync(BRIDGE_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BRIDGE_CONFIG_FILE, 'utf8'));
      if (parsed && typeof parsed.token === 'string' && parsed.token.trim().length >= 12) {
        bridgeConfigCache = {
          token: parsed.token.trim(),
          createdAt: Number(parsed.createdAt) || Date.now(),
          updatedAt: Number(parsed.updatedAt) || Date.now(),
        };
        return bridgeConfigCache;
      }
    }
  } catch {
    // regenerate below
  }
  const now = Date.now();
  bridgeConfigCache = {
    token: generateSecureToken(),
    createdAt: now,
    updatedAt: now,
  };
  ensureDir(DATA_DIR);
  fs.writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(bridgeConfigCache, null, 2), 'utf8');
  return bridgeConfigCache;
}

export function rotateFlowBridgeToken(): FlowBridgeConfig {
  const now = Date.now();
  bridgeConfigCache = {
    token: generateSecureToken(),
    createdAt: bridgeConfigCache?.createdAt || now,
    updatedAt: now,
  };
  ensureDir(DATA_DIR);
  fs.writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(bridgeConfigCache, null, 2), 'utf8');
  activeLease = null;
  pushBridgeLog('info', 'Đã tạo mới Bridge Token. Hãy cập nhật token trong popup Extension Chrome.');
  return bridgeConfigCache;
}

export function verifyFlowBridgeToken(provided?: string | null): boolean {
  const clean = String(provided || '').trim();
  if (!clean) return false;
  const expected = getFlowBridgeConfig().token;
  if (clean.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected));
}

export function pushBridgeLog(
  level: 'info' | 'success' | 'error',
  message: string,
  meta?: { sessionId?: string; taskCode?: string }
): void {
  bridgeLogs.unshift({
    id: `fbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    level,
    message,
    sessionId: meta?.sessionId,
    taskCode: meta?.taskCode,
  });
  if (bridgeLogs.length > 60) {
    bridgeLogs.length = 60;
  }
}

function expireStaleLease(): void {
  if (activeLease && Date.now() > activeLease.expiresAt) {
    pushBridgeLog(
      'error',
      `Tác vụ ${activeLease.taskCode} quá hạn nhận kết quả (${Math.round(JOB_LEASE_TTL_MS / 60000)} phút), đã mở khóa để nhận lại.`,
      { sessionId: activeLease.sessionId, taskCode: activeLease.taskCode }
    );
    activeLease = null;
  }
}

export function isFlowBridgeOnline(): boolean {
  return Boolean(lastHeartbeatAt && Date.now() - lastHeartbeatAt <= HEARTBEAT_TTL_MS);
}

export function recordFlowBridgeHeartbeat(params: {
  extensionVersion?: string;
  activeTabUrl?: string;
  flowTabReady?: boolean;
  busyJobId?: string;
}): void {
  expireStaleLease();
  const wasOffline = !isFlowBridgeOnline();
  lastHeartbeatAt = Date.now();
  if (params.extensionVersion) extensionVersion = String(params.extensionVersion).slice(0, 32);
  if (typeof params.activeTabUrl === 'string') activeTabUrl = params.activeTabUrl.slice(0, 300);
  flowTabReady = Boolean(params.flowTabReady);
  if (!params.busyJobId && activeLease && Date.now() - activeLease.claimedAt > 15_000) {
    // Worker reported idle after grace period -> release lease cleanly
    activeLease = null;
  }
  if (wasOffline) {
    pushBridgeLog(
      'success',
      `Chrome Extension Flow Bridge đã kết nối (${extensionVersion || 'v1.0'})${flowTabReady ? ' · Tab Google Flow sẵn sàng' : ' · Chưa mở tab labs.google/fx'}.`
    );
  }
}

export function countPendingFlowJobs(state: CoordinationCenterState): number {
  let count = 0;
  for (const sess of state.sessions) {
    if (sess.status === 'HOAN_THANH') continue;
    for (const t of sess.tasks) {
      if (t.videoSourceLock !== 'google_flow') continue;
      if (t.status !== 'CHO_NHAP_FLOW') continue;
      const depsOk = t.dependsOnTaskCodes.every((depCode) => {
        const dep = sess.tasks.find((x) => x.taskCode === depCode);
        return dep?.status === 'HOAN_THANH';
      });
      if (depsOk) count += 1;
    }
  }
  return count;
}

export function getFlowBridgeStatus(state?: CoordinationCenterState): FlowBridgeStatusSnapshot {
  expireStaleLease();
  const cfg = getFlowBridgeConfig();
  const online = isFlowBridgeOnline();
  const status: 'online' | 'busy' | 'offline' = !online
    ? 'offline'
    : activeLease
    ? 'busy'
    : 'online';

  return {
    connected: online,
    status,
    token: cfg.token,
    maskedToken: maskToken(cfg.token),
    lastHeartbeatAt,
    extensionVersion,
    activeTabUrl,
    flowTabReady: online ? flowTabReady : false,
    activeLease,
    pendingJobsCount: state ? countPendingFlowJobs(state) : 0,
    stats: { ...bridgeStats },
    recentLogs: bridgeLogs.slice(0, 20),
  };
}

export function claimNextFlowBridgeJob(params: {
  state: CoordinationCenterState;
  workerId?: string;
  loadArtifactDataUrl: (sessionId: string, fileName?: string) => string | undefined;
}): FlowBridgeClaimedJob | null {
  expireStaleLease();
  if (activeLease) {
    return null;
  }

  const orderedSessions = [...params.state.sessions].reverse();
  let picked: { session: CoordinationSession; task: CoordinationTaskRow; kind: 'image' | 'video' } | null = null;

  // Priority pass: find first runnable CHO_NHAP_FLOW task (IMG before VID within each session)
  for (const session of orderedSessions) {
    if (session.status === 'HOAN_THANH') continue;
    for (const task of session.tasks) {
      if (task.videoSourceLock !== 'google_flow') continue;
      if (task.status !== 'CHO_NHAP_FLOW') continue;
      const depsOk = task.dependsOnTaskCodes.every((depCode) => {
        const dep = session.tasks.find((x) => x.taskCode === depCode);
        return dep?.status === 'HOAN_THANH';
      });
      if (!depsOk) continue;
      const isImg = task.taskCode.includes('-IMG-');
      const isVid = task.taskCode.includes('-VID-');
      if (!isImg && !isVid) continue;
      picked = { session, task, kind: isImg ? 'image' : 'video' };
      break;
    }
    if (picked) break;
  }

  if (!picked) return null;

  const { session, task, kind } = picked;
  const scene =
    session.scenes.find((sc) => sc.sceneId === task.sceneId || sc.sceneIndex === task.sceneIndex) ||
    session.scenes[0];

  const referenceImages: FlowBridgeClaimedJob['referenceImages'] = [];
  if (kind === 'video') {
    const imgTask = session.tasks.find(
      (t) =>
        t.taskCode.includes('-IMG-') &&
        (t.sceneId === task.sceneId || t.sceneIndex === task.sceneIndex) &&
        t.status === 'HOAN_THANH'
    );
    const keyframeDataUrl = params.loadArtifactDataUrl(session.sessionId, imgTask?.localOutputFileName);
    if (keyframeDataUrl) {
      const mimeMatch = keyframeDataUrl.match(/^data:([^;]+);base64,/);
      referenceImages.push({
        name: `keyframe_scene_${String(scene?.sceneIndex || 1).padStart(2, '0')}.png`,
        role: 'keyframe',
        mimeType: mimeMatch?.[1] || 'image/png',
        dataUrl: keyframeDataUrl,
      });
    }
  }

  for (const ref of session.references) {
    if (ref.kind !== 'character') continue;
    const dataUrl = params.loadArtifactDataUrl(session.sessionId, ref.localFileName);
    if (!dataUrl) continue;
    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
    referenceImages.push({
      name: `${ref.name.replace(/[^a-zA-Z0-9._-]/g, '_') || ref.refId}.png`,
      role: 'character',
      mimeType: mimeMatch?.[1] || 'image/png',
      dataUrl,
    });
  }

  const jobId = `fbj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  activeLease = {
    jobId,
    sessionId: session.sessionId,
    taskCode: task.taskCode,
    kind,
    claimedAt: now,
    expiresAt: now + JOB_LEASE_TTL_MS,
    workerId: String(params.workerId || 'chrome-ext').slice(0, 64),
  };

  pushBridgeLog(
    'info',
    `Extension đã nhận tác vụ ${kind === 'image' ? 'Tạo Ảnh' : 'Tạo Video'} [${task.taskCode}] (${session.sessionId}) · ${referenceImages.length} ảnh tham chiếu.`,
    { sessionId: session.sessionId, taskCode: task.taskCode }
  );

  return {
    jobId,
    sessionId: session.sessionId,
    sessionTitle: session.title,
    taskCode: task.taskCode,
    kind,
    sceneIndex: scene?.sceneIndex || task.sceneIndex || 1,
    sceneTitle: scene?.title || task.title,
    aspectRatio: session.aspectRatio,
    durationSec: scene?.durationSec || 6,
    prompt: task.flowPrompt || scene?.videoPrompt || scene?.imagePrompt || scene?.actionDetail || task.title,
    referenceImages: referenceImages.slice(0, 4),
  };
}

export function markFlowBridgeJobDone(kind: 'image' | 'video', sessionId: string, taskCode: string, byteLength: number): void {
  if (activeLease && activeLease.sessionId === sessionId && activeLease.taskCode === taskCode) {
    activeLease = null;
  }
  if (kind === 'image') bridgeStats.completedImages += 1;
  else bridgeStats.completedVideos += 1;
  const mb = (byteLength / (1024 * 1024)).toFixed(2);
  pushBridgeLog(
    'success',
    `Đã nhận ${kind === 'image' ? 'Ảnh' : 'Video'} từ Google Flow cho [${taskCode}] (${mb} MB) — tự động chạy bước kế tiếp.`,
    { sessionId, taskCode }
  );
}

export function markFlowBridgeJobFailed(sessionId: string, taskCode: string, error: string): void {
  if (activeLease && activeLease.sessionId === sessionId && activeLease.taskCode === taskCode) {
    activeLease = null;
  }
  bridgeStats.failedJobs += 1;
  pushBridgeLog('error', `Google Flow báo lỗi tại [${taskCode}]: ${error}`, { sessionId, taskCode });
}

// ============================================================
// CHROME EXTENSION (MANIFEST V3) GENERATOR — PRE-CONFIGURED
// ============================================================

export function buildFlowBridgeExtensionFiles(appUrl: string): Record<string, string> {
  const cfg = getFlowBridgeConfig();
  const cleanUrl = String(appUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');

  const manifestJson = JSON.stringify(
    {
      manifest_version: 3,
      name: 'Google Flow Auto-Bridge (Trung Tâm Điều Phối AI)',
      version: '1.1.0',
      description:
        'Cầu nối tự động tạo ảnh & video trên Google Flow (labs.google/fx) bằng tài khoản Chrome của bạn và gửi kết quả trực tiếp về Trung Tâm Điều Phối AI.',
      permissions: ['storage', 'alarms', 'tabs', 'scripting'],
      host_permissions: [
        'https://labs.google/*',
        'https://*.googleusercontent.com/*',
        'https://*.googleapis.com/*',
        'https://storage.googleapis.com/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
        'https://*.run.app/*',
      ],
      background: {
        service_worker: 'background.js',
      },
      action: {
        default_popup: 'popup.html',
        default_title: 'Google Flow Auto-Bridge',
      },
      content_scripts: [
        {
          matches: ['https://labs.google/fx/*'],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
    },
    null,
    2
  );

  const configJs = `// Tự động nhúng sẵn địa chỉ App & Bridge Token khi tải từ Trung Tâm Điều Phối AI
self.DEFAULT_FLOW_BRIDGE_CONFIG = {
  appUrl: ${JSON.stringify(cleanUrl)},
  token: ${JSON.stringify(cfg.token)},
  autoRun: true,
  pollIntervalSec: 6,
  version: '1.1.0'
};
`;

  const backgroundJs = `importScripts('config.js');

const STORAGE_KEY = 'flow_bridge_settings_v1';
const STATE_KEY = 'flow_bridge_runtime_v1';

let isClaimingOrRunning = false;
let currentJob = null;

async function getSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const saved = res[STORAGE_KEY] || {};
  return {
    appUrl: (saved.appUrl || self.DEFAULT_FLOW_BRIDGE_CONFIG.appUrl || '').replace(/\\/+$/, ''),
    token: (saved.token || self.DEFAULT_FLOW_BRIDGE_CONFIG.token || '').trim(),
    autoRun: saved.autoRun !== undefined ? Boolean(saved.autoRun) : true,
  };
}

async function saveRuntime(patch) {
  const prev = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*'] });
  if (!tabs || tabs.length === 0) return null;
  return tabs.find((t) => t.active) || tabs[0];
}

async function sendHeartbeat() {
  const cfg = await getSettings();
  if (!cfg.appUrl || !cfg.token) return false;
  const tab = await findFlowTab();
  try {
    const res = await fetch(cfg.appUrl + '/api/flow-bridge/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({
        extensionVersion: self.DEFAULT_FLOW_BRIDGE_CONFIG.version || '1.1.0',
        activeTabUrl: tab?.url || '',
        flowTabReady: Boolean(tab && tab.id),
        busyJobId: currentJob?.jobId || '',
      }),
    });
    const ok = res.ok;
    const data = ok ? await res.json().catch(() => ({})) : {};
    await saveRuntime({
      connected: ok,
      flowTabReady: Boolean(tab && tab.id),
      pendingJobsCount: data.pendingJobsCount ?? 0,
      lastHeartbeatAt: ok ? Date.now() : null,
      lastError: ok ? '' : 'HTTP ' + res.status + ' (Kiểm tra App URL hoặc Bridge Token)',
    });
    return ok;
  } catch (err) {
    await saveRuntime({
      connected: false,
      lastError: String(err?.message || 'Không kết nối được App'),
    });
    return false;
  }
}

async function uploadResultToApp(job, blob, fileName, mimeType) {
  const cfg = await getSettings();
  const arrayBuffer = await blob.arrayBuffer();
  const res = await fetch(cfg.appUrl + '/api/flow-bridge/complete', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType || blob.type || (job.kind === 'image' ? 'image/png' : 'video/mp4'),
      'X-Flow-Bridge-Token': cfg.token,
      'X-Session-Id': encodeURIComponent(job.sessionId),
      'X-Task-Code': encodeURIComponent(job.taskCode),
      'X-File-Name': encodeURIComponent(fileName || (job.kind === 'image' ? job.taskCode + '.png' : job.taskCode + '.mp4')),
      'X-Mime-Type': mimeType || blob.type || '',
    },
    body: arrayBuffer,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('App từ chối nhận kết quả (HTTP ' + res.status + '): ' + txt.slice(0, 160));
  }
  return await res.json().catch(() => ({ ok: true }));
}

async function reportJobFailure(job, reason) {
  const cfg = await getSettings();
  try {
    await fetch(cfg.appUrl + '/api/flow-bridge/fail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({
        sessionId: job.sessionId,
        taskCode: job.taskCode,
        error: String(reason || 'Lỗi không xác định trên Google Flow'),
      }),
    });
  } catch {
    // ignore network failure while reporting
  }
}

function dataUrlToBlob(dataUrl, fallbackMime) {
  const parts = String(dataUrl || '').split(',');
  const header = parts[0] || '';
  const b64 = parts[1] || '';
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : fallbackMime || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function pollAndExecuteNextJob() {
  if (isClaimingOrRunning) return;
  const cfg = await getSettings();
  if (!cfg.autoRun || !cfg.appUrl || !cfg.token) return;

  const tab = await findFlowTab();
  if (!tab || !tab.id) {
    await saveRuntime({ flowTabReady: false });
    return;
  }

  isClaimingOrRunning = true;
  try {
    const res = await fetch(cfg.appUrl + '/api/flow-bridge/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({ workerId: 'chrome-ext-' + tab.id }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (!data || !data.job) return;

    currentJob = data.job;
    await saveRuntime({
      activeJob: {
        jobId: currentJob.jobId,
        sessionId: currentJob.sessionId,
        taskCode: currentJob.taskCode,
        kind: currentJob.kind,
        sceneIndex: currentJob.sceneIndex,
      },
      lastStatusText: 'Đang gửi lệnh ' + currentJob.taskCode + ' sang tab Google Flow...',
    });

    // Ensure content script is alive in the Flow tab
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        type: 'FLOW_RUN_JOB',
        job: currentJob,
      });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 800));
      result = await chrome.tabs.sendMessage(tab.id, {
        type: 'FLOW_RUN_JOB',
        job: currentJob,
      });
    }

    if (!result || !result.ok) {
      const reason = result?.error || 'Tab Google Flow không trả về tệp kết quả.';
      await reportJobFailure(currentJob, reason);
      await saveRuntime({ lastStatusText: 'Lỗi ' + currentJob.taskCode + ': ' + reason, activeJob: null });
      return;
    }

    let blob;
    let mimeType = result.mimeType || (currentJob.kind === 'image' ? 'image/png' : 'video/mp4');
    if (result.dataUrl) {
      blob = dataUrlToBlob(result.dataUrl, mimeType);
      mimeType = blob.type || mimeType;
    } else if (result.mediaUrl) {
      const dl = await fetch(result.mediaUrl);
      if (!dl.ok) throw new Error('Không tải được media từ URL Google Flow (HTTP ' + dl.status + ')');
      blob = await dl.blob();
      mimeType = blob.type || mimeType;
    } else {
      throw new Error('Không có dữ liệu ảnh/video trả về từ tab Google Flow.');
    }

    const ext = mimeType.includes('webm')
      ? '.webm'
      : mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? '.jpg'
      : mimeType.includes('webp')
      ? '.webp'
      : currentJob.kind === 'image'
      ? '.png'
      : '.mp4';

    await uploadResultToApp(currentJob, blob, currentJob.taskCode + '_flow' + ext, mimeType);
    await saveRuntime({
      activeJob: null,
      lastStatusText: 'Hoàn tất ' + currentJob.taskCode + ' và đã gửi về App!',
    });
  } catch (err) {
    if (currentJob) {
      await reportJobFailure(currentJob, String(err?.message || err));
    }
    await saveRuntime({
      activeJob: null,
      lastStatusText: 'Lỗi thực thi: ' + String(err?.message || err),
    });
  } finally {
    currentJob = null;
    isClaimingOrRunning = false;
    void sendHeartbeat();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('flow_bridge_tick', { periodInMinutes: 0.15 });
  void sendHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('flow_bridge_tick', { periodInMinutes: 0.15 });
  void sendHeartbeat();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flow_bridge_tick') {
    void sendHeartbeat().then((ok) => {
      if (ok) void pollAndExecuteNextJob();
    });
  }
});

// Fast in-memory tick while service worker is warm
setInterval(() => {
  void sendHeartbeat().then((ok) => {
    if (ok) void pollAndExecuteNextJob();
  });
}, 6000);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'POPUP_PING') {
    void sendHeartbeat().then(async (ok) => {
      const runtime = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
      sendResponse({ ok, runtime });
    });
    return true;
  }
  if (msg?.type === 'POPUP_POLL_NOW') {
    void sendHeartbeat().then(() => pollAndExecuteNextJob()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'MANUAL_CAPTURE_SUBMIT') {
    (async () => {
      try {
        if (!currentJob) {
          sendResponse({ ok: false, error: 'Hiện không có tác vụ Flow nào đang chờ nhận.' });
          return;
        }
        const blob = msg.dataUrl
          ? dataUrlToBlob(msg.dataUrl, msg.mimeType)
          : await (await fetch(msg.mediaUrl)).blob();
        const ext = currentJob.kind === 'image' ? '.png' : '.mp4';
        await uploadResultToApp(currentJob, blob, currentJob.taskCode + '_manual' + ext, blob.type);
        currentJob = null;
        isClaimingOrRunning = false;
        await saveRuntime({ activeJob: null, lastStatusText: 'Đã gửi tệp thủ công về App!' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});
`;

  const contentJs = `(() => {
  if (window.__FLOW_AUTO_BRIDGE_LOADED__) return;
  window.__FLOW_AUTO_BRIDGE_LOADED__ = true;

  let hudEl = null;
  let hudStatusEl = null;
  let hudSubEl = null;
  let hudCaptureBtn = null;
  let activeJobRef = null;
  let manualResolveFn = null;

  function ensureHud() {
    if (hudEl && document.body.contains(hudEl)) return;
    hudEl = document.createElement('div');
    hudEl.id = 'n3on-flow-bridge-hud';
    hudEl.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'width:300px',
      'padding:12px 14px',
      'border-radius:14px',
      'background:rgba(10,14,28,0.94)',
      'color:#e2e8f0',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:12px',
      'border:1px solid rgba(34,211,238,0.45)',
      'box-shadow:0 12px 32px rgba(0,0,0,0.45)',
      'backdrop-filter:blur(8px)',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-weight:700;color:#22d3ee;margin-bottom:6px;';
    title.textContent = 'Flow Auto-Bridge · Đã kết nối';

    hudStatusEl = document.createElement('div');
    hudStatusEl.style.cssText = 'font-weight:600;color:#f8fafc;line-height:1.35;';
    hudStatusEl.textContent = 'Đang trực chờ lệnh từ Trung Tâm Điều Phối AI...';

    hudSubEl = document.createElement('div');
    hudSubEl.style.cssText = 'margin-top:4px;font-size:11px;color:#94a3b8;line-height:1.35;';
    hudSubEl.textContent = 'Giữ tab Google Flow này mở để tự động tạo ảnh & video.';

    hudCaptureBtn = document.createElement('button');
    hudCaptureBtn.type = 'button';
    hudCaptureBtn.textContent = 'Gửi ảnh/video mới nhất về App';
    hudCaptureBtn.style.cssText = [
      'display:none',
      'margin-top:8px',
      'width:100%',
      'padding:7px 10px',
      'border-radius:8px',
      'border:none',
      'background:#0891b2',
      'color:#fff',
      'font-weight:700',
      'font-size:11px',
      'cursor:pointer',
    ].join(';');
    hudCaptureBtn.addEventListener('click', async () => {
      if (!activeJobRef) return;
      setHud('Đang lấy tệp mới nhất trên trang...', 'Vui lòng chờ 2 giây');
      const captured = await captureLatestMedia(activeJobRef.kind, new Set());
      if (captured && manualResolveFn) {
        manualResolveFn(captured);
      } else {
        setHud('Chưa thấy ảnh/video mới trên trang Flow.', 'Hãy đợi Flow tạo xong rồi bấm lại.');
      }
    });

    hudEl.appendChild(title);
    hudEl.appendChild(hudStatusEl);
    hudEl.appendChild(hudSubEl);
    hudEl.appendChild(hudCaptureBtn);
    document.body.appendChild(hudEl);
  }

  function setHud(mainText, subText, showManualBtn) {
    ensureHud();
    if (hudStatusEl) hudStatusEl.textContent = mainText;
    if (hudSubEl && subText !== undefined) hudSubEl.textContent = subText;
    if (hudCaptureBtn && showManualBtn !== undefined) {
      hudCaptureBtn.style.display = showManualBtn ? 'block' : 'none';
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function snapshotExistingMedia() {
    const urls = new Set();
    document.querySelectorAll('video, video source').forEach((el) => {
      const s = el.currentSrc || el.getAttribute('src') || '';
      if (s) urls.add(s);
    });
    document.querySelectorAll('img').forEach((img) => {
      const s = img.currentSrc || img.src || '';
      if (s) urls.add(s);
    });
    return urls;
  }

  async function blobUrlToDataUrl(url, fallbackMime) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (blob.size < 2048) throw new Error('Tệp quá nhỏ (' + blob.size + ' bytes)');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ dataUrl: reader.result, mimeType: blob.type || fallbackMime });
      reader.onerror = () => reject(new Error('Không đọc được Blob media'));
      reader.readAsDataURL(blob);
    });
  }

  async function captureLatestMedia(kind, baselineUrls) {
    if (kind === 'video') {
      const videos = Array.from(document.querySelectorAll('video')).reverse();
      for (const v of videos) {
        const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
        if (!src || baselineUrls.has(src)) continue;
        if (src.startsWith('blob:') || src.startsWith('https://') || src.startsWith('http://')) {
          try {
            const payload = await blobUrlToDataUrl(src, 'video/mp4');
            return { ok: true, ...payload, mediaUrl: src };
          } catch {
            if (src.startsWith('https://')) {
              return { ok: true, mediaUrl: src, mimeType: 'video/mp4' };
            }
          }
        }
      }
      return null;
    }

    // Image mode: look for newly generated large image (ignore tiny icons/avatars/dataURLs uploaded by us)
    const imgs = Array.from(document.querySelectorAll('img')).reverse();
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || baselineUrls.has(src)) continue;
      if (!img.complete || img.naturalWidth < 320 || img.naturalHeight < 320) continue;
      if (src.includes('googleusercontent.com/a/')) continue; // skip Google avatar
      try {
        const payload = await blobUrlToDataUrl(src, 'image/png');
        return { ok: true, ...payload, mediaUrl: src };
      } catch {
        // Canvas fallback if CORS allows
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          return { ok: true, dataUrl, mimeType: 'image/png' };
        } catch {
          if (src.startsWith('https://')) {
            return { ok: true, mediaUrl: src, mimeType: 'image/png' };
          }
        }
      }
    }
    return null;
  }

  function findPromptInput() {
    const candidates = [
      ...Array.from(document.querySelectorAll('textarea')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
      ...Array.from(document.querySelectorAll('[role="textbox"]')),
    ].filter((el) => isVisible(el) && !el.closest('#n3on-flow-bridge-hud'));

    if (candidates.length === 0) return null;
    // Prefer largest/primary prompt box (usually bottom composer or main textarea)
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0];
  }

  async function fillPrompt(el, text) {
    el.focus();
    await sleep(150);
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    await sleep(250);
  }

  async function trySwitchFlowMode(kind) {
    const keywords =
      kind === 'image'
        ? ['image', 'tạo ảnh', 'create image', 'text to image', 'imagen']
        : ['frames to video', 'ingredients to video', 'text to video', 'video', 'tạo video'];
    const buttons = Array.from(document.querySelectorAll('button, [role="tab"], [role="option"]')).filter(
      (b) => isVisible(b) && !b.closest('#n3on-flow-bridge-hud')
    );
    for (const kw of keywords) {
      const hit = buttons.find((b) => (b.textContent || b.getAttribute('aria-label') || '').toLowerCase().includes(kw));
      if (hit && hit.getAttribute('aria-selected') !== 'true') {
        hit.click();
        await sleep(500);
        return true;
      }
    }
    return false;
  }

  async function tryAttachReferenceImages(refs) {
    if (!Array.isArray(refs) || refs.length === 0) return 0;
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
      (inp) => !inp.disabled && !inp.closest('#n3on-flow-bridge-hud')
    );
    if (fileInputs.length === 0) return 0;

    const dt = new DataTransfer();
    for (const ref of refs.slice(0, 3)) {
      try {
        const res = await fetch(ref.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], ref.name || 'reference.png', { type: ref.mimeType || blob.type || 'image/png' });
        dt.items.add(file);
      } catch {
        // skip invalid ref
      }
    }
    if (dt.files.length === 0) return 0;

    const targetInput = fileInputs[0];
    targetInput.files = dt.files;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1800);
    return dt.files.length;
  }

  function findSubmitButton(promptEl) {
    const allButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => isVisible(b) && !b.disabled && !b.closest('#n3on-flow-bridge-hud')
    );
    const labelPatterns = [
      /generate/i,
      /create/i,
      /send/i,
      /submit/i,
      /arrow_forward/i,
      /tạo/i,
    ];
    for (const pat of labelPatterns) {
      const match = allButtons.find((b) => {
        const txt = (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
        return pat.test(txt);
      });
      if (match) return match;
    }
    // Fallback: closest button inside same form/composer container as promptEl
    const container = promptEl?.closest('form') || promptEl?.parentElement?.parentElement;
    if (container) {
      const localBtns = Array.from(container.querySelectorAll('button')).filter((b) => isVisible(b) && !b.disabled);
      if (localBtns.length > 0) return localBtns[localBtns.length - 1];
    }
    return null;
  }

  async function runFlowJobOnPage(job) {
    activeJobRef = job;
    setHud(
      'Đang chạy [' + job.taskCode + '] · ' + (job.kind === 'image' ? 'Tạo Ảnh Flow' : 'Tạo Video Veo'),
      'Phiên ' + job.sessionId + ' — Đang chuẩn bị khung nhập...',
      true
    );

    await trySwitchFlowMode(job.kind);

    const promptEl = findPromptInput();
    if (!promptEl) {
      return {
        ok: false,
        error: 'Không tìm thấy ô nhập prompt trên trang Google Flow. Hãy mở đúng màn hình tạo dự án trên labs.google/fx/tools/flow.',
      };
    }

    if (job.referenceImages && job.referenceImages.length > 0) {
      setHud(
        '[' + job.taskCode + '] Đang nạp ' + job.referenceImages.length + ' ảnh tham chiếu...',
        'Đang tải ảnh khóa nhân vật / keyframe lên Flow',
        true
      );
      await tryAttachReferenceImages(job.referenceImages);
    }

    // Snapshot AFTER uploading refs so uploaded thumbnails aren't mistaken for generated output
    const baselineUrls = snapshotExistingMedia();

    setHud('[' + job.taskCode + '] Đang điền prompt & bấm Generate...', job.prompt.slice(0, 90) + '...', true);
    await fillPrompt(promptEl, job.prompt);

    const submitBtn = findSubmitButton(promptEl);
    if (submitBtn) {
      submitBtn.click();
    } else {
      promptEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
      );
    }

    const maxWaitMs = job.kind === 'image' ? 180_000 : 360_000;
    const startedAt = Date.now();

    const waitPromise = new Promise((resolve) => {
      manualResolveFn = resolve;
      const timer = setInterval(async () => {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        setHud(
          '[' + job.taskCode + '] Đang chờ Google Flow render (' + elapsedSec + 's)...',
          'Tự động bắt ' + (job.kind === 'image' ? 'ảnh' : 'video MP4') + ' ngay khi xuất hiện (hoặc bấm nút dưới để gửi ngay).',
          true
        );

        const found = await captureLatestMedia(job.kind, baselineUrls);
        if (found && found.ok) {
          clearInterval(timer);
          manualResolveFn = null;
          resolve(found);
          return;
        }
        if (Date.now() - startedAt > maxWaitMs) {
          clearInterval(timer);
          manualResolveFn = null;
          resolve({
            ok: false,
            error: 'Quá thời gian chờ Google Flow render (' + Math.round(maxWaitMs / 1000) + 's).',
          });
        }
      }, 3000);
    });

    const outcome = await waitPromise;
    activeJobRef = null;
    if (outcome?.ok) {
      setHud('Đã hoàn tất [' + job.taskCode + ']!', 'Đang đẩy tệp về Trung Tâm Điều Phối AI...', false);
    } else {
      setHud('Tác vụ [' + job.taskCode + '] chưa hoàn tất', outcome?.error || '', false);
    }
    return outcome;
  }

  ensureHud();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'FLOW_RUN_JOB' && msg.job) {
      void runFlowJobOnPage(msg.job).then((res) => sendResponse(res));
      return true;
    }
  });
})();
`;

  const popupHtml = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Google Flow Auto-Bridge</title>
  <style>
    body { width: 340px; margin: 0; padding: 14px; font-family: system-ui, -apple-system, sans-serif; background: #0a0f1e; color: #e2e8f0; font-size: 12px; }
    h1 { margin: 0 0 8px; font-size: 14px; color: #22d3ee; display: flex; justify-content: space-between; align-items: center; }
    .badge { font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 700; }
    .on { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.45); }
    .off { background: rgba(244,63,94,0.2); color: #fb7185; border: 1px solid rgba(244,63,94,0.45); }
    label { display: block; margin-top: 8px; font-weight: 600; color: #94a3b8; font-size: 11px; }
    input[type="text"] { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border-radius: 8px; border: 1px solid #334155; background: #111827; color: #f8fafc; font-size: 11px; }
    .row { display: flex; gap: 6px; margin-top: 10px; }
    button { flex: 1; padding: 8px 10px; border-radius: 8px; border: none; font-weight: 700; font-size: 11px; cursor: pointer; }
    .primary { background: #0891b2; color: white; }
    .secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
    .status { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #111827; border: 1px solid #1e293b; font-size: 11px; line-height: 1.45; }
    .chk { display: flex; align-items: center; gap: 6px; margin-top: 10px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>
    <span>Flow Auto-Bridge</span>
    <span id="connBadge" class="badge off">Đang kiểm tra</span>
  </h1>
  <label>Địa chỉ App (Trung Tâm Điều Phối AI)</label>
  <input id="appUrl" type="text" placeholder="http://127.0.0.1:6868 hoặc https://..." />
  <label>Bridge Token</label>
  <input id="token" type="text" placeholder="fb_..." />
  <label class="chk">
    <input id="autoRun" type="checkbox" checked />
    <span>Tự động nhận &amp; chạy tác vụ Google Flow (Ảnh + Video)</span>
  </label>
  <div class="row">
    <button id="saveBtn" class="primary">Lưu &amp; Kết nối</button>
    <button id="openFlowBtn" class="secondary">Mở Google Flow</button>
  </div>
  <div id="statusBox" class="status">Đang kết nối tới App...</div>
  <script src="config.js"></script>
  <script src="popup.js"></script>
</body>
</html>
`;

  const popupJs = `const STORAGE_KEY = 'flow_bridge_settings_v1';

async function loadPopup() {
  const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const defaults = self.DEFAULT_FLOW_BRIDGE_CONFIG || {};
  document.getElementById('appUrl').value = saved.appUrl || defaults.appUrl || '';
  document.getElementById('token').value = saved.token || defaults.token || '';
  document.getElementById('autoRun').checked = saved.autoRun !== undefined ? Boolean(saved.autoRun) : true;
  refreshStatus();
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'POPUP_PING' }, (res) => {
    const badge = document.getElementById('connBadge');
    const box = document.getElementById('statusBox');
    if (res && res.ok) {
      badge.textContent = 'Trực tuyến';
      badge.className = 'badge on';
      const rt = res.runtime || {};
      const lines = [
        'Tab Google Flow: ' + (rt.flowTabReady ? 'ĐÃ MỞ & SẴN SÀNG' : 'Chưa mở (bấm Mở Google Flow)'),
        'Tác vụ Flow đang chờ: ' + (rt.pendingJobsCount ?? 0),
        rt.activeJob ? 'Đang xử lý: ' + rt.activeJob.taskCode + ' (' + rt.activeJob.kind + ')' : '',
        rt.lastStatusText ? 'Trạng thái: ' + rt.lastStatusText : '',
      ].filter(Boolean);
      box.textContent = lines.join(' · ');
    } else {
      badge.textContent = 'Ngoại tuyến';
      badge.className = 'badge off';
      box.textContent = (res?.runtime?.lastError) || 'Không kết nối được App. Kiểm tra App URL & Token.';
    }
  });
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const appUrl = document.getElementById('appUrl').value.trim().replace(/\\/+$/, '');
  const token = document.getElementById('token').value.trim();
  const autoRun = document.getElementById('autoRun').checked;
  await chrome.storage.local.set({ [STORAGE_KEY]: { appUrl, token, autoRun } });
  chrome.runtime.sendMessage({ type: 'POPUP_POLL_NOW' }, () => refreshStatus());
});

document.getElementById('openFlowBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
});

loadPopup();
`;

  const readmeTxt = `HƯỚNG DẪN CÀI ĐẶT GOOGLE FLOW AUTO-BRIDGE (CHROME EXTENSION)
=============================================================

Gói Extension này đã tự động cấu hình sẵn:
- App URL: ${cleanUrl}
- Bridge Token: ${cfg.token}

CÁCH CÀI TRONG 30 GIÂY:
1. Giải nén tệp ZIP này thành một thư mục trên máy tính.
2. Mở trình duyệt Chrome đã đăng nhập tài khoản Google Flow (labs.google/fx/tools/flow).
3. Truy cập: chrome://extensions
4. Bật công tắc "Developer mode" (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
5. Bấm "Load unpacked" (Tải tiện ích đã giải nén) và chọn thư mục vừa giải nén.
6. Mở tab https://labs.google/fx/tools/flow (vào 1 dự án mới) và để tab đó mở.
7. Quay lại App → Trung Tâm Điều Phối AI → Chọn nguồn "Google Flow · Veo" và bấm Chạy:
   Extension sẽ tự động nạp ảnh nhân vật, điền prompt, tạo ảnh/video trên Flow và đẩy file về App ghép phim!
`;

  return {
    'manifest.json': manifestJson,
    'config.js': configJs,
    'background.js': backgroundJs,
    'content.js': contentJs,
    'popup.html': popupHtml,
    'popup.js': popupJs,
    'README_CAI_DAT.txt': readmeTxt,
  };
}

export function writeFlowBridgeExtensionToWorkspace(appUrl: string): string {
  const files = buildFlowBridgeExtensionFiles(appUrl);
  ensureDir(EXTENSION_EXPORT_DIR);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(EXTENSION_EXPORT_DIR, name), content, 'utf8');
  }
  return EXTENSION_EXPORT_DIR;
}
