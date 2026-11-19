import React, { useState } from 'react';
import {
  Download,
  Trash2,
  RotateCcw,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  Film,
  Loader2,
  Save,
  Clapperboard,
} from 'lucide-react';
import {
  CustomLogoConfig,
  OUTPUT_FORMATS,
  OutputFormat,
  QueueVideoItem,
  RESOLUTION_PRESETS,
  TrendingVideoItem,
  VideoTransformConfig,
  WATERMARK_PRESETS,
  WatermarkMode,
} from '../types/bilibili';
import {
  formatBytes,
  formatDuration,
  formatPubdate,
  formatSpeed,
  formatViews,
} from '../utils/formatters';

interface QueueTableProps {
  items: QueueVideoItem[];
  onToggleSelectVisible: (visibleIds: string[], selected: boolean) => void;
  onToggleSelect: (id: string) => void;
  onUpdateItemConfig: (
    id: string,
    qn: number,
    format: OutputFormat,
    watermark: WatermarkMode
  ) => void;
  onStartSingle: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onRemoveSelected: () => void;
  onStartSelected: () => void;
  onRetryErrors: () => void;
  onClearAll: () => void;
  onSaveSingle: (item: QueueVideoItem) => void;
  onDownloadZip: () => void;
  onPushToStudio?: (videos: TrendingVideoItem[], query?: string) => void;
  customLogo?: CustomLogoConfig;
  videoTransform?: VideoTransformConfig;
}

const ThumbnailImage: React.FC<{ pic: string; title: string }> = ({ pic, title }) => {
  const [failed, setFailed] = useState(false);

  if (!pic || failed) {
    return (
      <div className="w-20 h-12 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
        <Film className="w-4 h-4 text-slate-400" />
      </div>
    );
  }

  return (
    <img
      src={`/api/bilibili/proxy-image?url=${encodeURIComponent(pic)}`}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-20 h-12 object-cover rounded-lg border border-slate-200/80 dark:border-slate-700/60 shrink-0 bg-slate-100 dark:bg-slate-800"
    />
  );
};

function queueItemToDiscoveryItem(item: QueueVideoItem): TrendingVideoItem {
  return {
    id: item.bvid || item.id,
    platform: item.platform || 'other',
    platformLabel: item.platform || 'Video',
    title: item.partTitle ? `${item.title} — P${item.page}: ${item.partTitle}` : item.title,
    author: item.author || 'Creator',
    pic: item.pic || '',
    sourceUrl: item.sourceUrl,
    duration: item.duration || 0,
    views: item.views || 0,
    pubdate: item.pubdate,
    score: 90,
    category: 'all',
    categoryLabel: 'Hàng đợi',
    orientation: 'unknown',
  };
}

export const QueueTable: React.FC<QueueTableProps> = ({
  items,
  onToggleSelectVisible,
  onToggleSelect,
  onUpdateItemConfig,
  onStartSingle,
  onRemoveItem,
  onRemoveSelected,
  onStartSelected,
  onRetryErrors,
  onClearAll,
  onSaveSingle,
  onDownloadZip,
  onPushToStudio,
  customLogo,
  videoTransform,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'error'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'newest' | 'views'>('default');
  const [pageSize, setPageSize] = useState<50 | 100 | 150 | 200 | 'all'>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const selectedItems = items.filter((i) => i.selected);
  const selectedCount = selectedItems.length;
  const pendingCount = items.filter(
    (i) =>
      i.status === 'idle' ||
      i.status === 'queued' ||
      i.status === 'downloading' ||
      i.status === 'processing'
  ).length;
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  const handleExportErrorList = () => {
    const errored = items.filter((i) => i.status === 'error');
    if (errored.length === 0) return;
    const lines = errored.map(
      (i) => `${i.sourceUrl}\t# ${i.title}${i.error ? ` (${i.error})` : ''}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gaconpro_video_loi_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const filteredItems = items
    .filter((item) => {
      if (filter === 'pending')
        return (
          item.status === 'idle' ||
          item.status === 'queued' ||
          item.status === 'downloading' ||
          item.status === 'processing'
        );
      if (filter === 'completed') return item.status === 'completed';
      if (filter === 'error') return item.status === 'error';
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return (b.pubdate || 0) - (a.pubdate || 0);
      if (sortBy === 'views') return (b.views || 0) - (a.views || 0);
      return 0;
    });

  const effectivePageSize = pageSize === 'all' ? Math.max(1, filteredItems.length) : pageSize;
  const totalPages =
    pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredItems.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * effectivePageSize;
  const paginatedItems =
    pageSize === 'all'
      ? filteredItems
      : filteredItems.slice(startIdx, startIdx + effectivePageSize);
  const allVisibleSelected =
    paginatedItems.length > 0 && paginatedItems.every((item) => item.selected);

  if (items.length === 0) {
    return (
      <section
        id="download-queue"
        className="glass-card rounded-2xl p-12 text-center space-y-3"
      >
        <div className="mx-auto w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-400/30 text-violet-600 dark:text-violet-300 flex items-center justify-center">
          <Film className="w-6 h-6" />
        </div>
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
          Chưa có video nào trong hàng đợi
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Dán các liên kết vào ô phía trên và nhấn{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-300">
            Phân tích &amp; Thêm vào hàng đợi
          </span>{' '}
          để bắt đầu tải xuống.
        </p>
      </section>
    );
  }

  return (
    <section
      id="download-queue"
      className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: 'all', label: `Tất cả (${items.length})` },
            { key: 'pending', label: `Đang chờ / tải (${pendingCount})` },
            { key: 'completed', label: `Hoàn tất (${completedCount})` },
            { key: 'error', label: `Lỗi / Cookie (${errorCount})` },
          ].map((tab) => {
            const active = filter === tab.key;
            const isErrTab = tab.key === 'error';
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  active
                    ? 'bg-violet-500/20 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200 border-violet-400/45'
                    : isErrTab && errorCount > 0
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25 hover:bg-rose-500/20'
                    : 'bg-slate-50 dark:bg-[#0c1021] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            );
          })}

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sắp xếp hàng đợi"
            className="rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="default">Sắp xếp: Mặc định</option>
            <option value="newest">Mới nhất</option>
            <option value="views">Xem nhiều nhất</option>
          </select>

          {filteredItems.length > 50 && (
            <select
              value={pageSize}
              onChange={(e) => {
                const val = e.target.value;
                setPageSize(val === 'all' ? 'all' : (Number(val) as 50 | 100 | 150 | 200));
                setCurrentPage(1);
              }}
              aria-label="Số mục mỗi trang"
              className="rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-2.5 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <option value={50}>50 / trang</option>
              <option value={100}>100 / trang</option>
              <option value={150}>150 / trang</option>
              <option value={200}>200 / trang</option>
              <option value="all">Tất cả</option>
            </select>
          )}
        </div>

        {/* Bulk Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={onStartSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải đã chọn ({selectedCount})</span>
              </button>

              {onPushToStudio && (
                <button
                  type="button"
                  onClick={() =>
                    onPushToStudio(
                      selectedItems.map(queueItemToDiscoveryItem),
                      ''
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-200 border border-cyan-500/35 transition whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Clapperboard className="w-3.5 h-3.5" />
                  <span>Đưa mục đã chọn sang Studio phái sinh</span>
                </button>
              )}

              <button
                type="button"
                onClick={onRemoveSelected}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/15 border border-rose-500/25 rounded-xl transition whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa chọn</span>
              </button>
            </>
          )}

          {errorCount > 0 && (
            <>
              <button
                type="button"
                onClick={onRetryErrors}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-200 border border-amber-400/30 font-semibold transition whitespace-nowrap cursor-pointer tabular-nums"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Thử lại lỗi ({errorCount})</span>
              </button>
              <button
                type="button"
                onClick={handleExportErrorList}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 font-medium transition whitespace-nowrap cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>DS lỗi (.txt)</span>
              </button>
            </>
          )}

          {completedCount > 0 && (
            <button
              type="button"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 transition whitespace-nowrap cursor-pointer tabular-nums"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>ZIP ({completedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClearAll}
            title="Xóa danh sách video khỏi hàng đợi (trừ video đang tải)"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 border border-slate-200 dark:border-slate-400/20 hover:bg-rose-500/10 transition whitespace-nowrap cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Làm trống</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50/70 dark:bg-[#0c1021]/80">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-400/15 bg-slate-100/80 dark:bg-[#131a35]/80 text-[11px] font-semibold text-slate-500 dark:text-slate-300">
              <th className="py-2.5 pl-4 pr-2 w-9">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() =>
                    onToggleSelectVisible(
                      paginatedItems.map((it) => it.id),
                      !allVisibleSelected
                    )
                  }
                  aria-label="Chọn tất cả video đang hiển thị"
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                />
              </th>
              <th className="py-2.5 px-2.5">Video</th>
              <th className="py-2.5 px-2 w-32">Độ phân giải</th>
              <th className="py-2.5 px-2 w-24">Định dạng</th>
              <th className="py-2.5 px-2 w-36">Xóa logo</th>
              <th className="py-2.5 px-2 w-40">Tiến trình</th>
              <th className="py-2.5 pl-2 pr-4 w-44 text-right">Thao tác</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200/80 dark:divide-slate-400/15 text-xs">
            {paginatedItems.map((item) => {
              const isBusy =
                item.status === 'queued' ||
                item.status === 'downloading' ||
                item.status === 'processing';

              const qualityOptions = [
                RESOLUTION_PRESETS[0],
                ...(Array.isArray(item.availableQualities) && item.availableQualities.length > 0
                  ? item.availableQualities
                  : RESOLUTION_PRESETS.slice(1)),
              ];

              const platformName =
                {
                  bilibili: 'Bilibili',
                  youtube: 'YouTube',
                  tiktok: 'TikTok',
                  douyin: 'Douyin',
                  kuaishou: 'Kuaishou',
                  xiaohongshu: 'Xiaohongshu',
                  weibo: 'Weibo',
                  xigua: 'Xigua',
                  dailymotion: 'Dailymotion',
                  facebook: 'Facebook',
                  other: 'Video',
                }[item.platform || 'bilibili'] || 'Bilibili';

              return (
                <tr
                  key={item.id}
                  className="hover:bg-white/60 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <td className="py-3 pl-4 pr-2 align-middle">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => onToggleSelect(item.id)}
                      aria-label={`Chọn ${item.title}`}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                    />
                  </td>

                  {/* Video Info */}
                  <td className="py-3 px-2.5 align-middle">
                    <div className="flex items-center gap-3 min-w-[230px]">
                      <ThumbnailImage pic={item.pic} title={item.title} />
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-slate-900 dark:text-white hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors line-clamp-1"
                          title={item.title}
                        >
                          {item.partTitle
                            ? `${item.title} — P${item.page}: ${item.partTitle}`
                            : item.title}
                        </a>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          <span className="font-semibold text-violet-600 dark:text-violet-300">
                            {platformName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{item.bvid}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatDuration(item.duration)}
                          </span>
                          {item.views !== undefined && item.views > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatViews(item.views)}
                              </span>
                            </>
                          )}
                          {item.pubdate !== undefined && item.pubdate > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatPubdate(item.pubdate)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Resolution */}
                  <td className="py-3 px-2 align-middle">
                    <select
                      disabled={isBusy}
                      value={item.selectedQn}
                      onChange={(e) =>
                        onUpdateItemConfig(
                          item.id,
                          Number(e.target.value),
                          item.selectedFormat,
                          item.selectedWatermark
                        )
                      }
                      className="w-full h-8 px-2 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none cursor-pointer"
                    >
                      {qualityOptions.map((q) => (
                        <option key={q.qn} value={q.qn}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Format */}
                  <td className="py-3 px-2 align-middle">
                    <select
                      disabled={isBusy}
                      value={item.selectedFormat}
                      onChange={(e) =>
                        onUpdateItemConfig(
                          item.id,
                          item.selectedQn,
                          e.target.value as OutputFormat,
                          item.selectedWatermark
                        )
                      }
                      className="w-full h-8 px-2 text-xs font-mono font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none cursor-pointer"
                    >
                      {OUTPUT_FORMATS.map((fmt) => (
                        <option key={fmt.value} value={fmt.value}>
                          {fmt.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Watermark */}
                  <td className="py-3 px-2 align-middle">
                    <select
                      disabled={
                        isBusy ||
                        item.selectedFormat === 'mp3' ||
                        item.selectedFormat === 'm4a'
                      }
                      value={item.selectedWatermark}
                      onChange={(e) =>
                        onUpdateItemConfig(
                          item.id,
                          item.selectedQn,
                          item.selectedFormat,
                          e.target.value as WatermarkMode
                        )
                      }
                      className="w-full h-8 px-2 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none cursor-pointer"
                    >
                      {WATERMARK_PRESETS.map((wm) => (
                        <option key={wm.value} value={wm.value}>
                          {wm.label}
                        </option>
                      ))}
                    </select>
                    {customLogo?.enabled &&
                      customLogo.dataUrl &&
                      item.selectedFormat !== 'mp3' &&
                      item.selectedFormat !== 'm4a' && (
                        <div className="mt-1 text-[10px] text-cyan-700 dark:text-cyan-300 font-medium truncate">
                          + Logo riêng
                        </div>
                      )}
                    {videoTransform &&
                      (() => {
                        const isAudio =
                          item.selectedFormat === 'mp3' || item.selectedFormat === 'm4a';
                        const tParts: string[] = [];
                        if (Math.abs(videoTransform.speed - 1) > 0.01)
                          tParts.push(`${videoTransform.speed}x`);
                        if (!isAudio && videoTransform.mirror === 'horizontal')
                          tParts.push('Lật ngang');
                        else if (!isAudio && videoTransform.mirror === 'vertical')
                          tParts.push('Lật dọc');
                        if (!isAudio && videoTransform.zoomPercent !== 100)
                          tParts.push(`Zoom ${videoTransform.zoomPercent}%`);
                        if (tParts.length === 0) return null;
                        return (
                          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            + {tParts.join(' · ')}
                          </div>
                        );
                      })()}
                  </td>

                  {/* Status & Progress */}
                  <td className="py-3 px-2 align-middle">
                    {item.status === 'idle' && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-200/70 dark:bg-white/5 text-slate-600 dark:text-slate-300 text-[11px]">
                        Sẵn sàng
                      </span>
                    )}

                    {item.status === 'queued' && (
                      <span className="px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[11px]">
                        Đang chờ...
                      </span>
                    )}

                    {(item.status === 'downloading' || item.status === 'processing') && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                          <span className="text-cyan-700 dark:text-cyan-300 font-sans font-semibold">
                            {item.status === 'processing' ? 'FFmpeg' : 'Đang tải'}
                          </span>
                          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">
                            {item.progress}%
                            {item.speedBytesPerSec ? ` · ${formatSpeed(item.speedBytesPerSec)}` : ''}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {item.status === 'completed' && (
                      <div className="space-y-0.5">
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{item.savedToDisk ? 'Đã lưu' : 'Hoàn tất'}</span>
                        </div>
                        {item.fileSize && (
                          <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {formatBytes(item.fileSize)}
                          </div>
                        )}
                        {item.saveError && (
                          <p
                            className="text-[10px] text-amber-600 dark:text-amber-300 truncate max-w-[140px]"
                            title={item.saveError}
                          >
                            {item.saveError}
                          </p>
                        )}
                      </div>
                    )}

                    {item.status === 'error' && (
                      <div
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[11px] font-semibold max-w-[155px]"
                        title={item.error}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.error || 'Lỗi tải'}</span>
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 pl-2 pr-4 align-middle text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {item.status === 'completed' && item.jobId ? (
                        <button
                          type="button"
                          onClick={() => onSaveSingle(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 rounded-lg transition whitespace-nowrap cursor-pointer"
                        >
                          <Save className="w-3 h-3" />
                          <span>Lưu</span>
                        </button>
                      ) : isBusy ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-cyan-600 dark:text-cyan-300">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onStartSingle(item.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100 bg-slate-200/70 dark:bg-white/10 hover:bg-emerald-500 hover:text-slate-950 rounded-lg transition whitespace-nowrap cursor-pointer"
                        >
                          {item.status === 'error' ? (
                            <>
                              <RotateCcw className="w-3 h-3" />
                              <span>Thử lại</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3 h-3" />
                              <span>Tải</span>
                            </>
                          )}
                        </button>
                      )}

                      {onPushToStudio && (
                        <button
                          type="button"
                          onClick={() =>
                            onPushToStudio([queueItemToDiscoveryItem(item)], '')
                          }
                          title="Đưa video này sang Studio phái sinh"
                          className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-violet-500/20 border border-slate-200 dark:border-white/10 text-cyan-700 dark:text-cyan-300 text-[11px] font-semibold transition whitespace-nowrap cursor-pointer"
                        >
                          + Studio
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRemoveItem(item.id)}
                        aria-label="Xóa khỏi hàng đợi"
                        className="p-1 text-slate-400 hover:text-rose-500 disabled:opacity-30 rounded-lg transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filteredItems.length > 50 && (
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Hiển thị {startIdx + 1}–{Math.min(startIdx + effectivePageSize, filteredItems.length)}{' '}
            trên {filteredItems.length} video
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Trước
              </button>

              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  className={`min-w-[30px] px-2 py-1 font-mono tabular-nums rounded-lg cursor-pointer ${
                    pageNum === safePage
                      ? 'bg-violet-600 text-white font-bold'
                      : 'bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {pageNum}
                </button>
              ))}

              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Sau
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
