// ============================================================================
// V16.4 GOOGLE SIGN-IN + EMAIL/PASSWORD AUTH & ISOLATED INSTANCE ENGINE
// Supports ~6 users today and scales to 80+ users next season.
// Locks each authenticated user into their own profile instance so no one can
// switch or overwrite your profile on your screen while syncing all picks live!
// ============================================================================
var AUTH_SESSION = null; // { uid, email, displayName, provider, boundProfileKey, linkedMemberName, instanceLocked, adminUnlock }
var AUTH_MODAL_MODE = "signin"; // "signin" | "signup"

function loadDeviceAuthSession() {
  var raw = safeGetStorage("sat_auth_session_v16");
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.boundProfileKey) {
        AUTH_SESSION = parsed;
      }
    } catch (e) {}
  }
  // Restore per-device compareTargetKey & Test Sim so another user's cloud sync never alters your screen view
  var savedCmp = safeGetStorage("sat_device_compare_target_v16");
  if (savedCmp) state.compareTargetKey = savedCmp;
  var savedTest = safeGetStorage("sat_device_test_sim_v16");
  if (savedTest) {
    try {
      var parsedTest = JSON.parse(savedTest);
      if (parsedTest && parsedTest.picks) state.test = parsedTest;
    } catch (e2) {}
  }
  var savedAct = safeGetStorage("sat_device_active_profile_v16");
  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey && AUTH_SESSION.instanceLocked !== false && !AUTH_SESSION.adminUnlock) {
    // Keep user on their bound profile (or their personal Test Sim sandbox)
    if (savedAct === "test") activeProfile = "test";
    else activeProfile = AUTH_SESSION.boundProfileKey;
    SESSION_UNLOCKED_PROFILES[AUTH_SESSION.boundProfileKey] = true;
  } else if (savedAct && (savedAct === "michael" || savedAct === "kinyion" || savedAct === "test" || state[savedAct])) {
    activeProfile = savedAct;
  }
}

function saveDeviceAuthSession() {
  if (AUTH_SESSION) {
    safeSetStorage("sat_auth_session_v16", JSON.stringify(AUTH_SESSION));
  } else {
    safeSetStorage("sat_auth_session_v16", "");
  }
  safeSetStorage("sat_device_active_profile_v16", activeProfile);
  if (state.compareTargetKey) {
    safeSetStorage("sat_device_compare_target_v16", state.compareTargetKey);
  }
}

function isAccountInstanceLocked() {
  return !!(AUTH_SESSION && AUTH_SESSION.boundProfileKey && AUTH_SESSION.instanceLocked !== false && !AUTH_SESSION.adminUnlock);
}

function canEditProfileInCurrentInstance(profKey) {
  if (!isAccountInstanceLocked()) return true;
  return (profKey === AUTH_SESSION.boundProfileKey || profKey === "test");
}

async function sha256Hex(str) {
  try {
    if (window.crypto && window.crypto.subtle) {
      var buf = new TextEncoder().encode(String(str || ""));
      var hashBuf = await window.crypto.subtle.digest("SHA-256", buf);
      var hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
  } catch (e) {}
  // Fallback deterministic hash if subtle crypto unavailable
  var h = 2166136261;
  var s = String(str || "");
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return "fnv_" + (h >>> 0).toString(16);
}

function resolveOrCreateProfileForMember(memberName, displayNameFallback, ownerUid, emailStr) {
  ensureMultiUserAndPrivacyState();
  var cleanMember = standardizeParticipantName(memberName || displayNameFallback || "Player");
  var lowMember = cleanMember.toLowerCase();

  if (lowMember === "michael a" || lowMember === "michael") {
    state.michael.linkedMemberName = "Michael A";
    return { profileKey: "michael", linkedMemberName: "Michael A", displayName: "Michael A" };
  }
  if (lowMember === "kinyion c" || lowMember === "kinyion") {
    state.kinyion.linkedMemberName = "Kinyion C";
    return { profileKey: "kinyion", linkedMemberName: "Kinyion C", displayName: "Kinyion C" };
  }

  // Check if a custom profile already exists for this leaderboard member or uid
  var existingPf = getProfileLinkedToMemberName(cleanMember);
  if (existingPf && !existingPf.isSandbox) {
    return { profileKey: existingPf.key, linkedMemberName: existingPf.linkedMemberName || cleanMember, displayName: existingPf.name };
  }

  // Create a deterministic profile key for this participant so it stays consistent across all devices (supports 80+ users!)
  var slug = cleanMember.toLowerCase().replace(/[^a-z0-9]/g, "");
  var detKey = "u_" + (slug || "user");
  var pm = findPoolMemberByName(cleanMember);
  var lb = findLeaderboardEntryByName(cleanMember);
  var priorPts = lb ? (parseFloat(lb.priorPts) || 0) : (pm ? (parseFloat(pm.priorPts) || 0) : 0);
  var rankStr = (lb && lb.rank) ? lb.rank : ((pm && pm.priorRank) ? pm.priorRank : "Linked");

  var isDeletedMember = !!((state.deletedPicksByMember && state.deletedPicksByMember[lowMember]) || (pm && pm._picksCleared) || (state[detKey] && state[detKey]._picksCleared));
  var initialPicks = {};
  var hasSheet = !isDeletedMember && pm && !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES);
  if (hasSheet) {
    for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
      var gm = GAMES[gIdx];
      var pVal = pm.picks[gm.id] || pm.picks[String(gm.id)];
      if (pVal) initialPicks[gm.id] = pVal;
    }
  }

  var palette = ["#10b981", "#f43f5e", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
  var colorPick = palette[slug.length % palette.length];

  var alreadyInCu = false;
  for (var c = 0; c < state.customUsers.length; c++) {
    if (state.customUsers[c].key === detKey) {
      alreadyInCu = true;
      state.customUsers[c].linkedMemberName = cleanMember;
      if (ownerUid) state.customUsers[c].ownerUid = ownerUid;
      if (emailStr) state.customUsers[c].email = emailStr;
      break;
    }
  }
  if (!alreadyInCu) {
    state.customUsers.push({
      key: detKey,
      name: cleanMember,
      linkedMemberName: cleanMember,
      priorPts: priorPts,
      rank: rankStr,
      color: colorPick,
      ownerUid: ownerUid || "",
      email: emailStr || ""
    });
  }

  if (!state[detKey]) {
    state[detKey] = {
      picks: initialPicks,
      _picksCleared: isDeletedMember,
      tiebreaker: (pm && pm.tiebreaker && pm.tiebreaker !== "—") ? pm.tiebreaker : "28-24",
      target: 20,
      linkedMemberName: cleanMember
    };
  } else if (isDeletedMember) {
    state[detKey].picks = {};
    state[detKey]._picksCleared = true;
  } else if ((!state[detKey].picks || Object.keys(state[detKey].picks).length === 0) && hasSheet) {
    state[detKey].picks = initialPicks;
  }
  if (!state.profilePrivacy[detKey]) {
    state.profilePrivacy[detKey] = {
      hidden: false,
      pin: "",
      revealAtKickoff: true,
      autoUnhideOnSheet: true,
      autoUnhideFridayNight: true
    };
  }
  return { profileKey: detKey, linkedMemberName: cleanMember, displayName: cleanMember };
}

async function bindAuthenticatedAccountToProfile(authUser, chosenMemberName) {
  var email = String(authUser.email || "").trim().toLowerCase();
  var uid = authUser.uid || ("acct_" + email.replace(/[^a-z0-9]/g, "_"));
  var dispName = authUser.displayName || chosenMemberName || email.split("@")[0] || "Player";

  // Check if this account already has a saved profile binding in Cloud Firestore (`pickem_v14_accounts/{uid}`)
  var acctDoc = null;
  var emailDocKey = "email_" + email.replace(/[^a-z0-9]/g, "_");
  if (fsDb && email) {
    try {
      var snap = await fsDb.collection("pickem_v14_accounts").doc(emailDocKey).get();
      if (snap && snap.exists) acctDoc = snap.data();
    } catch (e) {}
  }

  var targetMember = chosenMemberName || (acctDoc && acctDoc.linkedMemberName) || "";
  if (!targetMember) {
    // Try auto-matching displayName or email prefix to the 89-player leaderboard
    var matchLb = findLeaderboardEntryByName(dispName) || findPoolMemberByName(dispName);
    if (matchLb) {
      targetMember = matchLb.name;
    } else if (email.indexOf("michael") !== -1) {
      targetMember = "Michael A";
    } else if (email.indexOf("kinyion") !== -1 || email.indexOf("kenyon") !== -1) {
      targetMember = "Kinyion C";
    } else {
      targetMember = dispName;
    }
  }

  var resolved = resolveOrCreateProfileForMember(targetMember, dispName, uid, email);
  var bKey = resolved.profileKey;

  // Pull latest per-user picks from `pickem_v14_users/{bKey}` if present
  if (fsDb) {
    try {
      var uSnap = await fsDb.collection("pickem_v14_users").doc(bKey).get();
      if (uSnap && uSnap.exists) {
        var uData = uSnap.data();
        if (uData && uData.picks && hasSubmittedPicksForCurrentSlate(uData.picks, GAMES)) {
          state[bKey] = Object.assign({}, state[bKey] || {}, {
            picks: uData.picks,
            tiebreaker: uData.tiebreaker || "28-24",
            target: uData.target || 20,
            linkedMemberName: resolved.linkedMemberName
          });
        }
      }
    } catch (eU) {}
  }

  var prevEntries = (AUTH_SESSION && AUTH_SESSION.email === email && Array.isArray(AUTH_SESSION.linkedEntries)) ? AUTH_SESSION.linkedEntries.slice() : [];
  if (acctDoc && Array.isArray(acctDoc.linkedEntries)) {
    for (var leIdx = 0; leIdx < acctDoc.linkedEntries.length; leIdx++) {
      var candLe = acctDoc.linkedEntries[leIdx];
      if (candLe && candLe.profileKey && !prevEntries.some(function(x) { return x.profileKey === candLe.profileKey; })) {
        prevEntries.push(candLe);
      }
    }
  }
  if (!prevEntries.some(function(x) { return x.profileKey === bKey; })) {
    prevEntries.push({
      profileKey: bKey,
      memberName: resolved.linkedMemberName,
      label: "Entry #" + (prevEntries.length + 1) + ": " + resolved.linkedMemberName
    });
  }

  AUTH_SESSION = {
    uid: uid,
    email: email,
    displayName: resolved.displayName,
    provider: authUser.provider || "email",
    boundProfileKey: bKey,
    linkedMemberName: resolved.linkedMemberName,
    linkedEntries: prevEntries,
    isCommissioner: !!(authUser.isCommissioner || (acctDoc && acctDoc.isCommissioner)),
    instanceLocked: true,
    adminUnlock: false,
    signedInAt: new Date().toISOString()
  };

  if (fsDb && email) {
    try {
      var saveAcct = {
        uid: uid,
        email: email,
        displayName: resolved.displayName,
        provider: AUTH_SESSION.provider,
        boundProfileKey: bKey,
        linkedMemberName: resolved.linkedMemberName,
        linkedEntries: AUTH_SESSION.linkedEntries || [],
        updatedAt: new Date().toISOString()
      };
      if (authUser.passwordHash) saveAcct.passwordHash = authUser.passwordHash;
      await fsDb.collection("pickem_v14_accounts").doc(emailDocKey).set(saveAcct, { merge: true });
    } catch (eSave) {}
  }

  SESSION_UNLOCKED_PROFILES[bKey] = true;
  activeProfile = bKey;
  if (state.compareTargetKey === bKey) {
    state.compareTargetKey = (bKey === "michael") ? "kinyion" : "michael";
  }

  saveDeviceAuthSession();
  regradeAllPoolMembersLive();
  pushMultiUserAndPrivacyToFirebase();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
}

function initFirebaseAuthObserver() {
  if (!fbAuth) return;
  try {
    // Handle return from mobile Google OAuth Redirect (`signInWithRedirect`)
    fbAuth.getRedirectResult().then(function(res) {
      if (res && res.user) {
        var pendingMember = safeGetStorage("sat_pending_oauth_member_v16") || "";
        bindAuthenticatedAccountToProfile({
          uid: res.user.uid,
          email: res.user.email,
          displayName: res.user.displayName,
          provider: "google_oauth_redirect"
        }, pendingMember).then(function() {
          showAppToast("✅ Signed in with Google as " + (AUTH_SESSION ? AUTH_SESSION.displayName : "User") + "!");
        });
      }
    }).catch(function() {});

    // Automatically restore Firebase Auth session if signed in via Google or Email/Password
    fbAuth.onAuthStateChanged(function(user) {
      if (user && (!AUTH_SESSION || AUTH_SESSION.uid !== user.uid)) {
        var savedMember = (AUTH_SESSION && AUTH_SESSION.linkedMemberName) || safeGetStorage("sat_pending_oauth_member_v16") || "";
        bindAuthenticatedAccountToProfile({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || "firebase_auth"
        }, savedMember);
      }
    });
  } catch (e) {}
}

async function signInWithGoogleAccount(useRedirect) {
  var errEl = document.getElementById("auth-modal-error");
  var linkSel = document.getElementById("auth-link-member-select");
  var nameInput = document.getElementById("auth-name-input");
  var customName = nameInput ? String(nameInput.value || "").trim() : "";
  var chosenMember = linkSel ? String(linkSel.value || "").trim() : "";
  if (chosenMember === "__NEW_USER__") chosenMember = "";
  if (chosenMember === "__NEW_USER__") chosenMember = "";
  var preferredName = chosenMember || customName;
  if (preferredName) safeSetStorage("sat_pending_oauth_member_v16", preferredName);

  if (errEl) {
    errEl.style.color = "#38bdf8";
    errEl.textContent = useRedirect ? "↻ Redirecting to Google Sign-In..." : "↻ Opening Google Sign-In...";
  }

  if (fbAuth && typeof firebase.auth.GoogleAuthProvider === "function") {
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (useRedirect) {
        await fbAuth.signInWithRedirect(provider);
        return;
      }
      var res = await fbAuth.signInWithPopup(provider);
      if (res && res.user) {
        await bindAuthenticatedAccountToProfile({
          uid: res.user.uid,
          email: res.user.email,
          displayName: customName || res.user.displayName,
          provider: "google_oauth"
        }, preferredName);
        closeAuthModal();
        showAppToast("✅ Signed in with Google as " + AUTH_SESSION.displayName + " (Instance Locked)!");
        return;
      }
    } catch (err) {
      var code = (err && err.code) ? String(err.code) : "";
      if (code === "auth/popup-blocked") {
        // Automatically fall back to redirect if browser blocked the popup
        try {
          var redirProv = new firebase.auth.GoogleAuthProvider();
          await fbAuth.signInWithRedirect(redirProv);
          return;
        } catch (eRedir) {}
      }
      if (code === "auth/popup-closed-by-user") {
        if (errEl) {
          errEl.style.color = "#f87171";
          errEl.textContent = "Google Sign-In popup was closed before completing.";
        }
        return;
      }
      var emailInput = document.getElementById("auth-email-input");
      var googleEmail = emailInput ? String(emailInput.value || "").trim().toLowerCase() : "";
      if (!googleEmail || googleEmail.indexOf("@") === -1) {
        if (errEl) {
          errEl.style.color = "#fde68a";
          errEl.innerHTML = "ℹ️ <strong>Firebase OAuth Setup Note (" + (code || "Provider Not Enabled Yet") + "):</strong><br>" +
            "1. Open <a href='https://console.firebase.google.com/project/football-pickem-46206/authentication/providers' target='_blank' style='color:#38bdf8;text-decoration:underline;'>Firebase Console → Authentication → Sign-in method</a> and enable <strong>Google</strong> & <strong>Email/Password</strong>.<br>" +
            "2. Under <strong>Authentication → Settings → Authorized domains</strong>, add your hosting domain (e.g., Netlify/GitHub Pages).<br>" +
            "👉 <strong>Works Right Now:</strong> Type your email & password below and click <strong>Sign In / Create Account</strong> (or click Google Sign-In again with your email filled in) to authenticate immediately via the Cloud Firestore Vault!";
        }
        if (emailInput) emailInput.focus();
        return;
      }
      await bindAuthenticatedAccountToProfile({
        uid: "google_" + googleEmail.replace(/[^a-z0-9]/g, "_"),
        email: googleEmail,
        displayName: preferredName || googleEmail.split("@")[0],
        provider: "google_firestore"
      }, preferredName);
      closeAuthModal();
      showAppToast("✅ Signed in with Google (" + googleEmail + ") as " + AUTH_SESSION.displayName + "!");
      return;
    }
  }
}

async function submitEmailPasswordAuth(modeOverride) {
  var mode = modeOverride || AUTH_MODAL_MODE || "signin";
  var emailEl = document.getElementById("auth-email-input");
  var passEl = document.getElementById("auth-password-input");
  var nameEl = document.getElementById("auth-name-input");
  var linkSel = document.getElementById("auth-link-member-select");
  var errEl = document.getElementById("auth-modal-error");

  var email = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";
  var password = passEl ? String(passEl.value || "") : "";
  var customName = nameEl ? String(nameEl.value || "").trim() : "";
  var chosenMember = linkSel ? String(linkSel.value || "").trim() : "";
  if (chosenMember === "__NEW_USER__") chosenMember = "";

  if (!email || email.indexOf("@") === -1) {
    if (errEl) { errEl.style.color = "#f87171"; errEl.textContent = "⚠️ Please enter a valid email address."; }
    if (emailEl) emailEl.focus();
    return;
  }
  if (!password || password.length < 4) {
    if (errEl) { errEl.style.color = "#f87171"; errEl.textContent = "⚠️ Please enter a password (at least 4 characters; 6+ for Firebase Auth)."; }
    if (passEl) passEl.focus();
    return;
  }

  if (errEl) {
    errEl.style.color = "#38bdf8";
    errEl.textContent = mode === "signup" ? "↻ Creating your account & isolated instance..." : "↻ Signing in to your instance...";
  }

  var passHash = await sha256Hex(email + "::" + password);
  var emailDocKey = "email_" + email.replace(/[^a-z0-9]/g, "_");

  // 1. Try Official Firebase Authentication (Email/Password) first
  if (fbAuth && password.length >= 6) {
    try {
      var cred = null;
      if (mode === "signup") {
        cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        if (cred && cred.user && (customName || chosenMember)) {
          try { await cred.user.updateProfile({ displayName: chosenMember || customName }); } catch (eProf) {}
        }
      } else {
        cred = await fbAuth.signInWithEmailAndPassword(email, password);
      }
      if (cred && cred.user) {
        await bindAuthenticatedAccountToProfile({
          uid: cred.user.uid,
          email: cred.user.email || email,
          displayName: cred.user.displayName || chosenMember || customName,
          provider: "firebase_email",
          passwordHash: passHash
        }, chosenMember || customName);
        closeAuthModal();
        showAppToast("🔐 Signed in as " + AUTH_SESSION.displayName + " (Instance Locked)!");
        return;
      }
    } catch (fbErr) {
      var c = (fbErr && fbErr.code) ? String(fbErr.code) : "";
      if (c === "auth/wrong-password" || c === "auth/invalid-login-credentials") {
        if (errEl) { errEl.style.color = "#f87171"; errEl.textContent = "❌ Incorrect email or password."; }
        return;
      }
      if (c === "auth/email-already-in-use" && mode === "signup") {
        // Automatically attempt sign-in with those credentials
        try {
          var signCred = await fbAuth.signInWithEmailAndPassword(email, password);
          if (signCred && signCred.user) {
            await bindAuthenticatedAccountToProfile({
              uid: signCred.user.uid,
              email: email,
              displayName: signCred.user.displayName || chosenMember || customName,
              provider: "firebase_email",
              passwordHash: passHash
            }, chosenMember || customName);
            closeAuthModal();
            showAppToast("🔐 Signed in as " + AUTH_SESSION.displayName + "!");
            return;
          }
        } catch (e2) {
          if (errEl) { errEl.style.color = "#f87171"; errEl.textContent = "❌ Account already exists with a different password."; }
          return;
        }
      }
      // If Email/Password provider isn't enabled yet in Firebase Console (`auth/operation-not-allowed` / `auth/configuration-not-found`),
      // seamlessly fall through to the Cloud Firestore Account Vault (`pickem_v14_accounts`)!
    }
  }

  // 2. Cloud Firestore Account Vault (`pickem_v14_accounts/{emailDocKey}`) — Works 100% out-of-the-box!
  if (fsDb) {
    try {
      var snap = await fsDb.collection("pickem_v14_accounts").doc(emailDocKey).get();
      if (snap && snap.exists) {
        var existingAcct = snap.data();
        var isResettingVaultPass = (window._pendingVaultPasswordResetEmail === email);
        var verifyTarget = standardizeParticipantName(chosenMember || customName || "").toLowerCase();
        var acctLinked = standardizeParticipantName(existingAcct.linkedMemberName || existingAcct.displayName || "").toLowerCase();
        var verifiedForReset = isResettingVaultPass && (!acctLinked || (verifyTarget && verifyTarget === acctLinked));

        if (existingAcct.passwordHash && existingAcct.passwordHash !== passHash && !verifiedForReset) {
          if (errEl) {
            errEl.style.color = "#f87171";
            if (isResettingVaultPass && acctLinked) {
              errEl.textContent = "⚠️ To finish resetting password for " + email + ", select '" + (existingAcct.linkedMemberName || existingAcct.displayName) + "' in Step 1 above to verify your identity, then click Sign In.";
            } else {
              errEl.textContent = "❌ Incorrect password for " + email + ". Click 'Forgot Password?' below to reset.";
            }
          }
          return;
        }
        window._pendingVaultPasswordResetEmail = null;
        await bindAuthenticatedAccountToProfile({
          uid: existingAcct.uid || emailDocKey,
          email: email,
          displayName: existingAcct.displayName || chosenMember || customName,
          provider: "firestore_email",
          passwordHash: passHash
        }, chosenMember || existingAcct.linkedMemberName || customName);
        closeAuthModal();
        showAppToast(verifiedForReset ? ("✅ Password updated & signed in as " + AUTH_SESSION.displayName + "!") : ("🔐 Signed in as " + AUTH_SESSION.displayName + " (Instance Locked)!"));
        return;
      } else {
        // Create new account in Firestore Vault
        window._pendingVaultPasswordResetEmail = null;
        await bindAuthenticatedAccountToProfile({
          uid: emailDocKey,
          email: email,
          displayName: chosenMember || customName || email.split("@")[0],
          provider: "firestore_email",
          passwordHash: passHash
        }, chosenMember || customName);
        closeAuthModal();
        showAppToast("✅ Created account & locked instance for " + AUTH_SESSION.displayName + "!");
        return;
      }
    } catch (fsErr) {}
  }

  // 3. Offline / Local fallback
  await bindAuthenticatedAccountToProfile({
    uid: emailDocKey,
    email: email,
    displayName: chosenMember || customName || email.split("@")[0],
    provider: "local_email",
    passwordHash: passHash
  }, chosenMember || customName);
  closeAuthModal();
  showAppToast("🔐 Signed in as " + AUTH_SESSION.displayName + "!");
}

async function sendEmailPasswordReset() {
  var emailEl = document.getElementById("auth-email-input");
  var passEl = document.getElementById("auth-password-input");
  var errEl = document.getElementById("auth-modal-error");
  var email = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";
  if (!email || email.indexOf("@") === -1) {
    if (errEl) { errEl.style.color = "#f87171"; errEl.textContent = "⚠️ Enter your email address above first to reset password."; }
    if (emailEl) emailEl.focus();
    return;
  }
  var sentFirebaseEmail = false;
  if (fbAuth) {
    try {
      await fbAuth.sendPasswordResetEmail(email);
      sentFirebaseEmail = true;
    } catch (e) {}
  }
  // Also arm Cloud Firestore Vault Self-Service Reset so users on the Firestore Vault can immediately set a new password
  window._pendingVaultPasswordResetEmail = email;
  if (errEl) {
    if (sentFirebaseEmail) {
      errEl.style.color = "#34d399";
      errEl.innerHTML = "✅ <strong>Password reset email sent to " + email + "!</strong><br>*(Or if your account uses the Cloud Firestore Vault, select your Leaderboard Name in Step 1, type a new password above, and click Sign In to update it immediately.)*";
    } else {
      errEl.style.color = "#fde68a";
      errEl.innerHTML = "🔑 <strong>Password Reset Armed for " + email + ":</strong><br>1. Select your linked <strong>Leaderboard Name</strong> in Step 1 above (to verify your identity).<br>2. Type your <strong>NEW password</strong> in the password box above and click <strong>Sign In & Lock Instance</strong> to save your new password!";
    }
  }
  if (passEl) passEl.focus();
}

function signOutAccountInstance() {
  if (fbAuth && fbAuth.currentUser) {
    try { fbAuth.signOut(); } catch (e) {}
  }
  var oldName = AUTH_SESSION ? AUTH_SESSION.displayName : "Account";
  AUTH_SESSION = null;
  saveDeviceAuthSession();
  updateAuthUI();
  renderAll();
  if (document.getElementById("auth-modal-backdrop") && document.getElementById("auth-modal-backdrop").style.display === "flex") {
    openAuthModal();
  }
  showAppToast("🔓 Signed out of " + oldName + ". Multi-profile switching unlocked on this device.");
}

function toggleAdminInstanceOverride(checked) {
  if (!AUTH_SESSION) return;
  AUTH_SESSION.adminUnlock = !!checked;
  if (!checked && AUTH_SESSION.boundProfileKey && activeProfile !== "test") {
    activeProfile = AUTH_SESSION.boundProfileKey;
  }
  saveDeviceAuthSession();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  openAuthModal();
  showAppToast(checked ? "👑 Commissioner Override ON: You can switch to & edit any player's profile on this device." : "🔒 Strict Instance Lock ON: Locked to " + AUTH_SESSION.displayName + ".");
}

function commissionerSwitchToMember(memberName) {
  if (!AUTH_SESSION || !AUTH_SESSION.adminUnlock || !memberName) return;
  var resolved = resolveOrCreateProfileForMember(memberName, memberName, "", "");
  if (resolved && resolved.profileKey) {
    SESSION_UNLOCKED_PROFILES[resolved.profileKey] = true;
    activeProfile = resolved.profileKey;
    saveDeviceAuthSession();
    syncActiveProfileControlsUI();
    updateAuthUI();
    renderAll();
    openAuthModal();
    showAppToast("👑 Commissioner Mode: Now editing picks for " + resolved.displayName + "!");
  }
}

async function commissionerResetPlayerPassword() {
  var inp = document.getElementById("commish-reset-email-input");
  var targetEmail = inp ? String(inp.value || "").trim().toLowerCase() : "";
  if (!targetEmail || targetEmail.indexOf("@") === -1) {
    showAppToast("⚠️ Enter the player's email address to reset their password.");
    return;
  }
  var emailDocKey = "email_" + targetEmail.replace(/[^a-z0-9]/g, "_");
  if (fsDb) {
    try {
      await fsDb.collection("pickem_v14_accounts").doc(emailDocKey).set({
        passwordHash: "",
        resetByCommissionerAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {}
  }
  if (fbAuth) {
    try { await fbAuth.sendPasswordResetEmail(targetEmail); } catch (e2) {}
  }
  if (inp) inp.value = "";
  showAppToast("✅ Cleared vault password lock & triggered reset for " + targetEmail + "!");
}

function changeAuthenticatedLinkedMember(newMemberName) {
  if (!AUTH_SESSION || !newMemberName) return;
  bindAuthenticatedAccountToProfile({
    uid: AUTH_SESSION.uid,
    email: AUTH_SESSION.email,
    displayName: newMemberName,
    provider: AUTH_SESSION.provider
  }, newMemberName).then(function() {
    openAuthModal();
    showAppToast("🔗 Bound your account instance to " + newMemberName + "!");
  });
}

function setAuthModalMode(mode) {
  AUTH_MODAL_MODE = (mode === "signup") ? "signup" : "signin";
  openAuthModal();
}

function closeAuthModal() {
  var bd = document.getElementById("auth-modal-backdrop");
  if (bd) bd.style.display = "none";
}

function handleAuthMemberSelectChange(val) {
  var wrap = document.getElementById("auth-custom-name-wrap");
  if (!wrap) return;
  if (!val || val === "__NEW_USER__") {
    wrap.style.display = "block";
  } else {
    wrap.style.display = "none";
  }
}

function saveCustomInstanceDisplayName() {
  if (!AUTH_SESSION) return;
  var inp = document.getElementById("auth-edit-display-name");
  var ptsInp = document.getElementById("auth-edit-prior-pts");
  var newName = inp ? String(inp.value || "").trim() : "";
  if (!newName) {
    showAppToast("⚠️ Please enter a display name.");
    return;
  }
  var customPts = ptsInp ? (parseFloat(ptsInp.value) || 0) : 0;
  bindAuthenticatedAccountToProfile({
    uid: AUTH_SESSION.uid,
    email: AUTH_SESSION.email,
    displayName: newName,
    provider: AUTH_SESSION.provider
  }, newName).then(function() {
    var bKey = AUTH_SESSION.boundProfileKey;
    if (state.customUsers && Array.isArray(state.customUsers)) {
      for (var i = 0; i < state.customUsers.length; i++) {
        if (state.customUsers[i].key === bKey && !findLeaderboardEntryByName(newName)) {
          state.customUsers[i].priorPts = customPts;
          state.customUsers[i].rank = customPts > 0 ? "Custom" : "New";
        }
      }
    }
    regradeAllPoolMembersLive();
    pushMultiUserAndPrivacyToFirebase();
    openAuthModal();
    renderAll();
    showAppToast("✅ Updated your instance profile to " + newName + "!");
  });
}

function openAuthModal() {
  ensureMultiUserAndPrivacyState();
  var bd = document.getElementById("auth-modal-backdrop");
  var bodyEl = document.getElementById("auth-modal-body");
  if (!bd || !bodyEl) return;

  var allLb = [];
  if (state.leaderboard && Array.isArray(state.leaderboard)) {
    allLb = state.leaderboard.slice();
  }
  var curLinked = (AUTH_SESSION && AUTH_SESSION.linkedMemberName) ? AUTH_SESSION.linkedMemberName : "";
  var matchedOnBoard = false;
  for (var chk = 0; chk < allLb.length; chk++) {
    if (curLinked && standardizeParticipantName(curLinked).toLowerCase() === standardizeParticipantName(allLb[chk].name).toLowerCase()) {
      matchedOnBoard = true;
      break;
    }
  }
  var lbOpts = '<option value="__NEW_USER__"' + (!matchedOnBoard ? ' selected' : '') + '>✨ New Player / Not on Leaderboard Yet (Auto-Creates Profile)</option>';
  for (var i = 0; i < allLb.length; i++) {
    var item = allLb[i];
    var sel = (matchedOnBoard && standardizeParticipantName(curLinked).toLowerCase() === standardizeParticipantName(item.name).toLowerCase()) ? " selected" : "";
    lbOpts += '<option value="' + item.name.replace(/"/g, '&quot;') + '"' + sel + '>🏆 ' + item.name + ' (' + item.priorPts + ' pts • Rank ' + item.rank + ')</option>';
  }

  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    var boundMeta = getProfileMetaByKey(AUTH_SESSION.boundProfileKey);
    var isStrict = isAccountInstanceLocked();
    bodyEl.innerHTML =
      '<div style="background:rgba(16,185,129,0.12);border:1px solid #10b981;border-radius:12px;padding:12px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
          '<span style="font-size:0.86rem;font-weight:900;color:#34d399;">✅ Signed In & Instance Locked</span>' +
          '<span class="badge badge-ev">' + (AUTH_SESSION.provider.indexOf("google") !== -1 ? "🌐 Google Auth" : "📧 Email + Password") + '</span>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:#e2e8f0;margin-bottom:4px;"><strong>Account:</strong> ' + (AUTH_SESSION.email || AUTH_SESSION.displayName) + '</div>' +
        '<div style="font-size:0.78rem;color:#e2e8f0;margin-bottom:8px;"><strong>Bound Instance Profile:</strong> <span style="color:#38bdf8;font-weight:800;">' + boundMeta.name + '</span> (Prior: ' + (boundMeta.priorPts || 0) + ' pts • ' + (boundMeta.defaultRank || 'Pool') + ')</div>' +
        '<div style="font-size:0.72rem;color:#cbd5e1;background:rgba(9,13,22,0.75);padding:8px;border-radius:8px;border:1px solid var(--border-muted);">' +
          '🛡️ <strong>How Your Isolated Instance Works:</strong><br>' +
          '• Your device is locked to <strong>' + boundMeta.name + '</strong> (plus your personal <strong>🧪 Test Sim</strong> sandbox).<br>' +
          '• Other users logging in on their phones/computers <strong>cannot switch your active profile</strong> or edit your picks.<br>' +
          '• Everyone else\'s picks still stream into your app live in real time for Head-to-Head comparison and Live CST grading!' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:10px;">' +
        '<label style="font-size:0.73rem;font-weight:800;color:#bae6fd;display:block;margin-bottom:4px;">🔗 Link to Existing Leaderboard Player (or keep as Custom/New Player):</label>' +
        '<select class="search-input" style="width:100%;padding:7px 9px;font-size:0.76rem;color:#6ee7b7;" onchange="if(this.value && this.value !== \'__NEW_USER__\'){changeAuthenticatedLinkedMember(this.value);}">' + lbOpts + '</select>' +
      '</div>' +
      '<div style="background:rgba(15,23,42,0.85);border:1px solid var(--border-muted);border-radius:9px;padding:9px 11px;margin-bottom:12px;">' +
        '<div style="font-size:0.71rem;font-weight:800;color:#93c5fd;margin-bottom:5px;">✨ Not on the Leaderboard Yet? Set Your Custom Display Name & Starting Points:</div>' +
        '<div style="display:grid;grid-template-columns:1fr 95px auto;gap:6px;align-items:center;">' +
          '<input type="text" id="auth-edit-display-name" class="search-input" style="min-width:0;padding:6px 8px;font-size:0.76rem;" value="' + boundMeta.name.replace(/"/g, '&quot;') + '" placeholder="Your Display Name" />' +
          '<input type="number" id="auth-edit-prior-pts" class="search-input" style="min-width:0;padding:6px 8px;font-size:0.76rem;" value="' + (boundMeta.priorPts || 0) + '" placeholder="Prior Pts" title="Starting / Prior Season Points (0 for new players)" />' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:#000;border:none;font-weight:800;padding:6px 10px;" onclick="saveCustomInstanceDisplayName()">Save</button>' +
        '</div>' +
      '</div>' +
      '<div style="background:var(--panel-alt);padding:9px 11px;border-radius:9px;border:1px solid var(--border-muted);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<span style="font-size:0.73rem;color:#cbd5e1;">🕵️ <strong>Pre-Kickoff Pick Privacy:</strong> ' + ((state.profilePrivacy[AUTH_SESSION.boundProfileKey] && state.profilePrivacy[AUTH_SESSION.boundProfileKey].hidden) ? '<strong style="color:#6ee7b7;">🔒 Hidden From Other Users Until Kickoff</strong>' : '<strong style="color:#fde68a;">👁️ Public to Other Users</strong>') + '</span>' +
        '<button type="button" class="btn-sm" style="padding:4px 9px;font-size:0.69rem;border-color:#c084fc;color:#e9d5ff;" onclick="toggleQuickLockActiveProfile(); openAuthModal();">Toggle Privacy</button>' +
      '</div>' +
      '<div style="background:rgba(245,158,11,0.09);border:1px solid rgba(245,158,11,0.4);border-radius:9px;padding:9px 11px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">' +
          '<label style="font-size:0.73rem;font-weight:800;color:#fde68a;cursor:pointer;display:flex;align-items:center;gap:6px;">' +
            '<input type="checkbox" ' + (AUTH_SESSION.adminUnlock ? 'checked' : '') + ' onchange="toggleAdminInstanceOverride(this.checked)" />' +
            '👑 Commissioner Override Mode (Allow Multi-Profile Editing on This Device)' +
          '</label>' +
          '<span style="font-size:0.66rem;color:var(--muted);">Currently Editing: <strong style="color:#38bdf8;">' + getProfileMetaByKey(activeProfile).name + '</strong></span>' +
        '</div>' +
        (AUTH_SESSION.adminUnlock ? (
          '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:7px;">' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
              '<span style="font-size:0.7rem;color:#cbd5e1;font-weight:700;">🏈 Edit Any Player\'s Picks:</span>' +
              '<select class="search-input" style="flex:1;min-width:170px;padding:5px 8px;font-size:0.73rem;color:#fde68a;border-color:#f59e0b88;" onchange="if(this.value && this.value !== \'__NEW_USER__\'){commissionerSwitchToMember(this.value);}">' + lbOpts + '</select>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
              '<input type="email" id="commish-reset-email-input" class="search-input" style="flex:1;min-width:170px;padding:5px 8px;font-size:0.72rem;" placeholder="Player email to unlock/reset password..." />' +
              '<button type="button" class="btn-sm" style="border-color:#34d399;color:#6ee7b7;font-size:0.69rem;padding:5px 9px;" onclick="commissionerResetPlayerPassword()">🔑 Reset Player Password</button>' +
            '</div>' +
          '</div>'
        ) : '') +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;">' +
        '<button type="button" class="btn-sm" style="background:rgba(239,68,68,0.2);border-color:#ef4444;color:#fca5a5;font-weight:800;padding:8px 14px;" onclick="signOutAccountInstance()">🚪 Sign Out of Instance</button>' +
        '<div style="display:flex;gap:6px;">' +
          '<button type="button" class="btn-sm" style="border-color:#f59e0b;color:#fde68a;font-weight:800;padding:8px 12px;" onclick="switchProfile(\'test\'); closeAuthModal();">🧪 My Sandbox Sim</button>' +
          '<button type="button" class="btn-sm" style="background:var(--green);color:#000;border:none;font-weight:900;padding:8px 16px;" onclick="switchProfile(\'' + AUTH_SESSION.boundProfileKey + '\'); closeAuthModal();">🏈 Go to My Picks (' + boundMeta.shortName + ')</button>' +
        '</div>' +
      '</div>';
  } else {
    var isSignup = (AUTH_MODAL_MODE === "signup");
    bodyEl.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;background:#090d16;padding:4px;border-radius:9px;border:1px solid var(--border-muted);">' +
        '<button type="button" class="btn-sm ' + (!isSignup ? 'active' : '') + '" style="text-align:center;font-weight:800;padding:7px;" onclick="setAuthModalMode(\'signin\')">🔑 Sign In</button>' +
        '<button type="button" class="btn-sm ' + (isSignup ? 'active' : '') + '" style="text-align:center;font-weight:800;padding:7px;" onclick="setAuthModalMode(\'signup\')">✨ Create Account (80+ Ready)</button>' +
      '</div>' +
      '<div style="margin-bottom:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:10px;">' +
        '<label style="font-size:0.72rem;font-weight:800;color:#6ee7b7;display:block;margin-bottom:4px;">1️⃣ Are you on the current 89-player Leaderboard, or a Brand-New Player?</label>' +
        '<select id="auth-link-member-select" class="search-input" style="width:100%;padding:8px 10px;font-size:0.76rem;color:#6ee7b7;border-color:#10b98188;margin-bottom:6px;" onchange="handleAuthMemberSelectChange(this.value)">' + lbOpts + '</select>' +
        '<div id="auth-custom-name-wrap" style="display:' + (!matchedOnBoard ? 'block' : 'none') + ';">' +
          '<input type="text" id="auth-name-input" class="search-input" style="width:100%;padding:7px 10px;font-size:0.78rem;border-color:#38bdf888;" placeholder="Enter Your Display Name (or leave blank to use your Google Account name)" />' +
          '<div style="font-size:0.67rem;color:#93c5fd;margin-top:3px;">✨ Creates a brand-new isolated profile in Cloud Firestore, adds you to the live standings & H2H dropdowns for all users, and starts your picks sheet!</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:6px;">' +
        '<button type="button" class="google-auth-btn" onclick="signInWithGoogleAccount(false)">' +
          '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
          '<span>Continue with Google Sign-In</span>' +
        '</button>' +
        '<button type="button" class="btn-sm" style="padding:8px 10px;font-size:0.72rem;border-color:#cbd5e1;color:#e2e8f0;" onclick="signInWithGoogleAccount(true)" title="Use Redirect instead of Popup (Best for Mobile Safari / iOS)">📱 Mobile Redirect</button>' +
      '</div>' +
      '<div class="auth-divider">or Email + Password</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +

        '<input type="email" id="auth-email-input" class="search-input" style="width:100%;padding:8px 10px;font-size:0.8rem;" placeholder="Email address (e.g. you@gmail.com)" onkeydown="if(event.key===\'Enter\'){submitEmailPasswordAuth();}" />' +
        '<input type="password" id="auth-password-input" class="search-input" style="width:100%;padding:8px 10px;font-size:0.8rem;" placeholder="Password (6+ characters)" onkeydown="if(event.key===\'Enter\'){submitEmailPasswordAuth();}" />' +
      '</div>' +
      '<div id="auth-modal-error" style="font-size:0.73rem;color:#f87171;min-height:18px;margin:8px 0;font-weight:700;line-height:1.35;"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;">' +
        '<button type="button" class="btn-sm" style="font-size:0.69rem;color:var(--muted);" onclick="sendEmailPasswordReset()">Forgot Password?</button>' +
        '<button type="button" class="btn-sm" style="background:linear-gradient(90deg,#059669,#0284c7);color:#fff;border:none;font-weight:900;padding:9px 18px;font-size:0.8rem;" onclick="submitEmailPasswordAuth()">' +
          (isSignup ? '✨ Create Account & Lock Instance' : '🔐 Sign In & Lock Instance') +
        '</button>' +
      '</div>' +
      '<div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:0.69rem;color:var(--muted);">' +
        '💡 <strong>Built for 6 Users Today & 80+ Users Next Season:</strong> Signing in binds this browser exclusively to your profile so nobody else can switch your profile on your screen, while everyone\'s picks still update live alongside yours.' +
      '</div>';
  }

  bd.style.display = "flex";
}

function updateAuthUI() {
  var btn = document.getElementById("btn-auth-account");
  var instTag = document.getElementById("top-profile-instance-tag");
  var banner = document.getElementById("sidebar-instance-banner");
  var isLocked = isAccountInstanceLocked();

  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    var bMeta = getProfileMetaByKey(AUTH_SESSION.boundProfileKey);
    if (btn) {
      btn.textContent = "🔐 " + bMeta.shortName + (isLocked ? " (Locked Instance)" : " (Admin Mode)");
      btn.className = "btn-sm auth-pill-active";
    }
    if (instTag) {
      instTag.textContent = isLocked ? "🔒 My Instance" : "👑 Admin";
    }
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML =
        '<span>🔐 Instance: <strong style="color:#34d399;">' + bMeta.name + '</strong> ' +
        (isLocked ? '<span style="color:#93c5fd;">(Isolated • Others Read-Only)</span>' : '<span style="color:#fde68a;">(👑 Admin Override)</span>') +
        '</span>' +
        '<div style="display:flex;gap:4px;">' +
          '<button type="button" class="btn-sm" style="padding:2px 6px;font-size:0.64rem;" onclick="switchProfile(\'' + (activeProfile === 'test' ? AUTH_SESSION.boundProfileKey : 'test') + '\')">' +
            (activeProfile === 'test' ? ('🏈 Back to ' + bMeta.shortName) : '🧪 Sandbox') +
          '</button>' +
          '<button type="button" class="btn-sm" style="padding:2px 6px;font-size:0.64rem;border-color:#38bdf8;color:#7dd3fc;" onclick="openAuthModal()">⚙️ Manage</button>' +
        '</div>';
    }
  } else {
    if (btn) {
      btn.textContent = "🔐 Sign In / My Instance";
      btn.className = "btn-sm";
    }
    if (instTag) {
      instTag.textContent = "⇄";
    }
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML =
        '<span style="color:#cbd5e1;">🔓 <strong>Shared Device Mode</strong> (Sign in to lock your own instance)</span>' +
        '<button type="button" class="btn-sm" style="padding:2px 8px;font-size:0.66rem;background:linear-gradient(90deg,#0284c7,#4f46e5);color:#fff;border:none;font-weight:800;" onclick="openAuthModal()">🔐 Sign In / Register</button>';
    }
  }
}

function initState() {
  var saved = safeGetStorage("sat_week7_official_v14");
  if (saved) {
    try {
      var parsed = JSON.parse(saved);
      if (parsed.customGames && Array.isArray(parsed.customGames) && parsed.customGames.length === 23 && !isHardcodedWeek7Slate(parsed.customGames)) {
        GAMES = parsed.customGames;
        if (!isHardcodedWeek7Slate(GAMES)) hasLockedCustomSlate = true;
        for (var cg = 0; cg < GAMES.length; cg++) {
          if (GAMES[cg].awayL5 && GAMES[cg].awayL5.length) TEAM_LOGS[GAMES[cg].away] = Object.assign(TEAM_LOGS[GAMES[cg].away] || {}, { rec: GAMES[cg].awayRec || "2026", l5: GAMES[cg].awayL5 });
          if (GAMES[cg].homeL5 && GAMES[cg].homeL5.length) TEAM_LOGS[GAMES[cg].home] = Object.assign(TEAM_LOGS[GAMES[cg].home] || {}, { rec: GAMES[cg].homeRec || "2026", l5: GAMES[cg].homeL5 });
        }
      }
      var savedWkNum = Math.max(parseInt(parsed.currentWeek, 10) || 0, parseWeekNumFromLabel(parsed.weekLabel), 8);
      state.currentWeek = savedWkNum;
      state.weekLabel = "Week " + savedWkNum;
      if (parsed.tiebreakerGameId) state.tiebreakerGameId = parseInt(parsed.tiebreakerGameId, 10) || null;
      if (parsed.weekArchives && typeof parsed.weekArchives === "object") state.weekArchives = parsed.weekArchives;
      if (parsed.deletedPicksByMember && typeof parsed.deletedPicksByMember === "object") state.deletedPicksByMember = parsed.deletedPicksByMember;
      if (parsed.michael) state.michael = parsed.michael;
      if (parsed.kinyion) state.kinyion = parsed.kinyion;
      if (parsed.test) state.test = parsed.test;
      if (parsed.customUsers && Array.isArray(parsed.customUsers)) {
        state.customUsers = parsed.customUsers;
        for (var cuI = 0; cuI < state.customUsers.length; cuI++) {
          var uk = state.customUsers[cuI].key;
          if (uk && parsed[uk]) state[uk] = parsed[uk];
        }
      }
      if (parsed.profilePrivacy && typeof parsed.profilePrivacy === "object") {
        state.profilePrivacy = parsed.profilePrivacy;
        for (var pkLock in state.profilePrivacy) {
          if (state.profilePrivacy[pkLock] && state.profilePrivacy[pkLock].hidden) {
            SESSION_UNLOCKED_PROFILES[pkLock] = false;
          }
        }
      }
      if (parsed.watchlist) state.watchlist = parsed.watchlist;
      if (parsed.leaderboard) state.leaderboard = parsed.leaderboard;
      if (parsed.poolMembers && Array.isArray(parsed.poolMembers) && parsed.poolMembers.length >= 10) {
        state.poolMembers = parsed.poolMembers;
      }
      if (parsed.liveScores && typeof parsed.liveScores === "object") {
        for (var lk in parsed.liveScores) {
          if (parsed.liveScores[lk] && (parsed.liveScores[lk].completed || parsed.liveScores[lk].inProgress)) {
            LIVE_SCORES[lk] = parsed.liveScores[lk];
          }
        }
        state.liveScores = LIVE_SCORES;
      }
    } catch (e) {}
  }
  var mCleared = !!((state.deletedPicksByMember && state.deletedPicksByMember["michael a"]) || (state.michael && state.michael._picksCleared));
  var kCleared = !!((state.deletedPicksByMember && state.deletedPicksByMember["kinyion c"]) || (state.kinyion && state.kinyion._picksCleared));
  var mEmptyUnedited = (!mCleared && Object.keys(state.michael.picks || {}).length === 0 && !state.michael._manualEditsThisWeek);
  var kEmptyUnedited = (!kCleared && Object.keys(state.kinyion.picks || {}).length === 0 && !state.kinyion._manualEditsThisWeek);
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (mEmptyUnedited) state.michael.picks[g.id] = g.rec;
    if (kEmptyUnedited) state.kinyion.picks[g.id] = g.kinyionDefault;
    if (!g.keyInjHeader) {
      var compInjHdr = computeKeyInjHeaderFromLists(g);
      if (compInjHdr) g.keyInjHeader = compInjHdr;
    }
  }
  sanitizeStateForActiveSlate();
  ensureWatchlistDefaults();
  ensureWeekArchivesState();
  loadDeviceAuthSession();
  initFirebaseAuthObserver();
  syncActiveProfileControlsUI();
  updateAuthUI();
  recalcImpliedTiebreaker();
  renderSwayFeed();
  regradeAllPoolMembersLive();
  renderAll();
  startFirebaseRealtimeListeners();
  pullFromFirebaseCloud();
}

function saveCurrentState(profOverride, debounceWrite) {
  var targetProf = profOverride || activeProfile;
  var tbEl = document.getElementById("tiebreaker-input");
  var slEl = document.getElementById("target-slider");
  if (tbEl) state[activeProfile].tiebreaker = tbEl.value;
  if (slEl) state[activeProfile].target = parseInt(slEl.value, 10);
  state.customGames = GAMES;

  if (debounceWrite) {
    if (saveStateDebounceTimer) clearTimeout(saveStateDebounceTimer);
    saveStateDebounceTimer = setTimeout(function() {
      saveStateDebounceTimer = null;
      safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
      pushProfileToFirebase(targetProf);
    }, 180);
  } else {
    safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
    pushProfileToFirebase(targetProf);
  }
}

function switchProfile(prof) {
  ensureMultiUserAndPrivacyState();
  var isCommish = !!(AUTH_SESSION && AUTH_SESSION.adminUnlock && (typeof isVerifiedCommissioner !== "function" || isVerifiedCommissioner()));
  var myKey = (AUTH_SESSION && AUTH_SESSION.boundProfileKey) ? AUTH_SESSION.boundProfileKey : getMyInstanceProfileKey();
  var isAllowedOwn = (prof === myKey || prof === "test" || (typeof isMyLinkedBuyInProfile === "function" && isMyLinkedBuyInProfile(prof)));
  // Unless Commissioner Override is enabled, only allow switching between your own linked buy-in profiles and your personal `test` Sandbox Sim.
  if (!isCommish && !isAllowedOwn) {
    var targetMeta = getProfileMetaByKey(prof);
    setCompareTarget(prof);
    showAppToast("⚔️ Comparing against " + targetMeta.name + " (Read-Only). To switch accounts, use 🔐 Account Sign-In.");
    return;
  }
  activeProfile = prof;
  if (state.compareTargetKey === prof) {
    state.compareTargetKey = (myKey === "michael") ? "kinyion" : "michael";
  }
  saveDeviceAuthSession();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  showAppToast(prof === "test" ? "🧪 Switched to your personal Sandbox Simulator" : ("🏈 Switched to your Official Picks (" + getProfileMetaByKey(prof).name + ")"));
}

function copyOtherProfile() {
  var cmpDesc = resolveCompareTargetDescriptor();
  var sourceName = cmpDesc ? cmpDesc.name : "Compare Target";
  var sourcePicks = (cmpDesc && cmpDesc.picks) ? cmpDesc.picks : null;
  if (cmpDesc && !cmpDesc.isPoolMember && isProfileHiddenFromViewer(cmpDesc.key, null)) {
    unlockProfileWithPrompt(cmpDesc.key, function() {
      copyOtherProfile();
    });
    return;
  }
  if (!sourcePicks || Object.keys(sourcePicks).length === 0) {
    showAppToast("⚠️ No picks available on " + sourceName + " to copy.");
    return;
  }
  var copy = {};
  for (var k in sourcePicks) copy[k] = sourcePicks[k];
  state[activeProfile].picks = copy;
  saveCurrentState(activeProfile);
  renderAll();
  showAppToast("📥 Copied picks from " + sourceName + " into " + getProfileMetaByKey(activeProfile).name + "!");
}

function applyPreset(type) {
  lastLocalPickTs = Date.now();
  clearDeletedFlagForProfile(activeProfile);
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (type === "optimal") {
      state[activeProfile].picks[g.id] = g.rec;
    } else if (type === "safe" || type === "chalk") {
      state[activeProfile].picks[g.id] = g.awayProb > g.homeProb ? g.away : g.home;
    } else if (type === "aggressive") {
      var dog = g.awayPts > 1 ? g.away : (g.homePts > 1 ? g.home : null);
      var dogProb = dog === g.away ? g.awayProb : g.homeProb;
      if (dog && dogProb >= 0.27) state[activeProfile].picks[g.id] = dog;
      else state[activeProfile].picks[g.id] = g.rec;
    }
  }
  saveCurrentState(activeProfile);
  renderAll();
}


function calcProfileMetrics(profKey) {
  if (!state[profKey] || !state[profKey].picks) return null;
  var gMetrics = gradePickMap(state[profKey].picks, true, true);
  var target = state[profKey].target || 20;
  var hitProb = 0, cum = 0, p25 = 0, p75 = 0;
  for (var m = 0; m < 80; m++) {
    if (m >= target) hitProb += gMetrics.dp[m];
    cum += gMetrics.dp[m];
    if (!p25 && cum >= 0.25) p25 = m;
    if (!p75 && cum >= 0.75) p75 = m;
  }
  gMetrics.hitProb = hitProb;
  gMetrics.p25 = p25;
  gMetrics.p75 = p75;
  return gMetrics;
}


function updateWatchlistMeta(idx, field, val) {
  if (!state.watchlist[idx]) return;
  if (field === "priorPts") state.watchlist[idx][field] = parseFloat(val) || 0;
  else state.watchlist[idx][field] = val;
  pushWatchlistOrStandingsToFirebase();
  renderAll();
}

