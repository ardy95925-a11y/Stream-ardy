// ═══════════════════════════════════════════════════════════
// PULSE2 — chat.js  (Messaging, Reactions, Edit, Reply, Pin)
// ═══════════════════════════════════════════════════════════
import {
  state, db, showToast, escHtml, formatTime, showModal, closeAllModals,
  showUserPopup, renderPins,
  doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, where
} from "./app.js";

const MAX_MSG_LEN = 2000;

let unsubMessages = null;
let unsubTyping   = null;
let typingTimeout = null;
let replyTo       = null;   // { id, author, content }
let editingMsgId  = null;
let ctxMsgId      = null;
let ctxMsgData    = null;
let newMsgCount   = 0;
let isAtBottom    = true;

const QUICK_EMOJIS = ['👍','❤️','😂','🔥','😮','🎉','💯','👀','😎','⚡','🙌','💀','🤣','😭','✨','🤔'];

// ── Init ──────────────────────────────────────────────────────
export function initChat() {
  setupInput();
  setupScrollWatcher();
  setupScrollBottomBtn();
  setupContextMenu();
  setupReplyBar();
}

// ── Input ─────────────────────────────────────────────────────
function setupInput() {
  const input   = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const charCnt = document.getElementById('char-count');

  // Auto-resize + char count
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    const len = input.value.length;
    if (charCnt) {
      charCnt.textContent = len > 1800 ? `${len}/${MAX_MSG_LEN}` : '';
      charCnt.className = 'char-count' + (len > MAX_MSG_LEN ? ' error' : len > 1800 ? ' warn' : '');
    }
    if (state.preferences.sendTyping !== false) triggerTyping();
  });

  // Send / edit / cancel
  input.addEventListener('keydown', e => {
    const enterSend = state.preferences.enterSend !== false;
    if (e.key === 'Enter' && !e.shiftKey && enterSend) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { cancelReply(); cancelEdit(); }
    if (e.key === 'ArrowUp' && !input.value && !editingMsgId) { e.preventDefault(); editLastMessage(); }
  });

  sendBtn.addEventListener('click', handleSend);

  // Global shortcuts
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'k') {
      e.preventDefault();
      if (state.currentChannelId) { document.getElementById('message-input')?.focus(); }
    }
    if (e.key === 'Escape') {
      document.getElementById('ctx-menu')?.classList.add('hidden');
      document.getElementById('reaction-popup')?.classList.add('hidden');
      document.getElementById('emoji-picker')?.classList.add('hidden');
      document.querySelectorAll('.reaction-quick-popup').forEach(p => p.remove());
    }
  });
}

function handleSend() {
  if (editingMsgId) {
    submitEdit();
  } else {
    sendMessage();
  }
}

// ── Load channel messages ─────────────────────────────────────
export function loadChannel(channelId, type) {
  // Cleanup
  if (unsubMessages) unsubMessages();
  if (unsubTyping)   unsubTyping();
  clearTimeout(typingTimeout);

  replyTo = null; editingMsgId = null; newMsgCount = 0; isAtBottom = true;
  cancelReply(); cancelEdit();

  const msgList = document.getElementById('messages-list');
  msgList.innerHTML = '';

  const coll  = type === 'dm' ? 'dms' : 'channels';
  const msgQ  = query(collection(db, coll, channelId, 'messages'), orderBy('timestamp', 'asc'));

  // Messages listener
  unsubMessages = onSnapshot(msgQ, snap => {
    snap.docChanges().forEach(change => {
      const msg = { id: change.doc.id, ...change.doc.data() };

      if (change.type === 'added') {
        appendMessage(msg, msgList);
        const isMine = msg.authorId === state.user?.uid;
        if (isAtBottom || isMine) scrollToBottom();
        else { newMsgCount++; updateScrollBtn(); }

        if (!isMine && state.preferences.sound !== false) playPop();

        // Browser notification
        if (document.hidden && state.preferences.notifications && !isMine) {
          tryNotify(msg.author || 'Someone', msg.content || '');
        }
      }
      if (change.type === 'modified') updateMsgEl(msg);
      if (change.type === 'removed') {
        const el = document.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (el) {
          el.style.transition = 'opacity 0.2s, transform 0.2s';
          el.style.opacity = '0'; el.style.transform = 'translateX(-8px)';
          setTimeout(() => el.remove(), 200);
        }
      }
    });
    updateOnlineCount();
  }, err => {
    console.error('Firestore messages error:', err);
    showToast('Message load failed. Check Firestore rules.', 'error');
  });

  // Typing listener
  const typingColl = collection(db, coll, channelId, 'typing');
  unsubTyping = onSnapshot(typingColl, snap => {
    const typers = snap.docs.map(d => d.data())
      .filter(d => d.uid !== state.user?.uid && d.timestamp && (Date.now() - d.timestamp.toMillis()) < 5000);
    const el    = document.getElementById('typing-indicator');
    const label = document.getElementById('typing-text');
    if (!el) return;
    if (!typers.length) { el.classList.add('hidden'); return; }
    label.textContent = typers.slice(0,3).map(u => u.displayName).join(', ') + (typers.length === 1 ? ' is typing...' : ' are typing...');
    el.classList.remove('hidden');
  });
}

// ── Append message ────────────────────────────────────────────
function appendMessage(msg, container) {
  const prefs   = state.preferences;
  const grouped = prefs.grouping !== false;

  // Date divider
  if (msg.timestamp) {
    const msgDate  = msg.timestamp.toDate().toDateString();
    const dividers = container.querySelectorAll('.date-divider');
    const lastDiv  = dividers[dividers.length - 1];
    if (!lastDiv || lastDiv.dataset.date !== msgDate) {
      const dd = document.createElement('div');
      dd.className = 'date-divider'; dd.dataset.date = msgDate;
      dd.innerHTML = `<span>${formatDateLabel(msg.timestamp.toDate())}</span>`;
      container.appendChild(dd);
    }
  }

  // Continuation check
  const rows = container.querySelectorAll('.msg-row[data-author]');
  const last = rows[rows.length - 1];
  const isCont = grouped && last &&
    last.dataset.author === msg.authorId &&
    msg.timestamp && last.dataset.ts &&
    (msg.timestamp.toMillis() - parseInt(last.dataset.ts)) < 300000;

  const isMine  = msg.authorId === state.user?.uid;
  const color   = msg.avatarColor || '#FF6B1A';
  const initial = (msg.author || '?').charAt(0).toUpperCase();
  const showTs  = prefs.timestamps !== false;

  // Reply html
  const replyHtml = msg.replyTo ? `
    <div class="msg-reply-ref" data-jump="${msg.replyTo.id || ''}">
      <span style="color:var(--orange-l)">↩</span>
      <span class="reply-ref-author">${escHtml(msg.replyTo.author || 'Unknown')}</span>
      <span style="color:var(--text-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
        ${escHtml((msg.replyTo.content || '').slice(0, 70))}
      </span>
    </div>` : '';

  // Reactions html
  const reactHtml = buildReactionsHtml(msg.reactions || {}, msg.id);

  const div = document.createElement('div');
  div.className = `msg-row${isCont ? ' continuation' : ''}`;
  div.dataset.msgId  = msg.id;
  div.dataset.author = msg.authorId || '';
  div.dataset.ts     = msg.timestamp?.toMillis() || Date.now();

  div.innerHTML = `
    <div class="msg-avatar" style="background:${color}" data-uid="${msg.authorId || ''}" title="${escHtml(msg.author || '')}">${initial}</div>
    <div class="msg-body">
      ${!isCont ? `<div class="msg-meta">
        <span class="msg-author" data-uid="${msg.authorId || ''}">${escHtml(msg.author || 'Unknown')}</span>
        ${showTs ? `<span class="msg-time">${formatTime(msg.timestamp)}</span>` : ''}
        ${msg.edited ? `<span class="msg-edited">(edited)</span>` : ''}
      </div>` : (msg.edited ? `<span class="msg-edited">(edited)</span>` : '')}
      ${replyHtml}
      <div class="msg-content" id="mc-${msg.id}">${formatContent(msg.content || '')}</div>
      ${msg.pinned ? `<div style="font-size:11px;color:var(--orange);font-family:var(--font-mono);margin-top:3px">📌 pinned</div>` : ''}
      <div class="msg-reactions" id="mr-${msg.id}">${reactHtml}</div>
    </div>
    <div class="msg-actions">
      <button class="msg-act-btn react-quick" data-id="${msg.id}" title="React">😊</button>
      <button class="msg-act-btn msg-ctx-btn" data-id="${msg.id}" title="More">•••</button>
    </div>
  `;

  // Click handlers
  div.querySelector('.msg-avatar')?.addEventListener('click', () => openUserById(msg.authorId));
  div.querySelector('.msg-author')?.addEventListener('click', () => openUserById(msg.authorId));

  div.querySelector('.react-quick')?.addEventListener('click', e => {
    e.stopPropagation();
    showReactionPopup(msg.id, e.currentTarget);
  });

  div.querySelector('.msg-ctx-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    ctxMsgId = msg.id;
    ctxMsgData = msg;
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, isMine);
  });

  div.querySelector('.msg-reply-ref')?.addEventListener('click', () => {
    const target = document.querySelector(`[data-msg-id="${msg.replyTo?.id}"]`);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('highlighted'); setTimeout(() => target.classList.remove('highlighted'), 2000); }
  });

  // Reaction pill clicks
  div.querySelectorAll('.reaction-pill').forEach(pill => {
    pill.addEventListener('click', () => toggleReaction(msg.id, pill.dataset.emoji));
  });

  // Context menu on right-click
  div.addEventListener('contextmenu', e => {
    e.preventDefault();
    ctxMsgId = msg.id;
    ctxMsgData = msg;
    showContextMenu(e.clientX, e.clientY, isMine);
  });

  container.appendChild(div);
}

// ── Update existing message element ───────────────────────────
function updateMsgEl(msg) {
  const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!el) return;

  const contentEl   = document.getElementById(`mc-${msg.id}`);
  const reactionsEl = document.getElementById(`mr-${msg.id}`);

  if (contentEl) contentEl.innerHTML = formatContent(msg.content || '');
  if (reactionsEl) {
    reactionsEl.innerHTML = buildReactionsHtml(msg.reactions || {}, msg.id);
    reactionsEl.querySelectorAll('.reaction-pill').forEach(pill =>
      pill.addEventListener('click', () => toggleReaction(msg.id, pill.dataset.emoji)));
  }
}

function buildReactionsHtml(reactions, msgId) {
  return Object.entries(reactions).map(([emoji, users]) => {
    if (!users?.length) return '';
    const mine = users.includes(state.user?.uid);
    return `<div class="reaction-pill${mine ? ' mine' : ''}" data-emoji="${emoji}" data-msg="${msgId}" title="${users.length} reaction${users.length > 1 ? 's' : ''}">
      ${emoji} <span class="reaction-count">${users.length}</span>
    </div>`;
  }).join('');
}

// ── Send message ──────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !state.currentChannelId) return;
  if (content.length > MAX_MSG_LEN) { showToast(`Message too long (max ${MAX_MSG_LEN} chars).`, 'error'); return; }

  const msgData = {
    content,
    author:      state.userDoc?.displayName || state.user?.displayName || 'User',
    authorId:    state.user.uid,
    avatarColor: state.userDoc?.avatarColor || '#FF6B1A',
    timestamp:   serverTimestamp(),
    reactions:   {},
    pinned:      false,
    edited:      false,
  };

  if (replyTo) {
    msgData.replyTo = { id: replyTo.id, author: replyTo.author, content: replyTo.content };
  }

  input.value = '';
  input.style.height = 'auto';
  cancelReply();
  clearTypingIndicator();

  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    await addDoc(collection(db, coll, state.currentChannelId, 'messages'), msgData);
    if (state.currentChannelType === 'dm') {
      await updateDoc(doc(db, 'dms', state.currentChannelId), { lastActivity: serverTimestamp() });
    }
  } catch (err) {
    showToast('Failed to send message.', 'error');
    console.error('Send error:', err);
    input.value = content; // restore
  }
}

// ── Delete message ────────────────────────────────────────────
async function deleteMessage(msgId) {
  if (!msgId || !state.currentChannelId) return;
  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    await deleteDoc(doc(db, coll, state.currentChannelId, 'messages', msgId));
  } catch (err) {
    showToast('Failed to delete.', 'error');
    console.error(err);
  }
}

// ── Edit message ──────────────────────────────────────────────
function startEdit(msg) {
  cancelEdit();
  editingMsgId = msg.id;

  const contentEl = document.getElementById(`mc-${msg.id}`);
  if (!contentEl) return;

  const ta = document.createElement('textarea');
  ta.className = 'edit-input';
  ta.value = msg.content || '';
  ta.rows = 1;
  setTimeout(() => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }, 10);
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
    if (e.key === 'Escape') cancelEdit();
  });

  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  actions.innerHTML = `
    <button class="edit-save-btn">Save</button>
    <button class="edit-cancel-btn">Cancel <kbd style="font-size:10px">Esc</kbd></button>
  `;
  actions.querySelector('.edit-save-btn').addEventListener('click', submitEdit);
  actions.querySelector('.edit-cancel-btn').addEventListener('click', cancelEdit);

  contentEl.innerHTML = '';
  contentEl.appendChild(ta);
  contentEl.appendChild(actions);
}

async function submitEdit() {
  if (!editingMsgId || !state.currentChannelId) return;
  const ta = document.querySelector(`#mc-${editingMsgId} .edit-input`);
  if (!ta) return;
  const newContent = ta.value.trim();
  if (!newContent) { showToast('Message cannot be empty.', 'error'); return; }

  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const id = editingMsgId;
  cancelEdit();

  try {
    await updateDoc(doc(db, coll, state.currentChannelId, 'messages', id), {
      content: newContent, edited: true,
    });
  } catch (err) {
    showToast('Failed to edit message.', 'error');
    console.error(err);
  }
}

function cancelEdit() {
  if (!editingMsgId) return;
  const el = document.querySelector(`[data-msg-id="${editingMsgId}"] .msg-content`);
  editingMsgId = null;
  // The onSnapshot modified event will restore the element
}

function editLastMessage() {
  const rows = [...document.querySelectorAll('.msg-row[data-author]')];
  const lastMine = rows.reverse().find(r => r.dataset.author === state.user?.uid);
  if (!lastMine) return;
  const msgId = lastMine.dataset.msgId;
  // Fetch data from DOM + re-create with original content
  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  getDoc(doc(db, coll, state.currentChannelId, 'messages', msgId)).then(snap => {
    if (snap.exists()) startEdit({ id: snap.id, ...snap.data() });
  });
}

// ── Reply ─────────────────────────────────────────────────────
function setupReplyBar() {
  document.getElementById('cancel-reply-btn')?.addEventListener('click', cancelReply);
}

function startReply(msg) {
  replyTo = { id: msg.id, author: msg.author, content: msg.content };
  const banner    = document.getElementById('reply-banner');
  const authorEl  = document.getElementById('reply-banner-author');
  const previewEl = document.getElementById('reply-banner-preview');
  if (banner) { banner.classList.remove('hidden'); }
  if (authorEl) authorEl.textContent = msg.author || 'Unknown';
  if (previewEl) previewEl.textContent = (msg.content || '').slice(0, 80);
  document.getElementById('message-input')?.focus();
}

function cancelReply() {
  replyTo = null;
  document.getElementById('reply-banner')?.classList.add('hidden');
}

// ── Reactions ─────────────────────────────────────────────────
function showReactionPopup(msgId, anchor) {
  // Remove old
  document.getElementById('reaction-popup')?.classList.add('hidden');
  document.querySelectorAll('.reaction-quick-popup').forEach(p => p.remove());

  const popup = document.getElementById('reaction-popup');
  const grid  = document.getElementById('reaction-popup-grid');
  if (!popup || !grid) return;

  grid.innerHTML = '';
  QUICK_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'react-quick-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      toggleReaction(msgId, emoji);
      popup.classList.add('hidden');
    });
    grid.appendChild(btn);
  });

  popup.classList.remove('hidden');

  const rect = anchor.getBoundingClientRect();
  const pw   = 248;
  let left   = rect.left;
  let top    = rect.top - 60;
  if (left + pw > window.innerWidth) left = window.innerWidth - pw - 10;
  if (top < 10) top = rect.bottom + 6;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';

  const closePopup = e => {
    if (!popup.contains(e.target)) {
      popup.classList.add('hidden');
      document.removeEventListener('click', closePopup);
    }
  };
  setTimeout(() => document.addEventListener('click', closePopup), 10);
}

async function toggleReaction(msgId, emoji) {
  if (!state.currentChannelId || !state.user) return;
  const coll   = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const msgRef = doc(db, coll, state.currentChannelId, 'messages', msgId);
  try {
    const snap  = await getDoc(msgRef);
    if (!snap.exists()) return;
    const users = (snap.data().reactions || {})[emoji] || [];
    if (users.includes(state.user.uid)) {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(state.user.uid) });
    } else {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(state.user.uid) });
    }
  } catch (err) { console.warn('Reaction error:', err); }
}

// ── Pin ───────────────────────────────────────────────────────
async function pinMessage(msgId) {
  if (!state.currentChannelId) return;
  const coll   = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const msgRef = doc(db, coll, state.currentChannelId, 'messages', msgId);
  try {
    const snap   = await getDoc(msgRef);
    if (!snap.exists()) return;
    const pinned = !snap.data().pinned;
    await updateDoc(msgRef, { pinned });
    showToast(pinned ? '📌 Message pinned!' : 'Message unpinned.', 'success');
    renderPins();
  } catch (err) {
    showToast('Failed to pin message.', 'error');
    console.error(err);
  }
}

// ── Context menu ──────────────────────────────────────────────
function setupContextMenu() {
  const menu = document.getElementById('ctx-menu');

  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });

  document.getElementById('ctx-reply').addEventListener('click',  () => { if (ctxMsgData) startReply(ctxMsgData); menu.classList.add('hidden'); });
  document.getElementById('ctx-react').addEventListener('click',  () => {
    if (ctxMsgId) {
      const el = document.querySelector(`[data-msg-id="${ctxMsgId}"] .react-quick`);
      if (el) showReactionPopup(ctxMsgId, el);
    }
    menu.classList.add('hidden');
  });
  document.getElementById('ctx-pin').addEventListener('click',    () => { if (ctxMsgId) pinMessage(ctxMsgId); menu.classList.add('hidden'); });
  document.getElementById('ctx-copy').addEventListener('click',   () => {
    if (ctxMsgData?.content) navigator.clipboard.writeText(ctxMsgData.content).then(() => showToast('Copied!', 'success'));
    menu.classList.add('hidden');
  });
  document.getElementById('ctx-edit').addEventListener('click',   () => { if (ctxMsgData && ctxMsgData.authorId === state.user?.uid) startEdit(ctxMsgData); menu.classList.add('hidden'); });
  document.getElementById('ctx-delete').addEventListener('click', () => { if (ctxMsgId) deleteMessage(ctxMsgId); menu.classList.add('hidden'); });
}

function showContextMenu(x, y, isMine) {
  const menu    = document.getElementById('ctx-menu');
  const editBtn = document.getElementById('ctx-edit');
  const delBtn  = document.getElementById('ctx-delete');
  editBtn.style.display = isMine ? '' : 'none';
  delBtn.style.display  = isMine ? '' : 'none';
  menu.classList.remove('hidden');

  const w = window.innerWidth, h = window.innerHeight;
  let left = x, top = y;
  if (left + 200 > w) left = w - 210;
  if (top + 220 > h)  top  = y - menu.offsetHeight - 8;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

// ── Typing indicator ──────────────────────────────────────────
async function triggerTyping() {
  if (!state.currentChannelId || !state.user) return;
  const coll    = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const typRef  = doc(db, coll, state.currentChannelId, 'typing', state.user.uid);
  try {
    await setDoc(typRef, {
      uid:         state.user.uid,
      displayName: state.userDoc?.displayName || state.user.displayName || 'User',
      timestamp:   serverTimestamp(),
    });
  } catch {}
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTypingIndicator, 4000);
}

async function clearTypingIndicator() {
  if (!state.currentChannelId || !state.user) return;
  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try { await deleteDoc(doc(db, coll, state.currentChannelId, 'typing', state.user.uid)); } catch {}
}

// ── Online count ──────────────────────────────────────────────
let onlineCountTimeout = null;
async function updateOnlineCount() {
  clearTimeout(onlineCountTimeout);
  onlineCountTimeout = setTimeout(async () => {
    const el = document.getElementById('online-count');
    if (!el) return;
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('status', '==', 'online')));
      el.textContent = `● ${snap.size} online`;
    } catch { el.textContent = ''; }
  }, 2000);
}

// ── Open user popup ───────────────────────────────────────────
async function openUserById(uid) {
  if (!uid) return;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) showUserPopup(snap.data());
  } catch {}
}

// ── Scroll ────────────────────────────────────────────────────
function setupScrollWatcher() {
  const container = document.getElementById('messages-container');
  container.addEventListener('scroll', () => {
    isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isAtBottom) { newMsgCount = 0; }
    updateScrollBtn();
  });
}

function setupScrollBottomBtn() {
  document.getElementById('scroll-bottom-btn')?.addEventListener('click', () => {
    scrollToBottom(true);
    newMsgCount = 0;
    updateScrollBtn();
  });
}

function updateScrollBtn() {
  const btn   = document.getElementById('scroll-bottom-btn');
  const badge = document.getElementById('scroll-unread-badge');
  if (!btn) return;
  btn.classList.toggle('hidden', isAtBottom);
  if (badge) badge.textContent = newMsgCount > 0 ? String(newMsgCount) : '';
}

function scrollToBottom(instant = false) {
  const c = document.getElementById('messages-container');
  if (!c) return;
  if (instant) c.scrollTop = c.scrollHeight;
  else requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

// ── Audio ─────────────────────────────────────────────────────
let audioCtx;
function playPop() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.start(); osc.stop(audioCtx.currentTime + 0.18);
  } catch {}
}

// ── Notification ──────────────────────────────────────────────
function tryNotify(author, content) {
  if (Notification.permission === 'granted') {
    const n = new Notification(`Pulse2 — ${author}`, {
      body: content.slice(0, 100),
      tag: 'pulse2-msg',
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 5000);
  }
}

// ── Content formatting ────────────────────────────────────────
function formatContent(raw) {
  if (!raw) return '';
  let s = escHtml(raw);
  // Multiline code block ```
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<code class="code-block">${code}</code>`);
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code style="background:var(--orange-dim);border-radius:3px;padding:1px 5px;font-family:var(--font-mono);font-size:0.88em;color:var(--orange-l)">${c}</code>`);
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '<del style="opacity:0.55">$1</del>');
  // Underline __
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  // Links
  s = s.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--orange-l);text-decoration:underline;text-underline-offset:2px">$1</a>');
  return s;
}

function formatDateLabel(date) {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
