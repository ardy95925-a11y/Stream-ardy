// ═══════════════════════════════════════════════════════════
// PULSE2 — app.js  (Firebase + Auth + State + Sidebar)
// ═══════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { initChat, loadChannel } from "./chat.js";
import { initUI }                from "./ui.js";
import { initExtras }            from "./extras.js";
import { openRichProfile, buildRichUserCard, injectProfileStyles } from "./profile.js";

// ── Firebase ─────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCW6Utclu2ME1z1AwUj2xwTm_-it-aWFrI",
  authDomain: "pulse-c5322.firebaseapp.com",
  projectId: "pulse-c5322",
  storageBucket: "pulse-c5322.firebasestorage.app",
  messagingSenderId: "700936968948",
  appId: "1:700936968948:web:abe29f631b258516551ca1",
  measurementId: "G-LPHD13EJQP"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db   = getFirestore(firebaseApp);

export {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove, limit
};

// ── State ─────────────────────────────────────────────────────
export const state = {
  user:               null,
  userDoc:            null,
  currentChannelId:   null,
  currentChannelType: null,
  currentChannelMeta: {},
  channels:           [],
  preferences:        loadPrefs(),
  unsubChannels:      null,
  unsubDMs:           null,
};

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('p2_prefs') || '{}'); }
  catch { return {}; }
}
export function savePrefs() {
  localStorage.setItem('p2_prefs', JSON.stringify(state.preferences));
}

// ── Auth ──────────────────────────────────────────────────────
function setupAuth() {
  const tabs      = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('login-form');
  const regForm   = document.getElementById('register-form');
  const errEl     = document.getElementById('auth-error');
  const loader    = document.getElementById('auth-loader');

  // Tab switching
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loginForm.classList.toggle('active', tab.dataset.tab === 'login');
    regForm.classList.toggle('active',   tab.dataset.tab === 'register');
    errEl.textContent = '';
  }));

  // Color picker
  let selectedColor = '#FF6B1A';
  document.querySelectorAll('#reg-color-picker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#reg-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      selectedColor = sw.dataset.color;
    });
  });

  // Login
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth,
        document.getElementById('login-email').value.trim(),
        document.getElementById('login-password').value);
    } catch (err) {
      errEl.textContent = friendlyError(err.code);
      setLoading(false);
    }
  });

  // Register
  regForm.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const pass     = document.getElementById('reg-password').value;

    if (username.length < 2) { errEl.textContent = 'Username must be ≥ 2 characters.'; return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { errEl.textContent = 'Letters, numbers and _ only.'; return; }
    if (pass.length < 6) { errEl.textContent = 'Password must be ≥ 6 characters.'; return; }

    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('usernameLower', '==', username.toLowerCase())));
      if (!snap.empty) { errEl.textContent = 'Username already taken.'; setLoading(false); return; }

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: username });
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid, username, usernameLower: username.toLowerCase(),
        displayName: username, email, avatarColor: selectedColor,
        bio: '', status: 'online',
        createdAt: serverTimestamp(), lastSeen: serverTimestamp(),
      });
      await ensureGeneralChannel();
    } catch (err) {
      errEl.textContent = friendlyError(err.code);
      setLoading(false);
    }
  });

  function setLoading(on) {
    loader.classList.toggle('hidden', !on);
    document.querySelectorAll('.btn-primary').forEach(b => b.disabled = on);
  }

  // Auth state change
  onAuthStateChanged(auth, async user => {
    if (user) {
      state.user = user;
      let snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid, username: user.displayName || 'User',
          usernameLower: (user.displayName || 'user').toLowerCase(),
          displayName: user.displayName || 'User', email: user.email || '',
          avatarColor: '#FF6B1A', bio: '', status: 'online',
          createdAt: serverTimestamp(), lastSeen: serverTimestamp(),
        });
        snap = await getDoc(doc(db, 'users', user.uid));
      }
      state.userDoc = snap.data();

      try { await updateDoc(doc(db, 'users', user.uid), { status: 'online', lastSeen: serverTimestamp() }); } catch {}

      document.getElementById('auth-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
      setLoading(false);

      await ensureGeneralChannel();
      initUI();
      initChat();
      initExtras();
      injectProfileStyles();
      loadSidebar();
      applyPreferences();
    } else {
      state.user = null;
      state.userDoc = null;
      document.getElementById('app-screen').classList.remove('active');
      document.getElementById('auth-screen').classList.add('active');
    }
  });

  // Mark offline on unload
  window.addEventListener('beforeunload', () => {
    if (state.user) {
      navigator.sendBeacon && navigator.sendBeacon('/noop'); // graceful
      updateDoc(doc(db, 'users', state.user.uid), { status: 'offline', lastSeen: serverTimestamp() }).catch(() => {});
    }
  });

  // Logout buttons
  const doLogout = async () => {
    if (state.user) {
      try { await updateDoc(doc(db, 'users', state.user.uid), { status: 'offline', lastSeen: serverTimestamp() }); } catch {}
    }
    if (state.unsubChannels) state.unsubChannels();
    if (state.unsubDMs)      state.unsubDMs();
    await signOut(auth);
  };
  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('settings-logout-btn').addEventListener('click', doLogout);
}

// ── Sidebar Setup ─────────────────────────────────────────────
function loadSidebar() {
  const uDoc   = state.userDoc;
  const name   = uDoc?.displayName || 'User';
  const color  = uDoc?.avatarColor || '#FF6B1A';
  const status = uDoc?.status || 'online';
  const initial = name.charAt(0).toUpperCase();

  // Avatar / name
  ['sidebar-avatar', 'rail-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = initial; el.style.background = color; }
  });
  const unEl = document.getElementById('sidebar-username');
  if (unEl) unEl.textContent = name;
  updateStatusDisplay(status);

  // Nav rail clicks
  document.querySelectorAll('.rail-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchSidebarView(btn.dataset.view);
    });
  });

  // New channel buttons
  ['new-channel-btn', 'new-channel-btn2'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => showModal('new-channel-modal'));
  });

  // New DM button
  document.getElementById('new-dm-btn')?.addEventListener('click', () => {
    document.getElementById('dm-search-input').value = '';
    document.getElementById('dm-search-results').innerHTML = '';
    showModal('dm-modal');
  });

  // Profile buttons — use rich profile editor
  ['open-profile-btn', 'footer-profile-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openRichProfile);
  });

  // Sidebar settings shortcut
  document.getElementById('sidebar-settings-btn')?.addEventListener('click', () => {
    switchSidebarView('settings');
    document.querySelectorAll('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'settings'));
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeAllModals();
  });

  // Channel type cards
  document.querySelectorAll('.channel-type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.channel-type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Create channel
  document.getElementById('create-channel-btn')?.addEventListener('click', createChannel);

  // DM search
  const dmInput = document.getElementById('dm-search-input');
  let dmDebounce;
  dmInput?.addEventListener('input', () => {
    clearTimeout(dmDebounce);
    dmDebounce = setTimeout(() => searchUsers(dmInput.value.trim()), 300);
  });

  // User popup DM button
  document.getElementById('popup-dm-btn')?.addEventListener('click', async () => {
    const uid = document.getElementById('popup-dm-btn').dataset.uid;
    if (!uid) return;
    closeAllModals();
    const otherSnap = await getDoc(doc(db, 'users', uid));
    if (otherSnap.exists()) await openOrCreateDM(uid, otherSnap.data());
  });

  // Profile save
  document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile);

  // Status picker in profile modal
  document.querySelectorAll('#status-picker .status-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#status-picker .status-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Profile color picker
  document.querySelectorAll('#profile-color-picker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#profile-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      // Live preview
      const nameIn = document.getElementById('profile-name-input')?.value || state.userDoc?.displayName || '';
      const av = document.getElementById('profile-avatar-preview');
      if (av) { av.style.background = sw.dataset.color; av.textContent = nameIn.charAt(0).toUpperCase() || '?'; }
    });
  });

  // Profile name live preview
  document.getElementById('profile-name-input')?.addEventListener('input', e => {
    const nm = e.target.value.trim() || state.userDoc?.displayName || '?';
    const av = document.getElementById('profile-avatar-preview');
    const pr = document.getElementById('profile-name-preview');
    if (av) av.textContent = nm.charAt(0).toUpperCase();
    if (pr) pr.textContent = nm;
  });

  // Close panels
  document.getElementById('close-members-btn')?.addEventListener('click', () => {
    document.getElementById('members-panel').classList.add('hidden');
  });
  document.getElementById('close-pinned-btn')?.addEventListener('click', () => {
    document.getElementById('pinned-panel').classList.add('hidden');
  });

  // Members toggle
  document.getElementById('members-btn')?.addEventListener('click', toggleMembersPanel);
  document.getElementById('pin-btn')?.addEventListener('click', togglePinnedPanel);

  // Member filter
  document.getElementById('member-filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.member-item').forEach(el => {
      el.style.display = el.dataset.name?.includes(q) ? '' : 'none';
    });
  });

  // Load channels and DMs
  loadChannels();
  loadDMs();
}

// ── Channels ──────────────────────────────────────────────────
function loadChannels() {
  const list = document.getElementById('channel-list');
  const q = query(collection(db, 'channels'), orderBy('createdAt', 'asc'));

  if (state.unsubChannels) state.unsubChannels();
  state.unsubChannels = onSnapshot(q, snap => {
    state.channels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.innerHTML = '';
    if (state.channels.length === 0) return;

    state.channels.forEach(ch => {
      const li = document.createElement('li');
      li.className = 'ch-item' + (state.currentChannelId === ch.id ? ' active' : '');
      li.dataset.id = ch.id;
      li.innerHTML = `
        <span class="ch-icon">${ch.type === 'private' ? '🔒' : '#'}</span>
        <span class="ch-name">${escHtml(ch.name)}</span>
      `;
      li.addEventListener('click', () => selectConversation(ch.id, 'channel', ch));
      list.appendChild(li);
    });

    // Auto-select general on first load
    if (!state.currentChannelId) {
      const general = state.channels.find(c => c.name === 'general');
      if (general) selectConversation(general.id, 'channel', general);
    }
  });
}

// ── DMs ───────────────────────────────────────────────────────
function loadDMs() {
  const list = document.getElementById('dm-list');
  const q = query(
    collection(db, 'dms'),
    where('members', 'array-contains', state.user.uid),
    orderBy('lastActivity', 'desc')
  );

  if (state.unsubDMs) state.unsubDMs();
  state.unsubDMs = onSnapshot(q, async snap => {
    list.innerHTML = '';
    for (const d of snap.docs) {
      const dm   = { id: d.id, ...d.data() };
      const uid2 = dm.members?.find(m => m !== state.user.uid);
      if (!uid2) continue;
      try {
        const uSnap = await getDoc(doc(db, 'users', uid2));
        const other = uSnap.exists() ? uSnap.data() : { displayName: 'Unknown', avatarColor: '#555' };
        const li = document.createElement('li');
        li.className = 'dm-item' + (state.currentChannelId === dm.id ? ' active' : '');
        li.dataset.id = dm.id;
        li.innerHTML = `
          <div class="dm-avatar-xs" style="background:${other.avatarColor || '#FF6B1A'}">${(other.displayName || '?').charAt(0).toUpperCase()}</div>
          <span class="dm-name">${escHtml(other.displayName || 'Unknown')}</span>
        `;
        li.addEventListener('click', () => selectConversation(dm.id, 'dm', other));
        list.appendChild(li);
      } catch {}
    }
  });
}

// ── Select conversation ───────────────────────────────────────
export function selectConversation(id, type, meta = {}) {
  state.currentChannelId   = id;
  state.currentChannelType = type;
  state.currentChannelMeta = meta;

  // Update active classes
  document.querySelectorAll('.ch-item, .dm-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id));

  // Update header
  const iconEl    = document.getElementById('chat-icon');
  const nameEl    = document.getElementById('chat-name');
  const topicEl   = document.getElementById('chat-topic');
  const inputEl   = document.getElementById('message-input');

  if (type === 'channel') {
    iconEl.textContent = meta.type === 'private' ? '🔒' : '#';
    iconEl.style.fontSize = '';
    nameEl.textContent  = meta.name || id;
    topicEl.textContent = meta.topic || '';
    if (inputEl) inputEl.placeholder = `Message #${meta.name || id}`;
  } else {
    iconEl.textContent = '';
    iconEl.style.fontSize = '20px';
    iconEl.innerHTML = `<div class="user-avatar" style="width:28px;height:28px;font-size:12px;background:${meta.avatarColor || '#FF6B1A'}">${(meta.displayName || '?').charAt(0).toUpperCase()}</div>`;
    nameEl.textContent  = meta.displayName || 'DM';
    topicEl.textContent = '';
    if (inputEl) inputEl.placeholder = `Message ${meta.displayName || ''}`;
  }

  // Show chat
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  document.getElementById('pinned-panel').classList.add('hidden');

  // Close rail sidebar on mobile
  if (window.innerWidth < 500) document.getElementById('sidebar').classList.remove('open');

  loadChannel(id, type);

  // Update members panel if open
  if (!document.getElementById('members-panel').classList.contains('hidden')) {
    loadMembersPanel();
  }
}

// ── Members panel ──────────────────────────────────────────────
function toggleMembersPanel() {
  const panel = document.getElementById('members-panel');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (wasHidden) loadMembersPanel();
}

export async function loadMembersPanel() {
  const onlineList  = document.getElementById('online-members');
  const offlineList = document.getElementById('offline-members');
  const cntOn  = document.getElementById('cnt-online');
  const cntOff = document.getElementById('cnt-offline');
  if (!onlineList) return;

  onlineList.innerHTML  = `<li style="padding:8px;font-size:12px;color:var(--text-600);font-family:var(--font-mono)">Loading...</li>`;
  offlineList.innerHTML = '';

  try {
    const snap  = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => d.data());
    const online  = users.filter(u => u.status === 'online');
    const offline = users.filter(u => u.status !== 'online');

    onlineList.innerHTML  = '';
    offlineList.innerHTML = '';
    if (cntOn)  cntOn.textContent  = online.length;
    if (cntOff) cntOff.textContent = offline.length;

    online.forEach(u => onlineList.appendChild(makeMemberItem(u, true)));
    offline.forEach(u => offlineList.appendChild(makeMemberItem(u, false)));

    if (!online.length)  onlineList.innerHTML  = `<li style="padding:8px;font-size:12px;color:var(--text-600);font-family:var(--font-mono)">No one online</li>`;
    if (!offline.length) offlineList.innerHTML = `<li style="padding:8px;font-size:12px;color:var(--text-600);font-family:var(--font-mono)">None offline</li>`;
  } catch (e) {
    console.error('Members load error:', e);
    onlineList.innerHTML = `<li style="padding:8px;font-size:12px;color:var(--red)">Failed to load.</li>`;
  }
}

function makeMemberItem(user, isOnline) {
  const li = document.createElement('li');
  li.className = `member-item${!isOnline ? ' member-offline' : ''}`;
  li.dataset.name = (user.displayName || '').toLowerCase();
  li.innerHTML = `
    <div class="member-avatar-sm" style="background:${user.avatarColor || '#FF6B1A'}">
      ${(user.displayName || '?').charAt(0).toUpperCase()}
      <span class="status-dot ${isOnline ? (user.status || 'online') : 'offline'}"></span>
    </div>
    <span class="member-name">${escHtml(user.displayName || 'Unknown')}</span>
  `;
  li.addEventListener('click', () => showUserPopup(user));
  return li;
}

// ── Pinned panel ──────────────────────────────────────────────
function togglePinnedPanel() {
  const panel = document.getElementById('pinned-panel');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (wasHidden) renderPins();
}

export async function renderPins() {
  const list = document.getElementById('pinned-list');
  if (!list || !state.currentChannelId) return;
  list.innerHTML = '';

  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    const q    = query(collection(db, coll, state.currentChannelId, 'messages'), where('pinned', '==', true));
    const snap = await getDocs(q);
    if (snap.empty) { list.innerHTML = '<div class="pinned-empty">No pinned messages yet. Right-click a message to pin it.</div>'; return; }
    snap.forEach(d => {
      const msg = d.data();
      const div = document.createElement('div');
      div.className = 'pinned-item';
      div.innerHTML = `<div class="pinned-item-meta">${escHtml(msg.author || 'Unknown')} · ${formatTime(msg.timestamp)}</div><div>${escHtml((msg.content || '').slice(0, 120))}</div>`;
      list.appendChild(div);
    });
  } catch { list.innerHTML = '<div class="pinned-empty">Failed to load pins.</div>'; }
}

// ── Create channel ────────────────────────────────────────────
async function createChannel() {
  const nameRaw = document.getElementById('channel-name-input').value.trim();
  const topic   = document.getElementById('channel-topic-input').value.trim();
  const type    = document.querySelector('input[name="channel-type"]:checked')?.value || 'public';
  const name    = nameRaw.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');

  if (!name) { showToast('Enter a channel name.', 'error'); return; }

  try {
    await addDoc(collection(db, 'channels'), {
      name, topic, type, createdAt: serverTimestamp(), createdBy: state.user.uid,
    });
    closeAllModals();
    document.getElementById('channel-name-input').value  = '';
    document.getElementById('channel-topic-input').value = '';
    showToast(`#${name} created!`, 'success');
  } catch (err) {
    showToast('Failed to create channel.', 'error');
    console.error(err);
  }
}

// ── User search / DMs ──────────────────────────────────────────
async function searchUsers(val) {
  const results = document.getElementById('dm-search-results');
  results.innerHTML = '';
  if (!val || val.length < 1) return;

  try {
    const q    = query(collection(db, 'users'), where('usernameLower', '>=', val.toLowerCase()), where('usernameLower', '<=', val.toLowerCase() + '\uf8ff'), limit(10));
    const snap = await getDocs(q);

    if (snap.empty) {
      results.innerHTML = `<li style="padding:10px;color:var(--text-600);font-family:var(--font-mono);font-size:12px">No users found</li>`;
      return;
    }

    snap.forEach(d => {
      const u = d.data();
      if (u.uid === state.user.uid) return;
      const li = document.createElement('li');
      li.className = 'dm-user-result';
      li.innerHTML = `
        <div class="user-avatar" style="width:36px;height:36px;font-size:15px;background:${u.avatarColor || '#FF6B1A'}">${(u.displayName || '?').charAt(0).toUpperCase()}</div>
        <div><div class="uname">${escHtml(u.displayName || 'Unknown')}</div><div class="utag">@${escHtml(u.username || '')}</div></div>
      `;
      li.addEventListener('click', async () => {
        closeAllModals();
        await openOrCreateDM(u.uid, u);
      });
      results.appendChild(li);
    });
  } catch (err) {
    console.error('User search error:', err);
    results.innerHTML = `<li style="padding:10px;color:var(--red);font-size:12px">Search failed.</li>`;
  }
}

export async function openOrCreateDM(otherUid, otherUser) {
  // Check if DM already exists
  try {
    const q = query(collection(db, 'dms'), where('members', 'array-contains', state.user.uid));
    const snap = await getDocs(q);
    let existing = null;
    snap.forEach(d => {
      if (d.data().members?.includes(otherUid)) existing = { id: d.id, ...d.data() };
    });

    if (existing) {
      selectConversation(existing.id, 'dm', otherUser);
    } else {
      const ref = await addDoc(collection(db, 'dms'), {
        members: [state.user.uid, otherUid],
        createdAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      });
      selectConversation(ref.id, 'dm', otherUser);
    }
  } catch (err) {
    showToast('Failed to open DM.', 'error');
    console.error(err);
  }
}

// ── Profile modal ──────────────────────────────────────────────
function openProfileModal() {
  const uDoc = state.userDoc;
  if (!uDoc) return;

  const avEl = document.getElementById('profile-avatar-preview');
  const nmEl = document.getElementById('profile-name-preview');
  const unEl = document.getElementById('profile-user-preview');
  const niEl = document.getElementById('profile-name-input');
  const biEl = document.getElementById('profile-bio-input');

  if (avEl) { avEl.textContent = (uDoc.displayName || '?').charAt(0).toUpperCase(); avEl.style.background = uDoc.avatarColor || '#FF6B1A'; }
  if (nmEl) nmEl.textContent = uDoc.displayName || '';
  if (unEl) unEl.textContent = `@${uDoc.username || ''}`;
  if (niEl) niEl.value = uDoc.displayName || '';
  if (biEl) biEl.value = uDoc.bio || '';

  // Set color swatch
  document.querySelectorAll('#profile-color-picker .color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === uDoc.avatarColor);
  });

  // Set status
  document.querySelectorAll('#status-picker .status-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === (uDoc.status || 'online'));
  });

  showModal('profile-modal');
}

async function saveProfile() {
  const name   = document.getElementById('profile-name-input')?.value.trim();
  const bio    = document.getElementById('profile-bio-input')?.value.trim();
  const status = document.querySelector('#status-picker .status-chip.active')?.dataset.status || 'online';
  const color  = document.querySelector('#profile-color-picker .color-swatch.active')?.dataset.color || state.userDoc?.avatarColor || '#FF6B1A';

  if (!name) { showToast('Display name cannot be empty.', 'error'); return; }

  try {
    await updateDoc(doc(db, 'users', state.user.uid), {
      displayName: name, bio, status, avatarColor: color, lastSeen: serverTimestamp(),
    });
    await updateProfile(state.user, { displayName: name });

    // Update local state
    state.userDoc = { ...state.userDoc, displayName: name, bio, status, avatarColor: color };

    // Update sidebar UI
    ['sidebar-avatar', 'rail-avatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = name.charAt(0).toUpperCase(); el.style.background = color; }
    });
    const unEl = document.getElementById('sidebar-username');
    if (unEl) unEl.textContent = name;
    updateStatusDisplay(status);

    closeAllModals();
    showToast('Profile saved!', 'success');
  } catch (err) {
    showToast('Failed to save profile.', 'error');
    console.error(err);
  }
}

function updateStatusDisplay(status) {
  const dot   = document.getElementById('sidebar-status-dot');
  const label = document.getElementById('sidebar-status-label');
  const labels = { online: 'Online', idle: 'Idle', dnd: 'Busy', invisible: 'Invisible', offline: 'Offline' };

  if (dot) {
    dot.className = `status-dot-sm ${status}`;
  }
  if (label) label.textContent = labels[status] || 'Online';
}

// ── Show user popup ────────────────────────────────────────────
export function showUserPopup(user) {
  buildRichUserCard(user);
}

// ── Sidebar view switching ────────────────────────────────────
export function switchSidebarView(view) {
  document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`sidebar-${view}`);
  if (target) target.classList.add('active');
  if (view === 'search') setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
}

// ── Ensure #general exists ────────────────────────────────────
export async function ensureGeneralChannel() {
  try {
    const snap = await getDocs(query(collection(db, 'channels'), where('name', '==', 'general')));
    if (snap.empty) {
      await addDoc(collection(db, 'channels'), {
        name: 'general', topic: 'The main hub for everyone',
        type: 'public', createdAt: serverTimestamp(), createdBy: state.user?.uid || 'system',
      });
    }
  } catch (e) { console.warn('ensureGeneral:', e); }
}

// ── Preferences ───────────────────────────────────────────────
export function applyPreferences() {
  const p = state.preferences;
  if (p.lightMode)   document.body.classList.add('light-mode');
  if (p.compactMode) document.body.classList.add('compact-mode');
  if (p.fontSize)    { document.documentElement.style.setProperty('--msg-font-size', p.fontSize); const l = document.getElementById('font-size-val'); if (l) l.textContent = p.fontSize; }
  if (p.accentColor) applyAccentColor(p.accentColor);

  const toggles = {
    'theme-toggle':      !!p.lightMode,
    'compact-toggle':    !!p.compactMode,
    'sound-toggle':      p.sound !== false,
    'notif-toggle':      !!p.notifications,
    'timestamp-toggle':  p.timestamps !== false,
    'typing-pref-toggle':p.sendTyping !== false,
    'grouping-toggle':   p.grouping !== false,
    'enter-send-toggle': p.enterSend !== false,
  };
  Object.entries(toggles).forEach(([id, val]) => {
    const btn = document.getElementById(id);
    if (btn) { btn.classList.toggle('on', val); btn.dataset.on = String(val); }
  });

  if (p.accentColor) {
    document.querySelectorAll('#accent-color-picker .color-swatch').forEach(sw =>
      sw.classList.toggle('active', sw.dataset.color === p.accentColor));
  }
}

export function applyAccentColor(color) {
  document.documentElement.style.setProperty('--orange', color);
  document.documentElement.style.setProperty('--orange-l', color);
  // Dim = color + 1f (12% alpha hex)
  document.documentElement.style.setProperty('--orange-dim', color + '1f');
  document.documentElement.style.setProperty('--orange-glow', color + '3a');
}

// ── Modals ────────────────────────────────────────────────────
export function showModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id)?.classList.remove('hidden');
}
export function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
  if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');
}
export function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Toast ─────────────────────────────────────────────────────
export function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s var(--ease) forwards';
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ── Helpers ───────────────────────────────────────────────────
export function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str || '')));
  return d.innerHTML;
}

export function formatTime(ts) {
  if (!ts) return '';
  try {
    const d   = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function statusColor(s) {
  return { online: '#23d18b', idle: '#faa61a', dnd: '#f04747', invisible: '#747f8d', offline: '#747f8d' }[s] || '#747f8d';
}

function friendlyError(code) {
  const m = {
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/invalid-email':        'Please enter a valid email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/user-not-found':       'No account with that email.',
    'auth/weak-password':        'Password is too short (min 6 chars).',
    'auth/too-many-requests':    'Too many attempts – try again later.',
    'auth/invalid-credential':   'Wrong email or password.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return m[code] || `Error: ${code}`;
}

// ── Boot ──────────────────────────────────────────────────────
setupAuth();
