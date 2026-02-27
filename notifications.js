// ============================================
// PULSE2 — notifications.js
// Browser notifications, sounds, unread badges
// ============================================

let notifPermission = 'default';
let audioCtx = null;

// ---- Init ----
export function initNotifications() {
  requestPermission();
  setupPageVisibility();
  setupDocumentTitle();
}

async function requestPermission() {
  if ('Notification' in window) {
    notifPermission = await Notification.requestPermission();
  }
}

// ---- Send Notification ----
export function notify(title, body, options = {}) {
  // Only notify if page is hidden or user is in a different channel
  if (document.hidden || options.force) {
    if (notifPermission === 'granted') {
      const n = new Notification(`Pulse2 — ${title}`, {
        body,
        icon: options.icon || generateFaviconURL(),
        badge: generateFaviconURL(),
        tag: options.tag || 'pulse2-message',
        silent: false,
      });

      n.onclick = () => {
        window.focus();
        n.close();
        if (options.channelId && options.onClick) options.onClick();
      };

      setTimeout(() => n.close(), 6000);
    }
  }

  // Always play sound for new messages in current channel from others
  if (options.playSound !== false) {
    playMessageSound();
  }

  // Update title badge
  if (document.hidden) {
    incrementUnreadTitle();
  }
}

// ---- Unread Badges ----
let unreadCount = 0;
let originalTitle = 'Pulse2';

export function addUnreadBadge(channelId, count = 1) {
  const el = document.querySelector(`[data-id="${channelId}"]`);
  if (!el) return;

  let badge = el.querySelector('.unread-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'unread-badge';
    el.appendChild(badge);
  }

  const current = parseInt(badge.textContent) || 0;
  badge.textContent = Math.min(current + count, 99);
  badge.style.animation = 'none';
  badge.offsetHeight; // force reflow
  badge.style.animation = 'badgePop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
}

export function clearUnreadBadge(channelId) {
  const el = document.querySelector(`[data-id="${channelId}"]`);
  if (!el) return;
  const badge = el.querySelector('.unread-badge');
  if (badge) badge.remove();
  resetUnreadTitle();
}

function incrementUnreadTitle() {
  unreadCount++;
  document.title = `(${unreadCount}) ${originalTitle}`;
}

function resetUnreadTitle() {
  unreadCount = 0;
  document.title = originalTitle;
}

// ---- Page Visibility ----
function setupPageVisibility() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      resetUnreadTitle();
    }
  });
}

function setupDocumentTitle() {
  originalTitle = document.title;
}

// ---- Web Audio Sounds ----
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function playMessageSound() {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Pulse-themed sound: quick two-tone pop
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.06);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  } catch {
    // AudioContext might be suspended — ignore
  }
}

export function playJoinSound() {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch { /* silent */ }
}

export function playErrorSound() {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(200, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15);

    gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  } catch { /* silent */ }
}

// ---- Favicon Generator ----
function generateFaviconURL() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx2d = canvas.getContext('2d');

  // Background
  ctx2d.fillStyle = '#0a0a0b';
  ctx2d.beginPath();
  ctx2d.roundRect(0, 0, 32, 32, 8);
  ctx2d.fill();

  // Pulse wave
  ctx2d.strokeStyle = '#FF6B1A';
  ctx2d.lineWidth = 2;
  ctx2d.lineCap = 'round';
  ctx2d.beginPath();
  ctx2d.moveTo(4, 16);
  ctx2d.quadraticCurveTo(10, 6, 16, 16);
  ctx2d.quadraticCurveTo(22, 26, 28, 16);
  ctx2d.stroke();

  // Center dot
  ctx2d.fillStyle = '#FF6B1A';
  ctx2d.beginPath();
  ctx2d.arc(16, 16, 2.5, 0, Math.PI * 2);
  ctx2d.fill();

  // Set as favicon
  let link = document.querySelector("link[rel*='icon']") || document.createElement('link');
  link.type = 'image/x-icon';
  link.rel = 'shortcut icon';
  link.href = canvas.toDataURL();
  document.getElementsByTagName('head')[0].appendChild(link);

  return canvas.toDataURL();
}

// ---- Badge pulse animation ----
const badgeStyle = document.createElement('style');
badgeStyle.textContent = `
  @keyframes badgePop {
    0%   { transform: scale(0); }
    70%  { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(badgeStyle);

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
  // Generate favicon immediately
  generateFaviconURL();
});

// Export for use in chat.js if needed
window.Pulse2Notifications = { notify, addUnreadBadge, clearUnreadBadge, playMessageSound, playJoinSound };
