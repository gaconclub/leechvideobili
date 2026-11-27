import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Film,
  Upload,
  Search,
  Sparkles,
  Wand2,
  UserCheck,
  Music,
  Mic,
  Play,
  Plus,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  BookOpen,
  Settings,
  X,
  Clapperboard,
  Layers,
  Clock,
  ListVideo,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Save,
  Library,
  ArrowLeft,
  ArrowRight,
  HelpCircle,
  Lock,
  Volume2,
  ShieldCheck,
  Wrench,
  Eye,
  Camera,
  Pencil,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import {
  AiMusicStyleId,
  AiProviderId,
  BrollSourceId,
  CharacterAgeGroup,
  CharacterFivePartProfile,
  DerivativeAspectRatio,
  DerivativeBlueprint,
  DerivativeJobState,
  DerivativeMusicMode,
  DerivativeOutputLanguage,
  DerivativeScene,
  DerivativeSceneProgress,
  DerivativeStylePreset,
  DerivativeVisualMode,
  DerivativeVoiceId,
  DerivativeVoiceMode,
  ExpandedCreativeIdeaItem,
  LearnedVideoStyle,
  OfflineTtsVoiceOption,
  ServerCapabilitiesStatus,
  StudioCharacterRef,
  StudioCreationMode,
  StudioDefaultConfig,
  StudioLibraryVideoItem,
  StudioMusicTrack,
  StudioProductionFormat,
  StudioProjectProfile,
  StudioSavedCharacter,
  StudioScriptMode,
  StudioUploadedAsset,
  StudioVideoStyle,
  TrendingPlatformId,
  TrendingVideoItem,
} from '../types/bilibili';
import { formatBytes, formatDuration } from '../utils/formatters';
import { getGoogleWorkspaceAccessToken } from '../lib/googleWorkspaceAuth';
import { getDiscoveryThumbUrl } from './VideoDiscoveryCard';
import {
  AI_MUSIC_STYLE_OPTIONS,
  autoFixClientBlueprint,
  buildSceneTimelineFallbackClient,
  buildVideoMusicPromptDirectiveClient,
  CHARACTER_AGE_GROUP_OPTIONS,
  compileScenePromptClient,
  compressImageFileToDataUrl,
  DURATION_PRESETS,
  fetchStudioJsonWithAutoRetry,
  GEMINI_VOICE_LIBRARY,
  LANGUAGE_OPTIONS,
  NORTHERN_VN_ACCENT_BADGE,
  parseJsonSafe,
  PRODUCTION_FORMAT_OPTIONS,
  resolveVideoStyleMetaClient,
  runClientBlueprintQc,
  STYLE_OPTIONS,
  uploadMediaFileToStudio,
  VOICE_OPTIONS,
} from './studio/studioConfig';
import { StudioSceneCard } from './studio/StudioSceneCard';
import { StudioStylePicker } from './studio/StudioStylePicker';
import { LearnStyleModal } from './studio/LearnStyleModal';
import {
  deleteLocalCharacter,
  loadLocalCharacterLibrary,
  mergeCharacterLibraries,
  replaceLocalCharacterLibrary,
  upsertLocalCharacter,
} from '../lib/characterLibraryDb';

export interface StudioUploadedSourceItem {
  videoItem: TrendingVideoItem & {
    localAssetId: string;
    keyframes: string[];
    hasAudio: boolean;
  };
  asset: StudioUploadedAsset;
}

interface StudioPanelProps {
  incomingVideos: TrendingVideoItem[];
  incomingQuery?: string;
  incomingNonce?: number;
  sessdata: string;
  ytCookies: string;
  studioDefaults: StudioDefaultConfig;
  onOpenSettings: () => void;
  onOpenCommandCenter?: () => void;
}

const CREATIVE_IDEA_STARTERS = [
  {
    label: 'Điện ảnh ngắn · 10 cảnh',
    idea: 'Một lập trình viên trẻ tình cờ phát hiện trí tuệ nhân tạo mình tạo ra có cảm xúc thật, quyết định bảo vệ nó giữa thành phố mưa đêm.',
    style: 'cinematic' as StudioVideoStyle,
    scenes: 10,
    dur: 60,
  },
  {
    label: 'Người que · Giải thích',
    idea: 'Giải thích quy tắc 80/20 trong quản lý thời gian và cách người bình thường bứt phá hiệu suất chỉ trong 1 tuần.',
    style: 'stickman' as StudioVideoStyle,
    scenes: 6,
    dur: 40,
  },
  {
    label: 'Anime · Hành trình',
    idea: 'Cô gái kiếm sĩ trẻ bước vào khu rừng cổ đại để tìm lại ký ức bị đánh mất cùng người bạn đồng hành.',
    style: 'anime' as StudioVideoStyle,
    scenes: 8,
    dur: 60,
  },
  {
    label: 'Chuyên nghiệp · Kinh doanh',
    idea: '3 sai lầm phổ biến khiến video ngắn không có lượt xem và công thức giữ chân khán giả trong 3 giây đầu.',
    style: 'professional' as StudioVideoStyle,
    scenes: 5,
    dur: 30,
  },
];

export const StudioPanel: React.FC<StudioPanelProps> = ({
  incomingVideos,
  incomingQuery = '',
  incomingNonce = 0,
  sessdata,
  ytCookies,
  studioDefaults,
  onOpenSettings,
  onOpenCommandCenter,
}) => {
  const [capabilities, setCapabilities] = useState<ServerCapabilitiesStatus | null>(null);

  // Separate Studio Mode: 'creative' (Studio Sáng Tạo) vs 'derivative' (Tạo Video Phái Sinh)
  const [studioMode, setStudioMode] = useState<StudioCreationMode>('creative');

  // Mode 1: Creative Idea Inputs (Seed Summary -> N AI Expanded Ideas -> Direct Per-Idea Script Prompt -> Step 2)
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [ideaCount, setIdeaCount] = useState<number>(3);
  const [expandedIdeas, setExpandedIdeas] = useState<ExpandedCreativeIdeaItem[]>([]);
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [generatingIdeaId, setGeneratingIdeaId] = useState<string | null>(null);
  const [expandedIdeaPrompt, setExpandedIdeaPrompt] = useState('');
  const [isExpandingIdea, setIsExpandingIdea] = useState(false);
  const [expandIdeaError, setExpandIdeaError] = useState('');

  // Mode 2: Derivative Reference Video Sources (uploaded local + searched/pushed online)
  const [sources, setSources] = useState<
    (TrendingVideoItem & { localAssetId?: string; keyframes?: string[]; hasAudio?: boolean })[]
  >([]);
  const [isUploadingVideos, setIsUploadingVideos] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [uploadError, setUploadError] = useState('');
  const videoUploadInputRef = useRef<HTMLInputElement>(null);
  const [isWatchingReferenceVideo, setIsWatchingReferenceVideo] = useState(false);
  const [watchVideoError, setWatchVideoError] = useState('');
  const [watchVideoSuccess, setWatchVideoSuccess] = useState('');
  const [watchedSceneHighlights, setWatchedSceneHighlights] = useState<string[]>([]);

  // Inline Project Library Drawer for Derivative Reference Videos
  const [libraryItems, setLibraryItems] = useState<StudioLibraryVideoItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [importingJobId, setImportingJobId] = useState<string | null>(null);

  // Inline Search Drawer to pull videos directly into Derivative mode
  const [searchQueryInput, setSearchQueryInput] = useState('');
  const [searchPlatform, setSearchPlatform] = useState<TrendingPlatformId>('all');
  const [isSearchingSources, setIsSearchingSources] = useState(false);
  const [searchResults, setSearchResults] = useState<TrendingVideoItem[]>([]);
  const [searchError, setSearchError] = useState('');

  // Shared Project Profiles & 5-Component Consistency Bibles
  const [projectProfiles, setProjectProfiles] = useState<StudioProjectProfile[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [projectNameInput, setProjectNameInput] = useState<string>('');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [projectStatusMsg, setProjectStatusMsg] = useState('');

  const [characters, setCharacters] = useState<StudioCharacterRef[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [isAnalyzingCharacters, setIsAnalyzingCharacters] = useState(false);
  const [charAnalyzeError, setCharAnalyzeError] = useState('');
  const [charNameInput, setCharNameInput] = useState('');
  const [charPromptInput, setCharPromptInput] = useState('');
  const [charAgeGroupInput, setCharAgeGroupInput] = useState<CharacterAgeGroup>('auto');
  const [charVoiceModeInput, setCharVoiceModeInput] = useState<'default' | 'ai_online' | 'offline_system'>('default');
  const [charVoiceIdInput, setCharVoiceIdInput] = useState<Exclude<DerivativeVoiceId, 'none'>>('Kore');
  const [charOfflineVoiceInput, setCharOfflineVoiceInput] = useState<string>('');
  const [isGeneratingChar, setIsGeneratingChar] = useState(false);
  const [charError, setCharError] = useState('');
  const charUploadInputRef = useRef<HTMLInputElement>(null);
  const charReplaceInputRef = useRef<HTMLInputElement>(null);
  const [characterLibrary, setCharacterLibrary] = useState<StudioSavedCharacter[]>([]);
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [charLibraryQuery, setCharLibraryQuery] = useState('');
  const [charLibraryStatus, setCharLibraryStatus] = useState('');
  const [savingLibraryCharId, setSavingLibraryCharId] = useState('');
  const [confirmDeleteLibCharId, setConfirmDeleteLibCharId] = useState('');
  const [editingLibCharId, setEditingLibCharId] = useState('');
  const [editingLibName, setEditingLibName] = useState('');
  const [editingLibDesc, setEditingLibDesc] = useState('');
  const [replaceImageTarget, setReplaceImageTarget] = useState<{ scope: 'active' | 'library'; id: string } | null>(
    null
  );
  const [selectedCoordSceneIdsByBp, setSelectedCoordSceneIdsByBp] = useState<Record<string, string[]>>({});
  const charLibrarySyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      for (const timer of Object.values(charLibrarySyncTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const selectedChar = characters.find((c) => c.id === selectedCharacterId) || characters[0] || null;

  const [characterBibleDraft, setCharacterBibleDraft] = useState('');
  const [settingBibleDraft, setSettingBibleDraft] = useState('');
  const [visualStyleBibleDraft, setVisualStyleBibleDraft] = useState('');
  const [costumeBibleDraft, setCostumeBibleDraft] = useState('');
  const [continuityBibleDraft, setContinuityBibleDraft] = useState('');

  // Script & Production Config
  const [aiProvider, setAiProvider] = useState<AiProviderId>(
    (studioDefaults.aiProvider as string) === 'muse' ? 'gemini' : studioDefaults.aiProvider || 'gemini'
  );
  const [useProModel, setUseProModel] = useState(false);
  const [outputLanguage, setOutputLanguage] = useState<DerivativeOutputLanguage>('vi');
  const [videoStyle, setVideoStyle] = useState<StudioVideoStyle>('cinematic');
  const [customStylePrompt, setCustomStylePrompt] = useState('');
  const [learnedStyles, setLearnedStyles] = useState<LearnedVideoStyle[]>([]);
  const [isLearnStyleModalOpen, setIsLearnStyleModalOpen] = useState(false);
  const [enableNarrativeStyle, setEnableNarrativeStyle] = useState<boolean>(false);
  const [stylePreset, setStylePreset] = useState<DerivativeStylePreset>(
    studioDefaults.stylePreset && studioDefaults.stylePreset !== 'none'
      ? studioDefaults.stylePreset
      : 'storytelling_review'
  );
  const [aspectRatio, setAspectRatio] = useState<DerivativeAspectRatio>(
    studioDefaults.aspectRatioMode === '16:9'
      ? '16:9'
      : studioDefaults.aspectRatioMode === '1:1'
      ? '1:1'
      : '9:16'
  );
  const [targetDurationSec, setTargetDurationSec] = useState<number>(
    studioDefaults.targetDurationSec >= 10 ? studioDefaults.targetDurationSec : 60
  );
  const [scriptMode, setScriptMode] = useState<StudioScriptMode>('series');
  const [productionFormat, setProductionFormat] = useState<StudioProductionFormat>('dialogue_film');
  const [allowFreeCostumeChange, setAllowFreeCostumeChange] = useState<boolean>(false);
  const [showManualNarrationMusic, setShowManualNarrationMusic] = useState(false);
  const [showScriptModeGuide, setShowScriptModeGuide] = useState(false);
  const [desiredSceneCount, setDesiredSceneCount] = useState<number | 'auto'>('auto');
  const [customInstruction, setCustomInstruction] = useState('');
  const [activeStudioStep, setActiveStudioStep] = useState<1 | 2 | 3>(1);
  const [sourceInputTab, setSourceInputTab] = useState<'list' | 'library' | 'search'>('list');
  const [configTab, setConfigTab] = useState<'script' | 'media' | 'audio'>('script');
  const [showDraftBible, setShowDraftBible] = useState(false);
  const [reviewMetaTab, setReviewMetaTab] = useState<'summary' | 'analysis' | 'bible'>('summary');

  // Independent Blueprints & Jobs per mode so switching tabs preserves user's work
  const [batchBlueprintsByMode, setBatchBlueprintsByMode] = useState<
    Record<StudioCreationMode, DerivativeBlueprint[]>
  >({
    creative: [],
    derivative: [],
  });
  const [activeBatchIdxByMode, setActiveBatchIdxByMode] = useState<
    Record<StudioCreationMode, number>
  >({
    creative: 0,
    derivative: 0,
  });
  const [sharedSpiritByMode, setSharedSpiritByMode] = useState<
    Record<StudioCreationMode, string>
  >({
    creative: '',
    derivative: '',
  });
  const [isLearning, setIsLearning] = useState(false);
  const [learningElapsedSec, setLearningElapsedSec] = useState(0);
  const [learnError, setLearnError] = useState('');
  const [learnSuccess, setLearnSuccess] = useState('');
  const [isDispatchingToCommandCenter, setIsDispatchingToCommandCenter] = useState(false);
  const [commandCenterError, setCommandCenterError] = useState('');

  const blueprints = batchBlueprintsByMode[studioMode];
  const activeBatchIndex = Math.min(
    Math.max(0, activeBatchIdxByMode[studioMode]),
    Math.max(0, blueprints.length - 1)
  );
  const blueprint = blueprints[activeBatchIndex] || null;
  const activeJobKey = `${studioMode}:${activeBatchIndex}`;

  const setActiveBatchIndex = (idx: number) => {
    setActiveBatchIdxByMode((prev) => ({ ...prev, [studioMode]: idx }));
  };

  const setBlueprint = (
    updater:
      | DerivativeBlueprint
      | null
      | ((prev: DerivativeBlueprint | null) => DerivativeBlueprint | null)
  ) => {
    setBatchBlueprintsByMode((prevMap) => {
      const list = prevMap[studioMode] || [];
      const targetIdx = Math.min(Math.max(0, activeBatchIdxByMode[studioMode]), Math.max(0, list.length - 1));
      const current = list[targetIdx] || null;
      const nextVal = typeof updater === 'function' ? updater(current) : updater;
      if (!nextVal) {
        return { ...prevMap, [studioMode]: [] };
      }
      if (list.length === 0) {
        return { ...prevMap, [studioMode]: [nextVal] };
      }
      const nextList = list.map((item, i) => (i === targetIdx ? nextVal : item));
      return { ...prevMap, [studioMode]: nextList };
    });
  };

  const unifiedUnitCount = Math.max(1, Math.min(15, Math.round(Number(ideaCount || 3))));
  const unifiedTotalDurationSec = unifiedUnitCount * targetDurationSec;

  // Per-scene generation states
  const [imageEngineMode, setImageEngineMode] = useState<'gemini_standard' | 'gemini_pro' | 'muse2api' | 'qwen'>(
    studioDefaults.visualMode === 'qwen_video'
      ? 'qwen'
      : studioDefaults.visualMode === 'gemini_omni'
      ? 'gemini_standard'
      : 'muse2api'
  );
  const [sceneVideoEngine, setSceneVideoEngine] = useState<'gemini' | 'muse2api' | 'qwen'>(
    studioDefaults.visualMode === 'qwen_video'
      ? 'qwen'
      : studioDefaults.visualMode === 'gemini_omni'
      ? 'gemini'
      : 'muse2api'
  );
  const [busySceneImageIds, setBusySceneImageIds] = useState<Set<string>>(new Set());
  const [queuedSceneImageIds, setQueuedSceneImageIds] = useState<Set<string>>(new Set());
  const [busySceneVideoIds, setBusySceneVideoIds] = useState<Set<string>>(new Set());
  const [isBatchGeneratingImages, setIsBatchGeneratingImages] = useState(false);
  const [batchImageProgress, setBatchImageProgress] = useState<{ current: number; total: number } | null>(null);
  const [sceneImageErrors, setSceneImageErrors] = useState<Record<string, string>>({});
  const [sceneMediaError, setSceneMediaError] = useState('');
  const batchImageAbortRef = useRef(false);

  // Production: Visual engine + Music + Voice + Final Render
  const [visualMode, setVisualMode] = useState<DerivativeVisualMode>(
    (studioDefaults.visualMode as string) === 'muse_edison'
      ? 'muse2api_video'
      : studioDefaults.visualMode || 'muse2api_video'
  );
  const [brollSource, setBrollSource] = useState<BrollSourceId>(studioDefaults.brollSource || 'wikimedia');

  const [musicMode, setMusicMode] = useState<DerivativeMusicMode>('none');
  const [musicStyle, setMusicStyle] = useState<AiMusicStyleId>('auto_context');
  const [musicInstrumentalOnly, setMusicInstrumentalOnly] = useState(true);
  const [musicPrompt, setMusicPrompt] = useState(
    'Nhạc nền hiện đại, truyền cảm hứng, tiết tấu vừa phải cho video kể chuyện'
  );
  const [musicVolume, setMusicVolume] = useState(25);
  const [publicMusicQuery, setPublicMusicQuery] = useState('ambient instrumental');
  const [isSearchingMusic, setIsSearchingMusic] = useState(false);
  const [publicMusicResults, setPublicMusicResults] = useState<StudioMusicTrack[]>([]);
  const [selectedPublicTrack, setSelectedPublicTrack] = useState<StudioMusicTrack | null>(null);
  const [uploadedAudioTrack, setUploadedAudioTrack] = useState<StudioMusicTrack | null>(null);
  const [musicError, setMusicError] = useState('');
  const audioUploadInputRef = useRef<HTMLInputElement>(null);

  const activeMusicPromptDirective = useMemo(
    () =>
      buildVideoMusicPromptDirectiveClient({
        musicMode,
        musicStyle,
        musicPrompt,
        musicVolume,
        instrumentalOnly: musicInstrumentalOnly,
      }),
    [musicMode, musicStyle, musicPrompt, musicVolume, musicInstrumentalOnly]
  );

  const [voiceMode, setVoiceMode] = useState<DerivativeVoiceMode>(
    studioDefaults.voice === 'none' ? 'none' : 'ai_online'
  );
  const lastActiveVoiceModeRef = useRef<Exclude<DerivativeVoiceMode, 'none'>>('ai_online');
  const [voice, setVoice] = useState<Exclude<DerivativeVoiceId, 'none'>>(
    studioDefaults.voice === 'none' ? 'Kore' : studioDefaults.voice
  );
  const [offlineVoices, setOfflineVoices] = useState<OfflineTtsVoiceOption[]>([]);
  const [offlineVoice, setOfflineVoice] = useState<string>(studioDefaults.offlineVoice || '');
  const [isInstallingVieNeu, setIsInstallingVieNeu] = useState(false);
  const [offlineTtsNotice, setOfflineTtsNotice] = useState('');
  const [previewingSceneId, setPreviewingSceneId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const [keepSourceAudio, setKeepSourceAudio] = useState(studioDefaults.keepSourceAudio);

  useEffect(() => {
    if (voiceMode !== 'none') {
      lastActiveVoiceModeRef.current = voiceMode;
    }
  }, [voiceMode]);

  const handleToggleVoiceover = (enable: boolean) => {
    if (enable) {
      setVoiceMode(lastActiveVoiceModeRef.current || 'ai_online');
    } else {
      if (voiceMode !== 'none') {
        lastActiveVoiceModeRef.current = voiceMode;
      }
      setVoiceMode('none');
    }
    setBlueprint((prev) => (prev ? { ...prev, enableVoiceover: enable } : prev));
  };

  const [jobsByKey, setJobsByKey] = useState<Record<string, DerivativeJobState>>({});
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);
  const [isBatchRenderingAll, setIsBatchRenderingAll] = useState(false);
  const [batchRenderStatusText, setBatchRenderStatusText] = useState('');
  const [genError, setGenError] = useState('');
  const [retryingRenderSceneKey, setRetryingRenderSceneKey] = useState<string | null>(null);
  const [isResumingRenderJob, setIsResumingRenderJob] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const batchRenderAbortRef = useRef(false);

  const job = jobsByKey[activeJobKey] || null;
  const setJobForKey = (key: string, nextJob: DerivativeJobState | null) => {
    setJobsByKey((prev) => {
      const copy = { ...prev };
      if (!nextJob) delete copy[key];
      else copy[key] = nextJob;
      return copy;
    });
  };

  const fetchCapabilitiesAndVoices = async () => {
    try {
      const r = await fetch('/api/config/capabilities');
      if (r.ok) {
        const data = await parseJsonSafe<ServerCapabilitiesStatus>(r);
        setCapabilities(data);
      }
    } catch {
      // ignore
    }
    try {
      const vr = await fetch('/api/tts/offline/voices');
      if (vr.ok) {
        const vData = await parseJsonSafe<{ voices?: OfflineTtsVoiceOption[] }>(vr);
        const list = Array.isArray(vData.voices) ? vData.voices : [];
        setOfflineVoices(list);
        if (list.length > 0) {
          setOfflineVoice((prev) => (prev && list.some((v) => v.id === prev) ? prev : list[0].id));
        }
      }
    } catch {
      // ignore
    }
    try {
      const pr = await fetch('/api/studio/projects');
      if (pr.ok) {
        const pData = await parseJsonSafe<{ projects?: StudioProjectProfile[] }>(pr);
        if (Array.isArray(pData.projects)) {
          setProjectProfiles(pData.projects);
        }
      }
    } catch {
      // ignore
    }
    try {
      const sr = await fetch('/api/studio/learned-styles');
      if (sr.ok) {
        const sData = await parseJsonSafe<{ styles?: LearnedVideoStyle[] }>(sr);
        if (Array.isArray(sData.styles)) {
          setLearnedStyles(sData.styles);
        }
      }
    } catch {
      // ignore
    }
    let localChars: StudioSavedCharacter[] = [];
    try {
      localChars = await loadLocalCharacterLibrary();
      if (localChars.length > 0) {
        setCharacterLibrary(localChars);
      }
    } catch {
      // ignore IndexedDB error
    }
    try {
      const cr = await fetch('/api/studio/character-library');
      if (cr.ok) {
        const cData = await parseJsonSafe<{ characters?: StudioSavedCharacter[] }>(cr);
        const serverChars = Array.isArray(cData.characters) ? cData.characters : [];
        const { merged, missingOnServer } = mergeCharacterLibraries(serverChars, localChars);
        setCharacterLibrary(merged);
        void replaceLocalCharacterLibrary(merged).catch(() => {});
        // Push any characters restored from browser IndexedDB back to server disk
        if (missingOnServer.length > 0) {
          void (async () => {
            for (const item of missingOnServer) {
              try {
                await fetch('/api/studio/character-library', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(item),
                });
              } catch {
                // keep safely in IndexedDB
              }
            }
          })();
        }
      }
    } catch {
      // keep localChars loaded from IndexedDB
    }
  };

  const fetchLibraryVideos = async () => {
    setIsLoadingLibrary(true);
    try {
      const res = await fetch('/api/studio/library-videos');
      if (res.ok) {
        const data = await parseJsonSafe<{ videos?: StudioLibraryVideoItem[] }>(res);
        setLibraryItems(Array.isArray(data.videos) ? data.videos : []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const handleLoadProjectProfile = (profileId: string) => {
    setActiveProjectId(profileId);
    const found = projectProfiles.find((p) => p.id === profileId);
    if (!found) return;
    setProjectNameInput(found.name);
    if (found.videoStyle) setVideoStyle(found.videoStyle);
    setCharacterBibleDraft(found.characterBible || '');
    setSettingBibleDraft(found.settingBible || '');
    setVisualStyleBibleDraft(found.visualStyleBible || '');
    setCostumeBibleDraft(found.costumeBible || '');
    setContinuityBibleDraft(found.continuityBible || '');
    setAllowFreeCostumeChange(Boolean(found.allowFreeCostumeChange));
    setCharacters(Array.isArray(found.characterRefs) ? found.characterRefs : []);
    if (blueprint) {
      setBlueprint({
        ...blueprint,
        videoStyle: found.videoStyle || blueprint.videoStyle,
        characterBible: found.characterBible || blueprint.characterBible,
        settingBible: found.settingBible || blueprint.settingBible,
        visualStyleBible: found.visualStyleBible || blueprint.visualStyleBible,
        costumeBible: found.costumeBible || blueprint.costumeBible,
        continuityBible: found.continuityBible || blueprint.continuityBible,
        allowFreeCostumeChange: Boolean(found.allowFreeCostumeChange),
      });
    }
    setProjectStatusMsg(`Đã nạp hồ sơ dự án "${found.name}" (dùng chung cho Sáng tạo & Phái sinh).`);
  };

  const handleSaveProjectProfile = async () => {
    const cleanName =
      projectNameInput.trim() ||
      blueprint?.derivativeTitle?.trim() ||
      `Dự án Studio ${new Date().toLocaleDateString('vi-VN')}`;
    setIsSavingProject(true);
    setProjectStatusMsg('');
    try {
      const res = await fetch('/api/studio/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeProjectId || undefined,
          name: cleanName,
          videoStyle: blueprint?.videoStyle || videoStyle,
          characterBible: blueprint?.characterBible ?? characterBibleDraft,
          settingBible: blueprint?.settingBible ?? settingBibleDraft,
          visualStyleBible: blueprint?.visualStyleBible ?? visualStyleBibleDraft,
          costumeBible: blueprint?.costumeBible ?? costumeBibleDraft,
          continuityBible: blueprint?.continuityBible ?? continuityBibleDraft,
          allowFreeCostumeChange: blueprint?.allowFreeCostumeChange ?? allowFreeCostumeChange,
          characterRefs: characters.slice(0, 8),
        }),
      });
      const data = await parseJsonSafe<{ project?: StudioProjectProfile; error?: string }>(res);
      if (!res.ok || !data.project) throw new Error(data.error || `HTTP ${res.status}`);
      const saved = data.project;
      setProjectProfiles((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setActiveProjectId(saved.id);
      setProjectNameInput(saved.name);
      setProjectStatusMsg(`Đã lưu hồ sơ dự án "${saved.name}" vào kho dùng chung.`);
    } catch (err: any) {
      setProjectStatusMsg(err?.message || 'Không lưu được hồ sơ dự án.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleDeleteProjectProfile = async (id: string) => {
    try {
      const res = await fetch(`/api/studio/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setProjectProfiles((prev) => prev.filter((p) => p.id !== id));
        if (activeProjectId === id) {
          setActiveProjectId('');
        }
      }
    } catch {
      // ignore
    }
  };

  const handleSelectVideoStyle = (nextStyle: StudioVideoStyle, syncBlueprint = false) => {
    setVideoStyle(nextStyle);
    const foundLearned = nextStyle.startsWith('learned:')
      ? learnedStyles.find((s) => `learned:${s.id}` === nextStyle) || null
      : null;
    if (foundLearned) {
      const learnedTone = foundLearned.visualToneVi || foundLearned.promptDirective;
      if (learnedTone) {
        setVisualStyleBibleDraft(learnedTone);
      }
    }
    if (syncBlueprint && blueprint) {
      setBlueprint({
        ...blueprint,
        videoStyle: nextStyle,
        ...(foundLearned?.visualToneVi ? { visualStyleBible: foundLearned.visualToneVi } : {}),
      });
    }
  };

  const handleDeleteLearnedStyle = async (styleId: string) => {
    try {
      const res = await fetch(`/api/studio/learned-styles/${encodeURIComponent(styleId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return;
      const data = await parseJsonSafe<{ styles?: LearnedVideoStyle[] }>(res);
      const nextList = Array.isArray(data.styles)
        ? data.styles
        : learnedStyles.filter((s) => s.id !== styleId);
      setLearnedStyles(nextList);
      const targetKey = `learned:${styleId}`;
      if (videoStyle === targetKey) {
        setVideoStyle('cinematic');
      }
      if (blueprint && blueprint.videoStyle === targetKey) {
        setBlueprint({ ...blueprint, videoStyle: 'cinematic' });
      }
    } catch {
      // ignore
    }
  };

  const handleStyleLearned = (newStyle: LearnedVideoStyle, allStyles: LearnedVideoStyle[]) => {
    setLearnedStyles(allStyles);
    const nextStyleKey = `learned:${newStyle.id}` as StudioVideoStyle;
    setVideoStyle(nextStyleKey);
    const learnedTone = newStyle.visualToneVi || newStyle.promptDirective;
    if (learnedTone) {
      setVisualStyleBibleDraft(learnedTone);
    }
    if (blueprint) {
      setBlueprint({
        ...blueprint,
        videoStyle: nextStyleKey,
        ...(learnedTone ? { visualStyleBible: learnedTone } : {}),
      });
    }
  };

  const handlePickLibraryVideo = async (item: StudioLibraryVideoItem) => {
    if (sources.length >= 8) return;
    if (item.kind === 'uploaded' && item.localAssetId) {
      if (sources.some((s) => s.localAssetId === item.localAssetId)) return;
      setSources((prev) => [
        ...prev,
        {
          id: `lib_${item.localAssetId}`,
          platform: 'other',
          platformLabel: 'Thư viện dự án',
          title: item.title,
          author: 'Kho dự án',
          pic: item.keyframes?.[0] || '',
          sourceUrl: item.previewUrl,
          duration: Math.round(item.durationSec),
          views: 0,
          score: 99,
          category: 'library',
          categoryLabel: item.resolution || 'HD',
          orientation: 'unknown',
          localAssetId: item.localAssetId,
          keyframes: item.keyframes || [],
          hasAudio: true,
        },
      ]);
      return;
    }

    if (item.kind === 'rendered' && item.jobId) {
      setImportingJobId(item.jobId);
      setUploadError('');
      try {
        const res = await fetch('/api/studio/library-videos/import-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: item.jobId }),
        });
        const data = await parseJsonSafe<{ asset?: StudioUploadedAsset; error?: string }>(res);
        if (!res.ok || !data.asset) throw new Error(data.error || `HTTP ${res.status}`);
        const asset = data.asset;
        setSources((prev) => {
          if (prev.length >= 8 || prev.some((s) => s.localAssetId === asset.assetId)) return prev;
          return [
            ...prev,
            {
              id: `lib_${asset.assetId}`,
              platform: 'other',
              platformLabel: 'Video đã xuất dự án',
              title: item.title,
              author: 'Kho dự án',
              pic: asset.keyframes[0] || '',
              sourceUrl: asset.previewUrl,
              duration: Math.round(asset.durationSec),
              views: 0,
              score: 99,
              category: 'library',
              categoryLabel: asset.resolution,
              orientation: 'unknown',
              localAssetId: asset.assetId,
              keyframes: asset.keyframes,
              hasAudio: asset.hasAudio,
            },
          ];
        });
      } catch (err: any) {
        setUploadError(err?.message || 'Không thể nạp video từ thư viện dự án.');
      } finally {
        setImportingJobId(null);
      }
    }
  };

  useEffect(() => {
    if (!isLearning) {
      setLearningElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setLearningElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLearning]);

  useEffect(() => {
    void fetchCapabilitiesAndVoices();

    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Automatically switch to 'derivative' mode Step 1 when videos are pushed from Search or Trending tabs
  useEffect(() => {
    if (incomingVideos.length === 0) return;
    setStudioMode('derivative');
    setActiveStudioStep(1);
    setSourceInputTab('list');
    setSources((prev) => {
      const existingIds = new Set(prev.map((s) => s.sourceUrl || s.id));
      const merged = [...prev];
      for (const v of incomingVideos) {
        const key = v.sourceUrl || v.id;
        if (!existingIds.has(key) && merged.length < 8) {
          merged.push(v);
          existingIds.add(key);
        }
      }
      return merged;
    });
    if (incomingQuery && !searchQueryInput) {
      setSearchQueryInput(incomingQuery);
    }
  }, [incomingVideos, incomingNonce, incomingQuery]);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Upload multiple local videos
  const handleUploadVideos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setIsUploadingVideos(true);
    setUploadProgressText('Đang chuẩn bị tải video...');
    setUploadError('');
    try {
      for (const file of files) {
        if (file.size > 195 * 1024 * 1024) {
          throw new Error(`Tệp "${file.name}" vượt quá giới hạn 195MB mỗi video.`);
        }
        setUploadProgressText(`Đang tải ${file.name}...`);
        const asset = await uploadMediaFileToStudio<StudioUploadedAsset>(file, 'video', (pct) => {
          setUploadProgressText(
            pct >= 95 ? `Đang trích xuất khung hình (${file.name})...` : `Đang tải lên ${pct}%...`
          );
        });
        setSources((prev) => {
          if (prev.length >= 8) return prev;
          return [
            ...prev,
            {
              id: `local_${asset.assetId}`,
              platform: 'other',
              platformLabel: 'Video tải lên',
              title: asset.fileName.replace(/\.[^.]+$/, ''),
              author: 'Từ máy của bạn',
              pic: asset.keyframes[0] || '',
              sourceUrl: asset.previewUrl,
              duration: Math.round(asset.durationSec),
              views: 0,
              score: 99,
              category: 'upload',
              categoryLabel: asset.resolution,
              orientation: 'unknown',
              localAssetId: asset.assetId,
              keyframes: asset.keyframes,
              hasAudio: asset.hasAudio,
            },
          ];
        });
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Lỗi tải video lên máy chủ.');
    } finally {
      setIsUploadingVideos(false);
      setUploadProgressText('');
    }
  };

  const handleSearchSources = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQueryInput.trim();
    if (!q) return;
    setIsSearchingSources(true);
    setSearchError('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q,
          platform: searchPlatform,
          duration: 'all',
          orientation: 'all',
          sort: 'relevance',
          region: 'VN',
          sessdata,
          extraCookies: ytCookies,
        }),
      });
      const json = await parseJsonSafe<{ videos?: TrendingVideoItem[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSearchResults((json.videos || []).slice(0, 8));
    } catch (err: any) {
      setSearchError(err?.message || 'Không thể tìm kiếm video.');
    } finally {
      setIsSearchingSources(false);
    }
  };

  const handleAddSearchVideo = (video: TrendingVideoItem) => {
    setSources((prev) => {
      if (prev.length >= 8) return prev;
      if (prev.some((s) => s.id === video.id || s.sourceUrl === video.sourceUrl)) return prev;
      return [...prev, video];
    });
  };

  const handleRemoveSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  // Character uploads & AI generation (always adheres to active videoStyle + locked Northern Vietnamese accent)
  const buildNewCharacterVoiceConfig = () => {
    const ageMeta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === charAgeGroupInput);
    const voiceObj = GEMINI_VOICE_LIBRARY.find((v) => v.value === charVoiceIdInput);
    const resolvedOfflineVoice = charOfflineVoiceInput || offlineVoice || offlineVoices[0]?.id || undefined;
    return {
      ageGroup: charAgeGroupInput,
      voiceMode: charVoiceModeInput,
      voiceId: charVoiceModeInput === 'ai_online' ? charVoiceIdInput : charAgeGroupInput !== 'auto' ? ageMeta?.defaultVoiceId : undefined,
      offlineVoice: charVoiceModeInput === 'offline_system' ? resolvedOfflineVoice : undefined,
      voiceStyle: charVoiceModeInput === 'ai_online' ? voiceObj?.style : ageMeta?.pitchDirective,
      accentLock: 'vn_north' as const,
    };
  };

  const persistCharacterToLibrary = async (
    char: StudioCharacterRef,
    opts?: { silent?: boolean; explicitId?: string }
  ): Promise<StudioSavedCharacter | null> => {
    if (!char.dataUrl) return null;
    const now = Date.now();
    const existingLocal = characterLibrary.find(
      (c) => c.id === (opts?.explicitId || char.libraryId)
    );
    const stableLibId =
      opts?.explicitId ||
      char.libraryId ||
      `charlib_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const localRecord: StudioSavedCharacter = {
      id: stableLibId,
      name: (char.name || existingLocal?.name || 'Nhân vật chưa đặt tên').trim().slice(0, 80),
      dataUrl: char.dataUrl,
      ...(char.description !== undefined
        ? char.description.trim()
          ? { description: char.description.trim().slice(0, 600) }
          : {}
        : existingLocal?.description
          ? { description: existingLocal.description }
          : {}),
      source: char.source || existingLocal?.source || 'uploaded',
      ageGroup: char.ageGroup ?? existingLocal?.ageGroup,
      gender: char.gender ?? existingLocal?.gender,
      voiceMode: char.voiceMode ?? existingLocal?.voiceMode,
      voiceId: char.voiceId ?? existingLocal?.voiceId,
      offlineVoice: char.offlineVoice ?? existingLocal?.offlineVoice,
      voiceStyle: char.voiceStyle ?? existingLocal?.voiceStyle,
      accentLock: char.accentLock || 'vn_north',
      syncProfile: char.syncProfile ?? existingLocal?.syncProfile,
      createdAt: existingLocal?.createdAt || now,
      updatedAt: now,
    };

    if (!opts?.silent) {
      setSavingLibraryCharId(char.id);
    }

    // 1) Immediately persist to browser IndexedDB so characters survive app/server restarts
    try {
      await upsertLocalCharacter(localRecord);
    } catch {
      // fallback to memory state
    }
    setCharacterLibrary((prev) => [
      localRecord,
      ...prev.filter((item) => item.id !== localRecord.id),
    ]);
    if (!char.libraryId || char.libraryId !== stableLibId) {
      setCharacters((prev) =>
        prev.map((c) => (c.id === char.id ? { ...c, libraryId: stableLibId } : c))
      );
    }

    // 2) Sync to server disk as secondary persistent backup
    try {
      const res = await fetch('/api/studio/character-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: stableLibId,
          name: localRecord.name,
          dataUrl: localRecord.dataUrl,
          description: localRecord.description ?? '',
          source: localRecord.source,
          ageGroup: localRecord.ageGroup,
          gender: localRecord.gender,
          voiceMode: localRecord.voiceMode,
          voiceId: localRecord.voiceId,
          offlineVoice: localRecord.offlineVoice,
          voiceStyle: localRecord.voiceStyle,
          accentLock: localRecord.accentLock || 'vn_north',
          syncProfile: localRecord.syncProfile,
          createdAt: localRecord.createdAt,
        }),
      });
      const data = await parseJsonSafe<{
        character?: StudioSavedCharacter;
        characters?: StudioSavedCharacter[];
        error?: string;
      }>(res);
      if (res.ok && data.character) {
        const syncedItem = data.character;
        const currentLocal = await loadLocalCharacterLibrary().catch(() => []);
        const { merged } = mergeCharacterLibraries(
          Array.isArray(data.characters) ? data.characters : [syncedItem],
          [syncedItem, ...currentLocal]
        );
        setCharacterLibrary(merged);
        void replaceLocalCharacterLibrary(merged).catch(() => {});
        if (!opts?.silent) {
          setCharLibraryStatus(`Đã lưu vĩnh viễn "${syncedItem.name}" vào Thư viện nhân vật.`);
        }
        return syncedItem;
      }
      if (!opts?.silent) {
        setCharLibraryStatus(`Đã lưu "${localRecord.name}" vào Thư viện trình duyệt (dùng lại sau khi tắt mở lại).`);
      }
      return localRecord;
    } catch {
      if (!opts?.silent) {
        setCharLibraryStatus(`Đã lưu "${localRecord.name}" vào Thư viện trình duyệt (dùng lại sau khi tắt mở lại).`);
      }
      return localRecord;
    } finally {
      if (!opts?.silent) {
        setSavingLibraryCharId((prev) => (prev === char.id ? '' : prev));
      }
    }
  };

  const scheduleLibraryAutoSync = (updatedChar: StudioCharacterRef) => {
    const libId = updatedChar.libraryId;
    if (!libId) return;
    const existingTimer = charLibrarySyncTimersRef.current[libId];
    if (existingTimer) clearTimeout(existingTimer);
    charLibrarySyncTimersRef.current[libId] = setTimeout(() => {
      delete charLibrarySyncTimersRef.current[libId];
      void persistCharacterToLibrary(updatedChar, { silent: true, explicitId: libId });
    }, 650);
  };

  const handleTriggerReplaceCharacterImage = (scope: 'active' | 'library', id: string) => {
    setReplaceImageTarget({ scope, id });
    charReplaceInputRef.current?.click();
  };

  const handleReplaceCharacterImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replaceImageTarget;
    setReplaceImageTarget(null);
    if (!file || !target) return;
    setCharError('');
    setCharLibraryStatus('');
    try {
      const nextDataUrl = await compressImageFileToDataUrl(file, 960);
      if (target.scope === 'active') {
        const current = characters.find((c) => c.id === target.id);
        if (!current) return;
        const updatedChar: StudioCharacterRef = { ...current, dataUrl: nextDataUrl };
        setCharacters((prev) => prev.map((c) => (c.id === target.id ? updatedChar : c)));
        if (updatedChar.libraryId) {
          await persistCharacterToLibrary(updatedChar, { explicitId: updatedChar.libraryId });
        } else {
          setCharLibraryStatus(`Đã thay ảnh nhân vật "${updatedChar.name}".`);
        }
      } else {
        const saved = characterLibrary.find((c) => c.id === target.id);
        if (!saved) return;
        const updatedSaved = await persistCharacterToLibrary(
          { ...saved, libraryId: saved.id, dataUrl: nextDataUrl },
          { explicitId: saved.id }
        );
        if (updatedSaved) {
          setCharacters((prev) =>
            prev.map((c) =>
              c.libraryId === saved.id || c.id === `char_${saved.id}`
                ? { ...c, dataUrl: updatedSaved.dataUrl }
                : c
            )
          );
          setCharLibraryStatus(`Đã thay ảnh nhân vật "${updatedSaved.name}" trong Thư viện.`);
        }
      }
    } catch (err: any) {
      setCharError(err?.message || 'Không thể thay ảnh nhân vật.');
    }
  };

  const handleToggleLibraryCharacter = (saved: StudioSavedCharacter) => {
    setCharError('');
    setCharLibraryStatus('');
    const alreadyIdx = characters.findIndex(
      (c) => c.libraryId === saved.id || c.id === saved.id || c.id === `char_${saved.id}`
    );
    if (alreadyIdx >= 0) {
      const removedId = characters[alreadyIdx].id;
      setCharacters((prev) => {
        const next = prev.filter((c) => c.id !== removedId);
        if (selectedCharacterId === removedId) {
          setSelectedCharacterId(next[0]?.id || '');
        }
        return next;
      });
      return;
    }
    if (characters.length >= 8) {
      setCharError('Đã đạt tối đa 8 nhân vật đồng bộ trong phiên này. Hãy bỏ bớt nhân vật đang chọn trước.');
      return;
    }
    const activeId = `char_${saved.id}`;
    const importedChar: StudioCharacterRef = {
      id: activeId,
      libraryId: saved.id,
      name: saved.name,
      dataUrl: saved.dataUrl,
      description: saved.description,
      source: saved.source || 'uploaded',
      ageGroup: saved.ageGroup,
      gender: saved.gender,
      voiceMode: saved.voiceMode,
      voiceId: saved.voiceId,
      offlineVoice: saved.offlineVoice,
      voiceStyle: saved.voiceStyle,
      accentLock: saved.accentLock || 'vn_north',
      syncProfile: saved.syncProfile ? { ...saved.syncProfile } : undefined,
    };
    setCharacters((prev) => [...prev, importedChar]);
    setSelectedCharacterId(activeId);
    setCharLibraryStatus(`Đã nạp nhân vật "${saved.name}" từ Thư viện.`);
  };

  const handleDeleteLibraryCharacter = async (libId: string) => {
    setCharError('');
    setCharLibraryStatus('');
    try {
      await deleteLocalCharacter(libId).catch(() => {});
      setCharacterLibrary((prev) => prev.filter((c) => c.id !== libId));
      setCharacters((prev) =>
        prev.map((c) => (c.libraryId === libId ? { ...c, libraryId: undefined } : c))
      );
      if (confirmDeleteLibCharId === libId) setConfirmDeleteLibCharId('');
      if (editingLibCharId === libId) setEditingLibCharId('');
      await fetch(`/api/studio/character-library/${encodeURIComponent(libId)}`, {
        method: 'DELETE',
      }).catch(() => {});
      setCharLibraryStatus('Đã xóa nhân vật khỏi Thư viện app.');
    } catch (err: any) {
      setCharError(err?.message || 'Không thể xóa nhân vật khỏi thư viện.');
    }
  };

  const handleStartEditLibraryCharacter = (saved: StudioSavedCharacter) => {
    setEditingLibCharId(saved.id);
    setEditingLibName(saved.name || '');
    setEditingLibDesc(saved.description || '');
    setConfirmDeleteLibCharId('');
  };

  const handleSaveLibraryCharacterEdit = async (saved: StudioSavedCharacter) => {
    const nextName = editingLibName.trim() || saved.name;
    const nextDesc = editingLibDesc.trim();
    const updated = await persistCharacterToLibrary(
      {
        ...saved,
        libraryId: saved.id,
        name: nextName,
        description: nextDesc || undefined,
      },
      { explicitId: saved.id }
    );
    if (updated) {
      setCharacters((prev) =>
        prev.map((c) =>
          c.libraryId === saved.id || c.id === `char_${saved.id}`
            ? { ...c, name: updated.name, description: updated.description }
            : c
        )
      );
      setEditingLibCharId('');
      setCharLibraryStatus(`Đã cập nhật thông tin nhân vật "${updated.name}" trong Thư viện.`);
    }
  };

  const updateCharacterRef = (charId: string, patch: Partial<StudioCharacterRef>) => {
    setCharacters((prev) =>
      prev.map((c) => {
        if (c.id !== charId) return c;
        const updated = { ...c, ...patch };
        scheduleLibraryAutoSync(updated);
        return updated;
      })
    );
  };

  const updateSelectedCharacterSyncProfile = (
    charId: string,
    field: keyof CharacterFivePartProfile,
    value: string
  ) => {
    setCharacters((prev) =>
      prev.map((c) => {
        if (c.id !== charId) return c;
        const currentProfile: CharacterFivePartProfile = c.syncProfile || {
          face: '',
          physique: '',
          costume: '',
          voice: '',
          distinguishingMarks: '',
        };
        const updated: StudioCharacterRef = {
          ...c,
          syncProfile: {
            ...currentProfile,
            [field]: value,
          },
        };
        scheduleLibraryAutoSync(updated);
        return updated;
      })
    );
  };

  const synthesizeSyncedCharacters = (
    charList: StudioCharacterRef[],
    fallbackCostume: string
  ): { syncedChars: StudioCharacterRef[]; changed: boolean } => {
    let changed = false;
    const syncedChars = charList.map((c) => {
      const sp = c.syncProfile || {
        face: '',
        physique: '',
        costume: '',
        voice: '',
        distinguishingMarks: '',
      };
      const ageMeta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === (c.ageGroup || 'auto'));
      const nextFace = sp.face?.trim() || c.description?.trim() || '';
      const nextPhysique =
        sp.physique?.trim() ||
        (ageMeta && ageMeta.value !== 'auto' ? `Tỷ lệ cơ thể nhóm tuổi ${ageMeta.label}` : '');
      const nextCostume = sp.costume?.trim() || fallbackCostume.trim() || '';
      const nextVoice =
        sp.voice?.trim() ||
        [
          ageMeta && ageMeta.value !== 'auto' ? ageMeta.label : 'Giọng Bắc VN chuẩn',
          c.voiceId ? `(${c.voiceId})` : '',
        ]
          .filter(Boolean)
          .join(' ');
      const nextMarks = sp.distinguishingMarks?.trim() || '';
      if (
        !c.syncProfile ||
        nextFace !== (sp.face || '') ||
        nextPhysique !== (sp.physique || '') ||
        nextCostume !== (sp.costume || '') ||
        nextVoice !== (sp.voice || '')
      ) {
        changed = true;
      }
      return {
        ...c,
        syncProfile: {
          face: nextFace,
          physique: nextPhysique,
          costume: nextCostume,
          voice: nextVoice,
          distinguishingMarks: nextMarks,
        },
      };
    });
    return { syncedChars, changed };
  };

  const handleAnalyzeAllCharacters = async () => {
    if (characters.length === 0 || isAnalyzingCharacters) return;
    setIsAnalyzingCharacters(true);
    setCharAnalyzeError('');
    setCharError('');
    setShowDraftBible(true);
    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        profiles?: {
          id: string;
          name: string;
          syncProfile: CharacterFivePartProfile;
          suggestedDescription?: string;
          suggestedAgeGroup?: Exclude<CharacterAgeGroup, 'auto'>;
          suggestedGender?: 'male' | 'female';
        }[];
        error?: string;
      }>('/api/studio/analyze-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characters: characters.map((c) => ({
            id: c.id,
            name: c.name,
            dataUrl: c.dataUrl,
            description: c.description,
            ageGroup: c.ageGroup,
            gender: c.gender,
            syncProfile: c.syncProfile,
          })),
          videoStyle: blueprint?.videoStyle || videoStyle,
          customStylePrompt: customStylePrompt.trim(),
          ideaContext: (expandedIdeaPrompt || ideaPrompt || blueprint?.derivativeTitle || '').trim(),
          aiProvider,
        }),
      });
      if (!res.ok || !Array.isArray(data.profiles)) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const profileById = new Map(data.profiles.map((p) => [p.id, p]));
      const updatedForLibrary: StudioCharacterRef[] = [];
      setCharacters((prev) =>
        prev.map((c) => {
          const found = profileById.get(c.id);
          if (!found) return c;
          const ageMeta = found.suggestedAgeGroup
            ? CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === found.suggestedAgeGroup)
            : undefined;
          const nextChar: StudioCharacterRef = {
            ...c,
            syncProfile: found.syncProfile,
            description: c.description?.trim() ? c.description : found.suggestedDescription,
            ageGroup:
              !c.ageGroup || c.ageGroup === 'auto'
                ? found.suggestedAgeGroup || c.ageGroup
                : c.ageGroup,
            gender:
              !c.gender || c.gender === 'auto'
                ? found.suggestedGender || c.gender
                : c.gender,
            ...(ageMeta && (!c.voiceMode || c.voiceMode === 'default') && !c.voiceId
              ? { voiceId: ageMeta.defaultVoiceId, voiceStyle: ageMeta.pitchDirective }
              : {}),
          };
          if (nextChar.libraryId) {
            updatedForLibrary.push(nextChar);
          }
          return nextChar;
        })
      );
      for (const chToSync of updatedForLibrary) {
        void persistCharacterToLibrary(chToSync, { silent: true, explicitId: chToSync.libraryId });
      }
      if (!selectedCharacterId && characters[0]) {
        setSelectedCharacterId(characters[0].id);
      }
    } catch (err: any) {
      setCharAnalyzeError(err?.message || 'AI chưa phân tích được đầy đủ hồ sơ 5 thành phần nhân vật.');
    } finally {
      setIsAnalyzingCharacters(false);
    }
  };

  const handleUploadCharacters = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setCharError('');
    setCharLibraryStatus('');
    try {
      const voiceCfg = buildNewCharacterVoiceConfig();
      const baseName = charNameInput.trim();
      const baseDesc = charPromptInput.trim() || undefined;
      const availableSlots = Math.max(0, 8 - characters.length);
      const selectedFiles = files.slice(0, Math.min(8, Math.max(1, availableSlots || files.length)));
      const createdChars: StudioCharacterRef[] = [];

      for (let i = 0; i < selectedFiles.length; i += 1) {
        const file = selectedFiles[i];
        const dataUrl = await compressImageFileToDataUrl(file, 960);
        const newId = `char_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        const fallbackName = file.name.replace(/\.[^.]+$/, '');
        const finalName = baseName
          ? selectedFiles.length > 1
            ? `${baseName} ${i + 1}`
            : baseName
          : fallbackName;
        createdChars.push({
          id: newId,
          name: finalName,
          dataUrl,
          description: baseDesc,
          source: 'uploaded',
          ...voiceCfg,
        });
      }

      if (createdChars.length > 0) {
        setCharacters((prev) => [...prev, ...createdChars].slice(0, 8));
        setSelectedCharacterId(createdChars[createdChars.length - 1].id);
        setCharNameInput('');
        setCharPromptInput('');

        // Automatically persist every uploaded character into the app's Character Library
        let savedCount = 0;
        for (const newChar of createdChars) {
          const saved = await persistCharacterToLibrary(newChar, { silent: true });
          if (saved) savedCount += 1;
        }
        if (savedCount > 0) {
          setCharLibraryStatus(
            savedCount === 1
              ? `Đã tự động lưu "${createdChars[0].name}" vào Thư viện nhân vật để tái sử dụng các phiên sau.`
              : `Đã tự động lưu ${savedCount} nhân vật vào Thư viện app để tái sử dụng các phiên sau.`
          );
        }
      }
    } catch (err: any) {
      setCharError(err?.message || 'Không thể đọc ảnh nhân vật.');
    }
  };

  const handleGenerateCharacterAi = async (overrideDesc?: string, overrideName?: string) => {
    const desc = (overrideDesc ?? charPromptInput).trim();
    if (!desc) {
      setCharError('Hãy nhập mô tả ngoại hình nhân vật để AI vẽ mẫu.');
      return;
    }
    setIsGeneratingChar(true);
    setCharError('');
    setCharLibraryStatus('');
    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{ dataUrl?: string; error?: string }>(
        '/api/studio/generate-image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'character',
            prompt: desc,
            aspectRatio: '1:1',
            quality: imageEngineMode === 'gemini_pro' ? 'pro' : 'standard',
            engine: imageEngineMode === 'muse2api' ? 'muse2api' : imageEngineMode === 'qwen' ? 'qwen' : 'gemini',
            videoStyle: blueprint?.videoStyle || videoStyle,
            customStylePrompt: customStylePrompt.trim(),
            characterBible: blueprint?.characterBible || characterBibleDraft || desc,
            settingBible: blueprint?.settingBible || settingBibleDraft,
            visualStyleBible: blueprint?.visualStyleBible || visualStyleBibleDraft,
            costumeBible: blueprint?.costumeBible || costumeBibleDraft,
            continuityBible: blueprint?.continuityBible || continuityBibleDraft,
            allowFreeCostumeChange: blueprint?.allowFreeCostumeChange ?? allowFreeCostumeChange,
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      const generatedUrl = data.dataUrl;
      const voiceCfg = buildNewCharacterVoiceConfig();
      const newCharId = `char_ai_${Date.now()}`;
      const newChar: StudioCharacterRef = {
        id: newCharId,
        name: (overrideName ?? charNameInput).trim() || `Nhân vật ${characters.length + 1}`,
        description: desc,
        dataUrl: generatedUrl,
        source: 'ai_generated',
        ...voiceCfg,
      };
      setCharacters((prev) => [...prev.slice(0, 7), newChar]);
      setSelectedCharacterId(newCharId);
      if (!overrideName) setCharNameInput('');
      const saved = await persistCharacterToLibrary(newChar, { silent: true });
      if (saved) {
        setCharLibraryStatus(`Đã tự động lưu "${saved.name}" vào Thư viện nhân vật.`);
      }
    } catch (err: any) {
      setCharError(err?.message || 'Không thể tạo ảnh nhân vật AI.');
    } finally {
      setIsGeneratingChar(false);
    }
  };

  const handleWatchReferenceVideosToIdeaPrompt = async () => {
    if (sources.length === 0) {
      setWatchVideoError('Vui lòng tải lên hoặc chọn ít nhất 1 video tham chiếu trước khi cho AI xem video.');
      return;
    }

    setIsWatchingReferenceVideo(true);
    setWatchVideoError('');
    setWatchVideoSuccess('');
    setExpandIdeaError('');
    setLearnError('');

    const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
    if (changed) {
      setCharacters(syncedChars);
    }
    const charSummary = syncedChars
      .map((c) => {
        const sp = c.syncProfile;
        const profileBits = [
          sp?.face ? `Mặt: ${sp.face}` : '',
          sp?.physique ? `Dáng: ${sp.physique}` : '',
          sp?.costume ? `Trang phục: ${sp.costume}` : '',
          sp?.distinguishingMarks ? `Nhận dạng: ${sp.distinguishingMarks}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return [c.name, profileBits || c.description].filter(Boolean).join(' - ');
      })
      .filter(Boolean)
      .join('; ');

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        detailedPrompt?: string;
        suggestedSetting?: string;
        sceneHighlights?: string[];
        watchedVideoCount?: number;
        usedProvider?: string;
        usedModel?: string;
        error?: string;
      }>('/api/studio/analyze-video-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: sources,
          outputLanguage,
          videoStyle,
          customStylePrompt: customStylePrompt.trim(),
          characterSummary: charSummary,
          allowFreeCostumeChange,
          aiProvider,
          useProModel: aiProvider === 'gemini' && useProModel,
        }),
      });

      const promptText = String(data.detailedPrompt || '').trim();
      if (!res.ok || !promptText) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setIdeaPrompt(promptText);
      if (data.suggestedSetting?.trim()) {
        setSettingBibleDraft(data.suggestedSetting.trim());
      }
      setWatchedSceneHighlights(Array.isArray(data.sceneHighlights) ? data.sceneHighlights : []);
      setExpandedIdeas([]);
      setExpandedIdeaPrompt('');
      setEditingIdeaId(null);
      setWatchVideoSuccess(
        `AI đã xem ${data.watchedVideoCount || sources.length} video tham chiếu và viết prompt mô tả chi tiết đưa vào "Tóm tắt ý tưởng ban đầu". Bạn có thể chỉnh sửa hoặc bấm "Dùng AI triển khai ý tưởng" ngay bên dưới.`
      );
    } catch (err: any) {
      setWatchVideoError(err?.message || 'AI chưa thể xem và phân tích video tham chiếu lúc này.');
    } finally {
      setIsWatchingReferenceVideo(false);
    }
  };

  const handleExpandIdeaWithAi = async () => {
    const seed = ideaPrompt.trim();
    if (!seed) {
      setExpandIdeaError('Vui lòng nhập tóm tắt ý tưởng ban đầu trước khi bấm triển khai.');
      return;
    }

    setIsExpandingIdea(true);
    setExpandIdeaError('');
    setLearnError('');

    const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
    if (changed) {
      setCharacters(syncedChars);
    }
    const charSummary = syncedChars
      .map((c) => {
        const sp = c.syncProfile;
        const profileBits = [
          sp?.face ? `Mặt: ${sp.face}` : '',
          sp?.physique ? `Dáng: ${sp.physique}` : '',
          sp?.costume ? `Trang phục: ${sp.costume}` : '',
          sp?.distinguishingMarks ? `Nhận dạng: ${sp.distinguishingMarks}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return [c.name, profileBits || c.description].filter(Boolean).join(' - ');
      })
      .filter(Boolean)
      .join('; ');

    const clampedCount = Math.max(1, Math.min(15, Math.round(Number(ideaCount || 3))));
    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        ideas?: ExpandedCreativeIdeaItem[];
        expandedIdea?: string;
        suggestedSetting?: string;
        error?: string;
      }>('/api/studio/expand-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedIdea: seed,
          settingHint: settingBibleDraft.trim(),
          videoStyle,
          customStylePrompt: customStylePrompt.trim(),
          scriptMode,
          ideaCount: clampedCount,
          targetDurationSec,
          outputLanguage,
          characterSummary: charSummary,
          characterRefsMeta: syncedChars.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            ageGroup: c.ageGroup,
            gender: c.gender,
            voiceId: c.voiceId,
            syncProfile: c.syncProfile,
          })),
          allowFreeCostumeChange,
          aiProvider,
          useProModel: aiProvider === 'gemini' && useProModel,
        }),
      });

      const returnedIdeas: ExpandedCreativeIdeaItem[] =
        Array.isArray(data.ideas) && data.ideas.length > 0
          ? data.ideas
          : data.expandedIdea
          ? [
              {
                id: `idea_${Date.now()}_1`,
                index: 1,
                title: seed.slice(0, 64),
                summary: data.expandedIdea.trim().slice(0, 220),
                detail: data.expandedIdea.trim(),
                suggestedSetting: data.suggestedSetting,
              },
            ]
          : [];

      if (!res.ok || returnedIdeas.length === 0) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setExpandedIdeas(returnedIdeas);
      setEditingIdeaId(null);
      const firstIdea = returnedIdeas[0];
      setExpandedIdeaPrompt(
        [
          firstIdea.title,
          firstIdea.summary,
          firstIdea.detail && firstIdea.detail !== firstIdea.summary ? firstIdea.detail : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      );
      if (!settingBibleDraft.trim() && (firstIdea.suggestedSetting || data.suggestedSetting)?.trim()) {
        setSettingBibleDraft((firstIdea.suggestedSetting || data.suggestedSetting || '').trim());
      }
    } catch (err: any) {
      setExpandIdeaError(err?.message || 'AI không thể triển khai ý tưởng lúc này.');
    } finally {
      setIsExpandingIdea(false);
    }
  };

  // AI Learn & Create Script (supports Direct Per-Idea Script Prompt with 100% Idea Preservation & Direct Batch Compile without re-planning ideas)
  const handleLearnAndCreateScript = async (override?: {
    selectedIdea?: ExpandedCreativeIdeaItem;
    batchIdeas?: ExpandedCreativeIdeaItem[];
    preserveExactIdea?: boolean;
  }) => {
    const selectedIdea = override?.selectedIdea;
    const batchIdeas = Array.isArray(override?.batchIdeas) && override.batchIdeas.length > 0 ? override.batchIdeas : undefined;
    const directFromSelectedIdea = Boolean(selectedIdea);
    const preserveExactIdea = Boolean(override?.preserveExactIdea || selectedIdea || batchIdeas);
    const formattedSelectedIdea = selectedIdea
      ? [
          `Tiêu đề ý tưởng: ${selectedIdea.title}`,
          selectedIdea.summary,
          selectedIdea.detail && selectedIdea.detail !== selectedIdea.summary ? selectedIdea.detail : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';
    const effectiveCreativeIdea = formattedSelectedIdea || expandedIdeaPrompt.trim() || ideaPrompt.trim();
    const effectiveSettingBible = (selectedIdea?.suggestedSetting || settingBibleDraft).trim();

    if (studioMode === 'creative') {
      if (!effectiveCreativeIdea && !customInstruction.trim() && !batchIdeas) {
        setLearnError('Vui lòng nhập tóm tắt ý tưởng (hoặc dùng AI triển khai ý tưởng) ở Bước 1 để lên kịch bản.');
        return;
      }
    } else if (sources.length === 0) {
      setLearnError('Vui lòng tải lên hoặc thêm ít nhất 1 video tham chiếu ở Bước 1.');
      return;
    }

    if (selectedIdea) {
      setExpandedIdeaPrompt(formattedSelectedIdea);
      if (selectedIdea.suggestedSetting?.trim()) {
        setSettingBibleDraft(selectedIdea.suggestedSetting.trim());
      }
      setGeneratingIdeaId(selectedIdea.id);
    } else if (batchIdeas) {
      setGeneratingIdeaId('__ALL_BATCH__');
    } else {
      setGeneratingIdeaId(null);
    }

    setIsLearning(true);
    setLearnError('');
    setLearnSuccess('');
    setSceneMediaError('');
    setSceneImageErrors({});
    stopPolling();
    setJobsByKey((prev) => {
      const copy = { ...prev };
      Object.keys(copy).forEach((k) => {
        if (k.startsWith(`${studioMode}:`)) delete copy[k];
      });
      return copy;
    });

    const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
    if (changed) {
      setCharacters(syncedChars);
    }

    const charSummary = syncedChars
      .map((c) => {
        const ageMeta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === (c.ageGroup || 'auto'));
        const ageLabel = ageMeta && ageMeta.value !== 'auto' ? `Nhóm tuổi: ${ageMeta.label}` : 'Tuổi: AI tự phân tích';
        const voiceNote =
          c.voiceMode === 'offline_system'
            ? `Giọng VieNeu miền Bắc VN: ${c.offlineVoice || 'Mặc định'}`
            : c.voiceMode === 'ai_online'
            ? `Giọng Gemini miền Bắc VN (Hà Nội): ${c.voiceId || voice}`
            : `AI tự phân tích tuổi chọn giọng Bắc VN (${ageMeta?.defaultVoiceId || 'phù hợp'})`;
        const syncNote = c.syncProfile
          ? [
              c.syncProfile.face ? `Mặt: ${c.syncProfile.face}` : '',
              c.syncProfile.physique ? `Dáng: ${c.syncProfile.physique}` : '',
              c.syncProfile.costume ? `Trang phục: ${c.syncProfile.costume}` : '',
              c.syncProfile.voice ? `Chất giọng: ${c.syncProfile.voice}` : '',
              c.syncProfile.distinguishingMarks ? `Nhận dạng: ${c.syncProfile.distinguishingMarks}` : '',
            ]
              .filter(Boolean)
              .join(', ')
          : '';
        return [c.name, ageLabel, syncNote || c.description, voiceNote].filter(Boolean).join(' - ');
      })
      .join('; ');

    const effectiveStylePreset: DerivativeStylePreset = enableNarrativeStyle
      ? stylePreset === 'none'
        ? 'storytelling_review'
        : stylePreset
      : 'none';

    const seriesTotalDurationSec = unifiedUnitCount * targetDurationSec;
    const isRunningIndependentBatch =
      !directFromSelectedIdea && (Boolean(batchIdeas) || scriptMode === 'independent_batch');

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        blueprint?: DerivativeBlueprint;
        blueprints?: DerivativeBlueprint[];
        sharedSpiritNote?: string;
        error?: string;
      }>('/api/derivative/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: studioMode,
          scriptMode,
          productionFormat,
          ideaCount: unifiedUnitCount,
          videoCount: batchIdeas ? batchIdeas.length : isRunningIndependentBatch ? unifiedUnitCount : 1,
          ideaPrompt: selectedIdea || studioMode === 'creative' ? effectiveCreativeIdea : ideaPrompt.trim(),
          query: selectedIdea || studioMode === 'creative' ? effectiveCreativeIdea : searchQueryInput.trim() || incomingQuery,
          videos: studioMode === 'derivative' ? sources : [],
          stylePreset: effectiveStylePreset,
          videoStyle,
          customStylePrompt: customStylePrompt.trim(),
          aspectRatio,
          targetDurationSec: scriptMode === 'series' ? seriesTotalDurationSec : targetDurationSec,
          sceneDurationSec: scriptMode === 'series' ? targetDurationSec : undefined,
          desiredSceneCount:
            scriptMode === 'series'
              ? unifiedUnitCount
              : desiredSceneCount === 'auto'
              ? undefined
              : desiredSceneCount,
          outputLanguage,
          useProModel: aiProvider === 'gemini' && useProModel,
          characterSummary: charSummary,
          characterRefsMeta: syncedChars.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            ageGroup: c.ageGroup,
            gender: c.gender,
            voiceId: c.voiceId,
            syncProfile: c.syncProfile,
          })),
          characterBible: characterBibleDraft.trim(),
          settingBible: effectiveSettingBible,
          visualStyleBible: visualStyleBibleDraft.trim(),
          costumeBible: costumeBibleDraft.trim(),
          continuityBible: continuityBibleDraft.trim(),
          allowFreeCostumeChange,
          preserveExactIdea,
          directFromSelectedIdea,
          selectedIdeaTitle: selectedIdea?.title || '',
          ...(batchIdeas
            ? {
                prePlannedIdeas: batchIdeas.map((it) => ({
                  title: it.title,
                  summary: it.summary,
                  detail: it.detail,
                  suggestedSetting: it.suggestedSetting,
                })),
              }
            : {}),
          customInstruction: customInstruction.trim(),
          enableVoiceover: voiceMode !== 'none',
          aiProvider,
        }),
      }, undefined, 0);

      const returnedList =
        Array.isArray(data.blueprints) && data.blueprints.length > 0
          ? data.blueprints
          : data.blueprint
          ? [data.blueprint]
          : [];

      if (!res.ok || returnedList.length === 0) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const normalizedReturnedList = returnedList.map((bpItem) => ({
        ...bpItem,
        allowFreeCostumeChange: bpItem.allowFreeCostumeChange ?? allowFreeCostumeChange,
      }));

      setBatchBlueprintsByMode((prev) => ({ ...prev, [studioMode]: normalizedReturnedList }));
      setActiveBatchIdxByMode((prev) => ({ ...prev, [studioMode]: 0 }));
      setSharedSpiritByMode((prev) => ({
        ...prev,
        [studioMode]: data.sharedSpiritNote || normalizedReturnedList[0]?.sharedSpiritNote || '',
      }));

      const first = normalizedReturnedList[0];
      if (first?.characterBible) {
        setCharacterBibleDraft((prev) => (!allowFreeCostumeChange && prev.trim() ? prev : first.characterBible || prev));
      }
      if (first?.settingBible) setSettingBibleDraft(first.settingBible);
      if (first?.visualStyleBible) setVisualStyleBibleDraft(first.visualStyleBible);
      if (first?.costumeBible) {
        setCostumeBibleDraft((prev) => (!allowFreeCostumeChange && prev.trim() ? prev : first.costumeBible || prev));
      }
      if (first?.continuityBible) setContinuityBibleDraft(first.continuityBible);

      // Sync full character reference images & blueprint into Phòng Điều Hành AI Muse
      void fetch('/api/command-center/studio-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAction: 'learn_script',
          mode: studioMode,
          title: projectNameInput.trim() || first?.derivativeTitle || '',
          ideaOrCommand:
            (studioMode === 'creative' ? effectiveCreativeIdea : ideaPrompt.trim() || customInstruction.trim()) ||
            first?.learnedSummary ||
            '',
          productionFormat,
          aspectRatio,
          videoStyle: first?.videoStyle || videoStyle,
          allowFreeCostumeChange,
          characterRefs: syncedChars.slice(0, 8),
          visualBible: first?.visualStyleBible ?? visualStyleBibleDraft.trim(),
          settingBible: first?.settingBible ?? settingBibleDraft.trim(),
          costumeBible: first?.costumeBible ?? costumeBibleDraft.trim(),
          continuityBible: first?.continuityBible ?? continuityBibleDraft.trim(),
          blueprint: first,
        }),
      }).catch(() => {});

      const styleLabel = resolveVideoStyleMetaClient(
        first?.videoStyle || videoStyle,
        learnedStyles,
        customStylePrompt
      ).label;
      if (directFromSelectedIdea && selectedIdea) {
        setLearnSuccess(
          `Đã tạo ngay prompt kịch bản từ "${selectedIdea.title}" (${first.scenes.length} phân cảnh · ${first.targetDurationSec}s, giữ nguyên 100% ý tưởng đã chọn — ${styleLabel}).`
        );
      } else if (batchIdeas) {
        setLearnSuccess(
          `Đã tạo trực tiếp ${returnedList.length} kịch bản độc lập từ đúng ${batchIdeas.length} ý tưởng đã triển khai (${styleLabel}).`
        );
      } else if (scriptMode === 'independent_batch') {
        setLearnSuccess(
          `Đã tạo lô ${returnedList.length} kịch bản video độc lập phái sinh cùng mô-típ từ ý tưởng gốc (${styleLabel}).`
        );
      } else {
        setLearnSuccess(
          `Đã khởi tạo kịch bản Series ${first.scenes.length} phân cảnh nối tiếp liên hoàn (${styleLabel}).`
        );
      }
      setActiveStudioStep(2);
      setReviewMetaTab('summary');
    } catch (err: any) {
      setLearnError(err?.message || 'AI không thể phân tích hoặc tạo kịch bản.');
    } finally {
      setIsLearning(false);
      setGeneratingIdeaId(null);
    }
  };

  const getBlueprintSelectionKey = (bp: DerivativeBlueprint | null, idx = activeBatchIndex): string => {
    if (!bp) return 'none';
    return `${idx}::${bp.derivativeTitle || 'untitled'}::${bp.scenes.length}`;
  };

  const getSelectedCoordSceneIds = (bp: DerivativeBlueprint | null, idx = activeBatchIndex): string[] => {
    if (!bp) return [];
    const key = getBlueprintSelectionKey(bp, idx);
    const saved = selectedCoordSceneIdsByBp[key];
    const validIds = new Set(bp.scenes.map((s) => s.id));
    if (!saved) {
      return bp.scenes.map((s) => s.id);
    }
    return saved.filter((id) => validIds.has(id));
  };

  const toggleCoordSceneSelection = (sceneId: string) => {
    if (!blueprint) return;
    const key = getBlueprintSelectionKey(blueprint, activeBatchIndex);
    const current = getSelectedCoordSceneIds(blueprint, activeBatchIndex);
    const exists = current.includes(sceneId);
    const next = exists ? current.filter((id) => id !== sceneId) : [...current, sceneId];
    setSelectedCoordSceneIdsByBp((prev) => ({ ...prev, [key]: next }));
  };

  const selectAllCoordScenes = (selectAll: boolean) => {
    if (!blueprint) return;
    const key = getBlueprintSelectionKey(blueprint, activeBatchIndex);
    setSelectedCoordSceneIdsByBp((prev) => ({
      ...prev,
      [key]: selectAll ? blueprint.scenes.map((s) => s.id) : [],
    }));
  };

  // Send Studio idea / script / blueprint (selected scenes, full script, or all batch scripts) directly to Trung Tâm Điều Phối AI
  const handleDispatchToCommandCenter = async (opts?: {
    onlySelectedScenes?: boolean;
    dispatchAllBatch?: boolean;
  }) => {
    const activeIdea = [expandedIdeaPrompt.trim(), ideaPrompt.trim(), customInstruction.trim()]
      .filter(Boolean)
      .join('\n\n');
    const sourceTitles =
      studioMode === 'derivative' && sources.length > 0
        ? `Video tham chiếu (${sources.length}): ${sources.map((s) => s.title || s.sourceUrl).join('; ')}`
        : '';

    if (opts?.dispatchAllBatch && blueprints.length > 0) {
      setIsDispatchingToCommandCenter(true);
      setCommandCenterError('');
      setLearnError('');
      try {
        const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
        if (changed) setCharacters(syncedChars);

        const resolvedVideoSource =
          visualMode === 'qwen_video'
            ? 'qwen'
            : visualMode === 'muse2api_video'
              ? 'muse'
              : 'gemini';
        const googleToken = getGoogleWorkspaceAccessToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (googleToken) headers.Authorization = `Bearer ${googleToken}`;

        const createdIds: string[] = [];
        for (let i = 0; i < blueprints.length; i += 1) {
          const bp = blueprints[i];
          const resolvedTitle = bp.derivativeTitle?.trim() || `${projectNameInput.trim() || 'Kịch bản'} #${i + 1}`;
          const fullDirective = [
            activeIdea,
            sourceTitles,
            bp.learnedSummary ? `Tóm tắt kịch bản:\n${bp.learnedSummary}` : '',
          ]
            .filter(Boolean)
            .join('\n\n')
            .trim();

          const res = await fetch('/api/command-center/studio-sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              sourceAction: 'manual_dispatch',
              createCoordinationSession: true,
              videoSource: resolvedVideoSource,
              mode: studioMode,
              title: resolvedTitle,
              ideaOrCommand: fullDirective || resolvedTitle,
              productionFormat: bp.productionFormat || productionFormat,
              aspectRatio,
              videoStyle: bp.videoStyle || videoStyle,
              allowFreeCostumeChange: bp.allowFreeCostumeChange ?? allowFreeCostumeChange,
              blueprint: bp,
              characterRefs: syncedChars.slice(0, 8),
              visualBible: bp.visualStyleBible ?? visualStyleBibleDraft.trim(),
              settingBible: bp.settingBible ?? settingBibleDraft.trim(),
              costumeBible: bp.costumeBible ?? costumeBibleDraft.trim(),
              continuityBible: bp.continuityBible ?? continuityBibleDraft.trim(),
              voiceConfig: {
                enableVoiceover: voiceMode !== 'none',
                voiceMode,
                voice: voiceMode === 'ai_online' ? voice : 'Kore',
                voiceStyle: VOICE_OPTIONS.find((v) => v.value === voice)?.style || '',
                offlineVoice: voiceMode === 'offline_system' ? offlineVoice : undefined,
                productionFormat: bp.productionFormat || productionFormat,
              },
              musicConfig: {
                musicMode,
                musicStyle,
                musicPrompt: musicPrompt.trim(),
                musicVolume: Math.max(0, Math.min(0.9, musicVolume / 100)),
                musicAssetId: musicMode === 'uploaded' ? uploadedAudioTrack?.assetId : undefined,
                publicMusicUrl: musicMode === 'public_free' ? selectedPublicTrack?.url : undefined,
                instrumentalOnly: musicInstrumentalOnly,
              },
            }),
          });
          const data = await parseJsonSafe<{ error?: string; coordinationSession?: { sessionId?: string } }>(res);
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (data.coordinationSession?.sessionId) {
            createdIds.push(data.coordinationSession.sessionId);
          }
        }

        setProjectStatusMsg(
          `Đã đẩy toàn bộ ${createdIds.length} kịch bản vào hàng đợi tuần tự Trung Tâm Điều Phối AI (${createdIds.join(', ')}).`
        );
        onOpenCommandCenter?.();
      } catch (err: any) {
        const msg = err?.message || 'Không thể đẩy toàn bộ kịch bản sang Trung Tâm Điều Phối AI.';
        setCommandCenterError(msg);
        setLearnError(msg);
      } finally {
        setIsDispatchingToCommandCenter(false);
      }
      return;
    }

    let effectiveBlueprint: DerivativeBlueprint | null = blueprint;
    let selectedLabelSuffix = '';
    if (opts?.onlySelectedScenes && blueprint) {
      const selectedIds = new Set(getSelectedCoordSceneIds(blueprint, activeBatchIndex));
      const filteredScenes = blueprint.scenes.filter((sc) => selectedIds.has(sc.id));
      if (filteredScenes.length === 0) {
        const msg = 'Bạn chưa chọn phân cảnh nào. Hãy tích chọn ít nhất 1 phân cảnh hoặc bấm "Chọn tất cả" trước khi đẩy sang Trung Tâm Điều Phối AI.';
        setCommandCenterError(msg);
        setLearnError(msg);
        return;
      }
      if (filteredScenes.length < blueprint.scenes.length) {
        selectedLabelSuffix = ` (${filteredScenes.length}/${blueprint.scenes.length} phân cảnh đã chọn)`;
      }
      effectiveBlueprint = {
        ...blueprint,
        scenes: filteredScenes,
      };
    }

    const fullDirective = [
      activeIdea,
      sourceTitles,
      effectiveBlueprint?.learnedSummary ? `Tóm tắt kịch bản:\n${effectiveBlueprint.learnedSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!fullDirective && !effectiveBlueprint?.scenes?.length) {
      setCommandCenterError(
        'Vui lòng nhập ý tưởng, hướng dẫn hoặc tạo kịch bản phân cảnh trước khi đẩy sang Trung Tâm Điều Phối AI.'
      );
      return;
    }

    setIsDispatchingToCommandCenter(true);
    setCommandCenterError('');
    setLearnError('');
    try {
      const baseTitle =
        effectiveBlueprint?.derivativeTitle?.trim() ||
        projectNameInput.trim() ||
        (ideaPrompt.trim() ? ideaPrompt.trim().slice(0, 60) : 'Dự án từ Studio');
      const resolvedTitle = `${baseTitle}${selectedLabelSuffix}`;

      const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
      if (changed) {
        setCharacters(syncedChars);
      }
      const effectiveAllowFree = effectiveBlueprint?.allowFreeCostumeChange ?? allowFreeCostumeChange;

      const resolvedVideoSource =
        visualMode === 'qwen_video'
          ? 'qwen'
          : visualMode === 'muse2api_video'
            ? 'muse'
            : 'gemini';

      const googleToken = getGoogleWorkspaceAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) {
        headers.Authorization = `Bearer ${googleToken}`;
      }

      const res = await fetch('/api/command-center/studio-sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sourceAction: 'manual_dispatch',
          createCoordinationSession: true,
          videoSource: resolvedVideoSource,
          mode: studioMode,
          title: resolvedTitle,
          ideaOrCommand: fullDirective || resolvedTitle,
          productionFormat: effectiveBlueprint?.productionFormat || productionFormat,
          aspectRatio,
          videoStyle: effectiveBlueprint?.videoStyle || videoStyle,
          allowFreeCostumeChange: effectiveAllowFree,
          blueprint: effectiveBlueprint || undefined,
          characterRefs: syncedChars.slice(0, 8),
          visualBible: effectiveBlueprint?.visualStyleBible ?? visualStyleBibleDraft.trim(),
          settingBible: effectiveBlueprint?.settingBible ?? settingBibleDraft.trim(),
          costumeBible: effectiveBlueprint?.costumeBible ?? costumeBibleDraft.trim(),
          continuityBible: effectiveBlueprint?.continuityBible ?? continuityBibleDraft.trim(),
          voiceConfig: {
            enableVoiceover: voiceMode !== 'none',
            voiceMode,
            voice: voiceMode === 'ai_online' ? voice : 'Kore',
            voiceStyle: VOICE_OPTIONS.find((v) => v.value === voice)?.style || '',
            offlineVoice: voiceMode === 'offline_system' ? offlineVoice : undefined,
            productionFormat: effectiveBlueprint?.productionFormat || productionFormat,
          },
          musicConfig: {
            musicMode,
            musicStyle,
            musicPrompt: musicPrompt.trim(),
            musicVolume: Math.max(0, Math.min(0.9, musicVolume / 100)),
            musicAssetId: musicMode === 'uploaded' ? uploadedAudioTrack?.assetId : undefined,
            publicMusicUrl: musicMode === 'public_free' ? selectedPublicTrack?.url : undefined,
            instrumentalOnly: musicInstrumentalOnly,
          },
        }),
      });
      const data = await parseJsonSafe<{ error?: string; coordinationSession?: { sessionId?: string } }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const sid = data.coordinationSession?.sessionId;
      setProjectStatusMsg(
        sid
          ? `Đã tạo phiên điều phối ${sid} (${effectiveBlueprint?.scenes?.length || 0} phân cảnh) kèm dữ liệu tham chiếu tại Trung Tâm Điều Phối AI.`
          : 'Đã đẩy kịch bản & dữ liệu tham chiếu sang Trung Tâm Điều Phối AI.'
      );
      onOpenCommandCenter?.();
    } catch (err: any) {
      const msg = err?.message || 'Không thể đẩy lệnh sang Trung Tâm Điều Phối AI.';
      setCommandCenterError(msg);
      setLearnError(msg);
    } finally {
      setIsDispatchingToCommandCenter(false);
    }
  };

  const updateScene = (sceneId: string, patch: Partial<DerivativeScene>) => {
    setBlueprint((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map((sc) => (sc.id === sceneId ? { ...sc, ...patch } : sc)),
      };
    });
  };

  const handleAddScene = () => {
    setBlueprint((prev) => {
      if (!prev || prev.scenes.length >= 24) return prev;
      const idx = prev.scenes.length;
      const styleMeta = resolveVideoStyleMetaClient(prev.videoStyle || videoStyle, learnedStyles, customStylePrompt);
      const lastScene = prev.scenes[idx - 1];
      const sceneCode = `Scene ${String(idx + 1).padStart(2, '0')}`;
      const baseSceneFields: Partial<DerivativeScene> = {
        sceneIndex: idx + 1,
        sceneTitle: `Tiếp nối diễn biến (${sceneCode})`,
        sceneSummary: 'Nhân vật tiếp tục hành động nối tiếp trạng thái cuối của phân cảnh trước.',
        durationSec: Math.max(4, Math.round(lastScene?.durationSec || 6)),
        sourceVideoIndex: sources.length > 0 ? idx % sources.length : 0,
        sourceStartPercent: (idx * 20) % 75,
        onScreenText: '',
        dialogue: '',
        narration:
          voiceMode === 'none'
            ? ''
            : 'Tiếp nối diễn biến câu chuyện với góc nhìn rõ nét và nhịp dẫn mạch lạc.',
        charactersInScene: lastScene?.charactersInScene || 'Nhân vật chính theo Hồ sơ đồng bộ',
        actionDetail: 'Nhân vật tiếp tục hành động nối tiếp trạng thái cuối của phân cảnh trước',
        settingDetail: lastScene?.settingDetail || prev.settingBible || 'Bối cảnh đồng bộ xuyên suốt',
        cameraAngle: 'Trung cảnh (Medium shot)',
        cameraMovement: 'Đẩy máy chậm vào chủ thể (Slow Dolly-in)',
        cameraEquipment: lastScene?.cameraEquipment || 'Sony FX3 · Ống kính 35mm f/1.4 trên Gimbal DJI Ronin',
        lighting: lastScene?.lighting || 'Ánh sáng cân bằng đồng bộ tông màu',
        costume: lastScene?.costume || prev.costumeBible || 'Trang phục giữ nguyên theo hồ sơ nhân vật',
        shotStyle: styleMeta.shotDefault,
        continuityNote: lastScene?.sceneEndState
          ? `Tiếp nối từ ${lastScene.sceneEndState}`
          : `Tiếp nối mạch từ Scene ${String(Math.max(1, idx)).padStart(2, '0')}`,
        sceneEndState: 'Nhân vật hoàn tất động tác chuyển sang nhịp tiếp theo',
      };
      const newScene: DerivativeScene = {
        id: `scene_custom_${Date.now()}`,
        sceneIndex: baseSceneFields.sceneIndex!,
        sceneTitle: baseSceneFields.sceneTitle!,
        sceneSummary: baseSceneFields.sceneSummary!,
        durationSec: baseSceneFields.durationSec!,
        sourceVideoIndex: baseSceneFields.sourceVideoIndex!,
        sourceStartPercent: baseSceneFields.sourceStartPercent!,
        onScreenText: baseSceneFields.onScreenText!,
        dialogue: baseSceneFields.dialogue!,
        narration: baseSceneFields.narration!,
        charactersInScene: baseSceneFields.charactersInScene,
        actionDetail: baseSceneFields.actionDetail,
        settingDetail: baseSceneFields.settingDetail,
        cameraAngle: baseSceneFields.cameraAngle,
        cameraMovement: baseSceneFields.cameraMovement,
        cameraEquipment: baseSceneFields.cameraEquipment,
        lighting: baseSceneFields.lighting,
        costume: baseSceneFields.costume,
        shotStyle: baseSceneFields.shotStyle,
        continuityNote: baseSceneFields.continuityNote,
        sceneEndState: baseSceneFields.sceneEndState,
        videoTimeline: buildSceneTimelineFallbackClient(baseSceneFields),
        imagePrompt: 'Khung hình rõ nét, bố cục cân đối giữ nguyên ngoại hình nhân vật, trang phục, ánh sáng và bối cảnh đồng bộ.',
        videoPrompt: 'Chuyển động tự nhiên mượt mà, máy quay đẩy chậm giữ trọn không khí và tính liên tục.',
        visualNote: 'Nhân vật xuất hiện nối tiếp tự nhiên trong bối cảnh đồng bộ.',
        brollKeywordEn: 'cinematic story scene',
      };
      return { ...prev, scenes: [...prev.scenes, newScene] };
    });
  };

  const handleDeleteScene = (sceneId: string) => {
    setBlueprint((prev) => {
      if (!prev || prev.scenes.length <= 1) return prev;
      return {
        ...prev,
        scenes: prev.scenes
          .filter((s) => s.id !== sceneId)
          .map((s, idx) => ({ ...s, sceneIndex: idx + 1 })),
      };
    });
  };

  const handleMoveScene = (sceneId: string, direction: 'up' | 'down') => {
    setBlueprint((prev) => {
      if (!prev) return prev;
      const idx = prev.scenes.findIndex((s) => s.id === sceneId);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.scenes.length) return prev;
      const copy = [...prev.scenes];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return {
        ...prev,
        scenes: copy.map((s, i) => ({ ...s, sceneIndex: i + 1 })),
      };
    });
  };

  // Generate AI Scene Image keeping Character Ref + Consistency Bibles + Video Style
  const generateSingleSceneImage = async (
    sc: DerivativeScene,
    opts?: { preserveGlobalError?: boolean }
  ): Promise<boolean> => {
    if (!blueprint) return false;
    setBusySceneImageIds((prev) => new Set(prev).add(sc.id));
    setQueuedSceneImageIds((prev) => {
      const next = new Set(prev);
      next.delete(sc.id);
      return next;
    });
    setSceneImageErrors((prev) => {
      if (!(sc.id in prev)) return prev;
      const next = { ...prev };
      delete next[sc.id];
      return next;
    });
    if (!opts?.preserveGlobalError) {
      setSceneMediaError('');
    }

    const activeStyle = blueprint.videoStyle || videoStyle;
    const activeCharBible = blueprint.characterBible ?? characterBibleDraft;
    const activeSettingBible = blueprint.settingBible ?? settingBibleDraft;
    const activeVisualStyleBible = blueprint.visualStyleBible ?? visualStyleBibleDraft;
    const activeCostumeBible = blueprint.costumeBible ?? costumeBibleDraft;
    const activeContinuityBible = blueprint.continuityBible ?? continuityBibleDraft;
    const effectiveAllowFree = blueprint.allowFreeCostumeChange ?? allowFreeCostumeChange;
    const compiledPrompt = compileScenePromptClient({
      scene: sc,
      videoStyle: activeStyle,
      learnedStyles,
      customStylePrompt,
      characterBible: activeCharBible,
      settingBible: activeSettingBible,
      visualStyleBible: activeVisualStyleBible,
      costumeBible: activeCostumeBible,
      continuityBible: activeContinuityBible,
      characterRefs: characters,
      enableVoiceover: voiceMode !== 'none',
      totalScenes: blueprint.scenes.length,
      mediaType: 'image',
      hasAttachedRefs: characters.length > 0,
      targetEngine: imageEngineMode === 'muse2api' ? 'muse2api' : 'gemini',
      allowFreeCostumeChange: effectiveAllowFree,
    });

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{ dataUrl?: string; error?: string }>(
        '/api/studio/generate-image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'scene',
            mediaType: 'image',
            prompt: compiledPrompt,
            aspectRatio,
            quality: imageEngineMode === 'gemini_pro' ? 'pro' : 'standard',
            engine: imageEngineMode === 'muse2api' ? 'muse2api' : imageEngineMode === 'qwen' ? 'qwen' : 'gemini',
            videoStyle: activeStyle,
            customStylePrompt: customStylePrompt.trim(),
            characterBible: activeCharBible,
            settingBible: activeSettingBible,
            visualStyleBible: activeVisualStyleBible,
            costumeBible: activeCostumeBible,
            continuityBible: activeContinuityBible,
            allowFreeCostumeChange: effectiveAllowFree,
            sceneIndex: sc.sceneIndex,
            totalScenes: blueprint.scenes.length,
            sceneTitle: sc.sceneTitle || '',
            charactersInScene: sc.charactersInScene || '',
            settingDetail: sc.settingDetail || '',
            actionDetail: sc.actionDetail || '',
            dialogue: sc.dialogue || '',
            sceneSummary: sc.sceneSummary || '',
            costume: sc.costume || '',
            cameraAngle: sc.cameraAngle || '',
            cameraMovement: sc.cameraMovement || '',
            cameraEquipment: sc.cameraEquipment || '',
            lighting: sc.lighting || '',
            sceneEndState: sc.sceneEndState || '',
            imagePrompt: sc.imagePrompt || '',
            videoPrompt: sc.videoPrompt || '',
            vfxNotes: sc.vfxNotes || '',
            selectedCharacterIds: sc.selectedCharacterIds,
            characterRefs: characters.map((c) => ({
              id: c.id,
              dataUrl: c.dataUrl,
              name: c.name,
              description: c.description,
              syncProfile: c.syncProfile,
            })),
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      updateScene(sc.id, {
        sceneImageDataUrl: data.dataUrl,
        sceneImageSource: 'ai',
        omniClipAssetId: undefined,
        omniClipPreviewUrl: undefined,
      });
      return true;
    } catch (err: any) {
      const errMsg = err?.message || `Không thể tạo ảnh cho phân cảnh ${sc.sceneIndex}.`;
      setSceneImageErrors((prev) => ({ ...prev, [sc.id]: errMsg }));
      setSceneMediaError(`Phân cảnh ${sc.sceneIndex}: ${errMsg}`);
      return false;
    } finally {
      setBusySceneImageIds((prev) => {
        const next = new Set(prev);
        next.delete(sc.id);
        return next;
      });
    }
  };

  const handleBatchGenerateSceneImages = async () => {
    if (!blueprint || isBatchGeneratingImages) return;
    const pendingScenes = blueprint.scenes.filter((sc) => !sc.sceneImageDataUrl);
    if (pendingScenes.length === 0) {
      setSceneMediaError('Tất cả phân cảnh hiện đã có ảnh. Bấm "Tạo lại ảnh AI" trên từng cảnh nếu muốn vẽ lại.');
      return;
    }

    batchImageAbortRef.current = false;
    setIsBatchGeneratingImages(true);
    setSceneMediaError('');
    setQueuedSceneImageIds(new Set(pendingScenes.map((s) => s.id)));
    setBatchImageProgress({ current: 0, total: pendingScenes.length });

    let failedCount = 0;
    for (let i = 0; i < pendingScenes.length; i++) {
      if (batchImageAbortRef.current) break;
      const sc = pendingScenes[i];
      setBatchImageProgress({ current: i + 1, total: pendingScenes.length });
      const ok = await generateSingleSceneImage(sc, { preserveGlobalError: true });
      if (!ok) failedCount += 1;
    }

    setQueuedSceneImageIds(new Set());
    setBatchImageProgress(null);
    setIsBatchGeneratingImages(false);
    if (failedCount > 0 && !batchImageAbortRef.current) {
      setSceneMediaError(
        `Đã hoàn tất lượt tạo hàng loạt (${pendingScenes.length - failedCount}/${pendingScenes.length} phân cảnh thành công, ${failedCount} cảnh lỗi — xem chi tiết ngay dưới từng cảnh).`
      );
    }
  };

  const handleStopBatchGenerateSceneImages = () => {
    batchImageAbortRef.current = true;
    setQueuedSceneImageIds(new Set());
  };

  const handleUploadSceneImage = async (sceneId: string, file: File) => {
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 1280);
      setSceneImageErrors((prev) => {
        if (!(sceneId in prev)) return prev;
        const next = { ...prev };
        delete next[sceneId];
        return next;
      });
      updateScene(sceneId, {
        sceneImageDataUrl: dataUrl,
        sceneImageSource: 'uploaded',
        omniClipAssetId: undefined,
        omniClipPreviewUrl: undefined,
      });
    } catch (err: any) {
      setSceneMediaError(err?.message || 'Không đọc được ảnh tải lên.');
    }
  };

  const handleDeleteSceneImage = (sceneId: string) => {
    setSceneImageErrors((prev) => {
      if (!(sceneId in prev)) return prev;
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
    updateScene(sceneId, {
      sceneImageDataUrl: undefined,
      sceneImageSource: undefined,
    });
  };

  // Generate AI Video Clip with Gemini Omni Flash or Muse2API keeping full consistency context
  const handleGenerateSceneOmniClip = async (sc: DerivativeScene) => {
    if (!blueprint) return;
    setBusySceneVideoIds((prev) => new Set(prev).add(sc.id));
    setSceneMediaError('');
    const activeStyle = blueprint.videoStyle || videoStyle;
    const activeCharBible = blueprint.characterBible ?? characterBibleDraft;
    const activeSettingBible = blueprint.settingBible ?? settingBibleDraft;
    const activeVisualStyleBible = blueprint.visualStyleBible ?? visualStyleBibleDraft;
    const activeCostumeBible = blueprint.costumeBible ?? costumeBibleDraft;
    const activeContinuityBible = blueprint.continuityBible ?? continuityBibleDraft;
    const effectiveAllowFree = blueprint.allowFreeCostumeChange ?? allowFreeCostumeChange;
    const compiledPrompt = compileScenePromptClient({
      scene: sc,
      videoStyle: activeStyle,
      learnedStyles,
      customStylePrompt,
      characterBible: activeCharBible,
      settingBible: activeSettingBible,
      visualStyleBible: activeVisualStyleBible,
      costumeBible: activeCostumeBible,
      continuityBible: activeContinuityBible,
      characterRefs: characters,
      enableVoiceover: voiceMode !== 'none',
      totalScenes: blueprint.scenes.length,
      mediaType: 'video',
      hasAttachedRefs: Boolean(sc.sceneImageDataUrl || characters.length > 0),
      targetEngine: sceneVideoEngine === 'muse2api' ? 'muse2api' : 'gemini',
      allowFreeCostumeChange: effectiveAllowFree,
      musicPromptDirective: activeMusicPromptDirective,
    });

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        assetId?: string;
        previewUrl?: string;
        error?: string;
      }>('/api/studio/generate-scene-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: sceneVideoEngine,
          mediaType: 'video',
          prompt: compiledPrompt,
          aspectRatio,
          durationSec: Math.min(
            sceneVideoEngine === 'qwen' ? 10 : sceneVideoEngine === 'muse2api' ? 12 : 15,
            Math.max(4, Math.round(sc.durationSec || 8))
          ),
          videoStyle: activeStyle,
          customStylePrompt: customStylePrompt.trim(),
          characterBible: activeCharBible,
          settingBible: activeSettingBible,
          visualStyleBible: activeVisualStyleBible,
          costumeBible: activeCostumeBible,
          continuityBible: activeContinuityBible,
          allowFreeCostumeChange: effectiveAllowFree,
          musicMode,
          musicStyle,
          musicPrompt: musicPrompt.trim(),
          musicVolume: Math.max(0, Math.min(0.9, musicVolume / 100)),
          musicInstrumentalOnly,
          musicDirective: activeMusicPromptDirective,
          sceneIndex: sc.sceneIndex,
          totalScenes: blueprint.scenes.length,
          sceneTitle: sc.sceneTitle || '',
          settingDetail: sc.settingDetail || '',
          cameraMovement: sc.cameraMovement || '',
          cameraEquipment: sc.cameraEquipment || '',
          charactersInScene: sc.charactersInScene || '',
          actionDetail: sc.actionDetail || '',
          dialogue: sc.dialogue || '',
          narration: voiceMode !== 'none' ? sc.narration || '' : '',
          videoTimeline: (sc.videoTimeline || '').trim() || buildSceneTimelineFallbackClient(sc),
          enableVoiceover: voiceMode !== 'none',
          sceneSummary: sc.sceneSummary || '',
          costume: sc.costume || '',
          cameraAngle: sc.cameraAngle || '',
          lighting: sc.lighting || '',
          sceneEndState: sc.sceneEndState || '',
          imagePrompt: sc.imagePrompt || '',
          videoPrompt: sc.videoPrompt || '',
          vfxNotes: sc.vfxNotes || '',
          selectedCharacterIds: sc.selectedCharacterIds,
          sceneImageDataUrl: sc.sceneImageDataUrl,
          characterRefs: characters.map((c) => ({
            id: c.id,
            dataUrl: c.dataUrl,
            name: c.name,
            description: c.description,
            syncProfile: c.syncProfile,
          })),
        }),
      });
      if (!res.ok || !data.assetId) throw new Error(data.error || `HTTP ${res.status}`);
      updateScene(sc.id, {
        omniClipAssetId: data.assetId,
        omniClipPreviewUrl: data.previewUrl,
      });
    } catch (err: any) {
      setSceneMediaError(
        err?.message ||
          `Không tạo được clip ${
            sceneVideoEngine === 'qwen'
              ? 'AI Qwen (Alibaba)'
              : sceneVideoEngine === 'muse2api'
              ? 'Muse2API'
              : 'Omni Flash'
          } cho phân cảnh ${sc.sceneIndex}.`
      );
    } finally {
      setBusySceneVideoIds((prev) => {
        const next = new Set(prev);
        next.delete(sc.id);
        return next;
      });
    }
  };

  // Install or warm up VieNeu-TTS offline voice model
  const handleInstallVieNeuOffline = async () => {
    setIsInstallingVieNeu(true);
    setOfflineTtsNotice('');
    setGenError('');
    try {
      const res = await fetch('/api/tts/offline/setup', { method: 'POST' });
      const data = await parseJsonSafe<{ ok?: boolean; message?: string; error?: string }>(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setOfflineTtsNotice(data.message || 'Đã sẵn sàng thư viện giọng VieNeu-TTS Offline.');
      await fetchCapabilitiesAndVoices();
    } catch (err: any) {
      setGenError(err?.message || 'Không thể cài đặt thư viện VieNeu-TTS Offline.');
    } finally {
      setIsInstallingVieNeu(false);
    }
  };

  const handleSpeakOfflineBrowserPreview = async (
    text: string,
    sceneKey = 'sample',
    overrideVoiceMode?: 'default' | 'ai_online' | 'offline_system',
    overrideOfflineVoice?: string,
    overrideGeminiVoiceId?: Exclude<DerivativeVoiceId, 'none'>,
    overrideCharacterName?: string
  ) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    const effectiveMode =
      overrideVoiceMode && overrideVoiceMode !== 'default'
        ? overrideVoiceMode
        : voiceMode === 'none'
        ? 'ai_online'
        : voiceMode;
    const effectiveOfflineVoice = overrideOfflineVoice || offlineVoice;
    const effectiveGeminiVoice = overrideGeminiVoiceId || voice;

    if (effectiveMode === 'ai_online') {
      const voiceMeta = GEMINI_VOICE_LIBRARY.find((v) => v.value === effectiveGeminiVoice);
      setPreviewingSceneId(sceneKey);
      setOfflineTtsNotice('');
      setCharError('');
      try {
        const res = await fetch('/api/tts/gemini/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText.slice(0, 420),
            voice: effectiveGeminiVoice,
            voiceStyle: voiceMeta?.style || '',
            characterName: overrideCharacterName || '',
          }),
        });
        if (!res.ok) {
          const errData = await parseJsonSafe<{ error?: string }>(res).catch(() => ({} as { error?: string }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const wavBlob = await res.blob();
        if (previewAudioRef.current) {
          previewAudioRef.current.pause();
        }
        if (previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(wavBlob);
        previewObjectUrlRef.current = blobUrl;
        const audio = new Audio(blobUrl);
        previewAudioRef.current = audio;
        await audio.play();
        return;
      } catch (err: any) {
        const errText = err?.message || 'Không phát được giọng Gemini, chuyển sang đọc nháp trình duyệt.';
        if (sceneKey.startsWith('char')) {
          setCharError(errText);
        } else {
          setOfflineTtsNotice(errText);
        }
      } finally {
        setPreviewingSceneId(null);
      }
    }

    if (effectiveMode === 'offline_system' && capabilities?.localTools.offlineTts.engineId === 'vieneu') {
      setPreviewingSceneId(sceneKey);
      setOfflineTtsNotice('');
      try {
        const res = await fetch('/api/tts/offline/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText.slice(0, 400),
            voice: effectiveOfflineVoice,
          }),
        });
        if (!res.ok) {
          const errData = await parseJsonSafe<{ error?: string }>(res).catch(() => ({} as { error?: string }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const wavBlob = await res.blob();
        if (previewAudioRef.current) {
          previewAudioRef.current.pause();
        }
        if (previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(wavBlob);
        previewObjectUrlRef.current = blobUrl;
        const audio = new Audio(blobUrl);
        previewAudioRef.current = audio;
        await audio.play();
        return;
      } catch (err: any) {
        setOfflineTtsNotice(err?.message || 'Không phát được giọng VieNeu, chuyển sang trình duyệt.');
      } finally {
        setPreviewingSceneId(null);
      }
    }

    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = outputLanguage === 'en' ? 'en-US' : outputLanguage === 'zh' ? 'zh-CN' : 'vi-VN';
    window.speechSynthesis.speak(utter);
  };

  // Music: Prompt-embedded AI style selection, Wikimedia Commons Audio Search & Upload
  const handleSelectAiMusicStyle = (nextStyle: AiMusicStyleId) => {
    setMusicStyle(nextStyle);
    const meta = AI_MUSIC_STYLE_OPTIONS.find((opt) => opt.value === nextStyle);
    if (meta && nextStyle !== 'custom') {
      setMusicPrompt(meta.defaultPromptVi);
    }
    if (musicMode === 'none') {
      setMusicMode('ai_lyria');
    }
  };

  const handleSearchPublicMusic = async () => {
    setIsSearchingMusic(true);
    setMusicError('');
    try {
      const res = await fetch(`/api/studio/public-music?q=${encodeURIComponent(publicMusicQuery.trim() || 'ambient')}`);
      const data = await parseJsonSafe<{
        tracks?: { id: string; title: string; url: string; mimeType: string }[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const tracks: StudioMusicTrack[] = (data.tracks || []).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        mimeType: t.mimeType,
        source: 'wikimedia',
      }));
      setPublicMusicResults(tracks);
      if (tracks.length > 0 && !selectedPublicTrack) {
        setSelectedPublicTrack(tracks[0]);
      }
    } catch (err: any) {
      setMusicError(err?.message || 'Không thể tìm nhạc công cộng miễn phí.');
    } finally {
      setIsSearchingMusic(false);
    }
  };

  const handleUploadMusicFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMusicError('');
    try {
      const asset = await uploadMediaFileToStudio<{
        assetId: string;
        fileName: string;
        durationSec: number;
        mimeType: string;
        previewUrl: string;
      }>(file, 'audio');
      setUploadedAudioTrack({
        id: asset.assetId,
        assetId: asset.assetId,
        title: asset.fileName,
        url: asset.previewUrl,
        durationSec: asset.durationSec,
        mimeType: asset.mimeType,
        source: 'uploaded',
      });
    } catch (err: any) {
      setMusicError(err?.message || 'Không thể tải tệp nhạc lên.');
    }
  };

  // Submit and wait for a single blueprint render job
  const syncJobScenesToBlueprint = (
    stData: DerivativeJobState,
    targetMode: StudioCreationMode,
    targetIdx: number,
    explicitScenePatch?: { sceneIdx: number; sceneImageDataUrl?: string; videoAssetId?: string; videoPreviewUrl?: string }
  ) => {
    const jobScenes = stData.scenes;
    if ((!jobScenes || jobScenes.length === 0) && !explicitScenePatch) return;
    setBatchBlueprintsByMode((prevMap) => {
      const list = prevMap[targetMode] || [];
      const bp = list[targetIdx];
      if (!bp) return prevMap;
      let changed = false;
      const nextScenes = bp.scenes.map((sc, idx) => {
        const sp = jobScenes?.[idx];
        const patch: Partial<DerivativeScene> = {};
        if (sp?.videoAssetId && sp.videoAssetId !== sc.omniClipAssetId) {
          patch.omniClipAssetId = sp.videoAssetId;
          patch.omniClipPreviewUrl = sp.videoPreviewUrl || `/api/studio/assets/${sp.videoAssetId}`;
        }
        if (explicitScenePatch && explicitScenePatch.sceneIdx === idx) {
          if (explicitScenePatch.sceneImageDataUrl) {
            patch.sceneImageDataUrl = explicitScenePatch.sceneImageDataUrl;
            patch.sceneImageSource = 'ai';
          }
          if (explicitScenePatch.videoAssetId) {
            patch.omniClipAssetId = explicitScenePatch.videoAssetId;
            patch.omniClipPreviewUrl =
              explicitScenePatch.videoPreviewUrl || `/api/studio/assets/${explicitScenePatch.videoAssetId}`;
          }
        }
        if (Object.keys(patch).length > 0) {
          changed = true;
          return { ...sc, ...patch };
        }
        return sc;
      });
      if (!changed) return prevMap;
      const nextList = list.map((item, i) => (i === targetIdx ? { ...item, scenes: nextScenes } : item));
      return { ...prevMap, [targetMode]: nextList };
    });
  };

  const pollJobUntilSettled = (
    jobId: string,
    targetKey: string,
    targetMode: StudioCreationMode,
    targetIdx: number
  ): Promise<DerivativeJobState> => {
    return new Promise((resolve) => {
      stopPolling();
      const pollOnce = async () => {
        try {
          const stRes = await fetch(`/api/derivative/jobs/${jobId}`);
          if (!stRes.ok) return;
          const stData = await parseJsonSafe<DerivativeJobState>(stRes);
          setJobForKey(targetKey, stData);
          syncJobScenesToBlueprint(stData, targetMode, targetIdx);
          if (
            stData.status === 'completed' ||
            stData.status === 'error' ||
            stData.status === 'partial_error'
          ) {
            stopPolling();
            resolve(stData);
          }
        } catch {
          // ignore transient poll error
        }
      };
      void pollOnce();
      pollTimerRef.current = window.setInterval(() => {
        void pollOnce();
      }, 1400);
    });
  };

  const renderBlueprintAndAwait = async (
    targetBp: DerivativeBlueprint,
    targetKey: string,
    targetIdx: number
  ): Promise<DerivativeJobState> => {
    const voiceObj = VOICE_OPTIONS.find((v) => v.value === voice);
    const activeMusicAssetId =
      musicMode === 'uploaded' ? uploadedAudioTrack?.assetId : undefined;

    setJobForKey(targetKey, {
      jobId: '',
      status: 'queued',
      progress: 5,
      visualMode,
      stepLabel:
        studioMode === 'creative'
          ? 'Đang gửi yêu cầu dựng video sáng tạo...'
          : 'Đang gửi yêu cầu dựng video phái sinh...',
      scenes: targetBp.scenes.map((sc, i) => ({
        sceneIndex: i,
        sceneNumber: sc.sceneIndex || i + 1,
        sceneTitle: sc.sceneTitle || `Phân cảnh #${i + 1}`,
        progress: sc.omniClipAssetId ? 70 : sc.sceneImageDataUrl ? 25 : 5,
        status: 'pending',
        stageLabel: sc.omniClipAssetId
          ? 'Đã có video sẵn — chờ dựng & ghép MP4'
          : sc.sceneImageDataUrl
          ? 'Đã có ảnh từ Bước 2 — chuyển thẳng sang tạo video'
          : 'Đang chờ khởi tạo tiến trình...',
        imageStatus: sc.sceneImageDataUrl ? 'reused' : 'pending',
        imageSource: sc.sceneImageDataUrl ? 'step2_reused' : 'none',
        videoStatus: sc.omniClipAssetId ? 'reused' : 'pending',
        videoAssetId: sc.omniClipAssetId,
        videoPreviewUrl: sc.omniClipPreviewUrl,
        audioStatus: 'pending',
        renderStatus: 'pending',
        updatedAt: Date.now(),
      })),
    });

    const res = await fetch('/api/derivative/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blueprint: {
          ...targetBp,
          mode: studioMode,
          productionFormat: targetBp.productionFormat || productionFormat,
          videoStyle: targetBp.videoStyle || videoStyle,
          characterBible: targetBp.characterBible ?? characterBibleDraft,
          settingBible: targetBp.settingBible ?? settingBibleDraft,
          visualStyleBible: targetBp.visualStyleBible ?? visualStyleBibleDraft,
          costumeBible: targetBp.costumeBible ?? costumeBibleDraft,
          continuityBible: targetBp.continuityBible ?? continuityBibleDraft,
          allowFreeCostumeChange: targetBp.allowFreeCostumeChange ?? allowFreeCostumeChange,
          aspectRatio,
          enableVoiceover: voiceMode !== 'none',
        },
        sources: studioMode === 'derivative' ? sources : [],
        visualMode,
        voice: voiceMode === 'ai_online' ? voice : 'none',
        voiceMode,
        voiceStyle: voiceObj?.style || '',
        offlineVoice: voiceMode === 'offline_system' ? offlineVoice : undefined,
        keepSourceAudio: studioMode === 'derivative' ? keepSourceAudio : false,
        brollSource,
        musicMode,
        musicStyle,
        musicInstrumentalOnly,
        musicAssetId: activeMusicAssetId,
        publicMusicUrl: musicMode === 'public_free' ? selectedPublicTrack?.url : undefined,
        musicPrompt,
        musicVolume: Math.max(0, Math.min(0.9, musicVolume / 100)),
        characterRefs: characters.map((c) => ({
          id: c.id,
          dataUrl: c.dataUrl,
          name: c.name,
          description: c.description,
          ageGroup: c.ageGroup,
          gender: c.gender,
          voiceMode: c.voiceMode || 'default',
          voiceId: c.voiceId || voice,
          offlineVoice: c.offlineVoice,
          voiceStyle: c.voiceStyle,
          accentLock: c.accentLock || 'vn_north',
          syncProfile: c.syncProfile,
        })),
        sessdata,
        ytCookies,
      }),
    });
    const data = await parseJsonSafe<DerivativeJobState & { error?: string }>(res);
    if (!res.ok || !data.jobId) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    setJobForKey(targetKey, data);
    return pollJobUntilSettled(data.jobId, targetKey, studioMode, targetIdx);
  };

  // Final Render Pipeline for currently selected video
  const handleRenderFinalVideo = async () => {
    if (!blueprint) return;
    if (studioMode === 'derivative' && sources.length === 0) {
      const hasMedia = blueprint.scenes.some((s) => Boolean(s.sceneImageDataUrl || s.omniClipAssetId));
      if (!hasMedia) {
        setGenError('Chế độ Tạo Video Phái Sinh cần ít nhất 1 video nguồn hoặc ảnh/clip phân cảnh.');
        setActiveStudioStep(3);
        return;
      }
    }

    setActiveStudioStep(3);
    setIsGeneratingFinal(true);
    setGenError('');
    try {
      const finalState = await renderBlueprintAndAwait(blueprint, activeJobKey, activeBatchIndex);
      if (finalState.status === 'error' || finalState.status === 'partial_error') {
        setGenError(finalState.error || 'Một số phân cảnh gặp lỗi — hãy xử lý ngay ở danh sách tiến trình bên dưới.');
      }
    } catch (err: any) {
      setGenError(err?.message || 'Không thể khởi tạo tác vụ dựng video.');
    } finally {
      setIsGeneratingFinal(false);
    }
  };

  const handleRetryRenderScene = async (sceneIdx: number, action: 'image' | 'video' | 'full') => {
    if (!job?.jobId) return;
    const busyKey = `${job.jobId}:${sceneIdx}:${action}`;
    setRetryingRenderSceneKey(busyKey);
    setGenError('');
    const resolvedImgEngine: 'gemini' | 'muse2api' | 'qwen' =
      imageEngineMode === 'muse2api' ? 'muse2api' : imageEngineMode === 'qwen' ? 'qwen' : 'gemini';

    // Optimistic UI feedback for that specific scene row
    setJobForKey(activeJobKey, {
      ...job,
      scenes: (job.scenes || []).map((sp, i) =>
        i === sceneIdx
          ? {
              ...sp,
              status: 'running',
              imageStatus: action === 'image' ? 'running' : sp.imageStatus,
              videoStatus: action === 'video' || action === 'full' ? 'running' : sp.videoStatus,
              error: undefined,
              failedStage: undefined,
              stageLabel:
                action === 'image'
                  ? 'Đang tạo lại ảnh phân cảnh...'
                  : action === 'video'
                  ? 'Đang tạo lại video từ ảnh phân cảnh...'
                  : 'Đang khởi tạo lại tiến trình phân cảnh...',
            }
          : sp
      ),
    });

    try {
      const res = await fetch(`/api/derivative/jobs/${job.jobId}/scenes/${sceneIdx}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, imageEngine: resolvedImgEngine }),
      });
      const data = await parseJsonSafe<{
        ok?: boolean;
        error?: string;
        job?: DerivativeJobState;
        sceneImageDataUrl?: string;
        videoAssetId?: string;
        videoPreviewUrl?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.job) {
        setJobForKey(activeJobKey, data.job);
        syncJobScenesToBlueprint(data.job, studioMode, activeBatchIndex, {
          sceneIdx,
          sceneImageDataUrl: data.sceneImageDataUrl,
          videoAssetId: data.videoAssetId,
          videoPreviewUrl: data.videoPreviewUrl,
        });
      }
    } catch (err: any) {
      setGenError(err?.message || `Không thể chạy lại phân cảnh #${sceneIdx + 1}.`);
    } finally {
      setRetryingRenderSceneKey(null);
    }
  };

  const handleResumeRenderJob = async (allowFallbackOnError = false) => {
    if (!job?.jobId || isGeneratingFinal || isResumingRenderJob) return;
    setIsResumingRenderJob(true);
    setIsGeneratingFinal(true);
    setGenError('');
    try {
      const res = await fetch(`/api/derivative/jobs/${job.jobId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowFallbackOnError }),
      });
      const data = await parseJsonSafe<DerivativeJobState & { error?: string }>(res);
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setJobForKey(activeJobKey, data);
      const finalState = await pollJobUntilSettled(data.jobId, activeJobKey, studioMode, activeBatchIndex);
      if (finalState.status === 'error' || finalState.status === 'partial_error') {
        setGenError(finalState.error || 'Một số phân cảnh vẫn còn lỗi — hãy kiểm tra trực tiếp ở từng phân cảnh bên dưới.');
      }
    } catch (err: any) {
      setGenError(err?.message || 'Không thể khởi tạo lại tiến trình ghép MP4.');
    } finally {
      setIsResumingRenderJob(false);
      setIsGeneratingFinal(false);
    }
  };

  // Batch Render all independent videos sequentially
  const handleBatchRenderAllVideos = async () => {
    if (blueprints.length <= 1 || isGeneratingFinal || isBatchRenderingAll) return;
    if (studioMode === 'derivative' && sources.length === 0) {
      setGenError('Cần ít nhất 1 video nguồn tham chiếu hoặc ảnh/clip phân cảnh để dựng hàng loạt.');
      setActiveStudioStep(3);
      return;
    }

    setActiveStudioStep(3);
    batchRenderAbortRef.current = false;
    setIsBatchRenderingAll(true);
    setIsGeneratingFinal(true);
    setGenError('');

    let failed = 0;
    for (let idx = 0; idx < blueprints.length; idx += 1) {
      if (batchRenderAbortRef.current) break;
      const bp = blueprints[idx];
      const key = `${studioMode}:${idx}`;
      if (jobsByKey[key]?.status === 'completed') continue;

      setActiveBatchIndex(idx);
      setBatchRenderStatusText(`Đang dựng Video ${idx + 1}/${blueprints.length}: ${bp.derivativeTitle}`);
      try {
        const result = await renderBlueprintAndAwait(bp, key, idx);
        if (result.status === 'error' || result.status === 'partial_error') failed += 1;
      } catch (err: any) {
        failed += 1;
        setJobForKey(key, {
          jobId: '',
          status: 'error',
          progress: 0,
          stepLabel: 'Lỗi dựng video',
          error: err?.message || 'Không thể khởi tạo dựng video.',
        });
      }
    }

    setBatchRenderStatusText('');
    setIsBatchRenderingAll(false);
    setIsGeneratingFinal(false);
    if (failed > 0 && !batchRenderAbortRef.current) {
      setGenError(`Hoàn tất dựng hàng loạt: có ${failed}/${blueprints.length} video gặp lỗi — bấm vào từng video để xử lý riêng các phân cảnh lỗi.`);
    }
  };

  const totalSceneSec = blueprint
    ? Math.round(blueprint.scenes.reduce((sum, s) => sum + Number(s.durationSec || 0), 0))
    : 0;
  const canSubmitLearn =
    studioMode === 'creative'
      ? Boolean(expandedIdeas.length > 0 || expandedIdeaPrompt.trim() || ideaPrompt.trim() || customInstruction.trim())
      : sources.length > 0;

  const inputCls =
    'w-full h-9 px-3 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400';

  const productionAndBatchControls = (
    <div className="space-y-3.5 pt-3 border-t border-slate-200/80 dark:border-slate-400/15 text-xs">
      {/* 2 Video Production Format Modes: Phim có lời thoại vs Phim thuyết minh kể chuyện */}
      <div className="space-y-2 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-slate-800 dark:text-white">
            Chế độ sản xuất video
          </span>
          <span className="text-[10px] font-medium text-cyan-700 dark:text-cyan-300">
            {productionFormat === 'dialogue_film'
              ? 'Đồng bộ nhân vật · giọng đúng độ tuổi'
              : '1 giọng dẫn chuyện · AI tự ghép nhạc'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRODUCTION_FORMAT_OPTIONS.map((fmt) => {
            const active = productionFormat === fmt.value;
            return (
              <button
                key={fmt.value}
                type="button"
                onClick={() => {
                  setProductionFormat(fmt.value);
                  if (fmt.value === 'narration_story') {
                    if (voiceMode === 'none') setVoiceMode('ai_online');
                    if (musicMode === 'none') setMusicMode('auto_adaptive');
                    setShowManualNarrationMusic(false);
                  } else if (musicMode === 'auto_adaptive') {
                    setMusicMode('none');
                  }
                }}
                className={`text-left p-2.5 rounded-xl border transition cursor-pointer space-y-0.5 ${
                  active
                    ? fmt.value === 'dialogue_film'
                      ? 'bg-violet-500/15 border-violet-400/60 text-slate-900 dark:text-white shadow-sm'
                      : 'bg-emerald-500/15 border-emerald-400/60 text-slate-900 dark:text-white shadow-sm'
                    : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-cyan-400/40'
                }`}
              >
                <div className="font-bold flex items-center justify-between gap-1.5">
                  <span>{fmt.label}</span>
                  {active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/80 dark:bg-white/10 text-slate-800 dark:text-white font-semibold">
                      Đang chọn
                    </span>
                  )}
                </div>
                <div className="text-[10px] opacity-85 leading-snug">{fmt.shortDesc}</div>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {PRODUCTION_FORMAT_OPTIONS.find((f) => f.value === productionFormat)?.detailDesc}
        </p>
      </div>

      {/* Script Mode Segmented Selector + Comparison Help */}
      <div className="space-y-2 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Kiểu tạo lô video</span>
          <button
            type="button"
            onClick={() => setShowScriptModeGuide((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{showScriptModeGuide ? 'Ẩn so sánh' : 'Phân biệt 2 chế độ'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setScriptMode('series');
            }}
            className={`text-left p-2.5 rounded-xl border transition cursor-pointer ${
              scriptMode === 'series'
                ? 'bg-violet-500/15 border-violet-400/50 text-slate-900 dark:text-white'
                : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300'
            }`}
          >
            <div className="font-bold">Series liên hoàn</div>
            <div className="text-[11px] opacity-80">
              1 kịch bản tổng thể – {unifiedUnitCount} phân cảnh liên tiếp
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setScriptMode('independent_batch');
              if (desiredSceneCount !== 'auto') setDesiredSceneCount('auto');
            }}
            className={`text-left p-2.5 rounded-xl border transition cursor-pointer ${
              scriptMode === 'independent_batch'
                ? 'bg-violet-500/15 border-violet-400/50 text-slate-900 dark:text-white'
                : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300'
            }`}
          >
            <div className="font-bold">Lô nhiều video độc lập</div>
            <div className="text-[11px] opacity-80">
              {unifiedUnitCount} kịch bản độc lập phái sinh cùng mô-típ
            </div>
          </button>
        </div>

        {showScriptModeGuide && (
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-[11px] space-y-1.5 text-slate-600 dark:text-slate-300">
            <p>
              <strong className="text-violet-600 dark:text-violet-300">Series liên hoàn (1 kịch bản – {unifiedUnitCount} phân cảnh):</strong> AI viết <strong>01 kịch bản tổng thể duy nhất</strong> bám sát 100% ý tưởng gốc, rồi chia thành <strong>{unifiedUnitCount} phân cảnh liên tiếp</strong>, mỗi phân cảnh dài <strong>{targetDurationSec}s</strong> (tổng <strong>{unifiedTotalDurationSec}s</strong>), tình tiết nối tiếp logic xuyên suốt.
            </p>
            <p>
              <strong className="text-cyan-600 dark:text-cyan-300">Lô nhiều video độc lập ({unifiedUnitCount} kịch bản độc lập):</strong> AI tạo <strong>{unifiedUnitCount} kịch bản riêng biệt</strong>, mỗi video dài <strong>{targetDurationSec}s</strong> (tổng lô <strong>{unifiedTotalDurationSec}s</strong>), cùng chủ đề &amp; mô-típ cốt lõi nhưng khác nhân vật, phương tiện, bối cảnh cụ thể, hành vi và diễn biến — không liên kết nối tiếp nhau.
            </p>
          </div>
        )}
      </div>

      {/* Unified Single Duration Selector Bar */}
      <div className="space-y-1.5 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
            <span>
              {scriptMode === 'series'
                ? 'Thời lượng video (mỗi phân cảnh):'
                : 'Thời lượng video (mỗi kịch bản độc lập):'}
            </span>
          </span>
          <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-300">
            {targetDurationSec}s / {scriptMode === 'series' ? 'phân cảnh' : 'video'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.sec}
              type="button"
              onClick={() => setTargetDurationSec(preset.sec)}
              className={`h-7 px-2 text-[11px] rounded-lg border transition tabular-nums cursor-pointer whitespace-nowrap ${
                targetDurationSec === preset.sec
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-700 dark:text-cyan-200 font-bold'
                  : 'bg-white dark:bg-[#131a35] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:border-cyan-400/40'
              }`}
            >
              {preset.label}
            </button>
          ))}
          <div className="inline-flex items-center gap-1 pl-1 ml-auto">
            <input
              type="number"
              min={10}
              max={900}
              step={5}
              value={targetDurationSec}
              onChange={(e) => setTargetDurationSec(Math.max(10, Math.min(900, Number(e.target.value) || 10)))}
              aria-label="Nhập số giây tùy ý"
              className="w-16 h-7 px-1.5 text-xs font-mono tabular-nums text-center bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
            />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 pr-1">giây</span>
          </div>
        </div>
      </div>

      {/* Unified Quantity Selector + Live Architectural Formula Preview */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Số lượng ý tưởng muốn AI sáng tạo:
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {[1, 3, 5, 8, 10].map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setIdeaCount(cnt)}
                className={`h-7 px-2.5 text-[11px] rounded-lg border transition tabular-nums cursor-pointer ${
                  unifiedUnitCount === cnt
                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 border-cyan-400/50 font-bold'
                    : 'bg-white dark:bg-[#131a35] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:border-cyan-400/40'
                }`}
              >
                {cnt}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={15}
              value={unifiedUnitCount}
              onChange={(e) =>
                setIdeaCount(Math.max(1, Math.min(15, Math.round(Number(e.target.value) || 1))))
              }
              aria-label="Số lượng ý tưởng muốn AI sáng tạo"
              className="w-14 h-7 px-1.5 text-[11px] font-mono tabular-nums text-center bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-2.5 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-slate-800 dark:text-white">
              {scriptMode === 'series'
                ? `Series liên hoàn: 01 kịch bản · ${unifiedUnitCount} phân cảnh × ${targetDurationSec}s`
                : `Lô độc lập: ${unifiedUnitCount} kịch bản riêng × ${targetDurationSec}s`}
            </span>
            <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-200 border border-violet-400/30 font-mono font-bold text-[10px]">
              Tổng: {unifiedTotalDurationSec}s
            </span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {scriptMode === 'series'
              ? `1 câu chuyện xuyên suốt bám sát ý tưởng gốc, chia thành ${unifiedUnitCount} phân cảnh liên tiếp (Phân cảnh 01 → ${String(unifiedUnitCount).padStart(2, '0')}), mỗi phân cảnh dài đúng ${targetDurationSec}s.`
              : `${unifiedUnitCount} câu chuyện độc lập phái sinh cùng chủ đề & mô-típ cốt lõi, mỗi video dài đúng ${targetDurationSec}s (không nối tiếp tình tiết giữa các video).`}
          </p>
        </div>
      </div>
    </div>
  );

  // Shared AI Idea Expansion + Per-Idea Direct Script Prompt block (used in BOTH Sáng tạo từ ý tưởng & Phái sinh từ video)
  const ideaExpansionAndListBlock = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/85 border border-slate-200 dark:border-slate-400/20">
        <button
          type="button"
          disabled={isExpandingIdea || isLearning || isWatchingReferenceVideo || !ideaPrompt.trim()}
          onClick={() => void handleExpandIdeaWithAi()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-600 hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs shadow-md shadow-indigo-500/20 transition cursor-pointer"
        >
          {isExpandingIdea ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>AI đang tạo {unifiedUnitCount} ý tưởng...</span>
            </>
          ) : (
            <>
              <Wand2 className="w-3.5 h-3.5" />
              <span>
                {expandedIdeas.length > 0
                  ? `Dùng AI triển khai lại (${unifiedUnitCount} ý tưởng)`
                  : `Dùng AI triển khai ${unifiedUnitCount} ý tưởng`}
              </span>
            </>
          )}
        </button>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Bấm <strong>Tạo prompt kịch bản</strong> trực tiếp trên ý tưởng bạn chọn để sang Bước 2
        </span>
      </div>

      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
        <span className="font-semibold text-cyan-700 dark:text-cyan-300">Quy tắc tách bối cảnh khỏi nhân vật: </span>
        AI chỉ triển khai không gian, môi trường, ánh sáng, bầu không khí, hành động/tư thế, góc quay và đạo cụ/phụ kiện độc lập (mũ, nhẫn/trang sức, dây chuyền, giày dép, đồng hồ, túi xách, kính, đạo cụ cầm tay) — <strong className="text-slate-800 dark:text-slate-100">tuyệt đối không mô tả lại khuôn mặt, mái tóc, màu da, vóc dáng hay trang phục chính của nhân vật</strong>.
      </div>

      {expandIdeaError && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{expandIdeaError}</span>
        </div>
      )}

      {(expandedIdeas.length > 0 || isExpandingIdea) && (
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/5 dark:bg-cyan-500/10 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Danh sách ý tưởng đã triển khai ({expandedIdeas.length})
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30">
                {scriptMode === 'independent_batch'
                  ? `Bấm từng ý tưởng tạo ngay 1 kịch bản (${targetDurationSec}s) · không tạo lại ý tưởng`
                  : `Bấm từng ý tưởng tạo 01 kịch bản · ${unifiedUnitCount} phân cảnh × ${targetDurationSec}s = ${unifiedTotalDurationSec}s`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {scriptMode === 'independent_batch' && expandedIdeas.length >= 2 && (
                <button
                  type="button"
                  disabled={isLearning || isExpandingIdea}
                  onClick={() =>
                    void handleLearnAndCreateScript({
                      batchIdeas: expandedIdeas,
                      preserveExactIdea: true,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-bold transition cursor-pointer whitespace-nowrap"
                >
                  {isLearning && generatingIdeaId === '__ALL_BATCH__' ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Đang tạo cả {expandedIdeas.length} ({learningElapsedSec}s)...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      <span>Tạo prompt cả {expandedIdeas.length} ý tưởng</span>
                    </>
                  )}
                </button>
              )}
              {expandedIdeas.length > 0 && !isLearning && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedIdeas([]);
                    setExpandedIdeaPrompt('');
                    setEditingIdeaId(null);
                  }}
                  className="text-[11px] text-slate-500 hover:text-rose-500 cursor-pointer"
                >
                  Xóa danh sách
                </button>
              )}
            </div>
          </div>

          {isExpandingIdea && expandedIdeas.length === 0 ? (
            <div className="flex items-center gap-2 py-5 justify-center text-xs text-cyan-700 dark:text-cyan-200">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>AI đang sáng tạo đúng {ideaCount} ý tưởng riêng biệt theo chủ đề của bạn...</span>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-0.5">
              {expandedIdeas.map((item, idx) => {
                const code = String(item.index || idx + 1).padStart(2, '0');
                const isEditing = editingIdeaId === item.id;
                const isThisGenerating = isLearning && generatingIdeaId === item.id;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-white dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/25 p-3 space-y-2 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-snug">
                        <span className="text-cyan-700 dark:text-cyan-300 font-mono mr-1.5">
                          Ý tưởng {code}:
                        </span>
                        {item.title}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditingIdeaId(isEditing ? null : item.id)}
                        className="text-[11px] text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-300 shrink-0 cursor-pointer"
                      >
                        {isEditing ? 'Thu gọn' : 'Chi tiết / Sửa'}
                      </button>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {item.summary}
                    </p>

                    {isEditing && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-400/15">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExpandedIdeas((prev) =>
                              prev.map((x) => (x.id === item.id ? { ...x, title: val } : x))
                            );
                          }}
                          aria-label={`Tiêu đề Ý tưởng ${code}`}
                          className="w-full h-8 px-2.5 text-xs font-semibold bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
                        />
                        <textarea
                          rows={4}
                          value={item.detail}
                          onChange={(e) => {
                            const val = e.target.value;
                            setExpandedIdeas((prev) =>
                              prev.map((x) => (x.id === item.id ? { ...x, detail: val } : x))
                            );
                          }}
                          aria-label={`Nội dung chi tiết Ý tưởng ${code}`}
                          className="w-full p-2 text-xs bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:border-cyan-400 resize-y leading-relaxed"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[60%]">
                        {item.suggestedSetting ? `Bối cảnh: ${item.suggestedSetting}` : 'Giữ nguyên cốt truyện & tình huống gốc'}
                      </span>
                      <button
                        type="button"
                        disabled={isLearning || isExpandingIdea}
                        onClick={() =>
                          void handleLearnAndCreateScript({
                            selectedIdea: item,
                            preserveExactIdea: true,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs shadow-sm shadow-violet-600/20 transition cursor-pointer whitespace-nowrap"
                      >
                        {isThisGenerating ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              {scriptMode === 'independent_batch'
                                ? `Đang tạo prompt kịch bản (${targetDurationSec}s · ${learningElapsedSec}s)...`
                                : `Đang tạo prompt kịch bản (${unifiedUnitCount} cảnh × ${targetDurationSec}s · ${learningElapsedSec}s)...`}
                            </span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Tạo prompt kịch bản</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ================================================================= */}
      {/* COMPACT TOP STUDIO HEADER: MODE PILL + PROJECT VAULT + 3-STEPPER  */}
      {/* ================================================================= */}
      <div className="glass-card rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Mode Segmented Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
              Studio AI
            </h1>
            <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStudioMode('derivative');
                  setLearnError('');
                  setLearnSuccess('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
                  studioMode === 'derivative'
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Phái sinh từ video</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudioMode('creative');
                  setLearnError('');
                  setLearnSuccess('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
                  studioMode === 'creative'
                    ? 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Clapperboard className="w-3.5 h-3.5" />
                <span>Sáng tạo từ ý tưởng</span>
              </button>
            </div>
          </div>

          {/* Right: Compact Project Vault + AI Settings */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl px-2 py-1">
              <FolderOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300 shrink-0" />
              {projectProfiles.length > 0 && (
                <select
                  value={activeProjectId}
                  onChange={(e) => handleLoadProjectProfile(e.target.value)}
                  aria-label="Chọn dự án đồng bộ đã lưu"
                  className="h-7 px-1.5 text-xs bg-transparent text-slate-800 dark:text-white max-w-[150px] focus:outline-none cursor-pointer"
                >
                  <option value="">-- Nạp dự án ({projectProfiles.length}) --</option>
                  {projectProfiles.map((p) => (
                    <option key={p.id} value={p.id} className="bg-white dark:bg-[#131a35]">
                      {p.name} ({p.characterRefs.length})
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={projectNameInput}
                onChange={(e) => setProjectNameInput(e.target.value)}
                placeholder="Tên dự án..."
                className="h-7 px-2 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white w-28 sm:w-36 focus:border-cyan-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={isSavingProject}
                onClick={() => void handleSaveProjectProfile()}
                title="Lưu hồ sơ dự án dùng chung"
                className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 rounded-lg transition whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {isSavingProject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                <span>{activeProjectId ? 'Cập nhật' : 'Lưu'}</span>
              </button>
              {activeProjectId && (
                <button
                  type="button"
                  onClick={() => void handleDeleteProjectProfile(activeProjectId)}
                  title="Xóa dự án đang chọn"
                  className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200/70 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 font-medium transition cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Cấu hình AI</span>
            </button>
          </div>
        </div>

        {projectStatusMsg && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-300 font-medium">{projectStatusMsg}</p>
        )}

        {/* True 3-Step Workspace Stepper */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-200/80 dark:border-slate-400/15 text-xs">
          <button
            type="button"
            onClick={() => setActiveStudioStep(1)}
            className={`text-left rounded-xl px-3.5 py-2.5 border transition cursor-pointer flex items-center justify-between gap-2 ${
              activeStudioStep === 1
                ? 'bg-violet-500/15 border-violet-400/50 text-slate-900 dark:text-white shadow-sm'
                : 'bg-slate-50/80 dark:bg-[#0c1021]/70 border-slate-200 dark:border-slate-400/15 text-slate-600 dark:text-slate-300 hover:border-violet-400/35'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  activeStudioStep === 1
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                }`}
              >
                1
              </span>
              <span className="font-bold truncate">Nguồn &amp; Thiết lập</span>
            </div>
            <span className="text-[11px] font-medium text-violet-600 dark:text-violet-300 shrink-0">
              {studioMode === 'derivative'
                ? expandedIdeas.length > 0
                  ? `${sources.length} nguồn · ${expandedIdeas.length} ý tưởng`
                  : `${sources.length} nguồn`
                : expandedIdeas.length > 0 || expandedIdeaPrompt.trim()
                ? 'Đã triển khai AI'
                : ideaPrompt.trim()
                ? 'Đã có ý tưởng'
                : 'Chưa nhập'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStudioStep(2)}
            className={`text-left rounded-xl px-3.5 py-2.5 border transition cursor-pointer flex items-center justify-between gap-2 ${
              activeStudioStep === 2
                ? 'bg-cyan-500/15 border-cyan-400/50 text-slate-900 dark:text-white shadow-sm'
                : 'bg-slate-50/80 dark:bg-[#0c1021]/70 border-slate-200 dark:border-slate-400/15 text-slate-600 dark:text-slate-300 hover:border-cyan-400/35'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  activeStudioStep === 2
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                }`}
              >
                2
              </span>
              <span className="font-bold truncate">Kịch bản &amp; Phân cảnh</span>
            </div>
            <span className="text-[11px] font-medium text-cyan-600 dark:text-cyan-300 shrink-0">
              {blueprint ? `${blueprint.scenes.length} cảnh` : 'Chưa tạo'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStudioStep(3)}
            className={`text-left rounded-xl px-3.5 py-2.5 border transition cursor-pointer flex items-center justify-between gap-2 ${
              activeStudioStep === 3
                ? 'bg-emerald-500/15 border-emerald-400/50 text-slate-900 dark:text-white shadow-sm'
                : 'bg-slate-50/80 dark:bg-[#0c1021]/70 border-slate-200 dark:border-slate-400/15 text-slate-600 dark:text-slate-300 hover:border-emerald-400/35'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  activeStudioStep === 3
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                }`}
              >
                3
              </span>
              <span className="font-bold truncate">Dựng Lô &amp; Xuất MP4</span>
            </div>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300 shrink-0">
              {job?.status === 'completed'
                ? 'Đã xong'
                : job
                ? `${job.progress}%`
                : blueprint
                ? 'Sẵn sàng'
                : 'Chờ bước 2'}
            </span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BƯỚC 1: NGUỒN NỘI DUNG, NHÂN VẬT & CẤU HÌNH AI / MEDIA / ÂM THANH */}
      {/* ================================================================= */}
      <section className={activeStudioStep === 1 ? 'space-y-4' : 'hidden'}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT COLUMN (6 cols): Input Source/Idea + Character Lock */}
          <div className="lg:col-span-6 space-y-4">
            {/* Box A: Content Input */}
            {studioMode === 'creative' ? (
              <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Ý tưởng &amp; Bối cảnh sáng tạo
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Mô tả cốt truyện, chủ đề hoặc thông điệp — AI tự biên soạn kịch bản và prompt phân cảnh.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Tóm tắt ý tưởng ban đầu
                    </span>
                    {ideaPrompt.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          setIdeaPrompt('');
                          setExpandIdeaError('');
                        }}
                        className="text-[11px] text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        Xóa nháp
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={3}
                    value={ideaPrompt}
                    onChange={(e) => {
                      setIdeaPrompt(e.target.value);
                      if (expandIdeaError) setExpandIdeaError('');
                    }}
                    placeholder="Nhập tóm tắt ý tưởng đơn ban đầu (VD: Chàng trai lạnh lùng gặp lại cô gái cũ dưới mưa đêm bên chiếc siêu xe đen...)"
                    className="w-full p-3 text-xs sm:text-sm bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400 resize-y leading-relaxed"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {CREATIVE_IDEA_STARTERS.map((starter) => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => {
                        setIdeaPrompt(starter.idea);
                        setExpandedIdeas([]);
                        setExpandedIdeaPrompt('');
                        setEditingIdeaId(null);
                        setExpandIdeaError('');
                        setVideoStyle(starter.style);
                        const starterScenes = Math.max(1, Math.min(15, Math.round(starter.scenes || 3)));
                        const starterUnitSec = Math.max(10, Math.round((starter.dur || 30) / starterScenes));
                        setIdeaCount(starterScenes);
                        setTargetDurationSec(starterUnitSec);
                        setDesiredSceneCount('auto');
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-cyan-400/50 text-slate-700 dark:text-slate-200 rounded-lg transition cursor-pointer whitespace-nowrap"
                    >
                      {starter.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={settingBibleDraft}
                  onChange={(e) => setSettingBibleDraft(e.target.value)}
                  placeholder="Bối cảnh chủ đạo mong muốn (tùy chọn — VD: Thành phố mưa đêm neon)..."
                  className={inputCls}
                />

                {/* Moved from Thiết lập AI & Sản xuất: Chế độ sản xuất video, Kiểu tạo lô video, Thời lượng video */}
                {productionAndBatchControls}

                {/* Shared AI Idea Expansion + Per-Idea Direct Script Prompt */}
                {ideaExpansionAndListBlock}
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Nguồn video tham chiếu ({sources.length}/8)
                  </h2>

                  {/* Unified 3 Mini-Tabs inside Source Card */}
                  <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSourceInputTab('list')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                        sourceInputTab === 'list'
                          ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Đã chọn ({sources.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSourceInputTab('library');
                        void fetchLibraryVideos();
                      }}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                        sourceInputTab === 'library'
                          ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Thư viện
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceInputTab('search')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                        sourceInputTab === 'search'
                          ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Tìm nhanh
                    </button>
                  </div>
                </div>

                {/* Source Mini-Tab 1: Selected Videos + Upload */}
                {sourceInputTab === 'list' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Tải video từ máy, chọn từ Thư viện hoặc Tìm nhanh để AI học kịch bản.
                      </span>
                      <input
                        ref={videoUploadInputRef}
                        type="file"
                        multiple
                        accept="video/*"
                        onChange={handleUploadVideos}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isUploadingVideos || sources.length >= 8}
                        onClick={() => videoUploadInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-700 dark:text-cyan-200 text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        {isUploadingVideos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        <span>{isUploadingVideos ? uploadProgressText || 'Đang tải...' : 'Tải video từ máy'}</span>
                      </button>
                    </div>

                    {uploadError && (
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{uploadError}</span>
                      </div>
                    )}

                    {sources.length === 0 ? (
                      <div className="border border-dashed border-slate-300 dark:border-slate-400/25 rounded-xl p-5 text-center space-y-1.5 bg-slate-50/50 dark:bg-[#0c1021]/40">
                        <Film className="w-5 h-5 text-slate-400 dark:text-slate-500 mx-auto" />
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Chưa có video nguồn. Bấm <strong>Tải video từ máy</strong> hoặc chuyển tab <strong>Thư viện</strong> / <strong>Tìm nhanh</strong>.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {sources.map((src, idx) => {
                          const thumb = src.keyframes?.[0] || (src.pic ? getDiscoveryThumbUrl(src.pic) : '');
                          return (
                            <div
                              key={src.id}
                              className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20"
                            >
                              <span className="text-xs font-mono font-bold tabular-nums text-violet-600 dark:text-violet-300 w-5 text-center shrink-0">
                                #{idx + 1}
                              </span>
                              <div className="w-14 h-9 rounded-lg bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0">
                                {thumb && (
                                  <img src={thumb} alt={src.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {src.translatedTitle || src.title}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                                  {src.localAssetId ? 'Video tải lên' : src.platformLabel} · {src.duration > 0 ? formatDuration(src.duration) : '--:--'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveSource(src.id)}
                                title="Xóa video nguồn này"
                                className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Source Mini-Tab 2: Project Library */}
                {sourceInputTab === 'library' && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Video đã tải lên &amp; đã xuất MP4 trong dự án
                      </span>
                      <button
                        type="button"
                        onClick={() => void fetchLibraryVideos()}
                        className="text-[11px] text-cyan-600 dark:text-cyan-300 hover:underline cursor-pointer"
                      >
                        Làm mới
                      </button>
                    </div>
                    {isLoadingLibrary ? (
                      <div className="flex items-center gap-2 text-xs text-slate-500 py-4 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang tải thư viện...</span>
                      </div>
                    ) : libraryItems.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                        Chưa có video nào trong thư viện dự án.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                        {libraryItems.map((item) => {
                          const alreadyAdded =
                            Boolean(item.localAssetId && sources.some((s) => s.localAssetId === item.localAssetId)) ||
                            sources.some((s) => s.title === item.title);
                          const busyImport = Boolean(item.jobId && importingJobId === item.jobId);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50 dark:bg-[#0c1021]"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-semibold text-slate-900 dark:text-white truncate">
                                  {item.title}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                                  {item.kind === 'rendered' ? 'Đã dựng MP4' : 'Đã tải'} · {Math.round(item.durationSec)}s
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={alreadyAdded || busyImport || sources.length >= 8}
                                onClick={() => void handlePickLibraryVideo(item)}
                                className="px-2.5 py-1 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                {busyImport ? 'Nạp...' : alreadyAdded ? 'Đã chọn' : '+ Chọn'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Source Mini-Tab 3: Quick Online Search */}
                {sourceInputTab === 'search' && (
                  <div className="space-y-2.5">
                    <form onSubmit={handleSearchSources} className="flex flex-wrap sm:flex-nowrap gap-2">
                      <select
                        value={searchPlatform}
                        onChange={(e) => setSearchPlatform(e.target.value as TrendingPlatformId)}
                        aria-label="Nền tảng tìm kiếm"
                        className="h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="all">Tất cả nguồn</option>
                        <option value="youtube">YouTube</option>
                        <option value="tiktok">TikTok</option>
                        <option value="douyin">Douyin</option>
                        <option value="bilibili">Bilibili</option>
                        <option value="dailymotion">Dailymotion</option>
                      </select>
                      <input
                        type="text"
                        value={searchQueryInput}
                        onChange={(e) => setSearchQueryInput(e.target.value)}
                        placeholder="Từ khóa tìm video làm nguồn tham chiếu..."
                        className="flex-1 min-w-[140px] h-9 px-3 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                      />
                      <button
                        type="submit"
                        disabled={isSearchingSources}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-violet-700 dark:text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/35 rounded-xl transition whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {isSearchingSources ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        <span>Tìm</span>
                      </button>
                    </form>

                    {searchError && <p className="text-xs text-rose-600 dark:text-rose-400">{searchError}</p>}

                    {searchResults.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                        {searchResults.map((vid) => {
                          const alreadyAdded = sources.some((s) => s.id === vid.id || s.sourceUrl === vid.sourceUrl);
                          return (
                            <div
                              key={vid.id}
                              className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50/70 dark:bg-[#0c1021]/90"
                            >
                              <img
                                src={getDiscoveryThumbUrl(vid.pic)}
                                alt={vid.title}
                                referrerPolicy="no-referrer"
                                className="w-11 h-8 object-cover rounded-lg shrink-0 bg-slate-200 dark:bg-slate-800"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-slate-900 dark:text-white truncate">
                                  {vid.translatedTitle || vid.title}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
                                  {vid.platformLabel} · {formatDuration(vid.duration)}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={alreadyAdded || sources.length >= 8}
                                onClick={() => handleAddSearchVideo(vid)}
                                className="px-2 py-1 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 rounded-lg transition whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                {alreadyAdded ? 'Đã có' : '+ Thêm'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* AI Watch Reference Videos -> Detailed Scene & Plot Prompt -> Tóm tắt ý tưởng ban đầu */}
                <div className="pt-2 border-t border-slate-200/80 dark:border-slate-400/15 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-violet-500/10 dark:bg-violet-500/15 border border-violet-400/35">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        AI xem video tham chiếu &amp; viết prompt mô tả chi tiết
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        AI xem hình ảnh, bối cảnh và tình tiết xuất hiện trong video tham chiếu rồi tự động điền vào <strong>Tóm tắt ý tưởng ban đầu</strong> để triển khai ý tưởng phái sinh.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={sources.length === 0 || isWatchingReferenceVideo || isExpandingIdea || isLearning}
                      onClick={() => void handleWatchReferenceVideosToIdeaPrompt()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs shadow-md shadow-violet-600/20 transition cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isWatchingReferenceVideo ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>AI đang xem {sources.length} video...</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>AI xem video &amp; viết prompt mô tả chi tiết</span>
                        </>
                      )}
                    </button>
                  </div>

                  {watchVideoError && (
                    <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{watchVideoError}</span>
                    </div>
                  )}

                  {watchVideoSuccess && (
                    <div className="flex items-start justify-between gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{watchVideoSuccess}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWatchVideoSuccess('')}
                        className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {watchedSceneHighlights.length > 0 && (
                    <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/85 border border-slate-200 dark:border-slate-400/20 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          Diễn biến &amp; bối cảnh AI đã xem được ({watchedSceneHighlights.length} mốc)
                        </span>
                        <button
                          type="button"
                          onClick={() => setWatchedSceneHighlights([])}
                          className="text-[10px] text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          Ẩn
                        </button>
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-4">
                        {watchedSceneHighlights.map((hl, i) => (
                          <li key={i}>{hl}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Tóm tắt ý tưởng ban đầu
                      </span>
                      {ideaPrompt.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setIdeaPrompt('');
                            setWatchedSceneHighlights([]);
                            setWatchVideoSuccess('');
                            setExpandIdeaError('');
                          }}
                          className="text-[11px] text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          Xóa nháp
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={4}
                      value={ideaPrompt}
                      onChange={(e) => {
                        setIdeaPrompt(e.target.value);
                        if (expandIdeaError) setExpandIdeaError('');
                      }}
                      placeholder='Bấm "AI xem video & viết prompt mô tả chi tiết" ở trên để AI tự động điền bối cảnh và tình tiết từ video tham chiếu, hoặc tự nhập tóm tắt ý tưởng tại đây...'
                      className="w-full p-3 text-xs sm:text-sm bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400 resize-y leading-relaxed"
                    />
                  </div>

                  <input
                    type="text"
                    value={settingBibleDraft}
                    onChange={(e) => setSettingBibleDraft(e.target.value)}
                    placeholder="Bối cảnh chủ đạo mong muốn (tự điền sau khi AI xem video hoặc tự nhập)..."
                    className={inputCls}
                  />
                </div>

                {/* Chế độ sản xuất video, Kiểu tạo lô video, Thời lượng video */}
                {productionAndBatchControls}

                {/* Shared AI Idea Expansion + Per-Idea Direct Script Prompt (same workflow as Sáng tạo từ ý tưởng) */}
                {ideaExpansionAndListBlock}
              </div>
            )}

            {/* Box B: Character Synchronization (Name + Custom Voice + Up to 8 Characters) */}
            <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
              {/* Box B header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <UserCheck className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                  <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Nhân vật đồng bộ ({characters.length}/8)
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md">
                    <Lock className="w-3 h-3" />
                    <span>{NORTHERN_VN_ACCENT_BADGE}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                    Engine: <strong className="text-cyan-600 dark:text-cyan-300">{imageEngineMode === 'muse2api' ? 'Muse2API' : imageEngineMode === 'qwen' ? 'AI Qwen' : imageEngineMode === 'gemini_pro' ? 'Nano Pro' : 'Gemini'}</strong>
                  </span>
                  <input
                    ref={charUploadInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleUploadCharacters}
                    className="hidden"
                  />
                  <input
                    ref={charReplaceInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleReplaceCharacterImageFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCharacterLibrary((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-xl transition whitespace-nowrap cursor-pointer ${
                      showCharacterLibrary
                        ? 'text-violet-700 dark:text-violet-200 bg-violet-500/15 border-violet-500/40'
                        : 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10'
                    }`}
                  >
                    <Library className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
                    <span>Thư viện ({characterLibrary.length})</span>
                  </button>
                  <button
                    type="button"
                    disabled={characters.length >= 8}
                    onClick={() => charUploadInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 rounded-xl transition whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Tải ảnh mẫu</span>
                  </button>
                </div>
              </div>

              {/* Quick-pick strip when library has saved characters and current session has none selected yet */}
              {!showCharacterLibrary && characterLibrary.length > 0 && characters.length === 0 && (
                <div className="p-2.5 rounded-xl bg-violet-500/5 dark:bg-violet-500/10 border border-violet-500/20 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1.5">
                      <Library className="w-3.5 h-3.5" />
                      <span>Chọn nhanh nhân vật đã lưu ({characterLibrary.length})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCharacterLibrary(true)}
                      className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer"
                    >
                      Quản lý thư viện
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {characterLibrary.slice(0, 8).map((saved) => (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => handleToggleLibraryCharacter(saved)}
                        title={saved.description ? `${saved.name} — ${saved.description}` : saved.name}
                        className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 hover:border-violet-400 text-[11px] font-semibold text-slate-800 dark:text-slate-100 transition cursor-pointer"
                      >
                        <img
                          src={saved.dataUrl}
                          alt={saved.name}
                          className="w-6 h-6 rounded object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
                        />
                        <span className="max-w-[120px] truncate">{saved.name}</span>
                        <Plus className="w-3 h-3 text-violet-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Persistent Character Library Drawer */}
              {showCharacterLibrary && (
                <div className="p-3 rounded-xl bg-slate-50/95 dark:bg-[#0b1024]/95 border border-violet-500/30 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Library className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Thư viện nhân vật đã lưu ({characterLibrary.length})
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                        · Tự động lưu khi tải ảnh lên, dùng lại mọi phiên
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {characters.some((c) => !c.libraryId || !characterLibrary.some((l) => l.id === c.libraryId)) && (
                        <button
                          type="button"
                          onClick={async () => {
                            let count = 0;
                            for (const c of characters) {
                              if (!c.libraryId || !characterLibrary.some((l) => l.id === c.libraryId)) {
                                const res = await persistCharacterToLibrary(c, { silent: true });
                                if (res) count += 1;
                              }
                            }
                            if (count > 0) {
                              setCharLibraryStatus(`Đã lưu ${count} nhân vật đang dùng vào Thư viện vĩnh viễn.`);
                            }
                          }}
                          className="h-7 px-2.5 text-[11px] font-bold bg-violet-600 text-white hover:brightness-110 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Lưu nhân vật hiện tại vào thư viện
                        </button>
                      )}
                      {characterLibrary.length > 3 && (
                        <input
                          type="text"
                          value={charLibraryQuery}
                          onChange={(e) => setCharLibraryQuery(e.target.value)}
                          placeholder="Tìm tên / mô tả..."
                          className="h-7 w-36 sm:w-44 px-2 text-[11px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:border-violet-400"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setShowCharacterLibrary(false)}
                        aria-label="Đóng thư viện nhân vật"
                        className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {characterLibrary.length === 0 ? (
                    <div className="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                      Chưa có nhân vật nào trong thư viện. Khi bạn bấm <strong>Tải ảnh mẫu</strong> hoặc{' '}
                      <strong>AI vẽ</strong>, tên, ảnh và mô tả nhân vật sẽ tự động được lưu vĩnh viễn (cả máy chủ &amp; trình duyệt) để tắt đi bật lại vẫn còn nguyên.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                      {characterLibrary
                        .filter((item) => {
                          const q = charLibraryQuery.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            item.name.toLowerCase().includes(q) ||
                            String(item.description || '').toLowerCase().includes(q)
                          );
                        })
                        .map((saved) => {
                          const isSelectedInSession = characters.some(
                            (c) => c.libraryId === saved.id || c.id === saved.id || c.id === `char_${saved.id}`
                          );
                          const isEditing = editingLibCharId === saved.id;
                          const isConfirmingDelete = confirmDeleteLibCharId === saved.id;
                          const hasFivePart = Boolean(
                            saved.syncProfile &&
                              (saved.syncProfile.face || saved.syncProfile.costume || saved.syncProfile.physique)
                          );
                          return (
                            <div
                              key={saved.id}
                              className={`flex gap-2.5 p-2 rounded-xl border transition ${
                                isSelectedInSession
                                  ? 'border-emerald-500/60 bg-emerald-500/5 dark:bg-emerald-500/10'
                                  : 'border-slate-200 dark:border-slate-400/20 bg-white dark:bg-[#111830]'
                              }`}
                            >
                              <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 group">
                                <img src={saved.dataUrl} alt={saved.name} className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  onClick={() => handleTriggerReplaceCharacterImage('library', saved.id)}
                                  title="Thay ảnh nhân vật này"
                                  className="absolute inset-x-0 bottom-0 py-0.5 flex items-center justify-center gap-0.5 bg-black/70 hover:bg-violet-600/90 text-white text-[9px] font-semibold transition cursor-pointer"
                                >
                                  <Camera className="w-2.5 h-2.5" />
                                  <span>Đổi ảnh</span>
                                </button>
                              </div>

                              <div className="min-w-0 flex-1 flex flex-col justify-between gap-1.5 text-[11px]">
                                {isEditing ? (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      value={editingLibName}
                                      onChange={(e) => setEditingLibName(e.target.value)}
                                      placeholder="Tên nhân vật..."
                                      className="w-full h-6 px-1.5 text-[11px] font-semibold bg-white dark:bg-[#0c1228] border border-violet-400/50 rounded-md text-slate-900 dark:text-white focus:outline-none"
                                    />
                                    <input
                                      type="text"
                                      value={editingLibDesc}
                                      onChange={(e) => setEditingLibDesc(e.target.value)}
                                      placeholder="Mô tả ngoại hình / trang phục..."
                                      className="w-full h-6 px-1.5 text-[10px] bg-white dark:bg-[#0c1228] border border-slate-300 dark:border-slate-500/30 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none"
                                    />
                                    <div className="flex items-center gap-1 pt-0.5">
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveLibraryCharacterEdit(saved)}
                                        className="px-2 py-0.5 text-[10px] font-bold bg-violet-600 text-white rounded-md cursor-pointer"
                                      >
                                        Lưu
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingLibCharId('')}
                                        className="px-2 py-0.5 text-[10px] font-medium bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 rounded-md cursor-pointer"
                                      >
                                        Hủy
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold text-slate-900 dark:text-white truncate">
                                          {saved.name}
                                        </span>
                                        {hasFivePart && (
                                          <span className="px-1 py-0.5 text-[9px] font-semibold bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 rounded shrink-0">
                                            5 phần
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                                        {saved.description || 'Chưa có mô tả chi tiết.'}
                                      </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleLibraryCharacter(saved)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border transition cursor-pointer ${
                                          isSelectedInSession
                                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                                            : 'bg-violet-600 text-white border-violet-600 hover:brightness-110'
                                        }`}
                                      >
                                        {isSelectedInSession ? (
                                          <>
                                            <CheckCircle2 className="w-3 h-3" />
                                            <span>Đang dùng</span>
                                          </>
                                        ) : (
                                          <>
                                            <Plus className="w-3 h-3" />
                                            <span>Chọn dùng</span>
                                          </>
                                        )}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => handleTriggerReplaceCharacterImage('library', saved.id)}
                                        title="Thay ảnh nhân vật"
                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-white/5 hover:bg-slate-200/80 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 rounded-md cursor-pointer"
                                      >
                                        <Camera className="w-3 h-3" />
                                        <span>Thay ảnh</span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => handleStartEditLibraryCharacter(saved)}
                                        title="Sửa tên & mô tả nhân vật"
                                        className="p-1 text-slate-500 hover:text-violet-600 dark:hover:text-violet-300 cursor-pointer"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>

                                      {isConfirmingDelete ? (
                                        <div className="inline-flex items-center gap-1 ml-auto">
                                          <button
                                            type="button"
                                            onClick={() => void handleDeleteLibraryCharacter(saved.id)}
                                            className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-600 text-white rounded-md cursor-pointer"
                                          >
                                            Xác nhận xóa
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setConfirmDeleteLibCharId('')}
                                            className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 rounded-md cursor-pointer"
                                          >
                                            Hủy
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmDeleteLibCharId(saved.id);
                                            setEditingLibCharId('');
                                          }}
                                          title="Xóa nhân vật khỏi thư viện"
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-md cursor-pointer ml-auto"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          <span>Xóa</span>
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                <input
                  type="text"
                  value={charNameInput}
                  onChange={(e) => setCharNameInput(e.target.value)}
                  placeholder="Tên nhân vật..."
                  className={`sm:col-span-4 ${inputCls}`}
                />
                <input
                  type="text"
                  value={charPromptInput}
                  onChange={(e) => setCharPromptInput(e.target.value)}
                  placeholder="Mô tả ngoại hình để AI vẽ mẫu..."
                  className={`sm:col-span-5 ${inputCls}`}
                />
                <button
                  type="button"
                  disabled={isGeneratingChar || characters.length >= 8}
                  onClick={() => void handleGenerateCharacterAi()}
                  className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 rounded-xl transition disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {isGeneratingChar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  <span>AI vẽ</span>
                </button>
              </div>

              {/* Pre-assign Age Group & Gemini Voice Reference Library (Locked Northern Vietnamese Accent) */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                <select
                  value={charAgeGroupInput}
                  onChange={(e) => {
                    const nextAge = e.target.value as CharacterAgeGroup;
                    setCharAgeGroupInput(nextAge);
                    const meta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === nextAge);
                    if (meta && nextAge !== 'auto') {
                      setCharVoiceIdInput(meta.defaultVoiceId);
                    }
                  }}
                  aria-label="Nhóm tuổi giọng nói nhân vật"
                  className={`sm:col-span-4 ${inputCls}`}
                >
                  {CHARACTER_AGE_GROUP_OPTIONS.map((ag) => (
                    <option key={ag.value} value={ag.value}>
                      {ag.value === 'auto' ? 'Tuổi giọng: AI tự phân tích' : `${ag.label} · ${ag.timbreSummary}`}
                    </option>
                  ))}
                </select>
                <select
                  value={charVoiceModeInput}
                  onChange={(e) =>
                    setCharVoiceModeInput(e.target.value as 'default' | 'ai_online' | 'offline_system')
                  }
                  aria-label="Chế độ giọng nhân vật mới"
                  className={`sm:col-span-4 ${inputCls}`}
                >
                  <option value="default">AI tự chọn theo tuổi &amp; giới tính (Bắc VN)</option>
                  <option value="ai_online">Khóa giọng Gemini cụ thể (Miền Bắc VN)</option>
                  {offlineVoices.length > 0 && (
                    <option value="offline_system">Giọng VieNeu Offline</option>
                  )}
                </select>
                {charVoiceModeInput === 'ai_online' && (
                  <div className="sm:col-span-4 flex items-center gap-1.5">
                    <select
                      value={charVoiceIdInput}
                      onChange={(e) =>
                        setCharVoiceIdInput(e.target.value as Exclude<DerivativeVoiceId, 'none'>)
                      }
                      aria-label="Chọn giọng tham chiếu Gemini cho nhân vật mới"
                      className={`flex-1 min-w-0 ${inputCls}`}
                    >
                      {GEMINI_VOICE_LIBRARY.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label} · {v.timbre}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={previewingSceneId === 'char_new_preview'}
                      onClick={() =>
                        void handleSpeakOfflineBrowserPreview(
                          `Xin chào, tôi là ${charNameInput.trim() || 'nhân vật mới'}, giọng đọc chuẩn Hà Nội miền Bắc Việt Nam.`,
                          'char_new_preview',
                          'ai_online',
                          undefined,
                          charVoiceIdInput,
                          charNameInput.trim()
                        )
                      }
                      title="Nghe thử giọng tham chiếu Gemini (miền Bắc VN)"
                      className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-xl cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {previewingSceneId === 'char_new_preview' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                      <span>{previewingSceneId === 'char_new_preview' ? '...' : 'Thử'}</span>
                    </button>
                  </div>
                )}
                {charVoiceModeInput === 'offline_system' && (
                  <select
                    value={charOfflineVoiceInput || offlineVoice || offlineVoices[0]?.id || ''}
                    onChange={(e) => setCharOfflineVoiceInput(e.target.value)}
                    aria-label="Chọn giọng VieNeu cho nhân vật mới"
                    className={`sm:col-span-4 ${inputCls}`}
                  >
                    {offlineVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.description || v.id}
                      </option>
                    ))}
                  </select>
                )}
                {charVoiceModeInput === 'default' && (
                  <div className="sm:col-span-4 h-9 px-2.5 flex items-center text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl truncate">
                    Tự động chọn cao độ khớp tuổi
                  </div>
                )}
              </div>

              {charError && (
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-200">
                  {charError}
                </div>
              )}

              {charLibraryStatus && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-700 dark:text-emerald-300">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{charLibraryStatus}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCharLibraryStatus('')}
                    aria-label="Ẩn thông báo"
                    className="p-0.5 text-emerald-600/70 hover:text-emerald-700 dark:hover:text-emerald-200 cursor-pointer shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {characters.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {characters.map((ch, idx) => {
                    const isActiveChar = selectedChar?.id === ch.id;
                    const isSavedInLib = Boolean(
                      ch.libraryId && characterLibrary.some((item) => item.id === ch.libraryId)
                    );
                    return (
                    <div
                      key={ch.id}
                      onClick={() => setSelectedCharacterId(ch.id)}
                      className={`flex gap-2.5 p-2 rounded-xl border transition cursor-pointer ${
                        isActiveChar
                          ? 'border-violet-500/70 ring-1 ring-violet-400/35 bg-violet-500/5 dark:bg-violet-500/10'
                          : 'border-slate-200 dark:border-slate-400/20 bg-slate-50/90 dark:bg-[#0c1021]/90 hover:border-violet-400/40'
                      }`}
                    >
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0">
                        <img src={ch.dataUrl} alt={ch.name} className="w-full h-full object-cover" />
                        <span className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[9px] font-mono font-bold bg-black/70 text-white rounded">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTriggerReplaceCharacterImage('active', ch.id);
                          }}
                          title="Thay ảnh nhân vật này"
                          className="absolute inset-x-0 bottom-0 py-0.5 flex items-center justify-center gap-0.5 bg-black/70 hover:bg-violet-600/90 text-white text-[9px] font-semibold transition cursor-pointer"
                        >
                          <Camera className="w-2.5 h-2.5" />
                          <span>Đổi ảnh</span>
                        </button>
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5 text-[11px]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={ch.name}
                            onChange={(e) => updateCharacterRef(ch.id, { name: e.target.value })}
                            placeholder={`Tên nhân vật #${idx + 1}...`}
                            aria-label="Tên nhân vật"
                            className="flex-1 min-w-0 h-7 px-2 text-xs font-semibold bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                          />
                          <button
                            type="button"
                            disabled={savingLibraryCharId === ch.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void persistCharacterToLibrary(ch);
                            }}
                            title={
                              isSavedInLib
                                ? 'Đã lưu trong Thư viện nhân vật (bấm để đồng bộ ngay)'
                                : 'Lưu nhân vật này vào Thư viện app'
                            }
                            className={`p-1 rounded-md cursor-pointer shrink-0 transition ${
                              isSavedInLib
                                ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                                : 'text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 hover:bg-violet-500/10'
                            }`}
                          >
                            {savingLibraryCharId === ch.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isSavedInLib ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCharacters((prev) => {
                                const next = prev.filter((item) => item.id !== ch.id);
                                if (selectedCharacterId === ch.id) {
                                  setSelectedCharacterId(next[0]?.id || '');
                                }
                                return next;
                              });
                            }}
                            aria-label="Bỏ nhân vật khỏi phiên này"
                            title="Bỏ nhân vật khỏi phiên này (vẫn giữ trong Thư viện)"
                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <select
                            value={ch.ageGroup || 'auto'}
                            onChange={(e) => {
                              const nextAge = e.target.value as CharacterAgeGroup;
                              const meta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === nextAge);
                              updateCharacterRef(ch.id, {
                                ageGroup: nextAge,
                                ...(meta && nextAge !== 'auto' && (!ch.voiceMode || ch.voiceMode === 'default')
                                  ? { voiceId: meta.defaultVoiceId, voiceStyle: meta.pitchDirective }
                                  : {}),
                              });
                            }}
                            aria-label="Nhóm tuổi giọng của nhân vật"
                            className="h-6 px-1 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-violet-700 dark:text-violet-300 font-medium focus:outline-none max-w-[104px]"
                          >
                            {CHARACTER_AGE_GROUP_OPTIONS.map((ag) => (
                              <option key={ag.value} value={ag.value}>
                                {ag.value === 'auto' ? 'Tuổi: AI tự xét' : ag.label}
                              </option>
                            ))}
                          </select>

                          <select
                            value={ch.voiceMode || 'default'}
                            onChange={(e) => {
                              const nextMode = e.target.value as 'default' | 'ai_online' | 'offline_system';
                              const fallbackVid = ch.voiceId || charVoiceIdInput || 'Kore';
                              const meta = GEMINI_VOICE_LIBRARY.find((v) => v.value === fallbackVid);
                              updateCharacterRef(ch.id, {
                                voiceMode: nextMode,
                                voiceId: nextMode === 'ai_online' ? fallbackVid : ch.voiceId,
                                voiceStyle: nextMode === 'ai_online' ? ch.voiceStyle || meta?.style : ch.voiceStyle,
                                offlineVoice:
                                  nextMode === 'offline_system'
                                    ? ch.offlineVoice || offlineVoice || offlineVoices[0]?.id
                                    : ch.offlineVoice,
                                accentLock: 'vn_north',
                              });
                            }}
                            aria-label="Loại giọng nhân vật"
                            className="h-6 px-1 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none"
                          >
                            <option value="default">AI theo tuổi</option>
                            <option value="ai_online">Gemini Voice</option>
                            {offlineVoices.length > 0 && <option value="offline_system">VieNeu</option>}
                          </select>

                          {ch.voiceMode === 'ai_online' && (
                            <select
                              value={ch.voiceId || 'Kore'}
                              onChange={(e) => {
                                const vid = e.target.value as Exclude<DerivativeVoiceId, 'none'>;
                                const meta = GEMINI_VOICE_LIBRARY.find((v) => v.value === vid);
                                updateCharacterRef(ch.id, {
                                  voiceId: vid,
                                  voiceStyle: meta?.style,
                                  accentLock: 'vn_north',
                                });
                              }}
                              aria-label="Thư viện giọng tham chiếu Gemini của nhân vật"
                              className="flex-1 min-w-0 h-6 px-1 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none"
                            >
                              {GEMINI_VOICE_LIBRARY.map((v) => (
                                <option key={v.value} value={v.value}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          )}

                          {ch.voiceMode === 'offline_system' && offlineVoices.length > 0 && (
                            <select
                              value={ch.offlineVoice || offlineVoice || offlineVoices[0]?.id || ''}
                              onChange={(e) =>
                                updateCharacterRef(ch.id, { offlineVoice: e.target.value, accentLock: 'vn_north' })
                              }
                              aria-label="Giọng VieNeu riêng của nhân vật"
                              className="flex-1 min-w-0 h-6 px-1.5 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none"
                            >
                              {offlineVoices.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.description || v.id}
                                </option>
                              ))}
                            </select>
                          )}

                          {(!ch.voiceMode || ch.voiceMode === 'default') && (
                            <span className="flex-1 min-w-0 h-6 px-1.5 flex items-center text-[10px] text-emerald-700 dark:text-emerald-300 truncate">
                              AI theo tuổi {ch.voiceId ? `(${ch.voiceId})` : ''}
                            </span>
                          )}

                          <span
                            title="Đã khóa cố định giọng đọc miền Bắc Việt Nam (Hà Nội)"
                            className="inline-flex items-center gap-0.5 px-1.5 h-6 text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 rounded-md whitespace-nowrap shrink-0"
                          >
                            <Lock className="w-2.5 h-2.5" />
                            <span>Bắc VN</span>
                          </span>

                          <button
                            type="button"
                            disabled={previewingSceneId === `char_${ch.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSpeakOfflineBrowserPreview(
                                `Xin chào, tôi là ${ch.name || 'nhân vật chính'}, nói giọng miền Bắc Việt Nam.`,
                                `char_${ch.id}`,
                                ch.voiceMode || 'ai_online',
                                ch.offlineVoice,
                                ch.voiceId || voice,
                                ch.name
                              );
                            }}
                            title="Nghe thử giọng Gemini miền Bắc VN của nhân vật này"
                            className="px-1.5 h-6 text-[10px] font-medium bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 rounded-md cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            {previewingSceneId === `char_${ch.id}` ? '...' : 'Thử'}
                          </button>
                        </div>

                        <input
                          type="text"
                          value={ch.description || ''}
                          onChange={(e) => updateCharacterRef(ch.id, { description: e.target.value })}
                          placeholder="Đặc điểm ngoại hình / trang phục (tuỳ chọn)..."
                          className="w-full h-6 px-1.5 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none"
                        />
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}

              {/* Collapsible Pre-generation 5-Bible Notes — Per-Character Independent Sync Profiles */}
              <div className="pt-1.5 border-t border-slate-200/80 dark:border-slate-400/15 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDraftBible((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer"
                  >
                    {showDraftBible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    <span>Khóa trước Hồ sơ đồng bộ 5 thành phần (tùy chọn)</span>
                  </button>

                  {characters.length > 0 && (
                    <button
                      type="button"
                      disabled={isAnalyzingCharacters}
                      onClick={() => void handleAnalyzeAllCharacters()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 rounded-lg transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      {isAnalyzingCharacters ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>
                        {isAnalyzingCharacters
                          ? `AI đang phân tích ${characters.length} nhân vật...`
                          : `AI tự phân tích tất cả nhân vật (${characters.length})`}
                      </span>
                    </button>
                  )}
                </div>

                {charAnalyzeError && (
                  <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-200">
                    {charAnalyzeError}
                  </div>
                )}

                {showDraftBible && (
                  <div className="space-y-2.5 pt-1 text-xs">
                    {characters.length > 0 && selectedChar ? (
                      <>
                        <div className="p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {characters.map((ch, idx) => {
                                const isSel = ch.id === selectedChar.id;
                                const hasProfile = Boolean(
                                  ch.syncProfile?.face ||
                                    ch.syncProfile?.physique ||
                                    ch.syncProfile?.costume
                                );
                                return (
                                  <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() => setSelectedCharacterId(ch.id)}
                                    className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg border transition cursor-pointer ${
                                      isSel
                                        ? 'bg-violet-600 text-white border-violet-500 font-semibold shadow-sm'
                                        : 'bg-white dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/50'
                                    }`}
                                  >
                                    <span className="font-mono text-[10px] opacity-80">#{idx + 1}</span>
                                    <span className="max-w-[110px] truncate">
                                      {ch.name || `Nhân vật ${idx + 1}`}
                                    </span>
                                    {hasProfile && (
                                      <CheckCircle2
                                        className={`w-3 h-3 shrink-0 ${
                                          isSel ? 'text-white' : 'text-emerald-500'
                                        }`}
                                      />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300">
                              Đang chọn: <strong>{selectedChar.name}</strong>
                            </span>
                          </div>

                          <div key={selectedChar.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <label className="space-y-0.5">
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                1. Gương mặt ({selectedChar.name})
                              </span>
                              <input
                                type="text"
                                value={selectedChar.syncProfile?.face ?? ''}
                                onChange={(e) =>
                                  updateSelectedCharacterSyncProfile(selectedChar.id, 'face', e.target.value)
                                }
                                placeholder="Kiểu tóc, màu mắt, đường nét khuôn mặt..."
                                className={inputCls}
                              />
                            </label>
                            <label className="space-y-0.5">
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                2. Vóc dáng ({selectedChar.name})
                              </span>
                              <input
                                type="text"
                                value={selectedChar.syncProfile?.physique ?? ''}
                                onChange={(e) =>
                                  updateSelectedCharacterSyncProfile(selectedChar.id, 'physique', e.target.value)
                                }
                                placeholder="Chiều cao, dáng người, phong thái..."
                                className={inputCls}
                              />
                            </label>
                            <label className="space-y-0.5">
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                3. Trang phục ({selectedChar.name})
                              </span>
                              <input
                                type="text"
                                value={selectedChar.syncProfile?.costume ?? ''}
                                onChange={(e) =>
                                  updateSelectedCharacterSyncProfile(selectedChar.id, 'costume', e.target.value)
                                }
                                placeholder="Quần áo, màu sắc chất liệu, giày dép..."
                                className={inputCls}
                              />
                            </label>
                            <label className="space-y-0.5">
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                4. Giọng nói ({selectedChar.name})
                              </span>
                              <input
                                type="text"
                                value={selectedChar.syncProfile?.voice ?? ''}
                                onChange={(e) =>
                                  updateSelectedCharacterSyncProfile(selectedChar.id, 'voice', e.target.value)
                                }
                                placeholder="Cao độ, âm sắc, giọng Bắc VN chuẩn Hà Nội..."
                                className={inputCls}
                              />
                            </label>
                            <label className="sm:col-span-2 space-y-0.5">
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                5. Đặc điểm nhận dạng riêng ({selectedChar.name})
                              </span>
                              <input
                                type="text"
                                value={selectedChar.syncProfile?.distinguishingMarks ?? ''}
                                onChange={(e) =>
                                  updateSelectedCharacterSyncProfile(
                                    selectedChar.id,
                                    'distinguishingMarks',
                                    e.target.value
                                  )
                                }
                                placeholder="Sẹo, kính, phụ kiện, nốt ruồi, dấu hiệu phân biệt với nhân vật khác..."
                                className={inputCls}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={settingBibleDraft}
                            onChange={(e) => setSettingBibleDraft(e.target.value)}
                            placeholder="Bối cảnh chung dự án..."
                            className={inputCls}
                          />
                          <input
                            type="text"
                            value={visualStyleBibleDraft}
                            onChange={(e) => setVisualStyleBibleDraft(e.target.value)}
                            placeholder="Bảng màu & ánh sáng..."
                            className={inputCls}
                          />
                          <input
                            type="text"
                            value={continuityBibleDraft}
                            onChange={(e) => setContinuityBibleDraft(e.target.value)}
                            placeholder="Mạch liên tục chung..."
                            className={inputCls}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={characterBibleDraft}
                          onChange={(e) => setCharacterBibleDraft(e.target.value)}
                          placeholder="1. Ngoại hình nhân vật cố định..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={costumeBibleDraft}
                          onChange={(e) => setCostumeBibleDraft(e.target.value)}
                          placeholder="2. Trang phục & phụ kiện..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={visualStyleBibleDraft}
                          onChange={(e) => setVisualStyleBibleDraft(e.target.value)}
                          placeholder="3. Bảng màu & chất liệu hình ảnh..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={continuityBibleDraft}
                          onChange={(e) => setContinuityBibleDraft(e.target.value)}
                          placeholder="4. Trục liên tục câu chuyện..."
                          className={inputCls}
                        />
                        {studioMode === 'derivative' && (
                          <input
                            type="text"
                            value={settingBibleDraft}
                            onChange={(e) => setSettingBibleDraft(e.target.value)}
                            placeholder="5. Bối cảnh & không gian cố định..."
                            className={`sm:col-span-2 ${inputCls}`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (6 cols): Unified 3-Tab Configuration Card */}
          <div className="lg:col-span-6 glass-card rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-400/15 pb-3">
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Thiết lập AI &amp; Sản xuất
              </h2>
              <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-xs">
                <button
                  type="button"
                  onClick={() => setConfigTab('script')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                    configTab === 'script'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  1. Kịch bản
                </button>
                <button
                  type="button"
                  onClick={() => setConfigTab('media')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                    configTab === 'media'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  2. Hình &amp; Clip
                </button>
                <button
                  type="button"
                  onClick={() => setConfigTab('audio')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                    configTab === 'audio'
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  3. Giọng &amp; Nhạc
                </button>
              </div>
            </div>

            {/* CONFIG TAB 1: SCRIPT & FRAME PARAMETERS */}
            {configTab === 'script' && (
              <div className="space-y-4 text-xs">
                {/* Core 6 Dropdowns in clean 2-col grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Hệ thống AI viết kịch bản</span>
                    <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value as AiProviderId)} className={inputCls}>
                      <option value="gemini">
                        Google Gemini {capabilities?.aiProviders.gemini.configured ? '(Sẵn sàng)' : '(Chưa đặt key)'}
                      </option>
                      <option value="muse2api">
                        Muse2API (muse-spark · {capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                      </option>
                      <option value="openai">
                        OpenAI ChatGPT {capabilities?.aiProviders.openai.configured ? '(Sẵn sàng)' : '(Chưa đặt key)'}
                      </option>
                      <option value="meta">
                        Meta AI Llama {capabilities?.aiProviders.meta.configured ? '(Sẵn sàng)' : '(Chưa đặt key)'}
                      </option>
                      <option value="xingchi">
                        Xingchi API ({capabilities?.aiProviders.xingchi?.model || 'api.xingchiapi.com'} ·{' '}
                        {capabilities?.aiProviders.xingchi?.configured ? 'Sẵn sàng' : 'Chưa đặt key'})
                      </option>
                      <option value="alibaba">
                        Alibaba Model Studio ({capabilities?.aiProviders.alibaba?.model || 'qwen-plus'} ·{' '}
                        {capabilities?.aiProviders.alibaba?.configured ? 'Sẵn sàng' : 'Chưa đặt key'})
                      </option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Ngôn ngữ đầu ra</span>
                    <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value as DerivativeOutputLanguage)} className={inputCls}>
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Phong cách hình ảnh</span>
                    <StudioStylePicker
                      value={videoStyle}
                      learnedStyles={learnedStyles}
                      customStylePrompt={customStylePrompt}
                      onChange={(nextStyle) => handleSelectVideoStyle(nextStyle, false)}
                      onOpenLearnModal={() => setIsLearnStyleModalOpen(true)}
                      onDeleteLearnedStyle={(id) => void handleDeleteLearnedStyle(id)}
                      triggerClassName={`${inputCls} flex items-center justify-between gap-2 text-left hover:border-violet-400/60 cursor-pointer`}
                      ariaLabel="Phong cách hình ảnh"
                    />
                  </div>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Tỷ lệ khung hình</span>
                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as DerivativeAspectRatio)} className={inputCls}>
                      <option value="9:16">9:16 Dọc (Shorts / TikTok)</option>
                      <option value="16:9">16:9 Ngang (YouTube / Web)</option>
                      <option value="1:1">1:1 Vuông (Social / Feed)</option>
                    </select>
                  </label>

                  {scriptMode === 'series' ? (
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Số phân cảnh Series (đồng bộ tự động)
                      </span>
                      <div className="h-9 px-3 flex items-center justify-between gap-2 text-xs bg-violet-500/10 border border-violet-400/35 rounded-xl text-violet-800 dark:text-violet-200 font-semibold">
                        <span className="truncate">
                          {unifiedUnitCount} phân cảnh × {targetDurationSec}s
                        </span>
                        <span className="text-[10px] font-mono shrink-0">
                          Tổng {unifiedTotalDurationSec}s
                        </span>
                      </div>
                    </div>
                  ) : (
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Số cảnh trong mỗi video ({targetDurationSec}s)
                      </span>
                      <select
                        value={String(desiredSceneCount)}
                        onChange={(e) => setDesiredSceneCount(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                        className={inputCls}
                      >
                        <option value="auto">Tự động khớp {targetDurationSec}s (Khuyên dùng)</option>
                        <option value="1">1 phân cảnh ({targetDurationSec}s)</option>
                        <option value="2">2 phân cảnh</option>
                        <option value="3">3 phân cảnh</option>
                        <option value="4">4 phân cảnh</option>
                        <option value="5">5 phân cảnh</option>
                        <option value="6">6 phân cảnh</option>
                        <option value="8">8 phân cảnh</option>
                        <option value="10">10 phân cảnh</option>
                        <option value="12">12 phân cảnh</option>
                      </select>
                    </label>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Kiểu dẫn chuyện</span>
                      <button
                        type="button"
                        onClick={() => setEnableNarrativeStyle((v) => !v)}
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded border cursor-pointer ${
                          enableNarrativeStyle
                            ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-400/40'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {enableNarrativeStyle ? 'BẬT' : 'TẮT'}
                      </button>
                    </div>
                    {enableNarrativeStyle ? (
                      <select
                        value={stylePreset === 'none' ? 'storytelling_review' : stylePreset}
                        onChange={(e) => setStylePreset(e.target.value as DerivativeStylePreset)}
                        aria-label="Kiểu dẫn chuyện"
                        className={inputCls}
                      >
                        {STYLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="h-9 px-2.5 flex items-center text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-[#0c1021]/60 border border-dashed border-slate-200 dark:border-slate-400/20 rounded-xl truncate">
                        AI tự do sáng tạo
                      </div>
                    )}
                  </div>
                </div>

                {/* Accessible BẬT / TẮT Lồng tiếng (Thuyết minh / Giọng dẫn) Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/80 border border-slate-200 dark:border-slate-400/20">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                      <Mic className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300 shrink-0" />
                      <span>Lồng tiếng (Thuyết minh / Giọng dẫn)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                      {voiceMode === 'none'
                        ? 'Đang TẮT thuyết minh dẫn chuyện (vẫn giữ lời thoại trực tiếp nhân vật lip-sync nếu có).'
                        : 'Đang BẬT thuyết minh dẫn chuyện tách biệt hoàn toàn với lời thoại nhân vật.'}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-400/20 overflow-hidden bg-white dark:bg-[#131a35] shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceover(true)}
                      className={`px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                        voiceMode !== 'none'
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      BẬT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceover(false)}
                      className={`px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                        voiceMode === 'none'
                          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      TẮT
                    </button>
                  </div>
                </div>

                {/* KHÓA CỨNG ĐỒNG NHẤT NHÂN VẬT THAM CHIẾU (TỰ ĐỘNG KÍCH HOẠT TẠI BƯỚC 2) */}
                {(() => {
                  const syncedCharCount = characters.filter(
                    (c) => Boolean(c.dataUrl || c.syncProfile?.face || c.syncProfile?.costume)
                  ).length;
                  return (
                    <div className="space-y-2 p-3 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/80 border border-slate-200 dark:border-slate-400/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
                            <Lock
                              className={`w-3.5 h-3.5 shrink-0 ${
                                allowFreeCostumeChange
                                  ? 'text-amber-600 dark:text-amber-300'
                                  : 'text-emerald-600 dark:text-emerald-300'
                              }`}
                            />
                            <span>KHÓA CỨNG NHÂN VẬT THAM CHIẾU · TRANG PHỤC CHÍNH</span>
                            {syncedCharCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono">
                                Đang khóa {syncedCharCount} nhân vật
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                            {allowFreeCostumeChange
                              ? 'Đang BẬT duyệt đổi trang phục theo diễn biến kịch bản — VẪN KHÓA CỨNG 100% khuôn mặt, kiểu tóc, màu da và vóc dáng.'
                              : 'Đang TẮT (Khóa cứng mặc định): Tự động khóa 100% khuôn mặt, kiểu tóc, màu da, vóc dáng & trang phục chính theo ảnh tham chiếu. Đổi trang phục theo mạch truyện cần bạn bật duyệt thủ công.'}
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-400/20 overflow-hidden bg-white dark:bg-[#131a35] shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setAllowFreeCostumeChange(false);
                              setBlueprint((prev) => (prev ? { ...prev, allowFreeCostumeChange: false } : prev));
                            }}
                            className={`px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                              !allowFreeCostumeChange
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            TẮT (Khóa cứng)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAllowFreeCostumeChange(true);
                              setBlueprint((prev) => (prev ? { ...prev, allowFreeCostumeChange: true } : prev));
                            }}
                            className={`px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                              allowFreeCostumeChange
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            BẬT (Duyệt đổi đồ)
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/40 leading-relaxed">
                        <strong className="text-slate-700 dark:text-slate-200">Phụ kiện/đạo cụ độc lập được phép theo cảnh: </strong>
                        mũ, nhẫn/trang sức, dây chuyền, giày dép, đồng hồ, túi xách, kính, đạo cụ cầm tay (không được làm thay đổi khuôn mặt, vóc dáng hay cấu trúc trang phục chính).
                      </div>
                    </div>
                  );
                })()}

                {videoStyle === 'custom' && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Mô tả phong cách tự viết (dùng cho phân cảnh, tạo ảnh &amp; tạo video)
                    </span>
                    <input
                      type="text"
                      value={customStylePrompt}
                      onChange={(e) => setCustomStylePrompt(e.target.value)}
                      placeholder="vd: Hoạt hình 2D màu pastel ấm, nét mực mảnh, ánh sáng chiều tà dịu nhẹ..."
                      className={inputCls}
                    />
                  </div>
                )}

                {(() => {
                  const activeLearned = videoStyle.startsWith('learned:')
                    ? learnedStyles.find((s) => `learned:${s.id}` === videoStyle)
                    : null;
                  if (!activeLearned) return null;
                  return (
                    <div className="rounded-xl bg-blue-500/8 border border-blue-400/30 p-3 space-y-2 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-blue-700 dark:text-blue-200 truncate">
                          Đang áp dụng phong cách đã học: {activeLearned.name}
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          Nguồn: {activeLearned.sourceLabel}
                        </span>
                      </div>
                      {activeLearned.visualToneVi && (
                        <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                          {activeLearned.visualToneVi}
                        </p>
                      )}
                      {activeLearned.sampleFrames && activeLearned.sampleFrames.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5">
                          {activeLearned.sampleFrames.slice(0, 4).map((frame, fIdx) => (
                            <img
                              key={fIdx}
                              src={frame}
                              alt={`${activeLearned.name} ${fIdx + 1}`}
                              className="w-full h-11 object-cover rounded-lg border border-slate-200 dark:border-white/10"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Dedicated Skill Option: Phong cách quay phim điện ảnh */}
                <div
                  className={`rounded-xl border p-3 transition ${
                    videoStyle === 'cinematic_filmmaking'
                      ? 'bg-gradient-to-r from-amber-500/12 via-violet-500/10 to-cyan-500/10 border-amber-400/50 dark:border-amber-400/45'
                      : 'bg-slate-50/90 dark:bg-[#0c1021]/80 border-slate-200 dark:border-slate-400/20'
                  }`}
                >
                  <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Clapperboard className="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Sử dụng phong cách dựng phim điện ảnh
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30">
                          Skill: Phong cách quay phim điện ảnh
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Áp dụng ngữ pháp dựng phim nhịp động từ video mẫu: khung hình xuyên tiền cảnh 3 lớp, góc thấp uy quyền, cắt nhịp Macro mắt/bàn tay, Two-shot xóa phông, ánh sáng viền &amp; quỹ đạo Orbit mượt mà.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={videoStyle === 'cinematic_filmmaking'}
                      onChange={(e) => {
                        const nextStyle: StudioVideoStyle = e.target.checked ? 'cinematic_filmmaking' : 'cinematic';
                        setVideoStyle(nextStyle);
                        if (blueprint) {
                          setBlueprint({ ...blueprint, videoStyle: nextStyle });
                        }
                      }}
                      className="mt-0.5 w-4 h-4 rounded accent-amber-500 cursor-pointer shrink-0"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Chỉ đạo thêm cho AI (nhịp dựng, lời thoại, tông cảm xúc)..."
                    className={inputCls}
                  />
                  {aiProvider === 'gemini' && (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useProModel}
                        onChange={(e) => setUseProModel(e.target.checked)}
                        className="w-4 h-4 rounded accent-violet-500"
                      />
                      <span>
                        Dùng Gemini Pro (<code className="text-violet-600 dark:text-violet-300 font-mono">gemini-4-argon · Trả phí</code>)
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* CONFIG TAB 2: VISUAL & CLIP ENGINES (SINGLE SOURCE OF TRUTH) */}
            {configTab === 'media' && (
              <div className="space-y-3.5 text-xs">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Chế độ dựng khung hình tổng thể</span>
                  <select
                    value={visualMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as DerivativeVisualMode;
                      setVisualMode(nextMode);
                      if (nextMode === 'muse2api_video') setSceneVideoEngine('muse2api');
                      else if (nextMode === 'qwen_video') setSceneVideoEngine('qwen');
                      else if (nextMode === 'gemini_omni') setSceneVideoEngine('gemini');
                    }}
                    className={inputCls}
                  >
                    <option value="muse2api_video">
                      Muse2API Video (muse-video · Ưu tiên · {capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                    </option>
                    <option value="qwen_video">
                      AI Qwen Video ({capabilities?.aiProviders.alibaba?.videoModel || 'wan2.5-i2v-preview'} · {capabilities?.aiProviders.alibaba?.configured ? 'Sẵn sàng' : 'Chưa đặt key'})
                    </option>
                    <option value="gemini_omni">Gemini Omni Flash (gemini-omni-1.2-flash · Trả phí)</option>
                    <option value="storyboard_motion">Ảnh phân cảnh AI + Chuyển động Ken Burns</option>
                    <option value="remix">
                      {studioMode === 'derivative'
                        ? 'Video nguồn / Tải lên + Kho Wikimedia (Miễn phí)'
                        : 'Ảnh phân cảnh + Kho video Wikimedia (Miễn phí)'}
                    </option>
                  </select>
                </label>

                {visualMode === 'muse2api_video' && !capabilities?.aiProviders.muse2api?.configured && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                    Muse2API chưa sẵn sàng ({capabilities?.aiProviders.muse2api?.status || 'offline'}). Vào{' '}
                    <button type="button" onClick={onOpenSettings} className="underline font-semibold cursor-pointer">
                      Cấu hình &gt; Muse2API
                    </button>{' '}
                    để kết nối và nạp Cookie muse.ai.
                  </p>
                )}

                {(visualMode === 'qwen_video' || imageEngineMode === 'qwen' || sceneVideoEngine === 'qwen') &&
                  !capabilities?.aiProviders.alibaba?.configured && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                      AI Qwen (Alibaba Cloud Model Studio) chưa có khóa DASHSCOPE_API_KEY hoặc đang tắt. Vào{' '}
                      <button type="button" onClick={onOpenSettings} className="underline font-semibold cursor-pointer">
                        Cấu hình &gt; AI Kịch bản (Alibaba Cloud)
                      </button>{' '}
                      để kiểm tra trạng thái và chọn model Qwen Ảnh/Video.
                    </p>
                  )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Engine tạo ảnh (Nhân vật &amp; Cảnh)</span>
                    <select
                      value={imageEngineMode}
                      onChange={(e) =>
                        setImageEngineMode(e.target.value as 'gemini_standard' | 'gemini_pro' | 'muse2api' | 'qwen')
                      }
                      className={inputCls}
                    >
                      <option value="muse2api">
                        Muse2API ({capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                      </option>
                      <option value="qwen">
                        AI Qwen ({capabilities?.aiProviders.alibaba?.imageModel || 'qwen-image-plus'} · {capabilities?.aiProviders.alibaba?.configured ? 'Sẵn sàng' : 'Chưa đặt key'})
                      </option>
                      <option value="gemini_standard">Gemini Flash Image</option>
                      <option value="gemini_pro">Nano Banana 2.1 (1K)</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Engine dựng clip từng cảnh</span>
                    <select
                      value={sceneVideoEngine}
                      onChange={(e) => setSceneVideoEngine(e.target.value as 'gemini' | 'muse2api' | 'qwen')}
                      className={inputCls}
                    >
                      <option value="muse2api">Muse2API (muse-video · Ưu tiên)</option>
                      <option value="qwen">
                        AI Qwen Video ({capabilities?.aiProviders.alibaba?.videoModel || 'wan2.5-i2v-preview'} · {capabilities?.aiProviders.alibaba?.configured ? 'Sẵn sàng' : 'Chưa đặt key'})
                      </option>
                      <option value="gemini">Gemini Omni Flash</option>
                    </select>
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Kho video dự phòng B-roll</span>
                  <select value={brollSource} onChange={(e) => setBrollSource(e.target.value as BrollSourceId)} className={inputCls}>
                    <option value="wikimedia">Wikimedia Commons (Ưu tiên · Không cần key)</option>
                    <option value="auto">Tự động (Wikimedia → Pexels → Pixabay)</option>
                    <option value="pexels">Pexels Video</option>
                    <option value="pixabay">Pixabay Video</option>
                    <option value="none">Không dùng kho B-roll ngoài</option>
                  </select>
                </label>

                {studioMode === 'derivative' && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={keepSourceAudio}
                      onChange={(e) => setKeepSourceAudio(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500"
                    />
                    <span>Giữ âm thanh gốc video nguồn nhỏ (12%)</span>
                  </label>
                )}
              </div>
            )}

            {/* CONFIG TAB 3: VOICEOVER & BACKGROUND MUSIC */}
            {configTab === 'audio' && (
              <div className="space-y-4 text-xs">
                {/* Voiceover Section */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                      <Mic className="w-4 h-4" />
                      <span>
                        {productionFormat === 'narration_story'
                          ? 'Giọng người dẫn chuyện (Thuyết minh kể chuyện)'
                          : 'Giọng đọc & Phân tích độ tuổi nhân vật'}
                      </span>
                    </div>
                  </div>

                  {productionFormat === 'dialogue_film' ? (
                    <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/25 text-[11px] text-violet-800 dark:text-violet-200 leading-snug">
                      AI tự động đọc độ tuổi &amp; giới tính từng nhân vật (<strong>Trẻ em · Thanh niên · Đàn ông · Đàn bà · Trung niên · Người già</strong>) để chọn cao độ giọng riêng biệt, giữ nhất quán xuyên suốt mọi phân cảnh.
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-800 dark:text-emerald-200 leading-snug">
                      Chỉ cần chọn 1 giọng người dẫn chuyện bên dưới; không cần cấu hình giọng riêng cho từng nhân vật.
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'ai_online' as DerivativeVoiceMode, label: 'AI Online' },
                      { id: 'offline_system' as DerivativeVoiceMode, label: 'VieNeu Offline' },
                      { id: 'none' as DerivativeVoiceMode, label: 'Tắt lồng tiếng' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setVoiceMode(opt.id)}
                        className={`h-8 px-2 text-xs font-semibold rounded-xl border transition cursor-pointer ${
                          voiceMode === opt.id
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-700 dark:text-emerald-200 font-bold'
                            : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {voiceMode === 'ai_online' && (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <select
                          value={voice}
                          onChange={(e) => setVoice(e.target.value as Exclude<DerivativeVoiceId, 'none'>)}
                          aria-label="Chọn chất giọng Gemini"
                          className={`flex-1 min-w-0 ${inputCls}`}
                        >
                          {GEMINI_VOICE_LIBRARY.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label} · {v.timbre}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={previewingSceneId === 'sample_gemini'}
                          onClick={() =>
                            void handleSpeakOfflineBrowserPreview(
                              'Xin chào, đây là giọng đọc tham chiếu Gemini chuẩn miền Bắc Việt Nam.',
                              'sample_gemini',
                              'ai_online',
                              undefined,
                              voice
                            )
                          }
                          className="h-9 px-3 text-xs font-medium bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          {previewingSceneId === 'sample_gemini' ? 'Đang đọc...' : 'Nghe thử'}
                        </button>
                      </div>
                      <p className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <Lock className="w-3 h-3" />
                        <span>{NORTHERN_VN_ACCENT_BADGE}</span>
                      </p>
                    </div>
                  )}

                  {voiceMode === 'offline_system' && (
                    <div className="space-y-2">
                      {capabilities?.localTools.offlineTts.engineId === 'vieneu' && offlineVoices.length > 0 ? (
                        <div className="flex gap-2">
                          <select
                            value={offlineVoice}
                            onChange={(e) => setOfflineVoice(e.target.value)}
                            aria-label="Chọn giọng VieNeu Offline"
                            className={`flex-1 ${inputCls}`}
                          >
                            {offlineVoices.map((v) => (
                              <option key={v.id} value={v.id}>{v.description || v.id}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={previewingSceneId === 'sample'}
                            onClick={() =>
                              void handleSpeakOfflineBrowserPreview(
                                'Xin chào các bạn, đây là giọng đọc tiếng Việt ngoại tuyến VieNeu TTS.',
                                'sample'
                              )
                            }
                            className="h-9 px-3 text-xs font-medium bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl cursor-pointer whitespace-nowrap"
                          >
                            {previewingSceneId === 'sample' ? 'Đang đọc...' : 'Nghe thử'}
                          </button>
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                          <p className="text-[11px] text-amber-800 dark:text-amber-200">
                            Chưa cài model VieNeu-TTS (11 giọng Việt tự nhiên).
                          </p>
                          <button
                            type="button"
                            disabled={isInstallingVieNeu}
                            onClick={() => void handleInstallVieNeuOffline()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-cyan-500 rounded-xl cursor-pointer disabled:opacity-50"
                          >
                            {isInstallingVieNeu ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            <span>{isInstallingVieNeu ? 'Đang tải (~300MB)...' : 'Tải & Cài VieNeu-TTS'}</span>
                          </button>
                        </div>
                      )}
                      {offlineTtsNotice && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">{offlineTtsNotice}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Background Music Section */}
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-400/15 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-violet-700 dark:text-violet-300">
                      <Music className="w-4 h-4" />
                      <span>
                        {productionFormat === 'narration_story'
                          ? 'Nhạc nền AI sáng tạo & linh động'
                          : 'Ghép nhạc nền & AI sáng tạo'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {musicMode !== 'none' && (
                        <span className="text-[11px] font-mono font-bold tabular-nums text-violet-700 dark:text-violet-300">
                          Âm lượng {musicVolume}% / 90%
                        </span>
                      )}
                      {productionFormat === 'narration_story' && (
                        <button
                          type="button"
                          onClick={() => setShowManualNarrationMusic((v) => !v)}
                          className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer"
                        >
                          {showManualNarrationMusic ? 'Thu gọn nguồn nhạc' : 'Đổi nguồn nhạc'}
                        </button>
                      )}
                    </div>
                  </div>

                  {productionFormat === 'narration_story' && !showManualNarrationMusic ? (
                    <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-400/30 space-y-2">
                      <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                        Chế độ <strong>Phim thuyết minh kể chuyện</strong> ưu tiên AI tự sáng tạo nhạc nền theo phong cách bạn chọn (hoặc tự động khớp bối cảnh).
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={musicMode}
                        onChange={(e) => setMusicMode(e.target.value as DerivativeMusicMode)}
                        aria-label="Nguồn nhạc nền"
                        className={inputCls}
                      >
                        <option value="ai_lyria">AI tạo nhạc nền tích hợp trong prompt video (Chọn phong cách)</option>
                        <option value="auto_adaptive">AI tự động khớp nhạc nền theo bối cảnh video</option>
                        <option value="public_free">Nhạc công cộng miễn phí (Wikimedia Audio)</option>
                        <option value="uploaded">Tải tệp nhạc từ máy (.mp3 / .wav)</option>
                        <option value="none">Không chèn nhạc nền</option>
                      </select>

                      {musicMode === 'none' && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            Bật nhanh nhạc AI trong prompt:
                          </span>
                          {(['country', 'remix', 'chamber', 'kids_fun', 'cinematic'] as AiMusicStyleId[]).map((sid) => {
                            const opt = AI_MUSIC_STYLE_OPTIONS.find((o) => o.value === sid);
                            if (!opt) return null;
                            return (
                              <button
                                key={sid}
                                type="button"
                                onClick={() => handleSelectAiMusicStyle(sid)}
                                className="px-2 py-0.5 rounded-lg border border-violet-400/30 bg-violet-500/10 hover:bg-violet-600 hover:text-white text-[10px] font-semibold text-violet-700 dark:text-violet-300 transition cursor-pointer"
                              >
                                + {opt.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {musicMode !== 'none' && (
                    <div className="p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/70 border border-slate-200/80 dark:border-slate-400/15 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          Âm lượng nhạc nền <span className="text-slate-400 font-normal">(0% – 90%)</span>
                        </span>
                        <div className="flex items-center gap-1">
                          {[20, 45, 70, 90].map((presetVol) => (
                            <button
                              key={presetVol}
                              type="button"
                              onClick={() => setMusicVolume(presetVol)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold cursor-pointer transition ${
                                musicVolume === presetVol
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-slate-200/80 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-violet-500/20'
                              }`}
                            >
                              {presetVol}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={1}
                        value={musicVolume}
                        onChange={(e) => setMusicVolume(Math.min(90, Math.max(0, Number(e.target.value))))}
                        aria-label="Âm lượng nhạc nền tối đa 90 phần trăm"
                        className="w-full accent-violet-500 cursor-pointer"
                      />
                    </div>
                  )}

                  {(musicMode === 'ai_lyria' || musicMode === 'auto_adaptive') && (
                    <div className="space-y-2.5 p-2.5 rounded-xl bg-violet-500/5 border border-violet-400/25">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          Phong cách nhạc nền truyền trực tiếp vào prompt AI tạo video
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {AI_MUSIC_STYLE_OPTIONS.find((s) => s.value === musicStyle)?.shortLabel}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {AI_MUSIC_STYLE_OPTIONS.map((opt) => {
                          const active = musicStyle === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleSelectAiMusicStyle(opt.value)}
                              title={opt.desc}
                              className={`px-2 py-1.5 rounded-lg border text-left text-[11px] font-semibold transition cursor-pointer truncate ${
                                active
                                  ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
                                  : 'border-slate-200 dark:border-slate-400/20 bg-white/80 dark:bg-[#0c1021]/80 text-slate-700 dark:text-slate-200 hover:border-violet-400/60'
                              }`}
                            >
                              {opt.shortLabel}
                            </button>
                          );
                        })}
                      </div>

                      {(() => {
                        const activeOpt = AI_MUSIC_STYLE_OPTIONS.find((s) => s.value === musicStyle);
                        return activeOpt?.desc ? (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                            {activeOpt.desc}
                          </p>
                        ) : null;
                      })()}

                      <input
                        type="text"
                        value={musicPrompt}
                        onChange={(e) => setMusicPrompt(e.target.value)}
                        placeholder="Mô tả chi tiết thêm về tiết tấu, nhạc cụ, cảm xúc nhạc nền..."
                        className={inputCls}
                      />

                      <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={musicInstrumentalOnly}
                          onChange={(e) => setMusicInstrumentalOnly(e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-600 accent-violet-600"
                        />
                        <span>Chỉ nhạc nền không lời (Instrumental — không lẫn giọng hát vào thoại)</span>
                      </label>

                      {activeMusicPromptDirective && (
                        <div className="p-2 rounded-lg bg-white/80 dark:bg-[#0c1021]/90 border border-violet-400/25 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          <span className="font-bold text-violet-700 dark:text-violet-300">
                            Tham số tự động gắn vào prompt tạo video:{' '}
                          </span>
                          {activeMusicPromptDirective}
                        </div>
                      )}
                    </div>
                  )}

                  {musicMode === 'public_free' && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={publicMusicQuery}
                          onChange={(e) => setPublicMusicQuery(e.target.value)}
                          placeholder="Từ khóa (ambient, piano, upbeat)..."
                          className={`flex-1 ${inputCls}`}
                        />
                        <button
                          type="button"
                          disabled={isSearchingMusic}
                          onClick={handleSearchPublicMusic}
                          className="h-9 px-3 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl cursor-pointer whitespace-nowrap"
                        >
                          {isSearchingMusic ? 'Tìm...' : 'Tìm nhạc'}
                        </button>
                      </div>
                      {publicMusicResults.length > 0 && (
                        <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                          {publicMusicResults.map((tr) => (
                            <button
                              key={tr.id}
                              type="button"
                              onClick={() => setSelectedPublicTrack(tr)}
                              className={`w-full text-left px-2.5 py-1 rounded-lg border text-[11px] truncate cursor-pointer ${
                                selectedPublicTrack?.id === tr.id
                                  ? 'border-violet-400/50 bg-violet-500/15 font-semibold'
                                  : 'border-slate-200 dark:border-slate-400/20'
                              }`}
                            >
                              {tr.title}
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedPublicTrack?.url && <audio controls src={selectedPublicTrack.url} className="w-full h-8" />}
                    </div>
                  )}

                  {musicMode === 'uploaded' && (
                    <div className="space-y-2">
                      <input ref={audioUploadInputRef} type="file" accept="audio/*" onChange={handleUploadMusicFile} className="hidden" />
                      <button
                        type="button"
                        onClick={() => audioUploadInputRef.current?.click()}
                        className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Chọn file nhạc (.mp3 / .wav)</span>
                      </button>
                      {uploadedAudioTrack?.url && <audio controls src={uploadedAudioTrack.url} className="w-full h-8" />}
                    </div>
                  )}

                  {musicError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{musicError}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 1 Alerts + Primary Next CTA */}
        {learnError && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{learnError}</span>
            </div>
            <button
              type="button"
              disabled={isLearning}
              onClick={() => void handleLearnAndCreateScript({ preserveExactIdea: studioMode === 'creative' })}
              className="px-3 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer"
            >
              Thử lại ngay
            </button>
          </div>
        )}

        <div className="glass-card-accent rounded-2xl p-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
            <span>
              <span className="font-semibold text-slate-900 dark:text-white">Tóm tắt Bước 1:</span>{' '}
              {productionFormat === 'narration_story' ? 'Phim thuyết minh kể chuyện' : 'Phim có lời thoại'} ·{' '}
              {scriptMode === 'independent_batch'
                ? `${unifiedUnitCount} kịch bản độc lập × ${targetDurationSec}s (tổng ${unifiedTotalDurationSec}s)`
                : `1 kịch bản Series · ${unifiedUnitCount} phân cảnh × ${targetDurationSec}s (tổng ${unifiedTotalDurationSec}s)`}{' '}
              · {aspectRatio} ·{' '}
              {voiceMode === 'none' ? 'Không lồng tiếng' : voiceMode === 'offline_system' ? 'VieNeu Offline' : 'AI Voice'}
            </span>
            {expandedIdeas.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-200 border border-cyan-400/30 text-[10px] font-semibold">
                <Sparkles className="w-3 h-3" />
                Chọn nút &quot;Tạo prompt kịch bản&quot; ngay trên từng ý tưởng ở trên
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {blueprint && (
              <button
                type="button"
                onClick={() => setActiveStudioStep(2)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <span>Xem kịch bản đang có</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={isDispatchingToCommandCenter || isLearning || (!canSubmitLearn && !blueprint)}
              onClick={() => void handleDispatchToCommandCenter()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/15 border border-slate-700/40 dark:border-white/15 text-white font-semibold text-xs transition disabled:opacity-45 cursor-pointer whitespace-nowrap"
            >
              {isDispatchingToCommandCenter ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Clapperboard className="w-3.5 h-3.5 text-cyan-400" />
              )}
              <span>Đẩy sang Trung Tâm Điều Phối AI</span>
            </button>

            {/* Whenever expanded ideas exist (Creative or Derivative), hide bottom generate button so AI never re-invents away from the chosen idea */}
            {expandedIdeas.length === 0 ? (
              studioMode === 'derivative' ? (
                <button
                  type="button"
                  disabled={isLearning || !canSubmitLearn}
                  onClick={() => void handleLearnAndCreateScript()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 text-white font-bold text-xs sm:text-sm shadow-lg shadow-violet-600/25 transition disabled:opacity-50 cursor-pointer"
                >
                  {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>
                    {isLearning
                      ? scriptMode === 'independent_batch'
                        ? `Đang sáng tạo ${unifiedUnitCount} kịch bản (${learningElapsedSec}s)...`
                        : `AI đang lên 1 kịch bản · ${unifiedUnitCount} phân cảnh (${learningElapsedSec}s)...`
                      : scriptMode === 'independent_batch'
                      ? `AI Lên ${unifiedUnitCount} Kịch Bản Độc Lập & Sang Bước 2`
                      : `AI Lên Kịch Bản (${unifiedUnitCount} phân cảnh) & Sang Bước 2`}
                  </span>
                  {!isLearning && <ArrowRight className="w-4 h-4" />}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isLearning || !canSubmitLearn}
                  onClick={() => void handleLearnAndCreateScript({ preserveExactIdea: true })}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 text-white font-bold text-xs sm:text-sm shadow-lg shadow-violet-600/25 transition disabled:opacity-50 cursor-pointer"
                >
                  {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>
                    {isLearning
                      ? scriptMode === 'independent_batch'
                        ? `Đang tạo ${unifiedUnitCount} kịch bản độc lập (${learningElapsedSec}s)...`
                        : `Đang tạo 1 kịch bản · ${unifiedUnitCount} phân cảnh (${learningElapsedSec}s)...`
                      : scriptMode === 'independent_batch'
                      ? `Tạo ${unifiedUnitCount} prompt kịch bản độc lập từ ý tưởng gốc`
                      : `Tạo prompt kịch bản (${unifiedUnitCount} phân cảnh × ${targetDurationSec}s)`}
                  </span>
                  {!isLearning && <ArrowRight className="w-4 h-4" />}
                </button>
              )
            ) : null}
          </div>
        </div>
        {commandCenterError && (
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{commandCenterError}</span>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* BƯỚC 2: BIÊN TẬP KỊCH BẢN, HỒ SƠ ĐỒNG BỘ & PHÂN CẢNH              */}
      {/* ================================================================= */}
      <section className={activeStudioStep === 2 ? 'space-y-4' : 'hidden'}>
        {!blueprint ? (
          <div className="glass-card rounded-2xl p-8 text-center space-y-3">
            <BookOpen className="w-8 h-8 text-cyan-500 mx-auto" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Chưa có kịch bản nào ở chế độ này
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Quay lại <strong>Bước 1</strong> để chọn một ý tưởng đã triển khai rồi bấm <strong>Tạo prompt kịch bản</strong> (hoặc thêm video tham chiếu).
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveStudioStep(1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-semibold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Về Bước 1</span>
              </button>
              {canSubmitLearn && expandedIdeas.length === 0 && (
                <button
                  type="button"
                  disabled={isLearning}
                  onClick={() => void handleLearnAndCreateScript({ preserveExactIdea: studioMode === 'creative' })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer"
                >
                  {isLearning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Tạo prompt kịch bản ngay</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {learnSuccess && (
              <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{learnSuccess}</span>
                </div>
                <button type="button" onClick={() => setLearnSuccess('')} className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Independent Batch Switcher (if >1 video) */}
            {blueprints.length > 1 && (
              <div className="glass-card rounded-2xl p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white">
                    Chọn video trong lô ({blueprints.length} video độc lập)
                  </span>
                  <span className="font-mono text-cyan-600 dark:text-cyan-300 font-semibold">
                    Đang sửa Video {String(activeBatchIndex + 1).padStart(2, '0')}/{String(blueprints.length).padStart(2, '0')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {blueprints.map((bpItem, idx) => {
                    const isActive = idx === activeBatchIndex;
                    const itemJob = jobsByKey[`${studioMode}:${idx}`];
                    return (
                      <button
                        key={`${bpItem.derivativeTitle}_${idx}`}
                        type="button"
                        onClick={() => {
                          setActiveBatchIndex(idx);
                          setCharacterBibleDraft(bpItem.characterBible || '');
                          setSettingBibleDraft(bpItem.settingBible || '');
                          setVisualStyleBibleDraft(bpItem.visualStyleBible || '');
                          setCostumeBibleDraft(bpItem.costumeBible || '');
                          setContinuityBibleDraft(bpItem.continuityBible || '');
                          if (typeof bpItem.allowFreeCostumeChange === 'boolean') {
                            setAllowFreeCostumeChange(bpItem.allowFreeCostumeChange);
                          }
                        }}
                        className={`text-left p-2 rounded-xl border transition cursor-pointer ${
                          isActive
                            ? 'bg-violet-500/15 border-violet-400/50'
                            : 'bg-slate-50/70 dark:bg-[#0c1021]/70 border-slate-200 dark:border-slate-400/20 hover:border-cyan-400/40'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="font-bold text-cyan-600 dark:text-cyan-300">Video {String(idx + 1).padStart(2, '0')}</span>
                          <span className="text-slate-500">{bpItem.scenes.length} cảnh</span>
                        </div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                          {bpItem.derivativeTitle}
                        </div>
                        {itemJob?.status === 'completed' && (
                          <div className="text-[10px] text-emerald-500 font-semibold">Đã xong MP4</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unified 3-Tab Meta Panel (Summary+Hook | 9-Dim Analysis | 5-Component Bible) */}
            <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-400/15 pb-3">
                <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-xs">
                  <button
                    type="button"
                    onClick={() => setReviewMetaTab('summary')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                      reviewMetaTab === 'summary'
                        ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Tiêu đề &amp; Hook
                  </button>
                  {studioMode === 'derivative' && blueprint.referenceAnalysis && (
                    <button
                      type="button"
                      onClick={() => setReviewMetaTab('analysis')}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                        reviewMetaTab === 'analysis'
                          ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Phân tích 9 chiều
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReviewMetaTab('bible')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                      reviewMetaTab === 'bible'
                        ? 'bg-white dark:bg-[#131a35] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Hồ sơ đồng bộ 5 thành phần
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveStudioStep(1)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Sửa nguồn / Cấu hình</span>
                  </button>
                  <button
                    type="button"
                    disabled={isDispatchingToCommandCenter}
                    onClick={() => void handleDispatchToCommandCenter()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {isDispatchingToCommandCenter ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Clapperboard className="w-3.5 h-3.5" />
                    )}
                    <span>Đẩy sang Trung Tâm Điều Phối AI</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStudioStep(3)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer"
                  >
                    <span>Dựng &amp; Xuất MP4</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {reviewMetaTab === 'summary' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                  <div className="lg:col-span-6 space-y-2">
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tiêu đề video</span>
                      <input
                        type="text"
                        value={blueprint.derivativeTitle}
                        onChange={(e) => setBlueprint({ ...blueprint, derivativeTitle: e.target.value })}
                        className={`${inputCls} font-semibold`}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Chữ Hook nổi bật 3.5 giây đầu</span>
                      <input
                        type="text"
                        value={blueprint.derivativeHook}
                        onChange={(e) => setBlueprint({ ...blueprint, derivativeHook: e.target.value })}
                        className={inputCls}
                      />
                    </label>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {blueprint.hashtags.join(' ')}
                    </div>
                  </div>
                  <div className="lg:col-span-6 space-y-1.5">
                    <div className="text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
                      Tóm tắt kịch bản ({blueprint.usedModel || blueprint.usedProvider})
                    </div>
                    <p className="text-slate-700 dark:text-slate-200 leading-relaxed">{blueprint.learnedSummary}</p>
                    <p className="text-slate-500 dark:text-slate-400">
                      <strong>Công thức Hook:</strong> {blueprint.hookFormula}
                    </p>
                  </div>
                </div>
              )}

              {reviewMetaTab === 'analysis' && blueprint.referenceAnalysis && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px]">
                  {[
                    { label: 'Nội dung & Chủ đề chính', value: blueprint.referenceAnalysis.mainTheme },
                    { label: 'Cốt truyện & Diễn biến', value: blueprint.referenceAnalysis.plotProgression },
                    { label: 'Nhân vật & Đặc điểm', value: blueprint.referenceAnalysis.characterTraits },
                    { label: 'Bối cảnh & Không gian', value: blueprint.referenceAnalysis.settingAndSpace },
                    { label: 'Phong cách hình ảnh', value: blueprint.referenceAnalysis.visualStyle },
                    { label: 'Góc máy & Chuyển động', value: blueprint.referenceAnalysis.cameraAndMovement },
                    { label: 'Ánh sáng & Màu sắc', value: blueprint.referenceAnalysis.lightingAndColor },
                    { label: 'Nhịp độ dựng phim', value: blueprint.referenceAnalysis.editingPacing },
                    { label: 'Lời thoại & Âm thanh', value: blueprint.referenceAnalysis.dialogueAndAudio },
                  ]
                    .filter((item) => item.value && item.value.trim())
                    .map((item) => (
                      <div
                        key={item.label}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 space-y-0.5"
                      >
                        <div className="font-bold text-cyan-700 dark:text-cyan-300">{item.label}</div>
                        <p className="text-slate-700 dark:text-slate-200 leading-snug">{item.value}</p>
                      </div>
                    ))}
                </div>
              )}

              {reviewMetaTab === 'bible' && (
                <div className="space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Khóa đồng bộ xuyên suốt từ Scene 01 → Scene {String(blueprint.scenes.length).padStart(2, '0')}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {characters.length > 0 && (
                        <button
                          type="button"
                          disabled={isAnalyzingCharacters}
                          onClick={() => void handleAnalyzeAllCharacters()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/35 rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          {isAnalyzingCharacters ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>AI phân tích tất cả nhân vật ({characters.length})</span>
                        </button>
                      )}
                      {characters.length < 8 && (blueprint.characterBible || characterBibleDraft) && (
                        <button
                          type="button"
                          disabled={isGeneratingChar}
                          onClick={() =>
                            void handleGenerateCharacterAi(
                              blueprint.characterBible || characterBibleDraft,
                              'Nhân vật đồng bộ'
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          {isGeneratingChar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                          <span>Vẽ ảnh nhân vật từ Hồ sơ này</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isSavingProject}
                        onClick={() => void handleSaveProjectProfile()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 rounded-xl cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Lưu vào Dự án</span>
                      </button>
                    </div>
                  </div>

                  {characters.length > 0 && selectedChar && (
                    <div className="p-3 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-violet-400/30 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {characters.map((ch, idx) => {
                            const isSel = ch.id === selectedChar.id;
                            return (
                              <button
                                key={ch.id}
                                type="button"
                                onClick={() => setSelectedCharacterId(ch.id)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border transition cursor-pointer ${
                                  isSel
                                    ? 'bg-violet-600 text-white border-violet-500 font-semibold shadow-sm'
                                    : 'bg-white dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/50'
                                }`}
                              >
                                <span className="font-mono text-[10px] opacity-80">#{idx + 1}</span>
                                <span className="max-w-[120px] truncate">{ch.name || `Nhân vật ${idx + 1}`}</span>
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300">
                          Hồ sơ 5 thành phần · Đang chọn: <strong>{selectedChar.name}</strong>
                        </span>
                      </div>

                      <div key={selectedChar.id} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                        <input
                          type="text"
                          value={selectedChar.syncProfile?.face ?? ''}
                          onChange={(e) =>
                            updateSelectedCharacterSyncProfile(selectedChar.id, 'face', e.target.value)
                          }
                          placeholder="1. Gương mặt..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={selectedChar.syncProfile?.physique ?? ''}
                          onChange={(e) =>
                            updateSelectedCharacterSyncProfile(selectedChar.id, 'physique', e.target.value)
                          }
                          placeholder="2. Vóc dáng..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={selectedChar.syncProfile?.costume ?? ''}
                          onChange={(e) =>
                            updateSelectedCharacterSyncProfile(selectedChar.id, 'costume', e.target.value)
                          }
                          placeholder="3. Trang phục..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={selectedChar.syncProfile?.voice ?? ''}
                          onChange={(e) =>
                            updateSelectedCharacterSyncProfile(selectedChar.id, 'voice', e.target.value)
                          }
                          placeholder="4. Giọng nói..."
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={selectedChar.syncProfile?.distinguishingMarks ?? ''}
                          onChange={(e) =>
                            updateSelectedCharacterSyncProfile(
                              selectedChar.id,
                              'distinguishingMarks',
                              e.target.value
                            )
                          }
                          placeholder="5. Đặc điểm nhận dạng..."
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                    <label className="md:col-span-6 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">1. Character (Nhân vật)</span>
                      <textarea
                        rows={2}
                        value={blueprint.characterBible ?? ''}
                        onChange={(e) => {
                          setBlueprint({ ...blueprint, characterBible: e.target.value });
                          setCharacterBibleDraft(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white resize-y"
                      />
                    </label>
                    <label className="md:col-span-6 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">2. Environment (Bối cảnh)</span>
                      <textarea
                        rows={2}
                        value={blueprint.settingBible ?? ''}
                        onChange={(e) => {
                          setBlueprint({ ...blueprint, settingBible: e.target.value });
                          setSettingBibleDraft(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white resize-y"
                      />
                    </label>
                    <label className="md:col-span-4 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">3. Visual Style (Bảng màu)</span>
                      <textarea
                        rows={2}
                        value={blueprint.visualStyleBible ?? ''}
                        onChange={(e) => {
                          setBlueprint({ ...blueprint, visualStyleBible: e.target.value });
                          setVisualStyleBibleDraft(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white resize-y"
                      />
                    </label>
                    <label className="md:col-span-3 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">4. Costume (Trang phục)</span>
                      <textarea
                        rows={2}
                        value={blueprint.costumeBible ?? ''}
                        onChange={(e) => {
                          setBlueprint({ ...blueprint, costumeBible: e.target.value });
                          setCostumeBibleDraft(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white resize-y"
                      />
                    </label>
                    <label className="md:col-span-3 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">5. Continuity (Mạch truyện)</span>
                      <textarea
                        rows={2}
                        value={blueprint.continuityBible ?? ''}
                        onChange={(e) => {
                          setBlueprint({ ...blueprint, continuityBible: e.target.value });
                          setContinuityBibleDraft(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white resize-y"
                      />
                    </label>
                    <div className="md:col-span-2 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Phong cách quay / dựng</span>
                      <StudioStylePicker
                        value={blueprint.videoStyle || videoStyle}
                        learnedStyles={learnedStyles}
                        customStylePrompt={customStylePrompt}
                        onChange={(nextStyle) => handleSelectVideoStyle(nextStyle, true)}
                        onOpenLearnModal={() => setIsLearnStyleModalOpen(true)}
                        onDeleteLearnedStyle={(id) => void handleDeleteLearnedStyle(id)}
                        triggerClassName={`${inputCls} flex items-center justify-between gap-2 text-left hover:border-violet-400/60 cursor-pointer`}
                        ariaLabel="Phong cách quay / dựng"
                      />
                    </div>
                  </div>
                  {(blueprint.videoStyle || videoStyle) === 'custom' && (
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Mô tả phong cách tự viết</span>
                      <input
                        type="text"
                        value={customStylePrompt}
                        onChange={(e) => setCustomStylePrompt(e.target.value)}
                        placeholder="vd: Hoạt hình 2D màu pastel ấm, nét mực mảnh..."
                        className={inputCls}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Storyboard Controls & Compact Scene Cards */}
            <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  <strong className="text-sm text-slate-900 dark:text-white">
                    Dàn phân cảnh ({blueprint.scenes.length} cảnh)
                  </strong>{' '}
                  · Tổng ước lượng{' '}
                  <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                    {Math.floor(totalSceneSec / 60)}p {totalSceneSec % 60}s
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50 dark:bg-[#0c1021] p-0.5 text-[11px]">
                    <span className="px-2 text-slate-600 dark:text-slate-300 font-medium inline-flex items-center gap-1">
                      <Mic className="w-3 h-3 text-emerald-600 dark:text-emerald-300" />
                      <span>Lồng tiếng:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceover(true)}
                      className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
                        voiceMode !== 'none'
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      BẬT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceover(false)}
                      className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
                        voiceMode === 'none'
                          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      TẮT
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isBatchGeneratingImages}
                    onClick={handleBatchGenerateSceneImages}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 rounded-xl transition cursor-pointer disabled:opacity-70"
                  >
                    {isBatchGeneratingImages ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                    <span>
                      {isBatchGeneratingImages
                        ? `Đang vẽ ${batchImageProgress ? `${batchImageProgress.current}/${batchImageProgress.total}` : '...'}...`
                        : 'Tạo ảnh AI tất cả cảnh'}
                    </span>
                  </button>

                  {isBatchGeneratingImages && (
                    <button
                      type="button"
                      onClick={handleStopBatchGenerateSceneImages}
                      className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300 border border-rose-500/35 rounded-xl cursor-pointer"
                    >
                      Dừng
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={blueprint.scenes.length >= 24}
                    onClick={handleAddScene}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 border border-cyan-500/35 hover:bg-cyan-500/10 rounded-xl transition cursor-pointer disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm cảnh</span>
                  </button>
                </div>
              </div>

              {sceneMediaError && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{sceneMediaError}</span>
                </div>
              )}

              {/* Character Voice Profile Casting Strip (Dialogue Film) / Adaptive Music Strip (Narration Story) */}
              {(blueprint.productionFormat || productionFormat) === 'dialogue_film' &&
                Array.isArray(blueprint.characterVoiceProfiles) &&
                blueprint.characterVoiceProfiles.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-violet-500/8 border border-violet-400/25 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-bold text-violet-700 dark:text-violet-300 mr-1">
                      Phân vai giọng nói theo độ tuổi (Bắc VN):
                    </span>
                    {blueprint.characterVoiceProfiles.map((vp, vpIdx) => {
                      const ageMeta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === vp.ageGroup);
                      return (
                        <span
                          key={`${vp.characterName}_${vpIdx}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#131a35] border border-violet-400/30 text-slate-800 dark:text-slate-100"
                        >
                          <span className="font-semibold">{vp.characterName}</span>
                          <span className="text-[10px] text-violet-600 dark:text-violet-300">
                            · {ageMeta?.label || vp.ageGroup}
                          </span>
                          <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-300">
                            ({vp.voiceId})
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}

              {(blueprint.productionFormat || productionFormat) === 'narration_story' && (
                <div className="p-2.5 rounded-xl bg-emerald-500/8 border border-emerald-400/25 flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-800 dark:text-emerald-200">
                  <span>
                    <strong>Chế độ Phim thuyết minh kể chuyện:</strong> AI dùng 1 giọng người dẫn chuyện thống nhất &amp; tự ghép nhạc nền phù hợp từng phân cảnh.
                  </span>
                  {blueprint.adaptiveMusicPrompt && (
                    <span className="font-mono text-[10px] opacity-85 truncate max-w-md">
                      Nhạc nền: {blueprint.adaptiveMusicPrompt}
                    </span>
                  )}
                </div>
              )}

              {/* Reference Appearance & Costume Lock Banner + Warnings */}
              {(() => {
                const effectiveAllowFree = blueprint.allowFreeCostumeChange ?? allowFreeCostumeChange;
                const lockWarnings = Array.isArray(blueprint.costumeLockWarnings)
                  ? blueprint.costumeLockWarnings.filter((w) => w?.trim())
                  : [];
                return (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                        <Lock
                          className={`w-3.5 h-3.5 shrink-0 ${
                            effectiveAllowFree
                              ? 'text-amber-600 dark:text-amber-300'
                              : 'text-emerald-600 dark:text-emerald-300'
                          }`}
                        />
                        <span>
                          <strong>Khóa nhân vật tham chiếu:</strong>{' '}
                          {effectiveAllowFree
                            ? 'BẬT tự do đổi trang phục theo bối cảnh (vẫn khóa 100% mặt, tóc, vóc dáng).'
                            : 'TẮT đổi trang phục (khóa cứng 100% ngoại hình & bộ đồ gốc xuyên suốt mọi cảnh).'}
                        </span>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-400/20 overflow-hidden bg-white dark:bg-[#131a35]">
                        <button
                          type="button"
                          onClick={() => {
                            setAllowFreeCostumeChange(false);
                            setBlueprint({ ...blueprint, allowFreeCostumeChange: false });
                          }}
                          className={`px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                            !effectiveAllowFree
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          TẮT (Khóa đồ)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAllowFreeCostumeChange(true);
                            setBlueprint({ ...blueprint, allowFreeCostumeChange: true });
                          }}
                          className={`px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                            effectiveAllowFree
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          BẬT (Tự do)
                        </button>
                      </div>
                    </div>

                    {!effectiveAllowFree && lockWarnings.length > 0 && (
                      <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs text-amber-900 dark:text-amber-100 flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="font-bold flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
                            <span>Cảnh báo khóa trang phục tham chiếu</span>
                          </div>
                          {lockWarnings.map((w, idx) => (
                            <p key={idx} className="text-[11px] leading-snug opacity-95">
                              {w}
                            </p>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAllowFreeCostumeChange(true);
                            setBlueprint({ ...blueprint, allowFreeCostumeChange: true });
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold cursor-pointer shrink-0"
                        >
                          Bật tự do đổi trang phục
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Pre-Render 7-Point QC Gate Card */}
              {(() => {
                const effectiveAllowFree = blueprint.allowFreeCostumeChange ?? allowFreeCostumeChange;
                const liveQc = runClientBlueprintQc({
                  blueprint,
                  characterRefs: characters,
                  enableVoiceover: voiceMode !== 'none',
                  targetEngine: sceneVideoEngine === 'muse2api' ? 'muse2api' : 'gemini',
                  allowFreeCostumeChange: effectiveAllowFree,
                });
                const fixableIssues = liveQc.issues.filter((is) => is.autoFixable);
                const serverFixedCount = blueprint.qcReport?.autoFixedCount || 0;
                return (
                  <div
                    className={`p-3 rounded-xl border text-xs space-y-2 ${
                      liveQc.issues.length === 0
                        ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-900 dark:text-emerald-100'
                        : 'bg-amber-500/8 border-amber-500/30 text-amber-900 dark:text-amber-100'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span className="font-bold">
                          Cổng kiểm định Pre-Render QC: {liveQc.passedChecks}/{liveQc.totalChecks} chuẩn đạt · {liveQc.score}/100 điểm
                        </span>
                        {serverFixedCount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/70 dark:bg-white/10 font-medium">
                            Đã tự chuẩn hóa {serverFixedCount} mục
                          </span>
                        )}
                      </div>
                      {fixableIssues.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const fixed = autoFixClientBlueprint({
                              blueprint,
                              characterRefs: characters,
                              enableVoiceover: voiceMode !== 'none',
                              allowFreeCostumeChange: effectiveAllowFree,
                            });
                            setBlueprint(fixed.blueprint);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition cursor-pointer"
                        >
                          <Wrench className="w-3 h-3" />
                          <span>Tự động sửa lỗi đồng bộ ({fixableIssues.length})</span>
                        </button>
                      )}
                    </div>
                    {liveQc.issues.length > 0 ? (
                      <ul className="space-y-1 text-[11px] opacity-90 pl-6 list-disc">
                        {liveQc.issues.slice(0, 4).map((is) => (
                          <li key={is.id}>{is.message}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] opacity-85">
                        Đạt chuẩn đồng bộ nhân vật ↔ lời thoại, khóa trang phục tham chiếu, mạch nối cảnh, vệ sinh prompt an toàn model, nhịp đọc &amp; phân vai giọng nói.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Scene selection & dispatch bar for Trung Tâm Điều Phối AI */}
              {(() => {
                const selectedIds = getSelectedCoordSceneIds(blueprint, activeBatchIndex);
                const selectedSet = new Set(selectedIds);
                const allSelected = blueprint.scenes.length > 0 && selectedIds.length === blueprint.scenes.length;
                return (
                  <>
                    <div className="p-3 rounded-xl bg-violet-500/8 dark:bg-violet-500/12 border border-violet-500/30 flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="inline-flex items-center gap-2 font-bold text-slate-900 dark:text-white cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(e) => selectAllCoordScenes(e.target.checked)}
                            className="w-4 h-4 rounded accent-violet-600 cursor-pointer"
                          />
                          <span>
                            Chọn phân cảnh đẩy sang Trung Tâm Điều Phối AI ({selectedIds.length}/{blueprint.scenes.length})
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => selectAllCoordScenes(true)}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white/80 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 hover:border-violet-400 cursor-pointer"
                        >
                          Chọn tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() => selectAllCoordScenes(false)}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white/80 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 hover:border-rose-400 cursor-pointer"
                        >
                          Bỏ chọn
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isDispatchingToCommandCenter || selectedIds.length === 0}
                          onClick={() => void handleDispatchToCommandCenter({ onlySelectedScenes: true })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-bold cursor-pointer whitespace-nowrap shadow-sm"
                        >
                          {isDispatchingToCommandCenter ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Clapperboard className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {allSelected
                              ? `Đẩy tất cả ${blueprint.scenes.length} phân cảnh sang Điều phối AI`
                              : `Đẩy ${selectedIds.length} phân cảnh đã chọn sang Điều phối AI`}
                          </span>
                        </button>

                        {blueprints.length > 1 && (
                          <button
                            type="button"
                            disabled={isDispatchingToCommandCenter}
                            onClick={() => void handleDispatchToCommandCenter({ dispatchAllBatch: true })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-45 text-white text-xs font-bold cursor-pointer whitespace-nowrap shadow-sm"
                          >
                            <ListVideo className="w-3.5 h-3.5" />
                            <span>Đẩy toàn bộ {blueprints.length} kịch bản vào hàng đợi Điều phối AI</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-slate-400/15 border border-slate-200 dark:border-slate-400/20 rounded-2xl overflow-hidden">
                      {blueprint.scenes.map((sc, idx) => {
                        const isChecked = selectedSet.has(sc.id);
                        return (
                          <div
                            key={sc.id}
                            className={`transition ${
                              isChecked ? '' : 'opacity-65 bg-slate-100/40 dark:bg-black/15'
                            }`}
                          >
                            <div className="px-3.5 py-2 bg-slate-50/90 dark:bg-[#0e1429]/90 border-b border-slate-200/70 dark:border-slate-400/10 flex flex-wrap items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleCoordSceneSelection(sc.id)}
                                  className="w-4 h-4 rounded accent-violet-600 cursor-pointer"
                                />
                                <span>
                                  Chọn Phân cảnh #{idx + 1} đưa sang Trung Tâm Điều Phối AI
                                </span>
                              </label>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                  isChecked
                                    ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35'
                                    : 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-400/25'
                                }`}
                              >
                                {isChecked ? 'Đã chọn điều phối' : 'Bỏ qua khi đẩy'}
                              </span>
                            </div>
                            <StudioSceneCard
                              scene={sc}
                              index={idx}
                              totalScenes={blueprint.scenes.length}
                              mode={studioMode}
                              productionFormat={blueprint.productionFormat || productionFormat}
                              videoStyle={blueprint.videoStyle || videoStyle}
                              learnedStyles={learnedStyles}
                              customStylePrompt={customStylePrompt}
                              characterBible={blueprint.characterBible ?? characterBibleDraft}
                              settingBible={blueprint.settingBible ?? settingBibleDraft}
                              visualStyleBible={blueprint.visualStyleBible ?? visualStyleBibleDraft}
                              costumeBible={blueprint.costumeBible ?? costumeBibleDraft}
                              continuityBible={blueprint.continuityBible ?? continuityBibleDraft}
                              hasCharacterRefs={characters.length > 0}
                              characterRefs={characters}
                              allowFreeCostumeChange={blueprint.allowFreeCostumeChange ?? allowFreeCostumeChange}
                              sources={sources}
                              busyImg={busySceneImageIds.has(sc.id)}
                              queuedImg={queuedSceneImageIds.has(sc.id)}
                              busyVid={busySceneVideoIds.has(sc.id)}
                              sceneErr={sceneImageErrors[sc.id]}
                              sceneVideoEngine={sceneVideoEngine}
                              voiceMode={voiceMode}
                              musicPromptDirective={activeMusicPromptDirective}
                              previewingSceneId={previewingSceneId}
                              capabilities={capabilities}
                              onUpdateScene={updateScene}
                              onDeleteScene={handleDeleteScene}
                              onMoveScene={handleMoveScene}
                              onGenerateImage={(s) => void generateSingleSceneImage(s)}
                              onUploadSceneImage={(sceneId, f) => void handleUploadSceneImage(sceneId, f)}
                              onDeleteSceneImage={handleDeleteSceneImage}
                              onGenerateOmniClip={(s) => void handleGenerateSceneOmniClip(s)}
                              onSpeakPreview={(txt, id) => void handleSpeakOfflineBrowserPreview(txt, id)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* BƯỚC 3: DỰNG LÔ, TIẾN TRÌNH FFMPEG & XUẤT VIDEO MP4                */}
      {/* ================================================================= */}
      <section className={activeStudioStep === 3 ? 'space-y-4' : 'hidden'}>
        <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-3.5">
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Dựng Video Hoàn Chỉnh &amp; Xuất MP4 (FFmpeg)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {blueprint
                  ? `${blueprint.derivativeTitle} · ${blueprint.scenes.length} phân cảnh · ${aspectRatio} · ${
                      voiceMode === 'none' ? 'Không lồng tiếng' : voiceMode === 'offline_system' ? 'VieNeu Offline' : 'AI Voice'
                    }`
                  : 'Chưa có kịch bản — hãy tạo kịch bản ở Bước 1 & 2 trước khi xuất.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveStudioStep(blueprint ? 2 : 1)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{blueprint ? 'Quay lại sửa phân cảnh' : 'Về Bước 1'}</span>
              </button>

              {blueprints.length > 1 && (
                <button
                  type="button"
                  disabled={isGeneratingFinal || isBatchRenderingAll}
                  onClick={handleBatchRenderAllVideos}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-cyan-700 dark:text-cyan-200 bg-cyan-500/15 border border-cyan-500/35 hover:bg-cyan-500/25 rounded-xl transition disabled:opacity-50 cursor-pointer"
                >
                  {isBatchRenderingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListVideo className="w-4 h-4" />}
                  <span>
                    {isBatchRenderingAll ? 'Đang dựng hàng loạt...' : `Dựng Hàng Loạt ${blueprints.length} Video`}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={!blueprint || isDispatchingToCommandCenter}
                onClick={() => void handleDispatchToCommandCenter()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-violet-700 dark:text-violet-200 bg-violet-500/15 border border-violet-500/35 hover:bg-violet-500/25 rounded-xl transition disabled:opacity-45 cursor-pointer whitespace-nowrap"
              >
                {isDispatchingToCommandCenter ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Clapperboard className="w-3.5 h-3.5" />
                )}
                <span>Đẩy sang Trung Tâm Điều Phối AI</span>
              </button>

              <button
                id="btn-studio-render-primary"
                type="button"
                disabled={!blueprint || isGeneratingFinal}
                onClick={handleRenderFinalVideo}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 hover:brightness-110 rounded-xl shadow-lg shadow-violet-600/25 transition disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {isGeneratingFinal && !isBatchRenderingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                <span>
                  {isGeneratingFinal && !isBatchRenderingAll
                    ? 'Đang dựng Video...'
                    : blueprints.length > 1
                    ? `Dựng Video #${activeBatchIndex + 1} (.MP4)`
                    : 'Dựng & Xuất Video (.MP4)'}
                </span>
              </button>
            </div>
          </div>

          {/* Batch Queue Overview (if >1 independent video) */}
          {blueprints.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {blueprints.map((bpItem, idx) => {
                const itemJob = jobsByKey[`${studioMode}:${idx}`];
                const isActive = idx === activeBatchIndex;
                return (
                  <button
                    key={`${bpItem.derivativeTitle}_${idx}`}
                    type="button"
                    onClick={() => setActiveBatchIndex(idx)}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer space-y-1 ${
                      isActive
                        ? 'bg-violet-500/15 border-violet-400/50'
                        : 'bg-slate-50/80 dark:bg-[#0c1021]/80 border-slate-200 dark:border-slate-400/20'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="font-bold text-cyan-600 dark:text-cyan-300">Video {String(idx + 1).padStart(2, '0')}</span>
                      <span className="text-slate-500">{bpItem.scenes.length} cảnh</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {bpItem.derivativeTitle}
                    </div>
                    <div className="text-[11px]">
                      {itemJob?.status === 'completed' ? (
                        <span className="text-emerald-600 dark:text-emerald-300 font-semibold">✓ Đã xuất MP4</span>
                      ) : itemJob?.status === 'partial_error' ? (
                        <span className="text-amber-600 dark:text-amber-300 font-semibold">⚠ Có phân cảnh lỗi</span>
                      ) : itemJob?.status === 'error' ? (
                        <span className="text-rose-500">✕ Lỗi dựng</span>
                      ) : itemJob ? (
                        <span className="text-cyan-600 dark:text-cyan-300">Đang dựng {itemJob.progress}%</span>
                      ) : (
                        <span className="text-slate-400">Chờ dựng</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Export Status & Progress Bar + Per-Scene Progress Tracker + Preview Player */}
          <div className="rounded-2xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-4 space-y-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {!blueprint
                    ? 'Sẵn sàng xử lý luồng dựng video & ghép âm thanh bằng FFmpeg.'
                    : batchRenderStatusText
                    ? batchRenderStatusText
                    : job?.stepLabel
                    ? job.stepLabel
                    : `Sẵn sàng dựng ${blueprint.scenes.length} phân cảnh (${aspectRatio}) chất lượng 1080p HD.`}
                </span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {job ? `${job.progress}%` : '0%'}
                </span>
              </div>

              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    job?.status === 'error'
                      ? 'bg-rose-500'
                      : job?.status === 'partial_error'
                      ? 'bg-amber-500'
                      : job?.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400'
                  }`}
                  style={{ width: `${job ? Math.min(100, Math.max(4, job.progress)) : 0}%` }}
                />
              </div>
            </div>

            {genError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{genError}</span>
              </div>
            )}

            {/* Per-Scene Live Progress & Recovery Controls */}
            {blueprint && blueprint.scenes.length > 0 && (() => {
              const displayScenes: DerivativeSceneProgress[] =
                job?.scenes && job.scenes.length > 0
                  ? job.scenes
                  : blueprint.scenes.map((sc, i) => ({
                      sceneIndex: i,
                      sceneNumber: sc.sceneIndex || i + 1,
                      sceneTitle: sc.sceneTitle || `Phân cảnh #${i + 1}`,
                      progress: sc.omniClipAssetId ? 70 : sc.sceneImageDataUrl ? 25 : 0,
                      status: 'pending',
                      stageLabel: sc.omniClipAssetId
                        ? 'Đã có video sẵn ở Bước 2 — sẽ dùng thẳng khi ghép MP4'
                        : sc.sceneImageDataUrl
                        ? 'Đã có ảnh từ Bước 2 — sẽ dùng thẳng để tạo video (không tạo lại ảnh)'
                        : 'Chưa có ảnh Bước 2 — sẽ khởi tạo khi bấm Dựng & Xuất MP4',
                      imageStatus: sc.sceneImageDataUrl ? 'reused' : 'pending',
                      imageSource: sc.sceneImageDataUrl ? 'step2_reused' : 'none',
                      videoStatus: sc.omniClipAssetId ? 'reused' : 'pending',
                      videoAssetId: sc.omniClipAssetId,
                      videoPreviewUrl: sc.omniClipPreviewUrl,
                      audioStatus: 'pending',
                      renderStatus: 'pending',
                      updatedAt: 0,
                    }));

              const reusedImgCount = displayScenes.filter(
                (s) => s.imageSource === 'step2_reused' || s.imageStatus === 'reused'
              ).length;
              const errorSceneCount = displayScenes.filter((s) => s.status === 'error').length;
              const doneSceneCount = displayScenes.filter((s) => s.status === 'completed').length;
              const canOperateScenes = Boolean(job?.jobId) && !isGeneratingFinal && !isBatchRenderingAll;

              const stageBadgeCls = (st: DerivativeSceneProgress['imageStatus']) => {
                if (st === 'reused')
                  return 'text-cyan-700 dark:text-cyan-300 bg-cyan-500/12 border-cyan-500/30';
                if (st === 'completed')
                  return 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 border-emerald-500/30';
                if (st === 'running')
                  return 'text-violet-700 dark:text-violet-300 bg-violet-500/15 border-violet-500/35';
                if (st === 'error')
                  return 'text-rose-700 dark:text-rose-300 bg-rose-500/15 border-rose-500/35';
                return 'text-slate-500 dark:text-slate-400 bg-slate-200/60 dark:bg-white/5 border-slate-300/60 dark:border-white/10';
              };

              const imageStageText = (sp: DerivativeSceneProgress) => {
                if (sp.imageStatus === 'reused') return 'Ảnh: Dùng sẵn Bước 2';
                if (sp.imageStatus === 'completed') return 'Ảnh: Đã tạo xong';
                if (sp.imageStatus === 'running') return 'Ảnh: Đang tạo...';
                if (sp.imageStatus === 'error') return 'Ảnh: Lỗi';
                return 'Ảnh: Chờ';
              };

              const videoStageText = (sp: DerivativeSceneProgress) => {
                if (sp.videoStatus === 'reused') return 'Video: Dùng sẵn';
                if (sp.videoStatus === 'completed') return 'Video: Đã xong';
                if (sp.videoStatus === 'running') return 'Video: Đang tạo...';
                if (sp.videoStatus === 'error') return 'Video: Lỗi';
                return 'Video: Chờ';
              };

              return (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-400/15">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Tiến trình từng phân cảnh ({doneSceneCount}/{displayScenes.length} hoàn tất)
                      </span>
                      {reusedImgCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md bg-cyan-500/12 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                          <ImageIcon className="w-3 h-3" />
                          <span>{reusedImgCount}/{displayScenes.length} cảnh dùng thẳng ảnh Bước 2</span>
                        </span>
                      )}
                      {errorSceneCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35">
                          <AlertCircle className="w-3 h-3" />
                          <span>{errorSceneCount} phân cảnh lỗi</span>
                        </span>
                      )}
                    </div>

                    {job?.jobId && (job.status === 'partial_error' || job.status === 'error') && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isGeneratingFinal || isResumingRenderJob || Boolean(retryingRenderSceneKey)}
                          onClick={() => void handleResumeRenderJob(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-50 cursor-pointer"
                        >
                          {isResumingRenderJob ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          <span>Khởi tạo lại tiến trình &amp; Xuất MP4</span>
                        </button>
                        <button
                          type="button"
                          disabled={isGeneratingFinal || isResumingRenderJob || Boolean(retryingRenderSceneKey)}
                          onClick={() => void handleResumeRenderJob(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 rounded-lg transition disabled:opacity-50 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Bỏ qua cảnh lỗi &amp; Ghép MP4 ngay</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                    {displayScenes.map((sp, idx) => {
                      const bpScene = blueprint.scenes[idx];
                      const thumbSrc = sp.imagePreviewUrl || bpScene?.sceneImageDataUrl || '';
                      const isRowRetryingImage = retryingRenderSceneKey === `${job?.jobId}:${idx}:image`;
                      const isRowRetryingVideo = retryingRenderSceneKey === `${job?.jobId}:${idx}:video`;
                      const isRowRetryingFull = retryingRenderSceneKey === `${job?.jobId}:${idx}:full`;
                      const isRowBusy =
                        sp.status === 'running' || isRowRetryingImage || isRowRetryingVideo || isRowRetryingFull;
                      const showActionRow =
                        Boolean(job?.jobId) &&
                        (sp.status === 'error' ||
                          job?.status === 'partial_error' ||
                          job?.status === 'error' ||
                          job?.status === 'completed');

                      return (
                        <div
                          key={`render_scene_${idx}`}
                          className={`rounded-xl border p-3 space-y-2 transition ${
                            sp.status === 'error'
                              ? 'bg-rose-500/[0.06] border-rose-500/35'
                              : sp.status === 'running'
                              ? 'bg-violet-500/[0.06] border-violet-400/40'
                              : sp.status === 'completed'
                              ? 'bg-emerald-500/[0.04] border-emerald-500/25'
                              : 'bg-white/70 dark:bg-[#080b18]/70 border-slate-200/80 dark:border-slate-400/15'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-16 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-200/80 dark:bg-slate-800/80 border border-slate-300/60 dark:border-white/10 flex items-center justify-center">
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  alt={`Cảnh #${sp.sceneNumber}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="w-4 h-4 text-slate-400" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {sp.status === 'running' || isRowBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" />
                                  ) : sp.status === 'completed' ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  ) : sp.status === 'error' ? (
                                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                  ) : (
                                    <Film className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )}
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    Phân cảnh #{String(sp.sceneNumber).padStart(2, '0')} · {sp.sceneTitle}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${stageBadgeCls(
                                      sp.imageStatus
                                    )}`}
                                  >
                                    {imageStageText(sp)}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${stageBadgeCls(
                                      sp.videoStatus
                                    )}`}
                                  >
                                    {videoStageText(sp)}
                                  </span>
                                  <span className="text-[11px] font-mono font-bold tabular-nums text-slate-700 dark:text-slate-200 ml-1">
                                    {sp.progress}%
                                  </span>
                                </div>
                              </div>

                              {/* Per-scene Progress Bar */}
                              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-300 ${
                                    sp.status === 'error'
                                      ? 'bg-rose-500'
                                      : sp.status === 'completed'
                                      ? 'bg-emerald-500'
                                      : sp.status === 'running'
                                      ? 'bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400'
                                      : sp.imageStatus === 'reused' || sp.videoStatus === 'reused'
                                      ? 'bg-cyan-500/75'
                                      : 'bg-slate-400/60'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(sp.progress > 0 ? 6 : 0, sp.progress))}%` }}
                                />
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span
                                  className={
                                    sp.status === 'error'
                                      ? 'text-rose-600 dark:text-rose-300 font-semibold'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }
                                >
                                  {sp.stageLabel}
                                </span>
                                {sp.videoPreviewUrl && (
                                  <a
                                    href={sp.videoPreviewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] font-semibold text-cyan-600 dark:text-cyan-300 hover:underline"
                                  >
                                    Xem clip phân cảnh ↗
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Inline Error Banner IMMEDIATELY underneath scene progress bar */}
                          {sp.error && (
                            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-500/12 border border-rose-500/35 text-[11px] text-rose-700 dark:text-rose-200">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                              <div className="space-y-0.5 break-words">
                                <div className="font-bold">
                                  Lỗi tại bước{' '}
                                  {sp.failedStage === 'image'
                                    ? 'Tạo ảnh phân cảnh'
                                    : sp.failedStage === 'video'
                                    ? 'Tạo video phân cảnh'
                                    : sp.failedStage === 'render'
                                    ? 'Dựng FFmpeg'
                                    : 'Xử lý phân cảnh'}
                                  :
                                </div>
                                <div>{sp.error}</div>
                              </div>
                            </div>
                          )}

                          {/* Per-Scene Recovery Controls */}
                          {showActionRow && (
                            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-400/10">
                              <button
                                type="button"
                                disabled={!canOperateScenes || Boolean(retryingRenderSceneKey)}
                                onClick={() => void handleRetryRenderScene(idx, 'image')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-800 dark:text-cyan-200 bg-cyan-500/12 hover:bg-cyan-500/22 border border-cyan-500/30 rounded-lg transition disabled:opacity-45 cursor-pointer"
                              >
                                {isRowRetryingImage ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <ImageIcon className="w-3 h-3" />
                                )}
                                <span>Tạo lại ảnh phân cảnh</span>
                              </button>

                              <button
                                type="button"
                                disabled={!canOperateScenes || Boolean(retryingRenderSceneKey)}
                                onClick={() => void handleRetryRenderScene(idx, 'video')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-violet-800 dark:text-violet-200 bg-violet-500/12 hover:bg-violet-500/22 border border-violet-500/30 rounded-lg transition disabled:opacity-45 cursor-pointer"
                              >
                                {isRowRetryingVideo ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Film className="w-3 h-3" />
                                )}
                                <span>Tạo lại video</span>
                              </button>

                              <button
                                type="button"
                                disabled={!canOperateScenes || Boolean(retryingRenderSceneKey)}
                                onClick={() => void handleRetryRenderScene(idx, 'full')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 rounded-lg transition disabled:opacity-45 cursor-pointer"
                              >
                                {isRowRetryingFull ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3" />
                                )}
                                <span>Khởi tạo lại tiến trình</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {job?.warnings && job.warnings.length > 0 && (
              <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-300 list-disc pl-4">
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            {job?.status === 'completed' && job.jobId && (
              <div className="space-y-3 pt-2">
                <video
                  controls
                  src={`/api/derivative/jobs/${job.jobId}/file`}
                  className="w-full max-h-[440px] rounded-xl bg-black"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {job.fileName} · {job.resolution} · {job.durationSec}s · {job.fileSize ? formatBytes(job.fileSize) : ''}
                  </div>
                  <a
                    href={`/api/derivative/jobs/${job.jobId}/file?download=1`}
                    download={job.fileName || 'studio_video.mp4'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl transition whitespace-nowrap shadow"
                  >
                    <Download className="w-4 h-4" />
                    <span>Tải Video MP4 Về Máy</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <LearnStyleModal
        isOpen={isLearnStyleModalOpen}
        aiProvider={aiProvider}
        useProModel={aiProvider === 'gemini' && useProModel}
        sessdata={sessdata}
        ytCookies={ytCookies}
        onClose={() => setIsLearnStyleModalOpen(false)}
        onLearned={handleStyleLearned}
      />
    </div>
  );
};

