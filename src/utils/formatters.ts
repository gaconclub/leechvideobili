export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function parseUrlsFromText(text: string): string[] {
  return text
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        (s.includes('bilibili.com') ||
          s.includes('b23.tv') ||
          s.includes('youtube.com') ||
          s.includes('youtu.be') ||
          /^(BV[1-9A-HJ-NP-Za-km-z]{10}|av\d+)$/i.test(s))
    );
}

export function formatViews(views?: number): string {
  if (views === undefined || views === null || views < 0) return '';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M lượt xem`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K lượt xem`;
  return `${views} lượt xem`;
}

export function formatPubdate(pubdate?: number): string {
  if (!pubdate || pubdate <= 0) return '';
  const d = new Date(pubdate * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
