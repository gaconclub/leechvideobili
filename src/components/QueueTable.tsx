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
} from 'lucide-react';
import {
  CustomLogoConfig,
  OUTPUT_FORMATS,
  OutputFormat,
  QueueVideoItem,
  RESOLUTION_PRESETS,
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
  customLogo?: CustomLogoConfig;
  videoTransform?: VideoTransformConfig;
}

const ThumbnailImage: React.FC<{ pic: string; title: string }> = ({ pic, title }) => {
  const [failed, setFailed] = useState(false);

  if (!pic || failed) {
    return (
      <div className="w-24 h-14 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
        <Film className="w-5 h-5 text-slate-400" />
      </div>
    );
  }

  return (
    <img
      src={`/api/bilibili/proxy-image?url=${encodeURIComponent(pic)}`}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-24 h-14 object-cover rounded-lg border border-slate-200/80 dark:border-slate-800 shrink-0 bg-slate-100 dark:bg-slate-800"
    />
  );
};

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
  customLogo,
  videoTransform,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'error'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'newest' | 'views'>('default');
  const [pageSize, setPageSize] = useState<50 | 100 | 150 | 200 | 'all'>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const selectedCount = items.filter((i) => i.selected).length;
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
      if (sortBy === 'newest') {
        return (b.pubdate || 0) - (a.pubdate || 0);
      }
      if (sortBy === 'views') {
        return (b.views || 0) - (a.views || 0);
      }
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
        className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-14 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="mx-auto w-12 h-12 rounded-xl bg-[#003B3E]/10 dark:bg-[#003B3E]/65 text-[#003B3E] dark:text-[#1BA8AD] flex items-center justify-center mb-4">
          <Film className="w-6 h-6" />
        </div>
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Chưa có video nào trong hàng đợi
        </h2>
        <p className="text-sm text-slate-500 dark:text-teal-100/80 max-w-md mx-auto mt-1.5">
          Dán các liên kết Bilibili hoặc YouTube vào ô phía trên và nhấn{' '}
          <span className="font-medium text-[#003B3E] dark:text-[#1BA8AD]">
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
      className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      {/* Queue Toolbar */}
      <div className="px-6 py-4 border-b border-slate-200/80 dark:border-[#00464A]/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-[#000A10] rounded-lg">
            {[
              { key: 'all', label: `Tất cả (${items.length})` },
              { key: 'pending', label: 'Đang chờ / Tải' },
              { key: 'completed', label: `Hoàn tất (${completedCount})` },
              { key: 'error', label: `Lỗi (${errorCount})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.key
                    ? 'bg-white dark:bg-[#001722] text-[#003B3E] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-teal-100/75 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort by publish date or view count */}
          <div className="flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-[#000A10] rounded-lg">
            {[
              { key: 'default', label: 'Mặc định' },
              { key: 'newest', label: 'Mới nhất' },
              { key: 'views', label: 'Xem nhiều nhất' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSortBy(opt.key as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  sortBy === opt.key
                    ? 'bg-white dark:bg-[#001722] text-[#003B3E] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-teal-100/75 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 dark:text-teal-100/80 font-mono tabular-nums">
            <span>{selectedCount} đã chọn</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span>
              {completedCount}/{items.length} hoàn tất
            </span>
          </div>

          {filteredItems.length > 50 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="queue-page-size"
                className="text-xs font-medium text-slate-500 dark:text-teal-100/80 whitespace-nowrap"
              >
                Hiển thị
              </label>
              <select
                id="queue-page-size"
                value={pageSize}
                onChange={(e) => {
                  const val = e.target.value;
                  setPageSize(val === 'all' ? 'all' : (Number(val) as 50 | 100 | 150 | 200));
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1.5 text-xs font-mono bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] cursor-pointer"
              >
                <option value={50}>50 / trang</option>
                <option value={100}>100 / trang</option>
                <option value={150}>150 / trang</option>
                <option value={200}>200 / trang</option>
                <option value="all">Tất cả</option>
              </select>
            </div>
          )}
        </div>

        {/* Bulk actions */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={onStartSelected}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải đã chọn ({selectedCount})</span>
              </button>
              <button
                type="button"
                onClick={onRemoveSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa đã chọn</span>
              </button>
            </>
          )}

          {errorCount > 0 && (
            <>
              <button
                type="button"
                onClick={onRetryErrors}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Thử lại lỗi ({errorCount})</span>
              </button>
              <button
                type="button"
                onClick={handleExportErrorList}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Xuất DS lỗi (.txt)</span>
              </button>
            </>
          )}

          {completedCount > 0 && (
            <button
              type="button"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Tải tất cả ZIP ({completedCount})</span>
            </button>
          )}

          {items.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Xóa danh sách video khỏi hàng đợi (ngoại trừ video đang tải)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Làm trống hàng đợi</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200/80 dark:border-[#00464A]/80 bg-[#F8FAFB] dark:bg-[#000A10] text-xs font-semibold text-slate-500 dark:text-teal-100/85">
              <th className="py-3 pl-6 pr-3 w-10">
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
                  className="w-4 h-4 rounded border-slate-300 dark:border-teal-700 accent-[#003B3E] cursor-pointer"
                />
              </th>
              <th className="py-3 px-3">Video</th>
              <th className="py-3 px-3 w-36">Độ phân giải</th>
              <th className="py-3 px-3 w-28">Định dạng</th>
              <th className="py-3 px-3 w-40">Xóa logo</th>
              <th className="py-3 px-3 w-44">Tiến trình</th>
              <th className="py-3 pl-3 pr-6 w-36 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70 dark:divide-[#00464A]/60 text-sm">
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

              return (
                <tr
                  key={item.id}
                  className="hover:bg-[#003B3E]/[0.04] dark:hover:bg-[#003B3E]/25 transition-colors"
                >
                  <td className="py-3.5 pl-6 pr-3 align-middle">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => onToggleSelect(item.id)}
                      aria-label={`Chọn ${item.title}`}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-[#003B3E] cursor-pointer"
                    />
                  </td>

                  {/* Video info */}
                  <td className="py-3.5 px-3 align-middle">
                    <div className="flex items-center gap-3.5 min-w-[280px]">
                      <ThumbnailImage pic={item.pic} title={item.title} />
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-900 dark:text-slate-100 hover:text-[#003B3E] dark:hover:text-[#1BA8AD] transition-colors line-clamp-1"
                          title={item.title}
                        >
                          {item.partTitle
                            ? `${item.title} — P${item.page}: ${item.partTitle}`
                            : item.title}
                        </a>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <span
                            className={`font-semibold ${
                              item.platform === 'youtube'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-[#003B3E] dark:text-[#1BA8AD]'
                            }`}
                          >
                            {({
                              bilibili: 'Bilibili',
                              youtube: 'YouTube',
                              tiktok: 'TikTok',
                              douyin: 'Douyin',
                              kuaishou: 'Kuaishou',
                              xiaohongshu: 'Xiaohongshu',
                              weibo: 'Weibo',
                              xigua: 'Xigua',
                              dailymotion: 'Dailymotion',
                              other: 'Video',
                            }[item.platform || 'bilibili'] || 'Bilibili')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{item.bvid}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-[140px]">{item.author}</span>
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

                  {/* Per-row Resolution */}
                  <td className="py-3.5 px-3 align-middle">
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
                      className="w-full h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                    >
                      {qualityOptions.map((q) => (
                        <option key={q.qn} value={q.qn}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Per-row Output Format */}
                  <td className="py-3.5 px-3 align-middle">
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
                      className="w-full h-8 px-2.5 text-xs font-mono font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                    >
                      {OUTPUT_FORMATS.map((fmt) => (
                        <option key={fmt.value} value={fmt.value}>
                          {fmt.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Per-row Watermark removal */}
                  <td className="py-3.5 px-3 align-middle">
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
                      className="w-full h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white disabled:opacity-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
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
                        <div
                          className="mt-1 text-[11px] text-[#003B3E] dark:text-[#1BA8AD] font-medium truncate"
                          title="Sẽ tự động chèn logo riêng của bạn vào video này"
                        >
                          + Chèn logo riêng
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
                          <div
                            className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate"
                            title={`Sẽ áp dụng: ${tParts.join(', ')}`}
                          >
                            + {tParts.join(' · ')}
                          </div>
                        );
                      })()}
                  </td>

                  {/* Status & Progress */}
                  <td className="py-3.5 px-3 align-middle">
                    {item.status === 'idle' && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Sẵn sàng tải
                      </span>
                    )}

                    {item.status === 'queued' && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Đang chờ lượt...
                      </span>
                    )}

                    {(item.status === 'downloading' || item.status === 'processing') && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                          <span className="text-slate-700 dark:text-slate-300 font-sans font-medium">
                            {item.status === 'processing' ? 'Đang ghép FFmpeg' : 'Đang tải'}
                          </span>
                          <span className="text-[#003B3E] dark:text-[#1BA8AD] font-semibold">
                            {item.progress}%
                            {item.speedBytesPerSec
                              ? ` · ${formatSpeed(item.speedBytesPerSec)}`
                              : ''}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#003B3E] dark:bg-[#1BA8AD] transition-all duration-200"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {item.status === 'completed' && (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{item.savedToDisk ? 'Đã lưu về máy' : 'Hoàn tất'}</span>
                          {item.fileSize && (
                            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              · {formatBytes(item.fileSize)}
                            </span>
                          )}
                        </div>
                        {item.saveError && (
                          <p
                            className="text-[11px] text-amber-600 dark:text-amber-400 truncate max-w-[180px]"
                            title={item.saveError}
                          >
                            {item.saveError}
                          </p>
                        )}
                      </div>
                    )}

                    {item.status === 'error' && (
                      <div
                        className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"
                        title={item.error}
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="truncate max-w-[160px]">
                          {item.error || 'Lỗi tải xuống'}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 pl-3 pr-6 align-middle text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {item.status === 'completed' && item.jobId ? (
                        <button
                          type="button"
                          onClick={() => onSaveSingle(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Lưu tệp</span>
                        </button>
                      ) : isBusy ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#003B3E] dark:text-[#1BA8AD]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onStartSingle(item.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-[#003B3E] hover:text-white dark:hover:bg-[#003B3E] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {item.status === 'error' ? (
                            <>
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Thử lại</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" />
                              <span>Tải về</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRemoveItem(item.id)}
                        aria-label="Xóa khỏi hàng đợi"
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination bar when more than 50 items or multiple pages */}
      {filteredItems.length > 50 && (
        <div className="px-6 py-3.5 border-t border-slate-200/80 dark:border-[#00464A]/80 flex flex-wrap items-center justify-between gap-4 bg-[#F8FAFB] dark:bg-[#000A10]">
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-teal-100/80">
            Hiển thị {startIdx + 1}–{Math.min(startIdx + effectivePageSize, filteredItems.length)}{' '}
            trên {filteredItems.length} video
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#000E16] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                Trước
              </button>

              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  className={`min-w-[32px] px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium rounded-lg transition-colors cursor-pointer ${
                    pageNum === safePage
                      ? 'bg-[#003B3E] text-white'
                      : 'bg-white dark:bg-[#001722] text-slate-700 dark:text-teal-100 border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#000E16]'
                  }`}
                >
                  {pageNum}
                </button>
              ))}

              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] hover:bg-slate-100 dark:hover:bg-[#000E16] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
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
