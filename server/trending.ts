import crypto from 'crypto';

export type VideoPlatform =
  | 'bilibili'
  | 'youtube'
  | 'tiktok'
  | 'douyin'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'weibo'
  | 'xigua'
  | 'dailymotion'
  | 'facebook'
  | 'other';

export type TrendingPlatformId =
  | 'all'
  | 'youtube'
  | 'tiktok'
  | 'douyin'
  | 'bilibili'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'weibo'
  | 'xigua'
  | 'dailymotion';

export interface TrendingVideoItem {
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
  comments?: number;
  pubdate?: number;
  publishedText?: string;
  score: number;
  velocityPerHour?: number;
  category: string;
  categoryLabel: string;
  orientation: 'vertical' | 'horizontal' | 'unknown';
  rank?: number;
}

export interface TrendingTopicItem {
  id: string;
  platform: VideoPlatform;
  platformLabel: string;
  rank: number;
  title: string;
  translatedTitle?: string;
  hotValue: number;
  videoCount?: number;
  tag?: string;
  pic?: string;
  url: string;
  eventTime?: number;
}

export interface TrendingPlatformStatus {
  platform: TrendingPlatformId;
  label: string;
  status: 'ok' | 'partial' | 'cookie_required' | 'unavailable';
  count: number;
  message?: string;
  exploreUrl: string;
}

export interface TrendingQueryOptions {
  platform: TrendingPlatformId;
  category: string;
  duration: 'all' | 'short' | 'medium' | 'long';
  orientation: 'all' | 'vertical' | 'horizontal';
  sort: 'best' | 'rising' | 'views' | 'engagement' | 'newest';
  q: string;
  region: 'VN' | 'GLOBAL' | 'CN';
  refresh?: boolean;
  sessdata?: string;
  extraCookies?: string;
}

export interface TrendingApiResponse {
  videos: TrendingVideoItem[];
  topics: TrendingTopicItem[];
  platformStatuses: TrendingPlatformStatus[];
  updatedAt: number;
  fromCache?: boolean;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORY_LABELS: Record<string, string> = {
  all: 'Đang hot',
  knowledge: 'Kiến thức',
  shortfilm: 'Phim ngắn',
  food: 'Ẩm thực',
  pets: 'Thú cưng',
  rural: 'Nông thôn',
  travel: 'Du lịch',
  auto: 'Ô tô',
  tech: 'Công nghệ',
  ai: 'AI',
  entertainment: 'Giải trí',
  sports: 'Thể thao',
  diy: 'Thủ công',
  vlog: 'Vlog',
  gaming: 'Game',
  anime: 'Anime',
  music: 'Âm nhạc',
  comedy: 'Chế / Hài',
  dance: 'Nhảy',
};

const CACHE_TTL_MS = 4 * 60 * 1000;
const trendingCache = new Map<string, { data: Omit<TrendingApiResponse, 'fromCache'>; expiresAt: number }>();
const searchCache = new Map<string, { data: Omit<SearchApiResponse, 'fromCache'>; expiresAt: number }>();

let cachedTrendingBuvid = '';
let cachedTrendingBuvidExp = 0;

async function getTrendingBiliHeaders(sessdata?: string): Promise<Record<string, string>> {
  if (!cachedTrendingBuvid || Date.now() >= cachedTrendingBuvidExp) {
    try {
      const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const j = (await res.json()) as any;
        if (j?.code === 0 && j?.data?.b_3) {
          cachedTrendingBuvid = `buvid3=${j.data.b_3}; buvid4=${j.data.b_4 || ''}`;
          cachedTrendingBuvidExp = Date.now() + 30 * 60 * 1000;
        }
      }
    } catch {
      // ignore
    }
  }
  const cookies: string[] = [];
  if (cachedTrendingBuvid) cookies.push(cachedTrendingBuvid);
  if (sessdata?.trim()) cookies.push(`SESSDATA=${sessdata.trim()}`);
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Accept: 'application/json, text/plain, */*',
    ...(cookies.length > 0 ? { Cookie: cookies.join('; ') } : {}),
  };
}

export type SearchSortOption = 'relevance' | 'views' | 'newest' | 'engagement';

export interface SearchQueryOptions {
  q: string;
  platform: TrendingPlatformId;
  duration: 'all' | 'short' | 'medium' | 'long';
  orientation: 'all' | 'vertical' | 'horizontal';
  sort: SearchSortOption;
  region: 'VN' | 'GLOBAL' | 'CN';
  page?: number;
  refresh?: boolean;
  sessdata?: string;
  extraCookies?: string;
}

export interface SearchApiResponse {
  query: string;
  videos: TrendingVideoItem[];
  platformStatuses: TrendingPlatformStatus[];
  updatedAt: number;
  fromCache?: boolean;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseChineseOrCompactNum(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const s = String(raw || '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!s) return 0;
  const wanMatch = s.match(/([\d.]+)\s*万/);
  if (wanMatch) return Math.round(parseFloat(wanMatch[1]) * 10_000);
  const yiMatch = s.match(/([\d.]+)\s*亿/);
  if (yiMatch) return Math.round(parseFloat(yiMatch[1]) * 100_000_000);
  const trMatch = s.match(/([\d.]+)\s*(?:Tr|tr|M|m)/);
  if (trMatch) return Math.round(parseFloat(trMatch[1]) * 1_000_000);
  const kMatch = s.match(/([\d.]+)\s*(?:K|k|N)/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);
  const digits = s.replace(/[^\d.]/g, '');
  const val = parseFloat(digits);
  return Number.isFinite(val) ? Math.round(val) : 0;
}

function parseYouTubeViewCount(raw?: string): number {
  if (!raw) return 0;
  const clean = raw.toLowerCase().trim();
  // Vietnamese style e.g. "1,2 Tr lượt xem" or "462.943.878 lượt xem" or "90 N lượt xem"
  const unitMatch = clean.match(/([\d.,]+)\s*(tr|triệu|tỷ|ty|n|nghìn|k|m|b)\b/i);
  if (unitMatch) {
    const normalizedNum = parseFloat(unitMatch[1].replace(/\./g, '').replace(',', '.')) || 0;
    const u = unitMatch[2].toLowerCase();
    if (u === 'tỷ' || u === 'ty' || u === 'b') return Math.round(normalizedNum * 1_000_000_000);
    if (u === 'tr' || u === 'triệu' || u === 'm') return Math.round(normalizedNum * 1_000_000);
    if (u === 'n' || u === 'nghìn' || u === 'k') return Math.round(normalizedNum * 1_000);
  }
  const justDigits = clean.replace(/[^\d]/g, '');
  return parseInt(justDigits, 10) || 0;
}

function parseDurationText(raw?: string): number {
  if (!raw) return 0;
  const parts = raw
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function parseRelativeTimeToUnix(text?: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const numMatch = lower.match(/(\d+)/);
  const val = numMatch ? parseInt(numMatch[1], 10) : 1;
  const now = Math.floor(Date.now() / 1000);
  if (/phút|minute|min/.test(lower)) return now - val * 60;
  if (/giờ|hour|hr/.test(lower)) return now - val * 3600;
  if (/ngày|day/.test(lower)) return now - val * 86400;
  if (/tuần|week/.test(lower)) return now - val * 86400 * 7;
  if (/tháng|month/.test(lower)) return now - val * 86400 * 30;
  if (/năm|year/.test(lower)) return now - val * 86400 * 365;
  return 0;
}

function inferCategoryFromText(text: string, fallbackCat = 'all'): { id: string; label: string } {
  const t = text.toLowerCase();
  const rules: [string, RegExp][] = [
    ['ai', /\b(ai|artificial intelligence|chatgpt|sora|midjourney|deepseek|claude)\b|人工智能|大模型|ai灵境/i],
    ['pets', /宠物|猫|狗|仓鼠|萌宠|pet|cat|dog|puppy|kitten|thú cưng|mèo|chó/i],
    ['food', /美食|吃|雪糕|烧烤|做饭|料理|food|cooking|recipe|mukbang|ẩm thực|nấu ăn|món ngon/i],
    ['gaming', /游戏|英雄联盟|lol|blg|t1|gen|王者|原神|game|gaming|esports|valorant|lien quan/i],
    ['anime', /动漫|动画|二次元|鬼畜|anime|manga|cosplay|hoạt hình/i],
    ['music', /音乐|mv|翻唱|歌|music|song|remix|concert|nhạc|ca khúc/i],
    ['dance', /舞|跳舞|dance|choreography|nhảy/i],
    ['sports', /体育|足球|篮球|泰拳|冠军|sport|football|nba|ufc|bóng đá|thể thao/i],
    ['tech', /科技|数码|手机|电脑|tech|iphone|review|gadget|công nghệ/i],
    ['auto', /汽车|车|跑车|car|auto|driving|xe hơi|ô tô/i],
    ['travel', /旅游|风景|出行|travel|trip|tour|du lịch/i],
    ['rural', /农村|乡村|三农|种地|rural|farm|nông thôn|miền quê/i],
    ['diy', /手工|制作|diy|craft|handmade|thủ công|tự làm/i],
    ['knowledge', /科普|知识|历史|科学|knowledge|science|explain|kiến thức/i],
    ['comedy', /搞笑|喜剧|段子|comedy|funny|meme|hài|chế/i],
    ['shortfilm', /短剧|电影|影视|剧|movie|film|drama|phim ngắn/i],
    ['vlog', /vlog|日常|生活|life|nhật ký/i],
  ];
  for (const [id, regex] of rules) {
    if (regex.test(t)) {
      return { id, label: CATEGORY_LABELS[id] || id };
    }
  }
  const cat = fallbackCat !== 'all' ? fallbackCat : 'entertainment';
  return { id: cat, label: CATEGORY_LABELS[cat] || 'Đang hot' };
}

function computeScoreAndVelocity(
  views: number,
  likes = 0,
  comments = 0,
  pubdate = 0,
  rank?: number
): { score: number; velocityPerHour: number } {
  const now = Math.floor(Date.now() / 1000);
  const ageHours = pubdate > 0 ? Math.max(1, (now - pubdate) / 3600) : 24;
  const velocityPerHour = views > 0 ? Math.round(views / ageHours) : 0;

  const viewScore = views > 0 ? Math.min(48, Math.log10(views + 10) * 6.4) : 18;
  const velocityScore = velocityPerHour > 0 ? Math.min(28, Math.log10(velocityPerHour + 10) * 4.5) : 12;
  const engRatio = views > 0 && likes > 0 ? Math.min(0.15, (likes + comments * 2) / views) : 0.03;
  const engScore = Math.min(18, (engRatio / 0.12) * 18);
  const rankBonus = rank && rank <= 10 ? Math.max(0, 12 - rank) : 0;

  const total = Math.max(35, Math.min(99, Math.round(viewScore + velocityScore + engScore + rankBonus)));
  return { score: total, velocityPerHour };
}

export function detectPlatformFromUrl(urlStr: string): VideoPlatform {
  const lower = urlStr.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('youtube-nocookie.com')) {
    return 'youtube';
  }
  if (lower.includes('bilibili.com') || lower.includes('b23.tv') || /^(BV[1-9A-HJ-NP-Za-km-z]{10}|av\d+)$/i.test(urlStr.trim())) {
    return 'bilibili';
  }
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('douyin.com') || lower.includes('iesdouyin.com')) return 'douyin';
  if (lower.includes('kuaishou.com')) return 'kuaishou';
  if (lower.includes('xiaohongshu.com') || lower.includes('xhslink.com')) return 'xiaohongshu';
  if (lower.includes('weibo.com') || lower.includes('weibo.cn')) return 'weibo';
  if (lower.includes('ixigua.com')) return 'xigua';
  if (lower.includes('dailymotion.com') || lower.includes('dai.ly')) return 'dailymotion';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || /(?:^|\/)fb\.com\//i.test(lower)) {
    return 'facebook';
  }
  return 'other';
}

// ==========================================
// 1. BILIBILI
// ==========================================
const BILI_RID_MAP: Record<string, number> = {
  all: 0,
  anime: 1,
  music: 3,
  dance: 129,
  gaming: 4,
  knowledge: 36,
  tech: 188,
  sports: 234,
  auto: 223,
  vlog: 160,
  food: 211,
  pets: 217,
  comedy: 119,
  entertainment: 5,
  shortfilm: 181,
};

const BILI_SEARCH_MAP: Record<string, string> = {
  ai: 'AI 人工智能',
  rural: '农村 日常',
  travel: '旅游 Vlog',
  diy: '手工 DIY',
};

async function fetchBilibiliTrending(
  category: string,
  q: string,
  sessdata?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const headers = await getTrendingBiliHeaders(sessdata);

  try {
    const queryKeyword = q.trim() || BILI_SEARCH_MAP[category] || '';
    if (queryKeyword) {
      const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=click&keyword=${encodeURIComponent(
        queryKeyword
      )}&page=1&page_size=28`;
      const res = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(7000) });
      const json = (await res.json()) as any;
      const list: any[] = Array.isArray(json?.data?.result) ? json.data.result : [];
      if (list.length > 0) {
        const videos = list
          .filter((v) => v.bvid)
          .map((v, idx) => {
            const title = decodeHtmlEntities(String(v.title || v.bvid));
            const views = Number(v.play || 0);
            const likes = Number(v.like || 0);
            const comments = Number(v.review || v.video_review || 0);
            const pubdate = Number(v.pubdate || 0);
            const durParts = String(v.duration || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
            const duration = durParts.length === 2 ? durParts[0] * 60 + durParts[1] : 0;
            const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, comments, pubdate, idx + 1);
            const cat = inferCategoryFromText(`${title} ${v.typename || ''}`, category);
            return {
              id: `bili_${v.bvid}`,
              platform: 'bilibili' as VideoPlatform,
              platformLabel: 'Bilibili',
              title,
              author: v.author || 'Bilibili',
              pic: String(v.pic || '').startsWith('//')
                ? `https:${v.pic}`
                : String(v.pic || '').replace(/^http:/, 'https:'),
              sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
              duration,
              views,
              likes,
              comments,
              pubdate,
              score,
              velocityPerHour,
              category: cat.id,
              categoryLabel: v.typename || cat.label,
              orientation: 'horizontal' as const,
              rank: idx + 1,
            };
          });
        return {
          videos,
          status: {
            platform: 'bilibili',
            label: 'Bilibili',
            status: 'ok',
            count: videos.length,
            exploreUrl: 'https://www.bilibili.com/v/popular/all',
          },
        };
      }
    }

    const rid = BILI_RID_MAP[category] ?? 0;
    const endpoint =
      category === 'all'
        ? 'https://api.bilibili.com/x/web-interface/popular?ps=36&pn=1'
        : `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`;

    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(7000) });
    const json = (await res.json()) as any;
    const list: any[] = Array.isArray(json?.data?.list) ? json.data.list : [];

    const videos: TrendingVideoItem[] = list
      .filter((v) => v?.bvid)
      .slice(0, 36)
      .map((v, idx) => {
        const title = decodeHtmlEntities(String(v.title || v.bvid));
        const views = Number(v.stat?.view || 0);
        const likes = Number(v.stat?.like || 0);
        const comments = Number(v.stat?.reply || 0);
        const pubdate = Number(v.pubdate || v.ctime || 0);
        const w = Number(v.dimension?.width || 0);
        const h = Number(v.dimension?.height || 0);
        const orientation: 'vertical' | 'horizontal' | 'unknown' =
          w > 0 && h > 0 ? (h > w ? 'vertical' : 'horizontal') : 'horizontal';
        const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, comments, pubdate, idx + 1);
        const cat =
          category !== 'all'
            ? { id: category, label: CATEGORY_LABELS[category] || v.tname || 'Đang hot' }
            : inferCategoryFromText(`${title} ${v.tname || ''}`, 'all');

        return {
          id: `bili_${v.bvid}`,
          platform: 'bilibili',
          platformLabel: 'Bilibili',
          title,
          author: v.owner?.name || 'Bilibili Creator',
          pic: String(v.pic || '').replace(/^http:/, 'https:'),
          sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
          duration: Number(v.duration || 0),
          views,
          likes,
          comments,
          pubdate,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: v.tname || cat.label,
          orientation,
          rank: idx + 1,
        };
      });

    return {
      videos,
      status: {
        platform: 'bilibili',
        label: 'Bilibili',
        status: videos.length > 0 ? 'ok' : 'partial',
        count: videos.length,
        exploreUrl: 'https://www.bilibili.com/v/popular/all',
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'bilibili',
        label: 'Bilibili',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Không thể lấy dữ liệu Bilibili',
        exploreUrl: 'https://www.bilibili.com/v/popular/all',
      },
    };
  }
}

// ==========================================
// 2. YOUTUBE
// ==========================================
const YT_CATEGORY_QUERIES: Record<string, { vn: string; global: string; cn: string }> = {
  all: { vn: 'thịnh hành viral shorts 2026', global: 'trending viral shorts 2026', cn: '热门视频 shorts 2026' },
  knowledge: { vn: 'kiến thức thú vị khoa học', global: 'science explained interesting facts', cn: '科普 知识 历史' },
  shortfilm: { vn: 'phim ngắn hay 2026', global: 'award winning short film', cn: '短剧 微电影' },
  food: { vn: 'ẩm thực đường phố món ngon', global: 'street food cooking viral', cn: '美食 教程 试吃' },
  pets: { vn: 'thú cưng mèo chó hài hước', global: 'funny cute pets cats dogs shorts', cn: '萌宠 猫咪 狗狗' },
  rural: { vn: 'cuộc sống miền quê nông thôn', global: 'countryside rural life farming vlog', cn: '农村 乡村 生活' },
  travel: { vn: 'du lịch khám phá vlog', global: 'travel adventure vlog 4k', cn: '旅游 风景 vlog' },
  auto: { vn: 'review siêu xe ô tô độ', global: 'supercar review automotive', cn: '汽车 测评 改装' },
  tech: { vn: 'công nghệ smartphone mới', global: 'tech gadgets review 2026', cn: '数码 科技 评测' },
  ai: { vn: 'trí tuệ nhân tạo AI mới nhất', global: 'AI artificial intelligence tools 2026', cn: 'AI 人工智能 大模型' },
  entertainment: { vn: 'giải trí showbiz viral', global: 'entertainment viral showbiz', cn: '娱乐 综艺 明星' },
  sports: { vn: 'bóng đá thể thao highlights', global: 'sports football highlights', cn: '体育 足球 比赛' },
  diy: { vn: 'tự làm thủ công sáng tạo diy', global: 'diy handmade crafts satisfying', cn: '手工 制作 DIY' },
  vlog: { vn: 'daily vlog một ngày', global: 'day in the life vlog aesthetic', cn: '日常 vlog 生活' },
  gaming: { vn: 'game hot highlights 2026', global: 'gaming highlights esports 2026', cn: '游戏 实况 英雄联盟' },
  anime: { vn: 'anime edits amv mới', global: 'anime amv edits 2026', cn: '动漫 混剪 二次元' },
  music: { vn: 'nhạc trẻ hot remix 2026', global: 'top music video hits 2026', cn: '音乐 MV 热歌' },
  comedy: { vn: 'hài chế shorts cười xỉu', global: 'funny comedy shorts try not to laugh', cn: '搞笑 沙雕 短视频' },
  dance: { vn: 'nhảy cover dance trend', global: 'dance trend choreography shorts', cn: '跳舞 编舞 翻跳' },
};

function parseYtInitialDataVideos(html: string, defaultCategory: string): TrendingVideoItem[] {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
  if (!m) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const results: TrendingVideoItem[] = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || results.length >= 32) return;

    const vr = node.videoRenderer || node.gridVideoRenderer;
    if (vr && vr.videoId && !seen.has(vr.videoId)) {
      const vid = String(vr.videoId);
      seen.add(vid);
      const title =
        vr.title?.runs?.map((r: any) => r.text).join('') ||
        vr.title?.simpleText ||
        vid;
      const viewsRaw = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || '';
      const views = parseYouTubeViewCount(viewsRaw);
      const lenRaw = vr.lengthText?.simpleText || '';
      const duration = parseDurationText(lenRaw);
      const pubText = vr.publishedTimeText?.simpleText || '';
      const pubdate = parseRelativeTimeToUnix(pubText);
      const author =
        vr.ownerText?.runs?.[0]?.text ||
        vr.longBylineText?.runs?.[0]?.text ||
        vr.shortBylineText?.runs?.[0]?.text ||
        'YouTube';
      const thumbs: any[] = Array.isArray(vr.thumbnail?.thumbnails) ? vr.thumbnail.thumbnails : [];
      const pic = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const isShortsUrl = Boolean(vr.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes('/shorts/'));
      const isVertical = isShortsUrl || (duration > 0 && duration <= 62 && /#shorts|shorts/i.test(title));
      const { score, velocityPerHour } = computeScoreAndVelocity(views, 0, 0, pubdate, results.length + 1);
      const cat =
        defaultCategory !== 'all'
          ? { id: defaultCategory, label: CATEGORY_LABELS[defaultCategory] || 'YouTube' }
          : inferCategoryFromText(title, 'all');

      results.push({
        id: `yt_${vid}`,
        platform: 'youtube',
        platformLabel: 'YouTube',
        title,
        author,
        pic,
        sourceUrl: isShortsUrl ? `https://www.youtube.com/shorts/${vid}` : `https://www.youtube.com/watch?v=${vid}`,
        duration,
        views,
        pubdate,
        publishedText: pubText,
        score,
        velocityPerHour,
        category: cat.id,
        categoryLabel: cat.label,
        orientation: isVertical ? 'vertical' : 'horizontal',
        rank: results.length + 1,
      });
      return;
    }

    const reel = node.reelItemRenderer;
    if (reel && reel.videoId && !seen.has(reel.videoId)) {
      const vid = String(reel.videoId);
      seen.add(vid);
      const title = reel.headline?.simpleText || vid;
      const views = parseYouTubeViewCount(reel.viewCountText?.simpleText || '');
      const pic = reel.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const { score, velocityPerHour } = computeScoreAndVelocity(views, 0, 0, 0, results.length + 1);
      const cat =
        defaultCategory !== 'all'
          ? { id: defaultCategory, label: CATEGORY_LABELS[defaultCategory] || 'Shorts' }
          : inferCategoryFromText(title, 'all');
      results.push({
        id: `yt_${vid}`,
        platform: 'youtube',
        platformLabel: 'YouTube',
        title,
        author: 'YouTube Shorts',
        pic,
        sourceUrl: `https://www.youtube.com/shorts/${vid}`,
        duration: 45,
        views,
        score,
        velocityPerHour,
        category: cat.id,
        categoryLabel: cat.label,
        orientation: 'vertical',
        rank: results.length + 1,
      });
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else {
      for (const key of Object.keys(node)) {
        walk(node[key]);
      }
    }
  };

  walk(parsed);
  return results;
}

async function fetchYouTubeTrending(
  category: string,
  q: string,
  region: 'VN' | 'GLOBAL' | 'CN'
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const gl = region === 'VN' ? 'VN' : region === 'CN' ? 'TW' : 'US';
  const hl = region === 'VN' ? 'vi' : region === 'CN' ? 'zh-CN' : 'en';
  const acceptLang = region === 'VN' ? 'vi-VN,vi;q=0.9,en;q=0.8' : 'en-US,en;q=0.9';

  try {
    const urlsToFetch: string[] = [];
    if (q.trim()) {
      // Search sorted by view count (CAM%3D) + relevance
      urlsToFetch.push(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q.trim())}&sp=CAM%253D&gl=${gl}&hl=${hl}`
      );
    } else if (category === 'gaming') {
      urlsToFetch.push(`https://www.youtube.com/gaming/trending?gl=${gl}&hl=${hl}`);
    } else {
      const catMap = YT_CATEGORY_QUERIES[category] || YT_CATEGORY_QUERIES.all;
      const queryStr = region === 'VN' ? catMap.vn : region === 'CN' ? catMap.cn : catMap.global;
      // sp=CAMSAhAB -> Videos uploaded / sorted by view count; CAM%3D -> sorted by view count
      urlsToFetch.push(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(queryStr)}&sp=CAM%253D&gl=${gl}&hl=${hl}`
      );
      if (category === 'all') {
        urlsToFetch.push(`https://www.youtube.com/gaming/trending?gl=${gl}&hl=${hl}`);
      }
    }

    const fetchedPages = await Promise.allSettled(
      urlsToFetch.map((u) =>
        fetch(u, {
          headers: { 'User-Agent': UA, 'Accept-Language': acceptLang },
          signal: AbortSignal.timeout(8000),
        }).then((r) => r.text())
      )
    );

    const combined: TrendingVideoItem[] = [];
    const seenIds = new Set<string>();
    for (const res of fetchedPages) {
      if (res.status !== 'fulfilled') continue;
      const vids = parseYtInitialDataVideos(res.value, category);
      for (const v of vids) {
        if (!seenIds.has(v.id)) {
          seenIds.add(v.id);
          combined.push(v);
        }
      }
    }

    return {
      videos: combined.slice(0, 32),
      status: {
        platform: 'youtube',
        label: 'YouTube',
        status: combined.length > 0 ? 'ok' : 'partial',
        count: combined.length,
        exploreUrl: 'https://www.youtube.com',
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'youtube',
        label: 'YouTube',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Không thể lấy dữ liệu YouTube',
        exploreUrl: 'https://www.youtube.com',
      },
    };
  }
}

// ==========================================
// 3. DOUYIN (Real Videos via Tophub Douyin + Official Hot Search Topics)
// ==========================================
async function fetchDouyinTrending(
  category: string,
  q: string
): Promise<{
  videos: TrendingVideoItem[];
  topics: TrendingTopicItem[];
  status: TrendingPlatformStatus;
}> {
  const videos: TrendingVideoItem[] = [];
  const topics: TrendingTopicItem[] = [];

  const boardPaths =
    category === 'sports'
      ? ['/n/3adqqzadng', '/n/DpQvNABoNE']
      : ['/n/DpQvNABoNE', '/n/3adqqzadng'];

  const [boardResults, hotSearchRes] = await Promise.allSettled([
    Promise.allSettled(
      boardPaths.map((p) =>
        fetch(`https://tophub.today${p}`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(7000),
        }).then((r) => r.text())
      )
    ),
    fetch(
      'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1',
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.douyin.com/',
          Origin: 'https://www.douyin.com',
        },
        signal: AbortSignal.timeout(7000),
      }
    ).then((r) => r.json() as Promise<any>),
  ]);

  const seenUrls = new Set<string>();
  if (boardResults.status === 'fulfilled') {
    for (let bIdx = 0; bIdx < boardResults.value.length; bIdx++) {
      const br = boardResults.value[bIdx];
      if (br.status !== 'fulfilled') continue;
      const html = br.value;
      const isSportsBoard = boardPaths[bIdx] === '/n/3adqqzadng';
      const rows = html.matchAll(/<tr>([\s\S]*?)<\/tr>/g);
      for (const rowMatch of rows) {
        const row = rowMatch[1];
        const linkMatch = row.match(/<a href="(https:\/\/www\.douyin\.com\/video\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!linkMatch) continue;
        const sourceUrl = linkMatch[1];
        if (seenUrls.has(sourceUrl)) continue;
        seenUrls.add(sourceUrl);

        const title = decodeHtmlEntities(linkMatch[2]);
        if (!title) continue;
        const imgMatch = row.match(/<img[^>]+src="([^"]+)"/);
        const authorMatch = row.match(/class="item-desc"[^>]*>([\s\S]*?)<\/div>/);
        const extraMatch = row.match(/class="item-extra"[^>]*>([\s\S]*?)<\/div>/);
        const rankMatch = row.match(/<td[^>]*>\s*(\d+)\.\s*<\/td>/);

        const views = parseChineseOrCompactNum(extraMatch ? decodeHtmlEntities(extraMatch[1]) : '0');
        const rank = rankMatch ? parseInt(rankMatch[1], 10) : videos.length + 1;
        const author = authorMatch ? decodeHtmlEntities(authorMatch[1]) : 'Douyin Creator';
        const pic = imgMatch ? decodeHtmlEntities(imgMatch[1]) : '';
        const vidId = sourceUrl.split('/').pop() || crypto.randomBytes(4).toString('hex');
        const { score, velocityPerHour } = computeScoreAndVelocity(views, 0, 0, 0, rank);
        const cat = isSportsBoard
          ? { id: 'sports', label: 'Thể thao' }
          : inferCategoryFromText(title, 'entertainment');

        videos.push({
          id: `dy_${vidId}`,
          platform: 'douyin',
          platformLabel: 'Douyin',
          title,
          author,
          pic,
          sourceUrl,
          duration: 0,
          views,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: cat.label,
          orientation: 'vertical',
          rank,
        });
      }
    }
  }

  if (hotSearchRes.status === 'fulfilled') {
    const wordList: any[] = Array.isArray(hotSearchRes.value?.data?.word_list)
      ? hotSearchRes.value.data.word_list
      : [];
    for (let i = 0; i < wordList.length; i++) {
      const w = wordList[i];
      if (!w?.word) continue;
      const wordText = String(w.word);
      topics.push({
        id: `dy_topic_${w.sentence_id || i}`,
        platform: 'douyin',
        platformLabel: 'Douyin',
        rank: Number(w.position || i + 1),
        title: wordText,
        hotValue: Number(w.hot_value || 0),
        videoCount: Number(w.discuss_video_count || w.video_count || 0),
        tag: w.label === 1 ? 'Mới' : w.label === 3 ? 'Hot' : undefined,
        pic: Array.isArray(w.word_cover?.url_list) ? w.word_cover.url_list[0] : undefined,
        url: `https://www.douyin.com/search/${encodeURIComponent(wordText)}`,
        eventTime: Number(w.event_time || 0),
      });
    }
  }

  const qLower = q.trim().toLowerCase();
  const filteredVideos = qLower
    ? videos.filter((v) => v.title.toLowerCase().includes(qLower) || v.author.toLowerCase().includes(qLower))
    : videos;
  const filteredTopics = qLower
    ? topics.filter((t) => t.title.toLowerCase().includes(qLower))
    : topics;

  return {
    videos: filteredVideos,
    topics: filteredTopics,
    status: {
      platform: 'douyin',
      label: 'Douyin',
      status: filteredVideos.length > 0 || filteredTopics.length > 0 ? 'ok' : 'partial',
      count: filteredVideos.length,
      exploreUrl: 'https://www.douyin.com/hot',
    },
  };
}

// ==========================================
// 4. KUAISHOU (Official GraphQL brilliantDataQuery)
// ==========================================
async function fetchKuaishouTrending(
  q: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  try {
    const videos: TrendingVideoItem[] = [];
    const seen = new Set<string>();
    let pcursor = '';

    for (let round = 0; round < 2; round++) {
      const res = await fetch('https://www.kuaishou.com/graphql', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Referer: 'https://www.kuaishou.com/brilliant',
          Origin: 'https://www.kuaishou.com',
        },
        body: JSON.stringify({
          operationName: 'brilliantDataQuery',
          variables: { page: 'brilliant', pcursor },
          query:
            'query brilliantDataQuery($pcursor: String, $page: String) { brilliantData(pcursor: $pcursor, page: $page) { result pcursor feeds { type author { id name headerUrl } photo { ... on PhotoEntity { id caption duration viewCount likeCount coverUrl photoUrl timestamp } } } } }',
        }),
        signal: AbortSignal.timeout(7000),
      });

      const json = (await res.json()) as any;
      const data = json?.data?.brilliantData;
      const feeds: any[] = Array.isArray(data?.feeds) ? data.feeds : [];
      if (feeds.length === 0) break;

      for (const feed of feeds) {
        const photo = feed?.photo;
        if (!photo?.id || seen.has(photo.id)) continue;
        seen.add(photo.id);

        const title = decodeHtmlEntities(String(photo.caption || `Kuaishou #${photo.id}`));
        const views = parseChineseOrCompactNum(photo.viewCount);
        const likes = parseChineseOrCompactNum(photo.likeCount);
        const duration = Math.round(Number(photo.duration || 0) / 1000);
        const pubdate = photo.timestamp ? Math.floor(Number(photo.timestamp) / 1000) : 0;
        const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, 0, pubdate, videos.length + 1);
        const cat = inferCategoryFromText(title, 'vlog');

        videos.push({
          id: `ks_${photo.id}`,
          platform: 'kuaishou',
          platformLabel: 'Kuaishou',
          title,
          author: feed?.author?.name || 'Kuaishou Creator',
          pic: String(photo.coverUrl || ''),
          sourceUrl: `https://www.kuaishou.com/short-video/${photo.id}`,
          duration,
          views,
          likes,
          pubdate,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: cat.label,
          orientation: 'vertical',
          rank: videos.length + 1,
        });
      }

      if (!data?.pcursor || data.pcursor === 'no_more' || data.pcursor === pcursor) break;
      pcursor = String(data.pcursor);
    }

    const qLower = q.trim().toLowerCase();
    const filtered = qLower
      ? videos.filter((v) => v.title.toLowerCase().includes(qLower) || v.author.toLowerCase().includes(qLower))
      : videos;

    return {
      videos: filtered,
      status: {
        platform: 'kuaishou',
        label: 'Kuaishou',
        status: filtered.length > 0 ? 'ok' : 'partial',
        count: filtered.length,
        exploreUrl: 'https://www.kuaishou.com/brilliant',
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'kuaishou',
        label: 'Kuaishou',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Không thể lấy dữ liệu Kuaishou',
        exploreUrl: 'https://www.kuaishou.com/brilliant',
      },
    };
  }
}

// ==========================================
// 5. WEIBO (Hot Search Topics)
// ==========================================
async function fetchWeiboTrending(
  q: string
): Promise<{ topics: TrendingTopicItem[]; status: TrendingPlatformStatus }> {
  try {
    const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent': UA,
        Referer: 'https://weibo.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(7000),
    });

    const topics: TrendingTopicItem[] = [];
    if (res.ok) {
      const json = (await res.json()) as any;
      const realtime: any[] = Array.isArray(json?.data?.realtime) ? json.data.realtime : [];
      for (let i = 0; i < realtime.length; i++) {
        const r = realtime[i];
        if (!r?.word) continue;
        const word = String(r.word);
        topics.push({
          id: `wb_${r.mid || r.realpos || i}`,
          platform: 'weibo',
          platformLabel: 'Weibo',
          rank: Number(r.realpos || i + 1),
          title: word,
          hotValue: Number(r.num || 0),
          tag: r.label_name || undefined,
          url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${word}#`)}`,
        });
      }
    }

    const qLower = q.trim().toLowerCase();
    const filtered = qLower ? topics.filter((t) => t.title.toLowerCase().includes(qLower)) : topics;

    return {
      topics: filtered,
      status: {
        platform: 'weibo',
        label: 'Weibo',
        status: filtered.length > 0 ? 'ok' : 'partial',
        count: filtered.length,
        message: filtered.length > 0 ? 'Cung cấp danh sách đề tài/từ khóa hot Weibo theo thời gian thực' : undefined,
        exploreUrl: 'https://weibo.com/hot/search',
      },
    };
  } catch (err: any) {
    return {
      topics: [],
      status: {
        platform: 'weibo',
        label: 'Weibo',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Không thể lấy dữ liệu Weibo',
        exploreUrl: 'https://weibo.com/hot/search',
      },
    };
  }
}

// ==========================================
// 6. DAILYMOTION
// ==========================================
const DM_CHANNEL_MAP: Record<string, string> = {
  music: 'music',
  tech: 'tech',
  sports: 'sport',
  pets: 'animals',
  gaming: 'videogames',
  travel: 'travel',
  auto: 'auto',
  comedy: 'fun',
  vlog: 'lifestyle',
  food: 'lifestyle',
  entertainment: 'tv',
  shortfilm: 'shortfilms',
};

async function fetchDailymotionTrending(
  category: string,
  q: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  try {
    const params = new URLSearchParams({
      fields: 'id,title,thumbnail_720_url,duration,views_total,likes_total,created_time,owner.screenname,url,channel',
      sort: 'trending',
      limit: '24',
    });
    if (q.trim()) {
      params.set('search', q.trim());
    } else if (DM_CHANNEL_MAP[category]) {
      params.set('channel', DM_CHANNEL_MAP[category]);
    }

    const res = await fetch(`https://api.dailymotion.com/videos?${params.toString()}`, {
      signal: AbortSignal.timeout(7000),
    });
    const json = (await res.json()) as any;
    const list: any[] = Array.isArray(json?.list) ? json.list : [];

    const videos: TrendingVideoItem[] = list.map((v, idx) => {
      const title = String(v.title || v.id);
      const views = Number(v.views_total || 0);
      const likes = Number(v.likes_total || 0);
      const pubdate = Number(v.created_time || 0);
      const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, 0, pubdate, idx + 1);
      const cat =
        category !== 'all'
          ? { id: category, label: CATEGORY_LABELS[category] || 'Dailymotion' }
          : inferCategoryFromText(`${title} ${v.channel || ''}`, 'entertainment');

      return {
        id: `dm_${v.id}`,
        platform: 'dailymotion',
        platformLabel: 'Dailymotion',
        title,
        author: v['owner.screenname'] || 'Dailymotion',
        pic: String(v.thumbnail_720_url || ''),
        sourceUrl: String(v.url || `https://www.dailymotion.com/video/${v.id}`),
        duration: Number(v.duration || 0),
        views,
        likes,
        pubdate,
        score,
        velocityPerHour,
        category: cat.id,
        categoryLabel: cat.label,
        orientation: 'horizontal',
        rank: idx + 1,
      };
    });

    return {
      videos,
      status: {
        platform: 'dailymotion',
        label: 'Dailymotion',
        status: videos.length > 0 ? 'ok' : 'partial',
        count: videos.length,
        exploreUrl: 'https://www.dailymotion.com',
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'dailymotion',
        label: 'Dailymotion',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Không thể lấy dữ liệu Dailymotion',
        exploreUrl: 'https://www.dailymotion.com',
      },
    };
  }
}

// ==========================================
// 7. TIKTOK, XIAOHONGSHU, XIGUA (Live probe + multi-format Cookie support)
// ==========================================
function domainMatchesSuffix(cookieDomain: string, targetSuffix?: string): boolean {
  if (!targetSuffix) return true;
  const cleanCookie = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  const cleanTarget = targetSuffix.trim().toLowerCase().replace(/^\./, '');
  if (!cleanCookie) return true;
  return cleanCookie === cleanTarget || cleanCookie.endsWith(`.${cleanTarget}`);
}

function parseCookiesToMap(
  rawCookies?: string,
  targetDomainSuffix?: string
): { cookies: Map<string, string>; hasDomainMatch: boolean; hasAnyCookies: boolean } {
  const cookies = new Map<string, string>();
  const trimmed = (rawCookies || '').trim();
  if (!trimmed) {
    return { cookies, hasDomainMatch: false, hasAnyCookies: false };
  }

  let hasDomainMatch = false;
  let hasAnyCookies = false;

  // 1. JSON array export (Cookie-Editor / EditThisCookie)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      if (Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          const name = String(item?.name || '').trim();
          const value = String(item?.value ?? '').trim();
          const domain = String(item?.domain || '').trim();
          if (!name) continue;
          hasAnyCookies = true;
          if (domainMatchesSuffix(domain, targetDomainSuffix)) {
            if (domain || !targetDomainSuffix) hasDomainMatch = true;
            cookies.set(name, value);
          }
        }
        return { cookies, hasDomainMatch: hasDomainMatch || (!targetDomainSuffix && hasAnyCookies), hasAnyCookies };
      }
    } catch {
      // fall through to Netscape / header parsing
    }
  }

  // 2. Netscape TSV format
  if (trimmed.includes('\t') || trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const cols = s.split('\t');
      if (cols.length >= 7) {
        const domain = cols[0].trim();
        const name = cols[5].trim();
        const value = cols[6].trim();
        if (!name) continue;
        hasAnyCookies = true;
        if (domainMatchesSuffix(domain, targetDomainSuffix)) {
          hasDomainMatch = true;
          cookies.set(name, value);
        }
      }
    }
    return { cookies, hasDomainMatch, hasAnyCookies };
  }

  // 3. Raw Cookie header string ("Cookie: k=v; k2=v2" or "k=v; k2=v2")
  const headerClean = trimmed.replace(/^cookie:\s*/i, '');
  for (const part of headerClean.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    hasAnyCookies = true;
    cookies.set(name, value);
  }
  // Raw header string has no domain metadata, so treat as potential match if user supplied cookies
  return { cookies, hasDomainMatch: hasAnyCookies, hasAnyCookies };
}

function formatCookieMap(cookies: Map<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of cookies.entries()) {
    parts.push(`${k}=${v}`);
  }
  return parts.join('; ');
}

function extractCookieHeaderString(rawCookies?: string, targetDomainSuffix?: string): string {
  return formatCookieMap(parseCookiesToMap(rawCookies, targetDomainSuffix).cookies);
}

function hasCookiesForDomain(rawCookies?: string, targetDomainSuffix?: string): boolean {
  return parseCookiesToMap(rawCookies, targetDomainSuffix).hasDomainMatch;
}

const TIKTOK_CATEGORY_MAP: Record<string, number> = {
  all: 120,
  entertainment: 101,
  music: 101,
  comedy: 104,
  anime: 100,
  gaming: 103,
  vlog: 105,
  food: 105,
  pets: 105,
  travel: 105,
  sports: 112,
  knowledge: 116,
  tech: 116,
};

let tiktokSessionCache: { cookies: Map<string, string>; expiresAt: number } | null = null;

async function getTikTokSessionCookies(forceRefresh = false): Promise<Map<string, string>> {
  if (!forceRefresh && tiktokSessionCache && Date.now() < tiktokSessionCache.expiresAt && tiktokSessionCache.cookies.size > 0) {
    return new Map(tiktokSessionCache.cookies);
  }

  const jar = new Map<string, string>();
  try {
    const res = await fetch('https://www.tiktok.com/explore', {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(7000),
    });

    const setCookies: string[] =
      typeof (res.headers as any).getSetCookie === 'function'
        ? (res.headers as any).getSetCookie()
        : (res.headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_.-]+=)/);

    for (const sc of setCookies) {
      const firstPart = String(sc || '').split(';')[0].trim();
      const eq = firstPart.indexOf('=');
      if (eq > 0) {
        const k = firstPart.slice(0, eq).trim();
        const v = firstPart.slice(eq + 1).trim();
        if (k) jar.set(k, v);
      }
    }

    if (jar.size > 0) {
      tiktokSessionCache = {
        cookies: new Map(jar),
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
    }
  } catch {
    // ignore transient primer error
  }
  return jar;
}

function parseTikTokItemList(itemList: any[], categoryHint = 'all'): TrendingVideoItem[] {
  return itemList
    .filter((it) => it?.id)
    .map((it, idx) => {
      const title = String(it.desc || `TikTok #${it.id}`);
      const views = Number(it.stats?.playCount || 0);
      const likes = Number(it.stats?.diggCount || 0);
      const comments = Number(it.stats?.commentCount || 0);
      const pubdate = Number(it.createTime || 0);
      const authorUnique = it.author?.uniqueId || it.author?.id || 'user';
      const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, comments, pubdate, idx + 1);
      const cat =
        categoryHint !== 'all'
          ? { id: categoryHint, label: CATEGORY_LABELS[categoryHint] || 'TikTok' }
          : inferCategoryFromText(title, 'entertainment');
      const w = Number(it.video?.width || 0);
      const h = Number(it.video?.height || 0);
      const orientation: 'vertical' | 'horizontal' = w > 0 && h > 0 ? (h >= w ? 'vertical' : 'horizontal') : 'vertical';
      return {
        id: `tt_${it.id}`,
        platform: 'tiktok' as VideoPlatform,
        platformLabel: 'TikTok',
        title,
        author: it.author?.nickname || authorUnique,
        pic: String(it.video?.cover || it.video?.originCover || it.video?.dynamicCover || ''),
        sourceUrl: `https://www.tiktok.com/@${authorUnique}/video/${it.id}`,
        duration: Number(it.video?.duration || 0),
        views,
        likes,
        comments,
        pubdate,
        score,
        velocityPerHour,
        category: cat.id,
        categoryLabel: cat.label,
        orientation,
        rank: idx + 1,
      };
    });
}

async function fetchTikTokExploreList(
  categoryType: number,
  extraCookies?: string,
  forceRefreshSession = false
): Promise<{ itemList: any[]; hasUserDomainCookie: boolean }> {
  const sessionJar = await getTikTokSessionCookies(forceRefreshSession);
  const parsedUser = parseCookiesToMap(extraCookies, 'tiktok.com');
  const merged = new Map<string, string>(sessionJar);
  for (const [k, v] of parsedUser.cookies.entries()) {
    merged.set(k, v);
  }
  const cookieHeader = formatCookieMap(merged);

  const res = await fetch(
    `https://www.tiktok.com/api/explore/item_list/?aid=1988&count=24&categoryType=${categoryType}`,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: 'https://www.tiktok.com/explore',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(7000),
    }
  );
  const json = (await res.json().catch(() => null)) as any;
  const itemList: any[] = Array.isArray(json?.itemList) ? json.itemList : [];
  return { itemList, hasUserDomainCookie: parsedUser.hasDomainMatch };
}

async function fetchTikTokTrending(
  category = 'all',
  extraCookies?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const categoryType = TIKTOK_CATEGORY_MAP[category] || 120;
  let hasUserDomainCookie = false;
  try {
    let { itemList, hasUserDomainCookie: hasCookie } = await fetchTikTokExploreList(categoryType, extraCookies, false);
    hasUserDomainCookie = hasCookie;

    // Fallback to default categoryType=120 or re-prime session cookies if empty
    if (itemList.length === 0 && categoryType !== 120) {
      const retryDefault = await fetchTikTokExploreList(120, extraCookies, false);
      itemList = retryDefault.itemList;
    }
    if (itemList.length === 0) {
      const retryFresh = await fetchTikTokExploreList(categoryType, extraCookies, true);
      itemList = retryFresh.itemList;
    }

    const videos = parseTikTokItemList(itemList, category);
    if (videos.length > 0) {
      return {
        videos,
        status: {
          platform: 'tiktok',
          label: 'TikTok',
          status: 'ok',
          count: videos.length,
          exploreUrl: 'https://www.tiktok.com/explore',
        },
      };
    }

    return {
      videos: [],
      status: {
        platform: 'tiktok',
        label: 'TikTok',
        status: 'cookie_required',
        count: 0,
        message: hasUserDomainCookie
          ? 'Đã nhận Cookie TikTok nhưng phiên hiện tại chưa trả danh sách Explore (có thể Cookie đã hết hạn hoặc bị giới hạn IP). Hãy thử làm mới hoặc xuất lại Cookie .tiktok.com.'
          : 'TikTok đang chặn truy vấn danh sách Explore từ máy chủ. Hãy bấm Làm mới hoặc nhập Cookie .tiktok.com trong Cấu hình Cookie.',
        exploreUrl: 'https://www.tiktok.com/explore',
      },
    };
  } catch {
    return {
      videos: [],
      status: {
        platform: 'tiktok',
        label: 'TikTok',
        status: 'cookie_required',
        count: 0,
        message: hasUserDomainCookie
          ? 'Đã nhận Cookie TikTok nhưng kết nối tới TikTok Explore bị gián đoạn. Vui lòng thử Làm mới.'
          : 'TikTok yêu cầu Cookie xác thực để lấy bảng xếp hạng Explore.',
        exploreUrl: 'https://www.tiktok.com/explore',
      },
    };
  }
}

async function fetchXiaohongshuTrending(
  extraCookies?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const parsedCookies = parseCookiesToMap(extraCookies, 'xiaohongshu.com');
  const cookieHeader = formatCookieMap(parsedCookies.cookies);
  try {
    const res = await fetch('https://www.xiaohongshu.com/explore', {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.xiaohongshu.com/',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    const html = await res.text();
    const m = html.match(/window\.__INITIAL_STATE__=(\{.*?\})<\/script>/s);
    const videos: TrendingVideoItem[] = [];
    if (m) {
      try {
        const clean = m[1].replace(/:\s*undefined\b/g, ':null');
        const state = JSON.parse(clean);
        const feeds: any[] = Array.isArray(state?.feed?.feeds) ? state.feed.feeds : [];
        for (let i = 0; i < feeds.length; i++) {
          const f = feeds[i];
          const note = f?.noteCard || f;
          if (!f?.id || !note) continue;
          const title = String(note.displayTitle || note.title || f.id);
          const likes = parseChineseOrCompactNum(note.interactInfo?.likedCount || 0);
          const { score, velocityPerHour } = computeScoreAndVelocity(likes * 15, likes, 0, 0, i + 1);
          const cat = inferCategoryFromText(title, 'vlog');
          videos.push({
            id: `xhs_${f.id}`,
            platform: 'xiaohongshu',
            platformLabel: 'Xiaohongshu',
            title,
            author: note.user?.nickname || 'Xiaohongshu',
            pic: String(note.cover?.urlDefault || note.cover?.url || ''),
            sourceUrl: `https://www.xiaohongshu.com/explore/${f.id}`,
            duration: 0,
            views: likes * 15,
            likes,
            score,
            velocityPerHour,
            category: cat.id,
            categoryLabel: cat.label,
            orientation: 'vertical',
            rank: i + 1,
          });
        }
      } catch {
        // ignore parse errors
      }
    }

    if (videos.length > 0) {
      return {
        videos,
        status: {
          platform: 'xiaohongshu',
          label: 'Xiaohongshu',
          status: 'ok',
          count: videos.length,
          exploreUrl: 'https://www.xiaohongshu.com/explore',
        },
      };
    }
  } catch {
    // ignore
  }

  return {
    videos: [],
    status: {
      platform: 'xiaohongshu',
      label: 'Xiaohongshu',
      status: 'cookie_required',
      count: 0,
      message: parsedCookies.hasDomainMatch
        ? 'Đã nhận Cookie Xiaohongshu nhưng trang Explore yêu cầu phiên đăng nhập mới hoặc xác minh bổ sung (web_session). Bạn có thể mở Xiaohongshu hoặc xuất lại Cookie .xiaohongshu.com.'
        : 'Xiaohongshu (Tiểu Hồng Thư) yêu cầu Cookie đăng nhập (.xiaohongshu.com) để tải luồng Explore. Bạn có thể bấm Mở Xiaohongshu hoặc dán link note/video vào tab Tải hàng loạt.',
      exploreUrl: 'https://www.xiaohongshu.com/explore',
    },
  };
}

async function fetchXiguaTrending(
  extraCookies?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const parsedCookies = parseCookiesToMap(extraCookies, 'ixigua.com');
  const cookieHeader = formatCookieMap(parsedCookies.cookies);
  try {
    const res = await fetch('https://www.ixigua.com/api/feedv2/feedById?channelId=94349549395&count=20', {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.ixigua.com/',
        Origin: 'https://www.ixigua.com',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json().catch(() => null)) as any;
    const list: any[] = Array.isArray(json?.data?.data) ? json.data.data : [];
    const videos: TrendingVideoItem[] = list
      .filter((it) => it?.groupId || it?.itemId)
      .map((it, idx) => {
        const gid = String(it.groupId || it.itemId);
        const title = String(it.title || gid);
        const views = Number(it.videoDetailInfo?.videoWatchCount || it.playCount || 0);
        const duration = Number(it.videoDetailInfo?.videoDuration || it.duration || 0);
        const pubdate = Number(it.publishTime || 0);
        const { score, velocityPerHour } = computeScoreAndVelocity(views, 0, 0, pubdate, idx + 1);
        const cat = inferCategoryFromText(title, 'vlog');
        return {
          id: `xg_${gid}`,
          platform: 'xigua',
          platformLabel: 'Xigua',
          title,
          author: it.userInfo?.name || 'Xigua Creator',
          pic: String(it.middleImage?.url || it.largeImage?.url || ''),
          sourceUrl: `https://www.ixigua.com/${gid}`,
          duration,
          views,
          pubdate,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: cat.label,
          orientation: 'horizontal',
          rank: idx + 1,
        };
      });

    if (videos.length > 0) {
      return {
        videos,
        status: {
          platform: 'xigua',
          label: 'Xigua',
          status: 'ok',
          count: videos.length,
          exploreUrl: 'https://www.ixigua.com',
        },
      };
    }
  } catch {
    // ignore
  }

  return {
    videos: [],
    status: {
      platform: 'xigua',
      label: 'Xigua',
      status: 'cookie_required',
      count: 0,
      message: parsedCookies.hasDomainMatch
        ? 'Đã nhận Cookie Xigua nhưng API feed yêu cầu chữ ký trình duyệt (acrawler/_signature) hoặc Cookie mới hơn. Bạn có thể mở trang Xigua để lấy link.'
        : 'Xigua Video (Tây Qua) đang yêu cầu Cookie xác thực (.ixigua.com) để đọc API feed. Bạn có thể mở trang Xigua gốc hoặc thêm Cookie.',
      exploreUrl: 'https://www.ixigua.com',
    },
  };
}

// ==========================================
// AGGREGATOR & FILTERING
// ==========================================
function shortHash(val?: string): string {
  const s = (val || '').trim();
  if (!s) return '';
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 10);
}

export async function queryTrendingFeed(opts: TrendingQueryOptions): Promise<TrendingApiResponse> {
  const cacheKey = JSON.stringify({
    p: opts.platform,
    c: opts.category,
    q: opts.q.trim().toLowerCase(),
    r: opts.region,
    extraHash: shortHash(opts.extraCookies),
    sessHash: shortHash(opts.sessdata),
  });

  let baseData: Omit<TrendingApiResponse, 'fromCache'> | null = null;
  let fromCache = false;

  if (!opts.refresh) {
    const cached = trendingCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      baseData = cached.data;
      fromCache = true;
    }
  }

  if (!baseData) {
    const want = (p: TrendingPlatformId) => opts.platform === 'all' || opts.platform === p;

    const tasks: Promise<void>[] = [];
    let allVideos: TrendingVideoItem[] = [];
    let allTopics: TrendingTopicItem[] = [];
    const platformStatuses: TrendingPlatformStatus[] = [];

    if (want('youtube')) {
      tasks.push(
        fetchYouTubeTrending(opts.category, opts.q, opts.region).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('bilibili')) {
      tasks.push(
        fetchBilibiliTrending(opts.category, opts.q, opts.sessdata).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('douyin')) {
      tasks.push(
        fetchDouyinTrending(opts.category, opts.q).then((r) => {
          allVideos.push(...r.videos);
          allTopics.push(...r.topics);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('kuaishou')) {
      tasks.push(
        fetchKuaishouTrending(opts.q).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('dailymotion')) {
      tasks.push(
        fetchDailymotionTrending(opts.category, opts.q).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('weibo')) {
      tasks.push(
        fetchWeiboTrending(opts.q).then((r) => {
          allTopics.push(...r.topics);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('tiktok')) {
      tasks.push(
        fetchTikTokTrending(opts.category, opts.extraCookies).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('xiaohongshu')) {
      tasks.push(
        fetchXiaohongshuTrending(opts.extraCookies).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('xigua')) {
      tasks.push(
        fetchXiguaTrending(opts.extraCookies).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    await Promise.allSettled(tasks);

    baseData = {
      videos: allVideos,
      topics: allTopics.sort((a, b) => a.rank - b.rank),
      platformStatuses,
      updatedAt: Date.now(),
    };

    if (trendingCache.size >= 40) {
      const oldestKey = trendingCache.keys().next().value;
      if (oldestKey) trendingCache.delete(oldestKey);
    }
    trendingCache.set(cacheKey, { data: baseData, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // Apply interactive filters (category when mixed, duration, orientation, search) & sorting
  let filteredVideos = [...baseData.videos];

  if (opts.category && opts.category !== 'all') {
    const catMatched = filteredVideos.filter((v) => v.category === opts.category);
    // Keep platform-native category results too if matched, otherwise show matching slice
    if (catMatched.length > 0) {
      filteredVideos = catMatched;
    } else if (opts.platform === 'kuaishou' || opts.platform === 'douyin') {
      filteredVideos = [];
    }
  }

  if (opts.duration === 'short') {
    filteredVideos = filteredVideos.filter((v) => v.duration > 0 && v.duration <= 60);
  } else if (opts.duration === 'medium') {
    filteredVideos = filteredVideos.filter((v) => v.duration > 60 && v.duration <= 300);
  } else if (opts.duration === 'long') {
    filteredVideos = filteredVideos.filter((v) => v.duration > 300);
  }

  if (opts.orientation === 'vertical') {
    filteredVideos = filteredVideos.filter((v) => v.orientation === 'vertical');
  } else if (opts.orientation === 'horizontal') {
    filteredVideos = filteredVideos.filter((v) => v.orientation === 'horizontal');
  }

  const qLower = opts.q.trim().toLowerCase();
  if (qLower) {
    const terms = qLower.split(/\s+/).filter(Boolean);
    const matching = filteredVideos.filter((v) => {
      const hay = `${v.title} ${v.author} ${v.categoryLabel} ${v.platformLabel}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    if (matching.length > 0 || opts.platform === 'kuaishou' || opts.platform === 'douyin') {
      filteredVideos = matching;
    }
  }

  if (opts.sort === 'views') {
    filteredVideos.sort((a, b) => b.views - a.views);
  } else if (opts.sort === 'rising') {
    filteredVideos.sort((a, b) => (b.velocityPerHour || 0) - (a.velocityPerHour || 0));
  } else if (opts.sort === 'engagement') {
    filteredVideos.sort((a, b) => {
      const ea = a.views > 0 ? ((a.likes || 0) + (a.comments || 0) * 2) / a.views : 0;
      const eb = b.views > 0 ? ((b.likes || 0) + (b.comments || 0) * 2) / b.views : 0;
      return eb - ea;
    });
  } else if (opts.sort === 'newest') {
    filteredVideos.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));
  } else {
    // 'best' — balance score and platform variety when viewing 'all'
    filteredVideos.sort((a, b) => b.score - a.score);
  }

  return {
    videos: filteredVideos,
    topics: baseData.topics,
    platformStatuses: baseData.platformStatuses,
    updatedAt: baseData.updatedAt,
    fromCache,
  };
}

// Optional lightweight translation cache for Chinese/English -> Vietnamese titles
const translateCache = new Map<string, string>();

export async function translateTitlesBatch(titles: { id: string; text: string }[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const pending: { id: string; text: string }[] = [];

  for (const item of titles.slice(0, 20)) {
    const clean = item.text.trim();
    if (!clean) continue;
    const cached = translateCache.get(clean);
    if (cached) {
      result[item.id] = cached;
    } else {
      pending.push({ id: item.id, text: clean });
    }
  }

  if (pending.length === 0) return result;

  // Attempt parallel translate with a short timeout; fail gracefully if rate limited
  await Promise.allSettled(
    pending.slice(0, 12).map(async ({ id, text }) => {
      try {
        const res = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(
            text.slice(0, 240)
          )}`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3500) }
        );
        if (!res.ok) return;
        const json = (await res.json()) as any;
        const translated = Array.isArray(json?.[0])
          ? json[0].map((seg: any) => seg?.[0] || '').join('').trim()
          : '';
        if (translated && translated.toLowerCase() !== text.toLowerCase()) {
          if (translateCache.size > 500) translateCache.clear();
          translateCache.set(text, translated);
          result[id] = translated;
        }
      } catch {
        // graceful no-op
      }
    })
  );

  return result;
}

// ==========================================
// INDEPENDENT MULTI-PLATFORM VIDEO SEARCH
// ==========================================
async function searchYouTubeVideos(
  q: string,
  sort: SearchSortOption,
  orientation: 'all' | 'vertical' | 'horizontal',
  region: 'VN' | 'GLOBAL' | 'CN'
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const gl = region === 'VN' ? 'VN' : region === 'CN' ? 'TW' : 'US';
  const hl = region === 'VN' ? 'vi' : region === 'CN' ? 'zh-CN' : 'en';
  const acceptLang = region === 'VN' ? 'vi-VN,vi;q=0.9,en;q=0.8' : 'en-US,en;q=0.9';
  const searchExploreUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

  try {
    const queryStr = orientation === 'vertical' && !/shorts/i.test(q) ? `${q} #shorts` : q;
    const sp =
      sort === 'views'
        ? '&sp=CAM%253D'
        : sort === 'newest'
        ? '&sp=CAI%253D'
        : '';

    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(queryStr)}${sp}&gl=${gl}&hl=${hl}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': acceptLang },
      signal: AbortSignal.timeout(8500),
    });
    const html = await res.text();
    const videos = parseYtInitialDataVideos(html, 'all');
    return {
      videos,
      status: {
        platform: 'youtube',
        label: 'YouTube',
        status: videos.length > 0 ? 'ok' : 'partial',
        count: videos.length,
        exploreUrl: searchExploreUrl,
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'youtube',
        label: 'YouTube',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Lỗi tìm kiếm trên YouTube',
        exploreUrl: searchExploreUrl,
      },
    };
  }
}

async function searchBilibiliVideos(
  q: string,
  sort: SearchSortOption,
  page = 1,
  sessdata?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const searchExploreUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`;
  try {
    const headers = await getTrendingBiliHeaders(sessdata);
    const order =
      sort === 'views'
        ? 'click'
        : sort === 'newest'
        ? 'pubdate'
        : sort === 'engagement'
        ? 'stow'
        : 'totalrank';

    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=${order}&keyword=${encodeURIComponent(
      q
    )}&page=${Math.max(1, page)}&page_size=30`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(7500) });
    const json = (await res.json()) as any;
    const list: any[] = Array.isArray(json?.data?.result) ? json.data.result : [];

    const videos: TrendingVideoItem[] = list
      .filter((v) => v?.bvid)
      .map((v, idx) => {
        const title = decodeHtmlEntities(String(v.title || v.bvid));
        const views = Number(v.play || 0);
        const likes = Number(v.like || 0);
        const comments = Number(v.review || v.video_review || 0);
        const pubdate = Number(v.pubdate || 0);
        const durParts = String(v.duration || '0:0')
          .split(':')
          .map((x) => parseInt(x, 10) || 0);
        const duration = durParts.length === 2 ? durParts[0] * 60 + durParts[1] : 0;
        const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, comments, pubdate, idx + 1);
        const cat = inferCategoryFromText(`${title} ${v.typename || ''}`, 'all');
        return {
          id: `bili_${v.bvid}`,
          platform: 'bilibili' as VideoPlatform,
          platformLabel: 'Bilibili',
          title,
          author: v.author || 'Bilibili Creator',
          pic: String(v.pic || '').startsWith('//')
            ? `https:${v.pic}`
            : String(v.pic || '').replace(/^http:/, 'https:'),
          sourceUrl: `https://www.bilibili.com/video/${v.bvid}`,
          duration,
          views,
          likes,
          comments,
          pubdate,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: v.typename || cat.label,
          orientation: 'horizontal' as const,
          rank: idx + 1,
        };
      });

    return {
      videos,
      status: {
        platform: 'bilibili',
        label: 'Bilibili',
        status: videos.length > 0 ? 'ok' : 'partial',
        count: videos.length,
        exploreUrl: searchExploreUrl,
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'bilibili',
        label: 'Bilibili',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Lỗi tìm kiếm trên Bilibili',
        exploreUrl: searchExploreUrl,
      },
    };
  }
}

async function searchDailymotionVideos(
  q: string,
  sort: SearchSortOption,
  page = 1
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const searchExploreUrl = `https://www.dailymotion.com/search/${encodeURIComponent(q)}/videos`;
  try {
    const dmSort = sort === 'views' ? 'visited' : sort === 'newest' ? 'recent' : 'relevance';
    const params = new URLSearchParams({
      fields: 'id,title,thumbnail_720_url,duration,views_total,likes_total,created_time,owner.screenname,url,channel',
      search: q,
      sort: dmSort,
      page: String(Math.max(1, page)),
      limit: '24',
    });

    const res = await fetch(`https://api.dailymotion.com/videos?${params.toString()}`, {
      signal: AbortSignal.timeout(7000),
    });
    const json = (await res.json()) as any;
    const list: any[] = Array.isArray(json?.list) ? json.list : [];

    const videos: TrendingVideoItem[] = list.map((v, idx) => {
      const title = String(v.title || v.id);
      const views = Number(v.views_total || 0);
      const likes = Number(v.likes_total || 0);
      const pubdate = Number(v.created_time || 0);
      const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, 0, pubdate, idx + 1);
      const cat = inferCategoryFromText(`${title} ${v.channel || ''}`, 'entertainment');
      return {
        id: `dm_${v.id}`,
        platform: 'dailymotion',
        platformLabel: 'Dailymotion',
        title,
        author: v['owner.screenname'] || 'Dailymotion',
        pic: String(v.thumbnail_720_url || ''),
        sourceUrl: String(v.url || `https://www.dailymotion.com/video/${v.id}`),
        duration: Number(v.duration || 0),
        views,
        likes,
        pubdate,
        score,
        velocityPerHour,
        category: cat.id,
        categoryLabel: cat.label,
        orientation: 'horizontal',
        rank: idx + 1,
      };
    });

    return {
      videos,
      status: {
        platform: 'dailymotion',
        label: 'Dailymotion',
        status: videos.length > 0 ? 'ok' : 'partial',
        count: videos.length,
        exploreUrl: searchExploreUrl,
      },
    };
  } catch (err: any) {
    return {
      videos: [],
      status: {
        platform: 'dailymotion',
        label: 'Dailymotion',
        status: 'unavailable',
        count: 0,
        message: err?.message || 'Lỗi tìm kiếm trên Dailymotion',
        exploreUrl: searchExploreUrl,
      },
    };
  }
}

async function searchKuaishouVideos(
  q: string,
  extraCookies?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const exploreUrl = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(q)}`;
  const parsedCookies = parseCookiesToMap(extraCookies, 'kuaishou.com');
  const cookieHeader = formatCookieMap(parsedCookies.cookies);
  try {
    const res = await fetch('https://www.kuaishou.com/graphql', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Referer: exploreUrl,
        Origin: 'https://www.kuaishou.com',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({
        operationName: 'visionSearchPhoto',
        variables: { keyword: q, pcursor: '', page: 'search', searchSessionId: '' },
        query:
          'query visionSearchPhoto($keyword: String, $pcursor: String, $page: String, $searchSessionId: String) { visionSearchPhoto(keyword: $keyword, pcursor: $pcursor, page: $page, searchSessionId: $searchSessionId) { result pcursor feeds { type author { id name } photo { ... on PhotoEntity { id caption duration viewCount likeCount coverUrl timestamp } } } } }',
      }),
      signal: AbortSignal.timeout(7000),
    });
    const json = (await res.json()) as any;
    const feeds: any[] = Array.isArray(json?.data?.visionSearchPhoto?.feeds)
      ? json.data.visionSearchPhoto.feeds
      : [];

    const videos: TrendingVideoItem[] = feeds
      .filter((f) => f?.photo?.id)
      .map((f, idx) => {
        const photo = f.photo;
        const title = decodeHtmlEntities(String(photo.caption || `Kuaishou #${photo.id}`));
        const views = parseChineseOrCompactNum(photo.viewCount);
        const likes = parseChineseOrCompactNum(photo.likeCount);
        const duration = Math.round(Number(photo.duration || 0) / 1000);
        const pubdate = photo.timestamp ? Math.floor(Number(photo.timestamp) / 1000) : 0;
        const { score, velocityPerHour } = computeScoreAndVelocity(views, likes, 0, pubdate, idx + 1);
        const cat = inferCategoryFromText(title, 'vlog');
        return {
          id: `ks_${photo.id}`,
          platform: 'kuaishou',
          platformLabel: 'Kuaishou',
          title,
          author: f?.author?.name || 'Kuaishou',
          pic: String(photo.coverUrl || ''),
          sourceUrl: `https://www.kuaishou.com/short-video/${photo.id}`,
          duration,
          views,
          likes,
          pubdate,
          score,
          velocityPerHour,
          category: cat.id,
          categoryLabel: cat.label,
          orientation: 'vertical',
          rank: idx + 1,
        };
      });

    if (videos.length > 0) {
      return {
        videos,
        status: { platform: 'kuaishou', label: 'Kuaishou', status: 'ok', count: videos.length, exploreUrl },
      };
    }
  } catch {
    // ignore
  }

  return {
    videos: [],
    status: {
      platform: 'kuaishou',
      label: 'Kuaishou',
      status: 'cookie_required',
      count: 0,
      message: parsedCookies.hasDomainMatch
        ? 'Đã nhận Cookie Kuaishou nhưng API tìm kiếm yêu cầu phiên trình duyệt mới hơn hoặc xác minh Captcha. Bạn có thể mở Kuaishou để lấy link.'
        : 'Tìm kiếm từ khóa trực tiếp trên Kuaishou yêu cầu Cookie trình duyệt (.kuaishou.com). Bạn có thể mở trang tìm kiếm Kuaishou hoặc nhập Cookie.',
      exploreUrl,
    },
  };
}

async function searchTikTokVideos(
  q: string,
  extraCookies?: string
): Promise<{ videos: TrendingVideoItem[]; status: TrendingPlatformStatus }> {
  const exploreUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`;
  const sessionJar = await getTikTokSessionCookies(false);
  const parsedUser = parseCookiesToMap(extraCookies, 'tiktok.com');
  const merged = new Map<string, string>(sessionJar);
  for (const [k, v] of parsedUser.cookies.entries()) {
    merged.set(k, v);
  }
  const cookieHeader = formatCookieMap(merged);

  // Try direct TikTok search API with user cookies + session jar
  try {
    const searchUrl = `https://www.tiktok.com/api/search/general/full/?aid=1988&keyword=${encodeURIComponent(q)}&offset=0`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: exploreUrl,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    if (text.trim().startsWith('{')) {
      const json = JSON.parse(text);
      const rawItems: any[] = [];
      if (Array.isArray(json?.data)) {
        for (const entry of json.data) {
          if (entry?.item?.id) rawItems.push(entry.item);
        }
      }
      if (Array.isArray(json?.item_list)) {
        rawItems.push(...json.item_list);
      }
      const videos = parseTikTokItemList(rawItems, 'all');
      if (videos.length > 0) {
        return {
          videos,
          status: { platform: 'tiktok', label: 'TikTok', status: 'ok', count: videos.length, exploreUrl },
        };
      }
    }
  } catch {
    // ignore — TikTok search API often requires browser-signed X-Bogus
  }

  // Fallback: match against live TikTok Explore feed items if keywords match
  try {
    const { itemList } = await fetchTikTokExploreList(120, extraCookies, false);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = parseTikTokItemList(itemList, 'all').filter((v) => {
      const hay = `${v.title} ${v.author} ${v.categoryLabel}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    if (matched.length > 0) {
      return {
        videos: matched,
        status: {
          platform: 'tiktok',
          label: 'TikTok',
          status: 'partial',
          count: matched.length,
          message: `Hiển thị ${matched.length} video khớp từ khóa từ luồng TikTok Explore (API tìm kiếm toàn cầu của TikTok yêu cầu chữ ký trình duyệt X-Bogus).`,
          exploreUrl,
        },
      };
    }
  } catch {
    // ignore
  }

  return {
    videos: [],
    status: {
      platform: 'tiktok',
      label: 'TikTok',
      status: 'cookie_required',
      count: 0,
      message: parsedUser.hasDomainMatch
        ? 'Đã nhận Cookie TikTok của bạn! Tuy nhiên API tìm kiếm theo từ khóa của TikTok yêu cầu chữ ký bảo mật X-Bogus trên trình duyệt nên không gọi trực tiếp từ server được. Bảng Thịnh hành TikTok vẫn chạy tự động — hoặc bấm Mở TikTok để tìm rồi dán link tải.'
        : 'API tìm kiếm từ khóa của TikTok yêu cầu chữ ký trình duyệt X-Bogus. Bạn có thể xem tab Thịnh hành TikTok (hoạt động tự động) hoặc bấm mở trang tìm kiếm TikTok.',
      exploreUrl,
    },
  };
}

function buildCookieSearchStatus(
  platform: TrendingPlatformId,
  label: string,
  exploreUrl: string,
  domainSuffix: string,
  extraCookies?: string
): TrendingPlatformStatus {
  const hasDomainCookie = hasCookiesForDomain(extraCookies, domainSuffix);
  return {
    platform,
    label,
    status: 'cookie_required',
    count: 0,
    message: hasDomainCookie
      ? `Đã nhận Cookie ${label}, nhưng API tìm kiếm từ khóa của ${label} yêu cầu chữ ký bảo mật JS (X-Bogus/a_bogus) từ trình duyệt. Bấm nút bên dưới để mở tìm kiếm ${label} rồi dán link vào hàng đợi.`
      : `Tìm kiếm từ khóa trực tiếp trên ${label} yêu cầu Cookie & chữ ký trình duyệt (.${domainSuffix}). Bấm nút bên dưới để mở trang tìm kiếm ${label} theo từ khóa hoặc cấu hình Cookie.`,
    exploreUrl,
  };
}

export async function searchVideosAcrossPlatforms(opts: SearchQueryOptions): Promise<SearchApiResponse> {
  const trimmedQ = opts.q.trim();
  if (!trimmedQ) {
    return {
      query: '',
      videos: [],
      platformStatuses: [],
      updatedAt: Date.now(),
    };
  }

  const page = Math.max(1, Number(opts.page || 1));
  const cacheKey = JSON.stringify({
    q: trimmedQ.toLowerCase(),
    p: opts.platform,
    s: opts.sort,
    o: opts.orientation,
    r: opts.region,
    pg: page,
    extraHash: shortHash(opts.extraCookies),
    sessHash: shortHash(opts.sessdata),
  });

  let baseData: Omit<SearchApiResponse, 'fromCache'> | null = null;
  let fromCache = false;

  if (!opts.refresh) {
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      baseData = cached.data;
      fromCache = true;
    }
  }

  if (!baseData) {
    const want = (p: TrendingPlatformId) => opts.platform === 'all' || opts.platform === p;
    const tasks: Promise<void>[] = [];
    const allVideos: TrendingVideoItem[] = [];
    const platformStatuses: TrendingPlatformStatus[] = [];

    if (want('youtube')) {
      tasks.push(
        searchYouTubeVideos(trimmedQ, opts.sort, opts.orientation, opts.region).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('bilibili')) {
      tasks.push(
        searchBilibiliVideos(trimmedQ, opts.sort, page, opts.sessdata).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('dailymotion')) {
      tasks.push(
        searchDailymotionVideos(trimmedQ, opts.sort, page).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('kuaishou')) {
      tasks.push(
        searchKuaishouVideos(trimmedQ, opts.extraCookies).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('douyin')) {
      platformStatuses.push(
        buildCookieSearchStatus(
          'douyin',
          'Douyin',
          `https://www.douyin.com/search/${encodeURIComponent(trimmedQ)}?type=video`,
          'douyin.com',
          opts.extraCookies
        )
      );
    }

    if (want('tiktok')) {
      tasks.push(
        searchTikTokVideos(trimmedQ, opts.extraCookies).then((r) => {
          allVideos.push(...r.videos);
          platformStatuses.push(r.status);
        })
      );
    }

    if (want('xiaohongshu')) {
      platformStatuses.push(
        buildCookieSearchStatus(
          'xiaohongshu',
          'Xiaohongshu',
          `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(trimmedQ)}`,
          'xiaohongshu.com',
          opts.extraCookies
        )
      );
    }

    if (want('weibo')) {
      platformStatuses.push(
        buildCookieSearchStatus(
          'weibo',
          'Weibo',
          `https://s.weibo.com/weibo?q=${encodeURIComponent(trimmedQ)}`,
          'weibo.com',
          opts.extraCookies
        )
      );
    }

    if (want('xigua')) {
      platformStatuses.push(
        buildCookieSearchStatus(
          'xigua',
          'Xigua',
          `https://www.ixigua.com/search/${encodeURIComponent(trimmedQ)}`,
          'ixigua.com',
          opts.extraCookies
        )
      );
    }

    await Promise.allSettled(tasks);

    baseData = {
      query: trimmedQ,
      videos: allVideos,
      platformStatuses,
      updatedAt: Date.now(),
    };

    if (searchCache.size >= 40) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { data: baseData, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  let filtered = [...baseData.videos];

  if (opts.duration === 'short') {
    filtered = filtered.filter((v) => v.duration > 0 && v.duration <= 60);
  } else if (opts.duration === 'medium') {
    filtered = filtered.filter((v) => v.duration > 60 && v.duration <= 300);
  } else if (opts.duration === 'long') {
    filtered = filtered.filter((v) => v.duration > 300);
  }

  if (opts.orientation === 'vertical') {
    filtered = filtered.filter((v) => v.orientation === 'vertical');
  } else if (opts.orientation === 'horizontal') {
    filtered = filtered.filter((v) => v.orientation === 'horizontal');
  }

  if (opts.sort === 'views') {
    filtered.sort((a, b) => b.views - a.views);
  } else if (opts.sort === 'newest') {
    filtered.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));
  } else if (opts.sort === 'engagement') {
    filtered.sort((a, b) => {
      const ea = a.views > 0 ? ((a.likes || 0) + (a.comments || 0) * 2) / a.views : 0;
      const eb = b.views > 0 ? ((b.likes || 0) + (b.comments || 0) * 2) / b.views : 0;
      return eb - ea;
    });
  } else {
    // 'relevance' — interleave/rank naturally by relevance rank then score
    filtered.sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.score - a.score);
  }

  return {
    query: baseData.query,
    videos: filtered,
    platformStatuses: baseData.platformStatuses,
    updatedAt: baseData.updatedAt,
    fromCache,
  };
}
