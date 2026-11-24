import fs from 'fs';
import path from 'path';
import type {
  AlibabaConnectionStatus,
  AlibabaModelItem,
  AlibabaModelStudioStatus,
  AlibabaRegionId,
} from '../src/types/bilibili';

const REGION_ENDPOINTS: Record<AlibabaRegionId, { label: string; baseUrl: string }> = {
  intl: {
    label: 'Quốc tế / Singapore (dashscope-intl)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  us: {
    label: 'Mỹ / US Virginia (dashscope-us)',
    baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  },
  cn: {
    label: 'Trung Quốc / Bắc Kinh (dashscope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
};

const ALLOWED_EXACT_HOSTS = new Set([
  'dashscope-intl.aliyuncs.com',
  'dashscope-us.aliyuncs.com',
  'dashscope.aliyuncs.com',
]);

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'alibaba_modelstudio_config.json');

interface AlibabaPersistedConfig {
  version: number;
  enabled: boolean;
  region: AlibabaRegionId;
  selectedModel: string;
  imageModel: string;
  videoModel: string;
  timeoutSec: number;
  status: AlibabaConnectionStatus;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  lastError?: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  models: AlibabaModelItem[];
  modelsFetchedAt?: number;
}

function parseRegionId(raw: unknown): AlibabaRegionId {
  if (raw === 'us' || raw === 'cn' || raw === 'intl') return raw;
  return 'intl';
}

function clampTimeoutSec(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 60;
  return Math.max(10, Math.min(180, Math.round(num)));
}

export function isValidAlibabaModelSlug(slug: string): boolean {
  return /^[a-zA-Z0-9._:/-]{1,120}$/.test(slug);
}

export function hasAlibabaEnvKey(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY?.trim());
}

function getAlibabaApiKeySecret(): string {
  return process.env.DASHSCOPE_API_KEY?.trim() || '';
}

export function maskAlibabaApiKey(key?: string): string {
  const s = String(key || '').trim();
  if (!s) return 'Chưa thiết lập';
  if (s.length <= 10) return `${s.slice(0, 3)}***${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function createDefaultConfig(): AlibabaPersistedConfig {
  return {
    version: 1,
    enabled: true,
    region: parseRegionId(process.env.DASHSCOPE_REGION?.trim().toLowerCase()),
    selectedModel: (process.env.DASHSCOPE_MODEL || 'qwen-plus').trim() || 'qwen-plus',
    imageModel: (process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-plus').trim() || 'qwen-image-plus',
    videoModel: (process.env.DASHSCOPE_VIDEO_MODEL || 'wan2.5-i2v-preview').trim() || 'wan2.5-i2v-preview',
    timeoutSec: 60,
    status: hasAlibabaEnvKey() ? 'untested' : 'unconfigured',
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

function loadConfig(): AlibabaPersistedConfig {
  try {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      return createDefaultConfig();
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AlibabaPersistedConfig>;
    const base = createDefaultConfig();
    return {
      ...base,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
      region: parseRegionId(parsed.region ?? base.region),
      selectedModel:
        typeof parsed.selectedModel === 'string' && isValidAlibabaModelSlug(parsed.selectedModel.trim())
          ? parsed.selectedModel.trim()
          : base.selectedModel,
      imageModel:
        typeof parsed.imageModel === 'string' && isValidAlibabaModelSlug(parsed.imageModel.trim())
          ? parsed.imageModel.trim()
          : base.imageModel,
      videoModel:
        typeof parsed.videoModel === 'string' && isValidAlibabaModelSlug(parsed.videoModel.trim())
          ? parsed.videoModel.trim()
          : base.videoModel,
      timeoutSec: clampTimeoutSec(parsed.timeoutSec),
      status: parsed.status || base.status,
      lastCheckedAt: typeof parsed.lastCheckedAt === 'number' ? parsed.lastCheckedAt : undefined,
      lastLatencyMs: typeof parsed.lastLatencyMs === 'number' ? parsed.lastLatencyMs : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      requestsCount: typeof parsed.requestsCount === 'number' ? parsed.requestsCount : 0,
      successCount: typeof parsed.successCount === 'number' ? parsed.successCount : 0,
      errorCount: typeof parsed.errorCount === 'number' ? parsed.errorCount : 0,
      models: Array.isArray(parsed.models) ? parsed.models.slice(0, 250) : [],
      modelsFetchedAt: typeof parsed.modelsFetchedAt === 'number' ? parsed.modelsFetchedAt : undefined,
    };
  } catch {
    return createDefaultConfig();
  }
}

let store: AlibabaPersistedConfig = loadConfig();

function saveConfig(): void {
  try {
    ensureDataDir();
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch {
    // non-fatal
  }
}

export function resolveAlibabaBaseUrl(regionOverride?: AlibabaRegionId): string {
  const envCustom = process.env.DASHSCOPE_BASE_URL?.trim();
  if (envCustom && !regionOverride) {
    try {
      const parsed = new URL(envCustom);
      const host = parsed.hostname.toLowerCase();
      const allowed = ALLOWED_EXACT_HOSTS.has(host) || host.endsWith('.maas.aliyuncs.com');
      if (parsed.protocol === 'https:' && allowed) {
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
      }
    } catch {
      // fall through to region map
    }
  }
  const region = regionOverride || store.region || 'intl';
  return (REGION_ENDPOINTS[region] || REGION_ENDPOINTS.intl).baseUrl;
}

function classifyAlibabaModelGroup(id: string): AlibabaModelItem['group'] {
  const lower = id.toLowerCase();
  if (lower.includes('-vl') || lower.includes('omni') || lower.includes('qvq')) return 'vision';
  if (lower.includes('coder')) return 'coder';
  if (lower.includes('qwq') || lower.includes('thinking') || lower.includes('r1')) return 'reasoning';
  if (lower.includes('qwen')) return 'text';
  return 'other';
}

function classifyAlibabaError(statusCode: number | undefined, rawText: string): {
  status: AlibabaConnectionStatus;
  message: string;
} {
  const lower = rawText.toLowerCase();
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('invalidapikey') ||
    lower.includes('invalid_api_key') ||
    lower.includes('unauthorized') ||
    lower.includes('accessdenied')
  ) {
    return {
      status: 'auth_error',
      message:
        'DASHSCOPE_API_KEY không hợp lệ hoặc sai khu vực (Singapore / US / Bắc Kinh). Hãy kiểm tra lại khóa tại modelstudio.console.alibabacloud.com và chọn đúng khu vực đã tạo khóa.',
    };
  }
  if (
    statusCode === 402 ||
    statusCode === 429 ||
    lower.includes('throttling') ||
    lower.includes('quota') ||
    lower.includes('arrearage') ||
    lower.includes('rate limit')
  ) {
    return {
      status: 'quota_exceeded',
      message:
        'Tài khoản Alibaba Cloud Model Studio chạm giới hạn tốc độ hoặc hết hạn mức miễn phí/số dư (HTTP 402/429).',
    };
  }
  if (statusCode === 404 || lower.includes('model_not_found') || lower.includes('not found')) {
    return {
      status: 'error',
      message:
        'Model không tồn tại hoặc chưa bật ở khu vực này (HTTP 404). Hãy đổi sang qwen-plus / qwen-max hoặc tải lại danh sách Model.',
    };
  }
  const snippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 180);
  return {
    status: 'error',
    message: statusCode
      ? `Alibaba Model Studio trả về HTTP ${statusCode}${snippet ? `: ${snippet}` : ''}`
      : snippet || 'Không thể kết nối tới Alibaba Cloud Model Studio.',
  };
}

export function getAlibabaModelStudioStatus(): AlibabaModelStudioStatus {
  const hasKey = hasAlibabaEnvKey();
  const effectiveStatus: AlibabaConnectionStatus = !hasKey
    ? 'unconfigured'
    : store.status === 'unconfigured'
    ? 'untested'
    : store.status;

  return {
    region: store.region,
    regionLabel: (REGION_ENDPOINTS[store.region] || REGION_ENDPOINTS.intl).label,
    baseUrl: resolveAlibabaBaseUrl(),
    hasKey,
    maskedKey: maskAlibabaApiKey(getAlibabaApiKeySecret()),
    keySource: hasKey ? 'env' : 'none',
    enabled: store.enabled,
    configured: hasKey && store.enabled,
    selectedModel: store.selectedModel,
    imageModel: store.imageModel,
    videoModel: store.videoModel,
    timeoutSec: store.timeoutSec,
    status: effectiveStatus,
    lastCheckedAt: store.lastCheckedAt,
    lastLatencyMs: store.lastLatencyMs,
    lastError: hasKey ? store.lastError : undefined,
    requestsCount: store.requestsCount,
    successCount: store.successCount,
    errorCount: store.errorCount,
    models: store.models,
    modelsFetchedAt: store.modelsFetchedAt,
  };
}

export function getAlibabaRuntimeConfig(): {
  apiKey: string;
  baseUrl: string;
  apiOrigin: string;
  region: AlibabaRegionId;
  model: string;
  imageModel: string;
  videoModel: string;
  enabled: boolean;
  timeoutSec: number;
} {
  const baseUrl = resolveAlibabaBaseUrl();
  const apiOrigin = new URL(baseUrl).origin;
  return {
    apiKey: getAlibabaApiKeySecret(),
    baseUrl,
    apiOrigin,
    region: store.region,
    model: store.selectedModel || (process.env.DASHSCOPE_MODEL || 'qwen-plus').trim(),
    imageModel: store.imageModel || (process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-plus').trim(),
    videoModel: store.videoModel || (process.env.DASHSCOPE_VIDEO_MODEL || 'wan2.5-i2v-preview').trim(),
    enabled: store.enabled,
    timeoutSec: store.timeoutSec,
  };
}

export function updateAlibabaConfig(patch: {
  enabled?: boolean;
  region?: AlibabaRegionId;
  selectedModel?: string;
  imageModel?: string;
  videoModel?: string;
  timeoutSec?: number;
}): AlibabaModelStudioStatus {
  if (typeof patch.enabled === 'boolean') {
    store.enabled = patch.enabled;
  }
  if (patch.region === 'intl' || patch.region === 'us' || patch.region === 'cn') {
    store.region = patch.region;
  }
  if (typeof patch.selectedModel === 'string') {
    const trimmed = patch.selectedModel.trim();
    if (!trimmed || !isValidAlibabaModelSlug(trimmed)) {
      throw new Error('Mã model Qwen không hợp lệ. Chỉ dùng chữ, số và ký tự . _ : / - (tối đa 120 ký tự).');
    }
    store.selectedModel = trimmed;
  }
  if (typeof patch.imageModel === 'string') {
    const trimmed = patch.imageModel.trim();
    if (!trimmed || !isValidAlibabaModelSlug(trimmed)) {
      throw new Error('Mã model tạo ảnh Qwen không hợp lệ.');
    }
    store.imageModel = trimmed;
  }
  if (typeof patch.videoModel === 'string') {
    const trimmed = patch.videoModel.trim();
    if (!trimmed || !isValidAlibabaModelSlug(trimmed)) {
      throw new Error('Mã model tạo video Qwen/Wan không hợp lệ.');
    }
    store.videoModel = trimmed;
  }
  if (patch.timeoutSec !== undefined) {
    store.timeoutSec = clampTimeoutSec(patch.timeoutSec);
  }
  saveConfig();
  return getAlibabaModelStudioStatus();
}

export function recordAlibabaUsage(
  ok: boolean,
  opts?: { latencyMs?: number; statusCode?: number; errorMsg?: string }
): void {
  store.requestsCount = (store.requestsCount || 0) + 1;
  store.lastCheckedAt = Date.now();
  if (opts?.latencyMs !== undefined) {
    store.lastLatencyMs = Math.max(1, Math.round(opts.latencyMs));
  }
  if (ok) {
    store.successCount = (store.successCount || 0) + 1;
    store.status = 'ready';
    store.lastError = undefined;
  } else {
    store.errorCount = (store.errorCount || 0) + 1;
    const classified = classifyAlibabaError(opts?.statusCode, opts?.errorMsg || '');
    store.status = classified.status;
    store.lastError = classified.message;
  }
  saveConfig();
}

export async function fetchAlibabaModels(regionOverride?: AlibabaRegionId): Promise<{
  ok: boolean;
  models: AlibabaModelItem[];
  latencyMs: number;
  message: string;
  status: AlibabaModelStudioStatus;
}> {
  const apiKey = getAlibabaApiKeySecret();
  const baseUrl = resolveAlibabaBaseUrl(regionOverride);
  if (!apiKey) {
    throw new Error('Chưa cấu hình DASHSCOPE_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ.');
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(Math.min(30_000, store.timeoutSec * 1000)),
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const classified = classifyAlibabaError(res.status, errText);
      recordAlibabaUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
      return {
        ok: false,
        models: store.models,
        latencyMs,
        message: classified.message,
        status: getAlibabaModelStudioStatus(),
      };
    }

    const payload = (await res.json().catch(() => ({}))) as any;
    const rawList: any[] = Array.isArray(payload?.data) ? payload.data : [];
    const dedup = new Map<string, AlibabaModelItem>();
    for (const item of rawList) {
      const id = String(item?.id || '').trim();
      if (!id || !isValidAlibabaModelSlug(id)) continue;
      if (!dedup.has(id)) {
        dedup.set(id, {
          id,
          ownedBy: typeof item?.owned_by === 'string' ? item.owned_by : 'alibaba-cloud',
          group: classifyAlibabaModelGroup(id),
        });
      }
    }
    const models = Array.from(dedup.values()).sort((a, b) => a.id.localeCompare(b.id));
    store.models = models;
    store.modelsFetchedAt = Date.now();
    recordAlibabaUsage(true, { latencyMs });

    return {
      ok: true,
      models,
      latencyMs,
      message: `Đã tải ${models.length} model từ Alibaba Cloud Model Studio (${latencyMs}ms).`,
      status: getAlibabaModelStudioStatus(),
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const errMsg = String(err?.message || err || 'Lỗi kết nối Alibaba Model Studio.');
    recordAlibabaUsage(false, { latencyMs, errorMsg: errMsg });
    return {
      ok: false,
      models: store.models,
      latencyMs,
      message: `Không thể tải danh sách model từ ${baseUrl}: ${errMsg.slice(0, 180)}`,
      status: getAlibabaModelStudioStatus(),
    };
  }
}

export async function chatWithAlibabaModelStudio(params: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  region?: AlibabaRegionId;
  maxTokens?: number;
  temperature?: number;
}): Promise<{
  ok: boolean;
  reply: string;
  model: string;
  region: AlibabaRegionId;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  message: string;
  status: AlibabaModelStudioStatus;
}> {
  const apiKey = getAlibabaApiKeySecret();
  const region = params.region ? parseRegionId(params.region) : store.region;
  const baseUrl = resolveAlibabaBaseUrl(params.region ? region : undefined);
  const model = (params.model || store.selectedModel || 'qwen-plus').trim();

  if (!apiKey) {
    return {
      ok: false,
      reply: '',
      model,
      region,
      latencyMs: 0,
      message:
        'Chưa cấu hình DASHSCOPE_API_KEY trong Settings > Secrets hoặc tệp .env trên máy chủ. Hãy tạo khóa tại modelstudio.console.alibabacloud.com.',
      status: getAlibabaModelStudioStatus(),
    };
  }

  if (!isValidAlibabaModelSlug(model)) {
    throw new Error('Mã model Qwen không hợp lệ.');
  }

  const prompt = String(params.prompt || '').trim().slice(0, 4000);
  if (!prompt) {
    throw new Error('Vui lòng nhập nội dung kiểm thử.');
  }
  const systemPrompt = String(params.systemPrompt || '').trim().slice(0, 1500);
  const maxTokens = Math.max(16, Math.min(2048, Number(params.maxTokens) || 512));
  const temperature =
    typeof params.temperature === 'number' && Number.isFinite(params.temperature)
      ? Math.max(0, Math.min(1.5, params.temperature))
      : 0.4;

  const messages: { role: 'system' | 'user'; content: string }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const startedAt = Date.now();
  const timeoutMs = clampTimeoutSec(store.timeoutSec) * 1000;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const classified = classifyAlibabaError(res.status, errText);
      recordAlibabaUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
      return {
        ok: false,
        reply: '',
        model,
        region,
        latencyMs,
        message: classified.message,
        status: getAlibabaModelStudioStatus(),
      };
    }

    const data = (await res.json().catch(() => ({}))) as any;
    const rawContent = data?.choices?.[0]?.message?.content;
    const reply =
      typeof rawContent === 'string'
        ? rawContent.trim()
        : Array.isArray(rawContent)
        ? rawContent
            .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join('\n')
            .trim()
        : '';

    const usage = data?.usage
      ? {
          promptTokens: Number(data.usage.prompt_tokens || 0),
          completionTokens: Number(data.usage.completion_tokens || 0),
          totalTokens: Number(data.usage.total_tokens || 0),
        }
      : undefined;

    if (!reply) {
      recordAlibabaUsage(false, { latencyMs, errorMsg: 'Alibaba Model Studio trả về phản hồi rỗng.' });
      return {
        ok: false,
        reply: '',
        model,
        region,
        latencyMs,
        usage,
        message: 'Kết nối được nhưng Alibaba Model Studio trả về nội dung rỗng.',
        status: getAlibabaModelStudioStatus(),
      };
    }

    recordAlibabaUsage(true, { latencyMs });
    return {
      ok: true,
      reply,
      model: String(data?.model || model),
      region,
      latencyMs,
      usage,
      message: `Kết nối Alibaba Cloud Model Studio (${model} · ${region.toUpperCase()}) thành công (${latencyMs}ms).`,
      status: getAlibabaModelStudioStatus(),
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const errMsg = String(err?.message || err || 'Lỗi kết nối tới Alibaba Cloud Model Studio.');
    recordAlibabaUsage(false, { latencyMs, errorMsg: errMsg });
    return {
      ok: false,
      reply: '',
      model,
      region,
      latencyMs,
      message: `Lỗi kết nối tới ${baseUrl}: ${errMsg.slice(0, 180)}`,
      status: getAlibabaModelStudioStatus(),
    };
  }
}

export async function testAlibabaModelStudioConnection(opts?: {
  model?: string;
  region?: AlibabaRegionId;
}) {
  return chatWithAlibabaModelStudio({
    prompt: 'Trả lời đúng 1 cụm từ: Sẵn sàng',
    model: opts?.model,
    region: opts?.region,
    maxTokens: 24,
    temperature: 0,
  });
}

function assertSafeAlibabaMediaUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL media trả về từ Alibaba Model Studio không hợp lệ.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Chỉ chấp nhận URL media HTTPS từ Alibaba Cloud Model Studio.');
  }
  const host = parsed.hostname.toLowerCase();
  const isIpOrPrivate =
    host === 'localhost' ||
    host === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal');
  if (isIpOrPrivate) {
    throw new Error('Từ chối tải tệp media từ địa chỉ nội bộ.');
  }
  const isAllowedResultHost =
    host.endsWith('.aliyuncs.com') ||
    host.endsWith('.alibabacloud.com') ||
    (host.endsWith('.amazonaws.com') && host.includes('dashscope'));
  if (!isAllowedResultHost) {
    throw new Error(`Tên miền lưu trữ media không nằm trong danh sách tin cậy của Alibaba Cloud (${host}).`);
  }
  return parsed;
}

async function downloadSafeAlibabaMedia(rawUrl: string, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string }> {
  const safeUrl = assertSafeAlibabaMediaUrl(rawUrl);
  const res = await fetch(safeUrl.toString(), {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(`Không thể tải tệp media từ Alibaba Cloud (HTTP ${res.status}).`);
  }
  // Re-verify final redirected URL if any
  if (res.url) {
    assertSafeAlibabaMediaUrl(res.url);
  }
  const contentLen = Number(res.headers.get('content-length') || 0);
  if (contentLen > maxBytes) {
    throw new Error(`Tệp media vượt quá giới hạn dung lượng cho phép (${Math.round(maxBytes / (1024 * 1024))}MB).`);
  }
  const arrBuf = await res.arrayBuffer();
  if (arrBuf.byteLength > maxBytes) {
    throw new Error(`Tệp media vượt quá giới hạn dung lượng cho phép (${Math.round(maxBytes / (1024 * 1024))}MB).`);
  }
  if (arrBuf.byteLength < 256) {
    throw new Error('Tệp media trả về từ Alibaba Cloud rỗng hoặc bị lỗi.');
  }
  const mimeType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return { buffer: Buffer.from(arrBuf), mimeType };
}

async function pollDashScopeTask(apiOrigin: string, apiKey: string, taskId: string, maxWaitMs: number): Promise<any> {
  const cleanTaskId = String(taskId || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(cleanTaskId)) {
    throw new Error('Mã tác vụ (task_id) DashScope không hợp lệ.');
  }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const pollRes = await fetch(`${apiOrigin}/api/v1/tasks/${encodeURIComponent(cleanTaskId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!pollRes.ok) {
      const errTxt = await pollRes.text().catch(() => '');
      const classified = classifyAlibabaError(pollRes.status, errTxt);
      throw new Error(classified.message);
    }
    const data = (await pollRes.json().catch(() => ({}))) as any;
    const status = String(data?.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED') {
      return data;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      const errMsg =
        data?.output?.message ||
        data?.message ||
        data?.output?.code ||
        `Tác vụ DashScope kết thúc với trạng thái ${status}.`;
      throw new Error(`Alibaba Model Studio lỗi: ${String(errMsg).slice(0, 220)}`);
    }
  }
  throw new Error('Quá thời gian chờ tạo media từ Alibaba Cloud Model Studio. Vui lòng thử lại.');
}

function mapAspectRatioToQwenImageSize(aspectRatio?: '1:1' | '9:16' | '16:9'): string {
  if (aspectRatio === '9:16') return '720*1280';
  if (aspectRatio === '1:1') return '1024*1024';
  return '1280*720';
}

function mapAspectRatioToWanVideoSize(aspectRatio?: '1:1' | '9:16' | '16:9'): string {
  if (aspectRatio === '9:16') return '720*1280';
  if (aspectRatio === '1:1') return '960*960';
  return '1280*720';
}

function extractImageUrlFromDashScopePayload(payload: any): string {
  // Multimodal generation response format: output.choices[0].message.content[].image
  const choices = Array.isArray(payload?.output?.choices) ? payload.output.choices : [];
  for (const ch of choices) {
    const content = ch?.message?.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item?.image === 'string' && item.image.trim()) {
          return item.image.trim();
        }
      }
    }
  }
  // Async text2image / results format: output.results[0].url
  const results = Array.isArray(payload?.output?.results) ? payload.output.results : [];
  for (const r of results) {
    if (typeof r?.url === 'string' && r.url.trim()) {
      return r.url.trim();
    }
  }
  if (typeof payload?.output?.image_url === 'string' && payload.output.image_url.trim()) {
    return payload.output.image_url.trim();
  }
  return '';
}

export async function generateImageViaAlibabaQwen(params: {
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  referenceImages?: string[];
  model?: string;
}): Promise<{ dataUrl: string; model: string }> {
  const cfg = getAlibabaRuntimeConfig();
  if (!cfg.enabled) {
    throw new Error('Cổng Alibaba Cloud Model Studio đang tạm tắt. Hãy bật lại trong Cài đặt > Kết nối AI kịch bản.');
  }
  if (!cfg.apiKey) {
    throw new Error(
      'Chưa cấu hình DASHSCOPE_API_KEY trên máy chủ. Hãy thêm khóa API từ modelstudio.console.alibabacloud.com vào Settings > Secrets.'
    );
  }

  const model = (params.model || cfg.imageModel || 'qwen-image-plus').trim();
  if (!isValidAlibabaModelSlug(model)) {
    throw new Error('Mã model tạo ảnh Qwen không hợp lệ.');
  }

  const promptText = String(params.prompt || '').trim().slice(0, 3200);
  if (!promptText) {
    throw new Error('Thiếu mô tả để AI Qwen tạo ảnh.');
  }

  const validRefImages = (Array.isArray(params.referenceImages) ? params.referenceImages : [])
    .filter((u) => typeof u === 'string' && u.startsWith('data:image/'))
    .slice(0, 3);

  const size = mapAspectRatioToQwenImageSize(params.aspectRatio);
  const contentParts: Record<string, string>[] = [];
  for (const imgDataUrl of validRefImages) {
    contentParts.push({ image: imgDataUrl });
  }
  contentParts.push({ text: promptText });

  const startedAt = Date.now();
  const endpoint = `${cfg.apiOrigin}/api/v1/services/aigc/multimodal-generation/generation`;

  const submitPayload = {
    model,
    input: {
      messages: [
        {
          role: 'user',
          content: contentParts,
        },
      ],
    },
    parameters: {
      size,
      watermark: false,
      prompt_extend: true,
    },
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(submitPayload),
    signal: AbortSignal.timeout(120_000),
  });

  // Fallback for Wan text2image models that expect text2image/image-synthesis async endpoint
  if (!res.ok && model.toLowerCase().startsWith('wan')) {
    res = await fetch(`${cfg.apiOrigin}/api/v1/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { prompt: promptText },
        parameters: { size, n: 1, watermark: false, prompt_extend: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
    const classified = classifyAlibabaError(res.status, errText);
    throw new Error(classified.message);
  }

  let data = (await res.json().catch(() => ({}))) as any;
  if (data?.output?.task_id && !extractImageUrlFromDashScopePayload(data)) {
    data = await pollDashScopeTask(cfg.apiOrigin, cfg.apiKey, data.output.task_id, 180_000);
  }

  const imageUrl = extractImageUrlFromDashScopePayload(data);
  if (!imageUrl) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, errorMsg: 'Alibaba Model Studio không trả về đường dẫn ảnh.' });
    throw new Error(`Model ${model} không trả về ảnh hợp lệ. Hãy kiểm tra lại model ảnh trong cấu hình Alibaba Cloud.`);
  }

  const downloaded = await downloadSafeAlibabaMedia(imageUrl, 25 * 1024 * 1024);
  const finalMime = downloaded.mimeType.startsWith('image/') ? downloaded.mimeType : 'image/png';
  const latencyMs = Math.max(1, Date.now() - startedAt);
  recordAlibabaUsage(true, { latencyMs });

  return {
    dataUrl: `data:${finalMime};base64,${downloaded.buffer.toString('base64')}`,
    model: `${model} (Alibaba Qwen)`,
  };
}

function resolveWanVideoModelForMode(configuredModel: string, hasReferenceFrame: boolean): string {
  const m = configuredModel.trim() || 'wan2.5-i2v-preview';
  if (hasReferenceFrame) {
    // If user configured a T2V model but provided a starting frame, switch to matching I2V model if possible
    if (m.includes('-t2v')) return m.replace('-t2v', '-i2v');
    return m;
  }
  // No starting frame -> ensure T2V model
  if (m.includes('-i2v')) return m.replace('-i2v', '-t2v');
  return m;
}

export async function generateVideoBufferViaAlibabaQwen(params: {
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  durationSec?: number;
  firstFrameDataUrl?: string;
  model?: string;
}): Promise<{ buffer: Buffer; mimeType: string; ext: string; model: string }> {
  const cfg = getAlibabaRuntimeConfig();
  if (!cfg.enabled) {
    throw new Error('Cổng Alibaba Cloud Model Studio đang tạm tắt. Hãy bật lại trong Cài đặt > Kết nối AI kịch bản.');
  }
  if (!cfg.apiKey) {
    throw new Error(
      'Chưa cấu hình DASHSCOPE_API_KEY trên máy chủ. Hãy thêm khóa API từ modelstudio.console.alibabacloud.com vào Settings > Secrets.'
    );
  }

  const hasFirstFrame = Boolean(params.firstFrameDataUrl && params.firstFrameDataUrl.startsWith('data:image/'));
  const baseModel = (params.model || cfg.videoModel || 'wan2.5-i2v-preview').trim();
  const model = resolveWanVideoModelForMode(baseModel, hasFirstFrame);
  if (!isValidAlibabaModelSlug(model)) {
    throw new Error('Mã model tạo video Qwen/Wan không hợp lệ.');
  }

  const promptText = String(params.prompt || '').trim().slice(0, 2000);
  if (!promptText) {
    throw new Error('Thiếu mô tả phân cảnh để AI Qwen tạo video.');
  }

  const duration = Number(params.durationSec || 5) >= 8 ? 10 : 5;
  const startedAt = Date.now();
  const endpoint = `${cfg.apiOrigin}/api/v1/services/aigc/video-generation/video-synthesis`;

  const inputPayload: Record<string, unknown> = { prompt: promptText };
  const parametersPayload: Record<string, unknown> = {
    duration,
    prompt_extend: true,
    watermark: false,
  };

  if (hasFirstFrame && params.firstFrameDataUrl) {
    inputPayload.img_url = params.firstFrameDataUrl;
    parametersPayload.resolution = '720P';
  } else {
    parametersPayload.size = mapAspectRatioToWanVideoSize(params.aspectRatio);
  }

  const createRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model,
      input: inputPayload,
      parameters: parametersPayload,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, statusCode: createRes.status, errorMsg: errText });
    const classified = classifyAlibabaError(createRes.status, errText);
    throw new Error(classified.message);
  }

  const createData = (await createRes.json().catch(() => ({}))) as any;
  const taskId = String(createData?.output?.task_id || '').trim();
  if (!taskId) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, errorMsg: 'DashScope không trả về task_id tạo video.' });
    throw new Error('Alibaba Cloud Model Studio không khởi tạo được tác vụ dựng video.');
  }

  let finishedData: any;
  try {
    finishedData = await pollDashScopeTask(cfg.apiOrigin, cfg.apiKey, taskId, 360_000);
  } catch (pollErr: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, errorMsg: String(pollErr?.message || pollErr) });
    throw pollErr;
  }

  const videoUrl = String(finishedData?.output?.video_url || '').trim();
  if (!videoUrl) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    recordAlibabaUsage(false, { latencyMs, errorMsg: 'Tác vụ video DashScope xong nhưng không có video_url.' });
    throw new Error('Alibaba Model Studio hoàn tất nhưng không trả về đường dẫn video.');
  }

  const downloaded = await downloadSafeAlibabaMedia(videoUrl, 150 * 1024 * 1024);
  const latencyMs = Math.max(1, Date.now() - startedAt);
  recordAlibabaUsage(true, { latencyMs });

  return {
    buffer: downloaded.buffer,
    mimeType: downloaded.mimeType.startsWith('video/') ? downloaded.mimeType : 'video/mp4',
    ext: '.mp4',
    model: `${model} (Alibaba Qwen)`,
  };
}
