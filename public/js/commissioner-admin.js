// ============================================================================
// V16.7 ADMINISTRATIVE & MULTI-COMMISSIONER CONTROLS, MULTI-BUY-IN LINKING,
// MONDAY LOCKED ODDS, MANUAL PICK LOCK, SLIDE-OUT DRAWERS, CONDENSED SIMPLE
// VIEW & COMPACT 26-GAME REVIEW CHECKLIST
// ============================================================================
var SIMPLE_CARD_LAYOUT_STYLE = "condensed"; // "condensed" (default clean list) | "detailed" (cards with injuries/L5)
var DESKTOP_SIDEBAR_COLLAPSED = false;
var MASTER_SHEET_SEARCH_Q = "";

var PRODUCTION_FIRESTORE_SECURITY_RULES = [
  "rules_version = '2';",
  "service cloud.firestore {",
  "  match /databases/{database}/documents {",
  "    function isVerifiedCommissioner() {",
  "      return request.auth != null && (",
  "        request.auth.token.email == get(/databases/$(database)/documents/pickem_v14_commissioners/roles).data.primaryCommissionerEmail ||",
  "        get(/databases/$(database)/documents/pickem_v14_commissioners/roles).data.authorizedEmails[request.auth.token.email] == true",
  "      );",
  "    }",
  "    match /pickem_v14/shared_state {",
  "      allow read: if true;",
  "      allow write: if isVerifiedCommissioner() || !request.resource.data.diff(resource.data).affectedKeys().hasAny(['customGames', 'commissionerConfig', 'weekArchives', 'officialSheetSyncedForWeek']);",
  "    }",
  "    match /pickem_v14_commissioners/{docId} {",
  "      allow read: if true;",
  "      allow write: if isVerifiedCommissioner();",
  "    }",
  "    match /pickem_v14_users/{profileKey} {",
  "      allow read: if true;",
  "      allow write: if request.auth != null || isVerifiedCommissioner();",
  "    }",
  "  }",
  "}"
].join("\n");

// 1. Lock Monday Odds on all games so live mid-week ESPN line drift never alters Simple View lines/multipliers
function ensureMondayLockedOddsOnGames(forceRefreshAll) {
  if (!Array.isArray(GAMES)) return;
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (!g) continue;
    var curKey = normalizeTeamKey(g.away) + "@" + normalizeTeamKey(g.home);
    var teamChanged = (g._mondayLockKey && g._mondayLockKey !== curKey);
    if (forceRefreshAll || teamChanged || !g.mondayPoolLine) {
      g.mondayPoolLine = g.poolLine || (g.rec + " -3.5");
    }
    if (forceRefreshAll || teamChanged || typeof g.mondayAwayPts !== "number") {
      g.mondayAwayPts = g.awayPts || 1;
    }
    if (forceRefreshAll || teamChanged || typeof g.mondayHomePts !== "number") {
      g.mondayHomePts = g.homePts || 1;
    }
    g._mondayLockKey = curKey;
  }
}

// 2. Multi-Commissioner Role Configuration & Strict Role Verification
var _origEnsureCommissionerConfigV166 = ensureCommissionerConfig;
ensureCommissionerConfig = function() {
  var cfg = _origEnsureCommissionerConfigV166();
  if (!cfg.primaryCommissionerEmail) {
    cfg.primaryCommissionerEmail = "commissioner@separatedatturf.com";
  }
  if (!cfg.authorizedCommissioners || typeof cfg.authorizedCommissioners !== "object") {
    cfg.authorizedCommissioners = {
      "commissioner@separatedatturf.com": { role: "primary", label: "Primary Commissioner", enabled: true },
      "michael a": { role: "commissioner", label: "Michael A (League Admin)", enabled: true }
    };
  }
  var pEmailLow = String(cfg.primaryCommissionerEmail || "").trim().toLowerCase();
  if (pEmailLow && !cfg.authorizedCommissioners[pEmailLow]) {
    cfg.authorizedCommissioners[pEmailLow] = { role: "primary", label: "Primary Commissioner", enabled: true };
  }
  return cfg;
};

function isVerifiedCommissioner() {
  var cfg = ensureCommissionerConfig();
  if (!AUTH_SESSION || GUEST_BROWSING_MODE) return false;
  // Only a real Firebase sign-in counts (same rule as firestore.rules): the saved session's
  // email must be the signed-in Firebase user's own, verified email.
  var fbUser = (typeof fbAuth !== "undefined" && fbAuth) ? fbAuth.currentUser : null;
  if (!fbUser || !fbUser.emailVerified || String(fbUser.email || "").toLowerCase() !== String(AUTH_SESSION.email || "").trim().toLowerCase()) return false;
  var emailLow = String(AUTH_SESSION.email || "").trim().toLowerCase();
  if (/@separatedatturt\.com$/.test(emailLow)) return false; // typo domain on old saved lists
  var primaryLow = String(cfg.primaryCommissionerEmail || "commissioner@separatedatturf.com").trim().toLowerCase();
  if (emailLow && (emailLow === primaryLow || emailLow === "michael4ts14@gmail.com" || emailLow === "commissioner@separatedatturf.com")) {
    var pRec = cfg.authorizedCommissioners[emailLow];
    if (!pRec || pRec.enabled !== false) return true;
  }
  // Email addresses only: a player name on the list never grants access, since anyone can
  // create an account and link it to any player name.
  if (emailLow && emailLow.indexOf("@") !== -1 && cfg.authorizedCommissioners[emailLow] && cfg.authorizedCommissioners[emailLow].enabled !== false) {
    return true;
  }
  return false;
}

function assertCommissionerRole(actionLabel) {
  if (isVerifiedCommissioner()) return true;
  showAppToast("🔒 Commissioner Access Required" + (actionLabel ? (" for " + actionLabel) : "") + ". Sign in with an authorized Commissioner account.");
  return false;
}

function syncCommissionerVisibilityDOM() {
  var isCommish = isVerifiedCommissioner();
  var commishBtn = document.getElementById("btn-commish-console");
  if (commishBtn) commishBtn.classList.toggle("commish-only-hidden", !isCommish);

  var botPill = document.getElementById("bot-sync-pill");
  if (botPill) botPill.classList.toggle("commish-only-hidden", !isCommish);

  var archRow = document.getElementById("drawer-commish-archive-row");
  if (archRow) archRow.classList.toggle("commish-only-hidden", !isCommish);

  var archBtn = document.getElementById("btn-top-archive-wk");
  if (archBtn) archBtn.classList.toggle("commish-only-hidden", !isCommish);

  var impBtn = document.getElementById("btn-top-import-bot");
  if (impBtn) impBtn.classList.toggle("commish-only-hidden", !isCommish);

  var stActions = document.getElementById("standings-toolbar-actions");
  if (stActions) stActions.classList.toggle("commish-only-hidden", !isCommish);

  var archHub = document.getElementById("season-archive-hub-container");
  if (archHub) archHub.classList.toggle("commish-only-hidden", !isCommish);

  renderCommishActiveEditBar();
}

function syncCommissionerRolesToFirestore() {
  if (!isVerifiedCommissioner()) return;
  var cfg = ensureCommissionerConfig();
  saveCommissionerConfigToCloud();
  if (fsDb) {
    try {
      var emailsMap = {};
      for (var k in cfg.authorizedCommissioners) {
        if (cfg.authorizedCommissioners[k] && cfg.authorizedCommissioners[k].enabled !== false) {
          emailsMap[k] = true;
        }
      }
      // Replaces the doc: a merge set kept revoked emails in authorizedEmails, and
      // firestore.rules read that map, so a revoked co-commissioner kept write access.
      fsDb.collection("pickem_v14_commissioners").doc("roles").set({
        primaryCommissionerEmail: cfg.primaryCommissionerEmail,
        authorizedEmails: emailsMap,
        authorizedCommissioners: cfg.authorizedCommissioners,
        updatedBy: (AUTH_SESSION && AUTH_SESSION.email) || "commissioner",
        updatedAt: new Date().toISOString()
      }).catch(function(e) { reportCloudSaveFailure("commissioner roles", e); });
    } catch (e) {}
  }
}

function commishUpdatePrimaryEmail() {
  if (!assertCommissionerRole("Update Primary Email")) return;
  var inp = document.getElementById("commish-primary-email-input");
  var newEmail = inp ? String(inp.value || "").trim().toLowerCase() : "";
  if (!newEmail || newEmail.indexOf("@") === -1) {
    showAppToast("⚠️ Enter a valid primary commissioner email address.");
    return;
  }
  var cfg = ensureCommissionerConfig();
  cfg.primaryCommissionerEmail = newEmail;
  cfg.authorizedCommissioners[newEmail] = {
    role: "primary",
    label: "Primary Commissioner (" + newEmail + ")",
    enabled: true,
    assignedAt: new Date().toISOString()
  };
  syncCommissionerRolesToFirestore();
  syncCommissionerVisibilityDOM();
  renderCommissionerModalBody();
  showAppToast("✅ Updated Primary Commissioner Email to " + newEmail + "!");
}

function commishGrantRole(targetKeyRaw, roleLabel) {
  if (!assertCommissionerRole("Assign Commissioner Role")) return;
  var key = String(targetKeyRaw || "").trim().toLowerCase();
  if (!key) {
    showAppToast("Enter an email address or select a player to grant Commissioner access.");
    return;
  }
  var cfg = ensureCommissionerConfig();
  // Access is granted by email only. A selected player name is swapped for the email on file.
  if (key.indexOf("@") === -1) {
    var onFile = (cfg.playerEmailsMap || {})[standardizeParticipantName(targetKeyRaw).toLowerCase()];
    if (!onFile) {
      showAppToast("No email on file for " + targetKeyRaw + ". Type their sign-in email instead.");
      return;
    }
    roleLabel = (roleLabel || targetKeyRaw);
    key = String(onFile).trim().toLowerCase();
  }
  cfg.authorizedCommissioners[key] = {
    role: "co_commissioner",
    label: roleLabel || targetKeyRaw,
    enabled: true,
    assignedBy: (AUTH_SESSION && (AUTH_SESSION.email || AUTH_SESSION.displayName)) || "Commissioner",
    assignedAt: new Date().toISOString()
  };
  syncCommissionerRolesToFirestore();
  syncCommissionerVisibilityDOM();
  renderCommissionerModalBody();
  showAppToast("👑 Granted Commissioner privileges to " + (roleLabel || targetKeyRaw) + "!");
}

function commishToggleRoleEnabled(key) {
  if (!assertCommissionerRole("Modify Commissioner Role")) return;
  var cfg = ensureCommissionerConfig();
  var rec = cfg.authorizedCommissioners[key];
  if (!rec) return;
  rec.enabled = !rec.enabled;
  syncCommissionerRolesToFirestore();
  syncCommissionerVisibilityDOM();
  renderCommissionerModalBody();
  showAppToast(rec.enabled ? ("✅ Re-enabled Commissioner access for " + key) : ("🚫 Suspended Commissioner access for " + key));
}

function commishRevokeRole(key) {
  if (!assertCommissionerRole("Revoke Commissioner Role")) return;
  var cfg = ensureCommissionerConfig();
  if (key === String(cfg.primaryCommissionerEmail || "").toLowerCase()) {
    showAppToast("⚠️ Change the Primary Commissioner Email first before revoking the primary account.");
    return;
  }
  delete cfg.authorizedCommissioners[key];
  syncCommissionerRolesToFirestore();
  syncCommissionerVisibilityDOM();
  renderCommissionerModalBody();
  showAppToast("🚫 Revoked Commissioner privileges for " + key + ".");
}

// "Commissioner login" used to sign the device in as the primary commissioner with no password.
// Commissioners now sign in like everyone else (Google or email); the console opens for any
// signed-in account on the authorized list (see isVerifiedCommissioner).
function quickSignInAsVerifiedCommissioner() {
  closeSettingsDrawer();
  AUTH_MODAL_MODE = "signin";
  openAuthModal();
  showAppToast("Sign in with your commissioner account to open the console.");
}

// Gate openCommissionerModal & saveCurrentWeekToArchive to verified commissioners only
var _origOpenCommissionerModalV166 = openCommissionerModal;
openCommissionerModal = function(defaultTab) {
  if (!assertCommissionerRole("Commissioner Console")) {
    openAuthModal();
    return;
  }
  _origOpenCommissionerModalV166(defaultTab);
};

var _origSaveCurrentWeekToArchiveV166 = saveCurrentWeekToArchive;
saveCurrentWeekToArchive = function(notifyToast) {
  if (notifyToast && !assertCommissionerRole("Archive Week")) return;
  _origSaveCurrentWeekToArchiveV166(notifyToast);
};

// ---------------------------------------------------------------------------
// 3. Commissioner Pick Management: Delete Picks, Auto-Select Picks & Active Bar
// ---------------------------------------------------------------------------
function clearDeletedFlagForProfile(profKey) {
  if (!profKey) return;
  if (state[profKey]) {
    delete state[profKey]._picksCleared;
  }
  var meta = getProfileMetaByKey(profKey);
  var mName = standardizeParticipantName((meta && (meta.linkedMemberName || meta.name)) || "");
  if (mName) {
    var low = mName.toLowerCase();
    if (state.deletedPicksByMember && state.deletedPicksByMember[low]) {
      delete state.deletedPicksByMember[low];
    }
    var pm = findPoolMemberByName(mName);
    if (pm) {
      delete pm._picksCleared;
    }
  }
}

function commishDeletePlayerPicks(memberName) {
  if (!assertCommissionerRole("Delete Player Picks")) return;
  lastLocalPickTs = Date.now();
  var stdName = standardizeParticipantName(memberName || getProfileDisplayMeta(activeProfile).name);
  var lowName = stdName.toLowerCase();
  if (!state.deletedPicksByMember || typeof state.deletedPicksByMember !== "object") {
    state.deletedPicksByMember = {};
  }
  state.deletedPicksByMember[lowName] = true;

  var pm = findPoolMemberByName(stdName);
  if (pm) {
    pm.picks = {};
    pm._picksCleared = true;
    pm.submittedPicksCount = 0;
    pm.awaitingSheet = true;
    pm.livePts = 0;
    pm.inProgressPts = 0;
    pm.finalPts = 0;
    pm.won1x = 0;
    pm.won2x = 0;
    pm.won3x = 0;
    pm.newLiveTotal = parseFloat(pm.priorPts) || 0;
  }

  // Also clear watchlist rival picks if this player is on the watchlist
  if (state.watchlist && Array.isArray(state.watchlist)) {
    for (var w = 0; w < state.watchlist.length; w++) {
      if (state.watchlist[w] && standardizeParticipantName(state.watchlist[w].name).toLowerCase() === lowName) {
        state.watchlist[w].picks = {};
      }
    }
  }

  var linkedPf = getProfileLinkedToMemberName(stdName);
  var targetProfKeys = [];
  if (linkedPf && linkedPf.key) targetProfKeys.push(linkedPf.key);
  var actMeta = getProfileMetaByKey(activeProfile);
  if (actMeta && standardizeParticipantName(actMeta.linkedMemberName || actMeta.name).toLowerCase() === lowName) {
    if (targetProfKeys.indexOf(activeProfile) === -1) targetProfKeys.push(activeProfile);
  }

  var nowIso = new Date().toISOString();
  var sharedClearPatch = {
    deletedPicksByMember: state.deletedPicksByMember,
    poolMembers: state.poolMembers || [],
    watchlist: state.watchlist || [],
    updatedAt: nowIso
  };

  for (var k = 0; k < targetProfKeys.length; k++) {
    var pk = targetProfKeys[k];
    if (!state[pk]) state[pk] = { picks: {}, tiebreaker: "28-24", target: 20 };
    state[pk].picks = {};
    state[pk]._picksCleared = true;
    state[pk]._manualEditsThisWeek = true;
    state[pk].userLockedPicks = false;
    sharedClearPatch[pk] = state[pk];
    if (fsDb) {
      try {
        fsDb.collection("pickem_v14_users").doc(pk).set({
          picks: {},
          _picksCleared: true,
          currentWeek: state.currentWeek,
          deletedByCommissionerAt: nowIso,
          updatedAt: nowIso
        }, { merge: true }).catch(function(e) { reportCloudSaveFailure("the deleted picks", e); });
      } catch (e) {}
    }
  }

  regradeAllPoolMembersLive();
  saveLocalState();
  if (fsDb) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").set(sharedClearPatch, { merge: true }).catch(function(e) { reportCloudSaveFailure("the deleted picks", e); });
    } catch (e2) {}
  }

  renderAll();
  if (document.getElementById("commish-modal-backdrop") && document.getElementById("commish-modal-backdrop").style.display === "flex") {
    renderCommissionerModalBody();
  }
  if (document.getElementById("review-checklist-backdrop") && document.getElementById("review-checklist-backdrop").style.display === "flex") {
    renderReviewChecklistModalBody();
  }
  showAppToast("🗑️ Deleted all weekly picks for " + stdName + " (0/" + GAMES.length + " selected — nothing auto-selected)!");
}

function commishAutoSelectPlayerPicks(memberName, strategy) {
  if (!assertCommissionerRole("Auto-Select Picks")) return;
  var stdName = standardizeParticipantName(memberName || getProfileDisplayMeta(activeProfile).name);
  lastLocalPickTs = Date.now();
  if (state.deletedPicksByMember) delete state.deletedPicksByMember[stdName.toLowerCase()];
  var resolved = resolveOrCreateProfileForMember(stdName, stdName, "", "");
  var pKey = resolved.profileKey;
  clearDeletedFlagForProfile(pKey);
  if (!state[pKey]) state[pKey] = { picks: {}, tiebreaker: "28-24", target: 20 };
  state[pKey].picks = {};
  delete state[pKey]._picksCleared;

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var pick = g.rec;
    if (strategy === "chalk" || strategy === "safe") {
      pick = (getTeamWinProb(g, "away") >= getTeamWinProb(g, "home")) ? g.away : g.home;
    } else if (strategy === "dogs" || strategy === "aggressive") {
      var dog = g.awayPts > 1 ? g.away : (g.homePts > 1 ? g.home : null);
      var dogProb = (dog === g.away) ? getTeamWinProb(g, "away") : getTeamWinProb(g, "home");
      pick = (dog && dogProb >= 0.25) ? dog : g.rec;
    } else if (strategy === "random") {
      pick = (Math.random() < 0.5) ? g.away : g.home;
    } else if (strategy === "away") {
      pick = g.away;
    } else if (strategy === "home") {
      pick = g.home;
    } else {
      pick = g.rec; // Optimal EV
    }
    state[pKey].picks[g.id] = pick;
    state[pKey].picks[String(g.id)] = pick;
  }
  state[pKey]._manualEditsThisWeek = true;

  var pm = findPoolMemberByName(stdName);
  if (pm) {
    pm.picks = Object.assign({}, state[pKey].picks);
    pm.awaitingSheet = false;
  }

  saveCurrentState(pKey, false);
  regradeAllPoolMembersLive();
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  if (document.getElementById("commish-modal-backdrop") && document.getElementById("commish-modal-backdrop").style.display === "flex") {
    renderCommissionerModalBody();
  }
  showAppToast("⚡ Auto-selected all " + GAMES.length + " picks (" + String(strategy || "optimal").toUpperCase() + ") for " + stdName + "!");
}

function exitCommissionerImpersonateMode() {
  if (AUTH_SESSION) {
    AUTH_SESSION.adminUnlock = false;
    if (AUTH_SESSION.boundProfileKey) activeProfile = AUTH_SESSION.boundProfileKey;
    saveDeviceAuthSession();
  }
  renderCommishActiveEditBar();
  renderAll();
  showAppToast("✅ Exited Commissioner Player Edit Mode.");
}

function renderCommishActiveEditBar() {
  var bar = document.getElementById("commish-active-edit-bar");
  if (!bar) return;
  if (!isVerifiedCommissioner() || !AUTH_SESSION || !AUTH_SESSION.adminUnlock) {
    bar.style.display = "none";
    bar.classList.add("commish-only-hidden");
    return;
  }
  bar.classList.remove("commish-only-hidden");
  bar.style.display = "flex";

  var curMeta = getProfileDisplayMeta(activeProfile);
  var pmList = state.poolMembers || [];
  var opts = "";
  for (var i = 0; i < pmList.length; i++) {
    var n = pmList[i].name;
    var sel = (standardizeParticipantName(n).toLowerCase() === standardizeParticipantName(curMeta.name).toLowerCase()) ? " selected" : "";
    opts += '<option value="' + n.replace(/"/g, '&quot;') + '"' + sel + '>👤 ' + n + '</option>';
  }

  var safeName = jsArgAttr(curMeta.name);
  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<span class="badge badge-2x" style="font-size:0.73rem;padding:4px 9px;">👑 COMMISH PICK EDITOR</span>' +
      '<select class="search-input" style="max-width:190px;padding:4px 8px;font-size:0.75rem;font-weight:800;color:var(--warn);border-color:var(--border);" onchange="commissionerSwitchToMember(this.value)">' + opts + '</select>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-size:0.7rem;color:var(--warn);font-weight:800;">⚡ Auto-Select:</span>' +
      '<button type="button" class="btn-sm" style="padding:4px 8px;font-size:0.69rem;border-color:var(--border);color:var(--win);" onclick="commishAutoSelectPlayerPicks(\'' + safeName + '\', \'optimal\')">★ Optimal EV</button>' +
      '<button type="button" class="btn-sm" style="padding:4px 8px;font-size:0.69rem;border-color:var(--border);color:var(--text);" onclick="commishAutoSelectPlayerPicks(\'' + safeName + '\', \'chalk\')">🔒 All Favorites</button>' +
      '<button type="button" class="btn-sm" style="padding:4px 8px;font-size:0.69rem;border-color:var(--border);color:var(--warn);" onclick="commishAutoSelectPlayerPicks(\'' + safeName + '\', \'dogs\')">🚀 Underdog Chaser</button>' +
      '<button type="button" class="btn-sm" style="padding:4px 8px;font-size:0.69rem;background:var(--raised);border-color:var(--border);color:var(--loss);font-weight:800;" onclick="commishDeletePlayerPicks(\'' + safeName + '\')">🗑️ Delete Picks</button>' +
      '<button type="button" class="btn-sm" style="padding:4px 9px;font-size:0.69rem;background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="exitCommissionerImpersonateMode()">✓ Done</button>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// 4. Multi-Buy-In Account Linking (Multiple Team Entries Under One Email)
// ---------------------------------------------------------------------------
function ensureMultiBuyInEntries() {
  if (!AUTH_SESSION || !AUTH_SESSION.boundProfileKey) return [];
  if (!Array.isArray(AUTH_SESSION.linkedEntries) || AUTH_SESSION.linkedEntries.length === 0) {
    var bMeta = getProfileDisplayMeta(AUTH_SESSION.boundProfileKey);
    AUTH_SESSION.linkedEntries = [{
      profileKey: AUTH_SESSION.boundProfileKey,
      memberName: AUTH_SESSION.linkedMemberName || bMeta.name,
      label: "Entry #1: " + (AUTH_SESSION.linkedMemberName || bMeta.name)
    }];
  }
  return AUTH_SESSION.linkedEntries;
}

function isMyLinkedBuyInProfile(profKey) {
  if (profKey === "test") return true;
  if (!AUTH_SESSION) return profKey === getMyInstanceProfileKey();
  if (AUTH_SESSION.adminUnlock && isVerifiedCommissioner()) return true;
  if (AUTH_SESSION.boundProfileKey === profKey) return true;
  var list = ensureMultiBuyInEntries();
  for (var i = 0; i < list.length; i++) {
    if (list[i].profileKey === profKey) return true;
  }
  return false;
}

// Override isMyOwnInstanceProfile & canEditProfileInCurrentInstance so multi-buy-in entries are all editable by the owner!
isMyOwnInstanceProfile = function(profKey) {
  return isMyLinkedBuyInProfile(profKey);
};
canEditProfileInCurrentInstance = function(profKey) {
  if (!isAccountInstanceLocked()) return true;
  return isMyLinkedBuyInProfile(profKey);
};

function switchLinkedBuyInEntry(targetProfileKey) {
  if (!targetProfileKey) return;
  if (AUTH_SESSION && isMyLinkedBuyInProfile(targetProfileKey) && targetProfileKey !== "test") {
    AUTH_SESSION.boundProfileKey = targetProfileKey;
    var entries = ensureMultiBuyInEntries();
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].profileKey === targetProfileKey) {
        AUTH_SESSION.linkedMemberName = entries[i].memberName;
        AUTH_SESSION.displayName = entries[i].memberName;
        break;
      }
    }
  }
  activeProfile = targetProfileKey;
  saveDeviceAuthSession();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  var meta = getProfileDisplayMeta(targetProfileKey);
  showAppToast("🏈 Switched active buy-in entry to " + meta.name + "!");
}

function addLinkedBuyInEntryFromInput(inputId) {
  var inp = document.getElementById(inputId || "new-buyin-entry-name");
  var rawName = inp ? String(inp.value || "").trim() : "";
  if (!AUTH_SESSION) {
    showAppToast("⚠️ Sign in to your account first before linking multiple buy-in entries.");
    openAuthModal();
    return;
  }
  var entries = ensureMultiBuyInEntries();
  if (!rawName) {
    rawName = (AUTH_SESSION.linkedMemberName || AUTH_SESSION.displayName || "Player") + " #" + (entries.length + 1);
  }
  var stdName = standardizeParticipantName(rawName);
  var resolved = resolveOrCreateProfileForMember(stdName, stdName, AUTH_SESSION.uid || "", AUTH_SESSION.email || "");

  // Ensure the new buy-in entry is also on the pool roster if not already there
  if (!findPoolMemberByName(stdName)) {
    state.poolMembers.push({
      name: stdName,
      priorPts: 0,
      priorRank: "Buy-In #" + (entries.length + 1),
      tiebreaker: "28-24",
      picks: Object.assign({}, state[resolved.profileKey].picks || {}),
      awaitingSheet: false,
      livePts: 0,
      inProgressPts: 0,
      finalPts: 0,
      newLiveTotal: 0
    });
    state.leaderboard.push({
      rank: String(state.leaderboard.length + 1),
      name: stdName,
      priorPts: 0,
      note: "Linked Buy-In (" + (AUTH_SESSION.email || "Multi-Entry") + ")"
    });
  }

  var exists = false;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].profileKey === resolved.profileKey) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    entries.push({
      profileKey: resolved.profileKey,
      memberName: resolved.displayName,
      label: "Entry #" + (entries.length + 1) + ": " + resolved.displayName
    });
  }

  AUTH_SESSION.boundProfileKey = resolved.profileKey;
  AUTH_SESSION.linkedMemberName = resolved.displayName;
  AUTH_SESSION.displayName = resolved.displayName;
  activeProfile = resolved.profileKey;

  if (fsDb && AUTH_SESSION.email) {
    var emailDocKey = "email_" + String(AUTH_SESSION.email).toLowerCase().replace(/[^a-z0-9]/g, "_");
    try {
      fsDb.collection("pickem_v14_accounts").doc(emailDocKey).set({
        linkedEntries: entries,
        boundProfileKey: resolved.profileKey,
        linkedMemberName: resolved.displayName,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(function(e) { reportCloudSaveFailure("your linked entries", e); });
    } catch (e) {}
  }

  saveDeviceAuthSession();
  regradeAllPoolMembersLive();
  pushMultiUserAndPrivacyToFirebase();
  syncActiveProfileControlsUI();
  updateAuthUI();
  renderAll();
  if (document.getElementById("settings-drawer-backdrop") && document.getElementById("settings-drawer-backdrop").style.display === "flex") {
    renderSettingsDrawerBody();
  }
  showAppToast("✅ Linked Buy-In Entry '" + resolved.displayName + "' under " + (AUTH_SESSION.email || "your account") + "!");
}

function renderMultiBuyInEntryStrip() {
  var strip = document.getElementById("multi-buyin-entry-strip");
  if (!strip) return;
  if (!AUTH_SESSION || GUEST_BROWSING_MODE) {
    strip.style.display = "none";
    return;
  }
  var entries = ensureMultiBuyInEntries();
  strip.style.display = "flex";
  var pillsHtml = '<span class="entry-label">Entries</span>';
  for (var i = 0; i < entries.length; i++) {
    var en = entries[i];
    var isAct = (activeProfile === en.profileKey);
    var isLockedEntry = isCurrentProfileManuallyLocked(en.profileKey);
    pillsHtml += '<button type="button" class="entry-pill-btn' + (isAct ? ' active' : '') + '" aria-pressed="' + isAct + '" onclick="switchLinkedBuyInEntry(\'' + en.profileKey + '\')">' +
      en.memberName + (isLockedEntry ? ' (locked)' : '') +
    '</button>';
  }
  pillsHtml +=
    '<span class="entry-add">' +
      '<input type="text" id="inline-buyin-entry-input" class="search-input" placeholder="2nd entry name" aria-label="Second buy-in entry name" />' +
      '<button type="button" class="btn-sm" onclick="addLinkedBuyInEntryFromInput(\'inline-buyin-entry-input\')">Add buy-in</button>' +
    '</span>';
  strip.innerHTML = pillsHtml;
}

// ---------------------------------------------------------------------------
// 5. Manual "Lock Picks" Feature in Simple View + Locked Monday Odds Enforcement
// ---------------------------------------------------------------------------
function isCurrentProfileManuallyLocked(profKey) {
  var pk = profKey || activeProfile;
  if (!state[pk]) return false;
  if (!state[pk].userLockedPicks) return false;
  var curWk = parseInt(state.currentWeek, 10);
  var lockedWk = parseInt(state[pk].userLockedWeek, 10);
  if (curWk && lockedWk && lockedWk !== curWk) {
    state[pk].userLockedPicks = false;
    delete state[pk].userLockedWeek;
    return false;
  }
  return true;
}

function toggleManualUserPickLock(forceLockState) {
  if (!state[activeProfile]) state[activeProfile] = { picks: {}, tiebreaker: "28-24", target: 20 };
  if (isWeekLockedForActiveProfile() && !(AUTH_SESSION && AUTH_SESSION.adminUnlock && isVerifiedCommissioner())) {
    showAppToast("🔒 The " + pickDeadlineLabel() + " deadline has passed — picks are locked for the week.");
    return;
  }
  var nextState = (typeof forceLockState === "boolean") ? forceLockState : !state[activeProfile].userLockedPicks;
  state[activeProfile].userLockedPicks = nextState;
  state[activeProfile].userLockedWeek = nextState ? (parseInt(state.currentWeek, 10) || 0) : null;
  saveCurrentState(activeProfile, false);
  renderSimpleGuestAccountBar();
  renderAll();
  if (document.getElementById("review-checklist-backdrop") && document.getElementById("review-checklist-backdrop").style.display === "flex") {
    renderReviewChecklistModalBody();
  }
  if (nextState) {
    showAppToast("🔒 Picks LOCKED for " + getProfileDisplayMeta(activeProfile).name + "! Accidental edits are now blocked.");
  } else {
    showAppToast("🔓 Picks UNLOCKED for editing (" + getProfileDisplayMeta(activeProfile).name + "). Remember to Lock Picks when finished!");
  }
}

function syncManualLockButtonUI() {
  var btn = document.getElementById("btn-simple-manual-lock");
  var pill = document.getElementById("simple-lock-deadline-pill");
  var isUserLocked = isCurrentProfileManuallyLocked();
  var isCommishLocked = isWeekLockedForActiveProfile();

  if (btn) {
    btn.textContent = isCommishLocked ? "Locked for the week" : (isUserLocked ? "Unlock picks" : "Lock picks");
    btn.setAttribute("aria-pressed", isUserLocked ? "true" : "false");
  }
  if (pill) {
    pill.className = "lock-text";
    pill.textContent = isCommishLocked ? "Locked" : (isUserLocked ? "You locked your picks" : "Locks " + pickDeadlineLabel());
  }

  var revCountEl = document.getElementById("top-review-count");
  if (revCountEl) {
    var c = countMatchingPicksForSlate(getMyPicksMap(), GAMES);
    revCountEl.textContent = c.matched + "/" + GAMES.length;
  }
}

// Wrap pickSide & pickSideForProfile to enforce Manual User Pick Lock
var _origPickSideV166 = pickSide;
pickSide = function(gameId, sideCode) {
  if (isCurrentProfileManuallyLocked() && !(AUTH_SESSION && AUTH_SESSION.adminUnlock && isVerifiedCommissioner())) {
    showAppToast("🔒 Your picks are locked to prevent accidental edits! Tap '🔒 Picks Locked ✓ (Tap to Unlock)' above if you want to change a pick.");
    return;
  }
  _origPickSideV166(gameId, sideCode);
  syncManualLockButtonUI();
  if (document.getElementById("review-checklist-backdrop") && document.getElementById("review-checklist-backdrop").style.display === "flex") {
    renderReviewChecklistModalBody();
  }
};

var _origPickSideForProfileV166 = pickSideForProfile;
pickSideForProfile = function(profKey, gameId, sideCode) {
  if (isCurrentProfileManuallyLocked(profKey) && !(AUTH_SESSION && AUTH_SESSION.adminUnlock && isVerifiedCommissioner())) {
    showAppToast("🔒 Picks for " + getProfileDisplayMeta(profKey).name + " are locked! Unlock picks first to make changes.");
    return;
  }
  _origPickSideForProfileV166(profKey, gameId, sideCode);
  syncManualLockButtonUI();
};

// ---------------------------------------------------------------------------
// 6. Condensed Simple View & Detailed Simple Cards
// ---------------------------------------------------------------------------
function syncSimpleModeTabHighlights() {
  if (!SIMPLE_UI_MODE || currentMainView !== "cards") return;
  var isCond = (SIMPLE_CARD_LAYOUT_STYLE === "condensed");
  var tCards = document.getElementById("tab-mode-cards");
  var tCond = document.getElementById("tab-mode-condensed");
  var mCards = document.getElementById("mnav-cards");
  var mCond = document.getElementById("mnav-condensed");
  // Both simple layout styles live under the Picks tab.
  if (tCards) tCards.className = "mode-tab-btn active";
  if (tCond) tCond.className = "mode-tab-btn";
  if (mCards) mCards.className = "m-nav-btn active";
  if (mCond) mCond.className = "m-nav-btn";
  if (typeof syncNavAriaCurrent === "function") syncNavAriaCurrent();
}

function setSimpleCardLayoutStyle(styleMode) {
  SIMPLE_CARD_LAYOUT_STYLE = (styleMode === "detailed") ? "detailed" : "condensed";
  safeSetStorage("sat_simple_card_style_v16", SIMPLE_CARD_LAYOUT_STYLE);
  var bCond = document.getElementById("btn-simple-style-condensed");
  var bDet = document.getElementById("btn-simple-style-detailed");
  if (bCond) bCond.className = "btn-sm" + (SIMPLE_CARD_LAYOUT_STYLE === "condensed" ? " active" : "");
  if (bDet) bDet.className = "btn-sm" + (SIMPLE_CARD_LAYOUT_STYLE === "detailed" ? " active" : "");
  syncSimpleModeTabHighlights();
  renderGames();
}

function renderCondensedSimpleGamesHtml() {
  ensureMondayLockedOddsOnGames();
  var q = (document.getElementById("team-search") ? document.getElementById("team-search").value : "").trim().toLowerCase();
  var picks = (state[activeProfile] && state[activeProfile].picks) ? state[activeProfile].picks : {};
  var isLocked = isCurrentProfileManuallyLocked() || isWeekLockedForActiveProfile();
  var html = '<div class="simple-condensed-list">';
  var countRendered = 0;

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var monLine = g.mondayPoolLine || g.poolLine;
    var aPts = g.mondayAwayPts || g.awayPts || 1;
    var hPts = g.mondayHomePts || g.homePts || 1;
    var maxPts = Math.max(aPts, hPts);

    if (currentFilter === "2x" && maxPts !== 2) continue;
    if (currentFilter === "3x" && maxPts !== 3) continue;
    if (currentFilter === "inj") {
      var hdr = g.keyInjHeader || computeKeyInjHeaderFromLists(g);
      if (!hdr) continue;
    }
    if (q) {
      var hay = (g.away + " " + g.home + " " + g.awayCode + " " + g.homeCode + " " + monLine).toLowerCase();
      if (hay.indexOf(q) === -1) continue;
    }

    countRendered++;
    var myPick = getResolvedPickForGame(picks, g, true);
    var pickedAway = isSameTeamPick(myPick, g.away, g);
    var pickedHome = isSameTeamPick(myPick, g.home, g);

    var multBadge = maxPts === 3
      ? '<span class="badge badge-3x">3x Underdog (+14.5+)</span>'
      : (maxPts === 2 ? '<span class="badge badge-2x">2x Underdog (+7.5–14)</span>' : '<span class="badge badge-1x">1x Even</span>');

    var cardCls = "simple-cond-card" + (maxPts === 3 ? " mult-3x" : (maxPts === 2 ? " mult-2x" : ""));
    var lockBtnCls = isLocked ? " locked-disabled" : "";

    html +=
      '<div class="' + cardCls + '" id="game-card-' + g.id + '">' +
        '<div class="simple-cond-info">' +
          '<div class="simple-cond-matchup">' +
            '<span class="game-num">#' + g.id + '</span>' +
            '<span>' + g.away + ' <span style="color:var(--muted);font-weight:600;">at</span> ' + g.home + '</span>' +
            multBadge +
          '</div>' +
          '<div class="simple-cond-meta">' +
            '<span style="color:var(--text);font-weight:800;">🔒 Monday Line: ' + monLine + '</span>' +
            '<span>• ' + (g.kick || 'Saturday CST') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="simple-cond-picks">' +
          '<button type="button" class="simple-pick-btn' + (pickedAway ? ' picked' : '') + lockBtnCls + '" onclick="pickSide(' + g.id + ', 1)">' +
            '<span>' + (pickedAway ? '✓ ' : '') + g.away + '</span>' +
            '<span class="pts-pill ' + (aPts === 3 ? 'pts-3x' : (aPts === 2 ? 'pts-2x' : '')) + '">' + aPts + 'x</span>' +
          '</button>' +
          '<button type="button" class="simple-pick-btn' + (pickedHome ? ' picked' : '') + lockBtnCls + '" onclick="pickSide(' + g.id + ', 2)">' +
            '<span>' + (pickedHome ? '✓ ' : '') + g.home + '</span>' +
            '<span class="pts-pill ' + (hPts === 3 ? 'pts-3x' : (hPts === 2 ? 'pts-2x' : '')) + '">' + hPts + 'x</span>' +
          '</button>' +
        '</div>' +
      '</div>';
  }
  html += '</div>';
  if (countRendered === 0) {
    html = '<div class="side-box" style="text-align:center;color:var(--muted);">No games match that filter.</div>';
  }
  return html;
}

// Wrap renderGames so in Simple Mode + Condensed Layout it renders the ultra-clean Condensed Simple View,
// and in Detailed Simple Cards it locks Monday odds!
var _origRenderGamesV166 = renderGames;
renderGames = function() {
  ensureMondayLockedOddsOnGames();
  syncManualLockButtonUI();
  renderMultiBuyInEntryStrip();
  renderCommishActiveEditBar();

  var bCond = document.getElementById("btn-simple-style-condensed");
  var bDet = document.getElementById("btn-simple-style-detailed");
  if (bCond) bCond.className = "btn-sm" + (SIMPLE_CARD_LAYOUT_STYLE === "condensed" ? " active" : "");
  if (bDet) bDet.className = "btn-sm" + (SIMPLE_CARD_LAYOUT_STYLE === "detailed" ? " active" : "");

  if (SIMPLE_UI_MODE && SIMPLE_CARD_LAYOUT_STYLE === "condensed") {
    var container = document.getElementById("games-container");
    if (container) {
      container.innerHTML = renderCondensedSimpleGamesHtml();
      return;
    }
  }
  _origRenderGamesV166();
};

// Also ensure updateSingleGameCardPickUI works seamlessly when in Condensed Simple View
var _origUpdateSingleGameCardPickUIV166 = updateSingleGameCardPickUI;
updateSingleGameCardPickUI = function(g) {
  if (SIMPLE_UI_MODE && SIMPLE_CARD_LAYOUT_STYLE === "condensed") {
    renderGames();
    return true;
  }
  return _origUpdateSingleGameCardPickUIV166(g);
};

// ---------------------------------------------------------------------------
// 7. Mobile Navigation Handler (Fixes Standings & Board Tab in Simple & Advanced)
// ---------------------------------------------------------------------------
function handleMobileNavClick(targetMode) {
  closeSettingsDrawer();
  closeEvSimulatorDrawer();
  toggleMobileSidebar(false);

  if (SIMPLE_UI_MODE && targetMode === "condensed") {
    switchMainView("condensed");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (SIMPLE_UI_MODE && targetMode === "cards") {
    switchMainView("cards");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  switchMainView(targetMode);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

var _origSwitchMainViewV166 = switchMainView;
switchMainView = function(mode) {
  if (SIMPLE_UI_MODE && mode === "condensed") {
    SIMPLE_CARD_LAYOUT_STYLE = "condensed";
    safeSetStorage("sat_simple_card_style_v16", "condensed");
    _origSwitchMainViewV166("cards");
    syncSimpleModeTabHighlights();
    return;
  }
  if (SIMPLE_UI_MODE && mode === "cards") {
    // Re-selecting Picks no longer flips the card layout; that lives in the Picks ⋯ menu.
    _origSwitchMainViewV166("cards");
    syncSimpleModeTabHighlights();
    return;
  }
  _origSwitchMainViewV166(mode);
};

// ---------------------------------------------------------------------------
// 8. Compact 23-Game Review Checklist Modal (Works in Simple & Advanced Modes)
// ---------------------------------------------------------------------------
function openReviewChecklistModal() {
  var bd = document.getElementById("review-checklist-backdrop");
  if (!bd) return;
  bd.style.display = "flex";
  renderReviewChecklistModalBody();
}

function closeReviewChecklistModal() {
  var bd = document.getElementById("review-checklist-backdrop");
  if (bd) bd.style.display = "none";
}

function flipPickFromReviewChecklist(gameId) {
  var g = findGameById(gameId);
  if (!g) return;
  if (isCurrentProfileManuallyLocked() && !(AUTH_SESSION && AUTH_SESSION.adminUnlock && isVerifiedCommissioner())) {
    showAppToast("🔒 Unlock your picks first using the button below to flip a selection.");
    return;
  }
  var cur = getResolvedPickForGame(state[activeProfile].picks, g, true);
  var nextSide = isSameTeamPick(cur, g.away, g) ? 2 : 1;
  pickSide(gameId, nextSide);
  renderReviewChecklistModalBody();
}

function renderReviewChecklistModalBody() {
  var body = document.getElementById("review-checklist-body");
  if (!body) return;
  ensureMondayLockedOddsOnGames();

  var meta = getProfileDisplayMeta(activeProfile);
  var picks = (state[activeProfile] && state[activeProfile].picks) ? state[activeProfile].picks : {};
  var tb = (state[activeProfile] && state[activeProfile].tiebreaker) ? state[activeProfile].tiebreaker : "28-24";
  var isLocked = isCurrentProfileManuallyLocked();
  var count1x = 0, count2x = 0, count3x = 0, totalCeiling = 0, selectedTotal = 0;

  var rowsHtml = "";
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var p = getResolvedPickForGame(picks, g, false);
    var monLine = g.mondayPoolLine || g.poolLine;
    var pts = 0;
    var multBadge = '<span class="badge badge-3x">— Unselected</span>';
    var pickCellHtml = '<span style="color:var(--loss);font-weight:800;">⚠️ No Pick Selected</span>';
    if (p) {
      selectedTotal++;
      var isAway = isSameTeamPick(p, g.away, g);
      pts = getGamePickPts(g, isAway);
      if (pts === 3) count3x++;
      else if (pts === 2) count2x++;
      else count1x++;
      totalCeiling += pts;
      multBadge = pts === 3
        ? '<span class="badge badge-3x">3 pts (3x Dog)</span>'
        : (pts === 2 ? '<span class="badge badge-2x">2 pts (2x Dog)</span>' : '<span class="badge badge-1x">1 pt</span>');
      pickCellHtml = '<strong style="color:var(--win);">✓ ' + p + '</strong>';
    }

    rowsHtml +=
      '<tr>' +
        '<td><strong>#' + g.id + '</strong></td>' +
        '<td><strong>' + g.away + '</strong> <span style="color:var(--muted);">at</span> <strong>' + g.home + '</strong></td>' +
        '<td style="color:var(--text);font-size:0.71rem;">🔒 ' + monLine + '</td>' +
        '<td>' + pickCellHtml + '</td>' +
        '<td>' + multBadge + '</td>' +
        '<td>' +
          '<button type="button" class="btn-sm" style="padding:2px 8px;font-size:0.67rem;" onclick="flipPickFromReviewChecklist(' + g.id + ')" ' + (isLocked ? 'disabled' : '') + '>' + (p ? '⇄ Flip' : '➕ Pick Away') + '</button>' +
        '</td>' +
      '</tr>';
  }

  body.innerHTML =
    '<div class="commish-kpi-strip" style="margin-bottom:10px;">' +
      '<div class="commish-kpi"><div class="metric-label">Entry / Profile</div><div class="metric-val" style="color:var(--legacy-accent);font-size:0.95rem;">' + escapeHtml(meta.name) + '</div><div class="metric-sub">' + GAMES.length + ' / ' + GAMES.length + ' Games Selected</div></div>' +
      '<div class="commish-kpi"><div class="metric-label">Multiplier Breakdown</div><div class="metric-val" style="font-size:0.95rem;">' + count1x + '×1pt • ' + count2x + '×2pt • ' + count3x + '×3pt</div><div class="metric-sub">Max Ceiling: ' + totalCeiling + ' pts</div></div>' +
      '<div class="commish-kpi"><div class="metric-label">Official Tie-Breaker</div><div class="metric-val" style="color:var(--gold);font-size:0.95rem;">' + escapeHtml(tb) + '</div><div class="metric-sub">Highest Score First</div></div>' +
      '<div class="commish-kpi"><div class="metric-label">Submission Lock</div><div class="metric-val" style="color:' + (isLocked ? 'var(--green)' : 'var(--amber)') + ';font-size:0.95rem;">' + (isLocked ? '🔒 LOCKED' : '🔓 UNLOCKED') + '</div><div class="metric-sub">' + (isLocked ? 'Protected from accidental edits' : 'Click Lock Picks below to confirm') + '</div></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:8px 10px;background:var(--panel-alt);border-radius:9px;border:1px solid var(--border-muted);">' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<label style="font-size:0.74rem;font-weight:800;color:var(--text);">🎯 Verify Tie-Breaker:</label>' +
        '<input type="text" class="search-input" style="width:90px;min-width:0;padding:4px 8px;font-weight:800;text-align:center;" value="' + tb.replace(/"/g, '&quot;') + '" oninput="syncSimpleTiebreakerInput(this.value); document.getElementById(\'simple-tiebreaker-input\').value=this.value;" />' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button type="button" class="btn-sm" style="font-weight:900;padding:6px 12px;' + (isLocked ? 'background:var(--accent);border-color:var(--border);color:var(--loss);' : 'background:var(--accent);color:var(--on-accent);border:none;') + '" onclick="' + (isLocked ? 'toggleManualUserPickLock(false)' : 'closeReviewChecklistModal(); onPrimaryPicksAction();') + '">' +
          (isLocked ? '🔓 Unlock Picks to Edit' : '🔒 Lock picks') +
        '</button>' +
        (isLocked ? '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;padding:6px 12px;" onclick="closeReviewChecklistModal(); sendPicksToOfficialForm();">Send picks</button>' : '') +
        '<button type="button" class="btn-sm" onclick="copyPicksToClipboard()">📋 Copy List</button>' +
      '</div>' +
    '</div>' +
    '<div style="max-height:420px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:10px;">' +
      '<table class="condensed-table">' +
        '<thead><tr><th>#</th><th>Matchup</th><th>Monday Locked Line</th><th>Your Selection</th><th>Multiplier</th><th>Quick Flip</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// 9. Slide-Out Settings Drawer & Slide-Out EV Simulator Drawer + Desktop Rail Collapse
// ---------------------------------------------------------------------------
function toggleDesktopSidebarCollapse() {
  DESKTOP_SIDEBAR_COLLAPSED = !DESKTOP_SIDEBAR_COLLAPSED;
  var layout = document.getElementById("main-layout");
  var btn = document.getElementById("btn-toggle-desktop-rail");
  if (layout) layout.classList.toggle("sidebar-collapsed", DESKTOP_SIDEBAR_COLLAPSED);
  if (btn) {
    btn.setAttribute("aria-pressed", DESKTOP_SIDEBAR_COLLAPSED ? "true" : "false");
    btn.setAttribute("aria-label", DESKTOP_SIDEBAR_COLLAPSED ? "Show side panel" : "Hide side panel");
    btn.textContent = DESKTOP_SIDEBAR_COLLAPSED ? "Show side panel" : "Hide side panel";
  }
}

function openSettingsDrawer() {
  var bd = document.getElementById("settings-drawer-backdrop");
  if (!bd) return;
  bd.style.display = "flex";
  renderSettingsDrawerBody();
}

function closeSettingsDrawer() {
  var bd = document.getElementById("settings-drawer-backdrop");
  if (bd) bd.style.display = "none";
}

function renderSettingsDrawerBody() {
  var body = document.getElementById("settings-drawer-body");
  if (!body) return;
  ensureMultiUserAndPrivacyState();
  var myKey = getMyInstanceProfileKey();
  var myMeta = getProfileDisplayMeta(myKey);
  var myPriv = state.profilePrivacy[myKey] || { hidden: false };
  var isCommish = isVerifiedCommissioner();
  var entries = ensureMultiBuyInEntries();

  var entriesHtml = "";
  if (AUTH_SESSION && !GUEST_BROWSING_MODE) {
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      var isAct = (activeProfile === en.profileKey);
      entriesHtml += '<button type="button" class="entry-pill-btn' + (isAct ? ' active' : '') + '" onclick="switchLinkedBuyInEntry(\'' + en.profileKey + '\'); renderSettingsDrawerBody();">' +
        '🏈 #' + (i + 1) + ': ' + en.memberName +
      '</button>';
    }
  }

  var commishDrawerHtml = "";
  if (isCommish) {
    commishDrawerHtml =
      '<div class="drawer-section" style="border-color:var(--border);">' +
        '<div class="drawer-section-title" style="color:var(--warn);"><span>👑 Verified Commissioner Controls</span><span class="badge badge-ev">Authorized</span></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
          '<button type="button" class="btn-sm commish-top-btn" onclick="closeSettingsDrawer(); openCommissionerModal(\'submissions\');">👑 Commish Console</button>' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--win);font-weight:800;" onclick="closeSettingsDrawer(); openCommissionerModal(\'mastersheet\');">📊 Master Sheet Grid</button>' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);" onclick="saveCurrentWeekToArchive(true)">💾 Archive Week</button>' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);" onclick="closeSettingsDrawer(); openUnifiedImportModal(\'bot\');">📥 Import / Bot Hub</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:4px;">' +
          '<span style="font-size:0.71rem;color:var(--muted);">📚 Switch Archived Week:</span>' +
          '<select id="drawer-week-archive-select" class="compare-select" onchange="switchWeekArchive(this.value); renderSettingsDrawerBody();"></select>' +
        '</div>' +
      '</div>';
  }

  body.innerHTML =
    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>👤 Account & Multi-Buy-In Entries</span><span class="badge ' + (AUTH_SESSION ? 'badge-ev' : 'badge-2x') + '">' + (AUTH_SESSION ? 'Signed In' : 'Guest / Local') + '</span></div>' +
      '<div style="font-size:0.76rem;color:var(--text);">Active Entry: <strong style="color:var(--text);">' + escapeHtml(getProfileDisplayMeta(activeProfile).name) + '</strong> ' + (AUTH_SESSION && AUTH_SESSION.email ? ('<span style="color:var(--muted);">(' + AUTH_SESSION.email + ')</span>') : '') + '</div>' +
      (AUTH_SESSION ? (
        '<div style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0;">' + entriesHtml +
          '<button type="button" class="entry-pill-btn' + (activeProfile === "test" ? ' active' : '') + '" onclick="switchProfile(\'test\'); renderSettingsDrawerBody();">🧪 Sandbox Sim</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:4px;">' +
          '<input type="text" id="drawer-new-buyin-input" class="search-input" style="flex:1;min-width:0;padding:5px 8px;font-size:0.73rem;" placeholder="Link 2nd Buy-In Entry Name..." />' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);font-weight:800;" onclick="addLinkedBuyInEntryFromInput(\'drawer-new-buyin-input\')">➕ Add Buy-In</button>' +
        '</div>'
      ) : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
        '<button type="button" class="btn-sm" style="flex:1;background:var(--raised);color:var(--text);border:none;font-weight:800;" onclick="closeSettingsDrawer(); openAuthModal();">' + (AUTH_SESSION ? '⚙️ Manage Account' : '🔑 Sign In / Create Account') + '</button>' +
        (!isCommish ? '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--warn);font-weight:800;" onclick="quickSignInAsVerifiedCommissioner()">👑 Commish Login</button>' : '') +
      '</div>' +
    '</div>' +

    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>🎛️ View Mode & Simulators</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
        '<button type="button" class="btn-sm ' + (!SIMPLE_UI_MODE ? 'active' : '') + '" onclick="toggleSimpleUiMode(); renderSettingsDrawerBody();">' + (SIMPLE_UI_MODE ? '🧠 Enable Advanced Mode' : '✨ Return to Simple Mode') + '</button>' +
        '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--win);font-weight:800;" onclick="closeSettingsDrawer(); openEvSimulatorDrawer();">🎲 Open EV Simulator</button>' +
        '<button type="button" class="btn-sm ' + (SIMPLE_CARD_LAYOUT_STYLE === "condensed" ? 'active' : '') + '" onclick="setSimpleCardLayoutStyle(\'condensed\'); renderSettingsDrawerBody();">Compact cards</button>' +
        '<button type="button" class="btn-sm ' + (SIMPLE_CARD_LAYOUT_STYLE === "detailed" ? 'active' : '') + '" onclick="setSimpleCardLayoutStyle(\'detailed\'); renderSettingsDrawerBody();">Last 5 open</button>' +
      '</div>' +
    '</div>' +

    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>🔒 Pick Privacy & Spy Shield</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
        '<button type="button" class="btn-sm ' + (myPriv.hidden ? 'active' : '') + '" onclick="toggleQuickLockActiveProfile(); renderSettingsDrawerBody();">' + (myPriv.hidden ? '🔒 Hidden Pre-Kickoff' : '👁️ Picks Public') + '</button>' +
        '<button type="button" class="btn-sm ' + (BLIND_MODE ? 'active' : '') + '" onclick="toggleBlindMode(); renderSettingsDrawerBody();">' + (BLIND_MODE ? '🙈 Spy Shield: ON' : '👁️ Spy Shield: OFF') + '</button>' +
      '</div>' +
      '<button type="button" class="btn-sm" style="width:100%;border-color:var(--border);color:var(--text);" onclick="closeSettingsDrawer(); openUserAndPrivacyModal();">⚙️ Full Pick Privacy & H2H Settings</button>' +
    '</div>' +

    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>🏟️ Interactive Field Tracker & Live Sync</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
        '<button type="button" class="btn-sm ' + (DEMO_FIELD_PREVIEW ? 'active' : '') + '" onclick="toggleDemoFieldPreview(); renderSettingsDrawerBody();">' + (DEMO_FIELD_PREVIEW ? '🎮 Field Sim: ON' : '🏈 Field Sim: OFF') + '</button>' +
        '<button type="button" class="btn-sm" onclick="syncAllLiveTrackingData(true); closeSettingsDrawer();">🔄 Sync Live ESPN</button>' +
      '</div>' +
    '</div>' +
    commishDrawerHtml;

  // Populate archive dropdown if commissioner
  if (isCommish) {
    var dSel = document.getElementById("drawer-week-archive-select");
    var mainSel = document.getElementById("week-archive-select");
    if (dSel && mainSel) dSel.innerHTML = mainSel.innerHTML;
  }
}

function openEvSimulatorDrawer() {
  var bd = document.getElementById("ev-sim-drawer-backdrop");
  if (!bd) return;
  bd.style.display = "flex";
  renderEvSimulatorDrawerBody();
}

function closeEvSimulatorDrawer() {
  var bd = document.getElementById("ev-sim-drawer-backdrop");
  if (bd) bd.style.display = "none";
}

function renderEvSimulatorDrawerBody() {
  var body = document.getElementById("ev-sim-drawer-body");
  if (!body) return;
  updateScoreboard(true);
  renderMonteCarloSimulatorBox();

  var cur = calcProfileMetrics(activeProfile) || calcProfileMetrics("michael");
  var tgt = (state[activeProfile] && state[activeProfile].target) || 20;
  var distHtml = document.getElementById("dist-chart") ? document.getElementById("dist-chart").innerHTML : "";
  var mcHtml = document.getElementById("monte-carlo-sim-container") ? document.getElementById("monte-carlo-sim-container").innerHTML : "";

  body.innerHTML =
    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>📊 Exact Dynamic Programming EV & Score Distribution (' + getProfileDisplayMeta(activeProfile).name + ')</span></div>' +
      '<div class="score-grid">' +
        '<div class="metric-card"><div class="metric-label">Max Ceiling</div><div class="metric-val">' + cur.ceiling + ' pts</div><div class="metric-sub">' + cur.dogs + ' multiplier dog(s)</div></div>' +
        '<div class="metric-card"><div class="metric-label">Expected EV</div><div class="metric-val" style="color:var(--legacy-accent);">' + cur.ev.toFixed(2) + '</div><div class="metric-sub">True Moneyline EV</div></div>' +
        '<div class="metric-card"><div class="metric-label">Hit Target (≥' + tgt + 'p)</div><div class="metric-val" style="color:var(--green);">' + Math.round(cur.hitProb * 100) + '%</div><div class="metric-sub">Exact DP Probability</div></div>' +
        '<div class="metric-card"><div class="metric-label">Likely Range</div><div class="metric-val">' + cur.p25 + '–' + cur.p75 + ' pts</div><div class="metric-sub">25th–75th Percentile</div></div>' +
      '</div>' +
      '<div style="margin-top:8px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:0.73rem;margin-bottom:4px;">' +
          '<span>Target Weekly Score: <strong>' + tgt + ' pts</strong></span>' +
          '<span style="color:var(--muted);">Slide to recalculate</span>' +
        '</div>' +
        '<input type="range" min="14" max="28" value="' + tgt + '" style="width:100%;" oninput="updateTargetSlider(this.value); renderEvSimulatorDrawerBody();" />' +
      '</div>' +
      '<div style="margin-top:6px;">' + distHtml + '</div>' +
    '</div>' +

    '<div class="drawer-section">' +
      '<div class="drawer-section-title"><span>⚡ Quick Strategy Presets</span></div>' +
      '<div class="preset-grid">' +
        '<button type="button" class="preset-btn" onclick="applyPreset(\'optimal\'); renderEvSimulatorDrawerBody();">★ Optimal EV (Best +EV Dogs + Core)</button>' +
        '<button type="button" class="preset-btn" onclick="applyPreset(\'safe\'); renderEvSimulatorDrawerBody();">🛡️ Safe Core (Max Win %)</button>' +
        '<button type="button" class="preset-btn" onclick="applyPreset(\'aggressive\'); renderEvSimulatorDrawerBody();">🚀 Chaser (Live 2x/3x Dogs)</button>' +
        '<button type="button" class="preset-btn" onclick="applyPreset(\'chalk\'); renderEvSimulatorDrawerBody();">🔒 All Sheet Favorites</button>' +
      '</div>' +
    '</div>' +

    '<div class="drawer-section">' +
      mcHtml +
    '</div>';
}

// ---------------------------------------------------------------------------
// 10. Upgraded Commissioner Console Tabs:
//     - Tab 1 (submissions): Adds Auto-Pick & Delete Picks per player
//     - Tab 2 (mastersheet): Dedicated 89-Player Side-by-Side Master Spreadsheet Grid
//     - Tab 7 (admin): Multi-Commissioner Role Manager + Primary Email + Firestore Rules
// ---------------------------------------------------------------------------
switchCommissionerTab = function(tabName) {
  if (!assertCommissionerRole("Commissioner Console")) return;
  ACTIVE_COMMISH_TAB = tabName;
  var tabs = ["submissions", "mastersheet", "slate", "locks", "roster", "users", "comms", "admin"];
  for (var i = 0; i < tabs.length; i++) {
    var b = document.getElementById("cm-tab-" + tabs[i]);
    if (b) b.className = "hub-tab-btn" + (tabs[i] === tabName ? " active" : "");
  }
  var cfg = ensureCommissionerConfig();
  var pill = document.getElementById("commish-mode-pill");
  if (pill) {
    pill.textContent = cfg.scrapingMode === "standalone"
      ? "🏟️ Standalone Site Mode"
      : "🤖 Hybrid Mode (WordPress/Gmail Scraper Active)";
  }
  renderCommissionerModalBody();
};

var _origRenderCommissionerModalBodyV166 = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var body = document.getElementById("commish-modal-body");
  if (!body) return;
  if (!isVerifiedCommissioner()) {
    body.innerHTML = '<div class="side-box" style="text-align:center;color:var(--loss);">🔒 Verified Commissioner account required to view this console.</div>';
    return;
  }
  var cfg = ensureCommissionerConfig();
  regradeAllPoolMembersLive();

  if (ACTIVE_COMMISH_TAB === "submissions") {
    var pmList = state.poolMembers || [];
    var submittedCount = 0;
    var rowsHtml = "";

    for (var i = 0; i < pmList.length; i++) {
      var pm = pmList[i];
      var linkedPf = getProfileLinkedToMemberName(pm.name);
      var picksMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
      var cStats = countMatchingPicksForSlate(picksMap, GAMES);
      var isComplete = (cStats.matched >= GAMES.length);
      var hasAny = (cStats.matched > 0 && !pm.awaitingSheet);
      if (isComplete || hasAny) submittedCount++;

      if (COMMISH_SUBMISSION_FILTER === "submitted" && !hasAny) continue;
      if (COMMISH_SUBMISSION_FILTER === "missing" && hasAny) continue;

      var tbVal = (linkedPf && state[linkedPf.key] && state[linkedPf.key].tiebreaker) ? state[linkedPf.key].tiebreaker : (pm.tiebreaker || "—");
      var statusBadge = isComplete
        ? '<span class="badge badge-ev">✅ ' + cStats.matched + '/' + GAMES.length + ' Saved</span>'
        : (hasAny ? '<span class="badge badge-2x">⚠️ Partial (' + cStats.matched + '/' + GAMES.length + ')</span>' : '<span class="badge badge-3x">⏳ Missing (0/' + GAMES.length + ')</span>');

      var safeName = jsArgAttr(pm.name);
      rowsHtml += '<tr>' +
        '<td><strong>' + escapeHtml(pm.name) + '</strong>' + (linkedPf ? ' <span class="linked-lb-pill">App Account</span>' : '') + '</td>' +
        '<td>' + (pm.priorPts || 0) + ' pts</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><strong>' + escapeHtml(tbVal) + '</strong></td>' +
        '<td style="display:flex;gap:4px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm" style="padding:3px 7px;font-size:0.66rem;border-color:var(--border);color:var(--warn);" onclick="manuallySetPlayerPicks(\'' + safeName + '\')">✏️ Edit Picks / Override</button>' +
          '<button type="button" class="btn-sm" style="padding:3px 7px;font-size:0.66rem;border-color:var(--border);color:var(--text);" onclick="overrideTiebreaker(\'' + safeName + '\')">Tiebreaker</button>' +
          forceUnlockButtonHtml(pm.name) +
          '<button type="button" class="btn-sm" style="padding:3px 7px;font-size:0.66rem;border-color:var(--border);color:var(--text);" onclick="commishAutoSelectPlayerPicks(\'' + safeName + '\', \'optimal\')">⚡ Auto-Pick</button>' +
          '<button type="button" class="btn-sm" style="padding:3px 7px;font-size:0.66rem;border-color:var(--border);color:var(--loss);" onclick="commishDeletePlayerPicks(\'' + safeName + '\')">🗑️ Delete Picks</button>' +
        '</td>' +
      '</tr>';
    }

    var missingCount = pmList.length - submittedCount;
    body.innerHTML =
      '<div class="commish-kpi-strip">' +
        '<div class="commish-kpi"><div class="metric-label">Active Week</div><div class="metric-val" style="color:var(--legacy-accent);">' + (state.weekLabel || "Week 8") + '</div><div class="metric-sub">' + GAMES.length + ' Games • Lock: ' + pickDeadlineLabel() + '</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Sheets Saved</div><div class="metric-val" style="color:var(--green);">' + submittedCount + ' / ' + pmList.length + '</div><div class="metric-sub">' + Math.round((submittedCount / Math.max(1, pmList.length)) * 100) + '% Pool Completion</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Missing / Deleted</div><div class="metric-val" style="color:' + (missingCount > 0 ? 'var(--amber)' : 'var(--green)') + ';">' + missingCount + ' Missing</div><div class="metric-sub">' + (cfg.lastWedThuNudgeSentAt ? ('Last Nudge: ' + cfg.lastWedThuNudgeSentAt) : 'Wed/Thu Auto-Nudge Ready') + '</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Master Grid</div><div class="metric-val" style="color:var(--win);font-size:0.95rem;cursor:pointer;" onclick="switchCommissionerTab(\'mastersheet\')">📊 Open Grid →</div><div class="metric-sub">All 89 Players Side-by-Side</div></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
        '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "all" ? " active" : "") + '" onclick="setCommishSubFilter(\'all\')">All (' + pmList.length + ')</button>' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "submitted" ? " active" : "") + '" onclick="setCommishSubFilter(\'submitted\')">✅ Saved (' + submittedCount + ')</button>' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "missing" ? " active" : "") + '" onclick="setCommishSubFilter(\'missing\')">⏳ Missing (' + missingCount + ')</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);font-weight:800;" onclick="commishAutoFillMissingPlayers(\'chalk\')">⚡ Auto-Fill Missing (' + missingCount + ')</button>' +
          '<button type="button" class="btn-sm" style="border-color:var(--amber);color:var(--warn);font-weight:800;" onclick="triggerWedThuAutomatedNudge()">⏰ Send Wed/Thu Nudge</button>' +
          '<button type="button" class="btn-sm" style="background:var(--raised);color:var(--text);border:none;font-weight:900;" onclick="triggerSaturdayMorningMasterSheetBroadcast()">📊 Sat Reveal & Export CSV</button>' +
        '</div>' +
      '</div>' +
      '<div style="max-height:380px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:10px;">' +
        '<table class="condensed-table">' +
          '<thead><tr><th>Participant</th><th>Prior Pts</th><th>Submission Status</th><th>Tie-Breaker</th><th>Commissioner Pick Management</th></tr></thead>' +
          '<tbody>' + (rowsHtml || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No players match that filter.</td></tr>') + '</tbody>' +
        '</table>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "mastersheet") {
    var pmAll = (state.poolMembers || []).slice().sort(function(a, b) {
      return (b.newLiveTotal || b.priorPts || 0) - (a.newLiveTotal || a.priorPts || 0);
    });
    var thCols = '<th>Player (' + pmAll.length + ')</th><th>Prior</th><th>TB</th><th>Wk</th><th>Total</th>';
    for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
      var gm = GAMES[gIdx];
      thCols += '<th title="#' + gm.id + ' ' + gm.away + ' at ' + gm.home + ' (' + (gm.mondayPoolLine || gm.poolLine) + ')">G' + gm.id + '<br><span style="font-size:0.58rem;color:var(--text);">' + gm.awayCode + '/' + gm.homeCode + '</span></th>';
    }

    var qFilter = String(MASTER_SHEET_SEARCH_Q || "").trim().toLowerCase();
    var trRows = "";
    for (var r = 0; r < pmAll.length; r++) {
      var p = pmAll[r];
      if (qFilter && p.name.toLowerCase().indexOf(qFilter) === -1) continue;
      var linkedPf2 = getProfileLinkedToMemberName(p.name);
      var pMap = (linkedPf2 && state[linkedPf2.key] && state[linkedPf2.key].picks) ? state[linkedPf2.key].picks : (p.picks || {});
      var tbStr = (linkedPf2 && state[linkedPf2.key] && state[linkedPf2.key].tiebreaker) ? state[linkedPf2.key].tiebreaker : (p.tiebreaker || "—");
      var wkPts = p.awaitingSheet ? 0 : Math.max(p.livePts || 0, p.finalPts || 0);
      var totPts = p.newLiveTotal || p.priorPts || 0;
      var safePName = jsArgAttr(p.name);

      var cells = '<td>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">' +
          '<span>' + (r + 1) + '. ' + escapeHtml(p.name) + '</span>' +
          '<button type="button" class="btn-sm" style="padding:1px 5px;font-size:0.6rem;" onclick="commishQuickImpersonate(\'' + safePName + '\')" title="Edit ' + escapeHtml(p.name) + '\'s picks">✏️</button>' +
        '</div>' +
      '</td>' +
      '<td>' + (p.priorPts || 0) + '</td>' +
      '<td>' + escapeHtml(tbStr) + '</td>' +
      '<td style="color:var(--green);font-weight:800;">' + (p.awaitingSheet ? '—' : ('+' + wkPts)) + '</td>' +
      '<td style="color:var(--legacy-accent);font-weight:900;">' + totPts + '</td>';

      for (var c = 0; c < GAMES.length; c++) {
        var gObj = GAMES[c];
        var pickTeam = p.awaitingSheet ? null : getResolvedPickForGame(pMap, gObj, false);
        if (!pickTeam) {
          cells += '<td style="color:var(--muted);">—</td>';
        } else {
          var isAw = isSameTeamPick(pickTeam, gObj.away, gObj);
          var code = isAw ? gObj.awayCode : gObj.homeCode;
          var pts = getGamePickPts(gObj, isAw);
          var ls = LIVE_SCORES[gObj.id];
          var cellBg = "";
          var cellColor = pts === 3 ? "#fca5a5" : (pts === 2 ? "#fde68a" : "#e2e8f0");
          if (ls && (ls.completed || ls.inProgress) && ls.awayScore !== ls.homeScore) {
            var winTeam = ls.awayScore > ls.homeScore ? gObj.away : gObj.home;
            var won = isSameTeamPick(winTeam, pickTeam, gObj);
            cellBg = won ? "background:var(--raised);" : "background:var(--raised);";
            cellColor = won ? "#6ee7b7" : "#fca5a5";
          }
          cells += '<td style="' + cellBg + 'color:' + cellColor + ';font-weight:' + (pts > 1 ? '900' : '600') + ';">' + code + (pts > 1 ? (' (' + pts + 'x)') : '') + '</td>';
        }
      }
      trRows += '<tr>' + cells + '</tr>';
    }

    body.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
        '<div>' +
          '<strong style="font-size:0.86rem;color:var(--text);">📊 Master Spreadsheet Grid — All ' + pmAll.length + ' Players Side-by-Side (Games #1–#' + GAMES.length + ')</strong>' +
          '<div style="font-size:0.71rem;color:var(--muted);">Sticky player column on left • Scroll horizontally to inspect every game pick, underdog multiplier, and live grade.</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
          '<input type="text" id="master-sheet-filter" aria-label="Filter players" class="search-input" style="min-width:180px;padding:5px 9px;font-size:0.74rem;" placeholder="🔍 Filter player name..." value="' + MASTER_SHEET_SEARCH_Q.replace(/"/g, '&quot;') + '" oninput="MASTER_SHEET_SEARCH_Q=this.value; renderCommissionerModalBody();" />' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="exportOfficialMasterCsv()">📥 Download Master .CSV</button>' +
        '</div>' +
      '</div>' +
      '<div class="master-sheet-wrap">' +
        '<table class="master-sheet-table">' +
          '<thead><tr>' + thCols + '</tr></thead>' +
          '<tbody>' + trRows + '</tbody>' +
        '</table>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "admin") {
    var commishMap = cfg.authorizedCommissioners || {};
    var roleRows = "";
    var keys = Object.keys(commishMap);
    for (var k = 0; k < keys.length; k++) {
      var keyStr = keys[k];
      var rec = commishMap[keyStr];
      if (!rec) continue;
      var isEnabled = rec.enabled !== false;
      var safeKey = jsArgAttr(keyStr);
      roleRows += '<tr>' +
        '<td><strong>' + escapeHtml(keyStr) + '</strong></td>' +
        '<td>' + escapeHtml(rec.label || rec.role || "Commissioner") + '</td>' +
        '<td><span class="badge ' + (keyStr.indexOf("@") === -1 ? 'badge-3x' : (isEnabled ? 'badge-ev' : 'badge-3x')) + '">' + (keyStr.indexOf("@") === -1 ? 'Not used: names don\'t grant access, add their email' : (isEnabled ? 'Active' : 'Suspended')) + '</span></td>' +
        '<td style="display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm" style="padding:3px 8px;font-size:0.67rem;" onclick="commishToggleRoleEnabled(\'' + safeKey + '\')">' + (isEnabled ? '⏸ Disable' : '▶ Enable') + '</button>' +
          '<button type="button" class="btn-sm" style="padding:3px 8px;font-size:0.67rem;border-color:var(--border);color:var(--loss);" onclick="commishRevokeRole(\'' + safeKey + '\')">🚫 Revoke</button>' +
        '</td>' +
      '</tr>';
    }

    var memberOpts = '<option value="">— Or Select a Pool Member to Promote —</option>';
    var pmListAdmin = state.poolMembers || [];
    for (var m = 0; m < pmListAdmin.length; m++) {
      memberOpts += '<option value="' + pmListAdmin[m].name.replace(/"/g, '&quot;') + '">' + escapeHtml(pmListAdmin[m].name) + '</option>';
    }

    body.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:10px;margin-bottom:12px;">' +
        '<div class="side-box">' +
          '<div class="side-title"><span>📧 Primary Commissioner Account Email</span></div>' +
          '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;">Update the primary administrative email address (default: <code>commissioner@separatedatturf.com</code>):</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<input type="email" id="commish-primary-email-input" class="search-input" style="flex:1;padding:6px 9px;font-size:0.76rem;" value="' + String(cfg.primaryCommissionerEmail || "commissioner@separatedatturf.com").replace(/"/g, '&quot;') + '" />' +
            '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="commishUpdatePrimaryEmail()">💾 Update Primary Email</button>' +
          '</div>' +
        '</div>' +

        '<div class="side-box">' +
          '<div class="side-title"><span>👑 Assign New Co-Commissioner</span></div>' +
          '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;">Grant commissioner access by sign-in email. Picking a player uses the email on file for them.</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<input type="text" id="commish-new-role-input" class="search-input" style="flex:1;padding:6px 9px;font-size:0.75rem;" placeholder="Their sign-in email" />' +
            '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="commishGrantRole(document.getElementById(\'commish-new-role-input\').value, \'Co-Commissioner\')">➕ Grant Role</button>' +
          '</div>' +
          '<select class="search-input" style="width:100%;padding:5px 8px;font-size:0.73rem;" onchange="if(this.value){commishGrantRole(this.value, this.value + \' (Co-Commish)\'); this.value=\'\';}">' + memberOpts + '</select>' +
        '</div>' +
      '</div>' +

      '<div class="side-box" style="margin-bottom:12px;">' +
        '<div class="side-title"><span>🛡️ Authorized Commissioners (' + keys.length + ') — Strict Access Control</span></div>' +
        '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:8px;">' +
          '<table class="condensed-table">' +
            '<thead><tr><th>Authorized Email / Player Key</th><th>Role / Label</th><th>Status</th><th>Actions</th></tr></thead>' +
            '<tbody>' + roleRows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="side-box">' +
        '<div class="side-title">' +
          '<span>🔥 Backend Firebase Firestore Security Rules (<code>firestore.rules</code>)</span>' +
          '<button type="button" class="btn-sm" onclick="copyTextWithToast(PRODUCTION_FIRESTORE_SECURITY_RULES, \'📋 Copied firestore.rules to clipboard!\');">📋 Copy Rules</button>' +
        '</div>' +
        '<div style="font-size:0.71rem;color:var(--muted);margin-bottom:6px;">Enforces verified commissioner role checks on <code>pickem_v14/shared_state</code> and <code>pickem_v14_commissioners/roles</code> in Cloud Firestore:</div>' +
        '<textarea readonly rows="7" class="search-input" style="width:100%;font-family:monospace;font-size:0.68rem;color:var(--text);">' + PRODUCTION_FIRESTORE_SECURITY_RULES + '</textarea>' +
      '</div>';
    return;
  }

  _origRenderCommissionerModalBodyV166();
};

// Hook renderAll to keep Commissioner visibility, Multi-Buy-In strip, and Manual Lock pill in sync
