import React, { useState } from 'react';
import {
  Check,
  FolderOpen,
  X,
  Image as ImageIcon,
  Sliders,
} from 'lucide-react';
import {
  CustomLogoConfig,
  OUTPUT_FORMATS,
  OutputFormat,
  RESOLUTION_PRESETS,
  VideoTransformConfig,
  WATERMARK_PRESETS,
  WatermarkMode,
} from '../types/bilibili';

interface GlobalConfigBarProps {
  globalQn: number;
  globalFormat: OutputFormat;
  globalWatermark: WatermarkMode;
  concurrency: number;
  autoSave: boolean;
  folderName: string;
  subfolderName: string;
  folderNotice: string;
  hasItems: boolean;
  customLogo: CustomLogoConfig;
  videoTransform: VideoTransformConfig;
  onOpenLogoModal: () => void;
  onToggleCustomLogo: () => void;
  onOpenTransformModal: () => void;
  onResetTransform: () => void;
  onApplyPreset?: (preset: 'default' | 'bilibili_series' | 'shorts_clean') => void;
  onChangeGlobalQn: (qn: number) => void;
  onChangeGlobalFormat: (fmt: OutputFormat) => void;
  onChangeGlobalWatermark: (wm: WatermarkMode) => void;
  onChangeConcurrency: (n: number) => void;
  onToggleAutoSave: (val: boolean) => void;
  onChangeSubfolderName: (val: string) => void;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onApplyToAll: () => void;
}

const fieldSelectClass =
  'w-full rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-2 text-xs font-medium text-slate-900 dark:text-white focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none cursor-pointer';

export const GlobalConfigBar: React.FC<GlobalConfigBarProps> = ({
  globalQn,
  globalFormat,
  globalWatermark,
  concurrency,
  autoSave,
  folderName,
  subfolderName,
  folderNotice,
  hasItems,
  customLogo,
  videoTransform,
  onOpenLogoModal,
  onToggleCustomLogo,
  onOpenTransformModal,
  onResetTransform,
  onApplyPreset,
  onChangeGlobalQn,
  onChangeGlobalFormat,
  onChangeGlobalWatermark,
  onChangeConcurrency,
  onToggleAutoSave,
  onChangeSubfolderName,
  onPickFolder,
  onClearFolder,
  onApplyToAll,
}) => {
  const [presetKey, setPresetKey] = useState<'default' | 'bilibili_series' | 'shorts_clean'>('default');

  const transformParts: string[] = [];
  if (Math.abs(videoTransform.speed - 1) > 0.01) transformParts.push(`${videoTransform.speed}x`);
  if (videoTransform.mirror === 'horizontal') transformParts.push('Lật ngang');
  else if (videoTransform.mirror === 'vertical') transformParts.push('Lật dọc');
  if (videoTransform.zoomPercent !== 100) transformParts.push(`Zoom ${videoTransform.zoomPercent}%`);
  const transformSummary = transformParts.length > 0 ? transformParts.join(' • ') : '1.0x • Không biến đổi';
  const isTransformActive = transformParts.length > 0;

  const handlePresetChange = (next: 'default' | 'bilibili_series' | 'shorts_clean') => {
    setPresetKey(next);
    if (onApplyPreset) {
      onApplyPreset(next);
    } else {
      if (next === 'default') {
        onChangeGlobalQn(0);
        onChangeGlobalFormat('mp4');
        onChangeGlobalWatermark('auto');
      } else if (next === 'bilibili_series') {
        onChangeGlobalQn(80);
        onChangeGlobalFormat('mp4');
        onChangeGlobalWatermark('auto');
      } else if (next === 'shorts_clean') {
        onChangeGlobalQn(0);
        onChangeGlobalFormat('mp4');
        onChangeGlobalWatermark('auto');
      }
    }
  };

  return (
    <aside
      id="output-config"
      className="glass-card rounded-2xl p-4 sm:p-5 space-y-4 xl:sticky xl:top-20"
    >
      {/* Header + Preset + Apply All */}
      <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
        <div>
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
            Cấu hình đầu ra &amp; xử lý video
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Áp dụng mặc định cho video mới thêm hoặc đồng bộ lại toàn bộ hàng đợi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={presetKey}
            onChange={(e) =>
              handlePresetChange(e.target.value as 'default' | 'bilibili_series' | 'shorts_clean')
            }
            aria-label="Chọn cấu hình nhanh"
            className="rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-2.5 py-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-300 focus:outline-none cursor-pointer"
          >
            <option value="default">Preset: Chuẩn Reup</option>
            <option value="bilibili_series">Preset: Bilibili Series 1080p</option>
            <option value="shorts_clean">Preset: Shorts 9:16 Xóa Logo</option>
          </select>

          <button
            type="button"
            disabled={!hasItems}
            onClick={onApplyToAll}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition whitespace-nowrap cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Áp dụng cho tất cả</span>
          </button>
        </div>
      </div>

      {/* 2-Column Compact Options Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label htmlFor="global-resolution" className="block text-slate-500 dark:text-slate-400 mb-1">
            Độ phân giải
          </label>
          <select
            id="global-resolution"
            value={globalQn}
            onChange={(e) => onChangeGlobalQn(Number(e.target.value))}
            className={fieldSelectClass}
          >
            {RESOLUTION_PRESETS.map((opt) => (
              <option key={opt.qn} value={opt.qn}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="global-format" className="block text-slate-500 dark:text-slate-400 mb-1">
            Định dạng tệp
          </label>
          <select
            id="global-format"
            value={globalFormat}
            onChange={(e) => onChangeGlobalFormat(e.target.value as OutputFormat)}
            className={fieldSelectClass}
          >
            {OUTPUT_FORMATS.map((fmt) => (
              <option key={fmt.value} value={fmt.value}>
                {fmt.label} — {fmt.desc}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="global-watermark" className="block text-slate-500 dark:text-slate-400 mb-1">
            Xóa logo gốc
          </label>
          <select
            id="global-watermark"
            value={globalWatermark}
            onChange={(e) => onChangeGlobalWatermark(e.target.value as WatermarkMode)}
            className={fieldSelectClass}
          >
            {WATERMARK_PRESETS.map((wm) => (
              <option key={wm.value} value={wm.value}>
                {wm.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="global-concurrency" className="block text-slate-500 dark:text-slate-400 mb-1">
            Tải đồng thời
          </label>
          <select
            id="global-concurrency"
            value={concurrency}
            onChange={(e) => onChangeConcurrency(Number(e.target.value))}
            className={`${fieldSelectClass} font-mono tabular-nums`}
          >
            <option value={1}>1 luồng</option>
            <option value={2}>2 luồng</option>
            <option value={3}>3 luồng</option>
          </select>
        </div>

        {/* Brand Logo */}
        <div>
          <span className="block text-slate-500 dark:text-slate-400 mb-1">Logo thương hiệu</span>
          {customLogo.dataUrl ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 min-h-[38px]">
              <div className="flex items-center gap-2 min-w-0">
                <label className="ios-switch" title="Bật / Tắt chèn logo thương hiệu">
                  <input
                    type="checkbox"
                    checked={customLogo.enabled}
                    onChange={onToggleCustomLogo}
                  />
                  <span className="ios-slider" />
                </label>
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold truncate ${
                    customLogo.enabled
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {customLogo.enabled ? 'Đang bật' : 'Đang tắt'}
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenLogoModal}
                className="text-cyan-700 dark:text-cyan-300 hover:underline font-semibold shrink-0 cursor-pointer"
              >
                Sửa
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenLogoModal}
              className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-2 text-slate-700 dark:text-slate-200 hover:border-violet-400/50 transition cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300 shrink-0" />
              <span>Chèn logo riêng</span>
            </button>
          )}
        </div>

        {/* Frame Transform */}
        <div>
          <span className="block text-slate-500 dark:text-slate-400 mb-1">Biến đổi khung hình</span>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 min-h-[38px]">
            <button
              type="button"
              onClick={onOpenTransformModal}
              className="inline-flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-medium truncate cursor-pointer hover:text-cyan-600 dark:hover:text-cyan-300 transition min-w-0"
              title="Chỉnh sửa tốc độ, lật gương, thu phóng"
            >
              <Sliders className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300 shrink-0" />
              <span className="truncate font-mono tabular-nums text-[11px]">{transformSummary}</span>
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {isTransformActive && (
                <button
                  type="button"
                  onClick={onResetTransform}
                  title="Đặt lại mặc định"
                  className="p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={onOpenTransformModal}
                className="text-xs px-2 py-0.5 rounded bg-slate-200/80 dark:bg-white/5 hover:bg-slate-300/80 dark:hover:bg-white/10 text-violet-700 dark:text-violet-300 font-semibold cursor-pointer"
              >
                Đổi
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-save & Storage Folder */}
      <div className="rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-3.5 space-y-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-900 dark:text-white select-none">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => onToggleAutoSave(e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
            />
            <span>Tự động lưu về máy</span>
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Lưu tự động vào Downloads • Xuất ZIP theo thư mục
          </span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <label htmlFor="storage-subfolder" className="text-slate-500 dark:text-slate-400 shrink-0">
            Thư mục lưu trữ
          </label>
          <input
            id="storage-subfolder"
            type="text"
            value={subfolderName}
            onChange={(e) => onChangeSubfolderName(e.target.value)}
            placeholder="GaConPro_Downloads"
            className="flex-1 min-w-0 rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-900 dark:text-white font-medium font-mono focus:border-emerald-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onPickFolder}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-white/10 hover:bg-slate-100 dark:hover:bg-white/15 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-100 font-medium shrink-0 cursor-pointer whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
            <span>{folderName ? `Ổ đĩa: ${folderName}` : 'Chọn thư mục'}</span>
          </button>
          {folderName && (
            <button
              type="button"
              onClick={onClearFolder}
              title="Bỏ chọn thư mục trên máy"
              className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {folderNotice ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-300">{folderNotice}</p>
        ) : (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300/90">
            {folderName ? (
              <>
                Đang lưu vào:{' '}
                <code className="font-mono font-bold">
                  {folderName}
                  {subfolderName ? `/${subfolderName}` : ''}
                </code>
              </>
            ) : (
              <>
                Xuất ZIP theo thư mục &ldquo;
                <span className="font-bold underline">{subfolderName || 'GaConPro_Downloads'}</span>
                &rdquo;
              </>
            )}
          </p>
        )}
      </div>
    </aside>
  );
};
