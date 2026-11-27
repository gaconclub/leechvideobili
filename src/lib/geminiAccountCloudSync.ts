import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { GeminiAccountPublic } from '../types/commandCenter';
import { db, handleFirestoreError, OperationType } from './firebaseFirestore';

export interface CloudGeminiAccountRecord {
  id: string;
  ownerId: string;
  label: string;
  apiKey: string;
  enabled: boolean;
  isChairman: boolean;
  note: string;
  preferredModel: string;
}

export interface CloudGeminiPoolSettingsRecord {
  ownerId: string;
  chairmanAccountId: string;
  envDefaultEnabled: boolean;
  envDefaultLabel: string;
  envDefaultNote: string;
}

export interface HydrateCloudResult {
  cloudCount: number;
  syncedCount: number;
  addedCount: number;
  accounts: GeminiAccountPublic[];
  summary: {
    total: number;
    enabled: number;
    healthy: number;
    chairmanAccountId: string;
    chairmanLabel: string;
  } | null;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return s.slice(0, maxLen);
}

function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return VALID_ID_REGEX.test(cleaned) ? cleaned : `gem_${Date.now()}`;
}

export async function ensureUserProfileDoc(user: User): Promise<void> {
  if (!user?.uid || !user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const email = clampString(user.email || `${user.uid}@users.local`, 254, `${user.uid}@users.local`);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingEmail = snap.data()?.email;
      if (existingEmail !== email) {
        await updateDoc(ref, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function loadGeminiVaultFromCloud(user: User): Promise<{
  accounts: CloudGeminiAccountRecord[];
  settings: CloudGeminiPoolSettingsRecord | null;
}> {
  if (!user?.uid || !user.emailVerified) {
    return { accounts: [], settings: null };
  }

  await ensureUserProfileDoc(user);

  const accountsPath = `users/${user.uid}/geminiAccounts`;
  const accounts: CloudGeminiAccountRecord[] = [];
  try {
    const q = query(
      collection(db, 'users', user.uid, 'geminiAccounts'),
      where('ownerId', '==', user.uid)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const apiKey = clampString(d?.apiKey, 256);
      const label = clampString(d?.label, 120);
      if (label && apiKey.length >= 16) {
        accounts.push({
          id: sanitizeDocId(String(d?.id || docSnap.id)),
          ownerId: user.uid,
          label,
          apiKey,
          enabled: typeof d?.enabled === 'boolean' ? d.enabled : true,
          isChairman: d?.isChairman === true,
          note: clampString(d?.note, 300),
          preferredModel: clampString(d?.preferredModel, 80, 'gemini-4-hydrogen') || 'gemini-4-hydrogen',
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, accountsPath);
  }

  const settingsPath = `users/${user.uid}/poolSettings/gemini`;
  let settings: CloudGeminiPoolSettingsRecord | null = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid, 'poolSettings', 'gemini'));
    if (snap.exists()) {
      const d = snap.data();
      settings = {
        ownerId: user.uid,
        chairmanAccountId: sanitizeDocId(String(d?.chairmanAccountId || 'gemini-env-default')),
        envDefaultEnabled: typeof d?.envDefaultEnabled === 'boolean' ? d.envDefaultEnabled : true,
        envDefaultLabel: clampString(d?.envDefaultLabel, 120, 'Gemini Hệ thống (Mặc định)') || 'Gemini Hệ thống (Mặc định)',
        envDefaultNote: clampString(d?.envDefaultNote, 300),
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, settingsPath);
  }

  return { accounts, settings };
}

export async function hydrateServerGeminiPoolFromCloud(user: User): Promise<HydrateCloudResult> {
  const { accounts: cloudAccounts, settings } = await loadGeminiVaultFromCloud(user);

  if (cloudAccounts.length === 0 && !settings) {
    const res = await fetch('/api/gemini-accounts');
    const data = await res.json();
    return {
      cloudCount: 0,
      syncedCount: 0,
      addedCount: 0,
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
      summary: data?.summary || null,
    };
  }

  const syncRes = await fetch('/api/gemini-accounts/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accounts: cloudAccounts.map((a) => ({
        id: a.id,
        label: a.label,
        apiKey: a.apiKey,
        enabled: a.enabled,
        isChairman: a.isChairman,
        note: a.note,
        preferredModel: a.preferredModel,
      })),
      chairmanAccountId: settings?.chairmanAccountId,
      envDefaultEnabled: settings?.envDefaultEnabled,
      envDefaultLabel: settings?.envDefaultLabel,
      envDefaultNote: settings?.envDefaultNote,
    }),
  });

  const syncData = await syncRes.json();
  if (!syncRes.ok) {
    throw new Error(syncData?.error || 'Không thể đồng bộ cụm API Gemini lên máy chủ.');
  }

  return {
    cloudCount: cloudAccounts.length,
    syncedCount: Number(syncData?.syncedCount || 0),
    addedCount: Number(syncData?.addedCount || 0),
    accounts: Array.isArray(syncData?.accounts) ? syncData.accounts : [],
    summary: syncData?.summary || null,
  };
}

export async function saveGeminiAccountToCloud(
  user: User,
  input: {
    id: string;
    label: string;
    apiKey: string;
    enabled: boolean;
    isChairman: boolean;
    note?: string;
    preferredModel?: string;
  }
): Promise<void> {
  if (!user?.uid || !user.emailVerified) return;
  await ensureUserProfileDoc(user);

  const accountId = sanitizeDocId(input.id);
  const docPath = `users/${user.uid}/geminiAccounts/${accountId}`;
  const ref = doc(db, 'users', user.uid, 'geminiAccounts', accountId);

  const cleanLabel = clampString(input.label, 120);
  const cleanApiKey = clampString(input.apiKey, 256);
  const cleanNote = clampString(input.note || '', 300);
  const cleanModel = clampString(input.preferredModel || 'gemini-4-hydrogen', 80, 'gemini-4-hydrogen') || 'gemini-4-hydrogen';

  if (!cleanLabel || cleanApiKey.length < 16) return;

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        id: accountId,
        ownerId: user.uid,
        label: cleanLabel,
        apiKey: cleanApiKey,
        enabled: Boolean(input.enabled),
        isChairman: Boolean(input.isChairman),
        note: cleanNote,
        preferredModel: cleanModel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        label: cleanLabel,
        apiKey: cleanApiKey,
        enabled: Boolean(input.enabled),
        isChairman: Boolean(input.isChairman),
        note: cleanNote,
        preferredModel: cleanModel,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function updateGeminiAccountInCloud(
  user: User,
  accountId: string,
  patch: {
    label?: string;
    apiKey?: string;
    enabled?: boolean;
    isChairman?: boolean;
    note?: string;
    preferredModel?: string;
  }
): Promise<void> {
  if (!user?.uid || !user.emailVerified) return;
  const cleanId = sanitizeDocId(accountId);
  const docPath = `users/${user.uid}/geminiAccounts/${cleanId}`;
  const ref = doc(db, 'users', user.uid, 'geminiAccounts', cleanId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const payload: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof patch.label === 'string' && patch.label.trim()) {
      payload.label = clampString(patch.label, 120);
    }
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim().length >= 16) {
      payload.apiKey = clampString(patch.apiKey, 256);
    }
    if (typeof patch.enabled === 'boolean') {
      payload.enabled = patch.enabled;
    }
    if (typeof patch.isChairman === 'boolean') {
      payload.isChairman = patch.isChairman;
    }
    if (typeof patch.note === 'string') {
      payload.note = clampString(patch.note, 300);
    }
    if (typeof patch.preferredModel === 'string' && patch.preferredModel.trim()) {
      payload.preferredModel = clampString(patch.preferredModel, 80);
    }

    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, docPath);
  }
}

export async function deleteGeminiAccountFromCloud(user: User, accountId: string): Promise<void> {
  if (!user?.uid || !user.emailVerified) return;
  const cleanId = sanitizeDocId(accountId);
  const docPath = `users/${user.uid}/geminiAccounts/${cleanId}`;
  const ref = doc(db, 'users', user.uid, 'geminiAccounts', cleanId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}

export async function saveGeminiPoolSettingsToCloud(
  user: User,
  settings: {
    chairmanAccountId: string;
    envDefaultEnabled?: boolean;
    envDefaultLabel?: string;
    envDefaultNote?: string;
  },
  syncChairmanOnAccounts = false
): Promise<void> {
  if (!user?.uid || !user.emailVerified) return;
  await ensureUserProfileDoc(user);

  const chairmanId = sanitizeDocId(settings.chairmanAccountId || 'gemini-env-default');
  const settingsPath = `users/${user.uid}/poolSettings/gemini`;
  const ref = doc(db, 'users', user.uid, 'poolSettings', 'gemini');

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: user.uid,
        chairmanAccountId: chairmanId,
        envDefaultEnabled: typeof settings.envDefaultEnabled === 'boolean' ? settings.envDefaultEnabled : true,
        envDefaultLabel:
          clampString(settings.envDefaultLabel, 120, 'Gemini Hệ thống (Mặc định)') ||
          'Gemini Hệ thống (Mặc định)',
        envDefaultNote: clampString(settings.envDefaultNote || '', 300),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const patch: Record<string, any> = {
        chairmanAccountId: chairmanId,
        updatedAt: serverTimestamp(),
      };
      if (typeof settings.envDefaultEnabled === 'boolean') {
        patch.envDefaultEnabled = settings.envDefaultEnabled;
      }
      if (typeof settings.envDefaultLabel === 'string' && settings.envDefaultLabel.trim()) {
        patch.envDefaultLabel = clampString(settings.envDefaultLabel, 120);
      }
      if (typeof settings.envDefaultNote === 'string') {
        patch.envDefaultNote = clampString(settings.envDefaultNote, 300);
      }
      await updateDoc(ref, patch);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, settingsPath);
  }

  if (syncChairmanOnAccounts) {
    const accountsPath = `users/${user.uid}/geminiAccounts`;
    try {
      const q = query(
        collection(db, 'users', user.uid, 'geminiAccounts'),
        where('ownerId', '==', user.uid)
      );
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const shouldBeChairman = docSnap.id === chairmanId;
        const currentIsChairman = docSnap.data()?.isChairman === true;
        if (currentIsChairman !== shouldBeChairman) {
          await updateDoc(docSnap.ref, {
            isChairman: shouldBeChairman,
            ...(shouldBeChairman ? { enabled: true } : {}),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, accountsPath);
    }
  }
}
