// ============================================================================
// LEAGUE INVITE LINKS (modelled on Sleeper / ESPN / Yahoo: invite link -> claim your spot ->
// commissioner tools + log).
//
// Commissioner (Roster › League access): generate a link, regenerate it (the old one stops
// working), revoke it, and set an expiry. The secret code stays in the commissioner-only doc
// pickem_v14_security/invite { code, expiresAtTs, revoked, ... }; firestore.rules only accept an
// invite pass for a live, unexpired, unrevoked code. A public, code-free status
// (commissionerConfig.inviteLink) lets the landing page say "expired" before anyone signs in.
//
// Opening the link (?joinCode=...) shows "You're invited" with two paths:
//   - Claim your spot: pick your roster name (players already linked to an account are shown
//     but can't be picked), then sign in; the gate in account-security.js links it (registered
//     email) or files a request the commissioner approves.
//   - I'm new: sign in and join as a new player (invite-code mode adds you; otherwise the
//     commissioner approves).
// Commissioners can unlink (existing) or reassign a player to another account (Users tab).
// ============================================================================
var INVITE_EXPIRY_CHOICES = [
  { id: "never", label: "Never expires", ms: 0 },
  { id: "1d", label: "24 hours", ms: 24 * 3600e3 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 3600e3 },
  { id: "30d", label: "30 days", ms: 30 * 24 * 3600e3 }
];
var JOIN_INTENT_KEY = "sat_join_intent_v1"; // "new" while a new player signs in from the invite
var INVITE_LANDING_PENDING = /[?&]joinCode=/.test(window.location.search || "");

// ---------- Status ----------
function publicInviteStatus() {
  var s = ensureCommissionerConfig().inviteLink || null;
  if (!s) return null;
  var expired = !!(s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now());
  return { active: !!s.active && !expired, expired: expired, revoked: !s.active && !!s.revokedAt, expiresAt: s.expiresAt || "", createdAt: s.createdAt || "" };
}

function inviteStatusText(st) {
  if (!st) return "No invite link yet.";
  if (st.active) return "Active" + (st.expiresAt ? " until " + formatRequestTime(st.expiresAt) : ", never expires") + ".";
  if (st.expired) return "Expired " + formatRequestTime(st.expiresAt) + ".";
  return "Turned off.";
}

// The current link, or "" when there's no live code (commissioner only: needs the code).
function leagueInviteLink() {
  var code = INVITE_CODE_CACHE && INVITE_CODE_CACHE.code;
  var st = publicInviteStatus();
  if (!code || (st && !st.active)) return "";
  return window.location.origin + "/?joinCode=" + encodeURIComponent(code);
}

function randomInviteCode() {
  var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  var out = "";
  var buf = new Uint32Array(8);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  for (var i = 0; i < buf.length; i++) out += abc[buf[i] % abc.length];
  return out;
}

function loadInviteDetails(force) {
  if (!fsDb || !isVerifiedCommissioner()) return;
  if (INVITE_CODE_CACHE && INVITE_CODE_CACHE.full && !force) return;
  fsDb.collection("pickem_v14_security").doc("invite").get().then(function(d) {
    var v = d && d.exists ? (d.data() || {}) : {};
    INVITE_CODE_CACHE = { code: String(v.code || ""), expiresAt: v.expiresAt || "", revoked: !!v.revoked, createdAt: v.createdAt || "", full: true };
    if (ACTIVE_COMMISH_TAB === "roster") renderCommissionerModalBody();
  }, function() { INVITE_CODE_CACHE = { code: "", error: true, full: true }; });
}

// ---------- Commissioner actions ----------
// Writes the secret doc and the public status together; this device changes only after both save.
function writeInvite(secret, status, logText) {
  var now = new Date().toISOString();
  var TS = firebase.firestore.Timestamp;
  var doc = Object.assign({ updatedAt: now, updatedBy: commishEmailForLog() }, secret);
  doc.expiresAtTs = secret.expiresAt ? TS.fromDate(new Date(secret.expiresAt)) : null;
  var pub = Object.assign({ updatedAt: now }, status);
  return Promise.all([
    fsDb.collection("pickem_v14_security").doc("invite").set(doc, { merge: true }),
    fsDb.collection("pickem_v14").doc("shared_state").update(new firebase.firestore.FieldPath("commissionerConfig", "inviteLink"), pub)
  ]).then(function() {
    INVITE_CODE_CACHE = Object.assign({}, INVITE_CODE_CACHE || {}, { code: doc.code !== undefined ? doc.code : (INVITE_CODE_CACHE && INVITE_CODE_CACHE.code), expiresAt: doc.expiresAt || "", revoked: !!doc.revoked, full: true });
    ensureCommissionerConfig().inviteLink = pub;
    logCommishAction(logText, "", "");
    renderCommissionerModalBody();
  }, function(e) {
    showAppToast("Couldn't save the invite link (" + ((e && e.code) || "error") + "). Nothing changed.");
    throw e;
  });
}

function expiryFromChoice(choice) {
  var c = INVITE_EXPIRY_CHOICES.filter(function(x) { return x.id === choice; })[0] || INVITE_EXPIRY_CHOICES[2];
  return c.ms ? new Date(Date.now() + c.ms).toISOString() : "";
}

function generateInviteLink(regenerate) {
  if (!assertCommissionerRole("invite links")) return;
  var choice = (document.getElementById("invite-expiry") || {}).value || "7d";
  var go = function() {
    var code = randomInviteCode();
    var expiresAt = expiryFromChoice(choice);
    writeInvite({ code: code, expiresAt: expiresAt, revoked: false, createdAt: new Date().toISOString(), createdBy: commishEmailForLog() },
      { active: true, expiresAt: expiresAt, createdAt: new Date().toISOString(), revokedAt: "" },
      (regenerate ? "Regenerated" : "Created") + " the league invite link (" + (expiresAt ? "expires " + formatRequestTime(expiresAt) : "no expiry") + ")"
    ).then(function() { copyInviteLink(); }, function() {});
  };
  var st = publicInviteStatus();
  if (st && st.active) confirmDanger("Make a new invite link? The current link stops working right away; anyone who already joined stays in.", "New link", go);
  else go();
}

function setInviteExpiry(choice) {
  if (!choice || !assertCommissionerRole("invite links")) return;
  var st = publicInviteStatus();
  if (!st || !(INVITE_CODE_CACHE && INVITE_CODE_CACHE.code)) return; // applies to the next link
  var expiresAt = expiryFromChoice(choice);
  writeInvite({ expiresAt: expiresAt }, { active: true, expiresAt: expiresAt, createdAt: st.createdAt, revokedAt: "" },
    "Invite link expiry set to " + (expiresAt ? formatRequestTime(expiresAt) : "never")).catch(function() {});
}

function revokeInviteLink() {
  if (!assertCommissionerRole("invite links")) return;
  confirmDanger("Turn off the invite link? Nobody new can join with it. Players who already joined aren't affected. You can make a new link any time.", "Turn off", function() {
    var now = new Date().toISOString();
    writeInvite({ code: "", revoked: true, revokedAt: now, expiresAt: "" }, { active: false, expiresAt: "", revokedAt: now, createdAt: "" }, "Turned off the league invite link").then(function() {
      showAppToast("Invite link turned off.");
    }, function() {});
  });
}

// Replaces copyInviteLink: only a live link is copied.
copyInviteLink = function() {
  var link = leagueInviteLink();
  if (!link) { showAppToast("There's no active invite link. Make one first."); return; }
  var done = function() { showAppToast("Invite link copied: " + link); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function() { window.prompt("Copy the invite link:", link); });
  else window.prompt("Copy the invite link:", link);
};

function inviteLinkManagerHtml() {
  loadInviteDetails();
  var st = publicInviteStatus();
  var link = leagueInviteLink();
  var mode = getSecurityConfig().registrationMode;
  // With a live link the dropdown starts on its current expiry; picking another changes it.
  var opts = (st && st.active ? '<option value="" selected>' + escapeShellHtml(st.expiresAt ? "Until " + formatRequestTime(st.expiresAt) : "Never (current)") + '</option>' : '') +
    INVITE_EXPIRY_CHOICES.map(function(c) { return '<option value="' + c.id + '"' + (!(st && st.active) && c.id === "7d" ? " selected" : "") + '>' + c.label + '</option>'; }).join("");
  return '<div class="acct-invite invite-manager">' +
    '<div class="acct-link-label">League invite link</div>' +
    '<p class="invite-status' + (st && st.active ? ' is-active' : '') + '">' + escapeShellHtml(inviteStatusText(st)) + '</p>' +
    (link ? '<div class="invite-link-box"><code class="invite-link-text">' + escapeShellHtml(link) + '</code></div>' : '') +
    '<div class="acct-link-row invite-actions">' +
      '<label class="invite-expiry">Expires <select id="invite-expiry" class="search-input"' + (st && st.active ? ' onchange="setInviteExpiry(this.value)"' : '') + '>' + opts + '</select></label>' +
      (st && st.active
        ? '<button type="button" class="btn-sm" onclick="copyInviteLink()">Copy link</button>' +
          '<button type="button" class="btn-sm" onclick="generateInviteLink(true)">Regenerate</button>' +
          '<button type="button" class="btn-sm acct-danger" onclick="revokeInviteLink()">Turn off</button>'
        : '<button type="button" class="btn-sm" onclick="generateInviteLink(false)">Create invite link</button>') +
    '</div>' +
    '<p class="muted-note">Opening the link offers "Claim your spot" (pick your roster name; players already linked can\'t be picked) or "I\'m new". ' +
      (mode === "invite_code_required" ? 'In Invite code mode, new players join with the link; claims of roster names still need your approval unless their email is registered.'
        : 'In this access mode you approve every claim and new player under Pending account link requests.') +
      ' Only commissioners see the code.</p>' +
  '</div>';
}

// ---------- Reassign a player to another account ----------
function reassignPlayerAccount(profKey) {
  if (!assertCommissionerRole("reassigning players")) return;
  var b = BOUND_ACCOUNTS[profKey];
  var name = fixDisplaySpelling(getLinkedMemberNameForProfile(profKey) || (b && b.memberName) || profKey);
  var email = window.prompt("Reassign " + name + " to which account? Enter the email they sign in with." + (b ? "\n(Currently " + (b.email || "another account") + ")" : ""), "");
  if (email === null) return;
  email = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAppToast("That doesn't look like an email address."); return; }
  var acct = ACCOUNTS_CACHE && ACCOUNTS_CACHE.byEmail[email];
  var req = (LINK_REQUESTS || []).filter(function(r) { return r && String(r.authEmail || "").toLowerCase() === email; })[0];
  var uid = (acct && acct.uid) || (req && req.uid) || "";
  if (!uid || /^acct_/.test(uid)) { showAppToast(email + " hasn't signed in to the app yet. Send them the invite link; their claim shows up for you to approve."); return; }
  if (b && b.uid === uid) { showAppToast(name + " is already linked to " + email + "."); return; }
  var otherKeys = ownedProfileKeys(uid).filter(function(k) { return k !== profKey; });
  confirmDanger("Reassign " + name + " to " + email + "?\n\n" +
    (b ? "• " + (b.email || "The current account") + " loses access to " + name + ".\n" : "") +
    "• " + email + " plays " + name + " from their next app load.\n" +
    (otherKeys.length ? "• " + email + " also stays linked to " + otherKeys.map(function(k) { return fixDisplaySpelling(getLinkedMemberNameForProfile(k) || k); }).join(", ") + ".\n" : "") +
    "• Picks and standings don't change.", "Reassign", function() {
    var now = new Date().toISOString();
    var low = memberLowOf(getLinkedMemberNameForProfile(profKey) || name);
    var memberName = rosterDisplayName(getLinkedMemberNameForProfile(profKey) || name);
    var jobs = [
      setBindingGuarded(profKey, { uid: uid, email: email, displayName: (acct && acct.displayName) || (req && req.authDisplayName) || memberName, memberName: memberName, memberLow: low, boundAt: now, verifiedBy: "commish_approved" }, b ? b.uid : ""),
      fsDb.collection("pickem_v14_users").doc(profKey).set({ ownerUid: uid }, { merge: true }),
      fsDb.collection("pickem_v14_accounts").doc("email_" + email.replace(/[^a-z0-9]/g, "_")).set({ uid: uid, email: email, boundProfileKey: profKey, linkedMemberName: memberName, linkedEntries: [{ profileKey: profKey, memberName: memberName, label: "Entry #1: " + memberName }], updatedAt: now }, { merge: true })
    ];
    if (b && b.email) jobs.push(fsDb.collection("pickem_v14_accounts").doc("email_" + String(b.email).toLowerCase().replace(/[^a-z0-9]/g, "_")).set({ boundProfileKey: "", linkedMemberName: "", linkedEntries: [], updatedAt: now }, { merge: true }));
    if (req) jobs.push(fsDb.collection("pickem_v14_link_requests").doc(req.claimId || uid).delete());
    Promise.all(jobs).then(function() {
      var map = ensureCommissionerConfig().playerEmailsMap;
      if (isRosterMemberName(memberName) && map[low] !== email) { map[low] = email; saveCommissionerConfigToCloud(); }
      logCommishAction("Reassigned " + fixDisplaySpelling(memberName) + " from " + ((b && b.email) || "no account") + " to " + email, memberName, "");
      showAppToast(name + " now belongs to " + email + ".");
      renderCommissionerModalBody();
    }, function(e) { showAppToast("Couldn't reassign (" + ((e && e.code) || "error") + ")."); });
  });
}

// ---------- Player side: "You're invited" ----------
function joinIntentIsNew() {
  var raw = safeGetStorage(JOIN_INTENT_KEY) || "";
  try { var v = JSON.parse(raw); return !!(v && v.intent === "new" && Date.now() - (v.at || 0) < 15 * 60 * 1000); } catch (e) { return false; }
}

function inviteRosterRowsHtml() {
  var seen = {}, names = [];
  (state.leaderboard || []).concat(state.poolMembers || []).forEach(function(r) {
    var n = r && r.name ? standardizeParticipantName(r.name) : "";
    if (!n || seen[n.toLowerCase()] || isProfileArchived(profileKeyForMember(n))) return;
    seen[n.toLowerCase()] = true;
    names.push(n);
  });
  names.sort(function(a, b) { return fixDisplaySpelling(a).localeCompare(fixDisplaySpelling(b)); });
  return names.map(function(n) {
    var claimed = isMemberClaimedByOther(n, AUTH_SESSION && AUTH_SESSION.uid);
    var label = escapeShellHtml(fixDisplaySpelling(n));
    return '<button type="button" class="list-row invite-claim-row" data-name="' + escapeShellHtml(n.toLowerCase()) + '"' +
      (claimed ? ' disabled aria-disabled="true"' : ' onclick="claimInviteSpot(\'' + jsArgAttr(n) + '\')"') + '>' +
      '<span class="list-row-title">' + label + '</span>' + (claimed ? '<span class="acct-tag">Claimed</span>' : '') + '</button>';
  }).join("");
}

function showInviteLanding() {
  INVITE_LANDING_PENDING = false;
  try { history.replaceState(null, "", window.location.pathname + window.location.hash); } catch (e) {}
  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    showAppToast("You're already in the league as " + fixDisplaySpelling(AUTH_SESSION.linkedMemberName || "") + ".");
    return;
  }
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!bd || !body) return;
  var st = publicInviteStatus();
  document.getElementById("panel-sheet-title").textContent = "You're invited";
  if (st && !st.active) {
    body.innerHTML = '<p class="sheet-meta">This invite link ' + (st.expired ? "expired " + escapeShellHtml(formatRequestTime(st.expiresAt)) : "was turned off") + '. Ask the commissioner for a new one.</p>' +
      '<button type="button" class="btn-sm invite-wide" onclick="closePanelSheet()">Look around</button>';
    safeSetStorage(JOIN_CODE_STORAGE_KEY, "");
    bd.hidden = false;
    return;
  }
  body.innerHTML =
    '<p class="sheet-meta">Join the Separated at Turf pick\'em. Are you already in the league?</p>' +
    '<section class="invite-path" aria-labelledby="invite-new-h">' +
      '<h3 class="invite-path-h" id="invite-new-h">I\'m new</h3>' +
      '<p class="sheet-meta">Create your account and join as a new player' + (getSecurityConfig().registrationMode === "invite_code_required" ? '.' : '; the commissioner approves new players.') + '</p>' +
      '<button type="button" class="btn-sm invite-wide invite-primary" onclick="startInviteNewAccount()">Create my account</button>' +
    '</section>' +
    '<section class="invite-path" aria-labelledby="invite-claim-h">' +
      '<h3 class="invite-path-h" id="invite-claim-h">I\'m already in the league</h3>' +
      '<p class="sheet-meta">Pick your name to claim your spot: your points and history come with it. Names linked to an account are taken.</p>' +
      '<input type="search" class="search-input invite-search" placeholder="Search names" aria-label="Search names" oninput="filterRosterChooser(this.value, \'invite-claim-list\')" />' +
      '<div class="list-card invite-claim-list" id="invite-claim-list">' + inviteRosterRowsHtml() + '</div>' +
    '</section>';
  bd.hidden = false;
}

function claimInviteSpot(name) {
  closePanelSheet();
  safeSetStorage(JOIN_INTENT_KEY, "");
  if (AUTH_SESSION && AUTH_SESSION.uid && !AUTH_SESSION.boundProfileKey) { requestLinkToMember(name); return; }
  setPendingOauthMember(name);
  showAppToast("Sign in to claim " + fixDisplaySpelling(name) + ".");
  openAuthModal();
}

function startInviteNewAccount() {
  closePanelSheet();
  safeSetStorage(JOIN_INTENT_KEY, JSON.stringify({ intent: "new", at: Date.now() }));
  if (AUTH_SESSION && AUTH_SESSION.uid && !AUTH_SESSION.boundProfileKey) { requestLinkToMember(AUTH_SESSION.displayName || String(AUTH_SESSION.email || "").split("@")[0]); return; }
  openAuthModal();
}

// "I'm new" already answered the roster question: skip the "Which player are you?" chooser.
var _invitePrevChooser = chooseRosterNameForNewAccount;
chooseRosterNameForNewAccount = function() {
  if (joinIntentIsNew()) { safeSetStorage(JOIN_INTENT_KEY, ""); return Promise.resolve(""); }
  return _invitePrevChooser.apply(this, arguments);
};

// The landing waits for the pool (roster, invite status) and the account links to load.
(function waitForInviteLanding() {
  if (!INVITE_LANDING_PENDING) return;
  var tries = 0;
  var tick = function() {
    tries++;
    var ready = typeof CLOUD_HYDRATED !== "undefined" && CLOUD_HYDRATED && (state.leaderboard || []).length;
    if (ready) { (typeof loadBoundAccounts === "function" ? loadBoundAccounts() : Promise.resolve()).then(function() { setTimeout(showInviteLanding, 300); }); return; }
    if (tries < 40) setTimeout(tick, 250);
  };
  setTimeout(tick, 250);
})();

// ---------- Console wiring ----------
var _invitePrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _invitePrevCommishBody.apply(this, arguments);
  if (ACTIVE_COMMISH_TAB === "roster" && isVerifiedCommissioner()) {
    var old = document.querySelector("#commish-modal-body .acct-invite");
    if (old) old.outerHTML = inviteLinkManagerHtml();
  }
  return res;
};

// Users tab: linked players get Reassign next to their actions.
var _invitePrevUserRow = userRowHtml;
userRowHtml = function(r) {
  var html = _invitePrevUserRow.apply(this, arguments);
  if (r.kind === "archived" || r.key === "test") return html;
  var extra = '<button type="button" class="btn-sm" onclick="reassignPlayerAccount(\'' + jsArgAttr(r.key) + '\')">' + (r.binding ? "Reassign" : "Assign account") + '</button>' +
    (r.binding ? '<button type="button" class="btn-sm" onclick="unlinkPlayerAccount(\'' + jsArgAttr(r.key) + '\')">Unlink</button>' : '');
  return html.replace('<div class="users-actions">', '<div class="users-actions">' + extra);
};
