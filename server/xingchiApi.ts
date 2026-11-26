import fs from 'fs';
import path from 'path';
import type {
  XingchiConnectionStatus,
  XingchiModelItem,
  XingchiProtocol,
  XingchiPublicStatus,
  XingchiWebSearchMode,
} from '../src/types/bilibili';

const DEFAULT_XINGCHI_BASE_URL = 'https://api.xingchiapi.com';
const DEFAULT_XINGCHI_MODEL = 'gpt-6.1-sol';
const DEFAULT_XINGCHI_ACTOR_AUTH = 'local-image-extension';
const CODEX_USER_AGENT = 'codex_cli_rs/0.29.0';
const ALLOWED_XINGCHI_HOSTS = new Set(['api.xingchiapi.com', 'xingchiapi.com']);
const BLOCKED_CUSTOM_HEADERS = new Set([
  'authorization',
  'host',
  'cookie',
  'set-cookie',
  'x-api-key',
  'content-length',
  'transfer-encoding',
  'connection',
  'proxy-authorization',
]);
const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'xingchi_config.json');

interface XingchiPersistedConfig {
  version: number;
  enabled: boolean;
  protocol: XingchiProtocol;
  selectedModel: string;
  reviewModel: string;
  webSearch: XingchiWebSearchMode;
  disableResponseStorage: boolean;
  imageGeneration: boolean;
  apiKeyModelDiscovery: boolean;
  httpHeaders: Record<string, string>;
  timeoutSec: number;
  status: XingchiConnectionStatus;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  lastError?: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  models: XingchiModelItem[];
  modelsFetchedAt?: number;
}

function resolveEnvProtocol(): XingchiProtocol {
  const raw = String(process.env.XINGCHI_WIRE_API || 'responses')
    .trim()
    .toLowerCase();
  if (raw === 'anthropic') return 'anthropic';
  if (raw === 'openai' || raw === 'chat' || raw === 'chat_completions') return 'openai';
  return 'responses';
}

function getDefaultHttpHeaders(): Record<string, string> {
  const actorAuth = String(process.env.XINGCHI_ACTOR_AUTH || DEFAULT_XINGCHI_ACTOR_AUTH)
    .replace(/[\r\n]/g, '')
    .trim();
  return actorAuth ? { 'x-openai-actor-authorization': actorAuth } : {};
}

export function sanitizeXingchiHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const clean: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 10) break;
    const key = String(k || '')
      .trim()
      .toLowerCase();
    if (!key || BLOCKED_CUSTOM_HEADERS.has(key)) continue;
    // Allow only safe custom x-* extension headers
    if (!/^x-[a-z0-9-]{2,64}$/.test(key)) continue;
    const val = String(v ?? '')
      .replace(/[\r\n\0]/g, '')
      .trim();
    if (!val || val.length > 200) continue;
    clean[key] = val;
    count += 1;
  }
  return clean;
}

function parseProtocolValue(val: unknown): XingchiProtocol | undefined {
  if (val === 'responses' || val === 'openai' || val === 'anthropic') {
    return val;
  }
  return undefined;
}

function normalizeApiKeySecret(raw?: string): string {
  const original = String(raw || '');
  if (!original) return '';
  let s = original
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
  // Strip accidental key=value assignment if pasted from .env or TOML
  s = s.replace(/^(?:export\s+)?(?:XINGCHI_API_KEY|experimental_bearer_token|api_key)\s*=\s*/i, '').trim();
  // Strip surrounding straight/smart quotes or backticks
  s = s.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
  // Strip accidental Bearer prefix
  s = s.replace(/^bearer\s+/i, '').trim();
  // Strip quotes again in case value was "Bearer sk-..."
  s = s.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();
  return s;
}

function createDefaultConfig(): XingchiPersistedConfig {
  const envModel = (process.env.XINGCHI_MODEL || DEFAULT_XINGCHI_MODEL).trim() || DEFAULT_XINGCHI_MODEL;
  const envReview =
    (process.env.XINGCHI_REVIEW_MODEL || envModel || DEFAULT_XINGCHI_MODEL).trim() || DEFAULT_XINGCHI_MODEL;
  return {
    version: 2,
    enabled: true,
    protocol: resolveEnvProtocol(),
    selectedModel: isValidModelSlug(envModel) ? envModel : DEFAULT_XINGCHI_MODEL,
    reviewModel: isValidModelSlug(envReview) ? envReview : DEFAULT_XINGCHI_MODEL,
    webSearch: 'live',
    disableResponseStorage: true,
    imageGeneration: true,
    apiKeyModelDiscovery: true,
    httpHeaders: getDefaultHttpHeaders(),
    timeoutSec: 75,
    status: hasXingchiEnvKey() ? 'untested' : 'unconfigured',
    requestsCount: 0,
    successCount: 0,
    errorCount: 0,
    models: [],
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig(): XingchiPersistedConfig {
  try {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      return createDefaultConfig();
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<XingchiPersistedConfig>;
    const base = createDefaultConfig();
    const parsedProtocol = parseProtocolValue(parsed.protocol);
    const parsedHeaders =
      parsed.httpHeaders && typeof parsed.httpHeaders === 'object'
        ? sanitizeXingchiHeaders(parsed.httpHeaders)
        : base.httpHeaders;
    return {
      ...base,
      version: 2,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
      protocol: parsedProtocol || base.protocol,
      selectedModel:
        typeof parsed.selectedModel === 'string' && isValidModelSlug(parsed.selectedModel.trim())
          ? parsed.selectedModel.trim()
          : base.selectedModel,
      reviewModel:
        typeof parsed.reviewModel === 'string' && isValidModelSlug(parsed.reviewModel.trim())
          ? parsed.reviewModel.trim()
          : base.reviewModel,
      webSearch: parsed.webSearch === 'off' ? 'off' : 'live',
      disableResponseStorage:
        typeof parsed.disableResponseStorage === 'boolean'
          ? parsed.disableResponseStorage
          : base.disableResponseStorage,
      imageGeneration:
        typeof parsed.imageGeneration === 'boolean' ? parsed.imageGeneration : base.imageGeneration,
      apiKeyModelDiscovery:
        typeof parsed.apiKeyModelDiscovery === 'boolean'
          ? parsed.apiKeyModelDiscovery
          : base.apiKeyModelDiscovery,
      httpHeaders: parsedHeaders,
      timeoutSec: clampTimeoutSec(parsed.timeoutSec ?? base.timeoutSec),
      status: parsed.status || base.status,
      lastCheckedAt: typeof parsed.lastCheckedAt === 'number' ? parsed.lastCheckedAt : undefined,
      lastLatencyMs: typeof parsed.lastLatencyMs === 'number' ? parsed.lastLatencyMs : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      requestsCount: typeof parsed.requestsCount === 'number' ? parsed.requestsCount : 0,
      successCount: typeof parsed.successCount === 'number' ? parsed.successCount : 0,
      errorCount: typeof parsed.errorCount === 'number' ? parsed.errorCount : 0,
      models: Array.isArray(parsed.models) ? parsed.models.slice(0, 300) : [],
      modelsFetchedAt: typeof parsed.modelsFetchedAt === 'number' ? parsed.modelsFetchedAt : undefined,
    };
  } catch {
    return createDefaultConfig();
  }
}

let xingchiStore: XingchiPersistedConfig = loadConfig();

function saveConfig(): void {
  try {
    ensureDataDir();
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(xingchiStore, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch {
    // Non-fatal persistence issue
  }
}

function clampTimeoutSec(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 75;
  return Math.max(10, Math.min(240, Math.round(num)));
}

export function isValidModelSlug(slug: string): boolean {
  return /^[a-zA-Z0-9._:/-]{1,120}$/.test(slug);
}

export function resolveXingchiBaseUrl(): string {
  const raw = String(process.env.XINGCHI_BASE_URL || DEFAULT_XINGCHI_BASE_URL).trim();
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_XINGCHI_HOSTS.has(host) || host.endsWith('.xingchiapi.com');
    if (parsed.protocol !== 'https:' || !isAllowedHost) {
      return DEFAULT_XINGCHI_BASE_URL;
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return DEFAULT_XINGCHI_BASE_URL;
  }
}

export function hasXingchiEnvKey(): boolean {
  return Boolean(getXingchiApiKeySecret());
}

function getXingchiApiKeySecret(): string {
  return normalizeApiKeySecret(process.env.XINGCHI_API_KEY);
}

export function buildXingchiHeaders(
  apiKey: string,
  extra?: Record<string, string>,
  opts?: { codexClient?: boolean }
): Record<string, string> {
  const base: Record<string, string> = {
    ...sanitizeXingchiHeaders(xingchiStore.httpHeaders),
  };
  if (opts?.codexClient) {
    base['User-Agent'] = CODEX_USER_AGENT;
    base['originator'] = 'codex_cli_rs';
  }
  return {
    ...base,
    ...(extra || {}),
    Authorization: `Bearer ${apiKey}`,
  };
}

export function maskXingchiApiKey(key?: string): string {
  const s = String(key || '').trim();
  if (!s) return 'Chưa thiết lập';
  if (s.length <= 10) return `${s.slice(0, 3)}***${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function classifyModelFamily(id: string): XingchiModelItem['family'] {
  const lower = id.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
  if (
    lower.includes('gpt') ||
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('o4') ||
    lower.includes('chatgpt')
  ) {
    return 'gpt';
  }
  if (lower.includes('gemini') || lower.includes('gemma')) return 'gemini';
  return 'other';
}

function extractUpstreamErrorDetail(rawText: string): string {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return '';
  let extracted = '';
  try {
    const parsed = JSON.parse(trimmed) as any;
    const code = parsed?.error?.code || parsed?.code || '';
    const msg = parsed?.error?.message || parsed?.message || parsed?.detail || '';
    if (code && msg) {
      extracted = `${code}: ${msg}`;
    } else if (msg) {
      extracted = String(msg);
    } else if (code) {
      extracted = String(code);
    }
  } catch {
    extracted = trimmed;
  }
  return extracted
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function classifyXingchiError(statusCode: number | undefined, rawText: string): {
  status: XingchiConnectionStatus;
  message: string;
} {
  const lower = rawText.toLowerCase();
  const detail = extractUpstreamErrorDetail(rawText);
  const detailSuffix = detail ? ` · Chi tiết từ cổng: ${detail}` : '';

  if (
    statusCode === 401 ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key')
  ) {
    return {
      status: 'auth_error',
      message: `Cổng api.xingchiapi.com báo khóa không hợp lệ (HTTP ${statusCode || 401}${detailSuffix}). Lưu ý: trong Settings > Secrets chỉ dán chuỗi sk-... (không kèm dấu ngoặc kép) và kiểm tra khóa còn hoạt động trên tài khoản Xingchi.`,
    };
  }
  if (
    lower.includes('image generation is not enabled') ||
    lower.includes('not enabled for this group')
  ) {
    return {
      status: xingchiStore.status === 'ready' ? 'ready' : 'error',
      message: `Nhóm API Key hiện tại trên api.xingchiapi.com chưa được bật quyền tạo ảnh (HTTP ${statusCode || 403}${detailSuffix}). Kịch bản/text (${xingchiStore.selectedModel}) vẫn hoạt động bình thường; để tạo ảnh hãy bật quyền Image Generation cho nhóm key trên Xingchi hoặc chọn Gemini / Muse2API / Qwen / Google Flow.`,
    };
  }
  if (statusCode === 403 || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return {
      status: 'auth_error',
      message: `Cổng api.xingchiapi.com từ chối quyền truy cập (HTTP ${statusCode || 403}${detailSuffix}).`,
    };
  }
  if (
    statusCode === 402 ||
    statusCode === 429 ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('balance')
  ) {
    return {
      status: 'quota_exceeded',
      message: `Tài khoản Xingchi API chạm giới hạn tốc độ hoặc hết số dư/quota (HTTP ${statusCode || 429}${detailSuffix}).`,
    };
  }
  if (statusCode === 404 || lower.includes('model_not_found') || lower.includes('not found')) {
    return {
      status: 'error',
      message: `Model hoặc đường dẫn không tồn tại trên api.xingchiapi.com (HTTP 404${detailSuffix}). Hãy tải lại danh sách Model và chọn đúng mã model.`,
    };
  }
  return {
    status: 'error',
    message: statusCode
      ? `Xingchi API trả về HTTP ${statusCode}${detail ? `: ${detail}` : ''}`
      : detail || 'Không thể kết nối tới https://api.xingchiapi.com.',
  };
}

export function getXingchiPublicStatus(): XingchiPublicStatus {
  const hasKey = hasXingchiEnvKey();
  const baseUrl = resolveXingchiBaseUrl();
  const effectiveStatus: XingchiConnectionStatus = !hasKey
    ? 'unconfigured'
    : xingchiStore.status === 'unconfigured'
    ? 'untested'
    : xingchiStore.status;

  return {
    baseUrl,
    modelCatalogUrl: `${baseUrl}/v1/models`,
    hasKey,
    maskedKey: maskXingchiApiKey(getXingchiApiKeySecret()),
    keySource: hasKey ? 'env' : 'none',
    enabled: xingchiStore.enabled,
    configured: hasKey && xingchiStore.enabled,
    protocol: xingchiStore.protocol,
    selectedModel: xingchiStore.selectedModel,
    reviewModel: xingchiStore.reviewModel,
    webSearch: xingchiStore.webSearch,
    disableResponseStorage: xingchiStore.disableResponseStorage,
    imageGeneration: xingchiStore.imageGeneration,
    apiKeyModelDiscovery: xingchiStore.apiKeyModelDiscovery,
    httpHeaders: { ...xingchiStore.httpHeaders },
    timeoutSec: xingchiStore.timeoutSec,
    status: effectiveStatus,
    lastCheckedAt: xingchiStore.lastCheckedAt,
    lastLatencyMs: xingchiStore.lastLatencyMs,
    lastError: hasKey ? xingchiStore.lastError : undefined,
    requestsCount: xingchiStore.requestsCount,
    successCount: xingchiStore.successCount,
    errorCount: xingchiStore.errorCount,
    models: xingchiStore.models,
    modelsFetchedAt: xingchiStore.modelsFetchedAt,
  };
}

export function getXingchiRuntimeConfig(): {
  apiKey: string;
  baseUrl: string;
  v1BaseUrl: string;
  modelCatalogUrl: string;
  model: string;
  reviewModel: string;
  protocol: XingchiProtocol;
  webSearch: XingchiWebSearchMode;
  disableResponseStorage: boolean;
  imageGeneration: boolean;
  apiKeyModelDiscovery: boolean;
  httpHeaders: Record<string, string>;
  enabled: boolean;
  timeoutSec: number;
} {
  const baseUrl = resolveXingchiBaseUrl();
  const model =
    xingchiStore.selectedModel || (process.env.XINGCHI_MODEL || DEFAULT_XINGCHI_MODEL).trim() || DEFAULT_XINGCHI_MODEL;
  return {
    apiKey: getXingchiApiKeySecret(),
    baseUrl,
    v1BaseUrl: `${baseUrl}/v1`,
    modelCatalogUrl: `${baseUrl}/v1/models`,
    model,
    reviewModel: xingchiStore.reviewModel || model,
    protocol: xingchiStore.protocol,
    webSearch: xingchiStore.webSearch,
    disableResponseStorage: xingchiStore.disableResponseStorage,
    imageGeneration: xingchiStore.imageGeneration,
    apiKeyModelDiscovery: xingchiStore.apiKeyModelDiscovery,
    httpHeaders: { ...xingchiStore.httpHeaders },
    enabled: xingchiStore.enabled,
    timeoutSec: xingchiStore.timeoutSec,
  };
}

export function updateXingchiConfig(patch: {
  enabled?: boolean;
  protocol?: XingchiProtocol;
  selectedModel?: string;
  reviewModel?: string;
  webSearch?: XingchiWebSearchMode;
  disableResponseStorage?: boolean;
  imageGeneration?: boolean;
  apiKeyModelDiscovery?: boolean;
  httpHeaders?: Record<string, string>;
  timeoutSec?: number;
}): XingchiPublicStatus {
  if (typeof patch.enabled === 'boolean') {
    xingchiStore.enabled = patch.enabled;
  }
  const nextProtocol = parseProtocolValue(patch.protocol);
  if (nextProtocol) {
    xingchiStore.protocol = nextProtocol;
  }
  if (typeof patch.selectedModel === 'string') {
    const trimmed = patch.selectedModel.trim();
    if (!trimmed || !isValidModelSlug(trimmed)) {
      throw new Error('Mã model không hợp lệ. Chỉ dùng chữ, số và ký tự . _ : / - (tối đa 120 ký tự).');
    }
    xingchiStore.selectedModel = trimmed;
  }
  if (typeof patch.reviewModel === 'string') {
    const trimmed = patch.reviewModel.trim();
    if (!trimmed || !isValidModelSlug(trimmed)) {
      throw new Error('Mã review_model không hợp lệ.');
    }
    xingchiStore.reviewModel = trimmed;
  }
  if (patch.webSearch === 'live' || patch.webSearch === 'off') {
    xingchiStore.webSearch = patch.webSearch;
  }
  if (typeof patch.disableResponseStorage === 'boolean') {
    xingchiStore.disableResponseStorage = patch.disableResponseStorage;
  }
  if (typeof patch.imageGeneration === 'boolean') {
    xingchiStore.imageGeneration = patch.imageGeneration;
  }
  if (typeof patch.apiKeyModelDiscovery === 'boolean') {
    xingchiStore.apiKeyModelDiscovery = patch.apiKeyModelDiscovery;
  }
  if (patch.httpHeaders && typeof patch.httpHeaders === 'object') {
    xingchiStore.httpHeaders = sanitizeXingchiHeaders(patch.httpHeaders);
  }
  if (patch.timeoutSec !== undefined) {
    xingchiStore.timeoutSec = clampTimeoutSec(patch.timeoutSec);
  }
  saveConfig();
  return getXingchiPublicStatus();
}

export function importXingchiTomlConfig(rawToml: string): {
  ok: boolean;
  appliedFields: string[];
  ignoredSecretToken: boolean;
  warning?: string;
  status: XingchiPublicStatus;
} {
  const text = String(rawToml || '').trim();
  if (!text) {
    throw new Error('Vui lòng dán nội dung cấu hình TOML cần nạp.');
  }
  if (text.length > 20_000) {
    throw new Error('Nội dung cấu hình quá dài (tối đa 20.000 ký tự).');
  }

  const appliedFields: string[] = [];
  let ignoredSecretToken = false;

  const extractString = (key: string): string | undefined => {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\r\\n]+)["']`, 'm');
    const m = text.match(re);
    return m?.[1]?.trim();
  };

  const extractBool = (key: string): boolean | undefined => {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\b`, 'im');
    const m = text.match(re);
    if (!m) return undefined;
    return m[1].toLowerCase() === 'true';
  };

  if (/^\s*(experimental_bearer_token|api_key|bearer_token)\s*=/im.test(text)) {
    ignoredSecretToken = true;
  }

  const baseUrlVal = extractString('base_url');
  if (baseUrlVal) {
    try {
      const u = new URL(baseUrlVal);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:' || (!ALLOWED_XINGCHI_HOSTS.has(host) && !host.endsWith('.xingchiapi.com'))) {
        throw new Error('base_url chỉ chấp nhận tên miền HTTPS thuộc api.xingchiapi.com.');
      }
      appliedFields.push('base_url');
    } catch (err: any) {
      throw new Error(err?.message || 'base_url không hợp lệ.');
    }
  }

  const model = extractString('model');
  if (model && isValidModelSlug(model)) {
    xingchiStore.selectedModel = model;
    appliedFields.push(`model=${model}`);
  }

  const reviewModel = extractString('review_model');
  if (reviewModel && isValidModelSlug(reviewModel)) {
    xingchiStore.reviewModel = reviewModel;
    appliedFields.push(`review_model=${reviewModel}`);
  }

  const wireApi = extractString('wire_api')?.toLowerCase();
  if (wireApi === 'responses' || wireApi === 'openai' || wireApi === 'anthropic') {
    xingchiStore.protocol = wireApi;
    appliedFields.push(`wire_api=${wireApi}`);
  } else if (wireApi === 'chat' || wireApi === 'chat_completions') {
    xingchiStore.protocol = 'openai';
    appliedFields.push('wire_api=openai');
  }

  const webSearch = extractString('web_search')?.toLowerCase();
  if (webSearch === 'live' || webSearch === 'off') {
    xingchiStore.webSearch = webSearch;
    appliedFields.push(`web_search=${webSearch}`);
  }

  const disableStorage = extractBool('disable_response_storage');
  if (disableStorage !== undefined) {
    xingchiStore.disableResponseStorage = disableStorage;
    appliedFields.push(`disable_response_storage=${disableStorage}`);
  }

  const imageGen = extractBool('image_generation');
  if (imageGen !== undefined) {
    xingchiStore.imageGeneration = imageGen;
    appliedFields.push(`image_generation=${imageGen}`);
  }

  const discovery = extractBool('api_key_model_discovery');
  if (discovery !== undefined) {
    xingchiStore.apiKeyModelDiscovery = discovery;
    appliedFields.push(`api_key_model_discovery=${discovery}`);
  }

  const headersMatch = text.match(/^\s*http_headers\s*=\s*\{([^}]+)\}/m);
  if (headersMatch?.[1]) {
    const parsedHeaders: Record<string, string> = {};
    const pairRe = /["']([^"'\r\n]+)["']\s*=\s*["']([^"'\r\n]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(headersMatch[1])) !== null) {
      parsedHeaders[m[1]] = m[2];
    }
    const cleanHeaders = sanitizeXingchiHeaders(parsedHeaders);
    if (Object.keys(cleanHeaders).length > 0) {
      xingchiStore.httpHeaders = cleanHeaders;
      appliedFields.push(`http_headers(${Object.keys(cleanHeaders).join(', ')})`);
    }
  }

  if (appliedFields.length === 0) {
    throw new Error('Không tìm thấy trường cấu hình Xingchi hợp lệ trong đoạn TOML vừa dán.');
  }

  saveConfig();
  return {
    ok: true,
    appliedFields,
    ignoredSecretToken,
    warning: ignoredSecretToken
      ? 'Khóa API trong TOML đã được bỏ qua để bảo mật. Hãy đặt biến XINGCHI_API_KEY trong Settings > Secrets (chỉ dán chuỗi sk-..., không kèm dấu ngoặc kép).'
      : undefined,
    status: getXingchiPublicStatus(),
  };
}

export function recordXingchiUsage(
  ok: boolean,
  opts?: { latencyMs?: number; statusCode?: number; errorMsg?: string }
): void {
  const now = Date.now();
  xingchiStore.requestsCount = (xingchiStore.requestsCount || 0) + 1;
  xingchiStore.lastCheckedAt = now;
  if (opts?.latencyMs !== undefined) {
    xingchiStore.lastLatencyMs = Math.max(1, Math.round(opts.latencyMs));
  }
  if (ok) {
    xingchiStore.successCount = (xingchiStore.successCount || 0) + 1;
    xingchiStore.status = 'ready';
    xingchiStore.lastError = undefined;
  } else {
    xingchiStore.errorCount = (xingchiStore.errorCount || 0) + 1;
    const classified = classifyXingchiError(opts?.statusCode, opts?.errorMsg || '');
    xingchiStore.status = classified.status;
    xingchiStore.lastError = classified.message;
  }
  saveConfig();
}

export async function fetchXingchiModels(): Promise<{
  ok: boolean;
  models: XingchiModelItem[];
  latencyMs: number;
  message: string;
  status: XingchiPublicStatus;
}> {
  const apiKey = getXingchiApiKeySecret();
  const baseUrl = resolveXingchiBaseUrl();
  if (!apiKey) {
    throw new Error('Chưa cấu hình XINGCHI_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ.');
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: buildXingchiHeaders(apiKey, { Accept: 'application/json' }, { codexClient: true }),
      signal: AbortSignal.timeout(Math.min(30_000, xingchiStore.timeoutSec * 1000)),
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const classified = classifyXingchiError(res.status, errText);
      recordXingchiUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
      return {
        ok: false,
        models: xingchiStore.models,
        latencyMs,
        message: classified.message,
        status: getXingchiPublicStatus(),
      };
    }

    const payload = (await res.json().catch(() => ({}))) as any;
    const rawList: any[] = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
      ? payload.models
      : [];

    const dedup = new Map<string, XingchiModelItem>();
    for (const item of rawList) {
      const id = String(item?.id || item?.name || '').trim();
      if (!id || !isValidModelSlug(id)) continue;
      if (!dedup.has(id)) {
        dedup.set(id, {
          id,
          ownedBy: typeof item?.owned_by === 'string' ? item.owned_by : undefined,
          family: classifyModelFamily(id),
          created: typeof item?.created === 'number' ? item.created : undefined,
        });
      }
    }

    const models = Array.from(dedup.values()).sort((a, b) => a.id.localeCompare(b.id));
    xingchiStore.models = models;
    xingchiStore.modelsFetchedAt = Date.now();
    if (models.length > 0 && !xingchiStore.selectedModel) {
      const preferred =
        models.find((m) => m.id === DEFAULT_XINGCHI_MODEL) ||
        models.find((m) => m.family === 'gpt') ||
        models.find((m) => m.family === 'claude') ||
        models[0];
      if (preferred) {
        xingchiStore.selectedModel = preferred.id;
      }
    }
    recordXingchiUsage(true, { latencyMs });

    return {
      ok: true,
      models,
      latencyMs,
      message: `Đã đồng bộ ${models.length} model từ ${baseUrl}/v1/models (${latencyMs}ms).`,
      status: getXingchiPublicStatus(),
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const errMsg = String(err?.message || err || 'Lỗi kết nối tới api.xingchiapi.com');
    recordXingchiUsage(false, { latencyMs, errorMsg: errMsg });
    return {
      ok: false,
      models: xingchiStore.models,
      latencyMs,
      message: `Không thể tải danh sách model từ ${baseUrl}: ${errMsg.slice(0, 180)}`,
      status: getXingchiPublicStatus(),
    };
  }
}

function sanitizeDebugPreview(raw: string, maxLen = 180): string {
  return String(raw || '')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function extractEmbeddedError(data: any): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const errObj = data?.error || data?.response?.error;
  if (errObj) {
    const msg =
      typeof errObj === 'string'
        ? errObj
        : errObj?.message || errObj?.code || JSON.stringify(errObj);
    if (msg) return sanitizeDebugPreview(String(msg), 220);
  }
  if (data?.status === 'failed') {
    return sanitizeDebugPreview(
      String(data?.incomplete_details?.reason || data?.message || 'Response status=failed'),
      220
    );
  }
  if (
    typeof data?.code === 'string' &&
    data.code.toLowerCase() !== 'ok' &&
    data.code !== '0' &&
    data.code !== '200' &&
    typeof data?.message === 'string' &&
    !data?.output &&
    !data?.choices
  ) {
    return sanitizeDebugPreview(`${data.code}: ${data.message}`, 220);
  }
  return undefined;
}

function extractResponsesApiText(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const root =
    data?.response && typeof data.response === 'object' && !data.output && !data.output_text
      ? data.response
      : data?.data && typeof data.data === 'object' && !Array.isArray(data.data) && !data.output && !data.output_text
      ? data.data
      : data;

  if (typeof root?.output_text === 'string' && root.output_text.trim()) {
    return root.output_text.trim();
  }
  const chunks: string[] = [];
  if (Array.isArray(root?.output)) {
    for (const item of root.output) {
      if (item?.type === 'reasoning') continue;
      if (typeof item?.text === 'string' && item.text.trim()) {
        chunks.push(item.text.trim());
      }
      if (typeof item?.content === 'string' && item.content.trim()) {
        chunks.push(item.content.trim());
      } else if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (typeof part === 'string' && part.trim()) {
            chunks.push(part.trim());
          } else if (typeof part?.text === 'string' && part.text.trim()) {
            chunks.push(part.text.trim());
          } else if (typeof part?.output_text === 'string' && part.output_text.trim()) {
            chunks.push(part.output_text.trim());
          } else if (typeof part?.text?.value === 'string' && part.text.value.trim()) {
            chunks.push(part.text.value.trim());
          }
        }
      }
    }
  }
  if (chunks.length > 0) {
    return chunks.join('\n').trim();
  }
  // OpenAI Chat Completions fallback shape
  const choice = root?.choices?.[0];
  const fallbackContent = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof fallbackContent === 'string' && fallbackContent.trim()) {
    return fallbackContent.trim();
  }
  if (Array.isArray(fallbackContent)) {
    const joined = fallbackContent
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  // Anthropic / generic content array fallback
  if (Array.isArray(root?.content)) {
    const joined = root.content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  if (typeof root?.content === 'string' && root.content.trim()) {
    return root.content.trim();
  }
  return '';
}

function extractImageFromResponsesPayload(data: any): string | null {
  const root = data?.response && !data?.output ? data.response : data;
  if (Array.isArray(root?.output)) {
    for (const item of root.output) {
      if (item?.type === 'image_generation_call' && typeof item?.result === 'string' && item.result.trim()) {
        const b64 = item.result.trim();
        return b64.startsWith('data:image/') ? b64 : `data:image/png;base64,${b64}`;
      }
      if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (typeof part?.image_base64 === 'string' && part.image_base64.trim()) {
            return `data:image/png;base64,${part.image_base64.trim()}`;
          }
          if (typeof part?.b64_json === 'string' && part.b64_json.trim()) {
            return `data:image/png;base64,${part.b64_json.trim()}`;
          }
        }
      }
    }
  }
  return null;
}

function extractXingchiUsage(
  data: any
): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  const u = data?.usage || data?.response?.usage;
  if (!u || typeof u !== 'object') return undefined;
  const promptTokens = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
  const completionTokens = Number(u.output_tokens ?? u.completion_tokens ?? 0);
  const totalTokens = Number(u.total_tokens ?? promptTokens + completionTokens);
  if (!promptTokens && !completionTokens && !totalTokens) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

async function parseResponsesBody(res: Response): Promise<{
  text: string;
  imageDataUrl: string | null;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  embeddedError?: string;
  incompleteReason?: string;
  debugPreview: string;
}> {
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  const rawBody = await res.text();
  const trimmed = rawBody.trim();

  const looksLikeSse =
    ct.includes('text/event-stream') ||
    /^(?:event:|data:|id:)/m.test(trimmed);

  if (!looksLikeSse) {
    let data: any = {};
    try {
      data = JSON.parse(trimmed || '{}');
    } catch {
      return {
        text: '',
        imageDataUrl: null,
        debugPreview: `ct=${ct || 'unknown'} | ${sanitizeDebugPreview(trimmed, 160)}`,
      };
    }
    const text = extractResponsesApiText(data);
    const embeddedError = extractEmbeddedError(data);
    const incompleteReason =
      typeof data?.incomplete_details?.reason === 'string'
        ? data.incomplete_details.reason
        : typeof data?.response?.incomplete_details?.reason === 'string'
        ? data.response.incomplete_details.reason
        : undefined;
    const statusStr = data?.status || data?.response?.status || '';
    const keys = Object.keys(data || {}).slice(0, 8).join(',');
    return {
      text,
      imageDataUrl: extractImageFromResponsesPayload(data),
      model:
        typeof data?.model === 'string'
          ? data.model
          : typeof data?.response?.model === 'string'
          ? data.response.model
          : undefined,
      usage: extractXingchiUsage(data),
      embeddedError,
      incompleteReason,
      debugPreview: `json keys=[${keys}]${statusStr ? ` status=${statusStr}` : ''}${
        incompleteReason ? ` reason=${incompleteReason}` : ''
      } | ${sanitizeDebugPreview(trimmed, 140)}`,
    };
  }

  // Parse SSE stream (Codex Responses API / Chat Completions / Anthropic SSE formats)
  let deltaText = '';
  let doneItemText = '';
  let finalResponse: any = null;
  let sseImage: string | null = null;
  let sseModel: string | undefined;
  let embeddedError: string | undefined;
  let incompleteReason: string | undefined;
  const seenEventTypes = new Set<string>();

  for (const line of rawBody.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean.startsWith('data:')) continue;
    const payloadStr = clean.slice(5).trim();
    if (!payloadStr || payloadStr === '[DONE]') continue;
    try {
      const evt = JSON.parse(payloadStr) as any;
      if (typeof evt?.type === 'string') {
        seenEventTypes.add(evt.type);
      }
      if (typeof evt?.response?.model === 'string') {
        sseModel = evt.response.model;
      } else if (typeof evt?.model === 'string') {
        sseModel = evt.model;
      }

      if (evt?.type === 'error' || evt?.type === 'response.failed') {
        embeddedError = extractEmbeddedError(evt) || sanitizeDebugPreview(payloadStr, 180);
      } else if (evt?.type === 'response.output_text.delta') {
        if (typeof evt?.delta === 'string') {
          deltaText += evt.delta;
        } else if (typeof evt?.delta?.text === 'string') {
          deltaText += evt.delta.text;
        }
      } else if (evt?.type === 'response.output_text.done' && typeof evt?.text === 'string') {
        if (!doneItemText) doneItemText = evt.text;
      } else if (evt?.type === 'response.content_part.done') {
        const pt =
          typeof evt?.part?.text === 'string'
            ? evt.part.text
            : typeof evt?.text === 'string'
            ? evt.text
            : '';
        if (pt) doneItemText = doneItemText ? `${doneItemText}\n${pt}` : pt;
      } else if (evt?.type === 'response.output_item.done' && evt?.item) {
        if (evt.item.type === 'image_generation_call' && typeof evt.item.result === 'string' && evt.item.result.trim()) {
          const b64 = evt.item.result.trim();
          sseImage = b64.startsWith('data:image/') ? b64 : `data:image/png;base64,${b64}`;
        } else {
          const itemTxt = extractResponsesApiText({ output: [evt.item] });
          if (itemTxt) {
            doneItemText = doneItemText ? `${doneItemText}\n${itemTxt}` : itemTxt;
          }
        }
      } else if (
        evt?.type === 'response.image_generation_call.partial_image' &&
        typeof evt?.partial_image_b64 === 'string'
      ) {
        sseImage = `data:image/png;base64,${evt.partial_image_b64.trim()}`;
      } else if (
        evt?.type === 'response.completed' ||
        evt?.type === 'response.done' ||
        evt?.type === 'response.incomplete'
      ) {
        finalResponse = evt?.response || evt;
        if (typeof finalResponse?.incomplete_details?.reason === 'string') {
          incompleteReason = finalResponse.incomplete_details.reason;
        }
      } else if (evt?.type === 'content_block_delta' && typeof evt?.delta?.text === 'string') {
        deltaText += evt.delta.text;
      } else if (typeof evt?.choices?.[0]?.delta?.content === 'string') {
        deltaText += evt.choices[0].delta.content;
      } else if (typeof evt?.choices?.[0]?.message?.content === 'string') {
        doneItemText = evt.choices[0].message.content;
      } else if (evt?.error) {
        embeddedError = extractEmbeddedError(evt);
      }
    } catch {
      // Ignore malformed SSE lines
    }
  }

  const finalText =
    (finalResponse ? extractResponsesApiText(finalResponse) : '') ||
    deltaText.trim() ||
    doneItemText.trim();
  const finalImg = (finalResponse ? extractImageFromResponsesPayload(finalResponse) : null) || sseImage;
  return {
    text: finalText,
    imageDataUrl: finalImg,
    model: (typeof finalResponse?.model === 'string' ? finalResponse.model : undefined) || sseModel,
    usage: finalResponse ? extractXingchiUsage(finalResponse) : undefined,
    embeddedError: embeddedError || (finalResponse ? extractEmbeddedError(finalResponse) : undefined),
    incompleteReason,
    debugPreview: `sse events=[${Array.from(seenEventTypes).slice(0, 8).join(',')}]${
      incompleteReason ? ` reason=${incompleteReason}` : ''
    } | ${sanitizeDebugPreview(trimmed, 140)}`,
  };
}

export async function callXingchiCompletion(params: {
  prompt: string;
  systemPrompt?: string;
  imageDataUrls?: string[];
  model?: string;
  protocol?: XingchiProtocol;
  jsonMode?: boolean;
  useWebSearch?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{
  text: string;
  model: string;
  protocol: XingchiProtocol;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}> {
  const apiKey = getXingchiApiKeySecret();
  const baseUrl = resolveXingchiBaseUrl();
  if (!apiKey || !xingchiStore.enabled) {
    throw new Error(
      !apiKey
        ? 'Chưa cấu hình XINGCHI_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ.'
        : 'Cổng Xingchi API đang tạm tắt trong Cài đặt.'
    );
  }

  const protocol: XingchiProtocol =
    parseProtocolValue(params.protocol) || xingchiStore.protocol || 'responses';
  const model = (params.model || xingchiStore.selectedModel || DEFAULT_XINGCHI_MODEL).trim();
  if (!isValidModelSlug(model)) {
    throw new Error('Mã model Xingchi không hợp lệ.');
  }

  const prompt = String(params.prompt || '').trim();
  if (!prompt) {
    throw new Error('Thiếu nội dung prompt gửi tới Xingchi API.');
  }
  const systemPrompt = String(params.systemPrompt || '').trim();
  const images = Array.isArray(params.imageDataUrls)
    ? params.imageDataUrls.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 6)
    : [];
  const timeoutMs = Math.max(
    10_000,
    Math.min(240_000, params.timeoutMs || clampTimeoutSec(xingchiStore.timeoutSec) * 1000)
  );
  const startedAt = Date.now();

  const callChatCompletions = async (allowImages: boolean): Promise<Response> => {
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    if (allowImages && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      store: !xingchiStore.disableResponseStorage,
    };
    if (params.maxTokens) body.max_tokens = Math.max(256, params.maxTokens);
    if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      body.temperature = params.temperature;
    }
    if (params.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    return fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: buildXingchiHeaders(apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  const callResponsesApi = async (opts: {
    stream: boolean;
    allowImages: boolean;
    allowTools: boolean;
    allowJsonFormat: boolean;
    allowTemperature: boolean;
    allowMaxTokens: boolean;
  }): Promise<Response> => {
    const contentParts: any[] = [{ type: 'input_text', text: prompt }];
    if (opts.allowImages && images.length > 0) {
      for (const url of images) {
        contentParts.push({ type: 'input_image', image_url: url });
      }
    }

    const body: Record<string, unknown> = {
      model,
      instructions: systemPrompt || 'You are a helpful AI assistant.',
      input: [{ role: 'user', content: contentParts }],
      store: !xingchiStore.disableResponseStorage,
      stream: opts.stream,
    };
    // Avoid small max_output_tokens on Responses API because reasoning models (e.g. gpt-6.1-sol) consume tokens before text output
    if (opts.allowMaxTokens && params.maxTokens && params.maxTokens >= 1024) {
      body.max_output_tokens = params.maxTokens;
    }
    if (opts.allowTemperature && typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      body.temperature = params.temperature;
    }
    if (opts.allowJsonFormat && params.jsonMode) {
      body.text = { format: { type: 'json_object' } };
    }
    if (opts.allowTools && params.useWebSearch && xingchiStore.webSearch === 'live' && !params.jsonMode) {
      body.tools = [{ type: 'web_search' }];
    }

    return fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: buildXingchiHeaders(
        apiKey,
        {
          'Content-Type': 'application/json',
          Accept: opts.stream ? 'text/event-stream' : 'application/json',
        },
        { codexClient: true }
      ),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  let usedProtocol: XingchiProtocol = protocol;
  let usedResponsesStream = false;
  let res: Response;

  if (protocol === 'anthropic') {
    const bodyPayload: Record<string, unknown> = {
      model,
      max_tokens: params.maxTokens || 2048,
      messages: [{ role: 'user', content: prompt }],
    };
    if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      bodyPayload.temperature = params.temperature;
    }
    if (systemPrompt) {
      bodyPayload.system = systemPrompt;
    }
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: buildXingchiHeaders(apiKey, {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }),
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } else if (protocol === 'responses') {
    // Codex Responses gateways natively stream SSE; start with stream: true for maximum compatibility
    usedResponsesStream = true;
    res = await callResponsesApi({
      stream: true,
      allowImages: true,
      allowTools: true,
      allowJsonFormat: true,
      allowTemperature: false,
      allowMaxTokens: true,
    });

    // Retry cleanly if optional params (tools/format/max_output_tokens/images/stream) are rejected
    if (res.status === 400 || res.status === 403 || res.status === 422) {
      const firstErr = await res.clone().text().catch(() => '');
      const lower = firstErr.toLowerCase();
      const rejectStream = lower.includes('stream') && (lower.includes('false') || lower.includes('not supported'));
      const isParamRejection =
        res.status !== 403 ||
        (!lower.includes('invalid_api_key') && !lower.includes('incorrect api key'));

      if (isParamRejection) {
        usedResponsesStream = !rejectStream;
        res = await callResponsesApi({
          stream: usedResponsesStream,
          allowImages: !lower.includes('image'),
          allowTools: false,
          allowJsonFormat: false,
          allowTemperature: false,
          allowMaxTokens: false,
        });
      }
    }

    // Fallback to /v1/chat/completions only if /v1/responses endpoint is unsupported (404/405)
    if (res.status === 404 || res.status === 405) {
      usedProtocol = 'openai';
      res = await callChatCompletions(true);
    }
  } else {
    res = await callChatCompletions(true);
    if (!res.ok && images.length > 0 && (res.status === 400 || res.status === 422)) {
      res = await callChatCompletions(false);
    }
  }

  let latencyMs = Math.max(1, Date.now() - startedAt);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const classified = classifyXingchiError(res.status, errText);
    recordXingchiUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
    throw new Error(classified.message);
  }

  let text = '';
  let resolvedModel = model;
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  let debugPreview = '';
  let embeddedError: string | undefined;

  if (usedProtocol === 'responses') {
    let parsed = await parseResponsesBody(res);
    // If HTTP 200 returned empty text without an explicit upstream error, retry once with toggled stream mode and clean minimal payload
    if (!parsed.text && !parsed.embeddedError) {
      const retryRes = await callResponsesApi({
        stream: !usedResponsesStream,
        allowImages: false,
        allowTools: false,
        allowJsonFormat: false,
        allowTemperature: false,
        allowMaxTokens: false,
      });
      if (retryRes.ok) {
        const retryParsed = await parseResponsesBody(retryRes);
        if (retryParsed.text || retryParsed.embeddedError) {
          parsed = retryParsed;
        }
      }
      latencyMs = Math.max(1, Date.now() - startedAt);
    }
    text = parsed.text;
    if (parsed.model) resolvedModel = parsed.model;
    usage = parsed.usage;
    embeddedError = parsed.embeddedError;
    debugPreview = parsed.debugPreview;
  } else {
    const rawText = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(rawText || '{}');
    } catch {
      debugPreview = sanitizeDebugPreview(rawText, 160);
    }
    embeddedError = extractEmbeddedError(data);
    if (typeof data?.model === 'string') resolvedModel = data.model;
    usage = extractXingchiUsage(data);
    text = extractResponsesApiText(data);
    if (!text) {
      debugPreview = debugPreview || sanitizeDebugPreview(rawText, 160);
    }
  }

  if (embeddedError && !text) {
    recordXingchiUsage(false, { latencyMs, errorMsg: embeddedError });
    throw new Error(`Xingchi API báo lỗi trong phản hồi: ${embeddedError}`);
  }

  if (!text) {
    const detail = debugPreview ? ` (${debugPreview})` : '';
    recordXingchiUsage(false, {
      latencyMs,
      errorMsg: `Xingchi API trả về nội dung phản hồi rỗng${detail}`,
    });
    throw new Error(`Xingchi API kết nối được nhưng trả về nội dung phản hồi rỗng${detail}`);
  }

  recordXingchiUsage(true, { latencyMs });
  return {
    text,
    model: resolvedModel,
    protocol: usedProtocol,
    latencyMs,
    usage,
  };
}

export async function chatWithXingchi(params: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  protocol?: XingchiProtocol;
  useWebSearch?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<{
  ok: boolean;
  reply: string;
  model: string;
  protocol: XingchiProtocol;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  message: string;
  status: XingchiPublicStatus;
}> {
  const apiKey = getXingchiApiKeySecret();
  const protocol: XingchiProtocol =
    parseProtocolValue(params.protocol) || xingchiStore.protocol || 'responses';
  const model = (params.model || xingchiStore.selectedModel || DEFAULT_XINGCHI_MODEL).trim();

  if (!apiKey) {
    return {
      ok: false,
      reply: '',
      model,
      protocol,
      latencyMs: 0,
      message: 'Chưa cấu hình XINGCHI_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ.',
      status: getXingchiPublicStatus(),
    };
  }

  const prompt = String(params.prompt || '').trim().slice(0, 4000);
  if (!prompt) {
    throw new Error('Vui lòng nhập nội dung kiểm thử.');
  }

  const startedAt = Date.now();
  try {
    const res = await callXingchiCompletion({
      prompt,
      systemPrompt: String(params.systemPrompt || '').trim().slice(0, 1500) || undefined,
      model,
      protocol,
      useWebSearch: params.useWebSearch ?? xingchiStore.webSearch === 'live',
      maxTokens:
        params.maxTokens !== undefined
          ? Math.max(64, Math.min(4096, Number(params.maxTokens) || 1024))
          : 1024,
      temperature:
        typeof params.temperature === 'number' && Number.isFinite(params.temperature)
          ? Math.max(0, Math.min(1.5, params.temperature))
          : undefined,
    });

    const routeLabel =
      res.protocol === 'responses'
        ? '/v1/responses'
        : res.protocol === 'anthropic'
        ? '/v1/messages'
        : '/v1/chat/completions';

    return {
      ok: true,
      reply: res.text,
      model: res.model,
      protocol: res.protocol,
      latencyMs: res.latencyMs,
      usage: res.usage,
      message: `Kết nối Xingchi API (${res.model} · ${routeLabel}) thành công (${res.latencyMs}ms).`,
      status: getXingchiPublicStatus(),
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    return {
      ok: false,
      reply: '',
      model,
      protocol,
      latencyMs,
      message: String(err?.message || err || 'Lỗi kết nối Xingchi API.').slice(0, 360),
      status: getXingchiPublicStatus(),
    };
  }
}

function mapAspectRatioToOpenAiSize(aspectRatio?: '1:1' | '9:16' | '16:9'): string {
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '9:16') return '1024x1536';
  return '1024x1024';
}

export async function generateImageWithXingchi(params: {
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  model?: string;
  referenceImages?: string[];
}): Promise<{ dataUrl: string; model: string; latencyMs: number }> {
  const apiKey = getXingchiApiKeySecret();
  const baseUrl = resolveXingchiBaseUrl();
  if (!apiKey) {
    throw new Error('Chưa cấu hình XINGCHI_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ.');
  }
  if (!xingchiStore.enabled) {
    throw new Error('Cổng Xingchi API đang tạm tắt trong Cài đặt.');
  }
  if (!xingchiStore.imageGeneration) {
    throw new Error('Tính năng image_generation của Xingchi API đang tắt trong Cài đặt.');
  }

  const prompt = String(params.prompt || '').trim();
  if (!prompt) {
    throw new Error('Vui lòng nhập mô tả hình ảnh cho Xingchi API.');
  }

  const model = (params.model || xingchiStore.selectedModel || DEFAULT_XINGCHI_MODEL).trim();
  if (!isValidModelSlug(model)) {
    throw new Error('Mã model Xingchi không hợp lệ.');
  }

  const size = mapAspectRatioToOpenAiSize(params.aspectRatio);
  const refs = Array.isArray(params.referenceImages)
    ? params.referenceImages.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 4)
    : [];
  const timeoutMs = Math.max(60_000, clampTimeoutSec(xingchiStore.timeoutSec) * 1000);
  const startedAt = Date.now();

  // 1) Primary path: OpenAI Responses API with image_generation tool (prefer SSE stream first for Codex relays)
  let responsesErrorText = '';
  if (xingchiStore.protocol === 'responses') {
    const aspectHint =
      params.aspectRatio === '16:9'
        ? '16:9 landscape'
        : params.aspectRatio === '9:16'
        ? '9:16 vertical portrait'
        : '1:1 square';

    for (const attempt of [
      { stream: true, includeSize: false },
      { stream: true, includeSize: true },
      { stream: false, includeSize: false },
    ]) {
      try {
        const contentParts: any[] = [{ type: 'input_text', text: prompt }];
        for (const url of refs) {
          contentParts.push({ type: 'input_image', image_url: url });
        }
        const toolSpec: Record<string, unknown> = attempt.includeSize
          ? { type: 'image_generation', size }
          : { type: 'image_generation' };

        const resp = await fetch(`${baseUrl}/v1/responses`, {
          method: 'POST',
          headers: buildXingchiHeaders(
            apiKey,
            {
              'Content-Type': 'application/json',
              Accept: attempt.stream ? 'text/event-stream' : 'application/json',
            },
            { codexClient: true }
          ),
          body: JSON.stringify({
            model,
            instructions: `Generate a ${aspectHint} image matching the user request using the image_generation tool.`,
            input: [{ role: 'user', content: contentParts }],
            store: !xingchiStore.disableResponseStorage,
            stream: attempt.stream,
            tools: [toolSpec],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (resp.ok) {
          const parsed = await parseResponsesBody(resp);
          if (parsed.imageDataUrl) {
            const latencyMs = Math.max(1, Date.now() - startedAt);
            recordXingchiUsage(true, { latencyMs });
            return {
              dataUrl: parsed.imageDataUrl,
              model: `${parsed.model || model} (Xingchi Responses)`,
              latencyMs,
            };
          }
          continue;
        }
        const errText = await resp.text().catch(() => '');
        responsesErrorText = errText;
        if (resp.status === 401) {
          const classified = classifyXingchiError(resp.status, errText);
          recordXingchiUsage(false, {
            latencyMs: Math.max(1, Date.now() - startedAt),
            statusCode: resp.status,
            errorMsg: errText,
          });
          throw new Error(classified.message);
        }
        if (resp.status === 403 && errText.toLowerCase().includes('not enabled for this group')) {
          break;
        }
      } catch (err: any) {
        if (String(err?.message || '').includes('HTTP 401')) {
          throw err;
        }
      }
    }
  }

  // 2) Fallback path: OpenAI /v1/images/generations
  const imgModel =
    model.toLowerCase().includes('image') || model.toLowerCase().includes('dall')
      ? model
      : 'gpt-image-1';

  const imgRes = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: buildXingchiHeaders(apiKey, { 'Content-Type': 'application/json' }, { codexClient: true }),
    body: JSON.stringify({
      model: imgModel,
      prompt,
      size,
      n: 1,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const latencyMs = Math.max(1, Date.now() - startedAt);
  if (!imgRes.ok) {
    const errText = (await imgRes.text().catch(() => '')) || responsesErrorText;
    const classified = classifyXingchiError(imgRes.status, errText);
    const isGroupImageDisabled =
      errText.toLowerCase().includes('image generation is not enabled') ||
      errText.toLowerCase().includes('not enabled for this group');
    if (!isGroupImageDisabled) {
      recordXingchiUsage(false, { latencyMs, statusCode: imgRes.status, errorMsg: errText });
    }
    throw new Error(classified.message);
  }

  const imgData = (await imgRes.json().catch(() => ({}))) as any;
  const first = imgData?.data?.[0];
  if (typeof first?.b64_json === 'string' && first.b64_json.trim()) {
    recordXingchiUsage(true, { latencyMs });
    return {
      dataUrl: `data:image/png;base64,${first.b64_json.trim()}`,
      model: `${imgModel} (Xingchi)`,
      latencyMs,
    };
  }
  if (typeof first?.url === 'string' && first.url.startsWith('https://')) {
    const fetched = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
    if (fetched.ok) {
      const mime = fetched.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await fetched.arrayBuffer());
      recordXingchiUsage(true, { latencyMs });
      return {
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        model: `${imgModel} (Xingchi)`,
        latencyMs,
      };
    }
  }

  recordXingchiUsage(false, { latencyMs, errorMsg: 'Xingchi API không trả về dữ liệu ảnh.' });
  throw new Error('Xingchi API không trả về dữ liệu hình ảnh từ /v1/responses hay /v1/images/generations.');
}

export async function testXingchiConnection(opts?: {
  model?: string;
  protocol?: XingchiProtocol;
}) {
  return chatWithXingchi({
    prompt: 'Trả lời đúng 1 cụm từ: Sẵn sàng',
    model: opts?.model,
    protocol: opts?.protocol,
    useWebSearch: false,
    maxTokens: 1024,
  });
}
