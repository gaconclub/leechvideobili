import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import type { GeminiAccountPublic, GeminiAccountStatus } from '../src/types/commandCenter';

interface StoredGeminiAccount {
  id: string;
  label: string;
  apiKey: string;
  enabled: boolean;
  isChairman: boolean;
  note?: string;
  preferredModel?: string;
  status: GeminiAccountStatus;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  quotaStatus?: string;
  lastError?: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
}

interface GeminiPoolStoreFile {
  version: number;
  chairmanAccountId: string;
  envDefaultEnabled: boolean;
  envDefaultLabel: string;
  envDefaultNote?: string;
  envDefaultStatus: GeminiAccountStatus;
  envDefaultLastCheckedAt?: number;
  envDefaultLastLatencyMs?: number;
  envDefaultQuotaStatus?: string;
  envDefaultLastError?: string;
  envDefaultRequestsCount: number;
  envDefaultSuccessCount: number;
  envDefaultErrorCount: number;
  accounts: StoredGeminiAccount[];
}

export const ENV_DEFAULT_GEMINI_ACCOUNT_ID = 'gemini-env-default';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'gemini_accounts.json');

let roundRobinCursor = 0;

function createDefaultStore(): GeminiPoolStoreFile {
  return {
    version: 1,
    chairmanAccountId: ENV_DEFAULT_GEMINI_ACCOUNT_ID,
    envDefaultEnabled: true,
    envDefaultLabel: 'Gemini Hệ thống (Mặc định)',
    envDefaultNote: 'Tài khoản mặc định nạp từ cấu hình môi trường máy chủ',
    envDefaultStatus: process.env.GEMINI_API_KEY?.trim() ? 'untested' : 'error',
    envDefaultRequestsCount: 0,
    envDefaultSuccessCount: 0,
    envDefaultErrorCount: 0,
    accounts: [],
  };
}

let poolStore: GeminiPoolStoreFile = loadPoolStore();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPoolStore(): GeminiPoolStoreFile {
  try {
    ensureDataDir();
    if (!fs.existsSync(STORE_FILE)) {
      return createDefaultStore();
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GeminiPoolStoreFile>;
    const base = createDefaultStore();
    const merged: GeminiPoolStoreFile = {
      ...base,
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
    return merged;
  } catch {
    return createDefaultStore();
  }
}

function savePoolStore(): void {
  try {
    ensureDataDir();
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(poolStore, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
  } catch {
    // non-fatal persistence failure
  }
}

export function maskGeminiApiKey(key?: string): string {
  const s = String(key || '').trim();
  if (!s) return 'Chưa có key';
  if (s.length <= 10) return `${s.slice(0, 3)}***${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function hasEnvDefaultKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function resolveEffectiveChairmanId(): string {
  const allValidIds: string[] = [];
  if (hasEnvDefaultKey() && poolStore.envDefaultEnabled) {
    allValidIds.push(ENV_DEFAULT_GEMINI_ACCOUNT_ID);
  }
  for (const acc of poolStore.accounts) {
    if (acc.enabled && acc.apiKey.trim()) {
      allValidIds.push(acc.id);
    }
  }
  if (poolStore.chairmanAccountId && allValidIds.includes(poolStore.chairmanAccountId)) {
    return poolStore.chairmanAccountId;
  }
  if (allValidIds.length > 0) {
    poolStore.chairmanAccountId = allValidIds[0];
    return allValidIds[0];
  }
  return poolStore.chairmanAccountId || ENV_DEFAULT_GEMINI_ACCOUNT_ID;
}

export function listGeminiAccountsPublic(): GeminiAccountPublic[] {
  const chairmanId = resolveEffectiveChairmanId();
  const list: GeminiAccountPublic[] = [];

  if (hasEnvDefaultKey()) {
    list.push({
      id: ENV_DEFAULT_GEMINI_ACCOUNT_ID,
      label: poolStore.envDefaultLabel || 'Gemini Hệ thống (Mặc định)',
      source: 'env',
      maskedKey: maskGeminiApiKey(process.env.GEMINI_API_KEY),
      enabled: poolStore.envDefaultEnabled,
      isChairman: chairmanId === ENV_DEFAULT_GEMINI_ACCOUNT_ID,
      note: poolStore.envDefaultNote,
      preferredModel: 'gemini-4-hydrogen',
      status: poolStore.envDefaultStatus || 'untested',
      lastCheckedAt: poolStore.envDefaultLastCheckedAt,
      lastLatencyMs: poolStore.envDefaultLastLatencyMs,
      quotaStatus: poolStore.envDefaultQuotaStatus,
      lastError: poolStore.envDefaultLastError,
      requestsCount: poolStore.envDefaultRequestsCount || 0,
      successCount: poolStore.envDefaultSuccessCount || 0,
      errorCount: poolStore.envDefaultErrorCount || 0,
      createdAt: 0,
      updatedAt: poolStore.envDefaultLastCheckedAt || Date.now(),
    });
  }

  for (const acc of poolStore.accounts) {
    list.push({
      id: acc.id,
      label: acc.label,
      source: 'custom',
      maskedKey: maskGeminiApiKey(acc.apiKey),
      enabled: acc.enabled,
      isChairman: chairmanId === acc.id,
      note: acc.note,
      preferredModel: acc.preferredModel || 'gemini-4-hydrogen',
      status: acc.status,
      lastCheckedAt: acc.lastCheckedAt,
      lastLatencyMs: acc.lastLatencyMs,
      quotaStatus: acc.quotaStatus,
      lastError: acc.lastError,
      requestsCount: acc.requestsCount || 0,
      successCount: acc.successCount || 0,
      errorCount: acc.errorCount || 0,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    });
  }

  return list;
}

export function hasAnyEnabledGeminiAccount(): boolean {
  if (hasEnvDefaultKey() && poolStore.envDefaultEnabled) return true;
  return poolStore.accounts.some((a) => a.enabled && Boolean(a.apiKey.trim()));
}

export function getGeminiAccountSecretById(accountId?: string): { id: string; label: string; apiKey: string } | null {
  if (!accountId) return null;
  if (accountId === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || !poolStore.envDefaultEnabled) return null;
    return {
      id: ENV_DEFAULT_GEMINI_ACCOUNT_ID,
      label: poolStore.envDefaultLabel || 'Gemini Hệ thống (Mặc định)',
      apiKey: key,
    };
  }
  const found = poolStore.accounts.find((a) => a.id === accountId && a.enabled && a.apiKey.trim());
  if (!found) return null;
  return {
    id: found.id,
    label: found.label,
    apiKey: found.apiKey.trim(),
  };
}

export function resolveChairmanGeminiAccount(overrideChairmanId?: string): {
  id: string;
  label: string;
  apiKey: string;
} | null {
  const preferred = getGeminiAccountSecretById(overrideChairmanId);
  if (preferred) return preferred;

  const currentChairman = getGeminiAccountSecretById(resolveEffectiveChairmanId());
  if (currentChairman) return currentChairman;

  // Fallback to any enabled account
  if (hasEnvDefaultKey() && poolStore.envDefaultEnabled) {
    return {
      id: ENV_DEFAULT_GEMINI_ACCOUNT_ID,
      label: poolStore.envDefaultLabel || 'Gemini Hệ thống (Mặc định)',
      apiKey: process.env.GEMINI_API_KEY!.trim(),
    };
  }
  const firstCustom = poolStore.accounts.find((a) => a.enabled && a.apiKey.trim());
  if (firstCustom) {
    return {
      id: firstCustom.id,
      label: firstCustom.label,
      apiKey: firstCustom.apiKey.trim(),
    };
  }
  return null;
}

export function pickWorkerGeminiAccount(params?: {
  allowedAccountIds?: string[];
  preferredAccountId?: string;
  excludeAccountIds?: string[];
  chairmanAccountId?: string;
}): { id: string; label: string; apiKey: string } | null {
  const excluded = new Set(params?.excludeAccountIds || []);

  // Build candidate pool
  const candidates: { id: string; label: string; apiKey: string; status: GeminiAccountStatus }[] = [];
  if (hasEnvDefaultKey() && poolStore.envDefaultEnabled) {
    candidates.push({
      id: ENV_DEFAULT_GEMINI_ACCOUNT_ID,
      label: poolStore.envDefaultLabel || 'Gemini Hệ thống (Mặc định)',
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      status: poolStore.envDefaultStatus,
    });
  }
  for (const acc of poolStore.accounts) {
    if (acc.enabled && acc.apiKey.trim()) {
      candidates.push({
        id: acc.id,
        label: acc.label,
        apiKey: acc.apiKey.trim(),
        status: acc.status,
      });
    }
  }

  if (candidates.length === 0) return null;

  let filtered = candidates.filter((c) => !excluded.has(c.id));
  if (params?.allowedAccountIds && params.allowedAccountIds.length > 0) {
    const allowedSet = new Set(params.allowedAccountIds);
    const sessionFiltered = filtered.filter((c) => allowedSet.has(c.id));
    if (sessionFiltered.length > 0) {
      filtered = sessionFiltered;
    }
  }

  if (filtered.length === 0) {
    filtered = candidates;
  }

  // Prefer explicitly pinned account if available and not in auth/quota error
  if (params?.preferredAccountId) {
    const pinned = filtered.find(
      (c) => c.id === params.preferredAccountId && c.status !== 'auth_error' && c.status !== 'quota_exceeded'
    );
    if (pinned) return { id: pinned.id, label: pinned.label, apiKey: pinned.apiKey };
  }

  // Prioritize healthy / untested accounts over quota_exceeded / auth_error
  const healthyPool = filtered.filter((c) => c.status !== 'auth_error' && c.status !== 'quota_exceeded');
  const activePool = healthyPool.length > 0 ? healthyPool : filtered;

  // Prefer non-chairman workers when multiple Gemini accounts are active, leaving chairman dedicated to coordination
  const nonChairmanPool =
    activePool.length > 1 && params?.chairmanAccountId
      ? activePool.filter((c) => c.id !== params.chairmanAccountId)
      : activePool;
  const finalPool = nonChairmanPool.length > 0 ? nonChairmanPool : activePool;

  const picked = finalPool[roundRobinCursor % finalPool.length];
  roundRobinCursor = (roundRobinCursor + 1) % 1_000_000;
  return { id: picked.id, label: picked.label, apiKey: picked.apiKey };
}

export function recordGeminiAccountUsage(
  accountId: string | undefined,
  ok: boolean,
  opts?: { latencyMs?: number; errorMsg?: string }
): void {
  if (!accountId) return;
  const now = Date.now();
  const rawErr = String(opts?.errorMsg || '');
  const lowerErr = rawErr.toLowerCase();
  const classifiedStatus: GeminiAccountStatus = ok
    ? 'healthy'
    : lowerErr.includes('429') || lowerErr.includes('resource_exhausted') || lowerErr.includes('quota')
    ? 'quota_exceeded'
    : lowerErr.includes('api_key_invalid') || lowerErr.includes('401') || lowerErr.includes('403') || lowerErr.includes('permission_denied')
    ? 'auth_error'
    : 'error';

  if (accountId === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    poolStore.envDefaultRequestsCount = (poolStore.envDefaultRequestsCount || 0) + 1;
    if (ok) {
      poolStore.envDefaultSuccessCount = (poolStore.envDefaultSuccessCount || 0) + 1;
      poolStore.envDefaultStatus = 'healthy';
      poolStore.envDefaultLastError = undefined;
      poolStore.envDefaultQuotaStatus = 'Khả dụng';
    } else {
      poolStore.envDefaultErrorCount = (poolStore.envDefaultErrorCount || 0) + 1;
      poolStore.envDefaultStatus = classifiedStatus;
      poolStore.envDefaultLastError = rawErr.slice(0, 260);
      if (classifiedStatus === 'quota_exceeded') {
        poolStore.envDefaultQuotaStatus = 'Chạm hạn mức (429)';
      }
    }
    if (opts?.latencyMs !== undefined) poolStore.envDefaultLastLatencyMs = opts.latencyMs;
    poolStore.envDefaultLastCheckedAt = now;
    savePoolStore();
    return;
  }

  const acc = poolStore.accounts.find((a) => a.id === accountId);
  if (!acc) return;
  acc.requestsCount = (acc.requestsCount || 0) + 1;
  if (ok) {
    acc.successCount = (acc.successCount || 0) + 1;
    acc.status = 'healthy';
    acc.lastError = undefined;
    acc.quotaStatus = 'Khả dụng';
  } else {
    acc.errorCount = (acc.errorCount || 0) + 1;
    acc.status = classifiedStatus;
    acc.lastError = rawErr.slice(0, 260);
    if (classifiedStatus === 'quota_exceeded') {
      acc.quotaStatus = 'Chạm hạn mức (429)';
    }
  }
  if (opts?.latencyMs !== undefined) acc.lastLatencyMs = opts.latencyMs;
  acc.lastCheckedAt = now;
  acc.updatedAt = now;
  savePoolStore();
}

export function addGeminiAccount(input: {
  label: string;
  apiKey: string;
  note?: string;
  preferredModel?: string;
  setAsChairman?: boolean;
}): GeminiAccountPublic {
  const label = String(input.label || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  if (!label) throw new Error('Vui lòng nhập tên tài khoản Gemini API.');
  if (!apiKey || apiKey.length < 16) {
    throw new Error('Gemini API Key không hợp lệ (cần ít nhất 16 ký tự).');
  }
  const duplicate = poolStore.accounts.find((a) => a.apiKey.trim() === apiKey);
  if (duplicate) {
    throw new Error(`API Key này đã được thêm với tên "${duplicate.label}".`);
  }

  const now = Date.now();
  const id = `gem_${now}_${crypto.randomBytes(2).toString('hex')}`;
  const shouldBeChairman =
    input.setAsChairman === true || (!hasEnvDefaultKey() && poolStore.accounts.length === 0);

  const created: StoredGeminiAccount = {
    id,
    label,
    apiKey,
    enabled: true,
    isChairman: shouldBeChairman,
    note: input.note?.trim() || undefined,
    preferredModel: input.preferredModel?.trim() || 'gemini-4-hydrogen',
    status: 'untested',
    requestsCount: 0,
    successCount: 0,
    errorCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  poolStore.accounts.push(created);
  if (shouldBeChairman) {
    poolStore.chairmanAccountId = id;
    for (const a of poolStore.accounts) {
      a.isChairman = a.id === id;
    }
  }
  savePoolStore();

  return listGeminiAccountsPublic().find((a) => a.id === id)!;
}

export function updateGeminiAccount(
  id: string,
  patch: {
    label?: string;
    apiKey?: string;
    enabled?: boolean;
    note?: string;
    preferredModel?: string;
  }
): GeminiAccountPublic {
  if (id === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    if (!hasEnvDefaultKey()) {
      throw new Error('Không tìm thấy GEMINI_API_KEY mặc định trong cấu hình máy chủ.');
    }
    if (typeof patch.label === 'string' && patch.label.trim()) {
      poolStore.envDefaultLabel = patch.label.trim();
    }
    if (typeof patch.note === 'string') {
      poolStore.envDefaultNote = patch.note.trim() || undefined;
    }
    if (typeof patch.enabled === 'boolean') {
      poolStore.envDefaultEnabled = patch.enabled;
    }
    resolveEffectiveChairmanId();
    savePoolStore();
    return listGeminiAccountsPublic().find((a) => a.id === id)!;
  }

  const acc = poolStore.accounts.find((a) => a.id === id);
  if (!acc) throw new Error('Không tìm thấy tài khoản Gemini API này.');

  if (typeof patch.label === 'string' && patch.label.trim()) {
    acc.label = patch.label.trim();
  }
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (patch.apiKey.trim().length < 16) {
      throw new Error('Gemini API Key mới không hợp lệ.');
    }
    acc.apiKey = patch.apiKey.trim();
    acc.status = 'untested';
    acc.lastError = undefined;
  }
  if (typeof patch.enabled === 'boolean') {
    acc.enabled = patch.enabled;
  }
  if (typeof patch.note === 'string') {
    acc.note = patch.note.trim() || undefined;
  }
  if (typeof patch.preferredModel === 'string' && patch.preferredModel.trim()) {
    acc.preferredModel = patch.preferredModel.trim();
  }
  acc.updatedAt = Date.now();
  resolveEffectiveChairmanId();
  savePoolStore();
  return listGeminiAccountsPublic().find((a) => a.id === id)!;
}

export function deleteGeminiAccount(id: string): void {
  if (id === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    throw new Error('Không thể xóa tài khoản Gemini Hệ thống mặc định. Bạn có thể tạm tắt tài khoản này.');
  }
  const idx = poolStore.accounts.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('Không tìm thấy tài khoản Gemini API cần xóa.');
  poolStore.accounts.splice(idx, 1);
  resolveEffectiveChairmanId();
  savePoolStore();
}

export function setChairmanGeminiAccount(id: string): GeminiAccountPublic {
  const exists =
    (id === ENV_DEFAULT_GEMINI_ACCOUNT_ID && hasEnvDefaultKey()) ||
    poolStore.accounts.some((a) => a.id === id);
  if (!exists) {
    throw new Error('Không tìm thấy tài khoản Gemini API để chỉ định làm Chỉ huy trưởng.');
  }
  if (id === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    poolStore.envDefaultEnabled = true;
  } else {
    const acc = poolStore.accounts.find((a) => a.id === id);
    if (acc) acc.enabled = true;
  }
  poolStore.chairmanAccountId = id;
  for (const a of poolStore.accounts) {
    a.isChairman = a.id === id;
  }
  savePoolStore();
  return listGeminiAccountsPublic().find((a) => a.id === id)!;
}

export async function testGeminiAccountConnection(id: string): Promise<{
  ok: boolean;
  account: GeminiAccountPublic;
  latencyMs: number;
  model: string;
  message: string;
}> {
  let apiKey = '';
  let label = '';
  if (id === ENV_DEFAULT_GEMINI_ACCOUNT_ID) {
    apiKey = process.env.GEMINI_API_KEY?.trim() || '';
    label = poolStore.envDefaultLabel || 'Gemini Hệ thống (Mặc định)';
  } else {
    const acc = poolStore.accounts.find((a) => a.id === id);
    if (!acc) throw new Error('Không tìm thấy tài khoản Gemini API.');
    apiKey = acc.apiKey.trim();
    label = acc.label;
  }

  if (!apiKey) {
    throw new Error(`Tài khoản "${label}" chưa có API Key hợp lệ.`);
  }

  const startedAt = Date.now();
  const testModel = 'gemini-3.1-flash-lite';
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  try {
    const res = await ai.models.generateContent({
      model: testModel,
      contents: 'Reply with OK only.',
    });
    const latencyMs = Date.now() - startedAt;
    const reply = String(res.text || '').trim();
    if (!reply) {
      throw new Error('API phản hồi rỗng.');
    }
    recordGeminiAccountUsage(id, true, { latencyMs });
    const updated = listGeminiAccountsPublic().find((a) => a.id === id)!;
    return {
      ok: true,
      account: updated,
      latencyMs,
      model: testModel,
      message: `Kết nối thành công tới ${testModel} (${latencyMs}ms) · Hạn mức khả dụng.`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startedAt;
    const raw = String(err?.message || err || 'Lỗi kết nối Gemini API');
    const lower = raw.toLowerCase();
    let friendly = raw;
    if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
      friendly = 'Chạm hạn mức hoặc hết quota (HTTP 429 RESOURCE_EXHAUSTED). Hãy đổi key khác hoặc kiểm tra billing.';
    } else if (lower.includes('api_key_invalid') || lower.includes('401') || lower.includes('403') || lower.includes('permission_denied')) {
      friendly = 'API Key không hợp lệ hoặc không có quyền truy cập (401/403).';
    }
    recordGeminiAccountUsage(id, false, { latencyMs, errorMsg: friendly });
    const updated = listGeminiAccountsPublic().find((a) => a.id === id)!;
    return {
      ok: false,
      account: updated,
      latencyMs,
      model: testModel,
      message: friendly,
    };
  }
}

export function getGeminiPoolSummary(): {
  total: number;
  enabled: number;
  healthy: number;
  chairmanAccountId: string;
  chairmanLabel: string;
} {
  const accounts = listGeminiAccountsPublic();
  const chairman = accounts.find((a) => a.isChairman);
  return {
    total: accounts.length,
    enabled: accounts.filter((a) => a.enabled).length,
    healthy: accounts.filter((a) => a.enabled && (a.status === 'healthy' || a.status === 'untested')).length,
    chairmanAccountId: chairman?.id || resolveEffectiveChairmanId(),
    chairmanLabel: chairman?.label || 'Gemini Chủ tịch',
  };
}
