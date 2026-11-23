import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  createManualTask,
  getProductionSessionSnapshot,
  startProductionOrchestration,
} from './commandCenter';

const DATA_DIR = path.join(process.cwd(), 'data');
const WORKSPACE_STATE_FILE = path.join(DATA_DIR, 'workspace_sync_state.json');

export interface UploadedDriveFileRecord {
  artifactKey: string;
  kind: 'character' | 'keyframe' | 'video' | 'final_film';
  label: string;
  sceneIndex?: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  webViewLink: string;
  webContentLink?: string;
  uploadedAt: number;
}

export interface SessionDriveArchive {
  runId: string;
  runTitle: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  lastSyncedAt: number;
  files: UploadedDriveFileRecord[];
}

export interface WorkspaceSyncState {
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  rootFolderUrl?: string;
  bridgeSecret: string;
  lastSyncedAt?: number;
  sessionArchives: Record<string, SessionDriveArchive>;
}

const SHEET_TABS = {
  SESSIONS: 'Phien_San_Xuat',
  TASKS: 'Tac_Vu_AI',
  FILES: 'File_Ket_Qua',
} as const;

let stateCache: WorkspaceSyncState | null = null;

function loadWorkspaceState(): WorkspaceSyncState {
  if (stateCache) return stateCache;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(WORKSPACE_STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(WORKSPACE_STATE_FILE, 'utf8'));
      stateCache = {
        spreadsheetId: parsed.spreadsheetId,
        spreadsheetTitle: parsed.spreadsheetTitle,
        spreadsheetUrl: parsed.spreadsheetUrl,
        rootFolderId: parsed.rootFolderId,
        rootFolderName: parsed.rootFolderName,
        rootFolderUrl: parsed.rootFolderUrl,
        bridgeSecret: parsed.bridgeSecret || crypto.randomBytes(24).toString('hex'),
        lastSyncedAt: parsed.lastSyncedAt,
        sessionArchives: parsed.sessionArchives && typeof parsed.sessionArchives === 'object' ? parsed.sessionArchives : {},
      };
      return stateCache;
    } catch {
      // fall through to fresh state
    }
  }
  stateCache = {
    bridgeSecret: crypto.randomBytes(24).toString('hex'),
    sessionArchives: {},
  };
  saveWorkspaceState();
  return stateCache;
}

function saveWorkspaceState(): void {
  if (!stateCache) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmp = `${WORKSPACE_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stateCache, null, 2), 'utf8');
  fs.renameSync(tmp, WORKSPACE_STATE_FILE);
}

export function getPublicWorkspaceConfig(): Omit<WorkspaceSyncState, 'bridgeSecret'> & { bridgeReady: boolean } {
  const st = loadWorkspaceState();
  return {
    spreadsheetId: st.spreadsheetId,
    spreadsheetTitle: st.spreadsheetTitle,
    spreadsheetUrl: st.spreadsheetUrl,
    rootFolderId: st.rootFolderId,
    rootFolderName: st.rootFolderName,
    rootFolderUrl: st.rootFolderUrl,
    lastSyncedAt: st.lastSyncedAt,
    sessionArchives: st.sessionArchives,
    bridgeReady: Boolean(st.bridgeSecret),
  };
}

export function extractBearerToken(authHeader?: string): string {
  const raw = String(authHeader || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error('Thiếu mã xác thực Google Workspace. Vui lòng đăng nhập Google trước.');
  }
  return match[1].trim();
}

async function googleApiJson<T = any>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const errMsg =
      json?.error?.message ||
      json?.error_description ||
      `Google API HTTP ${res.status}`;
    const err = new Error(errMsg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

async function createDriveFolder(
  token: string,
  name: string,
  parentId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const body: Record<string, any> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const created = await googleApiJson<{ id: string; name: string; webViewLink?: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    token,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  return {
    id: created.id,
    name: created.name || name,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function verifyDriveItemExists(token: string, fileId?: string): Promise<boolean> {
  if (!fileId) return false;
  try {
    const meta = await googleApiJson<{ id?: string; trashed?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
      token
    );
    return Boolean(meta?.id && !meta.trashed);
  } catch {
    return false;
  }
}

async function ensureRootDriveFolder(token: string): Promise<{ id: string; name: string; url: string }> {
  const st = loadWorkspaceState();
  if (st.rootFolderId && (await verifyDriveItemExists(token, st.rootFolderId))) {
    return {
      id: st.rootFolderId,
      name: st.rootFolderName || 'Phong_Dieu_Hanh_AI_Muse',
      url: st.rootFolderUrl || `https://drive.google.com/drive/folders/${st.rootFolderId}`,
    };
  }
  const created = await createDriveFolder(token, 'Phong_Dieu_Hanh_AI_Muse');
  st.rootFolderId = created.id;
  st.rootFolderName = created.name;
  st.rootFolderUrl = created.webViewLink;
  saveWorkspaceState();
  return { id: created.id, name: created.name, url: created.webViewLink };
}

async function ensureSessionDriveFolder(
  token: string,
  runId: string,
  runTitle: string
): Promise<SessionDriveArchive> {
  const st = loadWorkspaceState();
  const existing = st.sessionArchives[runId];
  if (existing?.folderId && (await verifyDriveItemExists(token, existing.folderId))) {
    existing.runTitle = runTitle;
    return existing;
  }
  const root = await ensureRootDriveFolder(token);
  const cleanTitle = String(runTitle || 'Phien_San_Xuat')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60);
  const folderName = `${runId} - ${cleanTitle || 'Phim AI'}`;
  const created = await createDriveFolder(token, folderName, root.id);
  const archive: SessionDriveArchive = {
    runId,
    runTitle,
    folderId: created.id,
    folderName: created.name,
    folderUrl: created.webViewLink,
    lastSyncedAt: Date.now(),
    files: existing?.files || [],
  };
  st.sessionArchives[runId] = archive;
  saveWorkspaceState();
  return archive;
}

async function uploadFileBufferToDrive(params: {
  token: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string; name: string; webViewLink: string; webContentLink?: string; size?: number }> {
  const boundary = `muse_drive_${crypto.randomBytes(8).toString('hex')}`;
  const metadata = JSON.stringify({
    name: params.fileName,
    parents: [params.folderId],
  });
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    'utf8'
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([preamble, params.buffer, epilogue]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    }
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Không thể tải tệp lên Google Drive (HTTP ${res.status})`);
  }
  return {
    id: json.id,
    name: json.name || params.fileName,
    webViewLink: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`,
    webContentLink: json.webContentLink,
    size: Number(json.size) || params.buffer.byteLength,
  };
}

async function ensureSpreadsheetStructure(
  token: string,
  spreadsheetId: string
): Promise<{ title: string; tabNames: string[] }> {
  const meta = await googleApiJson<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
    token
  );
  const existingTabs = (meta.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);
  const neededTabs = [SHEET_TABS.SESSIONS, SHEET_TABS.TASKS, SHEET_TABS.FILES];
  const missing = neededTabs.filter((t) => !existingTabs.includes(t));

  if (missing.length > 0) {
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((title) => ({
            addSheet: { properties: { title } },
          })),
        }),
      }
    );
  }

  // Ensure header rows exist on each tab without erasing existing rows
  const headers: Record<string, string[]> = {
    [SHEET_TABS.SESSIONS]: [
      'Mã Phiên',
      'Tên Phiên',
      'Trạng Thái',
      'Tiến Độ (%)',
      'Cảnh Hoàn Thành',
      'Cảnh Đạt QA',
      'Thư Mục Google Drive',
      'Link Phim Hoàn Chỉnh',
      'Cập Nhật Lúc',
    ],
    [SHEET_TABS.TASKS]: [
      'Mã Tác Vụ',
      'Mã Phiên',
      'Cảnh #',
      'Loại Tác Vụ',
      'AI Phụ Trách',
      'Lệnh / Kịch Bản Thực Thi',
      'Trạng Thái (QUEUED/RUNNING/DONE/ERROR)',
      'Điểm QA',
      'Kết Quả / Link File Drive',
      'Báo Cáo Kiểm Định Muse 05',
      'Cập Nhật Lúc',
    ],
    [SHEET_TABS.FILES]: [
      'Mã Phiên',
      'Loại Tệp',
      'Cảnh #',
      'Tên Tệp',
      'Link Xem Google Drive',
      'Link Tải Về',
      'Thời Gian Lưu',
    ],
  };

  for (const tabName of neededTabs) {
    const check = await googleApiJson<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tabName}!A1:K1`)}`,
      token
    );
    if (!check.values || check.values.length === 0 || !check.values[0]?.[0]) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tabName}!A1`)}?valueInputOption=USER_ENTERED`,
        token,
        {
          method: 'PUT',
          body: JSON.stringify({ values: [headers[tabName]] }),
        }
      );
    }
  }

  return {
    title: meta.properties?.title || 'Phòng Điều Hành AI Muse — Bảng Lệnh & Báo Cáo',
    tabNames: Array.from(new Set([...existingTabs, ...neededTabs])),
  };
}

export async function initializeWorkspaceSync(params: {
  token: string;
  existingSpreadsheetId?: string;
  spreadsheetTitle?: string;
}): Promise<ReturnType<typeof getPublicWorkspaceConfig>> {
  const st = loadWorkspaceState();
  const rootFolder = await ensureRootDriveFolder(params.token);

  let sheetId = String(params.existingSpreadsheetId || '').trim();
  // Extract ID if user pasted full Google Sheets URL
  const urlMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) sheetId = urlMatch[1];

  if (!sheetId) {
    const title =
      String(params.spreadsheetTitle || '').trim() ||
      'Phòng Điều Hành AI Muse — Lệnh Sản Xuất & Báo Cáo';
    const created = await googleApiJson<{
      spreadsheetId: string;
      spreadsheetUrl?: string;
      properties?: { title?: string };
    }>('https://sheets.googleapis.com/v4/spreadsheets', params.token, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title },
        sheets: [
          { properties: { title: SHEET_TABS.SESSIONS } },
          { properties: { title: SHEET_TABS.TASKS } },
          { properties: { title: SHEET_TABS.FILES } },
        ],
      }),
    });
    sheetId = created.spreadsheetId;
    st.spreadsheetId = sheetId;
    st.spreadsheetTitle = created.properties?.title || title;
    st.spreadsheetUrl =
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

    // Move newly created spreadsheet into the root Drive folder so everything is tidy
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}?addParents=${encodeURIComponent(rootFolder.id)}&fields=id,parents`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${params.token}` },
          signal: AbortSignal.timeout(15_000),
        }
      );
    } catch {
      // non-fatal if move fails
    }
  } else {
    st.spreadsheetId = sheetId;
    st.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  }

  const verified = await ensureSpreadsheetStructure(params.token, sheetId);
  st.spreadsheetTitle = verified.title;
  st.lastSyncedAt = Date.now();
  saveWorkspaceState();
  return getPublicWorkspaceConfig();
}

function fmtViTime(ts?: number): string {
  return new Date(ts || Date.now()).toLocaleString('vi-VN');
}

async function readSheetRows(token: string, spreadsheetId: string, range: string): Promise<string[][]> {
  const data = await googleApiJson<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    token
  );
  return Array.isArray(data.values) ? data.values : [];
}

async function upsertRowsByKeyColumn(params: {
  token: string;
  spreadsheetId: string;
  tabName: string;
  keyColIndex: number;
  rows: string[][];
}): Promise<void> {
  const existing = await readSheetRows(
    params.token,
    params.spreadsheetId,
    `${params.tabName}!A1:K5000`
  );
  const header = existing[0] || [];
  const dataRows = existing.slice(1);
  const rowIndexMap = new Map<string, number>();
  dataRows.forEach((r, idx) => {
    const k = String(r[params.keyColIndex] || '').trim();
    if (k) rowIndexMap.set(k, idx);
  });

  for (const newRow of params.rows) {
    const k = String(newRow[params.keyColIndex] || '').trim();
    if (!k) continue;
    const hitIdx = rowIndexMap.get(k);
    if (typeof hitIdx === 'number') {
      dataRows[hitIdx] = newRow;
    } else {
      rowIndexMap.set(k, dataRows.length);
      dataRows.push(newRow);
    }
  }

  const allValues = header.length > 0 ? [header, ...dataRows] : dataRows;
  await googleApiJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(`${params.tabName}!A1`)}?valueInputOption=USER_ENTERED`,
    params.token,
    {
      method: 'PUT',
      body: JSON.stringify({ values: allValues }),
    }
  );
}

export async function pushSessionToGoogleWorkspace(params: {
  token: string;
  runId?: string;
  uploadMediaToDrive?: boolean;
}): Promise<{
  config: ReturnType<typeof getPublicWorkspaceConfig>;
  sessionArchive: SessionDriveArchive;
  uploadedNewFilesCount: number;
  syncedTasksCount: number;
}> {
  const st = loadWorkspaceState();
  if (!st.spreadsheetId) {
    await initializeWorkspaceSync({ token: params.token });
  }
  const sheetId = loadWorkspaceState().spreadsheetId!;
  await ensureSpreadsheetStructure(params.token, sheetId);

  const snap = getProductionSessionSnapshot(params.runId);
  if (!snap.run) {
    throw new Error('Không tìm thấy phiên sản xuất nào để đồng bộ lên Google Sheets & Drive.');
  }
  const run = snap.run;
  const archive = await ensureSessionDriveFolder(params.token, run.id, run.title);

  // 1. Upload generated artifacts to session Google Drive folder (skip already uploaded keys)
  let uploadedNewFilesCount = 0;
  const existingByKey = new Map(archive.files.map((f) => [f.artifactKey, f]));
  if (params.uploadMediaToDrive !== false) {
    for (const art of snap.artifacts) {
      if (existingByKey.has(art.key)) continue;
      if (!fs.existsSync(art.diskPath)) continue;
      const buf = fs.readFileSync(art.diskPath);
      const uploaded = await uploadFileBufferToDrive({
        token: params.token,
        folderId: archive.folderId,
        fileName: art.fileName,
        mimeType: art.mimeType,
        buffer: buf,
      });
      const rec: UploadedDriveFileRecord = {
        artifactKey: art.key,
        kind: art.kind,
        label: art.label,
        sceneIndex: art.sceneIndex,
        fileId: uploaded.id,
        fileName: uploaded.name,
        mimeType: art.mimeType,
        sizeBytes: uploaded.size,
        webViewLink: uploaded.webViewLink,
        webContentLink: uploaded.webContentLink,
        uploadedAt: Date.now(),
      };
      archive.files.push(rec);
      existingByKey.set(art.key, rec);
      uploadedNewFilesCount += 1;
    }
  }

  archive.lastSyncedAt = Date.now();
  st.sessionArchives[run.id] = archive;
  st.lastSyncedAt = Date.now();
  saveWorkspaceState();

  // Map scene artifacts to Drive URLs for the sheet report
  const finalDriveFile = archive.files.find((f) => f.kind === 'final_film');
  const driveLinkBySceneVideo = new Map<number, string>();
  const driveLinkBySceneKf = new Map<number, string>();
  for (const f of archive.files) {
    if (f.kind === 'video' && f.sceneIndex) driveLinkBySceneVideo.set(f.sceneIndex, f.webViewLink);
    if (f.kind === 'keyframe' && f.sceneIndex) driveLinkBySceneKf.set(f.sceneIndex, f.webViewLink);
  }

  // 2. Upsert Session Summary row in Phien_San_Xuat
  const sessionRow = [
    run.id,
    run.title,
    run.status.toUpperCase(),
    String(run.overallProgressPct ?? 0),
    `${run.completedScenes}/${run.sceneCount}`,
    `${run.passedQaScenes}/${run.sceneCount}`,
    archive.folderUrl,
    finalDriveFile?.webViewLink || '',
    fmtViTime(),
  ];
  await upsertRowsByKeyColumn({
    token: params.token,
    spreadsheetId: sheetId,
    tabName: SHEET_TABS.SESSIONS,
    keyColIndex: 0,
    rows: [sessionRow],
  });

  // 3. Upsert Task rows in Tac_Vu_AI
  const mapStatusToSheet = (status: string): string => {
    if (status === 'completed') return 'DONE';
    if (status === 'running') return 'RUNNING';
    if (status === 'failed' || status === 'qa_rejected') return 'ERROR';
    if (status === 'cancelled') return 'CANCELLED';
    return 'QUEUED';
  };

  const qaBySceneId = new Map<string, (typeof snap.qaReports)[number]>();
  for (const q of snap.qaReports) {
    if (q.sceneId && !qaBySceneId.has(q.sceneId)) qaBySceneId.set(q.sceneId, q);
  }

  const taskRows: string[][] = snap.tasks.map((t) => {
    const qa = t.sceneId ? qaBySceneId.get(t.sceneId) : undefined;
    const driveUrl =
      t.type === 'assemble_final_film'
        ? finalDriveFile?.webViewLink || ''
        : t.type === 'produce_scene_video' && t.sceneIndex
        ? driveLinkBySceneVideo.get(t.sceneIndex) || ''
        : t.type === 'design_scene_image' && t.sceneIndex
        ? driveLinkBySceneKf.get(t.sceneIndex) || ''
        : '';
    return [
      t.code || t.id,
      run.id,
      t.sceneIndex ? String(t.sceneIndex) : '',
      t.type,
      t.assignedAgentId,
      (t.instructions || t.title || '').slice(0, 600),
      mapStatusToSheet(t.status),
      qa ? `${qa.overallScore}/100 (${qa.passed ? 'ĐẠT' : 'LỖI'})` : '',
      driveUrl || (t.outputText || '').slice(0, 260),
      qa?.summary || t.error || '',
      fmtViTime(t.completedAt || t.startedAt || t.createdAt),
    ];
  });

  if (taskRows.length > 0) {
    await upsertRowsByKeyColumn({
      token: params.token,
      spreadsheetId: sheetId,
      tabName: SHEET_TABS.TASKS,
      keyColIndex: 0,
      rows: taskRows,
    });
  }

  // 4. Upsert File rows in File_Ket_Qua
  const fileRows: string[][] = archive.files.map((f) => [
    run.id,
    f.kind,
    f.sceneIndex ? String(f.sceneIndex) : '',
    f.fileName,
    f.webViewLink,
    f.webContentLink || f.webViewLink,
    fmtViTime(f.uploadedAt),
  ]);
  if (fileRows.length > 0) {
    await upsertRowsByKeyColumn({
      token: params.token,
      spreadsheetId: sheetId,
      tabName: SHEET_TABS.FILES,
      keyColIndex: 4, // unique Drive webViewLink
      rows: fileRows,
    });
  }

  return {
    config: getPublicWorkspaceConfig(),
    sessionArchive: archive,
    uploadedNewFilesCount,
    syncedTasksCount: taskRows.length,
  };
}

export async function pullQueuedCommandsFromGoogleSheets(params: {
  token: string;
}): Promise<{
  dispatchedCount: number;
  dispatchedItems: Array<{ rowNumber: number; taskCode: string; action: string; runId?: string }>;
}> {
  const st = loadWorkspaceState();
  if (!st.spreadsheetId) {
    throw new Error('Chưa kết nối bảng tính Google Sheets. Hãy khởi tạo kết nối trước.');
  }
  await ensureSpreadsheetStructure(params.token, st.spreadsheetId);

  const rows = await readSheetRows(
    params.token,
    st.spreadsheetId,
    `${SHEET_TABS.TASKS}!A1:K1000`
  );
  if (rows.length <= 1) {
    return { dispatchedCount: 0, dispatchedItems: [] };
  }

  const dispatchedItems: Array<{ rowNumber: number; taskCode: string; action: string; runId?: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const taskCode = String(row[0] || `SHEET-R${i + 1}`).trim();
    const rowRunId = String(row[1] || '').trim();
    const taskType = String(row[3] || '').trim().toLowerCase();
    const agentCol = String(row[4] || '').trim().toLowerCase();
    const instruction = String(row[5] || '').trim();
    const status = String(row[6] || '').trim().toUpperCase();

    if (!instruction) continue;
    if (!['QUEUED', 'PENDING', 'RUN', 'NEW', 'CHO_CHAY'].includes(status)) continue;

    // Decide whether this row launches a full film production session OR a targeted task in existing session
    const isFullProduction =
      !rowRunId ||
      taskType === 'new_production' ||
      taskType === 'start_production' ||
      taskType === 'phim_moi';

    let launchedRunId = rowRunId;
    let actionSummary = '';

    if (isFullProduction) {
      const nextState = await startProductionOrchestration({
        title: taskCode.startsWith('SHEET-') ? instruction.slice(0, 64) : `${taskCode} - ${instruction.slice(0, 48)}`,
        script: instruction,
      });
      launchedRunId = nextState.activeRun?.id || nextState.runs[0]?.id || '';
      actionSummary = `Đã khởi chạy phiên sản xuất mới (${launchedRunId}) từ Google Sheets.`;
    } else {
      const validAgent = (['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'].includes(agentCol)
        ? agentCol
        : 'muse-01') as 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04' | 'muse-05';
      await createManualTask({
        title: `[Sheets ${taskCode}] ${instruction.slice(0, 60)}`,
        instructions: instruction,
        assignedAgentId: validAgent,
      });
      actionSummary = `Đã giao tác vụ lẻ cho ${validAgent} từ Google Sheets.`;
    }

    // Mark row as RUNNING in Google Sheets immediately so it won't double-execute
    const rowNum = i + 1;
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(st.spreadsheetId)}/values/${encodeURIComponent(`${SHEET_TABS.TASKS}!B${rowNum}:K${rowNum}`)}?valueInputOption=USER_ENTERED`,
      params.token,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [
            [
              launchedRunId,
              row[2] || '',
              row[3] || (isFullProduction ? 'start_production' : 'custom_task'),
              row[4] || 'chairman',
              instruction,
              'RUNNING',
              row[7] || '',
              actionSummary,
              'AI đang tự động thực thi',
              fmtViTime(),
            ],
          ],
        }),
      }
    );

    dispatchedItems.push({
      rowNumber: rowNum,
      taskCode,
      action: actionSummary,
      runId: launchedRunId,
    });
  }

  st.lastSyncedAt = Date.now();
  saveWorkspaceState();
  return {
    dispatchedCount: dispatchedItems.length,
    dispatchedItems,
  };
}

export async function fetchSessionDriveAndSheetReport(params: {
  token: string;
  runId?: string;
}): Promise<{
  config: ReturnType<typeof getPublicWorkspaceConfig>;
  driveFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    webViewLink: string;
    webContentLink?: string;
    thumbnailLink?: string;
    createdTime?: string;
  }>;
  sheetTasks: Array<{
    taskCode: string;
    runId: string;
    sceneIndex: string;
    taskType: string;
    agent: string;
    instruction: string;
    status: string;
    qaScore: string;
    resultLink: string;
    qaNote: string;
    updatedAt: string;
  }>;
  sheetSessions: Array<{
    runId: string;
    title: string;
    status: string;
    progressPct: string;
    completedScenes: string;
    passedQaScenes: string;
    driveFolderUrl: string;
    finalVideoUrl: string;
    updatedAt: string;
  }>;
}> {
  const st = loadWorkspaceState();
  const driveFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    webViewLink: string;
    webContentLink?: string;
    thumbnailLink?: string;
    createdTime?: string;
  }> = [];

  const targetArchive = params.runId ? st.sessionArchives[params.runId] : undefined;
  const folderToList = targetArchive?.folderId || st.rootFolderId;

  if (folderToList) {
    try {
      const q = `'${folderToList}' in parents and trashed = false`;
      const list = await googleApiJson<{ files?: any[] }>(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,createdTime)`,
        params.token
      );
      for (const f of list.files || []) {
        driveFiles.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? Number(f.size) : undefined,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          webContentLink: f.webContentLink,
          thumbnailLink: f.thumbnailLink,
          createdTime: f.createdTime,
        });
      }
    } catch {
      // return local cached archive if Drive query fails
    }
  }

  const sheetTasks: Array<{
    taskCode: string;
    runId: string;
    sceneIndex: string;
    taskType: string;
    agent: string;
    instruction: string;
    status: string;
    qaScore: string;
    resultLink: string;
    qaNote: string;
    updatedAt: string;
  }> = [];
  const sheetSessions: Array<{
    runId: string;
    title: string;
    status: string;
    progressPct: string;
    completedScenes: string;
    passedQaScenes: string;
    driveFolderUrl: string;
    finalVideoUrl: string;
    updatedAt: string;
  }> = [];

  if (st.spreadsheetId) {
    try {
      const [sessRows, taskRows] = await Promise.all([
        readSheetRows(params.token, st.spreadsheetId, `${SHEET_TABS.SESSIONS}!A2:I200`),
        readSheetRows(params.token, st.spreadsheetId, `${SHEET_TABS.TASKS}!A2:K500`),
      ]);
      for (const r of sessRows) {
        if (!r[0]) continue;
        sheetSessions.push({
          runId: r[0] || '',
          title: r[1] || '',
          status: r[2] || '',
          progressPct: r[3] || '0',
          completedScenes: r[4] || '',
          passedQaScenes: r[5] || '',
          driveFolderUrl: r[6] || '',
          finalVideoUrl: r[7] || '',
          updatedAt: r[8] || '',
        });
      }
      for (const r of taskRows) {
        if (!r[0] && !r[5]) continue;
        if (params.runId && r[1] && r[1] !== params.runId) continue;
        sheetTasks.push({
          taskCode: r[0] || '',
          runId: r[1] || '',
          sceneIndex: r[2] || '',
          taskType: r[3] || '',
          agent: r[4] || '',
          instruction: r[5] || '',
          status: r[6] || '',
          qaScore: r[7] || '',
          resultLink: r[8] || '',
          qaNote: r[9] || '',
          updatedAt: r[10] || '',
        });
      }
    } catch {
      // non-fatal
    }
  }

  return {
    config: getPublicWorkspaceConfig(),
    driveFiles,
    sheetTasks,
    sheetSessions,
  };
}

export function verifyAppsScriptSecret(secretHeader?: string): boolean {
  const st = loadWorkspaceState();
  const given = String(secretHeader || '').trim();
  if (!given || !st.bridgeSecret) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(st.bridgeSecret, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function handleAppsScriptDispatch(body: {
  taskCode?: string;
  runId?: string;
  taskType?: string;
  agentId?: string;
  instruction?: string;
}): Promise<{ ok: true; runId: string; status: string; message: string }> {
  const instruction = String(body.instruction || '').trim();
  if (!instruction) {
    throw new Error('Thiếu nội dung lệnh thực thi (instruction).');
  }
  const taskCode = String(body.taskCode || 'AUTO').trim();
  const rowRunId = String(body.runId || '').trim();
  const taskType = String(body.taskType || '').trim().toLowerCase();

  const isFullProduction =
    !rowRunId || ['new_production', 'start_production', 'phim_moi'].includes(taskType);

  if (isFullProduction) {
    const nextState = await startProductionOrchestration({
      title: `${taskCode} - ${instruction.slice(0, 52)}`,
      script: instruction,
    });
    const launchedRunId = nextState.activeRun?.id || nextState.runs[0]?.id || '';
    return {
      ok: true,
      runId: launchedRunId,
      status: 'RUNNING',
      message: `Chủ tịch Gemini AI đã tiếp nhận & khởi chạy phiên ${launchedRunId} trên Cloud.`,
    };
  }

  const validAgent = (['muse-01', 'muse-02', 'muse-03', 'muse-04', 'muse-05'].includes(String(body.agentId || ''))
    ? body.agentId
    : 'muse-01') as 'muse-01' | 'muse-02' | 'muse-03' | 'muse-04' | 'muse-05';
  await createManualTask({
    title: `[Auto-Sheet ${taskCode}] ${instruction.slice(0, 60)}`,
    instructions: instruction,
    assignedAgentId: validAgent,
  });
  return {
    ok: true,
    runId: rowRunId,
    status: 'RUNNING',
    message: `Đã giao tác vụ ${taskCode} cho ${validAgent} trên Cloud.`,
  };
}

export function getAppsScriptSessionStatus(runId: string, baseUrl: string) {
  const snap = getProductionSessionSnapshot(runId);
  if (!snap.run) {
    throw new Error(`Không tìm thấy phiên ${runId}.`);
  }
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    runId: snap.run.id,
    title: snap.run.title,
    status: snap.run.status,
    overallProgressPct: snap.run.overallProgressPct,
    completedScenes: snap.run.completedScenes,
    passedQaScenes: snap.run.passedQaScenes,
    sceneCount: snap.run.sceneCount,
    artifacts: snap.artifacts.map((a) => ({
      key: a.key,
      kind: a.kind,
      label: a.label,
      sceneIndex: a.sceneIndex || '',
      fileName: a.fileName,
      mimeType: a.mimeType,
      downloadUrl: `${cleanBase}${a.artifactUrl}`,
    })),
    qaSummary: snap.qaReports
      .slice(0, 10)
      .map((q) => `Cảnh ${q.sceneIndex}: ${q.overallScore}/100 (${q.passed ? 'ĐẠT' : 'LỖI'})`)
      .join(' | '),
  };
}

export function generateAppsScriptBridgeCode(appBaseUrl: string): {
  code: string;
  webhookDispatchUrl: string;
  webhookStatusBaseUrl: string;
  spreadsheetId: string;
  rootFolderName: string;
} {
  const st = loadWorkspaceState();
  const cleanBase = appBaseUrl.replace(/\/+$/, '');
  const dispatchUrl = `${cleanBase}/api/workspace/webhook/dispatch`;
  const statusBaseUrl = `${cleanBase}/api/workspace/webhook/status`;
  const rootName = st.rootFolderName || 'Phong_Dieu_Hanh_AI_Muse';

  const code = `/**
 * PHÒNG ĐIỀU HÀNH AI MUSE — BỘ TỰ ĐỘNG CHẠY NGẦM 24/7 KHI TẮT PC
 * Hướng dẫn cài đặt (chỉ làm 1 lần):
 * 1. Mở file Google Sheets của bạn -> Tiện ích mở rộng -> Apps Script
 * 2. Dán toàn bộ đoạn mã này và nhấn Lưu (Ctrl+S)
 * 3. Vào mục Kích hoạt (Triggers - biểu tượng đồng hồ bên trái) -> Thêm trình kích hoạt:
 *    - Chọn hàm chạy: runAiMuseAutomationCycle
 *    - Nguồn sự kiện: Theo thời gian (Time-driven) -> Bộ hẹn giờ theo phút -> Mỗi 5 phút
 * Khi tắt máy PC, Google Cloud vẫn tự đọc lệnh QUEUED -> gọi AI sản xuất -> lưu file vào Google Drive theo từng phiên -> cập nhật báo cáo!
 */

const APP_DISPATCH_URL = '${dispatchUrl}';
const APP_STATUS_BASE_URL = '${statusBaseUrl}';
const BRIDGE_SECRET = '${st.bridgeSecret}';
const ROOT_DRIVE_FOLDER_NAME = '${rootName}';

function runAiMuseAutomationCycle() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskSheet = ss.getSheetByName('${SHEET_TABS.TASKS}');
  const sessionSheet = ss.getSheetByName('${SHEET_TABS.SESSIONS}');
  const fileSheet = ss.getSheetByName('${SHEET_TABS.FILES}');
  if (!taskSheet) return;

  const rows = taskSheet.getDataRange().getValues();
  const activeRunIds = {};

  // Bước 1: Quét các dòng QUEUED để gửi lệnh sang Cloud AI sản xuất
  for (let i = 1; i < rows.length; i++) {
    const taskCode = String(rows[i][0] || 'AUTO-' + (i + 1)).trim();
    const runId = String(rows[i][1] || '').trim();
    const taskType = String(rows[i][3] || 'start_production').trim();
    const agentId = String(rows[i][4] || 'chairman').trim();
    const instruction = String(rows[i][5] || '').trim();
    const status = String(rows[i][6] || '').trim().toUpperCase();

    if (status === 'QUEUED' && instruction) {
      const resp = UrlFetchApp.fetch(APP_DISPATCH_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-workspace-bridge-secret': BRIDGE_SECRET },
        payload: JSON.stringify({ taskCode, runId, taskType, agentId, instruction }),
        muteHttpExceptions: true,
      });
      if (resp.getResponseCode() === 200) {
        const data = JSON.parse(resp.getContentText());
        taskSheet.getRange(i + 1, 2).setValue(data.runId || runId);
        taskSheet.getRange(i + 1, 7).setValue('RUNNING');
        taskSheet.getRange(i + 1, 9).setValue(data.message || 'Đang chạy trên Cloud');
        taskSheet.getRange(i + 1, 11).setValue(new Date().toLocaleString('vi-VN'));
        if (data.runId) activeRunIds[data.runId] = true;
      }
    } else if (status === 'RUNNING' && runId) {
      activeRunIds[runId] = true;
    }
  }

  // Bước 2: Kiểm tra tiến độ các phiên RUNNING -> tự tải file kết quả lưu vào Google Drive theo thư mục từng phiên!
  const rootFolder = getOrCreateFolder_(null, ROOT_DRIVE_FOLDER_NAME);
  Object.keys(activeRunIds).forEach(function (runId) {
    const stResp = UrlFetchApp.fetch(APP_STATUS_BASE_URL + '/' + encodeURIComponent(runId), {
      method: 'get',
      headers: { 'x-workspace-bridge-secret': BRIDGE_SECRET },
      muteHttpExceptions: true,
    });
    if (stResp.getResponseCode() !== 200) return;
    const info = JSON.parse(stResp.getContentText());
    const sessionFolderName = runId + ' - ' + String(info.title || 'Phim AI').slice(0, 55);
    const sessionFolder = getOrCreateFolder_(rootFolder, sessionFolderName);

    let finalVideoDriveUrl = '';
    (info.artifacts || []).forEach(function (art) {
      let driveFile = findFileInFolder_(sessionFolder, art.fileName);
      if (!driveFile) {
        const dl = UrlFetchApp.fetch(art.downloadUrl, { muteHttpExceptions: true });
        if (dl.getResponseCode() === 200) {
          const blob = dl.getBlob().setName(art.fileName);
          driveFile = sessionFolder.createFile(blob);
          if (fileSheet) {
            fileSheet.appendRow([
              runId,
              art.kind,
              art.sceneIndex,
              art.fileName,
              driveFile.getUrl(),
              driveFile.getDownloadUrl() || driveFile.getUrl(),
              new Date().toLocaleString('vi-VN'),
            ]);
          }
        }
      }
      if (driveFile && art.kind === 'final_film') {
        finalVideoDriveUrl = driveFile.getUrl();
      }
    });

    if (sessionSheet) {
      upsertSessionRow_(sessionSheet, [
        runId,
        info.title,
        String(info.status || '').toUpperCase(),
        info.overallProgressPct || 0,
        (info.completedScenes || 0) + '/' + (info.sceneCount || 0),
        (info.passedQaScenes || 0) + '/' + (info.sceneCount || 0),
        sessionFolder.getUrl(),
        finalVideoDriveUrl,
        new Date().toLocaleString('vi-VN'),
      ]);
    }

    // Nếu phiên hoàn tất/thất bại -> cập nhật các dòng RUNNING thuộc phiên đó
    if (info.status === 'completed' || info.status === 'failed' || info.status === 'cancelled') {
      const latestRows = taskSheet.getDataRange().getValues();
      for (let r = 1; r < latestRows.length; r++) {
        if (String(latestRows[r][1]) === runId && String(latestRows[r][6]).toUpperCase() === 'RUNNING') {
          taskSheet.getRange(r + 1, 7).setValue(info.status === 'completed' ? 'DONE' : 'ERROR');
          taskSheet.getRange(r + 1, 9).setValue(finalVideoDriveUrl || sessionFolder.getUrl());
          taskSheet.getRange(r + 1, 10).setValue(info.qaSummary || '');
          taskSheet.getRange(r + 1, 11).setValue(new Date().toLocaleString('vi-VN'));
        }
      }
    }
  });
}

function getOrCreateFolder_(parent, name) {
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function findFileInFolder_(folder, fileName) {
  const iter = folder.getFilesByName(fileName);
  return iter.hasNext() ? iter.next() : null;
}

function upsertSessionRow_(sheet, rowValues) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(rowValues[0])) {
      sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
      return;
    }
  }
  sheet.appendRow(rowValues);
}
`;

  return {
    code,
    webhookDispatchUrl: dispatchUrl,
    webhookStatusBaseUrl: statusBaseUrl,
    spreadsheetId: st.spreadsheetId || '',
    rootFolderName: rootName,
  };
}
