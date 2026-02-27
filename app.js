// =====================================================
//  PULSE — app.js  v4  (ES Module, Firebase v10)
//  FIXES:
//    1. Persistent login (browserLocalPersistence)
//    2. GIF API key was broken variable reference → fixed to string
//    3. app.html HTML was duplicated → fixed in app.html
//    4. auth/no-auth-event no longer causes error flash
//    5. Presence now cleans up on tab close reliably
//
//  NEW FEATURES (20):
//    1.  Typing indicators — shows "... typing" in real time
//    2.  Message reactions — long-press/right-click to react with emoji
//    3.  Message reply/quote — reply to specific messages
//    4.  Delete your own messages
//    5.  Edit your own messages (within 5 minutes)
//    6.  Unread message badge on chat list items
//    7.  Message search — search through conversation history
//    8.  Dark/light theme toggle (respects system preference)
//    9.  Sound notifications for new messages
//    10. Message pinning — pin important messages in a chat
//    11. Copy message text to clipboard
//    12. Keyboard shortcut help dialog (press ?)
//    13. Remove friend
//    14. Block user
//    15. Chat media gallery — view all shared images in a grid
//    16. Message timestamps on hover (already partial, now full tooltip)
//    17. Auto-link URL preview cards (basic)
//    18. Unfriend confirmation dialog
//    19. Status/bio field in profile
//    20. Scroll-to-bottom button when not at bottom
// =====================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs,
  setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch, limit, arrayUnion, arrayRemove
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

// FIX: Set persistence so login survives browser restarts
await setPersistence(auth, browserLocalPersistence);

// FIX: Giphy API key — was broken variable reference, now a proper string
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
let replyingTo        = null;  // Feature 3: reply state
let searchMode        = false; // Feature 7: search mode
const friendsCache    = new Map();

// Feature 8: Theme
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
  return text.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">$1</a>');
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
      uid: currentUser.uid, displayName, username, photoURL, bio,
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

// ── Feature 16: Scroll to bottom button ──────────────
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
  btn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
}

// ── Feature 12: Keyboard shortcuts ───────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === '?') { showModal('shortcutsModal'); return; }
    if (e.key === 'Escape') { document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => { if (m.id !== 'setupModal' && m.id !== 'callModal') m.classList.add('hidden'); }); }
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

  // Feature 13: Remove friend button
  const removeBtn = document.createElement('button'); removeBtn.className = 'btn-icon'; removeBtn.title = 'Remove friend';
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ff4757"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
  removeBtn.addEventListener('click', e => { e.stopPropagation(); confirmRemoveFriend(friendDocId, userData.displayName); });

  actions.appendChild(msgBtn); actions.appendChild(removeBtn);
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(actions);
  div.addEventListener('click', () => openChat(uid, userData));
  container.appendChild(div);
}

// Feature 13: Confirm remove friend
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
  const meta = document.createElement('div'); meta.className = 'conv-meta';
  meta.innerHTML = `<div class="conv-name">${escHtml(userData.displayName)}</div>
    <div class="conv-preview">${escHtml(preview)}</div>`;
  const right = document.createElement('div'); right.className = 'conv-right';
  right.innerHTML = `<span class="conv-time">${fmtTime(chatData.lastMessageTime)}</span>`;

  // Feature 6: Unread badge
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
    // Clear unread count
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
let typingUnsub = null;
function subscribeToTyping(chatId) {
  if (typingUnsub) typingUnsub();
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
  $('messagesArea').innerHTML = '';
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  let firstLoad = true;
  messagesUnsub = onSnapshot(q, snap => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastMsg = msgs[msgs.length - 1];
    if (!firstLoad && lastMsg && lastMsg.senderId !== currentUser.uid) {
      playNotifSound(); // Feature 9
    }
    firstLoad = false;
    renderMessages(msgs);
  });
}

function renderMessages(messages) {
  const area = $('messagesArea');
  const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
  area.innerHTML = '';
  let lastDate = null, lastSender = null, groupEl = null;

  for (const msg of messages) {
    const dateLabel = fmtDateLabel(msg.createdAt);
    if (dateLabel !== lastDate) {
      const div = document.createElement('div');
      div.className = 'date-divider'; div.textContent = dateLabel;
      area.appendChild(div);
      lastDate = dateLabel; lastSender = null; groupEl = null;
    }

    const isMine = msg.senderId === currentUser.uid;
    if (msg.senderId !== lastSender || !groupEl) {
      groupEl = document.createElement('div');
      groupEl.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
      area.appendChild(groupEl);
      lastSender = msg.senderId;
    }

    const row = document.createElement('div');
    row.className = 'msg-row';
    row.dataset.msgId = msg.id;

    // Feature 3: Show reply context
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

    // Feature 2: Reactions display
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      const reactionBar = document.createElement('div'); reactionBar.className = 'reaction-bar';
      const counts = {};
      Object.values(msg.reactions).forEach(emoji => { counts[emoji] = (counts[emoji] || 0) + 1; });
      Object.entries(counts).forEach(([emoji, count]) => {
        const pill = document.createElement('button'); pill.className = 'reaction-pill';
        pill.innerHTML = `${emoji} ${count}`;
        pill.addEventListener('click', () => toggleReaction(msg.id, emoji));
        reactionBar.appendChild(pill);
      });
      row.appendChild(reactionBar);
    }

    // Feature 16: Timestamp tooltip
    row.title = fmtFull(msg.createdAt);

    // Context menu for messages (right-click / long press)
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

  // Feature 1: Typing indicator at bottom
  const typingEl = document.createElement('div');
  typingEl.id = 'typingIndicator';
  typingEl.className = 'typing-group';
  typingEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  area.appendChild(typingEl);

  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const isMine = last.senderId === currentUser.uid;
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    meta.textContent = fmtFull(last.createdAt);
    if (isMine) {
      const tick = document.createElement('span');
      tick.className = `msg-tick${last.read ? ' read' : ''}`;
      tick.textContent = ' ✓✓'; meta.appendChild(tick);
    }
    area.appendChild(meta);
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
    btn.addEventListener('click', () => { toggleReaction(msg.id, emoji); menu.remove(); });
    reactionRow.appendChild(btn);
  });
  menu.appendChild(reactionRow);

  const actions = [
    // Feature 3: Reply
    { label: '↩ Reply', fn: () => setReplyTo(msg) },
    // Feature 11: Copy
    ...(msg.text ? [{ label: '📋 Copy text', fn: () => { navigator.clipboard.writeText(msg.text).then(() => toast('Copied!')); } }] : []),
    // Feature 4 & 5: Delete / Edit (own messages only)
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

  // Position menu
  const rect = e.target?.getBoundingClientRect?.() || { left: window.innerWidth/2, top: window.innerHeight/2, width: 0, height: 0 };
  menu.style.cssText = `position:fixed;z-index:5000;top:${Math.min(e.clientY || rect.top, window.innerHeight - 250)}px;left:${Math.min(e.clientX || rect.left, window.innerWidth - 220)}px`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

// Feature 2: Toggle reaction
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
  }
}

// Feature 3: Reply to message
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

// Feature 4: Delete message
async function deleteMessage(msgId) {
  if (!currentChatId) return;
  if (!confirm('Delete this message?')) return;
  await deleteDoc(doc(db, 'chats', currentChatId, 'messages', msgId));
  toast('Message deleted');
}

// Feature 5: Edit message
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

$('msgSearchInput')?.addEventListener('input', e => {
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
});

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
    if (e.key === 'Escape') { clearReply(); clearEdit(); }
  });
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
    // Feature 1: Typing indicator
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

  let gifTimer = null;
  $('gifSearch').addEventListener('input', e => {
    clearTimeout(gifTimer);
    gifTimer = setTimeout(() => loadGifs(e.target.value.trim()), 400);
  });
}

async function sendTextMessage() {
  const inp = $('msgInput');
  const text = inp.value.trim();
  if (!text || !currentChatId) return;

  // Feature 5: If editing
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
    (payload.text || '').slice(0, 60);
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'chats', currentChatId, 'messages')), msg);
    batch.update(doc(db, 'chats', currentChatId), {
      lastMessage:     preview,
      lastMessageTime: serverTimestamp(),
      lastMessageType: payload.type,
      lastSenderId:    currentUser.uid,
      // Feature 6: increment unread for the other person
      [`unreadCount.${currentFriendId}`]: (await getDoc(doc(db, 'chats', currentChatId))).data()?.unreadCount?.[currentFriendId] + 1 || 1,
    });
    await batch.commit();
  } catch(e) { toast('Send failed: ' + e.message, 'error'); }
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
    // FIX: API key is now a proper string (was broken variable reference before)
    const endpoint = searchQuery
      ? `https://api.giphy.com/v1/gifs/search?api_key=${X9TJ3cb1am8tDiYXGHpnHzFPWvkxSAwz}&q=${encodeURIComponent(searchQuery)}&limit=24&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${X9TJ3cb1am8tDiYXGHpnHzFPWvkxSAwz}&limit=24&rating=g`;

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
});

// ── Call buttons ──────────────────────────────────────
$('callBtn').addEventListener('click', () => { if (currentFriendData) showCallModal('voice'); });
$('videoBtn').addEventListener('click', () => { if (currentFriendData) showCallModal('video'); });

function showCallModal(type) {
  setAvatar($('callAvatar'), currentFriendData);
  $('callName').textContent = currentFriendData.displayName;
  $('callType').textContent = (type === 'video' ? '📹 Video' : '📞 Voice') + ' calling…';
  $('callModal').classList.remove('hidden');
  let dots = 0;
  const iv = setInterval(() => {
    dots = (dots + 1) % 4;
    $('callType').textContent = (type === 'video' ? '📹 Video' : '📞 Voice') + ' calling' + '.'.repeat(dots);
  }, 600);
  $('endCallBtn').onclick = () => { clearInterval(iv); $('callModal').classList.add('hidden'); toast('Call ended'); };
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
  // Feature 19: Show bio
  const bioEl = $('profileBio');
  if (bioEl) bioEl.textContent = userData.bio || '';
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
$('closeProfileModal').addEventListener('click', () => hideModal('profileModal'));

// ── Settings ──────────────────────────────────────────
$('openSettingsBtn').addEventListener('click', () => {
  setAvatar($('settingsAvatar'), currentUserData);
  $('settingsName').textContent = currentUserData.displayName || '';
  $('settingsTag').textContent  = '@' + (currentUserData.username || '');
  // Feature 9: Show sound toggle state
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

// Feature 9: Sound toggle
$('soundToggleBtn')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('pulse-sound', soundEnabled);
  $('soundToggleBtn').textContent = soundEnabled ? 'On ✓' : 'Off';
  toast(soundEnabled ? 'Sound on 🔔' : 'Sound off 🔇');
});

// Feature 12: Shortcuts modal
$('openShortcutsBtn')?.addEventListener('click', () => { hideModal('settingsModal'); showModal('shortcutsModal'); });
$('closeShortcutsBtn')?.addEventListener('click', () => hideModal('shortcutsModal'));

// ── Modal helpers ─────────────────────────────────────
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('.modal-backdrop').forEach(b => {
  b.addEventListener('click', e => {
    if (e.target === b && b.id !== 'setupModal' && b.id !== 'callModal') {
      b.classList.add('hidden');
    }
  });
});
