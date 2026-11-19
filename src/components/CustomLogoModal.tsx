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
  const [uploadErr, setUploadErr] = useState<string>('');

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
      setUploadErr('');
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadErr('Vui lòng chọn tệp hình ảnh (PNG, JPG, WEBP, SVG).');
      return;
    }
    setUploadErr('');

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setDataUrl(result);
      setFileName(file.name);
      setEnabled(true);
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
    setUploadErr('');
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
    const pad = 12;
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    >
      <div className="glass-card-accent rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-violet-500/20 text-violet-600 dark:text-violet-300">
                <ImageIcon className="w-5 h-5" />
              </span>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Chèn logo thương hiệu vào video
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tự động chèn hình ảnh watermark lên video đã tải về thông qua FFmpeg.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleFileChange}
            className="hidden"
          />

          {uploadErr && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
              {uploadErr}
            </div>
          )}

          {!dataUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-500/40 hover:border-violet-500 dark:hover:border-violet-400 rounded-xl p-6 text-center cursor-pointer transition bg-slate-50/70 dark:bg-[#0c1021]/70"
            >
              <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center mx-auto mb-2 text-violet-600 dark:text-violet-300">
                <ImageIcon className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Nhấn để tải ảnh logo lên
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Khuyên dùng tệp PNG nền trong suốt (hỗ trợ PNG, JPG, WEBP, SVG)
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                    <img src={dataUrl} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {fileName || 'Logo tùy chỉnh'}
                    </p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-300">
                      Đã sẵn sàng chèn vào video
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg transition cursor-pointer"
                  >
                    Đổi ảnh
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="p-1.5 text-rose-500 hover:bg-rose-500/15 rounded-lg transition cursor-pointer"
                    title="Xóa logo này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative w-full aspect-video bg-gradient-to-br from-slate-900 to-[#0c1021] rounded-xl overflow-hidden border border-slate-700/60 flex items-center justify-center select-none">
                <div className="text-center text-slate-500 text-xs">
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

          {dataUrl && (
            <div className="space-y-3.5 pt-2">
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
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-xl border transition cursor-pointer ${
                        position === pos.id
                          ? 'bg-violet-600 text-white border-violet-500'
                          : 'bg-slate-50 dark:bg-[#0c1021] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="logo-scale-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Kích thước (% video)
                  </label>
                  <select
                    id="logo-scale-select"
                    value={scalePercent}
                    onChange={(e) => setScalePercent(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                  >
                    <option value={10}>10% (Nhỏ gọn)</option>
                    <option value={15}>15% (Chuẩn đẹp)</option>
                    <option value={20}>20% (Rõ ràng)</option>
                    <option value={25}>25% (Lớn)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="logo-opacity-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Độ mờ đục
                  </label>
                  <select
                    id="logo-opacity-select"
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                  >
                    <option value={1.0}>100% (Đậm nét)</option>
                    <option value={0.85}>85% (Chuẩn đẹp)</option>
                    <option value={0.65}>65% (Bán trong suốt)</option>
                    <option value={0.4}>40% (Chìm nhẹ)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="logo-margin-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Khoảng cách lề
                  </label>
                  <select
                    id="logo-margin-select"
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                  >
                    <option value={16}>16 px (Sát mép)</option>
                    <option value={24}>24 px (Tiêu chuẩn)</option>
                    <option value={36}>36 px (Rộng rãi)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Kích hoạt chèn logo này vào các video tải về
                </span>
              </label>

              <div className="flex items-start gap-2 p-2.5 bg-cyan-500/10 border border-cyan-400/25 rounded-xl text-xs text-slate-700 dark:text-slate-300">
                <Sparkles className="w-4 h-4 shrink-0 text-cyan-600 dark:text-cyan-300 mt-0.5" />
                <span>
                  <strong>Mẹo kết hợp:</strong> Bật đồng thời <em>&ldquo;Tự động phát hiện &amp; xóa&rdquo;</em> ở cấu hình — hệ thống sẽ xóa logo gốc bằng FFmpeg trước khi chèn logo thương hiệu.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200/80 dark:border-slate-400/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 rounded-xl transition cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Lưu &amp; Áp dụng</span>
          </button>
        </div>
      </div>
    </div>
  );
};
