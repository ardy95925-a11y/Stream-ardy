// ============================================
// PULSE2 — app.js (entry point + auth + state)
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initUI } from "./ui.js";
import { initChat } from "./chat.js";

// ---- Firebase Config ----
const firebaseConfig = {
  apiKey: "AIzaSyCW6Utclu2ME1z1AwUj2xwTm_-it-aWFrI",
  authDomain: "pulse-c5322.firebaseapp.com",
  projectId: "pulse-c5322",
  storageBucket: "pulse-c5322.firebasestorage.app",
  messagingSenderId: "700936968948",
  appId: "1:700936968948:web:abe29f631b258516551ca1",
  measurementId: "G-LPHD13EJQP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- Global State ----
export const state = {
  user: null,
  userDoc: null,
  currentChannel: null,
  currentChannelType: null, // 'channel' | 'dm'
  channels: [],
  dms: [],
  unsubMessages: null,
  unsubTyping: null,
  membersOpen: false,
};

export { auth, db, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove };

// ---- Auth Logic ----
function setupAuth() {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');

  const tabs = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const errorEl = document.getElementById('auth-error');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loginForm.classList.toggle('active', tab.dataset.tab === 'login');
      registerForm.classList.toggle('active', tab.dataset.tab === 'register');
      errorEl.textContent = '';
    });
  });

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      errorEl.textContent = friendlyError(err.code);
    }
  });

  // Register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!username || username.length < 2) {
      errorEl.textContent = 'Username must be at least 2 characters.';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters.';
      return;
    }

    try {
      // Check username uniqueness
      const usernameQuery = query(collection(db, 'users'), where('username', '==', username.toLowerCase()));
      const snap = await getDocs(usernameQuery);
      if (!snap.empty) {
        errorEl.textContent = 'Username already taken.';
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: username });

      // Create user doc
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        username: username.toLowerCase(),
        displayName: username,
        email: email,
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
        status: 'online',
        avatarColor: randomColor(),
      });

      // Auto-join general channel
      await joinChannel(cred.user.uid, 'general');
    } catch (err) {
      errorEl.textContent = friendlyError(err.code);
    }
  });

  // Auth state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.user = user;
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (userSnap.exists()) {
        state.userDoc = userSnap.data();
        // Update online status
        await updateDoc(doc(db, 'users', user.uid), { status: 'online', lastSeen: serverTimestamp() });
      }

      authScreen.classList.remove('active');
      appScreen.classList.add('active');
      initUI();
      initChat();
      loadSidebar();
    } else {
      state.user = null;
      state.userDoc = null;
      authScreen.classList.add('active');
      appScreen.classList.remove('active');
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (state.user) {
      await updateDoc(doc(db, 'users', state.user.uid), { status: 'offline', lastSeen: serverTimestamp() });
    }
    await signOut(auth);
  });
}

// ---- Sidebar Loader ----
async function loadSidebar() {
  // Set user info in sidebar
  const username = state.userDoc?.displayName || state.user.displayName || 'User';
  const sidebarUsername = document.getElementById('sidebar-username');
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  sidebarUsername.textContent = username;
  sidebarAvatar.textContent = username.charAt(0).toUpperCase();
  sidebarAvatar.style.background = state.userDoc?.avatarColor || '#FF6B1A';

  await loadChannels();
  await loadDMs();
  setupSidebarControls();
}

async function loadChannels() {
  const channelList = document.getElementById('channel-list');
  channelList.innerHTML = '';

  // Real-time channel listener
  const q = query(collection(db, 'channels'), orderBy('createdAt', 'asc'));
  onSnapshot(q, (snap) => {
    state.channels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderChannels();
  });
}

function renderChannels() {
  const channelList = document.getElementById('channel-list');
  channelList.innerHTML = '';

  if (state.channels.length === 0) {
    ensureGeneralChannel();
    return;
  }

  state.channels.forEach(ch => {
    const li = document.createElement('li');
    li.className = `channel-item${state.currentChannel === ch.id ? ' active' : ''}`;
    li.dataset.id = ch.id;
    li.innerHTML = `
      <span class="${ch.type === 'private' ? 'channel-lock' : 'channel-hash'}">${ch.type === 'private' ? '🔒' : '#'}</span>
      <span>${ch.name}</span>
    `;
    li.addEventListener('click', () => selectChannel(ch.id, 'channel'));
    channelList.appendChild(li);
  });
}

async function ensureGeneralChannel() {
  const snap = await getDocs(query(collection(db, 'channels'), where('name', '==', 'general')));
  if (snap.empty) {
    await addDoc(collection(db, 'channels'), {
      name: 'general',
      type: 'public',
      createdAt: serverTimestamp(),
      createdBy: state.user.uid,
    });
  }
}

async function loadDMs() {
  const q = query(collection(db, 'dms'), where('members', 'array-contains', state.user.uid), orderBy('lastActivity', 'desc'));
  onSnapshot(q, async (snap) => {
    const dmList = document.getElementById('dm-list');
    dmList.innerHTML = '';

    for (const docSnap of snap.docs) {
      const dm = { id: docSnap.id, ...docSnap.data() };
      const otherId = dm.members.find(m => m !== state.user.uid);
      if (!otherId) continue;

      const otherSnap = await getDoc(doc(db, 'users', otherId));
      const other = otherSnap.exists() ? otherSnap.data() : { displayName: 'Unknown', avatarColor: '#555' };

      const li = document.createElement('li');
      li.className = `dm-item${state.currentChannel === dm.id ? ' active' : ''}`;
      li.dataset.id = dm.id;
      li.innerHTML = `
        <div class="user-avatar" style="width:20px;height:20px;font-size:10px;background:${other.avatarColor || '#FF6B1A'}">${other.displayName?.charAt(0).toUpperCase()}</div>
        <span>${other.displayName}</span>
      `;
      li.addEventListener('click', () => selectChannel(dm.id, 'dm', other));
      dmList.appendChild(li);
    }
  });
}

export function selectChannel(id, type, meta = {}) {
  state.currentChannel = id;
  state.currentChannelType = type;

  // Update active states
  document.querySelectorAll('.channel-item, .dm-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  // Update header
  const icon = document.getElementById('chat-channel-icon');
  const name = document.getElementById('chat-channel-name');

  if (type === 'dm') {
    icon.textContent = '';
    icon.innerHTML = `<div class="user-avatar" style="width:22px;height:22px;font-size:11px;background:${meta.avatarColor || '#FF6B1A'}">${meta.displayName?.charAt(0).toUpperCase()}</div>`;
    name.textContent = meta.displayName || 'DM';
  } else {
    const ch = state.channels.find(c => c.id === id);
    icon.textContent = ch?.type === 'private' ? '🔒' : '#';
    name.textContent = ch?.name || id;
  }

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Trigger message load via event
  window.dispatchEvent(new CustomEvent('channelSelected', { detail: { id, type } }));
}

function setupSidebarControls() {
  // New channel
  document.getElementById('new-channel-btn').addEventListener('click', () => {
    showModal('new-channel-modal');
  });

  document.getElementById('create-channel-btn').addEventListener('click', async () => {
    const name = document.getElementById('channel-name-input').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const type = document.querySelector('input[name="channel-type"]:checked').value;
    if (!name) return;

    try {
      await addDoc(collection(db, 'channels'), {
        name,
        type,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid,
      });
      closeModals();
      showToast(`#${name} created!`, 'success');
    } catch (err) {
      showToast('Failed to create channel.', 'error');
    }
  });

  // New DM
  document.getElementById('new-dm-btn').addEventListener('click', () => {
    showModal('dm-modal');
  });

  // DM search
  const dmInput = document.getElementById('dm-search-input');
  let selectedUser = null;

  dmInput.addEventListener('input', async () => {
    const val = dmInput.value.trim().toLowerCase();
    const results = document.getElementById('dm-search-results');
    results.innerHTML = '';
    selectedUser = null;
    if (!val) return;

    const q = query(collection(db, 'users'), where('username', '>=', val), where('username', '<=', val + '\uf8ff'));
    const snap = await getDocs(q);

    snap.forEach(d => {
      const u = d.data();
      if (u.uid === state.user.uid) return;
      const li = document.createElement('li');
      li.className = 'dm-search-item';
      li.innerHTML = `
        <div class="user-avatar" style="width:28px;height:28px;font-size:12px;background:${u.avatarColor || '#FF6B1A'}">${u.displayName?.charAt(0).toUpperCase()}</div>
        <span>${u.displayName}</span>
      `;
      li.addEventListener('click', () => {
        document.querySelectorAll('.dm-search-item').forEach(i => i.classList.remove('selected'));
        li.classList.add('selected');
        selectedUser = u;
      });
      results.appendChild(li);
    });
  });

  document.getElementById('start-dm-btn').addEventListener('click', async () => {
    if (!selectedUser) { showToast('Select a user first.', 'error'); return; }

    // Check if DM already exists
    const q = query(collection(db, 'dms'), where('members', 'array-contains', state.user.uid));
    const snap = await getDocs(q);
    let existingDm = null;

    snap.forEach(d => {
      const data = d.data();
      if (data.members.includes(selectedUser.uid)) existingDm = { id: d.id, ...data };
    });

    if (existingDm) {
      closeModals();
      selectChannel(existingDm.id, 'dm', selectedUser);
    } else {
      const dmRef = await addDoc(collection(db, 'dms'), {
        members: [state.user.uid, selectedUser.uid],
        createdAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      });
      closeModals();
      selectChannel(dmRef.id, 'dm', selectedUser);
    }
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModals();
  });
}

// ---- Helpers ----
async function joinChannel(uid, channelName) {
  // Channels are public so no join mechanism needed, just for reference
}

function showModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).classList.remove('hidden');
}

function closeModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'Email already in use.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/weak-password': 'Password is too weak.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/invalid-credential': 'Invalid credentials. Check email and password.',
  };
  return map[code] || 'Something went wrong. Try again.';
}

function randomColor() {
  const colors = ['#FF6B1A', '#e74c3c', '#9b59b6', '#3498db', '#2ecc71', '#f39c12', '#1abc9c', '#e67e22'];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---- Init ----
setupAuth();

// Ensure general channel exists on load
setTimeout(ensureGeneralChannel, 2000);
