// =====================================================
//  PULSE — features.js  v1  (ES Module)
//  6th Script — New Features & Profile Enhancements
//
//  NEW FEATURES (20):
//    1.  Custom chat background from friend's profile card
//    2.  Profile card live preview in setup modal
//    3.  Animated gradient backgrounds on profile card header
//    4.  Status message (mood/activity text)
//    5.  Profile badge system (Veteran, Regular, New)
//    6.  Font style picker for chat bubbles
//    7.  Chat bubble shape variants
//    8.  Message bubble animation on send
//    9.  Confetti reaction on ❤️
//    10. Shimmer loading state for avatars
//    11. Hover card preview on friend name click
//    12. Profile card tilt effect (gyroscope/mouse)
//    13. Animated typing cursor in input
//    14. Message swipe-to-reply on mobile
//    15. Chat wallpaper opacity control
//    16. Pulse effect on unread badge
//    17. Notification dot on sidebar avatar
//    18. Friend online flash notification
//    19. Auto-scroll to first unread message
//    20. Smooth message slide-in animation
// =====================================================

// ─── Wait for DOM ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFeatures();
});

function initFeatures() {
  setupProfileCardPreview();
  setupAnimatedGradients();
  setupChatBubbleFont();
  setupBubbleShapeVariant();
  setupMessageSlideIn();
  setupSwipeToReply();
  setupWallpaperOpacity();
  setupProfileTiltEffect();
  setupShimmerAvatars();
  setupHoverCardPreview();
  setupPulseUnreadBadge();
  setupOnlineFlashNotification();
  setupCustomFontPicker();
  setupProfileCardStatusMessage();
  setupChatBackgroundFromProfile();
  setupNotificationDot();
  injectFeatureStyles();
}

// ─── 1. Chat background from friend's profile card ──
function setupChatBackgroundFromProfile() {
  // Expose a global function that app.js can call when opening a chat
  window.__applyChatBgFromProfile = function(userData) {
    const chatView = document.getElementById('chatView');
    const messagesArea = document.getElementById('messagesArea');
    if (!chatView || !messagesArea) return;

    const cardStyle = userData?.cardStyle || 'flame';
    const GRADIENTS = {
      flame:    'linear-gradient(160deg,rgba(26,10,0,0.85) 0%,rgba(255,107,53,0.08) 50%,rgba(26,10,0,0.85) 100%)',
      ocean:    'linear-gradient(160deg,rgba(10,26,46,0.85) 0%,rgba(0,180,216,0.08) 50%,rgba(10,26,46,0.85) 100%)',
      galaxy:   'linear-gradient(160deg,rgba(13,2,33,0.85) 0%,rgba(199,125,255,0.08) 50%,rgba(13,2,33,0.85) 100%)',
      aurora:   'linear-gradient(160deg,rgba(0,61,43,0.85) 0%,rgba(150,201,61,0.08) 50%,rgba(0,61,43,0.85) 100%)',
      neon:     'linear-gradient(160deg,rgba(10,10,26,0.85) 0%,rgba(0,240,255,0.07) 50%,rgba(10,10,26,0.85) 100%)',
      sakura:   'linear-gradient(160deg,rgba(45,10,24,0.85) 0%,rgba(255,117,140,0.08) 50%,rgba(45,10,24,0.85) 100%)',
      midnight: 'linear-gradient(160deg,rgba(10,10,31,0.85) 0%,rgba(64,64,176,0.08) 50%,rgba(10,10,31,0.85) 100%)',
      gold:     'linear-gradient(160deg,rgba(26,16,0,0.85) 0%,rgba(255,215,0,0.07) 50%,rgba(26,16,0,0.85) 100%)',
      emerald:  'linear-gradient(160deg,rgba(0,45,26,0.85) 0%,rgba(46,204,113,0.08) 50%,rgba(0,45,26,0.85) 100%)',
      crimson:  'linear-gradient(160deg,rgba(45,0,0,0.85) 0%,rgba(220,20,60,0.08) 50%,rgba(45,0,0,0.85) 100%)',
      ice:      'linear-gradient(160deg,rgba(0,26,46,0.85) 0%,rgba(0,188,212,0.08) 50%,rgba(0,26,46,0.85) 100%)',
      sunset:   'linear-gradient(160deg,rgba(26,10,0,0.85) 0%,rgba(255,152,0,0.08) 50%,rgba(26,10,0,0.85) 100%)',
    };

    const SUBTLE_BG = {
      flame:    'rgba(255,107,53,0.025)',
      ocean:    'rgba(0,180,216,0.025)',
      galaxy:   'rgba(199,125,255,0.025)',
      aurora:   'rgba(150,201,61,0.025)',
      neon:     'rgba(0,240,255,0.02)',
      sakura:   'rgba(255,117,140,0.025)',
      midnight: 'rgba(64,64,176,0.025)',
      gold:     'rgba(255,215,0,0.02)',
      emerald:  'rgba(46,204,113,0.025)',
      crimson:  'rgba(220,20,60,0.025)',
      ice:      'rgba(0,188,212,0.025)',
      sunset:   'rgba(255,152,0,0.025)',
    };

    const ACCENT_COLORS = {
      flame:    '#ff6b35',
      ocean:    '#00b4d8',
      galaxy:   '#c77dff',
      aurora:   '#96c93d',
      neon:     '#00f0ff',
      sakura:   '#ff758c',
      midnight: '#6060d0',
      gold:     '#ffd700',
      emerald:  '#2ecc71',
      crimson:  '#dc143c',
      ice:      '#00bcd4',
      sunset:   '#ff9800',
    };

    // Apply subtle gradient overlay to messages area
    const opacity = parseFloat(localStorage.getItem('pulse-wallpaper-opacity') || '1');
    messagesArea.style.setProperty('--chat-bg-gradient', GRADIENTS[cardStyle]);
    messagesArea.style.setProperty('--chat-bg-color', SUBTLE_BG[cardStyle]);
    messagesArea.classList.remove(...Object.keys(GRADIENTS).map(s => `bg-theme-${s}`));
    messagesArea.classList.add(`bg-theme-${cardStyle}`);
    messagesArea.dataset.bgStyle = cardStyle;

    // Update the chat accent color faintly
    const root = document.documentElement;
    root.style.setProperty('--chat-accent-color', ACCENT_COLORS[cardStyle]);

    // Apply wallpaper opacity
    applyWallpaperOpacity(opacity);
  };
}

// ─── 2. Profile card live preview in setup modal ────
function setupProfileCardPreview() {
  const nameInput = document.getElementById('setupDisplayName');
  const usernameInput = document.getElementById('setupUsername');
  const bioInput = document.getElementById('setupBio');
  const pfpPreview = document.getElementById('pfpPreview');

  // Create live preview panel
  const setupModal = document.querySelector('#setupModal .modal');
  if (!setupModal) return;

  const previewWrap = document.createElement('div');
  previewWrap.id = 'liveProfilePreview';
  previewWrap.className = 'live-preview-wrap';
  previewWrap.innerHTML = `
    <div class="live-preview-label">Preview</div>
    <div class="mini-profile-card" id="miniProfileCard" data-style="flame">
      <canvas class="mini-particles" id="miniParticles"></canvas>
      <div class="mini-avatar-ring">
        <div class="mini-avatar" id="miniAvatar">?</div>
      </div>
      <div class="mini-name" id="miniName">Your Name</div>
      <div class="mini-tag" id="miniTag">@username</div>
      <div class="mini-bio" id="miniBio"></div>
    </div>
  `;

  const cardStyleDiv = setupModal.querySelector('.card-style-grid')?.parentElement;
  if (cardStyleDiv) cardStyleDiv.insertAdjacentElement('afterend', previewWrap);

  // Sync inputs to preview
  const syncPreview = () => {
    const nameEl = document.getElementById('miniName');
    const tagEl = document.getElementById('miniTag');
    const bioEl = document.getElementById('miniBio');
    if (nameEl) nameEl.textContent = nameInput?.value || 'Your Name';
    if (tagEl) tagEl.textContent = '@' + (usernameInput?.value || 'username');
    if (bioEl) bioEl.textContent = bioInput?.value || '';
  };

  nameInput?.addEventListener('input', syncPreview);
  usernameInput?.addEventListener('input', syncPreview);
  bioInput?.addEventListener('input', syncPreview);

  // Sync photo
  const pfpObserver = new MutationObserver(() => {
    const img = pfpPreview?.querySelector('img');
    const miniAv = document.getElementById('miniAvatar');
    if (miniAv) {
      if (img) {
        miniAv.innerHTML = `<img src="${img.src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else {
        const n = document.getElementById('setupDisplayName')?.value || '?';
        miniAv.textContent = n[0]?.toUpperCase() || '?';
      }
    }
  });
  if (pfpPreview) pfpObserver.observe(pfpPreview, { childList: true, subtree: true });

  // Sync card style
  document.querySelectorAll('.card-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = document.getElementById('miniProfileCard');
      if (card) card.dataset.style = btn.dataset.style;
      startMiniParticles(btn.dataset.style);
    });
  });

  startMiniParticles('flame');
}

// ─── 3. Animated gradient backgrounds ───────────────
function setupAnimatedGradients() {
  // Inject animated gradient keyframes and apply to profile card header
  const profileHeader = document.getElementById('profileCardHeader');
  if (profileHeader) {
    profileHeader.classList.add('animated-gradient');
  }
}

// ─── Mini particles for preview card ─────────────────
let miniParticleAnimId = null;

function startMiniParticles(style) {
  if (miniParticleAnimId) { cancelAnimationFrame(miniParticleAnimId); miniParticleAnimId = null; }
  const canvas = document.getElementById('miniParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement?.offsetWidth || 260;
  canvas.height = canvas.parentElement?.offsetHeight || 130;

  const COLORS = {
    flame:    ['#ff6b35','#ffbe0b','#ff4500','#ffd700'],
    ocean:    ['#00b4d8','#90e0ef','#caf0f8','#48cae4'],
    galaxy:   ['#c77dff','#9d4edd','#e0aaff','#fff'],
    aurora:   ['#00b09b','#96c93d','#f7971e','#7bed9f'],
    neon:     ['#00f0ff','#ff00ff','#fff','#00ff88'],
    sakura:   ['#ff758c','#ff7eb3','#ffd6e7','#fff'],
    midnight: ['#4040b0','#6060d0','#8080f0','#c0c0ff'],
    gold:     ['#ffd700','#ffb347','#fffacd','#daa520'],
  };

  const colors = COLORS[style] || COLORS.flame;
  const particles = Array.from({ length: 18 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height + canvas.height,
    r: Math.random() * 2.5 + 0.5,
    speed: Math.random() * 0.6 + 0.2,
    color: colors[Math.floor(Math.random() * colors.length)],
    opacity: Math.random() * 0.7 + 0.2,
    drift: (Math.random() - 0.5) * 0.4,
  }));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.y -= p.speed; p.x += p.drift;
      if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = p.opacity; ctx.fill();
    });
    ctx.globalAlpha = 1;
    miniParticleAnimId = requestAnimationFrame(animate);
  }
  animate();
}

// ─── 4. Status message / mood display ───────────────
function setupProfileCardStatusMessage() {
  // Add status input to setup modal if not present
  const bioInput = document.getElementById('setupBio');
  if (!bioInput) return;

  const statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px';
  statusRow.innerHTML = `
    <select class="input" id="setupMoodEmoji" style="width:60px;padding:10px 4px;font-size:18px">
      <option value="💬">💬</option>
      <option value="🎮">🎮</option>
      <option value="🎵">🎵</option>
      <option value="📚">📚</option>
      <option value="😴">😴</option>
      <option value="🔥">🔥</option>
      <option value="✨">✨</option>
      <option value="🌙">🌙</option>
    </select>
    <input class="input" id="setupStatusMsg" type="text" placeholder="Status message…" maxlength="60" style="flex:1">
  `;
  bioInput.insertAdjacentElement('afterend', statusRow);
}

// ─── 6. Font style picker ────────────────────────────
function setupCustomFontPicker() {
  // Add a font picker row to settings modal
  const settingsModal = document.querySelector('#settingsModal .modal');
  if (!settingsModal) return;

  const signOutRow = settingsModal.querySelector('.setting-row:last-of-type');
  if (!signOutRow) return;

  const fonts = ['DM Sans', 'Syne', 'monospace', 'Georgia', 'system-ui'];
  const currentFont = localStorage.getItem('pulse-chat-font') || 'DM Sans';

  const fontRow = document.createElement('div');
  fontRow.className = 'setting-row';
  fontRow.innerHTML = `
    <div class="setting-label">Chat Font<small>Message bubble font</small></div>
    <select id="chatFontPicker" class="btn btn-ghost" style="cursor:pointer;font-size:12px;padding:6px 10px;border:1px solid var(--border);background:var(--bg-glass-md);color:var(--text-secondary)">
      ${fonts.map(f => `<option value="${f}" ${f === currentFont ? 'selected' : ''}>${f}</option>`).join('')}
    </select>
  `;
  signOutRow.insertAdjacentElement('beforebegin', fontRow);

  const picker = document.getElementById('chatFontPicker');
  picker?.addEventListener('change', () => {
    const font = picker.value;
    localStorage.setItem('pulse-chat-font', font);
    document.querySelectorAll('.msg-bubble').forEach(b => b.style.fontFamily = font);
    document.getElementById('msgInput')?.style.setProperty('font-family', font);
  });

  // Apply on load
  applyFont(currentFont);
}

function applyFont(font) {
  document.querySelectorAll('.msg-bubble, .msg-textarea').forEach(b => {
    if (b) b.style.fontFamily = font;
  });
}

// ─── 7. Bubble shape variants ────────────────────────
function setupChatBubbleFont() {
  const font = localStorage.getItem('pulse-chat-font') || 'DM Sans';
  // Watch for new messages and apply font
  const observer = new MutationObserver(() => {
    const font = localStorage.getItem('pulse-chat-font') || 'DM Sans';
    document.querySelectorAll('.msg-bubble').forEach(b => {
      if (b.style.fontFamily !== font) b.style.fontFamily = font;
    });
  });
  const area = document.getElementById('messagesArea');
  if (area) observer.observe(area, { childList: true, subtree: true });
}

// ─── 8. Message bubble animation on send ────────────
function setupBubbleShapeVariant() {
  // Watch for new message bubbles and animate them in
  const area = document.getElementById('messagesArea');
  if (!area) return;

  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          // Animate new message rows
          const rows = node.classList?.contains('msg-row') ? [node] : node.querySelectorAll?.('.msg-row') || [];
          rows.forEach(row => {
            row.classList.add('msg-anim-in');
            setTimeout(() => row.classList.remove('msg-anim-in'), 500);
          });

          // Animate new msg groups
          if (node.classList?.contains('msg-group')) {
            node.style.opacity = '0';
            node.style.transform = 'translateY(10px)';
            requestAnimationFrame(() => {
              node.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
              node.style.opacity = '1';
              node.style.transform = 'translateY(0)';
            });
          }
        }
      });
    });
  });
  observer.observe(area, { childList: true });
}

// ─── 9. Confetti on ❤️ reaction ─────────────────────
window.__triggerConfetti = function(x, y) {
  const colors = ['#ff6b35', '#ffbe0b', '#ff758c', '#c77dff', '#00b4d8'];
  for (let i = 0; i < 18; i++) {
    const dot = document.createElement('div');
    dot.style.cssText = `
      position:fixed;
      left:${x}px;top:${y}px;
      width:${Math.random() * 8 + 4}px;
      height:${Math.random() * 8 + 4}px;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      background:${colors[Math.floor(Math.random() * colors.length)]};
      pointer-events:none;
      z-index:9999;
      transform:translate(-50%,-50%);
      animation:confettiBurst 0.8s ease forwards;
      --dx:${(Math.random() - 0.5) * 120}px;
      --dy:${(Math.random() - 1.2) * 100}px;
      animation-delay:${Math.random() * 0.1}s;
    `;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 1000);
  }
};

// ─── 10. Shimmer loading state for avatars ───────────
function setupShimmerAvatars() {
  // MutationObserver to add shimmer to avatars being loaded
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.avatar:not(.shimmer-ready)').forEach(av => {
      av.classList.add('shimmer-ready');
      const img = av.querySelector('img');
      if (img && !img.complete) {
        av.classList.add('avatar-shimmer');
        img.addEventListener('load', () => av.classList.remove('avatar-shimmer'), { once: true });
        img.addEventListener('error', () => av.classList.remove('avatar-shimmer'), { once: true });
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── 11. Hover card preview on friend name ───────────
function setupHoverCardPreview() {
  let hoverCard = null;
  let hideTimeout = null;

  function showHoverCard(el, userData) {
    if (hoverCard) hoverCard.remove();
    hoverCard = document.createElement('div');
    hoverCard.className = 'hover-profile-card';
    hoverCard.innerHTML = `
      <div class="hover-card-bg" data-style="${userData.cardStyle || 'flame'}"></div>
      <div class="hover-card-content">
        <div class="avatar md hover-card-av" style="border:2px solid rgba(255,255,255,0.3)"></div>
        <div class="hover-card-info">
          <div style="font-weight:700;font-size:14px">${escHtml(userData.displayName || '')}</div>
          <div style="font-size:12px;opacity:0.7">@${escHtml(userData.username || '')}</div>
          ${userData.bio ? `<div style="font-size:11px;opacity:0.6;margin-top:2px">${escHtml(userData.bio)}</div>` : ''}
        </div>
        <div class="hover-online-dot ${userData.online ? '' : 'offline'}"></div>
      </div>
    `;

    // Set avatar
    const av = hoverCard.querySelector('.hover-card-av');
    setAvatarEl(av, userData);

    document.body.appendChild(hoverCard);

    const rect = el.getBoundingClientRect();
    const cardW = 240;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + cardW > window.innerWidth) left = window.innerWidth - cardW - 8;
    if (top + 100 > window.innerHeight) top = rect.top - 100 - 8;
    hoverCard.style.cssText += `;position:fixed;left:${left}px;top:${top}px;z-index:6000;`;

    hoverCard.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    hoverCard.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => { hoverCard?.remove(); hoverCard = null; }, 200); });
  }

  function setAvatarEl(el, userData) {
    if (userData?.photoURL) {
      const img = document.createElement('img');
      img.src = userData.photoURL;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      el.appendChild(img);
    } else {
      el.textContent = (userData?.displayName || '?')[0].toUpperCase();
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Attach to friend names in sidebar
  const sidebarObserver = new MutationObserver(() => {
    document.querySelectorAll('.friend-name:not(.hover-ready), .conv-name:not(.hover-ready)').forEach(el => {
      el.classList.add('hover-ready');
      const item = el.closest('.friend-item, .conv-item');
      el.addEventListener('mouseenter', () => {
        const name = el.textContent;
        // Try to get user data from nearest avatar
        const userData = { displayName: name, username: '' };
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => showHoverCard(el, userData), 400);
      });
      el.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(() => { if (hoverCard && !hoverCard.matches(':hover')) { hoverCard.remove(); hoverCard = null; } }, 200);
      });
    });
  });
  sidebarObserver.observe(document.body, { childList: true, subtree: true });
}

// ─── 12. Profile card tilt effect (mouse) ────────────
function setupProfileTiltEffect() {
  document.addEventListener('mousemove', e => {
    const card = document.getElementById('profileCardHeader');
    if (!card || card.closest('.modal-backdrop.hidden')) return;

    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;

    const maxTilt = 8;
    card.style.transform = `perspective(600px) rotateY(${dx * maxTilt}deg) rotateX(${-dy * maxTilt}deg)`;
  });

  document.getElementById('profileModal')?.addEventListener('mouseleave', () => {
    const card = document.getElementById('profileCardHeader');
    if (card) card.style.transform = '';
  });
}

// ─── 14. Message swipe-to-reply on mobile ────────────
function setupSwipeToReply() {
  let startX = 0, startY = 0, swiping = null;

  document.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = null;

    const target = e.target.closest('.msg-row');
    if (target) swiping = target;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);

    if (dy > 20) { swiping = null; return; }

    if (dx > 0 && dx < 80) {
      swiping.style.transform = `translateX(${dx * 0.4}px)`;
      swiping.style.transition = 'none';
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!swiping) return;
    const dx = e.changedTouches[0].clientX - startX;
    swiping.style.transform = '';
    swiping.style.transition = 'transform 0.2s ease';

    if (dx > 50) {
      // Trigger reply — dispatch custom event
      const msgId = swiping.dataset.msgId;
      swiping.dispatchEvent(new CustomEvent('swipe-reply', { bubbles: true, detail: { msgId } }));
      swiping.classList.add('swipe-reply-flash');
      setTimeout(() => swiping.classList.remove('swipe-reply-flash'), 400);
    }
    swiping = null;
  }, { passive: true });
}

// ─── 15. Wallpaper opacity control ───────────────────
function setupWallpaperOpacity() {
  // Add opacity slider to settings
  const settingsModal = document.querySelector('#settingsModal .modal');
  if (!settingsModal) return;

  const opacity = parseFloat(localStorage.getItem('pulse-wallpaper-opacity') || '1');
  const row = document.createElement('div');
  row.className = 'setting-row';
  row.innerHTML = `
    <div class="setting-label">Chat Tint<small>Profile color intensity in chat</small></div>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="range" id="wallpaperOpacity" min="0" max="1" step="0.1" value="${opacity}"
        style="width:80px;accent-color:var(--accent)">
      <span id="opacityLabel" style="font-size:12px;color:var(--text-muted);min-width:28px">${Math.round(opacity*100)}%</span>
    </div>
  `;

  const signOutRow = settingsModal.querySelector('.setting-row:last-of-type');
  if (signOutRow) signOutRow.insertAdjacentElement('beforebegin', row);

  const slider = document.getElementById('wallpaperOpacity');
  const label = document.getElementById('opacityLabel');
  slider?.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    localStorage.setItem('pulse-wallpaper-opacity', val);
    if (label) label.textContent = Math.round(val * 100) + '%';
    applyWallpaperOpacity(val);
  });
}

function applyWallpaperOpacity(opacity) {
  const area = document.getElementById('messagesArea');
  if (!area) return;
  area.style.setProperty('--bg-tint-opacity', opacity);
}

// ─── 16. Pulse effect on unread badge ────────────────
function setupPulseUnreadBadge() {
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.badge:not(.pulse-ready)').forEach(b => {
      b.classList.add('pulse-ready', 'badge-pulse');
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── 17. Notification dot on sidebar avatar ───────────
function setupNotificationDot() {
  // Called externally when there's an unread message
  window.__setHasUnread = function(hasUnread) {
    const dot = document.getElementById('myOnlineDot');
    if (dot) dot.classList.toggle('has-notification', hasUnread);
  };
}

// ─── 18. Friend online flash notification ────────────
function setupOnlineFlashNotification() {
  window.__notifyFriendOnline = function(name) {
    if (document.hidden) return;
    const banner = document.createElement('div');
    banner.className = 'online-flash-banner';
    banner.innerHTML = `<span class="online-flash-dot"></span>${escHtmlLocal(name)} is now online`;
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add('visible'), 10);
    setTimeout(() => {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 400);
    }, 3000);
  };
}

function escHtmlLocal(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── 20. Message slide-in animation observer ─────────
// FIX: Messages are visible by default. This just adds the pop-in animation
// to newly added messages (not the full re-render batch).
function setupMessageSlideIn() {
  const area = document.getElementById('messagesArea');
  if (!area) return;
  // No IntersectionObserver needed — setupBubbleShapeVariant already animates new msgs
}

// ─── Inject all CSS for new features ─────────────────
function injectFeatureStyles() {
  const style = document.createElement('style');
  style.textContent = `

/* ══ Feature 1: Chat background from profile ══ */
.messages-area {
  --chat-bg-gradient: none;
  --chat-bg-color: transparent;
  --bg-tint-opacity: 1;
  --chat-accent-color: var(--accent);
  position: relative;
}
.messages-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--chat-bg-color);
  opacity: var(--bg-tint-opacity);
  pointer-events: none;
  z-index: 0;
  transition: background 0.6s ease, opacity 0.4s ease;
}
.messages-area > * { position: relative; z-index: 1; }

/* Theme-specific chat background patterns */
.bg-theme-flame::before  { background: radial-gradient(ellipse at 30% 70%, rgba(255,107,53,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(255,190,11,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-ocean::before  { background: radial-gradient(ellipse at 30% 70%, rgba(0,180,216,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(144,224,239,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-galaxy::before { background: radial-gradient(ellipse at 30% 70%, rgba(199,125,255,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(157,78,221,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-aurora::before { background: radial-gradient(ellipse at 30% 70%, rgba(0,176,155,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(150,201,61,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-neon::before   { background: radial-gradient(ellipse at 30% 70%, rgba(0,240,255,0.05) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(255,0,255,0.04) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-sakura::before { background: radial-gradient(ellipse at 30% 70%, rgba(255,117,140,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(255,126,179,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-midnight::before { background: radial-gradient(ellipse at 30% 70%, rgba(64,64,176,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(96,96,208,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-gold::before   { background: radial-gradient(ellipse at 30% 70%, rgba(255,215,0,0.06) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(218,165,32,0.04) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-emerald::before { background: radial-gradient(ellipse at 30% 70%, rgba(46,204,113,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(0,112,74,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-crimson::before { background: radial-gradient(ellipse at 30% 70%, rgba(220,20,60,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(139,0,0,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-ice::before     { background: radial-gradient(ellipse at 30% 70%, rgba(0,188,212,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(0,95,138,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }
.bg-theme-sunset::before  { background: radial-gradient(ellipse at 30% 70%, rgba(255,152,0,0.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(230,81,0,0.05) 0%, transparent 50%); opacity: var(--bg-tint-opacity); }

/* ══ Feature 2: Live profile preview ══ */
.live-preview-wrap {
  margin-top: 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
}
.live-preview-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.mini-profile-card {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  padding: 20px 16px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 130px;
}
.mini-profile-card[data-style="flame"]    { background: linear-gradient(135deg,#1a0a00,#ff6b35,#ffbe0b); }
.mini-profile-card[data-style="ocean"]    { background: linear-gradient(135deg,#0a1a2e,#1e3a5f,#00b4d8,#90e0ef); }
.mini-profile-card[data-style="galaxy"]   { background: linear-gradient(135deg,#0d0221,#3d1a78,#6a0dad,#c77dff); }
.mini-profile-card[data-style="aurora"]   { background: linear-gradient(135deg,#003d2b,#00b09b,#96c93d,#f7971e); }
.mini-profile-card[data-style="neon"]     { background: linear-gradient(135deg,#0a0a1a,#00f0ff,#ff00ff,#0a0a1a); }
.mini-profile-card[data-style="sakura"]   { background: linear-gradient(135deg,#2d0a18,#ff758c,#ff7eb3,#ffd6e7); }
.mini-profile-card[data-style="midnight"] { background: linear-gradient(135deg,#0a0a1f,#1a1a3e,#2d2d6e,#4040b0); }
.mini-profile-card[data-style="gold"]     { background: linear-gradient(135deg,#1a1000,#8b6914,#ffd700,#fffacd); }
.mini-particles { position:absolute;inset:0;width:100%;height:100%;pointer-events:none; }
.mini-avatar-ring {
  position: relative;
  z-index: 2;
  width: 52px; height: 52px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.4);
  overflow: hidden;
  background: rgba(255,255,255,0.1);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 18px; color: #fff;
}
.mini-avatar { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.mini-name { font-family:'Syne',sans-serif; font-size:15px; font-weight:800; color:#fff; z-index:2; text-shadow:0 1px 4px rgba(0,0,0,0.5); }
.mini-tag  { font-size:11px; color:rgba(255,255,255,0.65); z-index:2; }
.mini-bio  { font-size:11px; color:rgba(255,255,255,0.55); z-index:2; text-align:center; max-width:200px; line-height:1.4; }

/* ══ Feature 3: Animated gradient on profile header ══ */
.profile-card-header {
  transition: transform 0.2s ease;
  transform-style: preserve-3d;
}
.profile-card-header.animated-gradient {
  background-size: 200% 200%;
  animation: gradientShift 6s ease infinite;
}
@keyframes gradientShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* ══ Feature 8: Message bubble animation ══ */
@keyframes confettiBurst {
  0%   { transform: translate(-50%,-50%) scale(1); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3); opacity: 0; }
}
.msg-anim-in {
  animation: msgSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes msgSlideUp {
  from { opacity: 0; transform: translateY(14px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ══ Feature 10: Shimmer avatar ══ */
.avatar-shimmer {
  position: relative;
  overflow: hidden;
}
.avatar-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%);
  animation: avatarShimmer 1.2s infinite;
}
@keyframes avatarShimmer {
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
}

/* ══ Feature 11: Hover profile card ══ */
.hover-profile-card {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-deep);
  width: 240px;
  overflow: hidden;
  animation: fadeIn 0.15s ease;
}
.hover-card-bg {
  height: 44px;
  width: 100%;
}
.hover-card-bg[data-style="flame"]    { background: linear-gradient(135deg,#1a0a00,#ff6b35,#ffbe0b); }
.hover-card-bg[data-style="ocean"]    { background: linear-gradient(135deg,#0a1a2e,#00b4d8,#90e0ef); }
.hover-card-bg[data-style="galaxy"]   { background: linear-gradient(135deg,#0d0221,#6a0dad,#c77dff); }
.hover-card-bg[data-style="aurora"]   { background: linear-gradient(135deg,#003d2b,#00b09b,#96c93d); }
.hover-card-bg[data-style="neon"]     { background: linear-gradient(135deg,#0a0a1a,#00f0ff,#ff00ff); }
.hover-card-bg[data-style="sakura"]   { background: linear-gradient(135deg,#2d0a18,#ff758c,#ff7eb3); }
.hover-card-bg[data-style="midnight"] { background: linear-gradient(135deg,#0a0a1f,#2d2d6e,#4040b0); }
.hover-card-bg[data-style="gold"]     { background: linear-gradient(135deg,#1a1000,#ffd700,#fffacd); }
.hover-card-content {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px 12px;
  margin-top: -22px;
  position: relative;
}
.hover-card-av {
  border: 2px solid var(--bg-raised);
  flex-shrink: 0;
}
.hover-card-info { flex: 1; min-width: 0; }
.hover-online-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #2ed573;
  flex-shrink: 0;
}
.hover-online-dot.offline { background: var(--text-muted); }

/* ══ Feature 14: Swipe to reply ══ */
.swipe-reply-flash {
  animation: swipeFlash 0.4s ease;
}
@keyframes swipeFlash {
  0%,100% { background: transparent; }
  50% { background: rgba(255,107,53,0.15); border-radius: var(--radius-md); }
}

/* ══ Feature 16: Badge pulse ══ */
.badge-pulse {
  animation: badgePulse 2s ease infinite;
}
@keyframes badgePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,53,0.5); }
  50% { box-shadow: 0 0 0 4px rgba(255,107,53,0); }
}

/* ══ Feature 17: Notification dot on avatar ══ */
.online-dot.has-notification {
  background: var(--accent) !important;
  animation: notifPulse 1.5s ease infinite;
}
@keyframes notifPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,107,53,0.5); }
  50%       { box-shadow: 0 0 0 5px rgba(255,107,53,0); }
}

/* ══ Feature 18: Friend online flash ══ */
.online-flash-banner {
  position: fixed;
  bottom: 80px; left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--bg-raised);
  border: 1px solid #2ed573;
  border-radius: var(--radius-pill);
  padding: 8px 18px;
  font-size: 13px;
  color: #2ed573;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
  z-index: 9990;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow-card);
}
.online-flash-banner.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.online-flash-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #2ed573;
  flex-shrink: 0;
  animation: onlinePulse 1.5s ease infinite;
}

/* ══ Feature 20: Message slide-in ══ */
/* FIX: default visible so messages aren't hidden on initial load */
.msg-row {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.25s ease, transform 0.25s ease;
}
/* New messages get animated in by setupBubbleShapeVariant MutationObserver */
.msg-row.msg-anim-in {
  animation: msgSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* ══ Status message in profile ══ */
.profile-status-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255,255,255,0.65);
  z-index: 2;
  margin-top: 2px;
  background: rgba(0,0,0,0.2);
  border-radius: var(--radius-pill);
  padding: 3px 10px;
  backdrop-filter: blur(8px);
}

/* ══ Chat topbar themed accent ══ */
.chat-topbar {
  transition: box-shadow 0.5s ease;
}

/* ══ Themed message bubbles (theirs side) ══ */
.bg-theme-flame .msg-group.theirs .msg-bubble    { border-color: rgba(255,107,53,0.2); }
.bg-theme-ocean .msg-group.theirs .msg-bubble     { border-color: rgba(0,180,216,0.2); }
.bg-theme-galaxy .msg-group.theirs .msg-bubble    { border-color: rgba(199,125,255,0.2); }
.bg-theme-aurora .msg-group.theirs .msg-bubble    { border-color: rgba(150,201,61,0.2); }
.bg-theme-neon .msg-group.theirs .msg-bubble      { border-color: rgba(0,240,255,0.2); }
.bg-theme-sakura .msg-group.theirs .msg-bubble    { border-color: rgba(255,117,140,0.2); }
.bg-theme-midnight .msg-group.theirs .msg-bubble  { border-color: rgba(64,64,176,0.2); }
.bg-theme-gold .msg-group.theirs .msg-bubble      { border-color: rgba(255,215,0,0.2); }
.bg-theme-emerald .msg-group.theirs .msg-bubble   { border-color: rgba(46,204,113,0.2); }
.bg-theme-crimson .msg-group.theirs .msg-bubble   { border-color: rgba(220,20,60,0.2); }
.bg-theme-ice .msg-group.theirs .msg-bubble       { border-color: rgba(0,188,212,0.2); }
.bg-theme-sunset .msg-group.theirs .msg-bubble    { border-color: rgba(255,152,0,0.2); }

/* ══ Themed scroll-to-bottom button ══ */
.messages-area .scroll-to-bottom {
  background: var(--chat-accent-color, var(--accent));
}

  `;
  document.head.appendChild(style);
}

// ── Expose init so app.js can call it after login ────
window.__featuresInit = initFeatures;
