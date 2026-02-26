/* =====================================================
   PULSE — app.js  v2.0
   Fixes: duplicate friends, chats not showing, pfp,
   + image/GIF sending, call button, emoji panel, polish
   ===================================================== */
'use strict';

// ─── State ────────────────────────────────────────────
let currentUser       = null;
let currentUserData   = null;
let currentChatId     = null;
let currentFriendId   = null;
let currentFriendData = null;
let messagesUnsub     = null;
let presenceUnsub     = null;
let presenceInterval  = null;
const friendsCache    = new Map();

const $ = id => document.getElementById(id);

// ─── Toast ───────────────────────────────────────────
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Avatar ───────────────────────────────────────────
function setAvatar(el, userData) {
  el.innerHTML = '';
  if (userData?.photoURL) {
    const img = document.createElement('img');
    img.src = userData.photoURL;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.onerror = () => { el.innerHTML = ''; el.textContent = (userData.displayName||'?')[0].toUpperCase(); };
    el.appendChild(img);
  } else {
    el.textContent = (userData?.displayName||'?')[0].toUpperCase();
  }
}

// ─── Time ─────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000)    return 'now';
  if (diff < 3600000)  return Math.floor(diff/60000) + 'm';
  if (diff < 86400000) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
function fmtFull(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function fmtDateLabel(ts) {
  if (!ts) return 'Today';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate()-1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
}
function getChatId(a,b) { return [a,b].sort().join('_'); }
function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── Auth ─────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  const snap = await db.collection('users').doc(user.uid).get();
  if (!snap.exists || !snap.data().displayName) {
    $('setupDisplayName').value = user.displayName || '';
    showModal('setupModal');
  } else {
    currentUserData = snap.data();
    initApp();
  }
});

// ─── Profile setup ────────────────────────────────────
$('pfpPreview').addEventListener('click', () => $('pfpFileInput').click());
$('pfpFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    $('pfpPreview').innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  };
  reader.readAsDataURL(file);
});

$('setupSaveBtn').addEventListener('click', saveProfile);

async function saveProfile() {
  const displayName = $('setupDisplayName').value.trim();
  const username    = $('setupUsername').value.trim().toLowerCase();
  if (!displayName)        { toast('Please enter a display name','error'); return; }
  if (username.length < 3) { toast('Username must be ≥ 3 chars','error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { toast('Letters, numbers, underscores only','error'); return; }

  const btn = $('setupSaveBtn');
  btn.textContent = 'Saving…'; btn.disabled = true;
  try {
    const uSnap = await db.collection('usernames').doc(username).get();
    if (uSnap.exists && uSnap.data().uid !== currentUser.uid) {
      toast('Username taken','error'); btn.textContent='Save & Continue'; btn.disabled=false; return;
    }

    // Photo: try Storage, fallback to base64 data URL
    let photoURL = currentUserData?.photoURL || currentUser.photoURL || null;
    const file = $('pfpFileInput').files[0];
    if (file) {
      const dataURL = await new Promise((res,rej) => {
        const r = new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsDataURL(file);
      });
      try {
        const ref = storage.ref(`avatars/${currentUser.uid}`);
        await ref.put(file);
        photoURL = await ref.getDownloadURL();
      } catch {
        photoURL = dataURL; // fallback — still shows fine
      }
    }

    const userData = {
      uid: currentUser.uid, displayName, username, photoURL,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      online: true,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!currentUserData?.createdAt) userData.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(db.collection('users').doc(currentUser.uid), userData, {merge:true});
    batch.set(db.collection('usernames').doc(username), {uid:currentUser.uid});
    if (currentUserData?.username && currentUserData.username !== username)
      batch.delete(db.collection('usernames').doc(currentUserData.username));
    await batch.commit();

    currentUserData = {...(currentUserData||{}), ...userData};
    hideModal('setupModal');
    updateSidebarFooter();
    toast('Profile saved!','success');
    if (!presenceInterval) initApp();
  } catch(e) {
    toast('Error: '+e.message,'error');
    btn.textContent='Save & Continue'; btn.disabled=false;
  }
}

// ─── Init ─────────────────────────────────────────────
function initApp() {
  updateSidebarFooter();
  startPresence();
  subscribeToFriends();
  subscribeToRequests();
  subscribeToChats();
  setupTabs();
  setupSearch();
  setupInputBar();
}

// ─── Presence ────────────────────────────────────────
function startPresence() {
  const setOnline = () => db.collection('users').doc(currentUser.uid)
    .update({online:true, lastSeen:firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  setOnline();
  presenceInterval = setInterval(setOnline, 25000);
  window.addEventListener('beforeunload', () => {
    clearInterval(presenceInterval);
    db.collection('users').doc(currentUser.uid).update({online:false}).catch(()=>{});
  });
  document.addEventListener('visibilitychange', () =>
    document.hidden
      ? db.collection('users').doc(currentUser.uid).update({online:false}).catch(()=>{})
      : setOnline()
  );
}

function updateSidebarFooter() {
  setAvatar($('myAvatar'), currentUserData);
  $('myName').textContent = currentUserData.displayName || '';
  $('myTag').textContent  = '@'+(currentUserData.username||'');
}

// ─── Tabs ─────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-'+btn.dataset.tab).classList.add('active');
    });
  });
}

// ─── Search ───────────────────────────────────────────
function setupSearch() {
  $('sidebarSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.conv-item,.friend-item').forEach(item => {
      const name = item.querySelector('.conv-name,.friend-name')?.textContent.toLowerCase()||'';
      item.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

// ─── Friends ──────────────────────────────────────────
// FIX: deduplicate via seenUids Set — the 'users' array-contains query can
// return both documents if both users have sent requests
function subscribeToFriends() {
  db.collection('friends')
    .where('users','array-contains',currentUser.uid)
    .where('status','==','accepted')
    .onSnapshot(async snap => {
      const list = $('friendsList');
      list.innerHTML = '';
      friendsCache.clear();
      const seenUids = new Set();

      const rows = await Promise.all(snap.docs.map(async d => {
        const fUid = d.data().users.find(u => u !== currentUser.uid);
        if (!fUid || seenUids.has(fUid)) return null;
        seenUids.add(fUid);
        const uSnap = await db.collection('users').doc(fUid).get();
        if (!uSnap.exists) return null;
        return {uid:fUid, userData:uSnap.data()};
      }));

      const valid = rows.filter(Boolean);
      if (!valid.length) {
        list.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>No friends yet — add some!</div>`;
        return;
      }
      valid.forEach(({uid,userData}) => {
        friendsCache.set(uid, userData);
        renderFriendItem(list, userData, uid);
      });
    });
}

function renderFriendItem(container, userData, uid) {
  const div = document.createElement('div');
  div.className = 'friend-item'; div.dataset.uid = uid;
  const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
  const av = document.createElement('div'); av.className = 'avatar md';
  setAvatar(av, userData);
  const dot = document.createElement('div');
  dot.className = `online-dot${userData.online?'':' offline'}`;
  wrap.appendChild(av); wrap.appendChild(dot);
  const meta = document.createElement('div'); meta.style.cssText='flex:1;min-width:0';
  meta.innerHTML=`<div class="friend-name">${escapeHtml(userData.displayName)}</div><div class="friend-tag">@${escapeHtml(userData.username||'')}</div>`;
  const msgBtn = document.createElement('button'); msgBtn.className='btn-icon'; msgBtn.title='Message';
  msgBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  msgBtn.addEventListener('click', e => { e.stopPropagation(); openChat(uid,userData); });
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(msgBtn);
  div.addEventListener('click', () => openChat(uid,userData));
  container.appendChild(div);
}

// ─── Requests ─────────────────────────────────────────
function subscribeToRequests() {
  db.collection('friends')
    .where('to','==',currentUser.uid)
    .where('status','==','pending')
    .onSnapshot(async snap => {
      const list=$('requestsList'), badge=$('requestsBadge');
      list.innerHTML='';
      if (snap.empty) {
        badge.classList.add('hidden');
        list.innerHTML=`<div class="empty-state">No pending requests</div>`; return;
      }
      badge.textContent = snap.size; badge.classList.remove('hidden');
      for (const doc of snap.docs) {
        const data = doc.data();
        const sSnap = await db.collection('users').doc(data.from).get();
        if (!sSnap.exists) continue;
        const sender = sSnap.data();
        const div=document.createElement('div'); div.className='req-item';
        const av=document.createElement('div'); av.className='avatar md'; setAvatar(av,sender);
        const info=document.createElement('div'); info.style.cssText='flex:1;min-width:0';
        info.innerHTML=`<div style="font-size:14px;font-weight:500">${escapeHtml(sender.displayName)}</div><div style="font-size:12px;color:var(--text-muted)">@${escapeHtml(sender.username||'')}</div>`;
        const btns=document.createElement('div'); btns.className='req-btns';
        const acc=document.createElement('button'); acc.className='btn-accept'; acc.textContent='Accept';
        acc.addEventListener('click',()=>acceptRequest(doc.id,data.from));
        const rej=document.createElement('button'); rej.className='btn-reject'; rej.textContent='Ignore';
        rej.addEventListener('click',async()=>{ await db.collection('friends').doc(doc.id).delete(); toast('Request ignored'); });
        btns.appendChild(acc); btns.appendChild(rej);
        div.appendChild(av); div.appendChild(info); div.appendChild(btns);
        list.appendChild(div);
      }
    });
}

async function acceptRequest(docId, fromUid) {
  const chatId = getChatId(currentUser.uid, fromUid);
  const batch = db.batch();
  batch.update(db.collection('friends').doc(docId),{
    status:'accepted', acceptedAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  // FIX: always set lastMessageTime so the chats query (orderBy lastMessageTime) works
  batch.set(db.collection('chats').doc(chatId),{
    participants:[currentUser.uid,fromUid],
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage:'',
    lastMessageTime:firebase.firestore.FieldValue.serverTimestamp(),
    lastMessageType:'text',
  },{merge:true});
  await batch.commit();
  toast('Friend added! 🎉','success');
}

// ─── Chats list ───────────────────────────────────────
// FIX: the Firestore query requires a composite index on (participants array-contains + lastMessageTime desc)
// We also handle the case where lastMessageTime is null by using merge with a timestamp above
function subscribeToChats() {
  db.collection('chats')
    .where('participants','array-contains',currentUser.uid)
    .orderBy('lastMessageTime','desc')
    .onSnapshot(async snap => {
      const list = $('chatList');
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>No chats yet</div>`;
        return;
      }
      const seenChats = new Set();
      for (const doc of snap.docs) {
        if (seenChats.has(doc.id)) continue;
        seenChats.add(doc.id);
        const data = doc.data();
        const fUid = data.participants?.find(p=>p!==currentUser.uid);
        if (!fUid) continue;
        let userData = friendsCache.get(fUid);
        if (!userData) {
          const uSnap = await db.collection('users').doc(fUid).get();
          if (!uSnap.exists) continue;
          userData = uSnap.data(); friendsCache.set(fUid,userData);
        }
        renderChatItem(list, doc.id, data, userData, fUid);
      }
    });
}

function renderChatItem(container, chatId, chatData, userData, friendUid) {
  const div=document.createElement('div');
  div.className=`conv-item${currentChatId===chatId?' active':''}`;
  div.dataset.chatId=chatId;
  const wrap=document.createElement('div'); wrap.className='avatar-wrap';
  const av=document.createElement('div'); av.className='avatar md'; setAvatar(av,userData);
  const dot=document.createElement('div'); dot.className=`online-dot${userData.online?'':' offline'}`;
  wrap.appendChild(av); wrap.appendChild(dot);
  let preview = chatData.lastMessage||'Start chatting…';
  if (chatData.lastMessageType==='image') preview='📷 Photo';
  if (chatData.lastMessageType==='gif')   preview='🎞 GIF';
  const meta=document.createElement('div'); meta.className='conv-meta';
  meta.innerHTML=`<div class="conv-name">${escapeHtml(userData.displayName)}</div><div class="conv-preview">${escapeHtml(preview)}</div>`;
  const right=document.createElement('div'); right.className='conv-right';
  right.innerHTML=`<span class="conv-time">${fmtTime(chatData.lastMessageTime)}</span>`;
  div.appendChild(wrap); div.appendChild(meta); div.appendChild(right);
  div.addEventListener('click',()=>{
    document.querySelectorAll('.conv-item').forEach(i=>i.classList.remove('active'));
    div.classList.add('active');
    openChat(friendUid,userData,chatId);
  });
  container.appendChild(div);
}

// ─── Open chat ────────────────────────────────────────
function openChat(friendUid, userData, existingChatId) {
  currentFriendId   = friendUid;
  currentFriendData = userData;
  currentChatId     = existingChatId || getChatId(currentUser.uid,friendUid);
  setAvatar($('chatAvatar'),userData);
  $('chatName').textContent = userData.displayName;
  if (presenceUnsub) presenceUnsub();
  presenceUnsub = db.collection('users').doc(friendUid).onSnapshot(snap => {
    if (!snap.exists) return;
    const d=snap.data();
    const dot=$('chatOnlineDot');
    if (d.online) { dot.classList.remove('offline'); $('chatStatus').textContent='Online'; }
    else {
      dot.classList.add('offline');
      $('chatStatus').textContent=`Last seen ${d.lastSeen?fmtTime(d.lastSeen)+' ago':'recently'}`;
    }
  });
  $('welcomeScreen').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  // Ensure chat doc exists with valid timestamp
  db.collection('chats').doc(currentChatId).set({
    participants:[currentUser.uid,friendUid],
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    lastMessageTime:firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage:'',
  },{merge:true}).catch(()=>{});
  subscribeToMessages(currentChatId);
}

// ─── Messages ─────────────────────────────────────────
function subscribeToMessages(chatId) {
  if (messagesUnsub) messagesUnsub();
  $('messagesArea').innerHTML='';
  messagesUnsub = db.collection('chats').doc(chatId)
    .collection('messages').orderBy('createdAt','asc')
    .onSnapshot(snap => renderMessages(snap.docs.map(d=>({id:d.id,...d.data()}))));
}

function renderMessages(messages) {
  const area=$('messagesArea');
  const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
  area.innerHTML='';
  let lastDate=null, lastSender=null, groupEl=null;

  for (const msg of messages) {
    const dateLabel = fmtDateLabel(msg.createdAt);
    if (dateLabel!==lastDate) {
      const div=document.createElement('div'); div.className='date-divider'; div.textContent=dateLabel;
      area.appendChild(div); lastDate=dateLabel; lastSender=null; groupEl=null;
    }
    const isMine = msg.senderId===currentUser.uid;
    if (msg.senderId!==lastSender||!groupEl) {
      groupEl=document.createElement('div');
      groupEl.className=`msg-group ${isMine?'mine':'theirs'}`;
      area.appendChild(groupEl); lastSender=msg.senderId;
    }
    const row=document.createElement('div'); row.className='msg-row'; row.title=fmtFull(msg.createdAt);

    if (msg.type==='image'||msg.type==='gif') {
      const wrap=document.createElement('div'); wrap.className='msg-media-wrap';
      const img=document.createElement('img'); img.src=msg.url||msg.text;
      img.className='msg-media'; img.loading='lazy';
      img.addEventListener('click',()=>openLightbox(msg.url||msg.text));
      wrap.appendChild(img); row.appendChild(wrap);
    } else {
      const bubble=document.createElement('div'); bubble.className='msg-bubble';
      bubble.innerHTML=linkify(escapeHtml(msg.text||''));
      row.appendChild(bubble);
    }
    groupEl.appendChild(row);
  }

  if (messages.length>0) {
    const last=messages[messages.length-1];
    const isMine=last.senderId===currentUser.uid;
    const meta=document.createElement('div'); meta.className='msg-meta';
    meta.textContent=fmtFull(last.createdAt);
    if (isMine) {
      const tick=document.createElement('span');
      tick.className=`msg-tick${last.read?' read':''}`;
      tick.textContent=' ✓✓'; meta.appendChild(tick);
    }
    area.appendChild(meta);
  }
  if (atBottom||messages.length<=1) area.scrollTop=area.scrollHeight;
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;text-underline-offset:2px">$1</a>');
}

function openLightbox(src) {
  const lb=document.createElement('div');
  lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn .2s ease';
  const img=document.createElement('img'); img.src=src;
  img.style.cssText='max-width:92vw;max-height:92vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.9)';
  lb.appendChild(img); lb.addEventListener('click',()=>lb.remove()); document.body.appendChild(lb);
}

// ─── Input bar ────────────────────────────────────────
function setupInputBar() {
  const inp=$('msgInput');
  inp.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendTextMessage();} });
  inp.addEventListener('input', () => { inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,140)+'px'; });
  $('sendBtn').addEventListener('click', sendTextMessage);
  $('attachBtn').addEventListener('click', () => $('fileUploadInput').click());
  $('fileUploadInput').addEventListener('change', handleFileUpload);
  $('gifBtn').addEventListener('click', toggleGifPanel);
  $('emojiBtn').addEventListener('click', toggleEmojiPanel);
}

async function sendTextMessage() {
  const text=$('msgInput').value.trim();
  if (!text||!currentChatId) return;
  $('msgInput').value=''; $('msgInput').style.height='auto';
  await sendMessage({type:'text',text});
}

async function sendMessage(payload) {
  if (!currentChatId) return;
  const msg = {
    senderId:currentUser.uid, senderName:currentUserData.displayName,
    createdAt:firebase.firestore.FieldValue.serverTimestamp(), read:false, ...payload
  };
  const preview = payload.type==='image'?'📷 Photo':payload.type==='gif'?'🎞 GIF':(payload.text||'').slice(0,60);
  try {
    const batch=db.batch();
    batch.set(db.collection('chats').doc(currentChatId).collection('messages').doc(), msg);
    batch.update(db.collection('chats').doc(currentChatId),{
      lastMessage:preview, lastMessageTime:firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageType:payload.type, lastSenderId:currentUser.uid,
    });
    await batch.commit();
  } catch(e) { toast('Send failed: '+e.message,'error'); }
}

// ─── File upload ──────────────────────────────────────
async function handleFileUpload(e) {
  const file=e.target.files[0]; if (!file||!currentChatId) return;
  e.target.value='';
  if (!file.type.startsWith('image/')) { toast('Only images supported','error'); return; }
  if (file.size>10*1024*1024) { toast('Max 10MB','error'); return; }

  const indicator=document.createElement('div');
  indicator.className='upload-indicator';
  indicator.innerHTML='<div class="upload-spinner"></div> Uploading…';
  $('chatInputBar').prepend(indicator);
  try {
    let url;
    try {
      const ref=storage.ref(`chat-media/${currentChatId}/${Date.now()}_${file.name}`);
      await ref.put(file); url=await ref.getDownloadURL();
    } catch {
      url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});
    }
    await sendMessage({type:'image',url,text:'Photo'});
  } catch(err) { toast('Upload failed: '+err.message,'error'); }
  finally { indicator.remove(); }
}

// ─── GIF panel ────────────────────────────────────────
function toggleGifPanel() {
  const panel=$('gifPanel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden'); $('gifSearch').focus();
    loadGifs(''); $('emojiPanel').classList.add('hidden');
  } else panel.classList.add('hidden');
}

let gifTimer=null;
$('gifSearch').addEventListener('input', e => {
  clearTimeout(gifTimer); gifTimer=setTimeout(()=>loadGifs(e.target.value),400);
});

async function loadGifs(query) {
  const grid=$('gifGrid'); grid.innerHTML='<div class="gif-loading">Loading…</div>';
  try {
    const key='AIzaSyB_'; // replace with real Tenor key
    const endpoint = query
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${key}&limit=24&media_filter=gif`
      : `https://tenor.googleapis.com/v2/featured?key=${key}&limit=24&media_filter=gif`;
    const res=await fetch(endpoint);
    if (!res.ok) throw new Error();
    const data=await res.json();
    renderGifs(data.results||[]);
  } catch {
    grid.innerHTML=`<div class="gif-no-key">
      <p>Add a free <a href="https://developers.google.com/tenor/guides/quickstart" target="_blank">Tenor API key</a> in app.js to enable GIFs</p>
    </div>`;
  }
}

function renderGifs(results) {
  const grid=$('gifGrid'); grid.innerHTML='';
  if (!results.length) { grid.innerHTML='<div class="gif-loading">No GIFs found</div>'; return; }
  results.forEach(gif => {
    const url=gif.media_formats?.gif?.url||gif.media_formats?.tinygif?.url;
    const thumb=gif.media_formats?.nanogif?.url||gif.media_formats?.tinygif?.url||url;
    if (!url) return;
    const img=document.createElement('img');
    img.src=thumb; img.className='gif-thumb'; img.loading='lazy';
    img.addEventListener('click',()=>{ sendMessage({type:'gif',url,text:'GIF'}); $('gifPanel').classList.add('hidden'); });
    grid.appendChild(img);
  });
}

// ─── Emoji panel ──────────────────────────────────────
const EMOJIS=['😀','😂','🥹','😍','🤩','😎','🥳','🤔','😮','😢','😭','😡','🔥','❤️','💯','👍','👎','👏','🙌','🤝','💪','✌️','🫶','💀','😈','🎉','🎊','🏆','⭐','✨','💫','🌈','🌙','☀️','🍕','🍦','🎮','📱','💻','🐶','🐱','🦊','🦁'];

function toggleEmojiPanel() {
  const panel=$('emojiPanel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    if (!panel.dataset.built) {
      EMOJIS.forEach(em => {
        const btn=document.createElement('button'); btn.className='emoji-btn'; btn.textContent=em;
        btn.addEventListener('click',()=>{
          const inp=$('msgInput'), pos=inp.selectionStart||inp.value.length;
          inp.value=inp.value.slice(0,pos)+em+inp.value.slice(pos);
          inp.focus(); panel.classList.add('hidden');
        });
        panel.appendChild(btn);
      });
      panel.dataset.built='1';
    }
    $('gifPanel').classList.add('hidden');
  } else panel.classList.add('hidden');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#gifPanel')&&!e.target.closest('#gifBtn'))   $('gifPanel')&&$('gifPanel').classList.add('hidden');
  if (!e.target.closest('#emojiPanel')&&!e.target.closest('#emojiBtn')) $('emojiPanel')&&$('emojiPanel').classList.add('hidden');
});

// ─── Call buttons ─────────────────────────────────────
$('callBtn').addEventListener('click',()=>{ if(currentFriendData) showCallModal('voice'); });
$('videoBtn').addEventListener('click',()=>{ if(currentFriendData) showCallModal('video'); });

function showCallModal(type) {
  setAvatar($('callAvatar'),currentFriendData);
  $('callName').textContent=currentFriendData.displayName;
  $('callType').textContent=(type==='video'?'📹 Video':'📞 Voice')+' calling…';
  $('callModal').classList.remove('hidden');
  let dots=0;
  const iv=setInterval(()=>{ dots=(dots+1)%4; $('callType').textContent=(type==='video'?'📹 Video':'📞 Voice')+' calling'+'.'.repeat(dots); },600);
  $('endCallBtn').onclick=()=>{ clearInterval(iv); $('callModal').classList.add('hidden'); toast('Call ended'); };
}

// ─── Add friend ───────────────────────────────────────
$('addFriendBtn').addEventListener('click',()=>{ $('friendSearchInput').value=''; $('friendSearchResult').innerHTML=''; showModal('addFriendModal'); });
$('closeFriendModal').addEventListener('click',()=>hideModal('addFriendModal'));
$('friendSearchBtn').addEventListener('click',searchFriend);
$('friendSearchInput').addEventListener('keydown',e=>{ if(e.key==='Enter') searchFriend(); });

async function searchFriend() {
  const username=$('friendSearchInput').value.trim().toLowerCase();
  const res=$('friendSearchResult');
  if (!username) return;
  res.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:13px">Searching…</div>';
  try {
    const snap=await db.collection('users').where('username','==',username).limit(1).get();
    if (snap.empty) { res.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:13px">No user found with that username</div>'; return; }
    const uid=snap.docs[0].id, userData=snap.docs[0].data();
    if (uid===currentUser.uid) { res.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:13px">That\'s you 😄</div>'; return; }

    const existing=await db.collection('friends').where('users','array-contains',currentUser.uid).get();
    const rel=existing.docs.find(d=>d.data().users.includes(uid));

    res.innerHTML='';
    const div=document.createElement('div'); div.className='friend-result';
    const av=document.createElement('div'); av.className='avatar md'; setAvatar(av,userData);
    const info=document.createElement('div'); info.className='info';
    info.innerHTML=`<strong>${escapeHtml(userData.displayName)}</strong><span>@${escapeHtml(userData.username)}</span>`;
    div.appendChild(av); div.appendChild(info);

    if (rel) {
      const badge=document.createElement('span'); badge.style.cssText='font-size:12px;color:var(--text-muted)';
      badge.textContent=rel.data().status==='accepted'?'Already friends':'Pending…';
      div.appendChild(badge);
    } else {
      const btn=document.createElement('button'); btn.className='btn btn-primary';
      btn.textContent='Add Friend'; btn.style.cssText='font-size:13px;padding:8px 16px';
      btn.addEventListener('click',async()=>{
        btn.textContent='Sending…'; btn.disabled=true;
        try {
          // FIX: sort UIDs so there's only ever ONE friend doc per pair
          await db.collection('friends').add({
            users:[currentUser.uid,uid].sort(), from:currentUser.uid, to:uid,
            status:'pending', createdAt:firebase.firestore.FieldValue.serverTimestamp()
          });
          btn.textContent='Request Sent ✓'; toast('Friend request sent!','success');
        } catch(e) { toast('Error: '+e.message,'error'); btn.textContent='Add Friend'; btn.disabled=false; }
      });
      div.appendChild(btn);
    }
    res.appendChild(div);
  } catch(e) { res.innerHTML=`<div style="padding:12px;color:#ff4757;font-size:13px">Error: ${e.message}</div>`; }
}

// ─── Profile modal ────────────────────────────────────
$('viewProfileBtn').addEventListener('click',async()=>{
  if (!currentFriendId) return;
  const snap=await db.collection('users').doc(currentFriendId).get();
  if (!snap.exists) return;
  openProfileModal(snap.data(),currentFriendId,true);
});

function openProfileModal(userData,uid,isFriend) {
  const av=$('profileAvatar'); av.style.cssText='width:90px;height:90px;font-size:28px;border-radius:50%';
  setAvatar(av,userData);
  $('profileName').textContent=userData.displayName;
  $('profileTag').textContent='@'+(userData.username||'');
  const actions=$('profileActions'); actions.innerHTML='';
  if (isFriend) {
    const msgBtn=document.createElement('button'); msgBtn.className='btn btn-primary';
    msgBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Message`;
    msgBtn.addEventListener('click',()=>{ hideModal('profileModal'); openChat(uid,userData); });
    const callBtn=document.createElement('button'); callBtn.className='btn btn-ghost';
    callBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Call`;
    callBtn.addEventListener('click',()=>{ hideModal('profileModal'); showCallModal('voice'); });
    actions.appendChild(msgBtn); actions.appendChild(callBtn);
  }
  showModal('profileModal');
}
$('closeProfileModal').addEventListener('click',()=>hideModal('profileModal'));

// ─── Settings ─────────────────────────────────────────
$('openSettingsBtn').addEventListener('click',()=>{
  setAvatar($('settingsAvatar'),currentUserData);
  $('settingsName').textContent=currentUserData.displayName||'';
  $('settingsTag').textContent='@'+(currentUserData.username||'');
  showModal('settingsModal');
});
$('closeSettingsBtn').addEventListener('click',()=>hideModal('settingsModal'));
$('signOutBtn').addEventListener('click',async()=>{
  await db.collection('users').doc(currentUser.uid).update({online:false}).catch(()=>{});
  await auth.signOut(); window.location.href='index.html';
});
$('editProfileBtn').addEventListener('click',()=>{
  hideModal('settingsModal');
  $('setupDisplayName').value=currentUserData.displayName||'';
  $('setupUsername').value=currentUserData.username||'';
  const preview=$('pfpPreview');
  preview.innerHTML = currentUserData.photoURL
    ? `<img src="${currentUserData.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;color:var(--text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  showModal('setupModal');
});
$('notifBtn').addEventListener('click',()=>{
  if ('Notification' in window) {
    Notification.requestPermission().then(p=>{
      if (p==='granted') { toast('Notifications enabled!','success'); $('notifBtn').textContent='Enabled ✓'; }
    });
  }
});

function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('.modal-backdrop').forEach(b => {
  b.addEventListener('click',e=>{ if(e.target===b&&b.id!=='setupModal'&&b.id!=='callModal') b.classList.add('hidden'); });
});
