import React from 'react';
import { SlidersHorizontal, Check, Sun, Moon, FolderOpen, X, Image as ImageIcon, Sliders } from 'lucide-react';
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
  darkMode: boolean;
  hasItems: boolean;
  customLogo: CustomLogoConfig;
  videoTransform: VideoTransformConfig;
  onOpenLogoModal: () => void;
  onToggleCustomLogo: () => void;
  onOpenTransformModal: () => void;
  onResetTransform: () => void;
  onChangeGlobalQn: (qn: number) => void;
  onChangeGlobalFormat: (fmt: OutputFormat) => void;
  onChangeGlobalWatermark: (wm: WatermarkMode) => void;
  onChangeConcurrency: (n: number) => void;
  onToggleAutoSave: (val: boolean) => void;
  onChangeSubfolderName: (val: string) => void;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onApplyToAll: () => void;
  onToggleDarkMode: () => void;
}

export const GlobalConfigBar: React.FC<GlobalConfigBarProps> = ({
  globalQn,
  globalFormat,
  globalWatermark,
  concurrency,
  autoSave,
  folderName,
  subfolderName,
  folderNotice,
  darkMode,
  hasItems,
  customLogo,
  videoTransform,
  onOpenLogoModal,
  onToggleCustomLogo,
  onOpenTransformModal,
  onResetTransform,
  onChangeGlobalQn,
  onChangeGlobalFormat,
  onChangeGlobalWatermark,
  onChangeConcurrency,
  onToggleAutoSave,
  onChangeSubfolderName,
  onPickFolder,
  onClearFolder,
  onApplyToAll,
  onToggleDarkMode,
}) => {
  return (
    <section
      id="output-config"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-6 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-[#FB7299]" />
            <span>Cấu hình đầu ra mặc định</span>
          </div>

          {/* Resolution selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="global-resolution"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Độ phân giải
            </label>
            <select
              id="global-resolution"
              value={globalQn}
              onChange={(e) => onChangeGlobalQn(Number(e.target.value))}
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299] cursor-pointer"
            >
              {RESOLUTION_PRESETS.map((opt) => (
                <option key={opt.qn} value={opt.qn}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Format selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="global-format"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Định dạng tệp
            </label>
            <select
              id="global-format"
              value={globalFormat}
              onChange={(e) => onChangeGlobalFormat(e.target.value as OutputFormat)}
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299] cursor-pointer"
            >
              {OUTPUT_FORMATS.map((fmt) => (
                <option key={fmt.value} value={fmt.value}>
                  {fmt.label} — {fmt.desc}
                </option>
              ))}
            </select>
          </div>

          {/* Watermark removal selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="global-watermark"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Xóa logo
            </label>
            <select
              id="global-watermark"
              value={globalWatermark}
              onChange={(e) => onChangeGlobalWatermark(e.target.value as WatermarkMode)}
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299] cursor-pointer"
            >
              {WATERMARK_PRESETS.map((wm) => (
                <option key={wm.value} value={wm.value}>
                  {wm.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Logo Button & Status Widget */}
          {customLogo.dataUrl ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-pink-200 dark:border-pink-900 bg-pink-50/60 dark:bg-pink-950/30">
              <input
                type="checkbox"
                id="toggle-custom-logo"
                checked={customLogo.enabled}
                onChange={onToggleCustomLogo}
                className="w-3.5 h-3.5 rounded border-pink-300 dark:border-pink-700 accent-[#FB7299] cursor-pointer"
                title="Bật / Tắt chèn logo riêng"
              />
              <div
                onClick={onOpenLogoModal}
                className="flex items-center gap-1.5 cursor-pointer hover:opacity-85 transition-opacity"
                title="Nhấn để xem hoặc đổi logo, chỉnh vị trí / kích thước"
              >
                <img
                  src={customLogo.dataUrl}
                  alt="Logo preview"
                  className="w-4 h-4 object-contain rounded bg-white dark:bg-slate-900 border border-pink-200 dark:border-pink-800 shrink-0"
                />
                <span className={`text-xs font-semibold whitespace-nowrap ${customLogo.enabled ? 'text-[#FB7299]' : 'text-slate-400 line-through'}`}>
                  {customLogo.enabled ? 'Logo riêng (Bật)' : 'Logo riêng (Tắt)'}
                </span>
                <span className="text-[10px] text-slate-500 underline ml-0.5">Sửa</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenLogoModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-3.5 h-3.5 text-[#FB7299]" />
              <span>Chèn logo của bạn</span>
            </button>
          )}

          {/* Video Transform Button (Speed / Mirror / Zoom) */}
          {(() => {
            const parts: string[] = [];
            if (Math.abs(videoTransform.speed - 1) > 0.01) parts.push(`${videoTransform.speed}x`);
            if (videoTransform.mirror === 'horizontal') parts.push('Lật ngang');
            else if (videoTransform.mirror === 'vertical') parts.push('Lật dọc');
            if (videoTransform.zoomPercent !== 100) parts.push(`Zoom ${videoTransform.zoomPercent}%`);
            const isActive = parts.length > 0;

            return isActive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-pink-200 dark:border-pink-900 bg-pink-50/60 dark:bg-pink-950/30">
                <button
                  type="button"
                  onClick={onOpenTransformModal}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FB7299] hover:opacity-85 transition-opacity cursor-pointer whitespace-nowrap"
                  title="Chỉnh sửa tốc độ, lật gương, thu phóng khung hình"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{parts.join(' · ')}</span>
                </button>
                <button
                  type="button"
                  onClick={onResetTransform}
                  title="Đặt lại tốc độ / lật / thu phóng về mặc định"
                  className="p-0.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenTransformModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Sliders className="w-3.5 h-3.5 text-[#FB7299]" />
                <span>Tốc độ · Lật · Thu phóng</span>
              </button>
            );
          })()}

          {/* Concurrency selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="global-concurrency"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Tải đồng thời
            </label>
            <select
              id="global-concurrency"
              value={concurrency}
              onChange={(e) => onChangeConcurrency(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299] cursor-pointer"
            >
              <option value={1}>1 luồng</option>
              <option value={2}>2 luồng</option>
              <option value={3}>3 luồng</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={!hasItems}
            onClick={onApplyToAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Áp dụng cho tất cả</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Auto-save & custom destination folder row */}
      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => onToggleAutoSave(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-[#FB7299] cursor-pointer"
            />
            <span>Tự động lưu về máy</span>
          </label>

          <div className="flex items-center gap-2">
            <label
              htmlFor="storage-subfolder"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Thư mục lưu trữ
            </label>
            <input
              id="storage-subfolder"
              type="text"
              value={subfolderName}
              onChange={(e) => onChangeSubfolderName(e.target.value)}
              placeholder="BiliBatch_Downloads"
              className="w-44 px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPickFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#FB7299]" />
              <span>{folderName ? `Ổ đĩa: ${folderName}` : 'Chọn thư mục trên máy'}</span>
            </button>

            {folderName && (
              <button
                type="button"
                onClick={onClearFolder}
                title="Bỏ chọn thư mục trên máy"
                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {folderNotice ? (
            <span className="text-amber-600 dark:text-amber-400">{folderNotice}</span>
          ) : folderName ? (
            <span>
              Đang lưu vào: <code className="font-mono">{folderName}{subfolderName ? `/${subfolderName}` : ''}</code>
            </span>
          ) : (
            <span>Lưu tự động vào Downloads · Xuất ZIP theo thư mục "{subfolderName || 'BiliBatch_Downloads'}"</span>
          )}
        </div>
      </div>
    </section>
  );
};
