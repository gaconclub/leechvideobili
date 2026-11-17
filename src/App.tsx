import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CookieSiteId,
  CustomLogoConfig,
  InspectError,
  OutputFormat,
  PerSiteCookies,
  QueueVideoItem,
  RESOLUTION_PRESETS,
  StudioDefaultConfig,
  TrendingVideoItem,
  VideoTransformConfig,
  WatermarkMode,
} from './types/bilibili';
import { TopBar, AppTab } from './components/TopBar';
import { BatchInputPanel } from './components/BatchInputPanel';
import { GlobalConfigBar } from './components/GlobalConfigBar';
import { QueueTable } from './components/QueueTable';
import { TrendingPanel } from './components/TrendingPanel';
import { SearchPanel } from './components/SearchPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SessdataModal } from './components/SessdataModal';
import { CustomLogoModal } from './components/CustomLogoModal';
import { VideoTransformModal } from './components/VideoTransformModal';
import { UpdateModal, SystemUpdateStatus } from './components/UpdateModal';
import { DerivativeStudioModal } from './components/DerivativeStudioModal';
import {
  buildCombinedCookiesString,
  DEFAULT_STUDIO_CONFIG,
  EMPTY_PER_SITE_COOKIES,
  migrateLegacyCookies,
} from './utils/cookies';

async function parseJsonSafe<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(`Máy chủ trả về phản hồi rỗng (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const trimmed = text.trim();
    if (res.status === 429) {
      throw new Error('Quá giới hạn tần suất yêu cầu (HTTP 429). Đang tạm chậm lại để thử lại.');
    }
    if (trimmed.startsWith('<')) {
      throw new Error(
        `Máy chủ tạm thời trả về trang HTML thay vì JSON (HTTP ${res.status}). Vui lòng thử lại sau giây lát.`
      );
    }
    throw new Error(`Phản hồi không phải JSON hợp lệ (HTTP ${res.status}): ${trimmed.slice(0, 80)}`);
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('batch');
  const [mountedSearch, setMountedSearch] = useState(false);
  const [mountedTrending, setMountedTrending] = useState(false);
  const [searchQueryRequest, setSearchQueryRequest] = useState<{ query: string; nonce: number } | null>(null);
  const [items, setItems] = useState<QueueVideoItem[]>([]);
  const [globalQn, setGlobalQn] = useState<number>(0); // Default: Tốt nhất (Auto)
  const [globalFormat, setGlobalFormat] = useState<OutputFormat>('mp4');
  const [globalWatermark, setGlobalWatermark] = useState<WatermarkMode>('auto');
  const [concurrency, setConcurrency] = useState<number>(3);
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    const saved = localStorage.getItem('bilibatch_autosave');
    return saved === null ? true : saved === 'true';
  });
  const [folderName, setFolderName] = useState<string>('');
  const [subfolderName, setSubfolderName] = useState<string>(() => {
    return localStorage.getItem('bilibatch_subfolder') ?? 'BiliBatch_Downloads';
  });
  const [folderNotice, setFolderNotice] = useState<string>('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectErrors, setInspectErrors] = useState<InspectError[]>([]);
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [isTransformModalOpen, setIsTransformModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<SystemUpdateStatus | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isServerRestarting, setIsServerRestarting] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateSuccessMsg, setUpdateSuccessMsg] = useState('');
  const [derivativeStudioState, setDerivativeStudioState] = useState<{
    isOpen: boolean;
    videos: TrendingVideoItem[];
    query: string;
  }>({ isOpen: false, videos: [], query: '' });

  const [videoTransform, setVideoTransform] = useState<VideoTransformConfig>(() => {
    try {
      const raw = localStorage.getItem('bilibatch_video_transform');
      if (!raw) return { speed: 1, mirror: 'none', zoomPercent: 100 };
      const parsed = JSON.parse(raw);
      return {
        speed: typeof parsed?.speed === 'number' ? parsed.speed : 1,
        mirror: parsed?.mirror === 'horizontal' || parsed?.mirror === 'vertical' ? parsed.mirror : 'none',
        zoomPercent: typeof parsed?.zoomPercent === 'number' ? parsed.zoomPercent : 100,
      };
    } catch {
      return { speed: 1, mirror: 'none', zoomPercent: 100 };
    }
  });

  const videoTransformRef = useRef(videoTransform);
  videoTransformRef.current = videoTransform;

  const handleSaveVideoTransform = (cfg: VideoTransformConfig) => {
    setVideoTransform(cfg);
    try {
      localStorage.setItem('bilibatch_video_transform', JSON.stringify(cfg));
    } catch {
      // ignore
    }
  };

  const handleResetTransform = () => {
    handleSaveVideoTransform({ speed: 1, mirror: 'none', zoomPercent: 100 });
  };

  const [customLogo, setCustomLogo] = useState<CustomLogoConfig>(() => {
    try {
      const raw = localStorage.getItem('bilibatch_custom_logo');
      if (!raw) {
        return {
          enabled: false,
          position: 'bottom-right',
          scalePercent: 15,
          opacity: 0.85,
          margin: 24,
        };
      }
      return JSON.parse(raw);
    } catch {
      return {
        enabled: false,
        position: 'bottom-right',
        scalePercent: 15,
        opacity: 0.85,
        margin: 24,
      };
    }
  });

  const customLogoRef = useRef(customLogo);
  customLogoRef.current = customLogo;

  const handleSaveCustomLogo = (cfg: CustomLogoConfig) => {
    setCustomLogo(cfg);
    try {
      localStorage.setItem('bilibatch_custom_logo', JSON.stringify(cfg));
    } catch {
      // ignore
    }
  };

  const handleToggleCustomLogo = () => {
    if (!customLogo.dataUrl) {
      setIsLogoModalOpen(true);
      return;
    }
    const next = { ...customLogo, enabled: !customLogo.enabled };
    setCustomLogo(next);
    try {
      localStorage.setItem('bilibatch_custom_logo', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const dirHandleRef = useRef<any>(null);
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const subfolderRef = useRef(subfolderName);
  subfolderRef.current = subfolderName;

  const handleToggleAutoSave = (val: boolean) => {
    setAutoSave(val);
    localStorage.setItem('bilibatch_autosave', String(val));
  };

  const handleChangeSubfolderName = (val: string) => {
    setSubfolderName(val);
    localStorage.setItem('bilibatch_subfolder', val);
  };

  const handlePickFolder = async () => {
    setFolderNotice('');
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setFolderNotice(
        'Trình duyệt hiện tại không hỗ trợ chọn ổ đĩa trực tiếp; hãy dùng ô Thư mục lưu trữ + Tải tất cả ZIP hoặc tự lưu về Downloads.'
      );
      return;
    }
    try {
      const handle = await picker({ mode: 'readwrite' });
      dirHandleRef.current = handle;
      setFolderName(handle.name || 'Thư mục đã chọn');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setFolderNotice(
        'Khung xem trước không hỗ trợ hộp thoại chọn ổ đĩa; hãy dùng ô Thư mục lưu trữ + Tải tất cả ZIP hoặc tự lưu về Downloads.'
      );
    }
  };

  const handleClearFolder = () => {
    dirHandleRef.current = null;
    setFolderName('');
    setFolderNotice('');
  };

  const [perSiteCookies, setPerSiteCookies] = useState<PerSiteCookies>(() => {
    try {
      const saved = localStorage.getItem('bilibatch_per_site_cookies');
      if (saved) {
        return { ...EMPTY_PER_SITE_COOKIES, ...(JSON.parse(saved) as Partial<PerSiteCookies>) };
      }
    } catch {
      // ignore parse failure
    }
    return migrateLegacyCookies(
      localStorage.getItem('bilibatch_yt_cookies') || '',
      localStorage.getItem('bilibatch_sessdata') || ''
    );
  });

  const [studioDefaults, setStudioDefaults] = useState<StudioDefaultConfig>(() => {
    try {
      const saved = localStorage.getItem('bilibatch_studio_defaults');
      if (saved) {
        return { ...DEFAULT_STUDIO_CONFIG, ...(JSON.parse(saved) as Partial<StudioDefaultConfig>) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_STUDIO_CONFIG;
  });

  const sessdata = perSiteCookies.bilibili || '';
  const ytCookies = useMemo(() => buildCombinedCookiesString(perSiteCookies), [perSiteCookies]);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('bilibatch_theme') === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('bilibatch_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    // Luôn dọn sạch hàng đợi từ phiên cũ để phiên làm việc mới bắt đầu từ đầu
    try {
      localStorage.removeItem('bilibatch_queue_items');
    } catch {
      // Ignore
    }
  }, []);

  const checkSystemUpdate = useCallback(async () => {
    setIsCheckingUpdate(true);
    setUpdateError('');
    try {
      const res = await fetch('/api/system/update-status');
      const data = await parseJsonSafe<SystemUpdateStatus>(res);
      setUpdateStatus(data);
    } catch (err: any) {
      setUpdateError(err?.message || 'Không thể kiểm tra cập nhật từ máy chủ');
    } finally {
      setIsCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    checkSystemUpdate();
  }, [checkSystemUpdate]);

  const handleOpenUpdateModal = () => {
    setUpdateSuccessMsg('');
    setUpdateError('');
    setIsUpdateModalOpen(true);
    checkSystemUpdate();
  };

  const handleApplyUpdate = async () => {
    setIsApplyingUpdate(true);
    setUpdateError('');
    setUpdateSuccessMsg('');
    try {
      const res = await fetch('/api/system/self-update', { method: 'POST' });
      const data = await parseJsonSafe<{
        ok?: boolean;
        restarting?: boolean;
        commit?: string;
        message?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Cập nhật thất bại');
      }

      if (data.restarting) {
        setIsApplyingUpdate(false);
        setIsServerRestarting(true);
        const deadline = Date.now() + 45_000;
        const pollServer = async () => {
          await new Promise((r) => setTimeout(r, 1500));
          while (Date.now() < deadline) {
            try {
              const ping = await fetch('/api/system/update-status', { cache: 'no-store' });
              if (ping.ok) {
                window.location.reload();
                return;
              }
            } catch {
              // server still restarting
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
          setIsServerRestarting(false);
          setUpdateSuccessMsg('Đã tải bản mới. Bạn hãy bấm tải lại trang (F5) để sử dụng.');
        };
        pollServer();
      } else {
        setIsApplyingUpdate(false);
        setUpdateSuccessMsg(
          `Đã kéo code mới từ GitHub (${data.commit || 'mới nhất'}). Hãy đóng cửa sổ dòng lệnh và chạy lại file start-windows.bat để áp dụng hoàn toàn.`
        );
        checkSystemUpdate();
      }
    } catch (err: any) {
      setIsApplyingUpdate(false);
      setUpdateError(err?.message || 'Lỗi khi cập nhật từ GitHub');
    }
  };

  const persistPerSiteCookies = useCallback((next: PerSiteCookies) => {
    setPerSiteCookies(next);
    localStorage.setItem('bilibatch_per_site_cookies', JSON.stringify(next));
    const nextBili = next.bilibili?.trim() || '';
    const nextCombined = buildCombinedCookiesString(next);
    if (nextBili) {
      localStorage.setItem('bilibatch_sessdata', nextBili);
    } else {
      localStorage.removeItem('bilibatch_sessdata');
    }
    if (nextCombined) {
      localStorage.setItem('bilibatch_yt_cookies', nextCombined);
    } else {
      localStorage.removeItem('bilibatch_yt_cookies');
    }
  }, []);

  const handleSaveSiteCookie = useCallback(
    (siteId: CookieSiteId, value: string) => {
      persistPerSiteCookies({ ...perSiteCookies, [siteId]: value });
    },
    [perSiteCookies, persistPerSiteCookies]
  );

  const handleSaveCookies = (nextSessdata: string, nextYtCookies: string) => {
    const migrated = migrateLegacyCookies(nextYtCookies, nextSessdata);
    persistPerSiteCookies(migrated);
  };

  const handleUpdateStudioDefaults = useCallback((next: StudioDefaultConfig) => {
    setStudioDefaults(next);
    localStorage.setItem('bilibatch_studio_defaults', JSON.stringify(next));
  }, []);

  const fetchChunkWithRetry = async (url: string): Promise<ArrayBuffer> => {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          let msg = `Không thể tải đoạn dữ liệu (HTTP ${res.status})`;
          try {
            const errData = await parseJsonSafe(res);
            if (errData?.error) msg = errData.error;
          } catch (e: any) {
            if (e?.message) msg = e.message;
          }
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(msg);
          }
          lastErr = new Error(msg);
        } else {
          return await res.arrayBuffer();
        }
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (lastErr.message.includes('HTTP 404') || lastErr.message.includes('hết hạn')) {
          throw lastErr;
        }
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw lastErr || new Error('Lỗi tải dữ liệu từ máy chủ');
  };

  const downloadBlobInChunks = async (
    baseUrl: string,
    totalSize: number,
    contentType: string,
    onChunk?: (chunk: ArrayBuffer) => Promise<void> | void
  ): Promise<Blob | null> => {
    const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB per request (well under 32 MiB proxy limit)
    if (totalSize <= CHUNK_SIZE) {
      const buf = await fetchChunkWithRetry(`${baseUrl}?offset=0&limit=${Math.max(1, totalSize)}`);
      if (onChunk) {
        await onChunk(buf);
        return null;
      }
      return new Blob([buf], { type: contentType || 'application/octet-stream' });
    }

    const parts: BlobPart[] = [];
    let offset = 0;
    while (offset < totalSize) {
      const limit = Math.min(CHUNK_SIZE, totalSize - offset);
      const buf = await fetchChunkWithRetry(`${baseUrl}?offset=${offset}&limit=${limit}`);
      if (buf.byteLength === 0) break;
      if (onChunk) {
        await onChunk(buf);
      } else {
        parts.push(buf);
      }
      offset += buf.byteLength;
    }

    return onChunk ? null : new Blob(parts, { type: contentType || 'application/octet-stream' });
  };

  const fetchJobFileInfo = async (jobId: string) => {
    const infoRes = await fetch(`/api/bilibili/jobs/${jobId}/file-info`);
    if (!infoRes.ok) {
      let msg = `Không thể kiểm tra tệp (HTTP ${infoRes.status})`;
      try {
        const errData = await parseJsonSafe(infoRes);
        if (errData?.error) msg = errData.error;
      } catch (e: any) {
        if (e?.message) msg = e.message;
      }
      throw new Error(msg);
    }
    return await parseJsonSafe<{ fileSize: number; fileName: string; contentType: string }>(infoRes);
  };

  const notifyServerJobSaved = (jobId?: string) => {
    if (!jobId) return;
    fetch(`/api/bilibili/jobs/${jobId}/ack-saved`, { method: 'POST' }).catch(() => {});
  };

  const cleanupServerJobs = (jobIds: string[]) => {
    const validIds = jobIds.filter(Boolean);
    if (validIds.length === 0) return;
    fetch('/api/bilibili/jobs/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds: validIds }),
    }).catch(() => {});
  };

  const triggerBrowserFileDownload = async (itemId: string, jobId: string, targetName: string) => {
    try {
      const info = await fetchJobFileInfo(jobId);
      const blob = await downloadBlobInChunks(
        `/api/bilibili/jobs/${jobId}/file`,
        info.fileSize,
        info.contentType
      );
      if (!blob) throw new Error('Không tạo được dữ liệu tải xuống');

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = targetName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

      notifyServerJobSaved(jobId);

      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId ? { ...it, savedToDisk: true, saveError: undefined } : it
        )
      );
    } catch (saveErr: any) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                savedToDisk: false,
                saveError: saveErr?.message || 'Lỗi tải tệp từ máy chủ',
              }
            : it
        )
      );
    }
  };

  // Track active downloads to enforce concurrency limit
  const activeCountRef = useRef(0);
  const itemsRef = useRef<QueueVideoItem[]>(items);
  itemsRef.current = items;

  const runJobForItem = useCallback(
    async (item: QueueVideoItem) => {
      activeCountRef.current += 1;
      try {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: 'downloading', progress: 0, error: undefined }
              : it
          )
        );

        let res: Response | null = null;
        const activeLogo = customLogoRef.current;
        const activeTransform = videoTransformRef.current;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          res = await fetch('/api/bilibili/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: item.platform || 'bilibili',
              sourceUrl: item.sourceUrl,
              bvid: item.bvid,
              cid: item.cid,
              title: item.title,
              partTitle: item.partTitle,
              qn: item.selectedQn,
              format: item.selectedFormat,
              watermark: item.selectedWatermark,
              sessdata,
              ytCookies,
              customLogo: activeLogo.enabled && activeLogo.dataUrl ? activeLogo : undefined,
              videoTransform: activeTransform,
            }),
          });
          if (res.status !== 429 || attempt === 3) break;
          await new Promise((r) => setTimeout(r, 2500 * attempt));
        }

        const data = await parseJsonSafe(res!);
        if (!res!.ok || !data.jobId) {
          throw new Error(data.error || 'Không thể khởi tạo tác vụ tải');
        }

        const jobId = data.jobId as string;

        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, jobId, fileName: data.fileName } : it
          )
        );

        // Poll until completed or error (with retry tolerance for transient network/429 hiccups)
        let consecutiveFailures = 0;
        while (true) {
          await new Promise((r) => setTimeout(r, 1200));
          let jobData: any;
          try {
            const jobRes = await fetch(`/api/bilibili/jobs/${jobId}`);
            if (!jobRes.ok) {
              if (jobRes.status === 404) {
                throw new Error(
                  'Tác vụ tải không còn tồn tại trên máy chủ (có thể máy chủ vừa khởi động lại). Vui lòng bấm Thử lại.'
                );
              }
              throw new Error(`HTTP ${jobRes.status}`);
            }
            jobData = await parseJsonSafe(jobRes);
            consecutiveFailures = 0;
          } catch (pollErr: any) {
            if (pollErr?.message?.includes('không còn tồn tại')) {
              throw pollErr;
            }
            consecutiveFailures += 1;
            const isRateLimit = String(pollErr?.message || '').includes('429');
            if (consecutiveFailures >= (isRateLimit ? 8 : 6)) {
              throw new Error(
                `Mất kết nối với tác vụ tải (${pollErr?.message || 'lỗi mạng'})`
              );
            }
            await new Promise((r) => setTimeout(r, isRateLimit ? 3000 : 1200));
            continue;
          }

          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: jobData.status,
                    progress: jobData.progress ?? it.progress,
                    speedBytesPerSec: jobData.speedBytesPerSec,
                    downloadedBytes: jobData.downloadedBytes,
                    totalBytes: jobData.totalBytes,
                    fileSize: jobData.fileSize,
                    fileName: jobData.fileName || it.fileName,
                    error: jobData.error,
                  }
                : it
            )
          );

          if (jobData.status === 'completed') {
            if (autoSaveRef.current) {
              const targetName = jobData.fileName || item.fileName || `${item.bvid}.${item.selectedFormat}`;
              const fileUrl = `/api/bilibili/jobs/${jobId}/file`;

              if (dirHandleRef.current) {
                try {
                  const info = await fetchJobFileInfo(jobId);
                  let targetDir = dirHandleRef.current;
                  const cleanSub = subfolderRef.current.replace(/[<>:"/\\|?*]/g, '_').trim();
                  if (cleanSub) {
                    targetDir = await dirHandleRef.current.getDirectoryHandle(cleanSub, {
                      create: true,
                    });
                  }
                  const fileHandle = await targetDir.getFileHandle(targetName, {
                    create: true,
                  });
                  const writable = await fileHandle.createWritable();
                  try {
                    await downloadBlobInChunks(
                      fileUrl,
                      info.fileSize,
                      info.contentType,
                      async (chunk) => {
                        await writable.write(chunk);
                      }
                    );
                    await writable.close();
                    notifyServerJobSaved(jobId);
                  } catch (writeErr) {
                    await writable.abort().catch(() => {});
                    throw writeErr;
                  }
                  setItems((prev) =>
                    prev.map((it) =>
                      it.id === item.id ? { ...it, savedToDisk: true, saveError: undefined } : it
                    )
                  );
                } catch (saveErr: any) {
                  setItems((prev) =>
                    prev.map((it) =>
                      it.id === item.id
                        ? {
                            ...it,
                            savedToDisk: false,
                            saveError: saveErr?.message || 'Lỗi ghi vào thư mục đã chọn',
                          }
                        : it
                    )
                  );
                }
              } else {
                await triggerBrowserFileDownload(item.id, jobId, targetName);
              }
            }
            break;
          }

          if (jobData.status === 'error') {
            break;
          }
        }
      } catch (err: any) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: 'error',
                  error: err?.message || 'Lỗi tải xuống',
                }
              : it
          )
        );
      } finally {
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      }
    },
    [sessdata, ytCookies, customLogo]
  );

  // Queue scheduler effect: dispatches queued items up to concurrency limit
  useEffect(() => {
    const queuedItems = items.filter((it) => it.status === 'queued');
    if (queuedItems.length === 0) return;

    const availableSlots = concurrency - activeCountRef.current;
    if (availableSlots <= 0) return;

    const toStart = queuedItems.slice(0, availableSlots);
    for (const item of toStart) {
      runJobForItem(item);
    }
  }, [items, concurrency, runJobForItem]);

  const handleInspect = async (urls: string[], expandPages: boolean) => {
    setIsInspecting(true);
    setInspectErrors([]);
    try {
      const res = await fetch('/api/bilibili/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, expandPages, sessdata, ytCookies }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setInspectErrors([{ url: urls[0], message: data.error || 'Lỗi phân tích liên kết' }]);
        return;
      }

      const newItems: QueueVideoItem[] = (data.items || []).map((raw: any) => ({
        ...raw,
        selectedQn: globalQn,
        selectedFormat: globalFormat,
        selectedWatermark: raw.platform === 'youtube' ? 'none' : globalWatermark,
        selected: true,
        status: 'idle',
        progress: 0,
      }));

      setItems((prev) => [...prev, ...newItems]);
      if (typeof data.suggestedFolder === 'string' && data.suggestedFolder.trim()) {
        handleChangeSubfolderName(data.suggestedFolder.trim());
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setInspectErrors(data.errors);
      }
    } catch (err: any) {
      setInspectErrors([
        { url: urls[0], message: err?.message || 'Không thể kết nối máy chủ' },
      ]);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleApplyToAll = () => {
    setItems((prev) =>
      prev.map((it) => {
        const isBusy =
          it.status === 'queued' ||
          it.status === 'downloading' ||
          it.status === 'processing';
        if (isBusy) return it;
        return {
          ...it,
          selectedQn: globalQn,
          selectedFormat: globalFormat,
          selectedWatermark: globalWatermark,
          status: it.status === 'completed' ? 'idle' : it.status,
          progress: it.status === 'completed' ? 0 : it.progress,
        };
      })
    );
  };

  const handleStartAll = () => {
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'idle' || it.status === 'error'
          ? { ...it, status: 'queued', progress: 0, error: undefined }
          : it
      )
    );
  };

  const handleStartSelected = () => {
    setItems((prev) =>
      prev.map((it) =>
        it.selected && (it.status === 'idle' || it.status === 'error')
          ? { ...it, status: 'queued', progress: 0, error: undefined }
          : it
      )
    );
  };

  const handleStartSingle = (id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, status: 'queued', progress: 0, error: undefined }
          : it
      )
    );
  };

  const handleRetryErrors = () => {
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'error'
          ? { ...it, status: 'queued', progress: 0, error: undefined }
          : it
      )
    );
  };

  const handleToggleSelectVisible = (visibleIds: string[], selected: boolean) => {
    const idSet = new Set(visibleIds);
    setItems((prev) =>
      prev.map((it) => (idSet.has(it.id) ? { ...it, selected } : it))
    );
  };

  const handleToggleSelect = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it))
    );
  };

  const handleUpdateItemConfig = (
    id: string,
    qn: number,
    format: OutputFormat,
    watermark: WatermarkMode
  ) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              selectedQn: qn,
              selectedFormat: format,
              selectedWatermark: watermark,
              status: it.status === 'completed' ? 'idle' : it.status,
              progress: it.status === 'completed' ? 0 : it.progress,
            }
          : it
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    const target = itemsRef.current.find((it) => it.id === id);
    if (target?.jobId && target.status !== 'downloading' && target.status !== 'processing') {
      cleanupServerJobs([target.jobId]);
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleRemoveSelected = () => {
    const removedJobIds = itemsRef.current
      .filter(
        (it) =>
          it.selected &&
          it.status !== 'downloading' &&
          it.status !== 'processing' &&
          Boolean(it.jobId)
      )
      .map((it) => it.jobId!);
    cleanupServerJobs(removedJobIds);
    setItems((prev) =>
      prev.filter(
        (it) =>
          !it.selected ||
          it.status === 'downloading' ||
          it.status === 'processing'
      )
    );
  };

  const handleClearAll = () => {
    const removedJobIds = itemsRef.current
      .filter(
        (it) =>
          it.status !== 'downloading' &&
          it.status !== 'processing' &&
          Boolean(it.jobId)
      )
      .map((it) => it.jobId!);
    cleanupServerJobs(removedJobIds);
    setItems((prev) =>
      prev.filter(
        (it) => it.status === 'downloading' || it.status === 'processing'
      )
    );
  };

  const handleSaveSingle = async (item: QueueVideoItem) => {
    if (!item.jobId) return;
    const targetName = item.fileName || `${item.bvid}.${item.selectedFormat}`;
    await triggerBrowserFileDownload(item.id, item.jobId, targetName);
  };

  const handleDownloadZip = async () => {
    const completedJobIds = items
      .filter((it) => it.status === 'completed' && it.jobId)
      .map((it) => it.jobId!);

    if (completedJobIds.length === 0) return;

    const prepRes = await fetch('/api/bilibili/batch-zip/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobIds: completedJobIds,
        folderName: subfolderName.trim() || 'BiliBatch_Downloads',
      }),
    });

    if (!prepRes.ok) return;
    const prepData = await parseJsonSafe<{ zipId: string; zipName: string; zipSize: number }>(prepRes);
    const blob = await downloadBlobInChunks(
      `/api/bilibili/batch-zip/${prepData.zipId}`,
      prepData.zipSize,
      'application/zip'
    );
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = prepData.zipName || `${(subfolderName.trim() || 'BiliBatch_Downloads').replace(/[<>:"/\\|?*]/g, '_')}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    fetch(`/api/bilibili/batch-zip/${prepData.zipId}/cleanup`, { method: 'POST' }).catch(() => {});
  };

  const queuedSourceUrls = useMemo(() => new Set(items.map((it) => it.sourceUrl)), [items]);

  const handleAddTrendingVideosToQueue = useCallback(
    (videos: TrendingVideoItem[], startImmediately: boolean) => {
      if (!videos || videos.length === 0) return;
      const defaultQualities = RESOLUTION_PRESETS.filter((q) => q.qn !== 0);

      setItems((prev) => {
        const next = [...prev];
        const byUrl = new Map(next.map((it, idx) => [it.sourceUrl, idx]));

        for (const v of videos) {
          const existingIdx = byUrl.get(v.sourceUrl);
          if (existingIdx !== undefined) {
            if (startImmediately) {
              const cur = next[existingIdx];
              if (cur.status === 'idle' || cur.status === 'error') {
                next[existingIdx] = { ...cur, status: 'queued', progress: 0, error: undefined };
              }
            }
            continue;
          }

          const cleanBvid =
            v.platform === 'bilibili' ? v.id.replace(/^bili_/, '') : v.id;

          const newItem: QueueVideoItem = {
            id: `${v.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            platform: v.platform,
            bvid: cleanBvid,
            aid: 0,
            cid: 0,
            page: 1,
            totalPages: 1,
            title: v.translatedTitle || v.title,
            partTitle: '',
            author: v.author,
            duration: v.duration || 0,
            views: v.views,
            pubdate: v.pubdate,
            pic: v.pic,
            sourceUrl: v.sourceUrl,
            availableQualities: defaultQualities,
            selectedQn: globalQn,
            selectedFormat: globalFormat,
            selectedWatermark: v.platform === 'youtube' ? 'none' : globalWatermark,
            selected: true,
            status: startImmediately ? 'queued' : 'idle',
            progress: 0,
          };
          next.push(newItem);
          byUrl.set(v.sourceUrl, next.length - 1);
        }

        return next;
      });
    },
    [globalQn, globalFormat, globalWatermark]
  );

  const [bookmarks, setBookmarks] = useState<TrendingVideoItem[]>(() => {
    try {
      const raw = localStorage.getItem('gaconpro_trending_bookmarks_v1');
      return raw ? (JSON.parse(raw) as TrendingVideoItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('gaconpro_trending_bookmarks_v1', JSON.stringify(bookmarks));
    } catch {
      // ignore
    }
  }, [bookmarks]);

  const bookmarkIds = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);

  const handleToggleBookmark = useCallback((video: TrendingVideoItem) => {
    setBookmarks((prev) => {
      if (prev.some((b) => b.id === video.id)) {
        return prev.filter((b) => b.id !== video.id);
      }
      return [video, ...prev];
    });
  }, []);

  const handleChangeTab = useCallback((tab: AppTab) => {
    setActiveTab(tab);
    if (tab === 'search') setMountedSearch(true);
    if (tab === 'trending') setMountedTrending(true);
  }, []);

  const handleSearchFromTopic = useCallback((topic: string) => {
    setMountedSearch(true);
    setActiveTab('search');
    setSearchQueryRequest({ query: topic, nonce: Date.now() });
  }, []);

  const handleOpenDerivativeStudio = useCallback((videos: TrendingVideoItem[], query = '') => {
    if (!videos || videos.length === 0) return;
    setDerivativeStudioState({ isOpen: true, videos, query });
  }, []);

  const isAnyDownloading = items.some(
    (it) =>
      it.status === 'queued' ||
      it.status === 'downloading' ||
      it.status === 'processing'
  );

  return (
    <div id="top" className="min-h-screen flex flex-col">
      <TopBar
        activeTab={activeTab}
        totalCount={items.length}
        isDownloading={isAnyDownloading}
        hasCookie={Boolean(sessdata.trim() || ytCookies.trim())}
        hasUpdate={Boolean(updateStatus?.supported && updateStatus?.hasUpdate)}
        onChangeTab={handleChangeTab}
        onStartAll={handleStartAll}
        onOpenCookieModal={() => setIsCookieModalOpen(true)}
        onOpenUpdateModal={handleOpenUpdateModal}
      />

      <main className="flex-1 w-full max-w-[1320px] mx-auto px-6 py-7 space-y-5">
        <div className={activeTab === 'batch' ? 'space-y-5' : 'hidden'}>
          <BatchInputPanel
            isInspecting={isInspecting}
            inspectErrors={inspectErrors}
            onInspect={handleInspect}
            onClearErrors={() => setInspectErrors([])}
          />

          <GlobalConfigBar
            globalQn={globalQn}
            globalFormat={globalFormat}
            globalWatermark={globalWatermark}
            concurrency={concurrency}
            autoSave={autoSave}
            folderName={folderName}
            subfolderName={subfolderName}
            folderNotice={folderNotice}
            darkMode={darkMode}
            hasItems={items.length > 0}
            customLogo={customLogo}
            videoTransform={videoTransform}
            onOpenLogoModal={() => setIsLogoModalOpen(true)}
            onToggleCustomLogo={handleToggleCustomLogo}
            onOpenTransformModal={() => setIsTransformModalOpen(true)}
            onResetTransform={handleResetTransform}
            onChangeGlobalQn={setGlobalQn}
            onChangeGlobalFormat={setGlobalFormat}
            onChangeGlobalWatermark={setGlobalWatermark}
            onChangeConcurrency={setConcurrency}
            onToggleAutoSave={handleToggleAutoSave}
            onChangeSubfolderName={handleChangeSubfolderName}
            onPickFolder={handlePickFolder}
            onClearFolder={handleClearFolder}
            onApplyToAll={handleApplyToAll}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
          />

          <QueueTable
            items={items}
            onToggleSelectVisible={handleToggleSelectVisible}
            onToggleSelect={handleToggleSelect}
            onUpdateItemConfig={handleUpdateItemConfig}
            onStartSingle={handleStartSingle}
            onRemoveItem={handleRemoveItem}
            onRemoveSelected={handleRemoveSelected}
            onStartSelected={handleStartSelected}
            onRetryErrors={handleRetryErrors}
            onClearAll={handleClearAll}
            onSaveSingle={handleSaveSingle}
            onDownloadZip={handleDownloadZip}
            customLogo={customLogo}
            videoTransform={videoTransform}
          />
        </div>

        {mountedSearch && (
          <div className={activeTab === 'search' ? 'block' : 'hidden'}>
            <SearchPanel
              sessdata={sessdata}
              ytCookies={ytCookies}
              externalQueryRequest={searchQueryRequest}
              queuedSourceUrls={queuedSourceUrls}
              bookmarkIds={bookmarkIds}
              onToggleBookmark={handleToggleBookmark}
              onAddVideosToQueue={handleAddTrendingVideosToQueue}
              onOpenCookieModal={() => setIsCookieModalOpen(true)}
              onOpenDerivativeStudio={handleOpenDerivativeStudio}
            />
          </div>
        )}

        {mountedTrending && (
          <div className={activeTab === 'trending' ? 'block' : 'hidden'}>
            <TrendingPanel
              sessdata={sessdata}
              ytCookies={ytCookies}
              queuedSourceUrls={queuedSourceUrls}
              bookmarks={bookmarks}
              bookmarkIds={bookmarkIds}
              onToggleBookmark={handleToggleBookmark}
              onAddVideosToQueue={handleAddTrendingVideosToQueue}
              onOpenCookieModal={() => setIsCookieModalOpen(true)}
              onSearchTopic={handleSearchFromTopic}
              onOpenDerivativeStudio={handleOpenDerivativeStudio}
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            perSiteCookies={perSiteCookies}
            studioDefaults={studioDefaults}
            onSaveSiteCookie={handleSaveSiteCookie}
            onSaveAllCookies={persistPerSiteCookies}
            onUpdateStudioDefaults={handleUpdateStudioDefaults}
          />
        )}
      </main>

      <footer className="border-t border-slate-200/80 dark:border-[#00464A]/80 py-5 px-6 text-xs text-slate-500 dark:text-teal-100/80">
        <div className="max-w-[1320px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>GaConPro V1.0 · Hỗ Trợ Phần Mềm : Zalo Đỗ Oanh 08.2626.8282</span>
          <span>Hỗ trợ MP4, MKV, WEBM, MP3, M4A · Xử lý ghép luồng bằng FFmpeg</span>
        </div>
      </footer>

      <SessdataModal
        isOpen={isCookieModalOpen}
        sessdata={sessdata}
        ytCookies={ytCookies}
        onSave={handleSaveCookies}
        onClose={() => setIsCookieModalOpen(false)}
      />

      <CustomLogoModal
        isOpen={isLogoModalOpen}
        config={customLogo}
        onSave={handleSaveCustomLogo}
        onClose={() => setIsLogoModalOpen(false)}
      />

      <VideoTransformModal
        isOpen={isTransformModalOpen}
        config={videoTransform}
        onSave={handleSaveVideoTransform}
        onClose={() => setIsTransformModalOpen(false)}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        status={updateStatus}
        isChecking={isCheckingUpdate}
        isUpdating={isApplyingUpdate}
        isRestarting={isServerRestarting}
        updateError={updateError}
        updateSuccessMsg={updateSuccessMsg}
        onCheckNow={checkSystemUpdate}
        onApplyUpdate={handleApplyUpdate}
        onClose={() => setIsUpdateModalOpen(false)}
      />

      <DerivativeStudioModal
        isOpen={derivativeStudioState.isOpen}
        initialVideos={derivativeStudioState.videos}
        searchQuery={derivativeStudioState.query}
        sessdata={sessdata}
        ytCookies={ytCookies}
        studioDefaults={studioDefaults}
        onClose={() => setDerivativeStudioState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
