import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
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
import {
  buildReferenceCharacterLockRules,
  EXPLICIT_WARDROBE_CHANGE_REQUEST_RE,
} from './skills/shortDramaProductionRules';
import type {
  CharacterFivePartProfile,
  DerivativeAspectRatio,
  DerivativeBlueprint,
  StudioProductionFormat,
  StudioVideoStyle,
} from '../src/types/bilibili';
import type {
  CloudOrchestratorConfig,
  CommandActivityLog,
  CommandBackupRecord,
  CommandCenterSseEventType,
  CommandCenterState,
  CommandCenterSummaryMetrics,
  CommandMemoryCharacter,
  CommandMemoryScene,
  CommandTask,
  CommandTaskStatus,
  CommandTaskType,
  CommunicationChannelId,
  ConversationMessage,
  CostumeMismatchReport,
  CostumeVersionSnapshot,
  FastCommStats,
  IncidentCategory,
  IncidentDialogTurn,
  IncidentRecord,
  IncidentSeverity,
  MuseAgentAvatarPreset,
  MuseAgentConfig,
  MuseAgentEngineMode,
  MuseAgentId,
  MuseAgentPermissions,
  MuseAgentStatus,
  MuseIntegrationHealth,
  MuseRunProgress,
  PerformanceAlert,
  ProductionRun,
  ProjectMemory,
  ProjectMemorySnapshot,
  QaCriterionId,
  QaCriterionResult,
  QaInspectionReport,
  StudioSyncedDirective,
} from '../src/types/commandCenter';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'muse_command_center.json');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'command_center_artifacts');
const BACKUPS_DIR = path.join(DATA_DIR, 'command_center_backups');
const STUDIO_ASSETS_DIR = path.join(process.cwd(), 'studio_assets');
const WORKER_BOOT_ID = `worker_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const TASK_TEXT_TIMEOUT_MS = 180_000;
const TASK_MEDIA_TIMEOUT_MS = 360_000;
const SLOW_TEXT_THRESHOLD_MS = 45_000;

interface StoredStudioBlueprintCache {
  syncedAt: number;
  title: string;
  scriptOrCommand: string;
  productionFormat: StudioProductionFormat;
  aspectRatio: DerivativeAspectRatio;
  videoStyle: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  visualBible?: string;
  settingBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  characters?: CommandMemoryCharacter[];
  scenes?: CommandMemoryScene[];
}

interface PersistedCommandCenterDoc {
  agents: MuseAgentConfig[];
  projectMemory: ProjectMemory;
  sessionMemories: Record<string, ProjectMemory>;
  selectedRunId?: string | null;
  latestStudioDirective?: StudioSyncedDirective | null;
  latestStudioBlueprint?: StoredStudioBlueprintCache | null;
  runs: ProductionRun[];
  tasks: CommandTask[];
  qaReports: QaInspectionReport[];
  incidents: IncidentRecord[];
  conversations: ConversationMessage[];
  logs: CommandActivityLog[];
  backups: CommandBackupRecord[];
  performanceAlerts: PerformanceAlert[];
  fastCommStats: {
    ackSamplesMs: number[];
    agentResponseSamplesMs: Record<string, number[]>;
    hungTaskCount: number;
    dedupedTaskCount: number;
  };
  cloudConfig: CloudOrchestratorConfig & { customMuse2ApiKey?: string };
  taskSeq: number;
  incidentSeq: number;
}

const DEFAULT_AGENTS: MuseAgentConfig[] = [
  {
    id: 'muse-01',
    code: 'Muse AI 01',
    name: 'Muse Director',
    role: 'director',
    roleTitle: 'Tổng đạo diễn',
    description:
      'AI điều phối trưởng: nhận lệnh sản xuất, phân tích kịch bản tổng thể, chia việc song song, quản lý Project Memory và tổng hợp phim hoàn chỉnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'director_clapboard',
    accentColor: '#7C3AED',
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
    name: 'Muse Script',
    role: 'screenwriter',
    roleTitle: 'Biên kịch',
    description:
      'Phân tích kịch bản, hồ sơ nhân vật 5 thành phần, giọng nói theo độ tuổi, lời thoại, bối cảnh, timeline theo giây và cấu trúc phân cảnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'script_feather',
    accentColor: '#0891B2',
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
    name: 'Muse Visual',
    role: 'image_designer',
    roleTitle: 'Thiết kế hình ảnh',
    description:
      'Tạo ảnh tham chiếu nhân vật và ảnh keyframe phân cảnh, giữ đồng bộ gương mặt, vóc dáng, trang phục và bối cảnh.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'visual_palette',
    accentColor: '#DB2777',
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
    name: 'Muse Video',
    role: 'video_director',
    roleTitle: 'Đạo diễn video',
    description:
      'Sản xuất video phân cảnh theo timeline từng giây, chuyển động, góc quay, lời thoại, khẩu hình và nối cảnh liên tục.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'video_camera',
    accentColor: '#D97706',
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
    name: 'Muse Guardian',
    role: 'qa_supervisor',
    roleTitle: 'Kiểm duyệt chất lượng',
    description:
      'AI kiểm định độc lập: đối chiếu 8 tiêu chí đồng nhất toàn phim, phát hiện sai lệch và yêu cầu tạo lại đúng phân cảnh lỗi.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'qa_shield',
    accentColor: '#059669',
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
    allowFreeCostumeChange: false,
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
    sessionMemories: {},
    selectedRunId: null,
    latestStudioDirective: null,
    latestStudioBlueprint: null,
    runs: [],
    tasks: [],
    qaReports: [],
    incidents: [],
    conversations: [],
    logs: [],
    backups: [],
    performanceAlerts: [],
    fastCommStats: {
      ackSamplesMs: [],
      agentResponseSamplesMs: {},
      hungTaskCount: 0,
      dedupedTaskCount: 0,
    },
    cloudConfig: {
      muse2ApiBaseUrl: cfg.baseUrl,
      customMuse2ApiKey: '',
      hasCustomMuse2ApiKey: false,
      maskedMuse2ApiKey: cfg.maskedKey,
      parallelLimit: 2,
      qaPassThreshold: 80,
      maxRetriesPerScene: 2,
      maxIncidentRetries: 3,
      autoDirectorIncidentResponse: true,
      autoBackupRealtime: true,
      workerHeartbeatAt: Date.now(),
      workerBootId: WORKER_BOOT_ID,
      isCloudEndpoint: !isLocalhostUrl(cfg.baseUrl),
    },
    taskSeq: 1,
    incidentSeq: 1,
  };
}

let storeDoc: PersistedCommandCenterDoc = createDefaultDoc();
let cachedHealth: MuseIntegrationHealth | null = null;
let lastHealthCheckAt = 0;
let orchestratorTimer: NodeJS.Timeout | null = null;
let isTicking = false;
const activeTaskIds = new Set<string>();
let lastAutoBackupAt = 0;

// ==========================================
// REAL-TIME SSE EVENT BUS (FAST COMMUNICATION ENGINE)
// ==========================================
const commandCenterBus = new EventEmitter();
commandCenterBus.setMaxListeners(100);
let sseClientsConnected = 0;
let pendingSyncTimer: NodeJS.Timeout | null = null;

export function emitCommandCenterEvent(type: CommandCenterSseEventType, data: any): void {
  commandCenterBus.emit('event', { type, data, ts: Date.now() });
  if (type !== 'state:sync') {
    if (pendingSyncTimer) return;
    pendingSyncTimer = setTimeout(() => {
      pendingSyncTimer = null;
      void getCommandCenterState(false)
        .then((st) => {
          commandCenterBus.emit('event', { type: 'state:sync', data: st, ts: Date.now() });
        })
        .catch(() => {});
    }, 120);
    pendingSyncTimer.unref();
  }
}

export function subscribeCommandCenterEvents(
  listener: (evt: { type: CommandCenterSseEventType; data: any; ts: number }) => void
): () => void {
  sseClientsConnected += 1;
  commandCenterBus.on('event', listener);
  emitCommandCenterEvent('metric:updated', { sseClientsConnected });
  return () => {
    commandCenterBus.off('event', listener);
    sseClientsConnected = Math.max(0, sseClientsConnected - 1);
  };
}

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

function mapLegacyChannel(ch?: string): CommunicationChannelId {
  if (!ch || ch === 'group') return 'commander';
  if (
    ch === 'commander' ||
    ch === 'incident' ||
    ch === 'production' ||
    ch === 'script' ||
    ch === 'visual' ||
    ch === 'video' ||
    ch === 'qa' ||
    ch === 'ai_bus' ||
    ch === 'muse-01' ||
    ch === 'muse-02' ||
    ch === 'muse-03' ||
    ch === 'muse-04' ||
    ch === 'muse-05'
  ) {
    return ch;
  }
  return 'commander';
}

function appendConversationMessage(msg: Omit<ConversationMessage, 'id' | 'createdAt'>): ConversationMessage {
  const ag = storeDoc.agents.find((a) => a.id === msg.senderId);
  const full: ConversationMessage = {
    ...msg,
    channel: mapLegacyChannel(msg.channel),
    sessionId: msg.sessionId || msg.runId,
    senderAvatarUrl: msg.senderAvatarUrl || ag?.avatarUrl,
    senderColor: msg.senderColor || ag?.accentColor,
    id: `msg_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
  };
  storeDoc.conversations.push(full);
  if (storeDoc.conversations.length > 1200) {
    storeDoc.conversations = storeDoc.conversations.slice(-1200);
  }
  emitCommandCenterEvent('message:created', full);
  return full;
}

function postAiBusMessage(params: {
  fromAgent: MuseAgentConfig;
  toAgentIds: MuseAgentId[];
  runId: string;
  projectId: string;
  taskId?: string;
  sceneId?: string;
  content: string;
}): void {
  const toLabels = params.toAgentIds
    .map((id) => storeDoc.agents.find((a) => a.id === id)?.name || id)
    .join(', ');
  appendConversationMessage({
    channel: 'ai_bus',
    projectId: params.projectId,
    runId: params.runId,
    sessionId: params.runId,
    sceneId: params.sceneId,
    taskId: params.taskId,
    senderType: 'agent',
    senderId: params.fromAgent.id,
    senderName: `${params.fromAgent.name} → ${toLabels}`,
    senderAvatarUrl: params.fromAgent.avatarUrl,
    senderColor: params.fromAgent.accentColor,
    messageKind: 'ai_bus',
    targetAgentIds: params.toAgentIds,
    content: params.content,
  });
}

function pushPerformanceAlert(params: {
  severity: 'warn' | 'error';
  category: PerformanceAlert['category'];
  agentId?: MuseAgentId;
  taskId?: string;
  runId?: string;
  message: string;
}): void {
  const alert: PerformanceAlert = {
    id: `alt_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
    severity: params.severity,
    category: params.category,
    agentId: params.agentId,
    taskId: params.taskId,
    runId: params.runId,
    message: params.message,
    resolved: false,
  };
  storeDoc.performanceAlerts.unshift(alert);
  if (storeDoc.performanceAlerts.length > 100) {
    storeDoc.performanceAlerts = storeDoc.performanceAlerts.slice(0, 100);
  }
  emitCommandCenterEvent('alert:created', alert);
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

function getEffectiveSelectedRunId(): string | null {
  if (storeDoc.selectedRunId && storeDoc.runs.some((r) => r.id === storeDoc.selectedRunId)) {
    return storeDoc.selectedRunId;
  }
  const running = storeDoc.runs.find((r) => ['planning', 'producing', 'inspecting', 'assembling'].includes(r.status));
  return running?.id || storeDoc.runs[0]?.id || null;
}

function getRunMemory(runId?: string): ProjectMemory {
  if (runId && storeDoc.sessionMemories[runId]) {
    return storeDoc.sessionMemories[runId];
  }
  if (runId && runId !== 'manual_run') {
    const cloned = structuredClone(storeDoc.projectMemory);
    storeDoc.sessionMemories[runId] = cloned;
    return cloned;
  }
  return storeDoc.projectMemory;
}

function throwIfRunStopped(runId?: string): void {
  if (!runId) return;
  const run = storeDoc.runs.find((r) => r.id === runId);
  if (!run) return;
  if (run.status === 'paused') {
    throw new Error('__RUN_PAUSED__');
  }
  if (run.status === 'cancelled') {
    throw new Error('__RUN_CANCELLED__');
  }
}

function commitSessionMemoryUpdate(
  runId: string | undefined,
  authorAgentId: string,
  summary: string,
  updater: (mem: ProjectMemory) => void
): number {
  const mem = getRunMemory(runId);
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
      allowFreeCostumeChange: mem.allowFreeCostumeChange === true,
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

  const selectedId = getEffectiveSelectedRunId();
  if (!runId || !selectedId || runId === selectedId) {
    storeDoc.projectMemory = mem;
  }
  saveStateAtomic();
  return mem.version;
}

function commitProjectMemoryUpdate(
  authorAgentId: string,
  summary: string,
  updater: (mem: ProjectMemory) => void
): number {
  return commitSessionMemoryUpdate(getEffectiveSelectedRunId() || undefined, authorAgentId, summary, updater);
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
  costumeRecovery?: CommandTask['costumeRecovery'];
  priority?: number;
  maxRetries?: number;
}): CommandTask {
  // Deduplication guard: prevent duplicate active/pending task for same runId + type + sceneId + characterId
  if (input.type !== 'custom_task') {
    const dup = storeDoc.tasks.find(
      (t) =>
        t.runId === input.runId &&
        t.type === input.type &&
        t.sceneId === input.sceneId &&
        t.characterId === input.characterId &&
        ['queued', 'blocked_by_deps', 'running'].includes(t.status)
    );
    if (dup) {
      storeDoc.fastCommStats.dedupedTaskCount += 1;
      return dup;
    }
  }

  const now = Date.now();
  const deps = (input.dependsOnTaskIds || []).filter(Boolean);
  const depsDone = deps.every((depId) => {
    const dep = storeDoc.tasks.find((t) => t.id === depId);
    return dep?.status === 'completed';
  });
  const isMedia =
    input.type === 'design_character_ref' ||
    input.type === 'design_scene_image' ||
    input.type === 'restore_costume_and_regen_image' ||
    input.type === 'produce_scene_video' ||
    input.type === 'assemble_final_film';
  const task: CommandTask = {
    id: `task_${now}_${crypto.randomBytes(3).toString('hex')}`,
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
    costumeRecovery: input.costumeRecovery,
    status: depsDone ? 'queued' : 'blocked_by_deps',
    priority: input.priority ?? 10,
    retryCount: 0,
    maxRetries: input.maxRetries ?? storeDoc.cloudConfig.maxRetriesPerScene,
    createdAt: now,
    acknowledgedAt: now,
    timeoutMs: isMedia ? TASK_MEDIA_TIMEOUT_MS : TASK_TEXT_TIMEOUT_MS,
  };
  storeDoc.tasks.push(task);
  if (storeDoc.tasks.length > 600) {
    storeDoc.tasks = storeDoc.tasks.slice(-600);
  }
  emitCommandCenterEvent('task:updated', task);
  return task;
}

// ==========================================
// IMMUTABLE REFERENCE COSTUME LOCK & PROMPT SANITIZER
// ==========================================
function ensureCharacterOriginalAnchors(ch: CommandMemoryCharacter): void {
  if (!ch.confirmedOriginalSyncProfile && ch.syncProfile) {
    ch.confirmedOriginalSyncProfile = structuredClone(ch.syncProfile);
  }
  if (!ch.confirmedOriginalDataUrl && ch.dataUrl) {
    ch.confirmedOriginalDataUrl = ch.dataUrl;
  }
  if (!ch.confirmedOriginalArtifactUrl && ch.artifactUrl) {
    ch.confirmedOriginalArtifactUrl = ch.artifactUrl;
  }
  if (!Array.isArray(ch.costumeVersionHistory)) {
    ch.costumeVersionHistory = [];
  }
}

function getCharacterCanonicalCostume(ch?: CommandMemoryCharacter): string {
  if (!ch) return '';
  return String(
    ch.confirmedOriginalSyncProfile?.costume || ch.syncProfile?.costume || ''
  ).trim();
}

function getCharacterCanonicalImageRefUrl(ch?: CommandMemoryCharacter): string | undefined {
  if (!ch) return undefined;
  return ch.confirmedOriginalArtifactUrl || ch.artifactUrl || ch.confirmedOriginalDataUrl || ch.dataUrl;
}

function getCharacterCanonicalImageDataUrl(ch?: CommandMemoryCharacter): string | undefined {
  if (!ch) return undefined;
  return (
    ch.confirmedOriginalDataUrl ||
    artifactUrlToDataUrl(ch.confirmedOriginalArtifactUrl) ||
    ch.dataUrl ||
    artifactUrlToDataUrl(ch.artifactUrl)
  );
}

function matchCharacterForScene(
  mem: ProjectMemory,
  sc?: CommandMemoryScene,
  hintNameOrId?: string
): CommandMemoryCharacter | undefined {
  if (!mem.characters || mem.characters.length === 0) return undefined;
  const hint = String(hintNameOrId || '').trim().toLowerCase();
  if (hint) {
    const byId = mem.characters.find((c) => c.id.toLowerCase() === hint);
    if (byId) return byId;
    const byName = mem.characters.find(
      (c) =>
        c.name.trim().toLowerCase() === hint ||
        hint.includes(c.name.trim().toLowerCase()) ||
        c.name.trim().toLowerCase().includes(hint)
    );
    if (byName) return byName;
  }
  if (sc) {
    const corpus = `${sc.speakerName || ''} ${sc.dialogue || ''} ${sc.actionDetail || ''} ${sc.title || ''}`.toLowerCase();
    const matched = mem.characters.find((c) => {
      const nm = c.name.trim().toLowerCase();
      return nm && corpus.includes(nm);
    });
    if (matched) return matched;
  }
  return mem.characters[0];
}

function stripWardrobeDriftFromText(raw: string): string {
  let out = String(raw || '').trim();
  if (!out) return '';
  // Remove explicit wardrobe change requests & conflicting clothing override phrases
  out = out
    .replace(new RegExp(EXPLICIT_WARDROBE_CHANGE_REQUEST_RE.source, 'gi'), '')
    .replace(/(?:tự ý\s*)?(?:đổi|thay|khoác thêm|mặc thêm|thêm|bỏ)\s+(?:áo khoác|trang phục|quần áo|váy|mũ|nón|kính|phụ kiện)[^.,;]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
  return out;
}

function sanitizeCostumeSourcesInMemory(
  mem: ProjectMemory,
  opts?: { sceneId?: string; characterId?: string }
): { cleanedCount: number; canonicalCostumeBible: string } {
  let cleanedCount = 0;
  for (const ch of mem.characters) {
    ensureCharacterOriginalAnchors(ch);
    if (!opts?.characterId || ch.id === opts.characterId) {
      const origCostume = getCharacterCanonicalCostume(ch);
      if (origCostume && ch.syncProfile.costume !== origCostume) {
        ch.syncProfile.costume = origCostume;
        cleanedCount += 1;
      }
    }
  }

  const canonicalEntries = mem.characters
    .map((c) => {
      const cst = getCharacterCanonicalCostume(c);
      return cst ? `${c.name}: ${cst}` : '';
    })
    .filter(Boolean);
  const canonicalCostumeBible =
    canonicalEntries.join(' | ') || mem.costumeBible || 'Giữ nguyên 100% trang phục tham chiếu đã xác nhận';

  if (mem.allowFreeCostumeChange !== true && canonicalCostumeBible && mem.costumeBible !== canonicalCostumeBible) {
    mem.costumeBible = canonicalCostumeBible;
    cleanedCount += 1;
  }

  // Clean affected scene + any unpassed subsequent scenes so drifted prompt tokens do not propagate
  for (const sc of mem.scenes) {
    if (sc.qaStatus === 'passed') continue; // NEVER alter scenes that already passed QA
    const isTarget = !opts?.sceneId || sc.sceneId === opts.sceneId;
    const ch = matchCharacterForScene(mem, sc, opts?.characterId);
    const sceneCanonicalCostume =
      (ch ? `${ch.name}: ${getCharacterCanonicalCostume(ch)}` : '') || canonicalCostumeBible;
    if (sceneCanonicalCostume && sc.costume !== sceneCanonicalCostume) {
      sc.costume = sceneCanonicalCostume;
      cleanedCount += 1;
    }
    const strippedAction = stripWardrobeDriftFromText(sc.actionDetail);
    if (strippedAction && strippedAction !== sc.actionDetail) {
      sc.actionDetail = strippedAction;
      cleanedCount += 1;
    }
    if (isTarget && mem.allowFreeCostumeChange !== true && sceneCanonicalCostume) {
      // Clear stale costume override hints inside queued scene instructions if any
      for (const queuedTask of storeDoc.tasks) {
        if (
          queuedTask.sceneId === sc.sceneId &&
          ['queued', 'blocked_by_deps'].includes(queuedTask.status) &&
          queuedTask.type === 'produce_scene_video'
        ) {
          queuedTask.instructions = `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. Trang phục khóa chuẩn: ${sceneCanonicalCostume}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`;
        }
      }
    }
  }

  return { cleanedCount, canonicalCostumeBible };
}

function buildCostumeMismatchReport(params: {
  mem: ProjectMemory;
  runId: string;
  targetMediaKind: 'character_image' | 'scene_image' | 'scene_video';
  scene?: CommandMemoryScene;
  character?: CommandMemoryCharacter;
  responsibleAgentId: MuseAgentId;
  faultyArtifactUrl?: string;
  faultyVideoUrl?: string;
  observedCostume?: string;
  mismatchDetails: string;
  restoreRecommendation?: string;
}): CostumeMismatchReport {
  const ch = params.character || matchCharacterForScene(params.mem, params.scene);
  if (ch) ensureCharacterOriginalAnchors(ch);
  const expectedCostume =
    getCharacterCanonicalCostume(ch) ||
    params.scene?.costume ||
    params.mem.costumeBible ||
    'Trang phục tham chiếu gốc đã xác nhận';
  const referenceImageUrl = getCharacterCanonicalImageRefUrl(ch);
  const charName = ch?.name || params.scene?.speakerName || 'Nhân vật chính';
  const charId = ch?.id || 'char_1';
  return {
    characterId: charId,
    characterName: charName,
    projectId: params.mem.projectId,
    runId: params.runId,
    sceneId: params.scene?.sceneId,
    sceneIndex: params.scene?.index,
    targetMediaKind: params.targetMediaKind,
    referenceImageUrl,
    expectedCostume,
    faultyArtifactUrl: params.faultyArtifactUrl,
    faultyVideoUrl: params.faultyVideoUrl,
    observedCostume: params.observedCostume,
    mismatchDetails: params.mismatchDetails,
    responsibleAgentId: params.responsibleAgentId,
    restoreRecommendation:
      params.restoreRecommendation ||
      `Khôi phục nguyên bản trang phục của "${charName}" (${charId}) từ ảnh tham chiếu gốc và hồ sơ nhân vật ban đầu ("${expectedCostume}"), loại bỏ mọi mô tả trang phục sai lệch và tạo lại đúng phần bị lỗi.`,
    detectedAt: Date.now(),
  };
}

// ==========================================
// AI DIRECTOR COMMAND & INCIDENT RESPONSE (CENTRALIZED RECOVERY)
// ==========================================
const INCIDENT_SMART_RULES: Record<
  IncidentCategory,
  { label: string; directive: string; rebuildKeyframe: boolean; targetAgent?: MuseAgentId }
> = {
  wrong_character: {
    label: 'Sai nhân vật',
    directive: 'Kiểm tra lại Character ID và hồ sơ tham chiếu 5 thành phần rồi tạo lại riêng phân cảnh.',
    rebuildKeyframe: true,
    targetAgent: 'muse-03',
  },
  wrong_dialogue: {
    label: 'Sai lời thoại',
    directive: 'Đối chiếu kịch bản gốc, sửa phân vai Character ID, lời thoại và timeline lời thoại trước khi tạo lại.',
    rebuildKeyframe: false,
    targetAgent: 'muse-04',
  },
  wrong_voice: {
    label: 'Sai giọng nói',
    directive: 'Khôi phục cấu hình giọng chuẩn theo giới tính, độ tuổi và sắc thái nhân vật trong Project Memory.',
    rebuildKeyframe: false,
    targetAgent: 'muse-04',
  },
  wrong_costume: {
    label: 'Sai trang phục',
    directive: 'Đối chiếu hồ sơ đồng bộ trang phục cố định của nhân vật và vẽ/tạo lại riêng cảnh lỗi.',
    rebuildKeyframe: true,
    targetAgent: 'muse-03',
  },
  wrong_setting: {
    label: 'Sai bối cảnh',
    directive: 'Kiểm tra dữ liệu bối cảnh, ánh sáng của cảnh trước và cảnh sau để nối mạch không gian chuẩn.',
    rebuildKeyframe: true,
    targetAgent: 'muse-03',
  },
  motion_error: {
    label: 'Lỗi chuyển động',
    directive: 'Điều chỉnh lại timeline theo từng giây, hành động cụ thể và chuyển động camera.',
    rebuildKeyframe: false,
    targetAgent: 'muse-04',
  },
  video_technical_error: {
    label: 'Video lỗi kỹ thuật',
    directive: 'Kiểm tra thông số tạo clip, âm thanh/khung hình và yêu cầu tạo lại riêng phân cảnh này.',
    rebuildKeyframe: false,
    targetAgent: 'muse-04',
  },
  muse_disconnected: {
    label: 'Muse mất kết nối',
    directive: 'Thử kết nối lại tài khoản khỏe mạnh, kích hoạt dự phòng hoặc chuyển giao nhiệm vụ sang Muse khả dụng.',
    rebuildKeyframe: false,
  },
  recurring_error: {
    label: 'Lỗi lặp lại',
    directive: 'Phân tích nguyên nhân gốc từ các lần sửa trước, thay đổi phương án tạo lại từ keyframe và khóa chặt prompt chuẩn.',
    rebuildKeyframe: true,
    targetAgent: 'muse-03',
  },
};

function nextIncidentCode(): string {
  const seq = Number(storeDoc.incidentSeq) || storeDoc.incidents.length + 1;
  const code = `INC-${String(seq).padStart(3, '0')}`;
  storeDoc.incidentSeq = seq + 1;
  return code;
}

function appendIncidentTurn(
  inc: IncidentRecord,
  turn: Omit<IncidentDialogTurn, 'id' | 'timestamp'>
): IncidentDialogTurn {
  const full: IncidentDialogTurn = {
    ...turn,
    id: `inct_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
  };
  inc.history.push(full);
  if (inc.history.length > 60) {
    inc.history = inc.history.slice(-60);
  }
  inc.updatedAt = full.timestamp;
  return full;
}

function postIncidentChannelMessage(params: {
  inc: IncidentRecord;
  senderId: MuseAgentId | 'user' | 'system';
  senderName: string;
  roleBadge: string;
  content: string;
  targetAgentIds?: MuseAgentId[];
  attachments?: string[];
}): void {
  const senderAgent = storeDoc.agents.find((a) => a.id === params.senderId);
  appendConversationMessage({
    channel: 'incident',
    projectId: params.inc.projectId,
    runId: params.inc.runId,
    sessionId: params.inc.sessionId,
    sceneId: params.inc.sceneId,
    taskId: params.inc.taskId,
    incidentId: params.inc.id,
    roleBadge: params.roleBadge,
    senderType: params.senderId === 'user' ? 'user' : params.senderId === 'system' ? 'system' : 'agent',
    senderId: params.senderId,
    senderName: params.senderName,
    senderAvatarUrl: senderAgent?.avatarUrl,
    senderColor: senderAgent?.accentColor || (params.senderId === 'system' ? '#F59E0B' : undefined),
    targetAgentIds: params.targetAgentIds,
    messageKind: 'incident',
    attachments: params.attachments,
    content: params.content,
  });
}

function classifyIncidentCategory(params: {
  explicitCategory?: IncidentCategory;
  priorCategory?: IncidentCategory;
  costumeMismatch?: CostumeMismatchReport;
  qaReport?: QaInspectionReport;
  errorText?: string;
  priorAttempts?: number;
}): IncidentCategory {
  if (params.costumeMismatch || params.explicitCategory === 'wrong_costume' || params.priorCategory === 'wrong_costume') {
    return 'wrong_costume';
  }
  if ((params.priorAttempts || 0) >= 1) {
    return 'recurring_error';
  }
  if (params.explicitCategory) return params.explicitCategory;

  const text = `${params.errorText || ''} ${params.qaReport?.summary || ''} ${params.qaReport?.fixInstruction || ''}`.toLowerCase();
  if (/mất kết nối|offline|timeout|vượt timeout|treo|econnrefused|ngoại tuyến|cookie|chưa có kết nối/i.test(text)) {
    return 'muse_disconnected';
  }
  if (params.qaReport) {
    const failed = [...params.qaReport.criteriaResults]
      .filter((c) => !c.passed)
      .sort((a, b) => a.score - b.score);
    const worst = failed[0]?.criterion;
    if (worst === 'dialogue') return 'wrong_dialogue';
    if (worst === 'voice') return 'wrong_voice';
    if (worst === 'character') return 'wrong_character';
    if (worst === 'costume') return 'wrong_costume';
    if (worst === 'setting' || worst === 'continuity') return 'wrong_setting';
    if (worst === 'motion') return 'motion_error';
    if (worst === 'audio') return 'video_technical_error';
  }
  if (/lời thoại|dialogue|phát sai|khẩu hình|lip-?sync/i.test(text)) return 'wrong_dialogue';
  if (/giọng|voice|nam nói|nữ nói|tts/i.test(text)) return 'wrong_voice';
  if (/trang phục|quần áo|costume/i.test(text)) return 'wrong_costume';
  if (/bối cảnh|ánh sáng|setting|nối cảnh/i.test(text)) return 'wrong_setting';
  if (/nhân vật|gương mặt|character|face/i.test(text)) return 'wrong_character';
  if (/chuyển động|camera|timeline|motion/i.test(text)) return 'motion_error';
  return 'video_technical_error';
}

function inferAgentFromCategory(category: IncidentCategory, task?: CommandTask, qaReport?: QaInspectionReport): MuseAgentId {
  if (category === 'wrong_costume') return 'muse-03';
  if (qaReport?.targetFixAgentId) return qaReport.targetFixAgentId;
  if (task?.assignedAgentId) return task.assignedAgentId;
  if (category === 'wrong_character' || category === 'wrong_setting') {
    return 'muse-03';
  }
  return 'muse-04';
}

async function generateQuickDirectorDialogPair(params: {
  inc: IncidentRecord;
  director: MuseAgentConfig;
  responsible: MuseAgentConfig;
  ruleDirective: string;
  scene?: CommandMemoryScene;
  mem: ProjectMemory;
}): Promise<{ directorQuestion: string; responsibleExplanation: string; directorAnalysis: string }> {
  const scLabel = params.scene
    ? `Cảnh ${String(params.scene.index).padStart(2, '0')} "${params.scene.title}"`
    : params.inc.taskId || 'Nhiệm vụ sản xuất';
  const cm = params.inc.costumeMismatch;
  const fallbackQuestion = cm
    ? `${params.responsible.name}, kiểm tra ngay sai lệch trang phục nhân vật "${cm.characterName}" (ID: ${cm.characterId}) tại ${scLabel}! Trang phục chuẩn bắt buộc: "${cm.expectedCostume}". Điểm không khớp: ${cm.mismatchDetails}. Giải trình tại sao prompt/khung hình bị lệch khỏi ảnh tham chiếu gốc?`
    : `${params.responsible.name}, kiểm tra gấp ${scLabel} (${params.inc.timestampRange || 'toàn cảnh'}). Báo cáo ghi nhận "${params.inc.categoryLabel}": ${params.inc.errorDescription}. Giải trình nguyên nhân sai lệch so với Project Memory v${params.mem.version} (nhân vật: ${params.mem.characters.map((c) => c.name).join(', ') || 'theo kịch bản'}).`;
  const fallbackExplanation = cm
    ? `Đã đối chiếu ảnh lỗi với ảnh tham chiếu gốc của "${cm.characterName}" (${cm.characterId}): quá trình sinh hình ảnh/prompt đã bị trôi trang phục (${cm.observedCostume || 'sai chi tiết so với bản gốc'}). Cần khôi phục nguyên bản từ hồ sơ gốc.`
    : `Đã đối chiếu dữ liệu gốc ${scLabel}: nguyên nhân dự kiến do ${params.inc.suspectedRootCause || 'prompt/ràng buộc tham chiếu chưa khóa chặt theo đúng phân vai và mốc thời gian kịch bản'}.`;
  const fallbackAnalysis = cm
    ? `Sai lệch trang phục khi khóa tham chiếu đang TẮT (${cm.characterName} - ${cm.characterId}): ${cm.mismatchDetails}. Phương án bắt buộc: Giao Muse AI 03 khôi phục 100% trang phục theo ảnh tham chiếu gốc, làm sạch prompt nguồn, tạo lại đúng ảnh lỗi rồi gửi Muse AI 05 kiểm định độc lập trước khi quay lại video.`
    : `Nguyên nhân gốc: ${params.inc.suspectedRootCause}. Phương án xử lý: ${params.ruleDirective}`;

  // Fast non-blocking AI synthesis (8s cap) so Director always speaks smartly without stalling on offline APIs
  if (params.inc.category === 'muse_disconnected') {
    return {
      directorQuestion: fallbackQuestion,
      responsibleExplanation: `Hệ thống ghi nhận lỗi kết nối/quá thời gian ở tài khoản hoặc kênh thực thi của ${params.responsible.name}: ${params.inc.errorDescription}`,
      directorAnalysis: fallbackAnalysis,
    };
  }

  try {
    const health = await refreshIntegrationHealth(false);
    const hasEngine = health.geminiConfigured || (health.muse2ApiReachable && health.healthyAccounts > 0);
    if (!hasEngine) {
      return {
        directorQuestion: fallbackQuestion,
        responsibleExplanation: fallbackExplanation,
        directorAnalysis: fallbackAnalysis,
      };
    }

    const cmContext = cm
      ? `\nCHI TIẾT SAI TRANG PHỤC: Nhân vật "${cm.characterName}" (${cm.characterId}) · Trang phục chuẩn: "${cm.expectedCostume}" · Điểm sai lệch: "${cm.mismatchDetails}" · AI tạo lỗi: ${cm.responsibleAgentId}.`
      : '';

    const res = await Promise.race([
      runAgentJsonInference({
        agent: params.director,
        systemPrompt: `Bạn là ${params.director.name} (Đạo diễn tổng) đang trực tiếp trao đổi với ${params.responsible.name} (${params.responsible.roleTitle}) về sự cố sản xuất phim.
Trả về DUY NHẤT JSON ngắn gọn bằng tiếng Việt:
{
  "directorQuestion": "Câu hỏi trực tiếp sắc bén của Đạo diễn tổng yêu cầu Muse gây lỗi giải trình (1-2 câu)",
  "responsibleExplanation": "Lời giải trình ngắn gọn thực tế của ${params.responsible.name} sau khi kiểm tra lại prompt/dữ liệu (1-2 câu)",
  "directorAnalysis": "Phân tích nguyên nhân gốc & phương án khắc phục cụ thể (1-2 câu)"
}`,
        userPrompt: `Sự cố ${params.inc.code} [${params.inc.categoryLabel}] tại ${scLabel} (mốc ${params.inc.timestampRange || '0s'}).
Mô tả lỗi: ${params.inc.errorDescription}${cmContext}
Dữ liệu tham chiếu: ${params.inc.referenceDataSummary}
Quy tắc xử lý gợi ý: ${params.ruleDirective}`,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8500)),
    ]);

    if (res && (res as any).parsed) {
      const p = (res as any).parsed;
      return {
        directorQuestion: String(p.directorQuestion || fallbackQuestion).trim(),
        responsibleExplanation: String(p.responsibleExplanation || fallbackExplanation).trim(),
        directorAnalysis: String(p.directorAnalysis || fallbackAnalysis).trim(),
      };
    }
  } catch {
    // Fallback immediately if AI inference throws during incident triage
  }

  return {
    directorQuestion: fallbackQuestion,
    responsibleExplanation: fallbackExplanation,
    directorAnalysis: fallbackAnalysis,
  };
}

function resolveIncidentRecord(
  inc: IncidentRecord,
  resolverAgent: MuseAgentConfig,
  summary: string
): void {
  if (inc.status === 'resolved') return;
  const director = storeDoc.agents.find((a) => a.id === 'muse-01') || storeDoc.agents[0];
  inc.status = 'resolved';
  inc.resolvedAt = Date.now();
  inc.resolutionSummary = summary;

  appendIncidentTurn(inc, {
    actorId: resolverAgent.id,
    actorName: `${resolverAgent.name} (${resolverAgent.roleTitle})`,
    roleBadge: 'Kiểm duyệt',
    kind: 'qa_review',
    content: summary,
  });
  appendIncidentTurn(inc, {
    actorId: director.id,
    actorName: `${director.name} (Đạo diễn tổng)`,
    roleBadge: 'Đóng sự cố',
    kind: 'resolution',
    content: `Xác nhận kết quả sửa chữa đạt yêu cầu. Đóng sự cố ${inc.code}, giữ nguyên toàn bộ các phân cảnh đã duyệt và tiếp tục dây chuyền sản xuất.`,
  });

  postIncidentChannelMessage({
    inc,
    senderId: resolverAgent.id,
    senderName: `${resolverAgent.name} (${resolverAgent.roleTitle})`,
    roleBadge: 'Kiểm duyệt · ĐẠT',
    targetAgentIds: ['muse-01'],
    content: `[${inc.code}] ${summary}`,
  });
  postIncidentChannelMessage({
    inc,
    senderId: director.id,
    senderName: `${director.name} (Đạo diễn tổng)`,
    roleBadge: 'Đóng sự cố',
    content: `[${inc.code}] Đã nghiệm thu kết quả sửa lỗi và đóng sự cố. Không làm gián đoạn các cảnh khác.`,
  });
  postAiBusMessage({
    fromAgent: director,
    toAgentIds: [inc.assignedFixAgentId, 'muse-05'],
    runId: inc.runId,
    projectId: inc.projectId,
    taskId: inc.taskId,
    sceneId: inc.sceneId,
    content: `[DIRECTOR→RESOLVED ${inc.code}] Đã kiểm định đạt và đóng sự cố.`,
  });

  // Clear escalated error on run if no remaining unresolved escalated incidents exist
  const run = storeDoc.runs.find((r) => r.id === inc.runId);
  if (run) {
    const stillEscalated = storeDoc.incidents.some(
      (x) => x.runId === inc.runId && x.status === 'escalated_to_user'
    );
    if (!stillEscalated && run.status === 'needs_attention') {
      run.status = 'producing';
      run.error = undefined;
      run.updatedAt = Date.now();
      emitCommandCenterEvent('run:updated', run);
    }
  }

  emitCommandCenterEvent('incident:updated', inc);
}

async function openOrAdvanceDirectorIncident(params: {
  incidentId?: string;
  runId: string;
  task?: CommandTask;
  scene?: CommandMemoryScene;
  qaReport?: QaInspectionReport;
  costumeMismatch?: CostumeMismatchReport;
  reporterAgentId: MuseAgentId;
  responsibleAgentId?: MuseAgentId;
  explicitCategory?: IncidentCategory;
  errorDescription: string;
  suspectedRootCause?: string;
  initialProposal?: string;
  severity?: IncidentSeverity;
  artifactUrls?: string[];
  requiresUserApproval?: boolean;
}): Promise<{ incident: IncidentRecord; autonomousFixQueued: boolean; escalated: boolean }> {
  const mem = getRunMemory(params.runId);
  const director = storeDoc.agents.find((a) => a.id === 'muse-01') || storeDoc.agents[0];
  const reporter = storeDoc.agents.find((a) => a.id === params.reporterAgentId) || storeDoc.agents[4];

  // Reuse an explicit incident or an open incident for the same run + scene/character/task to track multi-round remediation
  let inc = params.incidentId
    ? storeDoc.incidents.find((x) => x.id === params.incidentId)
    : storeDoc.incidents.find(
        (x) =>
          x.runId === params.runId &&
          !['resolved', 'escalated_to_user'].includes(x.status) &&
          ((params.scene?.sceneId && x.sceneId === params.scene.sceneId) ||
            (!params.scene?.sceneId &&
              params.costumeMismatch?.characterId &&
              x.costumeMismatch?.characterId === params.costumeMismatch.characterId &&
              !x.sceneId) ||
            (!params.scene?.sceneId && params.task?.id && x.taskId === params.task.id))
      );

  const priorAttempts = inc ? inc.attemptCount : 0;
  const resolvedCostumeMismatch =
    params.costumeMismatch || params.qaReport?.costumeMismatch || inc?.costumeMismatch;
  const category = classifyIncidentCategory({
    explicitCategory: params.explicitCategory,
    priorCategory: inc?.category,
    costumeMismatch: resolvedCostumeMismatch,
    qaReport: params.qaReport,
    errorText: params.errorDescription,
    priorAttempts,
  });
  const rule = INCIDENT_SMART_RULES[category];
  const responsibleId =
    params.responsibleAgentId ||
    resolvedCostumeMismatch?.responsibleAgentId ||
    inferAgentFromCategory(category, params.task, params.qaReport);
  const responsible = storeDoc.agents.find((a) => a.id === responsibleId) || storeDoc.agents[3];
  const maxAttempts = Math.max(
    1,
    Number(storeDoc.cloudConfig.maxIncidentRetries ?? storeDoc.cloudConfig.maxRetriesPerScene ?? 3)
  );
  const scNum = params.scene
    ? `Cảnh ${String(params.scene.index).padStart(2, '0')}`
    : resolvedCostumeMismatch?.characterName
    ? `Nhân vật ${resolvedCostumeMismatch.characterName}`
    : params.task?.code || 'Nhiệm vụ';
  const tsRange =
    params.qaReport?.timestampRange ||
    (params.scene ? `0s - ${params.scene.durationSec}s` : undefined);
  const refSummary = params.scene
    ? `Nhân vật: ${mem.characters.map((c) => `${c.name} (${c.id}: ${getCharacterCanonicalCostume(c) || c.voiceId})`).join(', ') || 'Theo kịch bản'} | Thoại: ${params.scene.dialogue || 'Không'} | Bối cảnh: ${params.scene.settingDetail} | Timeline: ${params.scene.videoTimeline || 'Chuẩn'}`
    : `Project Memory v${mem.version} (${mem.characters.length} nhân vật, ${mem.scenes.length} cảnh)`;
  const severity: IncidentSeverity =
    params.severity ||
    (category === 'muse_disconnected' || category === 'recurring_error' || category === 'wrong_costume'
      ? 'critical'
      : 'high');
  const artifacts = Array.from(
    new Set([
      ...(params.artifactUrls || []),
      ...(resolvedCostumeMismatch?.referenceImageUrl ? [resolvedCostumeMismatch.referenceImageUrl] : []),
      ...(resolvedCostumeMismatch?.faultyArtifactUrl ? [resolvedCostumeMismatch.faultyArtifactUrl] : []),
      ...(params.scene?.videoUrl ? [params.scene.videoUrl] : []),
      ...(params.scene?.keyframeImageUrl ? [params.scene.keyframeImageUrl] : []),
    ])
  ).filter(Boolean);

  if (!inc) {
    inc = {
      id: `inc_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      code: nextIncidentCode(),
      projectId: mem.projectId,
      sessionId: params.runId,
      runId: params.runId,
      taskId: params.task?.id,
      sceneId: params.scene?.sceneId,
      sceneIndex: params.scene?.index,
      timestampRange: tsRange,
      reporterAgentId: reporter.id,
      responsibleAgentId: responsible.id,
      assignedFixAgentId: category === 'wrong_costume' ? 'muse-03' : responsible.id,
      category,
      categoryLabel: rule.label,
      severity,
      priority: severity === 'critical' || severity === 'high' ? 'urgent' : 'high',
      status: 'reported',
      errorDescription: params.errorDescription,
      suspectedRootCause:
        params.suspectedRootCause ||
        resolvedCostumeMismatch?.mismatchDetails ||
        params.qaReport?.summary ||
        'Sai lệch thông số đồng bộ hoặc lỗi thực thi giữa tác vụ và Project Memory.',
      initialProposal:
        params.initialProposal || resolvedCostumeMismatch?.restoreRecommendation || rule.directive,
      artifactUrls: artifacts,
      referenceDataSummary: refSummary,
      attemptCount: 0,
      maxAttempts,
      remediationTaskIds: [],
      withinAutonomyScope: !params.requiresUserApproval,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      costumeMismatch: resolvedCostumeMismatch,
      versionHistory: [],
      history: [],
    };
    storeDoc.incidents.unshift(inc);
    if (storeDoc.incidents.length > 150) {
      storeDoc.incidents = storeDoc.incidents.slice(0, 150);
    }
  } else {
    inc.category = category;
    inc.categoryLabel = rule.label;
    inc.severity = severity;
    inc.errorDescription = params.errorDescription;
    inc.suspectedRootCause =
      params.suspectedRootCause || resolvedCostumeMismatch?.mismatchDetails || inc.suspectedRootCause;
    if (resolvedCostumeMismatch) inc.costumeMismatch = resolvedCostumeMismatch;
    inc.artifactUrls = Array.from(new Set([...inc.artifactUrls, ...artifacts]));
    inc.maxAttempts = maxAttempts;
    inc.taskId = params.task?.id || inc.taskId;
  }

  // 1. Report to Muse AI 01 (Urgent)
  const cm = inc.costumeMismatch;
  const reportText = cm
    ? `[Báo cáo sai trang phục khẩn → Muse AI 01] ${inc.code} · ${scNum}
• Nhân vật: ${cm.characterName} (ID: ${cm.characterId})
• Dự án / Phiên / Cảnh: ${cm.projectId} · ${cm.runId} · ${cm.sceneId ? `Cảnh ${cm.sceneIndex} (${cm.sceneId})` : 'Ảnh tham chiếu nhân vật'}
• AI tạo lỗi: ${storeDoc.agents.find((a) => a.id === cm.responsibleAgentId)?.name || cm.responsibleAgentId}
• Trang phục gốc chuẩn: ${cm.expectedCostume}
• Điểm sai lệch cụ thể: ${cm.mismatchDetails}
• Đề xuất bắt buộc: ${cm.restoreRecommendation}`
    : `[Báo cáo khẩn → Muse AI 01] ${inc.code} · ${scNum}${tsRange ? ` (${tsRange})` : ''}
• Muse phát hiện: ${reporter.name} | Phụ trách: ${responsible.name} | Loại: ${inc.categoryLabel}
• Lỗi cụ thể: ${inc.errorDescription}
• Nguyên nhân dự kiến: ${inc.suspectedRootCause}
• Đề xuất ban đầu: ${inc.initialProposal}`;

  appendIncidentTurn(inc, {
    actorId: reporter.id,
    actorName: `${reporter.name} (${reporter.roleTitle})`,
    roleBadge: cm ? 'Báo lỗi trang phục' : 'Báo cáo lỗi',
    kind: 'report',
    content: reportText,
    attachments: artifacts.slice(0, 4),
  });
  postIncidentChannelMessage({
    inc,
    senderId: reporter.id,
    senderName: `${reporter.name} – Báo cáo lỗi`,
    roleBadge: cm ? 'Sai trang phục' : 'Báo cáo lỗi',
    targetAgentIds: ['muse-01'],
    attachments: artifacts.slice(0, 3),
    content: cm
      ? `${scNum} — Nhân vật ${cm.characterName} (${cm.characterId}): ${cm.mismatchDetails}\n• Chuẩn gốc: ${cm.expectedCostume}\n• Khôi phục: ${cm.restoreRecommendation}`
      : `${scNum}: ${inc.errorDescription}\n(Task: ${params.task?.code || inc.taskId || 'N/A'} · Mức độ: ${severity.toUpperCase()})`,
  });

  // 2. Muse AI 01 directly investigates & dialogues with Responsible Muse
  inc.status = 'investigating';
  const dialog = await generateQuickDirectorDialogPair({
    inc,
    director,
    responsible,
    ruleDirective: rule.directive,
    scene: params.scene,
    mem,
  });

  inc.analyzedRootCause = dialog.directorAnalysis;

  appendIncidentTurn(inc, {
    actorId: director.id,
    actorName: `${director.name} (Đạo diễn tổng)`,
    roleBadge: 'Điều hành',
    kind: 'question',
    content: dialog.directorQuestion,
  });
  appendIncidentTurn(inc, {
    actorId: responsible.id,
    actorName: `${responsible.name} (${responsible.roleTitle})`,
    roleBadge: 'Giải trình',
    kind: 'explanation',
    content: dialog.responsibleExplanation,
  });

  postAiBusMessage({
    fromAgent: director,
    toAgentIds: [responsible.id],
    runId: params.runId,
    projectId: mem.projectId,
    taskId: params.task?.id,
    sceneId: params.scene?.sceneId,
    content: `[DIRECTOR→${responsible.code} ${inc.code}] ${dialog.directorQuestion}`,
  });
  postIncidentChannelMessage({
    inc,
    senderId: director.id,
    senderName: `${director.name} – Điều hành`,
    roleBadge: 'Điều hành',
    targetAgentIds: [responsible.id],
    content: dialog.directorQuestion,
  });
  postIncidentChannelMessage({
    inc,
    senderId: responsible.id,
    senderName: `${responsible.name} – Giải trình`,
    roleBadge: 'Giải trình',
    targetAgentIds: ['muse-01'],
    content: dialog.responsibleExplanation,
  });

  // 3. Check autonomy scope & retry limit
  const autoEnabled = storeDoc.cloudConfig.autoDirectorIncidentResponse !== false;
  const run = storeDoc.runs.find((r) => r.id === params.runId);
  const health = await refreshIntegrationHealth(false);
  const canExecuteAnyEngine =
    health.geminiConfigured ||
    (health.muse2ApiReachable && health.healthyAccounts > 0) ||
    health.accounts.some((a) => a.enabled);

  if (
    !autoEnabled ||
    params.requiresUserApproval ||
    inc.attemptCount >= maxAttempts ||
    (category === 'muse_disconnected' && !canExecuteAnyEngine)
  ) {
    const reason = params.requiresUserApproval
      ? 'Thao tác vượt quá phạm vi tự xử lý của AI (nguy cơ xóa dữ liệu chuẩn hoặc phát sinh chi phí lớn).'
      : !autoEnabled
      ? 'Chế độ tự động điều hành sự cố của Đạo diễn tổng đang tắt.'
      : category === 'muse_disconnected' && !canExecuteAnyEngine
      ? 'Toàn bộ tài khoản Muse2API và Gemini dự phòng đều đang ngoại tuyến/chưa cấu hình, không có engine để khôi phục tự động.'
      : `Sự cố ${inc.code} tại ${scNum} đã vượt giới hạn ${maxAttempts} vòng tự khắc phục (${inc.attemptCount}/${maxAttempts}).`;

    inc.status = 'escalated_to_user';
    inc.withinAutonomyScope = false;
    inc.escalationReason = reason;

    if (params.scene) {
      commitSessionMemoryUpdate(params.runId, 'muse-01', `Chuyển người dùng xử lý sự cố ${inc.code}`, (m) => {
        const target = m.scenes.find((s) => s.sceneId === params.scene!.sceneId);
        if (target) {
          target.qaStatus = 'escalated';
          if (params.qaReport) {
            target.qaScore = params.qaReport.overallScore;
            target.qaReportId = params.qaReport.id;
          }
        }
      });
    }

    if (run && !['completed', 'cancelled', 'paused'].includes(run.status)) {
      run.escalatedScenes = getRunMemory(params.runId).scenes.filter((s) => s.qaStatus === 'escalated').length;
      run.status = 'needs_attention';
      run.error = `[${inc.code}] ${reason}`;
      run.updatedAt = Date.now();
      emitCommandCenterEvent('run:updated', run);
    }

    appendIncidentTurn(inc, {
      actorId: director.id,
      actorName: `${director.name} (Đạo diễn tổng)`,
      roleBadge: 'Cần người dùng',
      kind: 'escalation',
      content: `${reason}\n• Phân tích của Đạo diễn tổng: ${dialog.directorAnalysis}`,
    });
    postIncidentChannelMessage({
      inc,
      senderId: director.id,
      senderName: `${director.name} – Báo cáo khẩn`,
      roleBadge: 'Cần can thiệp',
      content: `[CẦN NGƯỜI DÙNG] ${reason}\n• ${dialog.directorAnalysis}`,
    });
    appendConversationMessage({
      channel: 'commander',
      projectId: mem.projectId,
      runId: params.runId,
      sceneId: params.scene?.sceneId,
      incidentId: inc.id,
      senderType: 'agent',
      senderId: director.id,
      senderName: `${director.name} (Đạo diễn tổng)`,
      messageKind: 'alert',
      content: `Sự cố ${inc.code} vượt khả năng tự xử lý: ${reason} Hãy kiểm tra tại tab Trung tâm sự cố hoặc kênh #incident-command.`,
    });
    addActivityLog('warn', `Chuyển người dùng xử lý ${inc.code}`, reason, {
      agentId: 'muse-01',
      taskId: params.task?.id,
      runId: params.runId,
    });
    saveStateAtomic();
    emitCommandCenterEvent('incident:updated', inc);
    return { incident: inc, autonomousFixQueued: false, escalated: true };
  }

  // 4. Within autonomy scope -> Muse AI 01 issues direct fix command immediately
  inc.attemptCount += 1;
  inc.status = 'remediating';
  inc.withinAutonomyScope = true;

  const isCostumeLockWorkflow =
    category === 'wrong_costume' && mem.allowFreeCostumeChange !== true;

  let fixTargetAgent: MuseAgentId = isCostumeLockWorkflow ? 'muse-03' : responsible.id;
  let routeAdjustmentNote = '';

  // Smart recovery for disconnection / pinned account failure
  if (category === 'muse_disconnected') {
    if (responsible.engineMode === 'muse2api' && health.geminiConfigured) {
      responsible.engineMode = 'muse2api_with_gemini_fallback';
      routeAdjustmentNote = `Kích hoạt cơ chế Gemini dự phòng cho ${responsible.name}. `;
    }
    if (responsible.boundAccountId !== 'auto' && health.healthyAccounts > 0) {
      responsible.boundAccountId = 'auto';
      routeAdjustmentNote += `Chuyển ${responsible.name} sang xoay vòng tài khoản Muse2API khỏe mạnh tự động. `;
    }
    responsible.reconnectCount = (responsible.reconnectCount || 0) + 1;
  }

  const shouldRebuildKeyframe =
    Boolean(params.scene) &&
    (isCostumeLockWorkflow ||
      rule.rebuildKeyframe ||
      params.qaReport?.targetFixAgentId === 'muse-03' ||
      inc.attemptCount >= 2);

  const exactFixSummary =
    params.qaReport?.fixInstruction ||
    `${rule.directive} ${
      params.scene
        ? `Khóa chặt Character ID (${mem.characters.map((c) => `${c.name}:${c.voiceId}`).join(', ')}), lời thoại "${params.scene.dialogue || 'không'}", timeline "${params.scene.videoTimeline || 'chuẩn'}".`
        : ''
    }`.trim();

  const directorDirective = isCostumeLockWorkflow
    ? `Chỉ đạo khôi phục trang phục chuẩn (${inc.code} vòng #${inc.attemptCount}): Giao Muse AI 03 truy xuất ảnh tham chiếu & hồ sơ gốc của "${cm?.characterName || 'nhân vật'}" (${cm?.characterId || ''}), khôi phục nguyên bản trang phục "${cm?.expectedCostume || mem.costumeBible}", làm sạch prompt nguồn, lưu bản Trước/Sau không ghi đè gốc và chỉ tạo lại đúng ${params.scene ? `Cảnh ${String(params.scene.index).padStart(2, '0')}` : 'ảnh nhân vật'}. Sau đó gửi ngay Muse AI 05 kiểm duyệt lại trước khi dựng video.`
    : `${routeAdjustmentNote}${rule.directive} ${
        params.scene
          ? `Chỉ tạo lại RIÊNG Cảnh ${String(params.scene.index).padStart(2, '0')}, giữ nguyên tuyệt đối các phân cảnh đã đạt yêu cầu. Yêu cầu kỹ thuật: ${exactFixSummary}`
          : `Thực thi lại nhiệm vụ với cấu hình đã hiệu chỉnh.`
      }`.trim();

  inc.directorPlan = dialog.directorAnalysis;
  inc.directorCommand = directorDirective;

  // Enqueue ONLY the targeted fix (never whole film!)
  if (isCostumeLockWorkflow) {
    if (params.scene) {
      const sc = params.scene;
      commitSessionMemoryUpdate(
        params.runId,
        'muse-01',
        `Khóa & làm sạch nguồn prompt trang phục Cảnh ${sc.index} (${inc.code} vòng #${inc.attemptCount})`,
        (m) => {
          sanitizeCostumeSourcesInMemory(m, {
            sceneId: sc.sceneId,
            characterId: cm?.characterId,
          });
          const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
          if (target && target.qaStatus !== 'passed') {
            target.qaStatus = 'rejected';
            target.retryCount += 1;
            if (params.qaReport) {
              target.qaScore = params.qaReport.overallScore;
              target.qaReportId = params.qaReport.id;
            }
          }
        }
      );
    } else {
      commitSessionMemoryUpdate(
        params.runId,
        'muse-01',
        `Làm sạch thông số trang phục tham chiếu gốc (${inc.code} vòng #${inc.attemptCount})`,
        (m) => {
          sanitizeCostumeSourcesInMemory(m, { characterId: cm?.characterId });
        }
      );
    }

    const fixImgOwner = storeDoc.agents.find((a) => a.id === 'muse-03');
    if (fixImgOwner) fixImgOwner.regenCount = (fixImgOwner.regenCount || 0) + 1;

    const restoreTask = enqueueTask({
      runId: params.runId,
      type: 'restore_costume_and_regen_image',
      title: `[${inc.code} #${inc.attemptCount}] Muse AI 03 khôi phục trang phục & tạo lại ${params.scene ? `ảnh Cảnh ${params.scene.index}` : `ảnh ${cm?.characterName || 'nhân vật'}`}`,
      instructions: directorDirective,
      assignedAgentId: 'muse-03',
      sceneId: params.scene?.sceneId,
      sceneIndex: params.scene?.index,
      characterId: cm?.characterId,
      costumeRecovery: {
        incidentId: inc.id,
        characterId: cm?.characterId,
        targetMediaKind: cm?.targetMediaKind || (params.scene ? 'scene_image' : 'character_image'),
        mismatchDetails: cm?.mismatchDetails || inc.errorDescription,
        expectedCostume: cm?.expectedCostume,
      },
      priority: 10,
    });
    inc.remediationTaskIds.push(restoreTask.id);

    const verifyImgQa = enqueueTask({
      runId: params.runId,
      type: 'qa_inspect_image',
      title: `[Kiểm duyệt ảnh ${inc.code} #${inc.attemptCount}] ${params.scene ? `Cảnh ${params.scene.index}` : cm?.characterName || 'Nhân vật'} sau khôi phục trang phục`,
      instructions: `Đối chiếu trực tiếp ảnh vừa khôi phục của Muse AI 03 với ảnh tham chiếu gốc & hồ sơ gốc (${inc.code}). CHỈ ĐƯỢC phép sang dựng video khi trang phục khớp 100%.`,
      assignedAgentId: 'muse-05',
      dependsOnTaskIds: [restoreTask.id],
      sceneId: params.scene?.sceneId,
      sceneIndex: params.scene?.index,
      characterId: cm?.characterId,
      costumeRecovery: {
        incidentId: inc.id,
        characterId: cm?.characterId,
        targetMediaKind: params.scene ? 'scene_image' : 'character_image',
        mismatchDetails: cm?.mismatchDetails || inc.errorDescription,
        expectedCostume: cm?.expectedCostume,
      },
      priority: 9,
    });
    inc.remediationTaskIds.push(verifyImgQa.id);
    inc.qaVerificationTaskId = verifyImgQa.id;
    fixTargetAgent = 'muse-03';

    // Rewire any unstarted downstream tasks (blocked_by_deps / queued) to wait for verifyImgQa instead of running with faulty costume!
    if (params.scene) {
      for (const t of storeDoc.tasks) {
        if (
          t.runId === params.runId &&
          t.sceneId === params.scene.sceneId &&
          t.type === 'produce_scene_video' &&
          ['blocked_by_deps', 'queued'].includes(t.status)
        ) {
          t.dependsOnTaskIds = Array.from(
            new Set([
              ...t.dependsOnTaskIds.filter((id) => id !== params.task?.id),
              verifyImgQa.id,
            ])
          );
          t.status = 'blocked_by_deps';
          t.instructions = `${params.scene.actionDetail}. Timeline: ${params.scene.videoTimeline || 'chuyển động mượt liên tục'}. Trang phục khóa chuẩn: ${cm?.expectedCostume || params.scene.costume}. ${params.scene.dialogue ? `Lời thoại: ${params.scene.dialogue}` : ''}`;
        }
      }
      const assembleTask = storeDoc.tasks.find(
        (t) =>
          t.runId === params.runId &&
          t.type === 'assemble_final_film' &&
          (t.status === 'blocked_by_deps' || t.status === 'queued')
      );
      if (assembleTask) {
        assembleTask.dependsOnTaskIds = Array.from(
          new Set([
            ...assembleTask.dependsOnTaskIds.filter((id) => id !== params.task?.id),
            verifyImgQa.id,
          ])
        );
        assembleTask.status = 'blocked_by_deps';
      }
    } else if (params.task?.id) {
      // Character ref image failed QA -> hold any scene image generation depending on the failed char QA until verifyImgQa passes
      for (const t of storeDoc.tasks) {
        if (
          t.runId === params.runId &&
          t.type === 'design_scene_image' &&
          ['blocked_by_deps', 'queued'].includes(t.status) &&
          t.dependsOnTaskIds.includes(params.task.id)
        ) {
          t.dependsOnTaskIds = Array.from(
            new Set([
              ...t.dependsOnTaskIds.filter((id) => id !== params.task?.id),
              verifyImgQa.id,
            ])
          );
          t.status = 'blocked_by_deps';
        }
      }
    }
  } else if (params.scene) {
    const sc = params.scene;
    commitSessionMemoryUpdate(params.runId, 'muse-01', `Muse AI 01 chỉ đạo sửa Cảnh ${sc.index} (${inc.code} vòng #${inc.attemptCount})`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target && target.qaStatus !== 'passed') {
        target.qaStatus = 'rejected';
        target.retryCount += 1;
        if (params.qaReport) {
          target.qaScore = params.qaReport.overallScore;
          target.qaReportId = params.qaReport.id;
        }
      }
    });

    let fixDepTaskId: string | undefined;
    if (shouldRebuildKeyframe) {
      const fixImgOwner = storeDoc.agents.find((a) => a.id === 'muse-03');
      if (fixImgOwner) fixImgOwner.regenCount = (fixImgOwner.regenCount || 0) + 1;
      const retryImg = enqueueTask({
        runId: params.runId,
        type: 'design_scene_image',
        title: `[${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: Tạo lại ảnh keyframe`,
        instructions: `${sc.actionDetail}. CHỈ ĐẠO ĐẠO DIỄN TỔNG (${inc.code}): ${directorDirective}`,
        assignedAgentId: 'muse-03',
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 10,
      });
      inc.remediationTaskIds.push(retryImg.id);
      fixDepTaskId = retryImg.id;
      fixTargetAgent = 'muse-03';
    }

    const fixVidOwner = storeDoc.agents.find((a) => a.id === 'muse-04');
    if (fixVidOwner) fixVidOwner.regenCount = (fixVidOwner.regenCount || 0) + 1;

    const retryVid = enqueueTask({
      runId: params.runId,
      type: 'produce_scene_video',
      title: `[${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: Tạo lại video`,
      instructions: `${sc.actionDetail}. CHỈ ĐẠO ĐẠO DIỄN TỔNG (${inc.code}): ${directorDirective}`,
      assignedAgentId: 'muse-04',
      dependsOnTaskIds: fixDepTaskId ? [fixDepTaskId] : [],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 9,
    });
    inc.remediationTaskIds.push(retryVid.id);
    if (!shouldRebuildKeyframe) fixTargetAgent = 'muse-04';

    const retryQa = enqueueTask({
      runId: params.runId,
      type: 'qa_inspect_scene',
      title: `[Kiểm duyệt ${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `Kiểm tra lại Cảnh ${sc.index} sau chỉ đạo của Đạo diễn tổng (${inc.code}): ${exactFixSummary}`,
      assignedAgentId: 'muse-05',
      dependsOnTaskIds: [retryVid.id],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 8,
    });
    inc.qaVerificationTaskId = retryQa.id;
    inc.remediationTaskIds.push(retryQa.id);

    const assembleTask = storeDoc.tasks.find(
      (t) =>
        t.runId === params.runId &&
        t.type === 'assemble_final_film' &&
        (t.status === 'blocked_by_deps' || t.status === 'queued')
    );
    if (assembleTask) {
      assembleTask.dependsOnTaskIds = [
        ...assembleTask.dependsOnTaskIds.filter((id) => id !== params.task?.id),
        retryQa.id,
      ];
      assembleTask.status = 'blocked_by_deps';
    }
  } else if (params.task) {
    // Re-queue or reassign non-scene failed task under Muse 01 directive
    const fixTask = enqueueTask({
      runId: params.runId,
      type: params.task.type,
      title: `[${inc.code} #${inc.attemptCount}] ${params.task.title}`,
      instructions: `${params.task.instructions}\nCHỈ ĐẠO ĐẠO DIỄN TỔNG (${inc.code}): ${directorDirective}`,
      assignedAgentId: fixTargetAgent,
      dependsOnTaskIds: params.task.dependsOnTaskIds,
      sceneId: params.task.sceneId,
      sceneIndex: params.task.sceneIndex,
      characterId: params.task.characterId,
      priority: Math.max(9, params.task.priority),
    });
    inc.remediationTaskIds.push(fixTask.id);
  } else {
    const fixTask = enqueueTask({
      runId: params.runId,
      type: 'custom_task',
      title: `[${inc.code} #${inc.attemptCount}] Khắc phục sự cố theo chỉ đạo Muse AI 01`,
      instructions: `CHỈ ĐẠO ĐẠO DIỄN TỔNG (${inc.code}): ${directorDirective}\nLỗi gốc: ${inc.errorDescription}`,
      assignedAgentId: fixTargetAgent,
      priority: 9,
    });
    inc.remediationTaskIds.push(fixTask.id);
  }

  inc.assignedFixAgentId = fixTargetAgent;
  const fixAgent = storeDoc.agents.find((a) => a.id === fixTargetAgent) || responsible;
  const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];

  // Record Director Directive + Assigned Muse Response + Muse 05 QA standby
  appendIncidentTurn(inc, {
    actorId: director.id,
    actorName: `${director.name} (Đạo diễn tổng)`,
    roleBadge: 'Chỉ đạo',
    kind: 'directive',
    content: directorDirective,
  });
  appendIncidentTurn(inc, {
    actorId: fixAgent.id,
    actorName: `${fixAgent.name} (${fixAgent.roleTitle})`,
    roleBadge: 'Phản hồi',
    kind: 'progress',
    content: isCostumeLockWorkflow
      ? `Đã tiếp nhận lệnh khôi phục trang phục từ ${director.name}. Đang lấy lại trang phục chuẩn từ ảnh tham chiếu gốc của "${cm?.characterName || 'nhân vật'}", làm sạch prompt và vẽ lại riêng ${scNum} (vòng #${inc.attemptCount}/${maxAttempts}).`
      : `Đã nhận chỉ đạo từ ${director.name}. Đang sửa thông số và tạo lại ${scNum} (vòng #${inc.attemptCount}/${maxAttempts}).`,
  });
  if (params.scene || isCostumeLockWorkflow) {
    appendIncidentTurn(inc, {
      actorId: qaAgent.id,
      actorName: `${qaAgent.name} (${qaAgent.roleTitle})`,
      roleBadge: 'Kiểm duyệt',
      kind: 'qa_review',
      content: isCostumeLockWorkflow
        ? `Đang chờ nhận ảnh đã khôi phục trang phục của ${fixAgent.name} để kiểm tra độc lập với ảnh tham chiếu gốc trước khi cho phép chuyển sang dựng video.`
        : `Chờ nhận phiên bản mới của ${scNum} để kiểm định lại 8 tiêu chí trước khi cho phép đóng ${inc.code}.`,
    });
  }

  postIncidentChannelMessage({
    inc,
    senderId: director.id,
    senderName: `${director.name} – Chỉ đạo`,
    roleBadge: 'Chỉ đạo',
    targetAgentIds: [fixAgent.id, 'muse-05'],
    content: directorDirective,
  });
  postIncidentChannelMessage({
    inc,
    senderId: fixAgent.id,
    senderName: `${fixAgent.name} – Phản hồi`,
    roleBadge: 'Phản hồi',
    targetAgentIds: ['muse-01'],
    content: `Đã nhận chỉ đạo. Đang sửa prompt/dữ liệu và thực hiện lại ${scNum} (vòng ${inc.attemptCount}/${maxAttempts}).`,
  });
  if (params.scene || isCostumeLockWorkflow) {
    postIncidentChannelMessage({
      inc,
      senderId: qaAgent.id,
      senderName: `${qaAgent.name} – Kiểm duyệt`,
      roleBadge: 'Kiểm duyệt',
      targetAgentIds: ['muse-01'],
      content: isCostumeLockWorkflow
        ? `Chờ kiểm tra lại ảnh khôi phục trang phục của ${scNum} đối chiếu ảnh tham chiếu gốc.`
        : `Chờ nhận phiên bản mới của ${scNum} để kiểm tra lại.`,
    });
  }

  postAiBusMessage({
    fromAgent: director,
    toAgentIds: [fixAgent.id, 'muse-05'],
    runId: params.runId,
    projectId: mem.projectId,
    taskId: inc.remediationTaskIds[inc.remediationTaskIds.length - 1],
    sceneId: params.scene?.sceneId,
    content: `[DIRECTOR→FIX ${inc.code} #${inc.attemptCount}] ${directorDirective}`,
  });

  // Keep run actively producing while Muse 01 self-heals
  if (run && !['completed', 'cancelled', 'paused'].includes(run.status)) {
    run.status = 'producing';
    run.error = undefined;
    run.updatedAt = Date.now();
    emitCommandCenterEvent('run:updated', run);
  }

  addActivityLog('warn', `Đạo diễn chỉ đạo ${inc.code}`, `${director.name} giao ${fixAgent.name} khắc phục ${scNum} (vòng ${inc.attemptCount}/${maxAttempts}).`, {
    agentId: 'muse-01',
    taskId: params.task?.id,
    runId: params.runId,
  });

  saveStateAtomic();
  emitCommandCenterEvent('incident:updated', inc);
  void tickOrchestratorQueue();
  return { incident: inc, autonomousFixQueued: true, escalated: false };
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

async function runAgentJsonInference(params: {
  agent: MuseAgentConfig;
  systemPrompt: string;
  userPrompt: string;
  attachments?: string[];
  validate?: (parsed: any) => boolean;
}): Promise<{ parsed: any; rawText: string; provider: string; accountUsed?: string }> {
  const strictJsonRule =
    '\n\nQUY TẮC JSON BẮT BUỘC: Chỉ trả về 1 JSON object hợp lệ chuẩn RFC 8259; dùng dấu nháy kép cho mọi key và string; KHÔNG để dấu phẩy thừa (trailing comma) trước } hoặc ]; KHÔNG viết comment // hay /* */; thoát mọi dấu nháy kép bên trong chuỗi bằng \\".';
  const first = await runAgentTextInference({
    agent: params.agent,
    systemPrompt: `${params.systemPrompt}${strictJsonRule}`,
    userPrompt: params.userPrompt,
    attachments: params.attachments,
    jsonMode: true,
  });

  try {
    const parsed = parseAiBlueprintJsonSafe(first.text);
    if (!params.validate || params.validate(parsed)) {
      return {
        parsed,
        rawText: first.text,
        provider: first.provider,
        accountUsed: first.accountUsed,
      };
    }
  } catch {
    pushPerformanceAlert({
      severity: 'warn',
      category: 'format_error',
      agentId: params.agent.id,
      message: `${params.agent.name} trả về JSON chưa hợp chuẩn; đang tự động chạy lượt chuẩn hóa lại.`,
    });
  }

  const repairSystem = `${params.systemPrompt}${strictJsonRule}\nLƯU Ý SỬA LỖI: Phản hồi trước bị lỗi cú pháp JSON. Hãy xuất lại DUY NHẤT JSON hợp lệ, đầy đủ và hợp chuẩn.`;
  const repairUser = `Phản hồi trước chưa đạt chuẩn JSON hợp lệ:\n${first.text.slice(0, 6500)}\n\nDựa vào yêu cầu ban đầu sau đây, hãy xuất lại DUY NHẤT JSON chuẩn xác:\n${params.userPrompt.slice(0, 3500)}`;

  const second = await runAgentTextInference({
    agent: params.agent,
    systemPrompt: repairSystem,
    userPrompt: repairUser,
    jsonMode: true,
  });

  const parsedSecond = parseAiBlueprintJsonSafe(second.text);
  return {
    parsed: parsedSecond,
    rawText: second.text,
    provider: second.provider,
    accountUsed: second.accountUsed,
  };
}

// ==========================================
// TASK EXECUTION HANDLERS FOR 5 MUSE AI
// ==========================================

async function executePlanProductionTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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

  const allowFree = mem.allowFreeCostumeChange === true;
  const user = `Lệnh sản xuất & Kịch bản gốc từ người dùng:
${mem.originalScript}

Thông số dự án:
- Hình thức: ${mem.productionFormat === 'dialogue_film' ? 'Phim có lời thoại (đồng bộ nhân vật + khẩu hình)' : 'Phim thuyết minh kể chuyện'}
- Khung hình: ${mem.aspectRatio}
- Phong cách: ${mem.videoStyle}
- Khóa trang phục nhân vật tham chiếu: ${allowFree ? 'BẬT (cho phép đổi trang phục theo cảnh, vẫn khóa gương mặt/vóc dáng)' : 'TẮT (KHÓA TUYỆT ĐỐI ngoại hình VÀ trang phục theo ảnh/hồ sơ tham chiếu)'}`;

  const res = await runAgentJsonInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
  });

  throwIfRunStopped(task.runId);

  const parsed = res.parsed || {};
  const projectTitle = String(parsed.projectTitle || mem.title || 'Dự án phim AI Muse').trim();
  const strategy = String(parsed.productionStrategyVi || res.rawText.slice(0, 500)).trim();
  const continuityLock = String(parsed.continuityLockNotes || '').trim();
  const estScenes = Math.max(2, Math.min(10, Number(parsed.estimatedScenes) || 4));

  const newMemVer = commitSessionMemoryUpdate(task.runId, agent.id, 'Tổng đạo diễn lập kế hoạch sản xuất', (m) => {
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

  const analyzeTask = enqueueTask({
    runId: task.runId,
    type: 'analyze_script',
    title: `Biên kịch & bóc tách ${estScenes} phân cảnh + hồ sơ nhân vật 5 thành phần`,
    instructions: `Phân tích kịch bản "${projectTitle}" (${estScenes} phân cảnh), tách nhân vật kèm hồ sơ 5 thành phần, giọng nói theo độ tuổi, timeline từng giây và quan hệ nối cảnh.`,
    assignedAgentId: 'muse-02',
    dependsOnTaskIds: [task.id],
    priority: 9,
  });

  appendConversationMessage({
    channel: 'commander',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    targetAgentIds: ['muse-02', 'muse-05'],
    taskId: task.id,
    messageKind: 'deliverable',
    content: `Đã lập kế hoạch sản xuất "${projectTitle}" (~${estScenes} phân cảnh).\n• Chiến lược: ${strategy}\n• Đã khóa Project Memory v${newMemVer} và chuyển giao cho ${storeDoc.agents[1]?.name || 'Muse Script'}.`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: ['muse-02', 'muse-05'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: analyzeTask.id,
    content: `[ACK ${analyzeTask.code}] Khóa Memory v${newMemVer} cho "${projectTitle}". Yêu cầu ${storeDoc.agents[1]?.name} bóc tách ~${estScenes} phân cảnh và gửi schema sang pipeline.`,
  });
}

async function executeAnalyzeScriptTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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

  const allowFree = mem.allowFreeCostumeChange === true;
  const lockRulesBlock =
    mem.characters.length > 0 || mem.costumeBible
      ? buildReferenceCharacterLockRules({
          allowFreeCostumeChange: allowFree,
          characters: mem.characters.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            syncProfile: c.syncProfile,
          })),
          fallbackCostumeBible: mem.costumeBible,
        })
      : '';

  const user = `Kịch bản gốc:
${mem.originalScript}

Chiến lược Tổng đạo diễn đã duyệt:
${mem.timelineSummary}
${lockRulesBlock ? `\n${lockRulesBlock}\n` : ''}
Lưu ý:
- Hình thức: ${mem.productionFormat === 'dialogue_film' ? 'Phim có lời thoại (bắt buộc giữ lời thoại nhân vật + lip-sync)' : 'Phim thuyết minh kể chuyện (ưu tiên lời dẫn chuyện tự nhiên)'}.
- Số phân cảnh: 3 đến 6 phân cảnh rõ ràng, mỗi cảnh 5-8 giây.
- Hãy đặt "dependsOnPreviousScene": true CHỈ cho cảnh nào nối trực tiếp hành động/khung hình từ cảnh trước; các cảnh độc lập đặt false để Muse AI 03 & 04 sản xuất song song!`;

  const res = await runAgentJsonInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    validate: (p) => Boolean(p && Array.isArray(p.scenes) && p.scenes.length > 0),
  });

  const parsed = res.parsed;
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('Muse AI 02 chưa trả về cấu trúc phân cảnh JSON hợp lệ.');
  }

  throwIfRunStopped(task.runId);

  const normalizedChars: CommandMemoryCharacter[] = (Array.isArray(parsed.characters) ? parsed.characters : []).map(
    (c: any, idx: number) => {
      const existingChar =
        mem.characters.find((mc) => mc.id === c.id) ||
        mem.characters.find((mc) => mc.name.trim().toLowerCase() === String(c.name || '').trim().toLowerCase()) ||
        mem.characters[idx];
      const lockedCostume =
        !allowFree && existingChar?.syncProfile?.costume?.trim()
          ? existingChar.syncProfile.costume.trim()
          : '';
      const origProfile = existingChar?.confirmedOriginalSyncProfile || {
        face: String(existingChar?.syncProfile?.face?.trim() || c.syncProfile?.face || c.description || 'Gương mặt chuẩn theo kịch bản'),
        physique: String(existingChar?.syncProfile?.physique?.trim() || c.syncProfile?.physique || 'Tỷ lệ cân đối tự nhiên'),
        costume: lockedCostume || String(c.syncProfile?.costume || mem.costumeBible || parsed.costumeBible || 'Trang phục đồng bộ xuyên suốt'),
        voice: String(existingChar?.syncProfile?.voice?.trim() || c.syncProfile?.voice || 'Giọng đọc tự nhiên đúng độ tuổi'),
        distinguishingMarks: String(existingChar?.syncProfile?.distinguishingMarks?.trim() || c.syncProfile?.distinguishingMarks || 'Thần thái đặc trưng ổn định'),
      };
      const charObj: CommandMemoryCharacter = {
        id: String(existingChar?.id || c.id || `char_${idx + 1}`),
        name: String(existingChar?.name || c.name || `Nhân vật ${idx + 1}`).trim(),
        ageGroup: (['child', 'youth', 'adult_male', 'adult_female', 'middle_aged', 'elderly'].includes(c.ageGroup)
          ? c.ageGroup
          : existingChar?.ageGroup || 'youth') as any,
        gender: existingChar?.gender === 'female' || existingChar?.gender === 'male'
          ? existingChar.gender
          : c.gender === 'female'
          ? 'female'
          : 'male',
        voiceId: existingChar?.voiceId || (c.gender === 'female' ? 'Aoede' : 'Charon'),
        description: String(existingChar?.description || c.description || '').trim(),
        artifactUrl: existingChar?.artifactUrl,
        dataUrl: existingChar?.dataUrl,
        syncProfile: {
          face: String(existingChar?.syncProfile?.face?.trim() || c.syncProfile?.face || c.description || 'Gương mặt chuẩn theo kịch bản'),
          physique: String(existingChar?.syncProfile?.physique?.trim() || c.syncProfile?.physique || 'Tỷ lệ cân đối tự nhiên'),
          costume: lockedCostume || String(c.syncProfile?.costume || mem.costumeBible || parsed.costumeBible || 'Trang phục đồng bộ xuyên suốt'),
          voice: String(existingChar?.syncProfile?.voice?.trim() || c.syncProfile?.voice || 'Giọng đọc tự nhiên đúng độ tuổi'),
          distinguishingMarks: String(existingChar?.syncProfile?.distinguishingMarks?.trim() || c.syncProfile?.distinguishingMarks || 'Thần thái đặc trưng ổn định'),
        },
        approvedVersion: mem.version + 1,
        confirmedOriginalDataUrl: existingChar?.confirmedOriginalDataUrl || existingChar?.dataUrl,
        confirmedOriginalArtifactUrl: existingChar?.confirmedOriginalArtifactUrl || existingChar?.artifactUrl,
        confirmedOriginalSyncProfile: structuredClone(origProfile),
        costumeVersionHistory: existingChar?.costumeVersionHistory ? structuredClone(existingChar.costumeVersionHistory) : [],
      };
      ensureCharacterOriginalAnchors(charObj);
      return charObj;
    }
  );

  const canonicalLockedCostumeBible =
    !allowFree && (mem.costumeBible?.trim() || normalizedChars.some((c) => c.syncProfile.costume))
      ? mem.costumeBible?.trim() || normalizedChars.map((c) => `${c.name}: ${c.syncProfile.costume}`).join(' | ')
      : String(parsed.costumeBible || mem.costumeBible || '').trim();

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
      costume:
        !allowFree && canonicalLockedCostumeBible
          ? canonicalLockedCostumeBible
          : String(s.costume || canonicalLockedCostumeBible || '').trim(),
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
  const newVer = commitSessionMemoryUpdate(
    task.runId,
    'muse-01',
    `Khóa kịch bản từ ${agent.name} (${normalizedScenes.length} cảnh, ${normalizedChars.length} nhân vật)`,
    (m) => {
      m.visualBible = String(m.visualBible || parsed.visualBible || '').trim();
      m.settingBible = String(m.settingBible || parsed.settingBible || '').trim();
      m.costumeBible = !allowFree && canonicalLockedCostumeBible ? canonicalLockedCostumeBible : String(parsed.costumeBible || m.costumeBible || '').trim();
      m.continuityBible = String(m.continuityBible || parsed.continuityBible || '').trim();
      m.characters = normalizedChars.length > 0 ? normalizedChars : m.characters;
      m.scenes = normalizedScenes;
    }
  );

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
  const charQaDeps: string[] = [];
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
    if (!allowFree) {
      const charQa = enqueueTask({
        runId: task.runId,
        type: 'qa_inspect_image',
        title: `Kiểm tra trang phục ảnh nhân vật: ${ch.name}`,
        instructions: `Đối chiếu ảnh nhân vật ${ch.name} với hồ sơ trang phục gốc "${getCharacterCanonicalCostume(ch)}" trước khi tạo keyframe phân cảnh.`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [ct.id],
        characterId: ch.id,
        priority: 8,
      });
      charQaDeps.push(charQa.id);
    }
  }

  // Stage 3B (Scene Image) & Stage 4 (Scene Video) & Stage 5 (QA Inspect) DAG
  const sceneVideoTaskBySceneId = new Map<string, string>();
  const qaTaskIds: string[] = [];
  const sceneImgDeps = !allowFree && charQaDeps.length > 0 ? charQaDeps : charTaskIds.length > 0 ? charTaskIds : [task.id];

  for (const sc of normalizedScenes) {
    const imgTask = enqueueTask({
      runId: task.runId,
      type: 'design_scene_image',
      title: `Cảnh ${sc.index}: Tạo ảnh keyframe "${sc.title}"`,
      instructions: `${sc.actionDetail}. Bối cảnh: ${sc.settingDetail}. Góc máy: ${sc.cameraAngle}. Ánh sáng: ${sc.lighting}.`,
      assignedAgentId: 'muse-03',
      dependsOnTaskIds: sceneImgDeps,
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      priority: 7,
    });

    let videoImageReadyDepId = imgTask.id;
    if (!allowFree) {
      const imgQa = enqueueTask({
        runId: task.runId,
        type: 'qa_inspect_image',
        title: `Kiểm tra trang phục ảnh Cảnh ${sc.index}: "${sc.title}"`,
        instructions: `Kiểm tra keyframe Cảnh ${sc.index} đối chiếu ảnh tham chiếu & trang phục gốc trước khi dựng video.`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [imgTask.id],
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 7,
      });
      videoImageReadyDepId = imgQa.id;
    }

    const videoDeps = [videoImageReadyDepId];
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
    channel: 'script',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    targetAgentIds: ['muse-01', 'muse-03', 'muse-04', 'muse-05'],
    taskId: task.id,
    messageKind: 'deliverable',
    content: `Hoàn tất bóc tách kịch bản (Memory v${newVer}):\n• ${normalizedChars.length} nhân vật chuẩn 5 thành phần (${normalizedChars.map((c) => c.name).join(', ')}).\n• ${normalizedScenes.length} phân cảnh đã lập DAG song song/nối tiếp.`,
  });

  appendConversationMessage({
    channel: 'production',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    content: `Đã nạp ${normalizedScenes.length} phân cảnh và ${normalizedChars.length} nhân vật vào dây chuyền sản xuất (Memory v${newVer}).`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: ['muse-03', 'muse-04', 'muse-05'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: task.id,
    content: `[SCRIPT→PIPELINE] Memory v${newVer} đã khóa ${normalizedChars.length} nhân vật & ${normalizedScenes.length} cảnh. ${storeDoc.agents[2]?.name} bắt đầu vẽ tham chiếu nhân vật và keyframe song song.`,
  });
}

async function executeDesignCharacterRefTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
    allowFreeCostumeChange: mem.allowFreeCostumeChange === true,
  });

  throwIfRunStopped(task.runId);

  const saved = saveDataUrlArtifact(`char_${ch.id}`, img.dataUrl);
  if (!saved) throw new Error('Không lưu được tệp ảnh nhân vật từ AI.');

  commitSessionMemoryUpdate(task.runId, 'muse-01', `Lưu ảnh tham chiếu nhân vật ${ch.name} từ ${agent.name}`, (m) => {
    const target = m.characters.find((c) => c.id === ch.id);
    if (target) {
      target.artifactUrl = saved.url;
      target.approvedVersion = m.version + 1;
      if (!target.confirmedOriginalArtifactUrl && !target.confirmedOriginalDataUrl) {
        target.confirmedOriginalArtifactUrl = saved.url;
      }
      ensureCharacterOriginalAnchors(target);
    }
  });

  task.executedByProvider = img.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = saved.url;
  task.outputText = `Đã tạo & lưu ảnh tham chiếu cho nhân vật ${ch.name} (${img.model}).`;

  appendConversationMessage({
    channel: 'visual',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [saved.url],
    content: `Hoàn tất ảnh tham chiếu nhân vật ${ch.name} (${img.model}). Đã khóa vào Project Memory để đồng bộ các phân cảnh.`,
  });
}

async function executeDesignSceneImageTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
      ensureCharacterOriginalAnchors(c);
      const dUrl = getCharacterCanonicalImageDataUrl(c);
      if (!dUrl) return null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        dataUrl: dUrl,
        syncProfile: c.confirmedOriginalSyncProfile || c.syncProfile,
      };
    })
    .filter(Boolean) as any[];

  const charBibleText = mem.characters
    .map(
      (c) =>
        `${c.name}: ${(c.confirmedOriginalSyncProfile || c.syncProfile).face}; ${(c.confirmedOriginalSyncProfile || c.syncProfile).physique}; ${
          mem.allowFreeCostumeChange === true ? c.syncProfile.costume : getCharacterCanonicalCostume(c)
        }`
    )
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
    allowFreeCostumeChange: mem.allowFreeCostumeChange === true,
  });

  throwIfRunStopped(task.runId);

  const saved = saveDataUrlArtifact(`scene_${sc.index}_kf`, img.dataUrl);
  if (!saved) throw new Error('Không lưu được ảnh keyframe phân cảnh.');

  commitSessionMemoryUpdate(task.runId, 'muse-01', `Khóa keyframe Cảnh ${sc.index} từ ${agent.name}`, (m) => {
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

  appendConversationMessage({
    channel: 'visual',
    projectId: mem.projectId,
    runId: task.runId,
    sceneId: sc.sceneId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [saved.url],
    content: `Cảnh ${sc.index} "${sc.title}" đã hoàn tất keyframe (${img.model}).`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: mem.allowFreeCostumeChange === true ? ['muse-04'] : ['muse-05', 'muse-04'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: task.id,
    sceneId: sc.sceneId,
    content:
      mem.allowFreeCostumeChange === true
        ? `[VISUAL→VIDEO] Keyframe Cảnh ${sc.index} "${sc.title}" đã sẵn sàng tại Memory. Chuyển sang ${storeDoc.agents[3]?.name || 'Muse Video'} dựng video.`
        : `[VISUAL→QA] Keyframe Cảnh ${sc.index} "${sc.title}" đã sẵn sàng. Gửi ${storeDoc.agents[4]?.name || 'Muse Guardian'} kiểm tra khớp trang phục tham chiếu trước khi dựng video.`,
  });
}

async function executeRestoreCostumeAndRegenImageTask(
  task: CommandTask,
  agent: MuseAgentConfig
): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);

  const recovery = task.costumeRecovery;
  const inc = recovery?.incidentId
    ? storeDoc.incidents.find((i) => i.id === recovery.incidentId)
    : storeDoc.incidents.find(
        (i) =>
          i.runId === task.runId &&
          !['resolved', 'escalated_to_user'].includes(i.status) &&
          i.remediationTaskIds.includes(task.id)
      );

  const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
  const ch = matchCharacterForScene(mem, sc, task.characterId || recovery?.characterId || inc?.costumeMismatch?.characterId);
  if (!ch && !sc) {
    throw new Error('Không tìm thấy nhân vật hoặc phân cảnh cần khôi phục trang phục.');
  }

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
        `${agent.name} cần Muse2API trực tuyến (hoặc bật Gemini dự phòng) để khôi phục trang phục & tạo lại ảnh.`
      );
    }
  }

  if (ch) ensureCharacterOriginalAnchors(ch);
  const canonicalCostume = getCharacterCanonicalCostume(ch) || recovery?.expectedCostume || mem.costumeBible;
  const canonicalRefImageUrl = getCharacterCanonicalImageRefUrl(ch);
  const beforeCostume = sc ? sc.costume : ch?.syncProfile.costume || '';
  const beforeImageUrl = sc ? sc.keyframeImageUrl : ch?.artifactUrl;
  const beforePrompt = sc ? sc.actionDetail : ch ? `${ch.syncProfile.face}; ${ch.syncProfile.costume}` : '';

  // 1. Clean prompt sources & restore canonical costume without overwriting confirmedOriginal*
  let cleanedCount = 0;
  let canonicalCostumeBible = canonicalCostume;
  commitSessionMemoryUpdate(
    task.runId,
    'muse-01',
    `${agent.name} khôi phục trang phục gốc từ tham chiếu (${inc?.code || task.code})`,
    (m) => {
      const cleaned = sanitizeCostumeSourcesInMemory(m, {
        sceneId: sc?.sceneId,
        characterId: ch?.id,
      });
      cleanedCount = cleaned.cleanedCount;
      canonicalCostumeBible = cleaned.canonicalCostumeBible;
    }
  );

  const refreshedMem = getRunMemory(task.runId);
  const refreshedSc = sc ? refreshedMem.scenes.find((s) => s.sceneId === sc.sceneId) : undefined;
  const refreshedCh = ch ? refreshedMem.characters.find((c) => c.id === ch.id) : undefined;

  let afterImageUrl = beforeImageUrl;
  let usedModel = '';

  if (refreshedSc) {
    const charRefs = refreshedMem.characters
      .map((c) => {
        ensureCharacterOriginalAnchors(c);
        const dUrl = getCharacterCanonicalImageDataUrl(c);
        if (!dUrl) return null;
        const canonProfile = c.confirmedOriginalSyncProfile || c.syncProfile;
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          dataUrl: dUrl,
          syncProfile: canonProfile,
        };
      })
      .filter(Boolean) as any[];

    const charBibleText = refreshedMem.characters
      .map((c) => {
        const canon = c.confirmedOriginalSyncProfile || c.syncProfile;
        return `${c.name}: ${canon.face}; ${canon.physique}; ${canon.costume}`;
      })
      .join(' | ');

    const lockedInstruction = `${refreshedSc.actionDetail}. Bối cảnh: ${refreshedSc.settingDetail}. Góc máy: ${refreshedSc.cameraAngle}. Ánh sáng: ${refreshedSc.lighting}. KHÔI PHỤC NGUYÊN BẢN TRANG PHỤC GỐC (${canonicalCostume}): giữ 100% đúng màu sắc, kiểu dáng, chất liệu và phụ kiện theo ảnh tham chiếu gốc của "${refreshedCh?.name || 'nhân vật'}", TUYỆT ĐỐI KHÔNG tự thêm hay sửa chi tiết trang phục nào.`;

    const img = await generateStudioImage({
      mode: 'scene',
      prompt: lockedInstruction,
      aspectRatio: refreshedMem.aspectRatio,
      engine,
      videoStyle: refreshedMem.videoStyle,
      characterBible: charBibleText,
      settingBible: refreshedMem.settingBible,
      visualStyleBible: refreshedMem.visualBible,
      costumeBible: refreshedSc.costume || canonicalCostumeBible,
      continuityBible: refreshedMem.continuityBible,
      sceneIndex: refreshedSc.index,
      totalScenes: refreshedMem.scenes.length,
      sceneTitle: refreshedSc.title,
      charactersInScene: refreshedMem.characters.map((c) => c.name).join(', '),
      settingDetail: refreshedSc.settingDetail,
      actionDetail: refreshedSc.actionDetail,
      dialogue: refreshedSc.dialogue,
      sceneSummary: refreshedSc.title,
      costume: canonicalCostume || refreshedSc.costume,
      cameraAngle: refreshedSc.cameraAngle,
      vfxNotes: refreshedSc.vfxNotes,
      characterRefs: charRefs,
      museAccountId: agent.boundAccountId,
      allowFreeCostumeChange: false,
    });
    throwIfRunStopped(task.runId);
    const saved = saveDataUrlArtifact(`scene_${refreshedSc.index}_kf_restore`, img.dataUrl);
    if (!saved) throw new Error('Không lưu được ảnh keyframe sau khi khôi phục trang phục.');
    afterImageUrl = saved.url;
    usedModel = img.model;

    commitSessionMemoryUpdate(
      task.runId,
      'muse-01',
      `Lưu ảnh keyframe Cảnh ${refreshedSc.index} sau khôi phục trang phục`,
      (m) => {
        const target = m.scenes.find((s) => s.sceneId === refreshedSc.sceneId);
        if (target) {
          target.keyframeImageUrl = saved.url;
          target.keyframeArtifactName = saved.fileName;
          target.costume = canonicalCostume || target.costume;
          target.lastModifiedBy = agent.id;
        }
      }
    );
  } else if (refreshedCh) {
    const canonProfile = refreshedCh.confirmedOriginalSyncProfile || refreshedCh.syncProfile;
    const charBible = `${refreshedCh.name}: ${canonProfile.face}; ${canonProfile.physique}; ${canonProfile.costume}; ${canonProfile.distinguishingMarks}`;
    const img = await generateStudioImage({
      mode: 'character',
      prompt: `KHÔI PHỤC NGUYÊN BẢN TRANG PHỤC GỐC: ${charBible}. Giữ 100% đúng trang phục, màu sắc, chất liệu và phụ kiện gốc.`,
      aspectRatio: '1:1',
      engine,
      videoStyle: refreshedMem.videoStyle,
      characterBible: charBible,
      costumeBible: canonProfile.costume,
      visualStyleBible: refreshedMem.visualBible,
      museAccountId: agent.boundAccountId,
      allowFreeCostumeChange: false,
    });
    throwIfRunStopped(task.runId);
    const saved = saveDataUrlArtifact(`char_${refreshedCh.id}_restore`, img.dataUrl);
    if (!saved) throw new Error('Không lưu được ảnh nhân vật sau khi khôi phục trang phục.');
    afterImageUrl = saved.url;
    usedModel = img.model;

    commitSessionMemoryUpdate(
      task.runId,
      'muse-01',
      `Cập nhật ảnh nhân vật ${refreshedCh.name} sau khôi phục trang phục (giữ nguyên bản gốc)`,
      (m) => {
        const target = m.characters.find((c) => c.id === refreshedCh.id);
        if (target) {
          target.artifactUrl = saved.url;
          target.approvedVersion = m.version + 1;
          // NEVER overwrite target.confirmedOriginalArtifactUrl / confirmedOriginalDataUrl / confirmedOriginalSyncProfile
        }
      }
    );
  }

  // Record Before -> After Version Snapshot (preserving confirmed original anchor untouched)
  const snapshot: CostumeVersionSnapshot = {
    version: ((refreshedCh?.costumeVersionHistory?.length || 0) + 1),
    timestamp: Date.now(),
    actorAgentId: agent.id,
    incidentCode: inc?.code,
    sceneId: refreshedSc?.sceneId,
    sceneIndex: refreshedSc?.index,
    beforeCostume: beforeCostume || '(sai lệch trang phục)',
    afterCostume: canonicalCostume || canonicalCostumeBible,
    beforeImageUrl,
    afterImageUrl,
    beforePrompt,
    afterPrompt: refreshedSc ? refreshedSc.actionDetail : canonicalCostume,
    note: `Khôi phục theo ảnh & hồ sơ tham chiếu gốc (${cleanedCount} trường prompt đã làm sạch), không ghi đè bản gốc.`,
  };

  if (refreshedCh) {
    commitSessionMemoryUpdate(
      task.runId,
      'muse-01',
      `Lưu lịch sử phiên bản trang phục v${snapshot.version} cho ${refreshedCh.name}`,
      (m) => {
        const target = m.characters.find((c) => c.id === refreshedCh.id);
        if (target) {
          ensureCharacterOriginalAnchors(target);
          target.costumeVersionHistory = [...(target.costumeVersionHistory || []), snapshot].slice(-20);
        }
      }
    );
  }
  if (inc) {
    inc.versionHistory = [...(inc.versionHistory || []), snapshot];
    const atts = [canonicalRefImageUrl, beforeImageUrl, afterImageUrl].filter((x): x is string => Boolean(x));
    appendIncidentTurn(inc, {
      actorId: agent.id,
      actorName: `${agent.name} (${agent.roleTitle})`,
      roleBadge: 'Đã khôi phục đồ',
      kind: 'progress',
      attachments: atts,
      content: `Đã khôi phục nguyên bản trang phục cho "${refreshedCh?.name || 'nhân vật'}" (${refreshedSc ? `Cảnh ${refreshedSc.index}` : 'Ảnh nhân vật'}):\n• Trang phục chuẩn đã khóa lại: ${snapshot.afterCostume}\n• Prompt nguồn đã làm sạch: ${cleanedCount} cập nhật\n• Lưu lịch sử Trước → Sau (v${snapshot.version}) mà vẫn giữ nguyên 100% ảnh/hồ sơ tham chiếu gốc.\nĐang gửi ảnh mới tới Muse AI 05 kiểm duyệt độc lập trước khi dựng video.`,
    });
    postIncidentChannelMessage({
      inc,
      senderId: agent.id,
      senderName: `${agent.name} – Khôi phục trang phục`,
      roleBadge: 'Đã sửa ảnh',
      targetAgentIds: ['muse-05', 'muse-01'],
      attachments: atts,
      content: `[${inc.code}] Đã khôi phục trang phục chuẩn & tạo lại ${refreshedSc ? `ảnh Cảnh ${refreshedSc.index}` : `ảnh nhân vật ${refreshedCh?.name}`}. Gửi Muse AI 05 kiểm duyệt đối chiếu ảnh tham chiếu gốc.`,
    });
    inc.artifactUrls = Array.from(new Set([...inc.artifactUrls, ...atts]));
    emitCommandCenterEvent('incident:updated', inc);
  }

  task.executedByProvider = usedModel;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = afterImageUrl;
  task.outputText = `Đã khôi phục trang phục gốc (${snapshot.afterCostume.slice(0, 80)}) và tạo lại ảnh mới (${usedModel}).`;

  appendConversationMessage({
    channel: 'visual',
    projectId: refreshedMem.projectId,
    runId: task.runId,
    sceneId: refreshedSc?.sceneId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [beforeImageUrl, afterImageUrl].filter((x): x is string => Boolean(x)),
    content: `Hoàn tất khôi phục trang phục gốc cho ${refreshedSc ? `Cảnh ${refreshedSc.index}` : refreshedCh?.name} (${usedModel}). Đã gửi Muse AI 05 kiểm duyệt.`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: ['muse-05', 'muse-01'],
    runId: task.runId,
    projectId: refreshedMem.projectId,
    taskId: task.id,
    sceneId: refreshedSc?.sceneId,
    content: `[COSTUME-RESTORE→QA ${inc?.code || ''}] Đã khôi phục trang phục theo tham chiếu gốc và tạo lại ảnh mới. Yêu cầu ${storeDoc.agents[4]?.name || 'Muse Guardian'} kiểm định ngay trước khi quay video.`,
  });
}

async function executeQaInspectImageTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);

  const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
  const ch = matchCharacterForScene(mem, sc, task.characterId || task.costumeRecovery?.characterId);
  const targetKind: 'character_image' | 'scene_image' = sc ? 'scene_image' : 'character_image';

  const targetImageUrl = sc ? sc.keyframeImageUrl : ch?.artifactUrl;
  const targetDataUrl = artifactUrlToDataUrl(targetImageUrl);
  if (!targetDataUrl) {
    throw new Error(
      sc
        ? `Cảnh ${sc.index} chưa có ảnh keyframe để kiểm tra trang phục.`
        : `Nhân vật ${ch?.name || ''} chưa có ảnh tham chiếu để kiểm tra.`
    );
  }

  const allowFreeCostumeChange = mem.allowFreeCostumeChange === true;
  const refDataUrls = mem.characters
    .map((c) => {
      ensureCharacterOriginalAnchors(c);
      const refUrl = getCharacterCanonicalImageRefUrl(c);
      if (targetKind === 'character_image' && refUrl && refUrl === targetImageUrl) {
        return null;
      }
      return getCharacterCanonicalImageDataUrl(c) || null;
    })
    .filter((x): x is string => Boolean(x))
    .slice(0, 3);

  const allAttachments = Array.from(new Set([...refDataUrls, targetDataUrl])).slice(0, 5);
  const charChecklist =
    mem.characters
      .map((c, idx) => {
        ensureCharacterOriginalAnchors(c);
        const canon = c.confirmedOriginalSyncProfile || c.syncProfile;
        return `  ${idx + 1}. "${c.name}" (ID: ${c.id}): Mặt/tóc="${canon.face}"; Vóc dáng="${canon.physique}"; Đặc điểm="${canon.distinguishingMarks}"; TRANG PHỤC GỐC BẮT BUỘC="${canon.costume}"`;
      })
      .join('\n') || '  (Đối chiếu mô tả nhân vật & trang phục gốc)';

  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — AI kiểm định độc lập trong Phòng Điều Hành AI Muse.
Nhiệm vụ: Kiểm tra TRỰC TIẾP HÌNH ẢNH (${targetKind === 'scene_image' ? `Ảnh keyframe Cảnh ${sc?.index}` : `Ảnh nhân vật "${ch?.name}"`}) so với ảnh tham chiếu gốc & hồ sơ nhân vật gốc trong Project Memory v${mem.version}.
${
  refDataUrls.length > 0
    ? `CHÚ Ý THỨ TỰ ẢNH ĐÍNH KÈM: ${refDataUrls.length} ảnh đầu là ẢNH THAM CHIẾU GỐC CHUẨN; ảnh CUỐI CÙNG là ảnh mới tạo cần kiểm tra.`
    : 'Ảnh đính kèm là ảnh cần đối chiếu chặt chẽ với hồ sơ nhân vật gốc bên dưới.'
}
QUY TẮC KIỂM ĐỊNH NGHIÊM NGẶT:
- Chế độ AI ĐƯỢC PHÉP TỰ DO THAY ĐỔI TRANG PHỤC đang ${allowFreeCostumeChange ? 'BẬT' : 'TẮT (KHÓA CỨNG)'}.
- ${
    allowFreeCostumeChange
      ? 'Trang phục có thể linh hoạt theo cảnh nhưng mặt, tóc, vóc dáng phải khớp 100%.'
      : 'PHẢI đánh FAIL NGAY LẬP TỨC (costumePassed: false, score < 70) nếu có BẤT KỲ sai lệch nào về trang phục (sai màu, sai kiểu áo/quần/váy, tự thêm áo khoác/mũ/kính/phụ kiện hoặc bỏ phụ kiện gốc).'
  }
Trả về DUY NHẤT JSON:
{
  "overallScore": 90,
  "characterPassed": true,
  "costumePassed": true,
  "characterScore": 92,
  "costumeScore": 90,
  "summary": "Nhận xét ngắn gọn bằng tiếng Việt",
  "affectedCharacterId": "${ch?.id || 'char_1'}",
  "affectedCharacterName": "${ch?.name || 'Nhân vật chính'}",
  "expectedCostume": "${getCharacterCanonicalCostume(ch) || mem.costumeBible}",
  "observedCostume": "Mô tả trang phục thực tế thấy trong ảnh kiểm tra",
  "mismatchDetails": "Mô tả cụ thể mọi điểm không khớp giữa ảnh kiểm tra và ảnh tham chiếu gốc (rỗng nếu khớp 100%)",
  "fixInstruction": "Chỉ dẫn sửa nếu không đạt"
}`;

  const user = `THÔNG SỐ ĐỐI CHIẾU GỐC:
- Tùy chọn cho phép đổi trang phục: ${allowFreeCostumeChange ? 'BẬT' : 'TẮT (BẮT BUỘC GIỮ NGUYÊN 100%)'}
- Hồ sơ nhân vật gốc:\n${charChecklist}
${sc ? `- Cảnh kiểm tra: Cảnh ${sc.index} "${sc.title}" — Hành động: ${sc.actionDetail} — Trang phục chuẩn cảnh: ${sc.costume}` : `- Kiểm tra ảnh nhân vật "${ch?.name}" (${ch?.id})`}`;

  const res = await runAgentJsonInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    attachments: allAttachments,
  });

  throwIfRunStopped(task.runId);

  const parsed = res.parsed || {};
  const threshold = storeDoc.cloudConfig.qaPassThreshold;
  const charScore = Math.max(0, Math.min(100, Number(parsed.characterScore ?? parsed.overallScore ?? 85)));
  const costumeScore = Math.max(0, Math.min(100, Number(parsed.costumeScore ?? parsed.overallScore ?? 85)));
  const overallScore = Number.isFinite(Number(parsed.overallScore))
    ? Math.max(0, Math.min(100, Math.round(Number(parsed.overallScore))))
    : Math.round((charScore + costumeScore) / 2);
  const characterPassed = typeof parsed.characterPassed === 'boolean' ? parsed.characterPassed : charScore >= threshold;
  const costumePassed = typeof parsed.costumePassed === 'boolean' ? parsed.costumePassed : costumeScore >= threshold;

  const passed = allowFreeCostumeChange
    ? characterPassed && overallScore >= threshold
    : costumePassed && characterPassed && overallScore >= threshold;

  const matchedChar = matchCharacterForScene(
    mem,
    sc,
    String(parsed.affectedCharacterId || parsed.affectedCharacterName || ch?.id || '')
  );
  const mismatchText = String(
    parsed.mismatchDetails || parsed.summary || 'Trang phục trên ảnh chưa khớp với ảnh tham chiếu gốc.'
  ).trim();
  const costumeMismatch =
    !passed && !allowFreeCostumeChange && !costumePassed
      ? buildCostumeMismatchReport({
          mem,
          runId: task.runId,
          targetMediaKind: targetKind,
          scene: sc,
          character: matchedChar || ch,
          responsibleAgentId: 'muse-03',
          faultyArtifactUrl: targetImageUrl,
          observedCostume: String(parsed.observedCostume || '').trim() || undefined,
          mismatchDetails: mismatchText,
        })
      : undefined;

  const report: QaInspectionReport = {
    id: `qa_img_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    sceneId: sc?.sceneId || `char_${matchedChar?.id || ch?.id || 'ref'}`,
    sceneIndex: sc?.index || 0,
    runId: task.runId,
    inspectorAgentId: agent.id,
    checkedAt: Date.now(),
    overallScore,
    passed,
    threshold,
    targetMediaKind: targetKind,
    characterId: matchedChar?.id || ch?.id,
    costumeMismatch,
    criteriaResults: [
      {
        criterion: 'character',
        label: 'Nhân vật (Gương mặt, vóc dáng, độ tuổi)',
        passed: characterPassed,
        score: charScore,
        note: String(parsed.summary || 'Đối chiếu gương mặt & tỷ lệ tham chiếu').trim(),
      },
      {
        criterion: 'costume',
        label: 'Trang phục (Màu sắc, kiểu dáng, phụ kiện)',
        passed: costumePassed,
        score: costumeScore,
        note: passed
          ? 'Trang phục khớp 100% ảnh & hồ sơ tham chiếu gốc'
          : mismatchText,
      },
    ],
    timestampRange: sc ? `Keyframe 0s` : 'Ảnh tham chiếu',
    summary: String(
      parsed.summary ||
        (passed
          ? `Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name || 'nhân vật'} đạt chuẩn trang phục tham chiếu gốc`
          : `Phát hiện sai lệch trang phục trên ảnh: ${mismatchText}`)
    ).trim(),
    targetFixAgentId: passed ? undefined : 'muse-03',
    fixInstruction: passed ? undefined : String(parsed.fixInstruction || costumeMismatch?.restoreRecommendation || mismatchText).trim(),
    attemptNumber: (sc?.retryCount || 0) + 1,
  };

  storeDoc.qaReports.unshift(report);
  if (storeDoc.qaReports.length > 200) {
    storeDoc.qaReports = storeDoc.qaReports.slice(0, 200);
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputArtifactUrl = targetImageUrl;
  task.outputText = `QA Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name || ''}: ${overallScore}/100 (${passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}) — ${report.summary}`;

  const openInc = storeDoc.incidents.find(
    (i) =>
      i.runId === task.runId &&
      !['resolved', 'escalated_to_user'].includes(i.status) &&
      ((sc?.sceneId && i.sceneId === sc.sceneId) ||
        (!sc?.sceneId && (matchedChar?.id || ch?.id) && i.costumeMismatch?.characterId === (matchedChar?.id || ch?.id) && !i.sceneId) ||
        (task.costumeRecovery?.incidentId && i.id === task.costumeRecovery.incidentId))
  );

  if (passed) {
    appendConversationMessage({
      channel: 'qa',
      projectId: mem.projectId,
      runId: task.runId,
      sceneId: sc?.sceneId,
      senderType: 'agent',
      senderId: agent.id,
      senderName: `${agent.name} (${agent.roleTitle})`,
      taskId: task.id,
      messageKind: 'deliverable',
      attachments: targetImageUrl ? [targetImageUrl] : undefined,
      content: `Kiểm định ảnh ĐẠT (${overallScore}/100) cho ${sc ? `Cảnh ${sc.index} "${sc.title}"` : `nhân vật ${matchedChar?.name || ch?.name}`}. Trang phục khớp chuẩn tham chiếu gốc.`,
    });

    if (openInc) {
      if (sc) {
        // Restored image passed Muse 05 -> verify whether an unstarted video task is already waiting on task.id
        const pendingVid = storeDoc.tasks.find(
          (t) =>
            t.runId === task.runId &&
            t.sceneId === sc.sceneId &&
            t.type === 'produce_scene_video' &&
            ['blocked_by_deps', 'queued'].includes(t.status)
        );
        let vidIdForBus = pendingVid?.id;
        if (!pendingVid) {
          const fixVidOwner = storeDoc.agents.find((a) => a.id === 'muse-04');
          if (fixVidOwner) fixVidOwner.regenCount = (fixVidOwner.regenCount || 0) + 1;
          const canonCst = getCharacterCanonicalCostume(matchedChar || ch) || sc.costume;
          const retryVid = enqueueTask({
            runId: task.runId,
            type: 'produce_scene_video',
            title: `[${openInc.code} #${openInc.attemptCount}] Cảnh ${sc.index}: Quay lại video từ ảnh đã sửa trang phục`,
            instructions: `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. KHÓA TRANG PHỤC CHUẨN: ${canonCst}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`,
            assignedAgentId: 'muse-04',
            dependsOnTaskIds: [task.id],
            sceneId: sc.sceneId,
            sceneIndex: sc.index,
            priority: 9,
          });
          const finalVidQa = enqueueTask({
            runId: task.runId,
            type: 'qa_inspect_scene',
            title: `[Kiểm duyệt video ${openInc.code} #${openInc.attemptCount}] Cảnh ${sc.index}: "${sc.title}"`,
            instructions: `Kiểm tra video Cảnh ${sc.index} sau khi đã khôi phục trang phục đúng tham chiếu gốc (${openInc.code}).`,
            assignedAgentId: 'muse-05',
            dependsOnTaskIds: [retryVid.id],
            sceneId: sc.sceneId,
            sceneIndex: sc.index,
            priority: 8,
          });
          openInc.remediationTaskIds.push(retryVid.id, finalVidQa.id);
          openInc.qaVerificationTaskId = finalVidQa.id;
          vidIdForBus = retryVid.id;

          const assembleTask = storeDoc.tasks.find(
            (t) =>
              t.runId === task.runId &&
              t.type === 'assemble_final_film' &&
              (t.status === 'blocked_by_deps' || t.status === 'queued')
          );
          if (assembleTask) {
            assembleTask.dependsOnTaskIds = Array.from(
              new Set([...assembleTask.dependsOnTaskIds.filter((id) => id !== task.id), finalVidQa.id])
            );
            assembleTask.status = 'blocked_by_deps';
          }
        }
        appendIncidentTurn(openInc, {
          actorId: agent.id,
          actorName: `${agent.name} (${agent.roleTitle})`,
          roleBadge: 'Ảnh ĐẠT · Sang Video',
          kind: 'qa_review',
          attachments: targetImageUrl ? [targetImageUrl] : undefined,
          content: `Ảnh khôi phục Cảnh ${sc.index} ĐẠT ${overallScore}/100 — trang phục đã khớp 100% ảnh tham chiếu gốc. Đã xác nhận với Muse AI 01 cho phép Muse AI 04 dựng lại video Cảnh ${sc.index}.`,
        });
        postIncidentChannelMessage({
          inc: openInc,
          senderId: agent.id,
          senderName: `${agent.name} – Kiểm duyệt ảnh`,
          roleBadge: 'Ảnh ĐẠT',
          targetAgentIds: ['muse-01', 'muse-04'],
          attachments: targetImageUrl ? [targetImageUrl] : undefined,
          content: `[${openInc.code}] Ảnh Cảnh ${sc.index} đã đạt khớp trang phục gốc (${overallScore}/100). Chuyển Muse AI 04 dựng video Cảnh ${sc.index} (Task ${vidIdForBus || ''}).`,
        });
        emitCommandCenterEvent('incident:updated', openInc);
      } else {
        resolveIncidentRecord(
          openInc,
          agent,
          `Ảnh tham chiếu nhân vật "${matchedChar?.name || ch?.name}" đạt ${overallScore}/100 — trang phục đã khớp 100% hồ sơ gốc.`
        );
      }
    }

    postAiBusMessage({
      fromAgent: agent,
      toAgentIds: ['muse-01', 'muse-04'],
      runId: task.runId,
      projectId: mem.projectId,
      taskId: task.id,
      sceneId: sc?.sceneId,
      content: `[QA-IMG→PASS] Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name} đạt ${overallScore}/100 (khớp trang phục gốc). Cho phép tiếp tục dây chuyền.`,
    });
    return;
  }

  // Image failed costume/character QA -> reject task & escalate immediately to Muse AI 01
  task.status = 'qa_rejected';
  agent.stats.retried += 1;
  await openOrAdvanceDirectorIncident({
    incidentId: openInc?.id,
    runId: task.runId,
    task,
    scene: sc,
    qaReport: report,
    costumeMismatch,
    reporterAgentId: 'muse-05',
    responsibleAgentId: 'muse-03',
    explicitCategory: costumeMismatch ? 'wrong_costume' : 'wrong_character',
    errorDescription: costumeMismatch
      ? `Sai lệch trang phục nhân vật "${costumeMismatch.characterName}" (${costumeMismatch.characterId}) tại ${sc ? `ảnh Cảnh ${sc.index}` : 'ảnh nhân vật'}: ${costumeMismatch.mismatchDetails}`
      : `Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name || ''} không đạt kiểm định (${overallScore}/100 < ${threshold}): ${report.summary}`,
    suspectedRootCause: mismatchText,
    initialProposal: report.fixInstruction,
    severity: 'critical',
    artifactUrls: targetImageUrl ? [targetImageUrl] : [],
  });
}

async function executeProduceSceneVideoTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
      ensureCharacterOriginalAnchors(c);
      const dUrl = getCharacterCanonicalImageDataUrl(c);
      if (!dUrl) return null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        dataUrl: dUrl,
        syncProfile: c.confirmedOriginalSyncProfile || c.syncProfile,
      };
    })
    .filter(Boolean) as any[];

  const charBibleText = mem.characters
    .map((c) => {
      const canon = c.confirmedOriginalSyncProfile || c.syncProfile;
      return `${c.name}: ${canon.face}; ${canon.physique}; ${
        mem.allowFreeCostumeChange === true ? c.syncProfile.costume : canon.costume
      }; ${canon.voice}`;
    })
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
    allowFreeCostumeChange: mem.allowFreeCostumeChange === true,
  });

  throwIfRunStopped(task.runId);

  const srcDisk = artifactUrlToDiskPath(vidRes.previewUrl);
  let stableUrl = vidRes.previewUrl;
  let stableFile = vidRes.assetId;
  if (srcDisk && fs.existsSync(srcDisk)) {
    const buf = fs.readFileSync(srcDisk);
    const saved = saveArtifactBuffer(`scene_${sc.index}_vid`, path.extname(srcDisk) || '.mp4', buf);
    stableUrl = saved.url;
    stableFile = saved.fileName;
  }

  commitSessionMemoryUpdate(task.runId, 'muse-01', `Khóa video Cảnh ${sc.index} từ ${agent.name}`, (m) => {
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
    run.completedScenes = getRunMemory(task.runId).scenes.filter((s) => Boolean(s.videoUrl)).length;
    run.updatedAt = Date.now();
  }

  task.executedByProvider = vidRes.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = stableUrl;
  task.outputText = `Đã dựng xong Cảnh ${sc.index} "${sc.title}" (${vidRes.durationSec}s, audio=${vidRes.hasAudio ? 'có' : 'không'}, ${vidRes.model}).`;

  appendConversationMessage({
    channel: 'video',
    projectId: mem.projectId,
    runId: task.runId,
    sceneId: sc.sceneId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [stableUrl],
    content: `Cảnh ${sc.index} "${sc.title}" hoàn tất dựng clip (${vidRes.durationSec}s, ${vidRes.hasAudio ? 'có âm thanh' : 'chưa có âm thanh'}, ${vidRes.model}).`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: ['muse-05'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: task.id,
    sceneId: sc.sceneId,
    content: `[VIDEO→QA] Cảnh ${sc.index} (${vidRes.durationSec}s) đã dựng xong. Yêu cầu ${storeDoc.agents[4]?.name || 'Muse Guardian'} kiểm định 8 tiêu chí.`,
  });
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
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
  const allowFreeCostumeChange = mem.allowFreeCostumeChange === true;
  const canonicalCharChecklist =
    mem.characters.length > 0
      ? mem.characters
          .map(
            (c, i) =>
              `  ${i + 1}. Nhân vật "${c.name}": Khuôn mặt/tóc="${c.syncProfile.face}"; Vóc dáng="${c.syncProfile.physique}"; Đặc điểm nhận dạng="${c.syncProfile.distinguishingMarks}"; Trang phục chuẩn="${c.syncProfile.costume}"`
          )
          .join('\n')
      : '  (Kiểm tra khớp mô tả nhân vật & trang phục trong kịch bản)';

  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — AI kiểm định độc lập trong Phòng Điều Hành AI Muse.
Nhiệm vụ: Kiểm tra video đầu ra của Cảnh ${sc.index} dựa trên các khung hình trích xuất thực tế, ảnh tham chiếu nhân vật và Project Memory v${mem.version}.
QUY TẮC KIỂM ĐỊNH ĐỒNG NHẤT NHÂN VẬT & TRANG PHỤC (BẮT BUỘC):
1. Khuôn mặt, kiểu tóc, màu tóc phải khớp ảnh tham chiếu & hồ sơ nhân vật.
2. Vóc dáng, chiều cao, tỷ lệ cơ thể phải đồng nhất.
3. ${
    allowFreeCostumeChange
      ? 'Chế độ ĐƯỢC PHÉP TỰ DO THAY ĐỔI TRANG PHỤC đang BẬT — trang phục được phép đổi theo kịch bản cảnh, nhưng khuôn mặt/tóc/vóc dáng vẫn PHẢI khóa đồng nhất 100%.'
      : 'Chế độ ĐƯỢC PHÉP TỰ DO THAY ĐỔI TRANG PHỤC đang TẮT (KHÓA CỨNG) — trang phục, màu sắc vải & phụ kiện PHẢI khớp 100% ảnh tham chiếu & Costume Reference.'
  }
4. ${
    allowFreeCostumeChange
      ? 'Không kiểm lỗi nếu nhân vật mặc trang phục hợp lý theo cảnh.'
      : 'Cảnh báo & đánh FAIL tiêu chí "costume" (score < 70, passed: false) NGAY LẬP TỨC nếu phát hiện AI tự thêm áo khoác, đổi màu/kiểu áo quần, thêm/bớt phụ kiện trái phép — và BẮT BUỘC điền đầy đủ object "costumeMismatch".'
  }
5. Kiểm tra đồng nhất giữa ảnh tham chiếu nhân vật, keyframe cảnh và Cảnh trước đó (nếu có).
Trả về DUY NHẤT JSON hợp lệ:
{
  "overallScore": 85,
  "timestampRange": "0s-${sc.durationSec}s",
  "summary": "Nhận xét ngắn gọn kết quả kiểm định",
  "targetFixAgentId": "muse-04",
  "fixInstruction": "Chỉ dẫn cụ thể để sửa lỗi nếu điểm < ${storeDoc.cloudConfig.qaPassThreshold}",
  "costumeMismatch": null,
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
}
(Khi phát hiện sai trang phục lúc đang khóa, đặt "costumeMismatch": { "characterId": "...", "characterName": "...", "expectedCostume": "...", "observedCostume": "...", "mismatchDetails": "mô tả chi tiết điểm sai khác" })`;

  const user = `THÔNG SỐ CHUẨN PROJECT MEMORY v${mem.version}:
- Thiết lập khóa trang phục: ${allowFreeCostumeChange ? 'TỰ DO ĐỔI THEO CẢNH (vẫn khóa mặt/vóc dáng)' : 'KHÓA CỨNG TRANG PHỤC THEO ẢNH THAM CHIẾU (tuyệt đối không tự đổi)'}
- Hồ sơ đối chiếu nhân vật chi tiết:
${canonicalCharChecklist}
- Trang phục tổng thể (Costume Bible): ${mem.costumeBible || sc.costume || '(Theo ảnh tham chiếu)'}
- Cảnh cần kiểm tra: Cảnh ${sc.index}/${mem.scenes.length} — "${sc.title}"
- Thời lượng kiểm tra thực tế từ ffprobe: ${sc.probedDurationSec || sc.durationSec}s · Có luồng audio: ${sc.hasAudioStream ? 'Có' : 'Không'}
- Bối cảnh chuẩn: ${sc.settingDetail}
- Trang phục chuẩn cảnh này: ${sc.costume}
- Hành động chuẩn: ${sc.actionDetail}
- Lời thoại chuẩn: ${sc.dialogue || '(Không có thoại)'}
- Lời dẫn: ${sc.narration || '(Không)'}
- Cảnh trước đó: ${prevScene ? `Cảnh ${prevScene.index}: ${prevScene.actionDetail} (Trang phục: ${prevScene.costume})` : 'Đây là cảnh mở đầu'}
- Số khung hình video thực tế đính kèm: ${extractedFrames.length}`;

  const res = await runAgentJsonInference({
    agent,
    systemPrompt: sys,
    userPrompt: user,
    attachments: allAttachments,
  });

  throwIfRunStopped(task.runId);

  const parsed = res.parsed || {};
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

  // Hard lock gate: character consistency ALWAYS must pass; costume MUST pass whenever allowFreeCostumeChange is OFF
  const charCrit = criteriaResults.find((c) => c.criterion === 'character');
  const costumeCrit = criteriaResults.find((c) => c.criterion === 'costume');
  const charFailed = Boolean(charCrit && (!charCrit.passed || charCrit.score < threshold));
  const costumeLockedFailed = Boolean(
    !allowFreeCostumeChange && costumeCrit && (!costumeCrit.passed || costumeCrit.score < threshold)
  );
  const hardLockFailed = charFailed || costumeLockedFailed;

  const passed =
    !hardLockFailed &&
    overallScore >= threshold &&
    criteriaResults.filter((c) => !c.passed).length <= 1;

  const attemptNumber = sc.retryCount + 1;
  const targetFix: 'muse-02' | 'muse-03' | 'muse-04' =
    costumeLockedFailed
      ? 'muse-03'
      : parsed.targetFixAgentId === 'muse-03' || parsed.targetFixAgentId === 'muse-02'
      ? parsed.targetFixAgentId
      : hardLockFailed
      ? 'muse-03'
      : 'muse-04';

  const baseFixInstr = String(
    parsed.fixInstruction ||
      'Bám sát gương mặt nhân vật tham chiếu, trang phục và timeline hành động trong Project Memory.'
  ).trim();
  const lockFixSuffix = hardLockFailed
    ? ` [KHÓA THAM CHIẾU BẮT BUỘC: Giữ nguyên 100% ngoại hình & ${allowFreeCostumeChange ? 'nhân dạng' : 'trang phục tham chiếu'}: ${mem.characters.map((c) => `${c.name} (${c.syncProfile.face}; ${getCharacterCanonicalCostume(c) || c.syncProfile.costume})`).join(' | ') || mem.costumeBible}]`
    : '';

  let extractedFaultFrameUrl: string | undefined;
  if (costumeLockedFailed && extractedFrames[0]) {
    const savedFault = saveDataUrlArtifact(`qa_scene_${sc.index}_costume_fault`, extractedFrames[0]);
    if (savedFault) extractedFaultFrameUrl = savedFault.url;
  }
  const parsedCm = parsed.costumeMismatch && typeof parsed.costumeMismatch === 'object' ? parsed.costumeMismatch : null;
  const matchedCmChar = costumeLockedFailed
    ? matchCharacterForScene(mem, sc, String(parsedCm?.characterId || parsedCm?.characterName || ''))
    : undefined;
  const costumeMismatchReport: CostumeMismatchReport | undefined = costumeLockedFailed
    ? buildCostumeMismatchReport({
        mem,
        runId: task.runId,
        targetMediaKind: 'scene_video',
        scene: sc,
        character: matchedCmChar,
        responsibleAgentId: 'muse-04',
        faultyArtifactUrl: extractedFaultFrameUrl || sc.keyframeImageUrl,
        faultyVideoUrl: sc.videoUrl,
        observedCostume: String(parsedCm?.observedCostume || '').trim() || undefined,
        mismatchDetails: String(
          parsedCm?.mismatchDetails ||
            costumeCrit?.note ||
            parsed.summary ||
            `Trang phục trên video Cảnh ${sc.index} không khớp với ảnh tham chiếu gốc.`
        ).trim(),
      })
    : undefined;

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
    summary: String(
      parsed.summary ||
        (passed
          ? 'Đạt chuẩn đồng nhất'
          : hardLockFailed
          ? 'Sai lệch ngoại hình hoặc trang phục so với nhân vật tham chiếu đang khóa'
          : 'Cần chỉnh sửa lại phân cảnh')
    ).trim(),
    targetFixAgentId: passed ? undefined : targetFix,
    fixInstruction: passed ? undefined : `${baseFixInstr}${lockFixSuffix}`,
    attemptNumber,
    targetMediaKind: 'scene_video',
    characterId: costumeMismatchReport?.characterId,
    costumeMismatch: costumeMismatchReport,
  };

  storeDoc.qaReports.unshift(report);
  if (storeDoc.qaReports.length > 200) {
    storeDoc.qaReports = storeDoc.qaReports.slice(0, 200);
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = `QA Cảnh ${sc.index}: ${overallScore}/100 (${passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}) — ${report.summary}`;

  if (passed) {
    commitSessionMemoryUpdate(task.runId, 'muse-01', `Muse AI 05 duyệt Cảnh ${sc.index} (${overallScore}/100)`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target) {
        target.qaStatus = 'passed';
        target.qaScore = overallScore;
        target.qaReportId = report.id;
      }
    });

    const run = storeDoc.runs.find((r) => r.id === task.runId);
    if (run) {
      run.passedQaScenes = getRunMemory(task.runId).scenes.filter((s) => s.qaStatus === 'passed').length;
      run.updatedAt = Date.now();
    }

    appendConversationMessage({
      channel: 'qa',
      projectId: mem.projectId,
      runId: task.runId,
      sceneId: sc.sceneId,
      senderType: 'agent',
      senderId: agent.id,
      senderName: `${agent.name} (${agent.roleTitle})`,
      taskId: task.id,
      messageKind: 'deliverable',
      content: `Kiểm định ĐẠT Cảnh ${sc.index} "${sc.title}" (${overallScore}/100 ≥ ngưỡng ${threshold}). Cho phép đưa vào bản dựng cuối.`,
    });

    postAiBusMessage({
      fromAgent: agent,
      toAgentIds: ['muse-01'],
      runId: task.runId,
      projectId: mem.projectId,
      taskId: task.id,
      sceneId: sc.sceneId,
      content: `[QA→PASS] Cảnh ${sc.index} đạt ${overallScore}/100. Đã xác nhận đưa vào hàng đợi ghép phim.`,
    });

    // Resolve any open incident for this scene ONLY after real QA verification passes
    const openInc = storeDoc.incidents.find(
      (i) =>
        i.runId === task.runId &&
        i.sceneId === sc.sceneId &&
        !['resolved', 'escalated_to_user'].includes(i.status)
    );
    if (openInc) {
      resolveIncidentRecord(
        openInc,
        agent,
        `Kiểm duyệt ĐẠT Cảnh ${sc.index} "${sc.title}" (${overallScore}/100 ≥ ngưỡng ${threshold}) sau vòng khắc phục #${openInc.attemptCount}.`
      );
    }
    return;
  }

  // Failed QA: Muse 05 MUST report urgently to Muse AI 01 (never silently skip or bypass Director)
  task.status = 'qa_rejected';
  agent.stats.retried += 1;
  const failedLabels = report.criteriaResults
    .filter((c) => !c.passed)
    .map((c) => `${c.label} (${c.score}đ)`)
    .join(', ');

  await openOrAdvanceDirectorIncident({
    runId: task.runId,
    task,
    scene: sc,
    qaReport: report,
    costumeMismatch: costumeMismatchReport,
    reporterAgentId: 'muse-05',
    responsibleAgentId: costumeMismatchReport ? costumeMismatchReport.responsibleAgentId : targetFix,
    explicitCategory: costumeMismatchReport ? 'wrong_costume' : undefined,
    errorDescription: costumeMismatchReport
      ? `Sai trang phục nhân vật "${costumeMismatchReport.characterName}" (${costumeMismatchReport.characterId}) tại video Cảnh ${sc.index} "${sc.title}": ${costumeMismatchReport.mismatchDetails}`
      : `Cảnh ${sc.index} "${sc.title}" không đạt QA (${overallScore}/100 < ngưỡng ${threshold}, mốc ${report.timestampRange}). Tiêu chí lỗi: ${failedLabels || report.summary}`,
    suspectedRootCause: costumeMismatchReport?.mismatchDetails || report.summary,
    initialProposal: costumeMismatchReport?.restoreRecommendation || report.fixInstruction,
    severity: costumeMismatchReport || overallScore < 60 ? 'critical' : 'high',
    artifactUrls: [
      ...(extractedFaultFrameUrl ? [extractedFaultFrameUrl] : []),
      ...(sc.videoUrl ? [sc.videoUrl] : []),
    ],
  });
}

async function executeAssembleFinalFilmTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
  let silentInputIdx = -1;

  for (let i = 0; i < clipPaths.length; i += 1) {
    ffmpegArgs.push('-i', clipPaths[i].path);
  }
  if (clipPaths.some((c) => !c.hasAudio)) {
    silentInputIdx = clipPaths.length;
    ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

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

  throwIfRunStopped(task.runId);

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
    channel: 'commander',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [finalUrl],
    content: `Hoàn tất bàn giao bộ phim "${mem.title}" (${scenes.length} phân cảnh, ${Math.round(finalDur * 10) / 10}s) đạt kiểm định đồng nhất từ ${storeDoc.agents[4]?.name || 'Muse Guardian'}.`,
  });
  appendConversationMessage({
    channel: 'production',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [finalUrl],
    content: `Phiên "${mem.title}" đã hoàn tất xuất bản MP4 hoàn chỉnh (${Math.round(finalDur * 10) / 10}s).`,
  });
  maybeAutoBackup(`Hoàn tất sản xuất phim ${mem.title}`, task.runId, true);
}

async function executeCustomTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
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
    sceneId: task.sceneId,
    senderType: 'agent',
    senderId: agent.id,
    senderName: `${agent.name} (${agent.roleTitle})`,
    taskId: task.id,
    messageKind: 'deliverable',
    content: res.text,
  });
}

function recordAgentSample(agentId: MuseAgentId, durationMs: number, ackLatencyMs: number): void {
  const arr = storeDoc.fastCommStats.agentResponseSamplesMs[agentId] || [];
  arr.push(durationMs);
  if (arr.length > 30) arr.shift();
  storeDoc.fastCommStats.agentResponseSamplesMs[agentId] = arr;

  storeDoc.fastCommStats.ackSamplesMs.push(ackLatencyMs);
  if (storeDoc.fastCommStats.ackSamplesMs.length > 60) {
    storeDoc.fastCommStats.ackSamplesMs.shift();
  }
}

function hydrateAgentComputedMetrics(agent: MuseAgentConfig): MuseAgentConfig {
  const samples = storeDoc.fastCommStats.agentResponseSamplesMs[agent.id] || [];
  const avgResponseMs =
    samples.length > 0 ? Math.round(samples.reduce((s, v) => s + v, 0) / samples.length) : agent.avgResponseMs || 0;
  const ackSamples = storeDoc.fastCommStats.ackSamplesMs;
  const avgAckLatencyMs =
    ackSamples.length > 0
      ? Math.round(ackSamples.reduce((s, v) => s + v, 0) / ackSamples.length)
      : agent.avgAckLatencyMs || 0;
  const totalFinished = (agent.stats?.completed || 0) + (agent.stats?.failed || 0);
  const successRate =
    totalFinished > 0 ? Math.round(((agent.stats?.completed || 0) / totalFinished) * 100) : 100;
  return {
    ...agent,
    avgResponseMs,
    avgAckLatencyMs,
    reconnectCount: agent.reconnectCount || 0,
    regenCount: agent.regenCount || 0,
    hungCount: agent.hungCount || 0,
    successRate,
  };
}

function enrichProductionRun(run: ProductionRun): ProductionRun {
  const runTasks = storeDoc.tasks.filter((t) => t.runId === run.id);
  const sessionMem = storeDoc.sessionMemories[run.id];
  const scenes = sessionMem ? sessionMem.scenes : storeDoc.projectMemory.scenes;

  const perMuseProgress: MuseRunProgress[] = storeDoc.agents.map((ag) => {
    const agTasks = runTasks.filter((t) => t.assignedAgentId === ag.id);
    const totalTasks = agTasks.length;
    const completedTasks = agTasks.filter((t) => t.status === 'completed').length;
    const runningTask = agTasks.find((t) => t.status === 'running');
    const runningTasks = agTasks.filter((t) => t.status === 'running').length;
    const failedTasks = agTasks.filter((t) => t.status === 'failed').length;
    let progressPct = 0;
    if (totalTasks > 0) {
      if (completedTasks === totalTasks) {
        progressPct = 100;
      } else {
        progressPct = Math.min(96, Math.round(((completedTasks + runningTasks * 0.45) / totalTasks) * 100));
      }
    } else if (run.status === 'completed') {
      progressPct = 100;
    }
    return {
      agentId: ag.id,
      progressPct,
      completedTasks,
      totalTasks,
      runningTasks,
      failedTasks,
      currentTaskTitle: runningTask?.title || agTasks.find((t) => t.status === 'queued')?.title,
    };
  });

  const totalRunTasks = runTasks.length;
  const completedRunTasks = runTasks.filter((t) => t.status === 'completed').length;
  const runningRunTasks = runTasks.filter((t) => t.status === 'running').length;

  const overallProgressPct =
    run.status === 'completed'
      ? 100
      : totalRunTasks > 0
      ? Math.min(98, Math.round(((completedRunTasks + runningRunTasks * 0.4) / totalRunTasks) * 100))
      : 0;

  const sceneCount = scenes.length || run.sceneCount || 0;
  const activeSceneIds = new Set(
    runTasks.filter((t) => t.status === 'running' && t.sceneId).map((t) => t.sceneId!)
  );
  const failedSceneIds = new Set([
    ...runTasks.filter((t) => t.status === 'failed' && t.sceneId).map((t) => t.sceneId!),
    ...scenes.filter((s) => s.qaStatus === 'escalated').map((s) => s.sceneId),
  ]);
  const completedScenesCount = scenes.filter((s) => s.qaStatus === 'passed' || Boolean(s.videoUrl)).length;
  const passedQaCount = scenes.filter((s) => s.qaStatus === 'passed').length;
  const runningScenes = activeSceneIds.size;
  const failedScenes = failedSceneIds.size;
  const pendingScenes = Math.max(0, sceneCount - completedScenesCount - runningScenes - failedScenes);

  const startedAt = run.startedAt || run.createdAt;
  let estimatedRemainingSec: number | undefined;
  if (
    ['planning', 'producing', 'inspecting', 'assembling'].includes(run.status) &&
    completedRunTasks >= 1 &&
    overallProgressPct > 0 &&
    overallProgressPct < 100
  ) {
    const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
    estimatedRemainingSec = Math.max(5, Math.round((elapsedSec * (100 - overallProgressPct)) / overallProgressPct));
  }

  return {
    ...run,
    startedAt,
    sceneCount,
    completedScenes: completedScenesCount || run.completedScenes,
    passedQaScenes: passedQaCount || run.passedQaScenes,
    runningScenes,
    pendingScenes,
    failedScenes,
    overallProgressPct,
    perMuseProgress,
    estimatedRemainingSec,
  };
}

async function runSingleTask(task: CommandTask): Promise<void> {
  const agent = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
  if (!agent) return;

  activeTaskIds.add(task.id);
  const now = Date.now();
  task.status = 'running';
  task.startedAt = now;
  task.error = undefined;
  const ackLatencyMs = Math.max(1, now - (task.acknowledgedAt || task.createdAt));

  agent.lastActiveAt = now;
  agent.lastError = undefined;
  addActivityLog('info', `Bắt đầu ${task.code}`, `${agent.name} đang thực thi: ${task.title}`, {
    agentId: agent.id,
    taskId: task.id,
    runId: task.runId,
  });
  saveStateAtomic();
  emitCommandCenterEvent('task:updated', task);

  try {
    if (task.type === 'plan_production') {
      await executePlanProductionTask(task, agent);
    } else if (task.type === 'analyze_script') {
      await executeAnalyzeScriptTask(task, agent);
    } else if (task.type === 'design_character_ref') {
      await executeDesignCharacterRefTask(task, agent);
    } else if (task.type === 'design_scene_image') {
      await executeDesignSceneImageTask(task, agent);
    } else if (task.type === 'restore_costume_and_regen_image') {
      await executeRestoreCostumeAndRegenImageTask(task, agent);
    } else if (task.type === 'qa_inspect_image') {
      await executeQaInspectImageTask(task, agent);
    } else if (task.type === 'produce_scene_video') {
      await executeProduceSceneVideoTask(task, agent);
    } else if (task.type === 'qa_inspect_scene') {
      await executeQaInspectSceneTask(task, agent);
    } else if (task.type === 'assemble_final_film') {
      await executeAssembleFinalFilmTask(task, agent);
    } else {
      await executeCustomTask(task, agent);
    }

    const doneAt = Date.now();
    const isQaRejected = (task.status as CommandTaskStatus) === 'qa_rejected';
    if (!isQaRejected) {
      task.status = 'completed';
    }
    task.completedAt = doneAt;
    task.durationMs = Math.max(1, doneAt - (task.startedAt || doneAt));
    agent.stats.completed += 1;
    agent.lastActiveAt = doneAt;
    recordAgentSample(agent.id, task.durationMs, ackLatencyMs);

    const isTextTask = ['plan_production', 'analyze_script', 'qa_inspect_scene', 'qa_inspect_image', 'custom_task'].includes(task.type);
    if (isTextTask && task.durationMs > SLOW_TEXT_THRESHOLD_MS) {
      pushPerformanceAlert({
        severity: 'warn',
        category: 'slow_response',
        agentId: agent.id,
        taskId: task.id,
        runId: task.runId,
        message: `${agent.name} hoàn tất ${task.code} sau ${Math.round(task.durationMs / 1000)}s (chậm hơn ngưỡng ${Math.round(SLOW_TEXT_THRESHOLD_MS / 1000)}s).`,
      });
    }

    addActivityLog(
      isQaRejected ? 'warn' : 'success',
      isQaRejected ? `QA trả về ${task.code}` : `Hoàn tất ${task.code}`,
      task.outputText || task.title,
      {
        agentId: agent.id,
        taskId: task.id,
        runId: task.runId,
      }
    );

    // If this task was a non-scene remediation task inside an open incident (excluding costume image restore which MUST be verified by Muse 05 first), close that incident after real completion
    if (
      !isQaRejected &&
      task.type !== 'qa_inspect_scene' &&
      task.type !== 'qa_inspect_image' &&
      task.type !== 'restore_costume_and_regen_image' &&
      !task.sceneId
    ) {
      const matchedInc = storeDoc.incidents.find(
        (i) =>
          i.runId === task.runId &&
          !['resolved', 'escalated_to_user'].includes(i.status) &&
          i.remediationTaskIds.includes(task.id)
      );
      if (matchedInc) {
        const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || agent;
        resolveIncidentRecord(
          matchedInc,
          qaAgent,
          `Tác vụ khắc phục ${task.code} (${agent.name}) đã hoàn tất thực tế: ${task.outputText || task.title}`
        );
      }
    }

    maybeAutoBackup(`Hoàn tất ${task.code}`, task.runId);
    emitCommandCenterEvent('task:updated', task);
  } catch (err: any) {
    const errMsg = String(err?.message || err || 'Lỗi thực thi tác vụ.');
    if (errMsg === '__RUN_PAUSED__') {
      task.status = 'queued';
      task.error = undefined;
      addActivityLog('info', `Tạm dừng an toàn ${task.code}`, `${agent.name} đã giữ nguyên trạng thái ${task.code} để tiếp tục sau.`, {
        agentId: agent.id,
        taskId: task.id,
        runId: task.runId,
      });
      emitCommandCenterEvent('task:updated', task);
      return;
    }
    if (errMsg === '__RUN_CANCELLED__') {
      task.status = 'cancelled';
      task.error = undefined;
      addActivityLog('warn', `Hủy tác vụ ${task.code}`, `Đã ngưng ${task.code} do phiên sản xuất bị hủy.`, {
        agentId: agent.id,
        taskId: task.id,
        runId: task.runId,
      });
      emitCommandCenterEvent('task:updated', task);
      return;
    }

    task.status = 'failed';
    task.completedAt = Date.now();
    task.durationMs = task.startedAt ? task.completedAt - task.startedAt : undefined;
    task.error = errMsg;
    agent.stats.failed += 1;
    agent.lastError = errMsg;

    if (/offline|ngoại tuyến|cookie|chưa thể thực thi|ECONNREFUSED|timeout/i.test(errMsg)) {
      pushPerformanceAlert({
        severity: 'error',
        category: 'offline',
        agentId: agent.id,
        taskId: task.id,
        runId: task.runId,
        message: `${agent.name} báo lỗi kết nối tại ${task.code}: ${errMsg.slice(0, 140)}`,
      });
    }

    addActivityLog('error', `Lỗi ${task.code}`, `${agent.name}: ${errMsg}`, {
      agentId: agent.id,
      taskId: task.id,
      runId: task.runId,
    });

    // Report urgently to Muse AI 01 so Director handles recovery autonomously unless escalated
    const mem = getRunMemory(task.runId);
    const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
    const outcome = await openOrAdvanceDirectorIncident({
      runId: task.runId,
      task,
      scene: sc,
      reporterAgentId: agent.id,
      responsibleAgentId: agent.id,
      errorDescription: `${task.code} (${agent.name}) gặp lỗi khi thực thi "${task.title}": ${errMsg}`,
      suspectedRootCause: errMsg,
      severity: /offline|timeout|mất kết nối|chưa thể thực thi/i.test(errMsg) ? 'critical' : 'high',
      artifactUrls: task.outputArtifactUrl ? [task.outputArtifactUrl] : [],
    });

    if (outcome.escalated) {
      const run = storeDoc.runs.find((r) => r.id === task.runId);
      if (run && !['completed', 'cancelled', 'paused'].includes(run.status)) {
        run.status = 'needs_attention';
        run.error = outcome.incident.escalationReason || `${task.code} (${agent.name}) gặp lỗi: ${errMsg}`;
        run.updatedAt = Date.now();
        emitCommandCenterEvent('run:updated', run);
      }
    }
    emitCommandCenterEvent('task:updated', task);
  } finally {
    activeTaskIds.delete(task.id);
    saveStateAtomic();
  }
}

async function tickOrchestratorQueue(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    const now = Date.now();
    storeDoc.cloudConfig.workerHeartbeatAt = now;

    // 0. Watchdog: detect stalled/hung running tasks exceeding timeoutMs
    let watchdogChanged = false;
    for (const task of storeDoc.tasks) {
      if (task.status !== 'running' || !task.startedAt) continue;
      const limit = task.timeoutMs || TASK_MEDIA_TIMEOUT_MS;
      if (now - task.startedAt > limit) {
        activeTaskIds.delete(task.id);
        const ag = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
        if (ag) {
          ag.hungCount = (ag.hungCount || 0) + 1;
        }
        storeDoc.fastCommStats.hungTaskCount += 1;
        pushPerformanceAlert({
          severity: 'error',
          category: 'hung_timeout',
          agentId: task.assignedAgentId,
          taskId: task.id,
          runId: task.runId,
          message: `Tác vụ ${task.code} (${ag?.name || task.assignedAgentId}) bị treo quá ${Math.round(limit / 1000)}s.`,
        });

        if (task.retryCount < task.maxRetries) {
          task.retryCount += 1;
          task.status = 'queued';
          task.startedAt = undefined;
          task.acknowledgedAt = now;
          task.error = undefined;
          if (ag) ag.reconnectCount = (ag.reconnectCount || 0) + 1;
          addActivityLog('warn', `Tự kết nối lại ${task.code}`, `${ag?.name || task.assignedAgentId} vượt timeout, đã xếp hàng chạy lại lần #${task.retryCount}.`, {
            agentId: task.assignedAgentId,
            taskId: task.id,
            runId: task.runId,
          });
        } else {
          task.status = 'failed';
          task.completedAt = now;
          task.error = `Tác vụ treo vượt quá giới hạn ${Math.round(limit / 1000)}s.`;
          const mem = getRunMemory(task.runId);
          const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
          await openOrAdvanceDirectorIncident({
            runId: task.runId,
            task,
            scene: sc,
            reporterAgentId: task.assignedAgentId,
            responsibleAgentId: task.assignedAgentId,
            explicitCategory: 'muse_disconnected',
            errorDescription: `${task.code} (${ag?.name || task.assignedAgentId}) bị treo quá ${Math.round(limit / 1000)}s sau ${task.maxRetries} lần thử kết nối lại.`,
            suspectedRootCause: task.error,
            severity: 'critical',
          });
        }
        watchdogChanged = true;
        emitCommandCenterEvent('task:updated', task);
      }
    }
    if (watchdogChanged) saveStateAtomic();

    // 1. Promote blocked_by_deps tasks whose dependencies are all completed
    let promoted = false;
    for (const task of storeDoc.tasks) {
      if (task.status !== 'blocked_by_deps') continue;
      const run = storeDoc.runs.find((r) => r.id === task.runId);
      if (run && (run.status === 'paused' || run.status === 'cancelled')) continue;

      const deps = task.dependsOnTaskIds.map((id) => storeDoc.tasks.find((t) => t.id === id)).filter(Boolean) as CommandTask[];
      if (deps.some((d) => d.status === 'cancelled')) {
        task.status = 'cancelled';
        task.error = 'Đã hủy do tác vụ tiền đề bị hủy.';
        promoted = true;
        continue;
      }
      if (deps.length === task.dependsOnTaskIds.length && deps.every((d) => d.status === 'completed')) {
        task.status = 'queued';
        task.acknowledgedAt = now;
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
      if (run && ['paused', 'cancelled'].includes(run.status)) continue;

      const agent = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
      if (!agent || agent.paused) continue;
      if (agent.boundAccountId !== 'auto' && busyPinnedAccounts.has(agent.boundAccountId)) {
        continue;
      }

      if (!isAgentAccountReady(agent, health)) {
        task.status = 'failed';
        task.error = `${agent.name} chưa có kết nối Muse2API/tài khoản khỏe mạnh để thực thi thực tế. Hãy kiểm tra mục Cấu hình Cloud & Tài khoản hoặc bật Gemini dự phòng.`;
        agent.lastError = task.error;
        pushPerformanceAlert({
          severity: 'error',
          category: 'offline',
          agentId: agent.id,
          taskId: task.id,
          runId: task.runId,
          message: `${agent.name} mất kết nối khi chuẩn bị chạy ${task.code}.`,
        });
        addActivityLog('error', `Không thể chạy ${task.code}`, task.error, {
          agentId: agent.id,
          taskId: task.id,
          runId: task.runId,
        });
        const mem = getRunMemory(task.runId);
        const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
        await openOrAdvanceDirectorIncident({
          runId: task.runId,
          task,
          scene: sc,
          reporterAgentId: agent.id,
          responsibleAgentId: agent.id,
          explicitCategory: 'muse_disconnected',
          errorDescription: task.error,
          suspectedRootCause: `${agent.name} mất kết nối Muse2API hoặc chưa bật Gemini dự phòng.`,
          severity: 'critical',
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
      const loadedAgents = Array.isArray(raw.agents) && raw.agents.length === 5 ? raw.agents : base.agents;
      // Non-destructive identity defaults migration (preserve user edits)
      loadedAgents.forEach((ag, idx) => {
        const def = DEFAULT_AGENTS[idx];
        if (ag.name === `Muse AI 0${idx + 1}` && def) ag.name = def.name;
        if (!ag.accentColor && def) ag.accentColor = def.accentColor;
        if (!ag.avatarPreset && def) ag.avatarPreset = def.avatarPreset;
        if (
          ag.engineMode === 'muse2api' &&
          !ag.lastActiveAt &&
          ag.stats?.completed === 0 &&
          ag.stats?.failed === 0
        ) {
          ag.engineMode = 'muse2api_with_gemini_fallback';
        }
      });

      const migratedConversations = (Array.isArray(raw.conversations) ? raw.conversations : []).map((m) => ({
        ...m,
        channel: mapLegacyChannel((m as any).channel),
      }));

      const loadedRuns = Array.isArray(raw.runs) ? raw.runs : [];
      const loadedSessionMemories: Record<string, ProjectMemory> =
        raw.sessionMemories && typeof raw.sessionMemories === 'object' ? raw.sessionMemories : {};
      const firstRun = loadedRuns[0];
      const loadedMem = raw.projectMemory || base.projectMemory;
      if (firstRun && !loadedSessionMemories[firstRun.id]) {
        loadedSessionMemories[firstRun.id] = loadedMem;
      }

      storeDoc = {
        ...base,
        ...raw,
        agents: loadedAgents,
        projectMemory: loadedMem,
        sessionMemories: loadedSessionMemories,
        selectedRunId: raw.selectedRunId || firstRun?.id || null,
        latestStudioDirective: raw.latestStudioDirective || null,
        latestStudioBlueprint: raw.latestStudioBlueprint || null,
        runs: loadedRuns,
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        qaReports: Array.isArray(raw.qaReports) ? raw.qaReports : [],
        incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
        conversations: migratedConversations,
        logs: Array.isArray(raw.logs) ? raw.logs : [],
        backups: Array.isArray(raw.backups) ? raw.backups : [],
        performanceAlerts: Array.isArray(raw.performanceAlerts) ? raw.performanceAlerts : [],
        fastCommStats: { ...base.fastCommStats, ...(raw.fastCommStats || {}) },
        cloudConfig: { ...base.cloudConfig, ...(raw.cloudConfig || {}), workerBootId: WORKER_BOOT_ID },
        taskSeq: Number(raw.taskSeq) || 1,
        incidentSeq: Number(raw.incidentSeq) || 1,
      };
    } catch {
      storeDoc = createDefaultDoc();
    }
  } else {
    storeDoc = createDefaultDoc();
    saveStateAtomic();
  }

  if (storeDoc.cloudConfig.muse2ApiBaseUrl || storeDoc.cloudConfig.customMuse2ApiKey) {
    setMuse2ApiRuntimeOverride({
      baseUrl: storeDoc.cloudConfig.muse2ApiBaseUrl,
      apiKey: storeDoc.cloudConfig.customMuse2ApiKey,
    });
  }

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

  const selectedRunId = getEffectiveSelectedRunId();
  const enrichedRuns = storeDoc.runs.slice(0, 25).map(enrichProductionRun);
  const activeRun =
    enrichedRuns.find((r) => r.id === selectedRunId) ||
    enrichedRuns.find((r) => !['completed', 'failed', 'cancelled'].includes(r.status)) ||
    enrichedRuns[0] ||
    null;

  const selectedMemory = activeRun ? getRunMemory(activeRun.id) : storeDoc.projectMemory;

  const agentsWithMetrics = storeDoc.agents.map(hydrateAgentComputedMetrics);
  const connectedAgents = agentsWithMetrics.filter((a) => !['offline', 'error'].includes(a.status)).length;
  const workingAgents = agentsWithMetrics.filter((a) => a.status === 'working').length;
  const supervisingAgents = agentsWithMetrics.filter((a) => a.status === 'supervising').length;
  const waitingAgents = agentsWithMetrics.filter((a) => a.status === 'waiting').length;
  const pausedAgents = agentsWithMetrics.filter((a) => a.status === 'paused').length;

  const relevantTasks = activeRun ? storeDoc.tasks.filter((t) => t.runId === activeRun.id) : storeDoc.tasks;
  const metrics: CommandCenterSummaryMetrics = {
    connectedAgents,
    totalAgents: agentsWithMetrics.length,
    workingAgents,
    supervisingAgents,
    waitingAgents,
    pausedAgents,
    queuedTasks: relevantTasks.filter((t) => t.status === 'queued' || t.status === 'blocked_by_deps').length,
    runningTasks: relevantTasks.filter((t) => t.status === 'running').length,
    completedTasks: relevantTasks.filter((t) => t.status === 'completed').length,
    totalTasks: relevantTasks.length,
  };

  const ackArr = storeDoc.fastCommStats.ackSamplesMs;
  const avgDispatchAckMs =
    ackArr.length > 0 ? Math.round(ackArr.reduce((s, v) => s + v, 0) / ackArr.length) : 0;
  const allRespSamples = Object.values(storeDoc.fastCommStats.agentResponseSamplesMs).flat();
  const avgAgentResponseMs =
    allRespSamples.length > 0
      ? Math.round(allRespSamples.reduce((s, v) => s + v, 0) / allRespSamples.length)
      : 0;
  const fastCommStats: FastCommStats = {
    sseClientsConnected,
    avgDispatchAckMs,
    avgAgentResponseMs,
    aiBusMessageCount: storeDoc.conversations.filter((m) => m.channel === 'ai_bus').length,
    hungTaskCount: storeDoc.fastCommStats.hungTaskCount || 0,
    dedupedTaskCount: storeDoc.fastCommStats.dedupedTaskCount || 0,
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
    maxIncidentRetries: storeDoc.cloudConfig.maxIncidentRetries ?? 3,
    autoDirectorIncidentResponse: storeDoc.cloudConfig.autoDirectorIncidentResponse !== false,
    autoBackupRealtime: storeDoc.cloudConfig.autoBackupRealtime,
    workerHeartbeatAt: Date.now(),
    workerBootId: WORKER_BOOT_ID,
    isCloudEndpoint: !isLocalhostUrl(storeDoc.cloudConfig.muse2ApiBaseUrl || cfg.baseUrl),
  };

  return {
    metrics,
    agents: agentsWithMetrics,
    projectMemory: selectedMemory,
    latestStudioDirective: storeDoc.latestStudioDirective || null,
    selectedRunId: activeRun?.id || null,
    activeRun,
    runs: enrichedRuns,
    tasks: [...storeDoc.tasks].reverse().slice(0, 160),
    qaReports: storeDoc.qaReports.slice(0, 80),
    incidents: (storeDoc.incidents || []).slice(0, 100),
    conversations: storeDoc.conversations.slice(-260),
    logs: storeDoc.logs.slice(0, 180),
    backups: storeDoc.backups.slice(0, 30),
    performanceAlerts: storeDoc.performanceAlerts.slice(0, 40),
    fastCommStats,
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
    avatarDataUrl?: string;
    avatarUrl?: string;
    avatarPreset?: MuseAgentAvatarPreset;
    accentColor?: string;
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
  if (typeof patch.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.accentColor.trim())) {
    agent.accentColor = patch.accentColor.trim();
  }
  if (patch.avatarPreset) {
    agent.avatarPreset = patch.avatarPreset;
  }
  if (typeof patch.avatarDataUrl === 'string' && patch.avatarDataUrl.startsWith('data:')) {
    const saved = saveDataUrlArtifact(`avatar_${agentId}`, patch.avatarDataUrl);
    if (saved) agent.avatarUrl = saved.url;
  } else if (patch.avatarUrl === '') {
    agent.avatarUrl = undefined;
  } else if (typeof patch.avatarUrl === 'string' && patch.avatarUrl.trim()) {
    agent.avatarUrl = patch.avatarUrl.trim();
  }
  if (patch.permissions && typeof patch.permissions === 'object') {
    agent.permissions = { ...agent.permissions, ...patch.permissions };
  }

  addActivityLog('info', `Cập nhật hồ sơ ${agent.code}`, `${agent.name} · Vai trò: ${agent.roleTitle} · Màu: ${agent.accentColor}`, {
    agentId: agent.id,
  });
  saveStateAtomic();
  emitCommandCenterEvent('agent:updated', hydrateAgentComputedMetrics(agent));
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

interface StudioCharacterInput {
  id?: string;
  name?: string;
  description?: string;
  ageGroup?: string;
  gender?: string;
  voiceId?: string;
  dataUrl?: string;
  syncProfile?: Partial<CharacterFivePartProfile>;
}

function normalizeStudioCharactersToMemory(
  rawChars: StudioCharacterInput[] = [],
  existingVersion = 1,
  fallbackCostumeBible = ''
): CommandMemoryCharacter[] {
  return rawChars.slice(0, 8).map((c, idx) => {
    const id = String(c.id || `char_${idx + 1}`);
    const name = String(c.name || `Nhân vật ${idx + 1}`).trim();
    let artifactUrl: string | undefined;
    if (c.dataUrl && c.dataUrl.startsWith('data:')) {
      const saved = saveDataUrlArtifact(`studio_char_${id}`, c.dataUrl);
      if (saved) artifactUrl = saved.url;
    }
    const validAge = ['auto', 'child', 'youth', 'adult_male', 'adult_female', 'middle_aged', 'elderly'].includes(
      String(c.ageGroup || '')
    )
      ? (c.ageGroup as any)
      : 'auto';
    const validGender = c.gender === 'female' ? 'female' : c.gender === 'male' ? 'male' : 'auto';
    const syncProfile = {
      face: String(c.syncProfile?.face || c.description || 'Gương mặt theo mô tả Studio'),
      physique: String(c.syncProfile?.physique || 'Tỷ lệ cân đối tự nhiên'),
      costume: String(c.syncProfile?.costume || fallbackCostumeBible || 'Trang phục đồng bộ xuyên suốt'),
      voice: String(c.syncProfile?.voice || 'Giọng đọc tự nhiên theo độ tuổi'),
      distinguishingMarks: String(c.syncProfile?.distinguishingMarks || 'Đặc điểm nhận dạng ổn định'),
    };
    return {
      id,
      name,
      ageGroup: validAge,
      gender: validGender,
      voiceId: String(c.voiceId || (validGender === 'female' ? 'Aoede' : 'Kore')),
      description: String(c.description || '').trim(),
      artifactUrl,
      syncProfile,
      approvedVersion: existingVersion,
      confirmedOriginalArtifactUrl: artifactUrl,
      confirmedOriginalSyncProfile: structuredClone(syncProfile),
      costumeVersionHistory: [],
    };
  });
}

function normalizeStudioBlueprintScenesToMemory(bp?: Partial<DerivativeBlueprint> | null): CommandMemoryScene[] {
  if (!bp || !Array.isArray(bp.scenes) || bp.scenes.length === 0) return [];
  return bp.scenes.slice(0, 14).map((sc, idx) => {
    const sceneId = `scene_${idx + 1}`;
    const prevId = idx > 0 ? `scene_${idx}` : undefined;
    let keyframeImageUrl: string | undefined;
    let keyframeArtifactName: string | undefined;
    if (sc.sceneImageDataUrl && sc.sceneImageDataUrl.startsWith('data:')) {
      const savedKf = saveDataUrlArtifact(`studio_kf_${idx + 1}`, sc.sceneImageDataUrl);
      if (savedKf) {
        keyframeImageUrl = savedKf.url;
        keyframeArtifactName = savedKf.fileName;
      }
    }
    return {
      sceneId,
      index: Number(sc.sceneIndex || idx + 1),
      title: String(sc.sceneTitle || `Cảnh ${idx + 1}`).trim(),
      durationSec: Math.max(4, Math.min(12, Number(sc.durationSec) || 6)),
      narration: String(sc.narration || '').trim(),
      dialogue: String(sc.dialogue || '').trim(),
      speakerName: String(sc.charactersInScene || '').trim(),
      actionDetail: String(sc.actionDetail || sc.sceneSummary || sc.sceneTitle || '').trim(),
      settingDetail: String(sc.settingDetail || bp.settingBible || '').trim(),
      costume: String(sc.costume || bp.costumeBible || '').trim(),
      cameraAngle: String(sc.cameraAngle || 'Trung cảnh').trim(),
      cameraMovement: String(sc.cameraMovement || 'Đẩy máy chậm').trim(),
      lighting: String(sc.lighting || 'Ánh sáng điện ảnh tự nhiên').trim(),
      vfxNotes: String(sc.vfxNotes || '').trim(),
      videoTimeline: String(sc.videoTimeline || '').trim(),
      dependsOnSceneIds: prevId && sc.continuityNote ? [prevId] : [],
      continuityAnchorFromSceneId: prevId && sc.continuityNote ? prevId : undefined,
      keyframeImageUrl,
      keyframeArtifactName,
      qaStatus: 'pending',
      retryCount: 0,
      lastModifiedBy: 'studio',
    };
  });
}

function buildStudioDirectiveScriptText(params: {
  title?: string;
  ideaOrCommand?: string;
  blueprint?: Partial<DerivativeBlueprint> | null;
  characterRefs?: StudioCharacterInput[];
  visualBible?: string;
  settingBible?: string;
  costumeBible?: string;
  continuityBible?: string;
}): string {
  const parts: string[] = [];
  const mainIdea = String(params.ideaOrCommand || params.blueprint?.ideaPrompt || '').trim();
  if (mainIdea) parts.push(mainIdea);

  const bp = params.blueprint;
  if (bp?.derivativeTitle && !mainIdea.includes(bp.derivativeTitle)) {
    parts.push(`Tiêu đề kịch bản Studio: ${bp.derivativeTitle}`);
  }
  if (bp?.learnedSummary) {
    parts.push(`Tóm tắt kịch bản:\n${bp.learnedSummary}`);
  }
  if (Array.isArray(params.characterRefs) && params.characterRefs.length > 0) {
    const charLines = params.characterRefs.slice(0, 8).map((c, i) => {
      const sp = c.syncProfile;
      const detail = sp
        ? [sp.face, sp.physique, sp.costume, sp.voice].filter(Boolean).join('; ')
        : c.description || '';
      return `${i + 1}. ${c.name || `Nhân vật ${i + 1}`}${detail ? `: ${detail}` : ''}`;
    });
    parts.push(`Nhân vật đồng bộ (${charLines.length}):\n${charLines.join('\n')}`);
  }
  const vBible = params.visualBible || bp?.visualStyleBible;
  const sBible = params.settingBible || bp?.settingBible;
  const cBible = params.costumeBible || bp?.costumeBible;
  const contBible = params.continuityBible || bp?.continuityBible;
  if (vBible || sBible || cBible || contBible) {
    parts.push(
      [
        vBible ? `- Phong cách hình ảnh: ${vBible}` : '',
        sBible ? `- Bối cảnh: ${sBible}` : '',
        cBible ? `- Trang phục: ${cBible}` : '',
        contBible ? `- Mạch nối cảnh: ${contBible}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  if (bp?.scenes && bp.scenes.length > 0) {
    const sceneLines = bp.scenes.slice(0, 12).map((sc, idx) => {
      const talk = sc.dialogue ? ` | Thoại: "${sc.dialogue}"` : sc.narration ? ` | Dẫn: "${sc.narration}"` : '';
      return `- Cảnh ${sc.sceneIndex || idx + 1} (${sc.durationSec || 6}s) [${sc.sceneTitle || 'Phân cảnh'}]: ${
        sc.actionDetail || sc.sceneSummary || sc.visualNote || ''
      }${talk}`;
    });
    parts.push(`Danh sách ${bp.scenes.length} phân cảnh:\n${sceneLines.join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n').trim();
}

export async function syncStudioDirectiveToCommandCenter(params: {
  sourceAction: StudioSyncedDirective['sourceAction'];
  mode?: 'creative' | 'derivative';
  title?: string;
  ideaOrCommand?: string;
  productionFormat?: StudioProductionFormat;
  aspectRatio?: DerivativeAspectRatio;
  videoStyle?: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  characterRefs?: StudioCharacterInput[];
  visualBible?: string;
  settingBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  blueprint?: Partial<DerivativeBlueprint> | null;
  silent?: boolean;
}): Promise<CommandCenterState> {
  const bp = params.blueprint || null;
  const resolvedAllowFreeCostumeChange =
    typeof params.allowFreeCostumeChange === 'boolean'
      ? params.allowFreeCostumeChange
      : bp?.allowFreeCostumeChange === true;
  const resolvedTitle =
    String(params.title || bp?.derivativeTitle || '').trim() ||
    `Dự án từ Studio (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`;

  const resolvedFormat: StudioProductionFormat =
    (params.productionFormat || bp?.productionFormat) === 'narration_story' ? 'narration_story' : 'dialogue_film';
  const rawAr = params.aspectRatio || bp?.aspectRatio;
  const resolvedAspect: DerivativeAspectRatio = rawAr === '9:16' ? '9:16' : rawAr === '1:1' ? '1:1' : '16:9';
  const resolvedStyle: StudioVideoStyle = params.videoStyle || bp?.videoStyle || 'cinematic';

  const scriptOrCommand = buildStudioDirectiveScriptText({
    title: resolvedTitle,
    ideaOrCommand: params.ideaOrCommand,
    blueprint: bp,
    characterRefs: params.characterRefs,
    visualBible: params.visualBible,
    settingBible: params.settingBible,
    costumeBible: params.costumeBible,
    continuityBible: params.continuityBible,
  });

  if (!scriptOrCommand && (!bp?.scenes || bp.scenes.length === 0)) {
    return getCommandCenterState(false);
  }

  const chars = normalizeStudioCharactersToMemory(
    params.characterRefs || [],
    storeDoc.projectMemory.version,
    params.costumeBible || bp?.costumeBible || ''
  );
  const scenes = normalizeStudioBlueprintScenesToMemory(bp);

  const directive: StudioSyncedDirective = {
    syncedAt: Date.now(),
    sourceAction: params.sourceAction,
    mode: params.mode === 'derivative' || bp?.mode === 'derivative' ? 'derivative' : 'creative',
    title: resolvedTitle,
    scriptOrCommand: scriptOrCommand || resolvedTitle,
    productionFormat: resolvedFormat,
    aspectRatio: resolvedAspect,
    videoStyle: resolvedStyle,
    allowFreeCostumeChange: resolvedAllowFreeCostumeChange,
    visualBible: params.visualBible || bp?.visualStyleBible || '',
    settingBible: params.settingBible || bp?.settingBible || '',
    costumeBible: params.costumeBible || bp?.costumeBible || '',
    continuityBible: params.continuityBible || bp?.continuityBible || '',
    characterCount: chars.length,
    sceneCount: scenes.length,
    hasBlueprint: scenes.length > 0,
  };

  storeDoc.latestStudioDirective = directive;
  storeDoc.latestStudioBlueprint = {
    syncedAt: directive.syncedAt,
    title: resolvedTitle,
    scriptOrCommand: directive.scriptOrCommand,
    productionFormat: resolvedFormat,
    aspectRatio: resolvedAspect,
    videoStyle: resolvedStyle,
    allowFreeCostumeChange: resolvedAllowFreeCostumeChange,
    visualBible: directive.visualBible,
    settingBible: directive.settingBible,
    costumeBible: directive.costumeBible,
    continuityBible: directive.continuityBible,
    characters: chars,
    scenes,
  };

  // If no active run is currently executing in Command Center, hydrate Project Memory immediately so the 5 Muse AIs understand the Studio context
  const hasRunning = storeDoc.runs.some((r) => ['planning', 'producing', 'inspecting', 'assembling'].includes(r.status));
  if (!hasRunning) {
    commitProjectMemoryUpdate('system', `Đồng bộ chỉ thị từ Studio (${params.sourceAction}): ${resolvedTitle}`, (m) => {
      m.title = resolvedTitle;
      m.originalScript = directive.scriptOrCommand;
      m.productionFormat = resolvedFormat;
      m.aspectRatio = resolvedAspect;
      m.videoStyle = resolvedStyle;
      m.allowFreeCostumeChange = resolvedAllowFreeCostumeChange;
      if (directive.visualBible) m.visualBible = directive.visualBible;
      if (directive.settingBible) m.settingBible = directive.settingBible;
      if (directive.costumeBible) m.costumeBible = directive.costumeBible;
      if (directive.continuityBible) m.continuityBible = directive.continuityBible;
      if (chars.length > 0) m.characters = chars;
      if (scenes.length > 0) m.scenes = scenes;
    });
  }

  if (!params.silent) {
    const actionLabelMap: Record<StudioSyncedDirective['sourceAction'], string> = {
      expand_idea: 'Triển khai ý tưởng từ Studio',
      learn_script: 'Lên kịch bản từ Studio',
      save_project: 'Lưu dự án Studio',
      generate_video: 'Khởi tạo dựng video từ Studio',
      manual_dispatch: 'Đồng bộ thủ công từ Studio',
    };
    const lastMsg = storeDoc.conversations[storeDoc.conversations.length - 1];
    const summaryText = `Chỉ thị từ Studio [${actionLabelMap[params.sourceAction]}]: "${resolvedTitle}" (${chars.length} nhân vật, ${scenes.length} phân cảnh · ${resolvedAspect}). Đã nạp sẵn vào Trung tâm giao nhiệm vụ tổng & Project Memory để đội 5 Muse AI tiếp nhận.`;
    if (!lastMsg || lastMsg.content !== summaryText) {
      appendConversationMessage({
        channel: 'commander',
        projectId: storeDoc.projectMemory.projectId,
        senderType: 'system',
        senderId: 'studio_sync',
        senderName: `Đồng bộ Studio → ${storeDoc.agents[0]?.name || 'Muse Director'}`,
        targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
        messageKind: 'ack',
        content: summaryText,
      });
    }
    addActivityLog('info', 'Đồng bộ chỉ thị từ Studio', `${actionLabelMap[params.sourceAction]}: "${resolvedTitle}" (${scenes.length} cảnh, ${chars.length} nhân vật).`, {
      agentId: 'muse-01',
    });
  }

  saveStateAtomic();
  emitCommandCenterEvent('state:sync', await getCommandCenterState(false));
  return getCommandCenterState(false);
}

export async function selectProductionRun(runId: string): Promise<CommandCenterState> {
  const run = storeDoc.runs.find((r) => r.id === runId);
  if (!run) throw new Error('Không tìm thấy phiên sản xuất được chọn.');
  storeDoc.selectedRunId = run.id;
  storeDoc.projectMemory = getRunMemory(run.id);
  saveStateAtomic();
  emitCommandCenterEvent('run:updated', enrichProductionRun(run));
  return getCommandCenterState(false);
}

export async function createEmptyProductionSession(title?: string): Promise<CommandCenterState> {
  const runId = `run_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const resolvedTitle =
    String(title || '').trim() ||
    `Phiên sản xuất #${storeDoc.runs.length + 1} (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`;
  const freshMem = createEmptyProjectMemory();
  freshMem.title = resolvedTitle;
  const now = Date.now();
  const run: ProductionRun = {
    id: runId,
    projectId: freshMem.projectId,
    title: resolvedTitle,
    userCommand: '',
    status: 'idle',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    sceneCount: 0,
    completedScenes: 0,
    passedQaScenes: 0,
    escalatedScenes: 0,
  };
  storeDoc.sessionMemories[runId] = freshMem;
  storeDoc.runs.unshift(run);
  if (storeDoc.runs.length > 25) storeDoc.runs = storeDoc.runs.slice(0, 25);
  storeDoc.selectedRunId = runId;
  storeDoc.projectMemory = freshMem;

  appendConversationMessage({
    channel: 'production',
    projectId: freshMem.projectId,
    runId,
    senderType: 'system',
    senderId: 'system',
    senderName: 'Phòng Điều Hành',
    messageKind: 'ack',
    content: `Đã khởi tạo phiên sản xuất mới "${resolvedTitle}". Sẵn sàng nhận kịch bản hoặc phân cảnh từ Studio.`,
  });
  addActivityLog('info', 'Tạo phiên sản xuất mới', resolvedTitle, { runId });
  saveStateAtomic();
  emitCommandCenterEvent('run:updated', enrichProductionRun(run));
  return getCommandCenterState(false);
}

export async function startProductionOrchestration(params: {
  runId?: string;
  title?: string;
  script: string;
  productionFormat?: StudioProductionFormat;
  aspectRatio?: DerivativeAspectRatio;
  videoStyle?: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  studioBlueprint?: Partial<DerivativeBlueprint> | null;
  characterRefs?: StudioCharacterInput[];
  visualBible?: string;
  settingBible?: string;
  costumeBible?: string;
  continuityBible?: string;
}): Promise<CommandCenterState> {
  const cachedBp = storeDoc.latestStudioBlueprint;
  const resolvedAllowFreeCostumeChange =
    typeof params.allowFreeCostumeChange === 'boolean'
      ? params.allowFreeCostumeChange
      : typeof params.studioBlueprint?.allowFreeCostumeChange === 'boolean'
      ? params.studioBlueprint.allowFreeCostumeChange
      : cachedBp?.allowFreeCostumeChange === true;
  const script = String(params.script || cachedBp?.scriptOrCommand || '').trim();
  if (!script && !params.studioBlueprint?.scenes?.length) {
    throw new Error('Vui lòng nhập kịch bản hoặc câu lệnh sản xuất trước khi bắt đầu.');
  }

  if (storeDoc.projectMemory.scenes.length > 0 || storeDoc.projectMemory.originalScript) {
    createBackupSnapshot('pre_restore', `Sao lưu trước phiên sản xuất mới (${storeDoc.projectMemory.title})`);
  }

  const targetExisting = params.runId ? storeDoc.runs.find((r) => r.id === params.runId && r.status === 'idle') : undefined;
  const runId = targetExisting ? targetExisting.id : `run_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const title =
    (params.title || targetExisting?.title || params.studioBlueprint?.derivativeTitle || '').trim() ||
    `Phim AI ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

  const freshMemory = targetExisting ? getRunMemory(runId) : createEmptyProjectMemory();
  freshMemory.title = title;
  freshMemory.originalScript = script || title;
  freshMemory.productionFormat = params.productionFormat === 'narration_story' ? 'narration_story' : 'dialogue_film';
  freshMemory.aspectRatio =
    params.aspectRatio === '9:16' ? '9:16' : params.aspectRatio === '1:1' ? '1:1' : '16:9';
  freshMemory.videoStyle = params.videoStyle || params.studioBlueprint?.videoStyle || 'cinematic';
  freshMemory.allowFreeCostumeChange = resolvedAllowFreeCostumeChange;
  freshMemory.visualBible = String(params.visualBible || params.studioBlueprint?.visualStyleBible || '').trim();
  freshMemory.settingBible = String(params.settingBible || params.studioBlueprint?.settingBible || '').trim();
  freshMemory.costumeBible = String(params.costumeBible || params.studioBlueprint?.costumeBible || '').trim();
  freshMemory.continuityBible = String(params.continuityBible || params.studioBlueprint?.continuityBible || '').trim();
  freshMemory.updatedByAgentId = 'user';

  let preSeededChars: CommandMemoryCharacter[] = normalizeStudioCharactersToMemory(
    params.characterRefs || [],
    1,
    freshMemory.costumeBible
  );
  let preSeededScenes: CommandMemoryScene[] = normalizeStudioBlueprintScenesToMemory(params.studioBlueprint);

  if (
    preSeededScenes.length === 0 &&
    cachedBp &&
    cachedBp.scenes &&
    cachedBp.scenes.length > 0 &&
    script.slice(0, 120) === cachedBp.scriptOrCommand.slice(0, 120)
  ) {
    preSeededScenes = structuredClone(cachedBp.scenes);
    if (preSeededChars.length === 0 && cachedBp.characters) {
      preSeededChars = structuredClone(cachedBp.characters);
    }
    if (!freshMemory.visualBible && cachedBp.visualBible) freshMemory.visualBible = cachedBp.visualBible;
    if (!freshMemory.settingBible && cachedBp.settingBible) freshMemory.settingBible = cachedBp.settingBible;
    if (!freshMemory.costumeBible && cachedBp.costumeBible) freshMemory.costumeBible = cachedBp.costumeBible;
    if (!freshMemory.continuityBible && cachedBp.continuityBible) freshMemory.continuityBible = cachedBp.continuityBible;
  }

  freshMemory.characters = preSeededChars;
  freshMemory.scenes = preSeededScenes;
  storeDoc.sessionMemories[runId] = freshMemory;
  storeDoc.selectedRunId = runId;
  storeDoc.projectMemory = freshMemory;

  const hasPreSeededScenes = preSeededScenes.length > 0;
  const now = Date.now();
  let run: ProductionRun;
  if (targetExisting) {
    targetExisting.title = title;
    targetExisting.userCommand = script || title;
    targetExisting.status = hasPreSeededScenes ? 'producing' : 'planning';
    targetExisting.startedAt = now;
    targetExisting.updatedAt = now;
    targetExisting.sceneCount = preSeededScenes.length;
    targetExisting.completedScenes = 0;
    targetExisting.passedQaScenes = 0;
    targetExisting.escalatedScenes = 0;
    run = targetExisting;
  } else {
    run = {
      id: runId,
      projectId: freshMemory.projectId,
      title,
      userCommand: script || title,
      status: hasPreSeededScenes ? 'producing' : 'planning',
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      sceneCount: preSeededScenes.length,
      completedScenes: 0,
      passedQaScenes: 0,
      escalatedScenes: 0,
    };
    storeDoc.runs.unshift(run);
    if (storeDoc.runs.length > 25) storeDoc.runs = storeDoc.runs.slice(0, 25);
  }

  appendConversationMessage({
    channel: 'commander',
    projectId: freshMemory.projectId,
    runId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Đạo diễn (Bạn)',
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    content: script || title,
  });

  if (hasPreSeededScenes) {
    // Bypass redundant re-scripting: Muse AI 01 locks the Studio Blueprint & dispatches parallel production immediately!
    const planTask = enqueueTask({
      runId,
      type: 'plan_production',
      title: `Tổng đạo diễn tiếp nhận kịch bản Studio (${preSeededScenes.length} phân cảnh)`,
      instructions: script || title,
      assignedAgentId: 'muse-01',
      priority: 10,
    });
    planTask.status = 'completed';
    planTask.completedAt = Date.now();
    planTask.executedByProvider = 'studio-blueprint';
    planTask.outputText = `Đã tiếp nhận kịch bản hoàn chỉnh từ Studio (${preSeededChars.length} nhân vật, ${preSeededScenes.length} phân cảnh) và lập hàng đợi song song.`;

    preSeededChars.forEach(ensureCharacterOriginalAnchors);

    const charTaskIds: string[] = [];
    const charQaDeps: string[] = [];
    for (const ch of preSeededChars.slice(0, 4)) {
      if (!ch.artifactUrl) {
        const ct = enqueueTask({
          runId,
          type: 'design_character_ref',
          title: `Tạo ảnh tham chiếu nhân vật: ${ch.name}`,
          instructions: `${ch.name}: ${ch.syncProfile.face}. Vóc dáng: ${ch.syncProfile.physique}. Trang phục: ${ch.syncProfile.costume}.`,
          assignedAgentId: 'muse-03',
          characterId: ch.id,
          priority: 9,
        });
        charTaskIds.push(ct.id);
        if (!resolvedAllowFreeCostumeChange) {
          const cqa = enqueueTask({
            runId,
            type: 'qa_inspect_image',
            title: `Kiểm tra trang phục ảnh nhân vật: ${ch.name}`,
            instructions: `Đối chiếu ảnh nhân vật ${ch.name} với hồ sơ gốc "${getCharacterCanonicalCostume(ch)}" trước khi tạo keyframe.`,
            assignedAgentId: 'muse-05',
            dependsOnTaskIds: [ct.id],
            characterId: ch.id,
            priority: 9,
          });
          charQaDeps.push(cqa.id);
        }
      }
    }

    const sceneVideoTaskBySceneId = new Map<string, string>();
    const qaTaskIds: string[] = [];
    const sceneImgDeps = !resolvedAllowFreeCostumeChange && charQaDeps.length > 0 ? charQaDeps : charTaskIds;

    for (const sc of preSeededScenes) {
      const videoDeps: string[] = [];
      let imgReadyDep: string | undefined;
      if (!sc.keyframeImageUrl) {
        const imgTask = enqueueTask({
          runId,
          type: 'design_scene_image',
          title: `Cảnh ${sc.index}: Tạo ảnh keyframe "${sc.title}"`,
          instructions: `${sc.actionDetail}. Bối cảnh: ${sc.settingDetail}. Góc máy: ${sc.cameraAngle}. Ánh sáng: ${sc.lighting}.`,
          assignedAgentId: 'muse-03',
          dependsOnTaskIds: sceneImgDeps,
          sceneId: sc.sceneId,
          sceneIndex: sc.index,
          priority: 8,
        });
        imgReadyDep = imgTask.id;
      } else if (sceneImgDeps.length > 0) {
        videoDeps.push(...sceneImgDeps);
      }

      if (!resolvedAllowFreeCostumeChange && (imgReadyDep || sc.keyframeImageUrl)) {
        const imgQa = enqueueTask({
          runId,
          type: 'qa_inspect_image',
          title: `Kiểm tra trang phục ảnh Cảnh ${sc.index}: "${sc.title}"`,
          instructions: `Kiểm tra trang phục trên ảnh keyframe Cảnh ${sc.index} so với ảnh tham chiếu & hồ sơ gốc trước khi dựng video.`,
          assignedAgentId: 'muse-05',
          dependsOnTaskIds: imgReadyDep ? [imgReadyDep] : sceneImgDeps,
          sceneId: sc.sceneId,
          sceneIndex: sc.index,
          priority: 8,
        });
        videoDeps.push(imgQa.id);
      } else if (imgReadyDep) {
        videoDeps.push(imgReadyDep);
      }

      if (sc.continuityAnchorFromSceneId && sceneVideoTaskBySceneId.has(sc.continuityAnchorFromSceneId)) {
        videoDeps.push(sceneVideoTaskBySceneId.get(sc.continuityAnchorFromSceneId)!);
      }

      const vidTask = enqueueTask({
        runId,
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
        runId,
        type: 'qa_inspect_scene',
        title: `Kiểm định 8 tiêu chí Cảnh ${sc.index}: "${sc.title}"`,
        instructions: `Đối chiếu Cảnh ${sc.index} với Project Memory v${freshMemory.version} và các cảnh lân cận.`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [vidTask.id],
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 5,
      });
      qaTaskIds.push(qaTask.id);
    }

    enqueueTask({
      runId,
      type: 'assemble_final_film',
      title: `Ghép xuất phim hoàn chỉnh (${preSeededScenes.length} phân cảnh)`,
      instructions: `Tổng hợp toàn bộ phân cảnh đã đạt QA thành video MP4 hoàn chỉnh và bàn giao.`,
      assignedAgentId: 'muse-01',
      dependsOnTaskIds: qaTaskIds,
      priority: 1,
    });

    appendConversationMessage({
      channel: 'commander',
      projectId: freshMemory.projectId,
      runId,
      senderType: 'agent',
      senderId: 'muse-01',
      senderName: `${storeDoc.agents[0]?.name || 'Muse Director'} (${storeDoc.agents[0]?.roleTitle || 'Tổng đạo diễn'})`,
      targetAgentIds: ['muse-02', 'muse-03', 'muse-04', 'muse-05'],
      taskId: planTask.id,
      messageKind: 'ack',
      content: `Đã tiếp nhận kịch bản & phân cảnh đồng bộ từ Studio cho "${title}" (${preSeededChars.length} nhân vật, ${preSeededScenes.length} phân cảnh). Đã khóa Project Memory v${freshMemory.version} và phân công song song cho đội 5 Muse AI.`,
    });

    postAiBusMessage({
      fromAgent: storeDoc.agents[0],
      toAgentIds: ['muse-03', 'muse-04', 'muse-05'],
      runId,
      projectId: freshMemory.projectId,
      taskId: planTask.id,
      content: `[STUDIO-BLUEPRINT] Khởi chạy song song ${preSeededScenes.length} phân cảnh của "${title}".`,
    });

    addActivityLog(
      'info',
      'Tiếp nhận kịch bản từ Studio',
      `${storeDoc.agents[0]?.name || 'Muse Director'} đã phân công ${preSeededScenes.length} phân cảnh của "${title}" vào dây chuyền sản xuất song song.`,
      { agentId: 'muse-01', runId }
    );
  } else {
    enqueueTask({
      runId,
      type: 'plan_production',
      title: `Tổng đạo diễn lập kế hoạch & phân công sản xuất: ${title}`,
      instructions: script,
      assignedAgentId: 'muse-01',
      priority: 10,
    });

    addActivityLog('info', 'Khởi động dây chuyền sản xuất', `Phiên "${title}" đã được giao cho ${storeDoc.agents[0]?.name || 'Muse Director'}.`, {
      agentId: 'muse-01',
      runId,
    });
  }

  saveStateAtomic();
  emitCommandCenterEvent('run:updated', enrichProductionRun(run));
  void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function controlProductionRun(
  runId: string,
  action: 'pause' | 'resume' | 'cancel'
): Promise<CommandCenterState> {
  const run = storeDoc.runs.find((r) => r.id === runId);
  if (!run) throw new Error('Không tìm thấy phiên sản xuất.');
  const mem = getRunMemory(runId);

  if (action === 'pause') {
    run.status = 'paused';
    run.pausedAt = Date.now();
    appendConversationMessage({
      channel: 'production',
      projectId: mem.projectId,
      runId,
      senderType: 'system',
      senderId: 'system',
      senderName: 'Điều khiển phiên',
      messageKind: 'alert',
      content: `Phiên "${run.title}" đã TẠM DỪNG tại điểm an toàn. Ngưng cấp tác vụ mới và bảo toàn trạng thái hiện tại để tiếp tục sau.`,
    });
  } else if (action === 'resume') {
    run.status = storeDoc.tasks.some((t) => t.runId === runId && t.type === 'plan_production' && t.status !== 'completed')
      ? 'planning'
      : 'producing';
    run.pausedAt = undefined;
    run.error = undefined;
    appendConversationMessage({
      channel: 'production',
      projectId: mem.projectId,
      runId,
      senderType: 'system',
      senderId: 'system',
      senderName: 'Điều khiển phiên',
      messageKind: 'ack',
      content: `Phiên "${run.title}" đã TIẾP TỤC chạy các tác vụ chưa hoàn thành (giữ nguyên toàn bộ kết quả đã xong).`,
    });
  } else if (action === 'cancel') {
    run.status = 'cancelled';
    run.cancelledAt = Date.now();
    run.error = 'Phiên sản xuất đã bị hủy theo yêu cầu người dùng. Dữ liệu đã hoàn thành & backup vẫn được bảo toàn.';
    for (const t of storeDoc.tasks) {
      if (t.runId === runId && ['queued', 'blocked_by_deps'].includes(t.status)) {
        t.status = 'cancelled';
      }
    }
    createBackupSnapshot('pre_restore', `Bảo lưu trước khi hủy phiên "${run.title}"`, runId);
    appendConversationMessage({
      channel: 'production',
      projectId: mem.projectId,
      runId,
      senderType: 'system',
      senderId: 'system',
      senderName: 'Điều khiển phiên',
      messageKind: 'alert',
      content: `Phiên "${run.title}" đã HỦY. Mọi cảnh hoàn thành và bản backup của phiên vẫn được giữ nguyên trong lịch sử.`,
    });
  }
  run.updatedAt = Date.now();
  addActivityLog('info', `Điều khiển phiên ${action}`, `Phiên "${run.title}" chuyển sang trạng thái ${run.status}.`, {
    runId,
  });
  saveStateAtomic();
  emitCommandCenterEvent('run:updated', enrichProductionRun(run));
  if (action === 'resume') void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function createManualTask(params: {
  assignedAgentId: MuseAgentId;
  title: string;
  instructions: string;
  type?: CommandTaskType;
  sceneId?: string;
  runId?: string;
}): Promise<CommandCenterState> {
  const agent = storeDoc.agents.find((a) => a.id === params.assignedAgentId);
  if (!agent) throw new Error('Không tìm thấy Muse AI được chọn.');
  const runId = params.runId || getEffectiveSelectedRunId() || 'manual_run';
  const mem = getRunMemory(runId);
  const sc = params.sceneId ? mem.scenes.find((s) => s.sceneId === params.sceneId) : undefined;

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
    projectId: mem.projectId,
    runId,
    sceneId: sc?.sceneId,
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
    task.acknowledgedAt = Date.now();
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
  emitCommandCenterEvent('task:updated', task);
  if (action !== 'cancel') void tickOrchestratorQueue();
  return getCommandCenterState(false);
}

export async function resolveSceneQaManual(
  sceneId: string,
  action: 'approve' | 'reject',
  instruction?: string,
  explicitRunId?: string
): Promise<CommandCenterState> {
  const runId = explicitRunId || getEffectiveSelectedRunId() || 'manual_run';
  const mem = getRunMemory(runId);
  const sc = mem.scenes.find((s) => s.sceneId === sceneId);
  if (!sc) throw new Error('Không tìm thấy phân cảnh.');

  if (action === 'approve') {
    commitSessionMemoryUpdate(runId, 'user', `Người dùng duyệt thủ công Cảnh ${sc.index}`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sceneId);
      if (target) {
        target.qaStatus = 'passed';
        target.qaScore = target.qaScore || 85;
      }
    });
    const run = storeDoc.runs.find((r) => r.id === runId);
    if (run) {
      run.passedQaScenes = getRunMemory(runId).scenes.filter((s) => s.qaStatus === 'passed').length;
      run.escalatedScenes = getRunMemory(runId).scenes.filter((s) => s.qaStatus === 'escalated').length;
      if (run.escalatedScenes === 0 && run.status === 'needs_attention') {
        run.status = 'producing';
        run.error = undefined;
      }
    }
    const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];
    for (const t of storeDoc.tasks) {
      if (t.runId === runId && t.sceneId === sceneId && t.status === 'qa_rejected') {
        t.status = 'completed';
      }
    }
    const openInc = storeDoc.incidents.find(
      (i) => i.runId === runId && i.sceneId === sceneId && !['resolved', 'escalated_to_user'].includes(i.status)
    );
    if (openInc) {
      resolveIncidentRecord(openInc, qaAgent, `Người dùng đã duyệt thủ công Cảnh ${sc.index} "${sc.title}".`);
    }
    const allPassed = getRunMemory(runId).scenes.every((s) => s.qaStatus === 'passed');
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
          title: `Ghép xuất phim hoàn chỉnh (${mem.scenes.length} cảnh)`,
          instructions: 'Tổng hợp toàn bộ phân cảnh đã duyệt thành video MP4 hoàn chỉnh.',
          assignedAgentId: 'muse-01',
          priority: 1,
        });
      }
    }
  } else {
    const fixText = (instruction || '').trim() || 'Tạo lại phân cảnh này cho khớp gương mặt nhân vật, trang phục và hành động kịch bản.';
    commitSessionMemoryUpdate(runId, 'user', `Người dùng yêu cầu tạo lại Cảnh ${sc.index}`, (m) => {
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

export async function uploadCommandCenterAttachment(params: {
  dataUrl: string;
  filename?: string;
}): Promise<{ url: string; fileName: string }> {
  const raw = String(params.dataUrl || '');
  if (!raw.startsWith('data:')) {
    throw new Error('Định dạng tệp đính kèm không hợp lệ.');
  }
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Không đọc được nội dung base64 của tệp.');
  const mime = m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  let ext = '.bin';
  if (mime.includes('png')) ext = '.png';
  else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
  else if (mime.includes('webp')) ext = '.webp';
  else if (mime.includes('mp4')) ext = '.mp4';
  else if (mime.includes('text') || mime.includes('json')) ext = '.txt';
  else if (params.filename && path.extname(params.filename)) ext = path.extname(params.filename);

  const saved = saveArtifactBuffer('chat_att', ext, buf);
  return { url: saved.url, fileName: saved.fileName };
}

const DEFAULT_AGENT_BY_CHANNEL: Record<string, MuseAgentId> = {
  commander: 'muse-01',
  incident: 'muse-01',
  production: 'muse-01',
  script: 'muse-02',
  visual: 'muse-03',
  video: 'muse-04',
  qa: 'muse-05',
  ai_bus: 'muse-01',
};

export async function sendCommandCenterChat(params: {
  channel: CommunicationChannelId | 'group';
  message: string;
  targetAgentId?: MuseAgentId;
  attachments?: string[];
  sceneId?: string;
  sessionId?: string;
}): Promise<{ state: CommandCenterState; reply?: ConversationMessage }> {
  const text = String(params.message || '').trim();
  const attachments = Array.isArray(params.attachments) ? params.attachments.filter(Boolean).slice(0, 6) : [];
  if (!text && attachments.length === 0) throw new Error('Vui lòng nhập nội dung tin nhắn hoặc chọn tệp đính kèm.');

  const channel = mapLegacyChannel(params.channel);
  const runId = params.sessionId || getEffectiveSelectedRunId() || undefined;
  const mem = getRunMemory(runId);

  const isDm = channel.startsWith('muse-');
  const responderId: MuseAgentId = isDm
    ? (channel as MuseAgentId)
    : params.targetAgentId || DEFAULT_AGENT_BY_CHANNEL[channel] || 'muse-01';
  const responder = storeDoc.agents.find((a) => a.id === responderId) || storeDoc.agents[0];

  appendConversationMessage({
    channel,
    projectId: mem.projectId,
    runId,
    sessionId: runId,
    sceneId: params.sceneId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Đạo diễn (Bạn)',
    targetAgentIds: isDm ? [channel as MuseAgentId] : ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    attachments,
    content: text || '(Đã gửi tệp đính kèm)',
  });

  const recentHistory = storeDoc.conversations
    .filter((m) => m.channel === channel)
    .slice(-8)
    .map((m) => `${m.senderName}: ${m.content}`)
    .join('\n');

  const studioDirectiveNote = storeDoc.latestStudioDirective
    ? `\nChỉ thị mới nhất đồng bộ từ Studio (${storeDoc.latestStudioDirective.sourceAction}): "${storeDoc.latestStudioDirective.title}" · ${storeDoc.latestStudioDirective.characterCount} nhân vật, ${storeDoc.latestStudioDirective.sceneCount} phân cảnh.\nNội dung chỉ thị Studio:\n${storeDoc.latestStudioDirective.scriptOrCommand.slice(0, 1400)}`
    : '';
  const memoryScenesNote =
    mem.scenes.length > 0
      ? `\nCác phân cảnh trong Project Memory:\n${mem.scenes
          .slice(0, 8)
          .map((s) => `- Cảnh ${s.index}: ${s.title} (${s.qaStatus}) — ${s.actionDetail.slice(0, 100)}`)
          .join('\n')}`
      : '';

  const channelContextDesc: Record<string, string> = {
    commander: 'Kênh #tổng-chỉ-huy (lệnh điều hành toàn đội 5 Muse AI)',
    incident: 'Kênh #incident-command (Trung tâm chỉ huy xử lý sự cố — Đạo diễn tổng trực tiếp điều tra nguyên nhân và ra lệnh sửa lỗi)',
    production: 'Kênh #sản-xuất-phim (theo dõi tiến độ và điều phối phiên)',
    script: 'Kênh #kịch-bản (biên kịch, thoại, nhân vật, timeline)',
    visual: 'Kênh #hình-ảnh (thiết kế nhân vật, tạo ảnh keyframe)',
    video: 'Kênh #video (dựng video phân cảnh, prompt chuyển động)',
    qa: 'Kênh #kiểm-duyệt (báo cáo lỗi, kiểm định chất lượng)',
    ai_bus: 'Kênh #trao-đổi-ai (phối hợp trực tiếp giữa các AI)',
  };

  const openIncidentsNote =
    channel === 'incident'
      ? (() => {
          const openList = storeDoc.incidents.filter((i) => i.status !== 'resolved').slice(0, 6);
          return openList.length > 0
            ? `\nCác sự cố đang mở (${openList.length}):\n${openList
                .map((i) => `- [${i.code}] (${i.status}, vòng ${i.attemptCount}/${i.maxAttempts}) ${i.categoryLabel}: ${i.errorDescription.slice(0, 120)}`)
                .join('\n')}`
            : '\nHiện không có sự cố tồn đọng.';
        })()
      : '';

  const sys = `Bạn là ${responder.name} (${responder.roleTitle}) trong Phòng Điều Hành AI Muse.
Vai trò: ${responder.description}
Dự án/Phiên hiện tại: "${mem.title}" (Project Memory v${mem.version}, ${mem.characters.length} nhân vật, ${mem.scenes.length} cảnh).${studioDirectiveNote}${memoryScenesNote}${openIncidentsNote}
${
  isDm
    ? 'Bạn đang trao đổi riêng 1-1 với Đạo diễn. Hãy trả lời bám sát dữ liệu dự án hiện tại.'
    : `Bạn đang phản hồi trong ${channelContextDesc[channel] || channel}. Hãy trả lời ngắn gọn, bám sát đúng chuyên môn kênh và dữ liệu thực tế của phiên.`
}`;

  const inlineImageAttachments = attachments
    .map((att) => (att.startsWith('data:image/') ? att : artifactUrlToDataUrl(att)))
    .filter((x): x is string => Boolean(x && x.startsWith('data:image/')));

  const startedAt = Date.now();
  const inf = await runAgentTextInference({
    agent: responder,
    systemPrompt: sys,
    userPrompt: `Lịch sử kênh gần đây:\n${recentHistory}\n\nYêu cầu mới nhất của Đạo diễn:\n${text || 'Xem tệp đính kèm và phản hồi.'}`,
    attachments: inlineImageAttachments,
  });
  const respMs = Math.max(1, Date.now() - startedAt);
  recordAgentSample(responder.id, respMs, 5);

  responder.lastActiveAt = Date.now();
  const reply = appendConversationMessage({
    channel,
    projectId: mem.projectId,
    runId,
    sessionId: runId,
    sceneId: params.sceneId,
    senderType: 'agent',
    senderId: responder.id,
    senderName: `${responder.name} (${responder.roleTitle})`,
    promptDelivered: text,
    content: inf.text,
  });

  addActivityLog('info', `Chat #${channel}`, `${responder.name} phản hồi trong ${respMs}ms qua ${inf.provider}.`, {
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
    m.allowFreeCostumeChange = snap.data.allowFreeCostumeChange === true;
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

export async function reportCommandCenterIncident(params: {
  runId?: string;
  sceneId?: string;
  taskId?: string;
  reporterAgentId?: MuseAgentId;
  responsibleAgentId?: MuseAgentId;
  category?: IncidentCategory;
  errorDescription: string;
  suspectedRootCause?: string;
  initialProposal?: string;
  severity?: IncidentSeverity;
  requiresUserApproval?: boolean;
}): Promise<{ state: CommandCenterState; incident: IncidentRecord }> {
  const errDesc = String(params.errorDescription || '').trim();
  if (!errDesc) {
    throw new Error('Vui lòng nhập mô tả lỗi để báo cáo cho Muse AI 01.');
  }
  const runId = params.runId || getEffectiveSelectedRunId() || 'manual_run';
  const mem = getRunMemory(runId);
  const sc = params.sceneId ? mem.scenes.find((s) => s.sceneId === params.sceneId) : undefined;
  const task = params.taskId ? storeDoc.tasks.find((t) => t.id === params.taskId) : undefined;

  const res = await openOrAdvanceDirectorIncident({
    runId,
    task,
    scene: sc,
    reporterAgentId: params.reporterAgentId || 'muse-04',
    responsibleAgentId: params.responsibleAgentId,
    explicitCategory: params.category,
    errorDescription: errDesc,
    suspectedRootCause: params.suspectedRootCause,
    initialProposal: params.initialProposal,
    severity: params.severity,
    requiresUserApproval: params.requiresUserApproval,
  });

  return {
    state: await getCommandCenterState(false),
    incident: res.incident,
  };
}

export async function commandIncidentAction(params: {
  incidentId: string;
  action: 'directive' | 'reopen' | 'escalate' | 'resolve';
  message?: string;
  targetAgentId?: MuseAgentId;
}): Promise<CommandCenterState> {
  const inc = storeDoc.incidents.find((i) => i.id === params.incidentId);
  if (!inc) throw new Error('Không tìm thấy hồ sơ sự cố.');

  const director = storeDoc.agents.find((a) => a.id === 'muse-01') || storeDoc.agents[0];
  const msg = String(params.message || '').trim();

  if (params.action === 'resolve') {
    const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];
    if (inc.sceneId) {
      commitSessionMemoryUpdate(inc.runId, 'user', `Nghiệm thu & đóng sự cố ${inc.code}`, (m) => {
        const sc = m.scenes.find((s) => s.sceneId === inc.sceneId);
        if (sc) sc.qaStatus = 'passed';
      });
    }
    resolveIncidentRecord(
      inc,
      qaAgent,
      msg || `Đạo diễn / người dùng xác nhận nghiệm thu hoàn tất và đóng sự cố ${inc.code}.`
    );
  } else if (params.action === 'escalate') {
    inc.status = 'escalated_to_user';
    inc.withinAutonomyScope = false;
    inc.escalationReason = msg || 'Được đánh dấu cần sự can thiệp trực tiếp của người dùng.';
    appendIncidentTurn(inc, {
      actorId: director.id,
      actorName: `${director.name} (Đạo diễn tổng)`,
      roleBadge: 'Cần người dùng',
      kind: 'escalation',
      content: inc.escalationReason,
    });
    postIncidentChannelMessage({
      inc,
      senderId: director.id,
      senderName: `${director.name} – Báo cáo khẩn`,
      roleBadge: 'Cần can thiệp',
      content: inc.escalationReason,
    });
  } else {
    // 'directive' or 'reopen': reset attempt budget if escalated and let Muse AI 01 execute a new remediation round
    if (inc.status === 'escalated_to_user' || params.action === 'reopen') {
      inc.attemptCount = Math.max(0, inc.maxAttempts - 1);
      inc.status = 'remediating';
      inc.escalationReason = undefined;
    }
    const mem = getRunMemory(inc.runId);
    const sc = inc.sceneId ? mem.scenes.find((s) => s.sceneId === inc.sceneId) : undefined;
    const task = inc.taskId ? storeDoc.tasks.find((t) => t.id === inc.taskId) : undefined;
    if (msg) {
      appendIncidentTurn(inc, {
        actorId: 'user',
        actorName: 'Đạo diễn (Bạn)',
        roleBadge: 'Chỉ đạo bổ sung',
        kind: 'directive',
        content: msg,
      });
      postIncidentChannelMessage({
        inc,
        senderId: 'user',
        senderName: 'Đạo diễn (Bạn)',
        roleBadge: 'Chỉ đạo',
        targetAgentIds: ['muse-01', params.targetAgentId || inc.assignedFixAgentId],
        content: msg,
      });
    }
    await openOrAdvanceDirectorIncident({
      incidentId: inc.id,
      runId: inc.runId,
      task,
      scene: sc,
      reporterAgentId: 'muse-01',
      responsibleAgentId: params.targetAgentId || inc.assignedFixAgentId,
      explicitCategory: inc.category,
      errorDescription: msg || inc.errorDescription,
      suspectedRootCause: inc.analyzedRootCause || inc.suspectedRootCause,
      initialProposal: msg || inc.directorCommand || inc.initialProposal,
      severity: inc.severity,
    });
  }

  saveStateAtomic();
  emitCommandCenterEvent('incident:updated', inc);
  return getCommandCenterState(false);
}

export async function updateCloudConfig(patch: {
  muse2ApiBaseUrl?: string;
  muse2ApiKey?: string;
  clearCustomKey?: boolean;
  parallelLimit?: number;
  qaPassThreshold?: number;
  maxRetriesPerScene?: number;
  maxIncidentRetries?: number;
  autoDirectorIncidentResponse?: boolean;
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
  if (typeof patch.maxIncidentRetries === 'number') {
    storeDoc.cloudConfig.maxIncidentRetries = Math.max(1, Math.min(5, Math.round(patch.maxIncidentRetries)));
  }
  if (typeof patch.autoDirectorIncidentResponse === 'boolean') {
    storeDoc.cloudConfig.autoDirectorIncidentResponse = patch.autoDirectorIncidentResponse;
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
    `Muse2API: ${storeDoc.cloudConfig.muse2ApiBaseUrl || 'mặc định'} · Song song: ${storeDoc.cloudConfig.parallelLimit} · Ngưỡng QA: ${storeDoc.cloudConfig.qaPassThreshold} · Vòng sự cố tối đa: ${storeDoc.cloudConfig.maxIncidentRetries ?? 3}`
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
