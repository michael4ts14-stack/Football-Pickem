// ============================================================================
// ACCOUNT & ROSTER LINKING SECURITY
// Who may play which pool player:
// - pickem_v14_bindings/{profileKey}: the one account (uid) bound to a player. firestore.rules
//   only let that account (or a commissioner) change the player's picks.
// - An email the commissioner registered for a roster player (playerEmailsMap) links at once.
// - Anything else is a link request (pickem_v14_link_requests/{uid}) the commissioner approves.
// - commissionerConfig.securityConfig.registrationMode: "midseason_protected" (default),
//   "invite_code_required" (league invite code, new players may add themselves) or
//   "whitelist_strict" (pre-registered emails only).
// - commissionerConfig.blockedUsers: { uid: { email, name, blockedAt } }.
// Everything here stays off until the rules that know about bindings are published
// (ACCOUNT_SECURITY_LIVE), so the app works the same with the older rules.
// ============================================================================
var BOUND_ACCOUNTS = {};           // profileKey -> binding doc
var BOUND_ACCOUNTS_READY = null;   // promise for the first load
var ACCOUNT_SECURITY_LIVE = false; // the bindings collection is readable = new rules are live
var MY_LINK_REQUEST = null;        // this account's request, when it has one
var LINK_REQUESTS = [];            // commissioner: every request
var LINK_REQUESTS_WATCHING = false;
var MY_LINK_REQUEST_WATCH = null;
var INVITE_CODE_CACHE = null;      // commissioner: { code }
var JOIN_CODE_STORAGE_KEY = "sat_join_code_v1";

var REGISTRATION_MODES = {
  midseason_protected: { label: "Protected (this season)", sub: "New sign-ins link to an existing roster player: instantly if their email is registered, otherwise after you approve. Nobody adds a new player on their own." },
  invite_code_required: { label: "Invite code (new season)", sub: "Everyone enters the league invite code first. New players can then add themselves; claiming a roster player still needs a registered email or your approval." },
  whitelist_strict: { label: "Registered emails only", sub: "Only emails you registered for a roster player can link. Everyone else sees a private-pool notice." }
};

function getSecurityConfig() {
  var cfg = ensureCommissionerConfig();
  if (!cfg.securityConfig || typeof cfg.securityConfig !== "object") cfg.securityConfig = {};
  if (!REGISTRATION_MODES[cfg.securityConfig.registrationMode]) cfg.securityConfig.registrationMode = "midseason_protected";
  if (!cfg.blockedUsers || typeof cfg.blockedUsers !== "object") cfg.blockedUsers = {};
  return cfg.securityConfig;
}

function memberLowOf(name) {
  return standardizeParticipantName(name || "").toLowerCase();
}

// The profile key resolveOrCreateProfileForMember (auth.js) gives a roster name, without creating it.
function profileKeyForMember(name) {
  var low = memberLowOf(name);
  if (!low) return "";
  if (low === "michael a" || low === "michael") return "michael";
  if (low === "kinyion c" || low === "kinyion") return "kinyion";
  var pf = getProfileLinkedToMemberName(name);
  if (pf && !pf.isSandbox) return pf.key;
  return "u_" + (low.replace(/[^a-z0-9]/g, "") || "user");
}

function isRosterMemberName(name) {
  return !!(name && (findLeaderboardEntryByName(name) || findPoolMemberByName(name)));
}

function rosterDisplayName(name) {
  var hit = findLeaderboardEntryByName(name) || findPoolMemberByName(name);
  return hit ? standardizeParticipantName(hit.name) : standardizeParticipantName(name);
}

function bindingOwnerUid(profKey) {
  var b = BOUND_ACCOUNTS[profKey];
  return b ? String(b.uid || "") : "";
}

function ownedProfileKeys(uid) {
  return Object.keys(BOUND_ACCOUNTS).filter(function(k) { return uid && BOUND_ACCOUNTS[k].uid === uid; });
}

// A roster name is claimed when its profile is bound to some account other than `uid`.
function isMemberClaimedByOther(name, uid) {
  var owner = bindingOwnerUid(profileKeyForMember(name));
  return !!owner && owner !== uid;
}

// Roster player whose registered email (commissioner's playerEmailsMap) is this address.
function memberForRegisteredEmail(email) {
  var map = ensureCommissionerConfig().playerEmailsMap || {};
  var want = String(email || "").trim().toLowerCase();
  if (!want) return "";
  for (var low in map) {
    if (String(map[low] || "").trim().toLowerCase() === want && isRosterMemberName(low)) return rosterDisplayName(low);
  }
  return "";
}

function isAccountBlocked(uid, email) {
  var blocked = ensureCommissionerConfig().blockedUsers || {};
  if (uid && blocked[uid]) return true;
  var e = String(email || "").toLowerCase();
  return !!e && Object.keys(blocked).some(function(k) { return String((blocked[k] || {}).email || "").toLowerCase() === e; });
}

// ---------- Bindings: load once, then live ----------
function loadBoundAccounts() {
  if (BOUND_ACCOUNTS_READY) return BOUND_ACCOUNTS_READY;
  BOUND_ACCOUNTS_READY = new Promise(function(resolve) {
    if (typeof fsDb === "undefined" || !fsDb) { resolve(false); return; }
    var first = true;
    try {
      // quiet: older rules have no bindings collection, so this failure is expected there.
      listenWithRetry("account links", function(ok, err) {
        fsDb.collection("pickem_v14_bindings").onSnapshot(ok, err);
      }, function(snap) {
        var next = {};
        snap.forEach(function(d) { next[d.id] = d.data() || {}; });
        var prev = BOUND_ACCOUNTS;
        BOUND_ACCOUNTS = next;
        ACCOUNT_SECURITY_LIVE = true;
        if (first) { first = false; resolve(true); return; }
        onBoundAccountsChanged(prev);
      }, { quiet: true, onError: function() {
        // Older rules have no bindings collection: leave linking as it was.
        ACCOUNT_SECURITY_LIVE = false;
        if (first) { first = false; resolve(false); }
      } });
    } catch (e) { resolve(false); }
  });
  return BOUND_ACCOUNTS_READY;
}

// A binding appeared for this unlinked account (the commissioner approved it): link now.
function onBoundAccountsChanged(prev) {
  // The commissioner unlinked or reassigned this device's player: drop to the unlinked state
  // instead of leaving a session whose saves are denied.
  var bk = AUTH_SESSION && AUTH_SESSION.boundProfileKey;
  if (bk && prev && prev[bk] && prev[bk].uid === AUTH_SESSION.uid && (!BOUND_ACCOUNTS[bk] || BOUND_ACCOUNTS[bk].uid !== AUTH_SESSION.uid)) {
    enterUnlinkedAccountSession({ uid: AUTH_SESSION.uid, email: AUTH_SESSION.email, displayName: AUTH_SESSION.displayName, provider: AUTH_SESSION.provider }, { status: "choose", memberName: "" });
    showAppToast("The commissioner changed your player link. Pick your player again or ask them.");
    return;
  }
  if (AUTH_SESSION && !AUTH_SESSION.boundProfileKey && AUTH_SESSION.uid && ownedProfileKeys(AUTH_SESSION.uid).length) {
    var key = ownedProfileKeys(AUTH_SESSION.uid)[0];
    var b = BOUND_ACCOUNTS[key];
    var fbUser = fbAuth && fbAuth.currentUser;
    bindAuthenticatedAccountToProfile({
      uid: AUTH_SESSION.uid, email: AUTH_SESSION.email, displayName: AUTH_SESSION.displayName,
      emailVerified: fbUser ? fbUser.emailVerified : false, provider: AUTH_SESSION.provider
    }, b.memberName || "").then(function() {
      if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) showAppToast("The commissioner linked your account to " + fixDisplaySpelling(AUTH_SESSION.linkedMemberName || b.memberName || "your player") + ".");
    });
  }
  renderAccountSecurityBits();
}

// Writes a binding only if the doc is absent, already this uid's, or still held by the owner the
// caller saw (expectedUid), so two writers can't silently overwrite each other's owner.
function setBindingGuarded(profKey, data, expectedUid) {
  var ref = fsDb.collection("pickem_v14_bindings").doc(profKey);
  return fsDb.runTransaction(function(tx) {
    return tx.get(ref).then(function(snap) {
      var cur = snap.exists ? String((snap.data() || {}).uid || "") : "";
      if (cur && cur !== data.uid && cur !== (expectedUid || "")) {
        var err = new Error("binding-changed");
        err.code = "binding-changed";
        throw err;
      }
      tx.set(ref, data);
    });
  });
}

async function recordAccountBinding(profKey, memberName, verifiedBy, who) {
  if (!ACCOUNT_SECURITY_LIVE || !fsDb || !profKey || bindingOwnerUid(profKey)) return true;
  var b = {
    uid: who.uid, email: String(who.email || "").toLowerCase(), displayName: who.displayName || memberName,
    memberName: memberName, memberLow: memberLowOf(memberName), boundAt: new Date().toISOString(), verifiedBy: verifiedBy
  };
  try {
    await setBindingGuarded(profKey, b, "");
    BOUND_ACCOUNTS[profKey] = b;
    return true;
  } catch (e) {
    showAppToast("Couldn't record your account link (" + ((e && e.code) || "error") + "). Your picks may not save; tell the commissioner.");
    return false;
  }
}

async function readLegacyOwner(profKey) {
  try {
    var snap = await fsDb.collection("pickem_v14_users").doc(profKey).get();
    return snap && snap.exists ? String((snap.data() || {}).ownerUid || "") : "";
  } catch (e) { return ""; }
}

function isMineOwnerValue(owner, uid, email) {
  if (!owner) return false;
  var e = String(email || "").toLowerCase();
  return owner === uid || owner === e || owner === "email_" + e.replace(/[^a-z0-9]/g, "_");
}

// ---------- The gate: may this account play `targetMember`? ----------
// Returns { ok: true, memberName, needsBinding?, checked: true } to link, or
// { ok: false, status, memberName, message } to leave the account signed in but unlinked.
async function gateAccountLink(who, targetMember, explicitChoice) {
  await loadBoundAccounts();
  var uid = who.uid, email = String(who.email || "").toLowerCase();
  // A removed (archived) player stays removed until a commissioner restores it.
  if (targetMember && isProfileArchived(profileKeyForMember(targetMember)) && !isCommissionerAccountEmail(email, who.emailVerified)) {
    return { ok: false, status: "archived", memberName: targetMember };
  }
  if (!ACCOUNT_SECURITY_LIVE) return { ok: true, memberName: targetMember };
  var mode = getSecurityConfig().registrationMode;

  if (isAccountBlocked(uid, email)) return { ok: false, status: "blocked", memberName: targetMember };
  if (isCommissionerAccountEmail(email, who.emailVerified)) return gateCommissionerLink(uid, email, targetMember, explicitChoice);

  var owned = ownedProfileKeys(uid);
  var ownedMember = owned.length ? (BOUND_ACCOUNTS[owned[0]].memberName || getLinkedMemberNameForProfile(owned[0])) : "";

  // A registered email goes straight to its roster player unless the person picked another.
  var emailMember = memberForRegisteredEmail(email);
  if (emailMember && !explicitChoice && !owned.length) targetMember = emailMember;
  if (!targetMember) targetMember = ownedMember || who.displayName || email.split("@")[0];

  var key = profileKeyForMember(targetMember);
  var owner = bindingOwnerUid(key);
  if (owner === uid) return { ok: true, memberName: targetMember, checked: true };

  var onRoster = isRosterMemberName(targetMember);
  if (owner && owner !== uid) {
    if (ownedMember) {
      if (explicitChoice) showAppToast(fixDisplaySpelling(rosterDisplayName(targetMember)) + " is already claimed by another account. You're still on " + fixDisplaySpelling(ownedMember) + ".");
      return { ok: true, memberName: ownedMember, checked: true };
    }
    return { ok: false, status: "claimed", memberName: rosterDisplayName(targetMember) };
  }

  // Unbound from here on.
  // 1. The pick doc already named this account as its owner (before bindings existed).
  if (isMineOwnerValue(await readLegacyOwner(key), uid, email)) {
    return { ok: true, memberName: targetMember, needsBinding: "legacy_owner", checked: true };
  }
  // 2. The commissioner registered this email for this roster player.
  if (onRoster && emailMember && memberLowOf(emailMember) === memberLowOf(targetMember)) {
    if (who.emailVerified) return { ok: true, memberName: targetMember, needsBinding: "email_match", checked: true };
    if (!owned.length) return { ok: false, status: "verify_email", memberName: rosterDisplayName(targetMember) };
  }
  // 3. Already playing someone: a new name doesn't make a new player (a renamed account or a
  //    second device stays on its player); another roster player becomes a request.
  if (ownedMember) {
    if (onRoster && explicitChoice) {
      var filed = await fileLinkRequest(who, targetMember, key, false);
      if (filed) showAppToast("Asked the commissioner to also link " + fixDisplaySpelling(rosterDisplayName(targetMember)) + " to your account. You're still on " + fixDisplaySpelling(ownedMember) + ".");
    } else if (explicitChoice && memberLowOf(targetMember) !== memberLowOf(ownedMember)) {
      showAppToast("Your account stays linked to " + fixDisplaySpelling(ownedMember) + ". Ask the commissioner to change your player or name.");
    }
    return { ok: true, memberName: ownedMember, checked: true };
  }
  // 4. Not linked to anyone yet.
  if (mode === "whitelist_strict") return { ok: false, status: "whitelist", memberName: targetMember };
  if (mode === "invite_code_required" && !(await ensureInvitePass(uid))) {
    return { ok: false, status: "needs_invite", memberName: targetMember };
  }
  if (!onRoster && mode === "invite_code_required") {
    return { ok: true, memberName: targetMember, needsBinding: "self_new", checked: true };
  }
  await fileLinkRequest(who, targetMember, key, !onRoster);
  return { ok: false, status: "pending", memberName: onRoster ? rosterDisplayName(targetMember) : standardizeParticipantName(targetMember), isNewPlayer: !onRoster };
}

// Commissioners skip approval, but signing in still lands on their own player: the one already
// bound to them, else the one their email is registered for. Only a deliberate choice moves them,
// and never onto a player bound to someone else (they edit other players from the console).
function gateCommissionerLink(uid, email, targetMember, explicitChoice) {
  var owned = ownedProfileKeys(uid);
  var emailMember = memberForRegisteredEmail(email);
  var home = "";
  if (owned.length) {
    var emailKey = emailMember ? profileKeyForMember(emailMember) : "";
    var homeKey = owned.indexOf(emailKey) !== -1 ? emailKey : owned[0];
    home = BOUND_ACCOUNTS[homeKey].memberName || getLinkedMemberNameForProfile(homeKey);
  } else if (emailMember) {
    home = emailMember;
  }
  var target = (explicitChoice && targetMember) ? targetMember : (home || targetMember);
  var owner = bindingOwnerUid(profileKeyForMember(target));
  if (owner && owner !== uid) {
    if (explicitChoice) showAppToast(fixDisplaySpelling(rosterDisplayName(target)) + " is linked to another account. Edit their picks from Commissioner › Submissions.");
    target = home || "";
    owner = target ? bindingOwnerUid(profileKeyForMember(target)) : "";
    if (!target) return { ok: false, status: "choose", memberName: "" };
  }
  return { ok: true, memberName: target, checked: true, needsBinding: (target && !owner) ? "commish_approved" : "" };
}

// Same list as isVerifiedCommissioner (commissioner-admin.js), before AUTH_SESSION exists.
function isCommissionerAccountEmail(email, verified) {
  if (!verified || !email || /@separatedatturt\.com$/.test(email)) return false;
  var cfg = ensureCommissionerConfig();
  var primary = String(cfg.primaryCommissionerEmail || "commissioner@separatedatturf.com").toLowerCase();
  if (email === primary || email === "michael4ts14@gmail.com" || email === "commissioner@separatedatturf.com") return true;
  var rec = (cfg.authorizedCommissioners || {})[email];
  return !!(rec && rec.enabled !== false);
}

// ---------- Link requests (player side) ----------
async function fileLinkRequest(who, memberName, key, isNewPlayer) {
  if (!fsDb || !who.uid) return false;
  var req = {
    uid: who.uid, authEmail: String(who.email || "").toLowerCase(), authDisplayName: who.displayName || "",
    requestedMember: isNewPlayer ? standardizeParticipantName(memberName) : rosterDisplayName(memberName),
    requestedMemberLow: memberLowOf(memberName), requestedPlayerKey: key, isNewPlayer: !!isNewPlayer,
    requestedAt: new Date().toISOString(), status: "pending"
  };
  try {
    await fsDb.collection("pickem_v14_link_requests").doc(who.uid).set(req);
    MY_LINK_REQUEST = req;
    return true;
  } catch (e) {
    MY_LINK_REQUEST = null;
    return false;
  }
}

function watchMyLinkRequest(uid) {
  if (MY_LINK_REQUEST_WATCH || !fsDb || !uid) return;
  try {
    MY_LINK_REQUEST_WATCH = fsDb.collection("pickem_v14_link_requests").doc(uid).onSnapshot(function(d) {
      MY_LINK_REQUEST = d && d.exists ? d.data() : null;
      if (AUTH_SESSION && !AUTH_SESSION.boundProfileKey && AUTH_SESSION.linkState) {
        if (MY_LINK_REQUEST && MY_LINK_REQUEST.status === "rejected") AUTH_SESSION.linkState.status = "rejected";
        renderAccountSecurityBits();
      }
    }, function() {});
  } catch (e) {}
}

function cancelMyLinkRequest() {
  if (!AUTH_SESSION || !fsDb) return;
  fsDb.collection("pickem_v14_link_requests").doc(AUTH_SESSION.uid).delete().then(function() {
    MY_LINK_REQUEST = null;
    if (AUTH_SESSION && AUTH_SESSION.linkState) AUTH_SESSION.linkState.status = "choose";
    showAppToast("Request cancelled. Choose your player again.");
    renderAccountSecurityBits();
    openAuthModal();
  }, function() { showAppToast("Couldn't cancel the request. Try again."); });
}

// Pick a (different) roster player while unlinked.
function requestLinkToMember(name) {
  if (!AUTH_SESSION || !name) return;
  var fbUser = fbAuth && fbAuth.currentUser;
  bindAuthenticatedAccountToProfile({
    uid: AUTH_SESSION.uid, email: AUTH_SESSION.email, displayName: AUTH_SESSION.displayName,
    emailVerified: fbUser ? fbUser.emailVerified : false, provider: AUTH_SESSION.provider
  }, name).then(function() {
    if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) { closeAuthModal(); showAppToast("Linked to " + fixDisplaySpelling(AUTH_SESSION.linkedMemberName) + "."); }
    else openAuthModal();
  });
}

async function recheckEmailVerification() {
  var u = fbAuth && fbAuth.currentUser;
  if (!u) return;
  try { await u.reload(); await u.getIdToken(true); } catch (e) {}
  u = fbAuth.currentUser;
  if (!u.emailVerified) { showAppToast("Not verified yet. Open the link in the email we sent to " + u.email + "."); return; }
  requestLinkToMember(AUTH_SESSION && AUTH_SESSION.linkState ? AUTH_SESSION.linkState.memberName : "");
}

function resendVerificationEmail() {
  var u = fbAuth && fbAuth.currentUser;
  if (!u) return;
  u.sendEmailVerification().then(function() { showAppToast("Verification email sent to " + u.email + "."); }, function(e) { showAppToast("Couldn't send it (" + ((e && e.code) || "error") + ")."); });
}

// ---------- Invite code (player side) ----------
// The code lives in a commissioner-only doc; firestore.rules accept the invite pass only when
// the entered code matches, so a wrong code simply fails to save.
async function ensureInvitePass(uid) {
  if (!fsDb || !uid) return false;
  try {
    var snap = await fsDb.collection("pickem_v14_invite_passes").doc(uid).get();
    if (snap && snap.exists) return true;
  } catch (e) {}
  var code = safeGetStorage(JOIN_CODE_STORAGE_KEY) || "";
  return code ? await submitInviteCodeValue(uid, code) : false;
}

async function submitInviteCodeValue(uid, code) {
  code = String(code || "").trim();
  if (!code) return false;
  try {
    await fsDb.collection("pickem_v14_invite_passes").doc(uid).set({ code: code, at: new Date().toISOString() });
    safeSetStorage(JOIN_CODE_STORAGE_KEY, "");
    return true;
  } catch (e) { return false; }
}

async function submitInviteCodeFromModal() {
  var inp = document.getElementById("acct-invite-code");
  var msg = document.getElementById("acct-invite-msg");
  if (!AUTH_SESSION || !inp) return;
  var ok = await submitInviteCodeValue(AUTH_SESSION.uid, inp.value);
  if (!ok) { if (msg) msg.textContent = "That code didn't work. Check it with the commissioner."; return; }
  requestLinkToMember((AUTH_SESSION.linkState && AUTH_SESSION.linkState.memberName) || AUTH_SESSION.displayName);
}

// ?joinCode=... in the invite link: keep it for when this person signs in.
(function captureJoinCode() {
  try {
    var m = /[?&]joinCode=([^&#]+)/.exec(window.location.search || "");
    if (m) safeSetStorage(JOIN_CODE_STORAGE_KEY, decodeURIComponent(m[1]));
  } catch (e) {}
})();

// ---------- Signed in but not linked to a player: watch-only ----------
function enterUnlinkedAccountSession(who, gate) {
  AUTH_SESSION = {
    uid: who.uid, email: who.email, displayName: who.displayName, provider: who.provider,
    boundProfileKey: "", linkedMemberName: "", linkedEntries: [], instanceLocked: true, adminUnlock: false,
    linkState: { status: gate.status, memberName: gate.memberName || "", isNewPlayer: !!gate.isNewPlayer },
    signedInAt: new Date().toISOString()
  };
  // Picks made here stay in the device sandbox; nothing is saved to any player.
  GUEST_BROWSING_MODE = true;
  if (!state.test) state.test = { picks: {}, tiebreaker: "28-24", target: 20, linkedMemberName: "" };
  activeProfile = "test";
  saveDeviceAuthSession();
  watchMyLinkRequest(who.uid);
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  var bd = document.getElementById("auth-modal-backdrop");
  if (gate.status !== "claimed" || (bd && bd.style.display === "flex")) openAuthModal();
}

function isUnlinkedAccountSession() {
  return !!(AUTH_SESSION && !AUTH_SESSION.boundProfileKey && AUTH_SESSION.linkState);
}

function unlinkedRosterOptionsHtml(selectedName) {
  var seen = {}, names = [];
  (state.leaderboard || []).concat(state.poolMembers || []).forEach(function(r) {
    var n = r && r.name ? standardizeParticipantName(r.name) : "";
    if (!n || seen[n.toLowerCase()]) return;
    seen[n.toLowerCase()] = true;
    names.push(n);
  });
  names.sort(function(a, b) { return fixDisplaySpelling(a).localeCompare(fixDisplaySpelling(b)); });
  var sel = memberLowOf(selectedName);
  return '<option value="">Choose your name…</option>' + names.map(function(n) {
    var claimed = isMemberClaimedByOther(n, AUTH_SESSION && AUTH_SESSION.uid);
    return '<option value="' + escapeShellHtml(n) + '"' + (claimed ? ' disabled' : '') + (memberLowOf(n) === sel ? ' selected' : '') + '>' +
      escapeShellHtml(fixDisplaySpelling(n)) + (claimed ? ' · 🔒 Claimed' : '') + '</option>';
  }).join("");
}

function unlinkedAccountModalHtml() {
  var ls = AUTH_SESSION.linkState || {};
  var who = escapeShellHtml(AUTH_SESSION.email || AUTH_SESSION.displayName || "your account");
  var player = escapeShellHtml(fixDisplaySpelling(ls.memberName || ""));
  var status = (ls.status === "pending" && MY_LINK_REQUEST && MY_LINK_REQUEST.status === "rejected") ? "rejected" : ls.status;
  var card = function(title, body) {
    return '<div class="acct-link-card"><div class="acct-link-title">' + title + '</div><div class="acct-link-body">' + body + '</div></div>';
  };
  var chooser =
    '<label class="acct-link-label" for="acct-link-member">' + (status === "pending" ? 'Tapped the wrong name?' : 'Which player are you?') + '</label>' +
    '<div class="acct-link-row"><select id="acct-link-member" class="search-input">' + unlinkedRosterOptionsHtml(status === "claimed" ? "" : ls.memberName) + '</select>' +
    '<button type="button" class="btn-sm" onclick="requestLinkToMember(document.getElementById(\'acct-link-member\').value)">' + (status === "pending" ? 'Request this one' : 'Request link') + '</button></div>';
  var html = "";
  if (status === "pending") {
    html = card("⏳ Link request sent",
      'Waiting for the commissioner to approve linking <strong>' + who + '</strong> to ' + (ls.isNewPlayer ? 'a new player named ' : 'leaderboard player ') + '<strong>' + player + '</strong>. ' +
      'Until then you can look around and try picks on this device, but nothing is saved to ' + (player || 'that player') + '.') +
      chooser +
      '<button type="button" class="btn-sm acct-link-wide" onclick="cancelMyLinkRequest()">Cancel my request</button>';
  } else if (status === "rejected") {
    html = card("Link request declined", 'The commissioner didn\'t approve linking <strong>' + who + '</strong> to <strong>' + player + '</strong>. If that\'s a mistake, contact the commissioner, or choose your correct name.') + chooser;
  } else if (status === "claimed") {
    html = card("🔒 Already claimed", '<strong>' + player + '</strong> is already linked to another account. If that\'s you, ask the commissioner to move it to <strong>' + who + '</strong>.') + chooser;
  } else if (status === "verify_email") {
    html = card("Confirm your email", 'This email is registered for <strong>' + player + '</strong>. Open the verification link we emailed to <strong>' + who + '</strong>, then tap Done.') +
      '<div class="acct-link-row"><button type="button" class="btn-sm" onclick="recheckEmailVerification()">Done, I verified</button><button type="button" class="btn-sm" onclick="resendVerificationEmail()">Send it again</button></div>';
  } else if (status === "needs_invite") {
    html = card("League invite code", 'This pool needs the invite code from the commissioner before <strong>' + who + '</strong> can join.') +
      '<div class="acct-link-row"><input type="text" id="acct-invite-code" class="search-input" autocomplete="off" autocapitalize="characters" placeholder="Invite code" onkeydown="if(event.key===\'Enter\'){submitInviteCodeFromModal();}" />' +
      '<button type="button" class="btn-sm" onclick="submitInviteCodeFromModal()">Join</button></div><p class="muted-note" id="acct-invite-msg"></p>';
  } else if (status === "whitelist") {
    html = card("Private football pool", 'Contact the commissioner to be added. They need to register <strong>' + who + '</strong> for your player.');
  } else if (status === "blocked") {
    html = card("Account not allowed", '<strong>' + who + '</strong> can\'t join this pool. Contact the commissioner if this is a mistake.');
  } else if (status === "archived") {
    html = card("Player removed", '<strong>' + player + '</strong> was removed from the pool by the commissioner. Ask them to restore it, or link to your roster name.') + chooser;
  } else {
    html = chooser;
  }
  return '<div class="acct-link">' + html +
    '<button type="button" class="btn-sm acct-link-wide" onclick="signOutAccountInstance()">Sign out</button></div>';
}

// The auth modal shows the link status while the account isn't linked.
var _acctPrevOpenAuthModal = openAuthModal;
openAuthModal = function() {
  if (!isUnlinkedAccountSession()) return _acctPrevOpenAuthModal.apply(this, arguments);
  var bd = document.getElementById("auth-modal-backdrop");
  var body = document.getElementById("auth-modal-body");
  if (!bd || !body) return;
  body.innerHTML = unlinkedAccountModalHtml();
  bd.style.display = "flex";
};

// Picks strip: a short status line instead of "Picking as a guest".
var _acctPrevGuestBar = renderSimpleGuestAccountBar;
renderSimpleGuestAccountBar = function() {
  var r = _acctPrevGuestBar.apply(this, arguments);
  var el = document.getElementById("simple-guest-account-strip");
  if (el && isUnlinkedAccountSession()) {
    var st = AUTH_SESSION.linkState.status;
    var txt = st === "pending" ? "⏳ Waiting for the commissioner to link you to " + fixDisplaySpelling(AUTH_SESSION.linkState.memberName) + ". Picks here aren't saved."
      : st === "blocked" ? "This account can't join the pool."
      : st === "archived" ? "This player was removed by the commissioner. Picks here aren't saved."
      : st === "whitelist" ? "Private pool: contact the commissioner to be added."
      : "Your account isn't linked to a player yet. Picks here aren't saved.";
    el.innerHTML = '<span>' + escapeShellHtml(txt) + '</span><span class="account-note-links"><button type="button" class="link-btn" onclick="openAuthModal()">Details</button></span>';
  }
  return r;
};

// An unlinked account is a guest for picks: its only profile is the device sandbox.
var _acctPrevMyKey = getMyInstanceProfileKey;
getMyInstanceProfileKey = function() {
  if (isUnlinkedAccountSession()) return "test";
  return _acctPrevMyKey.apply(this, arguments);
};

var _acctPrevSignOut = signOutAccountInstance;
signOutAccountInstance = function() {
  if (MY_LINK_REQUEST_WATCH) { try { MY_LINK_REQUEST_WATCH(); } catch (e) {} MY_LINK_REQUEST_WATCH = null; }
  MY_LINK_REQUEST = null;
  return _acctPrevSignOut.apply(this, arguments);
};

// Cloud saves only for profiles this account is bound to (or anything, for a commissioner).
function canSaveProfileToCloud(profKey) {
  if (!AUTH_SESSION || !AUTH_SESSION.boundProfileKey) return false;
  if (isVerifiedCommissioner()) return true;
  if (!ACCOUNT_SECURITY_LIVE) return true;
  return bindingOwnerUid(profKey) === AUTH_SESSION.uid;
}

// ============================================================================
// COMMISSIONER: approval queue, roster link status, blocked accounts, league access
// ============================================================================
function startLinkRequestWatch() {
  if (LINK_REQUESTS_WATCHING || !fsDb || !isVerifiedCommissioner()) return;
  LINK_REQUESTS_WATCHING = true;
  try {
    fsDb.collection("pickem_v14_link_requests").onSnapshot(function(snap) {
      LINK_REQUESTS = snap.docs.map(function(d) { return Object.assign({ claimId: d.id }, d.data()); });
      LINK_REQUESTS.sort(function(a, b) { return String(b.requestedAt).localeCompare(String(a.requestedAt)); });
      renderAccountSecurityBits();
      var bd = document.getElementById("commish-modal-backdrop");
      if (bd && bd.style.display === "flex" && (ACTIVE_COMMISH_TAB === "roster" || ACTIVE_COMMISH_TAB === "submissions")) renderCommissionerModalBody();
    }, function() { LINK_REQUESTS_WATCHING = false; });
  } catch (e) { LINK_REQUESTS_WATCHING = false; }
}

function pendingLinkRequests() {
  return LINK_REQUESTS.filter(function(r) { return r.status === "pending"; });
}

function pendingRequestForMember(name) {
  var low = memberLowOf(name);
  return pendingLinkRequests().filter(function(r) { return r.requestedMemberLow === low; })[0] || null;
}

function findLinkRequest(uid) {
  return LINK_REQUESTS.filter(function(r) { return r.claimId === uid; })[0] || null;
}

async function approveLinkRequest(uid) {
  if (!assertCommissionerRole("approving account links")) return;
  var r = findLinkRequest(uid);
  if (!r) return;
  var key = r.requestedPlayerKey || profileKeyForMember(r.requestedMember);
  var owner = bindingOwnerUid(key);
  if (owner && owner !== r.uid) {
    showAppToast(fixDisplaySpelling(r.requestedMember) + " is linked to another account. Unlink it first.");
    return;
  }
  try {
    await setBindingGuarded(key, {
      uid: r.uid, email: r.authEmail, displayName: r.authDisplayName || r.requestedMember, memberName: r.requestedMember,
      memberLow: r.requestedMemberLow || memberLowOf(r.requestedMember), boundAt: new Date().toISOString(), verifiedBy: "commish_approved"
    }, "");
    await fsDb.collection("pickem_v14_link_requests").doc(uid).delete();
  } catch (e) {
    showAppToast("Couldn't approve (" + ((e && e.code) || "error") + "). Are the latest Firestore rules published?");
    return;
  }
  if (!r.isNewPlayer && r.authEmail) {
    ensureCommissionerConfig().playerEmailsMap[r.requestedMemberLow || memberLowOf(r.requestedMember)] = r.authEmail;
    saveCommissionerConfigToCloud();
  }
  showAppToast("Linked " + r.authEmail + " to " + fixDisplaySpelling(r.requestedMember) + ".");
  renderCommissionerModalBody();
}

function rejectLinkRequest(uid, block) {
  if (!assertCommissionerRole("rejecting account links")) return;
  var r = findLinkRequest(uid);
  if (!r) return;
  var go = function() {
    fsDb.collection("pickem_v14_link_requests").doc(uid).set({ status: "rejected", decidedAt: new Date().toISOString() }, { merge: true }).then(function() {
      if (block) {
        ensureCommissionerConfig().blockedUsers[uid] = { email: r.authEmail || "", name: r.authDisplayName || "", blockedAt: new Date().toISOString(), requestedMember: r.requestedMember || "" };
        saveCommissionerConfigToCloud();
      }
      showAppToast(block ? "Rejected and blocked " + (r.authEmail || "that account") + "." : "Rejected the request from " + (r.authEmail || "that account") + ".");
      renderCommissionerModalBody();
    }, function(e) { showAppToast("Couldn't update the request (" + ((e && e.code) || "error") + ")."); });
  };
  if (block) confirmDanger("Block " + (r.authEmail || "this account") + "? They won't be able to request links or save picks until you unblock them.", "Block", go);
  else go();
}

function unlinkPlayerAccount(profKey) {
  if (!assertCommissionerRole("unlinking accounts")) return;
  var b = BOUND_ACCOUNTS[profKey];
  if (!b) return;
  var name = fixDisplaySpelling(b.memberName || getLinkedMemberNameForProfile(profKey));
  confirmDanger("Unlink " + (b.email || "this account") + " from " + name + "? Their picks stay; that account can no longer change them. The registered email is cleared too, so the next link needs your approval or a new email.", "Unlink", function() {
    Promise.all([
      fsDb.collection("pickem_v14_bindings").doc(profKey).delete(),
      // The old owner value would otherwise let that account re-link itself.
      fsDb.collection("pickem_v14_users").doc(profKey).set({ ownerUid: "" }, { merge: true })
    ]).then(function() {
      var map = ensureCommissionerConfig().playerEmailsMap;
      var low = b.memberLow || memberLowOf(b.memberName);
      if (low && String(map[low] || "").toLowerCase() === String(b.email || "").toLowerCase()) { delete map[low]; saveCommissionerConfigToCloud(); }
      showAppToast("Unlinked " + name + ".");
      renderCommissionerModalBody();
    }, function(e) { showAppToast("Couldn't unlink (" + ((e && e.code) || "error") + ")."); });
  });
}

function unblockAccount(uid) {
  if (!assertCommissionerRole("unblocking accounts")) return;
  var cfg = ensureCommissionerConfig();
  delete cfg.blockedUsers[uid];
  saveCommissionerConfigToCloud();
  fsDb.collection("pickem_v14_link_requests").doc(uid).delete().catch(function() {});
  renderCommissionerModalBody();
}

function setRegisteredPlayerEmail(name) {
  if (!assertCommissionerRole("registering player emails")) return;
  var map = ensureCommissionerConfig().playerEmailsMap;
  var low = memberLowOf(name);
  var val = window.prompt("Email for " + fixDisplaySpelling(name) + " (they link instantly when they sign in with it). Leave blank to clear.", map[low] || "");
  if (val === null) return;
  val = String(val).trim().toLowerCase();
  if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { showAppToast("That doesn't look like an email address."); return; }
  if (val) map[low] = val; else delete map[low];
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
}

function setRegistrationMode(mode) {
  if (!assertCommissionerRole("changing league access")) return;
  if (!REGISTRATION_MODES[mode]) return;
  getSecurityConfig().registrationMode = mode;
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
  showAppToast("League access: " + REGISTRATION_MODES[mode].label + ".");
}

function loadInviteCode() {
  if (INVITE_CODE_CACHE || !fsDb || !isVerifiedCommissioner()) return;
  INVITE_CODE_CACHE = { code: "", loading: true };
  fsDb.collection("pickem_v14_security").doc("invite").get().then(function(d) {
    INVITE_CODE_CACHE = { code: d && d.exists ? String((d.data() || {}).code || "") : "" };
    renderCommissionerModalBody();
  }, function() { INVITE_CODE_CACHE = { code: "", error: true }; });
}

function copyInviteLink() {
  var code = INVITE_CODE_CACHE && INVITE_CODE_CACHE.code;
  if (!code) { showAppToast("Save an invite code first."); return; }
  var link = window.location.origin + "/?joinCode=" + encodeURIComponent(code);
  var done = function() { showAppToast("Invite link copied: " + link); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function() { window.prompt("Copy the invite link:", link); });
  else window.prompt("Copy the invite link:", link);
}

// App-only players: profiles with no row on the official leaderboard (a sign-in that didn't
// match a name), and duplicates whose name belongs to another profile ("Kinyon" = kinyion).
function appOnlyProfiles() {
  return (state.customUsers || []).filter(function(cu) {
    if (!cu || !cu.key || isProfileArchived(cu.key)) return false;
    var name = cu.linkedMemberName || cu.name;
    return !findLeaderboardEntryByName(name) || profileKeyForMember(name) !== cu.key;
  });
}

function isDuplicateProfile(cu) {
  var name = cu.linkedMemberName || cu.name;
  return profileKeyForMember(name) !== cu.key;
}

// Removing a player is a soft delete (archive): the record moves to
// commissionerConfig.archivedProfiles (commissioner-only, so no player device can bring it back),
// the pick doc is kept and flagged `archived`, the account is unlinked, and the player leaves the
// registry. Week archives and the pick doc keep their history, so Restore puts them back as they were.
// Every write is confirmed before this device's state changes.
async function archiveProfile(profKey, reason) {
  var cu = (state.customUsers || []).filter(function(c) { return c.key === profKey; })[0];
  if (!cu) throw { code: "not-found" };
  var now = new Date().toISOString();
  var binding = BOUND_ACCOUNTS[profKey] || null;
  var rowName = cu.name;
  // Only the empty row the app added for this player goes; a row with sheet history stays.
  var dropRow = function(pm) { return pm && pm.name === rowName && pm.awaitingSheet && !findLeaderboardEntryByName(pm.name) && !hasSubmittedPicksForCurrentSlate(pm.picks || {}, GAMES); };
  var hadRow = Array.isArray(state.poolMembers) && state.poolMembers.some(dropRow);
  var who = commishEmailForLog();

  await commitCommissionerConfig(function(cfg) {
    if (!cfg.archivedProfiles) cfg.archivedProfiles = {};
    cfg.archivedProfiles[profKey] = {
      record: JSON.parse(JSON.stringify(cu)),
      privacy: (state.profilePrivacy && state.profilePrivacy[profKey]) || null,
      name: cu.name, email: (binding && binding.email) || cu.email || "", uid: (binding && binding.uid) || "",
      archivedAt: now, archivedBy: who, reason: reason || ""
    };
  });
  logCommishAction("Removed (archived) player " + cu.name, cu.name, reason || "");

  var remaining = (state.customUsers || []).filter(function(c) { return c.key !== profKey; });
  var shared = { customUsers: remaining, updatedAt: now };
  if (hadRow) shared.poolMembers = state.poolMembers.filter(function(pm) { return !dropRow(pm); });
  var jobs = [
    fsDb.collection("pickem_v14").doc("shared_state").set(shared, { merge: true }),
    // ownerUid cleared: the old owner value would let that account re-link itself.
    fsDb.collection("pickem_v14_users").doc(profKey).set({ archived: true, archivedAt: now, archivedBy: who, ownerUid: "" }, { merge: true })
  ];
  if (binding) jobs.push(fsDb.collection("pickem_v14_bindings").doc(profKey).delete());
  await Promise.all(jobs);

  // Confirmed: now this device.
  state.customUsers = remaining;
  if (hadRow) state.poolMembers = shared.poolMembers;
  delete BOUND_ACCOUNTS[profKey];
  if (activeProfile === profKey) activeProfile = getMyInstanceProfileKey();
  if (state.compareTargetKey === profKey) state.compareTargetKey = "";
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
}

async function restoreArchivedProfile(profKey) {
  var entry = (ensureCommissionerConfig().archivedProfiles || {})[profKey];
  if (!entry) throw { code: "not-found" };
  var now = new Date().toISOString();
  var record = Object.assign({}, entry.record || { key: profKey, name: entry.name || profKey, linkedMemberName: entry.name || profKey }, { ownerUid: "" });
  await commitCommissionerConfig(function(cfg) {
    delete cfg.archivedProfiles[profKey];
  });
  logCommishAction("Restored player " + record.name, record.name, "");
  var list = (state.customUsers || []).filter(function(c) { return c.key !== profKey; }).concat([record]);
  var shared = { customUsers: list, updatedAt: now };
  if (entry.privacy) { shared.profilePrivacy = {}; shared.profilePrivacy[profKey] = entry.privacy; }
  var uRef = fsDb.collection("pickem_v14_users").doc(profKey);
  await Promise.all([
    fsDb.collection("pickem_v14").doc("shared_state").set(shared, { merge: true }),
    uRef.set({ archived: false, restoredAt: now }, { merge: true })
  ]);
  state.customUsers = list;
  if (entry.privacy) state.profilePrivacy[profKey] = entry.privacy;
  try {
    var snap = await uRef.get();
    var d = snap && snap.exists ? snap.data() : null;
    if (d && d.picks) state[profKey] = Object.assign({}, state[profKey] || {}, { picks: d.picks, tiebreaker: d.tiebreaker || "28-24", target: d.target || 20, linkedMemberName: d.linkedMemberName || record.linkedMemberName });
  } catch (e) {}
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
}

function removeAppOnlyPlayer(profKey) {
  if (!assertCommissionerRole("removing players")) return;
  var cu = (state.customUsers || []).filter(function(c) { return c.key === profKey; })[0];
  if (!cu) return;
  var b = BOUND_ACCOUNTS[profKey];
  confirmDanger("Remove \"" + cu.name + "\" from the pool?\n\n" +
    "• They disappear from the app on every device.\n" +
    (b ? "• " + (b.email || "Their account") + " is unlinked.\n" : "") +
    "• Their picks and past weeks are kept, and you can restore them under Removed players.\n" +
    "• Roster players aren't affected.", "Remove", function() {
    showAppToast("Removing " + cu.name + "…");
    archiveProfile(profKey, "Removed from Roster › App-only players").then(function() {
      regradeAllPoolMembersLive();
      renderAll();
      renderCommissionerModalBody();
      showAppToast("Removed " + cu.name + ". Restore it any time under Removed players.");
    }, function(e) { showAppToast("Couldn't remove " + cu.name + " (" + ((e && e.code) || "error") + "). Nothing was changed."); });
  });
}

function restoreArchivedPlayer(profKey) {
  if (!assertCommissionerRole("restoring players")) return;
  var entry = (ensureCommissionerConfig().archivedProfiles || {})[profKey];
  if (!entry) return;
  confirmDanger("Restore \"" + (entry.name || profKey) + "\"? They come back with their saved picks. Their account isn't re-linked; they sign in again and you approve the link.", "Restore", function() {
    restoreArchivedProfile(profKey).then(function() {
      regradeAllPoolMembersLive();
      renderAll();
      renderCommissionerModalBody();
      showAppToast("Restored " + (entry.name || profKey) + ".");
    }, function(e) { showAppToast("Couldn't restore (" + ((e && e.code) || "error") + ")."); });
  });
}

// Merge a duplicate / app-only profile into a roster player: the duplicate's account becomes
// the roster player's account (binding, pick-doc owner, account record, registered email), its
// picks move over only if the roster player has none this week, then the duplicate is deleted.
async function mergeProfileInto(dupKey, targetName) {
  if (!assertCommissionerRole("merging accounts")) return;
  var cu = (state.customUsers || []).filter(function(c) { return c.key === dupKey; })[0];
  if (!cu || !targetName) { showAppToast("Choose the roster player to merge into."); return; }
  var targetKey = profileKeyForMember(targetName);
  var targetLow = memberLowOf(targetName);
  var shownTarget = fixDisplaySpelling(rosterDisplayName(targetName));
  if (!targetKey || targetKey === dupKey) { showAppToast("That's the same player."); return; }

  var dupBinding = BOUND_ACCOUNTS[dupKey];
  var dupDoc = {};
  try { var ds = await fsDb.collection("pickem_v14_users").doc(dupKey).get(); dupDoc = ds && ds.exists ? ds.data() : {}; } catch (e) {}
  var uid = (dupBinding && dupBinding.uid) || cu.ownerUid || dupDoc.ownerUid || "";
  if (/^email_/.test(uid)) uid = ""; // old-style owner value, not an account id
  var email = String((dupBinding && dupBinding.email) || cu.email || "").toLowerCase();
  var targetOwner = bindingOwnerUid(targetKey);
  if (targetOwner && uid && targetOwner !== uid) { showAppToast(shownTarget + " is linked to a different account. Unlink it first."); return; }

  var dupPicks = (state[dupKey] && state[dupKey].picks) || dupDoc.picks || {};
  var targetPicks = (state[targetKey] && state[targetKey].picks) || {};
  // Combine: the kept record's picks win; the duplicate fills games the kept record hasn't
  // picked this week. Only this week's games move (older keys belong to other slates).
  var combined = Object.assign({}, targetPicks);
  var filled = 0;
  GAMES.forEach(function(g) {
    var mine = getResolvedPickForGame(targetPicks, g, false);
    var theirs = getResolvedPickForGame(dupPicks, g, false);
    if (!mine && theirs) { combined[g.id] = theirs; filled++; }
  });
  var movePicks = filled > 0;
  var targetTb = state[targetKey] && state[targetKey].tiebreaker;
  var msg = "Merge \"" + cu.name + "\" into " + shownTarget + "?\n\n" +
    (email ? "• " + email + " becomes " + shownTarget + "'s account and lands on their picks.\n" : "• No sign-in is attached to \"" + cu.name + "\".\n") +
    (movePicks ? "• " + filled + " of the duplicate's picks fill games " + shownTarget + " hasn't picked; " + shownTarget + "'s own picks stay.\n" : "• " + shownTarget + "'s own picks are kept (nothing to add).\n") +
    "• \"" + cu.name + "\" is then removed (archived; its picks history is kept).";
  confirmDanger(msg, "Merge", async function() {
    try {
      var now = new Date().toISOString();
      if (movePicks) {
        if (!state[targetKey]) state[targetKey] = { picks: {}, tiebreaker: "28-24", target: 20 };
        state[targetKey].picks = combined;
        var hadOwnPicks = hasSubmittedPicksForCurrentSlate(targetPicks, GAMES);
        if (!hadOwnPicks && ((state[dupKey] && state[dupKey].tiebreaker) || dupDoc.tiebreaker)) state[targetKey].tiebreaker = (state[dupKey] && state[dupKey].tiebreaker) || dupDoc.tiebreaker;
        else if (targetTb) state[targetKey].tiebreaker = targetTb;
        state[targetKey]._picksCleared = false;
      }
      var userDoc = { profileKey: targetKey, linkedMemberName: rosterDisplayName(targetName), updatedAt: now };
      if (uid) userDoc.ownerUid = uid;
      if (movePicks) { userDoc.picks = state[targetKey].picks; userDoc.tiebreaker = state[targetKey].tiebreaker; userDoc.currentWeek = state.currentWeek; userDoc._picksCleared = false; }
      var jobs = [fsDb.collection("pickem_v14_users").doc(targetKey).set(userDoc, { merge: true })];
      if (movePicks) {
        var sharedPicks = { updatedAt: now };
        sharedPicks[targetKey] = state[targetKey];
        jobs.push(fsDb.collection("pickem_v14").doc("shared_state").set(sharedPicks, { merge: true }));
      }
      if (uid && ACCOUNT_SECURITY_LIVE) {
        jobs.push(setBindingGuarded(targetKey, {
          uid: uid, email: email, displayName: (dupBinding && dupBinding.displayName) || cu.name, memberName: rosterDisplayName(targetName),
          memberLow: targetLow, boundAt: now, verifiedBy: "commish_approved"
        }, bindingOwnerUid(targetKey)));
      }
      if (email) {
        // The account record decides where the account lands on its next load (auth.js re-check).
        jobs.push(fsDb.collection("pickem_v14_accounts").doc("email_" + email.replace(/[^a-z0-9]/g, "_")).set({
          boundProfileKey: targetKey, linkedMemberName: rosterDisplayName(targetName),
          linkedEntries: [{ profileKey: targetKey, memberName: rosterDisplayName(targetName), label: "Entry #1: " + rosterDisplayName(targetName) }],
          updatedAt: now
        }, { merge: true }));
        var map = ensureCommissionerConfig().playerEmailsMap;
        if (!map[targetLow]) { map[targetLow] = email; saveCommissionerConfigToCloud(); }
      }
      await Promise.all(jobs);
      await archiveProfile(dupKey, "Merged into " + shownTarget);
      logCommishAction("Merged " + cu.name + " into " + shownTarget + (email ? " (account " + email + " moved)" : "") + (movePicks ? ", " + filled + " picks added" : ""), shownTarget, "");
      regradeAllPoolMembersLive();
      pushWatchlistOrStandingsToFirebase();
      renderAll();
      renderCommissionerModalBody();
      showAppToast("Merged " + cu.name + " into " + shownTarget + "." + (email ? " Their app moves over the next time it opens." : ""));
    } catch (e) {
      showAppToast("Couldn't finish the merge (" + ((e && e.code) || (e && e.message) || "error") + ").");
    }
  });
}

function mergeTargetOptionsHtml(cu) {
  var guess = isDuplicateProfile(cu) ? memberLowOf(cu.linkedMemberName || cu.name) : "";
  var names = (state.leaderboard || []).map(function(r) { return standardizeParticipantName(r.name); });
  names.sort(function(a, b) { return fixDisplaySpelling(a).localeCompare(fixDisplaySpelling(b)); });
  return '<option value="">Merge into…</option>' + names.map(function(n) {
    return '<option value="' + escapeShellHtml(n) + '"' + (memberLowOf(n) === guess ? ' selected' : '') + '>' + escapeShellHtml(fixDisplaySpelling(n)) + '</option>';
  }).join("");
}

// ---------- Commissioner HTML ----------
function formatRequestTime(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pendingLinkRequestsCardHtml() {
  var list = pendingLinkRequests();
  if (!list.length) return "";
  return '<section class="acct-pending" aria-labelledby="acct-pending-h">' +
    '<h3 class="console-h" id="acct-pending-h">🚨 Pending account link requests (' + list.length + ')</h3>' +
    '<div class="list-card">' + list.map(function(r) {
      var id = jsArgAttr(r.claimId);
      var owner = bindingOwnerUid(r.requestedPlayerKey);
      return '<div class="acct-req">' +
        '<div class="acct-req-main">' +
          '<div class="acct-req-name">' + escapeShellHtml(fixDisplaySpelling(r.requestedMember)) + (r.isNewPlayer ? ' <span class="acct-tag">New player</span>' : '') + (owner ? ' <span class="acct-tag is-warn">Linked to another account</span>' : '') + '</div>' +
          '<div class="acct-req-sub">' + escapeShellHtml(r.authEmail || "") + (r.authDisplayName ? ' · ' + escapeShellHtml(r.authDisplayName) : '') + ' · ' + escapeShellHtml(formatRequestTime(r.requestedAt)) + '</div>' +
        '</div>' +
        '<div class="acct-req-actions">' +
          '<button type="button" class="btn-sm acct-approve" onclick="approveLinkRequest(\'' + id + '\')">✓ Approve &amp; link</button>' +
          '<button type="button" class="btn-sm" onclick="rejectLinkRequest(\'' + id + '\', false)">✕ Reject</button>' +
          '<button type="button" class="btn-sm acct-danger" onclick="rejectLinkRequest(\'' + id + '\', true)">🚫 Reject &amp; block</button>' +
        '</div>' +
      '</div>';
    }).join("") + '</div></section>';
}

// Link status cell for one roster row (Commissioner › Roster).
function accountLinkCellHtml(name) {
  if (!ACCOUNT_SECURITY_LIVE) return '<span class="muted-note">—</span>';
  var key = profileKeyForMember(name);
  var b = BOUND_ACCOUNTS[key];
  var safeKey = jsArgAttr(key);
  var safeName = jsArgAttr(name);
  if (b) {
    return '<div class="acct-cell"><span class="acct-status is-linked">🟢 Linked</span><span class="acct-email">' + escapeShellHtml(b.email || "") + '</span>' +
      '<button type="button" class="link-btn" onclick="unlinkPlayerAccount(\'' + safeKey + '\')">Unlink</button></div>';
  }
  var req = pendingRequestForMember(name);
  if (req) {
    var id = jsArgAttr(req.claimId);
    return '<div class="acct-cell"><span class="acct-status is-pending">🟡 Claim pending</span><span class="acct-email">' + escapeShellHtml(req.authEmail || "") + '</span>' +
      '<span><button type="button" class="link-btn" onclick="approveLinkRequest(\'' + id + '\')">Approve</button> <button type="button" class="link-btn" onclick="rejectLinkRequest(\'' + id + '\', false)">Deny</button></span></div>';
  }
  var pre = (ensureCommissionerConfig().playerEmailsMap || {})[memberLowOf(name)];
  return '<div class="acct-cell"><span class="acct-status">⚪ Unclaimed</span>' +
    (pre ? '<span class="acct-email">Pre-approved: ' + escapeShellHtml(pre) + '</span>' : '') +
    '<button type="button" class="link-btn" onclick="setRegisteredPlayerEmail(\'' + safeName + '\')">' + (pre ? 'Change email' : 'Pre-approve email') + '</button></div>';
}

function leagueAccessHtml() {
  var sc = getSecurityConfig();
  if (!ACCOUNT_SECURITY_LIVE) {
    return '<section class="acct-access"><h3 class="console-h">League access &amp; security</h3>' +
      '<p class="muted-note">Account linking protection turns on once the latest Firestore rules are published: <code>firebase deploy --only firestore:rules</code>. Until then, linking works the old way.</p></section>';
  }
  loadInviteCode();
  var code = INVITE_CODE_CACHE && INVITE_CODE_CACHE.code ? INVITE_CODE_CACHE.code : "";
  return '<section class="acct-access" aria-labelledby="acct-access-h">' +
    '<h3 class="console-h" id="acct-access-h">League access &amp; security</h3>' +
    '<div class="list-card">' + Object.keys(REGISTRATION_MODES).map(function(m) {
      var on = sc.registrationMode === m;
      return '<label class="list-row acct-mode' + (on ? ' is-on' : '') + '"><input type="radio" name="acct-reg-mode" ' + (on ? 'checked' : '') + ' onchange="setRegistrationMode(\'' + m + '\')" />' +
        '<span class="list-row-text"><span class="list-row-title">' + REGISTRATION_MODES[m].label + '</span><span class="list-row-sub">' + REGISTRATION_MODES[m].sub + '</span></span></label>';
    }).join("") + '</div>' +
    '<div class="acct-invite">' +
      '<label class="acct-link-label" for="commish-invite-code">League invite code' + (sc.registrationMode === "invite_code_required" ? '' : ' (used in Invite code mode)') + '</label>' +
      '<div class="acct-link-row"><input type="text" id="commish-invite-code" class="search-input" autocomplete="off" value="' + escapeShellHtml(code) + '" placeholder="e.g. TURF2026" />' +
      '<button type="button" class="btn-sm" onclick="copyInviteLink()">Copy invite link</button></div>' +
      '<p class="muted-note">Only commissioners can see the code. The link (<code>?joinCode=…</code>) fills it in for whoever opens it.</p>' +
    '</div>' +
  '</section>';
}

function appOnlyPlayersHtml() {
  var list = appOnlyProfiles();
  if (!list.length) return "";
  return '<details class="acct-details"><summary>App-only and duplicate players (' + list.length + ')</summary>' +
    '<p class="muted-note">Created when a sign-in didn\'t match a roster name. Merge moves the account (and its picks, if the roster player has none) onto the right roster player; Remove just deletes it.</p>' +
    '<div class="list-card">' + list.map(function(cu) {
      var b = BOUND_ACCOUNTS[cu.key];
      var pk = state[cu.key] && state[cu.key].picks ? countMatchingPicksForSlate(state[cu.key].picks, GAMES).matched : 0;
      return '<div class="acct-req"><div class="acct-req-main"><div class="acct-req-name">' + escapeShellHtml(cu.name) +
        (isDuplicateProfile(cu) ? ' <span class="acct-tag is-warn">Duplicate of ' + escapeShellHtml(fixDisplaySpelling(getLinkedMemberNameForProfile(profileKeyForMember(cu.linkedMemberName || cu.name)) || "")) + '</span>' : '') + '</div>' +
        '<div class="acct-req-sub">' + escapeShellHtml(cu.key) + ' · ' + pk + ' picks' + (b ? ' · ' + escapeShellHtml(b.email || "") : (cu.email ? ' · ' + escapeShellHtml(cu.email) : '')) + '</div></div>' +
        '<div class="acct-req-actions acct-merge">' +
          '<select class="search-input" id="acct-merge-' + escapeShellHtml(cu.key) + '" aria-label="Roster player to merge ' + escapeShellHtml(cu.name) + ' into">' + mergeTargetOptionsHtml(cu) + '</select>' +
          '<button type="button" class="btn-sm" onclick="mergeProfileInto(\'' + jsArgAttr(cu.key) + '\', document.getElementById(\'acct-merge-' + jsArgAttr(cu.key) + '\').value)">Merge</button>' +
          (b ? '<button type="button" class="btn-sm" onclick="unlinkPlayerAccount(\'' + jsArgAttr(cu.key) + '\')">Unlink</button>' : '') +
          '<button type="button" class="btn-sm acct-danger" onclick="removeAppOnlyPlayer(\'' + jsArgAttr(cu.key) + '\')">Remove</button></div></div>';
    }).join("") + '</div></details>';
}

function archivedPlayersHtml() {
  var arch = ensureCommissionerConfig().archivedProfiles || {};
  var keys = Object.keys(arch);
  if (!keys.length) return "";
  keys.sort(function(a, b) { return String(arch[b].archivedAt || "").localeCompare(String(arch[a].archivedAt || "")); });
  return '<details class="acct-details"><summary>Removed players (' + keys.length + ')</summary>' +
    '<p class="muted-note">Removed players are hidden everywhere but keep their picks history. Restore brings them back.</p>' +
    '<div class="list-card">' + keys.map(function(k) {
      var e = arch[k] || {};
      return '<div class="acct-req"><div class="acct-req-main"><div class="acct-req-name">' + escapeShellHtml(e.name || k) + '</div>' +
        '<div class="acct-req-sub">' + escapeShellHtml(k) + (e.email ? ' · ' + escapeShellHtml(e.email) : '') + ' · removed ' + escapeShellHtml(formatRequestTime(e.archivedAt)) + (e.archivedBy ? ' by ' + escapeShellHtml(e.archivedBy) : '') + '</div></div>' +
        '<div class="acct-req-actions"><button type="button" class="btn-sm" onclick="restoreArchivedPlayer(\'' + jsArgAttr(k) + '\')">Restore</button></div></div>';
    }).join("") + '</div></details>';
}

function blockedAccountsHtml() {
  var blocked = ensureCommissionerConfig().blockedUsers || {};
  var ids = Object.keys(blocked);
  if (!ids.length) return "";
  return '<details class="acct-details"><summary>Blocked accounts (' + ids.length + ')</summary><div class="list-card">' + ids.map(function(uid) {
    var b = blocked[uid] || {};
    return '<div class="acct-req"><div class="acct-req-main"><div class="acct-req-name">' + escapeShellHtml(b.email || uid) + '</div>' +
      '<div class="acct-req-sub">' + (b.requestedMember ? 'Asked for ' + escapeShellHtml(fixDisplaySpelling(b.requestedMember)) + ' · ' : '') + escapeShellHtml(formatRequestTime(b.blockedAt)) + '</div></div>' +
      '<div class="acct-req-actions"><button type="button" class="btn-sm" onclick="unblockAccount(\'' + jsArgAttr(uid) + '\')">Unblock</button></div></div>';
  }).join("") + '</div></details>';
}

var _acctPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _acctPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (!body || !isVerifiedCommissioner()) return res;
  startLinkRequestWatch();
  if (ACTIVE_COMMISH_TAB === "roster") {
    body.insertAdjacentHTML("afterbegin", pendingLinkRequestsCardHtml());
    body.insertAdjacentHTML("beforeend", leagueAccessHtml() + appOnlyPlayersHtml() + archivedPlayersHtml() + blockedAccountsHtml());
  } else if (ACTIVE_COMMISH_TAB === "submissions") {
    body.insertAdjacentHTML("afterbegin", pendingLinkRequestsCardHtml());
  }
  return res;
};

// Badge with the number of pending requests on More and the commissioner buttons.
function renderAccountSecurityBits() {
  var n = isVerifiedCommissioner() ? pendingLinkRequests().length : 0;
  ["mnav-drawer", "nav-more-commish", "btn-commish-console"].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var badge = btn.querySelector(".nav-alert-badge.is-link-req");
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-alert-badge is-link-req";
      btn.appendChild(badge);
    }
    badge.textContent = n;
    badge.setAttribute("aria-label", n + " pending account link " + (n === 1 ? "request" : "requests"));
  });
  if (typeof renderSimpleGuestAccountBar === "function") renderSimpleGuestAccountBar();
  var bd = document.getElementById("auth-modal-backdrop");
  if (isUnlinkedAccountSession() && bd && bd.style.display === "flex") {
    // Rebuilding the modal wipes a half-typed invite code, so leave it alone while an input is in use.
    var typing = Array.prototype.some.call(bd.querySelectorAll("input"), function(inp) { return inp === document.activeElement || !!inp.value; });
    if (!typing) openAuthModal();
  }
}

var _acctPrevRenderAll = renderAll;
renderAll = function() {
  var r = _acctPrevRenderAll.apply(this, arguments);
  if (isVerifiedCommissioner()) startLinkRequestWatch();
  renderAccountSecurityBits();
  return r;
};

// More › Commissioner console row: show the pending count.
var _acctPrevMoreView = typeof renderMoreView === "function" ? renderMoreView : null;
if (_acctPrevMoreView) {
  renderMoreView = function() {
    var r = _acctPrevMoreView.apply(this, arguments);
    var n = isVerifiedCommissioner() ? pendingLinkRequests().length : 0;
    if (n) {
      var row = document.querySelector('#more-view-container .list-row[onclick^="openCommissionerModal"] .list-row-title');
      if (row && !row.querySelector(".acct-tag")) row.insertAdjacentHTML("beforeend", ' <span class="acct-tag is-warn">' + n + ' link ' + (n === 1 ? 'request' : 'requests') + '</span>');
    }
    return r;
  };
}

loadBoundAccounts();
