import React, { useEffect, useState } from 'react';
import {
  X,
  Gauge,
  FlipHorizontal2,
  ZoomIn,
  RotateCcw,
  Check,
  Sliders,
} from 'lucide-react';
import { MirrorMode, VideoTransformConfig } from '../types/bilibili';

interface VideoTransformModalProps {
  isOpen: boolean;
  config: VideoTransformConfig;
  onSave: (config: VideoTransformConfig) => void;
  onClose: () => void;
}

const SPEED_PRESETS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
const ZOOM_PRESETS = [75, 85, 90, 100, 110, 120, 135];

export const VideoTransformModal: React.FC<VideoTransformModalProps> = ({
  isOpen,
  config,
  onSave,
  onClose,
}) => {
  const [speed, setSpeed] = useState<number>(config.speed || 1);
  const [mirror, setMirror] = useState<MirrorMode>(config.mirror || 'none');
  const [zoomPercent, setZoomPercent] = useState<number>(config.zoomPercent || 100);

  useEffect(() => {
    if (isOpen) {
      setSpeed(config.speed || 1);
      setMirror(config.mirror || 'none');
      setZoomPercent(config.zoomPercent || 100);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleReset = () => {
    setSpeed(1);
    setMirror('none');
    setZoomPercent(100);
  };

  const handleSave = () => {
    onSave({
      speed: Number(speed.toFixed(2)),
      mirror,
      zoomPercent: Math.round(zoomPercent),
    });
    onClose();
  };

  const previewTransform = [
    mirror === 'horizontal' ? 'scaleX(-1)' : '',
    mirror === 'vertical' ? 'scaleY(-1)' : '',
    `scale(${zoomPercent / 100})`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-pink-50 dark:bg-pink-950/40 text-[#FB7299]">
                <Sliders className="w-5 h-5" />
              </span>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Chỉnh sửa khung hình &amp; tốc độ video
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Điều chỉnh tốc độ phát, lật gương và thu phóng nội dung mà vẫn giữ nguyên kích thước khung hình gốc.
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

        {/* Live 16:9 Mockup Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Xem trước khung hình (giữ nguyên tỷ lệ gốc)</span>
            <span className="font-mono tabular-nums">
              {speed}x · {mirror === 'horizontal' ? 'Lật ngang' : mirror === 'vertical' ? 'Lật dọc' : 'Không lật'} · Zoom {zoomPercent}%
            </span>
          </div>
          <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 flex items-center justify-center select-none">
            <div
              className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 flex flex-col items-center justify-center text-white transition-transform duration-150 border border-pink-400/30"
              style={{ transform: previewTransform }}
            >
              <div className="text-lg font-display font-bold tracking-wide flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-[#FB7299] text-white text-xs">TRÁI</span>
                <span>NỘI DUNG VIDEO</span>
                <span className="px-2 py-0.5 rounded bg-sky-500 text-white text-xs">PHẢI</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                {zoomPercent < 100
                  ? 'Thu nhỏ có viền đen xung quanh'
                  : zoomPercent > 100
                  ? 'Phóng to cắt vừa khung hình gốc'
                  : 'Kích thước khung hình 100%'}
              </p>
            </div>
          </div>
        </div>

        {/* Speed Control */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="video-speed-range"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              <Gauge className="w-4 h-4 text-[#FB7299]" />
              <span>Tốc độ video (Nhanh / Chậm)</span>
            </label>
            <span className="text-xs font-mono font-semibold text-[#FB7299] tabular-nums">
              {speed.toFixed(2).replace(/\.00$/, '.0')}x
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SPEED_PRESETS.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setSpeed(val)}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded-lg border transition-colors cursor-pointer ${
                  Math.abs(speed - val) < 0.01
                    ? 'bg-[#FB7299] text-white border-[#FB7299]'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {val === 1 ? '1.0x (Gốc)' : `${val}x`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-400">0.5x</span>
            <input
              id="video-speed-range"
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="flex-1 accent-[#FB7299] cursor-pointer"
            />
            <span className="text-[11px] font-mono text-slate-400">2.0x</span>
          </div>
        </div>

        {/* Mirror Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <FlipHorizontal2 className="w-4 h-4 text-[#FB7299]" />
            <span>Chế độ lật gương video</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'none', label: 'Không lật (Gốc)' },
              { id: 'horizontal', label: 'Lật gương ngang' },
              { id: 'vertical', label: 'Lật dọc (Trên/Dưới)' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMirror(opt.id as MirrorMode)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  mirror === opt.id
                    ? 'bg-[#FB7299] text-white border-[#FB7299]'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zoom / Scale keeping frame ratio */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="video-zoom-range"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              <ZoomIn className="w-4 h-4 text-[#FB7299]" />
              <span>Thu nhỏ / Phóng to nội dung (giữ nguyên khung hình)</span>
            </label>
            <span className="text-xs font-mono font-semibold text-[#FB7299] tabular-nums">
              {zoomPercent}%
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ZOOM_PRESETS.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setZoomPercent(val)}
                className={`px-2.5 py-1 text-xs font-mono font-medium rounded-lg border transition-colors cursor-pointer ${
                  zoomPercent === val
                    ? 'bg-[#FB7299] text-white border-[#FB7299]'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {val === 100 ? '100% (Gốc)' : `${val}%`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-400">50%</span>
            <input
              id="video-zoom-range"
              type="range"
              min={50}
              max={150}
              step={1}
              value={zoomPercent}
              onChange={(e) => setZoomPercent(Number(e.target.value))}
              className="flex-1 accent-[#FB7299] cursor-pointer"
            />
            <span className="text-[11px] font-mono text-slate-400">150%</span>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Đặt lại mặc định</span>
          </button>

          <div className="flex items-center gap-2.5">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#FB7299] hover:bg-[#e55d85] rounded-lg transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Lưu &amp; Áp dụng</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
