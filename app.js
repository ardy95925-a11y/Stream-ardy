// app.js — Auth, routing, profile setup
import { initFriends } from "./friends.js";
import { initChat } from "./chat.js";

const { auth, db, storage, provider, signInWithPopup, signOut, onAuthStateChanged } = window.__firebase;
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── Screens ───
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ─── Toast ───
export function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ─── Auth state ───
onAuthStateChanged(auth, async user => {
  if (!user) return showScreen("screen-login");

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists() || !snap.data().displayName) {
    setupProfileScreen(user);
    showScreen("screen-profile");
  } else {
    const data = snap.data();
    await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() });
    window.__me = { uid: user.uid, ...data };
    loadApp();
  }
});

// ─── Google login ───
document.getElementById("btn-google-login").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    toast("Login failed. Try again.", "error");
  }
};

// ─── Profile setup ───
let _avatarFile = null;

function setupProfileScreen(user) {
  const preview = document.getElementById("avatar-preview");
  if (user.photoURL) preview.src = user.photoURL;

  document.getElementById("avatar-upload").onchange = e => {
    _avatarFile = e.target.files[0];
    if (_avatarFile) preview.src = URL.createObjectURL(_avatarFile);
  };

  document.getElementById("btn-save-profile").onclick = async () => {
    const name = document.getElementById("input-displayname").value.trim();
    if (!name) return toast("Please enter a display name", "error");

    const btn = document.getElementById("btn-save-profile");
    btn.disabled = true;
    btn.textContent = "Saving…";

    let photoURL = user.photoURL || `https://api.dicebear.com/8.x/lorelei/svg?seed=${user.uid}`;

    if (_avatarFile) {
      try {
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadBytes(storageRef, _avatarFile);
        photoURL = await getDownloadURL(storageRef);
      } catch (e) {
        toast("Photo upload failed, using default.", "warn");
      }
    }

    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      displayName: name,
      photoURL,
      online: true,
      lastSeen: serverTimestamp(),
      friends: [],
      friendRequests: []
    });

    window.__me = { uid: user.uid, displayName: name, photoURL };
    loadApp();
  };
}

// ─── Load main app ───
function loadApp() {
  showScreen("screen-app");
  document.getElementById("my-avatar").src = window.__me.photoURL;
  document.getElementById("my-name").textContent = window.__me.displayName;

  document.getElementById("btn-signout").onclick = async () => {
    await updateDoc(doc(db, "users", window.__me.uid), { online: false, lastSeen: serverTimestamp() });
    await signOut(auth);
    showScreen("screen-login");
  };

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    };
  });

  initFriends(db, window.__me, toast, openChatWith);
  initChat(db, storage, window.__me, toast);
}

// ─── Open chat from friends list ───
export function openChatWith(peerUid) {
  // switch to chats tab and trigger chat open
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === "chats");
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-chats").classList.add("active");
  window.__openChat && window.__openChat(peerUid);
}
