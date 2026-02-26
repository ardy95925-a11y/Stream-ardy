// chat.js — Real-time messaging, emoji reactions, read receipts, image sharing
import {
  collection, doc, getDoc, addDoc, onSnapshot,
  query, orderBy, limit, updateDoc, arrayUnion, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const EMOJIS = ["❤️","😂","🔥","👍","😮","😢","😡","🎉","💯","😍","🤔","👀","✨","💀","🙏","🫡"];

export function initChat(db, storage, me, toast) {
  let currentPeerUid = null;
  let currentChatId  = null;
  let unsubMessages  = null;

  const chatEmpty     = document.getElementById("chat-empty");
  const chatActive    = document.getElementById("chat-active");
  const msgContainer  = document.getElementById("messages-container");
  const msgInput      = document.getElementById("msg-input");
  const sendBtn       = document.getElementById("send-btn");
  const imgUpload     = document.getElementById("img-upload");
  const emojiPickerEl = document.getElementById("emoji-picker");
  const emojiGrid     = document.getElementById("emoji-grid");
  const emojiToggle   = document.getElementById("emoji-btn");

  // ── Build emoji picker ─────────────────────
  EMOJIS.forEach(e => {
    const btn = document.createElement("button");
    btn.textContent = e;
    btn.className   = "emoji-opt";
    btn.onclick = () => {
      msgInput.value += e;
      msgInput.focus();
    };
    emojiGrid.appendChild(btn);
  });

  emojiToggle.onclick = ev => {
    ev.stopPropagation();
    emojiPickerEl.classList.toggle("hidden");
  };
  document.addEventListener("click", e => {
    if (!emojiPickerEl.contains(e.target) && e.target !== emojiToggle) {
      emojiPickerEl.classList.add("hidden");
    }
  });

  // ── Open a chat ────────────────────────────
  window.__openChat = async peerUid => {
    if (currentPeerUid === peerUid) return;
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }

    currentPeerUid = peerUid;
    currentChatId  = makeChatId(me.uid, peerUid);
    msgContainer.innerHTML = "";

    const peerSnap = await getDoc(doc(db, "users", peerUid));
    if (!peerSnap.exists()) return toast("User not found", "error");
    const peer = peerSnap.data();

    document.getElementById("chat-peer-avatar").src         = peer.photoURL || "";
    document.getElementById("chat-peer-name").textContent   = peer.displayName;
    document.getElementById("chat-peer-status").textContent = peer.online ? "🟢 Online" : "⚫ Offline";

    chatEmpty.classList.add("hidden");
    chatActive.classList.remove("hidden");

    // Live presence update
    onSnapshot(doc(db, "users", peerUid), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      document.getElementById("chat-peer-status").textContent = d.online ? "🟢 Online" : "⚫ Offline";
    });

    // Messages listener
    const messagesRef = collection(db, "chats", currentChatId, "messages");
    const q           = query(messagesRef, orderBy("createdAt", "asc"), limit(250));

    unsubMessages = onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added")    appendMessage(change.doc, peerUid);
        if (change.type === "modified") updateMessageEl(change.doc, peerUid);
      });
      scrollBottom();
      markRead(currentChatId, peerUid);
    });

    // Highlight in sidebar
    highlightChat(peerUid);
  };

  // ── Send text ──────────────────────────────
  sendBtn.onclick = () => doSend();
  msgInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  async function doSend() {
    const text = msgInput.value.trim();
    if (!text || !currentChatId) return;
    msgInput.value = "";
    emojiPickerEl.classList.add("hidden");
    await pushMessage({ type: "text", text });
  }

  // ── Send image ─────────────────────────────
  imgUpload.onchange = async e => {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;
    toast("Uploading…");
    try {
      const storageRef = ref(storage, `chat_imgs/${currentChatId}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const imageURL = await getDownloadURL(storageRef);
      await pushMessage({ type: "image", imageURL });
    } catch {
      toast("Image upload failed", "error");
    }
    imgUpload.value = "";
  };

  async function pushMessage(payload) {
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
      ...payload,
      senderUid: me.uid,
      createdAt: (await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"))
                   .serverTimestamp(),
      readBy:    [me.uid],
      reactions: {}
    });
  }

  // ── Render a new message ───────────────────
  function appendMessage(docSnap, peerUid) {
    if (document.querySelector(`[data-msgid="${docSnap.id}"]`)) return;
    const d     = docSnap.data();
    const isMine = d.senderUid === me.uid;

    const wrap = document.createElement("div");
    wrap.className        = `msg-wrap ${isMine ? "mine" : "theirs"}`;
    wrap.dataset.msgid    = docSnap.id;
    wrap.dataset.chatid   = currentChatId;

    const isRead = d.readBy?.includes(peerUid);
    const time   = d.createdAt?.toDate ? fmtTime(d.createdAt.toDate()) : "";

    let bodyHtml = "";
    if (d.type === "image") {
      bodyHtml = `<img class="msg-img" src="${escH(d.imageURL)}" alt="image" loading="lazy" />`;
    } else {
      bodyHtml = `<span class="msg-text">${escH(d.text)}</span>`;
    }

    wrap.innerHTML = `
      <div class="bubble">
        ${bodyHtml}
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${isMine ? `<span class="read-tick ${isRead ? 'read' : ''}">${isRead ? "✓✓" : "✓"}</span>` : ""}
        </div>
        <div class="reactions-row"></div>
      </div>
      <button class="react-btn" title="React">＋</button>`;

    updateReactions(wrap, d.reactions || {}, docSnap.id);

    wrap.querySelector(".react-btn").onclick = ev => {
      ev.stopPropagation();
      showFloatingPicker(docSnap.id, wrap);
    };

    msgContainer.appendChild(wrap);
  }

  // ── Update existing message (reactions / read) ──
  function updateMessageEl(docSnap, peerUid) {
    const wrap = document.querySelector(`[data-msgid="${docSnap.id}"]`);
    if (!wrap) return;
    const d = docSnap.data();

    // Read receipt
    const tick = wrap.querySelector(".read-tick");
    if (tick) {
      const isRead = d.readBy?.includes(peerUid);
      tick.textContent = isRead ? "✓✓" : "✓";
      tick.classList.toggle("read", isRead);
    }

    // Reactions
    updateReactions(wrap, d.reactions || {}, docSnap.id);
  }

  function updateReactions(wrap, reactions, msgId) {
    const row = wrap.querySelector(".reactions-row");
    if (!row) return;
    row.innerHTML = Object.entries(reactions)
      .filter(([, users]) => users.length > 0)
      .map(([emoji, users]) => {
        const mine = users.includes(me.uid);
        return `<button class="reaction-badge ${mine ? 'mine-react' : ''}"
                  data-emoji="${emoji}" data-msgid="${msgId}">${emoji} ${users.length}</button>`;
      }).join("");

    row.querySelectorAll(".reaction-badge").forEach(btn => {
      btn.onclick = () => toggleReaction(btn.dataset.msgid, btn.dataset.emoji);
    });
  }

  // ── Floating reaction picker ───────────────
  let _floatingPicker = null;

  function showFloatingPicker(msgId, wrapEl) {
    if (_floatingPicker) _floatingPicker.remove();

    const picker = document.createElement("div");
    picker.className = "floating-reaction-picker glass";
    EMOJIS.slice(0, 8).forEach(e => {
      const btn = document.createElement("button");
      btn.textContent = e;
      btn.onclick = async ev => {
        ev.stopPropagation();
        await toggleReaction(msgId, e);
        picker.remove();
        _floatingPicker = null;
      };
      picker.appendChild(btn);
    });

    wrapEl.appendChild(picker);
    _floatingPicker = picker;

    setTimeout(() => {
      document.addEventListener("click", () => {
        picker.remove();
        _floatingPicker = null;
      }, { once: true });
    }, 50);
  }

  async function toggleReaction(msgId, emoji) {
    const msgRef  = doc(db, "chats", currentChatId, "messages", msgId);
    const snap    = await getDoc(msgRef);
    if (!snap.exists()) return;
    const reactions = { ...snap.data().reactions };
    const users     = reactions[emoji] || [];
    reactions[emoji] = users.includes(me.uid)
      ? users.filter(u => u !== me.uid)
      : [...users, me.uid];
    await updateDoc(msgRef, { reactions });
  }

  // ── Mark messages as read ──────────────────
  async function markRead(chatId, peerUid) {
    const q    = query(collection(db, "chats", chatId, "messages"), where("senderUid", "==", peerUid));
    const snap = await getDocs(q);
    snap.docs.forEach(async d => {
      if (!d.data().readBy?.includes(me.uid)) {
        await updateDoc(d.ref, { readBy: arrayUnion(me.uid) });
      }
    });
  }

  // ── Chats sidebar list ─────────────────────
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
      item.className    = "list-item chat-list-item";
      item.dataset.uid  = uid;
      item.innerHTML    = `
        <div class="avatar-wrap">
          <img class="list-avatar" src="${user.photoURL}" alt="${escH(user.displayName)}" />
          <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
        </div>
        <div class="list-info">
          <span class="list-name">${escH(user.displayName)}</span>
          <span class="list-sub">${user.online ? 'Online' : 'Offline'}</span>
        </div>`;
      item.onclick = () => window.__openChat(uid);
      chatsList.appendChild(item);
    }

    if (currentPeerUid) highlightChat(currentPeerUid);
  };

  // ── Helpers ────────────────────────────────
  function makeChatId(a, b)  { return [a, b].sort().join("_"); }
  function scrollBottom()    { msgContainer.scrollTop = msgContainer.scrollHeight; }
  function fmtTime(d)        { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function escH(s)           { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function highlightChat(uid) {
    document.querySelectorAll(".chat-list-item").forEach(el =>
      el.classList.toggle("active", el.dataset.uid === uid));
  }
}
