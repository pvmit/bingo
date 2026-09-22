// Publiczny config Firebase (bezpieczny do commitowania).
// Uzupelnij po utworzeniu projektu: Console -> Project settings -> Your apps -> Web.
// Realtime Database: utworz baze (np. europe-west1) i wklej databaseURL.
window.FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

window.FIREBASE_READY = Object.values(window.FIREBASE_CONFIG).every(
  (v) => typeof v === "string" && v.length > 0 && !v.includes("REPLACE_ME")
);
