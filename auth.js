// auth.js - Pulse2 Authentication
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./app.js";
import { showToast } from "./ui.js";

export function initAuth() {
  const loginCard    = document.getElementById("login-card");
  const registerCard = document.getElementById("register-card");
  const loginBtn     = document.getElementById("login-btn");
  const registerBtn  = document.getElementById("register-btn");
  const loginError   = document.getElementById("login-error");
  const regError     = document.getElementById("reg-error");

  document.getElementById("go-register").addEventListener("click", () => {
    loginCard.classList.add("hidden");
    registerCard.classList.remove("hidden");
  });
  document.getElementById("go-login").addEventListener("click", () => {
    registerCard.classList.add("hidden");
    loginCard.classList.remove("hidden");
  });

  // LOGIN
  loginBtn.addEventListener("click", async () => {
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    loginError.textContent = "";
    if (!email || !password) { loginError.textContent = "Please fill all fields."; return; }
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in...";
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      loginError.textContent = friendlyError(e.code);
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
  });

  // REGISTER
  registerBtn.addEventListener("click", async () => {
    const name     = document.getElementById("reg-name").value.trim();
    const email    = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    regError.textContent = "";
    if (!name || !email || !password) { regError.textContent = "Please fill all fields."; return; }
    if (password.length < 6) { regError.textContent = "Password must be at least 6 characters."; return; }
    registerBtn.disabled = true;
    registerBtn.textContent = "Creating...";
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      // Store user profile in Firestore
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        displayName: name,
        email: email,
        createdAt: serverTimestamp(),
        status: "online"
      });
      showToast(`Welcome to Pulse2, ${name}!`);
    } catch (e) {
      regError.textContent = friendlyError(e.code);
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = "Create Account";
    }
  });

  // LOGOUT
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    showToast("Signed out. See you around!");
  });

  // Enter key support
  ["login-email", "login-password"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") loginBtn.click();
    });
  });
  ["reg-name", "reg-email", "reg-password"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") registerBtn.click();
    });
  });
}

function friendlyError(code) {
  const map = {
    "auth/invalid-email": "Invalid email address.",
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "Email already registered.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-credential": "Invalid email or password."
  };
  return map[code] || "Something went wrong. Try again.";
}
