import type {
  CharacterFivePartProfile,
  DerivativeAspectRatio,
  StudioVideoStyle,
} from './bilibili';

export type IndependentVideoSource = 'gemini' | 'qwen' | 'muse' | 'google_flow';

export type AiReadinessStatus = 'ready' | 'unconfigured' | 'offline' | 'error';

export interface AiEngineReadinessItem {
  id: 'gemini' | 'qwen' | 'muse' | 'google_flow' | 'ffmpeg';
  name: string;
  role: string;
  independentSource?: IndependentVideoSource;
  status: AiReadinessStatus;
  latencyMs?: number;
  activeModel?: string;
  accountSummary?: string;
  detail: string;
  checkedAt: number;
}

export type CoordinationTaskStatus =
  | 'CHO_NHAN'
  | 'DANG_LAM'
  | 'HOAN_THANH'
  | 'LOI'
  | 'CHO_NHAP_FLOW';

export type CoordinationTaskStep = 1 | 2 | 3 | 4;

export interface CoordinationReferenceItem {
  refId: string;
  sessionId: string;
  kind:
    | 'script'
    | 'character'
    | 'visual_bible'
    | 'setting_bible'
    | 'costume_bible'
    | 'continuity_bible';
  name: string;
  detail: string;
  characterId?: string;
  syncProfile?: CharacterFivePartProfile;
  localUrl?: string;
  localFileName?: string;
  driveFileId?: string;
  driveUrl?: string;
  updatedAt: number;
}

export interface CoordinationSceneSpec {
  sceneId: string;
  sceneIndex: number;
  title: string;
  durationSec: number;
  narration: string;
  dialogue: string;
  charactersInScene: string;
  selectedCharacterIds?: string[];
  settingDetail: string;
  actionDetail: string;
  costume: string;
  cameraAngle: string;
  cameraMovement: string;
  lighting: string;
  vfxNotes: string;
  videoTimeline: string;
  imagePrompt: string;
  videoPrompt: string;
}

export interface CoordinationTaskRow {
  taskCode: string;
  sessionId: string;
  step: CoordinationTaskStep;
  stepLabel: string;
  sceneIndex?: number;
  sceneId?: string;
  title: string;
  instructions: string;
  videoSourceLock: IndependentVideoSource;
  assignedAiLabel: string;
  assignedAccountId?: string;
  assignedAccountLabel?: string;
  dependsOnTaskCodes: string[];
  inputRefIds: string[];
  inputDriveLinks: string[];
  status: CoordinationTaskStatus;
  resultSummary?: string;
  localOutputUrl?: string;
  localOutputFileName?: string;
  driveFileId?: string;
  driveOutputUrl?: string;
  errorReason?: string;
  retryCount: number;
  flowPrompt?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface MeetingRoomMessage {
  id: string;
  sessionId: string;
  createdAt: number;
  senderId: string;
  senderName: string;
  senderRole: string;
  kind: 'report' | 'claim' | 'completed' | 'error' | 'sync' | 'user' | 'coordinator';
  taskCode?: string;
  content: string;
  referenceLink?: string;
}

export type CoordinationSessionStatus =
  | 'CHO_CHAY'
  | 'DANG_CHAY'
  | 'CHO_FLOW'
  | 'HOAN_THANH'
  | 'CO_LOI'
  | 'TAM_DUNG';

export interface CoordinationVoiceConfig {
  enableVoiceover: boolean;
  voiceMode: 'none' | 'ai_online' | 'offline_system';
  voice?: string;
  voiceStyle?: string;
  offlineVoice?: string;
  productionFormat?: 'dialogue_film' | 'narration_story';
}

export interface CoordinationSession {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sourceAction: 'studio_dispatch' | 'manual_order';
  videoSource: IndependentVideoSource;
  aspectRatio: DerivativeAspectRatio;
  videoStyle: StudioVideoStyle;
  allowFreeCostumeChange: boolean;
  status: CoordinationSessionStatus;
  scriptSummary: string;
  visualBible: string;
  settingBible: string;
  costumeBible: string;
  continuityBible: string;
  scenes: CoordinationSceneSpec[];
  references: CoordinationReferenceItem[];
  tasks: CoordinationTaskRow[];
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderUrl?: string;
  finalVideoLocalUrl?: string;
  finalVideoDriveUrl?: string;
  lastSheetsSyncAt?: number;
  lastError?: string;
  parallelDispatchSummary?: string;
  voiceConfig?: CoordinationVoiceConfig;
  musicConfig?: {
    musicMode: 'none' | 'auto_adaptive' | 'ai_lyria' | 'public_free' | 'uploaded';
    musicStyle?: string;
    musicPrompt?: string;
    musicVolume: number; // 0..0.9 (max 90%)
    musicAssetId?: string;
    publicMusicUrl?: string;
    instrumentalOnly?: boolean;
  };
}

export interface CoordinationWorkspaceConfig {
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  rootFolderUrl?: string;
  lastSyncedAt?: number;
}

export interface CoordinationCenterState {
  readiness: AiEngineReadinessItem[];
  readinessCheckedAt: number;
  workspace: CoordinationWorkspaceConfig;
  activeSessionId: string | null;
  sessions: CoordinationSession[];
  meetingMessages: MeetingRoomMessage[];
  updatedAt: number;
}
