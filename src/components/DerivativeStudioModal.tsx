import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Wand2,
  Loader2,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Film,
  Volume2,
  BookOpen,
  RotateCcw,
} from 'lucide-react';
import {
  AiProviderId,
  BrollSourceId,
  DerivativeAspectRatio,
  DerivativeBlueprint,
  DerivativeJobState,
  DerivativeScene,
  DerivativeStylePreset,
  DerivativeVisualMode,
  DerivativeVoiceId,
  StudioDefaultConfig,
  TrendingVideoItem,
} from '../types/bilibili';
import { formatBytes, formatDuration } from '../utils/formatters';
import { getDiscoveryThumbUrl } from './VideoDiscoveryCard';

interface DerivativeStudioModalProps {
  isOpen: boolean;
  initialVideos: TrendingVideoItem[];
  searchQuery?: string;
  sessdata: string;
  ytCookies: string;
  studioDefaults?: StudioDefaultConfig;
  onClose: () => void;
}

const STYLE_OPTIONS: { value: DerivativeStylePreset; label: string }[] = [
  { value: 'summary_fast', label: 'Tóm tắt & Điểm tin nhanh' },
  { value: 'storytelling_review', label: 'Kể chuyện / Review cuốn hút' },
  { value: 'top_list', label: 'Top điểm nổi bật / So sánh' },
  { value: 'tips_tutorial', label: 'Mẹo hay & Hướng dẫn ngắn' },
];

const VOICE_OPTIONS: { value: DerivativeVoiceId; label: string; style: string }[] = [
  { value: 'Kore', label: 'Kore · Nữ rõ ràng, truyền cảm', style: 'Clear, engaging Vietnamese female narrator' },
  { value: 'Puck', label: 'Puck · Nam năng động, nhịp nhanh', style: 'Energetic, upbeat young male Vietnamese creator' },
  { value: 'Zephyr', label: 'Zephyr · Tự nhiên, nhẹ nhàng', style: 'Warm, conversational natural Vietnamese voice' },
  { value: 'Charon', label: 'Charon · Nam trầm ấm, chuyên sâu', style: 'Deep, authoritative storytelling narrator' },
  { value: 'Fenrir', label: 'Fenrir · Mạnh mẽ, dứt khoát', style: 'Punchy, confident high-retention narrator' },
  { value: 'none', label: 'Không lồng tiếng (chỉ hình + chữ)', style: '' },
];

export const DerivativeStudioModal: React.FC<DerivativeStudioModalProps> = ({
  isOpen,
  initialVideos,
  searchQuery = '',
  sessdata,
  ytCookies,
  studioDefaults,
  onClose,
}) => {
  const [sources, setSources] = useState<TrendingVideoItem[]>([]);
  const [aiProvider, setAiProvider] = useState<AiProviderId>('gemini');
  const [brollSource, setBrollSource] = useState<BrollSourceId>('auto');
  const [stylePreset, setStylePreset] = useState<DerivativeStylePreset>('summary_fast');
  const [aspectRatio, setAspectRatio] = useState<DerivativeAspectRatio>('9:16');
  const [targetDuration, setTargetDuration] = useState<'short' | 'medium'>('short');
  const [customInstruction, setCustomInstruction] = useState('');

  const [isLearning, setIsLearning] = useState(false);
  const [learnError, setLearnError] = useState('');
  const [blueprint, setBlueprint] = useState<DerivativeBlueprint | null>(null);

  const [visualMode, setVisualMode] = useState<DerivativeVisualMode>('remix');
  const [voice, setVoice] = useState<DerivativeVoiceId>('Kore');
  const [keepSourceAudio, setKeepSourceAudio] = useState(false);

  const [job, setJob] = useState<DerivativeJobState | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      const sliced = initialVideos.slice(0, 6);
      setSources(sliced);
      const verticalCount = sliced.filter((v) => v.orientation === 'vertical').length;
      const autoRatio: DerivativeAspectRatio =
        verticalCount >= Math.ceil(sliced.length / 2) ? '9:16' : '16:9';

      if (studioDefaults) {
        setAiProvider(studioDefaults.aiProvider);
        setBrollSource(studioDefaults.brollSource);
        setStylePreset(studioDefaults.stylePreset);
        setAspectRatio(
          studioDefaults.aspectRatioMode === 'auto' ? autoRatio : studioDefaults.aspectRatioMode
        );
        setTargetDuration(studioDefaults.targetDuration);
        setVisualMode(studioDefaults.visualMode);
        setVoice(studioDefaults.voice);
        setKeepSourceAudio(studioDefaults.keepSourceAudio);
      } else {
        setAspectRatio(autoRatio);
      }

      setBlueprint(null);
      setLearnError('');
      setJob(null);
      setGenError('');
      setIsLearning(false);
      setIsGenerating(false);
    }
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, initialVideos, studioDefaults]);

  if (!isOpen) return null;

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const handleRemoveSource = (id: string) => {
    if (sources.length <= 1) return;
    setSources((prev) => prev.filter((s) => s.id !== id));
    setBlueprint(null);
    setJob(null);
  };

  const handleLearnContent = async () => {
    if (sources.length === 0) return;
    setIsLearning(true);
    setLearnError('');
    setJob(null);
    setGenError('');
    stopPolling();

    try {
      const res = await fetch('/api/derivative/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          videos: sources,
          stylePreset,
          aspectRatio,
          targetDuration,
          customInstruction,
          aiProvider,
        }),
      });
      const text = await res.text();
      const data = JSON.parse(text) as { blueprint?: DerivativeBlueprint; error?: string };
      if (!res.ok || !data.blueprint) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBlueprint(data.blueprint);
    } catch (err: any) {
      setLearnError(err?.message || 'Không thể phân tích nội dung các video đã chọn.');
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
      if (!prev || prev.scenes.length >= 8) return prev;
      const idx = prev.scenes.length;
      const newScene: DerivativeScene = {
        id: `scene_custom_${Date.now()}`,
        sceneIndex: idx + 1,
        durationSec: 7,
        sourceVideoIndex: idx % Math.max(1, sources.length),
        sourceStartPercent: (idx * 20) % 75,
        onScreenText: `Điểm nhấn #${idx + 1}`,
        narration: 'Chia sẻ thêm góc nhìn nổi bật giúp người xem áp dụng ngay.',
        visualNote: '',
      };
      return { ...prev, scenes: [...prev.scenes, newScene] };
    });
  };

  const handleDeleteScene = (sceneId: string) => {
    setBlueprint((prev) => {
      if (!prev || prev.scenes.length <= 1) return prev;
      const filtered = prev.scenes
        .filter((s) => s.id !== sceneId)
        .map((s, idx) => ({ ...s, sceneIndex: idx + 1 }));
      return { ...prev, scenes: filtered };
    });
  };

  const handleGenerateVideo = async () => {
    if (!blueprint || sources.length === 0) return;
    stopPolling();
    setIsGenerating(true);
    setGenError('');
    setJob({
      jobId: '',
      status: 'queued',
      progress: 5,
      stepLabel: 'Đang gửi yêu cầu dựng video phái sinh...',
    });

    const selectedVoiceObj = VOICE_OPTIONS.find((v) => v.value === voice);

    try {
      const res = await fetch('/api/derivative/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprint: { ...blueprint, aspectRatio },
          sources,
          visualMode,
          voice,
          voiceStyle: selectedVoiceObj?.style || '',
          keepSourceAudio,
          brollSource,
          sessdata,
          ytCookies,
        }),
      });
      const text = await res.text();
      const data = JSON.parse(text) as DerivativeJobState & { error?: string };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const activeJobId = data.jobId;
      setJob(data);

      pollTimerRef.current = window.setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/derivative/jobs/${activeJobId}`);
          if (!pollRes.ok) {
            if (pollRes.status === 404) {
              stopPolling();
              setIsGenerating(false);
              setGenError('Tác vụ không còn tồn tại trên máy chủ.');
            }
            return;
          }
          const jobData = (await pollRes.json()) as DerivativeJobState;
          setJob(jobData);
          if (jobData.status === 'completed' || jobData.status === 'error') {
            stopPolling();
            setIsGenerating(false);
            if (jobData.status === 'error') {
              setGenError(jobData.error || 'Quá trình tạo video gặp sự cố.');
            }
          }
        } catch {
          // ignore transient poll network error
        }
      }, 1100);
    } catch (err: any) {
      stopPolling();
      setIsGenerating(false);
      setGenError(err?.message || 'Không thể bắt đầu tạo video phái sinh.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="derivative-modal-title"
    >
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-[#00464A] bg-slate-50/70 dark:bg-[#000A10]/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#003B3E] text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h2
                id="derivative-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-white truncate"
              >
                AI Học nội dung &amp; Tạo Video Phái Sinh
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70 truncate">
                Phân tích mô tả, phụ đề, khung hình từ {sources.length} video nguồn → tổng hợp kịch bản mới → dựng MP4 + lồng tiếng AI
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopPolling();
              onClose();
            }}
            aria-label="Đóng"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Workspace Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* 1. Source Videos Strip */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-teal-200/75">
                1. Video nguồn để AI học ({sources.length})
              </h3>
              {searchQuery && (
                <span className="text-xs text-[#003B3E] dark:text-[#1BA8AD] font-medium truncate max-w-xs">
                  Chủ đề: &ldquo;{searchQuery}&rdquo;
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {sources.map((src, idx) => (
                <div
                  key={src.id}
                  className="flex items-center gap-2.5 p-2 rounded-xl bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A]"
                >
                  <div className="relative w-16 h-10 rounded-md overflow-hidden bg-slate-900 shrink-0">
                    {src.pic ? (
                      <img
                        src={getDiscoveryThumbUrl(src.pic)}
                        alt={src.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-teal-200/60">
                        <Film className="w-4 h-4" />
                      </div>
                    )}
                    <span className="absolute top-0.5 left-0.5 px-1 rounded bg-slate-950/80 text-white text-[9px] font-bold font-mono">
                      #{idx + 1}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {src.translatedTitle || src.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-teal-200/65 truncate">
                      {src.platformLabel} · {src.duration > 0 ? formatDuration(src.duration) : 'Ngắn'}
                    </p>
                  </div>
                  {sources.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSource(src.id)}
                      title="Bỏ video này khỏi danh sách học"
                      className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 2. Learning Parameters & Trigger */}
          <section className="p-4 rounded-xl bg-[#F8FAFB] dark:bg-[#000A10]/90 border border-slate-200/90 dark:border-[#00464A] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                  AI học & viết kịch bản
                </span>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as AiProviderId)}
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                >
                  <option value="gemini">Google Gemini (Mặc định)</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                  <option value="meta">Meta AI (Llama)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                  Phong cách nội dung phái sinh
                </span>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value as DerivativeStylePreset)}
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                >
                  {STYLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                  Khung hình đầu ra
                </span>
                <select
                  value={aspectRatio}
                  onChange={(e) => {
                    const val = e.target.value as DerivativeAspectRatio;
                    setAspectRatio(val);
                    setBlueprint((prev) => (prev ? { ...prev, aspectRatio: val } : prev));
                  }}
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                >
                  <option value="9:16">9:16 Dọc (TikTok / Shorts / Reels)</option>
                  <option value="16:9">16:9 Ngang (YouTube / Bilibili)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                  Thời lượng mục tiêu
                </span>
                <select
                  value={targetDuration}
                  onChange={(e) => setTargetDuration(e.target.value as 'short' | 'medium')}
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                >
                  <option value="short">Ngắn (~25–32 giây · 4 cảnh)</option>
                  <option value="medium">Trung bình (~42–50 giây · 5 cảnh)</option>
                </select>
              </label>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                placeholder="Gợi ý thêm cho AI (tùy chọn): VD: nhấn mạnh 3 mẹo thực tế, giọng hài hước, kết thúc kêu gọi bình luận..."
                className="flex-1 h-9 px-3 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-teal-200/45 focus:outline-none focus:border-[#003B3E]"
              />
              <button
                type="button"
                onClick={handleLearnContent}
                disabled={isLearning || isGenerating}
                className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {isLearning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang đọc &amp; học video...</span>
                  </>
                ) : blueprint ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Học lại &amp; Viết kịch bản khác</span>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>AI Học nội dung &amp; Lập kịch bản</span>
                  </>
                )}
              </button>
            </div>

            {learnError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{learnError}</span>
              </div>
            )}
          </section>

          {/* 3. Learned Insights + Editable Storyboard */}
          {blueprint && (
            <section className="space-y-4">
              {/* What AI Learned */}
              <div className="p-4 rounded-xl bg-teal-50/60 dark:bg-[#00262E]/70 border border-[#003B3E]/20 dark:border-[#1BA8AD]/30 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#003B3E] dark:text-[#1BA8AD]">
                  <Sparkles className="w-4 h-4" />
                  <span>Kiến thức &amp; Công thức AI đã học từ {blueprint.sourcesAnalyzed.length} video</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-teal-50 leading-relaxed">
                  {blueprint.learnedSummary}
                </p>
                {blueprint.keyTakeaways.length > 0 && (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-slate-700 dark:text-teal-100/90">
                    {blueprint.keyTakeaways.map((pt, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="font-mono font-bold text-[#003B3E] dark:text-[#1BA8AD]">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-[11px] text-slate-600 dark:text-teal-200/80 pt-1 border-t border-[#003B3E]/15 dark:border-[#1BA8AD]/20">
                  <strong className="text-slate-800 dark:text-white">Công thức Hook:</strong> {blueprint.hookFormula}
                </div>

                {/* Per-source proof of analysis */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {blueprint.sourcesAnalyzed.map((sa) => (
                    <div
                      key={sa.index}
                      className="p-2 rounded-lg bg-white/80 dark:bg-[#000A10]/70 border border-slate-200/70 dark:border-[#00464A]/80 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 dark:text-white truncate">
                          #{sa.index + 1} · {sa.platformLabel}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 shrink-0">
                          {[
                            sa.hasCaptions ? 'Phụ đề' : '',
                            sa.hasDescription ? 'Mô tả' : '',
                            sa.hasThumbnail ? 'Ảnh' : '',
                          ]
                            .filter(Boolean)
                            .join(' + ') || 'Tiêu đề'}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-teal-100/80 line-clamp-2">{sa.keyPoint}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editable Title & Hook */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-teal-100">
                    Tiêu đề video phái sinh
                  </span>
                  <input
                    type="text"
                    value={blueprint.derivativeTitle}
                    onChange={(e) => setBlueprint({ ...blueprint, derivativeTitle: e.target.value })}
                    className="w-full h-9 px-3 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-teal-100">
                    Chữ Hook nổi bật (hiện 3.5 giây đầu)
                  </span>
                  <input
                    type="text"
                    value={blueprint.derivativeHook}
                    onChange={(e) => setBlueprint({ ...blueprint, derivativeHook: e.target.value })}
                    className="w-full h-9 px-3 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                  />
                </label>
              </div>

              {/* Editable Storyboard Scenes */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-teal-200/75">
                    2. Kịch bản từng phân cảnh ({blueprint.scenes.length} cảnh)
                  </h3>
                  {blueprint.scenes.length < 8 && (
                    <button
                      type="button"
                      onClick={handleAddScene}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] hover:bg-[#003B3E]/10 rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm cảnh</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2.5">
                  {blueprint.scenes.map((sc) => (
                    <div
                      key={sc.id}
                      className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-[#003B3E] text-white text-[11px] font-bold font-mono">
                            Cảnh {sc.sceneIndex}
                          </span>
                          <select
                            value={sc.sourceVideoIndex}
                            onChange={(e) =>
                              updateScene(sc.id, { sourceVideoIndex: Number(e.target.value) })
                            }
                            className="h-7 px-2 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-md text-slate-700 dark:text-teal-100"
                          >
                            {sources.map((src, idx) => (
                              <option key={src.id} value={idx}>
                                Hình từ Video #{idx + 1} ({src.platformLabel})
                              </option>
                            ))}
                          </select>
                          <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-teal-200/70">
                            <span>Cắt tại:</span>
                            <input
                              type="number"
                              min={0}
                              max={85}
                              value={sc.sourceStartPercent}
                              onChange={(e) =>
                                updateScene(sc.id, {
                                  sourceStartPercent: Math.max(0, Math.min(85, Number(e.target.value) || 0)),
                                })
                              }
                              className="w-12 h-7 px-1.5 text-[11px] font-mono bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-md text-center"
                            />
                            <span>%</span>
                          </label>
                        </div>

                        {blueprint.scenes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteScene(sc.id)}
                            title="Xóa cảnh"
                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/70">
                            Chữ hiển thị trên video (Phụ đề)
                          </span>
                          <input
                            type="text"
                            value={sc.onScreenText}
                            onChange={(e) => updateScene(sc.id, { onScreenText: e.target.value })}
                            className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-slate-500 dark:text-teal-200/70">
                            Lời thuyết minh (AI đọc lồng tiếng)
                          </span>
                          <textarea
                            rows={2}
                            value={sc.narration}
                            onChange={(e) => updateScene(sc.id, { narration: e.target.value })}
                            className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Render Controls */}
              <div className="p-4 rounded-xl bg-[#F8FAFB] dark:bg-[#000A10]/90 border border-slate-200/90 dark:border-[#00464A] space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-teal-200/75">
                  3. Cấu hình dựng Video Phái Sinh (MP4)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="space-y-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                      <Film className="w-3.5 h-3.5" />
                      <span>Chế độ dựng hình ảnh</span>
                    </span>
                    <select
                      value={visualMode}
                      onChange={(e) => setVisualMode(e.target.value as DerivativeVisualMode)}
                      className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                    >
                      <option value="remix">Remix cắt ghép video nguồn + Lồng tiếng AI</option>
                      <option value="storyboard_motion">Ảnh chuyển động Ken Burns + Lồng tiếng AI (Nhanh)</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Giọng đọc AI tiếng Việt</span>
                    </span>
                    <select
                      value={voice}
                      onChange={(e) => setVoice(e.target.value as DerivativeVoiceId)}
                      className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                    >
                      {VOICE_OPTIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-teal-200/80">
                      <Film className="w-3.5 h-3.5" />
                      <span>Video nền dự phòng (B-roll)</span>
                    </span>
                    <select
                      value={brollSource}
                      onChange={(e) => setBrollSource(e.target.value as BrollSourceId)}
                      className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
                    >
                      <option value="auto">Tự động (Pexels / Pixabay / Wikimedia)</option>
                      <option value="wikimedia">Wikimedia Commons (CC0 · Miễn phí)</option>
                      <option value="pexels">Pexels Video</option>
                      <option value="pixabay">Pixabay Video</option>
                      <option value="none">Chỉ dùng Ken Burns từ ảnh gốc</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  {visualMode === 'remix' ? (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-teal-100/85 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={keepSourceAudio}
                        onChange={(e) => setKeepSourceAudio(e.target.checked)}
                        className="rounded border-slate-300 text-[#003B3E] focus:ring-[#003B3E]"
                      />
                      <span>Giữ âm thanh/nhạc gốc làm nền nhỏ (12%)</span>
                    </label>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={handleGenerateVideo}
                    disabled={isGenerating}
                    className="inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-xl transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang tạo video phái sinh...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        <span>Tạo Video Phái Sinh (MP4)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 4. Progress & Result Preview */}
          {(job || genError) && (
            <section className="p-4 rounded-xl bg-white dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] space-y-3">
              {job && job.status !== 'completed' && job.status !== 'error' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-teal-100">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#003B3E] dark:text-[#1BA8AD]" />
                      {job.stepLabel}
                    </span>
                    <span className="font-mono tabular-nums">{job.progress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-[#003B3E] dark:bg-[#1BA8AD] transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(4, job.progress))}%` }}
                    />
                  </div>
                </div>
              )}

              {genError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{genError}</span>
                </div>
              )}

              {job?.warnings && job.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                  {job.warnings.map((w, idx) => (
                    <p key={idx}>• {w}</p>
                  ))}
                </div>
              )}

              {job?.status === 'completed' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Đã tạo xong video phái sinh!
                        {job.durationSec ? ` · ${job.durationSec}s` : ''}
                        {job.resolution ? ` · ${job.resolution}` : ''}
                        {job.fileSize ? ` · ${formatBytes(job.fileSize)}` : ''}
                      </span>
                    </div>

                    <a
                      href={`/api/derivative/jobs/${job.jobId}/file?download=1`}
                      download={job.fileName || 'derivative.mp4'}
                      className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải Video MP4 về máy</span>
                    </a>
                  </div>

                  <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex justify-center">
                    <video
                      key={job.jobId}
                      controls
                      playsInline
                      src={`/api/derivative/jobs/${job.jobId}/file`}
                      className="max-h-[420px] w-auto"
                    />
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
