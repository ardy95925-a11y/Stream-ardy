// =====================================================
//  PULSE — media.js  v1
//  Drop-in media script — NO API KEY NEEDED
//
//  FEATURES:
//    1.  Paste anything (Ctrl+V / iPad keyboard GIFs) → sends instantly
//    2.  Drag & drop images/videos/GIFs onto the chat
//    3.  Video messages (mp4, webm, mov) with inline player
//    4.  GIF support — keyboard GIFs, clipboard GIFs, file GIFs
//    5.  Video recording via camera (hold button)
//    6.  File attachment menu — image, video, GIF, any file
//    7.  Media preview before sending (confirm/cancel)
//    8.  Progress bar for large uploads
//    9.  Thumbnail strip for multi-file send
//    10. Auto-play GIFs, pause on tap on mobile
// =====================================================

(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────
  const $ = id => document.getElementById(id);

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function isImageFile(file) {
    return file.type.startsWith('image/');
  }

  function isVideoFile(file) {
    return file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name || '');
  }

  function isGifFile(file) {
    return file.type === 'image/gif';
  }

  function fmtFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── Inject styles ─────────────────────────────────
  function injectStyles() {
    if ($('pulse-media-styles')) return;
    const style = document.createElement('style');
    style.id = 'pulse-media-styles';
    style.textContent = `

/* ── Media preview modal ── */
.media-preview-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(12px);
  z-index: 8000;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.15s ease;
}
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
.media-preview-box {
  background: var(--bg-raised, #18181f);
  border: 1px solid var(--border, rgba(255,255,255,0.07));
  border-radius: 20px;
  padding: 20px;
  max-width: min(480px, 92vw);
  width: 100%;
  box-shadow: 0 24px 80px rgba(0,0,0,0.7);
  display: flex; flex-direction: column; gap: 14px;
}
.media-preview-title {
  font-family: 'Syne', sans-serif;
  font-size: 15px; font-weight: 700;
  color: var(--text-primary, #f0ede8);
}
.media-preview-content {
  border-radius: 12px; overflow: hidden;
  background: #000;
  max-height: 55vh;
  display: flex; align-items: center; justify-content: center;
}
.media-preview-content img,
.media-preview-content video {
  max-width: 100%; max-height: 55vh;
  object-fit: contain; display: block;
}
.media-preview-meta {
  font-size: 12px;
  color: var(--text-muted, #55545e);
}
.media-preview-caption {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-glass, rgba(255,255,255,0.04));
  border: 1px solid var(--border, rgba(255,255,255,0.07));
  border-radius: 10px;
  color: var(--text-primary, #f0ede8);
  font-family: 'DM Sans', sans-serif;
  font-size: 14px; outline: none;
  transition: border-color 0.2s;
}
.media-preview-caption:focus { border-color: var(--accent, #ff6b35); }
.media-preview-caption::placeholder { color: var(--text-muted, #55545e); }
.media-preview-actions {
  display: flex; gap: 8px;
}
.media-preview-actions button {
  flex: 1; padding: 11px;
  border: none; border-radius: 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.2s;
}
.media-send-btn {
  background: var(--accent, #ff6b35);
  color: #fff;
  box-shadow: 0 4px 20px rgba(255,107,53,0.4);
}
.media-send-btn:hover { background: #ff7d4d; }
.media-cancel-btn {
  background: var(--bg-glass-md, rgba(255,255,255,0.07));
  color: var(--text-secondary, #9997a0);
  border: 1px solid var(--border, rgba(255,255,255,0.07)) !important;
}
.media-cancel-btn:hover { background: var(--bg-overlay, #22222d); }

/* ── Upload progress bar ── */
.media-progress-wrap {
  position: absolute; bottom: 100%; left: 0; right: 0;
  padding: 6px 12px;
  background: var(--bg-raised, #18181f);
  border-top: 1px solid var(--border, rgba(255,255,255,0.07));
}
.media-progress-bar {
  height: 3px;
  background: var(--bg-overlay, #22222d);
  border-radius: 3px; overflow: hidden;
}
.media-progress-fill {
  height: 100%;
  background: var(--accent, #ff6b35);
  border-radius: 3px;
  transition: width 0.15s ease;
}
.media-progress-label {
  font-size: 11px;
  color: var(--text-muted, #55545e);
  margin-top: 4px;
}

/* ── Drop overlay ── */
.drop-overlay {
  position: absolute; inset: 0;
  background: rgba(255,107,53,0.08);
  border: 2px dashed var(--accent, #ff6b35);
  border-radius: 12px;
  z-index: 50;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.drop-overlay.active { opacity: 1; }
.drop-overlay-text {
  font-family: 'Syne', sans-serif;
  font-size: 18px; font-weight: 700;
  color: var(--accent, #ff6b35);
  text-align: center;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
}

/* ── Attach menu ── */
.attach-menu {
  position: absolute;
  bottom: calc(100% + 8px); left: 0;
  background: var(--bg-raised, #18181f);
  border: 1px solid var(--border, rgba(255,255,255,0.07));
  border-radius: 16px;
  padding: 8px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; gap: 2px;
  z-index: 200; min-width: 180px;
  animation: slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
.attach-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: none; background: none;
  border-radius: 10px;
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  color: var(--text-primary, #f0ede8);
  cursor: pointer; text-align: left;
  transition: background 0.15s;
  width: 100%;
}
.attach-menu-item:hover { background: var(--bg-glass-md, rgba(255,255,255,0.07)); }
.attach-menu-item .attach-icon {
  width: 34px; height: 34px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}

/* ── Video message bubble ── */
.msg-video-wrap {
  max-width: 300px;
  border-radius: 16px; overflow: hidden;
  cursor: pointer; position: relative;
  background: #000;
}
.msg-video-wrap video {
  display: block; width: 100%;
  max-height: 280px; object-fit: cover;
  border-radius: 16px;
}
.msg-video-play {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3);
  transition: opacity 0.2s;
  border-radius: 16px;
}
.msg-video-play svg {
  width: 48px; height: 48px;
  color: #fff; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
}
.msg-video-wrap:hover .msg-video-play { opacity: 0 }
.msg-video-wrap video:not([paused]) + .msg-video-play { opacity: 0; }

/* ── Paste hint toast ── */
.paste-hint {
  position: absolute; bottom: calc(100% + 8px); left: 50%;
  transform: translateX(-50%);
  background: var(--bg-raised, #18181f);
  border: 1px solid var(--accent, #ff6b35);
  border-radius: 999px;
  padding: 6px 16px;
  font-size: 12px;
  color: var(--accent, #ff6b35);
  white-space: nowrap;
  pointer-events: none;
  animation: pasteHintIn 0.3s ease;
  z-index: 300;
}
@keyframes pasteHintIn { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

/* ── Multi-file strip ── */
.multi-file-strip {
  display: flex; gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--border, rgba(255,255,255,0.07));
  background: var(--bg-surface, #111118);
  overflow-x: auto;
  scrollbar-width: none;
}
.multi-file-strip::-webkit-scrollbar { display: none; }
.multi-file-thumb {
  position: relative; flex-shrink: 0;
  width: 56px; height: 56px;
  border-radius: 10px; overflow: hidden;
  border: 2px solid var(--border, rgba(255,255,255,0.07));
  cursor: pointer; transition: border-color 0.2s;
}
.multi-file-thumb:hover { border-color: var(--accent, #ff6b35); }
.multi-file-thumb img, .multi-file-thumb video {
  width: 100%; height: 100%; object-fit: cover;
}
.multi-file-thumb .remove-thumb {
  position: absolute; top: 2px; right: 2px;
  width: 18px; height: 18px;
  background: rgba(0,0,0,0.7);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff;
  cursor: pointer; line-height: 1;
}
.multi-file-send-btn {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  width: 56px; height: 56px;
  border-radius: 10px;
  background: var(--accent, #ff6b35);
  border: none; cursor: pointer;
  font-size: 22px;
  transition: transform 0.2s;
  box-shadow: 0 4px 16px rgba(255,107,53,0.4);
}
.multi-file-send-btn:hover { transform: scale(1.08); }

    `;
    document.head.appendChild(style);
  }

  // ── State ─────────────────────────────────────────
  let pendingFiles = []; // multi-file queue
  let dropOverlay  = null;

  // ── Get the sendMessage function from app.js ──────
  // app.js exposes window.__pulseSendMessage after initApp() runs
  function getSendFn() {
    return window.__pulseSendMessage || null;
  }

  // ── Show media preview before sending ─────────────
  function showMediaPreview(file, dataURL, type) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'media-preview-backdrop';

      const isVideo = type === 'video';
      const isGif   = file.type === 'image/gif';

      backdrop.innerHTML = `
        <div class="media-preview-box">
          <div class="media-preview-title">${isVideo ? '📹 Send Video' : isGif ? '🎞 Send GIF' : '📷 Send Image'}</div>
          <div class="media-preview-content">
            ${isVideo
              ? `<video src="${dataURL}" controls playsinline style="max-width:100%;max-height:55vh;border-radius:12px"></video>`
              : `<img src="${dataURL}" style="max-width:100%;max-height:55vh;border-radius:12px" />`
            }
          </div>
          <div class="media-preview-meta">${file.name || 'Media'} · ${fmtFileSize(file.size)}</div>
          <input class="media-preview-caption" placeholder="Add a caption… (optional)" maxlength="200">
          <div class="media-preview-actions">
            <button class="media-cancel-btn">Cancel</button>
            <button class="media-send-btn">Send ${isVideo ? '📹' : isGif ? '🎞' : '📷'}</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      // Focus caption
      setTimeout(() => backdrop.querySelector('.media-preview-caption')?.focus(), 100);

      backdrop.querySelector('.media-send-btn').addEventListener('click', () => {
        const caption = backdrop.querySelector('.media-preview-caption').value.trim();
        backdrop.remove();
        resolve({ confirmed: true, caption, dataURL, type });
      });

      backdrop.querySelector('.media-cancel-btn').addEventListener('click', () => {
        backdrop.remove();
        resolve({ confirmed: false });
      });

      // Press Enter on caption = send
      backdrop.querySelector('.media-preview-caption').addEventListener('keydown', e => {
        if (e.key === 'Enter') backdrop.querySelector('.media-send-btn').click();
        if (e.key === 'Escape') backdrop.querySelector('.media-cancel-btn').click();
      });

      // Click backdrop to cancel
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) backdrop.querySelector('.media-cancel-btn').click();
      });
    });
  }

  // ── Show progress bar ─────────────────────────────
  function showProgress(label) {
    const inputBar = $('chatInputBar');
    if (!inputBar) return null;

    const wrap = document.createElement('div');
    wrap.className = 'media-progress-wrap';
    wrap.innerHTML = `
      <div class="media-progress-bar"><div class="media-progress-fill" style="width:0%"></div></div>
      <div class="media-progress-label">${label}</div>
    `;
    inputBar.style.position = 'relative';
    inputBar.appendChild(wrap);

    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(p + Math.random() * 12, 90);
      const fill = wrap.querySelector('.media-progress-fill');
      if (fill) fill.style.width = p + '%';
    }, 80);

    return {
      done() {
        clearInterval(iv);
        const fill = wrap.querySelector('.media-progress-fill');
        if (fill) fill.style.width = '100%';
        setTimeout(() => wrap.remove(), 400);
      }
    };
  }

  // ── Process and send a media file ─────────────────
  async function processAndSend(file, skipPreview = false) {
    const sendFn = getSendFn();
    if (!sendFn) {
      showToast('Chat not ready — open a conversation first', 'error');
      return;
    }

    const isVideo = isVideoFile(file);
    const isImg   = isImageFile(file) || isGifFile(file);
    const type    = isVideo ? 'video' : isGifFile(file) ? 'gif' : 'image';

    if (!isVideo && !isImg) {
      showToast('Only images, GIFs, and videos supported', 'error');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      showToast('File too large (max 50MB)', 'error');
      return;
    }

    let dataURL;
    try {
      dataURL = await readFileAsDataURL(file);
    } catch(e) {
      showToast('Could not read file', 'error');
      return;
    }

    // Show preview (skip for quick-paste GIFs from keyboard)
    if (!skipPreview) {
      const result = await showMediaPreview(file, dataURL, type);
      if (!result.confirmed) return;
      dataURL = result.dataURL;
      const caption = result.caption;

      const prog = showProgress(`Sending ${type}…`);
      try {
        await sendFn({
          type,
          url: dataURL,
          text: caption || (type === 'video' ? '📹 Video' : type === 'gif' ? '🎞 GIF' : '📷 Photo'),
        });
        prog.done();
        showToast(`${type === 'video' ? 'Video' : type === 'gif' ? 'GIF' : 'Image'} sent!`, 'success');
      } catch(e) {
        prog.done();
        showToast('Send failed: ' + e.message, 'error');
      }
    } else {
      // Direct send (keyboard GIF, quick paste)
      const prog = showProgress(`Sending ${type}…`);
      try {
        await sendFn({
          type,
          url: dataURL,
          text: type === 'video' ? '📹 Video' : type === 'gif' ? '🎞 GIF' : '📷 Photo',
        });
        prog.done();
      } catch(e) {
        prog.done();
        showToast('Send failed: ' + e.message, 'error');
      }
    }
  }

  // ── 1. Clipboard paste (Ctrl+V, iPad keyboard GIFs) ─
  function setupPaste() {
    document.addEventListener('paste', async (e) => {
      const chatView = $('chatView');
      if (!chatView || chatView.classList.contains('hidden')) return;

      const items = Array.from(e.clipboardData?.items || []);
      const mediaItems = items.filter(i => i.type.startsWith('image/') || i.type.startsWith('video/'));

      if (!mediaItems.length) return;

      e.preventDefault();

      for (const item of mediaItems) {
        const file = item.getAsFile();
        if (!file) continue;

        // iPad keyboard GIFs come as image/gif — send without preview dialog for speed
        const quickSend = isGifFile(file) && file.size < 3 * 1024 * 1024;
        await processAndSend(file, quickSend);
      }
    });
  }

  // ── 2. Drag & drop onto chat area ─────────────────
  function setupDragAndDrop() {
    const chatView = $('chatView') || document.querySelector('.main');
    if (!chatView) return;

    // Create drop overlay
    dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    dropOverlay.innerHTML = `<div class="drop-overlay-text">Drop to send 📎</div>`;
    chatView.style.position = 'relative';
    chatView.appendChild(dropOverlay);

    let dragCounter = 0;

    chatView.addEventListener('dragenter', e => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer.types.includes('Files')) {
        dropOverlay.classList.add('active');
      }
    });

    chatView.addEventListener('dragleave', e => {
      dragCounter--;
      if (dragCounter === 0) dropOverlay.classList.remove('active');
    });

    chatView.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    chatView.addEventListener('drop', async e => {
      e.preventDefault();
      dragCounter = 0;
      dropOverlay.classList.remove('active');

      const files = Array.from(e.dataTransfer.files).filter(f => isImageFile(f) || isVideoFile(f));
      if (!files.length) return;

      if (files.length === 1) {
        await processAndSend(files[0], false);
      } else {
        showMultiFileStrip(files);
      }
    });
  }

  // ── 9. Multi-file strip ───────────────────────────
  function showMultiFileStrip(files) {
    const existing = document.querySelector('.multi-file-strip');
    if (existing) existing.remove();

    const strip = document.createElement('div');
    strip.className = 'multi-file-strip';

    const items = [];

    const buildStrip = async () => {
      strip.innerHTML = '';
      for (let i = 0; i < items.length; i++) {
        const { file, dataURL, type } = items[i];
        const thumb = document.createElement('div');
        thumb.className = 'multi-file-thumb';
        if (type === 'video') {
          thumb.innerHTML = `<video src="${dataURL}" muted></video>`;
        } else {
          thumb.innerHTML = `<img src="${dataURL}">`;
        }
        const rm = document.createElement('div');
        rm.className = 'remove-thumb';
        rm.textContent = '✕';
        rm.addEventListener('click', e => {
          e.stopPropagation();
          items.splice(i, 1);
          buildStrip();
          if (items.length === 0) strip.remove();
        });
        thumb.appendChild(rm);
        strip.appendChild(thumb);
      }

      const sendAll = document.createElement('button');
      sendAll.className = 'multi-file-send-btn';
      sendAll.textContent = '↑';
      sendAll.title = `Send ${items.length} files`;
      sendAll.addEventListener('click', async () => {
        strip.remove();
        for (const { file, dataURL, type } of items) {
          await processAndSend(file, true);
        }
      });
      strip.appendChild(sendAll);
    };

    (async () => {
      for (const file of files) {
        const dataURL = await readFileAsDataURL(file);
        const type = isVideoFile(file) ? 'video' : isGifFile(file) ? 'gif' : 'image';
        items.push({ file, dataURL, type });
      }
      await buildStrip();

      const inputBar = $('chatInputBar');
      if (inputBar) inputBar.before(strip);
    })();
  }

  // ── 3 & 4. Attach button menu ─────────────────────
  function setupAttachMenu() {
    const attachBtn = $('attachBtn');
    if (!attachBtn) return;

    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      // Remove existing
      document.querySelector('.attach-menu')?.remove();

      const menu = document.createElement('div');
      menu.className = 'attach-menu';
      menu.innerHTML = `
        <button class="attach-menu-item" data-action="image">
          <div class="attach-icon" style="background:rgba(255,107,53,0.15)">📷</div>
          <span>Photo / Image</span>
        </button>
        <button class="attach-menu-item" data-action="gif">
          <div class="attach-icon" style="background:rgba(199,125,255,0.15)">🎞</div>
          <span>GIF</span>
        </button>
        <button class="attach-menu-item" data-action="video">
          <div class="attach-icon" style="background:rgba(0,180,216,0.15)">📹</div>
          <span>Video</span>
        </button>
        <button class="attach-menu-item" data-action="camera">
          <div class="attach-icon" style="background:rgba(46,213,115,0.15)">🎥</div>
          <span>Record Video</span>
        </button>
      `;

      // Hidden file inputs
      const imgInput   = Object.assign(document.createElement('input'), { type:'file', accept:'image/*', style:'display:none', id:'_pulseImgInput' });
      const gifInput   = Object.assign(document.createElement('input'), { type:'file', accept:'image/gif', style:'display:none', id:'_pulseGifInput' });
      const videoInput = Object.assign(document.createElement('input'), { type:'file', accept:'video/*', style:'display:none', id:'_pulseVideoInput' });
      const camInput   = Object.assign(document.createElement('input'), { type:'file', accept:'video/*', capture:'environment', style:'display:none', id:'_pulseCamInput' });

      [imgInput, gifInput, videoInput, camInput].forEach(inp => {
        document.body.appendChild(inp);
        inp.addEventListener('change', async ev => {
          const file = ev.target.files[0];
          ev.target.value = '';
          document.body.removeChild(inp);
          if (file) await processAndSend(file, false);
        });
      });

      menu.querySelector('[data-action="image"]').addEventListener('click', () => { menu.remove(); imgInput.click(); });
      menu.querySelector('[data-action="gif"]').addEventListener('click', () => { menu.remove(); gifInput.click(); });
      menu.querySelector('[data-action="video"]').addEventListener('click', () => { menu.remove(); videoInput.click(); });
      menu.querySelector('[data-action="camera"]').addEventListener('click', () => { menu.remove(); camInput.click(); });

      const inputBar = $('chatInputBar');
      if (inputBar) {
        inputBar.style.position = 'relative';
        inputBar.appendChild(menu);
      }

      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
    });
  }

  // ── Patch renderMessages to display video bubbles ─
  // We inject a MutationObserver so videos get proper players
  function setupVideoMessageRenderer() {
    const area = $('messagesArea');
    if (!area) return;

    const observer = new MutationObserver(() => {
      // Find any video URL messages that haven't been upgraded yet
      area.querySelectorAll('.msg-video-wrap:not([data-ready])').forEach(wrap => {
        wrap.setAttribute('data-ready', '1');
        const video = wrap.querySelector('video');
        if (!video) return;

        // Toggle play/pause on tap
        video.addEventListener('click', () => {
          if (video.paused) {
            // Pause all other videos first
            area.querySelectorAll('video').forEach(v => { if (v !== video) v.pause(); });
            video.play();
          } else {
            video.pause();
          }
        });

        // Show/hide play button overlay based on state
        const playBtn = wrap.querySelector('.msg-video-play');
        if (playBtn) {
          video.addEventListener('play', () => playBtn.style.opacity = '0');
          video.addEventListener('pause', () => playBtn.style.opacity = '1');
          video.addEventListener('ended', () => playBtn.style.opacity = '1');
        }
      });

      // Auto-play GIFs (loop silently)
      area.querySelectorAll('.msg-media[src*=".gif"]:not([data-gif-ready])').forEach(img => {
        img.setAttribute('data-gif-ready', '1');
        img.style.cursor = 'pointer';
        // On mobile: tap to toggle animation via src swap trick (just reload)
        img.addEventListener('click', () => openLightboxLocal(img.src));
      });
    });

    observer.observe(area, { childList: true, subtree: true });
  }

  function openLightboxLocal(src) {
    const lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    const isVideo = /\.(mp4|webm|mov)/i.test(src) || src.startsWith('data:video');
    if (isVideo) {
      const v = document.createElement('video');
      v.src = src; v.controls = true; v.autoplay = true;
      v.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:12px';
      lb.appendChild(v);
    } else {
      const img = document.createElement('img'); img.src = src;
      img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,0.9)';
      lb.appendChild(img);
    }
    lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
  }

  // ── Patch sendMessage to handle video type rendering ──
  // We extend the existing renderMessages in app.js via a global hook
  function setupVideoRendering() {
    // Expose a hook that app.js's renderMessages can call
    window.__pulseRenderExtra = function(msg, row) {
      if (msg.type === 'video') {
        row.innerHTML = ''; // clear any existing content
        const wrap = document.createElement('div');
        wrap.className = 'msg-video-wrap';
        const video = document.createElement('video');
        video.src = msg.url || msg.text || '';
        video.preload = 'metadata';
        video.playsInline = true;
        video.muted = false;
        video.style.cssText = 'max-width:280px;border-radius:16px;display:block';
        const playOverlay = document.createElement('div');
        playOverlay.className = 'msg-video-play';
        playOverlay.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        wrap.appendChild(video); wrap.appendChild(playOverlay);
        row.appendChild(wrap);
        return true;
      }
      return false;
    };
  }

  // ── Show paste hint on input focus (first time) ───
  function setupPasteHint() {
    const inp = $('msgInput');
    if (!inp) return;
    let shown = false;
    inp.addEventListener('focus', () => {
      if (shown || localStorage.getItem('pulse-paste-hint-shown')) return;
      shown = true;
      localStorage.setItem('pulse-paste-hint-shown', '1');
      const hint = document.createElement('div');
      hint.className = 'paste-hint';
      hint.textContent = '💡 Paste or drag images, GIFs & videos to send';
      const inputBar = $('chatInputBar');
      if (inputBar) {
        inputBar.style.position = 'relative';
        inputBar.appendChild(hint);
        setTimeout(() => hint.remove(), 4000);
      }
    });
  }

  // ── Toast helper (local, doesn't need app.js toast) ─
  function showToast(msg, type = '') {
    // Use app.js toast if available
    const container = $('toast-container');
    if (container) {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.textContent = msg;
      container.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }
  }

  // ── Bridge: expose sendMessage hook for this script ─
  // app.js exposes window.__pulseSendMessage — we set it up here as a fallback
  // that waits for app.js to register the real one
  function waitForSendBridge() {
    // Bridge is set by app.js initApp() — nothing to poll
  }

  function injectSendBridgePatch() {
    // app.js sets window.__pulseSendMessage in initApp().
    // This is just a safety stub that shows a clear error if called before auth.
    if (window.__pulseSendMessagePatched) return;
    window.__pulseSendMessagePatched = true;
    if (typeof window.__pulseSendMessage === 'undefined') {
      window.__pulseSendMessage = function() {
        throw new Error('Open a chat first to send media');
      };
    }
  }

  // ── INIT ──────────────────────────────────────────
  function init() {
    injectStyles();
    setupPaste();
    setupDragAndDrop();
    setupAttachMenu();
    setupVideoMessageRenderer();
    setupVideoRendering();
    setupPasteHint();
    injectSendBridgePatch();
    waitForSendBridge();

    // Re-run setup when chat opens (chatView becomes visible)
    const chatViewObserver = new MutationObserver(() => {
      const chatView = $('chatView');
      if (chatView && !chatView.classList.contains('hidden')) {
        setupVideoMessageRenderer();
      }
    });
    const chatView = $('chatView');
    if (chatView) chatViewObserver.observe(chatView, { attributes: true, attributeFilter: ['class'] });

    console.log('[media.js] Pulse media enhancements loaded ✓');
    console.log('[media.js] Paste any image/GIF/video to send it instantly');
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
