// ═══════════════════════════════════════════════════════════
// PULSE2 — extras.js  (Polls · Message Threads · GIF Search
//                      · Invite Links · Magic Commands)
// ═══════════════════════════════════════════════════════════
import {
  state, db, showToast, escHtml, formatTime,
  showModal, closeModal, closeAllModals,
  doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, where, limit
} from "./app.js";

// ── Magic Commands (/slash commands) ─────────────────────────
// Intercepts outgoing messages for /commands before they send.
// Hooked in by patching the message input's keydown in initExtras().

const COMMANDS = {
  '/roll':    cmdRoll,
  '/flip':    cmdFlip,
  '/poll':    cmdPoll,
  '/shrug':   () => insertText('¯\\_(ツ)_/¯'),
  '/tableflip': () => insertText('(╯°□°）╯︵ ┻━┻'),
  '/unflip':  () => insertText('┬──┬ ノ( ゜-゜ノ)'),
  '/lenny':   () => insertText('( ͡° ͜ʖ ͡°)'),
  '/me':      cmdMe,
  '/gif':     cmdGif,
  '/help':    cmdHelp,
};

function insertText(text) {
  const input = document.getElementById('message-input');
  if (!input) return false;
  input.value = text;
  return true; // signal: send immediately
}

function cmdRoll(args) {
  // /roll [NdN]  e.g. /roll 2d6
  const match = (args[0] || '1d6').match(/^(\d+)?d(\d+)$/i);
  const count = Math.min(parseInt(match?.[1] || 1), 20);
  const sides = Math.min(parseInt(match?.[2] || 6), 1000);
  if (!match || isNaN(sides) || sides < 2) { showToast('Usage: /roll 2d6', 'error'); return false; }
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0);
  const detail = count > 1 ? ` [${rolls.join(', ')}]` : '';
  insertText(`🎲 Rolled ${count}d${sides}: **${total}**${detail}`);
  return true;
}

function cmdFlip() {
  insertText(Math.random() < 0.5 ? '🪙 Heads!' : '🪙 Tails!');
  return true;
}

function cmdMe(args) {
  const name = state.userDoc?.displayName || 'Someone';
  insertText(`_${name} ${args.join(' ')}_`);
  return true;
}

function cmdGif(args) {
  if (!args.length) { showToast('Usage: /gif <search term>', 'error'); return false; }
  openGifSearch(args.join(' '));
  return false; // don't send — gif picker takes over
}

function cmdHelp() {
  const helpText = [
    '**Pulse² Extras — Commands**',
    '/roll [NdN] — Roll dice (e.g. /roll 2d6)',
    '/flip — Flip a coin',
    '/poll Question | Option A | Option B — Create a poll',
    '/me <action> — Describe an action',
    '/gif <term> — Search for a GIF',
    '/shrug  /tableflip  /lenny — Text faces',
  ].join('\n');
  insertText(helpText);
  return true;
}

function cmdPoll(args) {
  // /poll Question | Option A | Option B | ...
  const parts = args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length < 3) {
    showToast('Usage: /poll Question | Option A | Option B', 'error');
    return false;
  }
  openPollCreator(parts[0], parts.slice(1));
  return false; // poll creator takes over
}

// ── Poll System ───────────────────────────────────────────────
function openPollCreator(question, options) {
  // Build an inline modal
  let existing = document.getElementById('poll-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'poll-modal';
  modal.className = 'modal';
  modal.style.cssText = 'max-width:400px;width:100%';
  modal.innerHTML = `
    <div class="modal-header">
      <h3>📊 Create Poll</h3>
      <button class="modal-close" id="poll-close-btn">✕</button>
    </div>
    <div class="input-group">
      <label>Question</label>
      <input type="text" id="poll-question" value="${escHtml(question)}" placeholder="Your question..." maxlength="200"/>
    </div>
    <div id="poll-options-list"></div>
    <button id="poll-add-option" style="background:none;border:1px dashed var(--border);color:var(--text-400);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;width:100%;margin-bottom:10px">+ Add Option</button>
    <div style="display:flex;gap:8px">
      <button id="poll-cancel-btn" class="btn-danger" style="flex:1">Cancel</button>
      <button id="poll-send-btn" class="btn-primary" style="flex:2">Send Poll →</button>
    </div>
  `;

  const overlay = document.getElementById('modal-overlay');
  overlay.appendChild(modal);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  // Render options
  const list = modal.querySelector('#poll-options-list');

  function renderOptions(opts) {
    list.innerHTML = '';
    opts.forEach((opt, i) => {
      const row = document.createElement('div');
      row.className = 'input-group';
      row.style.cssText = 'display:flex;gap:8px;align-items:center';
      row.innerHTML = `
        <input type="text" value="${escHtml(opt)}" placeholder="Option ${i + 1}" maxlength="100" style="flex:1"/>
        ${opts.length > 2 ? `<button data-i="${i}" class="icon-btn poll-del" title="Remove" style="flex-shrink:0">✕</button>` : ''}
      `;
      list.appendChild(row);
    });
  }

  let opts = [...options];
  renderOptions(opts);

  list.addEventListener('click', e => {
    if (e.target.classList.contains('poll-del')) {
      const i = parseInt(e.target.dataset.i);
      opts.splice(i, 1);
      renderOptions(opts);
    }
  });

  modal.querySelector('#poll-add-option').addEventListener('click', () => {
    if (opts.length >= 8) { showToast('Max 8 options.', 'error'); return; }
    opts.push('');
    renderOptions(opts);
    list.querySelectorAll('input')[opts.length - 1]?.focus();
  });

  modal.querySelector('#poll-close-btn').addEventListener('click',   () => { modal.remove(); overlay.classList.add('hidden'); });
  modal.querySelector('#poll-cancel-btn').addEventListener('click',  () => { modal.remove(); overlay.classList.add('hidden'); });
  modal.querySelector('#poll-send-btn').addEventListener('click', async () => {
    const q = modal.querySelector('#poll-question').value.trim();
    const currentOpts = [...list.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (!q) { showToast('Enter a question.', 'error'); return; }
    if (currentOpts.length < 2) { showToast('Need at least 2 options.', 'error'); return; }

    await sendPoll(q, currentOpts);
    modal.remove();
    overlay.classList.add('hidden');
  });
}

async function sendPoll(question, options) {
  if (!state.currentChannelId) return;
  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  const votes = {};
  options.forEach(opt => { votes[opt] = []; });

  try {
    await addDoc(collection(db, coll, state.currentChannelId, 'messages'), {
      type:        'poll',
      question,
      options,
      votes,
      author:      state.userDoc?.displayName || 'User',
      authorId:    state.user.uid,
      avatarColor: state.userDoc?.avatarColor || '#FF6B1A',
      timestamp:   serverTimestamp(),
      reactions:   {},
      pinned:      false,
      edited:      false,
    });
  } catch (err) {
    showToast('Failed to send poll.', 'error');
    console.error(err);
  }
}

export function renderPollMessage(msg) {
  const totalVotes = Object.values(msg.votes || {}).reduce((a, b) => a + (b?.length || 0), 0);
  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';

  const optionsHtml = (msg.options || []).map(opt => {
    const voters = (msg.votes || {})[opt] || [];
    const myVote = voters.includes(state.user?.uid);
    const pct    = totalVotes ? Math.round((voters.length / totalVotes) * 100) : 0;
    return `
      <button class="poll-opt${myVote ? ' voted' : ''}" data-opt="${escHtml(opt)}" data-msgid="${msg.id}">
        <div class="poll-opt-row">
          <span class="poll-opt-label">${escHtml(opt)}</span>
          <span class="poll-opt-count">${voters.length} · ${pct}%</span>
        </div>
        <div class="poll-bar"><div class="poll-fill" style="width:${pct}%"></div></div>
      </button>
    `;
  }).join('');

  const div = document.createElement('div');
  div.className = 'poll-card';
  div.innerHTML = `
    <div class="poll-header">
      <span class="poll-icon">📊</span>
      <span class="poll-question">${escHtml(msg.question || '')}</span>
    </div>
    ${optionsHtml}
    <div class="poll-footer">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</div>
  `;

  div.querySelectorAll('.poll-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.user || !state.currentChannelId) return;
      const opt = btn.dataset.opt;
      const msgRef = doc(db, coll, state.currentChannelId, 'messages', msg.id);
      try {
        const snap = await getDoc(msgRef);
        if (!snap.exists()) return;
        const votes = snap.data().votes || {};
        const updates = {};
        // Remove user from all options first
        (msg.options || []).forEach(o => {
          const arr = votes[o] || [];
          updates[`votes.${o}`] = arr.filter(uid => uid !== state.user.uid);
        });
        // Toggle: add if not already voted
        const currentVoters = votes[opt] || [];
        if (!currentVoters.includes(state.user.uid)) {
          updates[`votes.${opt}`] = arrayUnion(state.user.uid);
        }
        await updateDoc(msgRef, updates);
      } catch (err) { console.warn('Vote error:', err); }
    });
  });

  return div;
}

// ── GIF Search (via Tenor API via public CORS proxy) ──────────
const TENOR_KEY = 'AIzaSyDyT5W0Jh49F9udFSLST1t6s6YqH-s7qqo'; // public demo key
let gifSearchTimeout;
let gifPickerOpen = false;

function openGifSearch(prefill = '') {
  let picker = document.getElementById('gif-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'gif-picker';
    picker.className = 'gif-picker hidden';
    picker.innerHTML = `
      <div class="gif-picker-header">
        <input type="text" id="gif-search-input" placeholder="Search GIFs..." class="emoji-search" autocomplete="off"/>
        <button id="gif-close-btn" class="icon-btn">✕</button>
      </div>
      <div id="gif-grid" class="gif-grid">
        <div class="gif-placeholder">Search for a GIF above ✨</div>
      </div>
      <div class="gif-powered">Powered by Tenor</div>
    `;
    document.getElementById('input-area')?.appendChild(picker);

    picker.querySelector('#gif-close-btn').addEventListener('click', closeGifPicker);
    picker.querySelector('#gif-search-input').addEventListener('input', e => {
      clearTimeout(gifSearchTimeout);
      gifSearchTimeout = setTimeout(() => fetchGifs(e.target.value), 400);
    });
  }

  picker.classList.remove('hidden');
  gifPickerOpen = true;

  const input = picker.querySelector('#gif-search-input');
  if (prefill) {
    input.value = prefill;
    fetchGifs(prefill);
  }
  setTimeout(() => input.focus(), 50);

  // Clear message input since /gif was used
  const msgInput = document.getElementById('message-input');
  if (msgInput) msgInput.value = '';
}

function closeGifPicker() {
  const picker = document.getElementById('gif-picker');
  picker?.classList.add('hidden');
  gifPickerOpen = false;
}

async function fetchGifs(query) {
  if (!query.trim()) return;
  const grid = document.getElementById('gif-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="gif-placeholder">Searching...</div>';

  try {
    const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=20&contentfilter=medium&media_filter=gif,tinygif`;
    const res  = await fetch(url);
    const data = await res.json();

    if (!data.results?.length) {
      grid.innerHTML = '<div class="gif-placeholder">No GIFs found 😶</div>';
      return;
    }

    grid.innerHTML = '';
    data.results.forEach(result => {
      const url    = result.media_formats?.tinygif?.url || result.media_formats?.gif?.url;
      const bigUrl = result.media_formats?.gif?.url || url;
      if (!url) return;

      const img = document.createElement('img');
      img.src = url;
      img.className = 'gif-thumb';
      img.alt = result.content_description || 'GIF';
      img.loading = 'lazy';
      img.addEventListener('click', () => sendGif(bigUrl, result.content_description || 'GIF'));
      grid.appendChild(img);
    });
  } catch (err) {
    grid.innerHTML = '<div class="gif-placeholder">Failed to load GIFs 😢</div>';
    console.warn('GIF fetch error:', err);
  }
}

async function sendGif(gifUrl, altText) {
  if (!state.currentChannelId) return;
  closeGifPicker();

  const coll = state.currentChannelType === 'dm' ? 'dms' : 'channels';
  try {
    await addDoc(collection(db, coll, state.currentChannelId, 'messages'), {
      type:        'gif',
      content:     '',
      gifUrl,
      gifAlt:      altText,
      author:      state.userDoc?.displayName || 'User',
      authorId:    state.user.uid,
      avatarColor: state.userDoc?.avatarColor || '#FF6B1A',
      timestamp:   serverTimestamp(),
      reactions:   {},
      pinned:      false,
      edited:      false,
    });
    if (state.currentChannelType === 'dm') {
      await updateDoc(doc(db, 'dms', state.currentChannelId), { lastActivity: serverTimestamp() });
    }
  } catch (err) {
    showToast('Failed to send GIF.', 'error');
    console.error(err);
  }
}

export function renderGifMessage(msg) {
  const div = document.createElement('div');
  div.className = 'gif-msg';
  div.innerHTML = `<img src="${escHtml(msg.gifUrl)}" alt="${escHtml(msg.gifAlt || 'GIF')}" class="gif-msg-img" loading="lazy"/>`;
  return div;
}

// ── Invite Link Generator ─────────────────────────────────────
export function setupInviteButton() {
  // Add an invite button to channel header
  const headerRight = document.querySelector('.chat-header-right');
  if (!headerRight || document.getElementById('invite-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'invite-btn';
  btn.className = 'icon-btn hdr-btn';
  btn.title = 'Copy Invite Link';
  btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  btn.addEventListener('click', generateInviteLink);

  // Insert before pin button
  const pinBtn = document.getElementById('pin-btn');
  if (pinBtn) headerRight.insertBefore(btn, pinBtn);
  else headerRight.prepend(btn);
}

async function generateInviteLink() {
  if (!state.currentChannelId || state.currentChannelType !== 'channel') {
    showToast('Invite links only work for channels.', 'error');
    return;
  }

  const code    = Math.random().toString(36).slice(2, 10).toUpperCase();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  try {
    await setDoc(doc(db, 'invites', code), {
      channelId:   state.currentChannelId,
      channelName: state.currentChannelMeta?.name || 'channel',
      createdBy:   state.user.uid,
      createdAt:   serverTimestamp(),
      expiresAt:   expires,
      uses:        0,
    });

    const link = `${location.origin}${location.pathname}?invite=${code}`;
    await navigator.clipboard.writeText(link);
    showToast(`📎 Invite link copied! (24h) — ${code}`, 'success');
  } catch (err) {
    showToast('Failed to create invite link.', 'error');
    console.error(err);
  }
}

// ── Message Threads (Reply Count Indicator) ───────────────────
export function renderThreadCount(msg) {
  if (!msg.threadCount || msg.threadCount < 1) return null;
  const span = document.createElement('span');
  span.className = 'thread-count';
  span.dataset.msgId = msg.id;
  span.innerHTML = `💬 ${msg.threadCount} repl${msg.threadCount === 1 ? 'y' : 'ies'}`;
  span.addEventListener('click', () => showToast('Threads coming soon!', 'info'));
  return span;
}

// ── User Presence: "Last Active" tooltip ─────────────────────
export function enhanceMemberItem(el, user) {
  if (!user.lastSeen) return;
  try {
    const ts   = user.lastSeen.toDate ? user.lastSeen.toDate() : new Date(user.lastSeen);
    const diff = Date.now() - ts.getTime();
    const mins = Math.floor(diff / 60000);
    const hrs  = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    let label;
    if (user.status === 'online')    label = 'Active now';
    else if (mins < 5)               label = 'Just now';
    else if (mins < 60)              label = `${mins}m ago`;
    else if (hrs < 24)               label = `${hrs}h ago`;
    else                             label = `${days}d ago`;

    el.title = `Last seen: ${label}`;
    const existing = el.querySelector('.member-name');
    if (existing && user.status !== 'online') {
      existing.insertAdjacentHTML('afterend', `<span class="member-lastseen">${label}</span>`);
    }
  } catch {}
}

// ── Message Word Count / Reading Time ────────────────────────
export function addMessageStats(contentEl, content) {
  if (!content || content.length < 200) return;
  const words = content.trim().split(/\s+/).length;
  const readSecs = Math.ceil(words / 3.5);
  if (readSecs < 5) return;
  const badge = document.createElement('span');
  badge.className = 'msg-read-time';
  badge.textContent = `~${readSecs}s read`;
  contentEl.appendChild(badge);
}

// ── Channel Stats Widget ──────────────────────────────────────
export async function showChannelStats() {
  if (!state.currentChannelId || state.currentChannelType !== 'channel') return;

  const coll = 'channels';
  try {
    const snap = await getDocs(
      query(collection(db, coll, state.currentChannelId, 'messages'),
        orderBy('timestamp', 'desc'), limit(500))
    );

    const msgs = snap.docs.map(d => d.data());
    const total = msgs.length;
    const authorCounts = {};
    msgs.forEach(m => {
      if (m.authorId) authorCounts[m.authorId] = (authorCounts[m.authorId] || { name: m.author, count: 0 });
      if (m.authorId) authorCounts[m.authorId].count++;
    });
    const topAuthors = Object.values(authorCounts).sort((a, b) => b.count - a.count).slice(0, 3);

    const statsHtml = `
      <div class="stats-widget">
        <div class="stats-title">📈 Channel Stats (last 500 msgs)</div>
        <div class="stats-row"><span>Total messages</span><strong>${total}</strong></div>
        ${topAuthors.map(a => `<div class="stats-row"><span>@${escHtml(a.name)}</span><strong>${a.count} msgs</strong></div>`).join('')}
      </div>`;

    const existing = document.getElementById('stats-widget-container');
    if (existing) { existing.remove(); return; }

    const container = document.createElement('div');
    container.id = 'stats-widget-container';
    container.innerHTML = statsHtml;
    container.style.cssText = 'position:fixed;bottom:90px;right:24px;z-index:200;';
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 8000);
  } catch (err) {
    console.warn('Stats error:', err);
  }
}

// ── Slash Command Autocomplete ────────────────────────────────
function setupCommandAutocomplete() {
  const input = document.getElementById('message-input');
  if (!input) return;

  let autocomplete = document.getElementById('cmd-autocomplete');
  if (!autocomplete) {
    autocomplete = document.createElement('div');
    autocomplete.id = 'cmd-autocomplete';
    autocomplete.className = 'cmd-autocomplete hidden';
    document.getElementById('input-area')?.appendChild(autocomplete);
  }

  const CMD_LIST = [
    { cmd: '/roll',      desc: 'Roll dice — /roll 2d6' },
    { cmd: '/flip',      desc: 'Flip a coin' },
    { cmd: '/poll',      desc: 'Create a poll' },
    { cmd: '/gif',       desc: 'Send a GIF' },
    { cmd: '/me',        desc: 'Describe an action' },
    { cmd: '/shrug',     desc: '¯\\_(ツ)_/¯' },
    { cmd: '/tableflip', desc: '(╯°□°）╯︵ ┻━┻' },
    { cmd: '/lenny',     desc: '( ͡° ͜ʖ ͡°)' },
    { cmd: '/help',      desc: 'Show all commands' },
  ];

  let selectedIdx = -1;
  let suggestions = [];

  input.addEventListener('input', () => {
    const val = input.value;
    if (!val.startsWith('/') || val.includes(' ')) {
      autocomplete.classList.add('hidden');
      selectedIdx = -1;
      return;
    }

    suggestions = CMD_LIST.filter(c => c.cmd.startsWith(val.toLowerCase()));
    if (!suggestions.length) { autocomplete.classList.add('hidden'); return; }

    autocomplete.innerHTML = suggestions.map((s, i) => `
      <div class="cmd-suggestion${i === selectedIdx ? ' selected' : ''}" data-i="${i}">
        <strong>${escHtml(s.cmd)}</strong>
        <span>${escHtml(s.desc)}</span>
      </div>
    `).join('');
    autocomplete.classList.remove('hidden');

    autocomplete.querySelectorAll('.cmd-suggestion').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        const i = parseInt(el.dataset.i);
        input.value = suggestions[i].cmd + ' ';
        autocomplete.classList.add('hidden');
        input.focus();
      });
    });
  });

  input.addEventListener('keydown', e => {
    if (autocomplete.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, suggestions.length - 1);
      rerenderSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      rerenderSelected();
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      const pick = selectedIdx >= 0 ? suggestions[selectedIdx] : suggestions[0];
      input.value = pick.cmd + ' ';
      autocomplete.classList.add('hidden');
      selectedIdx = -1;
    } else if (e.key === 'Escape') {
      autocomplete.classList.add('hidden');
      selectedIdx = -1;
    }
  });

  function rerenderSelected() {
    autocomplete.querySelectorAll('.cmd-suggestion').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIdx);
    });
  }
}

// ── Command Interceptor ───────────────────────────────────────
function setupCommandInterceptor() {
  const input   = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  if (!input) return;

  function maybeRunCommand() {
    const val = input.value.trim();
    if (!val.startsWith('/')) return false;

    const parts   = val.split(/\s+/);
    const cmd     = parts[0].toLowerCase();
    const args    = parts.slice(1);
    const handler = COMMANDS[cmd];

    if (!handler) return false;

    const shouldSend = handler(args);
    if (!shouldSend) {
      input.value = '';
    }
    // If shouldSend = true, the message text was placed in input and normal send picks it up
    return !shouldSend; // true = we handled it (don't double-send)
  }

  // Intercept Enter key
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && state.preferences.enterSend !== false) {
      if (maybeRunCommand()) e.stopImmediatePropagation();
    }
  }, true); // capture phase — run before chat.js

  // Intercept send button
  sendBtn.addEventListener('click', e => {
    if (maybeRunCommand()) e.stopImmediatePropagation();
  }, true);
}

// ── CSS Injection ─────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('extras-styles')) return;
  const style = document.createElement('style');
  style.id = 'extras-styles';
  style.textContent = `
    /* ── Poll Card ── */
    .poll-card {
      background: var(--bg-700);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin: 4px 0;
      max-width: 380px;
    }
    .poll-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .poll-icon { font-size: 18px; }
    .poll-question {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 15px;
      color: var(--text-100);
    }
    .poll-opt {
      width: 100%;
      background: var(--bg-600);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      margin-bottom: 6px;
      text-align: left;
    }
    .poll-opt:hover { border-color: var(--orange); background: var(--bg-500); }
    .poll-opt.voted { border-color: var(--orange); background: var(--orange-dim); }
    .poll-opt-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .poll-opt-label { font-size: 13px; color: var(--text-100); }
    .poll-opt-count { font-size: 11px; color: var(--text-400); font-family: var(--font-mono); }
    .poll-bar { height: 4px; background: var(--bg-400); border-radius: 2px; overflow: hidden; }
    .poll-fill { height: 100%; background: var(--orange); border-radius: 2px; transition: width 0.4s ease; }
    .poll-footer { font-size: 11px; color: var(--text-600); font-family: var(--font-mono); margin-top: 8px; }

    /* ── GIF Picker ── */
    .gif-picker {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--bg-700);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      z-index: 100;
      box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
      max-height: 340px;
      display: flex;
      flex-direction: column;
    }
    .gif-picker.hidden { display: none; }
    .gif-picker-header {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
      align-items: center;
    }
    .gif-picker-header input { flex: 1; }
    .gif-grid {
      flex: 1;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 6px;
    }
    .gif-thumb {
      width: 100%;
      aspect-ratio: 4/3;
      object-fit: cover;
      border-radius: 6px;
      cursor: pointer;
      border: 2px solid transparent;
      transition: border-color 0.15s, transform 0.15s;
    }
    .gif-thumb:hover { border-color: var(--orange); transform: scale(1.03); }
    .gif-placeholder {
      grid-column: 1/-1;
      text-align: center;
      padding: 30px;
      color: var(--text-600);
      font-size: 13px;
      font-family: var(--font-mono);
    }
    .gif-powered { font-size: 10px; color: var(--text-600); text-align: right; margin-top: 6px; font-family: var(--font-mono); }
    .gif-msg-img {
      border-radius: 10px;
      max-width: 320px;
      max-height: 280px;
      cursor: zoom-in;
      display: block;
    }

    /* ── Slash Autocomplete ── */
    .cmd-autocomplete {
      position: absolute;
      bottom: 100%;
      left: 12px;
      background: var(--bg-700);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 6px;
      z-index: 101;
      min-width: 260px;
      box-shadow: 0 -6px 24px rgba(0,0,0,0.4);
    }
    .cmd-autocomplete.hidden { display: none; }
    .cmd-suggestion {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      gap: 10px;
    }
    .cmd-suggestion strong { font-family: var(--font-mono); color: var(--orange); font-size: 12px; }
    .cmd-suggestion span { color: var(--text-400); font-size: 11px; font-family: var(--font-mono); }
    .cmd-suggestion:hover, .cmd-suggestion.selected { background: var(--bg-500); }

    /* ── Stats Widget ── */
    .stats-widget {
      background: var(--bg-700);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      min-width: 220px;
      box-shadow: 0 6px 32px rgba(0,0,0,0.5);
      animation: toastIn 0.3s var(--ease, ease) forwards;
    }
    .stats-title { font-size: 12px; color: var(--orange); font-family: var(--font-mono); font-weight: 600; margin-bottom: 10px; text-transform: uppercase; }
    .stats-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
    .stats-row span { color: var(--text-400); }
    .stats-row strong { color: var(--text-100); }

    /* ── Message extras ── */
    .msg-read-time {
      font-size: 10px;
      color: var(--text-600);
      font-family: var(--font-mono);
      margin-left: 8px;
      opacity: 0.7;
    }
    .thread-count {
      display: inline-block;
      margin-top: 4px;
      font-size: 11px;
      color: var(--orange);
      font-family: var(--font-mono);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--orange-dim);
      transition: background 0.15s;
    }
    .thread-count:hover { background: var(--orange-glow); }
    .member-lastseen {
      font-size: 10px;
      color: var(--text-600);
      font-family: var(--font-mono);
      margin-left: 4px;
    }
  `;
  document.head.appendChild(style);
}

// ── Keyboard Shortcut: Ctrl+G for GIF picker ─────────────────
function setupExtrasShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl+G: open GIF search
    if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
      e.preventDefault();
      if (!state.currentChannelId) return;
      if (gifPickerOpen) closeGifPicker();
      else openGifSearch('');
    }
    // Ctrl+Shift+S: channel stats
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      showChannelStats();
    }
  });
}

// ── Update keyboard shortcuts panel in settings ───────────────
function patchShortcutsPanel() {
  const list = document.querySelector('.shortcut-list');
  if (!list || document.getElementById('extras-shortcuts')) return;
  const extras = document.createElement('div');
  extras.id = 'extras-shortcuts';
  extras.innerHTML = `
    <div class="shortcut-row"><kbd>Ctrl+G</kbd><span>GIF picker</span></div>
    <div class="shortcut-row"><kbd>Ctrl+Shift+S</kbd><span>Channel stats</span></div>
    <div class="shortcut-row"><kbd>/</kbd><span>Slash commands</span></div>
  `;
  list.appendChild(extras);
}

// ── Main Export ───────────────────────────────────────────────
export function initExtras() {
  injectStyles();
  setupCommandInterceptor();
  setupCommandAutocomplete();
  setupExtrasShortcuts();

  // Hook setup that needs DOM ready (after initUI / initChat)
  requestAnimationFrame(() => {
    setupInviteButton();
    patchShortcutsPanel();
  });

  // Re-attach invite button when channel changes
  document.addEventListener('click', e => {
    if (e.target.closest('.ch-item') || e.target.closest('.dm-item')) {
      requestAnimationFrame(setupInviteButton);
    }
  });

  console.log('%c🎛 Pulse² Extras loaded', 'color:#FF6B1A;font-weight:bold;font-family:monospace');
}
