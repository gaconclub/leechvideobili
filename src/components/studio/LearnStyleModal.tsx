import React, { useRef, useState } from 'react';
import { FolderOpen, Loader2, Trash2, Wand2, X } from 'lucide-react';
import {
  AiProviderId,
  LearnedVideoStyle,
  StudioUploadedAsset,
} from '../../types/bilibili';
import { parseJsonSafe, uploadMediaFileToStudio } from './studioConfig';

interface LearnStyleModalProps {
  isOpen: boolean;
  aiProvider: AiProviderId;
  useProModel: boolean;
  sessdata?: string;
  ytCookies?: string;
  onClose: () => void;
  onLearned: (style: LearnedVideoStyle, allStyles: LearnedVideoStyle[]) => void;
}

export const LearnStyleModal: React.FC<LearnStyleModalProps> = ({
  isOpen,
  aiProvider,
  useProModel,
  sessdata = '',
  ytCookies = '',
  onClose,
  onLearned,
}) => {
  const [sourceUrl, setSourceUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [styleName, setStyleName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isAnalyzing) return;
    setErrorMsg('');
    setStatusLabel('');
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setSourceUrl('');
    setErrorMsg('');
    if (!styleName.trim()) {
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (base) setStyleName(base.slice(0, 48));
    }
    e.target.value = '';
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAnalyzing) return;

    const cleanUrl = sourceUrl.trim();
    if (!selectedFile && !cleanUrl) {
      setErrorMsg('Vui lòng dán link video mẫu hoặc chọn file video trên máy.');
      return;
    }
    if (!selectedFile && !/^https?:\/\/\S+/i.test(cleanUrl)) {
      setErrorMsg('Link video mẫu cần bắt đầu bằng http:// hoặc https://.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg('');

    try {
      let localAssetId = '';
      if (selectedFile) {
        setStatusLabel(`Đang tải video "${selectedFile.name}" lên máy chủ (0%)...`);
        const asset = await uploadMediaFileToStudio<StudioUploadedAsset>(
          selectedFile,
          'video',
          (pct) => {
            if (pct < 100) {
              setStatusLabel(`Đang tải video "${selectedFile.name}" lên máy chủ (${pct}%)...`);
            } else {
              setStatusLabel('Đang cắt 16 khung hình rải đều & phân tích phong cách bằng AI...');
            }
          }
        );
        localAssetId = asset.assetId;
      } else {
        setStatusLabel('Đang tải video mẫu (≤ 480p), cắt 16 khung hình rải đều & phân tích bằng AI...');
      }

      const res = await fetch('/api/studio/learned-styles/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(localAssetId ? { localAssetId } : { sourceUrl: cleanUrl }),
          styleName: styleName.trim(),
          aiProvider,
          useProModel,
          sessdata,
          ytCookies,
        }),
      });
      const data = await parseJsonSafe<{
        style?: LearnedVideoStyle;
        styles?: LearnedVideoStyle[];
        error?: string;
      }>(res);
      if (!res.ok || !data.style) {
        throw new Error(data.error || `Không thể phân tích phong cách (HTTP ${res.status}).`);
      }

      const nextList = Array.isArray(data.styles) ? data.styles : [data.style];
      setSourceUrl('');
      setSelectedFile(null);
      setStyleName('');
      setStatusLabel('');
      onLearned(data.style, nextList);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Phân tích phong cách thất bại. Vui lòng thử lại.');
      setStatusLabel('');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#14182d] border border-slate-200 dark:border-slate-500/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-600/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-sm">
            <Wand2 className="w-4 h-4 text-violet-500 dark:text-violet-300 shrink-0" />
            <span>Học phong cách từ video mẫu</span>
          </div>
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleClose}
            aria-label="Đóng"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAnalyze} className="p-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Link video mẫu (YouTube, TikTok, Facebook, Instagram, Douyin...)
            </label>
            <input
              type="url"
              value={sourceUrl}
              disabled={isAnalyzing}
              onChange={(e) => {
                setSourceUrl(e.target.value);
                if (e.target.value.trim()) setSelectedFile(null);
                setErrorMsg('');
              }}
              placeholder="https://..."
              className="w-full h-10 px-3 text-xs bg-slate-50 dark:bg-[#0d1122] border border-slate-200 dark:border-slate-500/30 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-violet-400 disabled:opacity-60"
            />

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">hoặc</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-[#1c223d] hover:bg-slate-200/80 dark:hover:bg-[#242b4d] border border-slate-200 dark:border-slate-500/30 rounded-lg transition cursor-pointer disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" />
                <span>Chọn file video trên máy</span>
              </button>

              {selectedFile && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 min-w-0">
                  <span className="truncate max-w-[200px] font-medium">{selectedFile.name}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                  {!isAnalyzing && (
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      title="Bỏ chọn file"
                      className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Tên phong cách (tuỳ chọn)
            </label>
            <input
              type="text"
              value={styleName}
              disabled={isAnalyzing}
              onChange={(e) => setStyleName(e.target.value)}
              placeholder="vd: Hoạt hình đầu tròn"
              maxLength={80}
              className="w-full h-10 px-3 text-xs bg-slate-50 dark:bg-[#0d1122] border border-slate-200 dark:border-slate-500/30 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-violet-400 disabled:opacity-60"
            />
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Tool tải video (≤ 480p), cắt 16 khung hình rải đều + 1 đoạn ngắn rồi nhờ AI phân tích nét vẽ / chất ảnh, màu, ánh sáng, cách quay. Phong cách lưu trong máy — lần sau chỉ cần chọn lại.
          </p>

          {statusLabel && (
            <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-400/30 text-xs text-violet-700 dark:text-violet-200 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{statusLabel}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs text-rose-600 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={handleClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isAnalyzing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-400 rounded-xl shadow-md shadow-indigo-500/20 transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>{isAnalyzing ? 'Đang phân tích...' : 'Phân tích'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
