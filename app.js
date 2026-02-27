// =====================================================
//  PULSE — app.js  (ES Module, Firebase v10)
// =====================================================
import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut }
                                from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL }
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
const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── State ─────────────────────────────────────────────
let currentUser       = null;
let currentUserData   = null;
let currentChatId     = null;
let currentFriendId   = null;
let currentFriendData = null;
let messagesUnsub     = null;
let presenceUnsub     = null;
let presenceInterval  = null;
const friendsCache    = new Map();

const $ = id => document.getElementById(id);

// ── Helpers ───────────────────────────────────────────
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

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
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">$1</a>');
}

// ── Auth guard ────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  $('loadingOverlay').classList.add('hidden');
  $('appRoot').style.display = '';

  if (!snap.exists() || !snap.data().displayName) {
    $('setupDisplayName').value = user.displayName || '';
    showModal('setupModal');
  } else {
    currentUserData = snap.data();
    initApp();
  }
});

// ── Profile setup ─────────────────────────────────────
$('pfpPreview').addEventListener('click', () => $('pfpFileInput').click());
$('pfpFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    $('pfpPreview').innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  };
  reader.readAsDataURL(file);
});

$('setupSaveBtn').addEventListener('click', saveProfile);

async function saveProfile() {
  const displayName = $('setupDisplayName').value.trim();
  const username    = $('setupUsername').value.trim().toLowerCase();

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

    // Photo upload: try Firebase Storage, fall back to base64
    let photoURL = currentUserData?.photoURL || currentUser.photoURL || null;
    const file = $('pfpFileInput').files[0];
    if (file) {
      const dataURL = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      try {
        const sRef = storageRef(storage, `avatars/${currentUser.uid}`);
        await uploadBytes(sRef, file);
        photoURL = await getDownloadURL(sRef);
      } catch {
        photoURL = dataURL; // fallback — still displays correctly
      }
    }

    const userData = {
      uid: currentUser.uid, displayName, username, photoURL,
      updatedAt: serverTimestamp(),
      online: true,
      lastSeen: serverTimestamp(),
      ...(!currentUserData?.createdAt && { createdAt: serverTimestamp() })
    };

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
    toast('Profile saved!', 'success');
  } catch (e) {
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

// ── Friends list ──────────────────────────────────────
function subscribeToFriends() {
  const q = query(
    collection(db, 'friends'),
    where('users', 'array-contains', currentUser.uid),
    where('status', '==', 'accepted')
  );
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
      return { uid: fUid, userData: uSnap.data() };
    }));

    const valid = rows.filter(Boolean);
    if (!valid.length) {
      list.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>No friends yet — add some!</div>`;
      return;
    }
    valid.forEach(({ uid, userData }) => {
      friendsCache.set(uid, userData);
      renderFriendItem(list, userData, uid);
    });
  });
}

function renderFriendItem(container, userData, uid) {
  const div = document.createElement('div');
  div.className = 'friend-item';
  const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
  const av = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, userData);
  const dot = document.createElement('div'); dot.className = `online-dot${userData.online ? '' : ' offline'}`;
  dot.style.cssText = 'position:absolute;bottom:0;right:0';
  wrap.appendChild(av); wrap.appendChild(dot);
  const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0';
  meta.innerHTML = `<div class="friend-name">${escHtml(userData.displayName)}</div><div class="friend-tag">@${escHtml(userData.username || '')}</div>`;
  const msgBtn = document.createElement('button'); msgBtn.className = 'btn-icon'; msgBtn.title = 'Message';
  msgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  msgBtn.addEventListener('click', e => { e.stopPropagation(); openChat(uid, userData); });
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(msgBtn);
  div.addEventListener('click', () => openChat(uid, userData));
  container.appendChild(div);
}

// ── Requests ──────────────────────────────────────────
function subscribeToRequests() {
  const q = query(
    collection(db, 'friends'),
    where('to', '==', currentUser.uid),
    where('status', '==', 'pending')
  );
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
      info.innerHTML = `<div style="font-size:14px;font-weight:500">${escHtml(sender.displayName)}</div><div style="font-size:12px;color:var(--text-muted)">@${escHtml(sender.username || '')}</div>`;
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
    lastMessage: '',
    lastMessageTime: serverTimestamp(),
    lastMessageType: 'text'
  }, { merge: true });
  await batch.commit();
  toast('Friend added! 🎉', 'success');
}

// ── Chats list ────────────────────────────────────────
function subscribeToChats() {
  const q = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', currentUser.uid),
    orderBy('lastMessageTime', 'desc')
  );
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
  const dot = document.createElement('div'); dot.className = `online-dot${userData.online ? '' : ' offline'}`;
  dot.style.cssText = 'position:absolute;bottom:0;right:0';
  wrap.appendChild(av); wrap.appendChild(dot);
  let preview = chatData.lastMessage || 'Start chatting…';
  if (chatData.lastMessageType === 'image') preview = '📷 Photo';
  if (chatData.lastMessageType === 'gif')   preview = '🎞 GIF';
  const meta = document.createElement('div'); meta.className = 'conv-meta';
  meta.innerHTML = `<div class="conv-name">${escHtml(userData.displayName)}</div><div class="conv-preview">${escHtml(preview)}</div>`;
  const right = document.createElement('div'); right.className = 'conv-right';
  right.innerHTML = `<span class="conv-time">${fmtTime(chatData.lastMessageTime)}</span>`;
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(right);
  div.addEventListener('click', () => {
    document.querySelectorAll('.conv-item').forEach(i => i.classList.remove('active'));
    div.classList.add('active');
    openChat(friendUid, userData, chatId);
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
    if (d.online) { dot.classList.remove('offline'); $('chatStatus').textContent = 'Online'; }
    else {
      dot.classList.add('offline');
      $('chatStatus').textContent = `Last seen ${d.lastSeen ? fmtTime(d.lastSeen) + ' ago' : 'recently'}`;
    }
  });

  $('welcomeScreen').classList.add('hidden');
  $('chatView').classList.remove('hidden');

  setDoc(doc(db, 'chats', currentChatId), {
    participants: [currentUser.uid, friendUid],
    createdAt: serverTimestamp(),
    lastMessageTime: serverTimestamp(),
    lastMessage: '',
  }, { merge: true }).catch(() => {});

  subscribeToMessages(currentChatId);
}

// ── Messages ──────────────────────────────────────────
function subscribeToMessages(chatId) {
  if (messagesUnsub) messagesUnsub();
  $('messagesArea').innerHTML = '';
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  messagesUnsub = onSnapshot(q, snap => {
    renderMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
      const div = document.createElement('div'); div.className = 'date-divider'; div.textContent = dateLabel;
      area.appendChild(div); lastDate = dateLabel; lastSender = null; groupEl = null;
    }
    const isMine = msg.senderId === currentUser.uid;
    if (msg.senderId !== lastSender || !groupEl) {
      groupEl = document.createElement('div');
      groupEl.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
      area.appendChild(groupEl); lastSender = msg.senderId;
    }
    const row = document.createElement('div'); row.className = 'msg-row'; row.title = fmtFull(msg.createdAt);
    if (msg.type === 'image' || msg.type === 'gif') {
      const wrap = document.createElement('div'); wrap.className = 'msg-media-wrap';
      const img = document.createElement('img'); img.src = msg.url || msg.text;
      img.className = 'msg-media'; img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(msg.url || msg.text));
      wrap.appendChild(img); row.appendChild(wrap);
    } else {
      const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
      bubble.innerHTML = linkify(escHtml(msg.text || ''));
      row.appendChild(bubble);
    }
    groupEl.appendChild(row);
  }

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

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  const img = document.createElement('img'); img.src = src;
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.9)';
  lb.appendChild(img); lb.addEventListener('click', () => lb.remove()); document.body.appendChild(lb);
}

// ── Input bar ─────────────────────────────────────────
function setupInputBar() {
  const inp = $('msgInput');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } });
  inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 140) + 'px'; });
  $('sendBtn').addEventListener('click', sendTextMessage);
  $('attachBtn').addEventListener('click', () => $('fileUploadInput').click());
  $('fileUploadInput').addEventListener('change', handleFileUpload);
  $('gifBtn').addEventListener('click', toggleGifPanel);
  $('emojiBtn').addEventListener('click', toggleEmojiPanel);

  let gifTimer = null;
  $('gifSearch').addEventListener('input', e => {
    clearTimeout(gifTimer); gifTimer = setTimeout(() => loadGifs(e.target.value), 400);
  });
}

async function sendTextMessage() {
  const text = $('msgInput').value.trim();
  if (!text || !currentChatId) return;
  $('msgInput').value = ''; $('msgInput').style.height = 'auto';
  await sendMessage({ type: 'text', text });
}

async function sendMessage(payload) {
  if (!currentChatId) return;
  const msg = { senderId: currentUser.uid, senderName: currentUserData.displayName, createdAt: serverTimestamp(), read: false, ...payload };
  const preview = payload.type === 'image' ? '📷 Photo' : payload.type === 'gif' ? '🎞 GIF' : (payload.text || '').slice(0, 60);
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'chats', currentChatId, 'messages')), msg);
    batch.update(doc(db, 'chats', currentChatId), { lastMessage: preview, lastMessageTime: serverTimestamp(), lastMessageType: payload.type, lastSenderId: currentUser.uid });
    await batch.commit();
  } catch (e) { toast('Send failed: ' + e.message, 'error'); }
}

async function handleFileUpload(e) {
  const file = e.target.files[0]; if (!file || !currentChatId) return;
  e.target.value = '';
  if (!file.type.startsWith('image/')) { toast('Images only', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('Max 10MB', 'error'); return; }
  const indicator = document.createElement('div');
  indicator.className = 'upload-indicator';
  indicator.innerHTML = '<div class="upload-spinner"></div> Uploading…';
  $('chatInputBar').prepend(indicator);
  try {
    let url;
    try {
      const sRef = storageRef(storage, `chat-media/${currentChatId}/${Date.now()}_${file.name}`);
      await uploadBytes(sRef, file); url = await getDownloadURL(sRef);
    } catch {
      url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
    }
    await sendMessage({ type: 'image', url, text: 'Photo' });
  } catch (err) { toast('Upload failed: ' + err.message, 'error'); }
  finally { indicator.remove(); }
}

// ── GIF panel ─────────────────────────────────────────
function toggleGifPanel() {
  const panel = $('gifPanel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden'); $('gifSearch').focus();
    loadGifs(''); $('emojiPanel').classList.add('hidden');
  } else panel.classList.add('hidden');
}

async function loadGifs(query) {
  const grid = $('gifGrid'); grid.innerHTML = '<div class="gif-loading">Loading…</div>';
  try {
    const key = 'AIzaSyB_'; // ← replace with a real Tenor API key
    const url = query
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${key}&limit=24&media_filter=gif`
      : `https://tenor.googleapis.com/v2/featured?key=${key}&limit=24&media_filter=gif`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('api');
    const data = await res.json();
    renderGifs(data.results || []);
  } catch {
    grid.innerHTML = `<div class="gif-no-key">Add a free <a href="https://developers.google.com/tenor/guides/quickstart" target="_blank">Tenor API key</a> in app.js to enable GIFs.</div>`;
  }
}

function renderGifs(results) {
  const grid = $('gifGrid'); grid.innerHTML = '';
  if (!results.length) { grid.innerHTML = '<div class="gif-loading">No GIFs found</div>'; return; }
  results.forEach(gif => {
    const url   = gif.media_formats?.gif?.url;
    const thumb = gif.media_formats?.nanogif?.url || gif.media_formats?.tinygif?.url || url;
    if (!url) return;
    const img = document.createElement('img'); img.src = thumb; img.className = 'gif-thumb'; img.loading = 'lazy';
    img.addEventListener('click', () => { sendMessage({ type: 'gif', url, text: 'GIF' }); $('gifPanel').classList.add('hidden'); });
    grid.appendChild(img);
  });
}

// ── Emoji panel ───────────────────────────────────────
const EMOJIS = ['😀','😂','🥹','😍','🤩','😎','🥳','🤔','😮','😢','😭','😡','🔥','❤️','💯','👍','👎','👏','🙌','🤝','💪','✌️','🫶','💀','😈','🎉','🎊','🏆','⭐','✨','💫','🌈','🌙','☀️','🍕','🍦','🎮','📱','💻','🐶'];

function toggleEmojiPanel() {
  const panel = $('emojiPanel');
  if (panel.classList.contains('hidden')) {
    if (!panel.dataset.built) {
      EMOJIS.forEach(em => {
        const btn = document.createElement('button'); btn.className = 'emoji-btn'; btn.textContent = em;
        btn.addEventListener('click', () => {
          const inp = $('msgInput'), pos = inp.selectionStart || inp.value.length;
          inp.value = inp.value.slice(0, pos) + em + inp.value.slice(pos);
          inp.focus(); panel.classList.add('hidden');
        });
        panel.appendChild(btn);
      });
      panel.dataset.built = '1';
    }
    panel.classList.remove('hidden'); $('gifPanel').classList.add('hidden');
  } else panel.classList.add('hidden');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#gifPanel')   && !e.target.closest('#gifBtn'))   $('gifPanel')   && $('gifPanel').classList.add('hidden');
  if (!e.target.closest('#emojiPanel') && !e.target.closest('#emojiBtn')) $('emojiPanel') && $('emojiPanel').classList.add('hidden');
});

// ── Call buttons ──────────────────────────────────────
$('callBtn').addEventListener('click',  () => { if (currentFriendData) showCallModal('voice'); });
$('videoBtn').addEventListener('click', () => { if (currentFriendData) showCallModal('video'); });

function showCallModal(type) {
  setAvatar($('callAvatar'), currentFriendData);
  $('callName').textContent = currentFriendData.displayName;
  $('callType').textContent = (type === 'video' ? '📹 Video' : '📞 Voice') + ' calling…';
  $('callModal').classList.remove('hidden');
  let dots = 0;
  const iv = setInterval(() => { dots = (dots + 1) % 4; $('callType').textContent = (type === 'video' ? '📹 Video' : '📞 Voice') + ' calling' + '.'.repeat(dots); }, 600);
  $('endCallBtn').onclick = () => { clearInterval(iv); $('callModal').classList.add('hidden'); toast('Call ended'); };
}

// ── Add friend ────────────────────────────────────────
$('addFriendBtn').addEventListener('click', () => { $('friendSearchInput').value = ''; $('friendSearchResult').innerHTML = ''; showModal('addFriendModal'); });
$('closeFriendModal').addEventListener('click', () => hideModal('addFriendModal'));
$('friendSearchBtn').addEventListener('click', searchFriend);
$('friendSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriend(); });

async function searchFriend() {
  const username = $('friendSearchInput').value.trim().toLowerCase();
  const res = $('friendSearchResult');
  if (!username) return;
  res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Searching…</div>';
  try {
    const q = query(collection(db, 'users'), where('username', '==', username));
    const snap = await getDocs(q);
    if (snap.empty) { res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">No user found</div>'; return; }
    const uid = snap.docs[0].id, userData = snap.docs[0].data();
    if (uid === currentUser.uid) { res.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">That\'s you 😄</div>'; return; }

    const existQ = query(collection(db, 'friends'), where('users', 'array-contains', currentUser.uid));
    const existSnap = await getDocs(existQ);
    const rel = existSnap.docs.find(d => d.data().users.includes(uid));

    res.innerHTML = '';
    const div = document.createElement('div'); div.className = 'friend-result';
    const av = document.createElement('div'); av.className = 'avatar md'; setAvatar(av, userData);
    const info = document.createElement('div'); info.className = 'info';
    info.innerHTML = `<strong>${escHtml(userData.displayName)}</strong><span>@${escHtml(userData.username)}</span>`;
    div.appendChild(av); div.appendChild(info);
    if (rel) {
      const badge = document.createElement('span'); badge.style.cssText = 'font-size:12px;color:var(--text-muted)';
      badge.textContent = rel.data().status === 'accepted' ? 'Already friends' : 'Pending…';
      div.appendChild(badge);
    } else {
      const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Add Friend'; btn.style.cssText = 'font-size:13px;padding:8px 16px';
      btn.addEventListener('click', async () => {
        btn.textContent = 'Sending…'; btn.disabled = true;
        try {
          await addDoc(collection(db, 'friends'), { users: [currentUser.uid, uid].sort(), from: currentUser.uid, to: uid, status: 'pending', createdAt: serverTimestamp() });
          btn.textContent = 'Request Sent ✓'; toast('Friend request sent!', 'success');
        } catch (e) { toast('Error: ' + e.message, 'error'); btn.textContent = 'Add Friend'; btn.disabled = false; }
      });
      div.appendChild(btn);
    }
    res.appendChild(div);
  } catch (e) { res.innerHTML = `<div style="padding:12px;color:#ff4757;font-size:13px">Error: ${e.message}</div>`; }
}

// ── Profile modal ─────────────────────────────────────
$('viewProfileBtn').addEventListener('click', async () => {
  if (!currentFriendId) return;
  const snap = await getDoc(doc(db, 'users', currentFriendId));
  if (!snap.exists()) return;
  openProfileModal(snap.data(), currentFriendId, true);
});

function openProfileModal(userData, uid, isFriend) {
  const av = $('profileAvatar'); setAvatar(av, userData);
  $('profileName').textContent = userData.displayName;
  $('profileTag').textContent  = '@' + (userData.username || '');
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
  showModal('settingsModal');
});
$('closeSettingsBtn').addEventListener('click', () => hideModal('settingsModal'));

$('signOutBtn').addEventListener('click', async () => {
  await updateDoc(doc(db, 'users', currentUser.uid), { online: false }).catch(() => {});
  await signOut(auth);
  window.location.href = 'index.html';
});

$('editProfileBtn').addEventListener('click', () => {
  hideModal('settingsModal');
  $('setupDisplayName').value = currentUserData.displayName || '';
  $('setupUsername').value    = currentUserData.username    || '';
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

// ── Modal helpers ─────────────────────────────────────
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('.modal-backdrop').forEach(b => {
  b.addEventListener('click', e => { if (e.target === b && b.id !== 'setupModal' && b.id !== 'callModal') b.classList.add('hidden'); });
});


