importScripts('config.js');

const STORAGE_KEY = 'flow_bridge_settings_v1';
const STATE_KEY = 'flow_bridge_runtime_v1';

let isClaimingOrRunning = false;
let currentJob = null;

async function getSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const saved = res[STORAGE_KEY] || {};
  return {
    appUrl: (saved.appUrl || self.DEFAULT_FLOW_BRIDGE_CONFIG.appUrl || '').replace(/\/+$/, ''),
    token: (saved.token || self.DEFAULT_FLOW_BRIDGE_CONFIG.token || '').trim(),
    autoRun: saved.autoRun !== undefined ? Boolean(saved.autoRun) : true,
  };
}

async function saveRuntime(patch) {
  const prev = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: ['https://labs.google/fx/*'] });
  if (!tabs || tabs.length === 0) return null;
  return tabs.find((t) => t.active) || tabs[0];
}

async function sendHeartbeat() {
  const cfg = await getSettings();
  if (!cfg.appUrl || !cfg.token) return false;
  const tab = await findFlowTab();
  try {
    const res = await fetch(cfg.appUrl + '/api/flow-bridge/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({
        extensionVersion: self.DEFAULT_FLOW_BRIDGE_CONFIG.version || '1.1.0',
        activeTabUrl: tab?.url || '',
        flowTabReady: Boolean(tab && tab.id),
        busyJobId: currentJob?.jobId || '',
      }),
    });
    const ok = res.ok;
    const data = ok ? await res.json().catch(() => ({})) : {};
    await saveRuntime({
      connected: ok,
      flowTabReady: Boolean(tab && tab.id),
      pendingJobsCount: data.pendingJobsCount ?? 0,
      lastHeartbeatAt: ok ? Date.now() : null,
      lastError: ok ? '' : 'HTTP ' + res.status + ' (Kiểm tra App URL hoặc Bridge Token)',
    });
    return ok;
  } catch (err) {
    await saveRuntime({
      connected: false,
      lastError: String(err?.message || 'Không kết nối được App'),
    });
    return false;
  }
}

async function uploadResultToApp(job, blob, fileName, mimeType) {
  const cfg = await getSettings();
  const arrayBuffer = await blob.arrayBuffer();
  const res = await fetch(cfg.appUrl + '/api/flow-bridge/complete', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType || blob.type || (job.kind === 'image' ? 'image/png' : 'video/mp4'),
      'X-Flow-Bridge-Token': cfg.token,
      'X-Session-Id': encodeURIComponent(job.sessionId),
      'X-Task-Code': encodeURIComponent(job.taskCode),
      'X-File-Name': encodeURIComponent(fileName || (job.kind === 'image' ? job.taskCode + '.png' : job.taskCode + '.mp4')),
      'X-Mime-Type': mimeType || blob.type || '',
    },
    body: arrayBuffer,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('App từ chối nhận kết quả (HTTP ' + res.status + '): ' + txt.slice(0, 160));
  }
  return await res.json().catch(() => ({ ok: true }));
}

async function reportJobFailure(job, reason) {
  const cfg = await getSettings();
  try {
    await fetch(cfg.appUrl + '/api/flow-bridge/fail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({
        sessionId: job.sessionId,
        taskCode: job.taskCode,
        error: String(reason || 'Lỗi không xác định trên Google Flow'),
      }),
    });
  } catch {
    // ignore network failure while reporting
  }
}

function dataUrlToBlob(dataUrl, fallbackMime) {
  const parts = String(dataUrl || '').split(',');
  const header = parts[0] || '';
  const b64 = parts[1] || '';
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : fallbackMime || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function pollAndExecuteNextJob() {
  if (isClaimingOrRunning) return;
  const cfg = await getSettings();
  if (!cfg.autoRun || !cfg.appUrl || !cfg.token) return;

  const tab = await findFlowTab();
  if (!tab || !tab.id) {
    await saveRuntime({ flowTabReady: false });
    return;
  }

  isClaimingOrRunning = true;
  try {
    const res = await fetch(cfg.appUrl + '/api/flow-bridge/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flow-Bridge-Token': cfg.token,
      },
      body: JSON.stringify({ workerId: 'chrome-ext-' + tab.id }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (!data || !data.job) return;

    currentJob = data.job;
    await saveRuntime({
      activeJob: {
        jobId: currentJob.jobId,
        sessionId: currentJob.sessionId,
        taskCode: currentJob.taskCode,
        kind: currentJob.kind,
        sceneIndex: currentJob.sceneIndex,
      },
      lastStatusText: 'Đang gửi lệnh ' + currentJob.taskCode + ' sang tab Google Flow...',
    });

    // Ensure content script is alive in the Flow tab
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        type: 'FLOW_RUN_JOB',
        job: currentJob,
      });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 800));
      result = await chrome.tabs.sendMessage(tab.id, {
        type: 'FLOW_RUN_JOB',
        job: currentJob,
      });
    }

    if (!result || !result.ok) {
      const reason = result?.error || 'Tab Google Flow không trả về tệp kết quả.';
      await reportJobFailure(currentJob, reason);
      await saveRuntime({ lastStatusText: 'Lỗi ' + currentJob.taskCode + ': ' + reason, activeJob: null });
      return;
    }

    let blob;
    let mimeType = result.mimeType || (currentJob.kind === 'image' ? 'image/png' : 'video/mp4');
    if (result.dataUrl) {
      blob = dataUrlToBlob(result.dataUrl, mimeType);
      mimeType = blob.type || mimeType;
    } else if (result.mediaUrl) {
      const dl = await fetch(result.mediaUrl);
      if (!dl.ok) throw new Error('Không tải được media từ URL Google Flow (HTTP ' + dl.status + ')');
      blob = await dl.blob();
      mimeType = blob.type || mimeType;
    } else {
      throw new Error('Không có dữ liệu ảnh/video trả về từ tab Google Flow.');
    }

    const ext = mimeType.includes('webm')
      ? '.webm'
      : mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? '.jpg'
      : mimeType.includes('webp')
      ? '.webp'
      : currentJob.kind === 'image'
      ? '.png'
      : '.mp4';

    await uploadResultToApp(currentJob, blob, currentJob.taskCode + '_flow' + ext, mimeType);
    await saveRuntime({
      activeJob: null,
      lastStatusText: 'Hoàn tất ' + currentJob.taskCode + ' và đã gửi về App!',
    });
  } catch (err) {
    if (currentJob) {
      await reportJobFailure(currentJob, String(err?.message || err));
    }
    await saveRuntime({
      activeJob: null,
      lastStatusText: 'Lỗi thực thi: ' + String(err?.message || err),
    });
  } finally {
    currentJob = null;
    isClaimingOrRunning = false;
    void sendHeartbeat();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('flow_bridge_tick', { periodInMinutes: 0.15 });
  void sendHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('flow_bridge_tick', { periodInMinutes: 0.15 });
  void sendHeartbeat();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flow_bridge_tick') {
    void sendHeartbeat().then((ok) => {
      if (ok) void pollAndExecuteNextJob();
    });
  }
});

// Fast in-memory tick while service worker is warm
setInterval(() => {
  void sendHeartbeat().then((ok) => {
    if (ok) void pollAndExecuteNextJob();
  });
}, 6000);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'POPUP_PING') {
    void sendHeartbeat().then(async (ok) => {
      const runtime = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
      sendResponse({ ok, runtime });
    });
    return true;
  }
  if (msg?.type === 'POPUP_POLL_NOW') {
    void sendHeartbeat().then(() => pollAndExecuteNextJob()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'MANUAL_CAPTURE_SUBMIT') {
    (async () => {
      try {
        if (!currentJob) {
          sendResponse({ ok: false, error: 'Hiện không có tác vụ Flow nào đang chờ nhận.' });
          return;
        }
        const blob = msg.dataUrl
          ? dataUrlToBlob(msg.dataUrl, msg.mimeType)
          : await (await fetch(msg.mediaUrl)).blob();
        const ext = currentJob.kind === 'image' ? '.png' : '.mp4';
        await uploadResultToApp(currentJob, blob, currentJob.taskCode + '_manual' + ext, blob.type);
        currentJob = null;
        isClaimingOrRunning = false;
        await saveRuntime({ activeJob: null, lastStatusText: 'Đã gửi tệp thủ công về App!' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});
