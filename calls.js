// calls.js — Voice & Video call UI (WebRTC + Firestore signaling)
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot,
  deleteDoc, serverTimestamp, collection, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export function initCalls(db, me, toast) {
  // ── DOM refs ────────────────────────────────
  const overlay        = document.getElementById("call-overlay");
  const peerAvatar     = document.getElementById("call-peer-avatar");
  const peerName       = document.getElementById("call-peer-name");
  const statusText     = document.getElementById("call-status-text");
  const videoArea      = document.getElementById("video-area");
  const localVideo     = document.getElementById("local-video");
  const remoteVideo    = document.getElementById("remote-video");
  const callTimer      = document.getElementById("call-timer");
  const incomingActions = document.getElementById("incoming-actions");
  const muteBtn        = document.getElementById("btn-mute");
  const camBtn         = document.getElementById("btn-cam-toggle");
  const endBtn         = document.getElementById("btn-end-call");
  const acceptBtn      = document.getElementById("btn-accept-call");
  const declineBtn     = document.getElementById("btn-decline-call");
  const voiceCallBtn   = document.getElementById("btn-voice-call");
  const videoCallBtn   = document.getElementById("btn-video-call");

  let pc            = null;   // RTCPeerConnection
  let localStream   = null;
  let callDocRef    = null;
  let unsubCall     = null;
  let timerInterval = null;
  let isMuted       = false;
  let isCamOff      = false;
  let callType      = null;   // "voice" | "video"
  let currentPeerUid = null;

  // ── Hook into chat header buttons ──────────
  voiceCallBtn.onclick = () => startCall("voice");
  videoCallBtn.onclick = () => startCall("video");

  // Keep track of who we're chatting with
  const origOpenChat = window.__openChat;
  window.__openChat = async peerUid => {
    currentPeerUid = peerUid;
    if (origOpenChat) await origOpenChat(peerUid);
  };

  // ── Listen for incoming calls to ME ────────
  onSnapshot(doc(db, "calls", me.uid), async snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status !== "ringing") return;
    if (data.callee !== me.uid)    return;

    // Show incoming call UI
    callType    = data.type;
    callDocRef  = doc(db, "calls", me.uid);

    const callerSnap = await getDoc(doc(db, "users", data.caller));
    const caller     = callerSnap.exists() ? callerSnap.data() : { displayName: "Unknown", photoURL: "" };

    currentPeerUid = data.caller;
    showOverlay(caller, callType === "video");
    statusText.textContent = `Incoming ${callType} call…`;
    incomingActions.classList.remove("hidden");
    endBtn.classList.add("hidden");
    muteBtn.classList.add("hidden");
    camBtn.classList.add("hidden");
  });

  acceptBtn.onclick  = () => answerCall();
  declineBtn.onclick = () => declineCall();

  // ── Start outgoing call ─────────────────────
  async function startCall(type) {
    if (!currentPeerUid) return toast("Open a chat first", "warn");
    callType = type;

    const peerSnap = await getDoc(doc(db, "users", currentPeerUid));
    if (!peerSnap.exists()) return;
    const peer = peerSnap.data();

    // Request media
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video"
      });
    } catch (e) {
      return toast("Camera/microphone access denied", "error");
    }

    pc = buildPC();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (type === "video") localVideo.srcObject = localStream;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Write call doc under callee's uid so they see it
    callDocRef = doc(db, "calls", currentPeerUid);
    await setDoc(callDocRef, {
      caller:    me.uid,
      callee:    currentPeerUid,
      type,
      status:    "ringing",
      offer:     { sdp: offer.sdp, type: offer.type },
      createdAt: serverTimestamp()
    });

    showOverlay(peer, type === "video");
    statusText.textContent = "Calling…";
    incomingActions.classList.add("hidden");
    endBtn.classList.remove("hidden");
    muteBtn.classList.remove("hidden");
    if (type === "video") camBtn.classList.remove("hidden");

    // Listen for answer / ICE from callee
    unsubCall = onSnapshot(callDocRef, async snap => {
      if (!snap.exists()) { hangup(); return; }
      const d = snap.data();

      if (d.status === "answered" && d.answer && pc.signalingState !== "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
        statusText.textContent = "Connected";
        startTimer();
      }

      if (d.status === "ended") hangup();

      // Apply queued ICE candidates from callee
      if (d.iceCandidatesCallee) {
        for (const c of d.iceCandidatesCallee) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
      }
    });

    // Collect our ICE candidates and write them
    pc.onicecandidate = async e => {
      if (e.candidate) {
        const { arrayUnion } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        await updateDoc(callDocRef, {
          iceCandidatesCaller: arrayUnion(e.candidate.toJSON())
        });
      }
    };
  }

  // ── Answer incoming call ────────────────────
  async function answerCall() {
    const snap = await getDoc(callDocRef);
    if (!snap.exists()) return;
    const d = snap.data();

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video"
      });
    } catch (e) {
      return toast("Camera/microphone access denied", "error");
    }

    pc = buildPC();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (callType === "video") localVideo.srcObject = localStream;

    await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await updateDoc(callDocRef, {
      status: "answered",
      answer: { sdp: answer.sdp, type: answer.type }
    });

    incomingActions.classList.add("hidden");
    endBtn.classList.remove("hidden");
    muteBtn.classList.remove("hidden");
    if (callType === "video") camBtn.classList.remove("hidden");
    statusText.textContent = "Connected";
    startTimer();

    // ICE
    pc.onicecandidate = async e => {
      if (e.candidate) {
        const { arrayUnion } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        await updateDoc(callDocRef, {
          iceCandidatesCallee: arrayUnion(e.candidate.toJSON())
        });
      }
    };

    // Apply queued ICE from caller
    if (d.iceCandidatesCaller) {
      for (const c of d.iceCandidatesCaller) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
    }

    unsubCall = onSnapshot(callDocRef, snap => {
      if (!snap.exists() || snap.data().status === "ended") hangup();
    });
  }

  async function declineCall() {
    if (callDocRef) await updateDoc(callDocRef, { status: "ended" }).catch(() => {});
    hideOverlay();
  }

  // ── Build RTCPeerConnection ─────────────────
  function buildPC() {
    const conn = new RTCPeerConnection(ICE_SERVERS);
    conn.ontrack = e => {
      remoteVideo.srcObject = e.streams[0];
    };
    conn.onconnectionstatechange = () => {
      if (["failed","disconnected","closed"].includes(conn.connectionState)) hangup();
    };
    return conn;
  }

  // ── Controls ────────────────────────────────
  muteBtn.onclick = () => {
    isMuted = !isMuted;
    localStream?.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    muteBtn.textContent = isMuted ? "🔇" : "🎙️";
    muteBtn.classList.toggle("active-ctrl", isMuted);
  };

  camBtn.onclick = () => {
    isCamOff = !isCamOff;
    localStream?.getVideoTracks().forEach(t => { t.enabled = !isCamOff; });
    camBtn.textContent = isCamOff ? "🚫📷" : "📷";
    camBtn.classList.toggle("active-ctrl", isCamOff);
  };

  endBtn.onclick = () => hangup(true);

  async function hangup(sendSignal = false) {
    if (sendSignal && callDocRef) {
      await updateDoc(callDocRef, { status: "ended" }).catch(() => {});
    }
    if (unsubCall) { unsubCall(); unsubCall = null; }
    if (pc)          { pc.close(); pc = null; }
    localStream?.getTracks().forEach(t => t.stop());
    localStream   = null;
    localVideo.srcObject  = null;
    remoteVideo.srcObject = null;
    stopTimer();
    hideOverlay();
  }

  // ── Timer ───────────────────────────────────
  let timerSecs = 0;
  function startTimer() {
    timerSecs = 0;
    callTimer.classList.remove("hidden");
    timerInterval = setInterval(() => {
      timerSecs++;
      const m = String(Math.floor(timerSecs / 60)).padStart(2, "0");
      const s = String(timerSecs % 60).padStart(2, "0");
      callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSecs = 0;
    callTimer.textContent = "00:00";
    callTimer.classList.add("hidden");
  }

  // ── Overlay helpers ─────────────────────────
  function showOverlay(peer, withVideo) {
    peerAvatar.src      = peer.photoURL || "";
    peerName.textContent = peer.displayName;
    videoArea.classList.toggle("hidden", !withVideo);
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    incomingActions.classList.add("hidden");
    endBtn.classList.add("hidden");
    muteBtn.classList.add("hidden");
    camBtn.classList.add("hidden");
    callDocRef    = null;
    callType      = null;
    isMuted       = false;
    isCamOff      = false;
    muteBtn.textContent = "🎙️";
    camBtn.textContent  = "📷";
    statusText.textContent = "Calling…";
    stopTimer();
  }
}
