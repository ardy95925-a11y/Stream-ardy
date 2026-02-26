// ─────────────────────────────────────────────
//  app.js  — Firebase init + auth + routing
//  ALL Firebase imports live here. No window.__firebase needed.
// ─────────────────────────────────────────────

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp }
                               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
                               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ── Your Firebase config ──────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCPabeR73HulqHs-wAq_ass1lUxkoEijAY",
  authDomain:        "chatin-e7d51.firebaseapp.com",
  projectId:         "chatin-e7d51",
  storageBucket:     "chatin-e7d51.firebasestorage.app",
  messagingSenderId: "175440428513",
  appId:             "1:175440428513:web:c6b365aa7728f0ad5a66a0"
};

const app      = initializeApp(firebaseConfig);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);

// ── Shared state ─────────────────────────────
export let me = null;   // populated after login

// ── Screen router ─────────────────────────────
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

// ── Toast ────────────────────────────────────
export function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ── Auth state listener ───────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) {
    showScreen("screen-login");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || !snap.data().displayName) {
      setupProfileScreen(user);
      showScreen("screen-profile");
    } else {
      const data = snap.data();
      await updateDoc(doc(db, "users", user.uid), {
        online:   true,
        lastSeen: serverTimestamp()
      });
      me = { uid: user.uid, ...data };
      await launchApp();
    }
  } catch (err) {
    console.error("Auth state error:", err);
    toast("Something went wrong. Please refresh.", "error");
    showScreen("screen-login");
  }
});

// ── Google login button ───────────────────────
document.getElementById("btn-google-login").addEventListener("click", async () => {
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    // onAuthStateChanged will take it from here
  } catch (err) {
    console.error("Login error:", err);
    errEl.textContent = err.code === "auth/popup-closed-by-user"
      ? "Popup closed — try again."
      : "Login failed: " + (err.message || err.code);
  }
});

// ── Profile setup ─────────────────────────────
let _avatarFile = null;

function setupProfileScreen(user) {
  _avatarFile = null;
  const preview = document.getElementById("avatar-preview");
  preview.src   = user.photoURL || `https://api.dicebear.com/8.x/lorelei/svg?seed=${user.uid}`;

  document.getElementById("avatar-upload").onchange = e => {
    _avatarFile = e.target.files[0];
    if (_avatarFile) preview.src = URL.createObjectURL(_avatarFile);
  };

  document.getElementById("btn-save-profile").onclick = async () => {
    const name  = document.getElementById("input-displayname").value.trim();
    const errEl = document.getElementById("profile-error");
    errEl.textContent = "";

    if (!name) { errEl.textContent = "Please enter a display name."; return; }

    const btn = document.getElementById("btn-save-profile");
    btn.disabled    = true;
    btn.textContent = "Saving…";

    let photoURL = user.photoURL
      || `https://api.dicebear.com/8.x/lorelei/svg?seed=${user.uid}`;

    if (_avatarFile) {
      try {
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadBytes(storageRef, _avatarFile);
        photoURL = await getDownloadURL(storageRef);
      } catch (e) {
        console.warn("Avatar upload failed:", e);
        toast("Photo upload failed — using default.", "warn");
      }
    }

    await setDoc(doc(db, "users", user.uid), {
      uid:           user.uid,
      displayName:   name,
      photoURL,
      online:        true,
      lastSeen:      serverTimestamp(),
      friends:       [],
      friendRequests: []
    });

    me = { uid: user.uid, displayName: name, photoURL, friends: [], friendRequests: [] };
    await launchApp();

    btn.disabled    = false;
    btn.textContent = "Save & Continue →";
  };
}

// ── Launch app after auth ─────────────────────
async function launchApp() {
  showScreen("screen-app");

  document.getElementById("my-avatar").src          = me.photoURL  || "";
  document.getElementById("my-name").textContent    = me.displayName || "";

  document.getElementById("btn-signout").onclick = async () => {
    try {
      await updateDoc(doc(db, "users", me.uid), { online: false, lastSeen: serverTimestamp() });
    } catch (_) {}
    await signOut(auth);
    me = null;
    showScreen("screen-login");
  };

  // Tab switcher
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b  => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    };
  });

  // Dynamic import so these modules share the same firebase instances via exports
  const { initFriends } = await import("./friends.js");
  const { initChat    } = await import("./chat.js");
  const { initCalls   } = await import("./calls.js");

  initFriends(db, me, toast, openChatWith);
  initChat(db, storage, me, toast);
  initCalls(db, me, toast);
}

// ── Open a chat (called from friends list) ────
export function openChatWith(peerUid) {
  // Switch to chats tab
  document.querySelectorAll(".tab-btn").forEach(b  => b.classList.toggle("active", b.dataset.tab === "chats"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-chats").classList.add("active");

  if (window.__openChat) window.__openChat(peerUid);
}
