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
  region: AlibabaRegionId;
  model: string;
  enabled: boolean;
  timeoutSec: number;
} {
  return {
    apiKey: getAlibabaApiKeySecret(),
    baseUrl: resolveAlibabaBaseUrl(),
    region: store.region,
    model: store.selectedModel || (process.env.DASHSCOPE_MODEL || 'qwen-plus').trim(),
    enabled: store.enabled,
    timeoutSec: store.timeoutSec,
  };
}

export function updateAlibabaConfig(patch: {
  enabled?: boolean;
  region?: AlibabaRegionId;
  selectedModel?: string;
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
