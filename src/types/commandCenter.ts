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
  | 'director'
  | 'screenwriter'
  | 'image_designer'
  | 'video_director'
  | 'qa_supervisor';

export type MuseAgentStatus =
  | 'online'
  | 'working'
  | 'waiting'
  | 'supervising'
  | 'paused'
  | 'offline'
  | 'error';

export type MuseAgentEngineMode = 'muse2api' | 'muse2api_with_gemini_fallback';

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

export interface QaInspectionReport {
  id: string;
  sceneId: string;
  sceneIndex: number;
  runId: string;
  inspectorAgentId: MuseAgentId;
  checkedAt: number;
  overallScore: number;
  passed: boolean;
  threshold: number;
  criteriaResults: QaCriterionResult[];
  timestampRange: string;
  summary: string;
  targetFixAgentId?: 'muse-02' | 'muse-03' | 'muse-04';
  fixInstruction?: string;
  attemptNumber: number;
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
}

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
    visualBible: string;
    settingBible: string;
    costumeBible: string;
    continuityBible: string;
    timelineSummary: string;
    characters: CommandMemoryCharacter[];
    scenes: CommandMemoryScene[];
  };
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
  visualBible: string;
  settingBible: string;
  costumeBible: string;
  continuityBible: string;
  timelineSummary: string;
  characters: CommandMemoryCharacter[];
  scenes: CommandMemoryScene[];
  snapshots: ProjectMemorySnapshot[];
}

export type CommandTaskType =
  | 'plan_production'
  | 'analyze_script'
  | 'design_character_ref'
  | 'design_scene_image'
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
  assignedAgentId: MuseAgentId;
  dependsOnTaskIds: string[];
  sceneId?: string;
  sceneIndex?: number;
  characterId?: string;
  status: CommandTaskStatus;
  priority: number;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  acknowledgedAt?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  timeoutMs?: number;
  executedByProvider?: string;
  boundAccountUsed?: string;
  externalTaskId?: string;
  outputText?: string;
  outputArtifactUrl?: string;
  error?: string;
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
  error?: string;
}

export type CommunicationChannelId =
  | 'commander'
  | 'incident'
  | 'production'
  | 'script'
  | 'visual'
  | 'video'
  | 'qa'
  | 'ai_bus'
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
  targetAgentIds?: MuseAgentId[];
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
  agentId?: MuseAgentId | 'system';
  taskId?: string;
  runId?: string;
  action: string;
  detail: string;
}

export interface CommandBackupRecord {
  id: string;
  createdAt: number;
  kind: 'auto' | 'manual' | 'pre_restore';
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
  qaPassThreshold: number;
  maxRetriesPerScene: number;
  maxIncidentRetries?: number;
  autoDirectorIncidentResponse?: boolean;
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
  actorId: MuseAgentId | 'system' | 'user';
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
  reporterAgentId: MuseAgentId;
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
}
