// app.js - Pulse2 Entry Point
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initAuth } from "./auth.js";
import { initChat } from "./chat.js";

const firebaseConfig = {
  apiKey: "AIzaSyCW6Utclu2ME1z1AwUj2xwTm_-it-aWFrI",
  authDomain: "pulse-c5322.firebaseapp.com",
  projectId: "pulse-c5322",
  storageBucket: "pulse-c5322.firebasestorage.app",
  messagingSenderId: "700936968948",
  appId: "1:700936968948:web:abe29f631b258516551ca1",
  measurementId: "G-LPHD13EJQP"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Route between auth and app
const authScreen = document.getElementById("auth-screen");
const appScreen  = document.getElementById("app-screen");

let chatInitialized = false;

onAuthStateChanged(auth, (user) => {
  if (user) {
    authScreen.classList.remove("active");
    appScreen.classList.add("active");
    if (!chatInitialized) {
      chatInitialized = true;
      initChat(user);
    }
  } else {
    appScreen.classList.remove("active");
    authScreen.classList.add("active");
    chatInitialized = false;
  }
});

initAuth();
