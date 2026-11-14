import React, { useState, useRef } from 'react';
import { X, Image as ImageIcon, Trash2, Check, Sparkles } from 'lucide-react';
import { CustomLogoConfig, LogoPosition } from '../types/bilibili';

interface CustomLogoModalProps {
  isOpen: boolean;
  config: CustomLogoConfig;
  onSave: (config: CustomLogoConfig) => void;
  onClose: () => void;
}

export const CustomLogoModal: React.FC<CustomLogoModalProps> = ({
  isOpen,
  config,
  onSave,
  onClose,
}) => {
  const [enabled, setEnabled] = useState<boolean>(config.enabled);
  const [dataUrl, setDataUrl] = useState<string | undefined>(config.dataUrl);
  const [fileName, setFileName] = useState<string | undefined>(config.fileName);
  const [position, setPosition] = useState<LogoPosition>(config.position || 'bottom-right');
  const [scalePercent, setScalePercent] = useState<number>(config.scalePercent || 15);
  const [opacity, setOpacity] = useState<number>(config.opacity ?? 0.85);
  const [margin, setMargin] = useState<number>(config.margin || 24);

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setEnabled(config.enabled);
      setDataUrl(config.dataUrl);
      setFileName(config.fileName);
      setPosition(config.position || 'bottom-right');
      setScalePercent(config.scalePercent || 15);
      setOpacity(config.opacity ?? 0.85);
      setMargin(config.margin || 24);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn tệp hình ảnh (PNG, JPG, WEBP, SVG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setDataUrl(result);
      setFileName(file.name);
      setEnabled(true);
      // Auto-save so closing the modal will keep the uploaded logo active
      onSave({
        enabled: true,
        dataUrl: result,
        fileName: file.name,
        position,
        scalePercent,
        opacity,
        margin,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setDataUrl(undefined);
    setFileName(undefined);
    setEnabled(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = () => {
    onSave({
      enabled: Boolean(enabled && dataUrl),
      dataUrl,
      fileName,
      position,
      scalePercent,
      opacity,
      margin,
    });
    onClose();
  };

  const getPositionStyles = () => {
    const pad = 12; // visual preview padding
    switch (position) {
      case 'top-left':
        return { top: `${pad}px`, left: `${pad}px` };
      case 'top-right':
        return { top: `${pad}px`, right: `${pad}px` };
      case 'bottom-left':
        return { bottom: `${pad}px`, left: `${pad}px` };
      case 'center':
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
      case 'bottom-right':
      default:
        return { bottom: `${pad}px`, right: `${pad}px` };
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-[#003B3E]/10 dark:bg-[#003B3E]/65 text-[#003B3E] dark:text-[#1BA8AD]">
                <ImageIcon className="w-5 h-5" />
              </span>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Chèn logo thương hiệu của bạn vào video
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tự động chèn hình ảnh watermark lên video đã tải về thông qua FFmpeg.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload & preview area */}
        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleFileChange}
            className="hidden"
          />

          {!dataUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-[#003B3E] dark:hover:border-[#003B3E] rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-[#000A10]/60 hover:bg-[#003B3E]/[0.08]"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-2 text-slate-500 dark:text-slate-400">
                <ImageIcon className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Nhấn để tải ảnh logo lên
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Khuyên dùng tệp PNG nền trong suốt để có thẩm mỹ tốt nhất (hỗ trợ JPG, WEBP)
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                    <img src={dataUrl} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {fileName || 'Logo tùy chỉnh'}
                    </p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      Đã sẵn sàng chèn vào video
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-[#00464A] rounded-lg transition-colors cursor-pointer"
                  >
                    Đổi ảnh
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    title="Xóa logo này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Real-time Video Mockup Preview */}
              <div className="relative w-full aspect-video bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center select-none">
                <div className="text-center text-slate-600 dark:text-slate-500 text-xs">
                  <p className="font-semibold">Mô phỏng khung hình video 16:9</p>
                  <p className="text-[10px]">Vị trí và độ mờ hiển thị trực tiếp bên dưới</p>
                </div>

                <div
                  className="absolute pointer-events-none transition-all duration-150"
                  style={{
                    ...getPositionStyles(),
                    width: `${scalePercent * 1.5}%`,
                    maxWidth: '35%',
                    opacity,
                  }}
                >
                  <img
                    src={dataUrl}
                    alt="Watermark Mockup"
                    className="w-full h-auto object-contain drop-shadow-md"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Options */}
          {dataUrl && (
            <div className="space-y-3.5 pt-2">
              {/* Position selector */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Vị trí hiển thị logo
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {[
                    { id: 'top-left', label: 'Trên trái' },
                    { id: 'top-right', label: 'Trên phải' },
                    { id: 'bottom-left', label: 'Dưới trái' },
                    { id: 'bottom-right', label: 'Dưới phải' },
                    { id: 'center', label: 'Chính giữa' },
                  ].map((pos) => (
                    <button
                      key={pos.id}
                      type="button"
                      onClick={() => setPosition(pos.id as LogoPosition)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        position === pos.id
                          ? 'bg-[#003B3E] text-white border-[#003B3E]'
                          : 'bg-slate-50 dark:bg-[#000A10] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scale & Opacity controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Scale */}
                <div>
                  <label
                    htmlFor="logo-scale-select"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Kích thước (% video)
                  </label>
                  <select
                    id="logo-scale-select"
                    value={scalePercent}
                    onChange={(e) => setScalePercent(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                  >
                    <option value={10}>10% (Nhỏ gọn)</option>
                    <option value={15}>15% (Chuẩn đẹp)</option>
                    <option value={20}>20% (Rõ ràng)</option>
                    <option value={25}>25% (Lớn)</option>
                  </select>
                </div>

                {/* Opacity */}
                <div>
                  <label
                    htmlFor="logo-opacity-select"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Độ mờ đục (Opacity)
                  </label>
                  <select
                    id="logo-opacity-select"
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                  >
                    <option value={1.0}>100% (Đậm nét)</option>
                    <option value={0.85}>85% (Chuẩn đẹp)</option>
                    <option value={0.65}>65% (Bán trong suốt)</option>
                    <option value={0.4}>40% (Chìm nhẹ)</option>
                  </select>
                </div>

                {/* Margin */}
                <div>
                  <label
                    htmlFor="logo-margin-select"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Khoảng cách lề
                  </label>
                  <select
                    id="logo-margin-select"
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                  >
                    <option value={16}>16 px (Sát mép)</option>
                    <option value={24}>24 px (Tiêu chuẩn)</option>
                    <option value={36}>36 px (Rộng rãi)</option>
                  </select>
                </div>
              </div>

              {/* Enable / Disable toggle */}
              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-[#003B3E] cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Kích hoạt chèn logo này vào các video tải về
                </span>
              </label>

              <div className="flex items-start gap-2 p-2.5 bg-[#003B3E]/10 border border-[#003B3E]/35 rounded-xl text-xs text-slate-700 dark:text-slate-300">
                <Sparkles className="w-4 h-4 shrink-0 text-[#003B3E] dark:text-[#1BA8AD] mt-0.5" />
                <span>
                  <strong>Mẹo kết hợp:</strong> Bạn có thể bật đồng thời mục <em>&quot;Tự động phát hiện & xóa&quot;</em> ở ngoài thanh cấu hình — hệ thống sẽ dùng FFmpeg xóa logo Bilibili gốc trước, sau đó chèn logo của bạn lên video!
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-[#00464A]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Lưu & Áp dụng</span>
          </button>
        </div>
      </div>
    </div>
  );
};
