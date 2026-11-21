import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import {
  chatWithMuse2ApiSpark,
  getMuse2ApiStatus,
  listMuse2ApiAccounts,
  resolveMuse2ApiConfig,
  setMuse2ApiRuntimeOverride,
} from './muse2api';
import {
  formatGeminiError,
  generateSceneVideoWithOmniFlash,
  generateStudioImage,
  getGeminiClient,
  markGeminiModelOverloaded,
  parseAiBlueprintJsonSafe,
  prioritizeGeminiCandidateModels,
  probeDurationSeconds,
  probeHasAudioStream,
  retryWithGeminiBackoff,
  shouldFallbackGeminiModel,
} from './derivative';
import type {
  CharacterFivePartProfile,
  DerivativeAspectRatio,
  StudioProductionFormat,
  StudioVideoStyle,
} from '../src/types/bilibili';
import type {
  CloudOrchestratorConfig,
  CommandActivityLog,
  CommandBackupRecord,
  CommandCenterState,
  CommandCenterSummaryMetrics,
  CommandMemoryCharacter,
  CommandMemoryScene,
  CommandTask,
  CommandTaskStatus,
  CommandTaskType,
  ConversationMessage,
  MuseAgentConfig,
  MuseAgentEngineMode,
  MuseAgentId,
  MuseAgentPermissions,
  MuseAgentStatus,
  MuseIntegrationHealth,
  ProductionRun,
  ProjectMemory,
  ProjectMemorySnapshot,
  QaCriterionId,
  QaCriterionResult,
  QaInspectionReport,
} from '../src/types/commandCenter';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'muse_command_center.json');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'command_center_artifacts');
const BACKUPS_DIR = path.join(DATA_DIR, 'command_center_backups');
const STUDIO_ASSETS_DIR = path.join(process.cwd(), 'studio_assets');
const WORKER_BOOT_ID = `worker_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;

interface PersistedCommandCenterDoc {
  agents: MuseAgentConfig[];
  projectMemory: ProjectMemory;
  runs: ProductionRun[];
  tasks: CommandTask[];
  qaReports: QaInspectionReport[];
  conversations: ConversationMessage[];
  logs: CommandActivityLog[];
  backups: CommandBackupRecord[];
  cloudConfig: CloudOrchestratorConfig & { customMuse2ApiKey?: string };
  taskSeq: number;
}

const DEFAULT_AGENTS: MuseAgentConfig[] = [
  {
    id: 'muse-01',
    code: 'Muse AI 01',
    name: 'Muse AI 01',
    role: 'director',
    roleTitle: 'Tổng đạo diễn',
    description:
      'AI điều phối trưởng: nhận lệnh sản xuất, phân tích kịch bản tổng thể, chia việc song song, quản lý Project Memory và tổng hợp phim hoàn chỉnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api',
    status: 'offline',
    paused: false,
    permissions: {
      canModifyProjectMemory: true,
      canApproveQa: false,
      canExecuteMedia: false,
      allowedDataScopes: ['project_memory:rw', 'tasks:dispatch', 'runs:control', 'chat:all'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-02',
    code: 'Muse AI 02',
    name: 'Muse AI 02',
    role: 'screenwriter',
    roleTitle: 'Biên kịch',
    description:
      'Phân tích kịch bản, hồ sơ nhân vật 5 thành phần, giọng nói theo độ tuổi, lời thoại, bối cảnh, timeline theo giây và cấu trúc phân cảnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api',
    status: 'offline',
    paused: false,
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: false,
      canExecuteMedia: false,
      allowedDataScopes: ['project_memory:propose_script', 'chat:screenwriter', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-03',
    code: 'Muse AI 03',
    name: 'Muse AI 03',
    role: 'image_designer',
    roleTitle: 'Thiết kế hình ảnh',
    description:
      'Tạo ảnh tham chiếu nhân vật và ảnh keyframe phân cảnh, giữ đồng bộ gương mặt, vóc dáng, trang phục và bối cảnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api',
    status: 'offline',
    paused: false,
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: false,
      canExecuteMedia: true,
      allowedDataScopes: ['project_memory:read', 'artifacts:write_image', 'chat:image', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-04',
    code: 'Muse AI 04',
    name: 'Muse AI 04',
    role: 'video_director',
    roleTitle: 'Đạo diễn hình ảnh & video',
    description:
      'Sản xuất video phân cảnh theo timeline từng giây, chuyển động, góc quay, lời thoại, khẩu hình và nối cảnh liên tục.',
    boundAccountId: 'auto',
    engineMode: 'muse2api',
    status: 'offline',
    paused: false,
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: false,
      canExecuteMedia: true,
      allowedDataScopes: ['project_memory:read', 'artifacts:write_video', 'chat:video', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-05',
    code: 'Muse AI 05',
    name: 'Muse AI 05',
    role: 'qa_supervisor',
    roleTitle: 'Giám sát chất lượng',
    description:
      'AI kiểm định độc lập: đối chiếu 8 tiêu chí đồng nhất toàn phim, phát hiện sai lệch và yêu cầu tạo lại đúng phân cảnh lỗi.',
    boundAccountId: 'auto',
    engineMode: 'muse2api',
    status: 'offline',
    paused: false,
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: true,
      canExecuteMedia: false,
      allowedDataScopes: ['project_memory:read', 'qa_reports:write', 'tasks:reject_retry', 'chat:qa', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
];

function createEmptyProjectMemory(): ProjectMemory {
  return {
    projectId: `proj_${Date.now().toString(36)}`,
    title: 'Dự án sản xuất mới',
    version: 1,
    updatedAt: Date.now(),
    updatedByAgentId: 'system',
    originalScript: '',
    productionFormat: 'dialogue_film',
    aspectRatio: '16:9',
    videoStyle: 'cinematic',
    visualBible: '',
    settingBible: '',
    costumeBible: '',
    continuityBible: '',
    timelineSummary: '',
    characters: [],
    scenes: [],
    snapshots: [],
  };
}

function isLocalhostUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0' || h === '::1';
  } catch {
    return true;
  }
}

function createDefaultDoc(): PersistedCommandCenterDoc {
  const cfg = resolveMuse2ApiConfig();
  return {
    agents: structuredClone(DEFAULT_AGENTS),
    projectMemory: createEmptyProjectMemory(),
    runs: [],
    tasks: [],
    qaReports: [],
    conversations: [],
    logs: [],
    backups: [],
    cloudConfig: {
      muse2ApiBaseUrl: cfg.baseUrl,
      customMuse2ApiKey: '',
      hasCustomMuse2ApiKey: false,
      maskedMuse2ApiKey: cfg.maskedKey,
      parallelLimit: 2,
      qaPassThreshold: 80,
      maxRetriesPerScene: 2,
      autoBackupRealtime: true,
      workerHeartbeatAt: Date.now(),
      workerBootId: WORKER_BOOT_ID,
      isCloudEndpoint: !isLocalhostUrl(cfg.baseUrl),
    },
    taskSeq: 1,
  };
}

let storeDoc: PersistedCommandCenterDoc = createDefaultDoc();
let cachedHealth: MuseIntegrationHealth | null = null;
let lastHealthCheckAt = 0;
let orchestratorTimer: NodeJS.Timeout | null = null;
let isTicking = false;
const activeTaskIds = new Set<string>();
let lastAutoBackupAt = 0;

function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function maskSecret(val: string): string {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function saveStateAtomic(): void {
  ensureDirs();
  try {
    const tmpPath = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(storeDoc, null, 2), 'utf8');
    fs.renameSync(tmpPath, STATE_FILE);
  } catch {
    // ignore disk error silently to keep worker loop alive
  }
}

function addActivityLog(
  level: CommandActivityLog['level'],
  action: string,
  detail: string,
  extra?: { agentId?: MuseAgentId | 'system'; taskId?: string; runId?: string }
): void {
  const entry: CommandActivityLog = {
    id: `log_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
    level,
    agentId: extra?.agentId || 'system',
    taskId: extra?.taskId,
    runId: extra?.runId,
    action,
    detail,
  };
  storeDoc.logs.unshift(entry);
  if (storeDoc.logs.length > 400) {
    storeDoc.logs = storeDoc.logs.slice(0, 400);
  }
}

function appendConversationMessage(msg: Omit<ConversationMessage, 'id' | 'createdAt'>): ConversationMessage {
  const full: ConversationMessage = {
    ...msg,
    id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
  };
  storeDoc.conversations.push(full);
  if (storeDoc.conversations.length > 1000) {
    storeDoc.conversations = storeDoc.conversations.slice(-1000);
  }
  return full;
}

function createBackupSnapshot(
  kind: CommandBackupRecord['kind'],
  summary: string,
  runId?: string
): CommandBackupRecord {
  ensureDirs();
  const rec: CommandBackupRecord = {
    id: `bkp_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
    kind,
    projectId: storeDoc.projectMemory.projectId,
    runId,
    summary,
    messageCount: storeDoc.conversations.length,
    taskCount: storeDoc.tasks.length,
    memoryVersion: storeDoc.projectMemory.version,
  };
  const payload = {
    backup: rec,
    exportedAt: Date.now(),
    agents: storeDoc.agents,
    projectMemory: storeDoc.projectMemory,
    runs: storeDoc.runs,
    tasks: storeDoc.tasks,
    qaReports: storeDoc.qaReports,
    conversations: storeDoc.conversations,
    logs: storeDoc.logs.slice(0, 150),
  };
  try {
    fs.writeFileSync(path.join(BACKUPS_DIR, `${rec.id}.json`), JSON.stringify(payload, null, 2), 'utf8');
    storeDoc.backups.unshift(rec);
    if (storeDoc.backups.length > 50) {
      const removed = storeDoc.backups.splice(50);
      for (const old of removed) {
        const oldFile = path.join(BACKUPS_DIR, `${old.id}.json`);
        if (fs.existsSync(oldFile)) {
          fs.unlink(oldFile, () => {});
        }
      }
    }
  } catch {
    // ignore
  }
  return rec;
}

function maybeAutoBackup(reason: string, runId?: string, force = false): void {
  if (!storeDoc.cloudConfig.autoBackupRealtime && !force) return;
  const now = Date.now();
  if (!force && now - lastAutoBackupAt < 25_000) return;
  lastAutoBackupAt = now;
  createBackupSnapshot('auto', reason, runId);
}

function commitProjectMemoryUpdate(
  authorAgentId: string,
  summary: string,
  updater: (mem: ProjectMemory) => void
): number {
  const mem = storeDoc.projectMemory;
  const snap: ProjectMemorySnapshot = {
    id: `memsnap_v${mem.version}_${Date.now().toString(36)}`,
    version: mem.version,
    createdAt: Date.now(),
    authorAgentId: mem.updatedByAgentId || authorAgentId,
    summary: `Bản lưu trước cập nhật (${summary})`,
    data: {
      title: mem.title,
      originalScript: mem.originalScript,
      productionFormat: mem.productionFormat,
      aspectRatio: mem.aspectRatio,
      videoStyle: mem.videoStyle,
      visualBible: mem.visualBible,
      settingBible: mem.settingBible,
      costumeBible: mem.costumeBible,
      continuityBible: mem.continuityBible,
      timelineSummary: mem.timelineSummary,
      characters: structuredClone(mem.characters),
      scenes: structuredClone(mem.scenes),
    },
  };
  mem.snapshots.unshift(snap);
  if (mem.snapshots.length > 25) {
    mem.snapshots = mem.snapshots.slice(0, 25);
  }
  updater(mem);
  mem.version += 1;
  mem.updatedAt = Date.now();
  mem.updatedByAgentId = authorAgentId;
  saveStateAtomic();
  return mem.version;
}

function nextTaskCode(): string {
  const code = `TASK-${String(storeDoc.taskSeq).padStart(3, '0')}`;
  storeDoc.taskSeq += 1;
  return code;
}

function enqueueTask(input: {
  runId: string;
  type: CommandTaskType;
  title: string;
  instructions: string;
  assignedAgentId: MuseAgentId;
  dependsOnTaskIds?: string[];
  sceneId?: string;
  sceneIndex?: number;
  characterId?: string;
  priority?: number;
  maxRetries?: number;
}): CommandTask {
  const deps = (input.dependsOnTaskIds || []).filter(Boolean);
  const depsDone = deps.every((depId) => {
    const dep = storeDoc.tasks.find((t) => t.id === depId);
    return dep?.status === 'completed';
  });
  const task: CommandTask = {
    id: `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    code: nextTaskCode(),
    runId: input.runId,
    type: input.type,
    title: input.title,
    instructions: input.instructions,
    assignedAgentId: input.assignedAgentId,
    dependsOnTaskIds: deps,
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    characterId: input.characterId,
    status: depsDone ? 'queued' : 'blocked_by_deps',
    priority: input.priority ?? 10,
    retryCount: 0,
    maxRetries: input.maxRetries ?? storeDoc.cloudConfig.maxRetriesPerScene,
    createdAt: Date.now(),
  };
  storeDoc.tasks.push(task);
  if (storeDoc.tasks.length > 500) {
    storeDoc.tasks = storeDoc.tasks.slice(-500);
  }
  return task;
}

async function checkFfmpegQuick(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      const timer = setTimeout(() => {
        try {
          p.kill();
        } catch {
          // ignore
        }
        resolve(false);
      }, 3000);
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      p.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

export async function refreshIntegrationHealth(force = false): Promise<MuseIntegrationHealth> {
  const now = Date.now();
  if (!force && cachedHealth && now - lastHealthCheckAt < 6000) {
    return cachedHealth;
  }

  const museStatus = await getMuse2ApiStatus();
  let accounts: MuseIntegrationHealth['accounts'] = Array.isArray(museStatus.accounts)
    ? museStatus.accounts.map((a: any) => ({
        id: String(a.id || ''),
        label: String(a.label || a.id || 'Muse Account'),
        enabled: a.enabled !== false,
        ok: a.ok,
        status: a.status,
        error: a.error,
        quotaText: a.quota ? JSON.stringify(a.quota) : undefined,
      }))
    : [];

  if (museStatus.reachable && accounts.length === 0) {
    try {
      const accRes = await listMuse2ApiAccounts();
      if (Array.isArray(accRes?.accounts)) {
        accounts = accRes.accounts.map((a: any) => ({
          id: String(a.id || ''),
          label: String(a.label || a.id || 'Muse Account'),
          enabled: a.enabled !== false,
          ok: a.ok,
          status: a.status,
          error: a.error,
        }));
      }
    } catch {
      // ignore
    }
  }

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const ffmpegAvailable = await checkFfmpegQuick();
  const cfg = resolveMuse2ApiConfig();
  const warnings: string[] = [];

  if (!museStatus.reachable) {
    warnings.push(
      `Muse2API (${cfg.baseUrl}) hiện đang ngoại tuyến. Hãy khởi chạy Muse2API hoặc nhập URL Cloud Server trong mục Cấu hình Cloud & Tài khoản.`
    );
  } else if (museStatus.status === 'auth_error') {
    warnings.push(museStatus.error || 'Sai MUSE2API_KEY kết nối tới máy chủ Muse2API.');
  } else if (museStatus.healthyAccounts === 0) {
    warnings.push('Muse2API đã kết nối nhưng chưa có tài khoản Muse.ai khỏe mạnh. Hãy nạp cookie tài khoản Muse.ai.');
  }

  if (isLocalhostUrl(cfg.baseUrl)) {
    warnings.push(
      'Địa chỉ Muse2API hiện tại là localhost (127.0.0.1). Để 5 Muse AI tiếp tục chạy độc lập khi bạn tắt máy tính cá nhân, cần triển khai máy chủ điều phối + Muse2API lên Cloud Server (HTTPS/VPS).'
    );
  }
  if (!ffmpegAvailable) {
    warnings.push('Không phát hiện FFmpeg trên máy chủ — chức năng trích khung hình kiểm định và ghép phim MP4 sẽ bị hạn chế.');
  }

  cachedHealth = {
    muse2ApiReachable: museStatus.reachable,
    muse2ApiReady: museStatus.ready,
    muse2ApiStatus: museStatus.status,
    muse2ApiBaseUrl: cfg.baseUrl,
    accountsCount: museStatus.accountsCount,
    healthyAccounts: museStatus.healthyAccounts,
    accounts,
    geminiConfigured,
    ffmpegAvailable,
    warnings,
    checkedAt: Date.now(),
  };
  lastHealthCheckAt = Date.now();
  return cachedHealth;
}

function isAgentAccountReady(agent: MuseAgentConfig, health: MuseIntegrationHealth): boolean {
  if (health.muse2ApiReachable && health.muse2ApiStatus === 'ready') {
    if (agent.boundAccountId && agent.boundAccountId !== 'auto') {
      const found = health.accounts.find((a) => a.id === agent.boundAccountId);
      if (found) {
        return found.enabled && found.ok !== false;
      }
    }
    if (health.healthyAccounts > 0 || health.accounts.some((a) => a.enabled)) {
      return true;
    }
  }
  if (agent.engineMode === 'muse2api_with_gemini_fallback' && health.geminiConfigured) {
    return true;
  }
  return false;
}

function computeAgentLiveStatuses(health: MuseIntegrationHealth): void {
  const runningTasks = storeDoc.tasks.filter((t) => t.status === 'running');
  const blockedTasks = storeDoc.tasks.filter((t) => t.status === 'blocked_by_deps' || t.status === 'queued');

  for (const agent of storeDoc.agents) {
    const runningForAgent = runningTasks.find((t) => t.assignedAgentId === agent.id);
    if (agent.paused) {
      agent.status = 'paused';
      agent.currentTaskId = undefined;
      agent.currentTaskSummary = undefined;
      continue;
    }
    if (runningForAgent) {
      agent.status = agent.role === 'qa_supervisor' ? 'supervising' : 'working';
      agent.currentTaskId = runningForAgent.id;
      agent.currentTaskSummary = `${runningForAgent.code}: ${runningForAgent.title}`;
      continue;
    }
    agent.currentTaskId = undefined;
    agent.currentTaskSummary = undefined;

    const ready = isAgentAccountReady(agent, health);
    if (!ready) {
      agent.status = agent.lastError ? 'error' : 'offline';
      continue;
    }
    const hasPendingWork = blockedTasks.some((t) => t.assignedAgentId === agent.id);
    if (hasPendingWork) {
      agent.status = 'waiting';
    } else if (agent.role === 'qa_supervisor' && storeDoc.runs.some((r) => ['planning', 'producing', 'inspecting'].includes(r.status))) {
      agent.status = 'supervising';
    } else {
      agent.status = 'online';
    }
  }
}

function saveArtifactBuffer(prefix: string, ext: string, buf: Buffer): { fileName: string; url: string; filePath: string } {
  ensureDirs();
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  const fileName = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${safeExt}`;
  const filePath = path.join(ARTIFACTS_DIR, fileName);
  fs.writeFileSync(filePath, buf);
  return {
    fileName,
    filePath,
    url: `/api/command-center/artifacts/${encodeURIComponent(fileName)}`,
  };
}

function saveDataUrlArtifact(prefix: string, dataUrl: string): { fileName: string; url: string; filePath: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : '.png';
  return saveArtifactBuffer(prefix, ext, buf);
}

function artifactUrlToDataUrl(artifactUrl?: string): string | undefined {
  if (!artifactUrl) return undefined;
  if (artifactUrl.startsWith('data:')) return artifactUrl;
  const name = decodeURIComponent(artifactUrl.split('/').pop() || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!name) return undefined;
  const candidatePaths = [path.join(ARTIFACTS_DIR, name), path.join(STUDIO_ASSETS_DIR, name)];
  for (const fp of candidatePaths) {
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
      const buf = fs.readFileSync(fp);
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  }
  return undefined;
}

function artifactUrlToDiskPath(artifactUrl?: string): string | undefined {
  if (!artifactUrl) return undefined;
  const clean = artifactUrl.split('?')[0];
  const base = decodeURIComponent(clean.split('/').pop() || '');
  if (clean.includes('/api/studio/assets/')) {
    if (fs.existsSync(STUDIO_ASSETS_DIR)) {
      const match = fs.readdirSync(STUDIO_ASSETS_DIR).find((f) => f.startsWith(base));
      if (match) return path.join(STUDIO_ASSETS_DIR, match);
    }
  }
  const safeName = base.replace(/[^a-zA-Z0-9._-]/g, '');
  const p1 = path.join(ARTIFACTS_DIR, safeName);
  if (fs.existsSync(p1)) return p1;
  return undefined;
}

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { cwd: ARTIFACTS_DIR });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('FFmpeg xử lý vượt quá thời gian cho phép.'));
    }, timeoutMs);
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
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

async function extractFramesFromVideoDisk(videoPath: string, count = 3): Promise<string[]> {
  if (!fs.existsSync(videoPath)) return [];
  const dur = await probeDurationSeconds(videoPath, ARTIFACTS_DIR);
  const safeDur = Math.max(1.5, dur || 5);
  const ratios = count === 1 ? [0.85] : [0.12, 0.5, 0.85];
  const frames: string[] = [];

  for (let i = 0; i < ratios.length; i += 1) {
    const ts = Math.max(0.1, Math.min(safeDur - 0.15, safeDur * ratios[i]));
    const outImg = path.join(ARTIFACTS_DIR, `_probe_${Date.now()}_${i}_${crypto.randomBytes(2).toString('hex')}.jpg`);
    try {
      const r = await runFfmpeg(
        ['-y', '-ss', ts.toFixed(2), '-i', videoPath, '-frames:v', '1', '-q:v', '4', outImg],
        20_000
      );
      if (r.code === 0 && fs.existsSync(outImg)) {
        const buf = fs.readFileSync(outImg);
        if (buf.byteLength > 500) {
          frames.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
        }
      }
    } catch {
      // ignore frame extraction error
    } finally {
      if (fs.existsSync(outImg)) fs.unlink(outImg, () => {});
    }
  }
  return frames;
}

async function runAgentTextInference(params: {
  agent: MuseAgentConfig;
  systemPrompt: string;
  userPrompt: string;
  attachments?: string[];
  jsonMode?: boolean;
}): Promise<{ text: string; provider: string; accountUsed?: string }> {
  const health = await refreshIntegrationHealth();
  const canTryMuse =
    health.muse2ApiReachable &&
    health.muse2ApiStatus === 'ready' &&
    (params.agent.boundAccountId === 'auto'
      ? health.healthyAccounts > 0 || health.accounts.some((a) => a.enabled)
      : true);

  let museError: string | null = null;
  if (canTryMuse) {
    try {
      const text = await chatWithMuse2ApiSpark(
        [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        240,
        params.attachments,
        params.agent.boundAccountId
      );
      return {
        text,
        provider: 'muse2api (muse-spark)',
        accountUsed: params.agent.boundAccountId,
      };
    } catch (err: any) {
      museError = String(err?.message || err || 'Lỗi kết nối Muse2API');
    }
  } else {
    museError = health.muse2ApiReachable
      ? health.warnings[0] || 'Chưa có tài khoản Muse.ai khả dụng trên Muse2API.'
      : `Muse2API (${health.muse2ApiBaseUrl}) chưa trực tuyến.`;
  }

  if (params.agent.engineMode === 'muse2api_with_gemini_fallback' && health.geminiConfigured) {
    const ai = getGeminiClient();
    const parts: any[] = [];
    for (const att of (params.attachments || []).slice(0, 6)) {
      const m = String(att || '').match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
    }
    parts.push({ text: `${params.systemPrompt}\n\n${params.userPrompt}` });

    const candidates = prioritizeGeminiCandidateModels(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
    let lastErr: any;
    for (const model of candidates) {
      try {
        const res = await retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model,
              contents: { parts },
              config: params.jsonMode ? { responseMimeType: 'application/json' } : undefined,
            }),
          [1200, 2800]
        );
        const text = String(res.text || '').trim();
        if (!text) throw new Error(`Mô hình ${model} trả về rỗng.`);
        return {
          text,
          provider: `gemini-fallback (${model})`,
        };
      } catch (err: any) {
        lastErr = err;
        markGeminiModelOverloaded(model, err);
        if (!shouldFallbackGeminiModel(err)) throw new Error(formatGeminiError(err));
      }
    }
    throw new Error(formatGeminiError(lastErr));
  }

  throw new Error(
    `${params.agent.name} (${params.agent.roleTitle}) chưa thể thực thi: ${museError}. Hãy kết nối Muse2API + tài khoản Muse.ai thực tế hoặc bật chế độ Gemini Dự phòng cho agent này.`
  );
}

// ==========================================
// TASK EXECUTION HANDLERS FOR 5 MUSE AI
// ==========================================

async function executePlanProductionTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — Điều phối trưởng trong Phòng Điều Hành AI Muse.
Nhiệm vụ: Nhận kịch bản/lệnh của đạo diễn, lập kế hoạch sản xuất cho đội 5 AI (Muse 01 Tổng đạo diễn, Muse 02 Biên kịch, Muse 03 Hình ảnh, Muse 04 Video, Muse 05 QA).
Hãy trả về đúng JSON hợp lệ (không markdown) với cấu trúc:
{
  "projectTitle": "Tên phim ngắn gọn",
  "productionStrategyVi": "Tóm tắt kế hoạch phân công song song vs nối tiếp cho cả đội (3-5 câu tiếng Việt)",
  "estimatedScenes": 4,
  "parallelGroupsNote": "Giải thích nhóm phân cảnh nào có thể chạy song song và cảnh nào phải nối tiếp giữ nhân vật/bối cảnh",
  "continuityLockNotes": "Quy tắc đồng bộ nhân vật, trang phục, bối cảnh cốt lõi cần khóa vào Project Memory"
}`;

  const user = `Lệnh sản xuất & Kịch bản gốc từ người dùng:
${mem.originalScript}

Thông số dự án:
- Hình thức: ${mem.productionFormat === 'dialogue_film' ? 'Phim có lời thoại (đồng bộ nhân vật + khẩu hình)' : 'Phim thuyết minh kể chuyện'}
- Khung hình: ${mem.aspectRatio}
- Phong cách: ${mem.videoStyle}`;

  const res = await runAgentTextInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    jsonMode: true,
  });

  const parsed = parseAiBlueprintJsonSafe(res.text) || {};
  const projectTitle = String(parsed.projectTitle || mem.title || 'Dự án phim AI Muse').trim();
  const strategy = String(parsed.productionStrategyVi || res.text.slice(0, 500)).trim();
  const continuityLock = String(parsed.continuityLockNotes || '').trim();
  const estScenes = Math.max(2, Math.min(10, Number(parsed.estimatedScenes) || 4));

  commitProjectMemoryUpdate(agent.id, 'Tổng đạo diễn lập kế hoạch sản xuất', (m) => {
    m.title = projectTitle;
    if (continuityLock) m.continuityBible = continuityLock;
    m.timelineSummary = strategy;
  });

  const run = storeDoc.runs.find((r) => r.id === task.runId);
  if (run) {
    run.title = projectTitle;
    run.status = 'producing';
    run.updatedAt = Date.now();
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = strategy;

  appendConversationMessage({
    channel: 'group',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    targetAgentIds: ['muse-02', 'muse-05'],
    taskId: task.id,
    content: `Đã lập kế hoạch sản xuất "${projectTitle}" (~${estScenes} phân cảnh).\n• Chiến lược: ${strategy}\n• Đã khóa Project Memory v${storeDoc.projectMemory.version} và giao Muse AI 02 phân tích kịch bản chi tiết.`,
  });

  enqueueTask({
    runId: task.runId,
    type: 'analyze_script',
    title: `Biên kịch & bóc tách ${estScenes} phân cảnh + hồ sơ nhân vật 5 thành phần`,
    instructions: `Phân tích kịch bản "${projectTitle}" (${estScenes} phân cảnh), tách nhân vật kèm hồ sơ 5 thành phần, giọng nói theo độ tuổi, timeline từng giây và quan hệ nối cảnh.`,
    assignedAgentId: 'muse-02',
    dependsOnTaskIds: [task.id],
    priority: 9,
  });
}

async function executeAnalyzeScriptTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) trong Phòng Điều Hành AI Muse.
Hãy bóc tách kịch bản thành dữ liệu sản xuất chuẩn xác để khóa vào Project Memory.
Trả về DUY NHẤT JSON hợp lệ theo schema:
{
  "visualBible": "Mô tả phong cách hình ảnh, màu sắc, ánh sáng chủ đạo",
  "settingBible": "Mô tả bối cảnh tổng thể & thời gian",
  "costumeBible": "Quy chuẩn trang phục xuyên suốt",
  "continuityBible": "Quy chuẩn nối cảnh, hướng nhìn, vị trí nhân vật",
  "characters": [
    {
      "id": "char_1",
      "name": "Tên nhân vật",
      "ageGroup": "child | youth | adult_male | adult_female | middle_aged | elderly",
      "gender": "male | female",
      "description": "Mô tả ngắn ngoại hình & tính cách",
      "syncProfile": {
        "face": "1. Gương mặt, mắt, mũi, kiểu tóc chi tiết",
        "physique": "2. Vóc dáng, chiều cao, độ tuổi",
        "costume": "3. Trang phục & phụ kiện cố định",
        "voice": "4. Giọng nói, cao độ, âm sắc theo độ tuổi",
        "distinguishingMarks": "5. Đặc điểm nhận dạng riêng biệt"
      }
    }
  ],
  "scenes": [
    {
      "index": 1,
      "title": "Tên cảnh ngắn",
      "durationSec": 6,
      "narration": "Lời dẫn chuyện (nếu có)",
      "dialogue": "Lời thoại nhân vật trực tiếp (nếu là phim có lời thoại, ghi rõ ai nói câu gì)",
      "speakerName": "Tên nhân vật nói chính",
      "actionDetail": "Hành động diễn xuất cụ thể trong cảnh",
      "settingDetail": "Bối cảnh cụ thể của cảnh này",
      "costume": "Trang phục của nhân vật trong cảnh",
      "cameraAngle": "Góc máy (vd: Trung cảnh / Cận cảnh / Toàn cảnh)",
      "cameraMovement": "Chuyển động máy (vd: Đẩy máy chậm / Theo sát)",
      "lighting": "Ánh sáng cảnh",
      "vfxNotes": "Hiệu ứng / không khí",
      "videoTimeline": "0s-2s: ... | 2s-4s: ... | 4s-6s: ...",
      "dependsOnPreviousScene": false
    }
  ]
}`;

  const user = `Kịch bản gốc:
${mem.originalScript}

Chiến lược Tổng đạo diễn đã duyệt:
${mem.timelineSummary}

Lưu ý:
- Hình thức: ${mem.productionFormat === 'dialogue_film' ? 'Phim có lời thoại (bắt buộc giữ lời thoại nhân vật + lip-sync)' : 'Phim thuyết minh kể chuyện (ưu tiên lời dẫn chuyện tự nhiên)'}.
- Số phân cảnh: 3 đến 6 phân cảnh rõ ràng, mỗi cảnh 5-8 giây.
- Hãy đặt "dependsOnPreviousScene": true CHỈ cho cảnh nào nối trực tiếp hành động/khung hình từ cảnh trước; các cảnh độc lập đặt false để Muse AI 03 & 04 sản xuất song song!`;

  const res = await runAgentTextInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    jsonMode: true,
  });

  const parsed = parseAiBlueprintJsonSafe(res.text);
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('Muse AI 02 chưa trả về cấu trúc phân cảnh JSON hợp lệ.');
  }

  const normalizedChars: CommandMemoryCharacter[] = (Array.isArray(parsed.characters) ? parsed.characters : []).map(
    (c: any, idx: number) => ({
      id: String(c.id || `char_${idx + 1}`),
      name: String(c.name || `Nhân vật ${idx + 1}`).trim(),
      ageGroup: (['child', 'youth', 'adult_male', 'adult_female', 'middle_aged', 'elderly'].includes(c.ageGroup)
        ? c.ageGroup
        : 'youth') as any,
      gender: c.gender === 'female' ? 'female' : 'male',
      voiceId: c.gender === 'female' ? 'Aoede' : 'Charon',
      description: String(c.description || '').trim(),
      syncProfile: {
        face: String(c.syncProfile?.face || c.description || 'Gương mặt chuẩn theo kịch bản'),
        physique: String(c.syncProfile?.physique || 'Tỷ lệ cân đối tự nhiên'),
        costume: String(c.syncProfile?.costume || parsed.costumeBible || 'Trang phục đồng bộ xuyên suốt'),
        voice: String(c.syncProfile?.voice || 'Giọng đọc tự nhiên đúng độ tuổi'),
        distinguishingMarks: String(c.syncProfile?.distinguishingMarks || 'Thần thái đặc trưng ổn định'),
      },
      approvedVersion: storeDoc.projectMemory.version + 1,
    })
  );

  const rawScenes = parsed.scenes.slice(0, 10);
  const normalizedScenes: CommandMemoryScene[] = rawScenes.map((s: any, idx: number) => {
    const sceneId = `scene_${idx + 1}`;
    const prevId = idx > 0 && s.dependsOnPreviousScene ? `scene_${idx}` : undefined;
    return {
      sceneId,
      index: idx + 1,
      title: String(s.title || `Cảnh ${idx + 1}`).trim(),
      durationSec: Math.max(4, Math.min(10, Number(s.durationSec) || 6)),
      narration: String(s.narration || '').trim(),
      dialogue: String(s.dialogue || '').trim(),
      speakerName: String(s.speakerName || normalizedChars[0]?.name || '').trim(),
      actionDetail: String(s.actionDetail || s.title || '').trim(),
      settingDetail: String(s.settingDetail || parsed.settingBible || '').trim(),
      costume: String(s.costume || parsed.costumeBible || '').trim(),
      cameraAngle: String(s.cameraAngle || 'Trung cảnh').trim(),
      cameraMovement: String(s.cameraMovement || 'Đẩy máy chậm').trim(),
      lighting: String(s.lighting || 'Ánh sáng điện ảnh tự nhiên').trim(),
      vfxNotes: String(s.vfxNotes || '').trim(),
      videoTimeline: String(s.videoTimeline || '').trim(),
      dependsOnSceneIds: prevId ? [prevId] : [],
      continuityAnchorFromSceneId: prevId,
      qaStatus: 'pending',
      retryCount: 0,
      lastModifiedBy: 'muse-01',
    };
  });

  // Director (Muse AI 01) validates & locks Project Memory version
  const newVer = commitProjectMemoryUpdate('muse-01', `Khóa kịch bản từ ${agent.name} (${normalizedScenes.length} cảnh, ${normalizedChars.length} nhân vật)`, (m) => {
    m.visualBible = String(parsed.visualBible || m.visualBible || '').trim();
    m.settingBible = String(parsed.settingBible || m.settingBible || '').trim();
    m.costumeBible = String(parsed.costumeBible || m.costumeBible || '').trim();
    m.continuityBible = String(parsed.continuityBible || m.continuityBible || '').trim();
    m.characters = normalizedChars;
    m.scenes = normalizedScenes;
  });

  const run = storeDoc.runs.find((r) => r.id === task.runId);
  if (run) {
    run.sceneCount = normalizedScenes.length;
    run.updatedAt = Date.now();
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = `Đã bóc tách ${normalizedChars.length} nhân vật (5 thành phần) và ${normalizedScenes.length} phân cảnh. Khóa Project Memory v${newVer}.`;

  // Stage 3A: Character Reference Sheet Tasks (parallel for all characters, max 4)
  const charTaskIds: string[] = [];
  for (const ch of normalizedChars.slice(0, 4)) {
    const ct = enqueueTask({
      runId: task.runId,
      type: 'design_character_ref',
      title: `Tạo ảnh tham chiếu nhân vật: ${ch.name}`,
      instructions: `${ch.name}: ${ch.syncProfile.face}. Vóc dáng: ${ch.syncProfile.physique}. Trang phục: ${ch.syncProfile.costume}. Đặc điểm: ${ch.syncProfile.distinguishingMarks}`,
      assignedAgentId: 'muse-03',
      dependsOnTaskIds: [task.id],
      characterId: ch.id,
      priority: 8,
    });
    charTaskIds.push(ct.id);
  }

  // Stage 3B (Scene Image) & Stage 4 (Scene Video) & Stage 5 (QA Inspect) DAG
  const sceneVideoTaskBySceneId = new Map<string, string>();
  const qaTaskIds: string[] = [];

  for (const sc of normalizedScenes) {
    const imgTask = enqueueTask({
      runId: task.runId,
      type: 'design_scene_image',
      title: `Cảnh ${sc.index}: Tạo ảnh keyframe "${sc.title}"`,
      instructions: `${sc.actionDetail}. Bối cảnh: ${sc.settingDetail}. Góc máy: ${sc.cameraAngle}. Ánh sáng: ${sc.lighting}.`,
      assignedAgentId: 'muse-03',
      dependsOnTaskIds: charTaskIds.length > 0 ? charTaskIds : [task.id],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 7,
    });

    const videoDeps = [imgTask.id];
    if (sc.continuityAnchorFromSceneId && sceneVideoTaskBySceneId.has(sc.continuityAnchorFromSceneId)) {
      videoDeps.push(sceneVideoTaskBySceneId.get(sc.continuityAnchorFromSceneId)!);
    }

    const vidTask = enqueueTask({
      runId: task.runId,
      type: 'produce_scene_video',
      title: `Cảnh ${sc.index}: Quay & dựng video "${sc.title}" (${sc.durationSec}s)`,
      instructions: `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`,
      assignedAgentId: 'muse-04',
      dependsOnTaskIds: videoDeps,
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 6,
    });
    sceneVideoTaskBySceneId.set(sc.sceneId, vidTask.id);

    const qaTask = enqueueTask({
      runId: task.runId,
      type: 'qa_inspect_scene',
      title: `Kiểm định 8 tiêu chí Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `Đối chiếu Cảnh ${sc.index} với Project Memory v${newVer} và các cảnh lân cận.`,
      assignedAgentId: 'muse-05',
      dependsOnTaskIds: [vidTask.id],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 5,
    });
    qaTaskIds.push(qaTask.id);
  }

  enqueueTask({
    runId: task.runId,
    type: 'assemble_final_film',
    title: `Ghép xuất phim hoàn chỉnh (${normalizedScenes.length} phân cảnh)`,
    instructions: `Tổng hợp toàn bộ phân cảnh đã đạt QA thành video MP4 hoàn chỉnh và bàn giao.`,
    assignedAgentId: 'muse-01',
    dependsOnTaskIds: qaTaskIds,
    priority: 1,
  });

  appendConversationMessage({
    channel: 'group',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    targetAgentIds: ['muse-01', 'muse-03', 'muse-04', 'muse-05'],
    taskId: task.id,
    content: `Hoàn tất phân tích kịch bản (Project Memory v${newVer}):\n• ${normalizedChars.length} nhân vật chuẩn hóa 5 thành phần.\n• ${normalizedScenes.length} phân cảnh đã lập DAG song song/nối tiếp.\nĐã chuyển giao tạo ảnh tham chiếu cho Muse AI 03 và xếp hàng sản xuất cho Muse AI 04 & QA Muse AI 05.`,
  });
}

async function executeDesignCharacterRefTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const ch = mem.characters.find((c) => c.id === task.characterId);
  if (!ch) throw new Error(`Không tìm thấy nhân vật ${task.characterId} trong Project Memory.`);

  const health = await refreshIntegrationHealth();
  const useMuse =
    health.muse2ApiReachable &&
    health.muse2ApiStatus === 'ready' &&
    (agent.boundAccountId !== 'auto' || health.healthyAccounts > 0 || health.accounts.some((a) => a.enabled));

  let engine: 'muse2api' | 'gemini' = 'muse2api';
  if (!useMuse) {
    if (agent.engineMode === 'muse2api_with_gemini_fallback' && health.geminiConfigured) {
      engine = 'gemini';
    } else {
      throw new Error(
        `${agent.name} cần Muse2API trực tuyến (hoặc bật Gemini dự phòng) để tạo ảnh nhân vật "${ch.name}".`
      );
    }
  }

  const charBible = `${ch.name}: ${ch.syncProfile.face}; ${ch.syncProfile.physique}; ${ch.syncProfile.costume}; ${ch.syncProfile.distinguishingMarks}`;
  const img = await generateStudioImage({
    mode: 'character',
    prompt: task.instructions || charBible,
    aspectRatio: '1:1',
    engine,
    videoStyle: mem.videoStyle,
    characterBible: charBible,
    costumeBible: ch.syncProfile.costume,
    visualStyleBible: mem.visualBible,
    museAccountId: agent.boundAccountId,
  });

  const saved = saveDataUrlArtifact(`char_${ch.id}`, img.dataUrl);
  if (!saved) throw new Error('Không lưu được tệp ảnh nhân vật từ AI.');

  commitProjectMemoryUpdate('muse-01', `Lưu ảnh tham chiếu nhân vật ${ch.name} từ ${agent.name}`, (m) => {
    const target = m.characters.find((c) => c.id === ch.id);
    if (target) {
      target.artifactUrl = saved.url;
      target.approvedVersion = m.version + 1;
    }
  });

  task.executedByProvider = img.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = saved.url;
  task.outputText = `Đã tạo & lưu ảnh tham chiếu cho nhân vật ${ch.name} (${img.model}).`;

  appendConversationMessage({
    channel: agent.id,
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: agent.name,
    taskId: task.id,
    attachments: [saved.url],
    content: `Hoàn tất ảnh tham chiếu nhân vật **${ch.name}** bằng ${img.model}. Đã gửi Tổng đạo diễn khóa vào Project Memory.`,
  });
}

async function executeDesignSceneImageTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sc = mem.scenes.find((s) => s.sceneId === task.sceneId);
  if (!sc) throw new Error(`Không tìm thấy phân cảnh ${task.sceneId} trong Project Memory.`);

  const health = await refreshIntegrationHealth();
  const useMuse =
    health.muse2ApiReachable &&
    health.muse2ApiStatus === 'ready' &&
    (agent.boundAccountId !== 'auto' || health.healthyAccounts > 0 || health.accounts.some((a) => a.enabled));

  let engine: 'muse2api' | 'gemini' = 'muse2api';
  if (!useMuse) {
    if (agent.engineMode === 'muse2api_with_gemini_fallback' && health.geminiConfigured) {
      engine = 'gemini';
    } else {
      throw new Error(
        `${agent.name} cần Muse2API trực tuyến (hoặc bật Gemini dự phòng) để tạo ảnh Cảnh ${sc.index}.`
      );
    }
  }

  const charRefs = mem.characters
    .map((c) => {
      const dUrl = c.dataUrl || artifactUrlToDataUrl(c.artifactUrl);
      if (!dUrl) return null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        dataUrl: dUrl,
        syncProfile: c.syncProfile,
      };
    })
    .filter(Boolean) as any[];

  const charBibleText = mem.characters
    .map((c) => `${c.name}: ${c.syncProfile.face}; ${c.syncProfile.physique}; ${c.syncProfile.costume}`)
    .join(' | ');

  const img = await generateStudioImage({
    mode: 'scene',
    prompt: task.instructions || `${sc.actionDetail}. ${sc.settingDetail}`,
    aspectRatio: mem.aspectRatio,
    engine,
    videoStyle: mem.videoStyle,
    characterBible: charBibleText,
    settingBible: mem.settingBible,
    visualStyleBible: mem.visualBible,
    costumeBible: sc.costume || mem.costumeBible,
    continuityBible: mem.continuityBible,
    sceneIndex: sc.index,
    totalScenes: mem.scenes.length,
    sceneTitle: sc.title,
    charactersInScene: mem.characters.map((c) => c.name).join(', '),
    settingDetail: sc.settingDetail,
    actionDetail: sc.actionDetail,
    dialogue: sc.dialogue,
    sceneSummary: sc.title,
    costume: sc.costume,
    cameraAngle: sc.cameraAngle,
    vfxNotes: sc.vfxNotes,
    characterRefs: charRefs,
    museAccountId: agent.boundAccountId,
  });

  const saved = saveDataUrlArtifact(`scene_${sc.index}_kf`, img.dataUrl);
  if (!saved) throw new Error('Không lưu được ảnh keyframe phân cảnh.');

  commitProjectMemoryUpdate('muse-01', `Khóa keyframe Cảnh ${sc.index} từ ${agent.name}`, (m) => {
    const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
    if (target) {
      target.keyframeImageUrl = saved.url;
      target.keyframeArtifactName = saved.fileName;
      target.lastModifiedBy = agent.id;
    }
  });

  task.executedByProvider = img.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = saved.url;
  task.outputText = `Đã tạo & lưu keyframe Cảnh ${sc.index} "${sc.title}" (${img.model}).`;
}

async function executeProduceSceneVideoTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sc = mem.scenes.find((s) => s.sceneId === task.sceneId);
  if (!sc) throw new Error(`Không tìm thấy phân cảnh ${task.sceneId} trong Project Memory.`);

  const health = await refreshIntegrationHealth();
  const useMuse =
    health.muse2ApiReachable &&
    health.muse2ApiStatus === 'ready' &&
    (agent.boundAccountId !== 'auto' || health.healthyAccounts > 0 || health.accounts.some((a) => a.enabled));

  let engine: 'muse2api' | 'gemini' = 'muse2api';
  if (!useMuse) {
    if (agent.engineMode === 'muse2api_with_gemini_fallback' && health.geminiConfigured) {
      engine = 'gemini';
    } else {
      throw new Error(
        `${agent.name} cần Muse2API trực tuyến (hoặc bật Gemini dự phòng) để tạo video Cảnh ${sc.index}.`
      );
    }
  }

  let sceneKeyframeDataUrl = artifactUrlToDataUrl(sc.keyframeImageUrl);
  // If continuity scene has a previous scene video, extract its ending frame as continuity visual context if no keyframe exists
  if (!sceneKeyframeDataUrl && sc.continuityAnchorFromSceneId) {
    const prevScene = mem.scenes.find((s) => s.sceneId === sc.continuityAnchorFromSceneId);
    const prevDisk = artifactUrlToDiskPath(prevScene?.videoUrl);
    if (prevDisk) {
      const frames = await extractFramesFromVideoDisk(prevDisk, 1);
      if (frames[0]) sceneKeyframeDataUrl = frames[0];
    }
  }

  const charRefs = mem.characters
    .map((c) => {
      const dUrl = c.dataUrl || artifactUrlToDataUrl(c.artifactUrl);
      if (!dUrl) return null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        dataUrl: dUrl,
        syncProfile: c.syncProfile,
      };
    })
    .filter(Boolean) as any[];

  const charBibleText = mem.characters
    .map((c) => `${c.name}: ${c.syncProfile.face}; ${c.syncProfile.physique}; ${c.syncProfile.costume}; ${c.syncProfile.voice}`)
    .join(' | ');

  const vidRes = await generateSceneVideoWithOmniFlash({
    engine,
    prompt: `${task.instructions || sc.actionDetail}${sc.lighting ? `. Lighting: ${sc.lighting}` : ''}`,
    aspectRatio: mem.aspectRatio,
    durationSec: sc.durationSec,
    videoStyle: mem.videoStyle,
    characterBible: charBibleText,
    settingBible: mem.settingBible,
    visualStyleBible: mem.visualBible,
    costumeBible: sc.costume || mem.costumeBible,
    continuityBible: mem.continuityBible,
    sceneIndex: sc.index,
    totalScenes: mem.scenes.length,
    sceneTitle: sc.title,
    settingDetail: sc.settingDetail,
    cameraMovement: sc.cameraMovement,
    charactersInScene: mem.characters.map((c) => c.name).join(', '),
    actionDetail: sc.actionDetail,
    dialogue: mem.productionFormat === 'dialogue_film' ? sc.dialogue : '',
    narration: sc.narration,
    videoTimeline: sc.videoTimeline,
    enableVoiceover: Boolean(sc.narration),
    sceneSummary: sc.title,
    costume: sc.costume,
    cameraAngle: sc.cameraAngle,
    vfxNotes: sc.vfxNotes,
    sceneImageDataUrl: sceneKeyframeDataUrl,
    characterRefs: charRefs,
    museAccountId: agent.boundAccountId,
  });

  // Persist a stable copy into ARTIFACTS_DIR so artifacts URL works reliably across restarts
  const srcDisk = artifactUrlToDiskPath(vidRes.previewUrl);
  let stableUrl = vidRes.previewUrl;
  let stableFile = vidRes.assetId;
  if (srcDisk && fs.existsSync(srcDisk)) {
    const buf = fs.readFileSync(srcDisk);
    const saved = saveArtifactBuffer(`scene_${sc.index}_vid`, path.extname(srcDisk) || '.mp4', buf);
    stableUrl = saved.url;
    stableFile = saved.fileName;
  }

  commitProjectMemoryUpdate('muse-01', `Khóa video Cảnh ${sc.index} từ ${agent.name}`, (m) => {
    const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
    if (target) {
      target.videoUrl = stableUrl;
      target.videoArtifactName = stableFile;
      target.videoAssetId = vidRes.assetId;
      target.probedDurationSec = vidRes.durationSec;
      target.hasAudioStream = vidRes.hasAudio;
      target.qaStatus = 'inspecting';
      target.lastModifiedBy = agent.id;
    }
  });

  const run = storeDoc.runs.find((r) => r.id === task.runId);
  if (run) {
    run.completedScenes = storeDoc.projectMemory.scenes.filter((s) => Boolean(s.videoUrl)).length;
    run.updatedAt = Date.now();
  }

  task.executedByProvider = vidRes.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = stableUrl;
  task.outputText = `Đã dựng xong Cảnh ${sc.index} "${sc.title}" (${vidRes.durationSec}s, audio=${vidRes.hasAudio ? 'có' : 'không'}, ${vidRes.model}).`;
}

const QA_CRITERIA_META: { id: QaCriterionId; label: string }[] = [
  { id: 'character', label: 'Nhân vật (Gương mặt, vóc dáng, độ tuổi)' },
  { id: 'costume', label: 'Trang phục (Màu sắc, kiểu dáng, phụ kiện)' },
  { id: 'voice', label: 'Giọng nói (Đúng nhân vật, đúng giọng)' },
  { id: 'dialogue', label: 'Lời thoại (Không nhầm người, không thiếu câu)' },
  { id: 'setting', label: 'Bối cảnh (Không gian, thời gian, ánh sáng)' },
  { id: 'motion', label: 'Chuyển động (Đúng hành động kịch bản)' },
  { id: 'continuity', label: 'Nối cảnh (Không nhảy cảnh, đúng vị trí)' },
  { id: 'audio', label: 'Âm thanh (Nhạc nền, hiệu ứng, khẩu hình)' },
];

async function executeQaInspectSceneTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sc = mem.scenes.find((s) => s.sceneId === task.sceneId);
  if (!sc) throw new Error(`Không tìm thấy phân cảnh ${task.sceneId} để kiểm duyệt.`);
  if (!sc.videoUrl) throw new Error(`Cảnh ${sc.index} chưa có file video đầu ra để kiểm định.`);

  const diskPath = artifactUrlToDiskPath(sc.videoUrl);
  const extractedFrames = diskPath ? await extractFramesFromVideoDisk(diskPath, 3) : [];
  const charAttachments = mem.characters
    .map((c) => c.dataUrl || artifactUrlToDataUrl(c.artifactUrl))
    .filter((x): x is string => Boolean(x))
    .slice(0, 2);
  const keyframeAtt = artifactUrlToDataUrl(sc.keyframeImageUrl);
  const allAttachments = Array.from(
    new Set([...extractedFrames, ...(keyframeAtt ? [keyframeAtt] : []), ...charAttachments])
  ).slice(0, 6);

  const prevScene = sc.index > 1 ? mem.scenes.find((s) => s.index === sc.index - 1) : undefined;
  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — AI kiểm định độc lập trong Phòng Điều Hành AI Muse.
Nhiệm vụ: Kiểm tra video đầu ra của Cảnh ${sc.index} dựa trên các khung hình trích xuất thực tế, ảnh tham chiếu nhân vật và Project Memory v${mem.version}.
Trả về DUY NHẤT JSON hợp lệ:
{
  "overallScore": 85,
  "timestampRange": "0s-${sc.durationSec}s",
  "summary": "Nhận xét ngắn gọn kết quả kiểm định",
  "targetFixAgentId": "muse-04",
  "fixInstruction": "Chỉ dẫn cụ thể để sửa lỗi nếu điểm < ${storeDoc.cloudConfig.qaPassThreshold}",
  "criteria": [
    { "criterion": "character", "score": 88, "passed": true, "note": "..." },
    { "criterion": "costume", "score": 86, "passed": true, "note": "..." },
    { "criterion": "voice", "score": 85, "passed": true, "note": "..." },
    { "criterion": "dialogue", "score": 85, "passed": true, "note": "..." },
    { "criterion": "setting", "score": 88, "passed": true, "note": "..." },
    { "criterion": "motion", "score": 84, "passed": true, "note": "..." },
    { "criterion": "continuity", "score": 85, "passed": true, "note": "..." },
    { "criterion": "audio", "score": 82, "passed": true, "note": "..." }
  ]
}`;

  const user = `THÔNG SỐ CHUẨN PROJECT MEMORY v${mem.version}:
- Nhân vật đồng bộ: ${mem.characters.map((c) => `${c.name} (${c.syncProfile.face}; ${c.syncProfile.costume})`).join(' | ') || 'Theo kịch bản'}
- Cảnh cần kiểm tra: Cảnh ${sc.index}/${mem.scenes.length} — "${sc.title}"
- Thời lượng kiểm tra thực tế từ ffprobe: ${sc.probedDurationSec || sc.durationSec}s · Có luồng audio: ${sc.hasAudioStream ? 'Có' : 'Không'}
- Bối cảnh chuẩn: ${sc.settingDetail}
- Trang phục chuẩn: ${sc.costume}
- Hành động chuẩn: ${sc.actionDetail}
- Lời thoại chuẩn: ${sc.dialogue || '(Không có thoại)'}
- Lời dẫn: ${sc.narration || '(Không)'}
- Cảnh trước đó: ${prevScene ? `Cảnh ${prevScene.index}: ${prevScene.actionDetail} (${prevScene.settingDetail})` : 'Đây là cảnh mở đầu'}
- Số khung hình video thực tế đính kèm: ${extractedFrames.length}`;

  const res = await runAgentTextInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    attachments: allAttachments,
    jsonMode: true,
  });

  const parsed = parseAiBlueprintJsonSafe(res.text) || {};
  const threshold = storeDoc.cloudConfig.qaPassThreshold;
  const rawCriteria: any[] = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  const criteriaResults: QaCriterionResult[] = QA_CRITERIA_META.map((meta) => {
    const found = rawCriteria.find((c) => c?.criterion === meta.id);
    const score = Math.max(0, Math.min(100, Number(found?.score ?? parsed.overallScore ?? 78)));
    return {
      criterion: meta.id,
      label: meta.label,
      score,
      passed: typeof found?.passed === 'boolean' ? found.passed : score >= threshold,
      note: String(found?.note || 'Đã đối chiếu với Project Memory').trim(),
    };
  });

  const avgScore = Math.round(criteriaResults.reduce((acc, c) => acc + c.score, 0) / criteriaResults.length);
  const overallScore = Number.isFinite(Number(parsed.overallScore))
    ? Math.max(0, Math.min(100, Math.round(Number(parsed.overallScore))))
    : avgScore;
  const passed = overallScore >= threshold && criteriaResults.filter((c) => !c.passed).length <= 1;

  const attemptNumber = sc.retryCount + 1;
  const targetFix: 'muse-02' | 'muse-03' | 'muse-04' =
    parsed.targetFixAgentId === 'muse-03' || parsed.targetFixAgentId === 'muse-02'
      ? parsed.targetFixAgentId
      : 'muse-04';

  const report: QaInspectionReport = {
    id: `qa_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    sceneId: sc.sceneId,
    sceneIndex: sc.index,
    runId: task.runId,
    inspectorAgentId: agent.id,
    checkedAt: Date.now(),
    overallScore,
    passed,
    threshold,
    criteriaResults,
    timestampRange: String(parsed.timestampRange || `0s-${sc.durationSec}s`),
    summary: String(parsed.summary || (passed ? 'Đạt chuẩn đồng nhất' : 'Cần chỉnh sửa lại phân cảnh')).trim(),
    targetFixAgentId: passed ? undefined : targetFix,
    fixInstruction: passed
      ? undefined
      : String(parsed.fixInstruction || 'Bám sát gương mặt nhân vật tham chiếu, trang phục và timeline hành động trong Project Memory.').trim(),
    attemptNumber,
  };

  storeDoc.qaReports.unshift(report);
  if (storeDoc.qaReports.length > 200) {
    storeDoc.qaReports = storeDoc.qaReports.slice(0, 200);
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = `QA Cảnh ${sc.index}: ${overallScore}/100 (${passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}) — ${report.summary}`;

  if (passed) {
    commitProjectMemoryUpdate('muse-01', `Muse AI 05 duyệt Cảnh ${sc.index} (${overallScore}/100)`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target) {
        target.qaStatus = 'passed';
        target.qaScore = overallScore;
        target.qaReportId = report.id;
      }
    });

    const run = storeDoc.runs.find((r) => r.id === task.runId);
    if (run) {
      run.passedQaScenes = storeDoc.projectMemory.scenes.filter((s) => s.qaStatus === 'passed').length;
      run.updatedAt = Date.now();
    }

    appendConversationMessage({
      channel: 'group',
      projectId: mem.projectId,
      runId: task.runId,
      senderType: 'agent',
      senderId: agent.id,
      senderName: `${agent.name} (${agent.roleTitle})`,
      taskId: task.id,
      content: `Kiểm định ĐẠT Cảnh ${sc.index} "${sc.title}" (${overallScore}/100 ≥ ngưỡng ${threshold}). Cho phép đưa vào bản dựng cuối.`,
    });
    return;
  }

  // Failed QA: check retry budget
  const maxRetries = storeDoc.cloudConfig.maxRetriesPerScene;
  if (sc.retryCount < maxRetries) {
    agent.stats.retried += 1;
    commitProjectMemoryUpdate('muse-01', `Muse AI 05 trả về sửa Cảnh ${sc.index} (lần ${attemptNumber})`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target) {
        target.qaStatus = 'rejected';
        target.qaScore = overallScore;
        target.qaReportId = report.id;
        target.retryCount += 1;
      }
    });

    // Queue targeted regeneration ONLY for this failed scene and rewire final assemble task dependency!
    let fixDepTaskId: string | undefined;
    if (targetFix === 'muse-03') {
      const retryImg = enqueueTask({
        runId: task.runId,
        type: 'design_scene_image',
        title: `[Sửa lỗi QA #${attemptNumber}] Cảnh ${sc.index}: Tạo lại ảnh keyframe`,
        instructions: `${sc.actionDetail}. YÊU CẦU SỬA LỖI TỪ QA: ${report.fixInstruction}`,
        assignedAgentId: 'muse-03',
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 9,
      });
      fixDepTaskId = retryImg.id;
    }

    const retryVid = enqueueTask({
      runId: task.runId,
      type: 'produce_scene_video',
      title: `[Sửa lỗi QA #${attemptNumber}] Cảnh ${sc.index}: Tạo lại video`,
      instructions: `${sc.actionDetail}. YÊU CẦU SỬA LỖI TỪ QA: ${report.fixInstruction}`,
      assignedAgentId: 'muse-04',
      dependsOnTaskIds: fixDepTaskId ? [fixDepTaskId] : [],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 8,
    });

    const retryQa = enqueueTask({
      runId: task.runId,
      type: 'qa_inspect_scene',
      title: `[Kiểm định lại #${attemptNumber}] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `Kiểm tra lại Cảnh ${sc.index} sau khi đã khắc phục: ${report.fixInstruction}`,
      assignedAgentId: 'muse-05',
      dependsOnTaskIds: [retryVid.id],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 7,
    });

    // Update final assembly task dependency to wait for retryQa instead of the old qa task
    const assembleTask = storeDoc.tasks.find(
      (t) =>
        t.runId === task.runId &&
        t.type === 'assemble_final_film' &&
        (t.status === 'blocked_by_deps' || t.status === 'queued')
    );
    if (assembleTask) {
      assembleTask.dependsOnTaskIds = [
        ...assembleTask.dependsOnTaskIds.filter((id) => id !== task.id),
        retryQa.id,
      ];
      assembleTask.status = 'blocked_by_deps';
    }

    appendConversationMessage({
      channel: 'group',
      projectId: mem.projectId,
      runId: task.runId,
      senderType: 'agent',
      senderId: agent.id,
      senderName: `${agent.name} (${agent.roleTitle})`,
      targetAgentIds: [targetFix],
      taskId: task.id,
      content: `Phát hiện lỗi QA tại Cảnh ${sc.index} "${sc.title}" (${overallScore}/100 < ${threshold}, mốc ${report.timestampRange}).\n• Giao ${targetFix === 'muse-03' ? 'Muse AI 03' : 'Muse AI 04'} tạo lại RIÊNG cảnh này: ${report.fixInstruction}`,
    });
  } else {
    // Escalate to user
    commitProjectMemoryUpdate('muse-01', `Cảnh báo vượt số lần thử lại Cảnh ${sc.index}`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target) {
        target.qaStatus = 'escalated';
        target.qaScore = overallScore;
        target.qaReportId = report.id;
      }
    });
    const run = storeDoc.runs.find((r) => r.id === task.runId);
    if (run) {
      run.escalatedScenes = storeDoc.projectMemory.scenes.filter((s) => s.qaStatus === 'escalated').length;
      run.status = 'needs_attention';
      run.error = `Cảnh ${sc.index} chưa đạt QA sau ${maxRetries} lần tự động sửa (${overallScore}/${threshold}). Cần người dùng kiểm tra hoặc duyệt thủ công.`;
      run.updatedAt = Date.now();
    }
    addActivityLog('warn', 'QA vượt giới hạn thử lại', `Cảnh ${sc.index} đạt ${overallScore}/100, cần người dùng xử lý.`, {
      agentId: agent.id,
      taskId: task.id,
      runId: task.runId,
    });
  }
}

async function executeAssembleFinalFilmTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const scenes = [...mem.scenes].sort((a, b) => a.index - b.index);
  if (scenes.length === 0) {
    throw new Error('Project Memory chưa có phân cảnh nào để ghép phim.');
  }

  const unpassed = scenes.filter((s) => s.qaStatus !== 'passed');
  if (unpassed.length > 0) {
    throw new Error(
      `Còn ${unpassed.length} phân cảnh chưa được duyệt QA (${unpassed.map((s) => `Cảnh ${s.index}`).join(', ')}). Hãy hoàn tất kiểm định hoặc duyệt thủ công trước khi xuất phim.`
    );
  }

  const clipPaths: { path: string; hasAudio: boolean; index: number }[] = [];
  for (const sc of scenes) {
    const dp = artifactUrlToDiskPath(sc.videoUrl);
    if (!dp || !fs.existsSync(dp)) {
      throw new Error(`Thiếu tệp video của Cảnh ${sc.index} trên đĩa máy chủ.`);
    }
    const hasAudio = await probeHasAudioStream(dp, ARTIFACTS_DIR);
    clipPaths.push({ path: dp, hasAudio, index: sc.index });
  }

  const [w, h] = mem.aspectRatio === '9:16' ? [720, 1280] : mem.aspectRatio === '1:1' ? [1080, 1080] : [1280, 720];
  const outName = `final_film_${Date.now()}_${crypto.randomBytes(2).toString('hex')}.mp4`;
  const outPath = path.join(ARTIFACTS_DIR, outName);

  const ffmpegArgs: string[] = ['-y'];
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  let silentInputIdx = -1;

  for (let i = 0; i < clipPaths.length; i += 1) {
    ffmpegArgs.push('-i', clipPaths[i].path);
    filterParts.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`
    );
  }
  if (clipPaths.some((c) => !c.hasAudio)) {
    silentInputIdx = clipPaths.length;
    ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }
  for (let i = 0; i < clipPaths.length; i += 1) {
    if (clipPaths[i].hasAudio) {
      filterParts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
    } else {
      filterParts.push(`[${silentInputIdx}:a]atrim=0:12,aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
    }
    concatInputs.push(`[v${i}][a${i}]`);
  }

  // Note: for clips lacking audio, shortest/apadding via segment duration matching is safer by normalizing each clip first,
  // or using apad + shortest per segment if needed. Let's keep filter clean with concat video+audio where silent audio is trimmed to exact probed clip duration!
  const cleanFilterParts: string[] = [];
  const cleanConcatInputs: string[] = [];
  for (let i = 0; i < clipPaths.length; i += 1) {
    const dur = Math.max(1, (await probeDurationSeconds(clipPaths[i].path, ARTIFACTS_DIR)) || 6);
    cleanFilterParts.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`
    );
    if (clipPaths[i].hasAudio) {
      cleanFilterParts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
    } else {
      cleanFilterParts.push(
        `[${silentInputIdx}:a]atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a${i}]`
      );
    }
    cleanConcatInputs.push(`[v${i}][a${i}]`);
  }
  cleanFilterParts.push(`${cleanConcatInputs.join('')}concat=n=${clipPaths.length}:v=1:a=1[vout][aout]`);

  ffmpegArgs.push(
    '-filter_complex',
    cleanFilterParts.join(';'),
    '-map',
    '[vout]',
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
    '160k',
    '-movflags',
    '+faststart',
    outPath
  );

  const ffRes = await runFfmpeg(ffmpegArgs, 180_000);
  if (ffRes.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`FFmpeg ghép phim lỗi (code ${ffRes.code}): ${ffRes.stderr.slice(-300)}`);
  }

  const finalDur = await probeDurationSeconds(outPath, ARTIFACTS_DIR);
  const finalUrl = `/api/command-center/artifacts/${encodeURIComponent(outName)}`;

  const run = storeDoc.runs.find((r) => r.id === task.runId);
  if (run) {
    run.status = 'completed';
    run.completedAt = Date.now();
    run.updatedAt = Date.now();
    run.finalVideoUrl = finalUrl;
    run.finalVideoArtifactName = outName;
    run.finalDurationSec = Math.round(finalDur * 10) / 10;
    run.passedQaScenes = scenes.length;
    run.escalatedScenes = 0;
  }

  task.executedByProvider = 'ffmpeg-director-assembler';
  task.outputArtifactUrl = finalUrl;
  task.outputText = `Đã ghép & bàn giao phim hoàn chỉnh (${scenes.length} phân cảnh, tổng ${Math.round(finalDur * 10) / 10}s).`;

  appendConversationMessage({
    channel: 'group',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    attachments: [finalUrl],
    content: `Hoàn tất bàn giao bộ phim "${mem.title}" (${scenes.length} phân cảnh, ${Math.round(finalDur * 10) / 10}s) đạt kiểm định đồng nhất từ Muse AI 05.`,
  });
  maybeAutoBackup(`Hoàn tất sản xuất phim ${mem.title}`, task.runId, true);
}

async function executeCustomTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = storeDoc.projectMemory;
  const sys = `Bạn là ${agent.name} (${agent.roleTitle}). Mô tả vai trò: ${agent.description}.
Project Memory hiện tại (v${mem.version}): Tiêu đề "${mem.title}", ${mem.characters.length} nhân vật, ${mem.scenes.length} phân cảnh.
Hãy thực hiện chính xác nhiệm vụ được giao bằng tiếng Việt rõ ràng, súc tích và chuyên nghiệp.`;
  const res = await runAgentTextInference({
    agent,
    systemPrompt: sys,
    userPrompt: task.instructions || task.title,
  });

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = res.text;

  appendConversationMessage({
    channel: agent.id,
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: agent.name,
    taskId: task.id,
    content: res.text,
  });
}

async function runSingleTask(task: CommandTask): Promise<void> {
  const agent = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
  if (!agent) return;

  activeTaskIds.add(task.id);
  task.status = 'running';
  task.startedAt = Date.now();
  task.error = undefined;
  agent.lastActiveAt = Date.now();
  agent.lastError = undefined;
  addActivityLog('info', `Bắt đầu ${task.code}`, `${agent.name} đang thực thi: ${task.title}`, {
    agentId: agent.id,
    taskId: task.id,
    runId: task.runId,
  });
  saveStateAtomic();

  try {
    if (task.type === 'plan_production') {
      await executePlanProductionTask(task, agent);
    } else if (task.type === 'analyze_script') {
      await executeAnalyzeScriptTask(task, agent);
    } else if (task.type === 'design_character_ref') {
      await executeDesignCharacterRefTask(task, agent);
    } else if (task.type === 'design_scene_image') {
      await executeDesignSceneImageTask(task, agent);
    } else if (task.type === 'produce_scene_video') {
      await executeProduceSceneVideoTask(task, agent);
    } else if (task.type === 'qa_inspect_scene') {
      await executeQaInspectSceneTask(task, agent);
    } else if (task.type === 'assemble_final_film') {
      await executeAssembleFinalFilmTask(task, agent);
    } else {
      await executeCustomTask(task, agent);
    }

    task.status = 'completed';
    task.completedAt = Date.now();
    agent.stats.completed += 1;
    agent.lastActiveAt = Date.now();
    addActivityLog('success', `Hoàn tất ${task.code}`, task.outputText || task.title, {
      agentId: agent.id,
      taskId: task.id,
      runId: task.runId,
    });
    maybeAutoBackup(`Hoàn tất ${task.code}`, task.runId);
  } catch (err: any) {
    const errMsg = String(err?.message || err || 'Lỗi thực thi tác vụ.');
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = errMsg;
    agent.stats.failed += 1;
    agent.lastError = errMsg;
    addActivityLog('error', `Lỗi ${task.code}`, `${agent.name}: ${errMsg}`, {
      agentId: agent.id,
      taskId: task.id,
      runId: task.runId,
    });

    const run = storeDoc.runs.find((r) => r.id === task.runId);
    if (run && !['completed', 'cancelled'].includes(run.status)) {
      run.status = 'needs_attention';
      run.error = `${task.code} (${agent.name}) gặp lỗi: ${errMsg}`;
      run.updatedAt = Date.now();
    }
  } finally {
    activeTaskIds.delete(task.id);
    saveStateAtomic();
  }
}

async function tickOrchestratorQueue(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    storeDoc.cloudConfig.workerHeartbeatAt = Date.now();

    // 1. Promote blocked_by_deps tasks whose dependencies are all completed
    let promoted = false;
    for (const task of storeDoc.tasks) {
      if (task.status !== 'blocked_by_deps') continue;
      const run = storeDoc.runs.find((r) => r.id === task.runId);
      if (run && run.status === 'paused') continue;

      const deps = task.dependsOnTaskIds.map((id) => storeDoc.tasks.find((t) => t.id === id)).filter(Boolean) as CommandTask[];
      if (deps.some((d) => d.status === 'cancelled')) {
        task.status = 'cancelled';
        task.error = 'Đã hủy do tác vụ tiền đề bị hủy.';
        promoted = true;
        continue;
      }
      if (deps.length === task.dependsOnTaskIds.length && deps.every((d) => d.status === 'completed')) {
        task.status = 'queued';
        promoted = true;
      }
    }
    if (promoted) saveStateAtomic();

    // 2. Dispatch eligible queued tasks up to parallelLimit
    const maxParallel = Math.max(1, Math.min(5, storeDoc.cloudConfig.parallelLimit || 2));
    if (activeTaskIds.size >= maxParallel) return;

    const queued = storeDoc.tasks
      .filter((t) => t.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    if (queued.length === 0) return;

    const health = await refreshIntegrationHealth();
    const busyPinnedAccounts = new Set<string>();
    for (const activeId of activeTaskIds) {
      const at = storeDoc.tasks.find((t) => t.id === activeId);
      const ag = at ? storeDoc.agents.find((a) => a.id === at.assignedAgentId) : undefined;
      if (ag?.boundAccountId && ag.boundAccountId !== 'auto') {
        busyPinnedAccounts.add(ag.boundAccountId);
      }
    }

    let slotsLeft = maxParallel - activeTaskIds.size;
    for (const task of queued) {
      if (slotsLeft <= 0) break;
      const run = storeDoc.runs.find((r) => r.id === task.runId);
      if (run && run.status === 'paused') continue;

      const agent = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
      if (!agent || agent.paused) continue;
      if (agent.boundAccountId !== 'auto' && busyPinnedAccounts.has(agent.boundAccountId)) {
        continue;
      }

      // Check real capability readiness before starting task; if neither Muse2API nor Gemini fallback is ready, keep error honest!
      if (!isAgentAccountReady(agent, health)) {
        // Only fail fast if user actually started execution; fail with honest explanation
        task.status = 'failed';
        task.error = `${agent.name} chưa có kết nối Muse2API/tài khoản khỏe mạnh để thực thi thực tế. Hãy kiểm tra mục Cấu hình Cloud & Tài khoản hoặc bật Gemini dự phòng.`;
        agent.lastError = task.error;
        if (run && !['completed', 'paused'].includes(run.status)) {
          run.status = 'needs_attention';
          run.error = task.error;
        }
        addActivityLog('error', `Không thể chạy ${task.code}`, task.error, {
          agentId: agent.id,
          taskId: task.id,
          runId: task.runId,
        });
        saveStateAtomic();
        continue;
      }

      if (agent.boundAccountId !== 'auto') {
        busyPinnedAccounts.add(agent.boundAccountId);
      }
      slotsLeft -= 1;
      void runSingleTask(task);
    }
  } finally {
    isTicking = false;
  }
}

export function initCommandCenter(): void {
  ensureDirs();
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<PersistedCommandCenterDoc>;
      const base = createDefaultDoc();
      storeDoc = {
        ...base,
        ...raw,
        agents: Array.isArray(raw.agents) && raw.agents.length === 5 ? raw.agents : base.agents,
        projectMemory: raw.projectMemory || base.projectMemory,
        runs: Array.isArray(raw.runs) ? raw.runs : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        qaReports: Array.isArray(raw.qaReports) ? raw.qaReports : [],
        conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
        logs: Array.isArray(raw.logs) ? raw.logs : [],
        backups: Array.isArray(raw.backups) ? raw.backups : [],
        cloudConfig: { ...base.cloudConfig, ...(raw.cloudConfig || {}), workerBootId: WORKER_BOOT_ID },
        taskSeq: Number(raw.taskSeq) || 1,
      };
    } catch {
      storeDoc = createDefaultDoc();
    }
  } else {
    storeDoc = createDefaultDoc();
    saveStateAtomic();
  }

  // Apply persisted Cloud Muse2API override if set
  if (storeDoc.cloudConfig.muse2ApiBaseUrl || storeDoc.cloudConfig.customMuse2ApiKey) {
    setMuse2ApiRuntimeOverride({
      baseUrl: storeDoc.cloudConfig.muse2ApiBaseUrl,
      apiKey: storeDoc.cloudConfig.customMuse2ApiKey,
    });
  }

  // Crash recovery: re-queue any task interrupted mid-flight when server restarted
  let recovered = 0;
  for (const t of storeDoc.tasks) {
    if (t.status === 'running') {
      t.status = 'queued';
      t.error = undefined;
      recovered += 1;
    }
  }
  if (recovered > 0) {
    addActivityLog(
      'warn',
      'Khôi phục hàng đợi Cloud',
      `Phát hiện và khôi phục ${recovered} tác vụ đang chạy dở trước khi máy chủ khởi động lại.`
    );
    createBackupSnapshot('pre_restore', `Khôi phục tự động ${recovered} tác vụ sau khởi động lại`);
    saveStateAtomic();
  }

  if (!orchestratorTimer) {
    orchestratorTimer = setInterval(() => {
      void tickOrchestratorQueue();
    }, 2000);
    orchestratorTimer.unref();
  }
}

export async function getCommandCenterState(forceHealth = false): Promise<CommandCenterState> {
  const health = await refreshIntegrationHealth(forceHealth);
  computeAgentLiveStatuses(health);

  const activeRun =
    storeDoc.runs.find((r) => !['completed', 'failed', 'cancelled'].includes(r.status)) ||
    storeDoc.runs[0] ||
    null;

  const connectedAgents = storeDoc.agents.filter((a) => !['offline', 'error'].includes(a.status)).length;
  const workingAgents = storeDoc.agents.filter((a) => a.status === 'working').length;
  const supervisingAgents = storeDoc.agents.filter((a) => a.status === 'supervising').length;
  const waitingAgents = storeDoc.agents.filter((a) => a.status === 'waiting').length;
  const pausedAgents = storeDoc.agents.filter((a) => a.status === 'paused').length;

  const relevantTasks = activeRun ? storeDoc.tasks.filter((t) => t.runId === activeRun.id) : storeDoc.tasks;
  const metrics: CommandCenterSummaryMetrics = {
    connectedAgents,
    totalAgents: storeDoc.agents.length,
    workingAgents,
    supervisingAgents,
    waitingAgents,
    pausedAgents,
    queuedTasks: relevantTasks.filter((t) => t.status === 'queued' || t.status === 'blocked_by_deps').length,
    runningTasks: relevantTasks.filter((t) => t.status === 'running').length,
    completedTasks: relevantTasks.filter((t) => t.status === 'completed').length,
    totalTasks: relevantTasks.length,
  };

  const cfg = resolveMuse2ApiConfig();
  const safeCloudConfig: CloudOrchestratorConfig = {
    muse2ApiBaseUrl: storeDoc.cloudConfig.muse2ApiBaseUrl || cfg.baseUrl,
    hasCustomMuse2ApiKey: Boolean(storeDoc.cloudConfig.customMuse2ApiKey),
    maskedMuse2ApiKey: storeDoc.cloudConfig.customMuse2ApiKey
      ? maskSecret(storeDoc.cloudConfig.customMuse2ApiKey)
      : cfg.maskedKey,
    parallelLimit: storeDoc.cloudConfig.parallelLimit,
    qaPassThreshold: storeDoc.cloudConfig.qaPassThreshold,
    maxRetriesPerScene: storeDoc.cloudConfig.maxRetriesPerScene,
    autoBackupRealtime: storeDoc.cloudConfig.autoBackupRealtime,
    workerHeartbeatAt: Date.now(),
    workerBootId: WORKER_BOOT_ID,
    isCloudEndpoint: !isLocalhostUrl(storeDoc.cloudConfig.muse2ApiBaseUrl || cfg.baseUrl),
  };

  return {
    metrics,
    agents: storeDoc.agents,
    projectMemory: storeDoc.projectMemory,
    activeRun,
    runs: storeDoc.runs.slice(0, 20),
    tasks: [...storeDoc.tasks].reverse().slice(0, 120),
    qaReports: storeDoc.qaReports.slice(0, 60),
    conversations: storeDoc.conversations.slice(-150),
    logs: storeDoc.logs.slice(0, 150),
    backups: storeDoc.backups.slice(0, 30),
    cloudConfig: safeCloudConfig,
    integrationHealth: health,
  };
}

export async function updateMuseAgentConfig(
  agentId: MuseAgentId,
  patch: {
    name?: string;
    roleTitle?: string;
    description?: string;
    boundAccountId?: string;
    engineMode?: MuseAgentEngineMode;
    paused?: boolean;
    permissions?: Partial<MuseAgentPermissions>;
  }
): Promise<CommandCenterState> {
  const agent = storeDoc.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Không tìm thấy ${agentId}.`);

  if (typeof patch.name === 'string' && patch.name.trim()) agent.name = patch.name.trim().slice(0, 48);
  if (typeof patch.roleTitle === 'string' && patch.roleTitle.trim()) agent.roleTitle = patch.roleTitle.trim().slice(0, 64);
  if (typeof patch.description === 'string') agent.description = patch.description.trim().slice(0, 400);
  if (typeof patch.boundAccountId === 'string') agent.boundAccountId = patch.boundAccountId.trim() || 'auto';
  if (patch.engineMode === 'muse2api' || patch.engineMode === 'muse2api_with_gemini_fallback') {
    agent.engineMode = patch.engineMode;
  }
  if (typeof patch.paused === 'boolean') agent.paused = patch.paused;
  if (patch.permissions && typeof patch.permissions === 'object') {
    agent.permissions = { ...agent.permissions, ...patch.permissions };
  }

  addActivityLog('info', `Cập nhật cấu hình ${agent.code}`, `${agent.name} · Vai trò: ${agent.roleTitle} · Account: ${agent.boundAccountId}`, {
    agentId: agent.id,
  });
  saveStateAtomic();
  return getCommandCenterState(false);
}

export async function testMuseAgentConnection(agentId: MuseAgentId): Promise<{
  ok: boolean;
  provider: string;
  reply: string;
}> {
  const agent = storeDoc.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Không tìm thấy ${agentId}.`);
  const res = await runAgentTextInference({
    agent,
    systemPrompt: `Bạn là ${agent.name} (${agent.roleTitle}). Hãy xác nhận ngắn gọn 1 câu rằng bạn đã nhận kết nối.`,
    userPrompt: 'Kiểm tra kết nối từ Phòng Điều Hành AI Muse. Trả lời 1 câu tiếng Việt.',
  });
  agent.lastActiveAt = Date.now();
  agent.lastError = undefined;
  addActivityLog('success', `Kiểm tra kết nối ${agent.name}`, `Phản hồi thực từ ${res.provider}: ${res.text.slice(0, 120)}`, {
    agentId: agent.id,
  });
  saveStateAtomic();
  return { ok: true, provider: res.provider, reply: res.text };
}

export async function startProductionOrchestration(params: {
  title?: string;
  script: string;
  productionFormat?: StudioProductionFormat;
  aspectRatio?: DerivativeAspectRatio;
  videoStyle?: StudioVideoStyle;
}): Promise<CommandCenterState> {
  const script = String(params.script || '').trim();
  if (!script) {
    throw new Error('Vui lòng nhập kịch bản hoặc câu lệnh sản xuất trước khi bắt đầu.');
  }

  // Backup previous project state before starting new production run
  if (storeDoc.projectMemory.scenes.length > 0 || storeDoc.projectMemory.originalScript) {
    createBackupSnapshot('pre_restore', `Sao lưu trước phiên sản xuất mới (${storeDoc.projectMemory.title})`);
  }

  const runId = `run_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const title = (params.title || '').trim() || `Phim AI ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

  const freshMemory = createEmptyProjectMemory();
  freshMemory.title = title;
  freshMemory.originalScript = script;
  freshMemory.productionFormat = params.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';
  freshMemory.aspectRatio =
    params.aspectRatio === '9:16' ? '9:16' : params.aspectRatio === '1:1' ? '1:1' : '16:9';
  freshMemory.videoStyle = params.videoStyle || 'cinematic';
  freshMemory.updatedByAgentId = 'user';
  storeDoc.projectMemory = freshMemory;

  const run: ProductionRun = {
    id: runId,
    projectId: freshMemory.projectId,
    title,
    userCommand: script,
    status: 'planning',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sceneCount: 0,
    completedScenes: 0,
    passedQaScenes: 0,
    escalatedScenes: 0,
  };
  storeDoc.runs.unshift(run);
  if (storeDoc.runs.length > 25) storeDoc.runs = storeDoc.runs.slice(0, 25);

  appendConversationMessage({
    channel: 'group',
    projectId: freshMemory.projectId,
    runId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Đạo diễn (Bạn)',
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    content: script,
  });

  enqueueTask({
    runId,
    type: 'plan_production',
    title: `Tổng đạo diễn lập kế hoạch & phân công sản xuất: ${title}`,
    instructions: script,
    assignedAgentId: 'muse-01',
    priority: 10,
  });

  addActivityLog('info', 'Khởi động dây chuyền sản xuất', `Phiên "${title}" đã được giao cho Muse AI 01 — Tổng đạo diễn.`, {
    agentId: 'muse-01',
    runId,
  });
  saveStateAtomic();
  void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function controlProductionRun(
  runId: string,
  action: 'pause' | 'resume' | 'cancel'
): Promise<CommandCenterState> {
  const run = storeDoc.runs.find((r) => r.id === runId);
  if (!run) throw new Error('Không tìm thấy phiên sản xuất.');

  if (action === 'pause') {
    run.status = 'paused';
  } else if (action === 'resume') {
    run.status = 'producing';
    run.error = undefined;
  } else if (action === 'cancel') {
    run.status = 'failed';
    run.error = 'Người dùng đã dừng phiên sản xuất.';
    for (const t of storeDoc.tasks) {
      if (t.runId === runId && ['queued', 'blocked_by_deps'].includes(t.status)) {
        t.status = 'cancelled';
      }
    }
  }
  run.updatedAt = Date.now();
  addActivityLog('info', `Điều khiển phiên ${action}`, `Phiên "${run.title}" chuyển sang trạng thái ${run.status}.`, {
    runId,
  });
  saveStateAtomic();
  if (action === 'resume') void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function createManualTask(params: {
  assignedAgentId: MuseAgentId;
  title: string;
  instructions: string;
  type?: CommandTaskType;
  sceneId?: string;
}): Promise<CommandCenterState> {
  const agent = storeDoc.agents.find((a) => a.id === params.assignedAgentId);
  if (!agent) throw new Error('Không tìm thấy Muse AI được chọn.');
  const runId = storeDoc.runs[0]?.id || 'manual_run';
  const sc = params.sceneId ? storeDoc.projectMemory.scenes.find((s) => s.sceneId === params.sceneId) : undefined;

  const task = enqueueTask({
    runId,
    type: params.type || 'custom_task',
    title: params.title.trim() || `Nhiệm vụ thủ công cho ${agent.name}`,
    instructions: params.instructions.trim() || params.title.trim(),
    assignedAgentId: params.assignedAgentId,
    sceneId: sc?.sceneId,
    sceneIndex: sc?.index,
    priority: 10,
  });

  appendConversationMessage({
    channel: agent.id,
    projectId: storeDoc.projectMemory.projectId,
    runId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Đạo diễn (Bạn)',
    targetAgentIds: [agent.id],
    taskId: task.id,
    content: `[Giao việc ${task.code}] ${task.title}\n${task.instructions}`,
  });

  addActivityLog('info', `Giao việc thủ công ${task.code}`, `${agent.name}: ${task.title}`, {
    agentId: agent.id,
    taskId: task.id,
    runId,
  });
  saveStateAtomic();
  void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function controlTask(
  taskId: string,
  action: 'retry' | 'cancel' | 'run_now'
): Promise<CommandCenterState> {
  const task = storeDoc.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error('Không tìm thấy tác vụ.');

  if (action === 'retry' || action === 'run_now') {
    task.status = 'queued';
    task.error = undefined;
    task.retryCount += action === 'retry' ? 1 : 0;
    const run = storeDoc.runs.find((r) => r.id === task.runId);
    if (run && ['needs_attention', 'failed', 'paused'].includes(run.status)) {
      run.status = 'producing';
      run.error = undefined;
      run.updatedAt = Date.now();
    }
  } else if (action === 'cancel') {
    task.status = 'cancelled';
    task.error = 'Đã hủy thủ công.';
  }
  addActivityLog('info', `Thao tác tác vụ ${task.code}`, `Hành động: ${action}`, {
    agentId: task.assignedAgentId,
    taskId: task.id,
    runId: task.runId,
  });
  saveStateAtomic();
  if (action !== 'cancel') void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function resolveSceneQaManual(
  sceneId: string,
  action: 'approve' | 'reject',
  instruction?: string
): Promise<CommandCenterState> {
  const mem = storeDoc.projectMemory;
  const sc = mem.scenes.find((s) => s.sceneId === sceneId);
  if (!sc) throw new Error('Không tìm thấy phân cảnh.');
  const runId = storeDoc.runs[0]?.id || 'manual_run';

  if (action === 'approve') {
    commitProjectMemoryUpdate('user', `Người dùng duyệt thủ công Cảnh ${sc.index}`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sceneId);
      if (target) {
        target.qaStatus = 'passed';
        target.qaScore = target.qaScore || 85;
      }
    });
    const run = storeDoc.runs.find((r) => r.id === runId);
    if (run) {
      run.passedQaScenes = storeDoc.projectMemory.scenes.filter((s) => s.qaStatus === 'passed').length;
      run.escalatedScenes = storeDoc.projectMemory.scenes.filter((s) => s.qaStatus === 'escalated').length;
      if (run.escalatedScenes === 0 && run.status === 'needs_attention') {
        run.status = 'producing';
        run.error = undefined;
      }
    }
    // Unblock assembly if all scenes passed
    const allPassed = storeDoc.projectMemory.scenes.every((s) => s.qaStatus === 'passed');
    if (allPassed) {
      const hasAssemble = storeDoc.tasks.some(
        (t) => t.runId === runId && t.type === 'assemble_final_film' && ['queued', 'blocked_by_deps', 'running'].includes(t.status)
      );
      if (hasAssemble) {
        const asm = storeDoc.tasks.find((t) => t.runId === runId && t.type === 'assemble_final_film' && t.status === 'blocked_by_deps');
        if (asm) asm.status = 'queued';
      } else {
        enqueueTask({
          runId,
          type: 'assemble_final_film',
          title: `Ghép xuất phim hoàn chỉnh (${storeDoc.projectMemory.scenes.length} cảnh)`,
          instructions: 'Tổng hợp toàn bộ phân cảnh đã duyệt thành video MP4 hoàn chỉnh.',
          assignedAgentId: 'muse-01',
          priority: 1,
        });
      }
    }
  } else {
    const fixText = (instruction || '').trim() || 'Tạo lại phân cảnh này cho khớp gương mặt nhân vật, trang phục và hành động kịch bản.';
    commitProjectMemoryUpdate('user', `Người dùng yêu cầu tạo lại Cảnh ${sc.index}`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sceneId);
      if (target) target.qaStatus = 'rejected';
    });
    const vidTask = enqueueTask({
      runId,
      type: 'produce_scene_video',
      title: `[Làm lại thủ công] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `${sc.actionDetail}. YÊU CẦU: ${fixText}`,
      assignedAgentId: 'muse-04',
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 9,
    });
    enqueueTask({
      runId,
      type: 'qa_inspect_scene',
      title: `[Kiểm định lại] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: fixText,
      assignedAgentId: 'muse-05',
      dependsOnTaskIds: [vidTask.id],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 8,
    });
  }

  saveStateAtomic();
  void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function sendCommandCenterChat(params: {
  channel: 'group' | MuseAgentId;
  message: string;
  targetAgentId?: MuseAgentId;
}): Promise<{ state: CommandCenterState; reply?: ConversationMessage }> {
  const text = String(params.message || '').trim();
  if (!text) throw new Error('Vui lòng nhập nội dung tin nhắn.');
  const mem = storeDoc.projectMemory;
  const runId = storeDoc.runs[0]?.id;

  appendConversationMessage({
    channel: params.channel,
    projectId: mem.projectId,
    runId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Đạo diễn (Bạn)',
    targetAgentIds: params.channel === 'group' ? ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'] : [params.channel],
    content: text,
  });

  // Determine which agent replies
  const responderId: MuseAgentId =
    params.channel !== 'group' ? params.channel : params.targetAgentId || 'muse-01';
  const responder = storeDoc.agents.find((a) => a.id === responderId) || storeDoc.agents[0];

  const recentHistory = storeDoc.conversations
    .filter((m) => m.channel === params.channel)
    .slice(-8)
    .map((m) => `${m.senderName}: ${m.content}`)
    .join('\n');

  const sys = `Bạn là ${responder.name} (${responder.roleTitle}) trong Phòng Điều Hành AI Muse.
Vai trò: ${responder.description}
Dự án hiện tại: "${mem.title}" (Project Memory v${mem.version}, ${mem.characters.length} nhân vật, ${mem.scenes.length} cảnh).
${
  params.channel === 'group'
    ? 'Bạn đang trả lời trong Phòng họp nhóm 5 AI Muse. Hãy phản hồi rõ ràng, phối hợp công việc thực tế với các thành viên còn lại.'
    : 'Bạn đang trao đổi trực tiếp 1-1 với Đạo diễn.'
}`;

  const prompt = `Lịch sử trao đổi gần đây:\n${recentHistory}\n\nYêu cầu mới nhất của Đạo diễn:\n${text}`;

  const inf = await runAgentTextInference({
    agent: responder,
    systemPrompt: sys,
    userPrompt: prompt,
  });

  responder.lastActiveAt = Date.now();
  const reply = appendConversationMessage({
    channel: params.channel,
    projectId: mem.projectId,
    runId,
    senderType: 'agent',
    senderId: responder.id,
    senderName: `${responder.name} (${responder.roleTitle})`,
    promptDelivered: text,
    content: inf.text,
  });

  addActivityLog('info', `Chat ${params.channel === 'group' ? 'nhóm' : responder.code}`, `${responder.name} đã phản hồi qua ${inf.provider}.`, {
    agentId: responder.id,
    runId,
  });
  saveStateAtomic();
  return { state: await getCommandCenterState(false), reply };
}

export function searchCommandCenterArchive(params: {
  query?: string;
  agentId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
}): {
  messages: ConversationMessage[];
  tasks: CommandTask[];
} {
  const q = String(params.query || '').trim().toLowerCase();
  const fromMs = params.dateFrom ? new Date(params.dateFrom).getTime() : 0;
  const toMs = params.dateTo ? new Date(params.dateTo).getTime() + 86_400_000 : Number.MAX_SAFE_INTEGER;

  const messages = storeDoc.conversations.filter((m) => {
    if (params.agentId && params.agentId !== 'all') {
      if (m.senderId !== params.agentId && m.channel !== params.agentId && !(m.targetAgentIds || []).includes(params.agentId as MuseAgentId)) {
        return false;
      }
    }
    if (params.projectId && params.projectId !== 'all' && m.projectId !== params.projectId) return false;
    if (m.createdAt < fromMs || m.createdAt > toMs) return false;
    if (q) {
      const hay = `${m.senderName} ${m.content} ${m.promptDelivered || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const tasks = storeDoc.tasks.filter((t) => {
    if (params.agentId && params.agentId !== 'all' && t.assignedAgentId !== params.agentId) return false;
    if (t.createdAt < fromMs || t.createdAt > toMs) return false;
    if (q) {
      const hay = `${t.code} ${t.title} ${t.instructions} ${t.outputText || ''} ${t.error || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    messages: messages.slice(-150).reverse(),
    tasks: tasks.slice(-100).reverse(),
  };
}

export async function createManualBackup(summary?: string): Promise<CommandCenterState> {
  createBackupSnapshot('manual', summary?.trim() || `Sao lưu thủ công (${storeDoc.projectMemory.title})`);
  addActivityLog('success', 'Tạo bản sao lưu thủ công', `Đã lưu snapshot Project Memory v${storeDoc.projectMemory.version} và ${storeDoc.conversations.length} tin nhắn.`);
  saveStateAtomic();
  return getCommandCenterState(false);
}

export async function restoreBackupById(backupId: string): Promise<CommandCenterState> {
  const fp = path.join(BACKUPS_DIR, `${backupId.replace(/[^a-zA-Z0-9._-]/g, '')}.json`);
  if (!fs.existsSync(fp)) {
    throw new Error('Không tìm thấy tệp sao lưu để khôi phục.');
  }
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  createBackupSnapshot('pre_restore', `Sao lưu tự động trước khi khôi phục ${backupId}`);

  if (Array.isArray(data.agents) && data.agents.length === 5) storeDoc.agents = data.agents;
  if (data.projectMemory) storeDoc.projectMemory = data.projectMemory;
  if (Array.isArray(data.runs)) storeDoc.runs = data.runs;
  if (Array.isArray(data.tasks)) storeDoc.tasks = data.tasks;
  if (Array.isArray(data.qaReports)) storeDoc.qaReports = data.qaReports;
  if (Array.isArray(data.conversations)) storeDoc.conversations = data.conversations;

  addActivityLog('warn', 'Khôi phục từ Backup', `Đã khôi phục toàn bộ trạng thái từ ${backupId}.`);
  saveStateAtomic();
  return getCommandCenterState(false);
}

export function getBackupExportFilePath(backupId: string): string | null {
  const fp = path.join(BACKUPS_DIR, `${backupId.replace(/[^a-zA-Z0-9._-]/g, '')}.json`);
  return fs.existsSync(fp) ? fp : null;
}

export async function restoreProjectMemorySnapshot(snapshotId: string): Promise<CommandCenterState> {
  const snap = storeDoc.projectMemory.snapshots.find((s) => s.id === snapshotId);
  if (!snap) throw new Error('Không tìm thấy phiên bản Project Memory cần khôi phục.');

  commitProjectMemoryUpdate('user', `Khôi phục Project Memory về bản v${snap.version}`, (m) => {
    m.title = snap.data.title;
    m.originalScript = snap.data.originalScript;
    m.productionFormat = snap.data.productionFormat;
    m.aspectRatio = snap.data.aspectRatio;
    m.videoStyle = snap.data.videoStyle;
    m.visualBible = snap.data.visualBible;
    m.settingBible = snap.data.settingBible;
    m.costumeBible = snap.data.costumeBible;
    m.continuityBible = snap.data.continuityBible;
    m.timelineSummary = snap.data.timelineSummary;
    m.characters = structuredClone(snap.data.characters);
    m.scenes = structuredClone(snap.data.scenes);
  });
  addActivityLog('warn', 'Khôi phục Project Memory', `Đã khôi phục về phiên bản v${snap.version}.`);
  return getCommandCenterState(false);
}

export async function updateCloudConfig(patch: {
  muse2ApiBaseUrl?: string;
  muse2ApiKey?: string;
  clearCustomKey?: boolean;
  parallelLimit?: number;
  qaPassThreshold?: number;
  maxRetriesPerScene?: number;
  autoBackupRealtime?: boolean;
}): Promise<CommandCenterState> {
  if (typeof patch.muse2ApiBaseUrl === 'string') {
    storeDoc.cloudConfig.muse2ApiBaseUrl = patch.muse2ApiBaseUrl.trim().replace(/\/+$/, '');
  }
  if (patch.clearCustomKey) {
    storeDoc.cloudConfig.customMuse2ApiKey = '';
  } else if (typeof patch.muse2ApiKey === 'string' && patch.muse2ApiKey.trim()) {
    storeDoc.cloudConfig.customMuse2ApiKey = patch.muse2ApiKey.trim();
  }
  if (typeof patch.parallelLimit === 'number') {
    storeDoc.cloudConfig.parallelLimit = Math.max(1, Math.min(5, Math.round(patch.parallelLimit)));
  }
  if (typeof patch.qaPassThreshold === 'number') {
    storeDoc.cloudConfig.qaPassThreshold = Math.max(50, Math.min(98, Math.round(patch.qaPassThreshold)));
  }
  if (typeof patch.maxRetriesPerScene === 'number') {
    storeDoc.cloudConfig.maxRetriesPerScene = Math.max(0, Math.min(5, Math.round(patch.maxRetriesPerScene)));
  }
  if (typeof patch.autoBackupRealtime === 'boolean') {
    storeDoc.cloudConfig.autoBackupRealtime = patch.autoBackupRealtime;
  }

  setMuse2ApiRuntimeOverride({
    baseUrl: storeDoc.cloudConfig.muse2ApiBaseUrl,
    apiKey: storeDoc.cloudConfig.customMuse2ApiKey,
  });

  addActivityLog(
    'info',
    'Cập nhật cấu hình Cloud & Điều phối',
    `Muse2API: ${storeDoc.cloudConfig.muse2ApiBaseUrl || 'mặc định'} · Song song: ${storeDoc.cloudConfig.parallelLimit} · Ngưỡng QA: ${storeDoc.cloudConfig.qaPassThreshold}`
  );
  saveStateAtomic();
  return getCommandCenterState(true);
}

export function resolveArtifactDiskPath(filename: string): string | null {
  const safe = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return null;
  const fp = path.join(ARTIFACTS_DIR, safe);
  return fs.existsSync(fp) ? fp : null;
}
