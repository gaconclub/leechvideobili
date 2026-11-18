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
  Volume2,
  BookOpen,
  Settings,
  X,
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
  StudioDefaultConfig,
  StudioMusicTrack,
  StudioUploadedAsset,
  TrendingPlatformId,
  TrendingVideoItem,
} from '../types/bilibili';
import { formatBytes, formatDuration } from '../utils/formatters';
import { getDiscoveryThumbUrl } from './VideoDiscoveryCard';

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

const STYLE_OPTIONS: { value: DerivativeStylePreset; label: string }[] = [
  { value: 'summary_fast', label: 'Tóm tắt & Điểm tin nhanh' },
  { value: 'storytelling_review', label: 'Kể chuyện / Review cuốn hút' },
  { value: 'top_list', label: 'Top điểm nổi bật / So sánh' },
  { value: 'tips_tutorial', label: 'Mẹo hay & Hướng dẫn ngắn' },
];

const VOICE_OPTIONS: { value: DerivativeVoiceId; label: string; style: string }[] = [
  { value: 'Kore', label: 'Kore · Nữ rõ ràng, truyền cảm', style: 'Clear, engaging female narrator' },
  { value: 'Puck', label: 'Puck · Nam năng động, nhịp nhanh', style: 'Energetic, upbeat young male creator' },
  { value: 'Zephyr', label: 'Zephyr · Tự nhiên, nhẹ nhàng', style: 'Warm, conversational natural voice' },
  { value: 'Charon', label: 'Charon · Nam trầm ấm, chuyên sâu', style: 'Deep, authoritative storytelling narrator' },
  { value: 'Fenrir', label: 'Fenrir · Mạnh mẽ, dứt khoát', style: 'Punchy, confident high-retention narrator' },
];

const LANGUAGE_OPTIONS: { value: DerivativeOutputLanguage; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English (Tiếng Anh)' },
  { value: 'zh', label: '中文 (Tiếng Trung)' },
  { value: 'vi_en', label: 'Song ngữ Việt - Anh' },
];

async function parseJsonSafe<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(`Máy chủ trả về phản hồi rỗng (HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const trimmed = text.trim();
    if (res.status === 413) {
      throw new Error('Dung lượng gói tải lên vượt giới hạn máy chủ trung gian (HTTP 413). Hệ thống đã tự chuyển sang tải chia nhỏ — vui lòng thử lại.');
    }
    if (res.status === 429) {
      throw new Error('Quá nhiều yêu cầu cùng lúc (HTTP 429). Vui lòng đợi vài giây rồi thử lại.');
    }
    if (trimmed.startsWith('<')) {
      throw new Error(`Máy chủ hoặc cổng proxy trả về lỗi HTML (HTTP ${res.status}). Vui lòng thử lại.`);
    }
    throw new Error(`Phản hồi không phải JSON hợp lệ (HTTP ${res.status}): ${trimmed.slice(0, 100)}`);
  }
}

async function fetchStudioJsonWithAutoRetry<T>(
  url: string,
  init: RequestInit,
  onRetrying?: () => void
): Promise<{ res: Response; data: T }> {
  let res = await fetch(url, init);
  let data = await parseJsonSafe<T>(res);
  const errStr = String((data as any)?.error || '');
  if (!res.ok && (res.status === 503 || errStr.includes('503') || errStr.includes('truy cập cao'))) {
    onRetrying?.();
    await new Promise((r) => setTimeout(r, 3200));
    res = await fetch(url, init);
    data = await parseJsonSafe<T>(res);
  }
  return { res, data };
}

const STUDIO_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB chunks (safely under Cloud Run 32 MiB limit)

async function uploadMediaFileToStudio<T>(
  file: File,
  kind: 'video' | 'audio',
  onProgress?: (percent: number) => void
): Promise<T> {
  // Small files <= 3 MiB can upload in a single request
  if (file.size <= 3 * 1024 * 1024) {
    const endpoint = kind === 'video' ? '/api/studio/upload-video' : '/api/studio/upload-audio';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await parseJsonSafe<{ asset?: T; error?: string }>(res);
    if (!res.ok || !data.asset) {
      throw new Error(data.error || `Không thể tải lên "${file.name}" (HTTP ${res.status}).`);
    }
    onProgress?.(100);
    return data.asset;
  }

  // Larger files upload sequentially in 4 MiB chunks
  const initRes = await fetch('/api/studio/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, fileName: file.name }),
  });
  const initData = await parseJsonSafe<{ uploadId?: string; error?: string }>(initRes);
  if (!initRes.ok || !initData.uploadId) {
    throw new Error(initData.error || `Không thể khởi tạo tải lên "${file.name}".`);
  }

  const uploadId = initData.uploadId;
  let offset = 0;
  let chunkIndex = 0;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + STUDIO_UPLOAD_CHUNK_SIZE);
    const slice = file.slice(offset, end);
    const chunkRes = await fetch(`/api/studio/uploads/${uploadId}/chunk?index=${chunkIndex}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: slice,
    });
    const chunkData = await parseJsonSafe<{ ok?: boolean; error?: string }>(chunkRes);
    if (!chunkRes.ok || !chunkData.ok) {
      throw new Error(chunkData.error || `Lỗi tải đoạn #${chunkIndex + 1} của "${file.name}".`);
    }
    offset = end;
    chunkIndex += 1;
    onProgress?.(Math.min(95, Math.round((offset / file.size) * 95)));
  }

  const completeRes = await fetch(`/api/studio/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const completeData = await parseJsonSafe<{ asset?: T; error?: string }>(completeRes);
  if (!completeRes.ok || !completeData.asset) {
    throw new Error(completeData.error || `Không thể xử lý tệp "${file.name}" sau khi tải lên.`);
  }
  onProgress?.(100);
  return completeData.asset;
}

async function compressImageFileToDataUrl(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(rawUrl);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => resolve(rawUrl);
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

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

  // 1. Source videos (uploaded local + searched/pushed online)
  const [sources, setSources] = useState<
    (TrendingVideoItem & { localAssetId?: string; keyframes?: string[]; hasAudio?: boolean })[]
  >([]);
  const [isUploadingVideos, setIsUploadingVideos] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [uploadError, setUploadError] = useState('');
  const videoUploadInputRef = useRef<HTMLInputElement>(null);

  // Inline Search Drawer to pull videos directly into Studio
  const [searchQueryInput, setSearchQueryInput] = useState('');
  const [searchPlatform, setSearchPlatform] = useState<TrendingPlatformId>('all');
  const [isSearchingSources, setIsSearchingSources] = useState(false);
  const [searchResults, setSearchResults] = useState<TrendingVideoItem[]>([]);
  const [searchError, setSearchError] = useState('');

  // Character References
  const [characters, setCharacters] = useState<StudioCharacterRef[]>([]);
  const [charNameInput, setCharNameInput] = useState('');
  const [charPromptInput, setCharPromptInput] = useState('');
  const [isGeneratingChar, setIsGeneratingChar] = useState(false);
  const [charError, setCharError] = useState('');
  const charUploadInputRef = useRef<HTMLInputElement>(null);

  // 2. Learning & Script Config
  const [aiProvider, setAiProvider] = useState<AiProviderId>(
    (studioDefaults.aiProvider as string) === 'muse' ? 'gemini' : studioDefaults.aiProvider || 'gemini'
  );
  const [useProModel, setUseProModel] = useState(false);
  const [outputLanguage, setOutputLanguage] = useState<DerivativeOutputLanguage>('vi');
  const [stylePreset, setStylePreset] = useState<DerivativeStylePreset>(
    studioDefaults.stylePreset || 'storytelling_review'
  );
  const [aspectRatio, setAspectRatio] = useState<DerivativeAspectRatio>(
    studioDefaults.aspectRatioMode === '16:9' ? '16:9' : '9:16'
  );
  const [targetDurationSec, setTargetDurationSec] = useState<number>(
    studioDefaults.targetDurationSec >= 20 ? studioDefaults.targetDurationSec : 60
  );
  const [customInstruction, setCustomInstruction] = useState('');

  const [isLearning, setIsLearning] = useState(false);
  const [learnError, setLearnError] = useState('');
  const [learnSuccess, setLearnSuccess] = useState('');
  const [blueprint, setBlueprint] = useState<DerivativeBlueprint | null>(null);

  // 3. Per-scene generation states
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

  // 4. Production: Visual engine + Music + Voice + Final Render
  const [visualMode, setVisualMode] = useState<DerivativeVisualMode>(
    (studioDefaults.visualMode as string) === 'muse_edison'
      ? 'muse2api_video'
      : studioDefaults.visualMode || 'muse2api_video'
  );
  const [brollSource, setBrollSource] = useState<BrollSourceId>(studioDefaults.brollSource || 'wikimedia');

  const [musicMode, setMusicMode] = useState<DerivativeMusicMode>('none');
  const [musicPrompt, setMusicPrompt] = useState('Nhạc nền hiện đại, truyền cảm hứng, tiết tấu vừa phải cho video review');
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

  const [job, setJob] = useState<DerivativeJobState | null>(null);
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);
  const [genError, setGenError] = useState('');
  const pollTimerRef = useRef<number | null>(null);

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

  // Sync incoming videos when pushed from Search or Trending tabs
  useEffect(() => {
    if (incomingVideos.length === 0) return;
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

  // Character uploads & AI generation
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

  const handleGenerateCharacterAi = async () => {
    const desc = charPromptInput.trim();
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
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      const generatedUrl = data.dataUrl;
      setCharacters((prev) => [
        ...prev.slice(0, 2),
        {
          id: `char_ai_${Date.now()}`,
          name: charNameInput.trim() || 'Nhân vật AI',
          description: desc,
          dataUrl: generatedUrl,
          source: 'ai_generated',
        },
      ]);
      setCharNameInput('');
    } catch (err: any) {
      setCharError(err?.message || 'Không thể tạo ảnh nhân vật AI.');
    } finally {
      setIsGeneratingChar(false);
    }
  };

  // AI Learn & Create Script
  const handleLearnAndCreateScript = async () => {
    if (sources.length === 0) {
      setLearnError('Vui lòng tải lên hoặc thêm ít nhất 1 video nguồn ở Bước 1.');
      return;
    }
    setIsLearning(true);
    setLearnError('');
    setLearnSuccess('');
    setSceneMediaError('');
    setSceneImageErrors({});
    setJob(null);
    stopPolling();

    const charSummary = characters
      .map((c) => `${c.name}${c.description ? `: ${c.description}` : ''}`)
      .join('; ');

    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{
        blueprint?: DerivativeBlueprint;
        error?: string;
      }>('/api/derivative/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQueryInput.trim() || incomingQuery,
          videos: sources,
          stylePreset,
          aspectRatio,
          targetDurationSec,
          outputLanguage,
          useProModel: aiProvider === 'gemini' && useProModel,
          characterSummary: charSummary,
          customInstruction,
          aiProvider,
        }),
      });
      if (!res.ok || !data.blueprint) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBlueprint(data.blueprint);
    } catch (err: any) {
      setLearnError(err?.message || 'AI không thể phân tích nội dung video.');
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
      const newScene: DerivativeScene = {
        id: `scene_custom_${Date.now()}`,
        sceneIndex: idx + 1,
        durationSec: 10,
        sourceVideoIndex: idx % Math.max(1, sources.length),
        sourceStartPercent: (idx * 20) % 75,
        onScreenText: `Phân cảnh #${idx + 1}`,
        narration: 'Tiếp nối nội dung chuyên sâu với góc nhìn thực tế giúp người xem dễ áp dụng.',
        visualNote: 'Nhân vật trình bày trong bối cảnh hiện đại, ánh sáng rõ nét.',
        brollKeywordEn: 'creative studio presentation',
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

  // Generate AI Scene Image keeping Character Ref
  const generateSingleSceneImage = async (
    sc: DerivativeScene,
    opts?: { preserveGlobalError?: boolean }
  ): Promise<boolean> => {
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
    try {
      const { res, data } = await fetchStudioJsonWithAutoRetry<{ dataUrl?: string; error?: string }>(
        '/api/studio/generate-image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'scene',
            prompt: `${sc.visualNote || sc.onScreenText}. Context: ${sc.narration.slice(0, 140)}`,
            aspectRatio,
            quality: imageEngineMode === 'gemini_pro' ? 'pro' : 'standard',
            engine: imageEngineMode === 'muse2api' ? 'muse2api' : 'gemini',
            characterRefs: characters.map((c) => ({ dataUrl: c.dataUrl, name: c.name })),
          }),
        }
      );
      if (!res.ok || !data.dataUrl) throw new Error(data.error || `HTTP ${res.status}`);
      updateScene(sc.id, { sceneImageDataUrl: data.dataUrl });
      return true;
    } catch (err: any) {
      const errMsg = err?.message || `Không thể tạo ảnh cho cảnh ${sc.sceneIndex}.`;
      setSceneImageErrors((prev) => ({ ...prev, [sc.id]: errMsg }));
      setSceneMediaError(`Cảnh ${sc.sceneIndex}: ${errMsg}`);
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
        `Đã hoàn tất lượt tạo hàng loạt (${pendingScenes.length - failedCount}/${pendingScenes.length} cảnh thành công, ${failedCount} cảnh lỗi — xem chi tiết ngay dưới từng cảnh).`
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

  // Generate AI Video Clip with Gemini Omni Flash (gemini-omni-1.2-flash) or Muse2API (muse-video)
  const handleGenerateSceneOmniClip = async (sc: DerivativeScene) => {
    setBusySceneVideoIds((prev) => new Set(prev).add(sc.id));
    setSceneMediaError('');
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
          prompt: `${sc.visualNote || sc.onScreenText}. ${sc.narration.slice(0, 160)}`,
          aspectRatio,
          durationSec: Math.min(sceneVideoEngine === 'muse2api' ? 12 : 15, Math.max(4, Math.round(sc.durationSec || 8))),
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
          `Không tạo được clip ${sceneVideoEngine === 'muse2api' ? 'Muse2API' : 'Omni Flash'} cho cảnh ${sc.sceneIndex}.`
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

  // Rehearse offline speech (uses VieNeu-TTS WAV preview when offline VieNeu is active, else browser speechSynthesis)
  const handleSpeakOfflineBrowserPreview = async (text: string, sceneKey = 'sample') => {
    const cleanText = text.trim();
    if (!cleanText) return;

    if (
      voiceMode === 'offline_system' &&
      capabilities?.localTools.offlineTts.engineId === 'vieneu'
    ) {
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

  // Final Render Pipeline
  const handleRenderFinalVideo = async () => {
    if (!blueprint || sources.length === 0) return;
    stopPolling();
    setIsGeneratingFinal(true);
    setGenError('');
    setJob({
      jobId: '',
      status: 'queued',
      progress: 5,
      stepLabel: 'Đang gửi yêu cầu dựng video hoàn chỉnh...',
    });

    const voiceObj = VOICE_OPTIONS.find((v) => v.value === voice);
    const activeMusicAssetId =
      musicMode === 'ai_lyria'
        ? generatedAiTrack?.assetId
        : musicMode === 'uploaded'
        ? uploadedAudioTrack?.assetId
        : undefined;

    try {
      const res = await fetch('/api/derivative/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprint: { ...blueprint, aspectRatio },
          sources,
          visualMode,
          voice: voiceMode === 'ai_online' ? voice : 'none',
          voiceMode,
          voiceStyle: voiceObj?.style || '',
          offlineVoice: voiceMode === 'offline_system' ? offlineVoice : undefined,
          keepSourceAudio,
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
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const stRes = await fetch(`/api/derivative/jobs/${jobId}`);
          if (!stRes.ok) return;
          const stData = await parseJsonSafe<DerivativeJobState>(stRes);
          setJob(stData);
          if (stData.status === 'completed' || stData.status === 'error') {
            stopPolling();
            setIsGeneratingFinal(false);
            if (stData.status === 'error') {
              setGenError(stData.error || 'Tạo video thất bại.');
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 1400);
    } catch (err: any) {
      setIsGeneratingFinal(false);
      setGenError(err?.message || 'Không thể khởi tạo tác vụ dựng video.');
    }
  };

  const totalSceneSec = blueprint
    ? Math.round(blueprint.scenes.reduce((sum, s) => sum + Number(s.durationSec || 0), 0))
    : 0;

  return (
    <div className="space-y-6">
      {/* Studio Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 dark:border-[#00464A]/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Studio Sáng Tạo Video Phái Sinh
          </h1>
          <p className="text-sm text-slate-600 dark:text-teal-100/75 mt-1">
            Tải nhiều video lên hoặc chọn từ tìm kiếm · AI học khung hình, phụ đề & lời thoại · Dựng clip Omni Flash, ảnh nhân vật, nhạc nền & lồng tiếng.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-teal-200/75">
            {sources.length}/8 video nguồn · {characters.length}/3 nhân vật
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

      {/* SECTION 1: MULTI-VIDEO SOURCES & CHARACTER REFERENCES */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Video Sources (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  1. Nguồn video tham chiếu ({sources.length}/8)
                </h2>
                <p className="text-xs text-slate-500 dark:text-teal-200/70">
                  Tải nhiều video từ máy tính hoặc tìm trực tiếp từ các nền tảng video.
                </p>
              </div>
              <div>
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

            {uploadError && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Selected Sources List */}
            {sources.length === 0 ? (
              <div className="border border-dashed border-slate-300 dark:border-[#00464A] rounded-lg p-6 text-center space-y-2">
                <Film className="w-6 h-6 text-slate-400 dark:text-teal-300/60 mx-auto" />
                <p className="text-xs text-slate-600 dark:text-teal-100/75">
                  Chưa có video nguồn nào. Bấm <strong>Tải nhiều video lên</strong> hoặc tìm kiếm bên dưới để thêm video cho AI học nội dung.
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

          {/* Inline Search Bar inside Studio */}
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
                placeholder="Tìm nhanh video trên YouTube, TikTok, Bilibili để thêm vào Studio..."
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
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
          </div>
        </div>

        {/* Right: Character References (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Nhân vật tham chiếu ({characters.length}/3)
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
            <p className="text-xs text-slate-500 dark:text-teal-200/70">
              Dùng để AI giữ nguyên ngoại hình nhân vật khi tạo ảnh đại diện từng phân cảnh hoặc dựng clip Omni Flash.
            </p>

            {/* AI Character Generator */}
            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={charNameInput}
                  onChange={(e) => setCharNameInput(e.target.value)}
                  placeholder="Tên nhân vật (VD: Minh Review)"
                  className="w-1/3 h-8 px-2.5 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
                <input
                  type="text"
                  value={charPromptInput}
                  onChange={(e) => setCharPromptInput(e.target.value)}
                  placeholder="Mô tả ngoại hình để AI vẽ (VD: cô gái trẻ áo vest xanh phòng thu)..."
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
                    Muse2API (muse-image · Ưu tiên · {capabilities?.aiProviders.muse2api?.configured ? 'Sẵn sàng' : 'Tự host'})
                  </option>
                  <option value="gemini_standard">Gemini Flash Image (gemini-3.1-flash-lite-image)</option>
                  <option value="gemini_pro">Nano Banana 2.1 (Chất lượng cao 1K)</option>
                </select>
                <button
                  type="button"
                  disabled={isGeneratingChar || characters.length >= 3}
                  onClick={handleGenerateCharacterAi}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isGeneratingChar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  <span>AI tạo nhân vật mới</span>
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
              <div className="grid grid-cols-3 gap-2.5 pt-2">
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
          </div>
        </div>
      </section>

      {/* SECTION 2: AI LEARNING & SCRIPT SETTINGS */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                2. AI học nội dung & Sáng tạo kịch bản mới
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Phân tích tiêu đề, mô tả, khung hình, phụ đề & chép lời từ video nguồn để biên soạn phân cảnh chi tiết.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isLearning || sources.length === 0}
              onClick={handleLearnAndCreateScript}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isLearning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {isLearning
                  ? 'Đang xử lý...'
                  : aiProvider === 'muse2api'
                  ? 'Muse2API học & Lập kịch bản'
                  : 'AI học video & Lập kịch bản'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              Ngôn ngữ lời thoại & phụ đề
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
              Phong cách biên tập
            </span>
            <select
              value={stylePreset}
              onChange={(e) => setStylePreset(e.target.value as DerivativeStylePreset)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              {STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80">
              Tỉ lệ khung hình
            </span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as DerivativeAspectRatio)}
              className="w-full h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="9:16">9:16 Dọc (Shorts / TikTok)</option>
              <option value="16:9">16:9 Ngang (YouTube / Web)</option>
            </select>
          </label>

          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/80 tabular-nums">
              Thời lượng ({Math.floor(targetDurationSec / 60)}p {targetDurationSec % 60}s)
            </span>
            <div className="flex items-center gap-1.5">
              <select
                value={[30, 60, 180, 300, 360, 480, 600].includes(targetDurationSec) ? String(targetDurationSec) : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') setTargetDurationSec(Number(e.target.value));
                }}
                aria-label="Mốc thời lượng"
                className="flex-1 h-9 px-2 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="30">30s</option>
                <option value="60">1 phút</option>
                <option value="180">3 phút</option>
                <option value="300">5 phút</option>
                <option value="360">6 phút</option>
                <option value="480">8 phút</option>
                <option value="600">10 phút</option>
                {![30, 60, 180, 300, 360, 480, 600].includes(targetDurationSec) && (
                  <option value="custom">{targetDurationSec}s</option>
                )}
              </select>
              <input
                type="number"
                min={20}
                max={900}
                step={15}
                value={targetDurationSec}
                onChange={(e) => setTargetDurationSec(Math.max(20, Math.min(900, Number(e.target.value) || 30)))}
                className="w-16 h-9 px-1.5 text-xs font-mono tabular-nums text-center bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="Chỉ đạo thêm cho AI (VD: Nhấn mạnh số liệu thực tế, giữ giọng văn dí dỏm, thêm lời kêu gọi cuối video)..."
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

      {/* SECTION 3: STORYBOARD EDITOR, AI SCENE IMAGES & OMNI FLASH CLIPS */}
      {blueprint && (
        <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-5">
          {/* AI Learned Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4 border-b border-slate-200 dark:border-[#00464A]/80">
            <div className="lg:col-span-7 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD]">
                <BookOpen className="w-4 h-4" />
                <span>AI đã tổng hợp từ {blueprint.sourcesAnalyzed.length} video ({blueprint.usedModel || blueprint.usedProvider})</span>
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
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">Tiêu đề video phái sinh</span>
                <input
                  type="text"
                  value={blueprint.derivativeTitle}
                  onChange={(e) => setBlueprint({ ...blueprint, derivativeTitle: e.target.value })}
                  className="w-full h-9 px-3 text-xs font-semibold bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/80">Chữ Hook nổi bật 3.5 giây đầu</span>
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

          {/* Storyboard Controls Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-teal-100/85 tabular-nums">
              <strong>3. Dàn phân cảnh ({blueprint.scenes.length} cảnh)</strong> · Tổng ước lượng{' '}
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
                    ? 'Tạo ảnh Muse2API tất cả cảnh'
                    : 'Tạo ảnh AI cho tất cả cảnh'}
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

          {/* Scenes List (Clean hairline dividers, single elevation) */}
          <div className="divide-y divide-slate-200 dark:divide-[#00464A]/80 border border-slate-200 dark:border-[#00464A] rounded-xl overflow-hidden">
            {blueprint.scenes.map((sc, idx) => {
              const busyImg = busySceneImageIds.has(sc.id);
              const queuedImg = queuedSceneImageIds.has(sc.id);
              const busyVid = busySceneVideoIds.has(sc.id);
              const sceneErr = sceneImageErrors[sc.id];
              return (
                <div key={sc.id} className="p-4 bg-slate-50/40 dark:bg-[#000A10]/40 grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Visual Preview + Media Actions (4 cols) */}
                  <div className="lg:col-span-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-[#003B3E] dark:text-[#1BA8AD] tabular-nums">
                        Cảnh {idx + 1}/{blueprint.scenes.length}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={4}
                          max={45}
                          value={Math.round(sc.durationSec || 6)}
                          onChange={(e) =>
                            updateScene(sc.id, {
                              durationSec: Math.max(4, Math.min(45, Number(e.target.value) || 6)),
                            })
                          }
                          aria-label="Thời lượng cảnh"
                          className="w-12 h-6 px-1 text-[11px] font-mono tabular-nums text-center bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded text-slate-900 dark:text-white"
                        />
                        <span className="text-[11px] text-slate-500">giây</span>
                        {blueprint.scenes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteScene(sc.id)}
                            title="Xóa cảnh này"
                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-200 dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] flex items-center justify-center">
                      {sc.omniClipPreviewUrl ? (
                        <video
                          src={sc.omniClipPreviewUrl}
                          controls
                          muted
                          className="w-full h-full object-contain bg-black"
                        />
                      ) : sc.sceneImageDataUrl ? (
                        <img
                          src={sc.sceneImageDataUrl}
                          alt={`Cảnh ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center px-3 space-y-1">
                          <ImageIcon className="w-5 h-5 text-slate-400 dark:text-teal-300/50 mx-auto" />
                          <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                            Dùng clip nguồn / Wikimedia hoặc bấm tạo ảnh · clip AI bên dưới
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={busyImg || queuedImg}
                        onClick={() => generateSingleSceneImage(sc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#002935] text-slate-800 dark:text-teal-100 rounded transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {busyImg || queuedImg ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ImageIcon className="w-3 h-3" />
                        )}
                        <span>
                          {busyImg
                            ? 'Đang tạo ảnh...'
                            : queuedImg
                            ? 'Đang chờ lượt...'
                            : sc.sceneImageDataUrl
                            ? 'Tạo lại ảnh AI'
                            : 'Tạo ảnh AI'}
                        </span>
                      </button>

                      <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#002935] text-slate-800 dark:text-teal-100 rounded transition-colors cursor-pointer">
                        <Upload className="w-3 h-3" />
                        <span>Tải ảnh</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void handleUploadSceneImage(sc.id, f);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        disabled={busyVid}
                        onClick={() => handleGenerateSceneOmniClip(sc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#003B3E] hover:bg-[#002729] text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {busyVid ? <Loader2 className="w-3 h-3 animate-spin" /> : <Film className="w-3 h-3" />}
                        <span>
                          {busyVid
                            ? sceneVideoEngine === 'muse2api'
                              ? 'Đang tạo Muse2API...'
                              : 'Đang tạo Omni...'
                            : sceneVideoEngine === 'muse2api'
                            ? 'Dựng clip Muse2API'
                            : 'Dựng clip Omni'}
                        </span>
                      </button>
                    </div>
                    {sceneErr && (
                      <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                        {sceneErr}
                      </div>
                    )}
                  </div>

                  {/* Editable Scene Text Fields (8 cols) */}
                  <div className="lg:col-span-8 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <label className="sm:col-span-6 space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Chữ hiển thị trên màn hình</span>
                        <input
                          type="text"
                          value={sc.onScreenText}
                          onChange={(e) => updateScene(sc.id, { onScreenText: e.target.value })}
                          className="w-full h-8 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                        />
                      </label>
                      <label className="sm:col-span-6 space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Mô tả hình ảnh (Ảnh AI / Omni)</span>
                        <input
                          type="text"
                          value={sc.visualNote || ''}
                          onChange={(e) => updateScene(sc.id, { visualNote: e.target.value })}
                          className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                        />
                      </label>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Lời thuyết minh lồng tiếng</span>
                        <button
                          type="button"
                          disabled={previewingSceneId === sc.id}
                          onClick={() => void handleSpeakOfflineBrowserPreview(sc.narration, sc.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-[#003B3E] dark:text-[#1BA8AD] hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {previewingSceneId === sc.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                          <span>
                            {previewingSceneId === sc.id
                              ? 'Đang tạo giọng VieNeu...'
                              : voiceMode === 'offline_system' && capabilities?.localTools.offlineTts.engineId === 'vieneu'
                              ? 'Nghe thử VieNeu'
                              : 'Nghe nháp trình duyệt'}
                          </span>
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={sc.narration}
                        onChange={(e) => updateScene(sc.id, { narration: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Video nguồn cắt ghép</span>
                        <select
                          value={sc.sourceVideoIndex}
                          onChange={(e) => updateScene(sc.id, { sourceVideoIndex: Number(e.target.value) })}
                          className="w-full h-8 px-2 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white"
                        >
                          {sources.map((s, sIdx) => (
                            <option key={s.id} value={sIdx}>
                              #{sIdx + 1} · {(s.translatedTitle || s.title).slice(0, 42)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Từ khóa Wikimedia B-roll (EN)</span>
                        <input
                          type="text"
                          value={sc.brollKeywordEn || ''}
                          onChange={(e) => updateScene(sc.id, { brollKeywordEn: e.target.value })}
                          className="w-full h-8 px-2.5 text-xs font-mono bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
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
                <option value="remix">Video nguồn / Tải lên + Kho Wikimedia (Miễn phí)</option>
                <option value="storyboard_motion">Ảnh đại diện cảnh + Chuyển động Ken Burns</option>
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
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-teal-100/90 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={keepSourceAudio}
                onChange={(e) => setKeepSourceAudio(e.target.checked)}
                className="rounded border-slate-300 text-[#003B3E] focus:ring-[#003B3E]"
              />
              <span>Giữ âm thanh gốc video nguồn nhỏ (12%)</span>
            </label>
          </div>

          {/* Column B: Voiceover Online / Offline */}
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
                        <Volume2 className="w-3 h-3" />
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

          {/* Column C: Background Music (AI Lyria / Public Free / Uploaded) */}
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
                {selectedPublicTrack?.url && (
                  <audio controls src={selectedPublicTrack.url} className="w-full h-8" />
                )}
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
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 truncate">
                      {uploadedAudioTrack.title}
                    </p>
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
          <div className="text-xs text-slate-500 dark:text-teal-200/75">
            {!blueprint
              ? 'Hãy bấm "AI học video & Lập kịch bản" ở Bước 2 để có danh sách phân cảnh trước khi dựng.'
              : `Sẵn sàng dựng ${blueprint.scenes.length} phân cảnh (${aspectRatio}) với chất lượng 1080p HD.`}
          </div>
          <button
            type="button"
            disabled={!blueprint || isGeneratingFinal}
            onClick={handleRenderFinalVideo}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isGeneratingFinal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>{isGeneratingFinal ? 'Đang dựng Video Phái Sinh...' : 'Dựng & Xuất Video Phái Sinh (.MP4)'}</span>
          </button>
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
                  job.status === 'error' ? 'bg-rose-500' : job.status === 'completed' ? 'bg-emerald-500' : 'bg-[#003B3E] dark:bg-[#1BA8AD]'
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
                    download={job.fileName || 'video_phai_sinh.mp4'}
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
