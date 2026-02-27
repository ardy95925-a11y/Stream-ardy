// ============================================
// PULSE2 — chat.js (messages, typing, reactions)
// ============================================
import { state, db, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, showToast } from "./app.js";

let typingTimeout = null;
let typingRef = null;

export function initChat() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  });

  // Send on Enter (Shift+Enter for newline)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }

    // Typing indicator
    sendTypingIndicator();
  });

  sendBtn.addEventListener('click', sendMessage);

  // Listen for channel changes
  window.addEventListener('channelSelected', ({ detail }) => {
    loadMessages(detail.id, detail.type);
  });
}

// ---- Load Messages ----
function loadMessages(channelId, type) {
  const messagesList = document.getElementById('messages-list');
  messagesList.innerHTML = '';

  const collectionName = type === 'dm' ? 'dms' : 'channels';
  const msgPath = collection(db, collectionName, channelId, 'messages');
  const q = query(msgPath, orderBy('timestamp', 'asc'));

  // Unsubscribe previous listener
  if (state.unsubMessages) state.unsubMessages();
  if (state.unsubTyping) state.unsubTyping();

  // Messages listener
  state.unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = { id: change.doc.id, ...change.doc.data() };
        appendMessage(msg, messagesList);
        scrollToBottom();
      } else if (change.type === 'modified') {
        const msg = { id: change.doc.id, ...change.doc.data() };
        updateMessageEl(msg);
      } else if (change.type === 'removed') {
        const el = document.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (el) {
          el.style.animation = 'toastOut 0.2s ease forwards';
          setTimeout(() => el.remove(), 200);
        }
      }
    });

    updateOnlineCount(channelId, type);
  });

  // Typing indicator listener
  typingRef = collection(db, collectionName, channelId, 'typing');
  state.unsubTyping = onSnapshot(typingRef, (snap) => {
    const typingUsers = snap.docs
      .map(d => d.data())
      .filter(d => d.uid !== state.user.uid && Date.now() - d.timestamp?.toMillis() < 5000);

    const typingEl = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');

    if (typingUsers.length === 0) {
      typingEl.classList.add('hidden');
    } else {
      const names = typingUsers.map(u => u.displayName).slice(0, 3);
      typingText.textContent = names.join(', ') + (names.length === 1 ? ' is typing...' : ' are typing...');
      typingEl.classList.remove('hidden');
    }
  });
}

// ---- Append Message ----
function appendMessage(msg, container) {
  const msgs = container.querySelectorAll('.msg-row');
  const lastMsg = msgs[msgs.length - 1];
  const isContinuation = lastMsg && lastMsg.dataset.author === msg.authorId &&
    (msg.timestamp?.toMillis() - (parseInt(lastMsg.dataset.ts) || 0)) < 300000; // 5 min

  const div = document.createElement('div');
  div.className = `msg-row${isContinuation ? ' continuation' : ''}`;
  div.dataset.msgId = msg.id;
  div.dataset.author = msg.authorId;
  div.dataset.ts = msg.timestamp?.toMillis() || Date.now();

  const avatarColor = msg.avatarColor || '#FF6B1A';
  const initials = (msg.author || '?').charAt(0).toUpperCase();

  const reactions = renderReactions(msg);

  div.innerHTML = `
    <div class="msg-avatar" style="background:${avatarColor}">${initials}</div>
    <div class="msg-body">
      ${!isContinuation ? `
        <div class="msg-meta">
          <span class="msg-author">${escapeHtml(msg.author || 'Unknown')}</span>
          <span class="msg-time">${formatTime(msg.timestamp)}</span>
        </div>
      ` : ''}
      <div class="msg-content">${formatContent(msg.content)}</div>
      <div class="msg-reactions">${reactions}</div>
    </div>
    <div class="msg-actions">
      <button class="msg-action-btn react-btn" title="React" data-id="${msg.id}">😊</button>
      ${msg.authorId === state.user.uid ? `<button class="msg-action-btn delete-btn" title="Delete" data-id="${msg.id}">🗑</button>` : ''}
    </div>
  `;

  // React button
  div.querySelector('.react-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(msg.id, e.target);
  });

  // Delete button
  div.querySelector('.delete-btn')?.addEventListener('click', () => {
    deleteMessage(msg.id);
  });

  // Reaction pills
  div.querySelectorAll('.reaction-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const emoji = pill.dataset.emoji;
      toggleReaction(msg.id, emoji);
    });
  });

  container.appendChild(div);
}

function updateMessageEl(msg) {
  const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!el) return;

  const reactionsEl = el.querySelector('.msg-reactions');
  if (reactionsEl) {
    reactionsEl.innerHTML = renderReactions(msg);
    reactionsEl.querySelectorAll('.reaction-pill').forEach(pill => {
      pill.addEventListener('click', () => toggleReaction(msg.id, pill.dataset.emoji));
    });
  }
}

function renderReactions(msg) {
  if (!msg.reactions || Object.keys(msg.reactions).length === 0) return '';
  return Object.entries(msg.reactions).map(([emoji, users]) => {
    if (!users || users.length === 0) return '';
    const mine = users.includes(state.user?.uid);
    return `<div class="reaction-pill${mine ? ' mine' : ''}" data-emoji="${emoji}">
      <span>${emoji}</span>
      <span class="reaction-count">${users.length}</span>
    </div>`;
  }).join('');
}

// ---- Send Message ----
async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !state.currentChannel) return;

  input.value = '';
  input.style.height = 'auto';

  const collectionName = state.currentChannelType === 'dm' ? 'dms' : 'channels';

  try {
    await addDoc(collection(db, collectionName, state.currentChannel, 'messages'), {
      content,
      author: state.userDoc?.displayName || state.user.displayName || 'User',
      authorId: state.user.uid,
      avatarColor: state.userDoc?.avatarColor || '#FF6B1A',
      timestamp: serverTimestamp(),
      reactions: {},
    });

    // Update lastActivity for DMs
    if (state.currentChannelType === 'dm') {
      await updateDoc(doc(db, 'dms', state.currentChannel), { lastActivity: serverTimestamp() });
    }

    // Clear typing indicator
    clearTypingIndicator();
  } catch (err) {
    showToast('Failed to send message.', 'error');
  }
}

// ---- Delete Message ----
async function deleteMessage(msgId) {
  const collectionName = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    await deleteDoc(doc(db, collectionName, state.currentChannel, 'messages', msgId));
  } catch (err) {
    showToast('Failed to delete message.', 'error');
  }
}

// ---- Reactions ----
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '🎉', '👀', '💯', '😎', '⚡'];

function showReactionPicker(msgId, anchor) {
  // Remove existing picker
  document.querySelector('.reaction-quick-picker')?.remove();

  const picker = document.createElement('div');
  picker.className = 'emoji-picker reaction-quick-picker';
  picker.style.cssText = 'position:fixed;z-index:200;';

  QUICK_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      toggleReaction(msgId, emoji);
      picker.remove();
    });
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  picker.style.left = rect.left + 'px';

  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 100);
}

async function toggleReaction(msgId, emoji) {
  if (!state.currentChannel) return;
  const collectionName = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const msgRef = doc(db, collectionName, state.currentChannel, 'messages', msgId);

  try {
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) return;

    const reactions = msgSnap.data().reactions || {};
    const users = reactions[emoji] || [];

    if (users.includes(state.user.uid)) {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(state.user.uid) });
    } else {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(state.user.uid) });
    }
  } catch (err) {
    // silent
  }
}

// ---- Typing Indicator ----
async function sendTypingIndicator() {
  if (!state.currentChannel || !typingRef) return;

  const typingDocRef = doc(db, typingRef.path.replace('/typing', ''), 'typing', state.user.uid);

  try {
    await setDoc(typingDocRef, {
      uid: state.user.uid,
      displayName: state.userDoc?.displayName || state.user.displayName || 'User',
      timestamp: serverTimestamp(),
    });
  } catch { /* silent */ }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => clearTypingIndicator(), 4000);
}

async function clearTypingIndicator() {
  if (!state.currentChannel) return;
  const collectionName = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    await deleteDoc(doc(db, collectionName, state.currentChannel, 'typing', state.user.uid));
  } catch { /* silent */ }
}

// ---- Online Count ----
async function updateOnlineCount(channelId, type) {
  const el = document.getElementById('online-count');
  if (!el) return;

  try {
    const q = query(collection(db, 'users'), where('status', '==', 'online'));
    const snap = await getDocs(q);
    el.textContent = `● ${snap.size} online`;
  } catch {
    el.textContent = '';
  }
}

// ---- Helpers ----
function scrollToBottom() {
  const container = document.getElementById('messages-container');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatContent(content) {
  if (!content) return '';
  // Escape HTML
  let html = escapeHtml(content);
  // **bold**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // *italic*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,107,26,0.1);border-radius:3px;padding:1px 5px;font-family:var(--font-mono);font-size:0.9em">$1</code>');
  // URLs
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--orange-light);text-decoration:underline">$1</a>');
  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
