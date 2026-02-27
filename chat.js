// chat.js - Pulse2 Chat Engine
import {
  collection, doc, addDoc, getDoc, setDoc, getDocs, query, orderBy,
  onSnapshot, serverTimestamp, updateDoc, where, limit,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./app.js";
import { showToast, openModal, closeModal } from "./ui.js";

let currentUser = null;
let currentConversationId = null;
let currentConversationType = null; // 'channel' | 'dm'
let messagesUnsub = null;
let typingUnsub = null;
let typingTimeout = null;
let unreadCounts = {};

export async function initChat(user) {
  currentUser = user;

  // Set user sidebar info
  const nameEl = document.getElementById("sidebar-username");
  const avatarEl = document.getElementById("sidebar-avatar");
  const displayName = user.displayName || user.email.split("@")[0];
  nameEl.textContent = displayName;
  avatarEl.textContent = displayName[0].toUpperCase();

  await ensureDefaultChannels();
  await loadChannels();
  loadDMs();
  setupCreateChannel();
  setupDMModal();
  setupMessageInput();
}

// ============ CHANNELS ============

async function ensureDefaultChannels() {
  const defaults = ["general", "pulse-updates", "off-topic"];
  for (const name of defaults) {
    const id = `ch_${name.replace(/-/g, "_")}`;
    const ref = doc(db, "channels", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        name,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        description: `Default channel: #${name}`
      });
    }
  }
}

async function loadChannels() {
  const channelList = document.getElementById("channel-list");
  const q = query(collection(db, "channels"), orderBy("createdAt", "asc"));

  onSnapshot(q, (snap) => {
    channelList.innerHTML = "";
    snap.forEach(docSnap => {
      const ch = docSnap.data();
      const item = document.createElement("div");
      item.className = "channel-item" + (currentConversationId === docSnap.id ? " active" : "");
      item.dataset.id = docSnap.id;
      item.innerHTML = `<span class="channel-hash">#</span>${ch.name}`;
      if (unreadCounts[docSnap.id]) {
        item.innerHTML += `<span class="unread-badge">${unreadCounts[docSnap.id]}</span>`;
      }
      item.addEventListener("click", () => selectChannel(docSnap.id, ch.name));
      channelList.appendChild(item);
    });
  });
}

function selectChannel(id, name) {
  currentConversationId = id;
  currentConversationType = "channel";
  unreadCounts[id] = 0;
  showChatView("#", name);
  listenToMessages(`channels/${id}/messages`);
  listenToTyping(`channels/${id}/typing`);
  updateActiveItem(id);
}

// ============ DMs ============

async function loadDMs() {
  const dmList = document.getElementById("dm-list");
  const q = query(
    collection(db, "dms"),
    where("members", "array-contains", currentUser.uid),
    orderBy("lastActivity", "desc")
  );

  onSnapshot(q, async (snap) => {
    dmList.innerHTML = "";
    for (const docSnap of snap.docs) {
      const dm = docSnap.data();
      const otherId = dm.members.find(uid => uid !== currentUser.uid);
      let otherName = "Unknown";
      try {
        const userSnap = await getDoc(doc(db, "users", otherId));
        if (userSnap.exists()) otherName = userSnap.data().displayName;
      } catch (_) {}

      const item = document.createElement("div");
      item.className = "channel-item" + (currentConversationId === docSnap.id ? " active" : "");
      item.dataset.id = docSnap.id;
      item.innerHTML = `<span class="channel-hash">@</span>${otherName}`;
      item.addEventListener("click", () => selectDM(docSnap.id, otherName));
      dmList.appendChild(item);
    }
  });
}

async function selectDM(id, otherName) {
  currentConversationId = id;
  currentConversationType = "dm";
  unreadCounts[id] = 0;
  showChatView("@", otherName);
  listenToMessages(`dms/${id}/messages`);
  listenToTyping(`dms/${id}/typing`);
  updateActiveItem(id);
}

function setupDMModal() {
  document.getElementById("open-dm-btn").addEventListener("click", () => {
    openModal("New Direct Message", `
      <div class="input-group">
        <label>User Email</label>
        <input type="email" id="dm-email" placeholder="friend@example.com" />
      </div>
      <div id="dm-modal-error" class="auth-error"></div>
      <button class="btn-primary" id="dm-start-btn">Start DM</button>
    `);
    document.getElementById("dm-start-btn").addEventListener("click", startDM);
    document.getElementById("dm-email").addEventListener("keydown", e => {
      if (e.key === "Enter") startDM();
    });
  });
}

async function startDM() {
  const emailInput = document.getElementById("dm-email");
  const errEl = document.getElementById("dm-modal-error");
  const email = emailInput.value.trim().toLowerCase();
  errEl.textContent = "";
  if (!email) { errEl.textContent = "Enter an email."; return; }
  if (email === currentUser.email.toLowerCase()) { errEl.textContent = "Can't DM yourself!"; return; }

  // Find user by email
  const q = query(collection(db, "users"), where("email", "==", email), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) { errEl.textContent = "User not found."; return; }

  const other = snap.docs[0];
  const otherId = other.id;
  const otherName = other.data().displayName;

  // Check if DM already exists
  const dmId = [currentUser.uid, otherId].sort().join("_");
  const dmRef = doc(db, "dms", dmId);
  const existing = await getDoc(dmRef);

  if (!existing.exists()) {
    await setDoc(dmRef, {
      members: [currentUser.uid, otherId],
      lastActivity: serverTimestamp()
    });
  }
  closeModal();
  selectDM(dmId, otherName);
}

// ============ MESSAGES ============

function listenToMessages(path) {
  if (messagesUnsub) messagesUnsub();
  const messagesContainer = document.getElementById("messages-container");
  messagesContainer.innerHTML = `<div class="empty-channel">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
    <span>No messages yet. Say something!</span>
  </div>`;

  const q = query(collection(db, path), orderBy("createdAt", "asc"), limit(100));

  messagesUnsub = onSnapshot(q, (snap) => {
    if (snap.empty) return;

    messagesContainer.innerHTML = "";
    let prevAuthorId = null;
    let prevDate = null;

    snap.forEach(docSnap => {
      const msg = docSnap.data();
      const ts = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
      const dateStr = ts.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      // Date divider
      if (dateStr !== prevDate) {
        const div = document.createElement("div");
        div.className = "date-divider";
        div.textContent = dateStr;
        messagesContainer.appendChild(div);
        prevDate = dateStr;
        prevAuthorId = null;
      }

      const isContinued = msg.authorId === prevAuthorId;
      const isSelf = msg.authorId === currentUser.uid;
      const initial = (msg.author || "?")[0].toUpperCase();
      const timeStr = ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      const group = document.createElement("div");
      group.className = `msg-group${isContinued ? " msg-continued" : ""}${isSelf ? " msg-self" : ""}`;

      if (!isContinued) {
        group.innerHTML = `
          <div class="avatar" style="background:${hashColor(msg.authorId)}">${initial}</div>
          <div class="msg-content">
            <div class="msg-header">
              <span class="msg-author">${escapeHtml(msg.author || "User")}</span>
              <span class="msg-time">${timeStr}</span>
            </div>
            <div class="msg-text">${formatMessage(msg.text)}</div>
          </div>`;
      } else {
        group.innerHTML = `
          <div class="msg-content">
            <div class="msg-text">${formatMessage(msg.text)}</div>
          </div>`;
      }

      messagesContainer.appendChild(group);
      prevAuthorId = msg.authorId;
    });

    // Scroll to bottom on new messages
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ============ SEND MESSAGE ============

function setupMessageInput() {
  const input = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    updateTyping(input.value.length > 0);
  });

  sendBtn.addEventListener("click", sendMessage);
}

async function sendMessage() {
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text || !currentConversationId) return;

  input.value = "";
  input.style.height = "auto";
  updateTyping(false);

  const path = currentConversationType === "channel"
    ? `channels/${currentConversationId}/messages`
    : `dms/${currentConversationId}/messages`;

  try {
    await addDoc(collection(db, path), {
      text,
      author: currentUser.displayName || currentUser.email.split("@")[0],
      authorId: currentUser.uid,
      createdAt: serverTimestamp()
    });

    // Update DM lastActivity
    if (currentConversationType === "dm") {
      await updateDoc(doc(db, "dms", currentConversationId), {
        lastActivity: serverTimestamp()
      });
    }
  } catch (e) {
    showToast("Failed to send message.");
    console.error(e);
  }
}

// ============ TYPING INDICATOR ============

function listenToTyping(path) {
  if (typingUnsub) typingUnsub();
  const indicator = document.querySelector(".typing-indicator");
  if (!indicator) return;

  typingUnsub = onSnapshot(doc(db, path, "state"), (snap) => {
    if (!snap.exists()) { indicator.innerHTML = ""; return; }
    const data = snap.data();
    const typers = Object.entries(data)
      .filter(([uid, val]) => uid !== currentUser.uid && val && val.typing)
      .map(([, val]) => val.name);

    if (typers.length === 0) { indicator.innerHTML = ""; return; }
    const names = typers.length === 1 ? typers[0] :
                  typers.length === 2 ? `${typers[0]} and ${typers[1]}` :
                  `${typers[0]} and ${typers.length - 1} others`;
    indicator.innerHTML = `${escapeHtml(names)} is typing<span class="typing-dots">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </span>`;
  });
}

async function updateTyping(isTyping) {
  if (!currentConversationId) return;
  const path = currentConversationType === "channel"
    ? `channels/${currentConversationId}/typing`
    : `dms/${currentConversationId}/typing`;

  clearTimeout(typingTimeout);
  const ref = doc(db, path, "state");
  try {
    if (isTyping) {
      await setDoc(ref, {
        [currentUser.uid]: {
          typing: true,
          name: currentUser.displayName || currentUser.email.split("@")[0]
        }
      }, { merge: true });
      typingTimeout = setTimeout(() => updateTyping(false), 3000);
    } else {
      await setDoc(ref, { [currentUser.uid]: deleteField() }, { merge: true });
    }
  } catch (_) {}
}

// ============ CREATE CHANNEL ============

function setupCreateChannel() {
  document.getElementById("create-channel-btn").addEventListener("click", () => {
    openModal("Create Channel", `
      <div class="input-group">
        <label>Channel Name</label>
        <input type="text" id="new-channel-name" placeholder="my-channel" maxlength="32" />
      </div>
      <div id="channel-modal-error" class="auth-error"></div>
      <button class="btn-primary" id="create-channel-confirm">Create</button>
    `);
    document.getElementById("create-channel-confirm").addEventListener("click", createChannel);
    document.getElementById("new-channel-name").addEventListener("keydown", e => {
      if (e.key === "Enter") createChannel();
    });
    document.getElementById("new-channel-name").focus();
  });
}

async function createChannel() {
  const nameInput = document.getElementById("new-channel-name");
  const errEl = document.getElementById("channel-modal-error");
  const raw = nameInput.value.trim();
  const name = raw.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  errEl.textContent = "";
  if (!name) { errEl.textContent = "Enter a valid channel name."; return; }
  if (name.length < 2) { errEl.textContent = "Name too short."; return; }

  const id = `ch_${name.replace(/-/g, "_")}_${Date.now()}`;
  try {
    await setDoc(doc(db, "channels", id), {
      name,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      description: ""
    });
    closeModal();
    showToast(`#${name} created!`);
  } catch (e) {
    errEl.textContent = "Failed to create channel.";
  }
}

// ============ UTILS ============

function showChatView(prefix, title) {
  document.getElementById("welcome-screen").classList.add("hidden");
  const chatView = document.getElementById("chat-view");
  chatView.classList.remove("hidden");
  document.getElementById("chat-prefix").textContent = prefix;
  document.getElementById("chat-title").textContent = title;

  // Add typing indicator if not present
  if (!document.querySelector(".typing-indicator")) {
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    const bar = document.querySelector(".message-input-bar");
    bar.parentNode.insertBefore(indicator, bar);
  }

  document.getElementById("message-input").focus();
}

function updateActiveItem(id) {
  document.querySelectorAll(".channel-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function hashColor(uid) {
  const palette = ["#FF6B00","#e05500","#ff8c42","#d44000","#ff9a5c","#c24b00","#ff7a1a","#b33d00"];
  let hash = 0;
  for (const ch of (uid || "x")) hash = hash * 31 + ch.charCodeAt(0);
  return palette[Math.abs(hash) % palette.length];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMessage(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, `<code style="background:var(--bg3);padding:1px 5px;border-radius:4px;font-family:var(--font-mono);font-size:12px">$1</code>`)
    .replace(/\n/g, "<br>");
}
