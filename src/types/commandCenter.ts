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
  permissions: MuseAgentPermissions;
  currentTaskId?: string;
  currentTaskSummary?: string;
  lastActiveAt?: number;
  lastError?: string;
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
  startedAt?: number;
  completedAt?: number;
  executedByProvider?: string;
  boundAccountUsed?: string;
  externalTaskId?: string;
  outputText?: string;
  outputArtifactUrl?: string;
  error?: string;
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
    | 'failed'
    | 'needs_attention';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  finalVideoUrl?: string;
  finalVideoArtifactName?: string;
  finalDurationSec?: number;
  sceneCount: number;
  completedScenes: number;
  passedQaScenes: number;
  escalatedScenes: number;
  error?: string;
}

export interface ConversationMessage {
  id: string;
  channel: 'group' | MuseAgentId;
  projectId: string;
  runId?: string;
  senderType: 'user' | 'agent' | 'system';
  senderId: string;
  senderName: string;
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

export interface CloudOrchestratorConfig {
  muse2ApiBaseUrl: string;
  hasCustomMuse2ApiKey: boolean;
  maskedMuse2ApiKey: string;
  parallelLimit: number;
  qaPassThreshold: number;
  maxRetriesPerScene: number;
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

export interface CommandCenterState {
  metrics: CommandCenterSummaryMetrics;
  agents: MuseAgentConfig[];
  projectMemory: ProjectMemory;
  latestStudioDirective?: StudioSyncedDirective | null;
  activeRun: ProductionRun | null;
  runs: ProductionRun[];
  tasks: CommandTask[];
  qaReports: QaInspectionReport[];
  conversations: ConversationMessage[];
  logs: CommandActivityLog[];
  backups: CommandBackupRecord[];
  cloudConfig: CloudOrchestratorConfig;
  integrationHealth: MuseIntegrationHealth;
}

