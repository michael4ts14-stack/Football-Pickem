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
      // "google_firestore" sessions came from an old fallback that trusted a typed email
      // without Google confirming it; drop them so those devices sign in for real.
      if (parsed && parsed.boundProfileKey && parsed.provider !== "google_firestore") {
        AUTH_SESSION = parsed;
      }
    } catch (e) {}
  }
  // Restore per-device compareTargetKey & Test Sim so another user's cloud sync never alters your screen view
  state.compareTargetKey = safeGetStorage(COMPARE_TARGET_STORAGE_KEY) || "";
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
    state.kinyion.linkedMemberName = "Kinyon C";
    return { profileKey: "kinyion", linkedMemberName: "Kinyon C", displayName: "Kinyon C" };
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

// Is this pool player's entry owned by another account? Uses the owner recorded on the
// player's public pick doc (pickem_v14_users/{key}.ownerUid); account records are private.
async function memberLinkedToAnotherAccount(memberName, uid, email) {
  if (!fsDb || !memberName) return false;
  var low = standardizeParticipantName(memberName).toLowerCase();
  var key = low === "michael a" ? "michael" : (low === "kinyion c" ? "kinyion" : null);
  if (!key) {
    var linked = typeof getProfileLinkedToMemberName === "function" ? getProfileLinkedToMemberName(memberName) : null;
    key = linked && linked.key;
  }
  if (!key) return false;
  try {
    var snap = await fsDb.collection("pickem_v14_users").doc(key).get();
    var owner = snap && snap.exists ? String((snap.data() || {}).ownerUid || "") : "";
    if (!owner) return false;
    var emailLow = String(email || "").toLowerCase();
    var mine = [uid, emailLow, "email_" + emailLow.replace(/[^a-z0-9]/g, "_")];
    return mine.indexOf(owner) === -1;
  } catch (e) {
    return false;
  }
}

// Roster name for an account name: exact (ignoring case, spacing and a trailing period), or
// first name + last initial ("Steve Miller" -> "Steve M").
function findRosterMatchForAccountName(name) {
  var exact = findLeaderboardEntryByName(name) || findPoolMemberByName(name);
  if (exact) return exact.name;
  var parts = standardizeParticipantName(name).split(" ");
  if (parts.length < 2) return "";
  var short = parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase();
  var hit = findLeaderboardEntryByName(short) || findPoolMemberByName(short);
  return hit ? hit.name : "";
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

  // On a re-check the account record wins over this device's memory (the commissioner may
  // have merged or moved the account).
  var targetMember = authUser.recheck
    ? ((acctDoc && acctDoc.linkedMemberName) || chosenMemberName || "")
    : (chosenMemberName || (acctDoc && acctDoc.linkedMemberName) || "");
  // An email the commissioner registered for a roster player needs no name matching or chooser.
  if (!targetMember && typeof memberForRegisteredEmail === "function") {
    if (typeof loadBoundAccounts === "function") await loadBoundAccounts();
    targetMember = memberForRegisteredEmail(email);
  }
  if (!targetMember) {
    // Try auto-matching displayName or email prefix to the 89-player leaderboard
    var matchLb = findRosterMatchForAccountName(dispName);
    if (matchLb) {
      targetMember = matchLb;
    } else {
      // Ask before creating a new player, so "Steve Miller" can pick his "Steve M" row.
      var chosen = (typeof chooseRosterNameForNewAccount === "function") ? await chooseRosterNameForNewAccount(dispName) : "";
      targetMember = chosen || dispName;
    }
  }

  // Account linking security (account-security.js): claimed players stay with their account,
  // pre-registered emails link at once, anything else waits for the commissioner.
  var explicitChoice = !!chosenMemberName && !authUser.recheck; // a re-check isn't a new choice
  var gate = (typeof gateAccountLink === "function")
    ? await gateAccountLink({ uid: uid, email: email, emailVerified: authUser.emailVerified, displayName: dispName, provider: authUser.provider }, targetMember, explicitChoice)
    : { ok: true, memberName: targetMember };
  if (!gate.ok) {
    enterUnlinkedAccountSession({ uid: uid, email: email, displayName: dispName, provider: authUser.provider || "email" }, gate);
    return;
  }
  targetMember = gate.memberName;

  // A pool player already linked to a different account can't be taken over by linking to
  // that name (sign-up picker or "Link to Existing Leaderboard Player").
  var ownerElsewhere = gate.checked ? false : await memberLinkedToAnotherAccount(targetMember, uid, email);
  if (ownerElsewhere) {
    showAppToast(standardizeParticipantName(targetMember) + " is already linked to another account. Ask the commissioner if that's you.");
    if (acctDoc && acctDoc.linkedMemberName && !(await memberLinkedToAnotherAccount(acctDoc.linkedMemberName, uid, email))) {
      targetMember = acctDoc.linkedMemberName; // stay on your own player
    } else {
      targetMember = (email.split("@")[0] || "Player") + " (new player)";
    }
  }

  var resolved = resolveOrCreateProfileForMember(targetMember, dispName, uid, email);
  var bKey = resolved.profileKey;
  if (gate.needsBinding && typeof recordAccountBinding === "function") {
    await recordAccountBinding(bKey, resolved.linkedMemberName, gate.needsBinding, { uid: uid, email: email, displayName: resolved.displayName });
  }

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
  // With account bindings live, an entry is only one this account is actually bound to (an old
  // mix-up must not keep showing someone else's player).
  if (typeof ACCOUNT_SECURITY_LIVE !== "undefined" && ACCOUNT_SECURITY_LIVE) {
    prevEntries = prevEntries.filter(function(x) { return x && (x.profileKey === bKey || bindingOwnerUid(x.profileKey) === uid); });
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
      // Password hashes are no longer kept (the account doc is publicly readable); drop old ones.
      saveAcct.passwordHash = firebase.firestore.FieldValue.delete();
      await fsDb.collection("pickem_v14_accounts").doc(emailDocKey).set(saveAcct, { merge: true });
    } catch (eSave) {}
  }

  SESSION_UNLOCKED_PROFILES[bKey] = true;
  activeProfile = (authUser.keepSandbox && activeProfile === "test") ? "test" : bKey;
  if (state.compareTargetKey === bKey) { state.compareTargetKey = ""; safeSetStorage(COMPARE_TARGET_STORAGE_KEY, ""); }

  saveDeviceAuthSession();
  regradeAllPoolMembersLive();
  pushMultiUserAndPrivacyToFirebase();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
}

// The roster name chosen before a Google sign-in, kept across the redirect. It belongs to that one
// sign-in only: it expires, and it's cleared once used and on sign-out, so a name picked while
// creating one account is never applied to the next account that signs in on this device.
var PENDING_OAUTH_MEMBER_KEY = "sat_pending_oauth_member_v16";
var PENDING_OAUTH_MEMBER_MAX_MS = 15 * 60 * 1000;

function setPendingOauthMember(name) {
  safeSetStorage(PENDING_OAUTH_MEMBER_KEY, name ? JSON.stringify({ name: name, at: Date.now() }) : "");
}

function takePendingOauthMember() {
  var raw = safeGetStorage(PENDING_OAUTH_MEMBER_KEY) || "";
  safeSetStorage(PENDING_OAUTH_MEMBER_KEY, "");
  try {
    var v = JSON.parse(raw);
    if (v && v.name && Date.now() - (v.at || 0) < PENDING_OAUTH_MEMBER_MAX_MS) return String(v.name);
  } catch (e) {} // older plain-text values have no time, so they're dropped
  return "";
}

function initFirebaseAuthObserver() {
  if (!fbAuth) return;
  try {
    // Handle return from mobile Google OAuth Redirect (`signInWithRedirect`)
    fbAuth.getRedirectResult().then(function(res) {
      if (res && res.user) {
        var pendingMember = takePendingOauthMember();
        bindAuthenticatedAccountToProfile({
          uid: res.user.uid,
          email: res.user.email,
          displayName: res.user.displayName,
          emailVerified: res.user.emailVerified,
          provider: "google_oauth_redirect"
        }, pendingMember).then(function() {
          showAppToast("✅ Signed in with Google as " + (AUTH_SESSION ? AUTH_SESSION.displayName : "User") + "!");
        });
      }
    }).catch(function(err) {
      showAppToast("Google sign-in didn't finish: " + googleSignInErrorText(err));
    });

    // Automatically restore Firebase Auth session if signed in via Google or Email/Password
    fbAuth.onAuthStateChanged(function(user) {
      // A saved session only counts with a real Firebase sign-in behind it for the same account.
      if (!user && AUTH_SESSION) {
        var goneName = AUTH_SESSION.displayName || "your account";
        AUTH_SESSION = null;
        saveDeviceAuthSession();
        if (typeof enterGuestModeIfSignedOut === "function") enterGuestModeIfSignedOut();
        updateAuthUI();
        renderAll();
        showAppToast("Signed out of " + goneName + ". Sign in again to keep editing your picks.");
        return;
      }
      if (user && AUTH_SESSION && AUTH_SESSION.adminUnlock && !isVerifiedCommissioner()) {
        AUTH_SESSION.adminUnlock = false;
        if (AUTH_SESSION.boundProfileKey) activeProfile = AUTH_SESSION.boundProfileKey;
        saveDeviceAuthSession();
        renderAll();
      }
      // Re-check the account's link once per load too (not only on a new sign-in), so a link
      // the commissioner approved, removed or fixed reaches this device.
      if (user && (!AUTH_SESSION || AUTH_SESSION.uid !== user.uid || !window._accountLinkCheckedThisLoad)) {
        window._accountLinkCheckedThisLoad = true;
        var sameUser = !!(AUTH_SESSION && AUTH_SESSION.uid === user.uid);
        var savedMember = sameUser ? (AUTH_SESSION.linkedMemberName || "") : takePendingOauthMember();
        bindAuthenticatedAccountToProfile({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerified,
          keepSandbox: sameUser,
          recheck: sameUser,
          provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || "firebase_auth"
        }, savedMember);
      }
    });
  } catch (e) {}
}

// Phones, tablets and the installed app use the full-page redirect (popups are blocked or
// lose their way back there); desktop browsers use the popup.
function preferGoogleRedirect() {
  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  return standalone || touch || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
}

function googleSignInErrorText(err) {
  var code = (err && err.code) ? String(err.code) : "";
  var map = {
    "auth/popup-closed-by-user": "the Google window was closed before finishing.",
    "auth/cancelled-popup-request": "another sign-in window was already open.",
    "auth/network-request-failed": "no connection. Check your internet and try again.",
    "auth/unauthorized-domain": "this site isn't allowed for Google sign-in yet (Firebase › Authentication › Authorized domains).",
    "auth/operation-not-allowed": "Google sign-in is turned off for this project (Firebase › Authentication › Sign-in method).",
    "auth/web-storage-unsupported": "this browser blocks the storage sign-in needs (private browsing?).",
    "auth/account-exists-with-different-credential": "that email already has an account with a password. Sign in with email and password."
  };
  return map[code] || ((err && err.message) ? String(err.message) : "unknown error") + (code && !map[code] ? " (" + code + ")" : "");
}

async function signInWithGoogleAccount(useRedirect) {
  var errEl = document.getElementById("auth-modal-error");
  var linkSel = document.getElementById("auth-link-member-select");
  var nameInput = document.getElementById("auth-name-input");
  var customName = nameInput ? String(nameInput.value || "").trim() : "";
  var chosenMember = linkSel ? String(linkSel.value || "").trim() : "";
  if (chosenMember === "__NEW_USER__") chosenMember = "";
  var preferredName = chosenMember || customName;
  setPendingOauthMember(preferredName); // clears any older choice when none was made
  if (useRedirect === undefined || useRedirect === false) useRedirect = preferGoogleRedirect();

  if (!fbAuth || typeof firebase.auth.GoogleAuthProvider !== "function") {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "Google sign-in isn't available right now. Reload the page and try again."; }
    return;
  }
  if (errEl) {
    errEl.style.color = "var(--text)";
    errEl.textContent = useRedirect ? "Taking you to Google…" : "Opening Google sign-in…";
  }
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    if (useRedirect) {
      await fbAuth.signInWithRedirect(provider); // the page leaves; initFirebaseAuthObserver finishes
      return;
    }
    var res = await fbAuth.signInWithPopup(provider);
    if (res && res.user) {
      await bindAuthenticatedAccountToProfile({
        uid: res.user.uid,
        email: res.user.email,
        displayName: customName || res.user.displayName,
        emailVerified: res.user.emailVerified,
        provider: "google_oauth"
      }, preferredName);
      closeAuthModal();
      showAppToast("✅ Signed in with Google as " + AUTH_SESSION.displayName + "!");
    }
  } catch (err) {
    var code = (err && err.code) ? String(err.code) : "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try { await fbAuth.signInWithRedirect(provider); return; } catch (eRedir) { err = eRedir; }
    }
    // Never sign anyone in without Google confirming who they are.
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "Google sign-in didn't work: " + googleSignInErrorText(err); }
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
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "⚠️ Please enter a valid email address."; }
    if (emailEl) emailEl.focus();
    return;
  }
  if (!password || password.length < 4) {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "⚠️ Please enter a password (at least 4 characters; 6+ for Firebase Auth)."; }
    if (passEl) passEl.focus();
    return;
  }

  if (errEl) {
    errEl.style.color = "var(--text)";
    errEl.textContent = mode === "signup" ? "↻ Creating your account & isolated instance..." : "↻ Signing in to your instance...";
  }

  // Firebase Authentication only. (The old "Cloud Firestore vault" fallback compared a
  // password hash in the browser against a publicly readable document, so anyone could sign
  // in as an account that had no hash, or "reset" someone else's password.)
  if (!fbAuth) {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "Sign-in isn't available right now. Reload the page and try again."; }
    return;
  }
  if (password.length < 6) {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "Passwords are at least 6 characters."; }
    if (passEl) passEl.focus();
    return;
  }
  try {
    var cred = null;
    if (mode === "signup") {
      try {
        cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        if (cred && cred.user && (customName || chosenMember)) {
          try { await cred.user.updateProfile({ displayName: chosenMember || customName }); } catch (eProf) {}
        }
        if (cred && cred.user && !cred.user.emailVerified) {
          try { await cred.user.sendEmailVerification(); } catch (eVer) {}
        }
      } catch (eUp) {
        if (eUp && eUp.code === "auth/email-already-in-use") cred = await fbAuth.signInWithEmailAndPassword(email, password);
        else throw eUp;
      }
    } else {
      cred = await fbAuth.signInWithEmailAndPassword(email, password);
    }
    if (cred && cred.user) {
      await bindAuthenticatedAccountToProfile({
        uid: cred.user.uid,
        email: cred.user.email || email,
        displayName: cred.user.displayName || chosenMember || customName,
        emailVerified: cred.user.emailVerified,
        provider: "firebase_email"
      }, chosenMember || customName);
      closeAuthModal();
      showAppToast("🔐 Signed in as " + AUTH_SESSION.displayName + "!");
    }
  } catch (fbErr) {
    var c = (fbErr && fbErr.code) ? String(fbErr.code) : "";
    var msg = {
      "auth/wrong-password": "Incorrect email or password.",
      "auth/invalid-login-credentials": "Incorrect email or password.",
      "auth/invalid-credential": "Incorrect email or password. If you signed up with Google, use the Google button.",
      "auth/user-not-found": "No account with that email. Choose Create Account.",
      "auth/email-already-in-use": "That email already has an account with a different password.",
      "auth/weak-password": "Choose a stronger password (at least 6 characters).",
      "auth/invalid-email": "That email address doesn't look right.",
      "auth/too-many-requests": "Too many tries. Wait a few minutes, or use Forgot Password.",
      "auth/network-request-failed": "No connection. Check your internet and try again.",
      "auth/operation-not-allowed": "Email sign-in is turned off for this pool. Use Google sign-in."
    }[c] || ("Sign-in didn't work" + (c ? " (" + c + ")" : "") + ".");
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = msg; }
  }
}

async function sendEmailPasswordReset() {
  var emailEl = document.getElementById("auth-email-input");
  var passEl = document.getElementById("auth-password-input");
  var errEl = document.getElementById("auth-modal-error");
  var email = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";
  if (!email || email.indexOf("@") === -1) {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "⚠️ Enter your email address above first to reset password."; }
    if (emailEl) emailEl.focus();
    return;
  }
  // Google emails a reset link; the password only changes when the account owner uses it.
  try {
    await fbAuth.sendPasswordResetEmail(email);
    if (errEl) { errEl.style.color = "var(--win)"; errEl.textContent = "Password reset email sent to " + email + ". Use the link in it, then sign in."; }
  } catch (e) {
    if (errEl) { errEl.style.color = "var(--loss)"; errEl.textContent = "Couldn't send the reset email" + (e && e.code ? " (" + e.code + ")" : "") + "."; }
  }
  if (passEl) passEl.focus();
}

function signOutAccountInstance() {
  setPendingOauthMember("");
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

function commissionerSwitchToMember(memberName) {
  if (!AUTH_SESSION || !AUTH_SESSION.adminUnlock || !memberName) return;
  if (!assertCommissionerRole("editing another player's picks")) return;
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
  if (!assertCommissionerRole("resetting a password")) return;
  // Google emails the player a reset link; nothing about their account changes until they use it.
  try {
    await fbAuth.sendPasswordResetEmail(targetEmail);
    if (inp) inp.value = "";
    showAppToast("Password reset email sent to " + targetEmail + ".");
  } catch (e2) {
    showAppToast("Couldn't send the reset email: " + ((e2 && e2.message) || e2));
  }
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
  // With account security on (account-security.js), a new player needs the commissioner's
  // approval or the invite-code season, and players linked to another account can't be picked.
  var secLive = typeof ACCOUNT_SECURITY_LIVE !== "undefined" && ACCOUNT_SECURITY_LIVE;
  var secMode = secLive ? getSecurityConfig().registrationMode : "";
  var newLabel = !secLive ? "✨ New Player / Not on Leaderboard Yet (Auto-Creates Profile)"
    : (secMode === "invite_code_required" ? "✨ New player (needs the league invite code)" : "✨ New player (the commissioner approves)");
  var lbOpts = secMode === "whitelist_strict" ? '' : '<option value="__NEW_USER__"' + (!matchedOnBoard ? ' selected' : '') + '>' + newLabel + '</option>';
  var myUid = AUTH_SESSION ? AUTH_SESSION.uid : "";
  for (var i = 0; i < allLb.length; i++) {
    var item = allLb[i];
    var sel = (matchedOnBoard && standardizeParticipantName(curLinked).toLowerCase() === standardizeParticipantName(item.name).toLowerCase()) ? " selected" : "";
    var claimed = secLive && !sel && isMemberClaimedByOther(item.name, myUid);
    lbOpts += '<option value="' + escapeHtml(item.name) + '"' + sel + (claimed ? ' disabled' : '') + '>' + (claimed ? '🔒 ' : '🏆 ') + escapeHtml(item.name) + ' (' + item.priorPts + ' pts • Rank ' + item.rank + ')' + (claimed ? ' · Claimed' : '') + '</option>';
  }

  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    var boundMeta = getProfileDisplayMeta(AUTH_SESSION.boundProfileKey);
    var isStrict = isAccountInstanceLocked();
    bodyEl.innerHTML =
      '<div style="background:var(--raised);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
          '<span style="font-size:0.86rem;font-weight:900;color:var(--win);">✅ Signed In & Instance Locked</span>' +
          '<span class="badge badge-ev">' + (AUTH_SESSION.provider.indexOf("google") !== -1 ? "🌐 Google Auth" : "📧 Email + Password") + '</span>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--text);margin-bottom:4px;"><strong>Account:</strong> ' + (AUTH_SESSION.email || AUTH_SESSION.displayName) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--text);margin-bottom:8px;"><strong>Bound Instance Profile:</strong> <span style="color:var(--text);font-weight:800;">' + escapeHtml(boundMeta.name) + '</span> (Prior: ' + (boundMeta.priorPts || 0) + ' pts • ' + (boundMeta.defaultRank || 'Pool') + ')</div>' +
        '<div style="font-size:0.72rem;color:var(--text);background:var(--bg);padding:8px;border-radius:8px;border:1px solid var(--border-muted);">' +
          '🛡️ <strong>How Your Isolated Instance Works:</strong><br>' +
          '• Your device is locked to <strong>' + escapeHtml(boundMeta.name) + '</strong> (plus your personal <strong>🧪 Test Sim</strong> sandbox).<br>' +
          '• Other users logging in on their phones/computers <strong>cannot switch your active profile</strong> or edit your picks.<br>' +
          '• Everyone else\'s picks still stream into your app live in real time for Head-to-Head comparison and Live CST grading!' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:10px;">' +
        '<label style="font-size:0.73rem;font-weight:800;color:var(--text);display:block;margin-bottom:4px;">🔗 Link to Existing Leaderboard Player (or keep as Custom/New Player):</label>' +
        '<select class="search-input" style="width:100%;padding:7px 9px;font-size:0.76rem;color:var(--win);" onchange="if(this.value && this.value !== \'__NEW_USER__\'){changeAuthenticatedLinkedMember(this.value);}">' + lbOpts + '</select>' +
      '</div>' +
      '<div style="background:var(--surface);border:1px solid var(--border-muted);border-radius:9px;padding:9px 11px;margin-bottom:12px;">' +
        '<div style="font-size:0.71rem;font-weight:800;color:var(--text);margin-bottom:5px;">✨ Not on the Leaderboard Yet? Set Your Custom Display Name & Starting Points:</div>' +
        '<div style="display:grid;grid-template-columns:1fr 95px auto;gap:6px;align-items:center;">' +
          '<input type="text" id="auth-edit-display-name" class="search-input" style="min-width:0;padding:6px 8px;font-size:0.76rem;" value="' + boundMeta.name.replace(/"/g, '&quot;') + '" placeholder="Your Display Name" />' +
          '<input type="number" id="auth-edit-prior-pts" class="search-input" style="min-width:0;padding:6px 8px;font-size:0.76rem;" value="' + (boundMeta.priorPts || 0) + '" placeholder="Prior Pts" title="Starting / Prior Season Points (0 for new players)" />' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:800;padding:6px 10px;" onclick="saveCustomInstanceDisplayName()">Save</button>' +
        '</div>' +
      '</div>' +
      '<div style="background:var(--panel-alt);padding:9px 11px;border-radius:9px;border:1px solid var(--border-muted);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<span style="font-size:0.73rem;color:var(--text);">🕵️ <strong>Pre-Kickoff Pick Privacy:</strong> ' + ((state.profilePrivacy[AUTH_SESSION.boundProfileKey] && state.profilePrivacy[AUTH_SESSION.boundProfileKey].hidden) ? '<strong style="color:var(--win);">🔒 Hidden From Other Users Until Kickoff</strong>' : '<strong style="color:var(--warn);">👁️ Public to Other Users</strong>') + '</span>' +
        '<button type="button" class="btn-sm" style="padding:4px 9px;font-size:0.69rem;border-color:var(--border);color:var(--text);" onclick="toggleQuickLockActiveProfile(); openAuthModal();">Toggle Privacy</button>' +
      '</div>' +
      // Editing another player's picks lives in Commissioner > Submissions (one entry point, logged).
      (!isVerifiedCommissioner() ? '' : '<div style="background:var(--raised);border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:12px;display:flex;flex-direction:column;gap:7px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-size:0.73rem;">' +
          '<span>To edit another player\'s picks or tiebreaker, use <strong>Commissioner › Submissions</strong>.</span>' +
          '<button type="button" class="btn-sm" onclick="openCommissionerModal(\'submissions\')">Open Submissions</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
          '<input type="email" id="commish-reset-email-input" class="search-input" style="flex:1;min-width:170px;padding:5px 8px;font-size:0.72rem;" placeholder="Player email to send a password reset..." />' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--win);font-size:0.69rem;padding:5px 9px;" onclick="commissionerResetPlayerPassword()">🔑 Reset Player Password</button>' +
        '</div>' +
      '</div>') +
      '<div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;">' +
        '<button type="button" class="btn-sm" style="background:var(--raised);border-color:var(--border);color:var(--loss);font-weight:800;padding:8px 14px;" onclick="signOutAccountInstance()">🚪 Sign Out of Instance</button>' +
        '<div style="display:flex;gap:6px;">' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--warn);font-weight:800;padding:8px 12px;" onclick="switchProfile(\'test\'); closeAuthModal();">🧪 My Sandbox Sim</button>' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;padding:8px 16px;" onclick="switchProfile(\'' + AUTH_SESSION.boundProfileKey + '\'); closeAuthModal();">🏈 Go to My Picks (' + boundMeta.shortName + ')</button>' +
        '</div>' +
      '</div>';
  } else {
    var isSignup = (AUTH_MODAL_MODE === "signup");
    bodyEl.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;background:var(--bg);padding:4px;border-radius:9px;border:1px solid var(--border-muted);">' +
        '<button type="button" class="btn-sm ' + (!isSignup ? 'active' : '') + '" style="text-align:center;font-weight:800;padding:7px;" onclick="setAuthModalMode(\'signin\')">🔑 Sign In</button>' +
        '<button type="button" class="btn-sm ' + (isSignup ? 'active' : '') + '" style="text-align:center;font-weight:800;padding:7px;" onclick="setAuthModalMode(\'signup\')">✨ Create Account (80+ Ready)</button>' +
      '</div>' +
      '<div style="margin-bottom:10px;background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:10px;">' +
        '<label style="font-size:0.72rem;font-weight:800;color:var(--win);display:block;margin-bottom:4px;">1️⃣ Are you on the current 89-player Leaderboard, or a Brand-New Player?</label>' +
        '<select id="auth-link-member-select" class="search-input" style="width:100%;padding:8px 10px;font-size:0.76rem;color:var(--win);border-color:var(--border);margin-bottom:6px;" onchange="handleAuthMemberSelectChange(this.value)">' + lbOpts + '</select>' +
        '<div id="auth-custom-name-wrap" style="display:' + (!matchedOnBoard ? 'block' : 'none') + ';">' +
          '<input type="text" id="auth-name-input" class="search-input" style="width:100%;padding:7px 10px;font-size:0.78rem;border-color:var(--border);" placeholder="Enter Your Display Name (or leave blank to use your Google Account name)" />' +
          '<div style="font-size:0.67rem;color:var(--text);margin-top:3px;">✨ Creates a brand-new isolated profile in Cloud Firestore, adds you to the live standings & H2H dropdowns for all users, and starts your picks sheet!</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr;gap:6px;">' +
        '<button type="button" class="google-auth-btn" onclick="signInWithGoogleAccount()">' +
          '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
          '<span>Continue with Google Sign-In</span>' +
        '</button>' +
      '</div>' +
      '<div class="auth-divider">or Email + Password</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +

        '<input type="email" id="auth-email-input" class="search-input" style="width:100%;padding:8px 10px;font-size:0.8rem;" placeholder="Email address (e.g. you@gmail.com)" onkeydown="if(event.key===\'Enter\'){submitEmailPasswordAuth();}" />' +
        '<input type="password" id="auth-password-input" class="search-input" style="width:100%;padding:8px 10px;font-size:0.8rem;" placeholder="Password (6+ characters)" onkeydown="if(event.key===\'Enter\'){submitEmailPasswordAuth();}" />' +
      '</div>' +
      '<div id="auth-modal-error" style="font-size:0.73rem;color:var(--loss);min-height:18px;margin:8px 0;font-weight:700;line-height:1.35;"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;">' +
        '<button type="button" class="btn-sm" style="font-size:0.69rem;color:var(--muted);" onclick="sendEmailPasswordReset()">Forgot Password?</button>' +
        '<button type="button" class="btn-sm" style="background:var(--raised);color:var(--text);border:none;font-weight:900;padding:9px 18px;font-size:0.8rem;" onclick="submitEmailPasswordAuth()">' +
          (isSignup ? '✨ Create Account & Lock Instance' : '🔐 Sign In & Lock Instance') +
        '</button>' +
      '</div>' +
      '<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border);font-size:0.69rem;color:var(--muted);">' +
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
    var bMeta = getProfileDisplayMeta(AUTH_SESSION.boundProfileKey);
    if (btn) {
      btn.textContent = "🔐 " + bMeta.shortName + (isLocked ? " (Locked Instance)" : " (Admin Mode)");
      btn.className = "btn-sm auth-pill-active";
    }
    if (instTag) {
      instTag.textContent = isLocked ? "" : "Admin";
    }
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML =
        '<span>🔐 Instance: <strong style="color:var(--win);">' + escapeHtml(bMeta.name) + '</strong> ' +
        (isLocked ? '<span style="color:var(--text);">(Isolated • Others Read-Only)</span>' : '<span style="color:var(--warn);">(👑 Admin Override)</span>') +
        '</span>' +
        '<div style="display:flex;gap:4px;">' +
          '<button type="button" class="btn-sm" style="padding:2px 6px;font-size:0.64rem;" onclick="switchProfile(\'' + (activeProfile === 'test' ? AUTH_SESSION.boundProfileKey : 'test') + '\')">' +
            (activeProfile === 'test' ? ('🏈 Back to ' + bMeta.shortName) : '🧪 Sandbox') +
          '</button>' +
          '<button type="button" class="btn-sm" style="padding:2px 6px;font-size:0.64rem;border-color:var(--border);color:var(--text);" onclick="openAuthModal()">⚙️ Manage</button>' +
        '</div>';
    }
  } else {
    if (btn) {
      btn.textContent = "🔐 Sign In / My Instance";
      btn.className = "btn-sm";
    }
    if (instTag) {
      instTag.textContent = "Guest";
    }
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML =
        '<span style="color:var(--text);">🔓 <strong>Shared Device Mode</strong> (Sign in to lock your own instance)</span>' +
        '<button type="button" class="btn-sm" style="padding:2px 8px;font-size:0.66rem;background:var(--raised);color:var(--text);border:none;font-weight:800;" onclick="openAuthModal()">🔐 Sign In / Register</button>';
    }
  }
}

function initState() {
  var saved = safeGetStorage("sat_week7_official_v14");
  if (saved) {
    try {
      var parsed = JSON.parse(saved);
      if (parsed.customGames && Array.isArray(parsed.customGames) && parsed.customGames.length > 0 && !isHardcodedWeek7Slate(parsed.customGames)) {
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
          if (parsed.liveScores[lk] && !parsed.liveScores[lk]._demo && (parsed.liveScores[lk].completed || parsed.liveScores[lk].inProgress)) {
            LIVE_SCORES[lk] = parsed.liveScores[lk];
          }
        }
        state.liveScores = LIVE_SCORES;
      }
    } catch (e) {}
  }
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
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
  // The shared_state listener delivers the current document immediately; a separate
  // get() here applied and rendered the same data a second time on every load.
  startFirebaseRealtimeListeners();
}

var AUTOSAVE_DELAY_MS = 2500;
var PENDING_SAVE_PROFILES = {};

function hasPendingProfileSave(profKey) {
  return !!PENDING_SAVE_PROFILES[profKey];
}

function flushPendingProfileSaves() {
  if (saveStateDebounceTimer) clearTimeout(saveStateDebounceTimer);
  saveStateDebounceTimer = null;
  var keys = Object.keys(PENDING_SAVE_PROFILES);
  PENDING_SAVE_PROFILES = {};
  keys.forEach(function(k) { pushProfileToFirebase(k); });
}

// Leaving or hiding the app (switching apps, locking the phone) saves right away.
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden") flushPendingProfileSaves();
});
window.addEventListener("pagehide", flushPendingProfileSaves);

function saveCurrentState(profOverride, debounceWrite) {
  var targetProf = profOverride || activeProfile;
  var tbEl = document.getElementById("tiebreaker-input");
  var slEl = document.getElementById("target-slider");
  if (tbEl && !(typeof isTiebreakerLocked === "function" && isTiebreakerLocked())) state[activeProfile].tiebreaker = tbEl.value;
  if (slEl) state[activeProfile].target = parseInt(slEl.value, 10);
  state.customGames = GAMES;

  if (debounceWrite) {
    // Picks save to this device at once and to Firestore once taps pause (every write is
    // re-read by every open phone, so one write per burst instead of one per tap).
    safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
    PENDING_SAVE_PROFILES[targetProf] = true;
    if (saveStateDebounceTimer) clearTimeout(saveStateDebounceTimer);
    saveStateDebounceTimer = setTimeout(flushPendingProfileSaves, AUTOSAVE_DELAY_MS);
  } else {
    delete PENDING_SAVE_PROFILES[targetProf];
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
    var targetMeta = getProfileDisplayMeta(prof);
    setCompareTarget(prof);
    showAppToast("⚔️ Comparing against " + targetMeta.name + " (Read-Only). To switch accounts, use 🔐 Account Sign-In.");
    return;
  }
  activeProfile = prof;
  if (state.compareTargetKey === prof) { state.compareTargetKey = ""; safeSetStorage(COMPARE_TARGET_STORAGE_KEY, ""); }
  saveDeviceAuthSession();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  showAppToast(prof === "test" ? "🧪 Switched to your personal Sandbox Simulator" : ("🏈 Switched to your Official Picks (" + getProfileDisplayMeta(prof).name + ")"));
}

function copyOtherProfile() {
  var cmpDesc = resolveCompareTargetDescriptor();
  if (!cmpDesc) { showAppToast("Choose someone to compare with first."); return; }
  var sourceName = cmpDesc.name;
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
  if (isWeekLockedForActiveProfile() && activeProfile !== "test") {
    showAppToast("🔒 Picks are locked for the week.");
    return;
  }
  var copy = {};
  for (var k in sourcePicks) copy[k] = sourcePicks[k];
  keepLockedGamePicks(copy, state[activeProfile].picks || {});
  state[activeProfile].picks = copy;
  saveCurrentState(activeProfile);
  renderAll();
  showAppToast("📥 Copied picks from " + sourceName + " into " + getProfileDisplayMeta(activeProfile).name + "!");
}

// Games that are locked (kickoff, deadline or commissioner) keep the profile's current pick
// when a bulk action (copy, preset) fills the rest. The sandbox ignores locks, as in pickSide.
function keepLockedGamePicks(nextPicks, currentPicks) {
  if (activeProfile === "test") return;
  for (var i = 0; i < GAMES.length; i++) {
    var id = GAMES[i].id;
    if (!isGameLockedByCommissioner(id)) continue;
    if (currentPicks[id] !== undefined) nextPicks[id] = currentPicks[id];
    else delete nextPicks[id];
  }
}

function applyPreset(type) {
  if (isWeekLockedForActiveProfile() && activeProfile !== "test") {
    showAppToast("🔒 Picks are locked for the week.");
    return;
  }
  lastLocalPickTs = Date.now();
  clearDeletedFlagForProfile(activeProfile);
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (activeProfile !== "test" && isGameLockedByCommissioner(g.id)) continue;
    if (type === "optimal") {
      state[activeProfile].picks[g.id] = g.rec;
    } else if (type === "safe" || type === "chalk") {
      state[activeProfile].picks[g.id] = getTeamWinProb(g, "away") > getTeamWinProb(g, "home") ? g.away : g.home;
    } else if (type === "aggressive") {
      var dog = g.awayPts > 1 ? g.away : (g.homePts > 1 ? g.home : null);
      var dogProb = dog === g.away ? getTeamWinProb(g, "away") : getTeamWinProb(g, "home");
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

