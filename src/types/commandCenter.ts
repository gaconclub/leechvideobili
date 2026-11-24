import {
  CharacterAgeGroup,
  CharacterFivePartProfile,
  CharacterGenderHint,
  DerivativeAspectRatio,
  StudioProductionFormat,
  StudioVideoStyle,
} from './bilibili';

export type MuseAgentId = 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04' | 'muse-05';

export type MuseAgentRole =
  | 'director_script'
  | 'production_media'
  | 'qa_supervisor'
  | 'director'
  | 'screenwriter'
  | 'image_designer'
  | 'video_director';

export type MuseAgentStatus =
  | 'online'
  | 'working'
  | 'waiting'
  | 'supervising'
  | 'paused'
  | 'offline'
  | 'error';

export type MuseAgentEngineMode = 'muse2api' | 'muse2api_with_gemini_fallback';

export type VideoGenerationEngine = 'gemini' | 'google_flow' | 'muse';

export type MuseAgentAvatarPreset =
  | 'director_clapboard'
  | 'script_feather'
  | 'visual_palette'
  | 'video_camera'
  | 'qa_shield'
  | 'crown_star'
  | 'sparkles_orb';

export interface MuseAgentPermissions {
  canModifyProjectMemory: boolean;
  canApproveQa: boolean;
  canExecuteMedia: boolean;
  allowedDataScopes: string[];
}

export interface MuseAgentConfig {
  id: MuseAgentId;
  code: string; // "Muse AI 01" .. "Muse AI 05"
  name: string;
  role: MuseAgentRole;
  roleTitle: string;
  description: string;
  boundAccountId: string; // 'auto' or specific Muse2API account ID
  engineMode: MuseAgentEngineMode;
  status: MuseAgentStatus;
  paused: boolean;
  avatarUrl?: string;
  avatarPreset?: MuseAgentAvatarPreset;
  accentColor: string;
  permissions: MuseAgentPermissions;
  currentTaskId?: string;
  currentTaskSummary?: string;
  activeTaskCount?: number;
  activeTaskIds?: string[];
  maxConcurrentTasks?: number;
  lastActiveAt?: number;
  lastError?: string;
  avgResponseMs?: number;
  avgAckLatencyMs?: number;
  reconnectCount?: number;
  regenCount?: number;
  hungCount?: number;
  successRate?: number;
  stats: {
    completed: number;
    failed: number;
    retried: number;
  };
}

export type QaCriterionId =
  | 'character'
  | 'costume'
  | 'voice'
  | 'dialogue'
  | 'setting'
  | 'motion'
  | 'continuity'
  | 'audio';

export interface QaCriterionResult {
  criterion: QaCriterionId;
  label: string;
  passed: boolean;
  score: number;
  note: string;
}

export interface CostumeMismatchReport {
  characterId: string;
  characterName: string;
  projectId: string;
  runId: string;
  sceneId?: string;
  sceneIndex?: number;
  targetMediaKind: 'character_image' | 'scene_image' | 'scene_video';
  referenceImageUrl?: string;
  expectedCostume: string;
  faultyArtifactUrl?: string;
  faultyVideoUrl?: string;
  observedCostume?: string;
  mismatchDetails: string;
  responsibleAgentId: MuseAgentId;
  restoreRecommendation: string;
  detectedAt: number;
}

export interface CostumeVersionSnapshot {
  version: number;
  timestamp: number;
  actorAgentId: MuseAgentId;
  incidentCode?: string;
  sceneId?: string;
  sceneIndex?: number;
  beforeCostume: string;
  afterCostume: string;
  beforeImageUrl?: string;
  afterImageUrl?: string;
  beforePrompt?: string;
  afterPrompt?: string;
  note: string;
}

export type QaVerdictStatus = 'PASS' | 'PASS_WITH_TOLERANCE' | 'FAIL';

export type QaDeviationClass =
  | 'type_a_allowed_accessory'
  | 'type_b_minor_tolerance'
  | 'type_c_exceeds_limit';

export interface QaCharacterConsistencyMetrics {
  verdictStatus: QaVerdictStatus;
  deviationClass: QaDeviationClass;
  faceSimilarityScore: number; // 0-100
  faceDeviationPct: number; // 0-100
  physiqueSimilarityScore: number; // 0-100
  physiqueDeviationPct: number; // 0-100
  mainCostumeSimilarityScore: number; // 0-100
  mainCostumeDeviationPct: number; // 0-100
  overallDeviationExcludingAccessoriesPct: number; // 0-100 (must be <= 5% for tolerance pass)
  allowedAccessoryChanges: string[];
  criticalViolationFlags: string[];
  environmentalContextNote: string;
  accessoryDistortsIdentityOrCostume: boolean;
}

export interface QaInspectionReport {
  id: string;
  sceneId: string;
  sceneIndex: number;
  runId: string;
  inspectorAgentId: MuseAgentId;
  checkedAt: number;
  overallScore: number;
  passed: boolean;
  verdictStatus?: QaVerdictStatus;
  deviationClass?: QaDeviationClass;
  consistencyMetrics?: QaCharacterConsistencyMetrics;
  threshold: number;
  criteriaResults: QaCriterionResult[];
  timestampRange: string;
  summary: string;
  targetFixAgentId?: 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04';
  fixInstruction?: string;
  attemptNumber: number;
  targetMediaKind?: 'character_image' | 'scene_image' | 'scene_video';
  characterId?: string;
  costumeMismatch?: CostumeMismatchReport;
}

export interface CommandMemoryCharacter {
  id: string;
  name: string;
  ageGroup: CharacterAgeGroup;
  gender: CharacterGenderHint;
  voiceId: string;
  description: string;
  dataUrl?: string;
  artifactUrl?: string;
  syncProfile: CharacterFivePartProfile;
  approvedVersion: number;
  confirmedOriginalDataUrl?: string;
  confirmedOriginalArtifactUrl?: string;
  confirmedOriginalSyncProfile?: CharacterFivePartProfile;
  costumeVersionHistory?: CostumeVersionSnapshot[];
}

export type SceneProductionStage =
  | 'waiting_data'
  | 'creating_image'
  | 'image_ready'
  | 'waiting_video'
  | 'creating_video'
  | 'inspecting_qa'
  | 'completed'
  | 'failed'
  | 'needs_regen';

export interface CommandMemoryScene {
  sceneId: string;
  index: number;
  title: string;
  durationSec: number;
  narration: string;
  dialogue: string;
  speakerName: string;
  actionDetail: string;
  settingDetail: string;
  costume: string;
  cameraAngle: string;
  cameraMovement: string;
  lighting: string;
  vfxNotes: string;
  videoTimeline: string;
  dependsOnSceneIds: string[];
  continuityAnchorFromSceneId?: string;
  assignedProducerAgentId?: MuseAgentId;
  productionStage?: SceneProductionStage;
  imageValidated?: boolean;
  imageMemoryVersion?: number;
  lockedPromptVersion?: number;
  keyframeImageUrl?: string;
  keyframeArtifactName?: string;
  videoUrl?: string;
  videoArtifactName?: string;
  videoAssetId?: string;
  probedDurationSec?: number;
  hasAudioStream?: boolean;
  qaStatus: 'pending' | 'inspecting' | 'passed' | 'rejected' | 'escalated';
  qaScore?: number;
  qaReportId?: string;
  retryCount: number;
  lastModifiedBy: string;
  videoEngineUsed?: VideoGenerationEngine;
  flowPrompt?: string;
  flowStatus?: 'pending' | 'ready' | 'imported';
}

export interface ProjectMemorySnapshot {
  id: string;
  version: number;
  createdAt: number;
  authorAgentId: string;
  summary: string;
  data: {
    title: string;
    originalScript: string;
    productionFormat: StudioProductionFormat;
    aspectRatio: DerivativeAspectRatio;
    videoStyle: StudioVideoStyle;
    allowFreeCostumeChange?: boolean;
    visualBible: string;
    settingBible: string;
    costumeBible: string;
    continuityBible: string;
    timelineSummary: string;
    characters: CommandMemoryCharacter[];
    scenes: CommandMemoryScene[];
  };
}

export interface ProjectCoordinationEntry {
  id: string;
  timestamp: number;
  actorId: MuseAgentId | 'chairman' | 'user' | 'system';
  actorName: string;
  targetAgentIds?: (MuseAgentId | 'chairman')[];
  kind: 'directive' | 'response' | 'qa_report' | 'incident' | 'remediation' | 'delivery';
  projectId: string;
  runId?: string;
  taskId?: string;
  sceneId?: string;
  incidentId?: string;
  summary: string;
}

export interface ProjectMemory {
  projectId: string;
  title: string;
  version: number;
  updatedAt: number;
  updatedByAgentId: string;
  originalScript: string;
  productionFormat: StudioProductionFormat;
  aspectRatio: DerivativeAspectRatio;
  videoStyle: StudioVideoStyle;
  allowFreeCostumeChange?: boolean;
  visualBible: string;
  settingBible: string;
  costumeBible: string;
  continuityBible: string;
  timelineSummary: string;
  characters: CommandMemoryCharacter[];
  scenes: CommandMemoryScene[];
  snapshots: ProjectMemorySnapshot[];
  coordinationLog?: ProjectCoordinationEntry[];
}

export type CommandTaskType =
  | 'plan_production'
  | 'analyze_script'
  | 'design_character_ref'
  | 'design_scene_image'
  | 'qa_inspect_image'
  | 'restore_costume_and_regen_image'
  | 'produce_scene_video'
  | 'qa_inspect_scene'
  | 'assemble_final_film'
  | 'custom_task';

export type CommandTaskStatus =
  | 'queued'
  | 'blocked_by_deps'
  | 'running'
  | 'completed'
  | 'failed'
  | 'qa_rejected'
  | 'cancelled';

export interface CommandTask {
  id: string;
  code: string;
  runId: string;
  type: CommandTaskType;
  title: string;
  instructions: string;
  assignedAgentId: MuseAgentId | 'chairman';
  dependsOnTaskIds: string[];
  sceneId?: string;
  sceneIndex?: number;
  characterId?: string;
  costumeRecovery?: {
    incidentId?: string;
    characterId?: string;
    targetMediaKind: 'character_image' | 'scene_image' | 'scene_video';
    mismatchDetails: string;
    expectedCostume?: string;
  };
  status: CommandTaskStatus;
  priority: number;
  retryCount: number;
  maxRetries: number;
  expectedMemoryVersion?: number;
  allowMultipleVariants?: boolean;
  createdAt: number;
  acknowledgedAt?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  timeoutMs?: number;
  executedByProvider?: string;
  boundAccountUsed?: string;
  assignedGeminiAccountId?: string;
  assignedGeminiAccountLabel?: string;
  checkpointed?: boolean;
  externalTaskId?: string;
  outputText?: string;
  outputArtifactUrl?: string;
  error?: string;
  preferredVideoEngine?: VideoGenerationEngine;
  flowHandoffPrompt?: string;
}

export type AiWorkforceMode = 'gemini_only' | 'muse_only' | 'hybrid_gemini_muse';

export type GeminiAccountStatus = 'healthy' | 'quota_exceeded' | 'auth_error' | 'error' | 'untested';

export interface GeminiAccountPublic {
  id: string;
  label: string;
  source: 'env' | 'custom';
  maskedKey: string;
  enabled: boolean;
  isChairman: boolean;
  note?: string;
  preferredModel?: string;
  status: GeminiAccountStatus;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  quotaStatus?: string;
  lastError?: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
}

export type CloudHandoffStepId =
  | 'pause_local'
  | 'save_checkpoint'
  | 'sync_cloud'
  | 'chairman_takeover'
  | 'reassign_gemini'
  | 'verify_cloud'
  | 'disconnect_muse';

export type CloudHandoffStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CloudHandoffStep {
  id: CloudHandoffStepId;
  order: number;
  title: string;
  detail: string;
  status: CloudHandoffStepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface CloudHandoffState {
  status: 'local_active' | 'handing_off' | 'cloud_active' | 'failed';
  inProgress: boolean;
  localDeviceStatus: 'connected' | 'pausing' | 'safe_to_shutdown';
  museConnectionStatus: 'active' | 'draining' | 'disconnected' | 'inactive';
  cloudStatus: 'ready' | 'syncing' | 'running' | 'unavailable';
  safeToShutdownLocalPc: boolean;
  startedAt?: number;
  completedAt?: number;
  checkpointBackupId?: string;
  checkpointMemoryVersion?: number;
  reassignedTaskCount: number;
  preservedCompletedImages: number;
  preservedCompletedVideos: number;
  activeCloudGeminiIds: string[];
  chairmanGeminiAccountId?: string;
  error?: string;
  steps: CloudHandoffStep[];
}

export interface GeminiWorkerProgress {
  accountId: string;
  label: string;
  isChairman: boolean;
  status: GeminiAccountStatus;
  completedTasks: number;
  runningTasks: number;
  queuedTasks: number;
  failedTasks: number;
  totalTasks: number;
  progressPct: number;
  currentTaskTitle?: string;
}

export interface MuseRunProgress {
  agentId: MuseAgentId;
  progressPct: number;
  completedTasks: number;
  totalTasks: number;
  runningTasks: number;
  failedTasks: number;
  currentTaskTitle?: string;
}

export interface ProductionRun {
  id: string;
  projectId: string;
  title: string;
  userCommand: string;
  status:
    | 'idle'
    | 'planning'
    | 'producing'
    | 'inspecting'
    | 'assembling'
    | 'completed'
    | 'paused'
    | 'cancelled'
    | 'failed'
    | 'needs_attention';
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  pausedAt?: number;
  cancelledAt?: number;
  completedAt?: number;
  estimatedRemainingSec?: number;
  overallProgressPct?: number;
  perMuseProgress?: MuseRunProgress[];
  finalVideoUrl?: string;
  finalVideoArtifactName?: string;
  finalDurationSec?: number;
  sceneCount: number;
  completedScenes: number;
  passedQaScenes: number;
  escalatedScenes: number;
  runningScenes?: number;
  pendingScenes?: number;
  failedScenes?: number;
  aiWorkforceMode?: AiWorkforceMode;
  videoGenerationEngine?: VideoGenerationEngine;
  selectedGeminiAccountIds?: string[];
  chairmanGeminiAccountId?: string;
  pipelineLocked?: boolean;
  cloudHandoff?: CloudHandoffState;
  perGeminiProgress?: GeminiWorkerProgress[];
  error?: string;
}

export type GeminiDmChannelId = `gemini:${string}`;

export type CommunicationChannelId =
  | 'gemini'
  | GeminiDmChannelId
  | 'commander'
  | 'incident'
  | 'production'
  | 'script'
  | 'visual'
  | 'video'
  | 'qa'
  | 'ai_bus'
  | 'chairman'
  | MuseAgentId;

export interface ConversationMessage {
  id: string;
  channel: CommunicationChannelId;
  projectId: string;
  runId?: string;
  sessionId?: string;
  sceneId?: string;
  senderType: 'user' | 'agent' | 'system';
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  senderColor?: string;
  messageKind?: 'chat' | 'ai_bus' | 'ack' | 'alert' | 'deliverable' | 'incident';
  incidentId?: string;
  roleBadge?: string;
  targetAgentIds?: (MuseAgentId | 'chairman' | 'gemini' | GeminiDmChannelId)[];
  content: string;
  promptDelivered?: string;
  taskId?: string;
  attachments?: string[];
  createdAt: number;
}

export interface CommandActivityLog {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warn' | 'error';
  agentId?: MuseAgentId | 'system' | 'chairman' | 'gemini';
  taskId?: string;
  runId?: string;
  action: string;
  detail: string;
}

export interface CommandBackupRecord {
  id: string;
  createdAt: number;
  kind: 'auto' | 'manual' | 'pre_restore' | 'cloud_handoff';
  projectId: string;
  runId?: string;
  summary: string;
  messageCount: number;
  taskCount: number;
  memoryVersion: number;
}

export interface PerformanceAlert {
  id: string;
  createdAt: number;
  severity: 'warn' | 'error';
  category: 'offline' | 'hung_timeout' | 'slow_response' | 'format_error';
  agentId?: MuseAgentId;
  taskId?: string;
  runId?: string;
  message: string;
  resolved?: boolean;
}

export interface FastCommStats {
  sseClientsConnected: number;
  avgDispatchAckMs: number;
  avgAgentResponseMs: number;
  aiBusMessageCount: number;
  hungTaskCount: number;
  dedupedTaskCount: number;
}

export interface CloudOrchestratorConfig {
  muse2ApiBaseUrl: string;
  hasCustomMuse2ApiKey: boolean;
  maskedMuse2ApiKey: string;
  parallelLimit: number;
  perAgentConcurrencyLimit?: number;
  qaPassThreshold: number;
  maxRetriesPerScene: number;
  maxIncidentRetries?: number;
  autoDirectorIncidentResponse?: boolean;
  autoApproveAfterMaxRetries?: boolean;
  autoBackupRealtime: boolean;
  workerHeartbeatAt: number;
  workerBootId: string;
  isCloudEndpoint: boolean;
}

export interface MuseIntegrationHealth {
  muse2ApiReachable: boolean;
  muse2ApiReady: boolean;
  muse2ApiStatus: 'ready' | 'no_account' | 'auth_error' | 'offline';
  muse2ApiBaseUrl: string;
  accountsCount: number;
  healthyAccounts: number;
  accounts: {
    id: string;
    label: string;
    enabled: boolean;
    ok?: boolean;
    status?: string;
    error?: string;
    quotaText?: string;
  }[];
  geminiConfigured: boolean;
  ffmpegAvailable: boolean;
  warnings: string[];
  checkedAt: number;
}

export interface CommandCenterSummaryMetrics {
  connectedAgents: number;
  totalAgents: number;
  workingAgents: number;
  supervisingAgents: number;
  waitingAgents: number;
  pausedAgents: number;
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  totalTasks: number;
}

export interface StudioSyncedDirective {
  syncedAt: number;
  sourceAction: 'expand_idea' | 'learn_script' | 'save_project' | 'generate_video' | 'manual_dispatch';
  mode: 'creative' | 'derivative';
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
  characterCount: number;
  sceneCount: number;
  hasBlueprint: boolean;
}

export type IncidentCategory =
  | 'wrong_character'
  | 'wrong_dialogue'
  | 'wrong_voice'
  | 'wrong_costume'
  | 'wrong_setting'
  | 'motion_error'
  | 'ai_output_format_error'
  | 'video_technical_error'
  | 'muse_disconnected'
  | 'recurring_error';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'reported'
  | 'investigating'
  | 'remediating'
  | 'verifying'
  | 'resolved'
  | 'escalated_to_user';

export interface IncidentDialogTurn {
  id: string;
  timestamp: number;
  actorId: MuseAgentId | 'system' | 'user' | 'chairman';
  actorName: string;
  roleBadge: string;
  kind:
    | 'report'
    | 'question'
    | 'explanation'
    | 'directive'
    | 'progress'
    | 'qa_review'
    | 'resolution'
    | 'escalation';
  content: string;
  attachments?: string[];
}

export interface IncidentTechnicalDiagnosis {
  errorType: string;
  taskCode?: string;
  taskType?: string;
  agentName?: string;
  provider?: string;
  failedLocation?: string;
  excerpt?: string;
  rootCauseDetail: string;
  directorRemediationPlan: string;
}

export type ChairmanActionType =
  | 'patch_and_retry'
  | 'switch_engine_and_retry'
  | 'reassign_muse'
  | 'fix_scene_memory_and_regen'
  | 'adjust_qa_and_approve'
  | 'reset_stuck_run'
  | 'direct_briefing';

export interface ChairmanScenePatch {
  dialogue?: string;
  costume?: string;
  actionDetail?: string;
  settingDetail?: string;
}

export interface ChairmanPlanOption {
  id: string;
  label: string;
  recommended?: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
  actionType: ChairmanActionType;
  targetAgentId: MuseAgentId;
  executionCommand: string;
  scenePatch?: ChairmanScenePatch;
  estimatedOutcome: string;
  executedAt?: number;
}

export interface ChairmanBriefing {
  id: string;
  createdAt: number;
  incidentId?: string;
  incidentCode?: string;
  runId?: string;
  trigger: 'auto_takeover' | 'incident_analysis' | 'executive_order';
  userRequest?: string;
  rootCauseDiagnosis: string;
  critiqueOfMuseTeam: string;
  executiveSummary: string;
  options: ChairmanPlanOption[];
  selectedOptionId?: string;
  autoExecuted?: boolean;
  executionLog?: string;
}

export interface ChairmanConfig {
  enabled: boolean;
  name: string;
  title: string;
  autoInterveneOnIncident: boolean;
  autoExecuteRecommended: boolean;
  strictOversightMode: boolean;
  autonomousUpgraded?: boolean;
}

export interface IncidentRecord {
  id: string;
  code: string;
  projectId: string;
  sessionId: string;
  runId: string;
  taskId?: string;
  sceneId?: string;
  sceneIndex?: number;
  timestampRange?: string;
  reporterAgentId: MuseAgentId | 'chairman';
  responsibleAgentId: MuseAgentId;
  assignedFixAgentId: MuseAgentId;
  category: IncidentCategory;
  categoryLabel: string;
  severity: IncidentSeverity;
  priority: 'urgent' | 'high' | 'normal';
  status: IncidentStatus;
  errorDescription: string;
  suspectedRootCause: string;
  analyzedRootCause?: string;
  initialProposal: string;
  directorPlan?: string;
  directorCommand?: string;
  artifactUrls: string[];
  referenceDataSummary: string;
  attemptCount: number;
  maxAttempts: number;
  remediationTaskIds: string[];
  qaVerificationTaskId?: string;
  withinAutonomyScope: boolean;
  escalationReason?: string;
  resolutionSummary?: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  costumeMismatch?: CostumeMismatchReport;
  versionHistory?: CostumeVersionSnapshot[];
  technicalDiagnosis?: IncidentTechnicalDiagnosis;
  chairmanBriefingId?: string;
  chairmanOptions?: ChairmanPlanOption[];
  chairmanTakeoverCount?: number;
  history: IncidentDialogTurn[];
}

export type CommandCenterSseEventType =
  | 'state:sync'
  | 'run:updated'
  | 'task:updated'
  | 'message:created'
  | 'agent:updated'
  | 'metric:updated'
  | 'alert:created'
  | 'incident:updated';

export interface CommandCenterState {
  metrics: CommandCenterSummaryMetrics;
  agents: MuseAgentConfig[];
  chairmanConfig: ChairmanConfig;
  chairmanBriefings: ChairmanBriefing[];
  projectMemory: ProjectMemory;
  latestStudioDirective?: StudioSyncedDirective | null;
  selectedRunId?: string | null;
  activeRun: ProductionRun | null;
  runs: ProductionRun[];
  tasks: CommandTask[];
  qaReports: QaInspectionReport[];
  incidents: IncidentRecord[];
  conversations: ConversationMessage[];
  logs: CommandActivityLog[];
  backups: CommandBackupRecord[];
  performanceAlerts: PerformanceAlert[];
  fastCommStats: FastCommStats;
  cloudConfig: CloudOrchestratorConfig;
  integrationHealth: MuseIntegrationHealth;
  geminiAccounts?: GeminiAccountPublic[];
}
