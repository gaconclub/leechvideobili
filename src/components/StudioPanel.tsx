import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import {
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
  DerivativeStylePreset,
  DerivativeVisualMode,
  DerivativeVoiceId,
  DerivativeVoiceMode,
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
  StudioScriptMode,
  StudioUploadedAsset,
  StudioVideoStyle,
  TrendingPlatformId,
  TrendingVideoItem,
} from '../types/bilibili';
import { formatBytes, formatDuration } from '../utils/formatters';
import { getDiscoveryThumbUrl } from './VideoDiscoveryCard';
import {
  autoFixClientBlueprint,
  buildSceneTimelineFallbackClient,
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

  // Mode 1: Creative Idea Inputs (Seed Summary -> AI Expanded Concept -> Step 2 Script)
  const [ideaPrompt, setIdeaPrompt] = useState('');
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
  const [batchVideoCount, setBatchVideoCount] = useState<number>(3);
  const [batchDurationMode, setBatchDurationMode] = useState<'uniform' | 'per_video'>('uniform');
  const [perVideoDurations, setPerVideoDurations] = useState<number[]>([30, 30, 30]);
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

  const handleUpdateBatchVideoCount = (nextRaw: number) => {
    const count = Math.max(2, Math.min(15, Math.round(nextRaw || 2)));
    setBatchVideoCount(count);
    setPerVideoDurations((prev) => {
      const next = [...prev];
      while (next.length < count) {
        next.push(targetDurationSec);
      }
      return next.slice(0, count);
    });
  };

  // Per-scene generation states
  const [imageEngineMode, setImageEngineMode] = useState<'gemini_standard' | 'gemini_pro' | 'muse2api'>(
    studioDefaults.visualMode === 'gemini_omni' ? 'gemini_standard' : 'muse2api'
  );
  const [sceneVideoEngine, setSceneVideoEngine] = useState<'gemini' | 'muse2api'>(
    studioDefaults.visualMode === 'gemini_omni' ? 'gemini' : 'muse2api'
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
  const [musicPrompt, setMusicPrompt] = useState(
    'Nhạc nền hiện đại, truyền cảm hứng, tiết tấu vừa phải cho video kể chuyện'
  );
  const [musicTrackTier, setMusicTrackTier] = useState<'clip' | 'pro'>('clip');
  const [musicVolume, setMusicVolume] = useState(18);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [generatedAiTrack, setGeneratedAiTrack] = useState<StudioMusicTrack | null>(null);
  const [publicMusicQuery, setPublicMusicQuery] = useState('ambient instrumental');
  const [isSearchingMusic, setIsSearchingMusic] = useState(false);
  const [publicMusicResults, setPublicMusicResults] = useState<StudioMusicTrack[]>([]);
  const [selectedPublicTrack, setSelectedPublicTrack] = useState<StudioMusicTrack | null>(null);
  const [uploadedAudioTrack, setUploadedAudioTrack] = useState<StudioMusicTrack | null>(null);
  const [musicError, setMusicError] = useState('');
  const audioUploadInputRef = useRef<HTMLInputElement>(null);

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

  const updateCharacterRef = (charId: string, patch: Partial<StudioCharacterRef>) => {
    setCharacters((prev) => prev.map((c) => (c.id === charId ? { ...c, ...patch } : c)));
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
        return {
          ...c,
          syncProfile: {
            ...currentProfile,
            [field]: value,
          },
        };
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
      setCharacters((prev) =>
        prev.map((c) => {
          const found = profileById.get(c.id);
          if (!found) return c;
          const ageMeta = found.suggestedAgeGroup
            ? CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === found.suggestedAgeGroup)
            : undefined;
          return {
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
        })
      );
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
    try {
      const voiceCfg = buildNewCharacterVoiceConfig();
      let lastCreatedId = '';
      for (const file of files.slice(0, 8)) {
        const dataUrl = await compressImageFileToDataUrl(file, 960);
        const newId = `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        lastCreatedId = newId;
        setCharacters((prev) => {
          if (prev.length >= 8) return prev;
          const fallbackName = file.name.replace(/\.[^.]+$/, '');
          const baseName = charNameInput.trim();
          const finalName = baseName
            ? files.length > 1
              ? `${baseName} ${prev.length + 1}`
              : baseName
            : fallbackName;
          return [
            ...prev,
            {
              id: newId,
              name: finalName,
              dataUrl,
              description: charPromptInput.trim() || undefined,
              source: 'uploaded',
              ...voiceCfg,
            },
          ];
        });
      }
      if (lastCreatedId) {
        setSelectedCharacterId(lastCreatedId);
      }
      setCharNameInput('');
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
            engine: imageEngineMode === 'muse2api' ? 'muse2api' : 'gemini',
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
      setCharacters((prev) => [
        ...prev.slice(0, 7),
        {
          id: newCharId,
          name: (overrideName ?? charNameInput).trim() || `Nhân vật ${prev.length + 1}`,
          description: desc,
          dataUrl: generatedUrl,
          source: 'ai_generated',
          ...voiceCfg,
        },
      ]);
      setSelectedCharacterId(newCharId);
      if (!overrideName) setCharNameInput('');
    } catch (err: any) {
      setCharError(err?.message || 'Không thể tạo ảnh nhân vật AI.');
    } finally {
      setIsGeneratingChar(false);
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

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
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

      if (!res.ok || !data.expandedIdea) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setExpandedIdeaPrompt(data.expandedIdea.trim());
      if (!settingBibleDraft.trim() && data.suggestedSetting?.trim()) {
        setSettingBibleDraft(data.suggestedSetting.trim());
      }
    } catch (err: any) {
      setExpandIdeaError(err?.message || 'AI không thể triển khai ý tưởng lúc này.');
    } finally {
      setIsExpandingIdea(false);
    }
  };

  // AI Learn & Create Script (supports Series mode & Independent Multi-Video Batch mode)
  const handleLearnAndCreateScript = async () => {
    const effectiveCreativeIdea = expandedIdeaPrompt.trim() || ideaPrompt.trim();
    if (studioMode === 'creative') {
      if (!effectiveCreativeIdea && !customInstruction.trim()) {
        setLearnError('Vui lòng nhập tóm tắt ý tưởng (hoặc dùng AI triển khai ý tưởng) ở Bước 1 để lên kịch bản.');
        return;
      }
    } else if (sources.length === 0) {
      setLearnError('Vui lòng tải lên hoặc thêm ít nhất 1 video tham chiếu ở Bước 1.');
      return;
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

    const effectiveBatchDurations =
      scriptMode === 'independent_batch'
        ? Array.from({ length: batchVideoCount }, (_, idx) =>
            batchDurationMode === 'per_video' ? perVideoDurations[idx] || targetDurationSec : targetDurationSec
          )
        : undefined;

    const effectiveStylePreset: DerivativeStylePreset = enableNarrativeStyle
      ? stylePreset === 'none'
        ? 'storytelling_review'
        : stylePreset
      : 'none';

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
          videoCount: scriptMode === 'independent_batch' ? batchVideoCount : 1,
          perVideoDurations: effectiveBatchDurations,
          ideaPrompt: studioMode === 'creative' ? effectiveCreativeIdea : ideaPrompt.trim(),
          query: studioMode === 'creative' ? effectiveCreativeIdea : searchQueryInput.trim() || incomingQuery,
          videos: studioMode === 'derivative' ? sources : [],
          stylePreset: effectiveStylePreset,
          videoStyle,
          customStylePrompt: customStylePrompt.trim(),
          aspectRatio,
          targetDurationSec,
          desiredSceneCount: desiredSceneCount === 'auto' ? undefined : desiredSceneCount,
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
          settingBible: settingBibleDraft.trim(),
          visualStyleBible: visualStyleBibleDraft.trim(),
          costumeBible: costumeBibleDraft.trim(),
          continuityBible: continuityBibleDraft.trim(),
          allowFreeCostumeChange,
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
      if (scriptMode === 'independent_batch') {
        setLearnSuccess(
          `Đã sáng tạo ${returnedList.length} kịch bản video độc lập cùng tinh thần tham chiếu (${styleLabel}).`
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
    }
  };

  // Send Studio idea / script / blueprint directly to Phòng Điều Hành (5 Muse AI)
  const handleDispatchToCommandCenter = async () => {
    const activeIdea = [expandedIdeaPrompt.trim(), ideaPrompt.trim(), customInstruction.trim()]
      .filter(Boolean)
      .join('\n\n');
    const sourceTitles =
      studioMode === 'derivative' && sources.length > 0
        ? `Video tham chiếu (${sources.length}): ${sources.map((s) => s.title || s.sourceUrl).join('; ')}`
        : '';
    const fullDirective = [
      activeIdea,
      sourceTitles,
      blueprint?.learnedSummary ? `Tóm tắt kịch bản:\n${blueprint.learnedSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!fullDirective && !blueprint?.scenes?.length) {
      setCommandCenterError(
        'Vui lòng nhập ý tưởng, hướng dẫn hoặc tạo kịch bản phân cảnh trước khi giao cho Phòng Điều Hành 5 Muse AI.'
      );
      return;
    }

    setIsDispatchingToCommandCenter(true);
    setCommandCenterError('');
    setLearnError('');
    try {
      const resolvedTitle =
        blueprint?.derivativeTitle?.trim() ||
        projectNameInput.trim() ||
        (ideaPrompt.trim() ? ideaPrompt.trim().slice(0, 60) : 'Dự án từ Studio');

      const { syncedChars, changed } = synthesizeSyncedCharacters(characters, costumeBibleDraft.trim());
      if (changed) {
        setCharacters(syncedChars);
      }
      const effectiveAllowFree = blueprint?.allowFreeCostumeChange ?? allowFreeCostumeChange;

      const res = await fetch('/api/command-center/studio-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAction: 'manual_dispatch',
          mode: studioMode,
          title: resolvedTitle,
          ideaOrCommand: fullDirective || resolvedTitle,
          productionFormat: blueprint?.productionFormat || productionFormat,
          aspectRatio,
          videoStyle: blueprint?.videoStyle || videoStyle,
          allowFreeCostumeChange: effectiveAllowFree,
          blueprint: blueprint || undefined,
          characterRefs: syncedChars.slice(0, 8),
          visualBible: blueprint?.visualStyleBible ?? visualStyleBibleDraft.trim(),
          settingBible: blueprint?.settingBible ?? settingBibleDraft.trim(),
          costumeBible: blueprint?.costumeBible ?? costumeBibleDraft.trim(),
          continuityBible: blueprint?.continuityBible ?? continuityBibleDraft.trim(),
        }),
      });
      const data = await parseJsonSafe<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProjectStatusMsg(
        'Đã đồng bộ kịch bản & nhân vật sang Phòng Điều Hành. Chọn nguồn tạo video (AI Gemini / Google Flow / AI Muse) rồi bấm "Bắt đầu sản xuất".'
      );
      onOpenCommandCenter?.();
    } catch (err: any) {
      const msg = err?.message || 'Không thể giao lệnh sang Phòng Điều Hành 5 Muse AI.';
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
        onScreenText: sceneCode,
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
            engine: imageEngineMode === 'muse2api' ? 'muse2api' : 'gemini',
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
      targetEngine: sceneVideoEngine,
      allowFreeCostumeChange: effectiveAllowFree,
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
          durationSec: Math.min(sceneVideoEngine === 'muse2api' ? 12 : 15, Math.max(4, Math.round(sc.durationSec || 8))),
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
          `Không tạo được clip ${sceneVideoEngine === 'muse2api' ? 'Muse2API' : 'Omni Flash'} cho phân cảnh ${sc.sceneIndex}.`
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

  // Music: Lyria AI generation & Wikimedia Commons Audio Search & Upload
  const handleGenerateAiMusic = async () => {
    setIsGeneratingMusic(true);
    setMusicError('');
    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        assetId?: string;
        previewUrl?: string;
        mimeType?: string;
        lyrics?: string;
        durationSec?: number;
        model?: string;
        error?: string;
      }>('/api/studio/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: musicPrompt.trim() || `Instrumental soundtrack for ${blueprint?.derivativeTitle || 'video'}`,
          mode: musicTrackTier,
        }),
      });
      if (!res.ok || !data.assetId) throw new Error(data.error || `HTTP ${res.status}`);
      setGeneratedAiTrack({
        id: data.assetId,
        assetId: data.assetId,
        title: `Lyria AI (${data.model || 'lyria-3'}) · ${data.durationSec || 30}s`,
        url: data.previewUrl,
        source: 'ai_lyria',
        mimeType: data.mimeType,
        durationSec: data.durationSec,
        lyrics: data.lyrics,
      });
    } catch (err: any) {
      setMusicError(err?.message || 'Không thể sáng tác nhạc nền bằng Lyria AI.');
    } finally {
      setIsGeneratingMusic(false);
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
  const renderBlueprintAndAwait = async (
    targetBp: DerivativeBlueprint,
    targetKey: string
  ): Promise<DerivativeJobState> => {
    const voiceObj = VOICE_OPTIONS.find((v) => v.value === voice);
    const activeMusicAssetId =
      musicMode === 'ai_lyria'
        ? generatedAiTrack?.assetId
        : musicMode === 'uploaded'
        ? uploadedAudioTrack?.assetId
        : undefined;

    setJobForKey(targetKey, {
      jobId: '',
      status: 'queued',
      progress: 5,
      stepLabel:
        studioMode === 'creative'
          ? 'Đang gửi yêu cầu dựng video sáng tạo...'
          : 'Đang gửi yêu cầu dựng video phái sinh...',
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
        musicAssetId: activeMusicAssetId,
        publicMusicUrl: musicMode === 'public_free' ? selectedPublicTrack?.url : undefined,
        musicPrompt,
        musicVolume: musicVolume / 100,
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
    const data = await parseJsonSafe<{ jobId?: string; error?: string }>(res);
    if (!res.ok || !data.jobId) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const jobId = data.jobId;
    return new Promise((resolve) => {
      stopPolling();
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const stRes = await fetch(`/api/derivative/jobs/${jobId}`);
          if (!stRes.ok) return;
          const stData = await parseJsonSafe<DerivativeJobState>(stRes);
          setJobForKey(targetKey, stData);
          if (stData.status === 'completed' || stData.status === 'error') {
            stopPolling();
            resolve(stData);
          }
        } catch {
          // ignore transient poll error
        }
      }, 1400);
    });
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
      const finalState = await renderBlueprintAndAwait(blueprint, activeJobKey);
      if (finalState.status === 'error') {
        setGenError(finalState.error || 'Tạo video thất bại.');
      }
    } catch (err: any) {
      setGenError(err?.message || 'Không thể khởi tạo tác vụ dựng video.');
    } finally {
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
        const result = await renderBlueprintAndAwait(bp, key);
        if (result.status === 'error') failed += 1;
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
      setGenError(`Hoàn tất dựng hàng loạt: có ${failed}/${blueprints.length} video gặp lỗi — bấm vào từng video để xem chi tiết.`);
    }
  };

  const totalSceneSec = blueprint
    ? Math.round(blueprint.scenes.reduce((sum, s) => sum + Number(s.durationSec || 0), 0))
    : 0;
  const hasExpandedCreativeIdea = Boolean(expandedIdeaPrompt.trim());
  const canSubmitLearn =
    studioMode === 'creative'
      ? Boolean(expandedIdeaPrompt.trim() || ideaPrompt.trim() || customInstruction.trim())
      : sources.length > 0;

  const inputCls =
    'w-full h-9 px-3 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400';

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
                ? `${sources.length} nguồn`
                : expandedIdeaPrompt.trim()
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
                        setExpandedIdeaPrompt('');
                        setExpandIdeaError('');
                        setVideoStyle(starter.style);
                        setDesiredSceneCount(starter.scenes);
                        setTargetDurationSec(starter.dur);
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

                {/* Button: Dùng AI triển khai ý tưởng của bạn */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isExpandingIdea || !ideaPrompt.trim()}
                    onClick={() => void handleExpandIdeaWithAi()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-600 hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs shadow-md shadow-indigo-500/20 transition cursor-pointer"
                  >
                    {isExpandingIdea ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>AI đang triển khai ý tưởng...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>
                          {expandedIdeaPrompt.trim()
                            ? 'Dùng AI triển khai lại ý tưởng'
                            : 'Dùng AI triển khai ý tưởng của bạn'}
                        </span>
                      </>
                    )}
                  </button>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kết quả trả về bên dưới sẽ truyền thẳng sang Bước 2
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

                {/* Result returned directly below & passed to Step 2 AI Lên Kịch Bản */}
                {(expandedIdeaPrompt || isExpandingIdea) && (
                  <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/5 dark:bg-cyan-500/10 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Ý tưởng đã triển khai
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30">
                          Truyền sang Bước 2 · AI Lên Kịch Bản
                        </span>
                      </div>
                      {expandedIdeaPrompt && (
                        <button
                          type="button"
                          onClick={() => setExpandedIdeaPrompt('')}
                          className="text-[11px] text-slate-500 hover:text-rose-500 cursor-pointer"
                        >
                          Xóa kết quả
                        </button>
                      )}
                    </div>

                    {isExpandingIdea && !expandedIdeaPrompt ? (
                      <div className="flex items-center gap-2 py-4 justify-center text-xs text-cyan-700 dark:text-cyan-200">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang phân tích tóm tắt và triển khai nội dung chi tiết...</span>
                      </div>
                    ) : (
                      <textarea
                        rows={6}
                        value={expandedIdeaPrompt}
                        onChange={(e) => setExpandedIdeaPrompt(e.target.value)}
                        aria-label="Kết quả ý tưởng đã triển khai"
                        className="w-full p-2.5 text-xs bg-white dark:bg-[#0c1021] border border-cyan-400/35 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-400 resize-y leading-relaxed"
                      />
                    )}
                  </div>
                )}
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

                    <input
                      type="text"
                      value={ideaPrompt}
                      onChange={(e) => setIdeaPrompt(e.target.value)}
                      placeholder="Góc nhìn / Ý tưởng phát triển thêm từ nguồn (tùy chọn)..."
                      className={inputCls}
                    />
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
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                    Engine: <strong className="text-cyan-600 dark:text-cyan-300">{imageEngineMode === 'muse2api' ? 'Muse2API' : imageEngineMode === 'gemini_pro' ? 'Nano Pro' : 'Gemini'}</strong>
                  </span>
                  <input
                    ref={charUploadInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleUploadCharacters}
                    className="hidden"
                  />
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

              {characters.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {characters.map((ch, idx) => {
                    const isActiveChar = selectedChar?.id === ch.id;
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
                        <span className="absolute bottom-0.5 left-0.5 px-1 py-0.5 text-[9px] font-mono font-bold bg-black/70 text-white rounded">
                          #{idx + 1}
                        </span>
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
                            aria-label="Xóa nhân vật"
                            title="Xóa nhân vật"
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
                <div className="space-y-2">
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
                      <div className="font-bold">1 video Series liên hoàn</div>
                      <div className="text-[11px] opacity-80">1 câu chuyện đồng nhất xuyên suốt</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setScriptMode('independent_batch');
                        if (desiredSceneCount === 10) setDesiredSceneCount('auto');
                      }}
                      className={`text-left p-2.5 rounded-xl border transition cursor-pointer ${
                        scriptMode === 'independent_batch'
                          ? 'bg-violet-500/15 border-violet-400/50 text-slate-900 dark:text-white'
                          : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <div className="font-bold">Lô nhiều video độc lập (2–15)</div>
                      <div className="text-[11px] opacity-80">Nhiều câu chuyện riêng cùng chủ đề</div>
                    </button>
                  </div>

                  {showScriptModeGuide && (
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                      <p>
                        <strong className="text-violet-600 dark:text-violet-300">Series:</strong> Kể 1 cốt truyện liên tục nhiều cảnh (mặc định 10 cảnh), khóa chặt nhân vật &amp; bối cảnh từ đầu đến cuối.
                      </p>
                      <p>
                        <strong className="text-cyan-600 dark:text-cyan-300">Nhiều video độc lập:</strong> Tạo cùng lúc 2–15 kịch bản tách rời nhau, giữ chung tinh thần/phong cách để xuất hàng loạt.
                      </p>
                    </div>
                  )}

                  {scriptMode === 'independent_batch' && (
                    <div className="p-3 rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Số video độc lập:</span>
                        <div className="flex flex-wrap items-center gap-1">
                          {[2, 3, 5, 8, 10].map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => handleUpdateBatchVideoCount(cnt)}
                              className={`h-7 px-2.5 text-[11px] rounded-lg border transition tabular-nums cursor-pointer ${
                                batchVideoCount === cnt
                                  ? 'bg-violet-500/20 text-violet-700 dark:text-violet-200 border-violet-400/50 font-bold'
                                  : 'bg-white dark:bg-[#131a35] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-400/20'
                              }`}
                            >
                              {cnt}
                            </button>
                          ))}
                          <input
                            type="number"
                            min={2}
                            max={15}
                            value={batchVideoCount}
                            onChange={(e) => handleUpdateBatchVideoCount(Number(e.target.value))}
                            aria-label="Số lượng video muốn tạo"
                            className="w-14 h-7 px-1.5 text-[11px] font-mono tabular-nums text-center bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-400/15">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">Thời lượng mỗi video:</span>
                        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-400/20 overflow-hidden bg-white dark:bg-[#131a35]">
                          <button
                            type="button"
                            onClick={() => setBatchDurationMode('uniform')}
                            className={`px-2 py-1 text-[11px] cursor-pointer ${
                              batchDurationMode === 'uniform'
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Chung ({targetDurationSec}s)
                          </button>
                          <button
                            type="button"
                            onClick={() => setBatchDurationMode('per_video')}
                            className={`px-2 py-1 text-[11px] cursor-pointer ${
                              batchDurationMode === 'per_video'
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Riêng từng video
                          </button>
                        </div>
                      </div>

                      {batchDurationMode === 'per_video' && (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                          {Array.from({ length: batchVideoCount }, (_, idx) => (
                            <label
                              key={idx}
                              className="flex items-center justify-between gap-1 px-2 py-1 rounded-lg bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20"
                            >
                              <span className="text-[10px] font-mono text-slate-500">V{idx + 1}</span>
                              <input
                                type="number"
                                min={10}
                                max={900}
                                step={5}
                                value={perVideoDurations[idx] ?? targetDurationSec}
                                onChange={(e) => {
                                  const val = Math.max(10, Math.min(900, Number(e.target.value) || 10));
                                  setPerVideoDurations((prev) => {
                                    const next = Array.from({ length: batchVideoCount }, (__, j) => prev[j] ?? targetDurationSec);
                                    next[idx] = val;
                                    return next;
                                  });
                                }}
                                className="w-12 text-[11px] font-mono text-right bg-transparent text-slate-900 dark:text-white focus:outline-none"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

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

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {scriptMode === 'independent_batch' ? 'Số cảnh mỗi video' : 'Số phân cảnh Series'}
                    </span>
                    <select
                      value={String(desiredSceneCount)}
                      onChange={(e) => setDesiredSceneCount(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                      className={inputCls}
                    >
                      <option value="auto">Tự động khớp thời lượng (Khuyên dùng)</option>
                      <option value="1">1 phân cảnh (Toàn bộ thời lượng)</option>
                      <option value="2">2 phân cảnh</option>
                      <option value="3">3 phân cảnh</option>
                      <option value="4">4 phân cảnh</option>
                      <option value="5">5 phân cảnh</option>
                      <option value="6">6 phân cảnh</option>
                      <option value="8">8 phân cảnh</option>
                      <option value="10">10 phân cảnh</option>
                      <option value="12">12 phân cảnh</option>
                      <option value="16">16 phân cảnh</option>
                      <option value="20">20 phân cảnh</option>
                    </select>
                  </label>

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

                {/* Unified Single Duration Selector Bar */}
                <div className="space-y-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-400/15">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    <Clock className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
                    <span>Thời lượng video:</span>
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
                      else if (nextMode === 'gemini_omni') setSceneVideoEngine('gemini');
                    }}
                    className={inputCls}
                  >
                    <option value="muse2api_video">
                      Muse2API Video (muse-video · Ưu tiên · {capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Engine tạo ảnh (Nhân vật &amp; Cảnh)</span>
                    <select
                      value={imageEngineMode}
                      onChange={(e) => setImageEngineMode(e.target.value as 'gemini_standard' | 'gemini_pro' | 'muse2api')}
                      className={inputCls}
                    >
                      <option value="muse2api">
                        Muse2API ({capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                      </option>
                      <option value="gemini_standard">Gemini Flash Image</option>
                      <option value="gemini_pro">Nano Banana 2.1 (1K)</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Engine dựng clip từng cảnh</span>
                    <select
                      value={sceneVideoEngine}
                      onChange={(e) => setSceneVideoEngine(e.target.value as 'gemini' | 'muse2api')}
                      className={inputCls}
                    >
                      <option value="muse2api">Muse2API (muse-video · Ưu tiên)</option>
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
                          ? 'Nhạc nền AI linh động theo bối cảnh'
                          : 'Ghép nhạc nền'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {musicMode !== 'none' && (
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          Âm lượng {musicVolume}%
                        </span>
                      )}
                      {productionFormat === 'narration_story' && (
                        <button
                          type="button"
                          onClick={() => setShowManualNarrationMusic((v) => !v)}
                          className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer"
                        >
                          {showManualNarrationMusic ? 'Ẩn tùy chỉnh tay' : 'Chọn nhạc thủ công'}
                        </button>
                      )}
                    </div>
                  </div>

                  {productionFormat === 'narration_story' && !showManualNarrationMusic ? (
                    <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-400/30 space-y-2">
                      <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                        Chế độ <strong>Phim thuyết minh kể chuyện</strong> tự động ưu tiên AI sáng tác hoặc chọn nhạc nền khớp với cảm xúc và bối cảnh kịch bản mà không cần cài đặt thủ công từng cảnh.
                      </div>
                      {musicMode !== 'none' && (
                        <input
                          type="range"
                          min={5}
                          max={45}
                          value={musicVolume}
                          onChange={(e) => setMusicVolume(Number(e.target.value))}
                          aria-label="Âm lượng nhạc nền"
                          className="w-full accent-violet-500"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <select
                        value={musicMode}
                        onChange={(e) => setMusicMode(e.target.value as DerivativeMusicMode)}
                        aria-label="Nguồn nhạc nền"
                        className={inputCls}
                      >
                        <option value="auto_adaptive">AI tự động chọn nhạc nền phù hợp bối cảnh</option>
                        <option value="none">Không chèn nhạc nền</option>
                        <option value="ai_lyria">Nhạc nền AI sáng tác (Lyria · Trả phí)</option>
                        <option value="public_free">Nhạc công cộng miễn phí (Wikimedia Audio)</option>
                        <option value="uploaded">Tải tệp nhạc từ máy (.mp3 / .wav)</option>
                      </select>

                      {musicMode !== 'none' && (
                        <input
                          type="range"
                          min={5}
                          max={45}
                          value={musicVolume}
                          onChange={(e) => setMusicVolume(Number(e.target.value))}
                          aria-label="Âm lượng nhạc nền"
                          className="w-full accent-violet-500"
                        />
                      )}
                    </>
                  )}

                  {musicMode === 'ai_lyria' && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={musicPrompt}
                        onChange={(e) => setMusicPrompt(e.target.value)}
                        placeholder="Mô tả phong cách nhạc..."
                        className={inputCls}
                      />
                      <div className="flex gap-2">
                        <select
                          value={musicTrackTier}
                          onChange={(e) => setMusicTrackTier(e.target.value as 'clip' | 'pro')}
                          className="h-8 px-2 text-[11px] bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl"
                        >
                          <option value="clip">Lyria Clip (30s)</option>
                          <option value="pro">Lyria Pro</option>
                        </select>
                        <button
                          type="button"
                          disabled={isGeneratingMusic}
                          onClick={handleGenerateAiMusic}
                          className="flex-1 h-8 px-3 text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          {isGeneratingMusic ? 'Đang tạo nhạc...' : 'Tạo nhạc AI trước'}
                        </button>
                      </div>
                      {generatedAiTrack?.url && <audio controls src={generatedAiTrack.url} className="w-full h-8" />}
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
              onClick={handleLearnAndCreateScript}
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
              {scriptMode === 'independent_batch' ? `${batchVideoCount} video độc lập` : '1 Series'} · {aspectRatio} ·{' '}
              {targetDurationSec}s · {voiceMode === 'none' ? 'Không lồng tiếng' : voiceMode === 'offline_system' ? 'VieNeu Offline' : 'AI Voice'}
            </span>
            {studioMode === 'creative' && hasExpandedCreativeIdea && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-200 border border-cyan-400/30 text-[10px] font-semibold">
                <Sparkles className="w-3 h-3" />
                Truyền ý tưởng AI đã triển khai
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
              <span>Giao Phòng Điều Hành (5 Muse AI)</span>
            </button>
            <button
              type="button"
              disabled={isLearning || !canSubmitLearn}
              onClick={handleLearnAndCreateScript}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 text-white font-bold text-xs sm:text-sm shadow-lg shadow-violet-600/25 transition disabled:opacity-50 cursor-pointer"
            >
              {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {isLearning
                  ? scriptMode === 'independent_batch'
                    ? `Đang sáng tạo ${batchVideoCount} kịch bản (${learningElapsedSec}s)...`
                    : `AI đang lên kịch bản (${learningElapsedSec}s)...`
                  : scriptMode === 'independent_batch'
                  ? `AI Lên ${batchVideoCount} Kịch Bản & Sang Bước 2`
                  : 'AI Lên Kịch Bản & Sang Bước 2'}
              </span>
              {!isLearning && <ArrowRight className="w-4 h-4" />}
            </button>
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
              Quay lại <strong>Bước 1</strong> để nhập ý tưởng hoặc thêm video tham chiếu rồi bấm <strong>AI Lên Kịch Bản</strong>.
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
              {canSubmitLearn && (
                <button
                  type="button"
                  disabled={isLearning}
                  onClick={handleLearnAndCreateScript}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer"
                >
                  {isLearning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Tạo kịch bản ngay</span>
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
                    <span>Giao đội 5 Muse AI sản xuất</span>
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
                  targetEngine: sceneVideoEngine,
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

              <div className="divide-y divide-slate-200 dark:divide-slate-400/15 border border-slate-200 dark:border-slate-400/20 rounded-2xl overflow-hidden">
                {blueprint.scenes.map((sc, idx) => (
                  <StudioSceneCard
                    key={sc.id}
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
                ))}
              </div>
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
                <span>Giao Phòng Điều Hành (5 Muse AI)</span>
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

          {/* Export Status & Progress Bar + Preview Player */}
          <div className="rounded-2xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-600 dark:text-slate-300 font-medium">
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
                    : job?.status === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400'
                }`}
                style={{ width: `${job ? Math.min(100, Math.max(4, job.progress)) : 0}%` }}
              />
            </div>

            {genError && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{genError}</span>
              </div>
            )}

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

