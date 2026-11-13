import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver') as {
  ZipArchive: new (options?: { zlib?: { level?: number } }) => import('archiver').Archiver;
};

const PORT = 3000;
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'bili-downloads');
const RAW_CACHE_DIR = path.join(DOWNLOAD_DIR, 'raw_cache');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(RAW_CACHE_DIR)) {
  fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let cachedBuvidCookie = '';
let cachedBuvidExpiresAt = 0;

async function getBuvidCookie(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedBuvidCookie && Date.now() < cachedBuvidExpiresAt) {
    return cachedBuvidCookie;
  }
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://www.bilibili.com/',
      },
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      if (json.code === 0 && json.data?.b_3) {
        const b3 = json.data.b_3;
        const b4 = json.data.b_4 || '';
        const bNut = Math.floor(Date.now() / 1000);
        cachedBuvidCookie = `buvid3=${b3}; buvid4=${b4}; b_nut=${bNut}`;
        cachedBuvidExpiresAt = Date.now() + 30 * 60 * 1000;
        return cachedBuvidCookie;
      }
    }
  } catch {
    // ignore spi fetch error and fall back
  }
  return cachedBuvidCookie;
}

async function getBiliHeaders(
  sessdata?: string,
  forceRefreshCookies = false
): Promise<Record<string, string>> {
  const buvid = await getBuvidCookie(forceRefreshCookies);
  const cookies: string[] = [];
  if (buvid) cookies.push(buvid);
  if (sessdata && sessdata.trim()) {
    cookies.push(`SESSDATA=${sessdata.trim()}`);
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    Accept: 'application/json, text/plain, */*',
  };
  if (cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ');
  }
  return headers;
}

async function fetchBiliJson(url: string, sessdata?: string): Promise<any> {
  let headers = await getBiliHeaders(sessdata, false);
  let res = await fetch(url, { headers });

  if (res.status === 412) {
    headers = await getBiliHeaders(sessdata, true);
    res = await fetch(url, { headers });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bilibili từ chối yêu cầu (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Phản hồi từ Bilibili không hợp lệ');
  }
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

let cachedWbiKeys: { imgKey: string; subKey: string; expiresAt: number } | null = null;

async function getWbiKeys(sessdata?: string): Promise<{ imgKey: string; subKey: string }> {
  if (cachedWbiKeys && Date.now() < cachedWbiKeys.expiresAt) {
    return { imgKey: cachedWbiKeys.imgKey, subKey: cachedWbiKeys.subKey };
  }
  const navJson = await fetchBiliJson('https://api.bilibili.com/x/web-interface/nav', sessdata);
  const imgUrl: string = navJson?.data?.wbi_img?.img_url || '';
  const subUrl: string = navJson?.data?.wbi_img?.sub_url || '';
  const imgKey = imgUrl.split('/').pop()?.split('.')[0] || '';
  const subKey = subUrl.split('/').pop()?.split('.')[0] || '';
  if (!imgKey || !subKey) {
    throw new Error('Không thể lấy khóa WBI từ Bilibili');
  }
  cachedWbiKeys = { imgKey, subKey, expiresAt: Date.now() + 30 * 60 * 1000 };
  return { imgKey, subKey };
}

function encWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string
): string {
  const orig = imgKey + subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((n) => orig[n] || '').join('').slice(0, 32);
  const currTime = Math.round(Date.now() / 1000);
  const chrFilter = /[!'()*]/g;
  const allParams: Record<string, string | number> = { ...params, wts: currTime };
  const query = Object.keys(allParams)
    .sort()
    .map((key) => {
      const val = String(allParams[key]).replace(chrFilter, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

function extractSpaceMid(urlStr: string): string | null {
  const match = urlStr.match(/space\.bilibili\.com\/(?:[a-z]{2,5}\/)?(\d+)/i);
  return match ? match[1] : null;
}

function parseLengthToSeconds(lengthStr: string): number {
  if (!lengthStr) return 0;
  const parts = lengthStr.split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

const QN_LABELS: Record<number, string> = {
  127: '8K (4320P)',
  126: 'Dolby Vision',
  125: 'HDR',
  120: '4K (2160P)',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  64: '720P',
  32: '480P',
  16: '360P',
};

interface JobState {
  jobId: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  progress: number;
  speedBytesPerSec: number;
  downloadedBytes: number;
  totalBytes: number;
  fileSize?: number;
  fileName: string;
  filePath?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, JobState>();

interface PreparedZipState {
  zipId: string;
  zipPath: string;
  zipName: string;
  zipSize: number;
  createdAt: number;
}
const preparedZips = new Map<string, PreparedZipState>();

// Periodically clean up old jobs & prepared zips (> 1 hour) and raw source caches (> 2 hours)
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const rawCacheCutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      if (job.filePath && fs.existsSync(job.filePath)) {
        fs.unlink(job.filePath, () => {});
      }
      jobs.delete(id);
    }
  }
  for (const [zipId, zip] of preparedZips.entries()) {
    if (zip.createdAt < cutoff) {
      if (fs.existsSync(zip.zipPath)) {
        fs.unlink(zip.zipPath, () => {});
      }
      preparedZips.delete(zipId);
    }
  }
  try {
    if (fs.existsSync(RAW_CACHE_DIR)) {
      for (const entry of fs.readdirSync(RAW_CACHE_DIR)) {
        const dirPath = path.join(RAW_CACHE_DIR, entry);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.isDirectory() && stat.mtimeMs < rawCacheCutoff) {
            fs.rm(dirPath, { recursive: true, force: true }, () => {});
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}, 10 * 60 * 1000);

interface RawCacheMeta {
  ready: boolean;
  updatedAt: number;
  files: Record<string, string>;
  width?: number;
  height?: number;
}

function getRawCacheDir(cacheKey: string): string {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return path.join(RAW_CACHE_DIR, safeKey);
}

function readValidRawCache(cacheKey: string): { cacheDir: string; meta: RawCacheMeta } | null {
  try {
    const cacheDir = getRawCacheDir(cacheKey);
    const metaPath = path.join(cacheDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as RawCacheMeta;
    if (!meta?.ready || !meta.files || typeof meta.files !== 'object') return null;
    const entries = Object.values(meta.files);
    if (entries.length === 0) return null;
    for (const filePath of entries) {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const st = fs.statSync(filePath);
      if (st.size <= 0) return null;
    }
    const now = new Date();
    fs.utimesSync(cacheDir, now, now);
    return { cacheDir, meta };
  } catch {
    return null;
  }
}

function writeRawCacheMeta(
  cacheKey: string,
  meta: Omit<RawCacheMeta, 'ready' | 'updatedAt'>
): void {
  const cacheDir = getRawCacheDir(cacheKey);
  fs.mkdirSync(cacheDir, { recursive: true });
  const payload: RawCacheMeta = {
    ...meta,
    ready: true,
    updatedAt: Date.now(),
  };
  const tmpMeta = path.join(cacheDir, `meta_${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmpMeta, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmpMeta, path.join(cacheDir, 'meta.json'));
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

async function resolveShortUrl(rawUrl: string): Promise<string> {
  if (!rawUrl.includes('b23.tv')) return rawUrl;
  try {
    const res = await fetch(rawUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    });
    return res.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

function extractBiliIdentifier(urlStr: string): { bvid?: string; aid?: number; page?: number } {
  const bvMatch = urlStr.match(/BV[1-9A-HJ-NP-Za-km-z]{10}/);
  const avMatch = urlStr.match(/av(\d+)/i);
  let page: number | undefined;
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://www.bilibili.com/video/${urlStr}`);
    const pParam = u.searchParams.get('p');
    if (pParam && /^\d+$/.test(pParam)) {
      page = parseInt(pParam, 10);
    }
  } catch {
    // ignore URL parse error for bare IDs
  }
  return {
    bvid: bvMatch ? bvMatch[0] : undefined,
    aid: avMatch ? parseInt(avMatch[1], 10) : undefined,
    page,
  };
}

function getCandidateUrls(streamObj: any): string[] {
  if (!streamObj) return [];
  const raw: string[] = [];
  const primary = streamObj.baseUrl || streamObj.base_url || streamObj.url;
  if (primary) raw.push(primary);
  const backups = streamObj.backupUrl || streamObj.backup_url || [];
  if (Array.isArray(backups)) {
    for (const b of backups) {
      if (typeof b === 'string' && b) raw.push(b);
    }
  }
  const unique = Array.from(new Set(raw));
  // Prioritize international Akamai mirrors over mainland COS/OSS mirrors that return HTTP 567
  return unique.sort((a, b) => {
    const aAkam = a.includes('akamaized') || a.includes('mirrorakam') ? 0 : 1;
    const bAkam = b.includes('akamaized') || b.includes('mirrorakam') ? 0 : 1;
    return aAkam - bAkam;
  });
}

async function downloadSingleStreamWithRetry(
  candidates: string[],
  destPath: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number, speed: number) => void
): Promise<void> {
  let lastError: Error | null = null;

  for (let round = 0; round < Math.max(2, candidates.length * 2); round++) {
    const url = candidates[round % candidates.length];
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(new Error('Mất phản hồi từ máy chủ tải video')), 30_000);
    };

    try {
      resetStallTimer();
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        lastError = new Error(`HTTP ${res.status} khi tải luồng dữ liệu`);
        if (res.body) await res.body.cancel().catch(() => {});
        if (stallTimer) clearTimeout(stallTimer);
        continue;
      }

      const total = Number(res.headers.get('content-length') || 0);
      let downloaded = 0;
      const startTime = Date.now();
      const reader = res.body.getReader();
      const writer = fs.createWriteStream(destPath);

      try {
        while (true) {
          resetStallTimer();
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            const canContinue = writer.write(value);
            if (!canContinue) {
              await new Promise<void>((resolve) => writer.once('drain', resolve));
            }
            const elapsedSec = Math.max((Date.now() - startTime) / 1000, 0.1);
            onProgress(downloaded, total, Math.round(downloaded / elapsedSec));
          }
        }
        if (total > 0 && downloaded < total) {
          throw new Error(`Tải thiếu dữ liệu (${downloaded}/${total} bytes)`);
        }
        return;
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
        writer.end();
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }
    } catch (err: any) {
      if (stallTimer) clearTimeout(stallTimer);
      lastError = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, Math.min(2500, 500 * (round + 1))));
    }
  }

  throw lastError || new Error('Không thể tải luồng dữ liệu video');
}

async function downloadFileWithProgress(
  urls: string | string[],
  destPath: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number, speed: number) => void
): Promise<void> {
  const candidates = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('Không có đường dẫn tải dữ liệu hợp lệ');
  }

  // Probe whether CDN supports byte-range requests so long videos can download via 4 parallel connections
  let totalSize = 0;
  let supportsRange = false;
  let workingCandidates = [...candidates];

  for (const url of candidates) {
    try {
      const probe = await fetch(url, {
        headers: { ...headers, Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (probe.body) {
        await probe.body.cancel().catch(() => {});
      }
      if (probe.status === 206) {
        const cr = probe.headers.get('content-range') || '';
        const m = cr.match(/bytes\s+\d+-\d+\/(\d+)/i);
        if (m) {
          const parsedTotal = Number(m[1]);
          if (Number.isFinite(parsedTotal) && parsedTotal > 0) {
            totalSize = parsedTotal;
            supportsRange = true;
            // Prioritize working mirror first
            workingCandidates = [url, ...candidates.filter((c) => c !== url)];
            break;
          }
        }
      } else if (probe.ok) {
        const cl = Number(probe.headers.get('content-length') || 0);
        if (cl > 0) totalSize = cl;
        break;
      }
    } catch {
      // try next mirror
    }
  }

  const MIN_PARALLEL_SIZE = 4 * 1024 * 1024; // 4 MiB
  if (!supportsRange || totalSize < MIN_PARALLEL_SIZE) {
    return downloadSingleStreamWithRetry(workingCandidates, destPath, headers, onProgress);
  }

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB chunks
  const CONCURRENT_WORKERS = 4;
  const chunks: { index: number; start: number; end: number }[] = [];
  for (let start = 0, index = 0; start < totalSize; start += CHUNK_SIZE, index++) {
    chunks.push({
      index,
      start,
      end: Math.min(totalSize - 1, start + CHUNK_SIZE - 1),
    });
  }

  const chunkReceived = new Array<number>(chunks.length).fill(0);
  let totalDownloaded = 0;
  let nextChunkCursor = 0;
  const startTime = Date.now();
  let lastProgressEmit = 0;

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressEmit < 150) return;
    lastProgressEmit = now;
    const elapsedSec = Math.max((now - startTime) / 1000, 0.1);
    onProgress(totalDownloaded, totalSize, Math.round(totalDownloaded / elapsedSec));
  };

  const fh = await fs.promises.open(destPath, 'w');
  try {
    await fh.truncate(totalSize);

    const downloadOneChunk = async (chunk: { index: number; start: number; end: number }) => {
      const expectedTotal = chunk.end - chunk.start + 1;
      let lastErr: Error | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        if (chunkReceived[chunk.index] >= expectedTotal) return;
        const resumeStart = chunk.start + chunkReceived[chunk.index];
        const mirrorUrl = workingCandidates[(chunk.index + attempt) % workingCandidates.length];
        const controller = new AbortController();
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const resetStall = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(
            () => controller.abort(new Error(`Đoạn #${chunk.index + 1} bị treo kết nối`)),
            25_000
          );
        };

        try {
          resetStall();
          const res = await fetch(mirrorUrl, {
            headers: {
              ...headers,
              Range: `bytes=${resumeStart}-${chunk.end}`,
            },
            signal: controller.signal,
          });

          if (res.status !== 206 || !res.body) {
            if (res.body) await res.body.cancel().catch(() => {});
            throw new Error(`HTTP ${res.status} khi tải đoạn #${chunk.index + 1}`);
          }

          const reader = res.body.getReader();
          let writeOffset = resumeStart;

          while (true) {
            resetStall();
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              const remainingAllowed = chunk.end - writeOffset + 1;
              if (remainingAllowed <= 0) break;
              const sliceLen = Math.min(value.byteLength, remainingAllowed);
              await fh.write(value, 0, sliceLen, writeOffset);
              writeOffset += sliceLen;
              chunkReceived[chunk.index] += sliceLen;
              totalDownloaded += sliceLen;
              emitProgress(false);
            }
          }

          if (stallTimer) clearTimeout(stallTimer);
          if (chunkReceived[chunk.index] >= expectedTotal) {
            return;
          }
          lastErr = new Error(`Đoạn #${chunk.index + 1} chưa đủ dữ liệu`);
        } catch (err: any) {
          if (stallTimer) clearTimeout(stallTimer);
          lastErr = err instanceof Error ? err : new Error(String(err));
          await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
        }
      }

      throw lastErr || new Error(`Không thể tải đoạn #${chunk.index + 1}`);
    };

    const workerCount = Math.min(CONCURRENT_WORKERS, chunks.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextChunkCursor < chunks.length) {
          const idx = nextChunkCursor++;
          await downloadOneChunk(chunks[idx]);
        }
      })
    );

    emitProgress(true);
  } finally {
    await fh.close();
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg lỗi (code ${code}): ${stderr.slice(-500).trim()}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

type HwH264Encoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv';

const CPU_ENCODE_THREADS = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 3) || 2));

function getHwH264CodecArgs(encoder: HwH264Encoder): string[] {
  if (encoder === 'h264_amf') {
    return [
      '-c:v',
      'h264_amf',
      '-usage',
      'transcoding',
      '-quality',
      'balanced',
      '-rc',
      'cqp',
      '-qp_i',
      '19',
      '-qp_p',
      '21',
    ];
  }
  if (encoder === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0'];
  }
  // h264_qsv
  return ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '20'];
}

let detectedHwEncoderPromise: Promise<HwH264Encoder | null> | null = null;

function detectAvailableHwH264Encoder(): Promise<HwH264Encoder | null> {
  if (detectedHwEncoderPromise) return detectedHwEncoderPromise;

  detectedHwEncoderPromise = (async () => {
    const candidates: HwH264Encoder[] = ['h264_nvenc', 'h264_amf', 'h264_qsv'];
    for (const enc of candidates) {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'color=c=black:s=256x256:d=0.1',
            '-frames:v',
            '1',
            '-pix_fmt',
            'yuv420p',
            ...getHwH264CodecArgs(enc),
            '-f',
            'null',
            '-',
          ],
          { stdio: ['ignore', 'ignore', 'ignore'] }
        );
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(false);
        }, 6000);
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
        proc.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      if (ok) {
        console.log(`[FFmpeg] Hardware acceleration enabled: ${enc} (CPU fallback threads=${CPU_ENCODE_THREADS})`);
        return enc;
      }
    }
    console.log(`[FFmpeg] No GPU encoder detected, using libx264 CPU (threads=${CPU_ENCODE_THREADS})`);
    return null;
  })();

  return detectedHwEncoderPromise;
}

async function runH264EncodeWithFallback(
  prefixArgs: string[],
  suffixArgs: string[],
  finalPath: string
): Promise<void> {
  const hwEncoder = await detectAvailableHwH264Encoder();
  if (hwEncoder) {
    try {
      await runFfmpeg([...prefixArgs, ...getHwH264CodecArgs(hwEncoder), ...suffixArgs, finalPath]);
      return;
    } catch (hwErr: any) {
      console.warn(
        `[FFmpeg] ${hwEncoder} failed (${hwErr?.message || 'unknown'}), falling back to libx264 CPU`
      );
      if (fs.existsSync(finalPath)) {
        try {
          fs.unlinkSync(finalPath);
        } catch {
          // ignore
        }
      }
    }
  }

  await runFfmpeg([
    ...prefixArgs,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-threads',
    String(CPU_ENCODE_THREADS),
    '-pix_fmt',
    'yuv420p',
    ...suffixArgs,
    finalPath,
  ]);
}

type WatermarkMode = 'auto' | 'none' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

function probeVideoDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const [w, h] = out.trim().split('x').map(Number);
        if (w > 0 && h > 0) return resolve({ width: w, height: h });
      }
      resolve(null);
    });
    proc.on('error', () => resolve(null));
  });
}

function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', (code) => {
      resolve(code === 0 && out.trim().length > 0);
    });
    proc.on('error', () => resolve(false));
  });
}

function probeStreamCodecs(filePath: string): Promise<{ vcodec: string; acodec: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', () => {
      let vcodec = '';
      let acodec = '';
      for (const line of out.split(/\r?\n/)) {
        const [codecName, codecType] = line.trim().split(',');
        // ffprobe csv order matches -show_entries? Actually codec_name,codec_type or codec_type,codec_name depending on version; check both
        if (codecName === 'video' && codecType && !vcodec) vcodec = codecType;
        else if (codecName === 'audio' && codecType && !acodec) acodec = codecType;
        else if (codecType === 'video' && codecName && !vcodec) vcodec = codecName;
        else if (codecType === 'audio' && codecName && !acodec) acodec = codecName;
      }
      resolve({ vcodec, acodec });
    });
    proc.on('error', () => resolve({ vcodec: '', acodec: '' }));
  });
}

let ytDlpPathPromise: Promise<string> | null = null;

async function ensureYtDlpPath(): Promise<string> {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binDir = path.join(os.tmpdir(), 'bili-bin');
  const localBin = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  const legacyLinuxBin = '/tmp/bin/yt-dlp';

  if (fs.existsSync(localBin)) {
    return localBin;
  }
  if (!isWin && fs.existsSync(legacyLinuxBin)) {
    return legacyLinuxBin;
  }

  if (!ytDlpPathPromise) {
    ytDlpPathPromise = (async () => {
      // Try system yt-dlp first
      const systemFound = await new Promise<boolean>((resolve) => {
        const p = spawn('yt-dlp', ['--version'], { shell: isWin });
        p.on('close', (code) => resolve(code === 0));
        p.on('error', () => resolve(false));
      });
      if (systemFound) return 'yt-dlp';

      fs.mkdirSync(binDir, { recursive: true });
      const assetName = isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp_linux';
      const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`);
      if (!res.ok || !res.body) {
        throw new Error(`Không thể tải công cụ yt-dlp (HTTP ${res.status})`);
      }
      const tmpPart = `${localBin}.tmp`;
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(tmpPart, buf);
      if (!isWin) {
        fs.chmodSync(tmpPart, 0o755);
      }
      fs.renameSync(tmpPart, localBin);
      return localBin;
    })().catch((err) => {
      ytDlpPathPromise = null;
      throw err;
    });
  }
  return ytDlpPathPromise;
}

function writeYtCookiesFile(prefix: string, rawCookies?: string): string | null {
  const trimmed = (rawCookies || '').trim();
  if (!trimmed) return null;

  let content = '';
  if (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t')) {
    content = trimmed.startsWith('#') ? trimmed : `# Netscape HTTP Cookie File\n${trimmed}`;
  } else {
    // Convert browser Cookie header string (k=v; k2=v2) to Netscape cookies.txt
    const lines = ['# Netscape HTTP Cookie File'];
    for (const part of trimmed.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!name) continue;
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
      lines.push(`.google.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
    if (lines.length === 1) return null;
    content = lines.join('\n');
  }

  const cookiePath = path.join(DOWNLOAD_DIR, `${prefix}_yt_cookies.txt`);
  fs.writeFileSync(cookiePath, content + '\n', 'utf8');
  return cookiePath;
}

function isYouTubeUrl(urlStr: string): boolean {
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(urlStr);
}

function extractYouTubeVideoId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shortsMatch = u.pathname.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // ignore
  }
  return null;
}

function parseYtdlpSizeToBytes(numStr: string, unit: string): number {
  const n = parseFloat(numStr);
  if (!Number.isFinite(n)) return 0;
  const u = unit.toLowerCase();
  if (u.startsWith('k')) return Math.round(n * 1024);
  if (u.startsWith('m')) return Math.round(n * 1024 * 1024);
  if (u.startsWith('g')) return Math.round(n * 1024 * 1024 * 1024);
  return Math.round(n);
}

function runYtDlpJson(ytDlpBin: string, args: string[], timeoutMs = 45_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Hết thời gian chờ phản hồi từ YouTube'));
    }, timeoutMs);

    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout));
          return;
        } catch {
          // fall through
        }
      }
      const errMsg = stderr.trim() || `yt-dlp thất bại (code ${code})`;
      reject(new Error(errMsg));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseUploadDateToUnix(uploadDate?: string): number {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return 0;
  const y = parseInt(uploadDate.slice(0, 4), 10);
  const m = parseInt(uploadDate.slice(4, 6), 10) - 1;
  const d = parseInt(uploadDate.slice(6, 8), 10);
  return Math.floor(Date.UTC(y, m, d) / 1000);
}

async function inspectYouTubeUrl(rawUrl: string, ytCookies?: string): Promise<any[]> {
  const ytDlpBin = await ensureYtDlpPath();
  const tempCookiePath = writeYtCookiesFile(`inspect_${crypto.randomBytes(4).toString('hex')}`, ytCookies);
  const cookieArgs = tempCookiePath ? ['--cookies', tempCookiePath] : [];

  const defaultYtQualities = [
    { qn: 120, label: '4K (2160P)' },
    { qn: 116, label: '1080P60' },
    { qn: 80, label: '1080P' },
    { qn: 64, label: '720P' },
    { qn: 32, label: '480P' },
    { qn: 16, label: '360P' },
  ];

  try {
    const normalizedUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const videoId = extractYouTubeVideoId(normalizedUrl);
    const isPlaylistOrChannel =
      !videoId ||
      /youtube\.com\/(?:playlist\b|@|channel\/|c\/|user\/)/i.test(normalizedUrl);

    if (isPlaylistOrChannel) {
      const json = await runYtDlpJson(
        ytDlpBin,
        ['--flat-playlist', '--playlist-end', '150', '-J', '--no-warnings', ...cookieArgs, normalizedUrl],
        60_000
      );
      const entries: any[] = Array.isArray(json?.entries) ? json.entries : [];
      const fallbackAuthor = json?.uploader || json?.channel || json?.title || 'YouTube';
      const results: any[] = [];

      for (const entry of entries) {
        if (!entry || !entry.id) continue;
        if (entry.title === '[Private video]' || entry.title === '[Deleted video]') continue;
        const vid = String(entry.id);
        const thumbs: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
        const pic =
          thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

        results.push({
          id: `yt_${vid}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: vid,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: entry.title || vid,
          partTitle: '',
          author: entry.uploader || entry.channel || fallbackAuthor,
          duration: Math.round(Number(entry.duration || 0)),
          views: Number(entry.view_count || 0),
          pubdate: parseUploadDateToUnix(entry.upload_date),
          pic,
          sourceUrl:
            typeof entry.url === 'string' && entry.url.startsWith('http')
              ? entry.url
              : `https://www.youtube.com/watch?v=${vid}`,
          availableQualities: defaultYtQualities,
        });
      }

      if (results.length === 0) {
        throw new Error('Không tìm thấy video công khai nào trong danh sách phát hoặc kênh YouTube này.');
      }
      return results;
    }

    // Single video: try yt-dlp -J first, fallback to oEmbed if datacenter IP is challenged without cookies
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const info = await runYtDlpJson(
        ytDlpBin,
        ['--no-playlist', '--js-runtimes', 'node', '-J', '--no-warnings', ...cookieArgs, normalizedUrl],
        25_000
      );
      const formats: any[] = Array.isArray(info?.formats) ? info.formats : [];
      const maxHeights = new Set<number>();
      let hasHighFps1080 = false;
      for (const f of formats) {
        if (f?.vcodec && f.vcodec !== 'none' && Number(f.height) > 0) {
          const h = Number(f.height);
          maxHeights.add(h);
          if (h >= 1080 && Number(f.fps) > 45) hasHighFps1080 = true;
        }
      }
      const qualities: { qn: number; label: string }[] = [];
      if ([...maxHeights].some((h) => h >= 2160)) qualities.push({ qn: 120, label: '4K (2160P)' });
      if (hasHighFps1080) qualities.push({ qn: 116, label: '1080P60' });
      if ([...maxHeights].some((h) => h >= 1080)) qualities.push({ qn: 80, label: '1080P' });
      if ([...maxHeights].some((h) => h >= 720)) qualities.push({ qn: 64, label: '720P' });
      if ([...maxHeights].some((h) => h >= 480)) qualities.push({ qn: 32, label: '480P' });
      if ([...maxHeights].some((h) => h >= 360)) qualities.push({ qn: 16, label: '360P' });

      return [
        {
          id: `yt_${videoId}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: videoId,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: info.title || videoId,
          partTitle: '',
          author: info.uploader || info.channel || 'YouTube',
          duration: Math.round(Number(info.duration || 0)),
          views: Number(info.view_count || 0),
          pubdate: parseUploadDateToUnix(info.upload_date),
          pic: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          sourceUrl: normalizedUrl,
          availableQualities: qualities.length > 0 ? qualities : defaultYtQualities,
        },
      ];
    } catch {
      // Fallback to YouTube oEmbed API (works even without cookies)
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
        { headers: { 'User-Agent': USER_AGENT } }
      );
      if (!oembedRes.ok) {
        throw new Error('Không thể lấy thông tin video YouTube (hãy kiểm tra liên kết hoặc thêm YouTube Cookies).');
      }
      const oembed = (await oembedRes.json()) as any;
      return [
        {
          id: `yt_${videoId}_${crypto.randomBytes(3).toString('hex')}`,
          platform: 'youtube',
          bvid: videoId,
          aid: 0,
          cid: 0,
          page: 1,
          totalPages: 1,
          title: oembed.title || videoId,
          partTitle: '',
          author: oembed.author_name || 'YouTube',
          duration: 0,
          views: 0,
          pubdate: 0,
          pic: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          sourceUrl: normalizedUrl,
          availableQualities: defaultYtQualities,
        },
      ];
    }
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      fs.unlink(tempCookiePath, () => {});
    }
  }
}

function buildAtempoFilter(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0 + 1e-4) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-4) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${Number(remaining.toFixed(4))}`);
  return filters.join(',');
}

function buildDelogoFilter(
  mode: WatermarkMode | undefined,
  width: number,
  height: number
): string | null {
  if (!mode || mode === 'none' || width < 64 || height < 64) return null;

  const boxW = Math.max(32, Math.round(width * 0.30));
  const boxH = Math.max(20, Math.round(height * 0.12));
  const marginX = Math.max(4, Math.round(width * 0.02));
  const marginY = Math.max(4, Math.round(height * 0.02));

  let x = marginX;
  let y = marginY;

  if (mode === 'top-right') {
    x = Math.max(2, width - boxW - marginX);
    y = marginY;
  } else if (mode === 'top-left') {
    x = marginX;
    y = marginY;
  } else if (mode === 'bottom-right') {
    x = Math.max(2, width - boxW - marginX);
    y = Math.max(2, height - boxH - marginY);
  } else if (mode === 'bottom-left') {
    x = marginX;
    y = Math.max(2, height - boxH - marginY);
  }

  const clampedW = Math.min(boxW, width - x - 2);
  const clampedH = Math.min(boxH, height - y - 2);
  if (clampedW <= 4 || clampedH <= 4) return null;

  return `delogo=x=${x}:y=${y}:w=${clampedW}:h=${clampedH}`;
}

function sampleGrayFrames(filePath: string, sampleW: number, sampleH: number): Promise<Buffer[]> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i',
      filePath,
      '-vf',
      `fps=0.4,scale=${sampleW}:${sampleH},format=gray`,
      '-vframes',
      '6',
      '-f',
      'rawvideo',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('close', () => {
      const full = Buffer.concat(chunks);
      const frameSize = sampleW * sampleH;
      const frames: Buffer[] = [];
      for (let offset = 0; offset + frameSize <= full.length; offset += frameSize) {
        frames.push(full.subarray(offset, offset + frameSize));
      }
      resolve(frames);
    });
    proc.on('error', () => resolve([]));
  });
}

async function detectWatermarkDelogoFilter(
  filePath: string,
  width: number,
  height: number
): Promise<string | null> {
  if (width < 64 || height < 64) return null;
  const SW = 640;
  const SH = 360;
  const frames = await sampleGrayFrames(filePath, SW, SH);
  if (frames.length < 3) return null;

  // Check that the center of the video has actual motion (avoid false positives on still-image videos)
  let centerDiffSum = 0;
  let centerCount = 0;
  for (let y = 100; y < 260; y += 4) {
    for (let x = 180; x < 460; x += 4) {
      const idx = y * SW + x;
      for (let t = 1; t < frames.length; t++) {
        centerDiffSum += Math.abs(frames[t][idx] - frames[t - 1][idx]);
        centerCount++;
      }
    }
  }
  const avgCenterMotion = centerCount > 0 ? centerDiffSum / centerCount : 0;
  if (avgCenterMotion < 2.2) {
    return null;
  }

  const cornerW = Math.round(SW * 0.38);
  const cornerH = Math.round(SH * 0.18);
  const corners = [
    { x0: 2, y0: 2, x1: cornerW, y1: cornerH }, // top-left
    { x0: SW - cornerW, y0: 2, x1: SW - 2, y1: cornerH }, // top-right
    { x0: 2, y0: SH - cornerH, x1: cornerW, y1: SH - 2 }, // bottom-left
    { x0: SW - cornerW, y0: SH - cornerH, x1: SW - 2, y1: SH - 2 }, // bottom-right
  ];

  const filters: string[] = [];

  for (const c of corners) {
    const rowHits = new Int32Array(SH);
    const grid = new Uint8Array(SW * SH);
    let strongHits = 0;
    const regionArea = (c.x1 - c.x0) * (c.y1 - c.y0);

    for (let y = c.y0; y < c.y1; y++) {
      for (let x = c.x0; x < c.x1; x++) {
        const idx = y * SW + x;
        let diffSum = 0;
        let edgeSum = 0;
        for (let t = 0; t < frames.length; t++) {
          if (t > 0) {
            diffSum += Math.abs(frames[t][idx] - frames[t - 1][idx]);
          }
          const gx = Math.abs(frames[t][idx + 1] - frames[t][idx]);
          const gy = Math.abs(frames[t][idx + SW] - frames[t][idx]);
          edgeSum += (gx + gy) * 0.5;
        }
        const avgDiff = diffSum / (frames.length - 1);
        const avgEdge = edgeSum / frames.length;

        if (avgEdge >= 13 && avgDiff <= 9) {
          strongHits++;
        }
        if (avgEdge >= 9.5 && avgDiff <= 10) {
          grid[idx] = 1;
          rowHits[y]++;
        }
      }
    }

    if (strongHits >= 35 && strongHits <= regionArea * 0.45) {
      let peakY = -1;
      let maxR = 0;
      for (let y = c.y0; y < c.y1; y++) {
        if (rowHits[y] > maxR) {
          maxR = rowHits[y];
          peakY = y;
        }
      }
      if (peakY < 0 || maxR < 3) continue;

      let minY = peakY;
      let gap = 0;
      for (let y = peakY - 1; y >= c.y0; y--) {
        if (rowHits[y] >= 3) {
          minY = y;
          gap = 0;
        } else if (++gap > 4) {
          break;
        }
      }

      let maxY = peakY;
      gap = 0;
      for (let y = peakY + 1; y < c.y1; y++) {
        if (rowHits[y] >= 3) {
          maxY = y;
          gap = 0;
        } else if (++gap > 4) {
          break;
        }
      }

      const bandColHits = new Int32Array(SW);
      for (let x = c.x0; x < c.x1; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (grid[y * SW + x]) bandColHits[x]++;
        }
      }

      let minX = -1;
      let maxX = -1;
      for (let x = c.x0; x < c.x1; x++) {
        if (bandColHits[x] >= 1) {
          // Verify at least 1 other hit within +/- 10px to ignore isolated noise
          let nearby = 0;
          for (let nx = Math.max(c.x0, x - 10); nx <= Math.min(c.x1 - 1, x + 10); nx++) {
            if (nx !== x && bandColHits[nx] >= 1) {
              nearby++;
              break;
            }
          }
          if (nearby > 0) {
            if (minX < 0) minX = x;
            maxX = x;
          }
        }
      }
      if (minX < 0 || maxX <= minX) continue;

      if (maxX > minX && maxY > minY) {
        const padX = 8;
        const padY = 6;
        const sx0 = Math.max(1, minX - padX);
        const sy0 = Math.max(1, minY - padY);
        const sx1 = Math.min(SW - 1, maxX + padX);
        const sy1 = Math.min(SH - 1, maxY + padY);

        const fx = Math.max(2, Math.round((sx0 / SW) * width));
        const fy = Math.max(2, Math.round((sy0 / SH) * height));
        const fw = Math.min(
          Math.round(width * 0.36),
          width - fx - 2,
          Math.max(20, Math.round(((sx1 - sx0) / SW) * width))
        );
        const fh = Math.min(
          Math.round(height * 0.14),
          height - fy - 2,
          Math.max(16, Math.round(((sy1 - sy0) / SH) * height))
        );

        if (fw > 4 && fh > 4) {
          filters.push(`delogo=x=${fx}:y=${fy}:w=${fw}:h=${fh}`);
        }
      }
    }
  }

  return filters.length > 0 ? filters.join(',') : null;
}

interface CustomLogoParam {
  enabled?: boolean;
  dataUrl?: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
  scalePercent?: number;
  opacity?: number;
  margin?: number;
}

interface VideoTransformParam {
  speed?: number;
  mirror?: 'none' | 'horizontal' | 'vertical';
  zoomPercent?: number;
}

function normalizeVideoTransform(raw?: VideoTransformParam) {
  const speedRaw = typeof raw?.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : 1;
  const speed = Math.min(2.0, Math.max(0.5, Number(speedRaw.toFixed(2))));
  const mirror: 'none' | 'horizontal' | 'vertical' =
    raw?.mirror === 'horizontal' || raw?.mirror === 'vertical' ? raw.mirror : 'none';
  const zoomRaw =
    typeof raw?.zoomPercent === 'number' && Number.isFinite(raw.zoomPercent) ? raw.zoomPercent : 100;
  const zoomPercent = Math.min(150, Math.max(50, Math.round(zoomRaw)));

  return {
    speed,
    mirror,
    zoomPercent,
    hasSpeed: Math.abs(speed - 1) > 0.005,
    hasMirror: mirror !== 'none',
    hasZoom: Math.abs(zoomPercent - 100) >= 1,
  };
}

async function renderVideoWithFfmpeg(opts: {
  videoPath: string;
  separateAudioPath?: string;
  hasAudioStream: boolean;
  format: 'mp4' | 'mkv' | 'webm';
  finalPath: string;
  delogoFilter: string | null;
  dims: { width: number; height: number } | null;
  customLogoFile: string | null;
  customLogo?: CustomLogoParam;
  transform: ReturnType<typeof normalizeVideoTransform>;
  forceMp4Transcode?: boolean;
}) {
  const {
    videoPath,
    separateAudioPath,
    hasAudioStream,
    format,
    finalPath,
    delogoFilter,
    dims,
    customLogoFile,
    customLogo,
    transform,
    forceMp4Transcode,
  } = opts;

  const inputs: string[] = ['-i', videoPath];
  let audioInputIdx = 0;
  if (separateAudioPath && hasAudioStream) {
    audioInputIdx = 1;
    inputs.push('-i', separateAudioPath);
  }

  let logoInputIdx: number | null = null;
  if (customLogoFile && dims) {
    logoInputIdx = inputs.length / 2;
    inputs.push('-i', customLogoFile);
  }

  // Build video filter steps in exact order: reset PTS -> delogo -> mirror -> zoom (preserving WxH) -> even dims -> speed
  const vSteps: string[] = ['setpts=PTS-STARTPTS'];
  if (delogoFilter) {
    vSteps.push(delogoFilter);
  }
  if (transform.mirror === 'horizontal') {
    vSteps.push('hflip');
  } else if (transform.mirror === 'vertical') {
    vSteps.push('vflip');
  }
  if (transform.hasZoom && dims) {
    const frameW = Math.max(2, Math.floor(dims.width / 2) * 2);
    const frameH = Math.max(2, Math.floor(dims.height / 2) * 2);
    const z = transform.zoomPercent / 100;
    const sw = Math.max(2, Math.floor((frameW * z) / 2) * 2);
    const sh = Math.max(2, Math.floor((frameH * z) / 2) * 2);

    if (sw < frameW || sh < frameH) {
      vSteps.push(`scale=${sw}:${sh},pad=${frameW}:${frameH}:(ow-iw)/2:(oh-ih)/2:black`);
    } else if (sw > frameW || sh > frameH) {
      vSteps.push(`scale=${sw}:${sh},crop=${frameW}:${frameH}:(iw-ow)/2:(ih-oh)/2`);
    }
  } else {
    // Guarantee even dimensions for libx264 / yuv420p compatibility on non-standard resolutions
    vSteps.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  if (transform.hasSpeed) {
    vSteps.push(`setpts=PTS/${transform.speed}`);
  }

  const hasCustomFilterOps =
    Boolean(delogoFilter) ||
    transform.hasMirror ||
    transform.hasZoom ||
    transform.hasSpeed ||
    logoInputIdx !== null;

  if (!hasCustomFilterOps) {
    // No video filters and speed == 1.0
    if (format === 'mp4') {
      if (forceMp4Transcode) {
        await runH264EncodeWithFallback(
          [...inputs, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'],
          [
            ...(hasAudioStream ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
            '-max_muxing_queue_size',
            '4096',
            '-movflags',
            '+faststart',
          ],
          finalPath
        );
      } else {
        await runFfmpeg([
          ...inputs,
          '-c',
          'copy',
          '-max_muxing_queue_size',
          '4096',
          '-movflags',
          '+faststart',
          finalPath,
        ]);
      }
      return;
    }
    if (format === 'mkv') {
      await runFfmpeg([...inputs, '-c', 'copy', '-max_muxing_queue_size', '4096', finalPath]);
      return;
    }
    // webm still needs transcode from H264/HEVC/AAC
    await runFfmpeg([
      ...inputs,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '30',
      '-b:v',
      '0',
      '-deadline',
      'realtime',
      '-cpu-used',
      '4',
      '-threads',
      '0',
      ...(hasAudioStream ? ['-c:a', 'libopus'] : ['-an']),
      '-max_muxing_queue_size',
      '4096',
      finalPath,
    ]);
    return;
  }

  // Construct filter_complex for video (and audio when speed changes)
  const filterParts: string[] = [];
  if (logoInputIdx !== null && dims) {
    const targetLogoWidth = Math.max(
      24,
      Math.floor((dims.width * ((customLogo?.scalePercent || 15) / 100)) / 2) * 2
    );
    const margin = customLogo?.margin || 24;
    let overlayPos = `W-w-${margin}:H-h-${margin}`;
    if (customLogo?.position === 'top-right') overlayPos = `W-w-${margin}:${margin}`;
    else if (customLogo?.position === 'top-left') overlayPos = `${margin}:${margin}`;
    else if (customLogo?.position === 'bottom-left') overlayPos = `${margin}:H-h-${margin}`;
    else if (customLogo?.position === 'center') overlayPos = `(W-w)/2:(H-h)/2`;

    const logoOpacity = typeof customLogo?.opacity === 'number' ? customLogo.opacity : 0.85;
    filterParts.push(
      `[${logoInputIdx}:v]scale=${targetLogoWidth}:-2,format=rgba,colorchannelmixer=aa=${logoOpacity}[wm]`
    );

    filterParts.push(`[0:v]${vSteps.join(',')}[vbase]`);
    filterParts.push(`[vbase][wm]overlay=${overlayPos}:eof_action=repeat,format=yuv420p[vout]`);
  } else {
    filterParts.push(`[0:v]${vSteps.join(',')},format=yuv420p[vout]`);
  }

  const audioMapAndCodecArgs: string[] = [];
  if (hasAudioStream) {
    if (transform.hasSpeed) {
      filterParts.push(
        `[${audioInputIdx}:a]asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}[aout]`
      );
      audioMapAndCodecArgs.push('-map', '[aout]');
      if (format === 'webm') {
        audioMapAndCodecArgs.push('-c:a', 'libopus');
      } else {
        audioMapAndCodecArgs.push('-c:a', 'aac', '-b:a', '192k');
      }
    } else {
      audioMapAndCodecArgs.push('-map', `${audioInputIdx}:a`);
      if (format === 'webm') {
        audioMapAndCodecArgs.push('-c:a', 'libopus');
      } else {
        audioMapAndCodecArgs.push('-c:a', 'copy');
      }
    }
  }

  const filterComplex = filterParts.join(';');

  if (format === 'mp4' || format === 'mkv') {
    await runH264EncodeWithFallback(
      [...inputs, '-filter_complex', filterComplex, '-map', '[vout]', ...audioMapAndCodecArgs],
      [
        '-max_muxing_queue_size',
        '4096',
        ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
      ],
      finalPath
    );
  } else {
    await runFfmpeg([
      ...inputs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      ...audioMapAndCodecArgs,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '30',
      '-b:v',
      '0',
      '-deadline',
      'realtime',
      '-cpu-used',
      '4',
      '-threads',
      '0',
      '-max_muxing_queue_size',
      '4096',
      finalPath,
    ]);
  }
}

async function processDownloadJob(
  jobId: string,
  params: {
    bvid: string;
    cid: number;
    title: string;
    partTitle?: string;
    qn: number;
    format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
    watermark?: WatermarkMode;
    sessdata?: string;
    customLogo?: CustomLogoParam;
    videoTransform?: VideoTransformParam;
  }
) {
  const job = jobs.get(jobId);
  if (!job) return;

  const tempFiles: string[] = [];
  const headers = await getBiliHeaders(params.sessdata);
  const transform = normalizeVideoTransform(params.videoTransform);
  let hasCachedRawSource = false;

  try {
    job.status = 'downloading';
    job.progress = 2;

    const targetQn = params.qn > 0 ? params.qn : 120;
    const isAudioOnly = params.format === 'mp3' || params.format === 'm4a';

    let customLogoFile: string | null = null;
    if (!isAudioOnly && params.customLogo?.enabled && params.customLogo.dataUrl) {
      try {
        const commaIdx = params.customLogo.dataUrl.indexOf(',');
        const rawBase64 = commaIdx >= 0 ? params.customLogo.dataUrl.slice(commaIdx + 1) : params.customLogo.dataUrl;
        const logoBuffer = Buffer.from(rawBase64, 'base64');
        if (logoBuffer.length > 0) {
          customLogoFile = path.join(DOWNLOAD_DIR, `${jobId}_custom_logo.png`);
          await fs.promises.writeFile(customLogoFile, logoBuffer);
          tempFiles.push(customLogoFile);
        }
      } catch (logoErr) {
        console.error('Failed to write custom logo:', logoErr);
      }
    }

    let resolvedCid = params.cid;
    if (!resolvedCid || resolvedCid <= 0) {
      const viewJson = await fetchBiliJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(params.bvid)}`,
        params.sessdata
      );
      if (viewJson.code !== 0 || !viewJson.data?.cid) {
        throw new Error(viewJson.message || 'Không thể lấy thông tin CID của video');
      }
      resolvedCid = viewJson.data.cid;
    }

    const finalPath = path.join(DOWNLOAD_DIR, `${jobId}.${params.format}`);
    const avCacheKey = `bili_${params.bvid}_cid${resolvedCid}_qn${targetQn}_${isAudioOnly ? 'audio' : 'av'}`;
    const durlCacheKey = `bili_${params.bvid}_cid${resolvedCid}_qn${targetQn}_durl`;

    // Check if completed raw source streams are already cached on disk (skip download on retry!)
    const cachedAv = readValidRawCache(avCacheKey);
    const cachedDurl = !cachedAv ? readValidRawCache(durlCacheKey) : null;

    if (cachedAv && isAudioOnly && cachedAv.meta.files.audio) {
      const audioPath = cachedAv.meta.files.audio;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes = fs.statSync(audioPath).size;
      job.downloadedBytes = job.totalBytes;

      const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
      if (params.format === 'mp3') {
        await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
      } else if (transform.hasSpeed) {
        await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
      } else {
        await runFfmpeg(['-i', audioPath, '-vn', '-c:a', 'copy', finalPath]);
      }
    } else if (cachedAv && !isAudioOnly && cachedAv.meta.files.video) {
      const videoPath = cachedAv.meta.files.video;
      const audioPath = cachedAv.meta.files.audio;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes =
        fs.statSync(videoPath).size + (audioPath && fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0);
      job.downloadedBytes = job.totalBytes;

      let delogoFilter: string | null = null;
      const needsDims =
        (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

      let dims: { width: number; height: number } | null = null;
      if (needsDims) {
        dims = await probeVideoDimensions(videoPath);
        if (!dims && cachedAv.meta.width && cachedAv.meta.height) {
          dims = { width: cachedAv.meta.width, height: cachedAv.meta.height };
        }
        if (!dims && (customLogoFile || transform.hasZoom)) {
          dims = { width: 1920, height: 1080 };
        }
      }

      if (dims && params.watermark && params.watermark !== 'none') {
        if (params.watermark === 'auto') {
          delogoFilter = await detectWatermarkDelogoFilter(videoPath, dims.width, dims.height);
        } else {
          delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
        }
      }

      await renderVideoWithFfmpeg({
        videoPath,
        separateAudioPath: audioPath && fs.existsSync(audioPath) ? audioPath : undefined,
        hasAudioStream: Boolean(audioPath && fs.existsSync(audioPath)),
        format: params.format as 'mp4' | 'mkv' | 'webm',
        finalPath,
        delogoFilter,
        dims,
        customLogoFile,
        customLogo: params.customLogo,
        transform,
      });
    } else if (cachedDurl && cachedDurl.meta.files.raw) {
      const rawPath = cachedDurl.meta.files.raw;
      hasCachedRawSource = true;
      job.status = 'processing';
      job.progress = 85;
      job.totalBytes = fs.statSync(rawPath).size;
      job.downloadedBytes = job.totalBytes;

      const hasAudioStream = await probeHasAudio(rawPath);
      if (isAudioOnly) {
        if (!hasAudioStream) throw new Error('Video này không có luồng âm thanh');
        const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
        if (params.format === 'mp3') {
          await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
        } else if (transform.hasSpeed) {
          await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
        } else {
          await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
        }
      } else {
        let delogoFilter: string | null = null;
        let dims: { width: number; height: number } | null = null;
        const needsDims =
          (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

        if (needsDims) {
          dims = await probeVideoDimensions(rawPath);
          if (!dims && (customLogoFile || transform.hasZoom)) {
            dims = { width: 1920, height: 1080 };
          }
          if (dims && params.watermark && params.watermark !== 'none') {
            if (params.watermark === 'auto') {
              delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
            } else {
              delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
            }
          }
        }

        await renderVideoWithFfmpeg({
          videoPath: rawPath,
          hasAudioStream,
          format: params.format as 'mp4' | 'mkv' | 'webm',
          finalPath,
          delogoFilter,
          dims,
          customLogoFile,
          customLogo: params.customLogo,
          transform,
        });
      }
    } else {
      // Try DASH first for best quality & separate audio stream (fnval=4048 & try_look=1 unlocks up to 1080P for guests)
      const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(
        params.bvid
      )}&cid=${resolvedCid}&qn=${targetQn}&fnval=4048&fourk=1&try_look=1`;

      const playJson = await fetchBiliJson(playUrlApi, params.sessdata);

      if (playJson.code !== 0 || !playJson.data) {
        throw new Error(playJson.message || 'Không thể lấy luồng video từ Bilibili');
      }

      const data = playJson.data;

      if (data.dash && (data.dash.video?.length || data.dash.audio?.length)) {
        const videos: any[] = data.dash.video || [];
        const audios: any[] = data.dash.audio || [];

        // Pick best matching video stream <= targetQn (or closest), sorted by highest bandwidth
        const sortedVideos = [...videos].sort(
          (a, b) => b.id - a.id || (b.bandwidth || 0) - (a.bandwidth || 0)
        );
        let selectedVideo =
          sortedVideos.find((v) => v.id === targetQn) ||
          sortedVideos.find((v) => v.id <= targetQn) ||
          sortedVideos[sortedVideos.length - 1];

        // Prefer highest-bandwidth AVC (codec id 7) when multiple streams share same quality for MP4 compatibility
        if (selectedVideo) {
          const sameIdStreams = sortedVideos.filter((v) => v.id === selectedVideo.id);
          const avc = sameIdStreams.find((v) => v.codecid === 7);
          if (avc) selectedVideo = avc;
        }

        const selectedAudio =
          audios.length > 0 ? [...audios].sort((a, b) => b.bandwidth - a.bandwidth)[0] : null;

        const cacheDir = getRawCacheDir(avCacheKey);
        fs.mkdirSync(cacheDir, { recursive: true });
        const audioPath = path.join(cacheDir, 'audio.m4s');
        const videoPath = path.join(cacheDir, 'video.m4s');

        if (isAudioOnly) {
          const audioUrls = getCandidateUrls(selectedAudio);
          if (audioUrls.length === 0) throw new Error('Video này không có luồng âm thanh tách rời');
          const audioPart = path.join(cacheDir, `audio_${jobId.slice(0, 8)}.part`);
          tempFiles.push(audioPart);

          await downloadFileWithProgress(audioUrls, audioPart, headers, (dl, total, speed) => {
            job.downloadedBytes = dl;
            job.totalBytes = total;
            job.speedBytesPerSec = speed;
            job.progress = total > 0 ? Math.min(78, Math.round((dl / total) * 78)) : 40;
          });

          fs.renameSync(audioPart, audioPath);
          writeRawCacheMeta(avCacheKey, { files: { audio: audioPath } });
          hasCachedRawSource = true;

          job.status = 'processing';
          job.progress = 85;

          const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
          if (params.format === 'mp3') {
            await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
          } else if (transform.hasSpeed) {
            await runFfmpeg(['-i', audioPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
          } else {
            await runFfmpeg(['-i', audioPath, '-vn', '-c:a', 'copy', finalPath]);
          }
        } else {
          const videoUrls = getCandidateUrls(selectedVideo);
          const audioUrls = getCandidateUrls(selectedAudio);
          if (videoUrls.length === 0) throw new Error('Không tìm thấy luồng hình ảnh phù hợp');

          const videoPart = path.join(cacheDir, `video_${jobId.slice(0, 8)}.part`);
          tempFiles.push(videoPart);
          await downloadFileWithProgress(videoUrls, videoPart, headers, (dl, total, speed) => {
            job.downloadedBytes = dl;
            job.totalBytes = total;
            job.speedBytesPerSec = speed;
            job.progress = total > 0 ? Math.min(60, Math.round((dl / total) * 60)) : 30;
          });
          fs.renameSync(videoPart, videoPath);

          const cachedFiles: Record<string, string> = { video: videoPath };
          if (audioUrls.length > 0) {
            const audioPart = path.join(cacheDir, `audio_${jobId.slice(0, 8)}.part`);
            tempFiles.push(audioPart);
            await downloadFileWithProgress(audioUrls, audioPart, headers, (dl, total, speed) => {
              job.speedBytesPerSec = speed;
              const audioPct = total > 0 ? Math.round((dl / total) * 20) : 10;
              job.progress = Math.min(80, 60 + audioPct);
            });
            fs.renameSync(audioPart, audioPath);
            cachedFiles.audio = audioPath;
          }

          writeRawCacheMeta(avCacheKey, {
            files: cachedFiles,
            width: Number(selectedVideo?.width) || undefined,
            height: Number(selectedVideo?.height) || undefined,
          });
          hasCachedRawSource = true;

          job.status = 'processing';
          job.progress = 85;

          let delogoFilter: string | null = null;
          const needsDims =
            (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

          let dims: { width: number; height: number } | null = null;
          if (needsDims) {
            dims = await probeVideoDimensions(videoPath);
            if (!dims && selectedVideo?.width && selectedVideo?.height) {
              dims = { width: Number(selectedVideo.width), height: Number(selectedVideo.height) };
            }
            if (!dims && (customLogoFile || transform.hasZoom)) {
              dims = { width: 1920, height: 1080 };
            }
          }

          if (dims && params.watermark && params.watermark !== 'none') {
            if (params.watermark === 'auto') {
              delogoFilter = await detectWatermarkDelogoFilter(videoPath, dims.width, dims.height);
            } else {
              delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
            }
          }

          await renderVideoWithFfmpeg({
            videoPath,
            separateAudioPath: audioUrls.length > 0 ? audioPath : undefined,
            hasAudioStream: audioUrls.length > 0,
            format: params.format as 'mp4' | 'mkv' | 'webm',
            finalPath,
            delogoFilter,
            dims,
            customLogoFile,
            customLogo: params.customLogo,
            transform,
          });
        }
      } else if (data.durl?.length) {
        const durlCandidates = getCandidateUrls(data.durl[0]);
        const cacheDir = getRawCacheDir(durlCacheKey);
        fs.mkdirSync(cacheDir, { recursive: true });
        const rawPath = path.join(cacheDir, 'raw.mp4');
        const rawPart = path.join(cacheDir, `raw_${jobId.slice(0, 8)}.part`);
        tempFiles.push(rawPart);

        await downloadFileWithProgress(durlCandidates, rawPart, headers, (dl, total, speed) => {
          job.downloadedBytes = dl;
          job.totalBytes = total;
          job.speedBytesPerSec = speed;
          job.progress = total > 0 ? Math.min(80, Math.round((dl / total) * 80)) : 40;
        });

        fs.renameSync(rawPart, rawPath);
        writeRawCacheMeta(durlCacheKey, { files: { raw: rawPath } });
        hasCachedRawSource = true;

        job.status = 'processing';
        job.progress = 85;

        const hasAudioStream = await probeHasAudio(rawPath);

        if (isAudioOnly) {
          if (!hasAudioStream) {
            throw new Error('Video này không có luồng âm thanh');
          }
          const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
          if (params.format === 'mp3') {
            await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
          } else if (transform.hasSpeed) {
            await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
          } else {
            await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
          }
        } else {
          let delogoFilter: string | null = null;
          let dims: { width: number; height: number } | null = null;
          const needsDims =
            (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

          if (needsDims) {
            dims = await probeVideoDimensions(rawPath);
            if (!dims && (customLogoFile || transform.hasZoom)) {
              dims = { width: 1920, height: 1080 };
            }
            if (dims && params.watermark && params.watermark !== 'none') {
              if (params.watermark === 'auto') {
                delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
              } else {
                delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
              }
            }
          }

          await renderVideoWithFfmpeg({
            videoPath: rawPath,
            hasAudioStream,
            format: params.format as 'mp4' | 'mkv' | 'webm',
            finalPath,
            delogoFilter,
            dims,
            customLogoFile,
            customLogo: params.customLogo,
            transform,
          });
        }
      } else {
        throw new Error('Không có luồng phát khả dụng cho video này');
      }
    }

    const stat = fs.statSync(finalPath);
    job.filePath = finalPath;
    job.fileSize = stat.size;
    job.progress = 100;
    job.status = 'completed';
  } catch (err: any) {
    job.status = 'error';
    const rawMsg = err?.message || 'Lỗi không xác định trong quá trình tải';
    job.error = hasCachedRawSource
      ? `Đã giữ lại video gốc đã tải (bấm Thử lại để xuất lại không cần tải lại từ đầu): ${rawMsg}`
      : rawMsg;
  } finally {
    for (const tmp of tempFiles) {
      if (fs.existsSync(tmp)) {
        fs.unlink(tmp, () => {});
      }
    }
  }
}

async function processYouTubeDownloadJob(
  jobId: string,
  params: {
    sourceUrl: string;
    bvid: string;
    title: string;
    qn: number;
    format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
    watermark?: WatermarkMode;
    ytCookies?: string;
    customLogo?: CustomLogoParam;
    videoTransform?: VideoTransformParam;
  }
) {
  const job = jobs.get(jobId);
  if (!job) return;

  const tempFiles: string[] = [];
  const transform = normalizeVideoTransform(params.videoTransform);
  let hasCachedRawSource = false;

  try {
    job.status = 'downloading';
    job.progress = 2;

    const isAudioOnly = params.format === 'mp3' || params.format === 'm4a';

    let customLogoFile: string | null = null;
    if (!isAudioOnly && params.customLogo?.enabled && params.customLogo.dataUrl) {
      try {
        const commaIdx = params.customLogo.dataUrl.indexOf(',');
        const rawBase64 =
          commaIdx >= 0 ? params.customLogo.dataUrl.slice(commaIdx + 1) : params.customLogo.dataUrl;
        const logoBuffer = Buffer.from(rawBase64, 'base64');
        if (logoBuffer.length > 0) {
          customLogoFile = path.join(DOWNLOAD_DIR, `${jobId}_custom_logo.png`);
          await fs.promises.writeFile(customLogoFile, logoBuffer);
          tempFiles.push(customLogoFile);
        }
      } catch (logoErr) {
        console.error('Failed to write custom logo:', logoErr);
      }
    }

    const ytKey = params.bvid || crypto.createHash('md5').update(params.sourceUrl).digest('hex').slice(0, 12);
    const cacheKey = `yt_${ytKey}_qn${params.qn}_${isAudioOnly ? 'audio' : params.format === 'mp4' ? 'avc' : 'best'}`;
    const cached = readValidRawCache(cacheKey);
    let rawPath = '';

    if (cached?.meta.files.raw) {
      rawPath = cached.meta.files.raw;
      hasCachedRawSource = true;
      job.totalBytes = fs.statSync(rawPath).size;
      job.downloadedBytes = job.totalBytes;
      job.progress = 80;
    } else {
      const ytDlpBin = await ensureYtDlpPath();
      const cookiePath = writeYtCookiesFile(jobId, params.ytCookies);
      if (cookiePath) tempFiles.push(cookiePath);
      const cookieArgs = cookiePath ? ['--cookies', cookiePath] : [];

      const qnToHeight: Record<number, number> = {
        120: 2160,
        116: 1080,
        112: 1080,
        80: 1080,
        64: 720,
        32: 480,
        16: 360,
      };
      const maxH = qnToHeight[params.qn] || 0;

      const cacheDir = getRawCacheDir(cacheKey);
      fs.mkdirSync(cacheDir, { recursive: true });
      const stem = `raw_${jobId.slice(0, 8)}`;
      const rawPrefix = path.join(cacheDir, stem);

      let formatSelector = 'bestaudio/best';
      const mergeArgs: string[] = [];
      if (!isAudioOnly) {
        const hFilter = maxH > 0 ? `[height<=${maxH}]` : '';
        if (params.format === 'mp4') {
          formatSelector = `bestvideo[vcodec^=avc1]${hFilter}+bestaudio[ext=m4a]/bestvideo${hFilter}+bestaudio/best${hFilter}/best`;
        } else {
          formatSelector = `bestvideo${hFilter}+bestaudio/best${hFilter}/best`;
        }
        mergeArgs.push('--merge-output-format', 'mkv');
      }

      const targetUrl = params.sourceUrl || `https://www.youtube.com/watch?v=${params.bvid}`;
      const ytArgs = [
        '--no-playlist',
        '--js-runtimes',
        'node',
        '--no-warnings',
        '--newline',
        '--concurrent-fragments',
        '4',
        '--http-chunk-size',
        '10M',
        '--retries',
        '10',
        '--fragment-retries',
        '10',
        '--socket-timeout',
        '25',
        '--retry-sleep',
        '2',
        '-f',
        formatSelector,
        ...mergeArgs,
        ...cookieArgs,
        '-o',
        `${rawPrefix}.%(ext)s`,
        targetUrl,
      ];

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ytDlpBin, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          let stdoutBuf = '';

          proc.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString();
            const lines = stdoutBuf.split(/\r?\n/);
            stdoutBuf = lines.pop() || '';
            for (const line of lines) {
              const pctMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)([KMG]i?B)/i);
              if (pctMatch) {
                const pct = parseFloat(pctMatch[1]);
                const totalB = parseYtdlpSizeToBytes(pctMatch[2], pctMatch[3]);
                job.progress = Math.min(78, Math.max(2, Math.round((pct / 100) * 78)));
                if (totalB > 0) {
                  job.totalBytes = totalB;
                  job.downloadedBytes = Math.round((pct / 100) * totalB);
                }
              }
              const spdMatch = line.match(/\bat\s+([\d.]+)([KMG]i?B)\/s/i);
              if (spdMatch) {
                job.speedBytesPerSec = parseYtdlpSizeToBytes(spdMatch[1], spdMatch[2]);
              }
            }
          });

          proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 4000) stderr = stderr.slice(-4000);
          });

          proc.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else if (/Sign in to confirm you.?re not a bot|cookies/i.test(stderr)) {
              reject(
                new Error(
                  'YouTube yêu cầu xác minh chống bot. Vui lòng bấm "Cookie / Đăng nhập" trên thanh trên cùng -> tab YouTube Cookies và dán cookies.txt của bạn rồi bấm Thử lại.'
                )
              );
            } else {
              reject(new Error(`Lỗi tải YouTube (code ${code}): ${stderr.slice(-260).trim()}`));
            }
          });
          proc.on('error', (err) => reject(err));
        });
      } catch (dlErr) {
        // Clean partial files on failed download
        for (const f of fs.readdirSync(cacheDir)) {
          if (f.startsWith(stem)) {
            fs.unlink(path.join(cacheDir, f), () => {});
          }
        }
        throw dlErr;
      }

      const dirEntries = fs.readdirSync(cacheDir);
      const matchedRaw = dirEntries.find((f) => f.startsWith(`${stem}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
      if (!matchedRaw) {
        throw new Error('Không tìm thấy tệp sau khi tải từ YouTube');
      }
      const ext = path.extname(matchedRaw) || '.mkv';
      const stableRawPath = path.join(cacheDir, `source${ext}`);
      fs.renameSync(path.join(cacheDir, matchedRaw), stableRawPath);
      rawPath = stableRawPath;
      writeRawCacheMeta(cacheKey, { files: { raw: rawPath } });
      hasCachedRawSource = true;
    }

    job.status = 'processing';
    job.progress = 85;

    const finalPath = path.join(DOWNLOAD_DIR, `${jobId}.${params.format}`);

    if (isAudioOnly) {
      const hasAudio = await probeHasAudio(rawPath);
      if (!hasAudio) throw new Error('Video YouTube này không có luồng âm thanh');
      const codecs = await probeStreamCodecs(rawPath);
      const afArgs = transform.hasSpeed ? ['-af', `asetpts=PTS-STARTPTS,${buildAtempoFilter(transform.speed)}`] : [];
      if (params.format === 'mp3') {
        await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'libmp3lame', '-b:a', '320k', finalPath]);
      } else if (transform.hasSpeed || codecs.acodec !== 'aac') {
        await runFfmpeg(['-i', rawPath, '-vn', ...afArgs, '-c:a', 'aac', '-b:a', '192k', finalPath]);
      } else {
        await runFfmpeg(['-i', rawPath, '-vn', '-c:a', 'copy', finalPath]);
      }
    } else {
      const hasAudioStream = await probeHasAudio(rawPath);
      const codecs = await probeStreamCodecs(rawPath);
      const needsDims =
        (params.watermark && params.watermark !== 'none') || Boolean(customLogoFile) || transform.hasZoom;

      let dims: { width: number; height: number } | null = null;
      let delogoFilter: string | null = null;

      if (needsDims) {
        dims = await probeVideoDimensions(rawPath);
        if (!dims && (customLogoFile || transform.hasZoom)) {
          dims = { width: 1920, height: 1080 };
        }
        if (dims && params.watermark && params.watermark !== 'none') {
          if (params.watermark === 'auto') {
            delogoFilter = await detectWatermarkDelogoFilter(rawPath, dims.width, dims.height);
          } else {
            delogoFilter = buildDelogoFilter(params.watermark, dims.width, dims.height);
          }
        }
      }

      const forceMp4Transcode =
        params.format === 'mp4' &&
        ((codecs.vcodec !== 'h264' && codecs.vcodec !== 'hevc') ||
          (hasAudioStream && codecs.acodec !== 'aac'));

      await renderVideoWithFfmpeg({
        videoPath: rawPath,
        hasAudioStream,
        format: params.format as 'mp4' | 'mkv' | 'webm',
        finalPath,
        delogoFilter,
        dims,
        customLogoFile,
        customLogo: params.customLogo,
        transform,
        forceMp4Transcode,
      });
    }

    const stat = fs.statSync(finalPath);
    job.filePath = finalPath;
    job.fileSize = stat.size;
    job.progress = 100;
    job.status = 'completed';
  } catch (err: any) {
    job.status = 'error';
    const rawMsg = err?.message || 'Lỗi không xác định khi tải video YouTube';
    job.error = hasCachedRawSource
      ? `Đã giữ lại video gốc đã tải (bấm Thử lại để xuất lại không cần tải lại từ đầu): ${rawMsg}`
      : rawMsg;
  } finally {
    for (const tmp of tempFiles) {
      if (fs.existsSync(tmp)) {
        fs.unlink(tmp, () => {});
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // Proxy Bilibili & YouTube thumbnails safely
  app.get('/api/bilibili/proxy-image', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl.startsWith('http')) {
      return res.status(400).send('Invalid URL');
    }
    try {
      const isBiliImg = rawUrl.includes('hdslb.com') || rawUrl.includes('bilibili.com');
      const response = await fetch(rawUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          ...(isBiliImg ? { Referer: 'https://www.bilibili.com/' } : {}),
        },
      });
      if (!response.ok || !response.body) {
        return res.status(response.status).send('Image fetch failed');
      }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      await pipeline(Readable.fromWeb(response.body as any), res);
    } catch {
      res.status(502).send('Failed to proxy image');
    }
  });

  // Inspect one or multiple Bilibili / YouTube URLs
  app.post('/api/bilibili/inspect', async (req, res) => {
    try {
      const { urls, expandPages = true, sessdata, ytCookies } = (req.body || {}) as {
        urls?: string[];
        expandPages?: boolean;
        sessdata?: string;
        ytCookies?: string;
      };

      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Vui lòng nhập ít nhất một liên kết video.' });
      }

      const items: any[] = [];
      const errors: { url: string; message: string }[] = [];
      let suggestedFolder = '';
      const pickSuggestedFolder = (urlStr: string) => {
        if (suggestedFolder) return;
        const ytHandle = urlStr.match(/youtube\.com\/(@[^/?#\s]+)/i)?.[1];
        if (ytHandle) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(ytHandle));
          } catch {
            suggestedFolder = sanitizeFilename(ytHandle);
          }
          return;
        }
        const biliMid = extractSpaceMid(urlStr);
        if (biliMid) {
          suggestedFolder = sanitizeFilename(biliMid);
          return;
        }
        const ytLegacy = urlStr.match(/youtube\.com\/(?:channel|c|user)\/([^/?#\s]+)/i)?.[1];
        if (ytLegacy) {
          try {
            suggestedFolder = sanitizeFilename(decodeURIComponent(ytLegacy));
          } catch {
            suggestedFolder = sanitizeFilename(ytLegacy);
          }
        }
      };

    for (const rawInput of urls.slice(0, 30)) {
      const trimmed = rawInput.trim();
      if (!trimmed) continue;

      try {
        pickSuggestedFolder(trimmed);
        if (isYouTubeUrl(trimmed)) {
          const ytItems = await inspectYouTubeUrl(trimmed, ytCookies);
          items.push(...ytItems);
          continue;
        }

        const resolvedUrl = await resolveShortUrl(trimmed);
        pickSuggestedFolder(resolvedUrl);
        const spaceMid = extractSpaceMid(resolvedUrl);

        if (spaceMid) {
          let fetchedFromMedialist = false;
          let oid = '';
          let pageRound = 0;
          const maxRounds = 10; // up to 300 videos per channel inspect

          while (pageRound < maxRounds) {
            const medialistUrl = `https://api.bilibili.com/x/v2/medialist/resource/list?type=1&biz_id=${encodeURIComponent(
              spaceMid
            )}&mobi_app=web&ps=30${oid ? `&oid=${encodeURIComponent(oid)}` : ''}`;

            const mlJson = await fetchBiliJson(medialistUrl, sessdata);
            if (mlJson.code !== 0 || !Array.isArray(mlJson.data?.media_list)) {
              break;
            }

            const mediaList: any[] = mlJson.data.media_list;
            if (mediaList.length === 0) break;
            fetchedFromMedialist = true;

            for (const m of mediaList) {
              const bvidVal = m.bv_id || m.bvid;
              if (!bvidVal) continue;
              const firstPage = Array.isArray(m.pages) && m.pages[0] ? m.pages[0] : null;
              items.push({
                id: `${bvidVal}_space_${crypto.randomBytes(3).toString('hex')}`,
                bvid: bvidVal,
                aid: m.id || 0,
                cid: firstPage?.id || 0,
                page: 1,
                totalPages: m.page || 1,
                title: m.title || bvidVal,
                partTitle: '',
                author: m.upper?.name || `UID ${spaceMid}`,
                duration: m.duration || 0,
                views: Number(m.cnt_info?.play ?? 0),
                pubdate: Number(m.pubtime || m.ctime || 0),
                pic: (m.cover || '').replace(/^http:/, 'https:'),
                sourceUrl: `https://www.bilibili.com/video/${bvidVal}`,
                availableQualities: [
                  { qn: 120, label: '4K (2160P)' },
                  { qn: 116, label: '1080P60' },
                  { qn: 80, label: '1080P' },
                  { qn: 64, label: '720P' },
                  { qn: 32, label: '480P' },
                  { qn: 16, label: '360P' },
                ],
              });
            }

            if (!mlJson.data.has_more) break;
            const lastItem = mediaList[mediaList.length - 1];
            if (!lastItem?.id || String(lastItem.id) === oid) break;
            oid = String(lastItem.id);
            pageRound++;
          }

          if (!fetchedFromMedialist) {
            // Fallback to WBI arc/search if medialist is unavailable
            const { imgKey, subKey } = await getWbiKeys(sessdata);
            const pageSize = 30;
            const maxPages = 10;
            let pn = 1;
            let totalCount = 0;

            while (pn <= maxPages) {
              const qs = encWbi(
                { mid: spaceMid, ps: pageSize, tid: 0, pn, order: 'pubdate' },
                imgKey,
                subKey
              );
              const arcJson = await fetchBiliJson(
                `https://api.bilibili.com/x/space/wbi/arc/search?${qs}`,
                sessdata
              );

              if (arcJson.code !== 0 || !arcJson.data?.list?.vlist) {
                if (pn === 1) {
                  errors.push({
                    url: trimmed,
                    message: arcJson.message || 'Không thể lấy danh sách video của kênh này.',
                  });
                }
                break;
              }

              const vlist: any[] = arcJson.data.list.vlist;
              totalCount = arcJson.data.page?.count || vlist.length;
              if (vlist.length === 0) break;

              for (const v of vlist) {
                items.push({
                  id: `${v.bvid}_space_${crypto.randomBytes(3).toString('hex')}`,
                  bvid: v.bvid,
                  aid: v.aid || 0,
                  cid: 0,
                  page: 1,
                  totalPages: 1,
                  title: v.title || v.bvid,
                  partTitle: '',
                  author: v.author || `UID ${spaceMid}`,
                  duration: parseLengthToSeconds(v.length),
                  views: Number(v.play ?? 0),
                  pubdate: Number(v.created ?? 0),
                  pic: (v.pic || '').replace(/^http:/, 'https:'),
                  sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
                  availableQualities: [
                    { qn: 120, label: '4K (2160P)' },
                    { qn: 116, label: '1080P60' },
                    { qn: 80, label: '1080P' },
                    { qn: 64, label: '720P' },
                    { qn: 32, label: '480P' },
                    { qn: 16, label: '360P' },
                  ],
                });
              }

              if (pn * pageSize >= totalCount) break;
              pn++;
            }
          }
          continue;
        }

        const { bvid, aid, page } = extractBiliIdentifier(resolvedUrl);

        if (!bvid && !aid) {
          errors.push({ url: trimmed, message: 'Không nhận diện được mã BV, av hoặc kênh hợp lệ.' });
          continue;
        }

        const viewEndpoint = bvid
          ? `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
          : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;

        const viewJson = await fetchBiliJson(viewEndpoint, sessdata);

        if (viewJson.code !== 0 || !viewJson.data) {
          errors.push({
            url: trimmed,
            message: viewJson.message || 'Không tìm thấy video hoặc video đã bị ẩn.',
          });
          continue;
        }

        const v = viewJson.data;
        const pages: any[] = Array.isArray(v.pages) && v.pages.length > 0 ? v.pages : [{ cid: v.cid, page: 1, part: v.title, duration: v.duration }];

        // Fetch available qualities using first target cid
        const firstCid = pages[0].cid;
        let availableQualities: { qn: number; label: string }[] = [
          { qn: 80, label: '1080P' },
          { qn: 64, label: '720P' },
          { qn: 32, label: '480P' },
          { qn: 16, label: '360P' },
        ];

        try {
          const playJson = await fetchBiliJson(
            `https://api.bilibili.com/x/player/playurl?bvid=${v.bvid}&cid=${firstCid}&qn=120&fnval=4048&fourk=1&try_look=1`,
            sessdata
          );
          if (playJson.code === 0 && playJson.data?.accept_quality) {
            const qns: number[] = playJson.data.accept_quality;
            const descs: string[] = playJson.data.accept_description || [];
            availableQualities = qns.map((qn, idx) => ({
              qn,
              label: QN_LABELS[qn] || descs[idx] || `${qn}P`,
            }));
          }
        } catch {
          // keep fallback qualities
        }

        const targetPages =
          expandPages && !page
            ? pages
            : [pages.find((p) => p.page === (page || 1)) || pages[0]];

        for (const p of targetPages) {
          items.push({
            id: `${v.bvid}_${p.cid}_${crypto.randomBytes(3).toString('hex')}`,
            bvid: v.bvid,
            aid: v.aid,
            cid: p.cid,
            page: p.page,
            totalPages: pages.length,
            title: v.title,
            partTitle: pages.length > 1 ? p.part || `P${p.page}` : '',
            author: v.owner?.name || 'Bilibili Creator',
            duration: p.duration || v.duration || 0,
            views: Number(v.stat?.view ?? 0),
            pubdate: Number(v.pubdate || v.ctime || 0),
            pic: v.pic?.replace(/^http:/, 'https:') || '',
            sourceUrl: `https://www.bilibili.com/video/${v.bvid}${pages.length > 1 ? `?p=${p.page}` : ''}`,
            availableQualities,
          });
        }
      } catch (err: any) {
        errors.push({ url: trimmed, message: err?.message || 'Lỗi kết nối tới Bilibili' });
      }
    }

    if (!suggestedFolder && items.length > 0 && items[0]?.author) {
      suggestedFolder = sanitizeFilename(String(items[0].author));
    }

    res.json({ items, errors, suggestedFolder });
    } catch (fatalErr: any) {
      console.error('Inspect fatal error:', fatalErr);
      if (!res.headersSent) {
        res.status(500).json({ error: fatalErr?.message || 'Lỗi máy chủ khi phân tích liên kết' });
      }
    }
  });

  // Start a download job
  app.post('/api/bilibili/download', (req, res) => {
    const {
      platform,
      sourceUrl,
      bvid,
      cid,
      title,
      partTitle,
      qn,
      format,
      watermark,
      sessdata,
      ytCookies,
      customLogo,
      videoTransform,
    } = req.body as {
      platform?: 'bilibili' | 'youtube';
      sourceUrl?: string;
      bvid: string;
      cid: number;
      title: string;
      partTitle?: string;
      qn: number;
      format: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
      watermark?: WatermarkMode;
      sessdata?: string;
      ytCookies?: string;
      customLogo?: CustomLogoParam;
      videoTransform?: VideoTransformParam;
    };

    if (!bvid && !sourceUrl) {
      return res.status(400).json({ error: 'Thiếu thông tin video' });
    }

    const jobId = crypto.randomUUID();
    const baseName = sanitizeFilename(partTitle ? `${title} - ${partTitle}` : title) || bvid || 'video';
    const fileName = `${baseName}.${format}`;

    jobs.set(jobId, {
      jobId,
      status: 'queued',
      progress: 0,
      speedBytesPerSec: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      fileName,
      createdAt: Date.now(),
    });

    // Run asynchronously
    if (platform === 'youtube' || (sourceUrl && isYouTubeUrl(sourceUrl))) {
      processYouTubeDownloadJob(jobId, {
        sourceUrl: sourceUrl || `https://www.youtube.com/watch?v=${bvid}`,
        bvid,
        title,
        qn,
        format,
        watermark,
        ytCookies,
        customLogo,
        videoTransform,
      });
    } else {
      processDownloadJob(jobId, {
        bvid,
        cid,
        title,
        partTitle,
        qn,
        format,
        watermark,
        sessdata,
        customLogo,
        videoTransform,
      });
    }

    res.json({ jobId, fileName });
  });

  // Poll job status
  app.get('/api/bilibili/jobs/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Không tìm thấy tác vụ tải xuống' });
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      speedBytesPerSec: job.speedBytesPerSec,
      downloadedBytes: job.downloadedBytes,
      totalBytes: job.totalBytes,
      fileSize: job.fileSize,
      fileName: job.fileName,
      error: job.error,
    });
  });

  const resolveJobFile = (jobId: string) => {
    const job = jobs.get(jobId);
    let filePath = job?.filePath;
    let fileName = job?.fileName || `bilibili_${jobId.slice(0, 8)}.mp4`;

    if (!filePath || !fs.existsSync(filePath)) {
      const exts = ['.mp4', '.mkv', '.webm', '.mp3', '.m4a'];
      for (const ext of exts) {
        const candidate = path.join(DOWNLOAD_DIR, `${jobId}${ext}`);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          fileName = job?.fileName || `bilibili_${jobId.slice(0, 8)}${ext}`;
          break;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const fileSize = fs.statSync(filePath).size;
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
    };
    return {
      filePath,
      fileName,
      fileSize,
      contentType: mimeMap[ext] || 'application/octet-stream',
    };
  };

  // File metadata for chunked downloads (bypasses 32MB single-response proxy limit)
  app.get('/api/bilibili/jobs/:jobId/file-info', (req, res) => {
    const info = resolveJobFile(req.params.jobId);
    if (!info) {
      return res.status(404).json({
        error: 'Tệp video này không còn trên máy chủ (phiên cũ đã hết hạn). Bạn vui lòng bấm nút Thử lại để tải mới.',
      });
    }
    res.json({
      fileSize: info.fileSize,
      fileName: info.fileName,
      contentType: info.contentType,
    });
  });

  // Download completed file (full or byte-range chunk via ?offset=&limit=)
  app.get('/api/bilibili/jobs/:jobId/file', (req, res) => {
    const info = resolveJobFile(req.params.jobId);
    if (!info) {
      return res.status(404).json({
        error: 'Tệp video này không còn trên máy chủ (phiên cũ đã hết hạn). Bạn vui lòng bấm nút Thử lại để tải mới.',
      });
    }

    const hasOffset = req.query.offset !== undefined || req.query.limit !== undefined;
    if (hasOffset) {
      const offsetRaw = Number(req.query.offset ?? 0);
      const limitRaw = Number(req.query.limit ?? 8 * 1024 * 1024);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(20 * 1024 * 1024, Math.floor(limitRaw))
        : 8 * 1024 * 1024;

      if (offset >= info.fileSize) {
        return res.status(416).json({ error: 'Vị trí đọc vượt quá kích thước tệp' });
      }

      const end = Math.min(info.fileSize - 1, offset + limit - 1);
      const chunkLen = end - offset + 1;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(chunkLen));
      res.setHeader('X-Total-Size', String(info.fileSize));
      res.setHeader('Cache-Control', 'no-store');

      const stream = fs.createReadStream(info.filePath, { start: offset, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Không thể đọc đoạn dữ liệu tệp video' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    const ext = path.extname(info.fileName) || '.mp4';
    const encodedName = encodeURIComponent(info.fileName).replace(
      /['()*!]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bilibili_download${ext}"; filename*=UTF-8''${encodedName}`
    );
    res.sendFile(info.filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Không thể gửi tệp video từ máy chủ' });
      }
    });
  });

  // Prepare batch ZIP on disk so large archives (>32MB) can be downloaded cleanly in chunks
  app.post('/api/bilibili/batch-zip/prepare', async (req, res) => {
    try {
      const { jobIds, folderName } = (req.body || {}) as { jobIds?: string[]; folderName?: string };
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ error: 'Không có tệp nào để nén ZIP' });
      }

      const readyFiles = jobIds
        .map((id) => ({ id, info: resolveJobFile(id) }))
        .filter((entry): entry is { id: string; info: NonNullable<ReturnType<typeof resolveJobFile>> } => Boolean(entry.info));

      if (readyFiles.length === 0) {
        return res.status(404).json({ error: 'Chưa có tệp hoàn tất nào' });
      }

      const safeFolder = folderName ? sanitizeFilename(folderName) : '';
      const zipBaseName = safeFolder || 'BiliBatch_Downloads';
      const zipId = crypto.randomUUID();
      const zipPath = path.join(DOWNLOAD_DIR, `zip_${zipId}.zip`);

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({ zlib: { level: 1 } });

        output.on('close', () => resolve());
        output.on('error', (err) => reject(err));
        archive.on('error', (err: Error) => reject(err));
        archive.pipe(output);

        const usedNames = new Set<string>();
        for (const { id, info } of readyFiles) {
          let name = info.fileName;
          if (usedNames.has(name)) {
            const ext = path.extname(name);
            const stem = path.basename(name, ext);
            name = `${stem}_${id.slice(0, 4)}${ext}`;
          }
          usedNames.add(name);
          const entryPath = safeFolder ? `${safeFolder}/${name}` : name;
          archive.file(info.filePath, { name: entryPath });
        }

        archive.finalize();
      });

      const zipSize = fs.statSync(zipPath).size;
      const zipName = `${zipBaseName}.zip`;
      preparedZips.set(zipId, {
        zipId,
        zipPath,
        zipName,
        zipSize,
        createdAt: Date.now(),
      });

      res.json({ zipId, zipName, zipSize });
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Lỗi tạo tệp ZIP' });
      }
    }
  });

  app.get('/api/bilibili/batch-zip/:zipId', (req, res) => {
    const zip = preparedZips.get(req.params.zipId);
    if (!zip || !fs.existsSync(zip.zipPath)) {
      return res.status(404).json({ error: 'Tệp ZIP không tồn tại hoặc đã hết hạn' });
    }

    const hasOffset = req.query.offset !== undefined || req.query.limit !== undefined;
    if (hasOffset) {
      const offsetRaw = Number(req.query.offset ?? 0);
      const limitRaw = Number(req.query.limit ?? 8 * 1024 * 1024);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(20 * 1024 * 1024, Math.floor(limitRaw))
        : 8 * 1024 * 1024;

      if (offset >= zip.zipSize) {
        return res.status(416).json({ error: 'Vị trí đọc vượt quá kích thước tệp ZIP' });
      }

      const end = Math.min(zip.zipSize - 1, offset + limit - 1);
      const chunkLen = end - offset + 1;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(chunkLen));
      res.setHeader('X-Total-Size', String(zip.zipSize));
      res.setHeader('Cache-Control', 'no-store');

      const stream = fs.createReadStream(zip.zipPath, { start: offset, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Không thể đọc đoạn dữ liệu tệp ZIP' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="BiliBatch_Downloads.zip"; filename*=UTF-8''${encodeURIComponent(zip.zipName)}`
    );
    res.sendFile(zip.zipPath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Không thể gửi tệp ZIP từ máy chủ' });
      }
    });
  });

  // Batch ZIP download (kept for compatibility)
  app.post('/api/bilibili/batch-zip', (req, res) => {
    const { jobIds, folderName } = req.body as { jobIds?: string[]; folderName?: string };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'Không có tệp nào để nén ZIP' });
    }

    const readyJobs = jobIds
      .map((id) => jobs.get(id))
      .filter((j): j is JobState => Boolean(j && j.status === 'completed' && j.filePath && fs.existsSync(j.filePath)));

    if (readyJobs.length === 0) {
      return res.status(404).json({ error: 'Chưa có tệp hoàn tất nào' });
    }

    const safeFolder = folderName ? sanitizeFilename(folderName) : '';
    const zipBaseName = safeFolder || 'BiliBatch_Downloads';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="BiliBatch_Downloads.zip"; filename*=UTF-8''${encodeURIComponent(zipBaseName + '.zip')}`
    );

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err: Error) => {
      if (!res.headersSent) res.status(500).send(err.message);
    });
    archive.pipe(res);

    const usedNames = new Set<string>();
    for (const j of readyJobs) {
      let name = j.fileName;
      if (usedNames.has(name)) {
        const ext = path.extname(name);
        const stem = path.basename(name, ext);
        name = `${stem}_${j.jobId.slice(0, 4)}${ext}`;
      }
      usedNames.add(name);
      const entryPath = safeFolder ? `${safeFolder}/${name}` : name;
      archive.file(j.filePath!, { name: entryPath });
    }

    archive.finalize();
  });

  const runExec = (
    cmd: string,
    args: string[],
    timeoutMs = 20_000
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: process.cwd(),
        shell: process.platform === 'win32' && cmd === 'npm',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`Lệnh ${cmd} quá thời gian chờ`));
      }, timeoutMs);

      proc.stdout.on('data', (c) => {
        stdout += c.toString();
      });
      proc.stderr.on('data', (c) => {
        stderr += c.toString();
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  app.get('/api/system/update-status', async (_req, res) => {
    const supervisorActive = process.env.BILIBATCH_SUPERVISOR === '1';
    try {
      const cwd = process.cwd();
      if (!fs.existsSync(path.join(cwd, '.git'))) {
        return res.json({
          supported: false,
          supervisorActive,
          reason: 'Thư mục hiện tại chưa được kết nối GitHub (.git).',
        });
      }

      const remoteRes = await runExec('git', ['remote', 'get-url', 'origin'], 8000).catch(() => null);
      if (!remoteRes || remoteRes.code !== 0 || !remoteRes.stdout) {
        return res.json({
          supported: false,
          supervisorActive,
          reason: 'Chưa gắn địa chỉ GitHub (remote origin) cho thư mục dự án.',
        });
      }

      const branchRes = await runExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000);
      const branch =
        branchRes.code === 0 && branchRes.stdout && branchRes.stdout !== 'HEAD'
          ? branchRes.stdout
          : 'main';
      const commitRes = await runExec('git', ['rev-parse', '--short', 'HEAD'], 8000);
      const currentCommit = commitRes.code === 0 ? commitRes.stdout : '';

      const fetchRes = await runExec('git', ['fetch', 'origin', branch, '--quiet'], 18_000).catch(
        (err: any) => ({ code: 1, stdout: '', stderr: err?.message || 'Lỗi kết nối GitHub' })
      );

      if (fetchRes.code !== 0) {
        return res.json({
          supported: true,
          hasUpdate: false,
          currentCommit,
          branch,
          remoteUrl: remoteRes.stdout,
          supervisorActive,
          fetchError: fetchRes.stderr || 'Không thể kết nối GitHub',
        });
      }

      const countRes = await runExec(
        'git',
        ['rev-list', '--count', `HEAD..origin/${branch}`],
        8000
      );
      const behindCount = countRes.code === 0 ? parseInt(countRes.stdout, 10) || 0 : 0;

      const latestMsgRes = await runExec(
        'git',
        ['log', '-1', '--pretty=%s', `origin/${branch}`],
        8000
      );
      const latestHashRes = await runExec(
        'git',
        ['rev-parse', '--short', `origin/${branch}`],
        8000
      );

      res.json({
        supported: true,
        hasUpdate: behindCount > 0,
        behindCount,
        currentCommit,
        latestCommit: latestHashRes.code === 0 ? latestHashRes.stdout : '',
        latestMessage: latestMsgRes.code === 0 ? latestMsgRes.stdout : '',
        branch,
        remoteUrl: remoteRes.stdout,
        supervisorActive,
      });
    } catch (err: any) {
      res.json({
        supported: false,
        supervisorActive,
        reason: err?.message || 'Không thể kiểm tra trạng thái Git',
      });
    }
  });

  app.post('/api/system/self-update', async (_req, res) => {
    try {
      const hasActiveJobs = Array.from(jobs.values()).some(
        (j) => j.status === 'downloading' || j.status === 'processing'
      );
      if (hasActiveJobs) {
        return res.status(409).json({
          error: 'Đang có video đang tải hoặc xử lý FFmpeg. Vui lòng đợi tải xong rồi mới cập nhật.',
        });
      }

      const cwd = process.cwd();
      if (!fs.existsSync(path.join(cwd, '.git'))) {
        return res.status(400).json({ error: 'Thư mục này chưa kết nối GitHub (.git).' });
      }

      const branchRes = await runExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 8000);
      const branch =
        branchRes.code === 0 && branchRes.stdout && branchRes.stdout !== 'HEAD'
          ? branchRes.stdout
          : 'main';

      const pkgPath = path.join(cwd, 'package.json');
      const prevPkg = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf8') : '';

      const fetchRes = await runExec('git', ['fetch', 'origin', branch], 30_000);
      if (fetchRes.code !== 0) {
        return res.status(502).json({
          error: `Không thể kết nối GitHub: ${fetchRes.stderr || 'git fetch thất bại'}`,
        });
      }

      // Stash local tracked edits (if any) so pull --ff-only won't be blocked
      const diffRes = await runExec('git', ['diff', '--name-only'], 8000);
      if (diffRes.code === 0 && diffRes.stdout) {
        await runExec('git', ['stash', 'push', '-m', 'bilibatch-auto-update'], 10_000).catch(() => {});
      }

      const pullRes = await runExec('git', ['pull', '--ff-only', 'origin', branch], 30_000);
      if (pullRes.code !== 0) {
        return res.status(500).json({
          error: `Không thể tự gộp code mới (${pullRes.stderr || 'git pull thất bại'}). Bạn hãy chạy "git reset --hard origin/${branch}" trong thư mục dự án.`,
        });
      }

      const nextPkg = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf8') : '';
      let npmInstalled = false;
      if (prevPkg !== nextPkg) {
        const npmRes = await runExec('npm', ['install', '--legacy-peer-deps'], 180_000);
        if (npmRes.code !== 0) {
          return res.status(500).json({
            error: `Đã tải code mới nhưng cài thư viện npm lỗi: ${npmRes.stderr.slice(-200)}`,
          });
        }
        npmInstalled = true;
      }

      const newCommitRes = await runExec('git', ['rev-parse', '--short', 'HEAD'], 8000);
      const newMsgRes = await runExec('git', ['log', '-1', '--pretty=%s', 'HEAD'], 8000);
      const supervisorActive = process.env.BILIBATCH_SUPERVISOR === '1';

      res.json({
        ok: true,
        updated: true,
        npmInstalled,
        commit: newCommitRes.code === 0 ? newCommitRes.stdout : '',
        message: newMsgRes.code === 0 ? newMsgRes.stdout : '',
        restarting: supervisorActive,
      });

      if (supervisorActive) {
        setTimeout(() => {
          console.log('Self-update completed. Exiting with code 42 for supervisor restart...');
          process.exit(42);
        }, 600);
      }
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Lỗi không xác định khi cập nhật từ GitHub' });
      }
    }
  });

  // Ensure unmatched /api/* routes return JSON 404 instead of Vite SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Không tìm thấy API endpoint' });
  });

  // Ensure Express errors on /api/* (e.g., invalid JSON body, payload too large) return JSON
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      return res.status(status).json({
        error: err?.message || 'Lỗi xử lý trên máy chủ',
      });
    }
    next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BiliBatch server running at http://localhost:${PORT}`);
  });
}

startServer();
