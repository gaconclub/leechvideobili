import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { CommandCenterState } from '../../types/commandCenter';

export interface GoogleFlowBundleScene {
  sceneId: string;
  index: number;
  title: string;
  durationSec: number;
  keyframeImageUrl?: string;
  videoUrl?: string;
  imageValidated?: boolean;
  flowStatus?: 'not_exported' | 'ready' | 'imported';
  flowPrompt: string;
}

export interface GoogleFlowBundle {
  runId: string;
  title: string;
  aspectRatio: string;
  videoStyle: string;
  flowUrl: string;
  characterBible: string;
  fullScriptText: string;
  scenes: GoogleFlowBundleScene[];
}

interface Props {
  open: boolean;
  runId?: string;
  focusSceneId?: string | null;
  onClose: () => void;
  onStateUpdated: (next: CommandCenterState) => void;
}

export const GoogleFlowModal: React.FC<Props> = ({
  open,
  runId,
  focusSceneId,
  onClose,
  onStateUpdated,
}) => {
  const [bundle, setBundle] = useState<GoogleFlowBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploadingSceneId, setUploadingSceneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBundle = async () => {
    setLoading(true);
    setError(null);
    try {
      const targetId = encodeURIComponent(runId || 'active');
      const res = await fetch(`/api/command-center/productions/${targetId}/flow-bundle`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể tải gói kịch bản Google Flow.');
      setBundle(data);
    } catch (err: any) {
      setError(err?.message || 'Lỗi tải gói Google Flow.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadBundle();
    }
  }, [open, runId]);

  if (!open) return null;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      setError('Trình duyệt không cho phép sao chép tự động — hãy bôi đen và copy thủ công.');
    }
  };

  const handleUploadFlowVideo = (sceneId: string, file?: File | null) => {
    if (!file) return;
    setUploadingSceneId(sceneId);
    setError(null);
    setNotice(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const videoDataUrl = String(reader.result || '');
        const res = await fetch(`/api/command-center/scenes/${encodeURIComponent(sceneId)}/upload-flow-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: bundle?.runId || runId,
            videoDataUrl,
            fileName: file.name,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không thể nhập video từ Google Flow.');
        if (data.state) onStateUpdated(data.state);
        setNotice(`Đã nhập thành công video "${file.name}" từ Google Flow và tự động duyệt cảnh.`);
        await loadBundle();
      } catch (err: any) {
        setError(err?.message || 'Lỗi tải video lên máy chủ.');
      } finally {
        setUploadingSceneId(null);
      }
    };
    reader.onerror = () => {
      setError('Không đọc được tệp video đã chọn.');
      setUploadingSceneId(null);
    };
    reader.readAsDataURL(file);
  };

  const orderedScenes = bundle
    ? focusSceneId
      ? [
          ...bundle.scenes.filter((s) => s.sceneId === focusSceneId),
          ...bundle.scenes.filter((s) => s.sceneId !== focusSceneId),
        ]
      : bundle.scenes
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                Truyền kịch bản & ảnh Keyframe sang Google Flow
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Copy prompt chuẩn từng cảnh + tải ảnh keyframe đã duyệt đưa vào Google Flow, sau đó tải tệp .mp4 lên lại để tự động ghép phim.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={bundle?.flowUrl || 'https://labs.google/fx/tools/flow'}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Mở Google Flow
            </a>
            {bundle && (
              <button
                type="button"
                onClick={() => void copyText('full_script', bundle.fullScriptText)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition"
              >
                {copiedId === 'full_script' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedId === 'full_script' ? 'Đã copy toàn bộ' : 'Copy toàn bộ kịch bản'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Đang chuẩn bị gói kịch bản Google Flow...
            </div>
          ) : !bundle || orderedScenes.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Chưa có phân cảnh nào trong phiên hiện tại để xuất sang Google Flow.
            </div>
          ) : (
            <>
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl px-4 py-3 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-slate-900">{bundle.title}</span>
                  <span className="text-slate-500 ml-2">
                    Tỷ lệ {bundle.aspectRatio} · Phong cách {bundle.videoStyle} · {bundle.scenes.length} phân cảnh
                  </span>
                </div>
                <span className="text-blue-700 font-semibold">
                  Đã có video: {bundle.scenes.filter((s) => Boolean(s.videoUrl)).length}/{bundle.scenes.length}
                </span>
              </div>

              <div className="space-y-3">
                {orderedScenes.map((sc) => {
                  const isFocused = focusSceneId === sc.sceneId;
                  const isUploading = uploadingSceneId === sc.sceneId;
                  return (
                    <div
                      key={sc.sceneId}
                      className={`rounded-xl border p-4 transition ${
                        isFocused
                          ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              Cảnh {String(sc.index).padStart(2, '0')}: {sc.title}
                            </span>
                            <span className="text-[11px] text-slate-500">({sc.durationSec}s)</span>
                            {sc.videoUrl ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                Đã có video
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                                Chờ render Flow
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void copyText(sc.sceneId, sc.flowPrompt)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            {copiedId === sc.sceneId ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {copiedId === sc.sceneId ? 'Đã copy prompt' : 'Copy prompt Flow'}
                          </button>

                          {sc.keyframeImageUrl && (
                            <a
                              href={sc.keyframeImageUrl}
                              download={`scene_${String(sc.index).padStart(2, '0')}_keyframe.png`}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Tải ảnh Keyframe
                            </a>
                          )}

                          <label className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer">
                            {isUploading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            {isUploading ? 'Đang nạp...' : 'Tải .mp4 từ Flow lên'}
                            <input
                              type="file"
                              accept="video/mp4,video/webm,video/quicktime"
                              className="hidden"
                              disabled={isUploading}
                              onChange={(e) => {
                                handleUploadFlowVideo(sc.sceneId, e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                        {sc.keyframeImageUrl && (
                          <div className="md:col-span-3">
                            <img
                              src={sc.keyframeImageUrl}
                              alt={`Keyframe Cảnh ${sc.index}`}
                              className="w-full h-28 object-cover rounded-lg border border-slate-200 bg-slate-100"
                            />
                          </div>
                        )}
                        <div className={sc.keyframeImageUrl ? 'md:col-span-9' : 'md:col-span-12'}>
                          <textarea
                            readOnly
                            value={sc.flowPrompt}
                            rows={5}
                            className="w-full text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 leading-relaxed focus:outline-none"
                          />
                        </div>
                      </div>

                      {sc.videoUrl && (
                        <div className="mt-2.5 flex items-center gap-2 text-xs text-emerald-700">
                          <Film className="w-3.5 h-3.5" />
                          <span>Video đã gắn vào Cảnh {sc.index}:</span>
                          <a
                            href={sc.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-semibold"
                          >
                            Xem clip hiện tại
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
