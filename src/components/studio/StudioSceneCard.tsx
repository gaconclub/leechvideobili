import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Trash2,
  Upload,
  UserCheck,
  Volume2,
} from 'lucide-react';
import {
  DerivativeScene,
  DerivativeVoiceMode,
  ServerCapabilitiesStatus,
  StudioCharacterRef,
  StudioCreationMode,
  StudioProductionFormat,
  StudioVideoStyle,
  TrendingVideoItem,
} from '../../types/bilibili';
import {
  CAMERA_ANGLE_SUGGESTIONS,
  CAMERA_EQUIPMENT_SUGGESTIONS,
  CAMERA_MOVEMENT_SUGGESTIONS,
  CHARACTER_AGE_GROUP_OPTIONS,
  LIGHTING_SUGGESTIONS,
  VIDEO_STYLE_OPTIONS,
  compileScenePromptClient,
} from './studioConfig';

interface StudioSceneCardProps {
  scene: DerivativeScene;
  index: number;
  totalScenes: number;
  mode: StudioCreationMode;
  productionFormat?: StudioProductionFormat;
  videoStyle: StudioVideoStyle;
  characterBible: string;
  settingBible: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  hasCharacterRefs: boolean;
  characterRefs?: StudioCharacterRef[];
  sources: (TrendingVideoItem & { localAssetId?: string })[];
  busyImg: boolean;
  queuedImg: boolean;
  busyVid: boolean;
  sceneErr?: string;
  sceneVideoEngine: 'gemini' | 'muse2api';
  voiceMode: DerivativeVoiceMode;
  previewingSceneId: string | null;
  capabilities: ServerCapabilitiesStatus | null;
  onUpdateScene: (sceneId: string, patch: Partial<DerivativeScene>) => void;
  onDeleteScene: (sceneId: string) => void;
  onMoveScene: (sceneId: string, direction: 'up' | 'down') => void;
  onGenerateImage: (scene: DerivativeScene) => void;
  onUploadSceneImage: (sceneId: string, file: File) => void;
  onGenerateOmniClip: (scene: DerivativeScene) => void;
  onSpeakPreview: (text: string, sceneId: string) => void;
}

const fieldInputCls =
  'w-full h-8 px-2.5 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400';

const fieldTextareaCls =
  'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400 resize-y';

export const StudioSceneCard: React.FC<StudioSceneCardProps> = ({
  scene,
  index,
  totalScenes,
  mode,
  productionFormat = 'dialogue_film',
  videoStyle,
  characterBible,
  settingBible,
  visualStyleBible,
  costumeBible,
  continuityBible,
  hasCharacterRefs,
  characterRefs = [],
  sources,
  busyImg,
  queuedImg,
  busyVid,
  sceneErr,
  sceneVideoEngine,
  voiceMode,
  previewingSceneId,
  capabilities,
  onUpdateScene,
  onDeleteScene,
  onMoveScene,
  onGenerateImage,
  onUploadSceneImage,
  onGenerateOmniClip,
  onSpeakPreview,
}) => {
  const [showCinematographyDetails, setShowCinematographyDetails] = useState(false);
  const styleMeta = VIDEO_STYLE_OPTIONS.find((s) => s.value === videoStyle) || VIDEO_STYLE_OPTIONS[1];
  const paddedNumber = String(index + 1).padStart(2, '0');
  const totalPadded = String(totalScenes).padStart(2, '0');
  const sceneCode = `Scene ${paddedNumber}`;
  const isVoiceoverOff = voiceMode === 'none';

  const selectedIds = Array.isArray(scene.selectedCharacterIds) ? scene.selectedCharacterIds : [];
  const toggleSceneCharacterRef = (charRef: StudioCharacterRef) => {
    const exists = selectedIds.includes(charRef.id);
    const nextIds = exists
      ? selectedIds.filter((id) => id !== charRef.id)
      : [...selectedIds, charRef.id];
    const nextNames = characterRefs
      .filter((c) => nextIds.includes(c.id))
      .map((c) => c.name.trim())
      .filter(Boolean);
    onUpdateScene(scene.id, {
      selectedCharacterIds: nextIds,
      ...(nextNames.length > 0 ? { charactersInScene: nextNames.join(', ') } : {}),
    });
  };

  const handleRebuildPromptsFromFields = () => {
    const compiledImage = compileScenePromptClient({
      scene: { ...scene, imagePrompt: '' },
      videoStyle,
      characterBible,
      settingBible,
      visualStyleBible,
      costumeBible,
      continuityBible,
      totalScenes,
      mediaType: 'image',
      hasAttachedRefs: hasCharacterRefs,
    });
    const compiledVideo = compileScenePromptClient({
      scene: { ...scene, videoPrompt: '' },
      videoStyle,
      characterBible,
      settingBible,
      visualStyleBible,
      costumeBible,
      continuityBible,
      totalScenes,
      mediaType: 'video',
      hasAttachedRefs: hasCharacterRefs,
      targetEngine: sceneVideoEngine,
    });
    onUpdateScene(scene.id, {
      imagePrompt: compiledImage,
      videoPrompt: compiledVideo,
      visualNote: compiledImage,
    });
  };

  const compiledVideoPreviewLen = compileScenePromptClient({
    scene,
    videoStyle,
    characterBible,
    settingBible,
    visualStyleBible,
    costumeBible,
    continuityBible,
    totalScenes,
    mediaType: 'video',
    hasAttachedRefs: hasCharacterRefs,
    targetEngine: sceneVideoEngine,
  }).length;

  return (
    <div className="p-4 bg-slate-50/70 dark:bg-[#0c1021]/80 grid grid-cols-1 lg:grid-cols-12 gap-4">
      <datalist id={`camera-angles-${scene.id}`}>
        {CAMERA_ANGLE_SUGGESTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <datalist id={`camera-movements-${scene.id}`}>
        {CAMERA_MOVEMENT_SUGGESTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <datalist id={`lighting-presets-${scene.id}`}>
        {LIGHTING_SUGGESTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <datalist id={`camera-equipment-${scene.id}`}>
        {CAMERA_EQUIPMENT_SUGGESTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>

      {/* Left Column: Visual Preview + Media Generation + Duration Controls (4 cols) */}
      <div className="lg:col-span-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="font-mono font-bold text-cyan-700 dark:text-cyan-300 tabular-nums">
            {sceneCode} / {totalPadded}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={2}
              max={120}
              value={Math.round(scene.durationSec || 6)}
              onChange={(e) =>
                onUpdateScene(scene.id, {
                  durationSec: Math.max(2, Math.min(120, Number(e.target.value) || 6)),
                })
              }
              aria-label="Thời lượng cảnh"
              className="w-12 h-6 px-1 text-[11px] font-mono tabular-nums text-center bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">giây</span>
            {totalScenes > 1 && (
              <>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMoveScene(scene.id, 'up')}
                  title="Đưa phân cảnh lên trên"
                  className="p-1 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={index === totalScenes - 1}
                  onClick={() => onMoveScene(scene.id, 'down')}
                  title="Đưa phân cảnh xuống dưới"
                  className="p-1 text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteScene(scene.id)}
                  title="Xóa phân cảnh này"
                  className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-200 dark:bg-[#070913] border border-slate-200 dark:border-slate-400/20 flex items-center justify-center">
          {scene.omniClipPreviewUrl ? (
            <video
              src={scene.omniClipPreviewUrl}
              controls
              muted
              className="w-full h-full object-contain bg-black"
            />
          ) : scene.sceneImageDataUrl ? (
            <img
              src={scene.sceneImageDataUrl}
              alt={`${sceneCode} - ${scene.sceneTitle || ''}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center px-3 space-y-1">
              <ImageIcon className="w-5 h-5 text-slate-400 dark:text-slate-500 mx-auto" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {mode === 'creative'
                  ? 'Bấm "Tạo ảnh AI" hoặc "Dựng clip" dùng Prompt hình ảnh & Prompt video đồng bộ'
                  : 'Dùng video nguồn / B-roll hoặc bấm "Tạo ảnh AI" · "Dựng clip"'}
              </p>
            </div>
          )}
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          <span>Phong cách: {styleMeta.label}</span>
          <span> · </span>
          <span>
            {hasCharacterRefs
              ? 'Đã khóa ảnh mẫu nhân vật đồng bộ'
              : 'Đồng bộ 5 hồ sơ nhân vật · bối cảnh · trang phục'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busyImg || queuedImg}
            onClick={() => onGenerateImage(scene)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 rounded-lg transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
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
                : scene.sceneImageDataUrl
                ? 'Tạo lại ảnh AI'
                : 'Tạo ảnh AI'}
            </span>
          </button>

          <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 rounded-lg transition cursor-pointer whitespace-nowrap">
            <Upload className="w-3 h-3" />
            <span>Tải ảnh</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUploadSceneImage(scene.id, f);
              }}
            />
          </label>

          <button
            type="button"
            disabled={busyVid}
            onClick={() => onGenerateOmniClip(scene)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-gradient-to-r from-violet-600 to-cyan-500 hover:brightness-110 text-white rounded-lg transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
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
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
            {sceneErr}
          </div>
        )}
      </div>

      {/* Right Column: All 15 Detailed Production Fields (8 cols) */}
      <div className="lg:col-span-8 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <label className="sm:col-span-7 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Tên phân cảnh ({sceneCode})
            </span>
            <input
              type="text"
              value={scene.sceneTitle || ''}
              onChange={(e) => onUpdateScene(scene.id, { sceneTitle: e.target.value })}
              placeholder={`VD: Mở đầu tại cổng thiên cung (${sceneCode})...`}
              className={`${fieldInputCls} font-semibold`}
            />
          </label>

          <label className="sm:col-span-5 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Chữ hiển thị trên màn hình
            </span>
            <input
              type="text"
              value={scene.onScreenText || ''}
              onChange={(e) => onUpdateScene(scene.id, { onScreenText: e.target.value })}
              placeholder="Tiêu đề ngắn hiện trên khung hình..."
              className={fieldInputCls}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Mô tả nội dung (Diễn biến chính của phân cảnh)
          </span>
          <textarea
            rows={2}
            value={scene.sceneSummary || ''}
            onChange={(e) => onUpdateScene(scene.id, { sceneSummary: e.target.value })}
            placeholder="Tóm tắt rõ diễn biến chính, mục đích kể chuyện và cảm xúc của phân cảnh..."
            className={fieldTextareaCls}
          />
        </label>

        {/* Synced Character Reference Selector for Dialogue Scenes / Adaptive Music Pill for Narration Story */}
        {productionFormat === 'dialogue_film' && characterRefs.length > 0 && (
          <div className="p-2.5 rounded-xl bg-white/90 dark:bg-[#131a35]/90 border border-violet-400/30 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Chọn nhân vật đồng bộ cho phân cảnh ({selectedIds.length}/{characterRefs.length})</span>
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Khóa mặt · dáng · trang phục · giọng theo Tab Nhân vật
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {characterRefs.map((ch) => {
                const isSelected = selectedIds.includes(ch.id);
                const ageMeta = CHARACTER_AGE_GROUP_OPTIONS.find((a) => a.value === (ch.ageGroup || 'auto'));
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggleSceneCharacterRef(ch)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] transition cursor-pointer ${
                      isSelected
                        ? 'bg-violet-600/15 border-violet-500/60 text-slate-900 dark:text-white font-semibold'
                        : 'bg-slate-50 dark:bg-[#0c1021] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-violet-400/40'
                    }`}
                  >
                    <img
                      src={ch.dataUrl}
                      alt={ch.name}
                      className="w-5 h-5 rounded object-cover shrink-0 border border-slate-300 dark:border-white/15"
                    />
                    <span className="max-w-[110px] truncate">{ch.name}</span>
                    {ageMeta && ageMeta.value !== 'auto' && (
                      <span className="text-[9px] text-violet-600 dark:text-violet-300">· {ageMeta.label}</span>
                    )}
                    {ch.voiceId && (
                      <span className="text-[9px] font-mono text-cyan-600 dark:text-cyan-300">({ch.voiceId})</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {productionFormat === 'narration_story' && scene.musicMoodEn && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-800 dark:text-emerald-200">
            <span className="inline-flex items-center gap-1.5 font-medium truncate">
              <Music className="w-3.5 h-3.5 shrink-0" />
              <span>Nhạc nền AI theo cảnh: <strong className="font-mono">{scene.musicMoodEn}</strong></span>
            </span>
            <span className="text-[10px] opacity-80 shrink-0">1 giọng dẫn chuyện</span>
          </div>
        )}

        {/* Dialogue + Narration */}
        <div className={`grid grid-cols-1 ${productionFormat === 'narration_story' ? '' : 'md:grid-cols-2'} gap-2.5`}>
          {productionFormat !== 'narration_story' && (
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Lời thoại (Nội dung nhân vật nói · Tên: Câu thoại)
              </span>
              <textarea
                rows={2}
                value={scene.dialogue || ''}
                onChange={(e) => onUpdateScene(scene.id, { dialogue: e.target.value })}
                placeholder="VD: Minh: Chúng ta phải mở cánh cửa này trước khi bình minh lên!"
                className={fieldTextareaCls}
              />
            </label>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Lồng tiếng {isVoiceoverOff ? '(Đang tắt)' : '(Thuyết minh / Giọng dẫn)'}
              </span>
              {!isVoiceoverOff && (
                <button
                  type="button"
                  disabled={previewingSceneId === scene.id || !(scene.narration || '').trim()}
                  onClick={() => onSpeakPreview(scene.narration, scene.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-700 dark:text-cyan-300 hover:underline cursor-pointer disabled:opacity-40 whitespace-nowrap"
                >
                  {previewingSceneId === scene.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Volume2 className="w-3 h-3" />
                  )}
                  <span>
                    {previewingSceneId === scene.id
                      ? 'Đang đọc VieNeu...'
                      : voiceMode === 'offline_system' && capabilities?.localTools.offlineTts.engineId === 'vieneu'
                      ? 'Nghe thử VieNeu'
                      : 'Nghe nháp'}
                  </span>
                </button>
              )}
            </div>
            <textarea
              rows={2}
              disabled={isVoiceoverOff}
              value={isVoiceoverOff ? '' : scene.narration || ''}
              onChange={(e) => onUpdateScene(scene.id, { narration: e.target.value })}
              placeholder={
                isVoiceoverOff
                  ? 'Đang tắt lồng tiếng — không tạo dữ liệu giọng đọc'
                  : 'Nội dung thuyết minh / giọng dẫn đồng bộ nhịp cảnh...'
              }
              className={`${fieldTextareaCls} disabled:opacity-50 disabled:cursor-not-allowed`}
            />
          </div>
        </div>

        {/* Collapsible Advanced Cinematography, Continuity & Prompts */}
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-400/15 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowCinematographyDetails((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer"
            >
              {showCinematographyDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>
                Chi tiết đạo diễn, Prompt Ảnh/Video &amp; Nối cảnh
              </span>
              <span className="text-[10px] font-normal text-slate-400">
                {showCinematographyDetails ? '(Thu gọn)' : '(Bấm để chỉnh sâu)'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleRebuildPromptsFromFields}
              title="Đồng bộ lại Prompt hình ảnh & Prompt video từ các thông số bên dưới và Hồ sơ 5 thành phần"
              className="inline-flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300 hover:underline cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Đồng bộ vào Prompt Ảnh &amp; Video</span>
            </button>
          </div>

          {showCinematographyDetails && (
            <div className="space-y-3 pt-1">
              {/* Continuity hand-off */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Tiếp nối từ cảnh trước
                  </span>
                  <input
                    type="text"
                    value={scene.continuityNote || ''}
                    onChange={(e) => onUpdateScene(scene.id, { continuityNote: e.target.value })}
                    placeholder={`VD: Nối tiếp trạng thái cuối của Scene ${String(Math.max(1, index)).padStart(2, '0')}...`}
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Trạng thái cuối cảnh (truyền sang cảnh sau)
                  </span>
                  <input
                    type="text"
                    value={scene.sceneEndState || ''}
                    onChange={(e) => onUpdateScene(scene.id, { sceneEndState: e.target.value })}
                    placeholder="VD: Nhân vật đứng quay mặt về phía cánh cửa sáng..."
                    className={fieldInputCls}
                  />
                </label>
              </div>

              {/* 8 Cinematography Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Nhân vật (Xuất hiện trong cảnh)
                  </span>
                  <input
                    type="text"
                    value={scene.charactersInScene || ''}
                    onChange={(e) => onUpdateScene(scene.id, { charactersInScene: e.target.value })}
                    placeholder="VD: Minh (nam chính 25t), Linh (nữ đồng hành)..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Trang phục (Đồng bộ phụ kiện)
                  </span>
                  <input
                    type="text"
                    value={scene.costume || ''}
                    onChange={(e) => onUpdateScene(scene.id, { costume: e.target.value })}
                    placeholder="VD: Áo choàng trắng viền vàng, đai lưng bạc..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bối cảnh (Không gian, địa điểm, thời gian)
                  </span>
                  <input
                    type="text"
                    value={scene.settingDetail || ''}
                    onChange={(e) => onUpdateScene(scene.id, { settingDetail: e.target.value })}
                    placeholder="VD: Cổng thiên cung bằng đá ngọc giữa tầng mây lúc rạng đông..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Hành động (Hành vi &amp; diễn biến cụ thể)
                  </span>
                  <input
                    type="text"
                    value={scene.actionDetail || ''}
                    onChange={(e) => onUpdateScene(scene.id, { actionDetail: e.target.value })}
                    placeholder="VD: Minh bước chậm về phía trước, tay nâng ấn tín phát sáng..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Góc máy</span>
                  <input
                    type="text"
                    list={`camera-angles-${scene.id}`}
                    value={scene.cameraAngle || ''}
                    onChange={(e) => onUpdateScene(scene.id, { cameraAngle: e.target.value })}
                    placeholder="VD: Góc thấp trung cảnh (Low angle medium shot)..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kiểu quay (Chuyển động camera)
                  </span>
                  <input
                    type="text"
                    list={`camera-movements-${scene.id}`}
                    value={scene.cameraMovement || ''}
                    onChange={(e) => onUpdateScene(scene.id, { cameraMovement: e.target.value })}
                    placeholder="VD: Tracking shot, Slow dolly-in, Handheld..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Ánh sáng &amp; Màu sắc</span>
                  <input
                    type="text"
                    list={`lighting-presets-${scene.id}`}
                    value={scene.lighting || ''}
                    onChange={(e) => onUpdateScene(scene.id, { lighting: e.target.value })}
                    placeholder="VD: Ánh sáng ngược chiều (Cinematic rim light) ấm áp..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Phong cách quay</span>
                  <input
                    type="text"
                    value={scene.shotStyle || ''}
                    onChange={(e) => onUpdateScene(scene.id, { shotStyle: e.target.value })}
                    placeholder={styleMeta.shotDefault}
                    className={fieldInputCls}
                  />
                </label>

                <label className="sm:col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Thiết bị quay &amp; Ống kính (Máy quay, gimbal, tiêu cự)
                  </span>
                  <input
                    type="text"
                    list={`camera-equipment-${scene.id}`}
                    value={scene.cameraEquipment || ''}
                    onChange={(e) => onUpdateScene(scene.id, { cameraEquipment: e.target.value })}
                    placeholder="VD: Sony FX3 + 35mm f/1.4 trên gimbal DJI Ronin..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kỹ xảo &amp; Vật liệu VFX (Ánh sáng thể tích, hạt bụi, phản chiếu)
                  </span>
                  <input
                    type="text"
                    value={scene.vfxNotes || ''}
                    onChange={(e) => onUpdateScene(scene.id, { vfxNotes: e.target.value })}
                    placeholder="VD: volumetric light shafts, floating dust motes, metallic reflection..."
                    className={fieldInputCls}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Âm thanh 4 lớp (MUS / AMB / BIO / DET &amp; Silence Drop)
                  </span>
                  <input
                    type="text"
                    value={scene.soundLayersNote || ''}
                    onChange={(e) => onUpdateScene(scene.id, { soundLayersNote: e.target.value })}
                    placeholder="VD: AMB mưa nhẹ + DET tiếng tách trà đặt xuống + Silence Drop trước câu thoại..."
                    className={fieldInputCls}
                  />
                </label>
              </div>

              {/* Dedicated Image Prompt + Video Prompt */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Prompt hình ảnh ({sceneCode} — bố cục tĩnh, tạo hình, ánh sáng)
                  </span>
                  <textarea
                    rows={3}
                    value={scene.imagePrompt || scene.visualNote || ''}
                    onChange={(e) =>
                      onUpdateScene(scene.id, {
                        imagePrompt: e.target.value,
                        visualNote: e.target.value,
                      })
                    }
                    placeholder="Mô tả chi tiết khung hình tĩnh: chủ thể, trang phục, biểu cảm, không gian, góc máy, ánh sáng..."
                    className={fieldTextareaCls}
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Prompt video ({sceneCode} — chuyển động, hành động &amp; quỹ đạo máy quay)
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                      Biên dịch: {compiledVideoPreviewLen}/{sceneVideoEngine === 'muse2api' ? '1440' : '2400'} ký tự
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={scene.videoPrompt || ''}
                    onChange={(e) => onUpdateScene(scene.id, { videoPrompt: e.target.value })}
                    placeholder="Mô tả chi tiết chuyển động liên tục trong cảnh, nhịp diễn xuất, chuyển động máy quay & hiệu ứng môi trường..."
                    className={fieldTextareaCls}
                  />
                </label>
              </div>

              {/* Source video slice & B-roll keyword */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {mode === 'derivative' && sources.length > 0 && (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Video tham chiếu cắt ghép</span>
                    <select
                      value={scene.sourceVideoIndex}
                      onChange={(e) => onUpdateScene(scene.id, { sourceVideoIndex: Number(e.target.value) })}
                      className={fieldInputCls}
                    >
                      {sources.map((s, sIdx) => (
                        <option key={s.id} value={sIdx}>
                          #{sIdx + 1} · {(s.translatedTitle || s.title).slice(0, 42)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={mode === 'derivative' && sources.length > 0 ? 'space-y-1' : 'sm:col-span-2 space-y-1'}>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Từ khóa tìm B-roll dự phòng (Wikimedia Commons · EN)
                  </span>
                  <input
                    type="text"
                    value={scene.brollKeywordEn || ''}
                    onChange={(e) => onUpdateScene(scene.id, { brollKeywordEn: e.target.value })}
                    placeholder="VD: modern office workspace, city night timelapse..."
                    className={`${fieldInputCls} font-mono`}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
