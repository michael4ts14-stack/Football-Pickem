var state = {
  currentWeek: 8,
  weekLabel: "Week 8",
  michael: Object.assign(JSON.parse(JSON.stringify(WEEK7_OFFICIAL_MICHAEL)), { linkedMemberName: "Michael A" }),
  // Internal key is 'kinyion' (legacy spelling). Display name is 'Kinyon'. Do not rename the key.
  kinyion: Object.assign(JSON.parse(JSON.stringify(WEEK7_OFFICIAL_KINYION)), { linkedMemberName: "Kinyon C" }),
  test: { picks: {}, tiebreaker: "28-24", target: 20, linkedMemberName: "" },
  customUsers: [],
  compareTargetKey: "", // nobody is compared until the person picks someone
  fridayNightRevealOverride: false,
  profilePrivacy: {
    michael: { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: true, autoUnhideFridayNight: true },
    kinyion: { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: true, autoUnhideFridayNight: true },
    test: { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: true, autoUnhideFridayNight: true }
  },
  watchlist: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_WATCHLIST)),
  leaderboard: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_LEADERBOARD)),
  poolMembers: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_POOL_MEMBERS)),
  gasWebAppUrl: ""
};

var BLIND_MODE = false;
var SESSION_UNLOCKED_PROFILES = { michael: true, kinyion: true, test: true };
var EXPLICITLY_VIEW_UNLOCKED_PROFILES = {};

function getProfileLinkedToMemberName(memberName) {
  if (!memberName) return null;
  var target = standardizeParticipantName(memberName).toLowerCase();
  var allProfs = getAllUserProfiles();
  for (var i = 0; i < allProfs.length; i++) {
    var pf = allProfs[i];
    var linked = pf.linkedMemberName || (pf.isBuiltIn && !pf.isSandbox ? pf.name : "");
    if (linked && standardizeParticipantName(linked).toLowerCase() === target) {
      return pf;
    }
    if (!pf.isBuiltIn && standardizeParticipantName(pf.name).toLowerCase() === target) {
      return pf;
    }
  }
  return null;
}

// A second profile for a player who already has one ("Kinyon" next to kinyion): it must
// never be graded into, or clear, the player's real entry.
function isDuplicateProfileKey(profKey, memberName) {
  if (!profKey || !memberName) return false;
  var pf = getProfileLinkedToMemberName(memberName);
  return !!(pf && !pf.isSandbox && pf.key !== profKey);
}

// Pool rows the app added for an account (awaiting a sheet, no picks) that repeat another row's
// name once both spellings mean the same player ("Kinyon" and "Kinyion C"). A cleared empty
// duplicate would otherwise clear the real player's picks while grading. The real row is kept
// wherever it sits in the list.
function dropDuplicateAppPoolRows() {
  if (!Array.isArray(state.poolMembers)) return false;
  var lowOf = function(pm) { return pm && pm.name ? standardizeParticipantName(pm.name).toLowerCase() : ""; };
  var isEmptyAppRow = function(pm) { return !!pm.awaitingSheet && !hasSubmittedPicksForCurrentSlate(pm.picks || {}, GAMES); };
  var hasRealRow = {};
  state.poolMembers.forEach(function(pm) { var low = lowOf(pm); if (low && !isEmptyAppRow(pm)) hasRealRow[low] = true; });
  var kept = {}, out = [], dropped = false;
  for (var i = 0; i < state.poolMembers.length; i++) {
    var pm = state.poolMembers[i];
    var low = lowOf(pm);
    if (low && isEmptyAppRow(pm) && (hasRealRow[low] || kept[low])) { dropped = true; continue; }
    if (low) kept[low] = true;
    out.push(pm);
  }
  if (dropped) state.poolMembers = out;
  return dropped;
}

function findPoolMemberByName(memberName) {
  if (!memberName || !state.poolMembers || !Array.isArray(state.poolMembers)) return null;
  var target = standardizeParticipantName(memberName).toLowerCase();
  for (var i = 0; i < state.poolMembers.length; i++) {
    var pm = state.poolMembers[i];
    if (pm && pm.name && standardizeParticipantName(pm.name).toLowerCase() === target) {
      return pm;
    }
  }
  return null;
}

function findLeaderboardEntryByName(memberName) {
  if (!memberName || !state.leaderboard || !Array.isArray(state.leaderboard)) return null;
  var target = standardizeParticipantName(memberName).toLowerCase();
  for (var i = 0; i < state.leaderboard.length; i++) {
    var lb = state.leaderboard[i];
    if (lb && lb.name && standardizeParticipantName(lb.name).toLowerCase() === target) {
      return lb;
    }
  }
  return null;
}

function getLinkedMemberNameForProfile(profKey) {
  if (profKey === "michael") {
    return (state.michael && state.michael.linkedMemberName !== undefined) ? state.michael.linkedMemberName : "Michael A";
  }
  if (profKey === "kinyion") {
    return (state.kinyion && state.kinyion.linkedMemberName !== undefined) ? state.kinyion.linkedMemberName : "Kinyon C";
  }
  if (profKey === "test") {
    return (state.test && state.test.linkedMemberName) ? state.test.linkedMemberName : "";
  }
  if (state.customUsers && Array.isArray(state.customUsers)) {
    for (var i = 0; i < state.customUsers.length; i++) {
      if (state.customUsers[i].key === profKey) {
        return state.customUsers[i].linkedMemberName || state.customUsers[i].name || "";
      }
    }
  }
  return "";
}

// The redesign uses text labels, not emoji, in the UI. Messages built elsewhere still carry them.
function stripUiEmoji(text) {
  return String(text == null ? "" : text)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function showAppToast(msg, durationMs) {
  var el = document.getElementById("app-toast-banner");
  if (!el) return;
  el.textContent = stripUiEmoji(msg);
  el.setAttribute("role", "status");
  el.style.display = "block";
  if (window._appToastTimer) clearTimeout(window._appToastTimer);
  window._appToastTimer = setTimeout(function() {
    el.style.display = "none";
  }, durationMs || 2600);
}

function isUserModalOpen() {
  var bd = document.getElementById("opp-modal-backdrop");
  var titleEl = document.getElementById("modal-team-title");
  return !!(bd && bd.style.display === "flex" && titleEl && titleEl.textContent.indexOf("Profile") !== -1);
}

function refreshUserModalIfOpen() {
  if (isUserModalOpen()) {
    openUserAndPrivacyModal();
  }
}

function hasLinkedSpreadsheetPicksArrived(profKey) {
  // Only auto-unhide via spreadsheet if a fresh weekly spreadsheet was explicitly imported for the current week
  // AND the user has not manually locked their profile!
  if (!state.officialSheetSyncedForWeek || state.officialSheetSyncedForWeek !== state.currentWeek) {
    return false;
  }
  var priv = (state.profilePrivacy && state.profilePrivacy[profKey]) || {};
  if (priv.manualLockOverride) return false;
  var linkedName = getLinkedMemberNameForProfile(profKey);
  if (!linkedName) return false;
  var pm = findPoolMemberByName(linkedName);
  if (!pm || pm.awaitingSheet || !pm.picks) return false;
  return hasSubmittedPicksForCurrentSlate(pm.picks, GAMES);
}

function getAutoUnhideReason(profKey, gameId) {
  var priv = (state.profilePrivacy && state.profilePrivacy[profKey]) || {};
  if (!priv.hidden) return null;
  // If user manually locked this profile, only kickoff of a live/final game (if enabled) or explicit Friday Reveal Override unhides it
  if (gameId && priv.revealAtKickoff !== false && isGameStartedOrFinal(gameId)) {
    return "Kickoff";
  }
  if (state.fridayNightRevealOverride === true) {
    return "Friday Reveal ON";
  }
  if (!priv.manualLockOverride) {
    if (priv.autoUnhideOnSheet === true && hasLinkedSpreadsheetPicksArrived(profKey)) {
      return "Spreadsheet Synced";
    }
  }
  return null;
}

function syncLinkedProfilesWithLeaderboard() {
  var allProfs = getAllUserProfiles();
  for (var i = 0; i < allProfs.length; i++) {
    var pf = allProfs[i];
    if (!pf.linkedMemberName) continue;
    var pm = findPoolMemberByName(pf.linkedMemberName);
    var lb = findLeaderboardEntryByName(pf.linkedMemberName);
    var latestPts = (lb && lb.priorPts !== undefined) ? (parseFloat(lb.priorPts) || 0) : ((pm && pm.priorPts !== undefined) ? (parseFloat(pm.priorPts) || 0) : pf.priorPts);
    var latestRank = (lb && lb.rank) ? String(lb.rank) : ((pm && pm.priorRank) ? String(pm.priorRank) : pf.defaultRank);

    if (!pf.isBuiltIn && state.customUsers) {
      for (var c = 0; c < state.customUsers.length; c++) {
        if (state.customUsers[c].key === pf.key) {
          if (latestPts > 0) state.customUsers[c].priorPts = latestPts;
          if (latestRank) state.customUsers[c].rank = latestRank;
          break;
        }
      }
    }
    var delMap = state.deletedPicksByMember || {};
    var isDeletedMember = !!(delMap[standardizeParticipantName(pf.linkedMemberName).toLowerCase()] || (pm && pm._picksCleared) || (state[pf.key] && state[pf.key]._picksCleared));
    if (!isDeletedMember && pm && !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES)) {
      if (state[pf.key] && (!state[pf.key]._manualEditsThisWeek)) {
        state[pf.key].picks = Object.assign({}, state[pf.key].picks || {}, pm.picks);
        if (pm.tiebreaker && pm.tiebreaker !== "—") state[pf.key].tiebreaker = pm.tiebreaker;
      }
    }
  }
}

function ensureMultiUserAndPrivacyState() {
  if (!state.customUsers || !Array.isArray(state.customUsers)) state.customUsers = [];
  if (!state.profilePrivacy || typeof state.profilePrivacy !== "object") state.profilePrivacy = {};
  if (state.michael && state.michael.linkedMemberName === undefined) state.michael.linkedMemberName = "Michael A";
  if (state.kinyion && state.kinyion.linkedMemberName === undefined) state.kinyion.linkedMemberName = "Kinyon C";
  var allProfs = getAllUserProfiles();
  for (var i = 0; i < allProfs.length; i++) {
    var pk = allProfs[i].key;
    if (!state[pk]) state[pk] = { picks: {}, tiebreaker: "28-24", target: 20 };
    if (!state[pk].picks) state[pk].picks = {};
    if (!state.profilePrivacy[pk]) {
      state.profilePrivacy[pk] = { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: false, autoUnhideFridayNight: false, manualLockOverride: false };
    } else {
      if (state.profilePrivacy[pk].revealAtKickoff === undefined) state.profilePrivacy[pk].revealAtKickoff = true;
      if (state.profilePrivacy[pk].autoUnhideOnSheet === undefined) state.profilePrivacy[pk].autoUnhideOnSheet = false;
      if (state.profilePrivacy[pk].autoUnhideFridayNight === undefined) state.profilePrivacy[pk].autoUnhideFridayNight = false;
    }
  }
}

// Players a commissioner removed: commissionerConfig.archivedProfiles[key] (commissioner-only in
// firestore.rules, so no player device can undo it). Their pick doc and week archives are kept;
// they're just left out of the registry, so they can be restored.
function isProfileArchived(key, cfgOverride) {
  var cfg = cfgOverride || state.commissionerConfig || {};
  return !!(key && cfg.archivedProfiles && cfg.archivedProfiles[key]);
}

function getAllUserProfiles() {
  var mLinked = (state.michael && state.michael.linkedMemberName !== undefined) ? state.michael.linkedMemberName : "Michael A";
  var kLinked = (state.kinyion && state.kinyion.linkedMemberName !== undefined) ? state.kinyion.linkedMemberName : "Kinyon C";
  var tLinked = (state.test && state.test.linkedMemberName) ? state.test.linkedMemberName : "";

  var mLb = findLeaderboardEntryByName(mLinked || "Michael A");
  var kLb = findLeaderboardEntryByName(kLinked || "Kinyon C");

  var list = [
    { key: "michael", name: "Michael A", shortName: "Michael", icon: "👤", color: "#38bdf8", tabClass: "active-michael", btnClass: "m-active", selClass: "selected-michael", tagClass: "p-tag-m", priorPts: mLb ? (parseFloat(mLb.priorPts) || 111) : 111, defaultRank: mLb && mLb.rank ? mLb.rank : "T-64th", linkedMemberName: mLinked, isBuiltIn: true },
    { key: "kinyion", name: "Kinyon", shortName: "Kinyon", icon: "👤", color: "#c084fc", tabClass: "active-kinyion", btnClass: "k-active", selClass: "selected-kinyion", tagClass: "p-tag-k", priorPts: kLb ? (parseFloat(kLb.priorPts) || 112) : 112, defaultRank: kLb && kLb.rank ? kLb.rank : "T-57th", linkedMemberName: kLinked, isBuiltIn: true },
    { key: "test", name: "Test Sim", shortName: "Test", icon: "🧪", color: "#f59e0b", tabClass: "active-test", btnClass: "t-active", selClass: "selected-test", tagClass: "p-tag-test", priorPts: 0, defaultRank: "Sandbox", linkedMemberName: tLinked, isBuiltIn: true, isSandbox: true }
  ];
  if (state.customUsers && Array.isArray(state.customUsers)) {
    for (var i = 0; i < state.customUsers.length; i++) {
      var cu = state.customUsers[i];
      if (!cu || !cu.key || !cu.name) continue;
      var cuLinked = cu.linkedMemberName !== undefined ? cu.linkedMemberName : cu.name;
      var cuLb = cuLinked ? findLeaderboardEntryByName(cuLinked) : null;
      list.push({
        key: cu.key,
        name: cu.name,
        shortName: cu.name.slice(0, 8),
        icon: "👤",
        color: cu.color || "#10b981",
        tabClass: "active-custom",
        btnClass: "c-active",
        selClass: "selected-custom",
        tagClass: "p-tag-custom",
        priorPts: cuLb ? (parseFloat(cuLb.priorPts) || parseFloat(cu.priorPts) || 0) : (parseFloat(cu.priorPts) || 0),
        defaultRank: (cuLb && cuLb.rank) ? cuLb.rank : (cu.rank || "Linked"),
        linkedMemberName: cuLinked,
        isBuiltIn: false
      });
    }
  }
  return list;
}

// null for a key that isn't a registered profile (never another player's meta, which a save
// would write into that key's pick doc).
function getProfileMetaByKey(profKey) {
  var list = getAllUserProfiles();
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === profKey) return list[i];
  }
  return null;
}

// For labels only: an unregistered key shows as a plain placeholder instead of failing.
function getProfileDisplayMeta(profKey) {
  return getProfileMetaByKey(profKey) || { key: profKey, name: "Unknown player", shortName: "Player", icon: "👤", color: "#10b981", tabClass: "active-custom", btnClass: "c-active", selClass: "selected-custom", tagClass: "p-tag-custom", priorPts: 0, defaultRank: "", linkedMemberName: "", isBuiltIn: false };
}

function isGameStartedOrFinal(gameId) {
  if (!gameId) return false;
  var ls = LIVE_SCORES[gameId];
  return !!(ls && (ls.inProgress || ls.completed));
}

function getMyInstanceProfileKey() {
  // Signed-out visitors are guests: their only profile is the local sandbox, never a pool member's.
  if (typeof AUTH_SESSION !== "undefined" && !AUTH_SESSION) return "test";
  if (AUTH_SESSION && AUTH_SESSION.adminUnlock && activeProfile && activeProfile !== "test") {
    return activeProfile;
  }
  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    return AUTH_SESSION.boundProfileKey;
  }
  return (activeProfile && activeProfile !== "test") ? activeProfile : "michael";
}

function isMyOwnInstanceProfile(profKey) {
  if (profKey === "test") return true;
  if (AUTH_SESSION && AUTH_SESSION.adminUnlock) {
    return profKey === activeProfile || profKey === AUTH_SESSION.boundProfileKey;
  }
  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    return profKey === AUTH_SESSION.boundProfileKey;
  }
  return profKey === getMyInstanceProfileKey();
}

function isProfileHiddenFromViewer(profKey, gameId) {
  ensureMultiUserAndPrivacyState();
  // Your own bound profile and your personal Sandbox Sim are ALWAYS visible to YOU on your device!
  if (isMyOwnInstanceProfile(profKey)) {
    return false;
  }
  // If you turned on Spy Shield (Blind Mode), hide all other users' picks while you make yours
  if (BLIND_MODE) {
    return true;
  }
  var priv = state.profilePrivacy[profKey] || { hidden: false, revealAtKickoff: true, autoUnhideOnSheet: false, autoUnhideFridayNight: false };
  if (!priv.hidden) {
    return false;
  }
  // Check if automatic reveal conditions are met (e.g. Game Kickoff, Official Sheet Synced, or Friday 5PM CST)
  if (getAutoUnhideReason(profKey, gameId)) {
    return false;
  }
  // Otherwise, another user's hidden picks stay strictly hidden on your instance — NO PIN bypass!
  return true;
}

// Per device, written only by setCompareTarget(). (The old v16 key also held targets the app
// picked automatically, so it is no longer read.)
var COMPARE_TARGET_STORAGE_KEY = "sat_device_compare_target_v2";

function resolveCompareTargetDescriptor() {
  ensureMultiUserAndPrivacyState();
  var myKey = getMyInstanceProfileKey();
  var key = state.compareTargetKey;
  // No default opponent: without a choice (or when the choice is yourself) there is no target.
  if (!key || key === activeProfile || key === myKey) return null;
  if (String(key).indexOf("pm:") === 0) {
    var pmName = String(key).slice(3);
    var pm = findPoolMemberByName(pmName);
    var lb = findLeaderboardEntryByName(pmName);
    var linkedPf = getProfileLinkedToMemberName(pmName);
    if (linkedPf && !linkedPf.isSandbox && linkedPf.key !== myKey) {
      // Use live synced profile if that pool member has an active account instance
      var lMeta = getProfileMetaByKey(linkedPf.key);
      var lState = state[lMeta.key] || { picks: {} };
      return {
        key: lMeta.key,
        isPoolMember: false,
        name: lMeta.name,
        shortName: lMeta.shortName,
        icon: "👤",
        color: lMeta.color || "#c084fc",
        tagClass: lMeta.tagClass || "p-tag-k",
        btnClass: lMeta.btnClass || "k-active",
        priorPts: lMeta.priorPts || 0,
        rank: lMeta.defaultRank || "",
        picks: lState.picks || {},
        hasPicks: true,
        isHiddenForGame: function(gameId) { return isProfileHiddenFromViewer(lMeta.key, gameId); }
      };
    }
    var hasPicks = pm && !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES);
    return {
      key: key,
      isPoolMember: true,
      name: pm ? pm.name : pmName,
      shortName: (pm ? pm.name : pmName).slice(0, 9),
      icon: "🏆",
      color: "#facc15",
      tagClass: "p-tag-compare",
      btnClass: "w-active",
      priorPts: lb ? (parseFloat(lb.priorPts) || 0) : (pm ? (parseFloat(pm.priorPts) || 0) : 0),
      rank: lb && lb.rank ? lb.rank : (pm && pm.priorRank ? pm.priorRank : "Pool"),
      picks: hasPicks ? pm.picks : {},
      hasPicks: !!hasPicks,
      isHiddenForGame: function() { return BLIND_MODE; }
    };
  }
  var meta = getProfileMetaByKey(key);
  if (!meta) return null;
  var pState = state[meta.key] || { picks: {} };
  return {
    key: meta.key,
    isPoolMember: false,
    name: meta.name,
    shortName: meta.shortName,
    icon: meta.icon || "👤",
    color: meta.color || "#c084fc",
    tagClass: meta.tagClass || "p-tag-k",
    btnClass: meta.btnClass || "k-active",
    priorPts: meta.priorPts || 0,
    rank: meta.defaultRank || "",
    picks: pState.picks || {},
    hasPicks: true,
    isHiddenForGame: function(gameId) { return isProfileHiddenFromViewer(meta.key, gameId); }
  };
}

// The only place a compare target is set: the person's own choice (H2H select, player sheet).
// "" clears it.
function setCompareTarget(targetKey) {
  state.compareTargetKey = targetKey || "";
  safeSetStorage(COMPARE_TARGET_STORAGE_KEY, state.compareTargetKey);
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  renderAll();
}

// <option>s for every compare picker; the first one ("Choose someone…") means no target.
function compareTargetOptionsHtml() {
  var allProfs = getAllUserProfiles();
  var myKey = getMyInstanceProfileKey();
  var cur = resolveCompareTargetDescriptor();
  var curTarget = cur ? state.compareTargetKey : "";

  var opts = '<option value=""' + (curTarget ? '' : ' selected') + '>Choose someone to compare with</option>';
  // Quick choice: whoever is in 1st place right now (not you).
  var myLow = (typeof getMyLeaderboardNameLower === "function") ? getMyLeaderboardNameLower() : "";
  var leader = (state.poolMembers || []).filter(function(p) { return p && p.name && standardizeParticipantName(p.name).toLowerCase() !== myLow; })
    .sort(function(a, b) { return (parseFloat(b.newLiveTotal || b.priorPts) || 0) - (parseFloat(a.newLiveTotal || a.priorPts) || 0); })[0];
  if (leader) {
    var leaderKey = "pm:" + leader.name;
    opts += '<option value="' + leaderKey + '"' + (curTarget === leaderKey ? ' selected' : '') + '>1st place: ' + escapeHtml(leader.name) + '</option>';
  }
  opts += '<optgroup label="App users">';
  for (var i = 0; i < allProfs.length; i++) {
    var pf = allProfs[i];
    if (pf.key === myKey || pf.isSandbox) continue;
    var isHidden = isProfileHiddenFromViewer(pf.key, null);
    var sel = (curTarget === pf.key) ? " selected" : "";
    opts += '<option value="' + pf.key + '"' + sel + '>' + pf.name + (isHidden ? ' (hidden until kickoff)' : '') + '</option>';
  }
  opts += '</optgroup>';

  if (state.poolMembers && state.poolMembers.length > 0) {
    opts += '<optgroup label="Pool members">';
    var sortedPm = state.poolMembers.slice().sort(function(a, b) {
      return (parseFloat(b.priorPts) || 0) - (parseFloat(a.priorPts) || 0);
    });
    for (var j = 0; j < sortedPm.length; j++) {
      var pm = sortedPm[j];
      var pmKey = "pm:" + pm.name;
      var hasSheet = !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES);
      var selPm = (curTarget === pmKey) ? " selected" : "";
      opts += '<option value="' + pmKey + '"' + selPm + '>' + escapeHtml(pm.name) + ' (' + (pm.priorPts || 0) + ' pts' + (hasSheet ? '' : ', no sheet yet') + ')</option>';
    }
    opts += '</optgroup>';
  }
  return opts;
}

// Inline picker shown where a view needs a target and none is chosen yet.
function compareChooserHtml(lead) {
  return '<div class="compare-chooser"><span>' + (lead || "Choose someone to compare with") + '</span>' +
    '<select class="compare-select" aria-label="Compare with" onchange="setCompareTarget(this.value)">' + compareTargetOptionsHtml() + '</select></div>';
}

function populateCompareTargetSelectors() {
  var opts = compareTargetOptionsHtml();
  var sel1 = document.getElementById("sidebar-compare-select");
  if (sel1) sel1.innerHTML = opts;
  var sel2 = document.getElementById("cond-compare-select");
  if (sel2) sel2.innerHTML = opts;
  var sel3 = document.getElementById("live-compare-select");
  if (sel3) sel3.innerHTML = opts;
  var sel4 = document.getElementById("standings-compare-select");
  if (sel4) sel4.innerHTML = opts;
}

// Legacy PIN modal stubs disabled so no PIN can ever bypass account login!
function openPinModal() { openAuthModal(); }
function closePinModal() {
  var bd = document.getElementById("pin-modal-backdrop");
  if (bd) bd.style.display = "none";
}
function submitPinModal() { closePinModal(); }

function unlockProfileWithPrompt(profKey, onSuccess) {
  // Never allow unlocking another user's profile via PIN!
  if (isMyOwnInstanceProfile(profKey)) {
    if (onSuccess) onSuccess();
    return true;
  }
  var otherMeta = getProfileDisplayMeta(profKey);
  showAppToast("🔒 " + otherMeta.name + "'s picks are hidden until kickoff on their account instance.");
  return false;
}

function toggleCompareTargetPinUnlock() {
  showAppToast("🔒 Other users' hidden picks cannot be unlocked from your device — they auto-reveal at kickoff!");
}

function toggleQuickLockActiveProfile() {
  ensureMultiUserAndPrivacyState();
  var myKey = getMyInstanceProfileKey();
  var meta = getProfileDisplayMeta(myKey);
  var priv = state.profilePrivacy[myKey] || { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: false, autoUnhideFridayNight: false };
  priv.hidden = !priv.hidden;
  priv.manualLockOverride = priv.hidden;
  state.profilePrivacy[myKey] = priv;
  pushMultiUserAndPrivacyToFirebase();
  renderAll();
  refreshUserModalIfOpen();
  showAppToast(priv.hidden
    ? ("🔒 Your picks (" + meta.name + ") are now HIDDEN from other users until kickoff! (Still visible to you)")
    : ("👁️ Your picks (" + meta.name + ") are now PUBLIC to other users."));
}

function toggleFridayNightRevealOverride() {
  state.fridayNightRevealOverride = !state.fridayNightRevealOverride;
  pushMultiUserAndPrivacyToFirebase();
  renderAll();
  refreshUserModalIfOpen();
}

function toggleBlindMode() {
  BLIND_MODE = !BLIND_MODE;
  var topBtn = document.getElementById("btn-blind-mode");
  if (topBtn) {
    topBtn.textContent = BLIND_MODE ? "🙈 Spy Shield: ON" : "👁️ Spy Shield: OFF";
    topBtn.className = "btn-sm" + (BLIND_MODE ? " active" : "");
  }
  var sbBtn = document.getElementById("btn-sidebar-blind");
  if (sbBtn) {
    sbBtn.textContent = BLIND_MODE ? "🙈 Blind: ON" : "🙈 Blind";
    sbBtn.className = "btn-sm" + (BLIND_MODE ? " active" : "");
  }
  showAppToast(BLIND_MODE ? "🙈 Spy Shield ON: Other users' picks hidden!" : "👁️ Spy Shield OFF");
  renderAll();
}

function cycleNextActiveProfile() {
  var myKey = getMyInstanceProfileKey();
  var nextKey = (activeProfile === "test") ? myKey : "test";
  switchProfile(nextKey);
}

function pushMultiUserAndPrivacyToFirebase() {
  if (isApplyingRemoteUpdate) return;
  ensureMultiUserAndPrivacyState();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  // Only push metadata (customUsers registry + profilePrivacy) and the current active profile's picks
  // so one device NEVER overwrites another user's picks!
  // The active profile's picks go through pushProfileToFirebase below (it checks ownership);
  // the Friday-night reveal switch is the commissioner's (Console), not saved from here.
  // Signed-out visitors and accounts not linked to a player save nothing (firestore.rules agree).
  if (fsDb && AUTH_SESSION && AUTH_SESSION.boundProfileKey) {
    try { saveRegistryChangesToCloud().catch(function(e) { reportCloudSaveFailure("player settings", e); }); } catch (e) {}
  }
  if (activeProfile && activeProfile !== "test") {
    pushProfileToFirebase(activeProfile);
  }
}
// Saves only the registry entries and privacy settings this device changed since the last cloud
// read, merged into the current cloud list in a transaction. A profile the cloud copy never had
// is added only if it's this device's own, and one removed elsewhere stays removed.
function saveRegistryChangesToCloud() {
  var same = function(a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var baseCu = {};
  (CLOUD_REGISTRY.customUsers || []).forEach(function(cu) { if (cu && cu.key) baseCu[cu.key] = cu; });
  var basePriv = CLOUD_REGISTRY.profilePrivacy || {};
  var changedCu = (state.customUsers || []).filter(function(cu) {
    if (!cu || !cu.key) return false;
    return baseCu[cu.key] ? !same(baseCu[cu.key], cu) : isDeviceOwnProfileKey(cu.key);
  }).map(function(cu) { return JSON.parse(JSON.stringify(cu)); });
  // Privacy is only ever set for this device's own profiles (the defaults filled in for everyone
  // else would otherwise look like changes).
  var changedPriv = Object.keys(state.profilePrivacy || {}).filter(function(k) {
    return isDeviceOwnProfileKey(k) && !same(basePriv[k], state.profilePrivacy[k]);
  });
  var isCommish = typeof isVerifiedCommissioner === "function" && isVerifiedCommissioner();
  if (!changedCu.length && !changedPriv.length && !isCommish) return Promise.resolve();

  var ref = fsDb.collection("pickem_v14").doc("shared_state");
  var privVals = {};
  changedPriv.forEach(function(k) { privVals[k] = JSON.parse(JSON.stringify(state.profilePrivacy[k])); });
  return fsDb.runTransaction(function(tx) {
    return tx.get(ref).then(function(snap) {
      var cloud = snap.exists ? snap.data() : {};
      var list = Array.isArray(cloud.customUsers) ? cloud.customUsers.slice() : [];
      var cfg = (cloud.commissionerConfig && typeof cloud.commissionerConfig === "object") ? cloud.commissionerConfig : null;
      changedCu.forEach(function(cu) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].key === cu.key) { list[i] = cu; return; }
        }
        if (!baseCu[cu.key] && !isProfileArchived(cu.key, cfg)) list.push(cu);
      });
      var now = new Date().toISOString();
      if (!snap.exists) {
        var doc = { customUsers: list, profilePrivacy: privVals, updatedAt: now };
        if (isCommish) doc.fridayNightRevealOverride = !!state.fridayNightRevealOverride;
        tx.set(ref, doc, { merge: true });
        return list;
      }
      var args = [ref, "customUsers", list, "updatedAt", now];
      changedPriv.forEach(function(k) { args.push(new firebase.firestore.FieldPath("profilePrivacy", k), privVals[k]); });
      if (isCommish) args.push("fridayNightRevealOverride", !!state.fridayNightRevealOverride);
      tx.update.apply(tx, args);
      return list;
    });
  }).then(function(list) {
    CLOUD_REGISTRY.customUsers = JSON.parse(JSON.stringify(list));
    CLOUD_REGISTRY.profilePrivacy = Object.assign({}, CLOUD_REGISTRY.profilePrivacy || {}, privVals);
  });
}
var MEMORY_STORE = {};
// Sets an input's value unless the person is typing in it (a background update must never
// replace a half-typed tiebreaker).
function setInputValueUnlessEditing(el, val) {
  if (el && document.activeElement !== el) el.value = val;
}

function safeGetStorage(key) {
  try {
    var ls = window["local" + "Storage"];
    return ls ? ls.getItem(key) : (MEMORY_STORE[key] || null);
  } catch (e) {
    return MEMORY_STORE[key] || null;
  }
}
function safeSetStorage(key, val) {
  // Don't persist an archived week as this device's saved state.
  if (key === "sat_week7_official_v14" && typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY) return;
  MEMORY_STORE[key] = val;
  try {
    var ls = window["local" + "Storage"];
    if (ls) ls.setItem(key, val);
  } catch (e) {}
}

try {
  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
} catch (e) {}

function findGameById(id) {
  var targetId = Number(id);
  for (var i = 0; i < GAMES.length; i++) {
    if (Number(GAMES[i].id) === targetId) return GAMES[i];
  }
  return null;
}

