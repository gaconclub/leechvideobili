import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  DerivativeScene,
  DerivativeVoiceMode,
  ServerCapabilitiesStatus,
  StudioCreationMode,
  StudioVideoStyle,
  TrendingVideoItem,
} from '../../types/bilibili';
import {
  CAMERA_ANGLE_SUGGESTIONS,
  CAMERA_MOVEMENT_SUGGESTIONS,
  LIGHTING_SUGGESTIONS,
  VIDEO_STYLE_OPTIONS,
  compileScenePromptClient,
} from './studioConfig';

interface StudioSceneCardProps {
  scene: DerivativeScene;
  index: number;
  totalScenes: number;
  mode: StudioCreationMode;
  videoStyle: StudioVideoStyle;
  characterBible: string;
  settingBible: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  hasCharacterRefs: boolean;
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

export const StudioSceneCard: React.FC<StudioSceneCardProps> = ({
  scene,
  index,
  totalScenes,
  mode,
  videoStyle,
  characterBible,
  settingBible,
  visualStyleBible,
  costumeBible,
  continuityBible,
  hasCharacterRefs,
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
  const [showCinematographyDetails, setShowCinematographyDetails] = useState(true);
  const styleMeta = VIDEO_STYLE_OPTIONS.find((s) => s.value === videoStyle) || VIDEO_STYLE_OPTIONS[1];
  const paddedNumber = String(index + 1).padStart(2, '0');
  const totalPadded = String(totalScenes).padStart(2, '0');
  const sceneCode = `Scene ${paddedNumber}`;
  const isVoiceoverOff = voiceMode === 'none';

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
    });
    onUpdateScene(scene.id, {
      imagePrompt: compiledImage,
      videoPrompt: compiledVideo,
      visualNote: compiledImage,
    });
  };

  return (
    <div className="p-4 bg-slate-50/40 dark:bg-[#000A10]/40 grid grid-cols-1 lg:grid-cols-12 gap-4">
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

      {/* Left Column: Visual Preview + Media Generation + Duration Controls (4 cols) */}
      <div className="lg:col-span-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="font-mono font-semibold text-[#003B3E] dark:text-[#1BA8AD] tabular-nums">
            {sceneCode} / {totalPadded}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={2}
              max={45}
              value={Math.round(scene.durationSec || 6)}
              onChange={(e) =>
                onUpdateScene(scene.id, {
                  durationSec: Math.max(2, Math.min(45, Number(e.target.value) || 6)),
                })
              }
              aria-label="Thời lượng cảnh"
              className="w-12 h-6 px-1 text-[11px] font-mono tabular-nums text-center bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-500 mr-1">giây</span>
            {totalScenes > 1 && (
              <>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMoveScene(scene.id, 'up')}
                  title="Đưa phân cảnh lên trên"
                  className="p-1 text-slate-400 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] disabled:opacity-30 cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={index === totalScenes - 1}
                  onClick={() => onMoveScene(scene.id, 'down')}
                  title="Đưa phân cảnh xuống dưới"
                  className="p-1 text-slate-400 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] disabled:opacity-30 cursor-pointer"
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

        <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-200 dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] flex items-center justify-center">
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
              <ImageIcon className="w-5 h-5 text-slate-400 dark:text-teal-300/50 mx-auto" />
              <p className="text-[11px] text-slate-500 dark:text-teal-200/70">
                {mode === 'creative'
                  ? 'Bấm "Tạo ảnh AI" hoặc "Dựng clip" dùng Prompt hình ảnh & Prompt video đồng bộ'
                  : 'Dùng video nguồn / B-roll hoặc bấm "Tạo ảnh AI" · "Dựng clip"'}
              </p>
            </div>
          )}
        </div>

        <div className="text-[11px] text-slate-500 dark:text-teal-200/70 leading-snug">
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
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#002935] text-slate-800 dark:text-teal-100 rounded transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
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

          <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#002935] text-slate-800 dark:text-teal-100 rounded transition-colors cursor-pointer whitespace-nowrap">
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
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#003B3E] hover:bg-[#002729] text-white rounded transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
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

        {/* Continuity Hand-off Fields directly under media preview */}
        <div className="pt-2 border-t border-slate-200/70 dark:border-[#00464A]/60 space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
              Tiếp nối từ cảnh trước
            </span>
            <input
              type="text"
              value={scene.continuityNote || ''}
              onChange={(e) => onUpdateScene(scene.id, { continuityNote: e.target.value })}
              placeholder={`VD: Nối tiếp trạng thái cuối của Scene ${String(Math.max(1, index)).padStart(2, '0')}...`}
              className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
              Trạng thái cuối cảnh (truyền sang cảnh sau)
            </span>
            <input
              type="text"
              value={scene.sceneEndState || ''}
              onChange={(e) => onUpdateScene(scene.id, { sceneEndState: e.target.value })}
              placeholder="VD: Nhân vật đứng quay mặt về phía cánh cửa sáng..."
              className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            />
          </label>
        </div>

        {sceneErr && (
          <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
            {sceneErr}
          </div>
        )}
      </div>

      {/* Right Column: All 15 Detailed Production Fields (8 cols) */}
      <div className="lg:col-span-8 space-y-3">
        {/* 1-2-3 Header Row: Tên phân cảnh + Chữ hiện khung hình + Mô tả nội dung */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <label className="sm:col-span-7 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
              Tên phân cảnh ({sceneCode})
            </span>
            <input
              type="text"
              value={scene.sceneTitle || ''}
              onChange={(e) => onUpdateScene(scene.id, { sceneTitle: e.target.value })}
              placeholder={`VD: Mở đầu tại cổng thiên cung (${sceneCode})...`}
              className="w-full h-8 px-2.5 text-xs font-semibold bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            />
          </label>

          <label className="sm:col-span-5 space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
              Chữ hiển thị trên màn hình
            </span>
            <input
              type="text"
              value={scene.onScreenText || ''}
              onChange={(e) => onUpdateScene(scene.id, { onScreenText: e.target.value })}
              placeholder="Tiêu đề ngắn hiện trên khung hình..."
              className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
            Mô tả nội dung (Diễn biến chính của phân cảnh)
          </span>
          <textarea
            rows={2}
            value={scene.sceneSummary || ''}
            onChange={(e) => onUpdateScene(scene.id, { sceneSummary: e.target.value })}
            placeholder="Tóm tắt rõ diễn biến chính, mục đích kể chuyện và cảm xúc của phân cảnh..."
            className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
          />
        </label>

        {/* Dialogue (Lời thoại nhân vật) + Narration (Lồng tiếng thuyết minh) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
              Lời thoại (Nội dung nhân vật nói)
            </span>
            <textarea
              rows={2}
              value={scene.dialogue || ''}
              onChange={(e) => onUpdateScene(scene.id, { dialogue: e.target.value })}
              placeholder="VD: Minh: Chúng ta phải mở cánh cửa này trước khi bình minh lên!"
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
            />
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                Lồng tiếng {isVoiceoverOff ? '(Đang tắt)' : '(Thuyết minh / Giọng dẫn)'}
              </span>
              {!isVoiceoverOff && (
                <button
                  type="button"
                  disabled={previewingSceneId === scene.id || !(scene.narration || '').trim()}
                  onClick={() => onSpeakPreview(scene.narration, scene.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-[#003B3E] dark:text-[#1BA8AD] hover:underline cursor-pointer disabled:opacity-40 whitespace-nowrap"
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
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Cinematography Breakdown Fields (Nhân vật, Bối cảnh, Hành động, Góc máy, Ánh sáng, Trang phục, Kiểu quay, Phong cách quay) */}
        <div className="pt-2 border-t border-slate-200/70 dark:border-[#00464A]/60 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowCinematographyDetails((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-teal-100 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] cursor-pointer"
            >
              {showCinematographyDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>
                Thông số đạo diễn phân cảnh (Nhân vật · Bối cảnh · Hành động · Góc máy · Ánh sáng · Trang phục · Kiểu quay · Phong cách quay)
              </span>
            </button>
            <button
              type="button"
              onClick={handleRebuildPromptsFromFields}
              title="Đồng bộ lại Prompt hình ảnh & Prompt video từ các thông số bên dưới và Hồ sơ 5 thành phần"
              className="inline-flex items-center gap-1 text-[11px] text-[#003B3E] dark:text-[#1BA8AD] hover:underline cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Đồng bộ vào Prompt Ảnh & Video</span>
            </button>
          </div>

          {showCinematographyDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                  Nhân vật (Xuất hiện trong cảnh)
                </span>
                <input
                  type="text"
                  value={scene.charactersInScene || ''}
                  onChange={(e) => onUpdateScene(scene.id, { charactersInScene: e.target.value })}
                  placeholder="VD: Minh (nam chính 25t), Linh (nữ đồng hành)..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                  Trang phục (Đồng bộ phụ kiện)
                </span>
                <input
                  type="text"
                  value={scene.costume || ''}
                  onChange={(e) => onUpdateScene(scene.id, { costume: e.target.value })}
                  placeholder="VD: Áo choàng trắng viền vàng, đai lưng bạc..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                  Bối cảnh (Không gian, địa điểm, thời gian)
                </span>
                <input
                  type="text"
                  value={scene.settingDetail || ''}
                  onChange={(e) => onUpdateScene(scene.id, { settingDetail: e.target.value })}
                  placeholder="VD: Cổng thiên cung bằng đá ngọc giữa tầng mây lúc rạng đông..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                  Hành động (Hành vi & diễn biến cụ thể)
                </span>
                <input
                  type="text"
                  value={scene.actionDetail || ''}
                  onChange={(e) => onUpdateScene(scene.id, { actionDetail: e.target.value })}
                  placeholder="VD: Minh bước chậm về phía trước, tay nâng ấn tín phát sáng..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Góc máy</span>
                <input
                  type="text"
                  list={`camera-angles-${scene.id}`}
                  value={scene.cameraAngle || ''}
                  onChange={(e) => onUpdateScene(scene.id, { cameraAngle: e.target.value })}
                  placeholder="VD: Góc thấp trung cảnh (Low angle medium shot)..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
                  Kiểu quay (Chuyển động camera)
                </span>
                <input
                  type="text"
                  list={`camera-movements-${scene.id}`}
                  value={scene.cameraMovement || ''}
                  onChange={(e) => onUpdateScene(scene.id, { cameraMovement: e.target.value })}
                  placeholder="VD: Tracking shot, Slow dolly-in, Handheld..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Ánh sáng & Màu sắc</span>
                <input
                  type="text"
                  list={`lighting-presets-${scene.id}`}
                  value={scene.lighting || ''}
                  onChange={(e) => onUpdateScene(scene.id, { lighting: e.target.value })}
                  placeholder="VD: Ánh sáng ngược chiều (Cinematic rim light) ấm áp..."
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Phong cách quay</span>
                <input
                  type="text"
                  value={scene.shotStyle || ''}
                  onChange={(e) => onUpdateScene(scene.id, { shotStyle: e.target.value })}
                  placeholder={styleMeta.shotDefault}
                  className="w-full h-8 px-2.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
                />
              </label>
            </div>
          )}

          {/* Dedicated Image Prompt + Dedicated Video Prompt */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
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
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-teal-200/75">
                Prompt video ({sceneCode} — chuyển động, hành động & quỹ đạo máy quay)
              </span>
              <textarea
                rows={3}
                value={scene.videoPrompt || ''}
                onChange={(e) => onUpdateScene(scene.id, { videoPrompt: e.target.value })}
                placeholder="Mô tả chi tiết chuyển động liên tục trong cảnh, nhịp diễn xuất, chuyển động máy quay & hiệu ứng môi trường..."
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] resize-y"
              />
            </label>
          </div>
        </div>

        {/* Source video slice (derivative mode) & B-roll keyword */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {mode === 'derivative' && sources.length > 0 && (
            <label className="space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-teal-200/75">Video tham chiếu cắt ghép</span>
              <select
                value={scene.sourceVideoIndex}
                onChange={(e) => onUpdateScene(scene.id, { sourceVideoIndex: Number(e.target.value) })}
                className="w-full h-8 px-2 text-xs bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white"
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
            <span className="text-[11px] text-slate-500 dark:text-teal-200/75">
              Từ khóa tìm B-roll dự phòng (Wikimedia Commons · EN)
            </span>
            <input
              type="text"
              value={scene.brollKeywordEn || ''}
              onChange={(e) => onUpdateScene(scene.id, { brollKeywordEn: e.target.value })}
              placeholder="VD: modern office workspace, city night timelapse..."
              className="w-full h-8 px-2.5 text-xs font-mono bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
