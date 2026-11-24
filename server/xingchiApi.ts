import fs from 'fs';
import path from 'path';
import type {
  XingchiConnectionStatus,
  XingchiModelItem,
  XingchiProtocol,
  XingchiPublicStatus,
} from '../src/types/bilibili';

const DEFAULT_XINGCHI_BASE_URL = 'https://api.xingchiapi.com';
const ALLOWED_XINGCHI_HOSTS = new Set(['api.xingchiapi.com', 'xingchiapi.com']);
const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'xingchi_config.json');

interface XingchiPersistedConfig {
  version: number;
  enabled: boolean;
  protocol: XingchiProtocol;
  selectedModel: string;
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

function createDefaultConfig(): XingchiPersistedConfig {
  return {
    version: 1,
    enabled: true,
    protocol: 'openai',
    selectedModel: (process.env.XINGCHI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini',
    timeoutSec: 60,
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
    return {
      ...base,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
      protocol: parsed.protocol === 'anthropic' ? 'anthropic' : 'openai',
      selectedModel:
        typeof parsed.selectedModel === 'string' && isValidModelSlug(parsed.selectedModel.trim())
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
  if (!Number.isFinite(num)) return 60;
  return Math.max(10, Math.min(180, Math.round(num)));
}

export function isValidModelSlug(slug: string): boolean {
  return /^[a-zA-Z0-9._:/-]{1,120}$/.test(slug);
}

export function resolveXingchiBaseUrl(): string {
  const raw = String(process.env.XINGCHI_BASE_URL || DEFAULT_XINGCHI_BASE_URL).trim();
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost =
      ALLOWED_XINGCHI_HOSTS.has(host) || host.endsWith('.xingchiapi.com');
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
  return Boolean(process.env.XINGCHI_API_KEY?.trim());
}

function getXingchiApiKeySecret(): string {
  return process.env.XINGCHI_API_KEY?.trim() || '';
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

function classifyXingchiError(statusCode: number | undefined, rawText: string): {
  status: XingchiConnectionStatus;
  message: string;
} {
  const lower = rawText.toLowerCase();
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('invalid_api_key') ||
    lower.includes('unauthorized') ||
    lower.includes('incorrect api key')
  ) {
    return {
      status: 'auth_error',
      message: 'XINGCHI_API_KEY không hợp lệ hoặc đã hết quyền truy cập (HTTP 401/403).',
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
      message: 'Tài khoản Xingchi API chạm giới hạn tốc độ hoặc hết số dư/quota (HTTP 402/429).',
    };
  }
  if (statusCode === 404 || lower.includes('model_not_found') || lower.includes('not found')) {
    return {
      status: 'error',
      message: `Model hoặc đường dẫn không tồn tại trên api.xingchiapi.com (HTTP 404). Hãy tải lại danh sách Model và chọn đúng mã model.`,
    };
  }
  const cleanSnippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 180);
  return {
    status: 'error',
    message: statusCode
      ? `Xingchi API trả về HTTP ${statusCode}${cleanSnippet ? `: ${cleanSnippet}` : ''}`
      : cleanSnippet || 'Không thể kết nối tới https://api.xingchiapi.com.',
  };
}

export function getXingchiPublicStatus(): XingchiPublicStatus {
  const hasKey = hasXingchiEnvKey();
  const effectiveStatus: XingchiConnectionStatus = !hasKey
    ? 'unconfigured'
    : xingchiStore.status === 'unconfigured'
    ? 'untested'
    : xingchiStore.status;

  return {
    baseUrl: resolveXingchiBaseUrl(),
    hasKey,
    maskedKey: maskXingchiApiKey(getXingchiApiKeySecret()),
    keySource: hasKey ? 'env' : 'none',
    enabled: xingchiStore.enabled,
    configured: hasKey && xingchiStore.enabled,
    protocol: xingchiStore.protocol,
    selectedModel: xingchiStore.selectedModel,
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
  model: string;
  protocol: XingchiProtocol;
  enabled: boolean;
  timeoutSec: number;
} {
  const baseUrl = resolveXingchiBaseUrl();
  return {
    apiKey: getXingchiApiKeySecret(),
    baseUrl,
    v1BaseUrl: `${baseUrl}/v1`,
    model: xingchiStore.selectedModel || (process.env.XINGCHI_MODEL || 'gpt-4o-mini').trim(),
    protocol: xingchiStore.protocol,
    enabled: xingchiStore.enabled,
    timeoutSec: xingchiStore.timeoutSec,
  };
}

export function updateXingchiConfig(patch: {
  enabled?: boolean;
  protocol?: XingchiProtocol;
  selectedModel?: string;
  timeoutSec?: number;
}): XingchiPublicStatus {
  if (typeof patch.enabled === 'boolean') {
    xingchiStore.enabled = patch.enabled;
  }
  if (patch.protocol === 'openai' || patch.protocol === 'anthropic') {
    xingchiStore.protocol = patch.protocol;
  }
  if (typeof patch.selectedModel === 'string') {
    const trimmed = patch.selectedModel.trim();
    if (!trimmed || !isValidModelSlug(trimmed)) {
      throw new Error('Mã model không hợp lệ. Chỉ dùng chữ, số và ký tự . _ : / - (tối đa 120 ký tự).');
    }
    xingchiStore.selectedModel = trimmed;
  }
  if (patch.timeoutSec !== undefined) {
    xingchiStore.timeoutSec = clampTimeoutSec(patch.timeoutSec);
  }
  saveConfig();
  return getXingchiPublicStatus();
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
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
    if (models.length > 0 && !models.some((m) => m.id === xingchiStore.selectedModel)) {
      // Keep user's current model unless it was never explicitly fetched before and matches default
      const preferred =
        models.find((m) => m.id === 'gpt-4o-mini') ||
        models.find((m) => m.family === 'claude') ||
        models.find((m) => m.family === 'gpt') ||
        models[0];
      if (preferred && !xingchiStore.selectedModel) {
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

export async function chatWithXingchi(params: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  protocol?: XingchiProtocol;
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
  const baseUrl = resolveXingchiBaseUrl();
  const protocol: XingchiProtocol =
    params.protocol === 'anthropic' || params.protocol === 'openai'
      ? params.protocol
      : xingchiStore.protocol;
  const model = (params.model || xingchiStore.selectedModel || 'gpt-4o-mini').trim();

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

  if (!isValidModelSlug(model)) {
    throw new Error('Mã model không hợp lệ.');
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

  const startedAt = Date.now();
  const timeoutMs = clampTimeoutSec(xingchiStore.timeoutSec) * 1000;

  try {
    let res: Response;
    if (protocol === 'anthropic') {
      const bodyPayload: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemPrompt) {
        bodyPayload.system = systemPrompt;
      }
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else {
      const messages: { role: 'system' | 'user'; content: string }[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      res = await fetch(`${baseUrl}/v1/chat/completions`, {
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
    }

    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const classified = classifyXingchiError(res.status, errText);
      recordXingchiUsage(false, { latencyMs, statusCode: res.status, errorMsg: errText });
      return {
        ok: false,
        reply: '',
        model,
        protocol,
        latencyMs,
        message: classified.message,
        status: getXingchiPublicStatus(),
      };
    }

    const data = (await res.json().catch(() => ({}))) as any;
    let reply = '';
    let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

    if (protocol === 'anthropic') {
      const blocks = Array.isArray(data?.content) ? data.content : [];
      reply = blocks
        .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
        .join('\n')
        .trim();
      if (data?.usage) {
        const inputT = Number(data.usage.input_tokens || 0);
        const outputT = Number(data.usage.output_tokens || 0);
        usage = {
          promptTokens: inputT,
          completionTokens: outputT,
          totalTokens: inputT + outputT,
        };
      }
    } else {
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        reply = content.trim();
      } else if (Array.isArray(content)) {
        reply = content
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .join('\n')
          .trim();
      }
      if (data?.usage) {
        usage = {
          promptTokens: Number(data.usage.prompt_tokens || 0),
          completionTokens: Number(data.usage.completion_tokens || 0),
          totalTokens: Number(data.usage.total_tokens || 0),
        };
      }
    }

    if (!reply) {
      recordXingchiUsage(false, {
        latencyMs,
        errorMsg: 'Xingchi API trả về nội dung phản hồi rỗng.',
      });
      return {
        ok: false,
        reply: '',
        model,
        protocol,
        latencyMs,
        usage,
        message: 'Xingchi API kết nối được nhưng trả về nội dung phản hồi rỗng.',
        status: getXingchiPublicStatus(),
      };
    }

    recordXingchiUsage(true, { latencyMs });
    return {
      ok: true,
      reply,
      model: String(data?.model || model),
      protocol,
      latencyMs,
      usage,
      message: `Kết nối Xingchi API (${model} · ${protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}) thành công (${latencyMs}ms).`,
      status: getXingchiPublicStatus(),
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const errMsg = String(err?.message || err || 'Lỗi kết nối Xingchi API.');
    recordXingchiUsage(false, { latencyMs, errorMsg: errMsg });
    return {
      ok: false,
      reply: '',
      model,
      protocol,
      latencyMs,
      message: `Lỗi kết nối tới ${baseUrl}: ${errMsg.slice(0, 180)}`,
      status: getXingchiPublicStatus(),
    };
  }
}

export async function testXingchiConnection(opts?: {
  model?: string;
  protocol?: XingchiProtocol;
}) {
  return chatWithXingchi({
    prompt: 'Trả lời đúng 1 cụm từ: Sẵn sàng',
    model: opts?.model,
    protocol: opts?.protocol,
    maxTokens: 24,
    temperature: 0,
  });
}
