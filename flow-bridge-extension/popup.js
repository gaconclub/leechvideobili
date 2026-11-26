const STORAGE_KEY = 'flow_bridge_settings_v1';

async function loadPopup() {
  const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const defaults = self.DEFAULT_FLOW_BRIDGE_CONFIG || {};
  document.getElementById('appUrl').value = saved.appUrl || defaults.appUrl || '';
  document.getElementById('token').value = saved.token || defaults.token || '';
  document.getElementById('autoRun').checked = saved.autoRun !== undefined ? Boolean(saved.autoRun) : true;
  refreshStatus();
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'POPUP_PING' }, (res) => {
    const badge = document.getElementById('connBadge');
    const box = document.getElementById('statusBox');
    if (res && res.ok) {
      badge.textContent = 'Trực tuyến';
      badge.className = 'badge on';
      const rt = res.runtime || {};
      const lines = [
        'Tab Google Flow: ' + (rt.flowTabReady ? 'ĐÃ MỞ & SẴN SÀNG' : 'Chưa mở (bấm Mở Google Flow)'),
        'Tác vụ Flow đang chờ: ' + (rt.pendingJobsCount ?? 0),
        rt.activeJob ? 'Đang xử lý: ' + rt.activeJob.taskCode + ' (' + rt.activeJob.kind + ')' : '',
        rt.lastStatusText ? 'Trạng thái: ' + rt.lastStatusText : '',
      ].filter(Boolean);
      box.textContent = lines.join(' · ');
    } else {
      badge.textContent = 'Ngoại tuyến';
      badge.className = 'badge off';
      box.textContent = (res?.runtime?.lastError) || 'Không kết nối được App. Kiểm tra App URL & Token.';
    }
  });
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const appUrl = document.getElementById('appUrl').value.trim().replace(/\/+$/, '');
  const token = document.getElementById('token').value.trim();
  const autoRun = document.getElementById('autoRun').checked;
  await chrome.storage.local.set({ [STORAGE_KEY]: { appUrl, token, autoRun } });
  chrome.runtime.sendMessage({ type: 'POPUP_POLL_NOW' }, () => refreshStatus());
});

document.getElementById('openFlowBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
});

loadPopup();
