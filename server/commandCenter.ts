import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { Type } from '@google/genai';
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
  ALLOWED_ACCESSORIES_LIST_VI,
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
  ChairmanActionType,
  ChairmanBriefing,
  ChairmanConfig,
  ChairmanPlanOption,
  ChairmanScenePatch,
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
  IncidentTechnicalDiagnosis,
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
  ProjectCoordinationEntry,
  ProjectMemory,
  ProjectMemorySnapshot,
  QaCharacterConsistencyMetrics,
  QaCriterionId,
  QaCriterionResult,
  QaDeviationClass,
  QaInspectionReport,
  QaVerdictStatus,
  SceneProductionStage,
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
  chairmanConfig: ChairmanConfig;
  chairmanBriefings: ChairmanBriefing[];
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

const PRODUCTION_AGENT_IDS: MuseAgentId[] = ['muse-01', 'muse-02', 'muse-03', 'muse-04'];

const DEFAULT_AGENTS: MuseAgentConfig[] = [
  {
    id: 'muse-01',
    code: 'Muse AI 01',
    name: 'Muse Director',
    role: 'production_media',
    roleTitle: 'Nhân viên Sản xuất Hình ảnh & Video',
    description:
      'Nhân viên chuyên môn thuộc bộ phận sản xuất hình ảnh & video dưới quyền chỉ huy của Gemini AI: tiếp nhận phân cảnh, phân tích yêu cầu hình ảnh/video, tạo & chỉnh sửa ảnh, dựng video tuân thủ khóa nhân vật và báo cáo tiến độ về Gemini AI.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'director_clapboard',
    accentColor: '#7C3AED',
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: false,
      canExecuteMedia: true,
      allowedDataScopes: ['project_memory:read', 'artifacts:write_image', 'artifacts:write_video', 'chat:image', 'chat:video', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-02',
    code: 'Muse AI 02',
    name: 'Muse Producer 02',
    role: 'production_media',
    roleTitle: 'Thiết kế Hình ảnh & Sản xuất Video',
    description:
      'AI Sản xuất đa nhiệm (nhận việc ngay khi đủ dữ liệu): thiết kế ảnh nhân vật/phân cảnh và nối tiếp ngay sang tạo video theo timeline, lời thoại, khẩu hình mà không chờ AI khác.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'offline',
    paused: false,
    avatarPreset: 'visual_palette',
    accentColor: '#0891B2',
    permissions: {
      canModifyProjectMemory: false,
      canApproveQa: false,
      canExecuteMedia: true,
      allowedDataScopes: ['project_memory:read', 'artifacts:write_image', 'artifacts:write_video', 'chat:image', 'chat:video', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-03',
    code: 'Muse AI 03',
    name: 'Muse Producer 03',
    role: 'production_media',
    roleTitle: 'Thiết kế Hình ảnh & Sản xuất Video',
    description:
      'AI Sản xuất đa nhiệm & khôi phục trang phục chuẩn: thiết kế ảnh tham chiếu/phân cảnh, chuyển thẳng sang dựng video của cảnh đó ngay khi ảnh hoàn tất.',
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
      allowedDataScopes: ['project_memory:read', 'artifacts:write_image', 'artifacts:write_video', 'chat:image', 'chat:video', 'chat:group'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  },
  {
    id: 'muse-04',
    code: 'Muse AI 04',
    name: 'Muse Producer 04',
    role: 'production_media',
    roleTitle: 'Thiết kế Hình ảnh & Sản xuất Video',
    description:
      'AI Sản xuất đa nhiệm: thiết kế keyframe phân cảnh và sản xuất trực tiếp video theo timeline từng giây, chuyển động, góc quay và lip-sync đồng bộ.',
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
      allowedDataScopes: ['project_memory:read', 'artifacts:write_image', 'artifacts:write_video', 'chat:image', 'chat:video', 'chat:group'],
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
    coordinationLog: [],
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

function createDefaultChairmanConfig(): ChairmanConfig {
  return {
    enabled: true,
    name: 'Gemini AI – Chủ tịch',
    title: 'Chủ tịch & Tổng chỉ huy toàn bộ hệ thống 5 Muse AI',
    autoInterveneOnIncident: true,
    autoExecuteRecommended: true,
    strictOversightMode: true,
    autonomousUpgraded: true,
  };
}

function getChairmanDisplayName(): string {
  return storeDoc.chairmanConfig?.name?.trim() || 'Gemini AI – Chủ tịch';
}

interface ChairmanBusActor {
  id: 'chairman';
  name: string;
  accentColor: string;
  avatarUrl?: string;
}

function getChairmanBusActor(): ChairmanBusActor {
  return {
    id: 'chairman',
    name: getChairmanDisplayName(),
    accentColor: '#D97706',
  };
}

function getChairmanVirtualAgent(): MuseAgentConfig {
  return {
    id: 'muse-01',
    code: 'Gemini AI',
    name: getChairmanDisplayName(),
    role: 'director_script',
    roleTitle: storeDoc.chairmanConfig?.title || 'Chủ tịch & Tổng chỉ huy',
    description: 'Chủ tịch & Tổng chỉ huy tối cao điều phối 5 Muse AI thông qua Gemini API.',
    boundAccountId: 'auto',
    engineMode: 'muse2api_with_gemini_fallback',
    status: 'supervising',
    paused: false,
    avatarPreset: 'crown_star',
    accentColor: '#D97706',
    permissions: {
      canModifyProjectMemory: true,
      canApproveQa: false,
      canExecuteMedia: false,
      allowedDataScopes: ['project_memory:rw', 'script:analyze', 'tasks:dispatch', 'runs:control', 'chat:all'],
    },
    stats: { completed: 0, failed: 0, retried: 0 },
  };
}

function pickNextHealthyProducer(excludeId?: MuseAgentId): MuseAgentId {
  const candidates = PRODUCTION_AGENT_IDS.filter((id) => id !== excludeId);
  const scored = candidates
    .map((id) => {
      const ag = storeDoc.agents.find((a) => a.id === id);
      const active = storeDoc.tasks.filter(
        (t) => t.assignedAgentId === id && (t.status === 'running' || t.status === 'queued')
      ).length;
      const penalty =
        (ag?.paused ? 100 : 0) +
        (ag?.status === 'offline' || ag?.status === 'error' ? 50 : 0) +
        (ag?.stats?.failed || 0) * 3 +
        active * 2;
      return { id, penalty };
    })
    .sort((a, b) => a.penalty - b.penalty);
  return scored[0]?.id || excludeId || 'muse-03';
}

function appendProjectCoordinationLog(
  runId: string | undefined,
  entry: Omit<ProjectCoordinationEntry, 'id' | 'timestamp' | 'projectId'>
): void {
  const mem = getRunMemory(runId);
  if (!Array.isArray(mem.coordinationLog)) mem.coordinationLog = [];
  const rec: ProjectCoordinationEntry = {
    id: `coord_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: Date.now(),
    projectId: mem.projectId,
    ...entry,
  };
  mem.coordinationLog.unshift(rec);
  if (mem.coordinationLog.length > 250) {
    mem.coordinationLog = mem.coordinationLog.slice(0, 250);
  }
  if (mem !== storeDoc.projectMemory && storeDoc.projectMemory.projectId === mem.projectId) {
    if (!Array.isArray(storeDoc.projectMemory.coordinationLog)) {
      storeDoc.projectMemory.coordinationLog = [];
    }
    storeDoc.projectMemory.coordinationLog.unshift(rec);
    if (storeDoc.projectMemory.coordinationLog.length > 250) {
      storeDoc.projectMemory.coordinationLog = storeDoc.projectMemory.coordinationLog.slice(0, 250);
    }
  }
}

/**
 * Evaluates Muse AI 05 measurable character & costume consistency metrics.
 * Enforces the strict 5% rule:
 * - Allowed independent accessories (hat, gold ring, necklace, shoes, watch, bag, glasses, props) are excluded from overall deviation.
 * - Critical locked attributes (face/identity, physique, main outfit when locked, or accessory distorting identity/outfit)
 *   trigger an immediate FAIL even if overallDeviationExcludingAccessoriesPct <= 5%.
 */
function evaluateMuse05CharacterConsistency(params: {
  parsed: any;
  allowFreeCostumeChange: boolean;
  fallbackCharScore: number;
  fallbackCostumeScore: number;
}): {
  metrics: QaCharacterConsistencyMetrics;
  passed: boolean;
  verdictStatus: QaVerdictStatus;
  deviationClass: QaDeviationClass;
  costumeViolated: boolean;
  characterViolated: boolean;
} {
  const p = params.parsed || {};
  const clampPct = (v: any, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : def;
  };
  const clampScore = (v: any, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : def;
  };

  const faceSimilarityScore = clampScore(p.faceSimilarityScore ?? p.characterScore, params.fallbackCharScore);
  const faceDeviationPct = clampPct(
    p.faceDeviationPct,
    Math.max(0, Math.round((100 - faceSimilarityScore) * 10) / 10)
  );

  const physiqueSimilarityScore = clampScore(p.physiqueSimilarityScore ?? p.characterScore, params.fallbackCharScore);
  const physiqueDeviationPct = clampPct(
    p.physiqueDeviationPct,
    Math.max(0, Math.round((100 - physiqueSimilarityScore) * 10) / 10)
  );

  const mainCostumeSimilarityScore = clampScore(
    p.mainCostumeSimilarityScore ?? p.costumeScore,
    params.fallbackCostumeScore
  );
  const mainCostumeDeviationPct = clampPct(
    p.mainCostumeDeviationPct,
    Math.max(0, Math.round((100 - mainCostumeSimilarityScore) * 10) / 10)
  );

  const allowedAccessoryChanges: string[] = Array.isArray(p.allowedAccessoryChanges)
    ? p.allowedAccessoryChanges.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 10)
    : [];

  const accessoryDistortsIdentityOrCostume = Boolean(p.accessoryDistortsIdentityOrCostume);

  const computedOverallDev = params.allowFreeCostumeChange
    ? Math.round(((faceDeviationPct + physiqueDeviationPct) / 2) * 10) / 10
    : Math.round(((faceDeviationPct + physiqueDeviationPct + mainCostumeDeviationPct) / 3) * 10) / 10;

  const overallDeviationExcludingAccessoriesPct = clampPct(
    p.overallDeviationExcludingAccessoriesPct,
    computedOverallDev
  );

  const criticalViolationFlags: string[] = [];
  if (p.criticalFaceError === true || faceDeviationPct > 5 || faceSimilarityScore < 90 || p.characterPassed === false) {
    criticalViolationFlags.push(
      `Sai lệch khuôn mặt/nhận dạng (${faceDeviationPct}% > ngưỡng an toàn, tương đồng ${faceSimilarityScore}/100)`
    );
  }
  if (p.criticalPhysiqueError === true || physiqueDeviationPct > 5 || physiqueSimilarityScore < 90) {
    criticalViolationFlags.push(
      `Biến đổi vóc dáng/tỷ lệ cơ thể (${physiqueDeviationPct}%, tương đồng ${physiqueSimilarityScore}/100)`
    );
  }
  const costumeViolated =
    !params.allowFreeCostumeChange &&
    (p.criticalMainCostumeError === true ||
      p.costumePassed === false ||
      mainCostumeDeviationPct > 5 ||
      mainCostumeSimilarityScore < 90);
  if (costumeViolated) {
    criticalViolationFlags.push(
      `Thay đổi trang phục chính trái phép (${mainCostumeDeviationPct}%, tương đồng ${mainCostumeSimilarityScore}/100)`
    );
  }
  if (accessoryDistortsIdentityOrCostume) {
    criticalViolationFlags.push('Phụ kiện làm biến đổi nhận dạng hoặc cấu trúc trang phục chính đã khóa');
  }
  if (overallDeviationExcludingAccessoriesPct > 5) {
    criticalViolationFlags.push(
      `Sai lệch tổng thể sau loại trừ phụ kiện được phép là ${overallDeviationExcludingAccessoriesPct}% (> ngưỡng tối đa 5%)`
    );
  }

  const characterViolated =
    p.criticalFaceError === true ||
    p.criticalPhysiqueError === true ||
    p.characterPassed === false ||
    faceDeviationPct > 5 ||
    physiqueDeviationPct > 5 ||
    faceSimilarityScore < 90 ||
    physiqueSimilarityScore < 90;

  let verdictStatus: QaVerdictStatus;
  let deviationClass: QaDeviationClass;
  if (criticalViolationFlags.length > 0 || String(p.verdictStatus || '').toUpperCase() === 'FAIL') {
    verdictStatus = 'FAIL';
    deviationClass = 'type_c_exceeds_limit';
    if (criticalViolationFlags.length === 0) {
      criticalViolationFlags.push('Muse AI 05 đánh dấu FAIL theo đối chiếu trực tiếp với ảnh tham chiếu.');
    }
  } else if (allowedAccessoryChanges.length > 0 && overallDeviationExcludingAccessoriesPct <= 1) {
    verdictStatus = 'PASS_WITH_TOLERANCE';
    deviationClass = 'type_a_allowed_accessory';
  } else if (
    overallDeviationExcludingAccessoriesPct > 0 ||
    allowedAccessoryChanges.length > 0 ||
    String(p.verdictStatus || '').toUpperCase() === 'PASS_WITH_TOLERANCE'
  ) {
    verdictStatus = 'PASS_WITH_TOLERANCE';
    deviationClass = allowedAccessoryChanges.length > 0 && overallDeviationExcludingAccessoriesPct <= 1.5
      ? 'type_a_allowed_accessory'
      : 'type_b_minor_tolerance';
  } else {
    verdictStatus = 'PASS';
    deviationClass = 'type_b_minor_tolerance';
  }

  const metrics: QaCharacterConsistencyMetrics = {
    verdictStatus,
    deviationClass,
    faceSimilarityScore,
    faceDeviationPct,
    physiqueSimilarityScore,
    physiqueDeviationPct,
    mainCostumeSimilarityScore,
    mainCostumeDeviationPct,
    overallDeviationExcludingAccessoriesPct,
    allowedAccessoryChanges,
    criticalViolationFlags,
    environmentalContextNote: String(
      p.environmentalContextNote || 'Đã xét điều kiện góc máy, ánh sáng, tư thế và độ che khuất khi đối chiếu.'
    ).trim(),
    accessoryDistortsIdentityOrCostume,
  };

  return {
    metrics,
    passed: verdictStatus === 'PASS' || verdictStatus === 'PASS_WITH_TOLERANCE',
    verdictStatus,
    deviationClass,
    costumeViolated,
    characterViolated,
  };
}

function createDefaultDoc(): PersistedCommandCenterDoc {
  const cfg = resolveMuse2ApiConfig();
  return {
    agents: structuredClone(DEFAULT_AGENTS),
    chairmanConfig: createDefaultChairmanConfig(),
    chairmanBriefings: [],
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
      parallelLimit: 4,
      perAgentConcurrencyLimit: 2,
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
  extra?: { agentId?: MuseAgentId | 'system' | 'chairman'; taskId?: string; runId?: string }
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
    ch === 'chairman' ||
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
  fromAgent: MuseAgentConfig | ChairmanBusActor;
  toAgentIds: (MuseAgentId | 'chairman')[];
  runId: string;
  projectId: string;
  taskId?: string;
  sceneId?: string;
  content: string;
}): void {
  const chairmanName = getChairmanDisplayName();
  const toLabels = params.toAgentIds
    .map((id) => (id === 'chairman' ? chairmanName : storeDoc.agents.find((a) => a.id === id)?.name || id))
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

function getAgentEffectiveMaxConcurrency(agent: MuseAgentConfig, health?: MuseIntegrationHealth): number {
  const baseLimit = Math.max(1, Math.min(3, storeDoc.cloudConfig.perAgentConcurrencyLimit ?? 2));
  if (agent.role === 'director_script' || agent.role === 'qa_supervisor' || agent.role === 'director') {
    return baseLimit;
  }
  if (agent.boundAccountId && agent.boundAccountId !== 'auto') {
    return health?.geminiConfigured ? Math.min(2, baseLimit) : 1;
  }
  const healthyCount = health?.healthyAccounts || 0;
  if (healthyCount >= 2 || health?.geminiConfigured) {
    return baseLimit;
  }
  return 1;
}

function isValidImageArtifactOnDisk(artifactUrl?: string): boolean {
  if (!artifactUrl) return false;
  if (artifactUrl.startsWith('data:image/')) {
    return artifactUrl.length > 200;
  }
  const dp = artifactUrlToDiskPath(artifactUrl);
  if (!dp || !fs.existsSync(dp)) return false;
  try {
    return fs.statSync(dp).size > 200;
  } catch {
    return false;
  }
}

function setSceneProductionStage(runId: string, sceneId: string | undefined, stage: SceneProductionStage): void {
  if (!sceneId) return;
  const mem = getRunMemory(runId);
  const sc = mem.scenes.find((s) => s.sceneId === sceneId);
  if (!sc) return;
  sc.productionStage = stage;
}

function enqueueTask(input: {
  runId: string;
  type: CommandTaskType;
  title: string;
  instructions: string;
  assignedAgentId: MuseAgentId | 'chairman';
  dependsOnTaskIds?: string[];
  sceneId?: string;
  sceneIndex?: number;
  characterId?: string;
  costumeRecovery?: CommandTask['costumeRecovery'];
  expectedMemoryVersion?: number;
  allowMultipleVariants?: boolean;
  priority?: number;
  maxRetries?: number;
}): CommandTask {
  // Deduplication guard: prevent duplicate active/pending task across ALL agents for same runId + type + sceneId + characterId unless allowMultipleVariants is true
  if (input.type !== 'custom_task' && !input.allowMultipleVariants) {
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
    expectedMemoryVersion: input.expectedMemoryVersion,
    allowMultipleVariants: input.allowMultipleVariants,
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
  ai_output_format_error: {
    label: 'Lỗi định dạng / JSON từ AI',
    directive: 'Chuẩn hóa cấu trúc JSON RFC 8259 (dấu nháy kép cho mọi key/string, thoát dấu ngoặc kép trong lời thoại), thu gọn dữ liệu đầu ra hoặc tự động chuyển mô hình hỗ trợ JSON Schema (Gemini JSON Mode) để chạy lại đúng bước gặp lỗi.',
    rebuildKeyframe: false,
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
  senderId: MuseAgentId | 'user' | 'system' | 'chairman';
  senderName: string;
  roleBadge: string;
  content: string;
  targetAgentIds?: (MuseAgentId | 'chairman')[];
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
    senderColor:
      senderAgent?.accentColor ||
      (params.senderId === 'chairman'
        ? '#D97706'
        : params.senderId === 'system'
        ? '#F59E0B'
        : undefined),
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
  if (/expected double-quoted property name|unexpected token.*json|unterminated string in json|expected ',' or '}'|json\.parse|cú pháp json|định dạng json|trả về rỗng|invalid json|syntaxerror/i.test(text)) {
    return 'ai_output_format_error';
  }
  if (/mất kết nối|offline|timeout|vượt timeout|treo|econnrefused|ngoại tuyến|cookie|chưa có kết nối|503|504|deadline_exceeded|high demand/i.test(text)) {
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

function inferAgentFromCategory(category: IncidentCategory, task?: CommandTask, qaReport?: QaInspectionReport, scene?: CommandMemoryScene): MuseAgentId {
  const taskMuseId: MuseAgentId | undefined =
    task?.assignedAgentId && task.assignedAgentId !== 'chairman' ? task.assignedAgentId : undefined;
  if (category === 'wrong_costume') {
    if (scene?.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(scene.assignedProducerAgentId)) {
      return scene.assignedProducerAgentId;
    }
    if (taskMuseId && PRODUCTION_AGENT_IDS.includes(taskMuseId)) return taskMuseId;
    if (qaReport?.targetFixAgentId && PRODUCTION_AGENT_IDS.includes(qaReport.targetFixAgentId)) {
      return qaReport.targetFixAgentId;
    }
    return 'muse-03';
  }
  if (category === 'ai_output_format_error' && taskMuseId) {
    return taskMuseId;
  }
  if (task && ['qa_inspect_scene', 'qa_inspect_image'].includes(task.type)) {
    return 'muse-05';
  }
  if (qaReport?.targetFixAgentId && PRODUCTION_AGENT_IDS.includes(qaReport.targetFixAgentId)) {
    return qaReport.targetFixAgentId;
  }
  if (taskMuseId && PRODUCTION_AGENT_IDS.includes(taskMuseId)) return taskMuseId;
  if (scene?.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(scene.assignedProducerAgentId)) {
    return scene.assignedProducerAgentId;
  }
  if (taskMuseId) return taskMuseId;
  if (category === 'wrong_character' || category === 'wrong_setting') {
    return 'muse-03';
  }
  return 'muse-04';
}

function getTaskTypeLabelVi(type?: CommandTaskType | string): string {
  switch (type) {
    case 'plan_production':
      return 'Lập kế hoạch sản xuất';
    case 'analyze_script':
      return 'Phân tích kịch bản & bóc tách phân cảnh';
    case 'design_character_ref':
      return 'Tạo ảnh tham chiếu nhân vật';
    case 'design_scene_image':
      return 'Tạo ảnh keyframe phân cảnh';
    case 'restore_costume_and_regen_image':
      return 'Khôi phục trang phục & tạo lại ảnh';
    case 'produce_scene_video':
      return 'Quay & dựng video phân cảnh';
    case 'qa_inspect_image':
      return 'Kiểm định ảnh keyframe/trang phục';
    case 'qa_inspect_scene':
      return 'Kiểm định chất lượng video (8 tiêu chí)';
    case 'assemble_final_film':
      return 'Ghép xuất phim hoàn chỉnh';
    default:
      return type || 'Tác vụ sản xuất';
  }
}

function diagnoseIncidentTechnicalDetails(params: {
  rawError: string;
  task?: CommandTask;
  agent?: MuseAgentConfig;
  scene?: CommandMemoryScene;
  category: IncidentCategory;
}): {
  concreteErrorDescription: string;
  structuredRootCause: string;
  actionableInitialProposal: string;
  technicalDiagnosis: IncidentTechnicalDiagnosis;
} {
  const raw = String(params.rawError || '').trim();
  const taskCode = params.task?.code;
  const taskTypeLabel = getTaskTypeLabelVi(params.task?.type);
  const agentName = params.agent?.name || params.task?.assignedAgentId || 'Muse AI';
  const sceneLabel = params.scene ? `Cảnh ${String(params.scene.index).padStart(2, '0')} ("${params.scene.title}")` : '';
  const providerMatch = raw.match(/\[Engine:\s*([^\]]+)\]/i);
  const provider = providerMatch ? providerMatch[1].trim() : params.task?.executedByProvider;

  const isJsonErr =
    /expected double-quoted property name|unexpected token.*json|unterminated string in json|expected ',' or '}'|json\.parse|cú pháp json|định dạng json|invalid json/i.test(
      raw
    );
  const posMatch = raw.match(/position\s+(\d+)(?:\s*\(([^)]+)\))?/i);
  const excerptMatch = raw.match(/Đoạn lỗi[^:]*:\s*"([^"]+)"/i);
  const locationText = posMatch ? `ký tự ${posMatch[1]}${posMatch[2] ? ` (${posMatch[2]})` : ''}` : undefined;
  const excerptText = excerptMatch ? excerptMatch[1] : undefined;

  if (isJsonErr) {
    const specificSyntaxHint = /expected double-quoted property name/i.test(raw)
      ? 'Tên thuộc tính (property key) thiếu dấu nháy kép, hoặc còn dấu phẩy thừa (trailing comma) / văn bản thừa trước dấu đóng "}".'
      : /unterminated string/i.test(raw)
      ? 'Chuỗi văn bản bị ngắt giữa chừng (thiếu dấu đóng ngoặc kép hoặc phản hồi từ AI bị cắt cụt do quá dài).'
      : 'Cấu trúc JSON trả về không đúng chuẩn RFC 8259 (thiếu dấu phẩy, ngoặc kép trong lời thoại chưa thoát ký tự, hoặc lẫn mô tả ngoài JSON).';

    const rootCauseDetail = `Mô hình AI${provider ? ` (${provider})` : ''} tại bước "${taskTypeLabel}"${sceneLabel ? ` cho ${sceneLabel}` : ''} trả về JSON sai cú pháp${locationText ? ` tại ${locationText}` : ''}: ${specificSyntaxHint}`;
    const remediationPlan = `Gemini AI – Chủ tịch chỉ đạo: (1) Bật chế độ Gemini JSON Mode (responseMimeType: application/json) làm dự phòng chuẩn hóa cấu trúc cho ${agentName}; (2) Rút gọn độ dài schema/prompt để tránh cắt cụt giữa chừng và bắt buộc thoát dấu ngoặc kép (\\") trong lời thoại; (3) Chạy lại đúng tác vụ ${taskCode || taskTypeLabel} mà không hủy các cảnh đã hoàn thành.`;

    return {
      concreteErrorDescription: `${taskCode ? `[${taskCode}] ` : ''}${agentName} lỗi phân tích dữ liệu JSON ở bước "${taskTypeLabel}"${sceneLabel ? ` (${sceneLabel})` : ''}: ${raw}`,
      structuredRootCause: rootCauseDetail,
      actionableInitialProposal: remediationPlan,
      technicalDiagnosis: {
        errorType: 'Lỗi cú pháp JSON từ phản hồi AI',
        taskCode,
        taskType: taskTypeLabel,
        agentName,
        provider,
        failedLocation: locationText,
        excerpt: excerptText,
        rootCauseDetail,
        directorRemediationPlan: remediationPlan,
      },
    };
  }

  if (/keyframe hợp lệ|chưa có tệp ảnh keyframe|kiểm duyệt ảnh hợp lệ/i.test(raw)) {
    const rootCauseDetail = `${sceneLabel || 'Phân cảnh'} chưa có tệp ảnh keyframe hợp lệ trên đĩa (hoặc ảnh đang ở trạng thái chờ tạo lại/kiểm định) nên hệ thống chủ động chặn dựng video để tránh lỗi sai nhân vật/trang phục.`;
    const remediationPlan = `Gemini AI – Chủ tịch chỉ đạo: Yêu cầu Muse phụ trách tạo và xác thực xong tệp ảnh keyframe trên đĩa cho ${sceneLabel || 'phân cảnh'} trước, sau đó tự động mở khóa lại tác vụ dựng video.`;
    return {
      concreteErrorDescription: `${taskCode ? `[${taskCode}] ` : ''}${agentName} bị chặn bước "${taskTypeLabel}"${sceneLabel ? ` (${sceneLabel})` : ''}: ${raw}`,
      structuredRootCause: rootCauseDetail,
      actionableInitialProposal: remediationPlan,
      technicalDiagnosis: {
        errorType: 'Thiếu ảnh keyframe hợp lệ trên đĩa',
        taskCode,
        taskType: taskTypeLabel,
        agentName,
        provider,
        rootCauseDetail,
        directorRemediationPlan: remediationPlan,
      },
    };
  }

  if (/503|504|deadline_exceeded|high demand|timeout|vượt timeout|mất kết nối|offline|cookie|econnrefused|ngoại tuyến|chưa thể thực thi/i.test(raw)) {
    const isQuotaOrOverload = /503|504|deadline_exceeded|high demand|timeout|vượt timeout/i.test(raw);
    const rootCauseDetail = isQuotaOrOverload
      ? `Máy chủ mô hình AI / API tạo media đang quá tải hoặc phản hồi chậm quá giới hạn timeout ở bước "${taskTypeLabel}" (${agentName}).`
      : `Kênh kết nối Muse2API / tài khoản Muse.ai của ${agentName} bị ngắt, hết hạn cookie hoặc chưa cấu hình Gemini dự phòng cho bước "${taskTypeLabel}".`;
    const remediationPlan = isQuotaOrOverload
      ? `Gemini AI – Chủ tịch chỉ đạo: Tự động chuyển sang mô hình dự phòng nhanh hơn / xoay vòng tài khoản Muse.ai khác và thử chạy lại riêng tác vụ ${taskCode || taskTypeLabel}.`
      : `Gemini AI – Chủ tịch chỉ đạo: Xoay vòng sang tài khoản Muse2API khỏe mạnh, kích hoạt Gemini dự phòng nếu đã cấu hình, và chạy lại tác vụ ${taskCode || taskTypeLabel}.`;
    return {
      concreteErrorDescription: `${taskCode ? `[${taskCode}] ` : ''}${agentName} gián đoạn kết nối / quá thời gian ở bước "${taskTypeLabel}"${sceneLabel ? ` (${sceneLabel})` : ''}: ${raw}`,
      structuredRootCause: rootCauseDetail,
      actionableInitialProposal: remediationPlan,
      technicalDiagnosis: {
        errorType: isQuotaOrOverload ? 'Quá tải / Timeout API AI' : 'Lỗi kết nối / Xác thực Engine AI',
        taskCode,
        taskType: taskTypeLabel,
        agentName,
        provider,
        rootCauseDetail,
        directorRemediationPlan: remediationPlan,
      },
    };
  }

  if (/ffmpeg|mux|mp4|audio|khung hình/i.test(raw)) {
    const rootCauseDetail = `Lỗi xử lý media/FFmpeg ở bước "${taskTypeLabel}"${sceneLabel ? ` (${sceneLabel})` : ''}: ${raw}`;
    const remediationPlan = `Gemini AI – Chủ tịch chỉ đạo: Kiểm tra tệp video/audio đầu vào trên đĩa, tạo lại clip của riêng ${sceneLabel || 'phân cảnh lỗi'} bằng thông số mã hóa chuẩn H.264/AAC rồi gửi Muse AI 05 kiểm duyệt lại.`;
    return {
      concreteErrorDescription: `${taskCode ? `[${taskCode}] ` : ''}${agentName} gặp sự cố kỹ thuật media ở bước "${taskTypeLabel}": ${raw}`,
      structuredRootCause: rootCauseDetail,
      actionableInitialProposal: remediationPlan,
      technicalDiagnosis: {
        errorType: 'Lỗi kỹ thuật xử lý Video / FFmpeg',
        taskCode,
        taskType: taskTypeLabel,
        agentName,
        provider,
        rootCauseDetail,
        directorRemediationPlan: remediationPlan,
      },
    };
  }

  const rule = INCIDENT_SMART_RULES[params.category];
  const fallbackRootCause = raw
    ? `Lỗi tại bước "${taskTypeLabel}" (${agentName}${sceneLabel ? ` · ${sceneLabel}` : ''}): ${raw}`
    : `Sai lệch thông số đồng bộ hoặc lỗi thực thi giữa tác vụ ${taskCode || ''} và Project Memory.`;
  return {
    concreteErrorDescription: raw || `${agentName} gặp lỗi tại ${taskTypeLabel}`,
    structuredRootCause: fallbackRootCause,
    actionableInitialProposal: rule?.directive || 'Kiểm tra lại dữ liệu đầu vào và thực thi lại đúng tác vụ bị lỗi.',
    technicalDiagnosis: {
      errorType: rule?.label || 'Lỗi thực thi tác vụ',
      taskCode,
      taskType: taskTypeLabel,
      agentName,
      provider,
      rootCauseDetail: fallbackRootCause,
      directorRemediationPlan: rule?.directive || 'Kiểm tra và chạy lại tác vụ.',
    },
  };
}

async function generateQuickDirectorDialogPair(params: {
  inc: IncidentRecord;
  responsible: MuseAgentConfig;
  ruleDirective: string;
  scene?: CommandMemoryScene;
  mem: ProjectMemory;
}): Promise<{ directorQuestion: string; responsibleExplanation: string; directorAnalysis: string }> {
  const chairmanName = getChairmanDisplayName();
  const scLabel = params.scene
    ? `Cảnh ${String(params.scene.index).padStart(2, '0')} "${params.scene.title}"`
    : params.inc.taskId || 'Nhiệm vụ sản xuất';
  const cm = params.inc.costumeMismatch;
  const fallbackQuestion = cm
    ? `[${chairmanName} → ${params.responsible.name}] Kiểm tra ngay sai lệch trang phục nhân vật "${cm.characterName}" (ID: ${cm.characterId}) tại ${scLabel}! Trang phục chuẩn bắt buộc: "${cm.expectedCostume}". Điểm không khớp: ${cm.mismatchDetails}. Giải trình rõ lỗi phát sinh từ prompt, ảnh tham chiếu, hồ sơ nhân vật hay quá trình render?`
    : `[${chairmanName} → ${params.responsible.name}] Kiểm tra gấp ${scLabel} (${params.inc.timestampRange || 'toàn cảnh'}). Báo cáo ghi nhận "${params.inc.categoryLabel}": ${params.inc.errorDescription}. Giải trình nguyên nhân sai lệch so với Project Memory v${params.mem.version}.`;
  const fallbackExplanation = cm
    ? `${params.responsible.name} báo cáo ${chairmanName}: đã đối chiếu ảnh lỗi với ảnh tham chiếu gốc của "${cm.characterName}" (${cm.characterId}) — quá trình sinh hình ảnh/prompt đã bị trôi trang phục (${cm.observedCostume || 'sai chi tiết so với bản gốc'}). Sẵn sàng nhận lệnh khôi phục và tạo lại.`
    : `${params.responsible.name} báo cáo ${chairmanName}: đã rà soát dữ liệu ${scLabel}, nguyên nhân do ${params.inc.suspectedRootCause || 'prompt/ràng buộc tham chiếu chưa khóa chặt theo đúng hồ sơ nhân vật và timeline kịch bản'}.`;
  const fallbackAnalysis = cm
    ? `Chẩn đoán của ${chairmanName}: Sai lệch thuộc về dữ liệu khóa trang phục/prompt khi khóa cứng đang bật (${cm.characterName}). Chỉ đạo: giao ${params.responsible.name} khôi phục nguyên bản từ ảnh tham chiếu gốc, tạo lại đúng phần lỗi rồi gửi Muse AI 05 kiểm định lại.`
    : `Chẩn đoán của ${chairmanName}: ${params.inc.suspectedRootCause}. Phương án xử lý: ${params.ruleDirective}`;

  if (params.inc.category === 'muse_disconnected') {
    return {
      directorQuestion: fallbackQuestion,
      responsibleExplanation: `Hệ thống ghi nhận lỗi kết nối/quá thời gian ở tài khoản hoặc kênh thực thi của ${params.responsible.name}: ${params.inc.errorDescription}`,
      directorAnalysis: fallbackAnalysis,
    };
  }

  try {
    const health = await refreshIntegrationHealth(false);
    if (health.geminiConfigured) {
      const ai = getGeminiClient();
      const cmContext = cm
        ? `\nCHI TIẾT SAI TRANG PHỤC: Nhân vật "${cm.characterName}" (${cm.characterId}) · Trang phục chuẩn: "${cm.expectedCostume}" · Điểm sai lệch: "${cm.mismatchDetails}" · AI tạo lỗi: ${cm.responsibleAgentId}.`
        : '';
      const resp = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Sự cố ${params.inc.code} [${params.inc.categoryLabel}] tại ${scLabel} (mốc ${params.inc.timestampRange || '0s'}).
Mô tả lỗi từ Muse AI 05 / hệ thống: ${params.inc.errorDescription}${cmContext}
Dữ liệu tham chiếu: ${params.inc.referenceDataSummary}
Quy tắc xử lý gợi ý: ${params.ruleDirective}`,
          config: {
            systemInstruction: `Bạn là ${chairmanName} — Chủ tịch & Tổng chỉ huy toàn bộ đội ngũ 5 Muse AI (Muse Director + Muse 02/03/04 trực tiếp sản xuất hình ảnh/video; Muse 05 kiểm định độc lập).
Bạn đang trực tiếp chất vấn ${params.responsible.name} (${params.responsible.roleTitle}) về lỗi vừa phát hiện.
Xác định rõ lỗi thuộc về: prompt, ảnh tham chiếu, dữ liệu nhân vật hay quá trình tạo video.
Trả về JSON ngắn gọn bằng tiếng Việt.`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                directorQuestion: { type: Type.STRING },
                responsibleExplanation: { type: Type.STRING },
                directorAnalysis: { type: Type.STRING },
              },
              required: ['directorQuestion', 'responsibleExplanation', 'directorAnalysis'],
            },
          },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 9500)),
      ]);
      const rawText = (resp as any)?.text ? String((resp as any).text).trim() : '';
      if (rawText) {
        const p = parseAiBlueprintJsonSafe(rawText);
        if (p) {
          return {
            directorQuestion: String(p.directorQuestion || fallbackQuestion).trim(),
            responsibleExplanation: String(p.responsibleExplanation || fallbackExplanation).trim(),
            directorAnalysis: String(p.directorAnalysis || fallbackAnalysis).trim(),
          };
        }
      }
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
  const chairmanName = getChairmanDisplayName();
  inc.status = 'resolved';
  inc.resolvedAt = Date.now();
  inc.resolutionSummary = summary;

  appendIncidentTurn(inc, {
    actorId: resolverAgent.id,
    actorName: `${resolverAgent.name} (${resolverAgent.roleTitle})`,
    roleBadge: 'Kiểm định · ĐẠT',
    kind: 'qa_review',
    content: summary,
  });
  appendIncidentTurn(inc, {
    actorId: 'chairman',
    actorName: chairmanName,
    roleBadge: 'Chủ tịch đóng sự cố',
    kind: 'resolution',
    content: `Đã nhận xác nhận kiểm định đạt yêu cầu từ ${resolverAgent.name}. Chính thức đóng sự cố ${inc.code}, giữ nguyên các phân cảnh đạt chuẩn và tiếp tục dây chuyền sản xuất.`,
  });

  postIncidentChannelMessage({
    inc,
    senderId: resolverAgent.id,
    senderName: `${resolverAgent.name} (${resolverAgent.roleTitle})`,
    roleBadge: 'Kiểm định · ĐẠT',
    targetAgentIds: [inc.assignedFixAgentId],
    content: `[${inc.code} → ${chairmanName}] ${summary}`,
  });
  postIncidentChannelMessage({
    inc,
    senderId: 'chairman',
    senderName: `${chairmanName} – Tổng chỉ huy`,
    roleBadge: 'Đóng sự cố',
    targetAgentIds: [inc.assignedFixAgentId, resolverAgent.id],
    content: `[ĐÃ KHẮC PHỤC ${inc.code}] ${summary} — Chính thức đóng sự cố và tiếp tục sản xuất.`,
  });
  appendProjectCoordinationLog(inc.runId, {
    actorId: 'chairman',
    actorName: chairmanName,
    targetAgentIds: [inc.assignedFixAgentId, resolverAgent.id],
    kind: 'remediation',
    runId: inc.runId,
    taskId: inc.taskId,
    sceneId: inc.sceneId,
    incidentId: inc.id,
    summary: `Đóng sự cố ${inc.code} sau xác nhận của ${resolverAgent.name}: ${summary}`,
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
  reporterAgentId: MuseAgentId | 'chairman';
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
  const chairmanBus = getChairmanBusActor();
  const chairmanName = chairmanBus.name;
  const reporterAgent =
    params.reporterAgentId === 'chairman'
      ? null
      : storeDoc.agents.find((a) => a.id === params.reporterAgentId) || storeDoc.agents[4];
  const reporterId: MuseAgentId | 'chairman' = reporterAgent ? reporterAgent.id : 'chairman';
  const reporterName = reporterAgent ? reporterAgent.name : chairmanName;
  const reporterRoleTitle = reporterAgent ? reporterAgent.roleTitle : 'Chủ tịch & Tổng chỉ huy';

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
    inferAgentFromCategory(category, params.task, params.qaReport, params.scene);
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

  const diag =
    !resolvedCostumeMismatch && !params.qaReport
      ? diagnoseIncidentTechnicalDetails({
          rawError: params.suspectedRootCause || params.errorDescription,
          task: params.task,
          agent: responsible,
          scene: params.scene,
          category,
        })
      : null;

  const finalErrorDescription =
    diag && !params.errorDescription.includes('[TASK-') && params.task?.code
      ? diag.concreteErrorDescription
      : params.errorDescription;
  const finalRootCause =
    resolvedCostumeMismatch?.mismatchDetails ||
    params.qaReport?.summary ||
    (diag ? diag.structuredRootCause : params.suspectedRootCause) ||
    'Sai lệch thông số đồng bộ hoặc lỗi thực thi giữa tác vụ và Project Memory.';
  const finalProposal =
    params.initialProposal ||
    resolvedCostumeMismatch?.restoreRecommendation ||
    diag?.actionableInitialProposal ||
    rule.directive;

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
      reporterAgentId: reporterId,
      responsibleAgentId: responsible.id,
      assignedFixAgentId: responsible.id,
      category,
      categoryLabel: rule.label,
      severity,
      priority: severity === 'critical' || severity === 'high' ? 'urgent' : 'high',
      status: 'reported',
      errorDescription: finalErrorDescription,
      suspectedRootCause: finalRootCause,
      initialProposal: finalProposal,
      artifactUrls: artifacts,
      referenceDataSummary: refSummary,
      attemptCount: 0,
      maxAttempts,
      remediationTaskIds: [],
      withinAutonomyScope: !params.requiresUserApproval,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      costumeMismatch: resolvedCostumeMismatch,
      technicalDiagnosis: diag?.technicalDiagnosis,
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
    inc.errorDescription = finalErrorDescription;
    inc.suspectedRootCause = finalRootCause || inc.suspectedRootCause;
    if (diag?.technicalDiagnosis) inc.technicalDiagnosis = diag.technicalDiagnosis;
    if (resolvedCostumeMismatch) inc.costumeMismatch = resolvedCostumeMismatch;
    inc.artifactUrls = Array.from(new Set([...inc.artifactUrls, ...artifacts]));
    inc.maxAttempts = maxAttempts;
    inc.taskId = params.task?.id || inc.taskId;
  }

  // 1. Report directly to Gemini AI – Chairman & Supreme Commander (Urgent)
  const cm = inc.costumeMismatch;
  const reportText = cm
    ? `[Báo cáo sai trang phục khẩn → ${chairmanName}] ${inc.code} · ${scNum}
• Nhân vật: ${cm.characterName} (ID: ${cm.characterId})
• Dự án / Phiên / Cảnh: ${cm.projectId} · ${cm.runId} · ${cm.sceneId ? `Cảnh ${cm.sceneIndex} (${cm.sceneId})` : 'Ảnh tham chiếu nhân vật'}
• AI tạo lỗi: ${storeDoc.agents.find((a) => a.id === cm.responsibleAgentId)?.name || cm.responsibleAgentId}
• Trang phục gốc chuẩn: ${cm.expectedCostume}
• Điểm sai lệch cụ thể: ${cm.mismatchDetails}
• Đề xuất bắt buộc: ${cm.restoreRecommendation}`
    : `[Báo cáo khẩn → ${chairmanName}] ${inc.code} · ${scNum}${tsRange ? ` (${tsRange})` : ''}
• Báo cáo bởi: ${reporterName} | Phụ trách: ${responsible.name} | Loại: ${inc.categoryLabel}
• Lỗi cụ thể: ${inc.errorDescription}
• Nguyên nhân dự kiến: ${inc.suspectedRootCause}
• Đề xuất ban đầu: ${inc.initialProposal}`;

  appendIncidentTurn(inc, {
    actorId: reporterId,
    actorName: `${reporterName} (${reporterRoleTitle})`,
    roleBadge: cm ? 'Báo lỗi trang phục' : 'Báo cáo lỗi',
    kind: 'report',
    content: reportText,
    attachments: artifacts.slice(0, 4),
  });
  postIncidentChannelMessage({
    inc,
    senderId: reporterId,
    senderName: `${reporterName} – Báo cáo → ${chairmanName}`,
    roleBadge: cm ? 'Sai trang phục' : 'Báo cáo lỗi',
    targetAgentIds: ['chairman', responsible.id],
    attachments: artifacts.slice(0, 3),
    content: cm
      ? `${scNum} — Nhân vật ${cm.characterName} (${cm.characterId}): ${cm.mismatchDetails}\n• Chuẩn gốc: ${cm.expectedCostume}\n• Khôi phục: ${cm.restoreRecommendation}`
      : `${scNum}: ${inc.errorDescription}\n(Task: ${params.task?.code || inc.taskId || 'N/A'} · Mức độ: ${severity.toUpperCase()})`,
  });
  appendProjectCoordinationLog(params.runId, {
    actorId: reporterId,
    actorName: reporterName,
    targetAgentIds: ['chairman', responsible.id],
    kind: 'incident',
    runId: params.runId,
    taskId: params.task?.id,
    sceneId: params.scene?.sceneId,
    incidentId: inc.id,
    summary: `Báo cáo sự cố ${inc.code} tới ${chairmanName}: ${inc.errorDescription}`,
  });

  // 2. Gemini AI – Chairman directly investigates & interrogates Responsible Muse
  inc.status = 'investigating';
  const dialog = await generateQuickDirectorDialogPair({
    inc,
    responsible,
    ruleDirective: rule.directive,
    scene: params.scene,
    mem,
  });

  inc.analyzedRootCause = dialog.directorAnalysis;

  appendIncidentTurn(inc, {
    actorId: 'chairman',
    actorName: chairmanName,
    roleBadge: 'Chủ tịch chất vấn',
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

  postIncidentChannelMessage({
    inc,
    senderId: 'chairman',
    senderName: `${chairmanName} – Tổng chỉ huy`,
    roleBadge: 'Chủ tịch chỉ đạo',
    targetAgentIds: [responsible.id],
    content: dialog.directorQuestion,
  });
  postIncidentChannelMessage({
    inc,
    senderId: responsible.id,
    senderName: `${responsible.name} – Giải trình`,
    roleBadge: 'Giải trình',
    targetAgentIds: [responsible.id],
    content: dialog.responsibleExplanation,
  });
  appendConversationMessage({
    channel: responsible.id,
    projectId: mem.projectId,
    runId: params.runId,
    sessionId: params.runId,
    sceneId: params.scene?.sceneId,
    taskId: params.task?.id,
    incidentId: inc.id,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: `Chất vấn ${inc.code}`,
    targetAgentIds: [responsible.id],
    messageKind: 'incident',
    content: dialog.directorQuestion,
  });

  // 3. Check autonomy scope, Chairman full executive takeover & retry limit
  const autoEnabled = storeDoc.cloudConfig.autoDirectorIncidentResponse !== false;
  const chairmanAutoDecision = Boolean(
    storeDoc.chairmanConfig?.enabled &&
      storeDoc.chairmanConfig?.autoInterveneOnIncident &&
      storeDoc.chairmanConfig?.autoExecuteRecommended
  );
  const run = storeDoc.runs.find((r) => r.id === params.runId);
  const health = await refreshIntegrationHealth(false);
  const canExecuteAnyEngine =
    health.geminiConfigured ||
    (health.muse2ApiReachable && health.healthyAccounts > 0) ||
    health.accounts.some((a) => a.enabled);

  // Full autonomous Chairman executive takeover when standard retries are exhausted (NO waiting for user!)
  const maxChairmanTakeovers = 2;
  const currentTakeovers = inc.chairmanTakeoverCount || 0;
  if (
    autoEnabled &&
    !params.requiresUserApproval &&
    inc.attemptCount >= maxAttempts &&
    chairmanAutoDecision &&
    canExecuteAnyEngine &&
    currentTakeovers < maxChairmanTakeovers
  ) {
    inc.chairmanTakeoverCount = currentTakeovers + 1;
    inc.status = 'remediating';
    inc.withinAutonomyScope = true;
    inc.escalationReason = undefined;
    inc.updatedAt = Date.now();

    const takeoverMsg = `Đã qua ${inc.attemptCount}/${maxAttempts} vòng sửa tiêu chuẩn tại ${scNum}. ${chairmanName} kích hoạt quyền tự quyết tối cao (Vòng tiếp quản Chủ tịch #${inc.chairmanTakeoverCount}/${maxChairmanTakeovers}) — tự phân tích, điều chuyển Muse khỏe hơn / đổi engine dự phòng và phát lệnh thực thi ngay không cần chờ người dùng.`;

    appendIncidentTurn(inc, {
      actorId: 'chairman',
      actorName: chairmanName,
      roleBadge: `Chủ tịch tự quyết #${inc.chairmanTakeoverCount}`,
      kind: 'directive',
      content: `${takeoverMsg}\n• Chẩn đoán: ${dialog.directorAnalysis}`,
    });
    postIncidentChannelMessage({
      inc,
      senderId: 'chairman',
      senderName: `${chairmanName} – Quyền tự quyết`,
      roleBadge: 'Tự động thực thi',
      targetAgentIds: [responsible.id, 'muse-05'],
      content: takeoverMsg,
    });
    appendProjectCoordinationLog(params.runId, {
      actorId: 'chairman',
      actorName: chairmanName,
      targetAgentIds: [responsible.id],
      kind: 'remediation',
      runId: params.runId,
      taskId: params.task?.id,
      sceneId: params.scene?.sceneId,
      incidentId: inc.id,
      summary: takeoverMsg,
    });
    addActivityLog('warn', `Chủ tịch tự quyết xử lý ${inc.code}`, takeoverMsg, {
      agentId: 'chairman',
      taskId: params.task?.id,
      runId: params.runId,
    });
    saveStateAtomic();
    emitCommandCenterEvent('incident:updated', inc);
    void triggerChairmanAutoBriefing(inc.id);
    return { incident: inc, autonomousFixQueued: true, escalated: false };
  }

  if (
    !autoEnabled ||
    params.requiresUserApproval ||
    inc.attemptCount >= maxAttempts ||
    (category === 'muse_disconnected' && !canExecuteAnyEngine)
  ) {
    const reason = params.requiresUserApproval
      ? 'Thao tác được đánh dấu yêu cầu xác nhận thủ công.'
      : !autoEnabled
      ? `Chế độ tự động điều hành sự cố của ${chairmanName} đang tắt.`
      : category === 'muse_disconnected' && !canExecuteAnyEngine
      ? 'Toàn bộ tài khoản Muse2API và Gemini dự phòng đều đang ngoại tuyến/chưa cấu hình, không có engine để khôi phục tự động.'
      : `Sự cố ${inc.code} tại ${scNum} đã vượt ${maxAttempts} vòng tự khắc phục và ${currentTakeovers} vòng tiếp quản Chủ tịch nhưng vẫn chưa đạt QA.`;

    inc.status = 'escalated_to_user';
    inc.withinAutonomyScope = false;
    inc.escalationReason = reason;

    if (params.scene) {
      commitSessionMemoryUpdate(params.runId, 'chairman', `${chairmanName} báo cáo ngoại lệ sự cố ${inc.code}`, (m) => {
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
      actorId: 'chairman',
      actorName: chairmanName,
      roleBadge: 'Báo cáo ngoại lệ',
      kind: 'escalation',
      content: `${reason}\n• Phân tích của ${chairmanName}: ${dialog.directorAnalysis}`,
    });
    postIncidentChannelMessage({
      inc,
      senderId: 'chairman',
      senderName: `${chairmanName} – Báo cáo ngoại lệ`,
      roleBadge: 'Ngoại lệ hệ thống',
      content: `[NGOẠI LỆ] ${reason}\n• ${dialog.directorAnalysis}`,
    });
    appendConversationMessage({
      channel: 'commander',
      projectId: mem.projectId,
      runId: params.runId,
      sceneId: params.scene?.sceneId,
      incidentId: inc.id,
      senderType: 'agent',
      senderId: 'chairman',
      senderName: chairmanName,
      senderColor: '#D97706',
      roleBadge: 'Chủ tịch AI',
      messageKind: 'alert',
      content: `Sự cố ${inc.code} cần bổ sung tài nguyên/kiểm tra kết nối: ${reason}`,
    });
    addActivityLog('warn', `Chủ tịch báo ngoại lệ ${inc.code}`, reason, {
      agentId: 'chairman',
      taskId: params.task?.id,
      runId: params.runId,
    });
    saveStateAtomic();
    emitCommandCenterEvent('incident:updated', inc);
    if (storeDoc.chairmanConfig?.enabled && storeDoc.chairmanConfig?.autoInterveneOnIncident && canExecuteAnyEngine) {
      void triggerChairmanAutoBriefing(inc.id);
    }
    return { incident: inc, autonomousFixQueued: false, escalated: true };
  }

  // 4. Within autonomy scope -> Gemini AI – Chủ tịch issues direct fix command immediately
  inc.attemptCount += 1;
  inc.status = 'remediating';
  inc.withinAutonomyScope = true;

  const isCostumeLockWorkflow =
    category === 'wrong_costume' && mem.allowFreeCostumeChange !== true;

  // Pick assigned production Muse (muse-01..04); on retry #2+ rotate to another healthy production Muse
  const sceneBaseProducer: MuseAgentId =
    params.scene?.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(params.scene.assignedProducerAgentId)
      ? params.scene.assignedProducerAgentId
      : PRODUCTION_AGENT_IDS.includes(responsible.id)
      ? responsible.id
      : pickNextHealthyProducer();

  let fixTargetAgent: MuseAgentId =
    isCostumeLockWorkflow || Boolean(params.scene)
      ? inc.attemptCount >= 2
        ? pickNextHealthyProducer(sceneBaseProducer)
        : sceneBaseProducer
      : responsible.id;
  let routeAdjustmentNote =
    fixTargetAgent !== responsible.id
      ? `${chairmanName} điều chuyển từ ${responsible.name} sang ${storeDoc.agents.find((a) => a.id === fixTargetAgent)?.name || fixTargetAgent} để tránh lặp lỗi cũ. `
      : '';

  // Smart recovery for disconnection / pinned account / AI JSON format failure
  if (category === 'muse_disconnected' || category === 'ai_output_format_error') {
    const targetAg = storeDoc.agents.find((a) => a.id === fixTargetAgent) || responsible;
    if (targetAg.engineMode === 'muse2api' && health.geminiConfigured) {
      targetAg.engineMode = 'muse2api_with_gemini_fallback';
      routeAdjustmentNote += `Kích hoạt cơ chế Gemini JSON Schema / dự phòng cho ${targetAg.name}. `;
    }
    if (category === 'muse_disconnected' && targetAg.boundAccountId !== 'auto' && health.healthyAccounts > 0) {
      targetAg.boundAccountId = 'auto';
      routeAdjustmentNote += `Chuyển ${targetAg.name} sang xoay vòng tài khoản Muse2API khỏe mạnh tự động. `;
    }
    targetAg.reconnectCount = (targetAg.reconnectCount || 0) + 1;
  }

  const isNonSceneRegenTask = Boolean(
    params.task &&
      ['plan_production', 'analyze_script', 'qa_inspect_scene', 'qa_inspect_image', 'design_character_ref', 'assemble_final_film'].includes(
        params.task.type
      ) &&
      category !== 'wrong_costume' &&
      !params.qaReport
  );

  const shouldRebuildKeyframe =
    Boolean(params.scene) &&
    !isNonSceneRegenTask &&
    (isCostumeLockWorkflow ||
      rule.rebuildKeyframe ||
      category === 'wrong_character' ||
      category === 'wrong_setting' ||
      (inc.attemptCount >= 2 && category !== 'ai_output_format_error'));

  const exactFixSummary =
    params.qaReport?.fixInstruction ||
    inc.technicalDiagnosis?.directorRemediationPlan ||
    `${rule.directive} ${
      params.scene
        ? `Khóa chặt Character ID (${mem.characters.map((c) => `${c.name}:${c.voiceId}`).join(', ')}), lời thoại "${params.scene.dialogue || 'không'}", timeline "${params.scene.videoTimeline || 'chuẩn'}".`
        : ''
    }`.trim();

  const fixTargetName = storeDoc.agents.find((a) => a.id === fixTargetAgent)?.name || fixTargetAgent;

  const directorDirective = isCostumeLockWorkflow
    ? `${routeAdjustmentNote}Lệnh khôi phục trang phục chuẩn từ ${chairmanName} (${inc.code} vòng #${inc.attemptCount}): Giao ${fixTargetName} truy xuất ảnh tham chiếu & hồ sơ gốc của "${cm?.characterName || 'nhân vật'}" (${cm?.characterId || ''}), khôi phục nguyên bản trang phục chính "${cm?.expectedCostume || mem.costumeBible}", làm sạch prompt nguồn, lưu bản Trước/Sau không ghi đè gốc và chỉ tạo lại đúng ${params.scene ? `Cảnh ${String(params.scene.index).padStart(2, '0')}` : 'ảnh nhân vật'}. Sau đó gửi ngay Muse AI 05 kiểm định độc lập trước khi dựng video.`
    : `${routeAdjustmentNote}${rule.directive} ${
        isNonSceneRegenTask && params.task
          ? `Chạy lại đúng bước "${getTaskTypeLabelVi(params.task.type)}" (${params.task.code}) với chuẩn JSON RFC 8259 nghiêm ngặt, giữ nguyên các cảnh/dữ liệu đã hoàn thành. Chi tiết: ${exactFixSummary}`
          : params.scene
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
        'chairman',
        `${chairmanName} khóa & làm sạch nguồn prompt trang phục Cảnh ${sc.index} (${inc.code} vòng #${inc.attemptCount})`,
        (m) => {
          sanitizeCostumeSourcesInMemory(m, {
            sceneId: sc.sceneId,
            characterId: cm?.characterId,
          });
          const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
          if (target && target.qaStatus !== 'passed') {
            target.qaStatus = 'rejected';
            target.retryCount += 1;
            target.assignedProducerAgentId = fixTargetAgent;
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
        'chairman',
        `${chairmanName} làm sạch thông số trang phục tham chiếu gốc (${inc.code} vòng #${inc.attemptCount})`,
        (m) => {
          sanitizeCostumeSourcesInMemory(m, { characterId: cm?.characterId });
        }
      );
    }

    const fixImgOwner = storeDoc.agents.find((a) => a.id === fixTargetAgent);
    if (fixImgOwner) fixImgOwner.regenCount = (fixImgOwner.regenCount || 0) + 1;

    const restoreTask = enqueueTask({
      runId: params.runId,
      type: 'restore_costume_and_regen_image',
      title: `[${inc.code} #${inc.attemptCount}] ${fixTargetName} khôi phục trang phục & tạo lại ${params.scene ? `ảnh Cảnh ${params.scene.index}` : `ảnh ${cm?.characterName || 'nhân vật'}`}`,
      instructions: directorDirective,
      assignedAgentId: fixTargetAgent,
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
      instructions: `Đối chiếu trực tiếp ảnh vừa khôi phục của ${fixTargetName} với ảnh tham chiếu gốc & hồ sơ gốc (${inc.code}). CHỈ ĐƯỢC phép sang dựng video khi trang phục chính & nhân vật đạt chuẩn (sai lệch <= 5%, loại trừ phụ kiện hợp lệ).`,
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

    // Rewire any unstarted downstream tasks (blocked_by_deps / queued) to wait for verifyImgQa instead of running with faulty costume!
    if (params.scene) {
      for (const t of storeDoc.tasks) {
        if (
          t.runId === params.runId &&
          t.sceneId === params.scene.sceneId &&
          t.type === 'produce_scene_video' &&
          ['blocked_by_deps', 'queued'].includes(t.status)
        ) {
          t.assignedAgentId = fixTargetAgent;
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
  } else if (isNonSceneRegenTask && params.task) {
    const retryAssignee: MuseAgentId | 'chairman' =
      params.task.assignedAgentId === 'chairman' ? 'chairman' : fixTargetAgent;
    const retryExactTask = enqueueTask({
      runId: params.runId,
      type: params.task.type,
      title: `[${inc.code} #${inc.attemptCount}] ${params.task.title}`,
      instructions: `${params.task.instructions}\nCHỈ ĐẠO ${chairmanName.toUpperCase()} (${inc.code}): ${directorDirective}`,
      assignedAgentId: retryAssignee,
      dependsOnTaskIds: params.task.dependsOnTaskIds,
      sceneId: params.task.sceneId,
      sceneIndex: params.task.sceneIndex,
      characterId: params.task.characterId,
      expectedMemoryVersion: mem.version,
      priority: Math.max(9, params.task.priority),
    });
    inc.remediationTaskIds.push(retryExactTask.id);
    if (params.task.type === 'qa_inspect_scene' || params.task.type === 'qa_inspect_image') {
      inc.qaVerificationTaskId = retryExactTask.id;
    }
    for (const downstream of storeDoc.tasks) {
      if (
        downstream.runId === params.runId &&
        downstream.status === 'blocked_by_deps' &&
        downstream.dependsOnTaskIds.includes(params.task.id)
      ) {
        downstream.dependsOnTaskIds = Array.from(
          new Set([...downstream.dependsOnTaskIds.filter((id) => id !== params.task?.id), retryExactTask.id])
        );
      }
    }
  } else if (params.scene) {
    const sc = params.scene;
    const producerId: MuseAgentId = fixTargetAgent;
    commitSessionMemoryUpdate(params.runId, 'chairman', `${chairmanName} chỉ đạo ${fixTargetName} sửa Cảnh ${sc.index} (${inc.code} vòng #${inc.attemptCount})`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target && target.qaStatus !== 'passed') {
        target.qaStatus = 'rejected';
        target.retryCount += 1;
        target.assignedProducerAgentId = producerId;
        if (params.qaReport) {
          target.qaScore = params.qaReport.overallScore;
          target.qaReportId = params.qaReport.id;
        }
      }
    });

    sc.productionStage = 'needs_regen';
    if (shouldRebuildKeyframe) {
      sc.imageValidated = false;
    }

    let fixDepTaskId: string | undefined;
    if (shouldRebuildKeyframe) {
      const fixImgOwner = storeDoc.agents.find((a) => a.id === producerId);
      if (fixImgOwner) fixImgOwner.regenCount = (fixImgOwner.regenCount || 0) + 1;
      const retryImg = enqueueTask({
        runId: params.runId,
        type: 'design_scene_image',
        title: `[${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: Tạo lại ảnh keyframe`,
        instructions: `${sc.actionDetail}. CHỈ ĐẠO ${chairmanName.toUpperCase()} (${inc.code}): ${directorDirective}`,
        assignedAgentId: producerId,
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        expectedMemoryVersion: mem.version,
        priority: 10,
      });
      inc.remediationTaskIds.push(retryImg.id);

      // When Hard Character Lock is active, gate video regen on Muse 05 Image QA
      if (mem.allowFreeCostumeChange !== true && mem.characters.length > 0) {
        const retryImgQa = enqueueTask({
          runId: params.runId,
          type: 'qa_inspect_image',
          title: `[Kiểm duyệt ảnh ${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: "${sc.title}"`,
          instructions: `Kiểm tra đồng nhất ảnh keyframe Cảnh ${sc.index} theo ngưỡng 5% trước khi dựng lại video (${inc.code}).`,
          assignedAgentId: 'muse-05',
          dependsOnTaskIds: [retryImg.id],
          sceneId: sc.sceneId,
          sceneIndex: sc.index,
          priority: 9,
        });
        inc.remediationTaskIds.push(retryImgQa.id);
        fixDepTaskId = retryImgQa.id;
      } else {
        fixDepTaskId = retryImg.id;
      }
    }

    const fixVidOwner = storeDoc.agents.find((a) => a.id === producerId);
    if (fixVidOwner) fixVidOwner.regenCount = (fixVidOwner.regenCount || 0) + 1;

    const retryVid = enqueueTask({
      runId: params.runId,
      type: 'produce_scene_video',
      title: `[${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: Tạo lại video`,
      instructions: `${sc.actionDetail}. CHỈ ĐẠO ${chairmanName.toUpperCase()} (${inc.code}): ${directorDirective}`,
      assignedAgentId: producerId,
      dependsOnTaskIds: fixDepTaskId ? [fixDepTaskId] : [],
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      expectedMemoryVersion: mem.version,
      priority: 9,
    });
    inc.remediationTaskIds.push(retryVid.id);

    const retryQa = enqueueTask({
      runId: params.runId,
      type: 'qa_inspect_scene',
      title: `[Kiểm duyệt ${inc.code} #${inc.attemptCount}] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `Kiểm định lại Cảnh ${sc.index} sau lệnh của ${chairmanName} (${inc.code}): ${exactFixSummary}`,
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
    const retryAssignee: MuseAgentId | 'chairman' =
      params.task.assignedAgentId === 'chairman' ? 'chairman' : fixTargetAgent;
    const fixTask = enqueueTask({
      runId: params.runId,
      type: params.task.type,
      title: `[${inc.code} #${inc.attemptCount}] ${params.task.title}`,
      instructions: `${params.task.instructions}\nCHỈ ĐẠO ${chairmanName.toUpperCase()} (${inc.code}): ${directorDirective}`,
      assignedAgentId: retryAssignee,
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
      title: `[${inc.code} #${inc.attemptCount}] Khắc phục sự cố theo lệnh ${chairmanName}`,
      instructions: `CHỈ ĐẠO ${chairmanName.toUpperCase()} (${inc.code}): ${directorDirective}\nLỗi gốc: ${inc.errorDescription}`,
      assignedAgentId: fixTargetAgent,
      priority: 9,
    });
    inc.remediationTaskIds.push(fixTask.id);
  }

  inc.assignedFixAgentId = fixTargetAgent;
  const fixAgent = storeDoc.agents.find((a) => a.id === fixTargetAgent) || responsible;
  const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];

  // Record Chairman Directive + Assigned Muse Response + Muse 05 QA standby
  appendIncidentTurn(inc, {
    actorId: 'chairman',
    actorName: chairmanName,
    roleBadge: 'Chủ tịch chỉ đạo',
    kind: 'directive',
    content: directorDirective,
  });
  appendIncidentTurn(inc, {
    actorId: fixAgent.id,
    actorName: `${fixAgent.name} (${fixAgent.roleTitle})`,
    roleBadge: 'Tiếp nhận lệnh',
    kind: 'progress',
    content: isCostumeLockWorkflow
      ? `Đã tiếp nhận lệnh khôi phục trang phục từ ${chairmanName}. Đang lấy lại trang phục chuẩn từ ảnh tham chiếu gốc của "${cm?.characterName || 'nhân vật'}", làm sạch prompt và vẽ lại riêng ${scNum} (vòng #${inc.attemptCount}/${maxAttempts}).`
      : `Đã tiếp nhận lệnh từ ${chairmanName}. Đang sửa thông số và tạo lại ${scNum} (vòng #${inc.attemptCount}/${maxAttempts}).`,
  });
  if (params.scene || isCostumeLockWorkflow) {
    appendIncidentTurn(inc, {
      actorId: qaAgent.id,
      actorName: `${qaAgent.name} (${qaAgent.roleTitle})`,
      roleBadge: 'Kiểm định chờ',
      kind: 'qa_review',
      content: isCostumeLockWorkflow
        ? `Đang chờ nhận ảnh đã khôi phục trang phục của ${fixAgent.name} để kiểm định độc lập với ảnh tham chiếu gốc trước khi mở khóa dựng video.`
        : `Chờ nhận phiên bản mới của ${scNum} để kiểm định lại 8 tiêu chí & ngưỡng 5% rồi báo cáo ${chairmanName}.`,
    });
  }

  postIncidentChannelMessage({
    inc,
    senderId: 'chairman',
    senderName: `${chairmanName} – Chỉ đạo`,
    roleBadge: 'Lệnh Chủ tịch',
    targetAgentIds: [fixAgent.id, 'muse-05'],
    content: directorDirective,
  });
  postIncidentChannelMessage({
    inc,
    senderId: fixAgent.id,
    senderName: `${fixAgent.name} – Phản hồi`,
    roleBadge: 'Phản hồi',
    targetAgentIds: ['chairman'],
    content: `Báo cáo ${chairmanName}: đã nhận lệnh. Đang sửa prompt/dữ liệu và thực hiện lại ${scNum} (vòng ${inc.attemptCount}/${maxAttempts}).`,
  });
  if (params.scene || isCostumeLockWorkflow) {
    postIncidentChannelMessage({
      inc,
      senderId: qaAgent.id,
      senderName: `${qaAgent.name} – Kiểm định`,
      roleBadge: 'Kiểm định',
      targetAgentIds: ['chairman'],
      content: isCostumeLockWorkflow
        ? `Báo cáo ${chairmanName}: chờ kiểm tra ảnh khôi phục trang phục của ${scNum} đối chiếu ảnh tham chiếu gốc.`
        : `Báo cáo ${chairmanName}: chờ nhận phiên bản mới của ${scNum} để kiểm định lại.`,
    });
  }

  postAiBusMessage({
    fromAgent: chairmanBus,
    toAgentIds: [fixAgent.id, 'muse-05'],
    runId: params.runId,
    projectId: mem.projectId,
    taskId: inc.remediationTaskIds[inc.remediationTaskIds.length - 1],
    sceneId: params.scene?.sceneId,
    content: `[CHAIRMAN→FIX ${inc.code} #${inc.attemptCount}] ${directorDirective}`,
  });

  // Keep run actively producing while Gemini AI – Chủ tịch self-heals
  if (run && !['completed', 'cancelled', 'paused'].includes(run.status)) {
    run.status = 'producing';
    run.error = undefined;
    run.updatedAt = Date.now();
    emitCommandCenterEvent('run:updated', run);
  }

  appendProjectCoordinationLog(params.runId, {
    actorId: 'chairman',
    actorName: chairmanName,
    targetAgentIds: [fixAgent.id, 'muse-05'],
    kind: 'remediation',
    runId: params.runId,
    taskId: params.task?.id,
    sceneId: params.scene?.sceneId,
    incidentId: inc.id,
    summary: `Chỉ đạo ${fixAgent.name} khắc phục ${scNum} (${inc.code} vòng #${inc.attemptCount}/${maxAttempts}) và giao Muse AI 05 kiểm định lại.`,
  });

  addActivityLog('warn', `Chủ tịch chỉ đạo ${inc.code}`, `${chairmanName} giao ${fixAgent.name} khắc phục ${scNum} (vòng ${inc.attemptCount}/${maxAttempts}).`, {
    agentId: 'chairman',
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
    const runningForAgent = runningTasks.filter((t) => t.assignedAgentId === agent.id);
    agent.activeTaskIds = runningForAgent.map((t) => t.id);
    agent.activeTaskCount = runningForAgent.length;
    agent.maxConcurrentTasks = getAgentEffectiveMaxConcurrency(agent, health);

    if (agent.paused) {
      agent.status = 'paused';
      agent.currentTaskId = undefined;
      agent.currentTaskSummary = undefined;
      continue;
    }
    if (runningForAgent.length > 0) {
      agent.status = agent.role === 'qa_supervisor' ? 'supervising' : 'working';
      agent.currentTaskId = runningForAgent[0].id;
      agent.currentTaskSummary =
        runningForAgent.length > 1
          ? `(${runningForAgent.length} tác vụ đa nhiệm) ${runningForAgent[0].code}: ${runningForAgent[0].title}`
          : `${runningForAgent[0].code}: ${runningForAgent[0].title}`;
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

  let firstErrMsg = '';
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
    firstErrMsg = 'JSON thiếu trường bắt buộc theo schema.';
  } catch (err: any) {
    firstErrMsg = String(err?.message || err || 'Lỗi cú pháp JSON');
    pushPerformanceAlert({
      severity: 'warn',
      category: 'format_error',
      agentId: params.agent.id,
      message: `${params.agent.name} trả về JSON chưa hợp chuẩn (${first.provider}): ${firstErrMsg.slice(0, 140)}`,
    });
  }

  const repairSystem = `${params.systemPrompt}${strictJsonRule}\nLƯU Ý SỬA LỖI: Phản hồi trước bị lỗi cú pháp JSON (${firstErrMsg}). Hãy xuất lại DUY NHẤT JSON hợp lệ, đầy đủ và hợp chuẩn.`;
  const repairUser = `Phản hồi trước chưa đạt chuẩn JSON hợp lệ:\n${first.text.slice(0, 6500)}\n\nDựa vào yêu cầu ban đầu sau đây, hãy xuất lại DUY NHẤT JSON chuẩn xác:\n${params.userPrompt.slice(0, 3500)}`;

  const second = await runAgentTextInference({
    agent: params.agent,
    systemPrompt: repairSystem,
    userPrompt: repairUser,
    jsonMode: true,
  });

  let secondErrMsg = '';
  try {
    const parsedSecond = parseAiBlueprintJsonSafe(second.text);
    if (!params.validate || params.validate(parsedSecond)) {
      return {
        parsed: parsedSecond,
        rawText: second.text,
        provider: second.provider,
        accountUsed: second.accountUsed,
      };
    }
    secondErrMsg = 'JSON sau lượt sửa vẫn thiếu trường bắt buộc.';
  } catch (err: any) {
    secondErrMsg = String(err?.message || err || 'Lỗi cú pháp JSON');
  }

  // Structural rescue pass via Gemini JSON Schema mode if Muse2API produced unparseable freeform text
  const health = await refreshIntegrationHealth(false);
  if (health.geminiConfigured && !second.provider.startsWith('gemini')) {
    try {
      const ai = getGeminiClient();
      const parts: any[] = [];
      for (const att of (params.attachments || []).slice(0, 4)) {
        const m = String(att || '').match(/^data:([^;]+);base64,(.+)$/);
        if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
      parts.push({ text: `${repairSystem}\n\n${repairUser}` });
      const candidates = prioritizeGeminiCandidateModels(['gemini-3.1-flash-lite', 'gemini-4-hydrogen']);
      for (const model of candidates) {
        try {
          const gRes = await retryWithGeminiBackoff(
            () =>
              ai.models.generateContent({
                model,
                contents: { parts },
                config: { responseMimeType: 'application/json' },
              }),
            [1000, 2200]
          );
          const gText = String(gRes.text || '').trim();
          if (gText) {
            const gParsed = parseAiBlueprintJsonSafe(gText);
            if (!params.validate || params.validate(gParsed)) {
              return {
                parsed: gParsed,
                rawText: gText,
                provider: `gemini-json-rescue (${model})`,
              };
            }
          }
        } catch (gErr: any) {
          markGeminiModelOverloaded(model, gErr);
          if (!shouldFallbackGeminiModel(gErr)) break;
        }
      }
    } catch {
      // fall through to rich error throw below
    }
  }

  throw new Error(`${secondErrMsg} [Engine: ${second.provider}]`);
}

// ==========================================
// TASK EXECUTION HANDLERS FOR 5 MUSE AI
// ==========================================

async function executePlanProductionTask(task: CommandTask, agent: MuseAgentConfig): Promise<void> {
  const mem = getRunMemory(task.runId);
  throwIfRunStopped(task.runId);
  const chairmanName = getChairmanDisplayName();
  const isChairmanTask = task.assignedAgentId === 'chairman';
  const sys = `Bạn là ${chairmanName} — Chủ tịch & Tổng chỉ huy toàn bộ hệ thống 5 Muse AI.
Cơ cấu đội ngũ thực tế:
- Chủ tịch & Tổng chỉ huy (Bạn - Gemini AI): phân tích kịch bản, khóa Project Memory, giao nhiệm vụ và giám sát sự cố.
- Bộ phận sản xuất Hình ảnh & Video (4 nhân viên chạy song song độc lập): Muse Director (Muse AI 01), Muse Producer 02 (Muse AI 02), Muse Producer 03 (Muse AI 03), Muse Producer 04 (Muse AI 04). Mỗi Muse tự làm trọn ảnh phân cảnh -> nối tiếp tạo video phân cảnh đó mà không phải chờ Muse khác.
- Kiểm định độc lập: Muse Guardian (Muse AI 05) — kiểm duyệt khóa nhân vật (ngưỡng <= 5% sau loại trừ phụ kiện được phép) và báo lỗi trực tiếp về Chủ tịch.
Trả về đúng JSON hợp lệ (không markdown) với cấu trúc:
{
  "projectTitle": "Tên phim ngắn gọn",
  "productionStrategyVi": "Tóm tắt kế hoạch phân công đa nhiệm cho 4 Muse sản xuất (Muse 01–04) và kiểm định Muse 05 (3-5 câu tiếng Việt)",
  "estimatedScenes": 4,
  "parallelGroupsNote": "Giải thích nhóm phân cảnh nào chạy song song và cảnh nào nối tiếp giữ nhân vật/bối cảnh",
  "continuityLockNotes": "Quy tắc khóa cứng nhân vật (mặt, tóc, vóc dáng, trang phục chính) & phụ kiện được phép cần khóa vào Project Memory"
}`;

  const allowFree = mem.allowFreeCostumeChange === true;
  const user = `Lệnh sản xuất & Kịch bản gốc từ người dùng:
${mem.originalScript}

Thông số dự án:
- Hình thức: ${mem.productionFormat === 'dialogue_film' ? 'Phim có lời thoại (đồng bộ nhân vật + khẩu hình)' : 'Phim thuyết minh kể chuyện'}
- Khung hình: ${mem.aspectRatio}
- Phong cách: ${mem.videoStyle}
- Khóa trang phục nhân vật tham chiếu: ${allowFree ? 'BẬT (cho phép đổi trang phục chính theo cảnh, vẫn khóa gương mặt/tóc/vóc dáng)' : `TẮT (KHÓA CỨNG ngoại hình & trang phục chính; chỉ cho phép bổ sung phụ kiện độc lập: ${ALLOWED_ACCESSORIES_LIST_VI})`}`;

  let parsed: any = {};
  let rawText = '';
  let usedProvider = 'gemini';
  let usedAccount = 'Gemini API (Chủ tịch)';

  if (isChairmanTask) {
    const ai = getGeminiClient();
    const resp = await retryWithGeminiBackoff(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: user,
          config: {
            systemInstruction: sys,
            responseMimeType: 'application/json',
          },
        }),
      [1500, 3200]
    );
    rawText = (resp.text || '').trim();
    parsed = parseAiBlueprintJsonSafe(rawText) || {};
  } else {
    const res = await runAgentJsonInference({
      agent,
      systemPrompt: sys,
      userPrompt: user,
    });
    parsed = res.parsed || {};
    rawText = res.rawText;
    usedProvider = res.provider;
    usedAccount = res.accountUsed || '';
  }

  throwIfRunStopped(task.runId);

  const projectTitle = String(parsed.projectTitle || mem.title || 'Dự án phim AI Muse').trim();
  const strategy = String(parsed.productionStrategyVi || rawText.slice(0, 500)).trim();
  const continuityLock = String(parsed.continuityLockNotes || '').trim();
  const estScenes = Math.max(2, Math.min(10, Number(parsed.estimatedScenes) || 4));

  const newMemVer = commitSessionMemoryUpdate(task.runId, 'chairman', `${chairmanName} lập kế hoạch sản xuất`, (m) => {
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

  task.executedByProvider = usedProvider;
  task.boundAccountUsed = usedAccount;
  task.outputText = strategy;

  const analyzeTask = enqueueTask({
    runId: task.runId,
    type: 'analyze_script',
    title: `${chairmanName} phân tích kịch bản & chia ${estScenes} phân cảnh cho 4 Muse sản xuất`,
    instructions: `Trực tiếp phân tích kịch bản "${projectTitle}" (${estScenes} phân cảnh), khóa hồ sơ nhân vật 5 thành phần, lời thoại, timeline và giao song song cho Muse AI 01, 02, 03, 04.`,
    assignedAgentId: 'chairman',
    dependsOnTaskIds: [task.id],
    priority: 9,
  });

  appendConversationMessage({
    channel: 'commander',
    projectId: mem.projectId,
    runId: task.runId,
    sessionId: task.runId,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Kế hoạch Chủ tịch',
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    taskId: task.id,
    messageKind: 'deliverable',
    content: `Đã lập kế hoạch sản xuất "${projectTitle}" (~${estScenes} phân cảnh).\n• Chiến lược: ${strategy}\n• Đã khóa Project Memory v${newMemVer} và bắt đầu bóc tách phân cảnh giao cho 4 nhân viên sản xuất (Muse AI 01, 02, 03, 04) + kiểm định độc lập Muse AI 05.`,
  });

  appendProjectCoordinationLog(task.runId, {
    actorId: 'chairman',
    actorName: chairmanName,
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    kind: 'directive',
    runId: task.runId,
    taskId: task.id,
    summary: `Lập kế hoạch sản xuất "${projectTitle}" (~${estScenes} cảnh), khóa Project Memory v${newMemVer}.`,
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
    throw new Error(`${agent.name} chưa trả về cấu trúc phân cảnh JSON hợp lệ.`);
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
  const targetMemVer = mem.version + 1;
  const normalizedScenes: CommandMemoryScene[] = rawScenes.map((s: any, idx: number) => {
    const sceneId = `scene_${idx + 1}`;
    const prevId = idx > 0 && s.dependsOnPreviousScene ? `scene_${idx}` : undefined;
    const producerId = PRODUCTION_AGENT_IDS[idx % PRODUCTION_AGENT_IDS.length];
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
      assignedProducerAgentId: producerId,
      productionStage: 'waiting_data',
      imageValidated: false,
      lockedPromptVersion: targetMemVer,
      qaStatus: 'pending',
      retryCount: 0,
      lastModifiedBy: 'chairman',
    };
  });

  // Gemini AI – Chairman validates & locks Project Memory version
  const chairmanName = getChairmanDisplayName();
  const newVer = commitSessionMemoryUpdate(
    task.runId,
    'chairman',
    `${chairmanName} khóa kịch bản (${normalizedScenes.length} cảnh, ${normalizedChars.length} nhân vật)`,
    (m) => {
      if (parsed.projectTitle && (!m.title || m.title === 'Dự án sản xuất mới')) {
        m.title = String(parsed.projectTitle).trim();
      }
      m.visualBible = String(m.visualBible || parsed.visualBible || '').trim();
      m.settingBible = String(m.settingBible || parsed.settingBible || '').trim();
      m.costumeBible = !allowFree && canonicalLockedCostumeBible ? canonicalLockedCostumeBible : String(parsed.costumeBible || m.costumeBible || '').trim();
      m.continuityBible = String(m.continuityBible || parsed.continuityBible || '').trim();
      m.characters = normalizedChars.length > 0 ? normalizedChars : m.characters;
      m.scenes = normalizedScenes.map((sc) => ({ ...sc, lockedPromptVersion: m.version + 1 }));
    }
  );

  const run = storeDoc.runs.find((r) => r.id === task.runId);
  if (run) {
    run.status = 'producing';
    run.sceneCount = normalizedScenes.length;
    run.updatedAt = Date.now();
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = `${chairmanName} đã bóc tách ${normalizedChars.length} nhân vật (5 thành phần) và ${normalizedScenes.length} phân cảnh, khóa Project Memory v${newVer} và phân công cho 4 Muse sản xuất (Muse AI 01–04).`;

  // Character Reference Sheet Tasks (ONLY for characters lacking confirmed ref images, distributed across Muse 01, 02, 03, 04)
  const charTaskIds: string[] = [];
  const charQaDeps: string[] = [];
  const charsToGenerate = normalizedChars.slice(0, 4);
  for (let ci = 0; ci < charsToGenerate.length; ci += 1) {
    const ch = charsToGenerate[ci];
    if (ch.artifactUrl || ch.dataUrl || ch.confirmedOriginalArtifactUrl) {
      continue;
    }
    const producerId = PRODUCTION_AGENT_IDS[ci % PRODUCTION_AGENT_IDS.length];
    const ct = enqueueTask({
      runId: task.runId,
      type: 'design_character_ref',
      title: `Tạo ảnh tham chiếu nhân vật: ${ch.name}`,
      instructions: `${ch.name}: ${ch.syncProfile.face}. Vóc dáng: ${ch.syncProfile.physique}. Trang phục: ${ch.syncProfile.costume}. Đặc điểm: ${ch.syncProfile.distinguishingMarks}`,
      assignedAgentId: producerId,
      dependsOnTaskIds: [task.id],
      characterId: ch.id,
      expectedMemoryVersion: newVer,
      priority: 8,
    });
    charTaskIds.push(ct.id);
    if (!allowFree) {
      const charQa = enqueueTask({
        runId: task.runId,
        type: 'qa_inspect_image',
        title: `Kiểm tra đồng nhất ảnh nhân vật: ${ch.name}`,
        instructions: `Đối chiếu ảnh nhân vật ${ch.name} với hồ sơ gốc "${getCharacterCanonicalCostume(ch)}" theo ngưỡng 5% trước khi tạo keyframe phân cảnh.`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [ct.id],
        characterId: ch.id,
        priority: 8,
      });
      charQaDeps.push(charQa.id);
    }
  }

  // Non-blocking Per-Scene Multitasking Pipeline across ALL 4 production Muses (Muse Director 01, Muse 02, 03, 04):
  const sceneVideoTaskBySceneId = new Map<string, string>();
  const qaTaskIds: string[] = [];
  const sceneImgDeps = !allowFree && charQaDeps.length > 0 ? charQaDeps : charTaskIds.length > 0 ? charTaskIds : [task.id];

  for (let si = 0; si < normalizedScenes.length; si += 1) {
    const sc = normalizedScenes[si];
    const producerId = sc.assignedProducerAgentId || PRODUCTION_AGENT_IDS[si % PRODUCTION_AGENT_IDS.length];
    const imgTask = enqueueTask({
      runId: task.runId,
      type: 'design_scene_image',
      title: `Cảnh ${sc.index}: Tạo ảnh keyframe "${sc.title}"`,
      instructions: `${sc.actionDetail}. Bối cảnh: ${sc.settingDetail}. Góc máy: ${sc.cameraAngle}. Ánh sáng: ${sc.lighting}.`,
      assignedAgentId: producerId,
      dependsOnTaskIds: sceneImgDeps,
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      expectedMemoryVersion: newVer,
      priority: 7,
    });

    const videoDeps: string[] = [];
    if (!allowFree && normalizedChars.length > 0) {
      const imgQaTask = enqueueTask({
        runId: task.runId,
        type: 'qa_inspect_image',
        title: `Kiểm định ảnh keyframe Cảnh ${sc.index}: "${sc.title}"`,
        instructions: `Đối chiếu ảnh keyframe Cảnh ${sc.index} với ảnh tham chiếu gốc & trang phục chính (tách phụ kiện hợp lệ, sai lệch <= 5%) trước khi mở khóa dựng video.`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [imgTask.id],
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 7,
      });
      videoDeps.push(imgQaTask.id);
    } else {
      videoDeps.push(imgTask.id);
    }
    if (sc.continuityAnchorFromSceneId && sceneVideoTaskBySceneId.has(sc.continuityAnchorFromSceneId)) {
      videoDeps.push(sceneVideoTaskBySceneId.get(sc.continuityAnchorFromSceneId)!);
    }

    const vidTask = enqueueTask({
      runId: task.runId,
      type: 'produce_scene_video',
      title: `Cảnh ${sc.index}: Quay & dựng video "${sc.title}" (${sc.durationSec}s)`,
      instructions: `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`,
      assignedAgentId: producerId,
      dependsOnTaskIds: videoDeps,
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      expectedMemoryVersion: newVer,
      priority: 6,
    });
    sceneVideoTaskBySceneId.set(sc.sceneId, vidTask.id);

    const qaTask = enqueueTask({
      runId: task.runId,
      type: 'qa_inspect_scene',
      title: `Kiểm định 8 tiêu chí & ngưỡng 5% Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `Đối chiếu Cảnh ${sc.index} với ảnh tham chiếu & Project Memory v${newVer} (tách phụ kiện được phép, kiểm tra ngưỡng <= 5%).`,
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
    instructions: `Tổng hợp toàn bộ phân cảnh đã đạt kiểm định Muse AI 05 thành video MP4 hoàn chỉnh và bàn giao.`,
    assignedAgentId: 'chairman',
    dependsOnTaskIds: qaTaskIds,
    priority: 1,
  });

  appendProjectCoordinationLog(task.runId, {
    actorId: 'chairman',
    actorName: chairmanName,
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    kind: 'directive',
    runId: task.runId,
    taskId: task.id,
    summary: `Bóc tách xong ${normalizedScenes.length} cảnh & ${normalizedChars.length} nhân vật (Memory v${newVer}), phân công song song cho 4 Muse sản xuất (Muse AI 01–04).`,
  });

  appendConversationMessage({
    channel: 'script',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
    targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    taskId: task.id,
    messageKind: 'deliverable',
    content: `${chairmanName} hoàn tất phân tích kịch bản (Memory v${newVer}):\n• ${normalizedChars.length} nhân vật chuẩn 5 thành phần (${normalizedChars.map((c) => c.name).join(', ')}).\n• ${normalizedScenes.length} phân cảnh phân phối trực tiếp cho 4 Muse sản xuất (Muse AI 01–04) song song; Muse AI 05 kiểm định độc lập.`,
  });

  appendConversationMessage({
    channel: 'production',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
    taskId: task.id,
    content: `Đã nạp ${normalizedScenes.length} phân cảnh và ${normalizedChars.length} nhân vật vào dây chuyền đa nhiệm (Memory v${newVer}).`,
  });

  postAiBusMessage({
    fromAgent: getChairmanBusActor(),
    toAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: task.id,
    content: `[CHAIRMAN→POOL] Memory v${newVer} đã khóa ${normalizedChars.length} nhân vật & ${normalizedScenes.length} cảnh. Muse AI 01–04 nhận việc song song (ảnh → Muse 05 kiểm định ảnh khi khóa nhân vật → video → Muse 05 kiểm định cuối).`,
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

  commitSessionMemoryUpdate(task.runId, 'chairman', `Lưu ảnh tham chiếu nhân vật ${ch.name} từ ${agent.name}`, (m) => {
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
  if (!saved || !isValidImageArtifactOnDisk(saved.url)) {
    throw new Error('Không lưu hoặc xác thực được ảnh keyframe phân cảnh trên đĩa.');
  }

  const newImgMemVer = commitSessionMemoryUpdate(task.runId, 'chairman', `Khóa keyframe Cảnh ${sc.index} từ ${agent.name}`, (m) => {
    const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
    if (target) {
      target.keyframeImageUrl = saved.url;
      target.keyframeArtifactName = saved.fileName;
      target.imageValidated = true;
      target.imageMemoryVersion = m.version + 1;
      target.productionStage = mem.allowFreeCostumeChange !== true && mem.characters.length > 0 ? 'image_ready' : 'waiting_video';
      target.assignedProducerAgentId = agent.id;
      target.lastModifiedBy = agent.id;
    }
  });

  // Update downstream unstarted produce_scene_video expectedMemoryVersion so it remains synced
  for (const downstreamTask of storeDoc.tasks) {
    if (
      downstreamTask.runId === task.runId &&
      downstreamTask.sceneId === sc.sceneId &&
      downstreamTask.type === 'produce_scene_video' &&
      ['blocked_by_deps', 'queued'].includes(downstreamTask.status)
    ) {
      downstreamTask.expectedMemoryVersion = newImgMemVer;
    }
  }

  // Ensure an image QA task exists when Hard Character Lock is ON (avoid duplicates if DAG already queued one)
  if (mem.allowFreeCostumeChange !== true && mem.characters.length > 0) {
    const hasPendingImgQa = storeDoc.tasks.some(
      (t) =>
        t.runId === task.runId &&
        t.sceneId === sc.sceneId &&
        t.type === 'qa_inspect_image' &&
        ['blocked_by_deps', 'queued', 'running'].includes(t.status)
    );
    if (!hasPendingImgQa) {
      enqueueTask({
        runId: task.runId,
        type: 'qa_inspect_image',
        title: `Kiểm tra đồng nhất ảnh Cảnh ${sc.index}: "${sc.title}"`,
        instructions: `Kiểm tra keyframe Cảnh ${sc.index} đối chiếu ảnh tham chiếu & trang phục chính (tách phụ kiện hợp lệ, sai lệch <= 5%).`,
        assignedAgentId: 'muse-05',
        dependsOnTaskIds: [task.id],
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        priority: 7,
      });
    }
  }

  task.executedByProvider = img.model;
  task.boundAccountUsed = agent.boundAccountId;
  task.outputArtifactUrl = saved.url;
  task.outputText =
    mem.allowFreeCostumeChange !== true && mem.characters.length > 0
      ? `Đã tạo & xác thực keyframe Cảnh ${sc.index} "${sc.title}" (${img.model}). Chuyển Muse AI 05 kiểm định ảnh trước khi dựng video.`
      : `Đã tạo & xác thực keyframe Cảnh ${sc.index} "${sc.title}" (${img.model}). Tiếp tục ngay sang tạo video.`;

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
    content:
      mem.allowFreeCostumeChange !== true && mem.characters.length > 0
        ? `Cảnh ${sc.index} "${sc.title}" đã hoàn tất keyframe (${img.model}). Gửi Muse AI 05 kiểm định đồng nhất nhân vật & trang phục chính (<= 5%) trước khi dựng video.`
        : `Cảnh ${sc.index} "${sc.title}" đã hoàn tất & xác thực keyframe (${img.model}). ${agent.name} tự động chuyển tiếp ngay sang dựng video cho cảnh này.`,
  });

  postAiBusMessage({
    fromAgent: agent,
    toAgentIds: mem.allowFreeCostumeChange === true ? [agent.id, 'chairman'] : ['muse-05', 'chairman'],
    runId: task.runId,
    projectId: mem.projectId,
    taskId: task.id,
    sceneId: sc.sceneId,
    content:
      mem.allowFreeCostumeChange === true
        ? `[IMAGE→VIDEO] ${agent.name} hoàn tất keyframe Cảnh ${sc.index} "${sc.title}" (Memory v${newImgMemVer}). Tiếp tục dựng video ngay.`
        : `[IMAGE→QA-GATE] ${agent.name} hoàn tất keyframe Cảnh ${sc.index} "${sc.title}" (Memory v${newImgMemVer}). Gửi Muse AI 05 kiểm định khóa nhân vật/trang phục trước khi dựng video.`,
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
    'chairman',
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
    if (!saved || !isValidImageArtifactOnDisk(saved.url)) {
      throw new Error('Không lưu hoặc xác thực được ảnh keyframe sau khi khôi phục trang phục.');
    }
    afterImageUrl = saved.url;
    usedModel = img.model;

    commitSessionMemoryUpdate(
      task.runId,
      'chairman',
      `Lưu ảnh keyframe Cảnh ${refreshedSc.index} sau khôi phục trang phục`,
      (m) => {
        const target = m.scenes.find((s) => s.sceneId === refreshedSc.sceneId);
        if (target) {
          target.keyframeImageUrl = saved.url;
          target.keyframeArtifactName = saved.fileName;
          target.imageValidated = true;
          target.imageMemoryVersion = m.version + 1;
          target.productionStage = 'waiting_video';
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
      'chairman',
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
      'chairman',
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
      targetAgentIds: ['muse-05', 'chairman'],
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
    toAgentIds: ['muse-05', 'chairman'],
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

  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — AI kiểm định độc lập dưới quyền Chủ tịch & Tổng chỉ huy Gemini AI.
Nhiệm vụ: Kiểm định ĐO LƯỜNG ĐƯỢC hình ảnh (${targetKind === 'scene_image' ? `Ảnh keyframe Cảnh ${sc?.index}` : `Ảnh nhân vật "${ch?.name}"`}) so với ảnh tham chiếu gốc & hồ sơ nhân vật bất biến trong Project Memory v${mem.version}.
${
  refDataUrls.length > 0
    ? `THỨ TỰ ẢNH ĐÍNH KÈM: ${refDataUrls.length} ảnh đầu là ẢNH THAM CHIẾU GỐC CHUẨN; ảnh CUỐI CÙNG là ảnh mới tạo cần kiểm tra.`
    : 'Ảnh đính kèm là ảnh cần đối chiếu chặt chẽ với hồ sơ nhân vật gốc bên dưới.'
}
QUY TẮC KIỂM ĐỊNH 3 LOẠI SAI LỆCH & NGƯỠNG 5% (BẮT BUỘC):
- Chế độ cho phép đổi trang phục chính đang: ${allowFreeCostumeChange ? 'BẬT' : 'TẮT (KHÓA CỨNG)'}.
- LOẠI A — Thay đổi phụ kiện độc lập được phép (${ALLOWED_ACCESSORIES_LIST_VI}): ĐƯỢC PHÉP thông qua (PASS_WITH_TOLERANCE) nếu KHÔNG làm biến đổi nhận dạng, khuôn mặt, vóc dáng hay cấu trúc trang phục chính.
- LOẠI B — Sai lệch tổng thể nhỏ <= 5% SAU KHI LOẠI TRỪ phụ kiện được phép: Cho phép thông qua (PASS_WITH_TOLERANCE) CHỈ KHI không có lỗi nghiêm trọng về khuôn mặt, vóc dáng hay trang phục chính (tách riêng từng thuộc tính!).
- LOẠI C — Sai lệch vượt giới hạn (BẮT BUỘC đánh FAIL ngay lập tức):
  1) Sai lệch tổng thể sau loại trừ phụ kiện được phép > 5%.
  2) Khuôn mặt / nhận dạng nhân vật bị thay đổi rõ rệt (faceDeviationPct > 5 hoặc criticalFaceError = true).
  3) Vóc dáng / tỷ lệ cơ thể bị biến đổi đáng kể (physiqueDeviationPct > 5 hoặc criticalPhysiqueError = true).
  4) ${allowFreeCostumeChange ? '(Chế độ đổi đồ đang BẬT)' : 'Trang phục chính bị thay đổi trái phép (mainCostumeDeviationPct > 5 hoặc criticalMainCostumeError = true).'}
  5) Phụ kiện làm biến đổi thiết kế trang phục chính hoặc nhận dạng nhân vật (accessoryDistortsIdentityOrCostume = true).
  LƯU Ý CHỐT KỸ THUẬT: Ngưỡng 5% là sai lệch tổng thể sau khi loại trừ phụ kiện được phép — KHÔNG phải quyền thay đổi 5% khuôn mặt hoặc trang phục chính; lỗi nghiêm trọng ở thuộc tính quan trọng PHẢI đánh FAIL kể cả khi điểm tổng thể <= 5%.
Trả về DUY NHẤT JSON:
{
  "verdictStatus": "PASS | PASS_WITH_TOLERANCE | FAIL",
  "overallScore": 96,
  "faceSimilarityScore": 97,
  "faceDeviationPct": 2.5,
  "physiqueSimilarityScore": 96,
  "physiqueDeviationPct": 2.0,
  "mainCostumeSimilarityScore": 97,
  "mainCostumeDeviationPct": 1.5,
  "overallDeviationExcludingAccessoriesPct": 2.0,
  "allowedAccessoryChanges": ["nhẫn vàng", "mũ"],
  "criticalFaceError": false,
  "criticalPhysiqueError": false,
  "criticalMainCostumeError": false,
  "accessoryDistortsIdentityOrCostume": false,
  "environmentalContextNote": "Đánh giá ảnh hưởng của góc máy, ánh sáng, tư thế, độ che khuất",
  "characterPassed": true,
  "costumePassed": true,
  "summary": "Nhận xét ngắn gọn bằng tiếng Việt (nêu rõ PASS / PASS WITH TOLERANCE / FAIL và tỷ lệ sai lệch %)",
  "affectedCharacterId": "${ch?.id || 'char_1'}",
  "affectedCharacterName": "${ch?.name || 'Nhân vật chính'}",
  "expectedCostume": "${getCharacterCanonicalCostume(ch) || mem.costumeBible}",
  "observedCostume": "Mô tả trang phục thực tế thấy trong ảnh kiểm tra",
  "mismatchDetails": "Mô tả cụ thể điểm sai lệch (rỗng nếu đạt)",
  "fixInstruction": "Chỉ dẫn khắc phục cụ thể nếu FAIL"
}`;

  const user = `THÔNG SỐ ĐỐI CHIẾU GỐC:
- Khóa trang phục chính: ${allowFreeCostumeChange ? 'BẬT (cho phép đổi theo cảnh, vẫn khóa mặt/tóc/vóc dáng)' : 'KHÓA CỨNG (chỉ loại trừ phụ kiện được phép)'}
- Hồ sơ nhân vật gốc bất biến:\n${charChecklist}
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
  const rawCharScore = Math.max(0, Math.min(100, Number(parsed.faceSimilarityScore ?? parsed.characterScore ?? parsed.overallScore ?? 92)));
  const rawCostumeScore = Math.max(0, Math.min(100, Number(parsed.mainCostumeSimilarityScore ?? parsed.costumeScore ?? parsed.overallScore ?? 92)));
  const consistency = evaluateMuse05CharacterConsistency({
    parsed,
    allowFreeCostumeChange,
    fallbackCharScore: rawCharScore,
    fallbackCostumeScore: rawCostumeScore,
  });
  const charScore = Math.round((consistency.metrics.faceSimilarityScore + consistency.metrics.physiqueSimilarityScore) / 2);
  const costumeScore = consistency.metrics.mainCostumeSimilarityScore;
  const overallScore = Number.isFinite(Number(parsed.overallScore))
    ? Math.max(0, Math.min(100, Math.round(Number(parsed.overallScore))))
    : Math.max(0, Math.min(100, Math.round(100 - consistency.metrics.overallDeviationExcludingAccessoriesPct)));
  const characterPassed = !consistency.characterViolated;
  const costumePassed = allowFreeCostumeChange ? true : !consistency.costumeViolated;
  const passed = consistency.passed && overallScore >= threshold;
  const finalVerdict: QaVerdictStatus = passed ? consistency.verdictStatus : 'FAIL';

  const matchedChar = matchCharacterForScene(
    mem,
    sc,
    String(parsed.affectedCharacterId || parsed.affectedCharacterName || ch?.id || '')
  );
  const mismatchText = String(
    parsed.mismatchDetails ||
      consistency.metrics.criticalViolationFlags.join('; ') ||
      parsed.summary ||
      'Ảnh kiểm tra vượt ngưỡng sai lệch 5% hoặc vi phạm thuộc tính nhân vật đã khóa.'
  ).trim();
  const responsibleProducerId: MuseAgentId =
    sc?.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(sc.assignedProducerAgentId)
      ? sc.assignedProducerAgentId
      : 'muse-03';
  const costumeMismatch =
    !passed && !allowFreeCostumeChange && !costumePassed
      ? buildCostumeMismatchReport({
          mem,
          runId: task.runId,
          targetMediaKind: targetKind,
          scene: sc,
          character: matchedChar || ch,
          responsibleAgentId: responsibleProducerId,
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
    verdictStatus: finalVerdict,
    deviationClass: passed ? consistency.deviationClass : 'type_c_exceeds_limit',
    consistencyMetrics: { ...consistency.metrics, verdictStatus: finalVerdict },
    threshold,
    targetMediaKind: targetKind,
    characterId: matchedChar?.id || ch?.id,
    costumeMismatch,
    criteriaResults: [
      {
        criterion: 'character',
        label: 'Nhân vật (Khuôn mặt, tóc, vóc dáng)',
        passed: characterPassed,
        score: charScore,
        note: `Mặt ${consistency.metrics.faceSimilarityScore}/100 (lệch ${consistency.metrics.faceDeviationPct}%) · Vóc dáng ${consistency.metrics.physiqueSimilarityScore}/100 (lệch ${consistency.metrics.physiqueDeviationPct}%)`,
      },
      {
        criterion: 'costume',
        label: 'Trang phục chính & Phụ kiện được phép',
        passed: costumePassed,
        score: costumeScore,
        note: `Trang phục chính ${costumeScore}/100 (lệch ${consistency.metrics.mainCostumeDeviationPct}%) · Tổng sai lệch sau loại trừ phụ kiện: ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%${consistency.metrics.allowedAccessoryChanges.length > 0 ? ` · Phụ kiện hợp lệ: ${consistency.metrics.allowedAccessoryChanges.join(', ')}` : ''}`,
      },
    ],
    timestampRange: sc ? `Keyframe 0s` : 'Ảnh tham chiếu',
    summary: `[${finalVerdict.replace(/_/g, ' ')} · lệch ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%] ${String(
      parsed.summary ||
        (passed
          ? `Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name || 'nhân vật'} đạt chuẩn khóa nhân vật`
          : `Phát hiện sai lệch vượt ngưỡng hoặc vi phạm khóa nhân vật: ${mismatchText}`)
    ).trim()}`,
    targetFixAgentId: passed
      ? undefined
      : responsibleProducerId === 'muse-01' ||
          responsibleProducerId === 'muse-02' ||
          responsibleProducerId === 'muse-03' ||
          responsibleProducerId === 'muse-04'
        ? responsibleProducerId
        : 'muse-03',
    fixInstruction: passed ? undefined : String(parsed.fixInstruction || costumeMismatch?.restoreRecommendation || mismatchText).trim(),
    attemptNumber: (sc?.retryCount || 0) + 1,
  };

  appendProjectCoordinationLog(task.runId, {
    actorId: 'muse-05',
    actorName: agent.name,
    targetAgentIds: [responsibleProducerId],
    kind: 'qa_report',
    runId: task.runId,
    taskId: task.id,
    sceneId: sc?.sceneId,
    summary: `QA Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name || ''}: ${finalVerdict} (${overallScore}/100, lệch ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%).`,
  });

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
    if (sc) {
      sc.imageValidated = true;
    }
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
        const sceneProducerId: MuseAgentId =
          sc.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(sc.assignedProducerAgentId)
            ? sc.assignedProducerAgentId
            : 'muse-04';
        const sceneProducerName = storeDoc.agents.find((a) => a.id === sceneProducerId)?.name || sceneProducerId;

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
          const fixVidOwner = storeDoc.agents.find((a) => a.id === sceneProducerId);
          if (fixVidOwner) fixVidOwner.regenCount = (fixVidOwner.regenCount || 0) + 1;
          const canonCst = getCharacterCanonicalCostume(matchedChar || ch) || sc.costume;
          const retryVid = enqueueTask({
            runId: task.runId,
            type: 'produce_scene_video',
            title: `[${openInc.code} #${openInc.attemptCount}] Cảnh ${sc.index}: Quay lại video từ ảnh đã sửa trang phục`,
            instructions: `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. KHÓA TRANG PHỤC CHUẨN: ${canonCst}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`,
            assignedAgentId: sceneProducerId,
            dependsOnTaskIds: [task.id],
            sceneId: sc.sceneId,
            sceneIndex: sc.index,
            expectedMemoryVersion: mem.version,
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
          content: `Ảnh khôi phục Cảnh ${sc.index} ĐẠT ${overallScore}/100 — trang phục chính & nhân vật khớp chuẩn. Đã báo cáo ${getChairmanDisplayName()} mở khóa cho ${sceneProducerName} dựng lại video Cảnh ${sc.index}.`,
        });
        postIncidentChannelMessage({
          inc: openInc,
          senderId: agent.id,
          senderName: `${agent.name} – Kiểm định ảnh`,
          roleBadge: 'Ảnh ĐẠT',
          targetAgentIds: ['chairman', sceneProducerId],
          attachments: targetImageUrl ? [targetImageUrl] : undefined,
          content: `[${openInc.code}] Ảnh Cảnh ${sc.index} đạt khớp chuẩn (${overallScore}/100). Chuyển ${sceneProducerName} dựng video Cảnh ${sc.index} (Task ${vidIdForBus || ''}).`,
        });
        emitCommandCenterEvent('incident:updated', openInc);
      } else {
        resolveIncidentRecord(
          openInc,
          agent,
          `Ảnh tham chiếu nhân vật "${matchedChar?.name || ch?.name}" đạt ${overallScore}/100 — trang phục đã khớp chuẩn hồ sơ gốc.`
        );
      }
    }

    postAiBusMessage({
      fromAgent: agent,
      toAgentIds: ['chairman', ...(sc?.assignedProducerAgentId ? [sc.assignedProducerAgentId] : (['muse-04'] as MuseAgentId[]))],
      runId: task.runId,
      projectId: mem.projectId,
      taskId: task.id,
      sceneId: sc?.sceneId,
      content: `[QA-IMG→PASS] Ảnh ${sc ? `Cảnh ${sc.index}` : matchedChar?.name} đạt ${overallScore}/100 (khớp trang phục gốc). Cho phép tiếp tục dây chuyền.`,
    });
    return;
  }

  // Image failed costume/character QA -> invalidate scene image flag, reject task & escalate immediately to Muse AI 01
  if (sc) {
    sc.imageValidated = false;
    sc.productionStage = 'needs_regen';
  }
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
    responsibleAgentId: costumeMismatch ? responsibleProducerId : 'muse-03',
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

  // Guard 1: Validate keyframe / image readiness and non-rejected costume status
  const hasValidKeyframe = isValidImageArtifactOnDisk(sc.keyframeImageUrl);
  if (sc.imageValidated === false) {
    throw new Error(`Cảnh ${sc.index} đang chờ tạo lại hoặc kiểm duyệt ảnh hợp lệ trước khi dựng video.`);
  }
  if (!hasValidKeyframe && !sc.continuityAnchorFromSceneId) {
    throw new Error(`Cảnh ${sc.index} chưa có tệp ảnh keyframe hợp lệ trên đĩa để chuyển sang dựng video.`);
  }
  if (mem.allowFreeCostumeChange !== true) {
    const hasOpenCostumeBlock = storeDoc.incidents.some(
      (i) =>
        i.runId === task.runId &&
        i.sceneId === sc.sceneId &&
        i.category === 'wrong_costume' &&
        !['resolved', 'escalated_to_user'].includes(i.status)
    );
    if (hasOpenCostumeBlock) {
      throw new Error(`Cảnh ${sc.index} đang có sự cố sai lệch trang phục chưa nghiệm thu xong — tạm hoãn dựng video.`);
    }
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

  // Guard 2: Refresh prompt from latest Project Memory if version moved forward since task enqueue
  const latestScenePrompt = `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. ${
    sc.costume ? `Trang phục: ${sc.costume}. ` : ''
  }${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`.trim();
  const basePromptText =
    task.expectedMemoryVersion && mem.version > task.expectedMemoryVersion
      ? `${latestScenePrompt}${
          task.instructions?.includes('CHỈ ĐẠO ĐẠO DIỄN TỔNG')
            ? ` ${task.instructions.slice(task.instructions.indexOf('CHỈ ĐẠO ĐẠO DIỄN TỔNG'))}`
            : ''
        }`
      : task.instructions || latestScenePrompt;

  const vidRes = await generateSceneVideoWithOmniFlash({
    engine,
    prompt: `${basePromptText}${sc.lighting ? `. Lighting: ${sc.lighting}` : ''}`,
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

  commitSessionMemoryUpdate(task.runId, 'chairman', `Khóa video Cảnh ${sc.index} từ ${agent.name}`, (m) => {
    const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
    if (target) {
      target.videoUrl = stableUrl;
      target.videoArtifactName = stableFile;
      target.videoAssetId = vidRes.assetId;
      target.probedDurationSec = vidRes.durationSec;
      target.hasAudioStream = vidRes.hasAudio;
      target.qaStatus = 'inspecting';
      target.productionStage = 'inspecting_qa';
      target.assignedProducerAgentId = agent.id;
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

  const sys = `Bạn là ${agent.name} (${agent.roleTitle}) — AI kiểm định độc lập dưới quyền Chủ tịch & Tổng chỉ huy Gemini AI.
Nhiệm vụ: Kiểm định ĐO LƯỜNG ĐƯỢC video đầu ra của Cảnh ${sc.index} dựa trên các khung hình trích xuất thực tế, ảnh tham chiếu nhân vật gốc và Project Memory v${mem.version}.
QUY TẮC KIỂM ĐỊNH 3 LOẠI SAI LỆCH & NGƯỠNG 5% (BẮT BUỘC):
1. TÁCH RIÊNG CÁC THUỘC TÍNH QUAN TRỌNG:
   - Độ tương đồng & % sai lệch khuôn mặt/nhận dạng (faceSimilarityScore, faceDeviationPct).
   - Độ tương đồng & % sai lệch vóc dáng/tỷ lệ cơ thể (physiqueSimilarityScore, physiqueDeviationPct).
   - Độ tương đồng & % sai lệch trang phục chính (mainCostumeSimilarityScore, mainCostumeDeviationPct).
   - Mức sai lệch tổng thể SAU KHI LOẠI TRỪ phụ kiện độc lập được phép (overallDeviationExcludingAccessoriesPct).
   - Xét điều kiện góc máy, ánh sáng, tư thế, độ che khuất (environmentalContextNote).
2. PHÂN LOẠI 3 LOẠI THAY ĐỔI:
   - LOẠI A — Phụ kiện độc lập được phép (${ALLOWED_ACCESSORIES_LIST_VI}): ĐƯỢC PHÉP thông qua (PASS_WITH_TOLERANCE) nếu KHÔNG làm biến đổi nhận dạng, ngoại hình hay cấu trúc trang phục chính.
   - LOẠI B — Sai lệch tổng thể nhỏ <= 5% sau loại trừ phụ kiện được phép: Thông qua (PASS_WITH_TOLERANCE) CHỈ KHI không có lỗi nghiêm trọng ở khuôn mặt, vóc dáng hoặc trang phục chính.
   - LOẠI C — Sai lệch vượt giới hạn (FAIL ngay lập tức, báo thẳng Chủ tịch Gemini AI):
     • overallDeviationExcludingAccessoriesPct > 5%.
     • Khuôn mặt / nhận dạng thay đổi rõ rệt (faceDeviationPct > 5 hoặc criticalFaceError = true).
     • Vóc dáng / tỷ lệ cơ thể biến đổi đáng kể (physiqueDeviationPct > 5 hoặc criticalPhysiqueError = true).
     • ${allowFreeCostumeChange ? '(Chế độ đổi trang phục chính đang BẬT)' : 'Trang phục chính bị thay đổi trái phép (mainCostumeDeviationPct > 5 hoặc criticalMainCostumeError = true) — bắt buộc điền object "costumeMismatch".'}
     • Phụ kiện làm biến đổi nhận dạng hoặc thiết kế trang phục chính (accessoryDistortsIdentityOrCostume = true).
   CHỐT KỸ THUẬT: Ngưỡng 5% KHÔNG cho phép tự ý đổi 5% khuôn mặt hoặc trang phục chính; bất kỳ lỗi nghiêm trọng nào ở thuộc tính khóa đều phải đánh FAIL kể cả khi điểm tổng thể <= 5%.
Trả về DUY NHẤT JSON hợp lệ:
{
  "verdictStatus": "PASS | PASS_WITH_TOLERANCE | FAIL",
  "overallScore": 92,
  "faceSimilarityScore": 96,
  "faceDeviationPct": 2.5,
  "physiqueSimilarityScore": 96,
  "physiqueDeviationPct": 2.0,
  "mainCostumeSimilarityScore": 97,
  "mainCostumeDeviationPct": 1.5,
  "overallDeviationExcludingAccessoriesPct": 2.0,
  "allowedAccessoryChanges": [],
  "criticalFaceError": false,
  "criticalPhysiqueError": false,
  "criticalMainCostumeError": false,
  "accessoryDistortsIdentityOrCostume": false,
  "environmentalContextNote": "Nhận xét về góc máy, ánh sáng, tư thế, độ che khuất",
  "timestampRange": "0s-${sc.durationSec}s",
  "summary": "Nhận xét ngắn gọn kết quả kiểm định",
  "targetFixAgentId": "muse-04",
  "fixInstruction": "Chỉ dẫn cụ thể để sửa lỗi nếu FAIL",
  "costumeMismatch": null,
  "criteria": [
    { "criterion": "character", "score": 95, "passed": true, "note": "..." },
    { "criterion": "costume", "score": 96, "passed": true, "note": "..." },
    { "criterion": "voice", "score": 88, "passed": true, "note": "..." },
    { "criterion": "dialogue", "score": 88, "passed": true, "note": "..." },
    { "criterion": "setting", "score": 90, "passed": true, "note": "..." },
    { "criterion": "motion", "score": 88, "passed": true, "note": "..." },
    { "criterion": "continuity", "score": 88, "passed": true, "note": "..." },
    { "criterion": "audio", "score": 86, "passed": true, "note": "..." }
  ]
}
(Khi phát hiện sai trang phục chính lúc đang khóa, đặt "costumeMismatch": { "characterId": "...", "characterName": "...", "expectedCostume": "...", "observedCostume": "...", "mismatchDetails": "mô tả chi tiết điểm sai khác" })`;

  const user = `THÔNG SỐ CHUẨN PROJECT MEMORY v${mem.version}:
- Thiết lập khóa trang phục: ${allowFreeCostumeChange ? 'TỰ DO ĐỔI THEO CẢNH (vẫn khóa mặt/tóc/vóc dáng)' : 'KHÓA CỨNG TRANG PHỤC CHÍNH THEO ẢNH THAM CHIẾU (chỉ loại trừ phụ kiện độc lập được phép)'}
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
    const score = Math.max(0, Math.min(100, Number(found?.score ?? parsed.overallScore ?? 85)));
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

  const charCrit = criteriaResults.find((c) => c.criterion === 'character');
  const costumeCrit = criteriaResults.find((c) => c.criterion === 'costume');
  const consistency = evaluateMuse05CharacterConsistency({
    parsed,
    allowFreeCostumeChange,
    fallbackCharScore: charCrit?.score ?? overallScore,
    fallbackCostumeScore: costumeCrit?.score ?? overallScore,
  });

  if (charCrit) {
    charCrit.passed = !consistency.characterViolated && charCrit.passed;
    charCrit.note = `${charCrit.note} · Mặt ${consistency.metrics.faceSimilarityScore}/100 (lệch ${consistency.metrics.faceDeviationPct}%) · Dáng ${consistency.metrics.physiqueSimilarityScore}/100 (lệch ${consistency.metrics.physiqueDeviationPct}%)`;
  }
  if (costumeCrit) {
    costumeCrit.passed = allowFreeCostumeChange ? true : !consistency.costumeViolated && costumeCrit.passed;
    costumeCrit.note = `${costumeCrit.note} · Trang phục chính ${consistency.metrics.mainCostumeSimilarityScore}/100 (lệch ${consistency.metrics.mainCostumeDeviationPct}%) · Tổng lệch sau loại trừ phụ kiện: ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%`;
  }

  const costumeLockedFailed = !allowFreeCostumeChange && (consistency.costumeViolated || Boolean(costumeCrit && !costumeCrit.passed));
  const hardLockFailed = !consistency.passed || consistency.characterViolated || costumeLockedFailed;

  const passed =
    !hardLockFailed &&
    overallScore >= threshold &&
    criteriaResults.filter((c) => !c.passed).length <= 1;
  const finalVerdict: QaVerdictStatus = passed ? consistency.verdictStatus : 'FAIL';

  const attemptNumber = sc.retryCount + 1;
  const sceneProducer: 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04' =
    sc.assignedProducerAgentId && PRODUCTION_AGENT_IDS.includes(sc.assignedProducerAgentId)
      ? (sc.assignedProducerAgentId as 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04')
      : 'muse-04';
  const targetFix: 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04' =
    costumeLockedFailed
      ? sceneProducer
      : parsed.targetFixAgentId === 'muse-01' ||
        parsed.targetFixAgentId === 'muse-02' ||
        parsed.targetFixAgentId === 'muse-03' ||
        parsed.targetFixAgentId === 'muse-04'
      ? parsed.targetFixAgentId
      : sceneProducer;

  const baseFixInstr = String(
    parsed.fixInstruction ||
      consistency.metrics.criticalViolationFlags.join('; ') ||
      'Bám sát ảnh tham chiếu nhân vật, khóa cứng khuôn mặt/vóc dáng/trang phục chính và timeline hành động trong Project Memory.'
  ).trim();
  const lockFixSuffix = hardLockFailed
    ? ` [KHÓA THAM CHIẾU <=5% BẮT BUỘC: ${consistency.metrics.criticalViolationFlags.join('; ') || 'Giữ nguyên nhân dạng & trang phục chính'}]`
    : '';

  let extractedFaultFrameUrl: string | undefined;
  if ((costumeLockedFailed || hardLockFailed) && extractedFrames[0]) {
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
        responsibleAgentId: sceneProducer,
        faultyArtifactUrl: extractedFaultFrameUrl || sc.keyframeImageUrl,
        faultyVideoUrl: sc.videoUrl,
        observedCostume: String(parsedCm?.observedCostume || '').trim() || undefined,
        mismatchDetails: String(
          parsedCm?.mismatchDetails ||
            consistency.metrics.criticalViolationFlags.join('; ') ||
            costumeCrit?.note ||
            parsed.summary ||
            `Trang phục chính trên video Cảnh ${sc.index} sai lệch vượt ngưỡng cho phép so với ảnh tham chiếu gốc.`
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
    verdictStatus: finalVerdict,
    deviationClass: passed ? consistency.deviationClass : 'type_c_exceeds_limit',
    consistencyMetrics: { ...consistency.metrics, verdictStatus: finalVerdict },
    threshold,
    criteriaResults,
    timestampRange: String(parsed.timestampRange || `0s-${sc.durationSec}s`),
    summary: `[${finalVerdict.replace(/_/g, ' ')} · lệch ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%] ${String(
      parsed.summary ||
        (passed
          ? 'Đạt chuẩn đồng nhất nhân vật & kịch bản'
          : hardLockFailed
          ? 'Vi phạm khóa nhân vật hoặc sai lệch vượt ngưỡng 5%'
          : 'Cần chỉnh sửa lại phân cảnh')
    ).trim()}`,
    targetFixAgentId: passed ? undefined : targetFix,
    fixInstruction: passed ? undefined : `${baseFixInstr}${lockFixSuffix}`,
    attemptNumber,
    targetMediaKind: 'scene_video',
    characterId: costumeMismatchReport?.characterId,
    costumeMismatch: costumeMismatchReport,
  };

  appendProjectCoordinationLog(task.runId, {
    actorId: 'muse-05',
    actorName: agent.name,
    targetAgentIds: [sceneProducer],
    kind: 'qa_report',
    runId: task.runId,
    taskId: task.id,
    sceneId: sc.sceneId,
    summary: `QA Video Cảnh ${sc.index}: ${finalVerdict} (${overallScore}/100, lệch ${consistency.metrics.overallDeviationExcludingAccessoriesPct}%).`,
  });

  storeDoc.qaReports.unshift(report);
  if (storeDoc.qaReports.length > 200) {
    storeDoc.qaReports = storeDoc.qaReports.slice(0, 200);
  }

  task.executedByProvider = res.provider;
  task.boundAccountUsed = res.accountUsed;
  task.outputText = `QA Cảnh ${sc.index}: ${overallScore}/100 (${passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}) — ${report.summary}`;

  if (passed) {
    commitSessionMemoryUpdate(task.runId, 'chairman', `Muse AI 05 duyệt Cảnh ${sc.index} (${overallScore}/100)`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sc.sceneId);
      if (target) {
        target.qaStatus = 'passed';
        target.qaScore = overallScore;
        target.qaReportId = report.id;
        target.productionStage = 'completed';
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
      toAgentIds: ['chairman'],
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
  sc.productionStage = 'needs_regen';
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

  const chairmanName = getChairmanDisplayName();
  appendConversationMessage({
    channel: 'commander',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
    taskId: task.id,
    messageKind: 'deliverable',
    attachments: [finalUrl],
    content: `${chairmanName} hoàn tất bàn giao bộ phim "${mem.title}" (${scenes.length} phân cảnh, ${Math.round(finalDur * 10) / 10}s) đạt kiểm định đồng nhất từ ${storeDoc.agents[4]?.name || 'Muse Guardian'}.`,
  });
  appendConversationMessage({
    channel: 'production',
    projectId: mem.projectId,
    runId: task.runId,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
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
  const isChairmanTask = task.assignedAgentId === 'chairman';
  const agent = isChairmanTask
    ? getChairmanVirtualAgent()
    : storeDoc.agents.find((a) => a.id === task.assignedAgentId);
  if (!agent) return;

  activeTaskIds.add(task.id);
  const now = Date.now();
  task.status = 'running';
  task.startedAt = now;
  task.error = undefined;
  const ackLatencyMs = Math.max(1, now - (task.acknowledgedAt || task.createdAt));

  if (task.sceneId) {
    if (task.type === 'design_scene_image' || task.type === 'restore_costume_and_regen_image') {
      setSceneProductionStage(task.runId, task.sceneId, 'creating_image');
    } else if (task.type === 'produce_scene_video') {
      setSceneProductionStage(task.runId, task.sceneId, 'creating_video');
    } else if (task.type === 'qa_inspect_scene') {
      setSceneProductionStage(task.runId, task.sceneId, 'inspecting_qa');
    }
  }

  if (!isChairmanTask) {
    agent.lastActiveAt = now;
    agent.lastError = undefined;
  }
  addActivityLog('info', `Bắt đầu ${task.code}`, `${agent.name} đang thực thi: ${task.title}`, {
    agentId: isChairmanTask ? 'chairman' : agent.id,
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
    if (!isChairmanTask) {
      agent.stats.completed += 1;
      agent.lastActiveAt = doneAt;
      recordAgentSample(agent.id, task.durationMs, ackLatencyMs);
    }

    const isTextTask = ['plan_production', 'analyze_script', 'qa_inspect_scene', 'qa_inspect_image', 'custom_task'].includes(task.type);
    if (!isChairmanTask && isTextTask && task.durationMs > SLOW_TEXT_THRESHOLD_MS) {
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
        agentId: isChairmanTask ? 'chairman' : agent.id,
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
    if (!isChairmanTask) {
      agent.stats.failed += 1;
      agent.lastError = errMsg;
    }

    if (!isChairmanTask && /offline|ngoại tuyến|cookie|chưa thể thực thi|ECONNREFUSED|timeout/i.test(errMsg)) {
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
      agentId: isChairmanTask ? 'chairman' : agent.id,
      taskId: task.id,
      runId: task.runId,
    });

    // Report urgently to Gemini AI – Chủ tịch for autonomous recovery (isolated per scene!)
    const mem = getRunMemory(task.runId);
    const sc = task.sceneId ? mem.scenes.find((s) => s.sceneId === task.sceneId) : undefined;
    if (sc) {
      sc.productionStage = 'needs_regen';
    }
    const preCategory = classifyIncidentCategory({ errorText: errMsg });
    const preDiag = diagnoseIncidentTechnicalDetails({
      rawError: errMsg,
      task,
      agent,
      scene: sc,
      category: preCategory,
    });
    const outcome = await openOrAdvanceDirectorIncident({
      runId: task.runId,
      task,
      scene: sc,
      reporterAgentId: isChairmanTask ? 'chairman' : agent.id,
      responsibleAgentId: isChairmanTask ? undefined : agent.id,
      explicitCategory: preCategory,
      errorDescription: preDiag.concreteErrorDescription,
      suspectedRootCause: preDiag.structuredRootCause,
      initialProposal: preDiag.actionableInitialProposal,
      severity: /offline|timeout|mất kết nối|chưa thể thực thi|503|504/i.test(errMsg) ? 'critical' : 'high',
      artifactUrls: task.outputArtifactUrl ? [task.outputArtifactUrl] : [],
    });

    if (outcome.escalated) {
      if (sc) sc.productionStage = 'failed';
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
    // Immediately advance Stage 2 -> Stage 3 or next ready tasks without waiting for 2s poll tick
    void tickOrchestratorQueue();
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
        const watchdogMuseId: MuseAgentId =
          task.assignedAgentId === 'chairman' ? 'muse-01' : task.assignedAgentId;
        pushPerformanceAlert({
          severity: 'error',
          category: 'hung_timeout',
          agentId: task.assignedAgentId === 'chairman' ? undefined : task.assignedAgentId,
          taskId: task.id,
          runId: task.runId,
          message: `Tác vụ ${task.code} (${ag?.name || getChairmanDisplayName()}) bị treo quá ${Math.round(limit / 1000)}s.`,
        });

        if (task.retryCount < task.maxRetries) {
          task.retryCount += 1;
          task.status = 'queued';
          task.startedAt = undefined;
          task.acknowledgedAt = now;
          task.error = undefined;
          if (ag) ag.reconnectCount = (ag.reconnectCount || 0) + 1;
          addActivityLog('warn', `Tự kết nối lại ${task.code}`, `${ag?.name || getChairmanDisplayName()} vượt timeout, đã xếp hàng chạy lại lần #${task.retryCount}.`, {
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
          if (sc) sc.productionStage = 'needs_regen';
          await openOrAdvanceDirectorIncident({
            runId: task.runId,
            task,
            scene: sc,
            reporterAgentId: watchdogMuseId,
            responsibleAgentId: watchdogMuseId,
            explicitCategory: 'muse_disconnected',
            errorDescription: `${task.code} (${ag?.name || getChairmanDisplayName()}) bị treo quá ${Math.round(limit / 1000)}s sau ${task.maxRetries} lần thử kết nối lại.`,
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

    // 2. Dispatch eligible queued tasks up to parallelLimit with per-agent multitasking & dynamic load balancing
    const maxParallel = Math.max(1, Math.min(8, storeDoc.cloudConfig.parallelLimit || 4));
    if (activeTaskIds.size >= maxParallel) return;

    const queued = storeDoc.tasks
      .filter((t) => t.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    if (queued.length === 0) return;

    const health = await refreshIntegrationHealth();
    const busyPinnedAccounts = new Set<string>();
    const activeByAgent = new Map<MuseAgentId | 'chairman', number>();
    for (const activeId of activeTaskIds) {
      const at = storeDoc.tasks.find((t) => t.id === activeId);
      if (!at) continue;
      activeByAgent.set(at.assignedAgentId, (activeByAgent.get(at.assignedAgentId) || 0) + 1);
      if (at.assignedAgentId !== 'chairman') {
        const ag = storeDoc.agents.find((a) => a.id === at.assignedAgentId);
        if (ag?.boundAccountId && ag.boundAccountId !== 'auto') {
          busyPinnedAccounts.add(ag.boundAccountId);
        }
      }
    }

    let slotsLeft = maxParallel - activeTaskIds.size;
    for (const task of queued) {
      if (slotsLeft <= 0) break;
      const run = storeDoc.runs.find((r) => r.id === task.runId);
      if (run && ['paused', 'cancelled'].includes(run.status)) continue;

      if (task.assignedAgentId === 'chairman') {
        const currentChairmanActive = activeByAgent.get('chairman') || 0;
        if (currentChairmanActive >= 2) continue;
        if (task.type !== 'assemble_final_film' && !health.geminiConfigured) {
          task.status = 'failed';
          task.error =
            'Gemini AI – Chủ tịch cần cấu hình GEMINI_API_KEY để phân tích kịch bản và điều phối 5 Muse AI. Vui lòng kiểm tra Settings > Secrets.';
          addActivityLog('error', `Không thể chạy ${task.code}`, task.error, {
            agentId: 'chairman',
            taskId: task.id,
            runId: task.runId,
          });
          saveStateAtomic();
          continue;
        }
        activeByAgent.set('chairman', currentChairmanActive + 1);
        slotsLeft -= 1;
        void runSingleTask(task);
        continue;
      }

      let agent = storeDoc.agents.find((a) => a.id === task.assignedAgentId);
      if (!agent) continue;

      let currentAgentActive = activeByAgent.get(agent.id) || 0;
      let agentMax = getAgentEffectiveMaxConcurrency(agent, health);

      // Dynamic load-balancing across ALL 4 production Muses (Muse Director 01, Muse 02, 03, 04) if assigned agent is full or paused
      const isRebalanceableMedia =
        PRODUCTION_AGENT_IDS.includes(agent.id) &&
        (task.type === 'design_scene_image' ||
          task.type === 'design_character_ref' ||
          (task.type === 'produce_scene_video' && agent.paused));

      if (
        isRebalanceableMedia &&
        (agent.paused ||
          currentAgentActive >= agentMax ||
          (agent.boundAccountId !== 'auto' && busyPinnedAccounts.has(agent.boundAccountId)))
      ) {
        const alternate = storeDoc.agents
          .filter(
            (cand) =>
              PRODUCTION_AGENT_IDS.includes(cand.id) &&
              cand.id !== agent!.id &&
              !cand.paused &&
              isAgentAccountReady(cand, health) &&
              (cand.boundAccountId === 'auto' || !busyPinnedAccounts.has(cand.boundAccountId)) &&
              (activeByAgent.get(cand.id) || 0) < getAgentEffectiveMaxConcurrency(cand, health)
          )
          .sort((a, b) => (activeByAgent.get(a.id) || 0) - (activeByAgent.get(b.id) || 0))[0];

        if (alternate) {
          const prevAgentId = agent.id;
          task.assignedAgentId = alternate.id;
          agent = alternate;
          currentAgentActive = activeByAgent.get(alternate.id) || 0;
          agentMax = getAgentEffectiveMaxConcurrency(alternate, health);

          // Keep same-producer Stage 2 -> Stage 3 affinity when a scene image is rebalanced
          if (task.sceneId && task.type === 'design_scene_image') {
            const mem = getRunMemory(task.runId);
            const sc = mem.scenes.find((s) => s.sceneId === task.sceneId);
            if (sc) sc.assignedProducerAgentId = alternate.id;
            for (const dt of storeDoc.tasks) {
              if (
                dt.runId === task.runId &&
                dt.sceneId === task.sceneId &&
                dt.type === 'produce_scene_video' &&
                ['blocked_by_deps', 'queued'].includes(dt.status)
              ) {
                dt.assignedAgentId = alternate.id;
              }
            }
          }
          addActivityLog(
            'info',
            `Cân bằng tải ${task.code}`,
            `${getChairmanDisplayName()} điều chuyển ${task.code} từ ${prevAgentId} sang ${alternate.name} đang rảnh để sản xuất song song.`,
            { agentId: 'chairman', taskId: task.id, runId: task.runId }
          );
        }
      }

      if (agent.paused) continue;
      if (currentAgentActive >= agentMax) continue;
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
        if (sc) sc.productionStage = 'needs_regen';
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

      if (currentAgentActive >= 1) {
        addActivityLog(
          'info',
          `Đa nhiệm song song ${task.code}`,
          `${agent.name} đang xử lý đồng thời ${currentAgentActive + 1} tác vụ (nhận tiếp ${task.code}).`,
          { agentId: agent.id, taskId: task.id, runId: task.runId }
        );
      }

      if (agent.boundAccountId !== 'auto') {
        busyPinnedAccounts.add(agent.boundAccountId);
      }
      activeByAgent.set(agent.id, currentAgentActive + 1);
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
      // Non-destructive role & multitasking model migration (preserve user custom edits where applicable)
      loadedAgents.forEach((ag, idx) => {
        const def = DEFAULT_AGENTS[idx];
        if (!def) return;
        if (ag.name === `Muse AI 0${idx + 1}`) ag.name = def.name;
        if (!ag.accentColor) ag.accentColor = def.accentColor;
        if (!ag.avatarPreset) ag.avatarPreset = def.avatarPreset;

        // Migrate legacy hierarchy -> Gemini AI Chairman + 4 Production Muses (Muse 01–04) + Independent QA (Muse 05)
        if (ag.id === 'muse-01') {
          ag.role = 'production_media';
          if (
            !ag.roleTitle ||
            /đạo diễn tổng|tổng đạo diễn/i.test(ag.roleTitle)
          ) {
            ag.roleTitle = def.roleTitle;
          }
          if (
            !ag.description ||
            /điều phối trưởng|tổng đạo diễn|đạo diễn tổng/i.test(ag.description)
          ) {
            ag.description = def.description;
          }
          ag.permissions = {
            ...def.permissions,
            canModifyProjectMemory: false,
            canApproveQa: false,
            canExecuteMedia: true,
          };
        } else if (
          PRODUCTION_AGENT_IDS.includes(ag.id) &&
          ['screenwriter', 'image_designer', 'video_director', 'production_media'].includes(ag.role)
        ) {
          ag.role = 'production_media';
          if (['Muse Script', 'Muse Visual', 'Muse Video'].includes(ag.name)) {
            ag.name = def.name;
          }
          if (!ag.roleTitle || ['Biên kịch', 'Thiết kế hình ảnh', 'Đạo diễn video'].includes(ag.roleTitle)) {
            ag.roleTitle = def.roleTitle;
          }
          if (
            !ag.description ||
            ag.description.includes('Phân tích kịch bản, hồ sơ') ||
            ag.description.includes('Tạo ảnh tham chiếu nhân vật') ||
            ag.description.includes('Sản xuất video phân cảnh theo timeline')
          ) {
            ag.description = def.description;
          }
          if (ag.id === 'muse-02' && ag.avatarPreset === 'script_feather') {
            ag.avatarPreset = def.avatarPreset;
          }
          ag.permissions = {
            ...def.permissions,
            canExecuteMedia: true,
            canModifyProjectMemory: false,
            canApproveQa: false,
          };
        } else if (ag.id === 'muse-05') {
          ag.role = 'qa_supervisor';
          ag.permissions = {
            ...def.permissions,
            ...(ag.permissions || {}),
            canApproveQa: true,
            canExecuteMedia: false,
          };
        }

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

      const rawChairman = raw.chairmanConfig || ({} as Partial<ChairmanConfig>);
      const defaultChairman = createDefaultChairmanConfig();
      const needsAutonomousUpgrade = !rawChairman.autonomousUpgraded;
      const migratedChairman: ChairmanConfig = {
        ...defaultChairman,
        ...rawChairman,
        autoExecuteRecommended: needsAutonomousUpgrade ? true : rawChairman.autoExecuteRecommended ?? true,
        autonomousUpgraded: true,
        name:
          !rawChairman.name || rawChairman.name === 'Chủ tịch Điều hành AI'
            ? defaultChairman.name
            : rawChairman.name,
        title:
          !rawChairman.title || rawChairman.title.includes('Chủ tịch Hội đồng Điều hành')
            ? defaultChairman.title
            : rawChairman.title,
      };

      storeDoc = {
        ...base,
        ...raw,
        agents: loadedAgents,
        chairmanConfig: migratedChairman,
        chairmanBriefings: Array.isArray(raw.chairmanBriefings) ? raw.chairmanBriefings.slice(0, 40) : [],
        projectMemory: loadedMem,
        sessionMemories: loadedSessionMemories,
        selectedRunId: raw.selectedRunId || firstRun?.id || null,
        latestStudioDirective: raw.latestStudioDirective || null,
        latestStudioBlueprint: raw.latestStudioBlueprint || null,
        runs: loadedRuns,
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        qaReports: Array.isArray(raw.qaReports) ? raw.qaReports : [],
        incidents: (Array.isArray(raw.incidents) ? raw.incidents : []).map((incItem) => {
          if (
            incItem &&
            !incItem.technicalDiagnosis &&
            /expected double-quoted property name|unexpected token.*json|unterminated string in json|syntaxerror/i.test(
              `${incItem.suspectedRootCause || ''} ${incItem.errorDescription || ''}`
            )
          ) {
            const relatedTask = (Array.isArray(raw.tasks) ? raw.tasks : []).find((t) => t.id === incItem.taskId);
            const relatedAgent = loadedAgents.find((a) => a.id === incItem.responsibleAgentId);
            const relatedMem = (incItem.runId && loadedSessionMemories[incItem.runId]) || loadedMem;
            const relatedScene = relatedMem?.scenes?.find((s) => s.sceneId === incItem.sceneId);
            const upDiag = diagnoseIncidentTechnicalDetails({
              rawError: incItem.suspectedRootCause || incItem.errorDescription,
              task: relatedTask,
              agent: relatedAgent,
              scene: relatedScene,
              category: 'ai_output_format_error',
            });
            return {
              ...incItem,
              category: 'ai_output_format_error' as IncidentCategory,
              categoryLabel: INCIDENT_SMART_RULES.ai_output_format_error.label,
              suspectedRootCause: upDiag.structuredRootCause,
              initialProposal: upDiag.actionableInitialProposal,
              technicalDiagnosis: upDiag.technicalDiagnosis,
            };
          }
          return incItem;
        }),
        conversations: migratedConversations,
        logs: Array.isArray(raw.logs) ? raw.logs : [],
        backups: Array.isArray(raw.backups) ? raw.backups : [],
        performanceAlerts: Array.isArray(raw.performanceAlerts) ? raw.performanceAlerts : [],
        fastCommStats: { ...base.fastCommStats, ...(raw.fastCommStats || {}) },
        cloudConfig: {
          ...base.cloudConfig,
          ...(raw.cloudConfig || {}),
          parallelLimit: Math.max(1, Math.min(8, Number(raw.cloudConfig?.parallelLimit || base.cloudConfig.parallelLimit))),
          perAgentConcurrencyLimit: Math.max(1, Math.min(3, Number(raw.cloudConfig?.perAgentConcurrencyLimit ?? 2))),
          workerBootId: WORKER_BOOT_ID,
        },
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
      if (t.sceneId) {
        const mem = getRunMemory(t.runId);
        const sc = mem.scenes.find((s) => s.sceneId === t.sceneId);
        if (sc) {
          if (sc.productionStage === 'creating_image') sc.productionStage = 'waiting_data';
          else if (sc.productionStage === 'creating_video') sc.productionStage = 'waiting_video';
        }
      }
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
    perAgentConcurrencyLimit: Math.max(1, Math.min(3, storeDoc.cloudConfig.perAgentConcurrencyLimit ?? 2)),
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
    chairmanConfig: storeDoc.chairmanConfig || createDefaultChairmanConfig(),
    chairmanBriefings: (storeDoc.chairmanBriefings || []).slice(0, 30),
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
        senderName: `Đồng bộ Studio → ${getChairmanDisplayName()}`,
        targetAgentIds: ['chairman', 'muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
        messageKind: 'ack',
        content: summaryText,
      });
    }
    addActivityLog('info', 'Đồng bộ chỉ thị từ Studio', `${actionLabelMap[params.sourceAction]}: "${resolvedTitle}" (${scenes.length} cảnh, ${chars.length} nhân vật).`, {
      agentId: 'chairman',
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

  const chairmanName = getChairmanDisplayName();
  if (hasPreSeededScenes) {
    // Gemini AI – Chairman locks Studio Blueprint & dispatches parallel production across all 4 production Muses (Muse 01–04)!
    const planTask = enqueueTask({
      runId,
      type: 'plan_production',
      title: `${chairmanName} tiếp nhận kịch bản Studio (${preSeededScenes.length} phân cảnh)`,
      instructions: script || title,
      assignedAgentId: 'chairman',
      priority: 10,
    });
    planTask.status = 'completed';
    planTask.completedAt = Date.now();
    planTask.executedByProvider = 'studio-blueprint';
    planTask.outputText = `${chairmanName} đã tiếp nhận kịch bản hoàn chỉnh từ Studio (${preSeededChars.length} nhân vật, ${preSeededScenes.length} phân cảnh), khóa dữ liệu nhân vật và phân công song song cho 4 Muse sản xuất (Muse AI 01–04).`;

    preSeededChars.forEach(ensureCharacterOriginalAnchors);

    // Character Reference Tasks (ONLY for characters lacking confirmed images, distributed across Muse 01, 02, 03, 04)
    const charTaskIds: string[] = [];
    const charQaDeps: string[] = [];
    const charsList = preSeededChars.slice(0, 4);
    for (let ci = 0; ci < charsList.length; ci += 1) {
      const ch = charsList[ci];
      if (!ch.artifactUrl && !ch.dataUrl && !ch.confirmedOriginalArtifactUrl) {
        const producerId = PRODUCTION_AGENT_IDS[ci % PRODUCTION_AGENT_IDS.length];
        const ct = enqueueTask({
          runId,
          type: 'design_character_ref',
          title: `Tạo ảnh tham chiếu nhân vật: ${ch.name}`,
          instructions: `${ch.name}: ${ch.syncProfile.face}. Vóc dáng: ${ch.syncProfile.physique}. Trang phục: ${ch.syncProfile.costume}.`,
          assignedAgentId: producerId,
          characterId: ch.id,
          expectedMemoryVersion: freshMemory.version,
          priority: 9,
        });
        charTaskIds.push(ct.id);
        if (!resolvedAllowFreeCostumeChange) {
          const cqa = enqueueTask({
            runId,
            type: 'qa_inspect_image',
            title: `Kiểm tra đồng nhất ảnh nhân vật: ${ch.name}`,
            instructions: `Đối chiếu ảnh nhân vật ${ch.name} với hồ sơ gốc "${getCharacterCanonicalCostume(ch)}" theo ngưỡng 5% trước khi tạo keyframe.`,
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

    for (let si = 0; si < preSeededScenes.length; si += 1) {
      const sc = preSeededScenes[si];
      const producerId = PRODUCTION_AGENT_IDS[si % PRODUCTION_AGENT_IDS.length];
      sc.assignedProducerAgentId = producerId;
      sc.lockedPromptVersion = freshMemory.version;

      const videoDeps: string[] = [];
      const hasValidPreSeededKf = isValidImageArtifactOnDisk(sc.keyframeImageUrl);
      const enforceImageQaGate = !resolvedAllowFreeCostumeChange && preSeededChars.length > 0;
      if (!hasValidPreSeededKf) {
        sc.imageValidated = false;
        sc.productionStage = 'waiting_data';
        const imgTask = enqueueTask({
          runId,
          type: 'design_scene_image',
          title: `Cảnh ${sc.index}: Tạo ảnh keyframe "${sc.title}"`,
          instructions: `${sc.actionDetail}. Bối cảnh: ${sc.settingDetail}. Góc máy: ${sc.cameraAngle}. Ánh sáng: ${sc.lighting}.`,
          assignedAgentId: producerId,
          dependsOnTaskIds: sceneImgDeps,
          sceneId: sc.sceneId,
          sceneIndex: sc.index,
          expectedMemoryVersion: freshMemory.version,
          priority: 8,
        });
        if (enforceImageQaGate) {
          const imgQaTask = enqueueTask({
            runId,
            type: 'qa_inspect_image',
            title: `Kiểm định đồng nhất ảnh Cảnh ${sc.index}: "${sc.title}"`,
            instructions: `Kiểm tra ảnh keyframe Cảnh ${sc.index} theo ngưỡng 5% (loại trừ phụ kiện hợp lệ) so với ảnh tham chiếu & trang phục chính trước khi dựng video.`,
            assignedAgentId: 'muse-05',
            dependsOnTaskIds: [imgTask.id],
            sceneId: sc.sceneId,
            sceneIndex: sc.index,
            priority: 7,
          });
          videoDeps.push(imgQaTask.id);
        } else {
          videoDeps.push(imgTask.id);
        }
      } else {
        sc.imageValidated = true;
        sc.imageMemoryVersion = freshMemory.version;
        sc.productionStage = enforceImageQaGate ? 'image_ready' : 'waiting_video';
        if (sceneImgDeps.length > 0) {
          videoDeps.push(...sceneImgDeps);
        }
        if (enforceImageQaGate) {
          const imgQaTask = enqueueTask({
            runId,
            type: 'qa_inspect_image',
            title: `Kiểm định đồng nhất ảnh Cảnh ${sc.index}: "${sc.title}"`,
            instructions: `Kiểm tra ảnh keyframe Cảnh ${sc.index} theo ngưỡng 5% (loại trừ phụ kiện hợp lệ) so với ảnh tham chiếu & hồ sơ gốc trước khi dựng video.`,
            assignedAgentId: 'muse-05',
            sceneId: sc.sceneId,
            sceneIndex: sc.index,
            priority: 7,
          });
          videoDeps.push(imgQaTask.id);
        }
      }

      if (sc.continuityAnchorFromSceneId && sceneVideoTaskBySceneId.has(sc.continuityAnchorFromSceneId)) {
        videoDeps.push(sceneVideoTaskBySceneId.get(sc.continuityAnchorFromSceneId)!);
      }

      // SAME producer handles Stage 3 (video) immediately after Stage 2 (image) completes!
      const vidTask = enqueueTask({
        runId,
        type: 'produce_scene_video',
        title: `Cảnh ${sc.index}: Quay & dựng video "${sc.title}" (${sc.durationSec}s)`,
        instructions: `${sc.actionDetail}. Timeline: ${sc.videoTimeline || 'chuyển động mượt liên tục'}. ${sc.dialogue ? `Lời thoại: ${sc.dialogue}` : ''}`,
        assignedAgentId: producerId,
        dependsOnTaskIds: videoDeps,
        sceneId: sc.sceneId,
        sceneIndex: sc.index,
        expectedMemoryVersion: freshMemory.version,
        priority: 6,
      });
      sceneVideoTaskBySceneId.set(sc.sceneId, vidTask.id);

      const qaTask = enqueueTask({
        runId,
        type: 'qa_inspect_scene',
        title: `Kiểm định 8 tiêu chí & ngưỡng 5% Cảnh ${sc.index}: "${sc.title}"`,
        instructions: `Đối chiếu Cảnh ${sc.index} với ảnh tham chiếu & Project Memory v${freshMemory.version}.`,
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
      instructions: `Tổng hợp toàn bộ phân cảnh đã đạt kiểm định Muse AI 05 thành video MP4 hoàn chỉnh và bàn giao.`,
      assignedAgentId: 'chairman',
      dependsOnTaskIds: qaTaskIds,
      priority: 1,
    });

    appendConversationMessage({
      channel: 'commander',
      projectId: freshMemory.projectId,
      runId,
      sessionId: runId,
      senderType: 'agent',
      senderId: 'chairman',
      senderName: chairmanName,
      senderColor: '#D97706',
      roleBadge: 'Lệnh Chủ tịch',
      targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
      taskId: planTask.id,
      messageKind: 'ack',
      content: `Đã tiếp nhận kịch bản đồng bộ từ Studio cho "${title}" (${preSeededChars.length} nhân vật, ${preSeededScenes.length} phân cảnh). Đã khóa Project Memory v${freshMemory.version} và phân công song song cho 4 nhân viên sản xuất (Muse Director 01, Muse 02, Muse 03, Muse 04 — mỗi AI chủ động Ảnh → Video). Muse AI 05 kiểm định độc lập theo ngưỡng 5% và báo cáo trực tiếp về Chủ tịch.`,
    });

    appendProjectCoordinationLog(runId, {
      actorId: 'chairman',
      actorName: chairmanName,
      targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
      kind: 'directive',
      runId,
      taskId: planTask.id,
      summary: `Tiếp nhận kịch bản Studio "${title}" (${preSeededScenes.length} cảnh) và phân công cho 4 Muse sản xuất (Muse 01–04).`,
    });

    addActivityLog(
      'info',
      'Chủ tịch tiếp nhận kịch bản Studio',
      `${chairmanName} đã phân công ${preSeededScenes.length} phân cảnh của "${title}" cho 4 Muse sản xuất (Muse AI 01–04).`,
      { agentId: 'chairman', runId }
    );
  } else {
    // Gemini AI – Chairman directly analyzes script & dispatches tasks to Muse 01–04 + Muse 05
    enqueueTask({
      runId,
      type: 'analyze_script',
      title: `${chairmanName} phân tích kịch bản & chia việc cho 5 Muse AI: ${title}`,
      instructions: `Trực tiếp phân tích kịch bản "${title}", khóa nhân vật 5 thành phần, lời thoại, timeline từng giây và phân công song song cho 4 Muse sản xuất (Muse AI 01, 02, 03, 04) cùng kiểm định Muse AI 05.\n\nKịch bản gốc:\n${script}`,
      assignedAgentId: 'chairman',
      expectedMemoryVersion: freshMemory.version,
      priority: 10,
    });

    appendProjectCoordinationLog(runId, {
      actorId: 'chairman',
      actorName: chairmanName,
      targetAgentIds: ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
      kind: 'directive',
      runId,
      summary: `Tiếp nhận lệnh sản xuất "${title}", khởi động bước phân tích kịch bản & phân công cho 4 Muse sản xuất.`,
    });

    addActivityLog(
      'info',
      'Khởi động dây chuyền dưới quyền Chủ tịch Gemini AI',
      `Phiên "${title}" đã được ${chairmanName} tiếp nhận phân tích kịch bản và điều phối cho 5 Muse AI.`,
      { agentId: 'chairman', runId }
    );
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
  const runTasks = storeDoc.tasks.filter((t) => t.runId === runId);

  if (action === 'pause') {
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error('Phiên sản xuất đã kết thúc nên không thể tạm dừng.');
    }
    if (run.status === 'idle') {
      throw new Error('Phiên sản xuất chưa chạy tác vụ nào nên chưa cần tạm dừng.');
    }
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
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error('Phiên sản xuất đã kết thúc hoặc đã hủy; hãy tạo phiên mới để chạy lại.');
    }
    if (runTasks.length === 0) {
      run.status = 'idle';
      run.pausedAt = undefined;
      run.error = undefined;
    } else if (runTasks.every((t) => t.status === 'completed')) {
      run.status = 'completed';
      run.pausedAt = undefined;
      run.error = undefined;
      run.completedAt = run.completedAt || Date.now();
    } else {
      // If resuming from failed / needs_attention, requeue failed tasks so execution actually continues
      if (run.status === 'failed' || run.status === 'needs_attention') {
        for (const t of runTasks) {
          if (t.status === 'failed' || t.status === 'qa_rejected') {
            t.status = 'queued';
            t.error = undefined;
            t.acknowledgedAt = Date.now();
          }
        }
      }
      const hasIncompletePlanning = runTasks.some(
        (t) =>
          (t.type === 'analyze_script' || t.type === 'plan_production') &&
          t.status !== 'completed' &&
          t.status !== 'cancelled'
      );
      const onlyAssemblyLeft =
        !hasIncompletePlanning &&
        runTasks.every(
          (t) =>
            t.type === 'assemble_final_film' ||
            t.status === 'completed' ||
            t.status === 'cancelled'
        ) &&
        runTasks.some((t) => t.type === 'assemble_final_film' && t.status !== 'completed');

      run.status = hasIncompletePlanning ? 'planning' : onlyAssemblyLeft ? 'assembling' : 'producing';
      run.pausedAt = undefined;
      run.error = undefined;
    }
    appendConversationMessage({
      channel: 'production',
      projectId: mem.projectId,
      runId,
      senderType: 'system',
      senderId: 'system',
      senderName: 'Điều khiển phiên',
      messageKind: 'ack',
      content:
        run.status === 'idle'
          ? `Phiên "${run.title}" chưa có tác vụ nào — đang ở trạng thái sẵn sàng chờ giao kịch bản.`
          : `Phiên "${run.title}" đã TIẾP TỤC chạy các tác vụ chưa hoàn thành (giữ nguyên toàn bộ kết quả đã xong).`,
    });
  } else if (action === 'cancel') {
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error('Phiên sản xuất đã hoàn thành hoặc đã hủy trước đó.');
    }
    run.status = 'cancelled';
    run.cancelledAt = Date.now();
    run.error = 'Phiên sản xuất đã bị hủy theo yêu cầu người dùng. Dữ liệu đã hoàn thành & backup vẫn được bảo toàn.';
    for (const t of runTasks) {
      if (t.status === 'queued' || t.status === 'blocked_by_deps' || t.status === 'running') {
        t.status = 'cancelled';
        t.completedAt = Date.now();
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
  if (action === 'resume' && run.status !== 'idle' && run.status !== 'completed') {
    void tickOrchestratorQueue();
  }
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
          assignedAgentId: 'chairman',
          priority: 1,
        });
      }
    }
  } else {
    const fixText = (instruction || '').trim() || 'Tạo lại phân cảnh này cho khớp gương mặt nhân vật, trang phục và hành động kịch bản.';
    commitSessionMemoryUpdate(runId, 'user', `Người dùng yêu cầu tạo lại Cảnh ${sc.index}`, (m) => {
      const target = m.scenes.find((s) => s.sceneId === sceneId);
      if (target) {
        target.qaStatus = 'rejected';
        target.productionStage = 'needs_regen';
      }
    });
    const freshMem = getRunMemory(runId);
    const vidTask = enqueueTask({
      runId,
      type: 'produce_scene_video',
      title: `[Làm lại thủ công] Cảnh ${sc.index}: "${sc.title}"`,
      instructions: `${sc.actionDetail}. YÊU CẦU: ${fixText}`,
      assignedAgentId: sc.assignedProducerAgentId || 'muse-04',
      sceneId: sc.sceneId,
      sceneIndex: sc.index,
      expectedMemoryVersion: freshMem.version,
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

const DEFAULT_AGENT_BY_CHANNEL: Record<string, MuseAgentId | 'chairman'> = {
  commander: 'chairman',
  chairman: 'chairman',
  incident: 'chairman',
  production: 'chairman',
  script: 'chairman',
  visual: 'muse-02',
  video: 'muse-04',
  qa: 'muse-05',
  ai_bus: 'chairman',
};

export async function sendCommandCenterChat(params: {
  channel: CommunicationChannelId | 'group';
  message: string;
  targetAgentId?: MuseAgentId | 'chairman';
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
  const responderId: MuseAgentId | 'chairman' = isDm
    ? (channel as MuseAgentId)
    : params.targetAgentId || DEFAULT_AGENT_BY_CHANNEL[channel] || 'chairman';

  appendConversationMessage({
    channel,
    projectId: mem.projectId,
    runId,
    sessionId: runId,
    sceneId: params.sceneId,
    senderType: 'user',
    senderId: 'user',
    senderName: 'Người dùng (Chỉ đạo)',
    targetAgentIds: isDm ? [channel as MuseAgentId] : ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'],
    attachments,
    content: text || '(Đã gửi tệp đính kèm)',
  });

  const recentHistory = storeDoc.conversations
    .filter((m) => m.channel === channel)
    .slice(-10)
    .map((m) => `${m.senderName}: ${m.content}`)
    .join('\n');

  const studioDirectiveNote = storeDoc.latestStudioDirective
    ? `\nChỉ thị mới nhất đồng bộ từ Studio (${storeDoc.latestStudioDirective.sourceAction}): "${storeDoc.latestStudioDirective.title}" · ${storeDoc.latestStudioDirective.characterCount} nhân vật, ${storeDoc.latestStudioDirective.sceneCount} phân cảnh.\nNội dung chỉ thị Studio:\n${storeDoc.latestStudioDirective.scriptOrCommand.slice(0, 1200)}`
    : '';
  const memoryScenesNote =
    mem.scenes.length > 0
      ? `\nCác phân cảnh trong Project Memory v${mem.version}:\n${mem.scenes
          .slice(0, 10)
          .map(
            (s) =>
              `- [${s.sceneId}] Cảnh ${s.index}: ${s.title} (stage: ${s.productionStage || 'pending'}, QA: ${s.qaStatus}, phụ trách: ${s.assignedProducerAgentId || 'chưa giao'}) — ${s.actionDetail.slice(0, 90)}`
          )
          .join('\n')}`
      : '';
  const openIncidentsList = storeDoc.incidents.filter((i) => i.status !== 'resolved').slice(0, 6);
  const openIncidentsNote =
    openIncidentsList.length > 0
      ? `\nSự cố đang mở (${openIncidentsList.length}):\n${openIncidentsList
          .map(
            (i) =>
              `- [${i.code}] (${i.status}, vòng ${i.attemptCount}/${i.maxAttempts}, phụ trách: ${i.assignedFixAgentId}) ${i.categoryLabel}: ${i.errorDescription.slice(0, 130)}`
          )
          .join('\n')}`
      : '\nHiện không có sự cố tồn đọng.';

  const inlineImageAttachments = attachments
    .map((att) => (att.startsWith('data:image/') ? att : artifactUrlToDataUrl(att)))
    .filter((x): x is string => Boolean(x && x.startsWith('data:image/')));

  // === TWO-WAY COMMAND EXECUTION BY GEMINI AI – CHAIRMAN & SUPREME COMMANDER ===
  if (responderId === 'chairman') {
    const chairmanName = getChairmanDisplayName();
    const health = await refreshIntegrationHealth(false);
    if (!health.geminiConfigured) {
      throw new Error(
        'Chưa cấu hình GEMINI_API_KEY nên Gemini AI – Chủ tịch chưa thể điều hành qua Chat Room. Hãy kiểm tra Settings > Secrets.'
      );
    }

    const teamStatusText = storeDoc.agents
      .map(
        (a) =>
          `- ${a.id} (${a.name} · ${a.roleTitle}): status=${a.status}, completed=${a.stats.completed}, failed=${a.stats.failed}, task=${a.currentTaskSummary || 'rảnh'}`
      )
      .join('\n');

    const startedAt = Date.now();
    const ai = getGeminiClient();
    const parts: any[] = [];
    for (const dataUrl of inlineImageAttachments.slice(0, 3)) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    parts.push({
      text: `Lịch sử kênh #${channel} gần đây:\n${recentHistory}\n\nTrạng thái 5 Muse AI:\n${teamStatusText}${memoryScenesNote}${openIncidentsNote}${studioDirectiveNote}\n\nChỉ đạo mới nhất từ người dùng:\n${text || 'Xem tệp đính kèm và chỉ đạo 5 Muse AI.'}`,
    });

    const resp = await retryWithGeminiBackoff(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: `Bạn là ${chairmanName} — Chủ tịch & Tổng chỉ huy toàn bộ hệ thống 5 Muse AI.
Cơ cấu nhân sự thực tế:
- Muse AI 01 (muse-01 · Muse Director): Nhân viên Sản xuất Hình ảnh & Video.
- Muse AI 02, 03, 04 (muse-02, muse-03, muse-04): Nhân viên Sản xuất Hình ảnh & Video song song.
- Muse AI 05 (muse-05 · Muse Guardian): Kiểm định độc lập (ngưỡng sai lệch tổng thể <= 5% sau loại trừ phụ kiện được phép).

Bạn có quyền THỰC SỰ điều phối trong Chat Room:
1. Trả lời trực tiếp, sắc bén cho người dùng trong "replyToUser".
2. Khi cần giao việc, hỏi tiến độ, chất vấn lỗi, yêu cầu sửa prompt/ảnh/video hoặc chỉ đạo kiểm định lại: thêm danh sách "museDirectives" (tối đa 3 lệnh). Hệ thống sẽ gửi thật chỉ thị xuống kênh riêng của từng Muse, tự tạo Task nếu có "enqueueTaskType", và gọi Muse trả lời thật nếu "askMuseToReply": true.
3. Không giả lập kết quả nếu chưa chạy. Trả về JSON đúng schema.`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyToUser: { type: Type.STRING },
                museDirectives: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      targetAgentId: { type: Type.STRING },
                      directiveMessage: { type: Type.STRING },
                      askMuseToReply: { type: Type.BOOLEAN },
                      enqueueTaskType: { type: Type.STRING },
                      taskTitle: { type: Type.STRING },
                      taskInstructions: { type: Type.STRING },
                      sceneId: { type: Type.STRING },
                    },
                    required: ['targetAgentId', 'directiveMessage'],
                  },
                },
              },
              required: ['replyToUser'],
            },
          },
        }),
      [1200, 2600]
    );

    const parsed = parseAiBlueprintJsonSafe((resp.text || '').trim()) || {};
    const replyText = String(parsed.replyToUser || resp.text || '').trim();
    if (!replyText) {
      throw new Error('Gemini AI – Chủ tịch không trả về nội dung phản hồi. Vui lòng thử lại.');
    }

    const directives: any[] = Array.isArray(parsed.museDirectives) ? parsed.museDirectives.slice(0, 3) : [];
    const createdTaskCodes: string[] = [];
    const targetedMuseIds: MuseAgentId[] = [];
    const activeRunIdForTasks = runId || storeDoc.runs[0]?.id || 'manual_run';

    for (const d of directives) {
      const targetId = normalizeMuseId(d?.targetAgentId, 'muse-01');
      const targetAgent = storeDoc.agents.find((a) => a.id === targetId);
      const dirMsg = String(d?.directiveMessage || '').trim();
      if (!targetAgent || !dirMsg) continue;
      targetedMuseIds.push(targetId);

      let createdTask: CommandTask | undefined;
      const rawTaskType = String(d?.enqueueTaskType || '').trim() as CommandTaskType;
      const allowedTaskTypes: CommandTaskType[] = [
        'design_character_ref',
        'design_scene_image',
        'restore_costume_and_regen_image',
        'produce_scene_video',
        'qa_inspect_image',
        'qa_inspect_scene',
        'custom_task',
      ];
      if (rawTaskType && allowedTaskTypes.includes(rawTaskType)) {
        const effectiveAgent: MuseAgentId =
          rawTaskType === 'qa_inspect_image' || rawTaskType === 'qa_inspect_scene'
            ? 'muse-05'
            : targetId === 'muse-05'
            ? 'muse-03'
            : targetId;
        const matchedSc = d?.sceneId
          ? mem.scenes.find((s) => s.sceneId === d.sceneId)
          : params.sceneId
          ? mem.scenes.find((s) => s.sceneId === params.sceneId)
          : undefined;
        createdTask = enqueueTask({
          runId: activeRunIdForTasks,
          type: rawTaskType,
          title: String(d?.taskTitle || `[Lệnh Chủ tịch] ${dirMsg.slice(0, 68)}`).trim(),
          instructions: String(d?.taskInstructions || dirMsg).trim(),
          assignedAgentId: effectiveAgent,
          sceneId: matchedSc?.sceneId,
          sceneIndex: matchedSc?.index,
          expectedMemoryVersion: mem.version,
          allowMultipleVariants: rawTaskType === 'custom_task',
          priority: 9,
        });
        createdTaskCodes.push(`${createdTask.code}→${effectiveAgent}`);
      }

      // Deliver official Chairman directive directly into the target Muse's DM channel
      appendConversationMessage({
        channel: targetId,
        projectId: mem.projectId,
        runId,
        sessionId: runId,
        sceneId: d?.sceneId || params.sceneId,
        taskId: createdTask?.id,
        senderType: 'agent',
        senderId: 'chairman',
        senderName: chairmanName,
        senderColor: '#D97706',
        roleBadge: createdTask ? `Giao ${createdTask.code}` : 'Chỉ thị Chủ tịch',
        targetAgentIds: [targetId],
        content: `[CHỈ THỊ TỪ ${chairmanName.toUpperCase()}${createdTask ? ` · ${createdTask.code}` : ''}]\n${dirMsg}`,
      });

      appendProjectCoordinationLog(runId, {
        actorId: 'chairman',
        actorName: chairmanName,
        targetAgentIds: [targetId],
        kind: 'directive',
        runId,
        taskId: createdTask?.id,
        sceneId: d?.sceneId || params.sceneId,
        summary: `Chỉ đạo ${targetAgent.name}: ${dirMsg.slice(0, 200)}`,
      });

      // Live two-way response from the directed Muse AI (no fake response if unreachable)
      if (d?.askMuseToReply) {
        try {
          const museInf = await runAgentTextInference({
            agent: targetAgent,
            systemPrompt: `Bạn là ${targetAgent.name} (${targetAgent.roleTitle}) thuộc đội 5 Muse AI dưới quyền chỉ huy trực tiếp của ${chairmanName}. Trả lời ngắn gọn (2-4 câu tiếng Việt), xác nhận hoặc giải trình rõ ràng theo dữ liệu thật của dự án "${mem.title}" (Memory v${mem.version}).`,
            userPrompt: `Chỉ thị từ ${chairmanName}:\n${dirMsg}${createdTask ? `\nMã nhiệm vụ được giao: ${createdTask.code}` : ''}`,
          });
          targetAgent.lastActiveAt = Date.now();
          appendConversationMessage({
            channel: targetId,
            projectId: mem.projectId,
            runId,
            sessionId: runId,
            sceneId: d?.sceneId || params.sceneId,
            taskId: createdTask?.id,
            senderType: 'agent',
            senderId: targetAgent.id,
            senderName: `${targetAgent.name} (${targetAgent.roleTitle})`,
            roleBadge: 'Phản hồi Chủ tịch',
            content: museInf.text,
          });
          if (channel !== targetId) {
            appendConversationMessage({
              channel,
              projectId: mem.projectId,
              runId,
              sessionId: runId,
              sceneId: d?.sceneId || params.sceneId,
              taskId: createdTask?.id,
              senderType: 'agent',
              senderId: targetAgent.id,
              senderName: `${targetAgent.name} (${targetAgent.roleTitle})`,
              roleBadge: 'Báo cáo Chủ tịch',
              content: museInf.text,
            });
          }
          appendProjectCoordinationLog(runId, {
            actorId: targetAgent.id,
            actorName: targetAgent.name,
            kind: 'response',
            runId,
            taskId: createdTask?.id,
            sceneId: d?.sceneId || params.sceneId,
            summary: `${targetAgent.name} phản hồi Chủ tịch: ${museInf.text.slice(0, 180)}`,
          });
        } catch (museErr: any) {
          const errNote = String(museErr?.message || museErr || 'Không thể kết nối Muse AI.');
          appendConversationMessage({
            channel: targetId,
            projectId: mem.projectId,
            runId,
            sessionId: runId,
            taskId: createdTask?.id,
            senderType: 'system',
            senderId: 'system',
            senderName: 'Hệ thống giám sát',
            roleBadge: 'Cảnh báo kết nối',
            content: `${targetAgent.name} chưa phản hồi chỉ thị của ${chairmanName}: ${errNote}`,
          });
        }
      }
    }

    if (createdTaskCodes.length > 0) {
      void tickOrchestratorQueue();
    }

    const respMs = Math.max(1, Date.now() - startedAt);
    const footerNote =
      targetedMuseIds.length > 0
        ? `\n\n— Đã chuyển chỉ thị trực tiếp tới: ${Array.from(new Set(targetedMuseIds)).map((id) => id.toUpperCase()).join(', ')}${createdTaskCodes.length > 0 ? ` · Tạo nhiệm vụ: ${createdTaskCodes.join(', ')}` : ''}.`
        : '';

    const reply = appendConversationMessage({
      channel,
      projectId: mem.projectId,
      runId,
      sessionId: runId,
      sceneId: params.sceneId,
      senderType: 'agent',
      senderId: 'chairman',
      senderName: chairmanName,
      senderColor: '#D97706',
      roleBadge: 'Chủ tịch · Tổng chỉ huy',
      targetAgentIds: targetedMuseIds.length > 0 ? Array.from(new Set(targetedMuseIds)) : undefined,
      promptDelivered: text,
      content: `${replyText}${footerNote}`,
    });

    addActivityLog('info', `Chủ tịch chỉ đạo #${channel}`, `${chairmanName} phản hồi (${respMs}ms)${createdTaskCodes.length > 0 ? ` · giao ${createdTaskCodes.join(', ')}` : ''}.`, {
      agentId: 'chairman',
      runId,
    });
    saveStateAtomic();
    return { state: await getCommandCenterState(false), reply };
  }

  // === DIRECT MUSE AI RESPONSE ===
  const responder = storeDoc.agents.find((a) => a.id === responderId) || storeDoc.agents[0];
  const channelContextDesc: Record<string, string> = {
    commander: 'Kênh #tổng-chỉ-huy (lệnh điều hành toàn đội dưới quyền Chủ tịch Gemini AI)',
    incident: 'Kênh #incident-command (Trung tâm sự cố — báo cáo trực tiếp cho Chủ tịch Gemini AI)',
    production: 'Kênh #sản-xuất-phim (theo dõi tiến độ 4 Muse sản xuất & kiểm định Muse 05)',
    script: 'Kênh #kịch-bản (kịch bản, nhân vật khóa cứng, thoại & timeline)',
    visual: 'Kênh #hình-ảnh (thiết kế nhân vật, tạo ảnh keyframe)',
    video: 'Kênh #video (dựng video phân cảnh, prompt chuyển động)',
    qa: 'Kênh #kiểm-duyệt (kiểm định 5% & báo cáo lỗi về Chủ tịch Gemini AI)',
    ai_bus: 'Kênh #trao-đổi-ai (phối hợp giữa các AI)',
  };

  const sys = `Bạn là ${responder.name} (${responder.roleTitle}) trong Phòng Điều Hành AI Muse dưới quyền chỉ huy trực tiếp của ${getChairmanDisplayName()}.
Vai trò: ${responder.description}
Dự án/Phiên hiện tại: "${mem.title}" (Project Memory v${mem.version}, ${mem.characters.length} nhân vật, ${mem.scenes.length} cảnh).${studioDirectiveNote}${memoryScenesNote}${openIncidentsNote}
${
  isDm
    ? 'Bạn đang trao đổi riêng 1-1 trong Chat Room. Hãy trả lời bám sát dữ liệu dự án hiện tại và tuân thủ khóa nhân vật.'
    : `Bạn đang phản hồi trong ${channelContextDesc[channel] || channel}. Hãy trả lời ngắn gọn, bám sát đúng chuyên môn và dữ liệu thực tế của phiên.`
}`;

  const startedAt = Date.now();
  const inf = await runAgentTextInference({
    agent: responder,
    systemPrompt: sys,
    userPrompt: `Lịch sử kênh gần đây:\n${recentHistory}\n\nYêu cầu mới nhất:\n${text || 'Xem tệp đính kèm và phản hồi.'}`,
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

  appendProjectCoordinationLog(runId, {
    actorId: responder.id,
    actorName: responder.name,
    kind: 'response',
    runId,
    sceneId: params.sceneId,
    summary: `Phản hồi tại #${channel}: ${inf.text.slice(0, 180)}`,
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

function resolveSafeFileInDir(baseDir: string, rawName: string, extSuffix = ''): string | null {
  const baseName = path.basename(String(rawName || '')).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!baseName || baseName === '.' || baseName === '..' || baseName.includes('..')) {
    return null;
  }
  const finalName = extSuffix && !baseName.endsWith(extSuffix) ? `${baseName}${extSuffix}` : baseName;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, finalName);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

export async function restoreBackupById(backupId: string): Promise<CommandCenterState> {
  const fp = resolveSafeFileInDir(BACKUPS_DIR, backupId, '.json');
  if (!fp || !fs.existsSync(fp)) {
    throw new Error('Không tìm thấy tệp sao lưu để khôi phục.');
  }
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  createBackupSnapshot('pre_restore', `Sao lưu tự động trước khi khôi phục ${path.basename(fp, '.json')}`);

  if (Array.isArray(data.agents) && data.agents.length === 5) storeDoc.agents = data.agents;
  if (data.projectMemory) storeDoc.projectMemory = data.projectMemory;
  if (Array.isArray(data.runs)) storeDoc.runs = data.runs;
  if (Array.isArray(data.tasks)) storeDoc.tasks = data.tasks;
  if (Array.isArray(data.qaReports)) storeDoc.qaReports = data.qaReports;
  if (Array.isArray(data.conversations)) storeDoc.conversations = data.conversations;

  addActivityLog('warn', 'Khôi phục từ Backup', `Đã khôi phục toàn bộ trạng thái từ ${path.basename(fp, '.json')}.`);
  saveStateAtomic();
  return getCommandCenterState(false);
}

export function getBackupExportFilePath(backupId: string): string | null {
  const fp = resolveSafeFileInDir(BACKUPS_DIR, backupId, '.json');
  return fp && fs.existsSync(fp) ? fp : null;
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

  const chairmanName = getChairmanDisplayName();
  const msg = String(params.message || '').trim();

  if (params.action === 'resolve') {
    const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];
    if (inc.sceneId) {
      commitSessionMemoryUpdate(inc.runId, 'chairman', `Nghiệm thu & đóng sự cố ${inc.code}`, (m) => {
        const sc = m.scenes.find((s) => s.sceneId === inc.sceneId);
        if (sc) sc.qaStatus = 'passed';
      });
    }
    resolveIncidentRecord(
      inc,
      qaAgent,
      msg || `Người dùng / ${chairmanName} xác nhận nghiệm thu hoàn tất và đóng sự cố ${inc.code}.`
    );
  } else if (params.action === 'escalate') {
    inc.status = 'escalated_to_user';
    inc.withinAutonomyScope = false;
    inc.escalationReason = msg || 'Được đánh dấu cần sự can thiệp trực tiếp của người dùng.';
    appendIncidentTurn(inc, {
      actorId: 'chairman',
      actorName: chairmanName,
      roleBadge: 'Báo cáo ngoại lệ',
      kind: 'escalation',
      content: inc.escalationReason,
    });
    postIncidentChannelMessage({
      inc,
      senderId: 'chairman',
      senderName: `${chairmanName} – Báo cáo khẩn`,
      roleBadge: 'Cần can thiệp',
      content: inc.escalationReason,
    });
  } else {
    // 'directive' or 'reopen': reset attempt budget if escalated and let Gemini AI – Chủ tịch execute a new remediation round
    if (inc.status === 'escalated_to_user' || params.action === 'reopen') {
      inc.attemptCount = Math.max(0, inc.maxAttempts - 1);
      inc.chairmanTakeoverCount = 0;
      inc.status = 'remediating';
      inc.escalationReason = undefined;
    }
    const mem = getRunMemory(inc.runId);
    const sc = inc.sceneId ? mem.scenes.find((s) => s.sceneId === inc.sceneId) : undefined;
    const task = inc.taskId ? storeDoc.tasks.find((t) => t.id === inc.taskId) : undefined;
    if (msg) {
      appendIncidentTurn(inc, {
        actorId: 'user',
        actorName: 'Người dùng (Chủ dự án)',
        roleBadge: 'Chỉ đạo bổ sung',
        kind: 'directive',
        content: msg,
      });
      postIncidentChannelMessage({
        inc,
        senderId: 'user',
        senderName: 'Người dùng (Chủ dự án)',
        roleBadge: 'Chỉ đạo',
        targetAgentIds: ['chairman', params.targetAgentId || inc.assignedFixAgentId],
        content: msg,
      });
    }
    await openOrAdvanceDirectorIncident({
      incidentId: inc.id,
      runId: inc.runId,
      task,
      scene: sc,
      reporterAgentId: 'chairman',
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
  perAgentConcurrencyLimit?: number;
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
    storeDoc.cloudConfig.parallelLimit = Math.max(1, Math.min(8, Math.round(patch.parallelLimit)));
  }
  if (typeof patch.perAgentConcurrencyLimit === 'number') {
    storeDoc.cloudConfig.perAgentConcurrencyLimit = Math.max(1, Math.min(3, Math.round(patch.perAgentConcurrencyLimit)));
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
    `Muse2API: ${storeDoc.cloudConfig.muse2ApiBaseUrl || 'mặc định'} · Song song tổng: ${storeDoc.cloudConfig.parallelLimit} · Đa nhiệm/Muse: ${storeDoc.cloudConfig.perAgentConcurrencyLimit ?? 2} · Ngưỡng QA: ${storeDoc.cloudConfig.qaPassThreshold} · Vòng sự cố tối đa: ${storeDoc.cloudConfig.maxIncidentRetries ?? 3}`
  );
  saveStateAtomic();
  return getCommandCenterState(true);
}

export function resolveArtifactDiskPath(filename: string): string | null {
  const fp = resolveSafeFileInDir(ARTIFACTS_DIR, filename);
  return fp && fs.existsSync(fp) ? fp : null;
}

// ==========================================
// EXECUTIVE CHAIRMAN AI — SUPREME COMMAND OVER 5 MUSE AI
// ==========================================

const chairmanAnalyzingIncidents = new Set<string>();

const VALID_CHAIRMAN_ACTIONS: ChairmanActionType[] = [
  'patch_and_retry',
  'switch_engine_and_retry',
  'reassign_muse',
  'fix_scene_memory_and_regen',
  'adjust_qa_and_approve',
  'reset_stuck_run',
  'direct_briefing',
];

const VALID_MUSE_IDS: MuseAgentId[] = ['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'];

function normalizeMuseId(val: any, fallback: MuseAgentId = 'muse-01'): MuseAgentId {
  const s = String(val || '').trim().toLowerCase() as MuseAgentId;
  return VALID_MUSE_IDS.includes(s) ? s : fallback;
}

function normalizeChairmanAction(val: any): ChairmanActionType {
  const s = String(val || '').trim() as ChairmanActionType;
  return VALID_CHAIRMAN_ACTIONS.includes(s) ? s : 'patch_and_retry';
}

export async function updateChairmanConfig(patch: Partial<ChairmanConfig>): Promise<CommandCenterState> {
  if (!storeDoc.chairmanConfig) {
    storeDoc.chairmanConfig = createDefaultChairmanConfig();
  }
  if (typeof patch.enabled === 'boolean') storeDoc.chairmanConfig.enabled = patch.enabled;
  if (typeof patch.autoInterveneOnIncident === 'boolean') {
    storeDoc.chairmanConfig.autoInterveneOnIncident = patch.autoInterveneOnIncident;
  }
  if (typeof patch.autoExecuteRecommended === 'boolean') {
    storeDoc.chairmanConfig.autoExecuteRecommended = patch.autoExecuteRecommended;
  }
  if (typeof patch.strictOversightMode === 'boolean') {
    storeDoc.chairmanConfig.strictOversightMode = patch.strictOversightMode;
  }
  if (typeof patch.name === 'string' && patch.name.trim()) {
    storeDoc.chairmanConfig.name = patch.name.trim().slice(0, 80);
  }
  if (typeof patch.title === 'string' && patch.title.trim()) {
    storeDoc.chairmanConfig.title = patch.title.trim().slice(0, 140);
  }

  addActivityLog(
    'info',
    'Cập nhật quyền hạn Chủ tịch Điều hành AI',
    `Kích hoạt: ${storeDoc.chairmanConfig.enabled ? 'Bật' : 'Tắt'} · Tự tiếp quản sự cố: ${
      storeDoc.chairmanConfig.autoInterveneOnIncident ? 'Bật' : 'Tắt'
    } · Tự quyết & thực thi không chờ duyệt: ${storeDoc.chairmanConfig.autoExecuteRecommended ? 'Bật' : 'Tắt'}`,
    { agentId: 'chairman' }
  );
  saveStateAtomic();
  return getCommandCenterState(false);
}

function buildChairmanContextDigest(params: {
  inc?: IncidentRecord;
  run?: ProductionRun | null;
  health: MuseIntegrationHealth;
  userRequest?: string;
}): string {
  const runId = params.inc?.runId || params.run?.id || getEffectiveSelectedRunId();
  const mem = runId ? getRunMemory(runId) : storeDoc.projectMemory;
  const runTasks = runId ? storeDoc.tasks.filter((t) => t.runId === runId) : storeDoc.tasks.slice(-25);
  const failedOrActiveTasks = runTasks
    .filter((t) => ['failed', 'qa_rejected', 'running', 'queued', 'blocked_by_deps'].includes(t.status))
    .slice(-16)
    .map((t) => ({
      code: t.code,
      type: t.type,
      agent: t.assignedAgentId,
      status: t.status,
      sceneIndex: t.sceneIndex,
      retries: `${t.retryCount}/${t.maxRetries}`,
      error: t.error?.slice(0, 260),
      title: t.title,
    }));

  const openIncidents = storeDoc.incidents
    .filter((i) => i.status !== 'resolved')
    .slice(0, 8)
    .map((i) => ({
      code: i.code,
      status: i.status,
      severity: i.severity,
      category: i.categoryLabel,
      responsible: i.responsibleAgentId,
      assignedFix: i.assignedFixAgentId,
      sceneIndex: i.sceneIndex,
      attempts: `${i.attemptCount}/${i.maxAttempts}`,
      errorDescription: i.errorDescription.slice(0, 280),
      escalationReason: i.escalationReason?.slice(0, 220),
    }));

  const agentsSummary = storeDoc.agents.map((a) => ({
    id: a.id,
    name: a.name,
    roleTitle: a.roleTitle,
    status: a.status,
    paused: a.paused,
    engineMode: a.engineMode,
    boundAccountId: a.boundAccountId,
    completed: a.stats.completed,
    failed: a.stats.failed,
    lastError: a.lastError?.slice(0, 200),
    currentTask: a.currentTaskSummary?.slice(0, 120),
  }));

  const targetScene = params.inc?.sceneId
    ? mem.scenes.find((s) => s.sceneId === params.inc!.sceneId)
    : undefined;

  const payload = {
    userRequest: params.userRequest || null,
    integrationHealth: {
      muse2ApiStatus: params.health.muse2ApiStatus,
      healthyAccounts: params.health.healthyAccounts,
      accountsCount: params.health.accountsCount,
      geminiConfigured: params.health.geminiConfigured,
      ffmpegAvailable: params.health.ffmpegAvailable,
      warnings: params.health.warnings,
    },
    activeRun: params.run
      ? {
          id: params.run.id,
          title: params.run.title,
          status: params.run.status,
          sceneCount: params.run.sceneCount,
          completedScenes: params.run.completedScenes,
          failedScenes: params.run.failedScenes,
          escalatedScenes: params.run.escalatedScenes,
          error: params.run.error,
        }
      : null,
    agents: agentsSummary,
    openIncidents,
    failedOrActiveTasks,
    projectMemory: {
      title: mem.title,
      version: mem.version,
      allowFreeCostumeChange: Boolean(mem.allowFreeCostumeChange),
      characters: mem.characters.slice(0, 6).map((c) => ({
        id: c.id,
        name: c.name,
        voiceId: c.voiceId,
        costume: c.syncProfile?.costume?.slice(0, 140) || c.description?.slice(0, 140),
      })),
      totalScenes: mem.scenes.length,
    },
    targetIncident: params.inc
      ? {
          code: params.inc.code,
          status: params.inc.status,
          severity: params.inc.severity,
          category: params.inc.category,
          categoryLabel: params.inc.categoryLabel,
          reporter: params.inc.reporterAgentId,
          responsible: params.inc.responsibleAgentId,
          assignedFix: params.inc.assignedFixAgentId,
          attempts: `${params.inc.attemptCount}/${params.inc.maxAttempts}`,
          errorDescription: params.inc.errorDescription,
          suspectedRootCause: params.inc.suspectedRootCause,
          technicalDiagnosis: params.inc.technicalDiagnosis,
          costumeMismatch: params.inc.costumeMismatch
            ? {
                characterName: params.inc.costumeMismatch.characterName,
                expectedCostume: params.inc.costumeMismatch.expectedCostume,
                observedCostume: params.inc.costumeMismatch.observedCostume,
                mismatchDetails: params.inc.costumeMismatch.mismatchDetails,
              }
            : null,
          recentHistory: params.inc.history.slice(-6).map((h) => ({
            actor: h.actorName,
            kind: h.kind,
            content: h.content.slice(0, 300),
          })),
        }
      : null,
    targetScene: targetScene
      ? {
          sceneId: targetScene.sceneId,
          index: targetScene.index,
          title: targetScene.title,
          dialogue: targetScene.dialogue,
          speakerName: targetScene.speakerName,
          costume: targetScene.costume,
          actionDetail: targetScene.actionDetail,
          settingDetail: targetScene.settingDetail,
          qaStatus: targetScene.qaStatus,
          qaScore: targetScene.qaScore,
          retryCount: targetScene.retryCount,
        }
      : null,
  };

  return JSON.stringify(payload, null, 2);
}

export async function analyzeAndDirectWithChairman(params: {
  incidentId?: string;
  runId?: string;
  userRequest?: string;
  trigger?: ChairmanBriefing['trigger'];
}): Promise<{ state: CommandCenterState; briefing: ChairmanBriefing }> {
  const health = await refreshIntegrationHealth(false);
  const inc = params.incidentId
    ? storeDoc.incidents.find((i) => i.id === params.incidentId)
    : undefined;
  const runId = inc?.runId || params.runId || getEffectiveSelectedRunId() || undefined;
  const run = runId ? storeDoc.runs.find((r) => r.id === runId) || null : storeDoc.runs[0] || null;
  const chairmanName = storeDoc.chairmanConfig?.name || 'Chủ tịch Điều hành AI';

  const contextJson = buildChairmanContextDigest({
    inc,
    run,
    health,
    userRequest: params.userRequest?.trim(),
  });

  const systemInstruction = `Bạn là "${chairmanName}" — Chủ tịch & Tổng chỉ huy đứng TRÊN toàn bộ đội ngũ 5 Muse AI:
- Muse AI 01 (Muse Director), Muse AI 02, Muse AI 03, Muse AI 04: Bộ phận sản xuất Hình ảnh & Video trực tiếp (chạy song song từng phân cảnh, Ảnh → Video).
- Muse AI 05 (Muse Guardian): Kiểm định độc lập (ngưỡng sai lệch tổng thể <= 5% sau loại trừ phụ kiện được phép; tách riêng thuộc tính quan trọng khuôn mặt, vóc dáng, trang phục chính).
Nhiệm vụ của bạn:
1. Chẩn đoán sắc bén, thẳng thắn NGUYÊN NHÂN GỐC RỄ (không nói chung chung, không lặp lại mẫu câu máy móc của Muse 01).
2. Chỉ thẳng chỗ xử lý kém / sai hướng / lặp lỗi của đội ngũ 5 Muse AI hiện tại.
3. Đưa ra ĐÚNG 3 PHƯƠNG ÁN GIẢI QUYẾT THỰC THI ĐƯỢC NGAY (options), phân hóa rõ ràng theo chiến lược:
   - Phương án 1 (recommended=true): Tối ưu nhất, giải quyết tận gốc vấn đề.
   - Phương án 2: Dự phòng an toàn (ví dụ đổi engine dự phòng, điều chuyển Muse khỏe hơn, hoặc gỡ kẹt dây chuyền).
   - Phương án 3: Dứt điểm / thông chốt nhanh hoặc chỉ đạo trực tiếp xuống đội Muse.
4. Mỗi phương án phải chọn đúng actionType trong danh sách hợp lệ:
   - "switch_engine_and_retry": Bật chế độ dự phòng thông minh + tự chọn tài khoản khỏe + chạy lại tác vụ/sự cố.
   - "patch_and_retry": Vá trực tiếp chỉ thị/prompt lỗi + xóa lỗi cũ + chạy lại ngay.
   - "reassign_muse": Chuyển việc sang một Muse AI khác khỏe hơn + chạy lại.
   - "fix_scene_memory_and_regen": Sửa trực tiếp thoại/trang phục/bối cảnh/hành động của cảnh lỗi trong Project Memory và tạo lại cảnh.
   - "adjust_qa_and_approve": Phê duyệt thông chốt QA cho cảnh bị kẹt để dây chuyền đi tiếp.
   - "reset_stuck_run": Gỡ kẹt toàn bộ tác vụ lỗi/treo của phiên hiện tại và khởi động lại hàng đợi.
   - "direct_briefing": Phát chỉ thị chiến lược trực tiếp cho Muse AI mục tiêu (tạo nhiệm vụ ưu tiên nếu cần).
5. Toàn bộ nội dung viết bằng tiếng Việt tự nhiên, sắc bén, quyết đoán như một Chủ tịch điều hành thực thụ. Không bịa tên mô hình hay thông số giả.`;

  const userPrompt = `Dưới đây là toàn bộ tình hình thực tế của Phòng Điều Hành AI Muse:\n${contextJson}\n\nHãy phân tích sâu, chỉ rõ điểm chưa ổn của đội 5 Muse AI và lập 3 phương án hành động thực thi được ngay.`;

  const ai = getGeminiClient();
  let responseText = '';
  try {
    const resp = await retryWithGeminiBackoff(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rootCauseDiagnosis: {
                  type: Type.STRING,
                  description: 'Chẩn đoán nguyên nhân gốc rễ cụ thể bằng tiếng Việt.',
                },
                critiqueOfMuseTeam: {
                  type: Type.STRING,
                  description: 'Nhận xét thẳng thắn chỗ xử lý kém hoặc sai hướng của Muse 01-05.',
                },
                executiveSummary: {
                  type: Type.STRING,
                  description: 'Kết luận và chỉ đạo trọng tâm của Chủ tịch Điều hành.',
                },
                options: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      recommended: { type: Type.BOOLEAN },
                      riskLevel: { type: Type.STRING, description: 'low | medium | high' },
                      summary: { type: Type.STRING },
                      actionType: { type: Type.STRING },
                      targetAgentId: { type: Type.STRING, description: 'muse-01..muse-05' },
                      executionCommand: { type: Type.STRING },
                      estimatedOutcome: { type: Type.STRING },
                      scenePatch: {
                        type: Type.OBJECT,
                        properties: {
                          dialogue: { type: Type.STRING },
                          costume: { type: Type.STRING },
                          actionDetail: { type: Type.STRING },
                          settingDetail: { type: Type.STRING },
                        },
                      },
                    },
                    required: [
                      'label',
                      'riskLevel',
                      'summary',
                      'actionType',
                      'targetAgentId',
                      'executionCommand',
                      'estimatedOutcome',
                    ],
                  },
                },
              },
              required: ['rootCauseDiagnosis', 'critiqueOfMuseTeam', 'executiveSummary', 'options'],
            },
          },
        }),
      [1500, 3200]
    );
    responseText = (resp.text || '').trim();
  } catch (err: any) {
    throw new Error(formatGeminiError(err));
  }

  if (!responseText) {
    throw new Error('Chủ tịch Điều hành AI không nhận được phản hồi phân tích. Vui lòng thử lại.');
  }

  const parsed = parseAiBlueprintJsonSafe(responseText);
  if (!parsed || !Array.isArray(parsed.options) || parsed.options.length === 0) {
    throw new Error('Dữ liệu phương án từ Chủ tịch AI chưa đúng cấu trúc. Vui lòng thử lại.');
  }

  const normalizedOptions: ChairmanPlanOption[] = parsed.options.slice(0, 3).map((opt: any, idx: number) => {
    const riskRaw = String(opt?.riskLevel || 'low').toLowerCase();
    const riskLevel: 'low' | 'medium' | 'high' =
      riskRaw === 'high' ? 'high' : riskRaw === 'medium' ? 'medium' : 'low';
    const rawPatch = opt?.scenePatch && typeof opt.scenePatch === 'object' ? opt.scenePatch : undefined;
    const cleanPatch: ChairmanScenePatch | undefined = rawPatch
      ? {
          ...(typeof rawPatch.dialogue === 'string' && rawPatch.dialogue.trim()
            ? { dialogue: rawPatch.dialogue.trim() }
            : {}),
          ...(typeof rawPatch.costume === 'string' && rawPatch.costume.trim()
            ? { costume: rawPatch.costume.trim() }
            : {}),
          ...(typeof rawPatch.actionDetail === 'string' && rawPatch.actionDetail.trim()
            ? { actionDetail: rawPatch.actionDetail.trim() }
            : {}),
          ...(typeof rawPatch.settingDetail === 'string' && rawPatch.settingDetail.trim()
            ? { settingDetail: rawPatch.settingDetail.trim() }
            : {}),
        }
      : undefined;

    return {
      id: `copt_${Date.now().toString(36)}_${idx + 1}`,
      label: String(opt?.label || `Phương án ${idx + 1}`).trim(),
      recommended: idx === 0 ? opt?.recommended !== false : Boolean(opt?.recommended),
      riskLevel,
      summary: String(opt?.summary || '').trim(),
      actionType: normalizeChairmanAction(opt?.actionType),
      targetAgentId: normalizeMuseId(opt?.targetAgentId, inc?.assignedFixAgentId || 'muse-01'),
      executionCommand: String(opt?.executionCommand || opt?.summary || '').trim(),
      scenePatch: cleanPatch && Object.keys(cleanPatch).length > 0 ? cleanPatch : undefined,
      estimatedOutcome: String(opt?.estimatedOutcome || 'Khôi phục tiến độ và giảm lặp lỗi.').trim(),
    };
  });

  const briefing: ChairmanBriefing = {
    id: `chb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    createdAt: Date.now(),
    incidentId: inc?.id,
    incidentCode: inc?.code,
    runId: run?.id,
    trigger: params.trigger || (inc ? 'incident_analysis' : 'executive_order'),
    userRequest: params.userRequest?.trim() || undefined,
    rootCauseDiagnosis: String(parsed.rootCauseDiagnosis || '').trim(),
    critiqueOfMuseTeam: String(parsed.critiqueOfMuseTeam || '').trim(),
    executiveSummary: String(parsed.executiveSummary || '').trim(),
    options: normalizedOptions,
  };

  if (!Array.isArray(storeDoc.chairmanBriefings)) {
    storeDoc.chairmanBriefings = [];
  }
  storeDoc.chairmanBriefings.unshift(briefing);
  if (storeDoc.chairmanBriefings.length > 40) {
    storeDoc.chairmanBriefings = storeDoc.chairmanBriefings.slice(0, 40);
  }

  const optionsText = normalizedOptions
    .map(
      (o, i) =>
        `${i + 1}. ${o.label}${o.recommended ? ' [Khuyến nghị]' : ''}: ${o.summary}\n   → Giao ${o.targetAgentId.toUpperCase()}: ${o.executionCommand}`
    )
    .join('\n');

  const briefingMsgContent = `[CHỈ ĐẠO CHỦ TỊCH${inc ? ` · ${inc.code}` : ''}]
• Chẩn đoán gốc: ${briefing.rootCauseDiagnosis}
• Đánh giá đội 5 Muse AI: ${briefing.critiqueOfMuseTeam}
• Phương án đề xuất:
${optionsText}`;

  const mem = run?.id ? getRunMemory(run.id) : storeDoc.projectMemory;

  if (inc) {
    inc.chairmanBriefingId = briefing.id;
    inc.chairmanOptions = normalizedOptions;
    inc.updatedAt = Date.now();
    appendIncidentTurn(inc, {
      actorId: 'chairman',
      actorName: chairmanName,
      roleBadge: 'Chủ tịch chẩn đoán',
      kind: 'directive',
      content: briefingMsgContent,
    });
    postIncidentChannelMessage({
      inc,
      senderId: 'chairman',
      senderName: chairmanName,
      roleBadge: 'Chủ tịch AI',
      targetAgentIds: [inc.assignedFixAgentId, 'muse-05'],
      content: briefingMsgContent,
    });
    emitCommandCenterEvent('incident:updated', inc);
  }

  appendConversationMessage({
    channel: 'commander',
    projectId: mem.projectId,
    runId: run?.id,
    sceneId: inc?.sceneId,
    incidentId: inc?.id,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
    messageKind: inc ? 'incident' : 'chat',
    targetAgentIds: Array.from(new Set(normalizedOptions.map((o) => o.targetAgentId))),
    content: briefingMsgContent,
  });

  addActivityLog(
    'info',
    `Chủ tịch AI lập ${normalizedOptions.length} phương án${inc ? ` (${inc.code})` : ''}`,
    briefing.executiveSummary,
    { agentId: 'chairman', runId: run?.id }
  );

  saveStateAtomic();

  // Full Executive Autonomy: Gemini AI – Chủ tịch immediately decides & executes the recommended plan without waiting for user approval!
  const recommendedOption =
    normalizedOptions.find((o) => o.recommended) || normalizedOptions[0];
  if (
    storeDoc.chairmanConfig?.enabled &&
    storeDoc.chairmanConfig?.autoExecuteRecommended &&
    recommendedOption &&
    (params.trigger === 'auto_takeover' || params.trigger === 'incident_analysis')
  ) {
    const autoRes = await executeChairmanPlanOption({
      briefingId: briefing.id,
      optionId: recommendedOption.id,
      customNote: 'Chủ tịch Gemini AI tự động ra quyết định và triển khai thực thi ngay không cần chờ duyệt.',
    });
    briefing.autoExecuted = true;
    saveStateAtomic();
    return { state: autoRes.state, briefing };
  }

  return {
    state: await getCommandCenterState(false),
    briefing,
  };
}

async function triggerChairmanAutoBriefing(incidentId: string): Promise<void> {
  if (chairmanAnalyzingIncidents.has(incidentId)) return;
  chairmanAnalyzingIncidents.add(incidentId);
  try {
    await analyzeAndDirectWithChairman({
      incidentId,
      trigger: 'auto_takeover',
    });
  } catch {
    // Background auto-takeover fails silently so core orchestrator loop is never disrupted
  } finally {
    chairmanAnalyzingIncidents.delete(incidentId);
  }
}

export async function executeChairmanPlanOption(params: {
  briefingId?: string;
  incidentId?: string;
  optionId: string;
  customNote?: string;
}): Promise<{ state: CommandCenterState; briefing: ChairmanBriefing; executedSummary: string }> {
  const briefings = storeDoc.chairmanBriefings || [];
  let briefing = params.briefingId
    ? briefings.find((b) => b.id === params.briefingId)
    : undefined;
  if (!briefing && params.incidentId) {
    briefing = briefings.find((b) => b.incidentId === params.incidentId);
  }
  if (!briefing) {
    throw new Error('Không tìm thấy hồ sơ phương án của Chủ tịch AI.');
  }

  const option = briefing.options.find((o) => o.id === params.optionId);
  if (!option) {
    throw new Error('Không tìm thấy phương án được chọn.');
  }

  const chairmanName = storeDoc.chairmanConfig?.name || 'Chủ tịch Điều hành AI';
  const inc = briefing.incidentId
    ? storeDoc.incidents.find((i) => i.id === briefing!.incidentId)
    : params.incidentId
    ? storeDoc.incidents.find((i) => i.id === params.incidentId)
    : undefined;

  const runId = inc?.runId || briefing.runId || getEffectiveSelectedRunId() || 'manual_run';
  const run = storeDoc.runs.find((r) => r.id === runId);
  const mem = getRunMemory(runId);
  const targetAgent = storeDoc.agents.find((a) => a.id === option.targetAgentId) || storeDoc.agents[0];
  const noteSuffix = params.customNote?.trim() ? `\nGhi chú bổ sung: ${params.customNote.trim()}` : '';
  const fullDirective = `[LỆNH CHỦ TỊCH — ${option.label}] ${option.executionCommand}${noteSuffix}`;

  let executedSummary = '';

  const reviveRunIfNeeded = () => {
    if (run && ['failed', 'needs_attention', 'paused', 'idle'].includes(run.status)) {
      const runTasks = storeDoc.tasks.filter((t) => t.runId === run.id);
      const hasIncompletePlanning = runTasks.some(
        (t) =>
          (t.type === 'analyze_script' || t.type === 'plan_production') &&
          t.status !== 'completed' &&
          t.status !== 'cancelled'
      );
      run.status = hasIncompletePlanning ? 'planning' : 'producing';
      run.error = undefined;
      run.pausedAt = undefined;
      run.updatedAt = Date.now();
      emitCommandCenterEvent('run:updated', enrichProductionRun(run));
    }
  };

  const linkedTask = inc?.taskId
    ? storeDoc.tasks.find((t) => t.id === inc.taskId)
    : storeDoc.tasks.find(
        (t) => t.runId === runId && (t.status === 'failed' || t.status === 'qa_rejected')
      );

  if (option.actionType === 'switch_engine_and_retry') {
    targetAgent.engineMode = 'muse2api_with_gemini_fallback';
    targetAgent.boundAccountId = 'auto';
    targetAgent.paused = false;
    targetAgent.lastError = undefined;
    emitCommandCenterEvent('agent:updated', hydrateAgentComputedMetrics(targetAgent));

    if (linkedTask) {
      const retryTask = enqueueTask({
        runId,
        type: linkedTask.type,
        title: `[Chủ tịch điều phối] ${linkedTask.title}`,
        instructions: `${linkedTask.instructions}\n${fullDirective}`,
        assignedAgentId: targetAgent.id,
        dependsOnTaskIds: linkedTask.dependsOnTaskIds.filter((depId) => {
          const dep = storeDoc.tasks.find((x) => x.id === depId);
          return dep && dep.status !== 'failed' && dep.status !== 'cancelled';
        }),
        sceneId: linkedTask.sceneId,
        sceneIndex: linkedTask.sceneIndex,
        characterId: linkedTask.characterId,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(retryTask.id);
        inc.status = 'remediating';
        inc.assignedFixAgentId = targetAgent.id;
        inc.escalationReason = undefined;
        inc.directorCommand = fullDirective;
      }
      executedSummary = `Đã chuyển ${targetAgent.name} sang chế độ dự phòng thông minh (auto account) và xếp lại tác vụ ${retryTask.code} vào hàng đợi ưu tiên cao nhất.`;
    } else {
      const task = enqueueTask({
        runId,
        type: 'custom_task',
        title: `[Lệnh Chủ tịch] ${option.label}`,
        instructions: fullDirective,
        assignedAgentId: targetAgent.id,
        sceneId: inc?.sceneId,
        sceneIndex: inc?.sceneIndex,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(task.id);
        inc.status = 'remediating';
        inc.assignedFixAgentId = targetAgent.id;
        inc.escalationReason = undefined;
      }
      executedSummary = `Đã chuyển ${targetAgent.name} sang chế độ dự phòng thông minh và phát tác vụ ${task.code}.`;
    }
    reviveRunIfNeeded();
  } else if (option.actionType === 'reassign_muse') {
    targetAgent.paused = false;
    targetAgent.lastError = undefined;
    if (targetAgent.engineMode === 'muse2api') {
      targetAgent.engineMode = 'muse2api_with_gemini_fallback';
    }
    emitCommandCenterEvent('agent:updated', hydrateAgentComputedMetrics(targetAgent));

    if (linkedTask) {
      const movedTask = enqueueTask({
        runId,
        type: linkedTask.type,
        title: `[Chủ tịch điều chuyển → ${targetAgent.name}] ${linkedTask.title}`,
        instructions: `${linkedTask.instructions}\n${fullDirective}`,
        assignedAgentId: targetAgent.id,
        dependsOnTaskIds: linkedTask.dependsOnTaskIds.filter((depId) => {
          const dep = storeDoc.tasks.find((x) => x.id === depId);
          return dep && dep.status !== 'failed' && dep.status !== 'cancelled';
        }),
        sceneId: linkedTask.sceneId,
        sceneIndex: linkedTask.sceneIndex,
        characterId: linkedTask.characterId,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(movedTask.id);
        inc.assignedFixAgentId = targetAgent.id;
        inc.status = 'remediating';
        inc.escalationReason = undefined;
        inc.directorCommand = fullDirective;
      }
      executedSummary = `Đã điều chuyển tác vụ lỗi sang ${targetAgent.name} (${movedTask.code}) với chỉ thị trực tiếp từ Chủ tịch.`;
    } else {
      const task = enqueueTask({
        runId,
        type: 'custom_task',
        title: `[Chủ tịch giao → ${targetAgent.name}] ${option.label}`,
        instructions: fullDirective,
        assignedAgentId: targetAgent.id,
        sceneId: inc?.sceneId,
        sceneIndex: inc?.sceneIndex,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(task.id);
        inc.assignedFixAgentId = targetAgent.id;
        inc.status = 'remediating';
        inc.escalationReason = undefined;
      }
      executedSummary = `Đã giao trực tiếp nhiệm vụ ${task.code} cho ${targetAgent.name}.`;
    }
    reviveRunIfNeeded();
  } else if (option.actionType === 'fix_scene_memory_and_regen') {
    const sc = inc?.sceneId ? mem.scenes.find((s) => s.sceneId === inc.sceneId) : undefined;
    if (sc && option.scenePatch) {
      commitSessionMemoryUpdate(runId, 'chairman', `${chairmanName} chỉnh sửa trực tiếp Cảnh ${sc.index}`, (m) => {
        const targetSc = m.scenes.find((s) => s.sceneId === sc.sceneId);
        if (!targetSc) return;
        if (option.scenePatch?.dialogue) targetSc.dialogue = option.scenePatch.dialogue;
        if (option.scenePatch?.costume) targetSc.costume = option.scenePatch.costume;
        if (option.scenePatch?.actionDetail) targetSc.actionDetail = option.scenePatch.actionDetail;
        if (option.scenePatch?.settingDetail) targetSc.settingDetail = option.scenePatch.settingDetail;
        targetSc.qaStatus = 'pending';
        targetSc.productionStage = 'needs_regen';
        targetSc.lastModifiedBy = 'chairman';
      });
    }
    const regenType: CommandTaskType =
      sc && (option.targetAgentId === 'muse-03' || inc?.category === 'wrong_costume' || inc?.category === 'wrong_character')
        ? 'design_scene_image'
        : sc
        ? 'produce_scene_video'
        : 'custom_task';

    const regenTask = enqueueTask({
      runId,
      type: regenType,
      title: sc
        ? `[Chủ tịch sửa & tạo lại] Cảnh ${String(sc.index).padStart(2, '0')} (${targetAgent.name})`
        : `[Chủ tịch sửa & tạo lại] ${option.label}`,
      instructions: fullDirective,
      assignedAgentId: targetAgent.id,
      sceneId: sc?.sceneId,
      sceneIndex: sc?.index,
      priority: 10,
    });
    if (inc) {
      inc.remediationTaskIds.push(regenTask.id);
      inc.status = 'remediating';
      inc.assignedFixAgentId = targetAgent.id;
      inc.escalationReason = undefined;
      inc.directorCommand = fullDirective;
    }
    reviveRunIfNeeded();
    executedSummary = sc
      ? `Đã cập nhật dữ liệu Cảnh ${String(sc.index).padStart(2, '0')} trong Project Memory và giao ${targetAgent.name} tạo lại (${regenTask.code}).`
      : `Đã giao ${targetAgent.name} chạy lại nhiệm vụ ${regenTask.code} với thông số đã sửa.`;
  } else if (option.actionType === 'adjust_qa_and_approve') {
    if (inc?.sceneId) {
      commitSessionMemoryUpdate(runId, 'chairman', `${chairmanName} phê duyệt thông chốt Cảnh ${inc.sceneIndex || ''}`, (m) => {
        const sc = m.scenes.find((s) => s.sceneId === inc.sceneId);
        if (sc) {
          sc.qaStatus = 'passed';
          sc.productionStage = 'completed';
          sc.lastModifiedBy = 'chairman';
        }
      });
    }
    if (inc) {
      const qaAgent = storeDoc.agents.find((a) => a.id === 'muse-05') || storeDoc.agents[4];
      resolveIncidentRecord(
        inc,
        qaAgent,
        `${chairmanName} phê duyệt thông chốt & đóng sự cố ${inc.code}: ${option.executionCommand}`
      );
    }
    reviveRunIfNeeded();
    executedSummary = inc
      ? `Chủ tịch đã phê duyệt thông chốt và đóng sự cố ${inc.code} để dây chuyền tiếp tục chạy.`
      : `Chủ tịch đã phê duyệt thông chốt QA cho phiên hiện tại.`;
  } else if (option.actionType === 'reset_stuck_run') {
    let requeuedCount = 0;
    for (const a of storeDoc.agents) {
      if (a.paused || a.status === 'error') {
        a.paused = false;
        a.lastError = undefined;
      }
      if (a.engineMode === 'muse2api') {
        a.engineMode = 'muse2api_with_gemini_fallback';
      }
      emitCommandCenterEvent('agent:updated', hydrateAgentComputedMetrics(a));
    }
    for (const t of storeDoc.tasks) {
      if (t.runId === runId && (t.status === 'failed' || t.status === 'qa_rejected')) {
        t.status = 'queued';
        t.error = undefined;
        t.acknowledgedAt = Date.now();
        t.instructions = `${t.instructions}\n${fullDirective}`;
        requeuedCount += 1;
        emitCommandCenterEvent('task:updated', t);
      }
    }
    if (inc && inc.status !== 'resolved') {
      inc.status = 'remediating';
      inc.escalationReason = undefined;
      inc.directorCommand = fullDirective;
    }
    reviveRunIfNeeded();
    executedSummary = `Đã gỡ kẹt ${requeuedCount} tác vụ lỗi/treo, mở khóa toàn bộ 5 Muse AI và bật chế độ dự phòng thông minh để tiếp tục chạy.`;
  } else if (option.actionType === 'patch_and_retry') {
    targetAgent.paused = false;
    targetAgent.lastError = undefined;
    if (linkedTask) {
      const patchedTask = enqueueTask({
        runId,
        type: linkedTask.type,
        title: `[Chủ tịch vá lệnh] ${linkedTask.title}`,
        instructions: `${linkedTask.instructions}\n${fullDirective}`,
        assignedAgentId: targetAgent.id,
        dependsOnTaskIds: linkedTask.dependsOnTaskIds.filter((depId) => {
          const dep = storeDoc.tasks.find((x) => x.id === depId);
          return dep && dep.status !== 'failed' && dep.status !== 'cancelled';
        }),
        sceneId: linkedTask.sceneId,
        sceneIndex: linkedTask.sceneIndex,
        characterId: linkedTask.characterId,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(patchedTask.id);
        inc.status = 'remediating';
        inc.assignedFixAgentId = targetAgent.id;
        inc.escalationReason = undefined;
        inc.directorCommand = fullDirective;
      }
      executedSummary = `Đã vá chỉ thị thực thi và tạo tác vụ ưu tiên ${patchedTask.code} cho ${targetAgent.name}.`;
    } else {
      const task = enqueueTask({
        runId,
        type: 'custom_task',
        title: `[Chủ tịch chỉ đạo] ${option.label}`,
        instructions: fullDirective,
        assignedAgentId: targetAgent.id,
        sceneId: inc?.sceneId,
        sceneIndex: inc?.sceneIndex,
        priority: 10,
      });
      if (inc) {
        inc.remediationTaskIds.push(task.id);
        inc.status = 'remediating';
        inc.assignedFixAgentId = targetAgent.id;
        inc.escalationReason = undefined;
      }
      executedSummary = `Đã phát chỉ thị đã vá (${task.code}) cho ${targetAgent.name}.`;
    }
    reviveRunIfNeeded();
  } else {
    // direct_briefing
    const task = enqueueTask({
      runId,
      type: 'custom_task',
      title: `[Chỉ thị Chủ tịch] ${option.label}`,
      instructions: fullDirective,
      assignedAgentId: targetAgent.id,
      sceneId: inc?.sceneId,
      sceneIndex: inc?.sceneIndex,
      priority: 10,
    });
    if (inc && inc.status !== 'resolved') {
      inc.remediationTaskIds.push(task.id);
      inc.status = 'remediating';
      inc.assignedFixAgentId = targetAgent.id;
      inc.escalationReason = undefined;
      inc.directorCommand = fullDirective;
    }
    reviveRunIfNeeded();
    executedSummary = `Đã phát chỉ thị trực tiếp (${task.code}) từ Chủ tịch xuống ${targetAgent.name}.`;
  }

  option.executedAt = Date.now();
  briefing.selectedOptionId = option.id;
  briefing.executionLog = executedSummary;

  if (inc) {
    if (inc.chairmanOptions) {
      inc.chairmanOptions = inc.chairmanOptions.map((o) =>
        o.id === option.id ? { ...o, executedAt: option.executedAt } : o
      );
    }
    inc.updatedAt = Date.now();
    appendIncidentTurn(inc, {
      actorId: 'chairman',
      actorName: chairmanName,
      roleBadge: 'Lệnh thực thi',
      kind: 'directive',
      content: `Đã phê duyệt & thực thi "${option.label}" → ${targetAgent.name}.\n• Lệnh giao: ${option.executionCommand}\n• Kết quả điều phối: ${executedSummary}`,
    });
    postIncidentChannelMessage({
      inc,
      senderId: 'chairman',
      senderName: `${chairmanName} – Thực thi`,
      roleBadge: 'Lệnh Chủ tịch',
      targetAgentIds: [targetAgent.id],
      content: `[THỰC THI ${option.label}] ${executedSummary}\n• Chỉ thị: ${option.executionCommand}`,
    });
    emitCommandCenterEvent('incident:updated', inc);
  }

  // Broadcast to commander channel AND direct channel of target Muse AI
  appendConversationMessage({
    channel: 'commander',
    projectId: mem.projectId,
    runId: run?.id,
    sceneId: inc?.sceneId,
    incidentId: inc?.id,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Chủ tịch AI',
    messageKind: 'deliverable',
    targetAgentIds: [targetAgent.id],
    content: `[ĐÃ THỰC THI] ${option.label}\n• Giao cho: ${targetAgent.name}\n• ${executedSummary}`,
  });

  appendConversationMessage({
    channel: targetAgent.id,
    projectId: mem.projectId,
    runId: run?.id,
    sceneId: inc?.sceneId,
    incidentId: inc?.id,
    senderType: 'agent',
    senderId: 'chairman',
    senderName: chairmanName,
    senderColor: '#D97706',
    roleBadge: 'Lệnh Chủ tịch',
    messageKind: 'deliverable',
    targetAgentIds: [targetAgent.id],
    content: fullDirective,
  });

  addActivityLog(
    'success',
    `Chủ tịch thực thi: ${option.label}`,
    executedSummary,
    { agentId: 'chairman', runId: run?.id }
  );

  saveStateAtomic();
  void tickOrchestratorQueue();

  return {
    state: await getCommandCenterState(false),
    briefing,
    executedSummary,
  };
}
