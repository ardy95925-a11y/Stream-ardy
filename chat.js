// chat.js — Real-time messaging, reactions, read receipts, image sharing
import {
  collection, doc, getDoc, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, updateDoc, arrayUnion, where, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const EMOJIS = ["❤️","😂","😮","😢","😡","👍","👎","🔥","🎉","💯","😍","🤔","👀","✨","💀","🙏"];

export function initChat(db, storage, me, toast) {
  let currentPeerUid = null;
  let unsubMessages  = null;

  const chatEmpty     = document.getElementById("chat-empty");
  const chatActive    = document.getElementById("chat-active");
  const msgContainer  = document.getElementById("messages-container");
  const msgInput      = document.getElementById("msg-input");
  const sendBtn       = document.getElementById("send-btn");
  const imgUpload     = document.getElementById("img-upload");
  const emojiPicker   = document.getElementById("emoji-picker");
  const emojiGrid     = document.getElementById("emoji-grid");
  const emojiToggle   = document.getElementById("emoji-btn");

  // Build emoji picker
  EMOJIS.forEach(e => {
    const btn = document.createElement("button");
    btn.textContent = e;
    btn.className = "emoji-opt";
    btn.onclick = () => { msgInput.value += e; msgInput.focus(); };
    emojiGrid.appendChild(btn);
  });

  emojiToggle.onclick = (ev) => {
    ev.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
  };
  document.addEventListener("click", () => { emojiPicker.style.display = "none"; });

  // ─── Open a chat ───
  window.__openChat = async (peerUid) => {
    if (currentPeerUid === peerUid) return;
    if (unsubMessages) unsubMessages();
    currentPeerUid = peerUid;

    const peerSnap = await getDoc(doc(db, "users", peerUid));
    const peer = peerSnap.data();

    document.getElementById("chat-peer-avatar").src  = peer.photoURL;
    document.getElementById("chat-peer-name").textContent = peer.displayName;
    document.getElementById("chat-peer-status").textContent = peer.online ? "🟢 Online" : "⚫ Offline";

    chatEmpty.style.display  = "none";
    chatActive.style.display = "flex";

    const chatId = getChatId(me.uid, peerUid);
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"), limit(200));

    unsubMessages = onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added") renderMessage(change.doc, peerUid, chatId);
        if (change.type === "modified") updateMessageEl(change.doc);
      });
      scrollBottom();
      markRead(chatId, peerUid);
    });

    // Highlight in chat list
    document.querySelectorAll(".chat-list-item").forEach(el => {
      el.classList.toggle("active", el.dataset.uid === peerUid);
    });

    // Refresh peer status live
    onSnapshot(doc(db, "users", peerUid), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      document.getElementById("chat-peer-status").textContent = d.online ? "🟢 Online" : "⚫ Offline";
    });
  };

  // ─── Send message ───
  sendBtn.onclick = sendMessage;
  msgInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }});

  async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !currentPeerUid) return;
    msgInput.value = "";
    emojiPicker.style.display = "none";
    await sendToChat(currentPeerUid, { text, type: "text" });
  }

  // ─── Image upload ───
  imgUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentPeerUid) return;
    toast("Uploading image…");
    try {
      const storageRef = ref(storage, `chat_images/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await sendToChat(currentPeerUid, { imageURL: url, type: "image" });
    } catch (err) {
      toast("Image upload failed", "error");
    }
    imgUpload.value = "";
  };

  async function sendToChat(peerUid, payload) {
    const chatId = getChatId(me.uid, peerUid);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      ...payload,
      senderUid: me.uid,
      createdAt: serverTimestamp(),
      readBy: [me.uid],
      reactions: {}
    });
  }

  // ─── Render a message ───
  function renderMessage(docSnap, peerUid, chatId) {
    if (document.querySelector(`[data-msgid="${docSnap.id}"]`)) return;
    const data = docSnap.data();
    const isMine = data.senderUid === me.uid;
    const isRead  = data.readBy?.includes(peerUid);

    const el = document.createElement("div");
    el.className = `msg-bubble ${isMine ? "mine" : "theirs"}`;
    el.dataset.msgid = docSnap.id;

    let content = "";
    if (data.type === "image") {
      content = `<img class="msg-img" src="${data.imageURL}" alt="image" />`;
    } else {
      content = `<span class="msg-text">${escapeHtml(data.text)}</span>`;
    }

    const time = data.createdAt?.toDate
      ? formatTime(data.createdAt.toDate())
      : "";

    const reactions = renderReactionBadges(data.reactions || {}, docSnap.id, chatId);

    el.innerHTML = `
      <div class="bubble-content">
        ${content}
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${isMine ? `<span class="read-tick">${isRead ? "✓✓" : "✓"}</span>` : ""}
        </div>
        <div class="msg-reactions">${reactions}</div>
      </div>
      <div class="reaction-trigger" data-msgid="${docSnap.id}" data-chatid="${chatId}">+</div>
    `;

    el.querySelector(".reaction-trigger").onclick = (ev) => {
      ev.stopPropagation();
      showReactionPicker(docSnap.id, chatId, ev.currentTarget);
    };

    msgContainer.appendChild(el);
  }

  function updateMessageEl(docSnap) {
    const el = document.querySelector(`[data-msgid="${docSnap.id}"]`);
    if (!el) return;
    const data = docSnap.data();
    const isMine = data.senderUid === me.uid;
    const peerUid = currentPeerUid;
    const isRead  = data.readBy?.includes(peerUid);

    const tick = el.querySelector(".read-tick");
    if (tick && isMine) tick.textContent = isRead ? "✓✓" : "✓";

    const reactEl = el.querySelector(".msg-reactions");
    if (reactEl) reactEl.innerHTML = renderReactionBadges(data.reactions || {}, docSnap.id, data.chatId);
  }

  // ─── Reaction picker ───
  let _reactionPickerEl = null;

  function showReactionPicker(msgId, chatId, anchor) {
    if (_reactionPickerEl) _reactionPickerEl.remove();
    const picker = document.createElement("div");
    picker.className = "floating-reaction-picker glass";
    EMOJIS.slice(0, 8).forEach(e => {
      const btn = document.createElement("button");
      btn.textContent = e;
      btn.onclick = async () => {
        await reactToMessage(chatId, msgId, e);
        picker.remove();
      };
      picker.appendChild(btn);
    });
    anchor.parentElement.appendChild(picker);
    _reactionPickerEl = picker;
    setTimeout(() => document.addEventListener("click", () => picker.remove(), { once: true }), 100);
  }

  async function reactToMessage(chatId, msgId, emoji) {
    const msgRef = doc(db, "chats", chatId, "messages", msgId);
    const snap = await getDoc(msgRef);
    if (!snap.exists()) return;
    const reactions = snap.data().reactions || {};
    const users = reactions[emoji] || [];
    if (users.includes(me.uid)) {
      reactions[emoji] = users.filter(u => u !== me.uid);
    } else {
      reactions[emoji] = [...users, me.uid];
    }
    await updateDoc(msgRef, { reactions });
  }

  function renderReactionBadges(reactions, msgId, chatId) {
    return Object.entries(reactions)
      .filter(([, users]) => users.length > 0)
      .map(([emoji, users]) =>
        `<span class="reaction-badge" data-msgid="${msgId}">${emoji} ${users.length}</span>`
      ).join("");
  }

  // ─── Mark messages as read ───
  async function markRead(chatId, peerUid) {
    const q = query(
      collection(db, "chats", chatId, "messages"),
      where("senderUid", "==", peerUid)
    );
    const snap = await getDocs(q);
    snap.docs.forEach(async d => {
      if (!d.data().readBy?.includes(me.uid)) {
        await updateDoc(d.ref, { readBy: arrayUnion(me.uid) });
      }
    });
  }

  // ─── Chats sidebar list ───
  window.__refreshChats = async () => {
    const chatsList = document.getElementById("chats-list");
    chatsList.innerHTML = "";
    if (!me.friends || me.friends.length === 0) {
      chatsList.innerHTML = `<p class="empty-hint">Add friends to start chatting!</p>`;
      return;
    }
    for (const uid of me.friends) {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();
      const item = document.createElement("div");
      item.className = "list-item chat-list-item";
      item.dataset.uid = uid;
      item.innerHTML = `
        <div class="avatar-wrap">
          <img class="list-avatar" src="${user.photoURL}" alt="${user.displayName}" />
          <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
        </div>
        <div class="list-info">
          <span class="list-name">${user.displayName}</span>
          <span class="list-sub">${user.online ? 'Online' : 'Offline'}</span>
        </div>
      `;
      item.onclick = () => window.__openChat(uid);
      chatsList.appendChild(item);
    }
  };

  // ─── Helpers ───
  function getChatId(a, b) { return [a, b].sort().join("_"); }
  function scrollBottom() { msgContainer.scrollTop = msgContainer.scrollHeight; }
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function escapeHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
}
