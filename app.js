/* =====================================================
   PULSE — app.js
   Full chat app logic: auth, profiles, friends,
   real-time messaging, presence
   ===================================================== */

'use strict';

// ── State ────────────────────────────────────────────
let currentUser = null;
let currentUserData = null;
let currentChatId = null;
let currentFriendId = null;
let messagesUnsubscribe = null;
let presenceInterval = null;
let typingTimeout = null;
let allFriends = [];

// ── Helpers ──────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function avatarHTML(userData, el) {
  if (userData?.photoURL) {
    el.innerHTML = `<img src="${userData.photoURL}" alt="">`;
  } else {
    el.textContent = (userData?.displayName || '?')[0].toUpperCase();
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

// ── Auth guard ───────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;

  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists || !snap.data().displayName) {
    // Pre-fill from Google
    document.getElementById('setupDisplayName').value = user.displayName || '';
    showModal('setupModal');
  } else {
    currentUserData = snap.data();
    initApp();
  }
});

// ── Setup profile ─────────────────────────────────────
document.getElementById('pfpPreview').addEventListener('click', () => {
  document.getElementById('pfpFileInput').click();
});

document.getElementById('pfpFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById('pfpPreviewImg');
    img.src = ev.target.result;
    img.style.display = 'block';
    document.querySelector('#pfpPreview svg').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

document.getElementById('setupSaveBtn').addEventListener('click', async () => {
  const displayName = document.getElementById('setupDisplayName').value.trim();
  const username = document.getElementById('setupUsername').value.trim().toLowerCase();

  if (!displayName) { showToast('Please enter a display name', 'error'); return; }
  if (!username || username.length < 3) { showToast('Username must be at least 3 characters', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showToast('Username: letters, numbers, underscores only', 'error'); return; }

  const btn = document.getElementById('setupSaveBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    // Check username uniqueness
    const usernameSnap = await db.collection('usernames').doc(username).get();
    if (usernameSnap.exists && usernameSnap.data().uid !== currentUser.uid) {
      showToast('Username taken, try another', 'error');
      btn.textContent = 'Save & Continue'; btn.disabled = false;
      return;
    }

    let photoURL = currentUser.photoURL || null;

    // Upload PFP if provided
    const fileInput = document.getElementById('pfpFileInput');
    if (fileInput.files[0]) {
      const file = fileInput.files[0];
      const ref = storage.ref(`avatars/${currentUser.uid}`);
      await ref.put(file);
      photoURL = await ref.getDownloadURL();
    }

    const userData = {
      uid: currentUser.uid,
      displayName,
      username,
      photoURL,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      online: true,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(db.collection('users').doc(currentUser.uid), userData, { merge: true });
    batch.set(db.collection('usernames').doc(username), { uid: currentUser.uid });
    await batch.commit();

    currentUserData = { ...currentUserData, ...userData };
    hideModal('setupModal');
    initApp();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    btn.textContent = 'Save & Continue'; btn.disabled = false;
  }
});

// ── Init app ──────────────────────────────────────────
function initApp() {
  updateSidebarFooter();
  startPresence();
  subscribeToFriends();
  subscribeToRequests();
  subscribeToChats();
  setupSidebarTabs();
  setupSearch();
}

// ── Presence ──────────────────────────────────────────
function startPresence() {
  const setOnline = () => db.collection('users').doc(currentUser.uid).update({
    online: true,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});

  setOnline();
  presenceInterval = setInterval(setOnline, 30000);

  const goOffline = () => {
    clearInterval(presenceInterval);
    navigator.sendBeacon && db.collection('users').doc(currentUser.uid).update({
      online: false,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  };
  window.addEventListener('beforeunload', goOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      db.collection('users').doc(currentUser.uid).update({ online: false }).catch(() => {});
    } else setOnline();
  });
}

// ── Sidebar footer ────────────────────────────────────
function updateSidebarFooter() {
  const el = document.getElementById('myAvatar');
  avatarHTML(currentUserData, el);
  document.getElementById('myName').textContent = currentUserData.displayName || '';
  document.getElementById('myTag').textContent = '@' + (currentUserData.username || '');
}

// ── Tabs ──────────────────────────────────────────────
function setupSidebarTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── Search ────────────────────────────────────────────
function setupSearch() {
  document.getElementById('sidebarSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    // Filter active panel
    document.querySelectorAll('.conv-item, .friend-item').forEach(item => {
      const name = item.querySelector('.conv-name, .friend-name')?.textContent.toLowerCase() || '';
      item.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

// ── Friends ───────────────────────────────────────────
function subscribeToFriends() {
  db.collection('friends')
    .where('users', 'array-contains', currentUser.uid)
    .where('status', '==', 'accepted')
    .onSnapshot(async snap => {
      allFriends = [];
      const list = document.getElementById('friendsList');
      list.innerHTML = '';

      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          No friends yet — add some!
        </div>`;
        return;
      }

      const uids = snap.docs.map(d => {
        const u = d.data().users.find(u => u !== currentUser.uid);
        return { docId: d.id, friendUid: u };
      });

      for (const { docId, friendUid } of uids) {
        const userSnap = await db.collection('users').doc(friendUid).get();
        if (!userSnap.exists) continue;
        const userData = userSnap.data();
        allFriends.push({ uid: friendUid, ...userData });
        renderFriendItem(list, userData, friendUid);
      }
    });
}

function renderFriendItem(container, userData, uid) {
  const div = document.createElement('div');
  div.className = 'friend-item';
  div.dataset.uid = uid;

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-wrap';
  const av = document.createElement('div');
  av.className = 'avatar md';
  avatarHTML(userData, av);
  const dot = document.createElement('div');
  dot.className = `online-dot ${userData.online ? '' : 'offline'}`;
  avatarWrap.appendChild(av);
  avatarWrap.appendChild(dot);

  div.innerHTML = `
    <div class="friend-meta" style="flex:1;min-width:0">
      <div class="friend-name">${escapeHtml(userData.displayName)}</div>
      <div class="friend-tag">@${escapeHtml(userData.username || '')}</div>
    </div>
  `;
  div.insertBefore(avatarWrap, div.firstChild);

  div.addEventListener('click', () => openChat(uid, userData));
  container.appendChild(div);
}

// ── Requests ──────────────────────────────────────────
function subscribeToRequests() {
  db.collection('friends')
    .where('to', '==', currentUser.uid)
    .where('status', '==', 'pending')
    .onSnapshot(async snap => {
      const list = document.getElementById('requestsList');
      const badge = document.getElementById('requestsBadge');
      list.innerHTML = '';

      if (snap.empty) {
        badge.classList.add('hidden');
        list.innerHTML = `<div class="empty-state">No pending requests</div>`;
        return;
      }

      badge.textContent = snap.size;
      badge.classList.remove('hidden');

      for (const doc of snap.docs) {
        const data = doc.data();
        const senderSnap = await db.collection('users').doc(data.from).get();
        if (!senderSnap.exists) continue;
        const sender = senderSnap.data();

        const div = document.createElement('div');
        div.className = 'req-item';
        const av = document.createElement('div');
        av.className = 'avatar md';
        avatarHTML(sender, av);
        div.appendChild(av);
        div.innerHTML += `
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500">${escapeHtml(sender.displayName)}</div>
            <div style="font-size:12px;color:var(--text-muted)">@${escapeHtml(sender.username || '')}</div>
          </div>
          <div class="req-btns">
            <button class="btn-accept" data-id="${doc.id}" data-from="${data.from}">Accept</button>
            <button class="btn-reject" data-id="${doc.id}">Ignore</button>
          </div>
        `;
        div.querySelector('.btn-accept').addEventListener('click', async e => {
          const { id, from } = e.target.dataset;
          await acceptFriendRequest(id, from);
        });
        div.querySelector('.btn-reject').addEventListener('click', async e => {
          await db.collection('friends').doc(e.target.dataset.id).delete();
          showToast('Request ignored');
        });
        list.appendChild(div);
      }
    });
}

async function acceptFriendRequest(docId, fromUid) {
  const chatId = getChatId(currentUser.uid, fromUid);
  const batch = db.batch();
  batch.update(db.collection('friends').doc(docId), {
    status: 'accepted',
    acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(db.collection('chats').doc(chatId), {
    participants: [currentUser.uid, fromUid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: null,
    lastMessageTime: null
  }, { merge: true });
  await batch.commit();
  showToast('Friend added! 🎉', 'success');
}

// ── Chats list ────────────────────────────────────────
function subscribeToChats() {
  db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .orderBy('lastMessageTime', 'desc')
    .onSnapshot(async snap => {
      const list = document.getElementById('chatList');
      list.innerHTML = '';

      if (snap.empty) {
        list.innerHTML = `<div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          No chats yet. Add some friends!
        </div>`;
        return;
      }

      for (const doc of snap.docs) {
        const data = doc.data();
        const friendUid = data.participants.find(p => p !== currentUser.uid);
        const userSnap = await db.collection('users').doc(friendUid).get();
        if (!userSnap.exists) continue;
        const userData = userSnap.data();
        renderChatItem(list, doc.id, data, userData, friendUid);
      }
    });
}

function renderChatItem(container, chatId, chatData, userData, friendUid) {
  const div = document.createElement('div');
  div.className = `conv-item ${currentChatId === chatId ? 'active' : ''}`;
  div.dataset.chatId = chatId;
  div.dataset.friendUid = friendUid;

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-wrap';
  const av = document.createElement('div');
  av.className = 'avatar md';
  avatarHTML(userData, av);
  const dot = document.createElement('div');
  dot.className = `online-dot ${userData.online ? '' : 'offline'}`;
  avatarWrap.appendChild(av);
  avatarWrap.appendChild(dot);
  div.appendChild(avatarWrap);

  const preview = chatData.lastMessage || 'Start chatting…';
  div.innerHTML += `
    <div class="conv-meta">
      <div class="conv-name">${escapeHtml(userData.displayName)}</div>
      <div class="conv-preview">${escapeHtml(preview)}</div>
    </div>
    <div class="conv-right">
      <span class="conv-time">${formatTime(chatData.lastMessageTime)}</span>
    </div>
  `;

  div.addEventListener('click', () => {
    document.querySelectorAll('.conv-item').forEach(i => i.classList.remove('active'));
    div.classList.add('active');
    openChat(friendUid, userData, chatId);
  });

  container.appendChild(div);
}

// ── Open chat ─────────────────────────────────────────
async function openChat(friendUid, userData, existingChatId) {
  currentFriendId = friendUid;
  currentChatId = existingChatId || getChatId(currentUser.uid, friendUid);

  // Update topbar
  const av = document.getElementById('chatAvatar');
  avatarHTML(userData, av);
  document.getElementById('chatName').textContent = userData.displayName;

  // Subscribe to friend presence for status
  db.collection('users').doc(friendUid).onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data();
    const dot = document.getElementById('chatOnlineDot');
    const status = document.getElementById('chatStatus');
    if (d.online) {
      dot.classList.remove('offline');
      status.textContent = 'Online';
    } else {
      dot.classList.add('offline');
      const lastSeen = d.lastSeen ? formatTime(d.lastSeen) + ' ago' : 'recently';
      status.textContent = `Last seen ${lastSeen}`;
    }
  });

  document.getElementById('welcomeScreen').classList.add('hidden');
  document.getElementById('chatView').classList.remove('hidden');

  // Ensure chat doc exists
  await db.collection('chats').doc(currentChatId).set({
    participants: [currentUser.uid, friendUid],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  subscribeToMessages(currentChatId);
}

// ── Messages ──────────────────────────────────────────
function subscribeToMessages(chatId) {
  if (messagesUnsubscribe) messagesUnsubscribe();
  document.getElementById('messagesArea').innerHTML = '';

  messagesUnsubscribe = db.collection('chats').doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      renderMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

function renderMessages(messages) {
  const area = document.getElementById('messagesArea');
  area.innerHTML = '';

  let lastDateLabel = null;
  let lastSender = null;
  let groupEl = null;

  for (const msg of messages) {
    const dateLabel = formatDateLabel(msg.createdAt);
    if (dateLabel !== lastDateLabel) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = dateLabel;
      area.appendChild(divider);
      lastDateLabel = dateLabel;
      lastSender = null;
      groupEl = null;
    }

    const isMine = msg.senderId === currentUser.uid;
    const sameSender = msg.senderId === lastSender;

    if (!sameSender || !groupEl) {
      groupEl = document.createElement('div');
      groupEl.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
      area.appendChild(groupEl);
      lastSender = msg.senderId;
    }

    const row = document.createElement('div');
    row.className = 'msg-row';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.text;
    row.appendChild(bubble);
    groupEl.appendChild(row);
  }

  // Meta below last group
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const isMine = last.senderId === currentUser.uid;
    meta.innerHTML = `${formatFullTime(last.createdAt)} ${isMine ? (last.read ? '<span class="msg-tick read">✓✓</span>' : '<span class="msg-tick">✓✓</span>') : ''}`;
    area.appendChild(meta);
  }

  area.scrollTop = area.scrollHeight;
}

// ── Send message ──────────────────────────────────────
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentChatId) return;

  msgInput.value = '';
  msgInput.style.height = 'auto';

  const msgData = {
    text,
    senderId: currentUser.uid,
    senderName: currentUserData.displayName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    read: false,
  };

  try {
    const batch = db.batch();
    const msgRef = db.collection('chats').doc(currentChatId).collection('messages').doc();
    batch.set(msgRef, msgData);
    batch.update(db.collection('chats').doc(currentChatId), {
      lastMessage: text.length > 60 ? text.slice(0, 60) + '…' : text,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
      lastSenderId: currentUser.uid,
    });
    await batch.commit();
  } catch (e) {
    showToast('Failed to send: ' + e.message, 'error');
  }
}

// ── Add Friend ────────────────────────────────────────
document.getElementById('addFriendBtn').addEventListener('click', () => showModal('addFriendModal'));
document.getElementById('closeFriendModal').addEventListener('click', () => hideModal('addFriendModal'));

document.getElementById('friendSearchBtn').addEventListener('click', searchForFriend);
document.getElementById('friendSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchForFriend();
});

async function searchForFriend() {
  const username = document.getElementById('friendSearchInput').value.trim().toLowerCase();
  const resultEl = document.getElementById('friendSearchResult');
  if (!username) return;

  resultEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Searching…</div>';

  try {
    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    if (snap.empty) {
      resultEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">No user found</div>';
      return;
    }

    const userData = snap.docs[0].data();
    const uid = snap.docs[0].id;

    if (uid === currentUser.uid) {
      resultEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">That\'s you! 😄</div>';
      return;
    }

    // Check if already friends
    const existing = await db.collection('friends')
      .where('users', 'array-contains', currentUser.uid)
      .where('status', 'in', ['accepted', 'pending'])
      .get();

    const alreadyFriend = existing.docs.some(d => d.data().users.includes(uid));

    const av = document.createElement('div');
    av.className = 'avatar md';
    avatarHTML(userData, av);

    resultEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'friend-result';
    div.appendChild(av);
    div.innerHTML += `
      <div class="info">
        <strong>${escapeHtml(userData.displayName)}</strong>
        <span>@${escapeHtml(userData.username)}</span>
      </div>
    `;

    if (alreadyFriend) {
      div.innerHTML += `<span style="font-size:12px;color:var(--text-muted)">Already friends</span>`;
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Add Friend';
      btn.style.fontSize = '13px';
      btn.style.padding = '8px 16px';
      btn.addEventListener('click', async () => {
        btn.textContent = 'Sending…';
        btn.disabled = true;
        try {
          await db.collection('friends').add({
            users: [currentUser.uid, uid],
            from: currentUser.uid,
            to: uid,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          btn.textContent = 'Sent ✓';
          showToast('Friend request sent!', 'success');
        } catch (e) {
          showToast('Error: ' + e.message, 'error');
          btn.textContent = 'Add Friend'; btn.disabled = false;
        }
      });
      div.appendChild(btn);
    }

    resultEl.appendChild(div);
  } catch (e) {
    resultEl.innerHTML = `<div style="padding:12px;color:#ff4757;font-size:13px">Error: ${e.message}</div>`;
  }
}

// ── Profile modal ─────────────────────────────────────
document.getElementById('viewProfileBtn').addEventListener('click', async () => {
  if (!currentFriendId) return;
  const snap = await db.collection('users').doc(currentFriendId).get();
  if (!snap.exists) return;
  const data = snap.data();
  openProfileModal(data, currentFriendId, true);
});

function openProfileModal(userData, uid, isFriend) {
  const av = document.getElementById('profileAvatar');
  avatarHTML(userData, av);
  document.getElementById('profileName').textContent = userData.displayName;
  document.getElementById('profileTag').textContent = '@' + (userData.username || '');

  const actions = document.getElementById('profileActions');
  actions.innerHTML = '';
  if (isFriend) {
    const msgBtn = document.createElement('button');
    msgBtn.className = 'btn btn-primary';
    msgBtn.textContent = 'Message';
    msgBtn.addEventListener('click', () => {
      hideModal('profileModal');
      openChat(uid, userData);
    });
    actions.appendChild(msgBtn);
  }

  showModal('profileModal');
}

document.getElementById('closeProfileModal').addEventListener('click', () => hideModal('profileModal'));

// ── Settings ──────────────────────────────────────────
document.getElementById('openSettingsBtn').addEventListener('click', () => {
  const av = document.getElementById('settingsAvatar');
  avatarHTML(currentUserData, av);
  document.getElementById('settingsName').textContent = currentUserData.displayName || '';
  document.getElementById('settingsTag').textContent = '@' + (currentUserData.username || '');
  showModal('settingsModal');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => hideModal('settingsModal'));

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await db.collection('users').doc(currentUser.uid).update({ online: false }).catch(() => {});
  await auth.signOut();
  window.location.href = 'index.html';
});

document.getElementById('notifBtn').addEventListener('click', () => {
  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        showToast('Notifications enabled!', 'success');
        document.getElementById('notifBtn').textContent = 'Enabled ✓';
      }
    });
  }
});

document.getElementById('editProfileBtn').addEventListener('click', () => {
  hideModal('settingsModal');
  // Re-show setup modal with current data
  document.getElementById('setupDisplayName').value = currentUserData.displayName || '';
  document.getElementById('setupUsername').value = currentUserData.username || '';
  if (currentUserData.photoURL) {
    const img = document.getElementById('pfpPreviewImg');
    img.src = currentUserData.photoURL;
    img.style.display = 'block';
    document.querySelector('#pfpPreview svg').style.display = 'none';
  }
  showModal('setupModal');
});

// ── Modal helpers ─────────────────────────────────────
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Close modals on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop && backdrop.id !== 'setupModal') {
      backdrop.classList.add('hidden');
    }
  });
});

// ── XSS protection ────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
