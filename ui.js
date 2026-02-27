// ============================================
// PULSE2 — ui.js (UI interactions & enhancements)
// ============================================
import { state, db, collection, getDocs, query, where, onSnapshot, doc } from "./app.js";

const EMOJI_LIST = [
  '😀','😂','😍','🥺','😎','🤔','😅','🔥','💯','🎉',
  '❤️','💀','👀','✨','💪','🙌','👍','👎','🤝','🫶',
  '😤','🥳','😴','🤡','👻','💥','⚡','🌊','🎯','💎',
  '🚀','🌙','⭐','🎵','🎮','🏆','📢','💬','📱','🔮',
];

export function initUI() {
  setupEmojiPicker();
  setupMembersPanel();
  setupMessageInputEnhancements();
  setupKeyboardShortcuts();
  addWelcomeAnimations();
}

// ---- Emoji Picker ----
function setupEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  const emojiBtn = document.getElementById('emoji-btn');
  const input = document.getElementById('message-input');

  // Populate emojis
  EMOJI_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const pos = input.selectionStart;
      const before = input.value.substring(0, pos);
      const after = input.value.substring(pos);
      input.value = before + emoji + after;
      input.focus();
      input.selectionStart = input.selectionEnd = pos + emoji.length;
      picker.classList.add('hidden');

      // Trigger resize
      input.dispatchEvent(new Event('input'));
    });
    picker.appendChild(btn);
  });

  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== emojiBtn) {
      picker.classList.add('hidden');
    }
  });
}

// ---- Members Panel ----
function setupMembersPanel() {
  const membersBtn = document.getElementById('members-btn');
  const membersPanel = document.getElementById('members-panel');

  membersBtn.addEventListener('click', () => {
    state.membersOpen = !state.membersOpen;
    membersPanel.classList.toggle('hidden', !state.membersOpen);

    if (state.membersOpen) {
      loadMembers();
    }
  });
}

async function loadMembers() {
  const onlineList = document.getElementById('online-members');
  const offlineList = document.getElementById('offline-members');
  onlineList.innerHTML = '<li style="padding:6px 8px;font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">Loading...</li>';
  offlineList.innerHTML = '';

  try {
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => d.data());

    const online = users.filter(u => u.status === 'online');
    const offline = users.filter(u => u.status !== 'online');

    onlineList.innerHTML = '';
    offlineList.innerHTML = '';

    online.forEach(u => {
      onlineList.appendChild(createMemberEl(u, true));
    });

    offline.forEach(u => {
      offlineList.appendChild(createMemberEl(u, false));
    });

    if (online.length === 0) onlineList.innerHTML = '<li style="padding:6px 8px;font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">No one online</li>';
    if (offline.length === 0) offlineList.innerHTML = '<li style="padding:6px 8px;font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">None</li>';
  } catch (err) {
    onlineList.innerHTML = '<li style="padding:6px 8px;font-size:12px;color:var(--text-muted)">Failed to load.</li>';
  }
}

function createMemberEl(user, isOnline) {
  const li = document.createElement('li');
  li.className = 'member-item';
  li.innerHTML = `
    <div class="member-avatar ${isOnline ? 'online' : 'offline'}" style="background:${user.avatarColor || '#FF6B1A'}">
      ${(user.displayName || '?').charAt(0).toUpperCase()}
    </div>
    <span class="member-name">${user.displayName || 'Unknown'}</span>
  `;
  return li;
}

// ---- Input Enhancements ----
function setupMessageInputEnhancements() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  // Pulse send button when there's content
  input.addEventListener('input', () => {
    const hasContent = input.value.trim().length > 0;
    sendBtn.style.opacity = hasContent ? '1' : '0.5';
    sendBtn.style.transform = hasContent ? 'scale(1)' : 'scale(0.9)';
  });

  // Initial state
  sendBtn.style.opacity = '0.5';
  sendBtn.style.transform = 'scale(0.9)';

  // Drag over input area for file hints
  input.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.querySelector('.input-wrapper').style.borderColor = 'var(--orange)';
    document.querySelector('.input-wrapper').style.boxShadow = '0 0 0 3px var(--orange-dim)';
  });

  input.addEventListener('dragleave', () => {
    document.querySelector('.input-wrapper').style.borderColor = '';
    document.querySelector('.input-wrapper').style.boxShadow = '';
  });

  input.addEventListener('drop', (e) => {
    e.preventDefault();
    document.querySelector('.input-wrapper').style.borderColor = '';
    document.querySelector('.input-wrapper').style.boxShadow = '';
    // File drop hint
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      input.value = `[File: ${files[0].name}]`;
      input.dispatchEvent(new Event('input'));
    }
  });
}

// ---- Keyboard Shortcuts ----
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Alt+K: focus message input
    if (e.altKey && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('message-input');
      if (input && state.currentChannel) input.focus();
    }

    // Escape: close modals / emoji picker
    if (e.key === 'Escape') {
      document.getElementById('emoji-picker').classList.add('hidden');
      document.querySelector('.reaction-quick-picker')?.remove();
    }
  });
}

// ---- Welcome Animations ----
function addWelcomeAnimations() {
  // Stagger sidebar elements on load
  const sidebarItems = document.querySelectorAll('.sidebar-header, .sidebar-section, .sidebar-footer');
  sidebarItems.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-12px)';
    setTimeout(() => {
      el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    }, 100 + i * 80);
  });

  // Animate empty state on load
  const emptyState = document.getElementById('empty-state');
  if (emptyState) {
    emptyState.style.opacity = '0';
    setTimeout(() => {
      emptyState.style.transition = 'opacity 0.6s ease';
      emptyState.style.opacity = '1';
    }, 400);
  }
}

// ---- Smooth scroll helper ----
export function smoothScrollToBottom(container, instant = false) {
  if (instant) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// ---- Format file size ----
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ---- Color utils ----
export function stringToColor(str) {
  const colors = ['#FF6B1A', '#e74c3c', '#9b59b6', '#3498db', '#2ecc71', '#f39c12', '#1abc9c', '#e67e22', '#c0392b', '#8e44ad'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
