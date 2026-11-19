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

  // Mode 1: Creative Idea Inputs
  const [ideaPrompt, setIdeaPrompt] = useState('');

  // Mode 2: Derivative Reference Video Sources (uploaded local + searched/pushed online)
  const [sources, setSources] = useState<
    (TrendingVideoItem & { localAssetId?: string; keyframes?: string[]; hasAudio?: boolean })[]
  >([]);
  const [isUploadingVideos, setIsUploadingVideos] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [uploadError, setUploadError] = useState('');
  const videoUploadInputRef = useRef<HTMLInputElement>(null);

  // Inline Project Library Drawer for Derivative Reference Videos
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  const [desiredSceneCount, setDesiredSceneCount] = useState<number | 'auto'>(10);
  const [customInstruction, setCustomInstruction] = useState('');

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
          characterRefs: characters.slice(0, 3),
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

  // Automatically switch to 'derivative' mode when videos are pushed from Search or Trending tabs
  useEffect(() => {
    if (incomingVideos.length === 0) return;
    setStudioMode('derivative');
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
  const handleUploadCharacters = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setCharError('');
    try {
      for (const file of files.slice(0, 3)) {
        const dataUrl = await compressImageFileToDataUrl(file, 960);
        setCharacters((prev) => {
          if (prev.length >= 3) return prev;
          return [
            ...prev,
            {
              id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: charNameInput.trim() || file.name.replace(/\.[^.]+$/, ''),
              dataUrl,
              description: charPromptInput.trim() || undefined,
              source: 'uploaded',
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
      setCharacters((prev) => [
        ...prev.slice(0, 2),
        {
          id: `char_ai_${Date.now()}`,
          name: (overrideName ?? charNameInput).trim() || 'Nhân vật chính',
          description: desc,
          dataUrl: generatedUrl,
          source: 'ai_generated',
        },
      ]);
      if (!overrideName) setCharNameInput('');
    } catch (err: any) {
      setCharError(err?.message || 'Không thể tạo ảnh nhân vật AI.');
    } finally {
      setIsGeneratingChar(false);
    }
  };

  // AI Learn & Create Script (supports Series mode & Independent Multi-Video Batch mode)
  const handleLearnAndCreateScript = async () => {
    if (studioMode === 'creative') {
      if (!ideaPrompt.trim() && !customInstruction.trim()) {
        setLearnError('Vui lòng nhập ý tưởng hoặc mô tả nội dung ở Bước 1 để Studio Sáng Tạo lên kịch bản.');
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
      .map((c) => `${c.name}${c.description ? `: ${c.description}` : ''}`)
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
          ideaPrompt: ideaPrompt.trim(),
          query: studioMode === 'creative' ? ideaPrompt.trim() : searchQueryInput.trim() || incomingQuery,
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
          `Đã sáng tạo ${returnedList.length} kịch bản video độc lập cùng tinh thần tham chiếu (${styleLabel}). Chọn từng video ở Bước 3 để chỉnh sửa hoặc dựng hàng loạt.`
        );
      } else {
        setLearnSuccess(
          `Đã khởi tạo kịch bản Series ${first.scenes.length} phân cảnh nối tiếp liên hoàn (${styleLabel}).`
        );
      }
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
            characterRefs: characters.map((c) => ({ dataUrl: c.dataUrl, name: c.name })),
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
          sceneImageDataUrl: sc.sceneImageDataUrl,
          characterRefs: characters.map((c) => ({ dataUrl: c.dataUrl, name: c.name })),
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

  const handleSpeakOfflineBrowserPreview = async (text: string, sceneKey = 'sample') => {
    const cleanText = text.trim();
    if (!cleanText) return;

    if (voiceMode === 'offline_system' && capabilities?.localTools.offlineTts.engineId === 'vieneu') {
      setPreviewingSceneId(sceneKey);
      setOfflineTtsNotice('');
      try {
        const res = await fetch('/api/tts/offline/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText.slice(0, 400),
            voice: offlineVoice,
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
        characterRefs: characters.map((c) => ({ dataUrl: c.dataUrl, name: c.name })),
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
        return;
      }
    }

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
      return;
    }

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
  const activeVideoStyleMeta = VIDEO_STYLE_OPTIONS.find((s) => s.value === videoStyle) || VIDEO_STYLE_OPTIONS[1];
  const canSubmitLearn =
    studioMode === 'creative'
      ? Boolean(ideaPrompt.trim() || customInstruction.trim())
      : sources.length > 0;

  return (
    <div className="space-y-6">
      {/* Studio Page Header + Separated 2-Mode Segmented Switcher */}
      <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-[#00464A]/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {studioMode === 'creative' ? 'Studio Sáng Tạo Video Từ Ý Tưởng' : 'Tạo Video Phái Sinh Từ Nguồn Tham Chiếu'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-teal-100/75 mt-1">
              {studioMode === 'creative'
                ? 'Nhập ý tưởng · AI lên kịch bản phân cảnh đánh số liền lạc, đồng bộ nhân vật & bối cảnh, tạo ảnh/clip, lồng tiếng & ghép nhạc.'
                : 'Đưa video tham chiếu từ máy hoặc tìm trực tuyến · AI phân tích nội dung, phát triển kịch bản đồng bộ phân cảnh & dựng video mới.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-teal-200/75">
              {studioMode === 'derivative' ? `${sources.length}/8 video tham chiếu · ` : ''}
              {characters.length}/3 nhân vật đồng bộ
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-50 dark:hover:bg-[#002935] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Cấu hình AI</span>
            </button>
          </div>
        </div>

        {/* Functional 2-Mode Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setStudioMode('creative');
              setLearnError('');
              setLearnSuccess('');
            }}
            className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer flex items-start gap-3 ${
              studioMode === 'creative'
                ? 'bg-[#003B3E]/10 dark:bg-[#003B3E]/45 border-[#003B3E] dark:border-[#1BA8AD]'
                : 'bg-white dark:bg-[#001722] border-slate-200 dark:border-[#00464A] hover:bg-slate-50 dark:hover:bg-[#002935]/50'
            }`}
          >
            <div
              className={`p-2 rounded-lg shrink-0 ${
                studioMode === 'creative'
                  ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                  : 'bg-slate-100 dark:bg-[#000A10] text-slate-600 dark:text-teal-200'
              }`}
            >
              <Clapperboard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Studio Sáng Tạo
              </div>
              <p className="text-xs text-slate-600 dark:text-teal-100/75 mt-0.5 leading-snug">
                Sáng tạo video mới hoàn toàn từ ý tưởng, câu chuyện hoặc chủ đề (không cần video nguồn).
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setStudioMode('derivative');
              setLearnError('');
              setLearnSuccess('');
            }}
            className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer flex items-start gap-3 ${
              studioMode === 'derivative'
                ? 'bg-[#003B3E]/10 dark:bg-[#003B3E]/45 border-[#003B3E] dark:border-[#1BA8AD]'
                : 'bg-white dark:bg-[#001722] border-slate-200 dark:border-[#00464A] hover:bg-slate-50 dark:hover:bg-[#002935]/50'
            }`}
          >
            <div
              className={`p-2 rounded-lg shrink-0 ${
                studioMode === 'derivative'
                  ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                  : 'bg-slate-100 dark:bg-[#000A10] text-slate-600 dark:text-teal-200'
              }`}
            >
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Tạo Video Phái Sinh
              </div>
              <p className="text-xs text-slate-600 dark:text-teal-100/75 mt-0.5 leading-snug">
                Đưa nguồn video tham chiếu để AI học khung hình, phụ đề, lời thoại rồi phát triển kịch bản mới.
              </p>
            </div>
          </button>
        </div>

        {/* Shared Project Profile Bar (Dùng chung cho Studio Sáng Tạo & Tạo Video Phái Sinh) */}
        <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD] shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                Kho Dự Án Đồng Bộ Dùng Chung ({projectProfiles.length})
              </div>
              <p className="text-[11px] text-slate-500 dark:text-teal-200/70 truncate">
                Lưu và dùng chung Nhân vật · Bối cảnh · Phong cách · Trang phục · Mạch truyện giữa Studio Sáng Tạo & Phái Sinh.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {projectProfiles.length > 0 && (
              <select
                value={activeProjectId}
                onChange={(e) => handleLoadProjectProfile(e.target.value)}
                aria-label="Chọn hồ sơ dự án đã lưu"
                className="h-8 px-2.5 text-xs bg-white dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white max-w-[200px]"
              >
                <option value="">-- Nạp dự án đã lưu --</option>
                {projectProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.characterRefs.length} ảnh mẫu)
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              placeholder="Tên dự án dùng chung..."
              className="h-8 px-2.5 text-xs bg-white dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white w-44"
            />
            <button
              type="button"
              disabled={isSavingProject}
              onClick={() => void handleSaveProjectProfile()}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {isSavingProject ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{activeProjectId ? 'Cập nhật dự án' : 'Lưu dự án'}</span>
            </button>
            {activeProjectId && (
              <button
                type="button"
                onClick={() => void handleDeleteProjectProfile(activeProjectId)}
                title="Xóa dự án đang chọn"
                className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {projectStatusMsg && (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">{projectStatusMsg}</p>
        )}
      </div>

      {/* SECTION 1: MODE-SPECIFIC INPUT (IDEA OR REFERENCE VIDEOS) + CHARACTER CONSISTENCY */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Input Box (7 cols) */}
        {studioMode === 'creative' ? (
          <div className="lg:col-span-7 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  1. Nhập ý tưởng & Định hướng sáng tạo
                </h2>
                <p className="text-xs text-slate-500 dark:text-teal-200/70 mt-0.5">
                  Mô tả nội dung, thông điệp, nhân vật hoặc diễn biến chính — AI sẽ biên soạn kịch bản, hồ sơ đồng bộ và prompt phân cảnh chi tiết.
                </p>
              </div>

              <textarea
                rows={5}
                value={ideaPrompt}
                onChange={(e) => setIdeaPrompt(e.target.value)}
                placeholder="VD: Kể câu chuyện về một chàng kỹ sư trẻ phát hiện căn hầm bí mật dưới thư viện cũ... hoặc Giải thích cách AI hoạt động qua cuộc đối thoại hài hước của 2 nhân vật người que..."
                className="w-full p-3 text-xs sm:text-sm bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y leading-relaxed"
              />

              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  Gợi ý nhanh ý tưởng & cấu trúc mẫu:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {CREATIVE_IDEA_STARTERS.map((starter) => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => {
                        setIdeaPrompt(starter.idea);
                        setVideoStyle(starter.style);
                        setDesiredSceneCount(starter.scenes);
                        setTargetDurationSec(starter.dur);
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:border-[#003B3E] dark:hover:border-[#1BA8AD] text-slate-700 dark:text-teal-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {starter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-[#00464A]/80 space-y-2">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
                  Bối cảnh / Thế giới chủ đạo mong muốn (tùy chọn — để trống AI tự thiết lập đồng bộ)
                </span>
                <input
                  type="text"
                  value={settingBibleDraft}
                  onChange={(e) => setSettingBibleDraft(e.target.value)}
                  placeholder="VD: Thành phố tương lai mưa đêm ánh đèn neon xanh tím, không khí trầm lắng..."
                  className="w-full h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-7 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    1. Nguồn video tham chiếu ({sources.length}/8)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-teal-200/70">
                    Tải nhiều video từ máy tính hoặc tìm trực tiếp từ các nền tảng video để AI học & phát triển nội dung.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !libraryOpen;
                      setLibraryOpen(nextOpen);
                      if (nextOpen) void fetchLibraryVideos();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#1BA8AD]/15 border border-[#003B3E]/30 dark:border-[#1BA8AD]/40 hover:bg-[#003B3E]/20 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Library className="w-3.5 h-3.5" />
                    <span>{libraryOpen ? 'Đóng thư viện dự án' : 'Chọn từ thư viện dự án'}</span>
                  </button>
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
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isUploadingVideos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>{isUploadingVideos ? uploadProgressText || 'Đang trích xuất...' : 'Tải nhiều video lên'}</span>
                  </button>
                </div>
              </div>

              {libraryOpen && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Thư viện video sẵn có trong dự án (đã tải lên & đã dựng MP4)
                    </span>
                    <button
                      type="button"
                      onClick={() => void fetchLibraryVideos()}
                      className="text-[11px] text-[#003B3E] dark:text-[#1BA8AD] hover:underline cursor-pointer"
                    >
                      Làm mới
                    </button>
                  </div>
                  {isLoadingLibrary ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang tải danh sách video trong dự án...</span>
                    </div>
                  ) : libraryItems.length === 0 ? (
                    <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                      Chưa có video nào lưu trong thư viện dự án. Hãy tải video lên hoặc xuất video MP4 để xuất hiện tại đây.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {libraryItems.map((item) => {
                        const alreadyAdded =
                          Boolean(item.localAssetId && sources.some((s) => s.localAssetId === item.localAssetId)) ||
                          sources.some((s) => s.title === item.title);
                        const busyImport = Boolean(item.jobId && importingJobId === item.jobId);
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-[#00464A] bg-white dark:bg-[#001722]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-slate-900 dark:text-white truncate">
                                {item.title}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-teal-200/70 tabular-nums truncate">
                                {item.kind === 'rendered' ? 'Đã dựng MP4' : 'Video đã tải'} ·{' '}
                                {Math.round(item.durationSec)}s · {item.resolution || 'HD'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={alreadyAdded || busyImport || sources.length >= 8}
                              onClick={() => void handlePickLibraryVideo(item)}
                              className="px-2 py-1 text-[11px] font-semibold text-white bg-[#003B3E] hover:bg-[#002729] disabled:bg-slate-400 dark:disabled:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {busyImport ? 'Đang nạp...' : alreadyAdded ? 'Đã chọn' : '+ Chọn'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}

              {sources.length === 0 ? (
                <div className="border border-dashed border-slate-300 dark:border-[#00464A] rounded-lg p-6 text-center space-y-2">
                  <Film className="w-6 h-6 text-slate-400 dark:text-teal-300/60 mx-auto" />
                  <p className="text-xs text-slate-600 dark:text-teal-100/75">
                    Chưa có video tham chiếu nào. Bấm <strong>Tải nhiều video lên</strong> hoặc tìm kiếm bên dưới để thêm video cho AI học & phát triển kịch bản.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-[#00464A]/70 border border-slate-200 dark:border-[#00464A] rounded-lg overflow-hidden">
                  {sources.map((src, idx) => {
                    const thumb = src.keyframes?.[0] || (src.pic ? getDiscoveryThumbUrl(src.pic) : '');
                    return (
                      <div
                        key={src.id}
                        className="flex items-center gap-3 p-2.5 bg-slate-50/50 dark:bg-[#000A10]/40 hover:bg-slate-100/60 dark:hover:bg-[#002935]/40 transition-colors"
                      >
                        <span className="text-xs font-mono font-semibold tabular-nums text-slate-500 dark:text-teal-200/70 w-5 text-center shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="w-16 h-10 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0">
                          {thumb && (
                            <img src={thumb} alt={src.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                            {src.translatedTitle || src.title}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-teal-200/70 flex items-center gap-1.5 tabular-nums truncate">
                            <span>{src.localAssetId ? 'Video tải lên' : src.platformLabel}</span>
                            <span>·</span>
                            <span>{src.duration > 0 ? formatDuration(src.duration) : '--:--'}</span>
                            {src.keyframes && src.keyframes.length > 0 && (
                              <>
                                <span>·</span>
                                <span>{src.keyframes.length} khung hình</span>
                              </>
                            )}
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

            {/* Inline Search & Optional Expansion Idea */}
            <div className="pt-3 border-t border-slate-200 dark:border-[#00464A]/80 space-y-2.5">
              <form onSubmit={handleSearchSources} className="flex flex-wrap sm:flex-nowrap gap-2">
                <select
                  value={searchPlatform}
                  onChange={(e) => setSearchPlatform(e.target.value as TrendingPlatformId)}
                  aria-label="Nền tảng tìm kiếm"
                  className="h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
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
                  placeholder="Tìm nhanh video trên YouTube, TikTok, Bilibili để đưa vào tham chiếu..."
                  className="flex-1 min-w-[180px] h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
                <button
                  type="submit"
                  disabled={isSearchingSources}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-slate-800 dark:text-white bg-slate-100 dark:bg-[#002935] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/80 dark:hover:bg-[#003B3E] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isSearchingSources ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Tìm nguồn</span>
                </button>
              </form>

              {searchError && <p className="text-xs text-rose-600 dark:text-rose-400">{searchError}</p>}

              {searchResults.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {searchResults.map((vid) => {
                    const alreadyAdded = sources.some((s) => s.id === vid.id || s.sourceUrl === vid.sourceUrl);
                    return (
                      <div
                        key={vid.id}
                        className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-[#00464A] bg-slate-50/70 dark:bg-[#000A10]/60"
                      >
                        <img
                          src={getDiscoveryThumbUrl(vid.pic)}
                          alt={vid.title}
                          referrerPolicy="no-referrer"
                          className="w-12 h-8 object-cover rounded shrink-0 bg-slate-200 dark:bg-slate-800"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-slate-900 dark:text-white truncate">
                            {vid.translatedTitle || vid.title}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-teal-200/70 truncate tabular-nums">
                            {vid.platformLabel} · {formatDuration(vid.duration)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={alreadyAdded || sources.length >= 8}
                          onClick={() => handleAddSearchVideo(vid)}
                          className="px-2 py-1 text-[11px] font-semibold text-white bg-[#003B3E] hover:bg-[#002729] disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {alreadyAdded ? 'Đã thêm' : '+ Thêm'}
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
                placeholder="Góc nhìn / Ý tưởng phát triển từ video tham chiếu (VD: Tái hiện lại bằng nhân vật Anime hoặc mở rộng thêm phân tích)..."
                className="w-full h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
              />
            </div>
          </div>
        )}

        {/* Right: Character References & Identity Synchronization (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Nhân vật đồng bộ ({characters.length}/3)
                </h2>
              </div>
              <div>
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
                  disabled={characters.length >= 3}
                  onClick={() => charUploadInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/70 dark:hover:bg-[#002935] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Tải ảnh mẫu</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-teal-200/70 leading-relaxed">
              Dùng làm ảnh gốc giữ nguyên gương mặt, trang phục & phong cách <strong>{activeVideoStyleMeta.label}</strong> khi vẽ toàn bộ các phân cảnh nối tiếp nhau.
            </p>

            {/* AI Character Generator */}
            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={charNameInput}
                  onChange={(e) => setCharNameInput(e.target.value)}
                  placeholder="Tên nhân vật"
                  className="w-1/3 h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
                <input
                  type="text"
                  value={charPromptInput}
                  onChange={(e) => setCharPromptInput(e.target.value)}
                  placeholder="Mô tả ngoại hình, trang phục để AI vẽ mẫu đồng bộ..."
                  className="flex-1 h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <select
                  value={imageEngineMode}
                  onChange={(e) => setImageEngineMode(e.target.value as 'gemini_standard' | 'gemini_pro' | 'muse2api')}
                  aria-label="Mô hình tạo ảnh"
                  className="h-8 px-2 text-[11px] bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-700 dark:text-teal-100 focus:outline-none"
                >
                  <option value="muse2api">
                    Muse2API (muse-image · {capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                  </option>
                  <option value="gemini_standard">Gemini Flash Image</option>
                  <option value="gemini_pro">Nano Banana 2.1 (1K)</option>
                </select>
                <button
                  type="button"
                  disabled={isGeneratingChar || characters.length >= 3}
                  onClick={() => void handleGenerateCharacterAi()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isGeneratingChar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  <span>AI vẽ nhân vật</span>
                </button>
              </div>
            </div>

            {charError && (
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-800 dark:text-amber-200">
                {charError}
              </div>
            )}

            {/* Character Thumbnails Grid */}
            {characters.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                {characters.map((ch) => (
                  <div
                    key={ch.id}
                    className="relative group rounded-lg border border-slate-200 dark:border-[#00464A] overflow-hidden bg-slate-100 dark:bg-[#000A10]"
                  >
                    <img src={ch.dataUrl} alt={ch.name} className="w-full aspect-square object-cover" />
                    <div className="px-2 py-1 text-[11px] font-medium text-slate-800 dark:text-teal-100 truncate">
                      {ch.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => setCharacters((prev) => prev.filter((item) => item.id !== ch.id))}
                      aria-label="Xóa nhân vật"
                      className="absolute top-1 right-1 p-1 rounded bg-black/65 text-white hover:bg-rose-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="block space-y-1 pt-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
                Ghi chú ngoại hình nhân vật cố định (tùy chọn trước khi lập kịch bản)
              </span>
              <input
                type="text"
                value={characterBibleDraft}
                onChange={(e) => setCharacterBibleDraft(e.target.value)}
                placeholder="VD: Nam 25 tuổi, tóc đen ngắn rẽ ngôi, mặc áo khoác bomber xám..."
                className="w-full h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
              />
            </label>
          </div>
        </div>
      </section>

      {/* SECTION 2: AI ENGINE, SCRIPT MODE (SERIES VS INDEPENDENT BATCH), VIDEO STYLE & DURATION */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {studioMode === 'creative'
                  ? '2. Thiết lập AI & Lên kịch bản phân cảnh đồng bộ'
                  : '2. Thiết lập AI phân tích video & Lên kịch bản phân cảnh đồng bộ'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Chọn chế độ sáng tạo kịch bản (Series xuyên suốt hoặc Nhiều video độc lập), hệ thống AI, phong cách & thời lượng.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isLearning || !canSubmitLearn}
              onClick={handleLearnAndCreateScript}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {isLearning
                  ? scriptMode === 'independent_batch'
                    ? `Đang sáng tạo ${batchVideoCount} kịch bản...`
                    : 'Đang khởi tạo kịch bản Series...'
                  : scriptMode === 'independent_batch'
                  ? `AI Lên Kịch Bản ${batchVideoCount} Video Độc Lập`
                  : 'AI Lên Kịch Bản Phân Cảnh'}
              </span>
            </button>
          </div>
        </div>

        {/* 2 Script Creation Modes Selector */}
        <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              Chế độ sáng tạo kịch bản
            </span>
            <button
              type="button"
              onClick={() => setShowScriptModeGuide((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#003B3E] dark:text-[#1BA8AD] hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Bảng phân biệt 2 chế độ</span>
              {showScriptModeGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setScriptMode('series');
                if (desiredSceneCount === 'auto') setDesiredSceneCount(10);
              }}
              className={`text-left p-3 rounded-lg border transition-colors cursor-pointer flex items-start gap-2.5 ${
                scriptMode === 'series'
                  ? 'bg-white dark:bg-[#001722] border-[#003B3E] dark:border-[#1BA8AD]'
                  : 'bg-white/60 dark:bg-[#001722]/40 border-slate-200 dark:border-[#00464A]/80 hover:border-slate-300 dark:hover:border-[#1BA8AD]/50'
              }`}
            >
              <div
                className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                  scriptMode === 'series'
                    ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                    : 'bg-slate-200/80 dark:bg-[#002935] text-slate-600 dark:text-teal-200'
                }`}
              >
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Chế độ 1: Kịch bản Series (Cốt truyện xuyên suốt)
                </div>
                <p className="text-[11px] text-slate-600 dark:text-teal-100/75 mt-0.5 leading-snug">
                  Kể 1 câu chuyện liền mạch qua chuỗi phân cảnh nối tiếp nhau (mặc định 10 cảnh) · Đồng nhất nhân vật, trang phục & tiến trình bối cảnh.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setScriptMode('independent_batch');
                if (desiredSceneCount === 10) setDesiredSceneCount('auto');
              }}
              className={`text-left p-3 rounded-lg border transition-colors cursor-pointer flex items-start gap-2.5 ${
                scriptMode === 'independent_batch'
                  ? 'bg-white dark:bg-[#001722] border-[#003B3E] dark:border-[#1BA8AD]'
                  : 'bg-white/60 dark:bg-[#001722]/40 border-slate-200 dark:border-[#00464A]/80 hover:border-slate-300 dark:hover:border-[#1BA8AD]/50'
              }`}
            >
              <div
                className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                  scriptMode === 'independent_batch'
                    ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                    : 'bg-slate-200/80 dark:bg-[#002935] text-slate-600 dark:text-teal-200'
                }`}
              >
                <ListVideo className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Chế độ 2: Nhiều video độc lập cùng chủ đề
                </div>
                <p className="text-[11px] text-slate-600 dark:text-teal-100/75 mt-0.5 leading-snug">
                  Sáng tạo nhiều câu chuyện riêng biệt (nhân vật & bối cảnh khác nhau) · Giữ chung tinh thần, chủ đề & phong cách tham chiếu.
                </p>
              </div>
            </button>
          </div>

          {/* Collapsible 2-Mode Comparison Table */}
          {showScriptModeGuide && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#00464A] bg-white dark:bg-[#001722]">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-slate-200 dark:border-[#00464A] text-slate-500 dark:text-teal-200/80">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Tiêu chí</th>
                    <th className="py-2 px-3 font-semibold text-[#003B3E] dark:text-[#1BA8AD]">Chế độ 1: Series</th>
                    <th className="py-2 px-3 font-semibold text-[#003B3E] dark:text-[#1BA8AD]">Chế độ 2: Nhiều video độc lập</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-[#00464A]/60 text-slate-700 dark:text-teal-100/85">
                  <tr>
                    <td className="py-1.5 px-3 font-medium">Nội dung</td>
                    <td className="py-1.5 px-3">Một câu chuyện xuyên suốt nhiều phân cảnh</td>
                    <td className="py-1.5 px-3">Nhiều câu chuyện riêng biệt, không lặp ý tưởng</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-3 font-medium">Nhân vật & Bối cảnh</td>
                    <td className="py-1.5 px-3">Đồng nhất xuyên suốt theo tiến trình cốt truyện</td>
                    <td className="py-1.5 px-3">Nhân vật & bối cảnh riêng biệt ở từng video</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-3 font-medium">Liên kết</td>
                    <td className="py-1.5 px-3">Cảnh sau nối tiếp cảnh trước</td>
                    <td className="py-1.5 px-3">Mỗi video có mở đầu – diễn biến – kết thúc độc lập</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-3 font-medium">Số lượng & Thời lượng</td>
                    <td className="py-1.5 px-3">Mặc định 10 phân cảnh · Theo cấu hình series</td>
                    <td className="py-1.5 px-3">Tùy chọn số lượng video (2–15) · Thời lượng chung hoặc riêng từng video</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Mode 2 Controls: Batch Video Count & Per-Video Duration Settings */}
          {scriptMode === 'independent_batch' && (
            <div className="pt-2 border-t border-slate-200 dark:border-[#00464A]/70 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div className="lg:col-span-5 space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-600 dark:text-teal-200/85">
                  Số lượng video độc lập muốn tạo (2–15)
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[2, 3, 5, 8, 10].map((cnt) => {
                    const active = batchVideoCount === cnt;
                    return (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => handleUpdateBatchVideoCount(cnt)}
                        className={`h-8 px-3 text-xs font-medium rounded-lg border transition-colors tabular-nums cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-[#003B3E] text-white border-[#003B3E] dark:bg-[#1BA8AD] dark:text-[#001722] dark:border-[#1BA8AD]'
                            : 'bg-white dark:bg-[#001722] text-slate-700 dark:text-teal-100 border-slate-200 dark:border-[#00464A] hover:border-[#003B3E]'
                        }`}
                      >
                        {cnt} video
                      </button>
                    );
                  })}
                  <input
                    type="number"
                    min={2}
                    max={15}
                    value={batchVideoCount}
                    onChange={(e) => handleUpdateBatchVideoCount(Number(e.target.value))}
                    aria-label="Nhập số lượng video muốn tạo"
                    className="w-16 h-8 px-2 text-xs font-mono tabular-nums text-center bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                  />
                </div>
              </div>

              <div className="lg:col-span-7 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-teal-200/85">
                    Cấu hình thời lượng từng video trong đợt
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-[#00464A] overflow-hidden bg-white dark:bg-[#001722]">
                    <button
                      type="button"
                      onClick={() => setBatchDurationMode('uniform')}
                      className={`px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                        batchDurationMode === 'uniform'
                          ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                          : 'text-slate-600 dark:text-teal-200/80'
                      }`}
                    >
                      Áp dụng chung ({targetDurationSec}s/video)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchDurationMode('per_video')}
                      className={`px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                        batchDurationMode === 'per_video'
                          ? 'bg-[#003B3E] text-white dark:bg-[#1BA8AD] dark:text-[#001722]'
                          : 'text-slate-600 dark:text-teal-200/80'
                      }`}
                    >
                      Tùy chỉnh riêng từng video
                    </button>
                  </div>
                </div>

                {batchDurationMode === 'per_video' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {Array.from({ length: batchVideoCount }, (_, idx) => (
                      <label
                        key={idx}
                        className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A]"
                      >
                        <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-teal-200">
                          V{String(idx + 1).padStart(2, '0')}
                        </span>
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
                          aria-label={`Thời lượng Video ${idx + 1} (giây)`}
                          className="w-14 h-6 px-1 text-[11px] font-mono tabular-nums text-right bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded text-slate-900 dark:text-white focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-400">s</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                    Tất cả <strong className="font-mono">{batchVideoCount}</strong> video độc lập sẽ dùng thời lượng mục tiêu{' '}
                    <strong className="font-mono">{targetDurationSec}s</strong> (chỉnh ở bảng thời lượng bên dưới).
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Row 1: AI Provider, Language, Video Visual Style, Narrative Style, Aspect Ratio, Scene Count */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              Hệ thống AI phân tích
            </span>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AiProviderId)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
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
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              Ngôn ngữ lời thoại
            </span>
            <select
              value={outputLanguage}
              onChange={(e) => setOutputLanguage(e.target.value as DerivativeOutputLanguage)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              Phong cách video (Hình ảnh)
            </span>
            <select
              value={videoStyle}
              onChange={(e) => setVideoStyle(e.target.value as StudioVideoStyle)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              {VIDEO_STYLE_OPTIONS.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
                Kiểu dẫn chuyện
              </span>
              <button
                type="button"
                onClick={() => setEnableNarrativeStyle((v) => !v)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  enableNarrativeStyle
                    ? 'bg-[#003B3E] text-white border-[#003B3E] dark:bg-[#1BA8AD] dark:text-[#001722] dark:border-[#1BA8AD]'
                    : 'bg-slate-100 dark:bg-[#000A10] text-slate-500 dark:text-teal-200/70 border-slate-200 dark:border-[#00464A]'
                }`}
              >
                {enableNarrativeStyle ? 'Đang BẬT' : 'Đang TẮT'}
              </button>
            </div>
            {enableNarrativeStyle ? (
              <select
                value={stylePreset === 'none' ? 'storytelling_review' : stylePreset}
                onChange={(e) => setStylePreset(e.target.value as DerivativeStylePreset)}
                aria-label="Kiểu dẫn chuyện"
                className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
              >
                {STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="h-9 px-2.5 flex items-center text-[11px] text-slate-500 dark:text-teal-200/70 bg-slate-50/70 dark:bg-[#000A10]/60 border border-dashed border-slate-200 dark:border-[#00464A] rounded-lg truncate">
                AI tự do sáng tạo theo ý tưởng
              </div>
            )}
          </div>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              Tỷ lệ khung hình
            </span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as DerivativeAspectRatio)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="9:16">9:16 Dọc (Shorts / TikTok)</option>
              <option value="16:9">16:9 Ngang (YouTube / Web)</option>
              <option value="1:1">1:1 Vuông (Social / Feed)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              {scriptMode === 'independent_batch' ? 'Số cảnh mỗi video' : 'Số phân cảnh Series'}
            </span>
            <select
              value={String(desiredSceneCount)}
              onChange={(e) =>
                setDesiredSceneCount(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
              }
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="auto">Tự động theo thời lượng</option>
              <option value="3">3 phân cảnh</option>
              <option value="5">5 phân cảnh</option>
              <option value="6">6 phân cảnh</option>
              <option value="8">8 phân cảnh</option>
              <option value="10">10 phân cảnh (Mặc định Series)</option>
              <option value="12">12 phân cảnh</option>
              <option value="16">16 phân cảnh</option>
              <option value="20">20 phân cảnh</option>
            </select>
          </label>
        </div>

        {/* Row 2: Flexible Duration Presets (10s .. 10m) + Custom Seconds Box + Voiceover Toggle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-slate-200/70 dark:border-[#00464A]/60 items-start">
          <div className="lg:col-span-8 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-teal-200/80 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD]" />
                <span>
                  Thời lượng mục tiêu: <strong className="font-mono text-slate-900 dark:text-white">{targetDurationSec}s</strong> (
                  {Math.floor(targetDurationSec / 60)}p {targetDurationSec % 60}s)
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Nhập số giây linh động:</span>
                <input
                  type="number"
                  min={10}
                  max={900}
                  step={5}
                  value={targetDurationSec}
                  onChange={(e) =>
                    setTargetDurationSec(Math.max(10, Math.min(900, Number(e.target.value) || 10)))
                  }
                  aria-label="Nhập số giây linh động"
                  className="w-20 h-8 px-2 text-xs font-mono tabular-nums text-center bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
                <span className="text-[11px] text-slate-500">giây</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((preset) => {
                const active = targetDurationSec === preset.sec;
                return (
                  <button
                    key={preset.sec}
                    type="button"
                    onClick={() => setTargetDurationSec(preset.sec)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors tabular-nums cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#003B3E] text-white border-[#003B3E] dark:bg-[#1BA8AD] dark:text-[#001722] dark:border-[#1BA8AD]'
                        : 'bg-slate-50 dark:bg-[#000A10] text-slate-700 dark:text-teal-100 border-slate-200 dark:border-[#00464A] hover:border-[#003B3E]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-2">
            <span className="block text-[11px] font-medium text-slate-600 dark:text-teal-200/80">
              Tùy chọn lồng tiếng kịch bản
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (voiceMode === 'none') setVoiceMode('ai_online');
                }}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  voiceMode !== 'none'
                    ? 'bg-[#003B3E] text-white border-[#003B3E] dark:bg-[#1BA8AD] dark:text-[#001722] dark:border-[#1BA8AD]'
                    : 'bg-slate-50 dark:bg-[#000A10] text-slate-700 dark:text-teal-100 border-slate-200 dark:border-[#00464A]'
                }`}
              >
                Có lồng tiếng
              </button>
              <button
                type="button"
                onClick={() => setVoiceMode('none')}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  voiceMode === 'none'
                    ? 'bg-[#003B3E] text-white border-[#003B3E] dark:bg-[#1BA8AD] dark:text-[#001722] dark:border-[#1BA8AD]'
                    : 'bg-slate-50 dark:bg-[#000A10] text-slate-700 dark:text-teal-100 border-slate-200 dark:border-[#00464A]'
                }`}
              >
                Không lồng tiếng
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
              {voiceMode === 'none'
                ? 'Video chỉ xuất hình ảnh + chữ phụ đề + nhạc nền (nếu bật).'
                : 'Chọn giọng AI Online hoặc VieNeu-TTS Offline ở Bước 4.'}
            </p>
          </div>
        </div>

        {/* Row 3: Custom Instruction & Gemini Pro toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="Chỉ đạo thêm cho AI (VD: Nhấn mạnh nhịp chuyển cảnh liền mạch, góc quay điện ảnh, lời thoại tự nhiên không sáo rỗng)..."
            className="flex-1 h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
          />
          {aiProvider === 'gemini' && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-teal-100/90 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={useProModel}
                onChange={(e) => setUseProModel(e.target.checked)}
                className="rounded border-slate-300 text-[#003B3E] focus:ring-[#003B3E]"
              />
              <span>Dùng Gemini Pro (gemini-4-argon · Trả phí)</span>
            </label>
          )}
        </div>

        {learnSuccess && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{learnSuccess}</span>
          </div>
        )}

        {learnError && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{learnError}</span>
            </div>
            <button
              type="button"
              disabled={isLearning}
              onClick={handleLearnAndCreateScript}
              className="px-3 py-1.5 text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Thử lại ngay
            </button>
          </div>
        )}
      </section>

      {/* SECTION 3: INDEPENDENT VIDEO SWITCHER (IF BATCH) + CONSISTENCY ANCHOR & STORYBOARD */}
      {blueprint && (
        <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-5">
          {/* Batch Video Switcher when Multiple Independent Videos are generated */}
          {blueprints.length > 1 && (
            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Danh sách {blueprints.length} kịch bản video độc lập cùng chủ đề
                  </h3>
                  {(sharedSpiritByMode[studioMode] || blueprint.sharedSpiritNote) && (
                    <p className="text-[11px] text-slate-500 dark:text-teal-200/75 mt-0.5">
                      Tinh thần & phong cách chung: {sharedSpiritByMode[studioMode] || blueprint.sharedSpiritNote}
                    </p>
                  )}
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-teal-200/80">
                  Đang xem Video {String(activeBatchIndex + 1).padStart(2, '0')}/{String(blueprints.length).padStart(2, '0')}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {blueprints.map((bpItem, idx) => {
                  const isActive = idx === activeBatchIndex;
                  const itemJob = jobsByKey[`${studioMode}:${idx}`];
                  const itemDur =
                    bpItem.targetDurationSec ||
                    Math.round(bpItem.scenes.reduce((s, sc) => s + Number(sc.durationSec || 0), 0));
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
                      className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer space-y-1 ${
                        isActive
                          ? 'bg-white dark:bg-[#001722] border-[#003B3E] dark:border-[#1BA8AD]'
                          : 'bg-white/60 dark:bg-[#001722]/40 border-slate-200 dark:border-[#00464A]/80 hover:border-slate-300 dark:hover:border-[#1BA8AD]/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[11px] font-mono font-semibold tabular-nums text-[#003B3E] dark:text-[#1BA8AD]">
                          Video {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-teal-200/70">
                          {bpItem.scenes.length} cảnh · {itemDur}s
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-900 dark:text-white line-clamp-1">
                        {bpItem.derivativeTitle}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-teal-200/70 truncate">
                        {itemJob?.status === 'completed'
                          ? 'Đã xuất MP4'
                          : itemJob?.status === 'error'
                          ? 'Lỗi dựng video'
                          : itemJob
                          ? `Đang dựng ${itemJob.progress}%`
                          : 'Sẵn sàng chỉnh sửa & dựng'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary + Title + Hook */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4 border-b border-slate-200 dark:border-[#00464A]/80">
            <div className="lg:col-span-7 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD]">
                <BookOpen className="w-4 h-4" />
                <span>
                  {blueprints.length > 1
                    ? `Video độc lập #${activeBatchIndex + 1}/${blueprints.length} (${blueprint.usedModel || blueprint.usedProvider})`
                    : studioMode === 'creative'
                    ? `Kịch bản Series sáng tạo (${blueprint.usedModel || blueprint.usedProvider})`
                    : `AI tổng hợp Series từ ${blueprint.sourcesAnalyzed.length} video tham chiếu (${blueprint.usedModel || blueprint.usedProvider})`}
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-teal-100/85 leading-relaxed">
                {blueprint.learnedSummary}
              </p>
              <p className="text-xs text-slate-500 dark:text-teal-200/75">
                <strong>Công thức Hook:</strong> {blueprint.hookFormula}
              </p>
              {blueprint.keyTakeaways.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-700 dark:text-teal-100/85 list-disc pl-5">
                  {blueprint.keyTakeaways.map((tk, i) => (
                    <li key={i}>{tk}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="lg:col-span-5 space-y-2.5">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
                  Tiêu đề video
                </span>
                <input
                  type="text"
                  value={blueprint.derivativeTitle}
                  onChange={(e) => setBlueprint({ ...blueprint, derivativeTitle: e.target.value })}
                  className="w-full h-9 px-3 text-xs font-semibold bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
                  Chữ Hook nổi bật 3.5 giây đầu
                </span>
                <input
                  type="text"
                  value={blueprint.derivativeHook}
                  onChange={(e) => setBlueprint({ ...blueprint, derivativeHook: e.target.value })}
                  className="w-full h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>
              <div className="text-[11px] text-slate-500 dark:text-teal-200/70">
                {blueprint.hashtags.join(' ')}
              </div>
            </div>
          </div>

          {/* 9-Dimension Reference Video Analysis Panel (Derivative Mode) */}
          {studioMode === 'derivative' && blueprint.referenceAnalysis && (
            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                  AI Phân Tích Video Tham Chiếu (9 Chiều Đạo Diễn · Phát Triển Kịch Bản Phái Sinh Mới)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                  Dữ liệu bóc tách tự động từ video tham chiếu — AI giữ tinh thần & ngôn ngữ điện ảnh nhưng sáng tạo câu chuyện phái sinh mới hoàn toàn.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px]">
                {[
                  { label: 'Nội dung & Chủ đề chính', value: blueprint.referenceAnalysis.mainTheme },
                  { label: 'Cốt truyện & Diễn biến', value: blueprint.referenceAnalysis.plotProgression },
                  { label: 'Nhân vật & Đặc điểm nhận dạng', value: blueprint.referenceAnalysis.characterTraits },
                  { label: 'Bối cảnh & Không gian', value: blueprint.referenceAnalysis.settingAndSpace },
                  { label: 'Phong cách hình ảnh', value: blueprint.referenceAnalysis.visualStyle },
                  { label: 'Góc máy & Chuyển động camera', value: blueprint.referenceAnalysis.cameraAndMovement },
                  { label: 'Ánh sáng & Màu sắc', value: blueprint.referenceAnalysis.lightingAndColor },
                  { label: 'Nhịp độ dựng phim', value: blueprint.referenceAnalysis.editingPacing },
                  { label: 'Lời thoại, Âm thanh & Giọng đọc', value: blueprint.referenceAnalysis.dialogueAndAudio },
                ]
                  .filter((item) => item.value && item.value.trim())
                  .map((item) => (
                    <div
                      key={item.label}
                      className="p-2.5 rounded-lg bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A]/80 space-y-0.5"
                    >
                      <div className="font-semibold text-[#003B3E] dark:text-[#1BA8AD]">{item.label}</div>
                      <p className="text-slate-700 dark:text-teal-100/85 leading-snug">{item.value}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 5-Component Global Consistency Bible */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Cơ chế Đồng Bộ 5 Thành Phần Giữa Các Phân Cảnh (Scene 01 → Scene {String(blueprint.scenes.length).padStart(2, '0')})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                  Khóa chặt Character · Environment · Visual Style · Costume · Story Continuity để toàn bộ các phân cảnh ghép thành một bộ phim thống nhất.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {characters.length < 3 && (blueprint.characterBible || characterBibleDraft) && (
                  <button
                    type="button"
                    disabled={isGeneratingChar}
                    onClick={() =>
                      void handleGenerateCharacterAi(
                        blueprint.characterBible || characterBibleDraft,
                        'Nhân vật đồng bộ'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingChar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    <span>Vẽ ảnh nhân vật chuẩn từ Hồ sơ này</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isSavingProject}
                  onClick={() => void handleSaveProjectProfile()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#1BA8AD]/15 border border-[#003B3E]/30 dark:border-[#1BA8AD]/40 hover:bg-[#003B3E]/20 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Lưu hồ sơ vào Dự án</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <label className="md:col-span-6 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  1. Character Reference (Nhân vật & Đặc điểm nhận dạng cố định)
                </span>
                <textarea
                  rows={2}
                  value={blueprint.characterBible ?? ''}
                  onChange={(e) => {
                    setBlueprint({ ...blueprint, characterBible: e.target.value });
                    setCharacterBibleDraft(e.target.value);
                  }}
                  placeholder="Mô tả cố định ngoại hình, tuổi tác, kiểu tóc, gương mặt nhân vật..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                />
              </label>

              <label className="md:col-span-6 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  2. Environment Reference (Bối cảnh, Địa điểm & Không gian)
                </span>
                <textarea
                  rows={2}
                  value={blueprint.settingBible ?? ''}
                  onChange={(e) => {
                    setBlueprint({ ...blueprint, settingBible: e.target.value });
                    setSettingBibleDraft(e.target.value);
                  }}
                  placeholder="Mô tả không gian, kiến trúc, bối cảnh đồng bộ từ Scene 01 đến cảnh cuối..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                />
              </label>

              <label className="md:col-span-4 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  3. Visual Style Reference (Bảng màu & Ngôn ngữ hình ảnh)
                </span>
                <textarea
                  rows={2}
                  value={blueprint.visualStyleBible ?? ''}
                  onChange={(e) => {
                    setBlueprint({ ...blueprint, visualStyleBible: e.target.value });
                    setVisualStyleBibleDraft(e.target.value);
                  }}
                  placeholder="Tông màu chủ đạo, độ tương phản, ánh sáng, chất liệu phim xuyên suốt..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                />
              </label>

              <label className="md:col-span-3 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  4. Costume Reference (Trang phục & Phụ kiện)
                </span>
                <textarea
                  rows={2}
                  value={blueprint.costumeBible ?? ''}
                  onChange={(e) => {
                    setBlueprint({ ...blueprint, costumeBible: e.target.value });
                    setCostumeBibleDraft(e.target.value);
                  }}
                  placeholder="Áo choàng, phụ kiện, vật phẩm cầm tay cố định..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                />
              </label>

              <label className="md:col-span-3 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  5. Story Continuity (Trục liên tục câu chuyện)
                </span>
                <textarea
                  rows={2}
                  value={blueprint.continuityBible ?? ''}
                  onChange={(e) => {
                    setBlueprint({ ...blueprint, continuityBible: e.target.value });
                    setContinuityBibleDraft(e.target.value);
                  }}
                  placeholder="Tiến trình thời gian, hành động & mối liên kết mạch truyện..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                />
              </label>

              <label className="md:col-span-2 space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                  Phong cách đồng bộ
                </span>
                <select
                  value={blueprint.videoStyle || videoStyle}
                  onChange={(e) => {
                    const nextStyle = e.target.value as StudioVideoStyle;
                    setVideoStyle(nextStyle);
                    setBlueprint({ ...blueprint, videoStyle: nextStyle });
                  }}
                  className="w-full h-9 px-2 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                >
                  {VIDEO_STYLE_OPTIONS.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Storyboard Controls Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-teal-100/85 tabular-nums">
              <strong>3. Dàn phân cảnh nối tiếp ({blueprint.scenes.length} phân cảnh)</strong> · Tổng ước lượng{' '}
              <span className="font-mono font-semibold text-[#003B3E] dark:text-[#1BA8AD]">
                {Math.floor(totalSceneSec / 60)}p {totalSceneSec % 60}s
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sceneVideoEngine}
                onChange={(e) => setSceneVideoEngine(e.target.value as 'gemini' | 'muse2api')}
                aria-label="Mô hình dựng clip từng cảnh"
                className="h-8 px-2 text-[11px] bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-700 dark:text-teal-100 focus:outline-none"
              >
                <option value="muse2api">Clip cảnh: Muse2API (muse-video · Ưu tiên)</option>
                <option value="gemini">Clip cảnh: Gemini Omni Flash</option>
              </select>
              <button
                type="button"
                disabled={isBatchGeneratingImages}
                onClick={handleBatchGenerateSceneImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/70 dark:hover:bg-[#002935] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-70"
              >
                {isBatchGeneratingImages ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                <span>
                  {isBatchGeneratingImages
                    ? `Đang tạo ảnh ${batchImageProgress ? `${batchImageProgress.current}/${batchImageProgress.total}` : 'các cảnh'}...`
                    : imageEngineMode === 'muse2api'
                    ? 'Tạo ảnh đồng bộ Muse2API tất cả cảnh'
                    : 'Tạo ảnh AI đồng bộ tất cả cảnh'}
                </span>
              </button>
              {isBatchGeneratingImages && (
                <button
                  type="button"
                  onClick={handleStopBatchGenerateSceneImages}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-800/70 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Dừng</span>
                </button>
              )}
              <button
                type="button"
                disabled={blueprint.scenes.length >= 24}
                onClick={handleAddScene}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] border border-[#003B3E]/30 dark:border-[#1BA8AD]/40 hover:bg-[#003B3E]/5 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm phân cảnh</span>
              </button>
            </div>
          </div>

          {sceneMediaError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{sceneMediaError}</span>
            </div>
          )}

          {/* Sequentially Numbered Scene Cards */}
          <div className="divide-y divide-slate-200 dark:divide-[#00464A]/80 border border-slate-200 dark:border-[#00464A] rounded-xl overflow-hidden">
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
        </section>
      )}

      {/* SECTION 4: VISUAL ENGINE, BACKGROUND MUSIC, VOICEOVER & FINAL RENDER */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#00464A]/80 pb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              4. Âm thanh, Nhạc nền & Xuất Video Hoàn Chỉnh
            </h2>
            <p className="text-xs text-slate-500 dark:text-teal-200/70">
              Chọn mô hình dựng hình video, ghép nhạc nền AI/công cộng và giọng lồng tiếng trước khi kết xuất MP4.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Column A: Visual Engine */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Film className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
              <span>Công cụ tạo hình ảnh video</span>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Chế độ dựng video</span>
              <select
                value={visualMode}
                onChange={(e) => {
                  const nextMode = e.target.value as DerivativeVisualMode;
                  setVisualMode(nextMode);
                  if (nextMode === 'muse2api_video') setSceneVideoEngine('muse2api');
                  else if (nextMode === 'gemini_omni') setSceneVideoEngine('gemini');
                }}
                className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
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
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                Muse2API hiện chưa sẵn sàng ({capabilities?.aiProviders.muse2api?.status || 'offline'}). Vào{' '}
                <button type="button" onClick={onOpenSettings} className="underline font-semibold cursor-pointer">
                  Cấu hình AI &gt; Muse2API
                </button>{' '}
                để kết nối và nạp Cookie muse.ai.
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Kho video dự phòng B-roll</span>
              <select
                value={brollSource}
                onChange={(e) => setBrollSource(e.target.value as BrollSourceId)}
                className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="wikimedia">Wikimedia Commons (Ưu tiên · Không cần key)</option>
                <option value="auto">Tự động (Wikimedia → Pexels → Pixabay)</option>
                <option value="pexels">Pexels Video</option>
                <option value="pixabay">Pixabay Video</option>
                <option value="none">Không dùng kho B-roll ngoài</option>
              </select>
            </label>
            {studioMode === 'derivative' && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-teal-100/90 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepSourceAudio}
                  onChange={(e) => setKeepSourceAudio(e.target.checked)}
                  className="rounded border-slate-300 text-[#003B3E] focus:ring-[#003B3E]"
                />
                <span>Giữ âm thanh gốc video nguồn nhỏ (12%)</span>
              </label>
            )}
          </div>

          {/* Column B: Voiceover Online / Offline / None */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Mic className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
              <span>Lồng tiếng & Giọng đọc</span>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Chế độ giọng đọc</span>
              <select
                value={voiceMode}
                onChange={(e) => setVoiceMode(e.target.value as DerivativeVoiceMode)}
                className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="ai_online">Giọng đọc Online AI (Gemini Flash Lite TTS)</option>
                <option value="offline_system">
                  {capabilities?.localTools.offlineTts.engineId === 'vieneu'
                    ? 'Giọng đọc Offline · VieNeu-TTS Tiếng Việt (Sẵn sàng)'
                    : 'Giọng đọc Offline · VieNeu-TTS Tiếng Việt (Cần tải model)'}
                </option>
                <option value="none">Không lồng tiếng (Chỉ hình + chữ + nhạc)</option>
              </select>
            </label>

            {voiceMode === 'ai_online' && (
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Chọn chất giọng AI</span>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as Exclude<DerivativeVoiceId, 'none'>)}
                  className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {voiceMode === 'offline_system' && (
              <div className="space-y-2">
                {capabilities?.localTools.offlineTts.engineId === 'vieneu' && offlineVoices.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                        Chọn giọng VieNeu-TTS Offline ({offlineVoices.length} giọng Việt)
                      </span>
                      <select
                        value={offlineVoice}
                        onChange={(e) => setOfflineVoice(e.target.value)}
                        className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
                      >
                        {offlineVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.description || v.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={previewingSceneId === 'sample'}
                      onClick={() =>
                        void handleSpeakOfflineBrowserPreview(
                          'Xin chào các bạn, đây là giọng đọc tiếng Việt ngoại tuyến VieNeu TTS chạy hoàn toàn trên máy.',
                          'sample'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/70 dark:hover:bg-[#002935] text-slate-800 dark:text-teal-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {previewingSceneId === 'sample' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Mic className="w-3 h-3" />
                      )}
                      <span>{previewingSceneId === 'sample' ? 'Đang tạo audio...' : 'Nghe thử giọng VieNeu'}</span>
                    </button>
                  </div>
                )}

                {capabilities?.localTools.offlineTts.engineId !== 'vieneu' && (
                  <div className="space-y-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/60">
                    <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                      Thư viện <strong>VieNeu-TTS</strong> (11 giọng Việt tự nhiên) chưa được cài trên máy này
                      {capabilities?.localTools.offlineTts.available && capabilities.localTools.offlineTts.engine
                        ? ` (hiện chỉ có ${capabilities.localTools.offlineTts.engine} dự phòng)`
                        : ''}
                      . Bấm nút bên dưới để tải và cài tự động:
                    </p>
                    <button
                      type="button"
                      disabled={isInstallingVieNeu}
                      onClick={() => void handleInstallVieNeuOffline()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isInstallingVieNeu ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      <span>{isInstallingVieNeu ? 'Đang tải VieNeu-TTS (~300MB)...' : 'Tải & Cài VieNeu-TTS Offline'}</span>
                    </button>
                  </div>
                )}

                {offlineTtsNotice && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    {offlineTtsNotice}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Column C: Background Music */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                <Music className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
                <span>Ghép nhạc nền</span>
              </div>
              {musicMode !== 'none' && (
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-teal-200/75">
                  Âm lượng {musicVolume}%
                </span>
              )}
            </div>

            <select
              value={musicMode}
              onChange={(e) => setMusicMode(e.target.value as DerivativeMusicMode)}
              aria-label="Nguồn nhạc nền"
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
            >
              <option value="none">Không chèn nhạc nền</option>
              <option value="ai_lyria">Nhạc nền AI sáng tác (Lyria · Trả phí)</option>
              <option value="public_free">Nhạc nền công cộng miễn phí (Wikimedia Audio)</option>
              <option value="uploaded">Tải tệp nhạc từ máy (.mp3 / .wav)</option>
            </select>

            {musicMode !== 'none' && (
              <input
                type="range"
                min={5}
                max={45}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                className="w-full accent-[#003B3E]"
              />
            )}

            {musicMode === 'ai_lyria' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder="Mô tả phong cách nhạc (VD: Lo-fi chill nhẹ nhàng)..."
                  className="w-full h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={musicTrackTier}
                    onChange={(e) => setMusicTrackTier(e.target.value as 'clip' | 'pro')}
                    className="h-8 px-2 text-[11px] bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white"
                  >
                    <option value="clip">Lyria Clip (30s)</option>
                    <option value="pro">Lyria Pro (Đầy đủ)</option>
                  </select>
                  <button
                    type="button"
                    disabled={isGeneratingMusic}
                    onClick={handleGenerateAiMusic}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingMusic ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Music className="w-3.5 h-3.5" />}
                    <span>Tạo nhạc AI trước</span>
                  </button>
                </div>
                {generatedAiTrack?.url && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 truncate">{generatedAiTrack.title}</p>
                    <audio controls src={generatedAiTrack.url} className="w-full h-8" />
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
                    className="flex-1 h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    disabled={isSearchingMusic}
                    onClick={handleSearchPublicMusic}
                    className="h-8 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    {isSearchingMusic ? 'Đang tìm...' : 'Tìm nhạc'}
                  </button>
                </div>
                {publicMusicResults.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {publicMusicResults.map((tr) => {
                      const active = selectedPublicTrack?.id === tr.id;
                      return (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() => setSelectedPublicTrack(tr)}
                          className={`w-full text-left px-2.5 py-1.5 rounded border text-[11px] transition-colors cursor-pointer ${
                            active
                              ? 'border-[#003B3E] dark:border-[#1BA8AD] bg-[#003B3E]/10 text-slate-900 dark:text-white font-semibold'
                              : 'border-slate-200 dark:border-[#00464A] text-slate-700 dark:text-teal-100/80'
                          }`}
                        >
                          <div className="truncate">{tr.title}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedPublicTrack?.url && <audio controls src={selectedPublicTrack.url} className="w-full h-8" />}
              </div>
            )}

            {musicMode === 'uploaded' && (
              <div className="space-y-2">
                <input
                  ref={audioUploadInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleUploadMusicFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => audioUploadInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/70 rounded-lg text-slate-800 dark:text-white cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Chọn file nhạc (.mp3 / .wav)</span>
                </button>
                {uploadedAudioTrack?.url && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 truncate">{uploadedAudioTrack.title}</p>
                    <audio controls src={uploadedAudioTrack.url} className="w-full h-8" />
                  </div>
                )}
              </div>
            )}

            {musicError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{musicError}</p>}
          </div>
        </div>

        {/* Final Render CTA */}
        <div className="pt-4 border-t border-slate-200 dark:border-[#00464A]/80 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-500 dark:text-teal-200/75 tabular-nums">
            {!blueprint
              ? 'Hãy bấm nút "AI Lên Kịch Bản..." ở Bước 2 trước khi dựng video.'
              : batchRenderStatusText
              ? batchRenderStatusText
              : blueprints.length > 1
              ? `Đang chọn Video ${activeBatchIndex + 1}/${blueprints.length} (${blueprint.scenes.length} phân cảnh · ${aspectRatio} · ${
                  voiceMode === 'none' ? 'Không lồng tiếng' : 'Có lồng tiếng'
                }).`
              : `Sẵn sàng dựng ${blueprint.scenes.length} phân cảnh (${aspectRatio} · ${
                  voiceMode === 'none' ? 'Không lồng tiếng' : 'Có lồng tiếng'
                }) chất lượng 1080p HD.`}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {blueprints.length > 1 && (
              <button
                type="button"
                disabled={isGeneratingFinal || isBatchRenderingAll}
                onClick={handleBatchRenderAllVideos}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#1BA8AD]/15 border border-[#003B3E]/30 dark:border-[#1BA8AD]/40 hover:bg-[#003B3E]/20 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isBatchRenderingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListVideo className="w-4 h-4" />}
                <span>
                  {isBatchRenderingAll
                    ? 'Đang dựng hàng loạt...'
                    : `Dựng Hàng Loạt ${blueprints.length} Video (.MP4)`}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={!blueprint || isGeneratingFinal}
              onClick={handleRenderFinalVideo}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
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
                  : studioMode === 'creative'
                  ? 'Dựng & Xuất Video Series (.MP4)'
                  : 'Dựng & Xuất Video Phái Sinh (.MP4)'}
              </span>
            </button>
          </div>
        </div>

        {genError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{genError}</span>
          </div>
        )}

        {/* Job Progress & Output Player */}
        {job && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] space-y-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                {job.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : job.status === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-[#003B3E] dark:text-[#1BA8AD]" />
                )}
                <span>{job.stepLabel}</span>
              </div>
              <span className="font-mono tabular-nums text-slate-500 dark:text-teal-200/75">{job.progress}%</span>
            </div>

            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  job.status === 'error'
                    ? 'bg-rose-500'
                    : job.status === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-[#003B3E] dark:bg-[#1BA8AD]'
                }`}
                style={{ width: `${Math.min(100, Math.max(4, job.progress))}%` }}
              />
            </div>

            {job.warnings && job.warnings.length > 0 && (
              <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-300 list-disc pl-4">
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            {job.status === 'completed' && job.jobId && (
              <div className="space-y-3 pt-2">
                <video
                  controls
                  src={`/api/derivative/jobs/${job.jobId}/file`}
                  className="w-full max-h-[420px] rounded-lg bg-black"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-teal-200/80">
                    {job.fileName} · {job.resolution} · {job.durationSec}s · {job.fileSize ? formatBytes(job.fileSize) : ''}
                  </div>
                  <a
                    href={`/api/derivative/jobs/${job.jobId}/file?download=1`}
                    download={job.fileName || 'studio_video.mp4'}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>Tải Video MP4 Về Máy</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
