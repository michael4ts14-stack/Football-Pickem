// ============================================================================
// PART 1 SCRIPT: FIREBASE INITIALIZATION (`football-pickem-46206`) + TEAM_LOGS
// ============================================================================
var firebaseConfig = {
  apiKey: "AIzaSyCMEUZaBOSyQt_Bhyi4mN33_fEwMcDi4_A",
  // Sign in through the app's own domain (Firebase Hosting serves /__/auth/handler there).
  // With firebaseapp.com, Safari (iPhone) and Chrome (Android) block the cross-site storage
  // the Google redirect needs, and sign-in silently does nothing.
  authDomain: /^football-pickem-46206\.(web\.app|firebaseapp\.com)$/.test(location.hostname) ? location.hostname : "football-pickem-46206.firebaseapp.com",
  projectId: "football-pickem-46206",
  storageBucket: "football-pickem-46206.firebasestorage.app",
  messagingSenderId: "982061220945",
  appId: "1:982061220945:web:df232bc1c8699a74a3a470",
  measurementId: "G-CT7BX7DLZK"
};

var fbApp = null, fsDb = null, fbAuth = null;
var isApplyingRemoteUpdate = false;

try {
  if (typeof firebase !== "undefined") {
    fbApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    try { fsDb = firebase.firestore(); } catch (e1) {}
    try { if (firebase.auth) fbAuth = firebase.auth(); } catch (e2) {}
  }
} catch (err) {}

// Complete 68-Team Master Database (Strictly Outright W/L & Scores)
