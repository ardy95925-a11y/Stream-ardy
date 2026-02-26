// friends.js — Friend requests, friend list, searching users
import {
  collection, query, where, getDocs, doc, getDoc,
  updateDoc, arrayUnion, arrayRemove, onSnapshot, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function initFriends(db, me, toast, openChatWith) {
  const friendsList    = document.getElementById("friends-list");
  const requestsList   = document.getElementById("requests-list");
  const requestsLabel  = document.getElementById("friends-requests");
  const searchInput    = document.getElementById("input-friend-search");
  const addBtn         = document.getElementById("btn-add-friend");

  // ─── Add friend by display name ───
  addBtn.onclick = async () => {
    const name = searchInput.value.trim();
    if (!name) return toast("Enter a display name to search", "error");

    const q = query(collection(db, "users"), where("displayName", "==", name));
    const snap = await getDocs(q);

    if (snap.empty) return toast("User not found", "error");

    const target = snap.docs[0].data();
    if (target.uid === me.uid) return toast("That's you! 👀", "error");

    const meSnap = await getDoc(doc(db, "users", me.uid));
    const meData = meSnap.data();

    if (meData.friends?.includes(target.uid)) return toast("Already friends!", "error");
    if (target.friendRequests?.includes(me.uid)) return toast("Request already sent", "warn");

    await updateDoc(doc(db, "users", target.uid), {
      friendRequests: arrayUnion(me.uid)
    });

    toast(`Friend request sent to ${target.displayName} ✅`);
    searchInput.value = "";
  };

  // ─── Listen to own user doc for friends / requests ───
  onSnapshot(doc(db, "users", me.uid), async snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    me.friends        = data.friends || [];
    me.friendRequests = data.friendRequests || [];

    await renderRequests(data.friendRequests || []);
    await renderFriends(data.friends || []);
    // Refresh chat sidebar
    window.__refreshChats && window.__refreshChats();
  });

  // ─── Render incoming requests ───
  async function renderRequests(uids) {
    requestsList.innerHTML = "";
    requestsLabel.style.display = uids.length ? "block" : "none";

    for (const uid of uids) {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();

      const item = document.createElement("div");
      item.className = "list-item request-item";
      item.innerHTML = `
        <img class="list-avatar" src="${user.photoURL}" alt="${user.displayName}" />
        <span class="list-name">${user.displayName}</span>
        <div class="req-actions">
          <button class="btn-accept" data-uid="${uid}">✓</button>
          <button class="btn-decline" data-uid="${uid}">✗</button>
        </div>
      `;
      requestsList.appendChild(item);

      item.querySelector(".btn-accept").onclick = () => acceptRequest(uid, user);
      item.querySelector(".btn-decline").onclick = () => declineRequest(uid);
    }
  }

  async function acceptRequest(uid, user) {
    await updateDoc(doc(db, "users", me.uid), {
      friends: arrayUnion(uid),
      friendRequests: arrayRemove(uid)
    });
    await updateDoc(doc(db, "users", uid), {
      friends: arrayUnion(me.uid)
    });
    toast(`You and ${user.displayName} are now friends 🎉`);
  }

  async function declineRequest(uid) {
    await updateDoc(doc(db, "users", me.uid), {
      friendRequests: arrayRemove(uid)
    });
    toast("Request declined");
  }

  // ─── Render friends list ───
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
          <img class="list-avatar" src="${user.photoURL}" alt="${user.displayName}" />
          <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
        </div>
        <div class="list-info">
          <span class="list-name">${user.displayName}</span>
          <span class="list-sub">${user.online ? 'Online' : 'Offline'}</span>
        </div>
        <button class="btn-chat" data-uid="${uid}">💬</button>
      `;
      friendsList.appendChild(item);

      item.querySelector(".btn-chat").onclick = () => openChatWith(uid);
      item.addEventListener("dblclick", () => openChatWith(uid));
    }
  }
}
