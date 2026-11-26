(() => {
  if (window.__FLOW_AUTO_BRIDGE_LOADED__) return;
  window.__FLOW_AUTO_BRIDGE_LOADED__ = true;

  let hudEl = null;
  let hudStatusEl = null;
  let hudSubEl = null;
  let hudCaptureBtn = null;
  let activeJobRef = null;
  let manualResolveFn = null;

  function ensureHud() {
    if (hudEl && document.body.contains(hudEl)) return;
    hudEl = document.createElement('div');
    hudEl.id = 'n3on-flow-bridge-hud';
    hudEl.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'width:300px',
      'padding:12px 14px',
      'border-radius:14px',
      'background:rgba(10,14,28,0.94)',
      'color:#e2e8f0',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:12px',
      'border:1px solid rgba(34,211,238,0.45)',
      'box-shadow:0 12px 32px rgba(0,0,0,0.45)',
      'backdrop-filter:blur(8px)',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-weight:700;color:#22d3ee;margin-bottom:6px;';
    title.textContent = 'Flow Auto-Bridge · Đã kết nối';

    hudStatusEl = document.createElement('div');
    hudStatusEl.style.cssText = 'font-weight:600;color:#f8fafc;line-height:1.35;';
    hudStatusEl.textContent = 'Đang trực chờ lệnh từ Trung Tâm Điều Phối AI...';

    hudSubEl = document.createElement('div');
    hudSubEl.style.cssText = 'margin-top:4px;font-size:11px;color:#94a3b8;line-height:1.35;';
    hudSubEl.textContent = 'Giữ tab Google Flow này mở để tự động tạo ảnh & video.';

    hudCaptureBtn = document.createElement('button');
    hudCaptureBtn.type = 'button';
    hudCaptureBtn.textContent = 'Gửi ảnh/video mới nhất về App';
    hudCaptureBtn.style.cssText = [
      'display:none',
      'margin-top:8px',
      'width:100%',
      'padding:7px 10px',
      'border-radius:8px',
      'border:none',
      'background:#0891b2',
      'color:#fff',
      'font-weight:700',
      'font-size:11px',
      'cursor:pointer',
    ].join(';');
    hudCaptureBtn.addEventListener('click', async () => {
      if (!activeJobRef) return;
      setHud('Đang lấy tệp mới nhất trên trang...', 'Vui lòng chờ 2 giây');
      const captured = await captureLatestMedia(activeJobRef.kind, new Set());
      if (captured && manualResolveFn) {
        manualResolveFn(captured);
      } else {
        setHud('Chưa thấy ảnh/video mới trên trang Flow.', 'Hãy đợi Flow tạo xong rồi bấm lại.');
      }
    });

    hudEl.appendChild(title);
    hudEl.appendChild(hudStatusEl);
    hudEl.appendChild(hudSubEl);
    hudEl.appendChild(hudCaptureBtn);
    document.body.appendChild(hudEl);
  }

  function setHud(mainText, subText, showManualBtn) {
    ensureHud();
    if (hudStatusEl) hudStatusEl.textContent = mainText;
    if (hudSubEl && subText !== undefined) hudSubEl.textContent = subText;
    if (hudCaptureBtn && showManualBtn !== undefined) {
      hudCaptureBtn.style.display = showManualBtn ? 'block' : 'none';
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function snapshotExistingMedia() {
    const urls = new Set();
    document.querySelectorAll('video, video source').forEach((el) => {
      const s = el.currentSrc || el.getAttribute('src') || '';
      if (s) urls.add(s);
    });
    document.querySelectorAll('img').forEach((img) => {
      const s = img.currentSrc || img.src || '';
      if (s) urls.add(s);
    });
    return urls;
  }

  async function blobUrlToDataUrl(url, fallbackMime) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (blob.size < 2048) throw new Error('Tệp quá nhỏ (' + blob.size + ' bytes)');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ dataUrl: reader.result, mimeType: blob.type || fallbackMime });
      reader.onerror = () => reject(new Error('Không đọc được Blob media'));
      reader.readAsDataURL(blob);
    });
  }

  async function captureLatestMedia(kind, baselineUrls) {
    if (kind === 'video') {
      const videos = Array.from(document.querySelectorAll('video')).reverse();
      for (const v of videos) {
        const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
        if (!src || baselineUrls.has(src)) continue;
        if (src.startsWith('blob:') || src.startsWith('https://') || src.startsWith('http://')) {
          try {
            const payload = await blobUrlToDataUrl(src, 'video/mp4');
            return { ok: true, ...payload, mediaUrl: src };
          } catch {
            if (src.startsWith('https://')) {
              return { ok: true, mediaUrl: src, mimeType: 'video/mp4' };
            }
          }
        }
      }
      return null;
    }

    // Image mode: look for newly generated large image (ignore tiny icons/avatars/dataURLs uploaded by us)
    const imgs = Array.from(document.querySelectorAll('img')).reverse();
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || baselineUrls.has(src)) continue;
      if (!img.complete || img.naturalWidth < 320 || img.naturalHeight < 320) continue;
      if (src.includes('googleusercontent.com/a/')) continue; // skip Google avatar
      try {
        const payload = await blobUrlToDataUrl(src, 'image/png');
        return { ok: true, ...payload, mediaUrl: src };
      } catch {
        // Canvas fallback if CORS allows
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          return { ok: true, dataUrl, mimeType: 'image/png' };
        } catch {
          if (src.startsWith('https://')) {
            return { ok: true, mediaUrl: src, mimeType: 'image/png' };
          }
        }
      }
    }
    return null;
  }

  function findPromptInput() {
    const candidates = [
      ...Array.from(document.querySelectorAll('textarea')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
      ...Array.from(document.querySelectorAll('[role="textbox"]')),
    ].filter((el) => isVisible(el) && !el.closest('#n3on-flow-bridge-hud'));

    if (candidates.length === 0) return null;
    // Prefer largest/primary prompt box (usually bottom composer or main textarea)
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0];
  }

  async function fillPrompt(el, text) {
    el.focus();
    await sleep(150);
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    await sleep(250);
  }

  async function trySwitchFlowMode(kind) {
    const keywords =
      kind === 'image'
        ? ['image', 'tạo ảnh', 'create image', 'text to image', 'imagen']
        : ['frames to video', 'ingredients to video', 'text to video', 'video', 'tạo video'];
    const buttons = Array.from(document.querySelectorAll('button, [role="tab"], [role="option"]')).filter(
      (b) => isVisible(b) && !b.closest('#n3on-flow-bridge-hud')
    );
    for (const kw of keywords) {
      const hit = buttons.find((b) => (b.textContent || b.getAttribute('aria-label') || '').toLowerCase().includes(kw));
      if (hit && hit.getAttribute('aria-selected') !== 'true') {
        hit.click();
        await sleep(500);
        return true;
      }
    }
    return false;
  }

  async function tryAttachReferenceImages(refs) {
    if (!Array.isArray(refs) || refs.length === 0) return 0;
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
      (inp) => !inp.disabled && !inp.closest('#n3on-flow-bridge-hud')
    );
    if (fileInputs.length === 0) return 0;

    const dt = new DataTransfer();
    for (const ref of refs.slice(0, 3)) {
      try {
        const res = await fetch(ref.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], ref.name || 'reference.png', { type: ref.mimeType || blob.type || 'image/png' });
        dt.items.add(file);
      } catch {
        // skip invalid ref
      }
    }
    if (dt.files.length === 0) return 0;

    const targetInput = fileInputs[0];
    targetInput.files = dt.files;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1800);
    return dt.files.length;
  }

  function findSubmitButton(promptEl) {
    const allButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => isVisible(b) && !b.disabled && !b.closest('#n3on-flow-bridge-hud')
    );
    const labelPatterns = [
      /generate/i,
      /create/i,
      /send/i,
      /submit/i,
      /arrow_forward/i,
      /tạo/i,
    ];
    for (const pat of labelPatterns) {
      const match = allButtons.find((b) => {
        const txt = (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
        return pat.test(txt);
      });
      if (match) return match;
    }
    // Fallback: closest button inside same form/composer container as promptEl
    const container = promptEl?.closest('form') || promptEl?.parentElement?.parentElement;
    if (container) {
      const localBtns = Array.from(container.querySelectorAll('button')).filter((b) => isVisible(b) && !b.disabled);
      if (localBtns.length > 0) return localBtns[localBtns.length - 1];
    }
    return null;
  }

  async function runFlowJobOnPage(job) {
    activeJobRef = job;
    setHud(
      'Đang chạy [' + job.taskCode + '] · ' + (job.kind === 'image' ? 'Tạo Ảnh Flow' : 'Tạo Video Veo'),
      'Phiên ' + job.sessionId + ' — Đang chuẩn bị khung nhập...',
      true
    );

    await trySwitchFlowMode(job.kind);

    const promptEl = findPromptInput();
    if (!promptEl) {
      return {
        ok: false,
        error: 'Không tìm thấy ô nhập prompt trên trang Google Flow. Hãy mở đúng màn hình tạo dự án trên labs.google/fx/tools/flow.',
      };
    }

    if (job.referenceImages && job.referenceImages.length > 0) {
      setHud(
        '[' + job.taskCode + '] Đang nạp ' + job.referenceImages.length + ' ảnh tham chiếu...',
        'Đang tải ảnh khóa nhân vật / keyframe lên Flow',
        true
      );
      await tryAttachReferenceImages(job.referenceImages);
    }

    // Snapshot AFTER uploading refs so uploaded thumbnails aren't mistaken for generated output
    const baselineUrls = snapshotExistingMedia();

    setHud('[' + job.taskCode + '] Đang điền prompt & bấm Generate...', job.prompt.slice(0, 90) + '...', true);
    await fillPrompt(promptEl, job.prompt);

    const submitBtn = findSubmitButton(promptEl);
    if (submitBtn) {
      submitBtn.click();
    } else {
      promptEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
      );
    }

    const maxWaitMs = job.kind === 'image' ? 180_000 : 360_000;
    const startedAt = Date.now();

    const waitPromise = new Promise((resolve) => {
      manualResolveFn = resolve;
      const timer = setInterval(async () => {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        setHud(
          '[' + job.taskCode + '] Đang chờ Google Flow render (' + elapsedSec + 's)...',
          'Tự động bắt ' + (job.kind === 'image' ? 'ảnh' : 'video MP4') + ' ngay khi xuất hiện (hoặc bấm nút dưới để gửi ngay).',
          true
        );

        const found = await captureLatestMedia(job.kind, baselineUrls);
        if (found && found.ok) {
          clearInterval(timer);
          manualResolveFn = null;
          resolve(found);
          return;
        }
        if (Date.now() - startedAt > maxWaitMs) {
          clearInterval(timer);
          manualResolveFn = null;
          resolve({
            ok: false,
            error: 'Quá thời gian chờ Google Flow render (' + Math.round(maxWaitMs / 1000) + 's).',
          });
        }
      }, 3000);
    });

    const outcome = await waitPromise;
    activeJobRef = null;
    if (outcome?.ok) {
      setHud('Đã hoàn tất [' + job.taskCode + ']!', 'Đang đẩy tệp về Trung Tâm Điều Phối AI...', false);
    } else {
      setHud('Tác vụ [' + job.taskCode + '] chưa hoàn tất', outcome?.error || '', false);
    }
    return outcome;
  }

  ensureHud();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'FLOW_RUN_JOB' && msg.job) {
      void runFlowJobOnPage(msg.job).then((res) => sendResponse(res));
      return true;
    }
  });
})();
