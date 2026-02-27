// ═══════════════════════════════════════════════════════════
// PULSE2 — ui.js  (Emoji Picker, Settings, Search, Shortcuts)
// ═══════════════════════════════════════════════════════════
import {
  state, showToast, savePrefs, applyAccentColor, applyPreferences,
  escHtml, formatTime, switchSidebarView, selectConversation,
  db, collection, query, orderBy, getDocs, limit
} from "./app.js";

// Full emoji dataset
const EMOJIS = {
  recent:  [],
  smileys: ['😀','😁','😂','🤣','😅','😆','😍','🥰','😘','😎','🤩','🥳','😏','😒','😞','😭','😤','🤬','🤯','😳','🥺','😱','🙄','😴','🤗','🤔','🫡','🤭','🤫','😶','😐','😑','😬','🤥','🫠','😵','😲','🥱'],
  people:  ['👋','🤚','🖐','✋','🤜','🤛','👊','🤝','👍','👎','👏','🙌','🫶','💪','🦵','🦶','☝️','👆','👇','👈','👉','🤘','🤙','💅','🤳','🧏','💁','🙋','🤦','🤷','💀','👻','🫶','🫂'],
  objects: ['🔥','⚡','💥','✨','🌟','💫','❄️','🌊','🌀','🌈','☀️','🌙','⭐','🎯','💎','🏆','🎮','🎵','🎶','🎸','🎹','📱','💻','🖥','🎨','📷','🔮','🪄','🧲','🔑','🗝','🔒','💰','💸','🎁','🎀','🍕','🍔','🍩','🍫','☕','🥤','🎃','🎄','🎆'],
  symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💕','💞','💓','💗','💖','💘','💝','✅','❌','⭕','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🔶','🔷','🔸','🔹','▶️','⏩','⏪','⏫','⏬','🔁','🔂','🔀'],
};

let recentEmojis = [];
try { recentEmojis = JSON.parse(localStorage.getItem('p2_recent_emojis') || '[]'); } catch {}
EMOJIS.recent = recentEmojis;

// ── Init ──────────────────────────────────────────────────────
export function initUI() {
  generateFavicon();
  setupEmojiPicker();
  setupSettings();
  setupGlobalSearch();
  setupKeyboardShortcuts();
  animateIn();
}

// ── Emoji Picker ──────────────────────────────────────────────
function setupEmojiPicker() {
  const picker   = document.getElementById('emoji-picker');
  const emojiBtn = document.getElementById('emoji-btn');
  const searchEl = document.getElementById('emoji-search-input');
  const grid     = document.getElementById('emoji-grid');
  const input    = document.getElementById('message-input');
  const cats     = document.querySelectorAll('.emoji-cat');

  let currentCat = 'smileys';

  function renderEmojis(list) {
    grid.innerHTML = '';
    const toShow = list.length ? list : EMOJIS[currentCat] || [];
    toShow.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener('click', () => insertEmoji(emoji));
      grid.appendChild(btn);
    });
  }

  function insertEmoji(emoji) {
    const pos    = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const after  = input.value.slice(pos);
    input.value  = before + emoji + after;
    input.focus();
    input.selectionStart = input.selectionEnd = pos + emoji.length;
    input.dispatchEvent(new Event('input'));

    // Track recent
    recentEmojis = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 24);
    localStorage.setItem('p2_recent_emojis', JSON.stringify(recentEmojis));
    EMOJIS.recent = recentEmojis;
  }

  // Category buttons
  cats.forEach(btn => {
    btn.addEventListener('click', () => {
      cats.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCat = btn.dataset.cat;
      if (searchEl) searchEl.value = '';
      renderEmojis(EMOJIS[currentCat] || []);
    });
  });

  // Search
  if (searchEl) {
    let debounce;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const q = searchEl.value.trim().toLowerCase();
        if (!q) { renderEmojis(EMOJIS[currentCat] || []); return; }
        // Filter all emoji (heuristic: show any emoji that contains query as substring in its codepoint name isn't available, so show all 40)
        const all = [...new Set(Object.values(EMOJIS).flat())];
        renderEmojis(all.slice(0, 48)); // show broad selection when searching
      }, 150);
    });
  }

  // Initial render
  renderEmojis(EMOJIS.smileys);

  // Toggle
  emojiBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isHidden = picker.classList.contains('hidden');
    picker.classList.toggle('hidden', !isHidden);
    if (isHidden) {
      renderEmojis(EMOJIS[currentCat] || []);
      setTimeout(() => searchEl?.focus(), 50);
    }
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!picker.contains(e.target) && e.target !== emojiBtn) picker.classList.add('hidden');
  });

  // Ctrl+E shortcut
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      if (!state.currentChannelId) return;
      const isHidden = picker.classList.contains('hidden');
      picker.classList.toggle('hidden', !isHidden);
      if (isHidden) { renderEmojis(EMOJIS[currentCat] || []); setTimeout(() => searchEl?.focus(), 50); }
    }
  });
}

// ── Settings ──────────────────────────────────────────────────
function setupSettings() {
  // Theme
  setupToggle('theme-toggle', on => {
    document.body.classList.toggle('light-mode', on);
    state.preferences.lightMode = on;
    savePrefs();
  });

  // Compact
  setupToggle('compact-toggle', on => {
    document.body.classList.toggle('compact-mode', on);
    state.preferences.compactMode = on;
    savePrefs();
  });

  // Sound
  setupToggle('sound-toggle', on => {
    state.preferences.sound = on;
    savePrefs();
  });

  // Notifications
  setupToggle('notif-toggle', async on => {
    if (on && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Notification permission denied.', 'error');
        const btn = document.getElementById('notif-toggle');
        if (btn) { btn.classList.remove('on'); btn.dataset.on = 'false'; }
        return;
      }
    }
    state.preferences.notifications = on;
    savePrefs();
  });

  // Timestamps
  setupToggle('timestamp-toggle', on => {
    state.preferences.timestamps = on;
    savePrefs();
  });

  // Typing indicator
  setupToggle('typing-pref-toggle', on => {
    state.preferences.sendTyping = on;
    savePrefs();
  });

  // Grouping
  setupToggle('grouping-toggle', on => {
    state.preferences.grouping = on;
    savePrefs();
  });

  // Enter to send
  setupToggle('enter-send-toggle', on => {
    state.preferences.enterSend = on;
    savePrefs();
    const hintEl = document.querySelector('.input-hints span');
    if (hintEl) hintEl.textContent = on
      ? '⌨  Enter send · Shift+Enter newline · ↑ edit last'
      : '⌨  Shift+Enter or click send · ↑ edit last';
  });

  // Font size
  let fontSize = parseInt(state.preferences.fontSize) || 15;
  const sizeLabel = document.getElementById('font-size-val');

  document.getElementById('font-smaller')?.addEventListener('click', () => {
    fontSize = Math.max(12, fontSize - 1);
    applyFontSize(fontSize, sizeLabel);
  });
  document.getElementById('font-larger')?.addEventListener('click', () => {
    fontSize = Math.min(22, fontSize + 1);
    applyFontSize(fontSize, sizeLabel);
  });

  // Accent color
  document.querySelectorAll('#accent-color-picker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#accent-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      applyAccentColor(sw.dataset.color);
      state.preferences.accentColor = sw.dataset.color;
      savePrefs();
    });
  });
}

function setupToggle(id, callback) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    btn.dataset.on = String(on);
    callback(on);
  });
}

function applyFontSize(size, label) {
  document.documentElement.style.setProperty('--msg-font-size', size + 'px');
  if (label) label.textContent = size + 'px';
  state.preferences.fontSize = size + 'px';
  savePrefs();
}

// ── Global Search ─────────────────────────────────────────────
function setupGlobalSearch() {
  const input   = document.getElementById('global-search-input');
  const results = document.getElementById('search-results');
  if (!input || !results) return;

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    debounce = setTimeout(() => doSearch(q, results), 400);
  });
}

async function doSearch(searchQ, container) {
  container.innerHTML = `<div class="search-no-results">Searching...</div>`;
  const lq = searchQ.toLowerCase();

  try {
    const allResults = [];
    for (const ch of state.channels) {
      const snap = await getDocs(query(collection(db, 'channels', ch.id, 'messages'), orderBy('timestamp', 'desc'), limit(200)));
      snap.forEach(d => {
        const msg = d.data();
        if ((msg.content || '').toLowerCase().includes(lq)) {
          allResults.push({ ...msg, id: d.id, channelId: ch.id, channelName: ch.name });
        }
      });
    }

    if (!allResults.length) {
      container.innerHTML = `<div class="search-no-results">No results for "<strong>${escHtml(searchQ)}</strong>"</div>`;
      return;
    }

    container.innerHTML = '';
    allResults.slice(0, 30).forEach(msg => {
      const escaped = escHtml(searchQ).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const highlighted = (escHtml(msg.content || '')).replace(
        new RegExp(escaped, 'gi'), m => `<mark>${m}</mark>`
      );
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `
        <div class="search-result-meta">#${escHtml(msg.channelName || '')} · ${escHtml(msg.author || 'Unknown')} · ${formatTime(msg.timestamp)}</div>
        <div class="search-result-content">${highlighted}</div>
      `;
      div.addEventListener('click', () => jumpToMessage(msg));
      container.appendChild(div);
    });
  } catch (err) {
    container.innerHTML = `<div class="search-no-results">Search failed – check channel permissions.</div>`;
    console.error('Search error:', err);
  }
}

function jumpToMessage(msg) {
  // Switch to home and select the channel
  switchSidebarView('home');
  document.querySelectorAll('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'home'));

  const ch = state.channels.find(c => c.id === msg.channelId);
  if (ch) {
    selectConversation(ch.id, 'channel', ch);
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlighted');
        setTimeout(() => el.classList.remove('highlighted'), 2500);
      }
    }, 700);
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd+K: search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !e.shiftKey) {
      e.preventDefault();
      switchSidebarView('search');
      document.querySelectorAll('.rail-btn[data-view]').forEach(b =>
        b.classList.toggle('active', b.dataset.view === 'search'));
    }
  });
}

// ── Entrance animations ───────────────────────────────────────
function animateIn() {
  [['#server-rail', 60], ['#sidebar', 120], ['#chat-area', 180]].forEach(([sel, delay]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.style.cssText += 'opacity:0;transform:translateY(10px)';
    setTimeout(() => {
      el.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, delay);
  });
}

// ── Favicon ───────────────────────────────────────────────────
function generateFavicon() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0c0c10';
    if (ctx.roundRect) ctx.roundRect(0, 0, 32, 32, 8);
    else ctx.rect(0, 0, 32, 32);
    ctx.fill();

    ctx.strokeStyle = '#FF6B1A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(3, 16);
    ctx.quadraticCurveTo(7, 8,  12, 16);
    ctx.quadraticCurveTo(14, 20, 16, 16);
    ctx.quadraticCurveTo(18, 12, 20, 16);
    ctx.quadraticCurveTo(25, 24, 29, 16);
    ctx.stroke();

    ctx.fillStyle = '#FF6B1A';
    ctx.beginPath();
    ctx.arc(16, 16, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const link = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/png', href: canvas.toDataURL() });
    document.head.appendChild(link);
  } catch {}
}
