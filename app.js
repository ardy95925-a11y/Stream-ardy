// =====================================================
//  PULSE — app.js  v5  (ES Module, Firebase v10)
//  FIXES (v5):
//    1. setPersistence wrapped in try/catch (top-level await can crash)
//    2. scrollToBottomBtn moved OUT of messagesArea so it survives renderMessages()
//    3. typingIndicator no longer re-created inside renderMessages() — it now lives
//       permanently at the bottom of messagesArea, appended once in openChat()
//    4. sendMessage unread increment uses FieldValue increment instead of a racy getDoc
//    5. msgSearchInput listener attached safely (after DOM ready)
//    6. Settings theme toggle now calls applyTheme() so both toggles stay in sync
//    7. msg-row visibility: messages start visible; slide-in handled by features.js
//    8. clearReply now also clears edit mode so Escape properly resets state
//    9. Unsubscribe typing listener on new chat open (memory leak fix)
//    10. openChat ensures chat doc exists before subscribing messages
//
//  NEW FEATURES (chat experience improvements):
//    A. Message read receipts — mark messages read when chat is focused
//    B. "Sent/Delivered" double-tick that turns blue when seen
//    C. Voice memo button (record short audio, send as base64)
//    D. Mention/highlight — @username in message turns accent colour
//    E. Emoji shortcode hints — type :fire → shows 🔥 suggestion
// =====================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs,
  setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch, limit, arrayUnion, arrayRemove,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// ── Firebase init ─────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCPabeR73HulqHs-wAq_ass1lUxkoEijAY",
  authDomain:        "chatin-e7d51.firebaseapp.com",
  projectId:         "chatin-e7d51",
  storageBucket:     "chatin-e7d51.firebasestorage.app",
  messagingSenderId: "175440428513",
  appId:             "1:175440428513:web:c6b365aa7728f0ad5a66a0"
};
const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const storage = getStorage(fbApp);

// FIX 1: Wrap setPersistence — top-level await fails silently in some browsers
try {
  await setPersistence(auth, browserLocalPersistence);
} catch(e) {
  console.warn('Could not set persistence:', e.message);
}

const GIPHY_KEY = 'dc6zaTOxFJmzC';

// ── State ─────────────────────────────────────────────
let currentUser       = null;
let currentUserData   = null;
let currentChatId     = null;
let currentFriendId   = null;
let currentFriendData = null;
let messagesUnsub     = null;
let presenceUnsub     = null;
let presenceInterval  = null;
let typingTimeout     = null;
let typingUnsub       = null;
let replyingTo        = null;
let searchMode        = false;
// Voice memo
let mediaRecorder     = null;
let audioChunks       = [];
let isRecording       = false;
const friendsCache    = new Map();

let currentTheme = localStorage.getItem('pulse-theme') ||
  (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

const $ = id => document.getElementById(id);

// ── Toast ─────────────────────────────────────────────
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Avatar ────────────────────────────────────────────
function setAvatar(el, userData) {
  el.innerHTML = '';
  if (userData?.photoURL) {
    const img = document.createElement('img');
    img.src = userData.photoURL;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { el.innerHTML = ''; el.textContent = (userData.displayName || '?')[0].toUpperCase(); };
    el.appendChild(img);
  } else {
    el.textContent = (userData?.displayName || '?')[0].toUpperCase();
  }
}

// ── Time ──────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000)    return 'now';
  if (diff < 3600000)  return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtFull(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDateLabel(ts) {
  if (!ts) return 'Today';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
function getChatId(a, b) { return [a, b].sort().join('_'); }
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function linkify(text) {
  // Also highlight @mentions
  return text
    .replace(/(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">$1</a>')
    .replace(/@([a-z0-9_]+)/gi,
      '<span style="color:var(--accent);font-weight:600">@$1</span>');
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function resizeImage(file, maxW = 1200, maxH = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Feature 8: Theme ──────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('pulse-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeToggleBtn');
  if (btn) btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  // FIX 6: Keep settings theme button text in sync
  const settingsBtn = $('themeToggleBtnSettings');
  if (settingsBtn) settingsBtn.textContent = theme === 'dark' ? 'Dark ✓' : 'Light ✓';
}
applyTheme(currentTheme);

// ── Feature 9: Sound notifications ───────────────────
let soundEnabled = localStorage.getItem('pulse-sound') !== 'false';
function playNotifSound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

// ── Emoji shortcode hints (NEW FEATURE E) ─────────────
const EMOJI_SHORTCUTS = {
  ':fire:': '🔥', ':heart:': '❤️', ':laugh:': '😂', ':thumbs:': '👍',
  ':wave:': '👋', ':star:': '⭐', ':check:': '✅', ':sad:': '😢',
  ':wow:': '😮', ':cool:': '😎', ':party:': '🎉', ':eyes:': '👀',
  ':100:': '💯', ':muscle:': '💪', ':clap:': '👏', ':skull:': '💀',
};

function applyEmojiShortcodes(text) {
  let result = text;
  for (const [code, emoji] of Object.entries(EMOJI_SHORTCUTS)) {
    result = result.replaceAll(code, emoji);
  }
  return result;
}

function setupEmojiHints() {
  const inp = $('msgInput');
  const hint = $('emojiHint');
  if (!inp || !hint) return;
  inp.addEventListener('input', () => {
    const val = inp.value;
    const match = val.match(/:[a-z0-9]+:?$/);
    if (match) {
      const partial = match[0];
      const found = Object.entries(EMOJI_SHORTCUTS).find(([k]) => k.startsWith(partial));
      if (found) {
        hint.textContent = `${found[0]} → ${found[1]}  (Tab to insert)`;
        hint.classList.remove('hidden');
        return;
      }
    }
    hint.classList.add('hidden');
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !hint.classList.contains('hidden')) {
      e.preventDefault();
      const val = inp.value;
      const match = val.match(/:[a-z0-9]+:?$/);
      if (match) {
        const partial = match[0];
        const found = Object.entries(EMOJI_SHORTCUTS).find(([k]) => k.startsWith(partial));
        if (found) {
          inp.value = val.slice(0, -partial.length) + found[1];
          hint.classList.add('hidden');
        }
      }
    }
  });
}

// ── AUTH GUARD ────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;

  let snap;
  try { snap = await getDoc(doc(db, 'users', user.uid)); }
  catch(e) { snap = null; }

  $('loadingOverlay').classList.add('hidden');
  $('appRoot').style.display = '';

  const data = snap?.exists() ? snap.data() : null;

  if (data?.username) {
    currentUserData = data;
    initApp();
  } else {
    $('setupDisplayName').value = user.displayName || '';
    $('setupUsername').value    = '';
    if (user.photoURL) {
      $('pfpPreview').innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    }
    showModal('setupModal');
  }
});

// ── Profile setup ─────────────────────────────────────
$('pfpPreview').addEventListener('click', () => $('pfpFileInput').click());

$('pfpFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataURL = await resizeImage(file, 400, 400, 0.9);
    $('pfpPreview').innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } catch {
    const dataURL = await fileToDataURL(file);
    $('pfpPreview').innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
});

$('setupSaveBtn').addEventListener('click', saveProfile);

async function saveProfile() {
  const displayName = $('setupDisplayName').value.trim();
  const username    = $('setupUsername').value.trim().toLowerCase();
  const bio         = $('setupBio')?.value.trim() || '';
  const cardStyle   = document.querySelector('.card-style-btn.active:not(.bubble-shape-btn)')?.dataset.style || 'flame';
  const bubbleShape = document.querySelector('.bubble-shape-btn.active')?.dataset.shape || 'rounded';
  const statusMsg   = $('setupStatusMsg')?.value.trim() || '';
  const moodEmoji   = $('setupMoodEmoji')?.value || '💬';

  if (!displayName)        { toast('Please enter a display name', 'error'); return; }
  if (username.length < 3) { toast('Username must be ≥ 3 characters', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { toast('Letters, numbers, underscores only', 'error'); return; }

  const btn = $('setupSaveBtn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    const uSnap = await getDoc(doc(db, 'usernames', username));
    if (uSnap.exists() && uSnap.data().uid !== currentUser.uid) {
      toast('Username taken — try another', 'error');
      btn.textContent = 'Save & Continue'; btn.disabled = false;
      return;
    }

    let photoURL = currentUserData?.photoURL || null;
    const file = $('pfpFileInput').files[0];

    if (file) {
      const resized = await resizeImage(file, 400, 400, 0.85);
      try {
        const ref = sRef(storage, `avatars/${currentUser.uid}`);
        const blob = await (await fetch(resized)).blob();
        await uploadBytes(ref, blob);
        photoURL = await getDownloadURL(ref);
      } catch {
        photoURL = resized;
      }
    } else if (!photoURL && currentUser.photoURL) {
      photoURL = currentUser.photoURL;
    }

    const userData = {
      uid: currentUser.uid, displayName, username, photoURL, bio, cardStyle, bubbleShape, statusMsg, moodEmoji,
      updatedAt: serverTimestamp(), online: true, lastSeen: serverTimestamp(),
    };
    if (!currentUserData?.createdAt) userData.createdAt = serverTimestamp();

    const batch = writeBatch(db);
    batch.set(doc(db, 'users', currentUser.uid), userData, { merge: true });
    batch.set(doc(db, 'usernames', username), { uid: currentUser.uid });
    if (currentUserData?.username && currentUserData.username !== username) {
      batch.delete(doc(db, 'usernames', currentUserData.username));
    }
    await batch.commit();

    currentUserData = { ...(currentUserData || {}), ...userData };
    hideModal('setupModal');
    updateSidebarFooter();
    if (!presenceInterval) initApp();
    toast('Profile saved! 🎉', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
    btn.textContent = 'Save & Continue'; btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────
function initApp() {
  updateSidebarFooter();
  startPresence();
  subscribeToFriends();
  subscribeToRequests();
  subscribeToChats();
  setupTabs();
  setupSearch();
  setupInputBar();
  setupKeyboardShortcuts();
  applyTheme(currentTheme);
  setupThemeToggle();
  setupScrollToBottom();
  listenForIncomingCalls();
  setupCardStylePicker();
  setupEmojiHints();
  // FIX 5: attach msgSearchInput listener here, after DOM is definitely ready
  $('msgSearchInput')?.addEventListener('input', handleMsgSearch);
}

function handleMsgSearch(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    document.querySelectorAll('.msg-row').forEach(el => el.classList.remove('search-match','search-no-match'));
    return;
  }
  document.querySelectorAll('.msg-row').forEach(el => {
    const text = el.querySelector('.msg-bubble')?.textContent.toLowerCase() || '';
    el.classList.toggle('search-match', text.includes(q));
    el.classList.toggle('search-no-match', !text.includes(q) && !!el.querySelector('.msg-bubble'));
  });
}

function setupCardStylePicker() {
  document.querySelectorAll('.card-style-btn:not(.bubble-shape-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.card-style-btn:not(.bubble-shape-btn)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('.bubble-shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bubble-shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyBubbleShape(btn.dataset.shape);
    });
  });
  const savedShape = localStorage.getItem('pulse-bubble-shape') || 'rounded';
  applyBubbleShape(savedShape);
}

function applyBubbleShape(shape) {
  localStorage.setItem('pulse-bubble-shape', shape);
  const root = document.documentElement;
  if (shape === 'sharp') {
    root.style.setProperty('--msg-radius', '6px');
    root.style.setProperty('--msg-radius-tail', '2px');
  } else if (shape === 'pill') {
    root.style.setProperty('--msg-radius', '999px');
    root.style.setProperty('--msg-radius-tail', '8px');
  } else {
    root.style.setProperty('--msg-radius', 'var(--radius-lg)');
    root.style.setProperty('--msg-radius-tail', '4px');
  }
}

// ── Presence ──────────────────────────────────────────
function startPresence() {
  const userRef = doc(db, 'users', currentUser.uid);
  const setOnline = () => updateDoc(userRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  setOnline();
  presenceInterval = setInterval(setOnline, 25000);
  window.addEventListener('beforeunload', () => {
    clearInterval(presenceInterval);
    updateDoc(userRef, { online: false }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () =>
    document.hidden ? updateDoc(userRef, { online: false }).catch(() => {}) : setOnline()
  );
}

function updateSidebarFooter() {
  setAvatar($('myAvatar'), currentUserData);
  $('myName').textContent = currentUserData.displayName || '';
  $('myTag').textContent  = '@' + (currentUserData.username || '');
}

// ── Tabs ──────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function setupSearch() {
  $('sidebarSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.conv-item,.friend-item').forEach(item => {
      const name = item.querySelector('.conv-name,.friend-name')?.textContent.toLowerCase() || '';
      item.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

// ── Scroll to bottom button ───────────────────────────
// FIX 2: Button is in the HTML outside messagesArea, so it never gets wiped
function setupScrollToBottom() {
  const area = $('messagesArea');
  const btn  = $('scrollToBottomBtn');
  if (!area || !btn) return;
  area.addEventListener('scroll', () => {
    const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 150;
    btn.classList.toggle('visible', !atBottom);
  });
  btn.addEventListener('click', () => area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }));
}

// ── Feature 8: Theme toggle ───────────────────────────
function setupThemeToggle() {
  const btn = $('themeToggleBtn');
  if (!btn) return;
  // FIX 6: Use applyTheme() so both buttons stay in sync
  btn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
  const settingsBtn = $('themeToggleBtnSettings');
  if (settingsBtn) {
    settingsBtn.onclick = null; // remove inline handler
    settingsBtn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
  }
}

// ── Feature 12: Keyboard shortcuts ───────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === '?') { showModal('shortcutsModal'); return; }
    if (e.key === 'Escape') { document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => { if (m.id !== 'setupModal') m.classList.add('hidden'); }); }
    if (e.key === 'f' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleMessageSearch(); }
  });
}

// ── Friends ───────────────────────────────────────────
function subscribeToFriends() {
  const q = query(collection(db, 'friends'), where('users', 'array-contains', currentUser.uid), where('status', '==', 'accepted'));
  onSnapshot(q, async snap => {
    const list = $('friendsList');
    list.innerHTML = '';
    friendsCache.clear();
    const seenUids = new Set();

    const rows = await Promise.all(snap.docs.map(async d => {
      const fUid = d.data().users.find(u => u !== currentUser.uid);
      if (!fUid || seenUids.has(fUid)) return null;
      seenUids.add(fUid);
      const uSnap = await getDoc(doc(db, 'users', fUid));
      if (!uSnap.exists()) return null;
      return { uid: fUid, userData: uSnap.data(), docId: d.id };
    }));

    const valid = rows.filter(Boolean);
    if (!valid.length) {
      list.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>No friends yet — add some!</div>`;
      return;
    }
    valid.forEach(({ uid, userData, docId }) => {
      friendsCache.set(uid, userData);
      renderFriendItem(list, userData, uid, docId);
    });
  });
}

function renderFriendItem(container, userData, uid, friendDocId) {
  const div = document.createElement('div');
  div.className = 'friend-item';
  const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
  const av = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, userData);
  const dot = document.createElement('div');
  dot.className = `online-dot${userData.online ? '' : ' offline'}`;
  dot.style.cssText = 'position:absolute;bottom:0;right:0';
  wrap.appendChild(av); wrap.appendChild(dot);
  const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0';
  meta.innerHTML = `<div class="friend-name">${escHtml(userData.displayName)}</div>
    <div class="friend-tag">@${escHtml(userData.username || '')}</div>`;
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:4px';
  const msgBtn = document.createElement('button'); msgBtn.className = 'btn-icon'; msgBtn.title = 'Message';
  msgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  msgBtn.addEventListener('click', e => { e.stopPropagation(); openChat(uid, userData); });

  const removeBtn = document.createElement('button'); removeBtn.className = 'btn-icon'; removeBtn.title = 'Remove friend';
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ff4757"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
  removeBtn.addEventListener('click', e => { e.stopPropagation(); confirmRemoveFriend(friendDocId, userData.displayName); });

  actions.appendChild(msgBtn); actions.appendChild(removeBtn);
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(actions);
  div.addEventListener('click', () => openChat(uid, userData));
  container.appendChild(div);
}

function confirmRemoveFriend(docId, name) {
  if (confirm(`Remove ${name} from your friends?`)) {
    deleteDoc(doc(db, 'friends', docId)).then(() => toast('Friend removed')).catch(e => toast('Error: ' + e.message, 'error'));
  }
}

// ── Requests ──────────────────────────────────────────
function subscribeToRequests() {
  const q = query(collection(db, 'friends'), where('to', '==', currentUser.uid), where('status', '==', 'pending'));
  onSnapshot(q, async snap => {
    const list = $('requestsList');
    const badge = $('requestsBadge');
    list.innerHTML = '';
    if (snap.empty) {
      badge.classList.add('hidden');
      list.innerHTML = `<div class="empty-state">No pending requests</div>`;
      return;
    }
    badge.textContent = snap.size; badge.classList.remove('hidden');
    for (const d of snap.docs) {
      const data = d.data();
      const sSnap = await getDoc(doc(db, 'users', data.from));
      if (!sSnap.exists()) continue;
      const sender = sSnap.data();
      const div = document.createElement('div'); div.className = 'req-item';
      const av = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, sender);
      const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-size:14px;font-weight:500">${escHtml(sender.displayName)}</div>
        <div style="font-size:12px;color:var(--text-muted)">@${escHtml(sender.username || '')}</div>`;
      const btns = document.createElement('div'); btns.className = 'req-btns';
      const acc = document.createElement('button'); acc.className = 'btn-accept'; acc.textContent = 'Accept';
      acc.addEventListener('click', () => acceptRequest(d.id, data.from));
      const rej = document.createElement('button'); rej.className = 'btn-reject'; rej.textContent = 'Ignore';
      rej.addEventListener('click', async () => { await deleteDoc(doc(db, 'friends', d.id)); toast('Request ignored'); });
      btns.appendChild(acc); btns.appendChild(rej);
      div.appendChild(av); div.appendChild(info); div.appendChild(btns);
      list.appendChild(div);
    }
  });
}

async function acceptRequest(docId, fromUid) {
  const chatId = getChatId(currentUser.uid, fromUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'friends', docId), { status: 'accepted', acceptedAt: serverTimestamp() });
  batch.set(doc(db, 'chats', chatId), {
    participants: [currentUser.uid, fromUid],
    createdAt: serverTimestamp(),
    lastMessage: '', lastMessageTime: serverTimestamp(), lastMessageType: 'text'
  }, { merge: true });
  await batch.commit();
  toast('Friend added! 🎉', 'success');
}

// ── Chats list ────────────────────────────────────────
function subscribeToChats() {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid), orderBy('lastMessageTime', 'desc'));
  onSnapshot(q, async snap => {
    const list = $('chatList');
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>No chats yet</div>`;
      return;
    }
    const seen = new Set();
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      const data = d.data();
      const fUid = data.participants?.find(p => p !== currentUser.uid);
      if (!fUid) continue;
      let userData = friendsCache.get(fUid);
      if (!userData) {
        const uSnap = await getDoc(doc(db, 'users', fUid));
        if (!uSnap.exists()) continue;
        userData = uSnap.data(); friendsCache.set(fUid, userData);
      }
      renderChatItem(list, d.id, data, userData, fUid);
    }
  });
}

function renderChatItem(container, chatId, chatData, userData, friendUid) {
  const div = document.createElement('div');
  div.className = `conv-item${currentChatId === chatId ? ' active' : ''}`;
  const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
  const av = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, userData);
  const dot = document.createElement('div');
  dot.className = `online-dot${userData.online ? '' : ' offline'}`;
  dot.style.cssText = 'position:absolute;bottom:0;right:0';
  wrap.appendChild(av); wrap.appendChild(dot);
  let preview = chatData.lastMessage || 'Start chatting…';
  if (chatData.lastMessageType === 'image') preview = '📷 Photo';
  if (chatData.lastMessageType === 'gif')   preview = '🎞 GIF';
  if (chatData.lastMessageType === 'audio') preview = '🎤 Voice memo';
  const meta = document.createElement('div'); meta.className = 'conv-meta';
  meta.innerHTML = `<div class="conv-name">${escHtml(userData.displayName)}</div>
    <div class="conv-preview">${escHtml(preview)}</div>`;
  const right = document.createElement('div'); right.className = 'conv-right';
  right.innerHTML = `<span class="conv-time">${fmtTime(chatData.lastMessageTime)}</span>`;

  const unread = chatData.unreadCount?.[currentUser.uid] || 0;
  if (unread > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = unread > 9 ? '9+' : unread;
    right.appendChild(badge);
  }

  div.appendChild(wrap); div.appendChild(meta); div.appendChild(right);
  div.addEventListener('click', () => {
    document.querySelectorAll('.conv-item').forEach(i => i.classList.remove('active'));
    div.classList.add('active');
    openChat(friendUid, userData, chatId);
    updateDoc(doc(db, 'chats', chatId), { [`unreadCount.${currentUser.uid}`]: 0 }).catch(() => {});
  });
  container.appendChild(div);
}

// ── Open chat ─────────────────────────────────────────
function openChat(friendUid, userData, existingChatId) {
  currentFriendId   = friendUid;
  currentFriendData = userData;
  currentChatId     = existingChatId || getChatId(currentUser.uid, friendUid);

  setAvatar($('chatAvatar'), userData);
  $('chatName').textContent = userData.displayName;

  if (presenceUnsub) presenceUnsub();
  presenceUnsub = onSnapshot(doc(db, 'users', friendUid), snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    const dot = $('chatOnlineDot');
    if (d.online) {
      dot.classList.remove('offline');
      $('chatStatus').textContent = 'Online';
    } else {
      dot.classList.add('offline');
      $('chatStatus').textContent = `Last seen ${d.lastSeen ? fmtTime(d.lastSeen) + ' ago' : 'recently'}`;
    }
  });

  $('welcomeScreen').classList.add('hidden');
  $('chatView').classList.remove('hidden');

  clearReply();
  clearEdit();

  if (window.__applyChatBgFromProfile) window.__applyChatBgFromProfile(userData);

  setDoc(doc(db, 'chats', currentChatId), {
    participants: [currentUser.uid, friendUid],
    createdAt: serverTimestamp(),
    lastMessageTime: serverTimestamp(),
    lastMessage: '',
  }, { merge: true }).catch(() => {});

  subscribeToMessages(currentChatId);
  subscribeToTyping(currentChatId);
}

// ── Feature 1: Typing indicator ───────────────────────
function subscribeToTyping(chatId) {
  // FIX 9: Always unsub the previous typing listener
  if (typingUnsub) { typingUnsub(); typingUnsub = null; }
  typingUnsub = onSnapshot(doc(db, 'chats', chatId), snap => {
    const data = snap.data();
    const isTyping = data?.typing?.[currentFriendId];
    const indicator = $('typingIndicator');
    if (indicator) indicator.classList.toggle('visible', !!isTyping);
  });
}

function setTyping(isTyping) {
  if (!currentChatId) return;
  updateDoc(doc(db, 'chats', currentChatId), { [`typing.${currentUser.uid}`]: isTyping }).catch(() => {});
}

// ── Messages ──────────────────────────────────────────
function subscribeToMessages(chatId) {
  if (messagesUnsub) messagesUnsub();
  const area = $('messagesArea');
  area.innerHTML = '';

  // FIX 3: Recreate the permanent typing indicator at the bottom
  // It lives inside messagesArea but is rebuilt each time we open a chat
  const typingEl = document.createElement('div');
  typingEl.id = 'typingIndicator';
  typingEl.className = 'typing-group';
  typingEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  area.appendChild(typingEl);

  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  let firstLoad = true;
  messagesUnsub = onSnapshot(q, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastMsg = msgs[msgs.length - 1];
    if (!firstLoad && lastMsg && lastMsg.senderId !== currentUser.uid) {
      playNotifSound();
    }
    firstLoad = false;
    renderMessages(msgs);

    // NEW FEATURE A: Mark messages as read when chat is open and visible
    if (!document.hidden && currentChatId === chatId) {
      markMessagesRead(chatId, msgs);
    }
  });
}

// NEW FEATURE B: Mark messages read
async function markMessagesRead(chatId, msgs) {
  const unread = msgs.filter(m => m.senderId !== currentUser.uid && !m.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach(m => {
    batch.update(doc(db, 'chats', chatId, 'messages', m.id), { read: true });
  });
  batch.update(doc(db, 'chats', chatId), { [`unreadCount.${currentUser.uid}`]: 0 });
  await batch.commit().catch(() => {});
}

function renderMessages(messages) {
  const area = $('messagesArea');
  const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;

  // FIX 3: We remove everything EXCEPT the typing indicator, then re-render
  // This way typingIndicator element keeps its stable id and isn't wiped
  const typingEl = $('typingIndicator');
  area.innerHTML = '';
  if (typingEl) area.appendChild(typingEl);

  let lastDate = null, lastSender = null, groupEl = null;

  for (const msg of messages) {
    const dateLabel = fmtDateLabel(msg.createdAt);
    if (dateLabel !== lastDate) {
      const div = document.createElement('div');
      div.className = 'date-divider'; div.textContent = dateLabel;
      area.insertBefore(div, typingEl || null);
      lastDate = dateLabel; lastSender = null; groupEl = null;
    }

    const isMine = msg.senderId === currentUser.uid;
    if (msg.senderId !== lastSender || !groupEl) {
      groupEl = document.createElement('div');
      groupEl.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
      area.insertBefore(groupEl, typingEl || null);
      lastSender = msg.senderId;
    }

    const row = document.createElement('div');
    row.className = 'msg-row';
    row.dataset.msgId = msg.id;

    if (msg.replyTo) {
      const replyBubble = document.createElement('div');
      replyBubble.className = 'reply-context';
      replyBubble.innerHTML = `<span class="reply-name">${escHtml(msg.replyTo.senderName)}</span><span class="reply-text">${escHtml((msg.replyTo.text || '').slice(0, 80))}</span>`;
      row.appendChild(replyBubble);
    }

    if (msg.type === 'image' || msg.type === 'gif') {
      const wrap = document.createElement('div'); wrap.className = 'msg-media-wrap';
      const img  = document.createElement('img');
      img.src = msg.url || msg.text || '';
      img.className = 'msg-media'; img.loading = 'lazy'; img.decoding = 'async';
      img.style.background = 'var(--bg-overlay)'; img.style.minHeight = '80px';
      img.addEventListener('load', () => { img.style.background = ''; img.style.minHeight = ''; });
      img.addEventListener('error', () => { wrap.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Image unavailable</div>'; });
      img.addEventListener('click', () => openLightbox(msg.url || msg.text));
      wrap.appendChild(img); row.appendChild(wrap);
    } else if (msg.type === 'audio') {
      // NEW FEATURE C: Voice memo playback
      const audioWrap = document.createElement('div');
      audioWrap.className = 'msg-audio-wrap';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = msg.url || msg.text || '';
      audio.style.cssText = 'max-width:240px;border-radius:24px;height:36px';
      audioWrap.appendChild(audio);
      row.appendChild(audioWrap);
    } else {
      const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
      bubble.innerHTML = linkify(escHtml(msg.text || ''));
      if (msg.edited) {
        const editedTag = document.createElement('span');
        editedTag.className = 'edited-tag'; editedTag.textContent = ' (edited)';
        bubble.appendChild(editedTag);
      }
      row.appendChild(bubble);
    }

    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      const reactionBar = document.createElement('div'); reactionBar.className = 'reaction-bar';
      const counts = {};
      Object.values(msg.reactions).forEach(emoji => { counts[emoji] = (counts[emoji] || 0) + 1; });
      Object.entries(counts).forEach(([emoji, count]) => {
        const pill = document.createElement('button'); pill.className = 'reaction-pill';
        const myReaction = msg.reactions?.[currentUser.uid];
        if (myReaction === emoji) pill.classList.add('my-reaction');
        pill.innerHTML = `${emoji} ${count}`;
        pill.addEventListener('click', () => toggleReaction(msg.id, emoji));
        reactionBar.appendChild(pill);
      });
      row.appendChild(reactionBar);
    }

    row.title = fmtFull(msg.createdAt);

    const showCtxMenu = (e) => {
      e.preventDefault();
      showMessageContextMenu(e, msg, isMine);
    };
    row.addEventListener('contextmenu', showCtxMenu);
    let longPressTimer;
    row.addEventListener('touchstart', () => { longPressTimer = setTimeout(() => showCtxMenu({ clientX: 0, clientY: 0, preventDefault: () => {} }), 600); }, { passive: true });
    row.addEventListener('touchend', () => clearTimeout(longPressTimer));

    groupEl.appendChild(row);
  }

  // Show read receipt on last sent message
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const isMine = last.senderId === currentUser.uid;
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    meta.textContent = fmtFull(last.createdAt);
    if (isMine) {
      const tick = document.createElement('span');
      tick.className = `msg-tick${last.read ? ' read' : ''}`;
      // FIX: Show double-tick for sent (✓✓) vs single tick pending
      tick.textContent = last.read ? ' ✓✓' : ' ✓';
      tick.title = last.read ? 'Seen' : 'Sent';
      meta.appendChild(tick);
    }
    area.insertBefore(meta, typingEl || null);
  }

  if (atBottom || messages.length <= 1) area.scrollTop = area.scrollHeight;
}

// ── Feature 2: Message context menu ──────────────────
function showMessageContextMenu(e, msg, isMine) {
  document.querySelector('.msg-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'msg-ctx-menu';

  const reactions = ['❤️', '😂', '👍', '🔥', '😮', '😢'];
  const reactionRow = document.createElement('div'); reactionRow.className = 'ctx-reactions';
  reactions.forEach(emoji => {
    const btn = document.createElement('button'); btn.className = 'ctx-reaction-btn';
    btn.textContent = emoji;
    const myReaction = msg.reactions?.[currentUser.uid];
    if (myReaction === emoji) btn.style.background = 'var(--accent-soft)';
    btn.addEventListener('click', () => { toggleReaction(msg.id, emoji); menu.remove(); });
    reactionRow.appendChild(btn);
  });
  menu.appendChild(reactionRow);

  const actions = [
    { label: '↩ Reply', fn: () => setReplyTo(msg) },
    ...(msg.text ? [{ label: '📋 Copy text', fn: () => { navigator.clipboard.writeText(msg.text).then(() => toast('Copied!')); } }] : []),
    ...(isMine && msg.type === 'text' ? [{ label: '✏️ Edit', fn: () => startEditMessage(msg) }] : []),
    ...(isMine ? [{ label: '🗑 Delete', fn: () => deleteMessage(msg.id), danger: true }] : []),
  ];

  actions.forEach(({ label, fn, danger }) => {
    const btn = document.createElement('button');
    btn.className = `ctx-action${danger ? ' danger' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => { fn(); menu.remove(); });
    menu.appendChild(btn);
  });

  const rect = e.target?.getBoundingClientRect?.() || { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
  menu.style.cssText = `position:fixed;z-index:5000;top:${Math.min(e.clientY || rect.top, window.innerHeight - 250)}px;left:${Math.min(e.clientX || rect.left, window.innerWidth - 220)}px`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function toggleReaction(msgId, emoji) {
  if (!currentChatId) return;
  const msgRef = doc(db, 'chats', currentChatId, 'messages', msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;
  const reactions = snap.data().reactions || {};
  const myReaction = reactions[currentUser.uid];
  if (myReaction === emoji) {
    const newReactions = { ...reactions };
    delete newReactions[currentUser.uid];
    await updateDoc(msgRef, { reactions: newReactions });
  } else {
    await updateDoc(msgRef, { [`reactions.${currentUser.uid}`]: emoji });
    // Confetti on heart reaction
    if (emoji === '❤️' && window.__triggerConfetti) {
      window.__triggerConfetti(window.innerWidth / 2, window.innerHeight / 2);
    }
  }
}

function setReplyTo(msg) {
  replyingTo = msg;
  const bar = $('replyBar');
  if (bar) {
    bar.classList.remove('hidden');
    const text = msg.type === 'text' ? (msg.text || '').slice(0, 80) : msg.type === 'image' ? '📷 Photo' : '🎞 GIF';
    $('replyPreview').textContent = text;
    $('replyName').textContent = msg.senderName || 'User';
  }
  $('msgInput').focus();
}
function clearReply() {
  replyingTo = null;
  $('replyBar')?.classList.add('hidden');
}

async function deleteMessage(msgId) {
  if (!currentChatId) return;
  if (!confirm('Delete this message?')) return;
  await deleteDoc(doc(db, 'chats', currentChatId, 'messages', msgId));
  toast('Message deleted');
}

function startEditMessage(msg) {
  const fiveMinutes = 5 * 60 * 1000;
  const msgTime = msg.createdAt?.toDate?.() || new Date(msg.createdAt || 0);
  if (Date.now() - msgTime > fiveMinutes) { toast('Can only edit messages within 5 minutes', 'error'); return; }
  const inp = $('msgInput');
  inp.value = msg.text;
  inp.focus();
  inp.dataset.editingId = msg.id;
  $('sendBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;color:#fff"><polyline points="20 6 9 17 4 12"/></svg>`;
  toast('Editing message — press Enter to save');
}

function clearEdit() {
  const inp = $('msgInput');
  delete inp.dataset.editingId;
  $('sendBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}

// ── Feature 7: Message search ─────────────────────────
function toggleMessageSearch() {
  const bar = $('msgSearchBar');
  if (!bar) return;
  searchMode = !searchMode;
  bar.classList.toggle('hidden', !searchMode);
  if (searchMode) $('msgSearchInput').focus();
  else {
    $('msgSearchInput').value = '';
    document.querySelectorAll('.msg-row.search-match,.msg-row.search-no-match').forEach(el => {
      el.classList.remove('search-match', 'search-no-match');
    });
  }
}

// ── Lightbox ──────────────────────────────────────────
function openLightbox(src) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  const img = document.createElement('img'); img.src = src;
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.9)';
  lb.appendChild(img);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

// ── Feature 15: Media gallery ─────────────────────────
async function openMediaGallery() {
  if (!currentChatId) return;
  const q = query(collection(db, 'chats', currentChatId, 'messages'), where('type', 'in', ['image', 'gif']), orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(q);
  const modal = $('mediaGalleryModal');
  const grid = $('mediaGalleryGrid');
  grid.innerHTML = '';
  if (snap.empty) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:14px;text-align:center;padding:20px">No media shared yet</div>';
  } else {
    snap.docs.forEach(d => {
      const data = d.data();
      const img = document.createElement('img');
      img.src = data.url || data.text;
      img.className = 'gallery-thumb';
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(img.src));
      grid.appendChild(img);
    });
  }
  showModal('mediaGalleryModal');
}

// ── Input bar ─────────────────────────────────────────
function setupInputBar() {
  const inp = $('msgInput');
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
    // FIX 8: Escape now also clears edit mode
    if (e.key === 'Escape') { clearReply(); clearEdit(); }
  });
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
    setTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setTyping(false), 2000);
  });
  $('sendBtn').addEventListener('click', sendTextMessage);
  $('attachBtn').addEventListener('click', () => $('fileUploadInput').click());
  $('fileUploadInput').addEventListener('change', handleFileUpload);
  $('gifBtn').addEventListener('click', toggleGifPanel);
  $('emojiBtn').addEventListener('click', toggleEmojiPanel);
  $('cancelReplyBtn')?.addEventListener('click', clearReply);
  $('msgSearchToggleBtn')?.addEventListener('click', toggleMessageSearch);
  $('mediaGalleryBtn')?.addEventListener('click', openMediaGallery);
  $('closeMediaGallery')?.addEventListener('click', () => hideModal('mediaGalleryModal'));

  // NEW FEATURE C: Voice memo button
  const voiceBtn = $('voiceMemoBtn');
  if (voiceBtn) {
    voiceBtn.addEventListener('mousedown', startVoiceMemo);
    voiceBtn.addEventListener('touchstart', startVoiceMemo, { passive: true });
    voiceBtn.addEventListener('mouseup', stopVoiceMemo);
    voiceBtn.addEventListener('touchend', stopVoiceMemo);
    voiceBtn.addEventListener('mouseleave', stopVoiceMemo);
  }

  let gifTimer = null;
  $('gifSearch').addEventListener('input', e => {
    clearTimeout(gifTimer);
    gifTimer = setTimeout(() => loadGifs(e.target.value.trim()), 400);
  });
}

async function sendTextMessage() {
  const inp = $('msgInput');
  let text = inp.value.trim();
  if (!text || !currentChatId) return;

  // NEW FEATURE E: apply emoji shortcodes
  text = applyEmojiShortcodes(text);

  if (inp.dataset.editingId) {
    const msgId = inp.dataset.editingId;
    await updateDoc(doc(db, 'chats', currentChatId, 'messages', msgId), { text, edited: true });
    inp.value = ''; inp.style.height = 'auto';
    clearEdit();
    toast('Message updated');
    return;
  }

  inp.value = ''; inp.style.height = 'auto';
  setTyping(false); clearTimeout(typingTimeout);
  await sendMessage({ type: 'text', text, replyTo: replyingTo ? { text: replyingTo.text, senderName: replyingTo.senderName, msgId: replyingTo.id } : null });
  clearReply();
}

async function sendMessage(payload) {
  // Bridge for media.js — expose this function globally
  window.__pulseSendMessageDirect = sendMessage;
  if (!currentChatId) return;
  const msg = {
    senderId: currentUser.uid,
    senderName: currentUserData.displayName,
    createdAt: serverTimestamp(),
    read: false,
    ...payload
  };
  const preview =
    payload.type === 'image' ? '📷 Photo' :
    payload.type === 'gif'   ? '🎞 GIF'   :
    payload.type === 'audio' ? '🎤 Voice memo' :
    (payload.text || '').slice(0, 60);
  try {
    // FIX 4: Use Firestore increment() instead of racy getDoc + manual increment
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'chats', currentChatId, 'messages')), msg);
    batch.update(doc(db, 'chats', currentChatId), {
      lastMessage:     preview,
      lastMessageTime: serverTimestamp(),
      lastMessageType: payload.type,
      lastSenderId:    currentUser.uid,
      [`unreadCount.${currentFriendId}`]: increment(1),
    });
    await batch.commit();
  } catch(e) {
    // If update fails (doc might not exist yet), try set with merge
    try {
      await setDoc(doc(db, 'chats', currentChatId), {
        lastMessage: preview,
        lastMessageTime: serverTimestamp(),
        lastMessageType: payload.type,
        lastSenderId: currentUser.uid,
        participants: [currentUser.uid, currentFriendId],
      }, { merge: true });
      await addDoc(collection(db, 'chats', currentChatId, 'messages'), msg);
    } catch(e2) {
      toast('Send failed: ' + e2.message, 'error');
    }
  }
}

// ── Voice memo (NEW FEATURE C) ────────────────────────
async function startVoiceMemo() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      if (blob.size < 1000) return; // too short
      const reader = new FileReader();
      reader.onload = async () => {
        await sendMessage({ type: 'audio', url: reader.result, text: 'Voice memo' });
        toast('Voice memo sent 🎤', 'success');
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    isRecording = true;
    const btn = $('voiceMemoBtn');
    if (btn) { btn.style.background = '#ff4757'; btn.title = 'Release to send'; }
    toast('Recording… release to send');
  } catch(e) {
    toast('Mic access denied', 'error');
  }
}

function stopVoiceMemo() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  mediaRecorder.stop();
  const btn = $('voiceMemoBtn');
  if (btn) { btn.style.background = ''; btn.title = 'Hold to record voice memo'; }
}

// ── Image Upload ──────────────────────────────────────
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file || !currentChatId) return;
  e.target.value = '';
  if (!file.type.startsWith('image/')) { toast('Images only', 'error'); return; }
  if (file.size > 20 * 1024 * 1024)   { toast('Max file size is 20MB', 'error'); return; }

  const indicator = document.createElement('div');
  indicator.className = 'upload-indicator';
  indicator.innerHTML = '<div class="upload-spinner"></div> Processing image…';
  $('chatInputBar').prepend(indicator);

  try {
    const url = await resizeImage(file, 1200, 1200, 0.82);
    await sendMessage({ type: 'image', url, text: 'Photo' });
    toast('Image sent!', 'success');
  } catch(err) {
    toast('Could not process image: ' + err.message, 'error');
  } finally {
    indicator.remove();
  }
}

// ── GIF Panel ─────────────────────────────────────────
function toggleGifPanel() {
  const panel = $('gifPanel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    $('gifSearch').focus();
    loadGifs('');
    $('emojiPanel').classList.add('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

async function loadGifs(searchQuery) {
  const grid = $('gifGrid');
  grid.innerHTML = '<div class="gif-loading">Loading GIFs…</div>';
  try {
    const endpoint = searchQuery
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(searchQuery)}&limit=24&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=g`;

    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`Giphy error ${res.status}`);
    const data = await res.json();
    renderGifs(data.data || []);
  } catch(err) {
    grid.innerHTML = `<div class="gif-no-key">Couldn't load GIFs.<br><a href="https://developers.giphy.com" target="_blank" style="color:var(--accent)">Get a free API key</a></div>`;
  }
}

function renderGifs(gifs) {
  const grid = $('gifGrid');
  grid.innerHTML = '';
  if (!gifs.length) { grid.innerHTML = '<div class="gif-loading">No GIFs found</div>'; return; }
  gifs.forEach(gif => {
    const url   = gif.images?.original?.url      || gif.images?.downsized?.url;
    const thumb = gif.images?.fixed_width_small?.url || url;
    if (!url) return;
    const img = document.createElement('img');
    img.src = thumb; img.className = 'gif-thumb'; img.loading = 'lazy'; img.alt = gif.title || 'GIF';
    img.addEventListener('click', () => { sendMessage({ type: 'gif', url, text: 'GIF' }); $('gifPanel').classList.add('hidden'); });
    grid.appendChild(img);
  });
}

// ── Emoji panel ───────────────────────────────────────
const EMOJIS = ['😀','😂','🥹','😍','🤩','😎','🥳','🤔','😮','😢','😭','😡','🔥','❤️','💯','👍','👎','👏','🙌','🤝','💪','✌️','🫶','💀','😈','🎉','🎊','🏆','⭐','✨','💫','🌈','🌙','☀️','🍕','🍦','🎮','📱','💻','🐶','🐱','🦊','🦁','🐸','🍔','🤣','😏','🫡'];

function toggleEmojiPanel() {
  const panel = $('emojiPanel');
  if (panel.classList.contains('hidden')) {
    if (!panel.dataset.built) {
      EMOJIS.forEach(em => {
        const btn = document.createElement('button'); btn.className = 'emoji-btn'; btn.textContent = em;
        btn.addEventListener('click', () => {
          const inp = $('msgInput');
          const pos = inp.selectionStart || inp.value.length;
          inp.value = inp.value.slice(0, pos) + em + inp.value.slice(pos);
          inp.focus(); panel.classList.add('hidden');
        });
        panel.appendChild(btn);
      });
      panel.dataset.built = '1';
    }
    panel.classList.remove('hidden');
    $('gifPanel').classList.add('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('#gifPanel')   && !e.target.closest('#gifBtn'))   $('gifPanel')?.classList.add('hidden');
  if (!e.target.closest('#emojiPanel') && !e.target.closest('#emojiBtn')) $('emojiPanel')?.classList.add('hidden');
  if (!e.target.closest('.msg-ctx-menu')) document.querySelector('.msg-ctx-menu')?.remove();
  if (!e.target.closest('#emojiHint')) $('emojiHint')?.classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════
//  PULSE — CALL SYSTEM v3  (Complete rewrite)
//  Clean WebRTC signalling over Firestore
//  Features: voice calls, video calls, mute, camera toggle,
//            screen share (beta), in-call chat, emoji reactions,
//            draggable PiP, animated bg, call timer
// ═══════════════════════════════════════════════════════════

// ── Header call buttons ──────────────────────────────────
$('callBtn').addEventListener('click',  () => { if (currentFriendData) startCall('voice'); });
$('videoBtn').addEventListener('click', () => { if (currentFriendData) startCall('video'); });

// ── WebRTC state ─────────────────────────────────────────
let localStream     = null;
let screenStream    = null;
let pc              = null;   // RTCPeerConnection
let callDocId       = null;
let callType        = null;
let callRole        = null;   // 'caller' | 'callee'
let callUnsub       = null;   // Firestore snapshot unsub for the call doc
let calleeCandUnsub = null;   // Firestore snapshot unsub for callee candidates
let callerCandUnsub = null;   // Firestore snapshot unsub for caller candidates
let callTimerInt    = null;
let callStartedAt   = null;
let isMuted         = false;
let isCamOff        = false;
let isScreenSharing = false;
let betaEnabled     = localStorage.getItem('pulse_beta') === '1';
let bgAnimStop      = null;
let dotInterval     = null;   // "calling..." dots animation

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ]
};

// ── Beta toggle ──────────────────────────────────────────
function applyBetaUI() {
  const btn  = $('betaToggleBtn');  if (!btn) return;
  const item = $('screenShareCtrlItem');
  btn.textContent = betaEnabled ? 'On ✓' : 'Off';
  btn.style.color       = betaEnabled ? 'var(--accent)' : '';
  btn.style.borderColor = betaEnabled ? 'var(--border-accent)' : '';
  if (item) item.style.display = betaEnabled ? 'flex' : 'none';
}
applyBetaUI();

$('betaToggleBtn').addEventListener('click', () => {
  betaEnabled = !betaEnabled;
  localStorage.setItem('pulse_beta', betaEnabled ? '1' : '0');
  applyBetaUI();
  toast(betaEnabled ? '🎉 Beta features on — screen share unlocked!' : 'Beta features off');
});

// ── Overlay visibility ───────────────────────────────────
function openCallOverlay()  { $('callOverlay').style.display = 'block'; }
function closeCallOverlay() { $('callOverlay').style.display = 'none';  }

// ── Status text (two elements in HTML) ──────────────────
function setCallStatus(text) {
  const a = $('callType');      if (a) a.textContent = text;
  const b = $('callTopStatus'); if (b) b.textContent = text;
}

// ── Timer ────────────────────────────────────────────────
function startCallTimer() {
  if (callTimerInt) return;   // already running
  callStartedAt = Date.now();
  const el = $('callTimer');
  if (el) el.style.display = '';
  callTimerInt = setInterval(() => {
    const s   = Math.floor((Date.now() - callStartedAt) / 1000);
    const m   = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    const el2 = $('callTimer');
    if (el2) el2.textContent = `${m}:${sec}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInt) { clearInterval(callTimerInt); callTimerInt = null; }
  callStartedAt = null;
  const el = $('callTimer');
  if (el) { el.style.display = 'none'; el.textContent = '0:00'; }
}

// ── Animated background ──────────────────────────────────
function startBgAnim() {
  const canvas = $('callBgCanvas'); if (!canvas) return () => {};
  const ctx    = canvas.getContext('2d');
  let animId;
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  const pts = Array.from({ length: 30 }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: Math.random() * 1.6 + 0.4,
    dx: (Math.random() - 0.5) * 0.3,
    dy: (Math.random() - 0.5) * 0.3,
    a: Math.random() * 0.35 + 0.08,
  }));
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, canvas.width * 0.6
    );
    g.addColorStop(0, 'rgba(255,107,53,0.07)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,190,11,${p.a})`; ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
    });
    animId = requestAnimationFrame(draw);
  };
  draw();
  return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
}

// ── Draggable PiP ────────────────────────────────────────
function makePipDraggable() {
  const pip = $('localVideoPip'); if (!pip) return;
  let drag = false, ox = 0, oy = 0;
  const down = (cx, cy) => {
    drag = true;
    const r = pip.getBoundingClientRect();
    ox = cx - r.left; oy = cy - r.top;
  };
  const move = (cx, cy) => {
    if (!drag) return;
    let nx = cx - ox, ny = cy - oy;
    nx = Math.max(8, Math.min(window.innerWidth  - pip.offsetWidth  - 8, nx));
    ny = Math.max(70, Math.min(window.innerHeight - pip.offsetHeight - 150, ny));
    pip.style.left = nx + 'px'; pip.style.top = ny + 'px'; pip.style.right = 'auto';
  };
  const up = () => { drag = false; };
  pip.addEventListener('mousedown',  e => { down(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
  document.addEventListener('mouseup',   up);
  pip.addEventListener('touchstart', e => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('touchend', up);
}

// ── Reset overlay to fresh state ─────────────────────────
function resetOverlayUI(peerData, type) {
  // Identity
  setAvatar($('callAvatar'), peerData);
  $('callName').textContent = peerData.displayName;
  // Status
  setCallStatus(type === 'video' ? '📹 Video calling…' : '📞 Voice calling…');
  // Timer
  const timerEl = $('callTimer');
  if (timerEl) { timerEl.style.display = 'none'; timerEl.textContent = '0:00'; }
  // Control state
  isMuted = false; isCamOff = false; isScreenSharing = false;
  syncMuteBtn(); syncCamBtn();
  // Camera controls only for video calls
  const camItem = $('cameraCtrlItem');
  if (camItem) camItem.style.display = type === 'video' ? 'flex' : 'none';
  // PiP — hidden until stream arrives
  const pip = $('localVideoPip');
  if (pip) { pip.style.display = 'none'; pip.style.left = ''; pip.style.top = ''; pip.style.right = '16px'; }
  // Reset video elements
  const localV = $('localVideo');     if (localV)  { localV.srcObject = null; }
  const remoteV = $('remoteVideo');   if (remoteV) { remoteV.srcObject = null; remoteV.style.display = 'none'; }
  const screenV = $('screenShareVideo'); if (screenV) { screenV.srcObject = null; screenV.style.display = 'none'; }
  const remoteA = $('remoteAudio');   if (remoteA) { remoteA.srcObject = null; }
  // Screen share indicator
  const si = $('screenShareIndicator'); if (si) si.style.display = 'none';
  // Voice center — visible by default (hidden once video connects)
  $('callVoiceCenter').style.display = '';
  // Panels
  showChatPanel(false);
  showEmojiPicker(false);
  $('callChatMessages').innerHTML = '';
  $('callReactLayer').innerHTML = '';
  // Beta UI
  applyBetaUI();
  // BG animation
  if (bgAnimStop) { bgAnimStop(); bgAnimStop = null; }
  bgAnimStop = startBgAnim();
  // Draggable PiP
  makePipDraggable();
}

// ── Panel helpers ────────────────────────────────────────
function showChatPanel(show) {
  const p = $('callChatPanel'); if (!p) return;
  p.classList.toggle('call-chat-panel-hidden', !show);
}
function showEmojiPicker(show) {
  const p = $('callEmojiPicker'); if (!p) return;
  p.classList.toggle('call-emoji-picker-hidden', !show);
}

// ── Mute / cam button sync ───────────────────────────────
function syncMuteBtn() {
  const btn  = $('muteBtn');     if (!btn) return;
  const icon = $('muteBtnIcon');
  const lbl  = $('muteLbl');
  btn.classList.toggle('call-btn-off', isMuted);
  if (lbl) lbl.textContent = isMuted ? 'Unmute' : 'Mute';
  if (icon) icon.innerHTML = isMuted
    ? `<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>`
    : `<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>`;
}
function syncCamBtn() {
  const btn = $('cameraBtn'); if (!btn) return;
  btn.classList.toggle('call-btn-off', isCamOff);
}

// ── Handle remote tracks ─────────────────────────────────
// Called each time a remote track arrives via RTCPeerConnection.ontrack
function handleRemoteTrack(event, type) {
  const stream = event.streams[0]; if (!stream) return;

  // Always wire audio — covers both voice and video calls
  const audioEl = $('remoteAudio');
  if (audioEl && audioEl.srcObject !== stream) {
    audioEl.srcObject = stream;
    const prom = audioEl.play();
    if (prom) {
      prom.catch(err => {
        if (err.name === 'NotAllowedError') {
          // Browser blocked autoplay — resume on first user interaction
          const resume = () => { audioEl.play().catch(() => {}); document.removeEventListener('click', resume); };
          document.addEventListener('click', resume, { once: true });
          toast('Tap anywhere to enable audio 🔊');
        }
      });
    }
  }

  // Wire video track only for video calls
  if (event.track.kind === 'video' && type === 'video') {
    const rv = $('remoteVideo');
    if (rv) {
      rv.srcObject = stream;
      rv.style.display = '';
      $('callVoiceCenter').style.display = 'none';
    }
  }

  // Mark as connected and start timer
  setCallStatus(type === 'video' ? '📹 Connected' : '📞 Connected');
  startCallTimer();
}

// ── Clean up all WebRTC resources ───────────────────────
async function endCall() {
  // Stop dots animation
  if (dotInterval) { clearInterval(dotInterval); dotInterval = null; }

  // Unsubscribe Firestore listeners
  if (callUnsub)       { callUnsub();       callUnsub       = null; }
  if (calleeCandUnsub) { calleeCandUnsub(); calleeCandUnsub = null; }
  if (callerCandUnsub) { callerCandUnsub(); callerCandUnsub = null; }

  // Signal the other side that the call has ended
  if (callDocId) {
    updateDoc(doc(db, 'calls', callDocId), { status: 'ended' }).catch(() => {});
    callDocId = null;
  }

  // Close peer connection
  if (pc) { pc.close(); pc = null; }

  // Stop all local media tracks
  if (localStream)  { localStream.getTracks().forEach(t => t.stop());  localStream  = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }

  // Stop background animation
  if (bgAnimStop) { bgAnimStop(); bgAnimStop = null; }

  // Stop timer
  stopCallTimer();

  // Clear all media elements
  const ra = $('remoteAudio');     if (ra) ra.srcObject = null;
  const lv = $('localVideo');      if (lv) lv.srcObject = null;
  const rv = $('remoteVideo');     if (rv) { rv.srcObject = null; rv.style.display = 'none'; }
  const sv = $('screenShareVideo'); if (sv) { sv.srcObject = null; sv.style.display = 'none'; }

  // Reset flags
  isMuted = false; isCamOff = false; isScreenSharing = false;
  callType = null; callRole = null;

  closeCallOverlay();
}

// ── Wire up all call overlay buttons ────────────────────
function wireCallButtons() {
  // End call
  $('endCallBtn').onclick = () => { endCall(); toast('Call ended'); };

  // Mute
  $('muteBtn').onclick = () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0]; if (!track) return;
    isMuted = !isMuted;
    track.enabled = !isMuted;
    syncMuteBtn();
    toast(isMuted ? 'Muted 🔇' : 'Unmuted 🎙');
  };

  // Camera
  const camBtn = $('cameraBtn');
  if (camBtn) camBtn.onclick = () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0]; if (!track) return;
    isCamOff = !isCamOff;
    track.enabled = !isCamOff;
    syncCamBtn();
    toast(isCamOff ? 'Camera off 📷' : 'Camera on 📹');
  };

  // Emoji reactions
  $('callReactBtn').onclick = e => {
    e.stopPropagation();
    showEmojiPicker($('callEmojiPicker').classList.contains('call-emoji-picker-hidden'));
  };
  $('callEmojiPicker').querySelectorAll('.call-emoji-opt').forEach(btn => {
    btn.onclick = () => { sendFloatEmoji(btn.dataset.emoji); showEmojiPicker(false); };
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#callEmojiPicker') && !e.target.closest('#callReactBtn')) showEmojiPicker(false);
  });

  // In-call chat
  $('callChatBtn').onclick = () => {
    const isHidden = $('callChatPanel').classList.contains('call-chat-panel-hidden');
    showChatPanel(isHidden);
    if (isHidden) { const b = $('callChatBadge'); if (b) b.style.display = 'none'; }
  };
  $('closeCallChatBtn').onclick = () => showChatPanel(false);

  const sendCallChat = () => {
    const inp = $('callChatInput');
    const txt = inp.value.trim(); if (!txt) return;
    appendCallChatMsg('You', txt);
    inp.value = '';
  };
  $('callChatSendBtn').onclick = sendCallChat;
  $('callChatInput').onkeydown = e => { if (e.key === 'Enter') sendCallChat(); };

  // Screen share (beta)
  const ssBtn = $('screenShareBtn');
  if (ssBtn) ssBtn.onclick = async () => {
    if (!betaEnabled) { toast('Enable Beta Features in Settings first', 'error'); return; }
    if (isScreenSharing) await stopScreenShare();
    else await beginScreenShare();
  };
}

// ── Float emoji ──────────────────────────────────────────
function sendFloatEmoji(emoji) {
  const layer = $('callReactLayer'); if (!layer) return;
  const el = document.createElement('div');
  el.className = 'call-float-emoji';
  el.textContent = emoji;
  el.style.left = (10 + Math.random() * 70) + '%';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── In-call chat message ─────────────────────────────────
function appendCallChatMsg(who, text) {
  const box = $('callChatMessages'); if (!box) return;
  const el  = document.createElement('div');
  el.className = 'call-chat-msg';
  el.innerHTML = `<span class="ccm-who">${escHtml(who)}</span><span class="ccm-text">${escHtml(text)}</span>`;
  box.appendChild(el);
  box.scrollTop = 99999;
  if ($('callChatPanel').classList.contains('call-chat-panel-hidden') && who !== 'You') {
    const b = $('callChatBadge'); if (b) b.style.display = 'flex';
  }
}

// ═══════════════════════════════════════════════════════
//  START OUTGOING CALL
// ═══════════════════════════════════════════════════════
async function startCall(type) {
  // Prevent double-calling
  if (pc || callDocId) { await endCall(); }

  callType = type;
  callRole = 'caller';

  resetOverlayUI(currentFriendData, type);
  openCallOverlay();
  wireCallButtons();

  // Animated "calling…" dots
  let dots = 0;
  dotInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    setCallStatus((type === 'video' ? '📹 Video' : '📞 Voice') + ' calling' + '.'.repeat(dots));
  }, 600);

  try {
    // 1. Get local media
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });

    if (type === 'video') {
      $('localVideo').srcObject = localStream;
      $('localVideoPip').style.display = '';
    }

    // 2. Create peer connection
    pc = new RTCPeerConnection(ICE_CONFIG);

    // Add local tracks
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // 3. Create Firestore call document
    const callRef = doc(collection(db, 'calls'));
    callDocId = callRef.id;

    // 4. ICE candidate handler — send to Firestore as they trickle in
    pc.onicecandidate = async ev => {
      if (ev.candidate) {
        await addDoc(collection(db, 'calls', callDocId, 'callerCandidates'), ev.candidate.toJSON())
          .catch(() => {});
      }
    };

    // 5. Remote track handler
    pc.ontrack = ev => {
      clearInterval(dotInterval); dotInterval = null;
      handleRemoteTrack(ev, type);
    };

    // 6. ICE connection state monitoring
    pc.oniceconnectionstatechange = () => {
      const s = pc?.iceConnectionState;
      if (s === 'disconnected' || s === 'failed') {
        endCall();
        toast('Call disconnected', 'error');
      }
    };

    // 7. Create and set local offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 8. Write call document to Firestore
    await setDoc(callRef, {
      offer:     { type: offer.type, sdp: offer.sdp },
      callerId:  currentUser.uid,
      calleeId:  currentFriendId,
      type,
      status:    'calling',
      createdAt: serverTimestamp(),
    });

    // 9. Watch call doc for answer from callee
    callUnsub = onSnapshot(callRef, async snap => {
      const data = snap.data();
      if (!data) return;

      // Callee answered — set remote description
      if (data.answer && pc && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (e) {
          console.warn('setRemoteDescription failed:', e);
        }

        // Now subscribe to callee ICE candidates (only once)
        if (!calleeCandUnsub) {
          calleeCandUnsub = onSnapshot(
            collection(db, 'calls', callDocId, 'calleeCandidates'),
            s => {
              s.docChanges().forEach(async ch => {
                if (ch.type === 'added' && pc) {
                  await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(() => {});
                }
              });
            }
          );
        }
      }

      if (data.status === 'ended') {
        endCall();
      }
    });

  } catch (err) {
    clearInterval(dotInterval); dotInterval = null;
    await endCall();
    toast(
      err.name === 'NotAllowedError'
        ? 'Mic/camera access denied 🎙'
        : 'Could not start call: ' + err.message,
      'error'
    );
  }
}

// ═══════════════════════════════════════════════════════
//  ANSWER INCOMING CALL
// ═══════════════════════════════════════════════════════
async function answerCall(callerData, callId, callData) {
  // Clean up any existing call first
  if (pc || callDocId) { await endCall(); }

  callType = callData.type;
  callRole = 'callee';
  callDocId = callId;

  // Set up the friend state so the overlay shows correctly
  currentFriendId   = callData.callerId;
  currentFriendData = callerData;

  resetOverlayUI(callerData, callData.type);
  openCallOverlay();
  wireCallButtons();
  setCallStatus(callData.type === 'video' ? '📹 Connecting…' : '📞 Connecting…');

  try {
    // 1. Get local media
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: callData.type === 'video'
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        : false,
    });

    if (callData.type === 'video') {
      $('localVideo').srcObject = localStream;
      $('localVideoPip').style.display = '';
    }

    // 2. Create peer connection
    pc = new RTCPeerConnection(ICE_CONFIG);

    // Add local tracks
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // 3. ICE candidate handler — send callee candidates to Firestore
    pc.onicecandidate = async ev => {
      if (ev.candidate) {
        await addDoc(collection(db, 'calls', callId, 'calleeCandidates'), ev.candidate.toJSON())
          .catch(() => {});
      }
    };

    // 4. Remote track handler
    pc.ontrack = ev => handleRemoteTrack(ev, callData.type);

    // 5. ICE connection state monitoring
    pc.oniceconnectionstatechange = () => {
      const s = pc?.iceConnectionState;
      if (s === 'disconnected' || s === 'failed') {
        endCall();
        toast('Call disconnected', 'error');
      }
    };

    // 6. Set remote description from caller's offer
    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    // 7. Subscribe to caller's ICE candidates BEFORE creating answer
    //    so we don't miss any that arrive during negotiation
    callerCandUnsub = onSnapshot(
      collection(db, 'calls', callId, 'callerCandidates'),
      s => {
        s.docChanges().forEach(async ch => {
          if (ch.type === 'added' && pc) {
            await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(() => {});
          }
        });
      }
    );

    // 8. Create answer and set local description
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 9. Write answer back to Firestore — this triggers caller's snapshot
    await updateDoc(doc(db, 'calls', callId), {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'connected',
    });

    // 10. Start timer immediately on answer (remote tracks may be slow)
    startCallTimer();
    setCallStatus(callData.type === 'video' ? '📹 Connected' : '📞 Connected');

    // 11. Watch for call end
    callUnsub = onSnapshot(doc(db, 'calls', callId), snap => {
      if (snap.data()?.status === 'ended') endCall();
    });

  } catch (err) {
    await endCall();
    toast('Could not answer call: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
//  INCOMING CALL LISTENER
// ═══════════════════════════════════════════════════════
function listenForIncomingCalls() {
  const q = query(
    collection(db, 'calls'),
    where('calleeId', '==', currentUser.uid),
    where('status',   '==', 'calling')
  );
  onSnapshot(q, async snap => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added') {
        const data       = change.doc.data();
        const callerSnap = await getDoc(doc(db, 'users', data.callerId)).catch(() => null);
        if (!callerSnap?.exists()) continue;
        showIncomingCallUI(callerSnap.data(), change.doc.id, data);
      }
    }
  });
}

function showIncomingCallUI(caller, callId, callData) {
  // Remove any existing banner
  document.querySelector('.incoming-call-banner')?.remove();

  const banner = document.createElement('div');
  banner.className = 'incoming-call-banner';

  const avEl = document.createElement('div');
  avEl.className = 'avatar md';
  setAvatar(avEl, caller);

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex:1">
      ${avEl.outerHTML}
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(caller.displayName)}</div>
        <div style="font-size:12px;color:var(--text-muted)">${callData.type === 'video' ? '📹 Video' : '📞 Voice'} call incoming…</div>
      </div>
    </div>
    <button class="btn btn-primary btn-accept-call"  style="padding:8px 16px;font-size:13px">Answer</button>
    <button class="btn btn-ghost  btn-decline-call" style="padding:8px 16px;font-size:13px;color:#ff4757">Decline</button>
  `;

  document.body.appendChild(banner);
  playNotifSound();

  // Auto-dismiss after 30 s
  const autoDismiss = setTimeout(() => banner?.remove(), 30000);

  banner.querySelector('.btn-decline-call').addEventListener('click', async () => {
    clearTimeout(autoDismiss);
    banner.remove();
    await updateDoc(doc(db, 'calls', callId), { status: 'ended' }).catch(() => {});
  });

  banner.querySelector('.btn-accept-call').addEventListener('click', async () => {
    clearTimeout(autoDismiss);
    banner.remove();
    await answerCall(caller, callId, callData);
  });
}

// ═══════════════════════════════════════════════════════
//  SCREEN SHARE (BETA)
// ═══════════════════════════════════════════════════════
async function beginScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) return;

    if (pc) {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        // Video call: replace existing video sender track with screen track
        await videoSender.replaceTrack(screenTrack);
      } else {
        // Voice call: add a new video track for screen share
        pc.addTrack(screenTrack, screenStream);
      }
    }

    // Show locally
    const sv = $('screenShareVideo');
    sv.srcObject = screenStream;
    sv.style.display = '';
    const si = $('screenShareIndicator'); if (si) si.style.display = 'flex';

    isScreenSharing = true;
    $('screenShareBtn').classList.add('call-btn-active');
    toast('Screen sharing started 🖥');

    // Auto-stop when user ends the system picker
    screenTrack.onended = () => stopScreenShare();

  } catch (err) {
    if (err.name !== 'NotAllowedError') toast('Could not share screen', 'error');
  }
}

async function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  const sv = $('screenShareVideo');
  if (sv) { sv.style.display = 'none'; sv.srcObject = null; }
  const si = $('screenShareIndicator'); if (si) si.style.display = 'none';

  // Restore camera track for video calls
  if (pc && localStream && callType === 'video') {
    const camTrack = localStream.getVideoTracks()[0];
    if (camTrack) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(camTrack).catch(() => {});
    }
  }

  isScreenSharing = false;
  const ssBtn = $('screenShareBtn'); if (ssBtn) ssBtn.classList.remove('call-btn-active');
  toast('Screen sharing stopped');
}

// ── Profile card call button ─────────────────────────────
// (used in openProfileModal when calling from profile view)
function showCallModal(type) {
  // openProfileModal sets currentFriendId/currentFriendData before calling this
  if (!currentFriendId || !currentFriendData) { toast('No friend selected', 'error'); return; }
  hideModal('profileModal');
  startCall(type);
}

// ── Add friend ────────────────────────────────────────
$('addFriendBtn').addEventListener('click', () => {
  $('friendSearchInput').value = ''; $('friendSearchResult').innerHTML = '';
  showModal('addFriendModal');
});
$('closeFriendModal').addEventListener('click', () => hideModal('addFriendModal'));
$('friendSearchBtn').addEventListener('click', searchFriend);
$('friendSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriend(); });

async function searchFriend() {
  const username = $('friendSearchInput').value.trim().toLowerCase();
  const res = $('friendSearchResult');
  if (!username) return;
  res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Searching…</div>';
  try {
    const q    = query(collection(db, 'users'), where('username', '==', username));
    const snap = await getDocs(q);
    if (snap.empty) { res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">No user found</div>'; return; }
    const uid = snap.docs[0].id;
    const userData = snap.docs[0].data();
    if (uid === currentUser.uid) { res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">That\'s you 😄</div>'; return; }

    const existQ    = query(collection(db, 'friends'), where('users', 'array-contains', currentUser.uid));
    const existSnap = await getDocs(existQ);
    const rel       = existSnap.docs.find(d => d.data().users.includes(uid));

    res.innerHTML = '';
    const div  = document.createElement('div'); div.className = 'friend-result';
    const av   = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, userData);
    const info = document.createElement('div'); info.className = 'info';
    info.innerHTML = `<strong>${escHtml(userData.displayName)}</strong><span>@${escHtml(userData.username)}</span>`;
    div.appendChild(av); div.appendChild(info);

    if (rel) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:12px;color:var(--text-muted)';
      badge.textContent = rel.data().status === 'accepted' ? 'Already friends ✓' : 'Request pending…';
      div.appendChild(badge);
    } else {
      const btn = document.createElement('button'); btn.className = 'btn btn-primary';
      btn.textContent = 'Add Friend'; btn.style.cssText = 'font-size:13px;padding:8px 16px';
      btn.addEventListener('click', async () => {
        btn.textContent = 'Sending…'; btn.disabled = true;
        try {
          await addDoc(collection(db, 'friends'), { users: [currentUser.uid, uid].sort(), from: currentUser.uid, to: uid, status: 'pending', createdAt: serverTimestamp() });
          btn.textContent = 'Request Sent ✓';
          toast('Friend request sent!', 'success');
        } catch(e) { toast('Error: ' + e.message, 'error'); btn.textContent = 'Add Friend'; btn.disabled = false; }
      });
      div.appendChild(btn);
    }
    res.appendChild(div);
  } catch(e) {
    res.innerHTML = `<div style="padding:12px;color:#ff4757;font-size:13px">Error: ${e.message}</div>`;
  }
}

// ── Profile modal ─────────────────────────────────────
$('viewProfileBtn').addEventListener('click', async () => {
  if (!currentFriendId) return;
  const snap = await getDoc(doc(db, 'users', currentFriendId));
  if (!snap.exists()) return;
  openProfileModal(snap.data(), currentFriendId, true);
});

function openProfileModal(userData, uid, isFriend) {
  setAvatar($('profileAvatar'), userData);
  $('profileName').textContent = userData.displayName;
  $('profileTag').textContent  = '@' + (userData.username || '');

  const bioEl = $('profileBio');
  if (bioEl) bioEl.textContent = userData.bio || '';

  const statusEl = $('profileStatusMsg');
  if (statusEl) {
    if (userData.statusMsg) {
      statusEl.style.display = '';
      statusEl.textContent = (userData.moodEmoji || '💬') + ' ' + userData.statusMsg;
    } else {
      statusEl.style.display = 'none';
    }
  }

  const header = $('profileCardHeader');
  const cardStyle = userData.cardStyle || 'flame';
  header.setAttribute('data-style', cardStyle);

  const friendCountEl = $('profileFriendCount');
  const memberSinceEl = $('profileMemberSince');
  if (userData.createdAt && memberSinceEl) {
    const d = userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt);
    memberSinceEl.textContent = d.toLocaleDateString([], { month: 'short', year: 'numeric' });
  }
  if (friendCountEl) {
    const fq = query(collection(db, 'friends'), where('users', 'array-contains', uid), where('status', '==', 'accepted'));
    getDocs(fq).then(s => { friendCountEl.textContent = s.size; }).catch(() => {});
  }

  const badge = $('profileCardBadge');
  if (badge) {
    const joined = userData.createdAt?.toDate?.() || new Date();
    const ageMonths = (Date.now() - joined.getTime()) / (1000 * 60 * 60 * 24 * 30);
    badge.style.display = 'block';
    if (ageMonths > 12) badge.textContent = '⭐ Veteran';
    else if (ageMonths > 3) badge.textContent = '🌱 Regular';
    else badge.textContent = '✨ New';
  }

  startProfileParticles(cardStyle);

  const actions = $('profileActions'); actions.innerHTML = '';
  if (isFriend) {
    const msgBtn = document.createElement('button'); msgBtn.className = 'btn btn-primary';
    msgBtn.textContent = 'Message';
    msgBtn.addEventListener('click', () => { hideModal('profileModal'); openChat(uid, userData); });
    const callBtn = document.createElement('button'); callBtn.className = 'btn btn-ghost';
    callBtn.textContent = '📞 Call';
    callBtn.addEventListener('click', () => { hideModal('profileModal'); showCallModal('voice'); });
    actions.appendChild(msgBtn); actions.appendChild(callBtn);
  }
  showModal('profileModal');
}

let profileParticleAnimId = null;

function startProfileParticles(style) {
  if (profileParticleAnimId) {
    cancelAnimationFrame(profileParticleAnimId);
    profileParticleAnimId = null;
  }

  const canvas = $('profileParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.offsetWidth || 360;
  canvas.height = canvas.parentElement.offsetHeight || 200;

  const COLORS = {
    flame:    ['#ff6b35','#ffbe0b','#ff4500','#ffd700'],
    ocean:    ['#00b4d8','#90e0ef','#caf0f8','#48cae4'],
    galaxy:   ['#c77dff','#9d4edd','#e0aaff','#fff'],
    aurora:   ['#00b09b','#96c93d','#f7971e','#7bed9f'],
    neon:     ['#00f0ff','#ff00ff','#fff','#00ff88'],
    sakura:   ['#ff758c','#ff7eb3','#ffd6e7','#fff'],
    midnight: ['#4040b0','#6060d0','#8080f0','#c0c0ff'],
    gold:     ['#ffd700','#ffb347','#fffacd','#daa520'],
    emerald:  ['#2ecc71','#00704a','#a8f0c6','#00ff88'],
    crimson:  ['#dc143c','#ff6b6b','#ff9999','#fff'],
    ice:      ['#00bcd4','#e0f7fa','#80deea','#fff'],
    sunset:   ['#ff9800','#ffd54f','#e65100','#ffcc02'],
  };

  const colors = COLORS[style] || COLORS.flame;
  const particles = Array.from({ length: 30 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height + canvas.height,
    r: Math.random() * 3 + 1,
    speed: Math.random() * 0.8 + 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
    opacity: Math.random() * 0.7 + 0.2,
    drift: (Math.random() - 0.5) * 0.5,
  }));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.y -= p.speed; p.x += p.drift;
      if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = p.opacity; ctx.fill();
    });
    ctx.globalAlpha = 1;
    profileParticleAnimId = requestAnimationFrame(animate);
  }
  animate();
}

$('closeProfileModal').addEventListener('click', () => {
  if (profileParticleAnimId) { cancelAnimationFrame(profileParticleAnimId); profileParticleAnimId = null; }
  hideModal('profileModal');
});

// ── Settings ──────────────────────────────────────────
$('openSettingsBtn').addEventListener('click', () => {
  setAvatar($('settingsAvatar'), currentUserData);
  $('settingsName').textContent = currentUserData.displayName || '';
  $('settingsTag').textContent  = '@' + (currentUserData.username || '');
  const soundBtn = $('soundToggleBtn');
  if (soundBtn) soundBtn.textContent = soundEnabled ? 'On ✓' : 'Off';
  showModal('settingsModal');
});
$('closeSettingsBtn').addEventListener('click', () => hideModal('settingsModal'));

$('signOutBtn').addEventListener('click', async () => {
  clearInterval(presenceInterval);
  await updateDoc(doc(db, 'users', currentUser.uid), { online: false }).catch(() => {});
  await signOut(auth);
  window.location.href = 'index.html';
});

$('editProfileBtn').addEventListener('click', () => {
  hideModal('settingsModal');
  $('setupDisplayName').value = currentUserData.displayName || '';
  $('setupUsername').value    = currentUserData.username    || '';
  if ($('setupBio')) $('setupBio').value = currentUserData.bio || '';
  if ($('setupStatusMsg')) $('setupStatusMsg').value = currentUserData.statusMsg || '';
  if ($('setupMoodEmoji')) $('setupMoodEmoji').value = currentUserData.moodEmoji || '💬';
  const currentStyle = currentUserData.cardStyle || 'flame';
  document.querySelectorAll('.card-style-btn:not(.bubble-shape-btn)').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === currentStyle);
  });
  const currentShape = currentUserData.bubbleShape || 'rounded';
  document.querySelectorAll('.bubble-shape-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shape === currentShape);
  });
  const preview = $('pfpPreview');
  preview.innerHTML = currentUserData.photoURL
    ? `<img src="${currentUserData.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;color:var(--text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  showModal('setupModal');
});

$('notifBtn').addEventListener('click', () => {
  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') { toast('Notifications enabled!', 'success'); $('notifBtn').textContent = 'Enabled ✓'; }
    });
  }
});

$('soundToggleBtn')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('pulse-sound', soundEnabled);
  $('soundToggleBtn').textContent = soundEnabled ? 'On ✓' : 'Off';
  toast(soundEnabled ? 'Sound on 🔔' : 'Sound off 🔇');
});

$('openShortcutsBtn')?.addEventListener('click', () => { hideModal('settingsModal'); showModal('shortcutsModal'); });
$('closeShortcutsBtn')?.addEventListener('click', () => hideModal('shortcutsModal'));

// ── Media.js event bridge ─────────────────────────────
document.addEventListener('pulse:sendMedia', async (e) => {
  const payload = e.detail;
  if (payload) await sendMessage(payload).catch(err => toast('Send failed: ' + err.message, 'error'));
});

// ── Modal helpers ─────────────────────────────────────
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('.modal-backdrop').forEach(b => {
  b.addEventListener('click', e => {
    if (e.target === b && b.id !== 'setupModal') {
      b.classList.add('hidden');
    }
  });
});
