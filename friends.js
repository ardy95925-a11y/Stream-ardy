// friends.js — Friend requests, friend list
import {
  collection, query, where, getDocs,
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function initFriends(db, me, toast, openChatWith) {

  const friendsList      = document.getElementById("friends-list");
  const requestsList     = document.getElementById("requests-list");
  const requestsLabel    = document.getElementById("friends-requests-label");
  const searchInput      = document.getElementById("input-friend-search");
  const addBtn           = document.getElementById("btn-add-friend");

  // ── Send friend request ─────────────────────
  addBtn.onclick = async () => {
    const name = searchInput.value.trim();
    if (!name) return toast("Enter a display name to search", "error");

    const q    = query(collection(db, "users"), where("displayName", "==", name));
    const snap = await getDocs(q);

    if (snap.empty) return toast("User not found", "error");

    const target = snap.docs[0].data();
    if (target.uid === me.uid)         return toast("That's you! 👀", "error");
    if (me.friends?.includes(target.uid))
                                       return toast("Already friends!", "warn");
    if (target.friendRequests?.includes(me.uid))
                                       return toast("Request already sent", "warn");

    await updateDoc(doc(db, "users", target.uid), {
      friendRequests: arrayUnion(me.uid)
    });

    toast(`Request sent to ${target.displayName} ✅`);
    searchInput.value = "";
  };

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") addBtn.click();
  });

  // ── Live listener on own user doc ───────────
  onSnapshot(doc(db, "users", me.uid), async snap => {
    if (!snap.exists()) return;
    const data = snap.data();

    // Keep me object in sync
    me.friends        = data.friends        || [];
    me.friendRequests = data.friendRequests || [];

    await renderRequests(me.friendRequests);
    await renderFriends(me.friends);

    // Refresh chat sidebar
    if (window.__refreshChats) window.__refreshChats();
  });

  // ── Render incoming requests ────────────────
  async function renderRequests(uids) {
    requestsList.innerHTML = "";
    const hasReqs = uids.length > 0;
    requestsLabel.style.display  = hasReqs ? "block" : "none";
    requestsList.style.display   = hasReqs ? "block" : "none";

    for (const uid of uids) {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();

      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <img class="list-avatar" src="${user.photoURL}" alt="${escH(user.displayName)}" />
        <span class="list-name">${escH(user.displayName)}</span>
        <div class="req-actions">
          <button class="req-btn accept-req" data-uid="${uid}" title="Accept">✓</button>
          <button class="req-btn decline-req" data-uid="${uid}" title="Decline">✗</button>
        </div>`;
      requestsList.appendChild(item);

      item.querySelector(".accept-req").onclick  = () => acceptRequest(uid, user.displayName);
      item.querySelector(".decline-req").onclick = () => declineRequest(uid);
    }
  }

  async function acceptRequest(uid, displayName) {
    await updateDoc(doc(db, "users", me.uid), {
      friends:       arrayUnion(uid),
      friendRequests: arrayRemove(uid)
    });
    await updateDoc(doc(db, "users", uid), {
      friends: arrayUnion(me.uid)
    });
    toast(`You and ${displayName} are now friends 🎉`);
  }

  async function declineRequest(uid) {
    await updateDoc(doc(db, "users", me.uid), {
      friendRequests: arrayRemove(uid)
    });
    toast("Request declined");
  }

  // ── Render friends list ─────────────────────
  async function renderFriends(uids) {
    friendsList.innerHTML = "";

    if (uids.length === 0) {
      friendsList.innerHTML = `<p class="empty-hint">No friends yet — send a request above!</p>`;
      return;
    }

    for (const uid of uids) {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();

      const item = document.createElement("div");
      item.className = "list-item friend-item";
      item.innerHTML = `
        <div class="avatar-wrap">
          <img class="list-avatar" src="${user.photoURL}" alt="${escH(user.displayName)}" />
          <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
        </div>
        <div class="list-info">
          <span class="list-name">${escH(user.displayName)}</span>
          <span class="list-sub">${user.online ? 'Online' : 'Offline'}</span>
        </div>
        <button class="friend-chat-btn" title="Open chat">💬</button>`;
      friendsList.appendChild(item);

      item.querySelector(".friend-chat-btn").onclick = (e) => {
        e.stopPropagation();
        openChatWith(uid);
      };
      item.ondblclick = () => openChatWith(uid);
    }
  }

  function escH(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
}
