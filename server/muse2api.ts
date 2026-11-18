import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface Muse2ApiConfig {
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  maskedKey: string;
  source: 'env' | 'local_dotenv' | 'none';
  imageTimeoutSec: number;
  videoTimeoutSec: number;
  chatTimeoutSec: number;
}

export interface Muse2ApiStatusResult {
  reachable: boolean;
  ready: boolean;
  status: 'ready' | 'no_account' | 'auth_error' | 'offline';
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string;
  keySource: 'env' | 'local_dotenv' | 'none';
  accountsCount: number;
  healthyAccounts: number;
  browserRunning: boolean;
  mediaCount: number;
  stats?: {
    total?: number;
    enabled?: number;
    disabled?: number;
    healthy?: number;
    error?: number;
    expiring?: number;
    expired?: number;
  };
  accounts?: any[];
  localRuntime: {
    bundledDirExists: boolean;
    pythonAvailable: boolean;
    uvicornInstalled: boolean;
    chromiumAvailable: boolean;
    processRunning: boolean;
  };
  error?: string;
}

const MUSE2API_DIR = path.join(process.cwd(), 'muse2api');
let localMuseProc: ChildProcess | null = null;
let cachedRuntimeProbe: {
  checkedAt: number;
  bundledDirExists: boolean;
  pythonAvailable: boolean;
  uvicornInstalled: boolean;
  chromiumAvailable: boolean;
} | null = null;

function readLocalMuse2ApiDotenv(): Record<string, string> {
  const envPath = path.join(MUSE2API_DIR, '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const idx = s.indexOf('=');
      const k = s.slice(0, idx).trim();
      const v = s.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (k) out[k] = v;
    }
  } catch {
    // ignore read error
  }
  return out;
}

function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 10) return '••••••••';
  return `${k.slice(0, 6)}••••••${k.slice(-4)}`;
}

export function resolveMuse2ApiConfig(): Muse2ApiConfig {
  const localEnv = readLocalMuse2ApiDotenv();
  const envUrl = process.env.MUSE2API_BASE_URL?.trim();
  const localPort = localEnv.MUSE2API_PORT?.trim() || '18610';
  const rawUrl = (envUrl || `http://127.0.0.1:${localPort}`).replace(/\/v1\/?$/i, '').replace(/\/+$/, '');

  const envKey = process.env.MUSE2API_KEY?.trim() || '';
  const fileKey = localEnv.MUSE2API_KEY?.trim() || '';
  const apiKey = envKey || fileKey;
  const source: 'env' | 'local_dotenv' | 'none' = envKey ? 'env' : fileKey ? 'local_dotenv' : 'none';

  return {
    baseUrl: rawUrl,
    apiKey,
    hasKey: Boolean(apiKey),
    maskedKey: maskKey(apiKey),
    source,
    imageTimeoutSec: Math.max(30, Number(process.env.MUSE2API_IMAGE_TIMEOUT || localEnv.MUSE2API_IMAGE_TIMEOUT || 240)),
    videoTimeoutSec: Math.max(60, Number(process.env.MUSE2API_VIDEO_TIMEOUT || localEnv.MUSE2API_VIDEO_TIMEOUT || 600)),
    chatTimeoutSec: Math.max(30, Number(process.env.MUSE2API_CHAT_TIMEOUT || localEnv.MUSE2API_CHAT_TIMEOUT || 300)),
  };
}

function checkCmdSync(cmd: string, args: string[], timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(false);
      }, timeoutMs);
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      p.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function findLocalPythonBin(): string {
  const candidates = [
    path.join(MUSE2API_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(MUSE2API_DIR, '.venv', 'bin', 'python'),
    'python3',
    'python',
  ];
  for (const c of candidates) {
    if (c.includes(path.sep)) {
      if (fs.existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return 'python3';
}

export async function probeLocalMuse2ApiRuntime(force = false) {
  if (!force && cachedRuntimeProbe && Date.now() - cachedRuntimeProbe.checkedAt < 60_000) {
    return {
      ...cachedRuntimeProbe,
      processRunning: Boolean(localMuseProc && localMuseProc.exitCode === null),
    };
  }

  const bundledDirExists = fs.existsSync(path.join(MUSE2API_DIR, 'app.py'));
  const pyBin = findLocalPythonBin();
  const pythonAvailable = await checkCmdSync(pyBin, ['--version']);
  const uvicornInstalled = pythonAvailable
    ? await checkCmdSync(pyBin, ['-c', 'import fastapi, uvicorn, pydantic, requests, websocket'])
    : false;

  let chromiumAvailable = false;
  for (const bin of [
    process.env.MUSE2API_CHROMIUM?.trim() || '',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    'chromium',
    'google-chrome',
  ]) {
    if (!bin) continue;
    if (bin.startsWith('/') && fs.existsSync(bin)) {
      chromiumAvailable = true;
      break;
    }
    if (!bin.startsWith('/') && (await checkCmdSync(bin, ['--version']))) {
      chromiumAvailable = true;
      break;
    }
  }

  cachedRuntimeProbe = {
    checkedAt: Date.now(),
    bundledDirExists,
    pythonAvailable,
    uvicornInstalled,
    chromiumAvailable,
  };

  return {
    ...cachedRuntimeProbe,
    processRunning: Boolean(localMuseProc && localMuseProc.exitCode === null),
  };
}

export async function startLocalMuse2ApiProcess(): Promise<{ ok: boolean; message: string }> {
  const runtime = await probeLocalMuse2ApiRuntime(true);
  if (!runtime.bundledDirExists) {
    return { ok: false, message: 'Không tìm thấy thư mục /muse2api trên máy chủ.' };
  }
  if (!runtime.pythonAvailable) {
    return { ok: false, message: 'Máy chủ chưa có Python 3.10+. Hãy chạy Muse2API bằng Docker hoặc trên máy cá nhân rồi trỏ MUSE2API_BASE_URL tới đó.' };
  }
  if (!runtime.uvicornInstalled) {
    return {
      ok: false,
      message: 'Thiếu thư viện Python (fastapi, uvicorn...). Hãy chạy: pip install -r muse2api/requirements.txt trong môi trường ảo rồi thử lại.',
    };
  }
  if (!runtime.chromiumAvailable) {
    return {
      ok: false,
      message: 'Môi trường này chưa cài Chromium/Chrome nên không thể mở phiên muse.ai trực tiếp tại đây. Hãy chạy Docker hoặc chạy Muse2API trên máy tính của bạn (có Chrome/Chromium), mở Tunnel và điền MUSE2API_BASE_URL + MUSE2API_KEY.',
    };
  }
  if (localMuseProc && localMuseProc.exitCode === null) {
    return { ok: true, message: 'Tiến trình Muse2API cục bộ đang chạy.' };
  }

  const pyBin = findLocalPythonBin();
  const cfg = resolveMuse2ApiConfig();
  let port = '18610';
  try {
    const parsed = new URL(cfg.baseUrl);
    if (parsed.port) port = parsed.port;
  } catch {
    // ignore
  }

  const env = { ...process.env };
  if (cfg.apiKey && !env.MUSE2API_KEY) {
    env.MUSE2API_KEY = cfg.apiKey;
  }

  localMuseProc = spawn(pyBin, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', port], {
    cwd: MUSE2API_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  localMuseProc.on('exit', () => {
    localMuseProc = null;
  });

  // Wait up to 6s for /readyz to respond
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        return { ok: true, message: `Đã khởi chạy Muse2API nội bộ tại cổng ${port}.` };
      }
    } catch {
      // keep waiting
    }
  }

  return { ok: true, message: 'Đã gửi lệnh khởi chạy Muse2API cục bộ. Đang khởi tạo uvicorn...' };
}

export function stopLocalMuse2ApiProcess(): { ok: boolean; message: string } {
  if (localMuseProc && localMuseProc.exitCode === null) {
    localMuseProc.kill('SIGTERM');
    localMuseProc = null;
    return { ok: true, message: 'Đã dừng tiến trình Muse2API cục bộ.' };
  }
  return { ok: true, message: 'Không có tiến trình Muse2API cục bộ đang chạy.' };
}

async function museFetch(pathAndQuery: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const cfg = resolveMuse2ApiConfig();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cfg.apiKey) {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  }
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${cfg.baseUrl}${pathAndQuery}`, {
    ...init,
    headers,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

async function parseMuseResponseJson<T = any>(res: Response): Promise<T> {
  const txt = await res.text();
  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const errMsg =
      json?.error?.message ||
      (typeof json?.error === 'string' ? json.error : '') ||
      json?.detail ||
      json?.message ||
      txt.slice(0, 200) ||
      `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error(`Muse2API từ chối xác thực (401): ${errMsg}. Hãy kiểm tra MUSE2API_KEY trong Settings > Secrets hoặc .env.`);
    }
    throw new Error(`Muse2API lỗi (HTTP ${res.status}): ${errMsg}`);
  }
  return json as T;
}

export function convertCookieTextToHeader(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';

  // JSON format (Cookie-Editor array or { cookies: [...] } or key-value map)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const pairs = parsed
          .map((item) => {
            const name = String(item?.name || '').trim();
            const val = String(item?.value ?? '').trim();
            return name ? `${name}=${val}` : '';
          })
          .filter(Boolean);
        if (pairs.length > 0) return pairs.join('; ');
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.cookies)) {
          const pairs = parsed.cookies
            .map((item: any) => (item?.name ? `${String(item.name).trim()}=${String(item.value ?? '').trim()}` : ''))
            .filter(Boolean);
          if (pairs.length > 0) return pairs.join('; ');
        } else {
          const pairs = Object.entries(parsed)
            .map(([k, v]) => `${k.trim()}=${String(v ?? '').trim()}`)
            .filter((p) => !p.startsWith('='));
          if (pairs.length > 0) return pairs.join('; ');
        }
      }
    } catch {
      // fall through
    }
  }

  // Netscape cookies.txt (7 tab-separated columns)
  if (trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie') || trimmed.includes('\t')) {
    const pairs: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const cols = s.split('\t');
      if (cols.length >= 7 && cols[5]?.trim()) {
        pairs.push(`${cols[5].trim()}=${(cols[6] ?? '').trim()}`);
      }
    }
    if (pairs.length > 0) return pairs.join('; ');
  }

  // Strip optional leading "cookie:" prefix from Request Headers copy
  return trimmed.replace(/^cookie:\s*/i, '').trim();
}

export async function getMuse2ApiStatus(): Promise<Muse2ApiStatusResult> {
  const cfg = resolveMuse2ApiConfig();
  const localRuntime = await probeLocalMuse2ApiRuntime();

  let readyData: { status?: string; accounts?: number; browser_running?: boolean } | null = null;
  try {
    const readyRes = await fetch(`${cfg.baseUrl}/readyz`, {
      signal: AbortSignal.timeout(3500),
    });
    if (readyRes.ok) {
      readyData = (await readyRes.json()) as any;
    }
  } catch (err: any) {
    return {
      reachable: false,
      ready: false,
      status: 'offline',
      baseUrl: cfg.baseUrl,
      hasKey: cfg.hasKey,
      maskedKey: cfg.maskedKey,
      keySource: cfg.source,
      accountsCount: 0,
      healthyAccounts: 0,
      browserRunning: false,
      mediaCount: 0,
      localRuntime,
      error: `Không kết nối được tới Muse2API (${cfg.baseUrl}): ${err?.message || 'Service chưa chạy'}`,
    };
  }

  if (!readyData) {
    return {
      reachable: false,
      ready: false,
      status: 'offline',
      baseUrl: cfg.baseUrl,
      hasKey: cfg.hasKey,
      maskedKey: cfg.maskedKey,
      keySource: cfg.source,
      accountsCount: 0,
      healthyAccounts: 0,
      browserRunning: false,
      mediaCount: 0,
      localRuntime,
      error: `Máy chủ tại ${cfg.baseUrl} không phản hồi /readyz.`,
    };
  }

  try {
    const statusRes = await museFetch('/admin/status', {}, 5000);
    if (statusRes.status === 401) {
      return {
        reachable: true,
        ready: readyData.status === 'ready',
        status: 'auth_error',
        baseUrl: cfg.baseUrl,
        hasKey: cfg.hasKey,
        maskedKey: cfg.maskedKey,
        keySource: cfg.source,
        accountsCount: Number(readyData.accounts || 0),
        healthyAccounts: 0,
        browserRunning: Boolean(readyData.browser_running),
        mediaCount: 0,
        localRuntime,
        error: cfg.hasKey
          ? 'MUSE2API_KEY không khớp với máy chủ Muse2API.'
          : 'Muse2API đang chạy nhưng thiếu MUSE2API_KEY trong Settings > Secrets hoặc .env.',
      };
    }
    const adminData = await parseMuseResponseJson<any>(statusRes);
    const stats = adminData?.stats || {};
    const accounts = Array.isArray(adminData?.accounts) ? adminData.accounts : [];
    const accountsCount = Number(stats.total ?? accounts.length ?? readyData.accounts ?? 0);
    const enabledCount = Number(stats.enabled ?? readyData.accounts ?? 0);
    const healthyCount = Number(stats.healthy ?? accounts.filter((a: any) => a?.ok === true).length ?? 0);

    return {
      reachable: true,
      ready: enabledCount > 0,
      status: enabledCount > 0 ? 'ready' : 'no_account',
      baseUrl: cfg.baseUrl,
      hasKey: cfg.hasKey,
      maskedKey: cfg.maskedKey,
      keySource: cfg.source,
      accountsCount,
      healthyAccounts: healthyCount,
      browserRunning: Boolean(adminData?.browser_running ?? readyData.browser_running),
      mediaCount: Number(adminData?.media_count || 0),
      stats,
      accounts,
      localRuntime,
    };
  } catch (err: any) {
    return {
      reachable: true,
      ready: readyData.status === 'ready',
      status: readyData.status === 'ready' ? 'ready' : 'no_account',
      baseUrl: cfg.baseUrl,
      hasKey: cfg.hasKey,
      maskedKey: cfg.maskedKey,
      keySource: cfg.source,
      accountsCount: Number(readyData.accounts || 0),
      healthyAccounts: 0,
      browserRunning: Boolean(readyData.browser_running),
      mediaCount: 0,
      localRuntime,
      error: err?.message,
    };
  }
}

export async function listMuse2ApiAccounts() {
  const res = await museFetch('/admin/accounts', {}, 8000);
  return parseMuseResponseJson<{ accounts: any[]; stats: any }>(res);
}

export async function addMuse2ApiAccount(payload: { label?: string; cookieHeader?: string; batch?: string }) {
  const body: any = {};
  if (payload.batch?.trim()) {
    const convertedLines = payload.batch
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.includes('|')) {
          const [lbl, rest] = line.split('|', 2);
          if (!lbl.includes('=')) {
            return `${lbl.trim()} | ${convertCookieTextToHeader(rest)}`;
          }
        }
        return convertCookieTextToHeader(line);
      })
      .join('\n');
    body.batch = convertedLines;
  } else {
    body.label = payload.label?.trim() || 'Muse Account';
    body.cookie_header = convertCookieTextToHeader(payload.cookieHeader || '');
    if (!body.cookie_header) {
      throw new Error('Không đọc được Cookie hợp lệ của muse.ai.');
    }
  }
  const res = await museFetch('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 10_000);
  return parseMuseResponseJson(res);
}

export async function testMuse2ApiAccount(accountId: string) {
  const res = await museFetch(`/admin/accounts/${encodeURIComponent(accountId)}/test`, { method: 'POST' }, 65_000);
  return parseMuseResponseJson(res);
}

export async function keepaliveMuse2ApiAccount(accountId: string) {
  const res = await museFetch(`/admin/accounts/${encodeURIComponent(accountId)}/keepalive`, { method: 'POST' }, 25_000);
  return parseMuseResponseJson(res);
}

export async function keepaliveAllMuse2ApiAccounts() {
  const res = await museFetch('/admin/accounts/keepalive?force=true', { method: 'POST' }, 60_000);
  return parseMuseResponseJson(res);
}

export async function quotaMuse2ApiAccount(accountId: string) {
  const res = await museFetch(`/admin/accounts/${encodeURIComponent(accountId)}/quota`, { method: 'POST' }, 45_000);
  return parseMuseResponseJson(res);
}

export async function patchMuse2ApiAccount(accountId: string, patch: { label?: string; enabled?: boolean }) {
  const res = await museFetch(`/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, 10_000);
  return parseMuseResponseJson(res);
}

export async function deleteMuse2ApiAccount(accountId: string) {
  const res = await museFetch(`/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  }, 10_000);
  return parseMuseResponseJson(res);
}

export async function listMuse2ApiTasks(limit = 30) {
  const res = await museFetch(`/admin/tasks?limit=${limit}`, {}, 10_000);
  return parseMuseResponseJson<{ tasks: any[] }>(res);
}

export async function listMuse2ApiMedia() {
  const res = await museFetch('/admin/media', {}, 10_000);
  return parseMuseResponseJson<{ media: any[]; count: number }>(res);
}

function resolveMuseMediaAbsoluteUrl(mediaPathOrUrl: string): string {
  const cfg = resolveMuse2ApiConfig();
  const s = String(mediaPathOrUrl || '').trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const parsed = new URL(s);
      const baseParsed = new URL(cfg.baseUrl);
      const isLocalHost = (h: string) => h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0';
      if (isLocalHost(parsed.hostname) && parsed.host !== baseParsed.host) {
        return `${cfg.baseUrl}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // keep original
    }
    return s;
  }
  return `${cfg.baseUrl}${s.startsWith('/') ? '' : '/'}${s}`;
}

export async function chatWithMuse2ApiSpark(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  timeoutSec?: number
): Promise<string> {
  const cfg = resolveMuse2ApiConfig();
  const effectiveTimeout = Math.max(30, timeoutSec || cfg.chatTimeoutSec);
  const res = await museFetch(
    '/v1/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'muse-spark',
        messages,
        stream: false,
        timeout: effectiveTimeout,
      }),
    },
    (effectiveTimeout + 20) * 1000
  );
  const data = await parseMuseResponseJson<any>(res);
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new Error('Muse2API (muse-spark) không trả về nội dung phản hồi.');
  }
  return text;
}

export async function generateImageViaMuse2Api(params: {
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  referenceImageDataUrl?: string;
  timeoutSec?: number;
}): Promise<{ dataUrl: string; model: string }> {
  const cfg = resolveMuse2ApiConfig();
  const effectiveTimeout = Math.max(60, params.timeoutSec || cfg.imageTimeoutSec);

  const createRes = await museFetch(
    '/v1/images/tasks',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'muse-image',
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio || '16:9',
        response_format: 'url',
        timeout: effectiveTimeout,
        ...(params.referenceImageDataUrl ? { reference_image: params.referenceImageDataUrl } : {}),
      }),
    },
    20_000
  );
  const created = await parseMuseResponseJson<{ id: string; status: string }>(createRes);
  if (!created?.id) {
    throw new Error('Muse2API không trả về mã tác vụ tạo ảnh.');
  }

  const deadline = Date.now() + (effectiveTimeout + 30) * 1000;
  let taskResult: any = created;

  while (Date.now() < deadline) {
    if (taskResult.status === 'completed') break;
    if (taskResult.status === 'failed') {
      throw new Error(taskResult.error || 'Muse2API tạo ảnh thất bại.');
    }
    await new Promise((r) => setTimeout(r, 2500));
    const pollRes = await museFetch(`/v1/images/tasks/${encodeURIComponent(created.id)}`, {}, 15_000);
    taskResult = await parseMuseResponseJson(pollRes);
  }

  if (taskResult.status !== 'completed') {
    throw new Error('Quá thời gian chờ Muse2API tạo ảnh (muse-image).');
  }

  const item = Array.isArray(taskResult.data) ? taskResult.data[0] : null;
  if (item?.b64_json) {
    return { dataUrl: `data:image/png;base64,${item.b64_json}`, model: 'muse-image' };
  }

  const mediaUrl = resolveMuseMediaAbsoluteUrl(item?.url || taskResult.url || '');
  if (!mediaUrl) {
    throw new Error('Muse2API không trả về đường dẫn ảnh hoàn chỉnh.');
  }

  const dl = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
  if (!dl.ok) {
    throw new Error(`Không tải được ảnh từ Muse2API (${mediaUrl}): HTTP ${dl.status}`);
  }
  const mime = dl.headers.get('content-type') || 'image/webp';
  const buf = Buffer.from(await dl.arrayBuffer());
  return {
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    model: 'muse-image',
  };
}

export async function generateVideoBufferViaMuse2Api(params: {
  prompt: string;
  aspectRatio: '9:16' | '16:9';
  durationSec?: number;
  referenceImageDataUrl?: string;
  timeoutSec?: number;
}): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const cfg = resolveMuse2ApiConfig();
  const effectiveTimeout = Math.max(90, params.timeoutSec || cfg.videoTimeoutSec);
  const clampedDur = Math.max(3, Math.min(12, Math.round(params.durationSec || 6)));

  const createRes = await museFetch(
    '/v1/videos',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'muse-video',
        prompt: params.prompt,
        duration: clampedDur,
        aspect_ratio: params.aspectRatio,
        size: params.aspectRatio,
        timeout: effectiveTimeout,
        ...(params.referenceImageDataUrl ? { reference_image: params.referenceImageDataUrl } : {}),
      }),
    },
    20_000
  );
  const created = await parseMuseResponseJson<{ id: string; status: string }>(createRes);
  if (!created?.id) {
    throw new Error('Muse2API không trả về mã tác vụ tạo video.');
  }

  const deadline = Date.now() + (effectiveTimeout + 45) * 1000;
  let taskState: any = created;

  while (Date.now() < deadline) {
    if (taskState.status === 'completed' || taskState.status === 'succeeded') break;
    if (taskState.status === 'failed') {
      throw new Error(taskState.error || 'Muse2API tạo video thất bại.');
    }
    await new Promise((r) => setTimeout(r, 3500));
    const pollRes = await museFetch(`/v1/videos/${encodeURIComponent(created.id)}`, {}, 15_000);
    taskState = await parseMuseResponseJson(pollRes);
  }

  if (taskState.status !== 'completed' && taskState.status !== 'succeeded') {
    throw new Error('Quá thời gian chờ Muse2API tạo video (muse-video).');
  }

  const rawVideoUrl =
    taskState?.result?.url ||
    taskState?.video?.url ||
    taskState?.url ||
    '';
  const mediaUrl = resolveMuseMediaAbsoluteUrl(rawVideoUrl);
  if (!mediaUrl) {
    throw new Error('Muse2API hoàn tất nhưng không trả về URL video.');
  }

  const dl = await fetch(mediaUrl, { signal: AbortSignal.timeout(90_000) });
  if (!dl.ok) {
    throw new Error(`Không tải được video từ Muse2API (${mediaUrl}): HTTP ${dl.status}`);
  }
  const mimeType = dl.headers.get('content-type') || 'video/mp4';
  const buffer = Buffer.from(await dl.arrayBuffer());
  if (buffer.byteLength < 5000) {
    throw new Error('Dữ liệu video trả về từ Muse2API không hợp lệ hoặc quá nhỏ.');
  }
  const ext = mimeType.includes('webm') ? '.webm' : '.mp4';
  return { buffer, mimeType, ext };
}
