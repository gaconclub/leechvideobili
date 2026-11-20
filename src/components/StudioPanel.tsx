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
} from 'lucide-react';
import {
  AiProviderId,
  BrollSourceId,
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
  OfflineTtsVoiceOption,
  ServerCapabilitiesStatus,
  StudioCharacterRef,
  StudioCreationMode,
  StudioDefaultConfig,
  StudioLibraryVideoItem,
  StudioMusicTrack,
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
  compileScenePromptClient,
  compressImageFileToDataUrl,
  DURATION_PRESETS,
  fetchStudioJsonWithAutoRetry,
  LANGUAGE_OPTIONS,
  parseJsonSafe,
  STYLE_OPTIONS,
  uploadMediaFileToStudio,
  VIDEO_STYLE_OPTIONS,
  VOICE_OPTIONS,
} from './studio/studioConfig';
import { StudioSceneCard } from './studio/StudioSceneCard';

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
  const [charNameInput, setCharNameInput] = useState('');
  const [charPromptInput, setCharPromptInput] = useState('');
  const [charVoiceModeInput, setCharVoiceModeInput] = useState<'default' | 'ai_online' | 'offline_system'>('default');
  const [charVoiceIdInput, setCharVoiceIdInput] = useState<Exclude<DerivativeVoiceId, 'none'>>('Kore');
  const [charOfflineVoiceInput, setCharOfflineVoiceInput] = useState<string>('');
  const [isGeneratingChar, setIsGeneratingChar] = useState(false);
  const [charError, setCharError] = useState('');
  const charUploadInputRef = useRef<HTMLInputElement>(null);

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
  const [learnError, setLearnError] = useState('');
  const [learnSuccess, setLearnSuccess] = useState('');

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

  // Character uploads & AI generation (always adheres to active videoStyle for visual consistency!)
  const buildNewCharacterVoiceConfig = () => {
    const voiceObj = VOICE_OPTIONS.find((v) => v.value === charVoiceIdInput);
    const resolvedOfflineVoice = charOfflineVoiceInput || offlineVoice || offlineVoices[0]?.id || undefined;
    return {
      voiceMode: charVoiceModeInput,
      voiceId: charVoiceModeInput === 'ai_online' ? charVoiceIdInput : undefined,
      offlineVoice: charVoiceModeInput === 'offline_system' ? resolvedOfflineVoice : undefined,
      voiceStyle: charVoiceModeInput === 'ai_online' ? voiceObj?.style : undefined,
    };
  };

  const updateCharacterRef = (charId: string, patch: Partial<StudioCharacterRef>) => {
    setCharacters((prev) => prev.map((c) => (c.id === charId ? { ...c, ...patch } : c)));
  };

  const handleUploadCharacters = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setCharError('');
    try {
      const voiceCfg = buildNewCharacterVoiceConfig();
      for (const file of files.slice(0, 8)) {
        const dataUrl = await compressImageFileToDataUrl(file, 960);
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
              id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: finalName,
              dataUrl,
              description: charPromptInput.trim() || undefined,
              source: 'uploaded',
              ...voiceCfg,
            },
          ];
        });
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
            characterBible: blueprint?.characterBible || characterBibleDraft || desc,
            settingBible: blueprint?.settingBible || settingBibleDraft,
            visualStyleBible: blueprint?.visualStyleBible || visualStyleBibleDraft,
            costumeBible: blueprint?.costumeBible || costumeBibleDraft,
            continuityBible: blueprint?.continuityBible || continuityBibleDraft,
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      const generatedUrl = data.dataUrl;
      const voiceCfg = buildNewCharacterVoiceConfig();
      setCharacters((prev) => [
        ...prev.slice(0, 7),
        {
          id: `char_ai_${Date.now()}`,
          name: (overrideName ?? charNameInput).trim() || `Nhân vật ${prev.length + 1}`,
          description: desc,
          dataUrl: generatedUrl,
          source: 'ai_generated',
          ...voiceCfg,
        },
      ]);
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

    const charSummary = characters
      .map((c) => [c.name, c.description].filter(Boolean).join(' - '))
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
          scriptMode,
          targetDurationSec,
          outputLanguage,
          characterSummary: charSummary,
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

    const charSummary = characters
      .map((c) => {
        const voiceNote =
          c.voiceMode === 'offline_system'
            ? `Giọng VieNeu: ${c.offlineVoice || 'Mặc định'}`
            : c.voiceMode === 'ai_online'
            ? `Giọng AI: ${c.voiceId || voice}`
            : '';
        return [c.name, c.description, voiceNote].filter(Boolean).join(' - ');
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
          videoCount: scriptMode === 'independent_batch' ? batchVideoCount : 1,
          perVideoDurations: effectiveBatchDurations,
          ideaPrompt: studioMode === 'creative' ? effectiveCreativeIdea : ideaPrompt.trim(),
          query: studioMode === 'creative' ? effectiveCreativeIdea : searchQueryInput.trim() || incomingQuery,
          videos: studioMode === 'derivative' ? sources : [],
          stylePreset: effectiveStylePreset,
          videoStyle,
          aspectRatio,
          targetDurationSec,
          desiredSceneCount: desiredSceneCount === 'auto' ? undefined : desiredSceneCount,
          outputLanguage,
          useProModel: aiProvider === 'gemini' && useProModel,
          characterSummary: charSummary,
          characterBible: characterBibleDraft.trim(),
          settingBible: settingBibleDraft.trim(),
          visualStyleBible: visualStyleBibleDraft.trim(),
          costumeBible: costumeBibleDraft.trim(),
          continuityBible: continuityBibleDraft.trim(),
          customInstruction: customInstruction.trim(),
          enableVoiceover: voiceMode !== 'none',
          aiProvider,
        }),
      });

      const returnedList =
        Array.isArray(data.blueprints) && data.blueprints.length > 0
          ? data.blueprints
          : data.blueprint
          ? [data.blueprint]
          : [];

      if (!res.ok || returnedList.length === 0) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setBatchBlueprintsByMode((prev) => ({ ...prev, [studioMode]: returnedList }));
      setActiveBatchIdxByMode((prev) => ({ ...prev, [studioMode]: 0 }));
      setSharedSpiritByMode((prev) => ({
        ...prev,
        [studioMode]: data.sharedSpiritNote || returnedList[0]?.sharedSpiritNote || '',
      }));

      const first = returnedList[0];
      if (first?.characterBible) setCharacterBibleDraft(first.characterBible);
      if (first?.settingBible) setSettingBibleDraft(first.settingBible);
      if (first?.visualStyleBible) setVisualStyleBibleDraft(first.visualStyleBible);
      if (first?.costumeBible) setCostumeBibleDraft(first.costumeBible);
      if (first?.continuityBible) setContinuityBibleDraft(first.continuityBible);

      const styleLabel = VIDEO_STYLE_OPTIONS.find((s) => s.value === (first?.videoStyle || videoStyle))?.label || '';
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
      const styleMeta = VIDEO_STYLE_OPTIONS.find((s) => s.value === (prev.videoStyle || videoStyle)) || VIDEO_STYLE_OPTIONS[1];
      const lastScene = prev.scenes[idx - 1];
      const sceneCode = `Scene ${String(idx + 1).padStart(2, '0')}`;
      const newScene: DerivativeScene = {
        id: `scene_custom_${Date.now()}`,
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
    const compiledPrompt = compileScenePromptClient({
      scene: sc,
      videoStyle: activeStyle,
      characterBible: activeCharBible,
      settingBible: activeSettingBible,
      visualStyleBible: activeVisualStyleBible,
      costumeBible: activeCostumeBible,
      continuityBible: activeContinuityBible,
      totalScenes: blueprint.scenes.length,
      mediaType: 'image',
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
            characterBible: activeCharBible,
            settingBible: activeSettingBible,
            visualStyleBible: activeVisualStyleBible,
            costumeBible: activeCostumeBible,
            continuityBible: activeContinuityBible,
            sceneIndex: sc.sceneIndex,
            totalScenes: blueprint.scenes.length,
            charactersInScene: sc.charactersInScene || '',
            actionDetail: sc.actionDetail || '',
            dialogue: sc.dialogue || '',
            sceneSummary: sc.sceneSummary || '',
            costume: sc.costume || '',
            characterRefs: characters.map((c) => ({
              dataUrl: c.dataUrl,
              name: c.name,
              description: c.description,
            })),
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      updateScene(sc.id, { sceneImageDataUrl: data.dataUrl });
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
      updateScene(sceneId, { sceneImageDataUrl: dataUrl });
    } catch (err: any) {
      setSceneMediaError(err?.message || 'Không đọc được ảnh tải lên.');
    }
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
    const compiledPrompt = compileScenePromptClient({
      scene: sc,
      videoStyle: activeStyle,
      characterBible: activeCharBible,
      settingBible: activeSettingBible,
      visualStyleBible: activeVisualStyleBible,
      costumeBible: activeCostumeBible,
      continuityBible: activeContinuityBible,
      totalScenes: blueprint.scenes.length,
      mediaType: 'video',
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
          characterBible: activeCharBible,
          settingBible: activeSettingBible,
          visualStyleBible: activeVisualStyleBible,
          costumeBible: activeCostumeBible,
          continuityBible: activeContinuityBible,
          sceneIndex: sc.sceneIndex,
          totalScenes: blueprint.scenes.length,
          charactersInScene: sc.charactersInScene || '',
          actionDetail: sc.actionDetail || '',
          dialogue: sc.dialogue || '',
          sceneSummary: sc.sceneSummary || '',
          costume: sc.costume || '',
          sceneImageDataUrl: sc.sceneImageDataUrl,
          characterRefs: characters.map((c) => ({
            dataUrl: c.dataUrl,
            name: c.name,
            description: c.description,
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
    overrideOfflineVoice?: string
  ) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    const effectiveMode =
      overrideVoiceMode && overrideVoiceMode !== 'default' ? overrideVoiceMode : voiceMode;
    const effectiveOfflineVoice = overrideOfflineVoice || offlineVoice;

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
          videoStyle: targetBp.videoStyle || videoStyle,
          characterBible: targetBp.characterBible ?? characterBibleDraft,
          settingBible: targetBp.settingBible ?? settingBibleDraft,
          visualStyleBible: targetBp.visualStyleBible ?? visualStyleBibleDraft,
          costumeBible: targetBp.costumeBible ?? costumeBibleDraft,
          continuityBible: targetBp.continuityBible ?? continuityBibleDraft,
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
          dataUrl: c.dataUrl,
          name: c.name,
          description: c.description,
          voiceMode: c.voiceMode || 'default',
          voiceId: c.voiceId,
          offlineVoice: c.offlineVoice,
          voiceStyle: c.voiceStyle,
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                  <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Nhân vật đồng bộ ({characters.length}/8)
                  </h2>
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

              {/* Pre-assign dedicated voice when uploading or creating a character */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                <select
                  value={charVoiceModeInput}
                  onChange={(e) =>
                    setCharVoiceModeInput(e.target.value as 'default' | 'ai_online' | 'offline_system')
                  }
                  aria-label="Chế độ giọng nhân vật mới"
                  className={`sm:col-span-5 ${inputCls}`}
                >
                  <option value="default">Giọng mặc định theo video</option>
                  <option value="ai_online">Đặt giọng riêng (AI Online)</option>
                  {offlineVoices.length > 0 && (
                    <option value="offline_system">Đặt giọng riêng (VieNeu Offline)</option>
                  )}
                </select>
                {charVoiceModeInput === 'ai_online' && (
                  <select
                    value={charVoiceIdInput}
                    onChange={(e) =>
                      setCharVoiceIdInput(e.target.value as Exclude<DerivativeVoiceId, 'none'>)
                    }
                    aria-label="Chọn giọng AI cho nhân vật mới"
                    className={`sm:col-span-7 ${inputCls}`}
                  >
                    {VOICE_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}
                {charVoiceModeInput === 'offline_system' && (
                  <select
                    value={charOfflineVoiceInput || offlineVoice || offlineVoices[0]?.id || ''}
                    onChange={(e) => setCharOfflineVoiceInput(e.target.value)}
                    aria-label="Chọn giọng VieNeu cho nhân vật mới"
                    className={`sm:col-span-7 ${inputCls}`}
                  >
                    {offlineVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.description || v.id}
                      </option>
                    ))}
                  </select>
                )}
                {charVoiceModeInput === 'default' && (
                  <div className="sm:col-span-7 h-9 px-3 flex items-center text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0c1021]/60 border border-dashed border-slate-200 dark:border-slate-400/20 rounded-xl truncate">
                    Đặt tên &amp; giọng riêng ngay khi tạo hoặc chỉnh trực tiếp bên dưới
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
                  {characters.map((ch, idx) => (
                    <div
                      key={ch.id}
                      className="flex gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50/90 dark:bg-[#0c1021]/90"
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
                            onClick={() =>
                              setCharacters((prev) => prev.filter((item) => item.id !== ch.id))
                            }
                            aria-label="Xóa nhân vật"
                            title="Xóa nhân vật"
                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <select
                            value={ch.voiceMode || 'default'}
                            onChange={(e) => {
                              const nextMode = e.target.value as 'default' | 'ai_online' | 'offline_system';
                              updateCharacterRef(ch.id, {
                                voiceMode: nextMode,
                                voiceId:
                                  nextMode === 'ai_online' ? ch.voiceId || charVoiceIdInput || 'Kore' : ch.voiceId,
                                offlineVoice:
                                  nextMode === 'offline_system'
                                    ? ch.offlineVoice || offlineVoice || offlineVoices[0]?.id
                                    : ch.offlineVoice,
                              });
                            }}
                            aria-label="Loại giọng nhân vật"
                            className="h-6 px-1.5 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none"
                          >
                            <option value="default">Mặc định</option>
                            <option value="ai_online">AI Online</option>
                            {offlineVoices.length > 0 && <option value="offline_system">VieNeu</option>}
                          </select>

                          {(ch.voiceMode || 'default') === 'ai_online' && (
                            <select
                              value={ch.voiceId || 'Kore'}
                              onChange={(e) => {
                                const vid = e.target.value as Exclude<DerivativeVoiceId, 'none'>;
                                const meta = VOICE_OPTIONS.find((v) => v.value === vid);
                                updateCharacterRef(ch.id, {
                                  voiceId: vid,
                                  voiceStyle: meta?.style,
                                });
                              }}
                              aria-label="Giọng AI riêng của nhân vật"
                              className="flex-1 min-w-0 h-6 px-1.5 text-[10px] bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none"
                            >
                              {VOICE_OPTIONS.map((v) => (
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
                                updateCharacterRef(ch.id, { offlineVoice: e.target.value })
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

                          <button
                            type="button"
                            disabled={previewingSceneId === `char_${ch.id}`}
                            onClick={() =>
                              void handleSpeakOfflineBrowserPreview(
                                `Xin chào, tôi là ${ch.name || 'nhân vật chính'}.`,
                                `char_${ch.id}`,
                                ch.voiceMode,
                                ch.offlineVoice
                              )
                            }
                            title="Nghe thử giọng nhân vật này"
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
                  ))}
                </div>
              )}

              {/* Collapsible Pre-generation 5-Bible Notes */}
              <div className="pt-1 border-t border-slate-200/80 dark:border-slate-400/15">
                <button
                  type="button"
                  onClick={() => setShowDraftBible((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer"
                >
                  {showDraftBible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>Khóa trước Hồ sơ đồng bộ 5 thành phần (tùy chọn)</span>
                </button>

                {showDraftBible && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 text-xs">
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

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Phong cách hình ảnh</span>
                    <select value={videoStyle} onChange={(e) => setVideoStyle(e.target.value as StudioVideoStyle)} className={inputCls}>
                      {VIDEO_STYLE_OPTIONS.map((st) => (
                        <option key={st.value} value={st.value}>{st.label}</option>
                      ))}
                    </select>
                  </label>

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
                  <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                    <Mic className="w-4 h-4" />
                    <span>Lồng tiếng &amp; Giọng đọc</span>
                  </div>

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
                    <select
                      value={voice}
                      onChange={(e) => setVoice(e.target.value as Exclude<DerivativeVoiceId, 'none'>)}
                      aria-label="Chọn chất giọng AI"
                      className={inputCls}
                    >
                      {VOICE_OPTIONS.map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-violet-700 dark:text-violet-300">
                      <Music className="w-4 h-4" />
                      <span>Ghép nhạc nền</span>
                    </div>
                    {musicMode !== 'none' && (
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        Âm lượng {musicVolume}%
                      </span>
                    )}
                  </div>

                  <select
                    value={musicMode}
                    onChange={(e) => setMusicMode(e.target.value as DerivativeMusicMode)}
                    aria-label="Nguồn nhạc nền"
                    className={inputCls}
                  >
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
                      className="w-full accent-violet-500"
                    />
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
              disabled={isLearning || !canSubmitLearn}
              onClick={handleLearnAndCreateScript}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 text-white font-bold text-xs sm:text-sm shadow-lg shadow-violet-600/25 transition disabled:opacity-50 cursor-pointer"
            >
              {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {isLearning
                  ? scriptMode === 'independent_batch'
                    ? `Đang sáng tạo ${batchVideoCount} kịch bản...`
                    : 'AI đang lên kịch bản...'
                  : scriptMode === 'independent_batch'
                  ? `AI Lên ${batchVideoCount} Kịch Bản & Sang Bước 2`
                  : 'AI Lên Kịch Bản & Sang Bước 2'}
              </span>
              {!isLearning && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
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

                <div className="flex items-center gap-2 text-xs">
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
                    <label className="md:col-span-2 space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Phong cách quay / dựng</span>
                      <select
                        value={blueprint.videoStyle || videoStyle}
                        onChange={(e) => {
                          const nextStyle = e.target.value as StudioVideoStyle;
                          setVideoStyle(nextStyle);
                          setBlueprint({ ...blueprint, videoStyle: nextStyle });
                        }}
                        className={inputCls}
                      >
                        {VIDEO_STYLE_OPTIONS.map((st) => (
                          <option key={st.value} value={st.value}>{st.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
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

              <div className="divide-y divide-slate-200 dark:divide-slate-400/15 border border-slate-200 dark:border-slate-400/20 rounded-2xl overflow-hidden">
                {blueprint.scenes.map((sc, idx) => (
                  <StudioSceneCard
                    key={sc.id}
                    scene={sc}
                    index={idx}
                    totalScenes={blueprint.scenes.length}
                    mode={studioMode}
                    videoStyle={blueprint.videoStyle || videoStyle}
                    characterBible={blueprint.characterBible ?? characterBibleDraft}
                    settingBible={blueprint.settingBible ?? settingBibleDraft}
                    visualStyleBible={blueprint.visualStyleBible ?? visualStyleBibleDraft}
                    costumeBible={blueprint.costumeBible ?? costumeBibleDraft}
                    continuityBible={blueprint.continuityBible ?? continuityBibleDraft}
                    hasCharacterRefs={characters.length > 0}
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
    </div>
  );
};

