import { CookieSiteId, PerSiteCookies, StudioDefaultConfig } from '../types/bilibili';

export interface CookieSiteDescriptor {
  id: CookieSiteId;
  label: string;
  domain: string;
  domainsMatch: string[];
  description: string;
  placeholder: string;
  isSessdata?: boolean;
}

export const COOKIE_SITES: CookieSiteDescriptor[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    domain: '.youtube.com',
    domainsMatch: ['youtube.com', 'youtu.be', 'google.com'],
    description: 'Vượt xác minh chống bot khi tải video & trích đoạn làm video phái sinh.',
    placeholder: '# Netscape cookies.txt hoặc Cookie-Editor JSON của youtube.com\n.youtube.com\tTRUE\t/\tTRUE\t...',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    domain: '.tiktok.com',
    domainsMatch: ['tiktok.com', 'tiktokv.com'],
    description: 'Mở khóa danh sách Xu hướng, Tìm kiếm video TikTok và tải không watermark.',
    placeholder: '# Netscape cookies.txt, JSON hoặc header của tiktok.com\n.tiktok.com\tTRUE\t/\tTRUE\t...',
  },
  {
    id: 'bilibili',
    label: 'Bilibili (SESSDATA)',
    domain: '.bilibili.com',
    domainsMatch: ['bilibili.com'],
    description: 'Mở khóa độ phân giải 1080P60 / 4K và danh sách video đầy đủ trên Bilibili.',
    placeholder: 'Dán giá trị SESSDATA (ví dụ: 8a1b2c3d%2C173...)',
    isSessdata: true,
  },
  {
    id: 'douyin',
    label: 'Douyin (抖音)',
    domain: '.douyin.com',
    domainsMatch: ['douyin.com', 'iesdouyin.com'],
    description: 'Lấy video thịnh hành, tìm kiếm theo từ khóa và tải bản nét từ Douyin.',
    placeholder: '# Netscape cookies.txt, JSON hoặc Cookie header của douyin.com...',
  },
  {
    id: 'kuaishou',
    label: 'Kuaishou (快手)',
    domain: '.kuaishou.com',
    domainsMatch: ['kuaishou.com', 'gifshow.com'],
    description: 'Xác thực phiên truy cập Kuaishou khi tìm kiếm hoặc tải clip.',
    placeholder: '# Netscape cookies.txt, JSON hoặc Cookie header của kuaishou.com...',
  },
  {
    id: 'xiaohongshu',
    label: 'Xiaohongshu (小红书)',
    domain: '.xiaohongshu.com',
    domainsMatch: ['xiaohongshu.com', 'xhscdn.com'],
    description: 'Mở khóa bài đăng và video xu hướng trên Tiểu Hồng Thư.',
    placeholder: '# Netscape cookies.txt, JSON hoặc Cookie header của xiaohongshu.com...',
  },
  {
    id: 'weibo',
    label: 'Weibo (微博)',
    domain: '.weibo.com',
    domainsMatch: ['weibo.com', 'weibo.cn', 'sina.com.cn'],
    description: 'Hỗ trợ tải video và truy cập chủ đề nóng cần đăng nhập trên Weibo.',
    placeholder: '# Netscape cookies.txt, JSON hoặc Cookie header của weibo.com...',
  },
  {
    id: 'xigua',
    label: 'Xigua Video (西瓜视频)',
    domain: '.ixigua.com',
    domainsMatch: ['ixigua.com', 'toutiao.com'],
    description: 'Xác thực tài khoản khi trích xuất và tải video dài từ Xigua.',
    placeholder: '# Netscape cookies.txt, JSON hoặc Cookie header của ixigua.com...',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    domain: '.facebook.com',
    domainsMatch: ['facebook.com', 'fb.com', 'fb.watch'],
    description: 'Hỗ trợ tải video/Reels từ nhóm riêng tư, trang cá nhân hoặc khi Facebook yêu cầu đăng nhập.',
    placeholder: '# Netscape cookies.txt, Cookie-Editor JSON hoặc Cookie header (c_user=...; xs=...) của facebook.com...',
  },
  {
    id: 'muse',
    label: 'Muse AI (muse.ai)',
    domain: '.muse.ai',
    domainsMatch: ['muse.ai'],
    description: 'Cookie phiên muse.ai (hatch_sess, hatch_gw, hatch_vml) để đẩy sang dịch vụ Muse2API sinh ảnh, video và kịch bản.',
    placeholder: '# Dán Cookie header (hatch_sess=...; hatch_gw=...; hatch_vml=...), JSON từ Cookie-Editor hoặc Netscape cookies.txt của muse.ai...',
  },
  {
    id: 'other',
    label: 'Trang khác (IG / X / Vimeo...)',
    domain: '',
    domainsMatch: [],
    description: 'Cookie cho Dailymotion, Vimeo, Instagram, X/Twitter...',
    placeholder: '# Dán Netscape cookies.txt hoặc Cookie-Editor JSON có sẵn tên miền...',
  },
];

export const EMPTY_PER_SITE_COOKIES: PerSiteCookies = {
  youtube: '',
  tiktok: '',
  bilibili: '',
  douyin: '',
  kuaishou: '',
  xiaohongshu: '',
  weibo: '',
  xigua: '',
  facebook: '',
  muse: '',
  other: '',
};

export const DEFAULT_STUDIO_CONFIG: StudioDefaultConfig = {
  aiProvider: 'gemini',
  brollSource: 'wikimedia',
  stylePreset: 'summary_fast',
  aspectRatioMode: 'auto',
  targetDurationSec: 60,
  visualMode: 'muse2api_video',
  voice: 'Kore',
  keepSourceAudio: false,
};

function classifyDomainToSite(domain: string): CookieSiteId {
  const lower = domain.toLowerCase();
  for (const site of COOKIE_SITES) {
    if (site.id === 'other' || site.id === 'bilibili') continue;
    if (site.domainsMatch.some((d) => lower.includes(d))) {
      return site.id;
    }
  }
  return 'other';
}

function rawCookieBlockToNetscapeLines(raw: string, fallbackDomain: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];

  const out: string[] = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
      if (Array.isArray(list) && list.length > 0) {
        for (const item of list) {
          const name = String(item?.name || '').trim();
          const value = String(item?.value ?? '').trim();
          const domain = String(item?.domain || fallbackDomain || '').trim();
          if (!name || !domain) continue;
          const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const pathVal = String(item?.path || '/');
          const secureVal = item?.secure ? 'TRUE' : 'FALSE';
          const expVal = item?.expirationDate ? String(Math.floor(Number(item.expirationDate))) : '0';
          out.push(`${domain}\t${includeSubdomains}\t${pathVal}\t${secureVal}\t${expVal}\t${name}\t${value}`);
        }
        if (out.length > 0) return out;
      }
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      if (l.split('\t').length >= 7) {
        out.push(l);
      }
    }
    if (out.length > 0) return out;
  }

  if (fallbackDomain) {
    const headerClean = trimmed.replace(/^cookie:\s*/i, '');
    for (const part of headerClean.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!name) continue;
      out.push(`${fallbackDomain}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
  }

  return out;
}

export function buildCombinedCookiesString(perSite: PerSiteCookies): string {
  const lines: string[] = [];
  for (const site of COOKIE_SITES) {
    if (site.id === 'bilibili' || site.id === 'muse') continue;
    const raw = perSite[site.id];
    if (!raw?.trim()) continue;
    const siteLines = rawCookieBlockToNetscapeLines(raw, site.domain);
    lines.push(...siteLines);
  }
  if (lines.length === 0) return '';
  return `# Netscape HTTP Cookie File\n${lines.join('\n')}`;
}

export function migrateLegacyCookies(legacyYtCookies: string, legacySessdata: string): PerSiteCookies {
  const result: PerSiteCookies = { ...EMPTY_PER_SITE_COOKIES, bilibili: legacySessdata || '' };
  const trimmed = (legacyYtCookies || '').trim();
  if (!trimmed) return result;

  const buckets: Record<CookieSiteId, string[]> = {
    youtube: [],
    tiktok: [],
    bilibili: [],
    douyin: [],
    kuaishou: [],
    xiaohongshu: [],
    weibo: [],
    xigua: [],
    facebook: [],
    muse: [],
    other: [],
  };

  const netscapeLines = rawCookieBlockToNetscapeLines(trimmed, '');
  if (netscapeLines.length > 0) {
    for (const line of netscapeLines) {
      const cols = line.split('\t');
      const siteId = classifyDomainToSite(cols[0] || '');
      buckets[siteId].push(line);
    }
    (Object.keys(buckets) as CookieSiteId[]).forEach((k) => {
      if (buckets[k].length > 0) {
        result[k] = `# Netscape HTTP Cookie File\n${buckets[k].join('\n')}`;
      }
    });
  } else {
    result.other = trimmed;
  }

  return result;
}
