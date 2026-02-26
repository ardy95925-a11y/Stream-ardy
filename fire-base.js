const firebaseConfig = {
apiKey: "AIzaSyCPabeR73HulqHs-wAq_ass1lUxkoEijAY",
  authDomain: "chatin-e7d51.firebaseapp.com",
  projectId: "chatin-e7d51",
  storageBucket: "chatin-e7d51.firebasestorage.app",
  messagingSenderId: "175440428513",
  appId: "1:175440428513:web:c6b365aa7728f0ad5a66a0"
};

// Initialize Firebase (compat SDK — works with the script tags in HTML)
firebase.initializeApp(firebaseConfig);

const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();
