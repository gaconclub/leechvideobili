import React from 'react';
import {
  SlidersHorizontal,
  Check,
  Sun,
  Moon,
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

const selectBaseClass =
  'w-full h-9 px-3 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD] focus:ring-2 focus:ring-[#003B3E]/15 transition-all cursor-pointer';

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
  const transformParts: string[] = [];
  if (Math.abs(videoTransform.speed - 1) > 0.01) transformParts.push(`${videoTransform.speed}x`);
  if (videoTransform.mirror === 'horizontal') transformParts.push('Lật ngang');
  else if (videoTransform.mirror === 'vertical') transformParts.push('Lật dọc');
  if (videoTransform.zoomPercent !== 100) transformParts.push(`Zoom ${videoTransform.zoomPercent}%`);
  const isTransformActive = transformParts.length > 0;

  return (
    <section
      id="output-config"
      className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/70 dark:border-[#00464A]/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#003B3E]/10 dark:bg-[#003B3E]/65 text-[#003B3E] dark:text-[#1BA8AD] flex items-center justify-center shrink-0">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Cấu hình đầu ra &amp; xử lý video
            </h2>
            <p className="text-xs text-slate-500 dark:text-teal-100/80">
              Áp dụng mặc định cho video mới thêm hoặc đồng bộ lại toàn bộ hàng đợi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!hasItems}
            onClick={onApplyToAll}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#000A10] hover:bg-[#003B3E]/16 dark:hover:bg-[#000E16] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Áp dụng cho tất cả</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            className="h-9 w-9 inline-flex items-center justify-center text-slate-600 dark:text-teal-100 hover:text-[#003B3E] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main controls grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 py-4">
        {/* Resolution selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="global-resolution"
            className="block text-xs font-medium text-slate-500 dark:text-teal-100/80"
          >
            Độ phân giải
          </label>
          <select
            id="global-resolution"
            value={globalQn}
            onChange={(e) => onChangeGlobalQn(Number(e.target.value))}
            className={selectBaseClass}
          >
            {RESOLUTION_PRESETS.map((opt) => (
              <option key={opt.qn} value={opt.qn}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Format selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="global-format"
            className="block text-xs font-medium text-slate-500 dark:text-teal-100/80"
          >
            Định dạng tệp
          </label>
          <select
            id="global-format"
            value={globalFormat}
            onChange={(e) => onChangeGlobalFormat(e.target.value as OutputFormat)}
            className={selectBaseClass}
          >
            {OUTPUT_FORMATS.map((fmt) => (
              <option key={fmt.value} value={fmt.value}>
                {fmt.label} — {fmt.desc}
              </option>
            ))}
          </select>
        </div>

        {/* Watermark removal selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="global-watermark"
            className="block text-xs font-medium text-slate-500 dark:text-teal-100/80"
          >
            Xóa logo gốc
          </label>
          <select
            id="global-watermark"
            value={globalWatermark}
            onChange={(e) => onChangeGlobalWatermark(e.target.value as WatermarkMode)}
            className={selectBaseClass}
          >
            {WATERMARK_PRESETS.map((wm) => (
              <option key={wm.value} value={wm.value}>
                {wm.label}
              </option>
            ))}
          </select>
        </div>

        {/* Concurrency selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="global-concurrency"
            className="block text-xs font-medium text-slate-500 dark:text-teal-100/80"
          >
            Tải đồng thời
          </label>
          <select
            id="global-concurrency"
            value={concurrency}
            onChange={(e) => onChangeConcurrency(Number(e.target.value))}
            className={`${selectBaseClass} font-mono tabular-nums`}
          >
            <option value={1}>1 luồng</option>
            <option value={2}>2 luồng</option>
            <option value={3}>3 luồng</option>
          </select>
        </div>

        {/* Custom Logo Control */}
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-slate-500 dark:text-teal-100/80">
            Logo thương hiệu
          </span>
          {customLogo.dataUrl ? (
            <div className="h-9 flex items-center justify-between gap-2 px-2.5 rounded-lg border border-[#003B3E]/45 dark:border-[#1BA8AD]/35 bg-[#003B3E]/8 dark:bg-[#000A10]">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  id="toggle-custom-logo"
                  checked={customLogo.enabled}
                  onChange={onToggleCustomLogo}
                  className="w-3.5 h-3.5 rounded border-[#003B3E]/50 accent-[#003B3E] cursor-pointer shrink-0"
                  title="Bật / Tắt chèn logo riêng"
                />
                <button
                  type="button"
                  onClick={onOpenLogoModal}
                  className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:opacity-85 transition-opacity"
                  title="Nhấn để xem hoặc đổi logo, chỉnh vị trí / kích thước"
                >
                  <img
                    src={customLogo.dataUrl}
                    alt="Logo preview"
                    className="w-4 h-4 object-contain rounded bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] shrink-0"
                  />
                  <span
                    className={`text-xs font-semibold truncate ${
                      customLogo.enabled
                        ? 'text-[#003B3E] dark:text-[#1BA8AD]'
                        : 'text-slate-400 line-through'
                    }`}
                  >
                    {customLogo.enabled ? 'Đang bật' : 'Đang tắt'}
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={onOpenLogoModal}
                className="text-[11px] font-medium text-slate-600 dark:text-teal-100 hover:text-[#003B3E] dark:hover:text-white underline shrink-0 cursor-pointer"
              >
                Sửa
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenLogoModal}
              className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-medium rounded-lg border border-slate-200/90 dark:border-[#00464A] bg-[#F8FAFB] dark:bg-[#000A10] text-slate-700 dark:text-teal-50 hover:border-[#003B3E]/60 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] transition-colors cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD] shrink-0" />
              <span>Chèn logo riêng</span>
            </button>
          )}
        </div>

        {/* Video Transform Button (Speed / Mirror / Zoom) */}
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-slate-500 dark:text-teal-100/80">
            Biến đổi khung hình
          </span>
          {isTransformActive ? (
            <div className="h-9 flex items-center justify-between gap-1.5 px-2.5 rounded-lg border border-[#003B3E]/45 dark:border-[#1BA8AD]/35 bg-[#003B3E]/8 dark:bg-[#000A10]">
              <button
                type="button"
                onClick={onOpenTransformModal}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] hover:opacity-85 transition-opacity cursor-pointer truncate min-w-0"
                title="Chỉnh sửa tốc độ, lật gương, thu phóng khung hình"
              >
                <Sliders className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{transformParts.join(' · ')}</span>
              </button>
              <button
                type="button"
                onClick={onResetTransform}
                title="Đặt lại tốc độ / lật / thu phóng về mặc định"
                className="p-0.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 rounded transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenTransformModal}
              className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-medium rounded-lg border border-slate-200/90 dark:border-[#00464A] bg-[#F8FAFB] dark:bg-[#000A10] text-slate-700 dark:text-teal-50 hover:border-[#003B3E]/60 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Sliders className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD] shrink-0" />
              <span>Tốc độ · Lật · Zoom</span>
            </button>
          )}
        </div>
      </div>

      {/* Auto-save & custom destination folder row */}
      <div className="pt-4 border-t border-slate-200/70 dark:border-[#00464A]/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-teal-50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => onToggleAutoSave(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-teal-700 accent-[#003B3E] cursor-pointer"
            />
            <span>Tự động lưu về máy</span>
          </label>

          <div className="flex items-center gap-2">
            <label
              htmlFor="storage-subfolder"
              className="text-xs font-medium text-slate-500 dark:text-teal-100/80 whitespace-nowrap"
            >
              Thư mục lưu trữ
            </label>
            <input
              id="storage-subfolder"
              type="text"
              value={subfolderName}
              onChange={(e) => onChangeSubfolderName(e.target.value)}
              placeholder="GaConPro_Downloads"
              className="w-44 h-8 px-2.5 text-xs font-mono bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD] focus:ring-2 focus:ring-[#003B3E]/15 transition-all"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPickFolder}
              className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-slate-700 dark:text-teal-50 bg-slate-100/90 dark:bg-[#000A10] hover:bg-[#003B3E]/10 hover:text-[#003B3E] dark:hover:bg-[#000E16] dark:hover:text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD]" />
              <span>{folderName ? `Ổ đĩa: ${folderName}` : 'Chọn thư mục trên máy'}</span>
            </button>

            {folderName && (
              <button
                type="button"
                onClick={onClearFolder}
                title="Bỏ chọn thư mục trên máy"
                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-teal-100/80">
          {folderNotice ? (
            <span className="text-amber-600 dark:text-amber-300">{folderNotice}</span>
          ) : folderName ? (
            <span>
              Đang lưu vào:{' '}
              <code className="font-mono text-[#003B3E] dark:text-[#1BA8AD]">
                {folderName}
                {subfolderName ? `/${subfolderName}` : ''}
              </code>
            </span>
          ) : (
            <span>
              Lưu tự động vào Downloads · Xuất ZIP theo thư mục &ldquo;{subfolderName || 'GaConPro_Downloads'}&rdquo;
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
