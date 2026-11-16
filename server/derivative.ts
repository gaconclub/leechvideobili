import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { VideoPlatform } from './trending';

export type DerivativeVisualMode = 'remix' | 'storyboard_motion';
export type DerivativeStylePreset = 'summary_fast' | 'storytelling_review' | 'top_list' | 'tips_tutorial';
export type DerivativeVoiceId = 'none' | 'Kore' | 'Puck' | 'Zephyr' | 'Charon' | 'Fenrir';
export type DerivativeAspectRatio = '9:16' | '16:9';

export interface DerivativeSourceInput {
  id: string;
  platform: VideoPlatform;
  platformLabel: string;
  title: string;
  translatedTitle?: string;
  author: string;
  pic: string;
  sourceUrl: string;
  duration: number;
  views: number;
  likes?: number;
  categoryLabel?: string;
}

export interface DerivativeScene {
  id: string;
  sceneIndex: number;
  durationSec: number;
  sourceVideoIndex: number;
  sourceStartPercent: number;
  onScreenText: string;
  narration: string;
  visualNote?: string;
}

export interface DerivativeSourceInsight {
  index: number;
  title: string;
  platformLabel: string;
  author: string;
  hasDescription: boolean;
  hasCaptions: boolean;
  hasThumbnail: boolean;
  keyPoint: string;
}

export interface DerivativeBlueprint {
  learnedSummary: string;
  keyTakeaways: string[];
  hookFormula: string;
  derivativeTitle: string;
  derivativeHook: string;
  hashtags: string[];
  aspectRatio: DerivativeAspectRatio;
  sourcesAnalyzed: DerivativeSourceInsight[];
  scenes: DerivativeScene[];
}

export interface DerivativeJobRecord {
  jobId: string;
  status: 'queued' | 'learning' | 'downloading' | 'tts' | 'rendering' | 'completed' | 'error';
  progress: number;
  stepLabel: string;
  workDir: string;
  outputPath?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  resolution?: string;
  error?: string;
  warnings: string[];
  createdAt: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DERIVATIVE_BASE_DIR = path.join(os.tmpdir(), 'bili-downloads', 'derivative_jobs');
if (!fs.existsSync(DERIVATIVE_BASE_DIR)) {
  fs.mkdirSync(DERIVATIVE_BASE_DIR, { recursive: true });
}

export const derivativeJobs = new Map<string, DerivativeJobRecord>();

// Periodic cleanup of expired derivative job folders (> 2 hours old)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of derivativeJobs.entries()) {
    if (job.createdAt < cutoff && job.status !== 'downloading' && job.status !== 'rendering' && job.status !== 'tts') {
      try {
        fs.rmSync(job.workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      derivativeJobs.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Chưa phát hiện GEMINI_API_KEY trên máy chủ. Hãy thêm GEMINI_API_KEY trong bảng Settings > Secrets (hoặc tệp .env trên máy) để dùng tính năng AI học & tạo video phái sinh.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: any): string {
  const raw = String(err?.message || err || 'Lỗi kết nối Gemini AI');
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('API key not valid')) {
    return 'GEMINI_API_KEY không hợp lệ hoặc bị từ chối quyền. Vui lòng kiểm tra lại khóa trong Settings > Secrets.';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Đã chạm giới hạn tần suất Gemini API (429). Vui lòng đợi 30–60 giây rồi thử lại.';
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return `Mô hình AI tạm không khả dụng (${raw}). Vui lòng thử lại.`;
  }
  return raw;
}

function getRefererForUrl(rawUrl: string): string {
  if (rawUrl.includes('hdslb.com') || rawUrl.includes('bilibili.com')) return 'https://www.bilibili.com/';
  if (rawUrl.includes('douyinpic.com') || rawUrl.includes('douyin.com') || rawUrl.includes('byteimg.com')) return 'https://www.douyin.com/';
  if (rawUrl.includes('yximgs.com') || rawUrl.includes('kwimgs.com') || rawUrl.includes('kuaishou.com')) return 'https://www.kuaishou.com/';
  if (rawUrl.includes('sinaimg.cn') || rawUrl.includes('weibo.com')) return 'https://weibo.com/';
  if (rawUrl.includes('xhscdn.com') || rawUrl.includes('xiaohongshu.com')) return 'https://www.xiaohongshu.com/';
  if (rawUrl.includes('tiktokcdn') || rawUrl.includes('tiktokv.com') || rawUrl.includes('ttwstatic.com') || rawUrl.includes('tiktok.com')) {
    return 'https://www.tiktok.com/';
  }
  return '';
}

async function fetchImageBuffer(picUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!picUrl || !picUrl.startsWith('http')) return null;
  try {
    const referer = getRefererForUrl(picUrl);
    const res = await fetch(picUrl, {
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const arr = await res.arrayBuffer();
    if (arr.byteLength < 500) return null;
    return { buffer: Buffer.from(arr), mimeType: contentType };
  } catch {
    return null;
  }
}

interface EnrichedVideoContext {
  index: number;
  source: DerivativeSourceInput;
  description: string;
  tags: string[];
  captionsText: string;
  thumbnail: { buffer: Buffer; mimeType: string } | null;
}

function extractYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function fetchYouTubeContext(
  urlStr: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const vid = extractYouTubeId(urlStr);
  if (!vid) return { description: '', tags: [], captionsText: '' };

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${vid}&hl=vi`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(7000),
    });
    const html = await res.text();
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script>)/s);
    if (!match) return { description: '', tags: [], captionsText: '' };

    const player = JSON.parse(match[1]);
    const description = String(player?.videoDetails?.shortDescription || '').slice(0, 750);
    const tags: string[] = Array.isArray(player?.videoDetails?.keywords)
      ? player.videoDetails.keywords.slice(0, 12).map(String)
      : [];

    let captionsText = '';
    const tracks: any[] = Array.isArray(player?.captions?.playerCaptionsTracklistRenderer?.captionTracks)
      ? player.captions.playerCaptionsTracklistRenderer.captionTracks
      : [];
    const chosenTrack =
      tracks.find((t) => String(t.languageCode || '').startsWith('vi')) ||
      tracks.find((t) => String(t.languageCode || '').startsWith('en')) ||
      tracks[0];

    if (chosenTrack?.baseUrl) {
      try {
        const capUrl = `${chosenTrack.baseUrl}&fmt=json3`;
        const capRes = await fetch(capUrl, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5000),
        });
        if (capRes.ok) {
          const capJson = (await capRes.json().catch(() => null)) as any;
          const events: any[] = Array.isArray(capJson?.events) ? capJson.events : [];
          const segments: string[] = [];
          for (const ev of events) {
            if (!Array.isArray(ev?.segs)) continue;
            const line = ev.segs.map((s: any) => String(s?.utf8 || '')).join('').replace(/\s+/g, ' ').trim();
            if (line) segments.push(line);
          }
          captionsText = segments.join(' ').slice(0, 1400);
        }
      } catch {
        // ignore caption fetch error
      }
    }

    return { description, tags, captionsText };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function fetchBilibiliContext(
  sourceUrl: string,
  id: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const bvidMatch = sourceUrl.match(/(BV[0-9A-Za-z]+)/) || id.match(/(BV[0-9A-Za-z]+)/);
  if (!bvidMatch) return { description: '', tags: [], captionsText: '' };
  try {
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvidMatch[1]}`, {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json()) as any;
    const data = json?.data;
    if (!data) return { description: '', tags: [], captionsText: '' };
    const description = String(data.desc || data.dynamic || '').slice(0, 750);
    const tags = data.tname ? [String(data.tname)] : [];
    return { description, tags, captionsText: '' };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function fetchDailymotionContext(
  sourceUrl: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const m = sourceUrl.match(/\/video\/([A-Za-z0-9]+)/);
  if (!m) return { description: '', tags: [], captionsText: '' };
  try {
    const res = await fetch(`https://api.dailymotion.com/video/${m[1]}?fields=description,tags`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as any;
    return {
      description: String(json?.description || '').replace(/<[^>]+>/g, ' ').slice(0, 750),
      tags: Array.isArray(json?.tags) ? json.tags.slice(0, 10).map(String) : [],
      captionsText: '',
    };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function gatherSourceContexts(sources: DerivativeSourceInput[]): Promise<EnrichedVideoContext[]> {
  const limited = sources.slice(0, 6);
  return Promise.all(
    limited.map(async (src, idx) => {
      const [meta, thumb] = await Promise.all([
        src.platform === 'youtube'
          ? fetchYouTubeContext(src.sourceUrl)
          : src.platform === 'bilibili'
          ? fetchBilibiliContext(src.sourceUrl, src.id)
          : src.platform === 'dailymotion'
          ? fetchDailymotionContext(src.sourceUrl)
          : Promise.resolve({ description: '', tags: [], captionsText: '' }),
        fetchImageBuffer(src.pic),
      ]);

      return {
        index: idx,
        source: src,
        description: meta.description,
        tags: meta.tags,
        captionsText: meta.captionsText,
        thumbnail: thumb,
      };
    })
  );
}

const STYLE_LABELS: Record<DerivativeStylePreset, string> = {
  summary_fast: 'Tóm tắt & Điểm tin nhanh gọn, nhịp cắt dứt khoát',
  storytelling_review: 'Kể chuyện / Review cuốn hút có mở bài - cao trào - kết luận',
  top_list: 'Tổng hợp Top điểm nổi bật / So sánh góc nhìn đa chiều',
  tips_tutorial: 'Chắt lọc mẹo hay & hướng dẫn thực hành dễ áp dụng',
};

export async function learnVideosAndCreateBlueprint(params: {
  query?: string;
  videos: DerivativeSourceInput[];
  stylePreset: DerivativeStylePreset;
  aspectRatio: DerivativeAspectRatio;
  targetDuration: 'short' | 'medium';
  customInstruction?: string;
}): Promise<DerivativeBlueprint> {
  if (!params.videos || params.videos.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 video nguồn để AI học nội dung.');
  }

  const ai = getGeminiClient();
  const contexts = await gatherSourceContexts(params.videos);
  const desiredScenes = params.targetDuration === 'medium' ? 5 : 4;
  const desiredTotalSec = params.targetDuration === 'medium' ? 45 : 28;

  const parts: any[] = [];

  for (const ctx of contexts) {
    if (ctx.thumbnail) {
      parts.push({
        text: `[Ảnh đại diện Video #${ctx.index + 1} (${ctx.source.platformLabel}): ${ctx.source.translatedTitle || ctx.source.title}]`,
      });
      parts.push({
        inlineData: {
          mimeType: ctx.thumbnail.mimeType,
          data: ctx.thumbnail.buffer.toString('base64'),
        },
      });
    }
  }

  const dossierLines = contexts.map((ctx) => {
    const s = ctx.source;
    return [
      `=== VIDEO NGUỒN #${ctx.index + 1} (index=${ctx.index}) ===`,
      `- Nền tảng: ${s.platformLabel}`,
      `- Tiêu đề: ${s.translatedTitle ? `${s.translatedTitle} (Gốc: ${s.title})` : s.title}`,
      `- Kênh/Tác giả: ${s.author}`,
      `- Thời lượng gốc: ${s.duration > 0 ? `${s.duration} giây` : 'Chưa rõ'} | Lượt xem: ${s.views.toLocaleString('en-US')}`,
      ctx.tags.length > 0 ? `- Từ khóa/Tags: ${ctx.tags.join(', ')}` : '',
      ctx.description ? `- Mô tả nội dung:\n${ctx.description}` : '',
      ctx.captionsText ? `- Lời thoại/Phụ đề trích xuất:\n${ctx.captionsText}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  const promptText = `Bạn là Đạo diễn & Biên tập viên sáng tạo nội dung video ngắn/trung chuyên nghiệp bằng tiếng Việt.
Từ khóa/Chủ đề người dùng đang tìm kiếm: "${params.query?.trim() || 'Chủ đề tổng hợp từ các video đã chọn'}".
Phong cách video phái sinh mong muốn: ${STYLE_LABELS[params.stylePreset]}.
Tỉ lệ khung hình mục tiêu: ${params.aspectRatio}.
Tổng thời lượng mục tiêu: khoảng ${desiredTotalSec} giây chia thành đúng ${desiredScenes} phân cảnh (scenes).
${params.customInstruction?.trim() ? `Yêu cầu bổ sung từ người dùng: ${params.customInstruction.trim()}` : ''}

NHIỆM VỤ CỦA BẠN:
1. HỌC SÂU nội dung từ ${contexts.length} video nguồn dưới đây (dựa vào tiêu đề, mô tả, lời thoại/phụ đề thực tế và ảnh đại diện đi kèm):
   - Rút ra các kiến thức/luận điểm giá trị nhất, cách đặt hook thu hút, công thức giữ chân người xem.
   - Không dịch máy móc hay sao chép nguyên xi 1 video, mà TỔNG HỢP & TÁI SÁNG TẠO thành 1 kịch bản video phái sinh hoàn toàn mới mẻ, tự nhiên, hấp dẫn bằng tiếng Việt.
2. Với mỗi phân cảnh (sceneIndex 1..${desiredScenes}):
   - Chọn \`sourceVideoIndex\` (0 đến ${contexts.length - 1}) phù hợp nhất để lấy hình ảnh minh họa/trích đoạn.
   - Chọn \`sourceStartPercent\` (số nguyên 5..75) gợi ý điểm cắt tiêu biểu trong video gốc đó.
   - \`durationSec\`: thời lượng dự kiến của cảnh (6 đến 11 giây).
   - \`onScreenText\`: dòng chữ tiêu đề hiển thị trên khung hình (ngắn gọn, tối đa 12 chữ tiếng Việt có dấu chuẩn xác, dễ đọc trên điện thoại).
   - \`narration\`: lời thuyết minh tiếng Việt tự nhiên cho AI đọc lồng tiếng (khoảng 15–28 chữ khớp với \`durationSec\`, không dùng ký tự đặc biệt thừa hay hashtag trong lời đọc).
   - \`visualNote\`: ghi chú ngắn về bối cảnh hình ảnh cảnh này.

DỮ LIỆU CÁC VIDEO NGUỒN:
${dossierLines.join('\n\n')}`;

  parts.push({ text: promptText });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction:
          'Luôn phản hồi bằng JSON thuần túy đúng schema, nội dung tiếng Việt tự nhiên, sắc bén, giàu giá trị thông tin và tôn trọng nguyên tác bằng cách phái sinh góc nhìn tổng hợp mới.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            learnedSummary: {
              type: Type.STRING,
              description: 'Tóm tắt ngắn 2-3 câu về những nội dung cốt lõi AI học được từ các video nguồn.',
            },
            keyTakeaways: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 đến 5 gạch đầu dòng các kiến thức/ý tưởng đắt giá rút ra được.',
            },
            hookFormula: {
              type: Type.STRING,
              description: 'Công thức mở đầu & giữ chân người xem rút ra từ các video nguồn.',
            },
            sourceKeyPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Đúng bằng số lượng video nguồn: tóm tắt 1 câu bài học/điểm hay của từng video tương ứng theo thứ tự.',
            },
            derivativeTitle: {
              type: Type.STRING,
              description: 'Tiêu đề hấp dẫn cho video phái sinh mới.',
            },
            derivativeHook: {
              type: Type.STRING,
              description: 'Câu hook chữ nổi bật hiện 3.5 giây đầu video (tối đa 12 chữ).',
            },
            hashtags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 đến 6 hashtag phù hợp.',
            },
            scenes: {
              type: Type.ARRAY,
              description: `BẮT BUỘC phải trả về ĐÚNG ${desiredScenes} phân cảnh tách biệt (sceneIndex từ 1 đến ${desiredScenes}), không được gộp thành 1 cảnh duy nhất.`,
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneIndex: { type: Type.INTEGER },
                  durationSec: { type: Type.NUMBER },
                  sourceVideoIndex: { type: Type.INTEGER },
                  sourceStartPercent: { type: Type.INTEGER },
                  onScreenText: { type: Type.STRING },
                  narration: { type: Type.STRING },
                  visualNote: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);

    const rawScenes: any[] = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const scenes: DerivativeScene[] = rawScenes.slice(0, 8).map((sc, i) => {
      const idx = Math.max(0, Math.min(contexts.length - 1, Math.round(Number(sc?.sourceVideoIndex ?? i % contexts.length))));
      const dur = Math.max(4, Math.min(15, Number(sc?.durationSec || 7)));
      const startPct = Math.max(0, Math.min(80, Math.round(Number(sc?.sourceStartPercent ?? (i * 18) % 70))));
      return {
        id: `scene_${i + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sceneIndex: i + 1,
        durationSec: dur,
        sourceVideoIndex: idx,
        sourceStartPercent: startPct,
        onScreenText: String(sc?.onScreenText || `Phần ${i + 1}`).trim(),
        narration: String(sc?.narration || '').trim(),
        visualNote: String(sc?.visualNote || '').trim(),
      };
    });

    const sourceKeyPoints: string[] = Array.isArray(parsed?.sourceKeyPoints) ? parsed.sourceKeyPoints : [];
    const sourcesAnalyzed: DerivativeSourceInsight[] = contexts.map((ctx, i) => ({
      index: i,
      title: ctx.source.translatedTitle || ctx.source.title,
      platformLabel: ctx.source.platformLabel,
      author: ctx.source.author,
      hasDescription: Boolean(ctx.description),
      hasCaptions: Boolean(ctx.captionsText),
      hasThumbnail: Boolean(ctx.thumbnail),
      keyPoint: String(sourceKeyPoints[i] || ctx.description.slice(0, 120) || ctx.source.title),
    }));

    return {
      learnedSummary: String(parsed?.learnedSummary || 'Đã tổng hợp nội dung nổi bật từ các video đã chọn.'),
      keyTakeaways: Array.isArray(parsed?.keyTakeaways) ? parsed.keyTakeaways.map(String).slice(0, 6) : [],
      hookFormula: String(parsed?.hookFormula || 'Mở đầu trực diện vấn đề + chuyển cảnh nhanh + kết luận thực tế.'),
      derivativeTitle: String(parsed?.derivativeTitle || 'Video tổng hợp kiến thức mới'),
      derivativeHook: String(parsed?.derivativeHook || 'Đừng bỏ qua điểm mấu chốt này!'),
      hashtags: Array.isArray(parsed?.hashtags) ? parsed.hashtags.map(String).slice(0, 8) : [],
      aspectRatio: params.aspectRatio,
      sourcesAnalyzed,
      scenes:
        scenes.length > 0
          ? scenes
          : [
              {
                id: 'scene_1',
                sceneIndex: 1,
                durationSec: 7,
                sourceVideoIndex: 0,
                sourceStartPercent: 10,
                onScreenText: 'Tổng hợp nội dung nổi bật',
                narration: 'Dưới đây là những điểm quan trọng nhất được rút ra từ các video nổi bật về chủ đề này.',
                visualNote: 'Giới thiệu mở đầu',
              },
            ],
    };
  } catch (err: any) {
    throw new Error(formatGeminiError(err));
  }
}

// ==========================================
// DERIVATIVE VIDEO RENDERING (TTS + FFMPEG)
// ==========================================

function spawnPromise(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} quá thời gian chờ (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function probeDurationSeconds(filePath: string, cwd: string): Promise<number> {
  try {
    const res = await spawnPromise(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      cwd,
      15_000
    );
    const val = parseFloat(res.stdout.trim());
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

async function synthesizeSceneVoiceWav(
  ai: GoogleGenAI,
  text: string,
  voice: Exclude<DerivativeVoiceId, 'none'>,
  stylePrompt: string,
  outWavPath: string
): Promise<boolean> {
  const cleanText = text.trim();
  if (!cleanText) return false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const interaction = await ai.interactions.create({
        model: 'gemini-3.8-flash-lite-tts',
        input: [
          {
            type: 'text',
            text: cleanText,
            annotations: [
              {
                type: 'speech_metadata',
                style: stylePrompt,
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice }],
        },
      });

      const audio = interaction.output_audio;
      if (audio?.data) {
        fs.writeFileSync(outWavPath, Buffer.from(audio.data, 'base64'));
        return true;
      }
    } catch (err: any) {
      if (attempt === 2) {
        const msg = String(err?.message || err || '');
        if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID') || msg.includes('403')) {
          throw new Error(formatGeminiError(err));
        }
        return false;
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  return false;
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.min(99, Math.floor((s - Math.floor(s)) * 100));
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(t: string): string {
  return t.replace(/[\r\n]+/g, '\\N').replace(/\{/g, '(').replace(/\}/g, ')');
}

function buildAssSubtitlesFile(
  width: number,
  height: number,
  hookText: string,
  timeline: { start: number; end: number; caption: string }[]
): string {
  const isVertical = height > width;
  const hookFontSize = isVertical ? 54 : 48;
  const capFontSize = isVertical ? 48 : 42;
  const hookMarginV = isVertical ? 140 : 60;
  const capMarginV = isVertical ? 230 : 80;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 1',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Hook,DejaVu Sans,${hookFontSize},&H00FFFFFF,&H000000FF,&H00003B3E,&HCC003B3E,-1,0,0,0,100,100,0,0,3,18,0,8,56,56,${hookMarginV},1`,
    `Style: Caption,DejaVu Sans,${capFontSize},&H00FFFFFF,&H000000FF,&H00000000,&HAA000A10,-1,0,0,0,100,100,0,0,3,14,0,2,56,56,${capMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const cleanHook = escapeAssText(hookText.trim());
  if (cleanHook) {
    lines.push(`Dialogue: 1,0:00:00.00,${formatAssTime(Math.min(3.8, timeline[timeline.length - 1]?.end || 3.8))},Hook,,0,0,0,,${cleanHook}`);
  }

  for (const seg of timeline) {
    const cleanCap = escapeAssText(seg.caption.trim());
    if (!cleanCap) continue;
    lines.push(`Dialogue: 0,${formatAssTime(seg.start)},${formatAssTime(seg.end)},Caption,,0,0,0,,${cleanCap}`);
  }

  return lines.join('\n') + '\n';
}

export interface DownloadSourceClipResult {
  ok: boolean;
  reason?: string;
}

export type DownloadSourceClipFn = (
  source: DerivativeSourceInput,
  outPath: string
) => Promise<boolean | DownloadSourceClipResult>;

export interface StartDerivativeJobParams {
  blueprint: DerivativeBlueprint;
  sources: DerivativeSourceInput[];
  visualMode: DerivativeVisualMode;
  voice: DerivativeVoiceId;
  voiceStyle?: string;
  keepSourceAudio: boolean;
  downloadSourceVideo?: DownloadSourceClipFn;
}

export function startDerivativeVideoJob(params: StartDerivativeJobParams): DerivativeJobRecord {
  const jobId = `drv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const workDir = path.join(DERIVATIVE_BASE_DIR, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const safeTitle = params.blueprint.derivativeTitle
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'GaConPro_Derivative';
  const fileName = `${safeTitle}_PhaiSinh.mp4`;

  const job: DerivativeJobRecord = {
    jobId,
    status: 'queued',
    progress: 5,
    stepLabel: 'Đang khởi tạo tiến trình tạo video phái sinh...',
    workDir,
    fileName,
    warnings: [],
    createdAt: Date.now(),
  };
  derivativeJobs.set(jobId, job);

  void runDerivativePipeline(job, params).catch((err: any) => {
    job.status = 'error';
    job.error = formatGeminiError(err);
    job.stepLabel = 'Tạo video thất bại';
  });

  return job;
}

async function runDerivativePipeline(job: DerivativeJobRecord, params: StartDerivativeJobParams): Promise<void> {
  const { blueprint, sources, visualMode, voice, keepSourceAudio, downloadSourceVideo } = params;
  const scenes = blueprint.scenes.slice(0, 8);
  if (scenes.length === 0) {
    throw new Error('Kịch bản không có phân cảnh nào để dựng video.');
  }

  const isVertical = blueprint.aspectRatio === '9:16';
  const targetW = isVertical ? 1080 : 1920;
  const targetH = isVertical ? 1920 : 1080;
  job.resolution = `${targetW}x${targetH}`;

  // 1. Voiceover TTS generation (if enabled)
  const sceneAudioPaths: (string | null)[] = new Array(scenes.length).fill(null);
  const sceneTargetDurations: number[] = scenes.map((s) => Math.max(3.5, Number(s.durationSec || 6)));

  if (voice !== 'none') {
    job.status = 'tts';
    job.progress = 12;
    job.stepLabel = 'Đang tạo giọng đọc AI tiếng Việt cho từng phân cảnh...';
    const ai = getGeminiClient();
    const stylePrompt =
      params.voiceStyle?.trim() || 'Clear, engaging Vietnamese social video narrator with natural pacing';

    for (let i = 0; i < scenes.length; i += 1) {
      const sc = scenes[i];
      job.stepLabel = `Đang tổng hợp giọng đọc AI (${i + 1}/${scenes.length})...`;
      job.progress = 12 + Math.round(((i + 1) / scenes.length) * 23);

      const wavPath = path.join(job.workDir, `voice_${i}.wav`);
      const ok = await synthesizeSceneVoiceWav(ai, sc.narration, voice, stylePrompt, wavPath);
      if (ok) {
        sceneAudioPaths[i] = wavPath;
        const audioDur = await probeDurationSeconds(wavPath, job.workDir);
        if (audioDur > 0.5) {
          sceneTargetDurations[i] = Math.max(3.0, audioDur + 0.4);
        }
      } else if (sc.narration.trim()) {
        job.warnings.push(`Cảnh ${i + 1}: Không tạo được giọng đọc, giữ nhạc/nền tĩnh cho cảnh này.`);
      }
    }
  } else {
    job.progress = 30;
  }

  // 2. Gather visual assets (source videos if remix mode + thumbnails fallback)
  const downloadedSourceVideos = new Map<number, { path: string; duration: number }>();
  const thumbnailPaths = new Map<number, string>();

  job.status = 'downloading';
  job.stepLabel = 'Đang chuẩn bị tư liệu hình ảnh từ các video đã học...';

  const referencedIndices = Array.from(
    new Set(scenes.map((s) => Math.max(0, Math.min(sources.length - 1, s.sourceVideoIndex))))
  );

  // Download thumbnails for all referenced videos first (fast fallback & slideshow source)
  await Promise.all(
    referencedIndices.map(async (srcIdx) => {
      const src = sources[srcIdx];
      if (!src) return;
      const img = await fetchImageBuffer(src.pic);
      if (img) {
        const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
        const imgPath = path.join(job.workDir, `thumb_${srcIdx}.${ext}`);
        fs.writeFileSync(imgPath, img.buffer);
        thumbnailPaths.set(srcIdx, imgPath);
      }
    })
  );

  if (visualMode === 'remix' && downloadSourceVideo) {
    for (let k = 0; k < referencedIndices.length; k += 1) {
      const srcIdx = referencedIndices[k];
      const src = sources[srcIdx];
      if (!src) continue;
      job.stepLabel = `Đang tải video nguồn #${srcIdx + 1} (${src.platformLabel}) để trích đoạn...`;
      job.progress = 36 + Math.round(((k + 1) / Math.max(1, referencedIndices.length)) * 24);
      const vidOutPath = path.join(job.workDir, `src_video_${srcIdx}.mp4`);
      try {
        const dlRes = await downloadSourceVideo(src, vidOutPath);
        const ok = typeof dlRes === 'boolean' ? dlRes : Boolean(dlRes?.ok);
        const reason = typeof dlRes === 'object' && dlRes ? dlRes.reason : undefined;
        if (ok && fs.existsSync(vidOutPath) && fs.statSync(vidOutPath).size > 20_000) {
          const dur = await probeDurationSeconds(vidOutPath, job.workDir);
          downloadedSourceVideos.set(srcIdx, { path: vidOutPath, duration: dur > 0 ? dur : 30 });
        } else {
          job.warnings.push(
            reason
              ? `Video nguồn #${srcIdx + 1} (${src.platformLabel}): ${reason} — tự động chuyển sang ảnh chuyển động Ken Burns.`
              : `Video nguồn #${srcIdx + 1} (${src.platformLabel}) chưa trích xuất trực tiếp được — tự động chuyển sang ảnh chuyển động Ken Burns.`
          );
        }
      } catch (dlErr: any) {
        const msg = String(dlErr?.message || '').trim();
        job.warnings.push(
          msg
            ? `Video nguồn #${srcIdx + 1} (${src.platformLabel}): ${msg} — tự động dùng ảnh chuyển động Ken Burns.`
            : `Video nguồn #${srcIdx + 1} (${src.platformLabel}) không thể tải về — tự động dùng ảnh chuyển động Ken Burns.`
        );
      }
    }
  } else {
    job.progress = 55;
  }

  // 3. Render each normalized scene clip (matching exact width, height, fps, audio)
  job.status = 'rendering';
  const sceneVideoFiles: string[] = [];
  const subtitleTimeline: { start: number; end: number; caption: string }[] = [];
  let cursorSec = 0;

  for (let i = 0; i < scenes.length; i += 1) {
    const sc = scenes[i];
    const srcIdx = Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex));
    const sceneDur = Number(sceneTargetDurations[i].toFixed(2));
    job.stepLabel = `Đang dựng phân cảnh ${i + 1}/${scenes.length} bằng FFmpeg...`;
    job.progress = 62 + Math.round(((i + 1) / scenes.length) * 25);

    const outScenePath = path.join(job.workDir, `scene_${i}.mp4`);
    const audioWav = sceneAudioPaths[i];
    const srcVideo = downloadedSourceVideos.get(srcIdx);
    const thumbFile = thumbnailPaths.get(srcIdx);

    const canvasFilter =
      `[0:v]split[bg][fg];` +
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=18:2,setsar=1[bgblur];` +
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
      `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[vout]`;

    let args: string[] = [];

    if (srcVideo) {
      const startSec = Math.max(
        0,
        Math.min(Math.max(0, srcVideo.duration - sceneDur), (sc.sourceStartPercent / 100) * srcVideo.duration)
      );
      if (audioWav && keepSourceAudio) {
        args = [
          '-y',
          '-ss',
          startSec.toFixed(2),
          '-t',
          sceneDur.toFixed(2),
          '-i',
          path.basename(srcVideo.path),
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[0:a]aresample=44100,volume=0.12[abg];[1:a]aresample=44100,volume=1.35[avoice];[abg][avoice]amix=inputs=2:duration=longest:dropout_transition=0.2[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else if (audioWav) {
        args = [
          '-y',
          '-ss',
          startSec.toFixed(2),
          '-t',
          sceneDur.toFixed(2),
          '-i',
          path.basename(srcVideo.path),
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[1:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else {
        // No TTS voice: either keep original audio or generate silence
        args = [
          '-y',
          '-ss',
          startSec.toFixed(2),
          '-t',
          sceneDur.toFixed(2),
          '-i',
          path.basename(srcVideo.path),
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          canvasFilter,
          '-map',
          '[vout]',
          '-map',
          keepSourceAudio ? '0:a?' : '1:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    } else if (thumbFile) {
      // Motion Ken Burns on thumbnail image
      const frames = Math.max(90, Math.round(sceneDur * 30));
      const zoomExpr =
        i % 2 === 0
          ? `zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${targetW}x${targetH}:fps=30`
          : `zoompan=z='if(lte(zoom,1.0),1.18,max(1.0,zoom-0.0012))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${targetW}x${targetH}:fps=30`;

      const thumbFilter =
        `[0:v]split[bg][fg];` +
        `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:2,setsar=1[bgblur];` +
        `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
        `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,${zoomExpr},format=yuv420p[vout]`;

      if (audioWav) {
        args = [
          '-y',
          '-loop',
          '1',
          '-i',
          path.basename(thumbFile),
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${thumbFilter};[1:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else {
        args = [
          '-y',
          '-loop',
          '1',
          '-i',
          path.basename(thumbFile),
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          thumbFilter,
          '-map',
          '[vout]',
          '-map',
          '1:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    } else {
      // Solid styled brand backdrop fallback if neither video nor thumbnail downloaded
      const solidFilter = `color=c=#001722:s=${targetW}x${targetH}:d=${sceneDur.toFixed(2)}:r=30,format=yuv420p[vout]`;
      if (audioWav) {
        args = [
          '-y',
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${solidFilter};[0:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      } else {
        args = [
          '-y',
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          solidFilter,
          '-map',
          '[vout]',
          '-map',
          '0:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    }

    let renderRes = await spawnPromise('ffmpeg', args, job.workDir, 120_000);
    // Fallback if source video lacked an audio stream when keepSourceAudio=true or filter rejected
    if (renderRes.code !== 0 && srcVideo) {
      const noAudioFallbackArgs = [
        '-y',
        '-ss',
        '0',
        '-t',
        sceneDur.toFixed(2),
        '-i',
        path.basename(srcVideo.path),
        ...(audioWav
          ? ['-i', path.basename(audioWav)]
          : ['-f', 'lavfi', '-t', sceneDur.toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo']),
        '-filter_complex',
        `${canvasFilter};[1:a]aresample=44100,apad[aout]`,
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-t',
        sceneDur.toFixed(2),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        path.basename(outScenePath),
      ];
      renderRes = await spawnPromise('ffmpeg', noAudioFallbackArgs, job.workDir, 120_000);
    }

    if (renderRes.code !== 0 || !fs.existsSync(outScenePath)) {
      throw new Error(`FFmpeg lỗi khi dựng cảnh ${i + 1}: ${renderRes.stderr.slice(-260)}`);
    }

    const actualDur = (await probeDurationSeconds(outScenePath, job.workDir)) || sceneDur;
    subtitleTimeline.push({
      start: cursorSec,
      end: cursorSec + actualDur,
      caption: sc.onScreenText,
    });
    cursorSec += actualDur;
    sceneVideoFiles.push(path.basename(outScenePath));
  }

  // 4. Concatenate all scenes + burn Vietnamese ASS hook & captions + faststart
  job.stepLabel = 'Đang ghép hoàn thiện video phái sinh & chèn phụ đề...';
  job.progress = 91;

  const concatTxtPath = path.join(job.workDir, 'concat.txt');
  fs.writeFileSync(
    concatTxtPath,
    sceneVideoFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    'utf8'
  );

  const assContent = buildAssSubtitlesFile(targetW, targetH, blueprint.derivativeHook, subtitleTimeline);
  fs.writeFileSync(path.join(job.workDir, 'subtitles.ass'), assContent, 'utf8');

  const finalOutPath = path.join(job.workDir, 'final_derivative.mp4');
  let finalRes = await spawnPromise(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-vf',
      'ass=subtitles.ass',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      'final_derivative.mp4',
    ],
    job.workDir,
    180_000
  );

  // If libass is unavailable on a minimal FFmpeg build, gracefully concat without ASS subtitles
  if (finalRes.code !== 0 || !fs.existsSync(finalOutPath)) {
    job.warnings.push('FFmpeg trên máy không hỗ trợ libass, đã xuất video không kèm chữ phụ đề.');
    finalRes = await spawnPromise(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'concat.txt',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        'final_derivative.mp4',
      ],
      job.workDir,
      120_000
    );
  }

  if (finalRes.code !== 0 || !fs.existsSync(finalOutPath)) {
    throw new Error(`Không thể xuất tệp video phái sinh: ${finalRes.stderr.slice(-260)}`);
  }

  const stat = fs.statSync(finalOutPath);
  const totalDuration = (await probeDurationSeconds(finalOutPath, job.workDir)) || cursorSec;

  job.outputPath = finalOutPath;
  job.fileSize = stat.size;
  job.durationSec = Math.round(totalDuration * 10) / 10;
  job.status = 'completed';
  job.progress = 100;
  job.stepLabel = 'Hoàn tất video phái sinh!';
}
