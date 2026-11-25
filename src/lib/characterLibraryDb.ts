import type { StudioSavedCharacter } from '../types/bilibili';

const DB_NAME = 'bilibatch_studio_char_library_v1';
const DB_VERSION = 1;
const STORE_NAME = 'characters';
const FALLBACK_LS_KEY = 'bilibatch_studio_char_library_fallback_v1';

function openLibraryDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      resolve(null);
      return;
    }
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readFallbackLocalStorage(): StudioSavedCharacter[] {
  try {
    const raw = window.localStorage.getItem(FALLBACK_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFallbackLocalStorage(list: StudioSavedCharacter[]): void {
  try {
    window.localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    // Ignore quota exceeded when IndexedDB is primary store
  }
}

export async function loadLocalCharacterLibrary(): Promise<StudioSavedCharacter[]> {
  const db = await openLibraryDb();
  if (!db) {
    return readFallbackLocalStorage();
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? (req.result as StudioSavedCharacter[]) : [];
        items.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        db.close();
        if (items.length === 0) {
          const lsItems = readFallbackLocalStorage();
          resolve(lsItems);
          return;
        }
        resolve(items);
      };
      req.onerror = () => {
        db.close();
        resolve(readFallbackLocalStorage());
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(readFallbackLocalStorage());
    }
  });
}

export async function upsertLocalCharacter(record: StudioSavedCharacter): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    const cur = readFallbackLocalStorage().filter((c) => c.id !== record.id);
    writeFallbackLocalStorage([record, ...cur]);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

export async function replaceLocalCharacterLibrary(records: StudioSavedCharacter[]): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    writeFallbackLocalStorage(records);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const item of records.slice(0, 120)) {
        if (item?.id && item?.dataUrl) {
          store.put(item);
        }
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

export async function deleteLocalCharacter(id: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) {
    writeFallbackLocalStorage(readFallbackLocalStorage().filter((c) => c.id !== id));
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

export function mergeCharacterLibraries(
  serverChars: StudioSavedCharacter[],
  localChars: StudioSavedCharacter[]
): {
  merged: StudioSavedCharacter[];
  missingOnServer: StudioSavedCharacter[];
  missingLocally: StudioSavedCharacter[];
} {
  const byId = new Map<string, StudioSavedCharacter>();
  const serverIds = new Set<string>();
  const localIds = new Set<string>();

  for (const sc of serverChars) {
    if (!sc?.id || !sc?.dataUrl) continue;
    serverIds.add(sc.id);
    byId.set(sc.id, sc);
  }
  for (const lc of localChars) {
    if (!lc?.id || !lc?.dataUrl) continue;
    localIds.add(lc.id);
    const existing = byId.get(lc.id);
    if (!existing || (lc.updatedAt || 0) > (existing.updatedAt || 0)) {
      byId.set(lc.id, lc);
    }
  }

  const merged = Array.from(byId.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 120);

  const missingOnServer = merged.filter((item) => !serverIds.has(item.id));
  const missingLocally = merged.filter((item) => !localIds.has(item.id));
  return { merged, missingOnServer, missingLocally };
}
