// A player's saved picks belong to another week when fewer than half of them fit this week's
// games. Compared with the number of games (not every saved key), so leftover keys from older
// weeks ("game_14", ids past this slate) can't hide a full, valid set of this week's picks.
// "Picks cleared" means the profile was emptied (clearing saves picks: {} with the flag). A
// profile holding picks for this week's games was picked again after a clear, and the flag
// is a leftover that would hide those picks on every other screen, so it's dropped.
function withStaleClearFlagDropped(prof) {
  if (prof && prof._picksCleared && countMatchingPicksForSlate(prof.picks || {}, GAMES).matched > 0) {
    prof = Object.assign({}, prof, { _picksCleared: false });
  }
  return prof;
}

function picksLookLikeAnotherWeek(picks, games) {
  var m = countMatchingPicksForSlate(picks, games);
  var expected = Math.min(m.total, (games || []).length);
  return m.total >= 5 && m.matched < Math.ceil(expected * 0.5);
}

// ============================================================================
// FIREBASE REAL-TIME SYNC ENGINE (100% CLOUD FIRESTORE + PER-USER INSTANCE DOCS)
// Supports 6 users now and scales to 80+ concurrent users without profile switching
// or cross-user pick overwrites!
// ============================================================================
// Snapshots that arrive within this window are applied once (newest wins), so a burst of
// writes from other devices causes one re-render instead of one per write.
var REMOTE_APPLY_DEBOUNCE_MS = 200;
var pendingSharedStateData = null;
var pendingSharedStateTimer = null;
var pendingUsersRenderTimer = null;

function startFirebaseRealtimeListeners() {
  if (fsDb) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").onSnapshot(function(doc) {
        if (!doc || !doc.exists) return;
        // Our own just-saved data echoing back before the server confirms it: already on screen.
        if (doc.metadata && doc.metadata.hasPendingWrites) return;
        pendingSharedStateData = doc.data();
        if (pendingSharedStateTimer) return;
        pendingSharedStateTimer = setTimeout(function() {
          pendingSharedStateTimer = null;
          var data = pendingSharedStateData;
          pendingSharedStateData = null;
          if (data) applyRemoteCloudData(data, "Cloud Firestore");
        }, REMOTE_APPLY_DEBOUNCE_MS);
      }, function(err) {});
    } catch (e) {}

    // Apps Script bot heartbeat (written by Code.js every run): drives the 🤖 status pill.
    try {
      fsDb.collection("live_games").doc("bot_status").onSnapshot(function(doc) {
        BOT_STATUS = (doc && doc.exists) ? doc.data() : null;
        renderBotSyncPill();
      }, function(errBot) {});
      setInterval(renderBotSyncPill, 60000);
    } catch (eBot) {}

    // Dedicated Per-User Instance Collection (`pickem_v14_users/{profileKey}`)
    // Every user writes their own picks to their own document so 80+ users can pick simultaneously
    // with zero document contention and real-time updates across all connected browsers!
    try {
      fsDb.collection("pickem_v14_users").onSnapshot(function(snapshot) {
        if (!snapshot || !snapshot.docChanges) return;
        var changes = snapshot.docChanges();
        if (!changes.length) return;
        var anyRemoteApplied = false;
        var withinMyLocalEdit = (Date.now() - lastLocalPickTs) < 1800;

        for (var i = 0; i < changes.length; i++) {
          var ch = changes[i];
          if (ch.type !== "added" && ch.type !== "modified") continue;
          var docId = ch.doc.id;
          var uData = ch.doc.data();
          if (!docId || !uData || !uData.picks) continue;

          // Never overwrite the local device's own Test Sim or actively-edited profile during a click
          if (docId === "test") continue;
          if (docId === activeProfile && withinMyLocalEdit) continue;
          if (hasPendingProfileSave(docId)) continue; // newer local picks are waiting to save

          // While a past week is on screen, live picks belong to the parked live week.
          var viewingArchive = typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY && LIVE_WEEK_SNAPSHOT;
          var store = (viewingArchive && (docId === "michael" || docId === "kinyion")) ? LIVE_WEEK_SNAPSHOT : state;
          if (picksLookLikeAnotherWeek(uData.picks, viewingArchive ? LIVE_WEEK_SNAPSHOT.games : GAMES)) continue;

          // Register custom user metadata if this is one of the 80+ user accounts not yet in state.customUsers
          if (docId !== "michael" && docId !== "kinyion" && docId !== "test") {
            ensureMultiUserAndPrivacyState();
            var existsCu = false;
            for (var c = 0; c < state.customUsers.length; c++) {
              if (state.customUsers[c].key === docId) {
                existsCu = true;
                if (uData.linkedMemberName) state.customUsers[c].linkedMemberName = uData.linkedMemberName;
                if (uData.displayName) state.customUsers[c].name = uData.displayName;
                break;
              }
            }
            if (!existsCu && (uData.displayName || uData.linkedMemberName)) {
              state.customUsers.push({
                key: docId,
                name: uData.displayName || uData.linkedMemberName,
                linkedMemberName: uData.linkedMemberName || uData.displayName,
                priorPts: parseFloat(uData.priorPts) || 0,
                rank: uData.rank || "Linked",
                color: uData.color || "#10b981",
                ownerUid: uData.ownerUid || ""
              });
            }
          }

          // Cleared means a commissioner emptied this player's picks this week and they haven't
          // picked again. An account with no picks yet, or one cleared in an earlier week, must
          // not hide the player's sheet picks.
          var liveGames = viewingArchive ? LIVE_WEEK_SNAPSHOT.games : GAMES;
          var liveWeek = parseInt(viewingArchive ? LIVE_WEEK_SNAPSHOT.currentWeek : state.currentWeek, 10) || 0;
          var hasLivePicks = hasSubmittedPicksForCurrentSlate(uData.picks, liveGames);
          var isClearedDoc = !!(uData._picksCleared && !hasLivePicks && liveWeek && parseInt(uData.currentWeek, 10) === liveWeek);
          var linkedLow = standardizeParticipantName(uData.linkedMemberName || uData.displayName || "").toLowerCase();
          // A duplicate profile's state says nothing about the player's real picks.
          if (isDuplicateProfileKey(docId, uData.linkedMemberName || uData.displayName || "")) linkedLow = "";
          if (isClearedDoc) {
            if (!state.deletedPicksByMember) state.deletedPicksByMember = {};
            if (linkedLow) state.deletedPicksByMember[linkedLow] = true;
          } else if (linkedLow && state.deletedPicksByMember && state.deletedPicksByMember[linkedLow] && hasLivePicks) {
            // Picked again after a clear.
            if ((Date.now() - lastLocalPickTs) < 4000) continue;
            delete state.deletedPicksByMember[linkedLow];
          }
          store[docId] = Object.assign({}, store[docId] || {}, {
            picks: isClearedDoc ? {} : uData.picks,
            _picksCleared: isClearedDoc,
            tiebreaker: uData.tiebreaker || (store[docId] && store[docId].tiebreaker) || "28-24",
            target: uData.target || (store[docId] && store[docId].target) || 20,
            linkedMemberName: uData.linkedMemberName !== undefined ? uData.linkedMemberName : (store[docId] ? store[docId].linkedMemberName : "")
          });
          anyRemoteApplied = true;
        }

        if (anyRemoteApplied && !pendingUsersRenderTimer) {
          // State is already updated above; batch the expensive regrade + full re-render.
          pendingUsersRenderTimer = setTimeout(function() {
            pendingUsersRenderTimer = null;
            isApplyingRemoteUpdate = true;
            try {
              regradeAllPoolMembersLive();
              safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
              renderAll();
            } finally {
              isApplyingRemoteUpdate = false;
            }
          }, REMOTE_APPLY_DEBOUNCE_MS);
        }
      }, function(err2) {});
    } catch (e2) {}
  }
}

// False until the pool's shared state first arrives (or boot gives up waiting). Until then a
// device with no saved slate only has the built-in Week 7 games, which must not be shown or picked.
var CLOUD_HYDRATED = false;

function isAwaitingFirstSlate() {
  return !CLOUD_HYDRATED && isHardcodedWeek7Slate(GAMES);
}

function applyRemoteCloudData(data, sourceLabel) {
  if (!data) return;
  CLOUD_HYDRATED = true;

  // 1. ANTI-FLICKER GUARD: Never let a stale Week 7 snapshot (e.g. from Cloud Firestore when Code.gs only updated RTDB)
  //    overwrite an active Week 8+ slate already loaded in memory!
  var incomingGames = (data.customGames && Array.isArray(data.customGames) && data.customGames.length > 0) ? data.customGames : null;
  var incomingWkNum = Math.max(parseInt(data.currentWeek, 10) || 0, parseWeekNumFromLabel(data.weekLabel));
  if (incomingWkNum > LAST_CLOUD_WEEK) LAST_CLOUD_WEEK = incomingWkNum;
  if (typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY) {
    // Someone is looking at a past week: keep the newest snapshot and apply it when they
    // return to the live week, instead of switching the screen out from under them.
    PENDING_REMOTE_DATA = data;
    return;
  }
  var incomingIsWk7 = incomingGames ? isHardcodedWeek7Slate(incomingGames) : (incomingWkNum > 0 && incomingWkNum <= 7 && !data.leaderboard && !data.poolMembers);
  var currentIsCustomNewWeek = !isHardcodedWeek7Slate(GAMES) || hasLockedCustomSlate || (state.currentWeek && state.currentWeek >= 8);

  if (currentIsCustomNewWeek && incomingIsWk7) {
    // Auto-heal the stale database (e.g., Firestore) by pushing the current Week 8+ state to both DBs once
    if (!window._healedStaleFirestoreWeek) {
      window._healedStaleFirestoreWeek = true;
      setTimeout(function() {
        pushCustomGamesToFirebase();
        pushWatchlistOrStandingsToFirebase();
      }, 100);
    }
    return;
  }

  isApplyingRemoteUpdate = true;

  var slateChanged = false;
  var needsEspnEnrichment = false;
  if (incomingGames) {
    var incomingSig = getSlateSignature(incomingGames);
    var currentSig = getSlateSignature(GAMES);
    if (incomingSig !== currentSig) {
      GAMES = incomingGames;
      slateChanged = true;
      if (!isHardcodedWeek7Slate(GAMES)) {
        hasLockedCustomSlate = true;
      }
      clearAllSlateCaches();
    } else {
      // Same 26 matchups: preserve any in-memory ESPN enrichments (insights, schedules, injuries, kickoff times)
      for (var mIdx = 0; mIdx < GAMES.length; mIdx++) {
        if (incomingGames[mIdx]) {
          mergeEnrichedGameFields(incomingGames[mIdx], GAMES[mIdx]);
          GAMES[mIdx] = incomingGames[mIdx];
        }
      }
    }

    for (var i = 0; i < GAMES.length; i++) {
      var g = GAMES[i];
      var aRank = TEAM_RANKS[g.away] || null;
      var hRank = TEAM_RANKS[g.home] || null;
      var aClean = (g.awayRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
      var hClean = (g.homeRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
      g.awayRec = (aRank ? (aRank + " • ") : "") + aClean;
      g.homeRec = (hRank ? (hRank + " • ") : "") + hClean;
      enrichGameInjuries(g);
      if (g.awayL5 && g.awayL5.length) {
        TEAM_LOGS[g.away] = Object.assign(TEAM_LOGS[g.away] || {}, { rec: g.awayRec || "2026", l5: g.awayL5 });
      }
      if (g.homeL5 && g.homeL5.length) {
        TEAM_LOGS[g.home] = Object.assign(TEAM_LOGS[g.home] || {}, { rec: g.homeRec || "2026", l5: g.homeL5 });
      }
      if (!isGameEnrichedWithEspnData(g)) {
        needsEspnEnrichment = true;
      }
    }
  }

  if (data.liveScores && typeof data.liveScores === "object" && !slateChanged) {
    for (var lsKey in data.liveScores) {
      var incomingLs = data.liveScores[lsKey];
      var gCheck = findGameById(lsKey);
      if (!gCheck || !incomingLs) continue;
      if (incomingLs.matchupKey && incomingLs.matchupKey !== gameMatchupKey(gCheck)) continue;
      var existingLs = LIVE_SCORES[lsKey];
      if (incomingLs.completed || incomingLs.inProgress) {
        if (!existingLs || (!existingLs.completed && !existingLs.inProgress) || incomingLs.completed) {
          LIVE_SCORES[lsKey] = incomingLs;
        }
      }
    }
    state.liveScores = LIVE_SCORES;
  }

  // 2. GRANULAR PER-PROFILE MERGE: Never let another user's cloud update switch your activeProfile
  //    or compareTargetKey, and only protect `activeProfile` during a 1.5s local click while
  //    ALWAYS accepting other users' incoming picks in real time!
  var withinLocalPickLock = (Date.now() - lastLocalPickTs) < 3500;
  if (data.deletedPicksByMember && typeof data.deletedPicksByMember === "object" && !withinLocalPickLock) {
    state.deletedPicksByMember = data.deletedPicksByMember;
  }
  var shouldAcceptProfile = function(profKey) {
    if (profKey === "test") return false; // Test Sim is always isolated per-device!
    if (withinLocalPickLock || hasPendingProfileSave(profKey)) return false;
    var pMeta = getProfileMetaByKey(profKey);
    var pLow = standardizeParticipantName((pMeta && (pMeta.linkedMemberName || pMeta.name)) || "").toLowerCase();
    if (pLow && state.deletedPicksByMember && state.deletedPicksByMember[pLow]) return false;
    return true;
  };

  if (data.michael && data.michael.picks && shouldAcceptProfile("michael")) {
    var mMatch = countMatchingPicksForSlate(data.michael.picks, GAMES);
    if (mMatch.total < 5 || mMatch.matched >= Math.ceil(mMatch.total * 0.5)) {
      state.michael = data.michael;
    }
  }
  if (data.kinyion && data.kinyion.picks && shouldAcceptProfile("kinyion")) {
    var kMatch = countMatchingPicksForSlate(data.kinyion.picks, GAMES);
    if (kMatch.total < 5 || kMatch.matched >= Math.ceil(kMatch.total * 0.5)) {
      state.kinyion = data.kinyion;
    }
  }
  if (data.customUsers && Array.isArray(data.customUsers)) {
    // The cloud list is the registry. A profile only this device has is kept only if it's one of
    // this device's own (just created, not saved yet); any other local-only entry is a player
    // removed or merged elsewhere, and keeping it let a stale phone or laptop push it back.
    var mergedCu = data.customUsers.slice();
    var seenCuKeys = {};
    for (var mcI = 0; mcI < mergedCu.length; mcI++) {
      if (mergedCu[mcI] && mergedCu[mcI].key) seenCuKeys[mergedCu[mcI].key] = true;
    }
    if (state.customUsers && Array.isArray(state.customUsers)) {
      for (var lcI = 0; lcI < state.customUsers.length; lcI++) {
        var lcu = state.customUsers[lcI];
        if (lcu && lcu.key && !seenCuKeys[lcu.key] && isDeviceOwnProfileKey(lcu.key)) {
          mergedCu.push(lcu);
          seenCuKeys[lcu.key] = true;
        }
      }
    }
    state.customUsers = mergedCu;
    for (var cuIdx = 0; cuIdx < state.customUsers.length; cuIdx++) {
      var cKey = state.customUsers[cuIdx].key;
      if (cKey && data[cKey] && data[cKey].picks && shouldAcceptProfile(cKey)) {
        if (!picksLookLikeAnotherWeek(data[cKey].picks, GAMES)) {
          state[cKey] = withStaleClearFlagDropped(data[cKey]);
        }
      }
    }
  }
  if (data.profilePrivacy && typeof data.profilePrivacy === "object") {
    for (var ppk in data.profilePrivacy) {
      var wasHidden = state.profilePrivacy && state.profilePrivacy[ppk] && state.profilePrivacy[ppk].hidden;
      state.profilePrivacy[ppk] = data.profilePrivacy[ppk];
      // Never auto-lock the profile that this device is signed into / actively using!
      var isMyBoundProf = (AUTH_SESSION && AUTH_SESSION.boundProfileKey === ppk) || (ppk === activeProfile);
      if (data.profilePrivacy[ppk].hidden && !wasHidden && !isMyBoundProf) {
        SESSION_UNLOCKED_PROFILES[ppk] = false;
      }
    }
  }
  if (data.watchlist && Array.isArray(data.watchlist) && !withinLocalPickLock) {
    state.watchlist = data.watchlist;
  }

  var localMaxPrior = Math.max(getMaxPriorPts(state.leaderboard), getMaxPriorPts(WEEK7_OFFICIAL_LEADERBOARD));
  var cloudLbStale = false;
  if (data.leaderboard && Array.isArray(data.leaderboard) && data.leaderboard.length > 0) {
    var incomingLbMax = getMaxPriorPts(data.leaderboard);
    if (incomingLbMax >= localMaxPrior) {
      state.leaderboard = data.leaderboard;
    } else {
      cloudLbStale = true;
    }
  }
  if (data.poolMembers) {
    var incomingPm = Array.isArray(data.poolMembers) ? data.poolMembers : Object.values(data.poolMembers);
    if (incomingPm.length > 0) {
      var incomingPmMax = getMaxPriorPts(incomingPm);
      if (incomingPmMax < localMaxPrior) cloudLbStale = true;
      state.poolMembers = incomingPm;
    }
  }
  var minValidWeek = (!isHardcodedWeek7Slate(GAMES) || localMaxPrior >= 120) ? 8 : 7;
  if (incomingWkNum >= minValidWeek && incomingWkNum >= (state.currentWeek || minValidWeek)) {
    state.currentWeek = incomingWkNum;
    state.weekLabel = "Week " + incomingWkNum;
  } else if ((data.currentWeek && parseInt(data.currentWeek, 10) < minValidWeek) || (data.weekLabel && parseWeekNumFromLabel(data.weekLabel) < minValidWeek)) {
    cloudLbStale = true;
  }
  if (data.lastScrapedFile) state.lastScrapedFile = data.lastScrapedFile;
  if (data.commissionerConfig && typeof data.commissionerConfig === "object") {
    state.commissionerConfig = Object.assign(ensureCommissionerConfig(), data.commissionerConfig);
    renderCommishAnnouncementBanner();
  }
  if (data.tiebreakerGameId) state.tiebreakerGameId = parseInt(data.tiebreakerGameId, 10) || null;
  if (data.weekArchives && typeof data.weekArchives === "object") {
    state.weekArchives = Object.assign({}, state.weekArchives || {}, data.weekArchives);
  }
  ensureWeekArchivesState();

  var neededClean = sanitizeStateForActiveSlate();
  ensureWatchlistDefaults();
  regradeAllPoolMembersLive();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  setInputValueUnlessEditing(document.getElementById("tiebreaker-input"), state[activeProfile].tiebreaker || "28-24");
  setInputValueUnlessEditing(document.getElementById("target-slider"), state[activeProfile].target || 20);

  renderSwayFeed();
  renderAll();
  var nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  document.getElementById("cloud-status-text").textContent = "🔥 Firebase Live Sync (" + sourceLabel + " • " + nowStr + ") — Michael, Kinyon & Pool Synced!";
  isApplyingRemoteUpdate = false;

  if ((neededClean || slateChanged || cloudLbStale) && !window._pushedSlateCleanup) {
    window._pushedSlateCleanup = true;
    pushCustomGamesToFirebase();
    pushWatchlistOrStandingsToFirebase();
  }

  // 3. AUTO-ENRICH NEW WEEK SLATE: When a new week arrives (or games still have Code.gs stub text),
  //    immediately run full ESPN schedule + insights + injury sync and save back to Firebase!
  // Games ESPN can't enrich stay "unenriched" forever, so without the 5-minute floor every
  // snapshot re-ran a full ESPN refresh (dozens of requests) on every device.
  var enrichDue = slateChanged || !window._lastFullWeekEnrichmentAt || (Date.now() - window._lastFullWeekEnrichmentAt) > 5 * 60 * 1000;
  if ((slateChanged || needsEspnEnrichment) && enrichDue && !window._fullWeekEnrichmentRunning) {
    window._fullWeekEnrichmentRunning = true;
    window._lastFullWeekEnrichmentAt = Date.now();
    setTimeout(function() {
      syncAllLiveTrackingData(true).finally(function() {
        setTimeout(function() { window._fullWeekEnrichmentRunning = false; }, 10000);
      });
    }, 120);
  }
}

function pushProfileToFirebase(profKey) {
  if (isApplyingRemoteUpdate) return;
  // An archived week's picks on screen must never be saved as this week's picks.
  if (typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY) return;
  // Keep `test` (Sandbox Sim) local to this device so sandbox experiments never collide across users
  if (profKey === "test") {
    safeSetStorage("sat_device_test_sim_v16", JSON.stringify(state.test || {}));
    return;
  }
  // Without a signed-in account nothing but the local sandbox is saved, so a visitor can
  // never overwrite a pool member's picks.
  if (!AUTH_SESSION) return;
  // Only the player this account is bound to (account-security.js); anyone for a commissioner.
  if (typeof canSaveProfileToCloud === "function" && !canSaveProfileToCloud(profKey)) return;
  var profObj = state[profKey];
  if (!profObj) return;
  var meta = getProfileMetaByKey(profKey);
  var nowIso = new Date().toISOString();

  // 1. The profile's own pick doc (`pickem_v14_users/{profKey}`). Your own entries are saved
  //    with you as owner; a commissioner editing someone else's leaves the owner alone.
  //    firestore.rules only lets the owner (or a commissioner) change a profile.
  var mine = isOwnEntry(profKey);
  var userDoc = {
        profileKey: profKey,
        displayName: meta ? meta.name : profKey,
        linkedMemberName: getLinkedMemberNameForProfile(profKey) || (meta ? meta.name : ""),
        priorPts: meta ? (parseFloat(meta.priorPts) || 0) : 0,
        rank: meta ? (meta.defaultRank || "") : "",
        color: meta ? (meta.color || "#10b981") : "#10b981",
    picks: profObj.picks || {},
    tiebreaker: profObj.tiebreaker || "28-24",
    target: profObj.target || 20,
    currentWeek: state.currentWeek || 8,
    updatedAt: nowIso
  };
  if (mine) userDoc.ownerUid = AUTH_SESSION.uid;

  // 2. Then ONLY this profile's key in `pickem_v14/shared_state` (never other users' keys),
  //    named in lastProfileWriter so the rules can check you own it. After step 1, so a new
  //    profile's pick doc (its ownership record) exists first. The active week is never
  //    written here: a pick save must never move everyone's week.
  var payload = {};
  payload[profKey] = profObj;
  payload.lastProfileWriter = profKey;
  payload.updatedAt = nowIso;

  if (!fsDb) return;
  var setStatus = function(ok) {
    var el = document.getElementById("cloud-status-text");
    if (!el) return;
    var t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.textContent = ok ? "✓ Saved " + profKey.toUpperCase() + " to Cloud Firestore (" + t + ")" : "Couldn't save " + profKey.toUpperCase() + " to the cloud (" + t + ")";
  };
  // mergeFields replaces each listed field whole. A plain merge set deep-merges maps, so a
  // pick removed on one device (or a stale key dropped for the new slate) stayed in the cloud
  // and came back on every other device.
  try {
    fsDb.collection("pickem_v14_users").doc(profKey).set(userDoc, { mergeFields: Object.keys(userDoc) })
      .then(function() { return fsDb.collection("pickem_v14").doc("shared_state").set(payload, { mergeFields: Object.keys(payload) }); })
      .then(function() { setStatus(true); }, function(e) { setStatus(false); reportCloudSaveFailure(profKey.toUpperCase() + "'s picks", e); });
  } catch (e) {}
}

// A cloud save that failed is shown (once per 20s per label) instead of leaving the screen
// looking saved while every other device, and this one after a refresh, keeps the old value.
var CLOUD_SAVE_FAIL_SHOWN = {};
function reportCloudSaveFailure(label, err) {
  var now = Date.now();
  if (CLOUD_SAVE_FAIL_SHOWN[label] && now - CLOUD_SAVE_FAIL_SHOWN[label] < 20000) return;
  CLOUD_SAVE_FAIL_SHOWN[label] = now;
  var why = err && err.code === "permission-denied" ? "not allowed for this account" : ((err && err.code) || "offline?");
  if (typeof showAppToast === "function") showAppToast("Couldn't save " + label + " to the cloud (" + why + "). Other devices won't see it.");
}

// Profiles this device made or plays: the active profile, the bound one, and linked entries.
function isDeviceOwnProfileKey(key) {
  if (!key) return false;
  if (key === activeProfile) return true;
  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey === key) return true;
  return !!(AUTH_SESSION && (AUTH_SESSION.linkedEntries || []).some(function(e) { return e && e.profileKey === key; }));
}

// Your own entries: the profile your account is bound to, or one of your linked entries.
function isOwnEntry(profKey) {
  if (!AUTH_SESSION || !AUTH_SESSION.uid) return false;
  if (AUTH_SESSION.boundProfileKey === profKey) return true;
  if (typeof bindingOwnerUid === "function" && bindingOwnerUid(profKey) === AUTH_SESSION.uid) return true;
  return (AUTH_SESSION.linkedEntries || []).some(function(e) { return e && e.profileKey === profKey; });
}

var BOT_STATUS = null;

function formatAgo(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  if (!iso || isNaN(ms)) return "never";
  var min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return min + "m ago";
  if (min < 48 * 60) return Math.round(min / 60) + "h ago";
  return Math.round(min / 1440) + "d ago";
}

// Commissioner-only pill: when the Gmail bot last finished a run with no failed reads/writes.
function renderBotSyncPill() {
  var el = document.getElementById("bot-sync-pill");
  if (!el) return;
  var gmail = BOT_STATUS && BOT_STATUS.gmail;
  var espn = BOT_STATUS && BOT_STATUS.espn;
  if (!gmail) {
    el.textContent = "Bot: no data";
    el.style.color = "var(--text)";
    return;
  }
  var lastOk = gmail.lastSuccessAt;
  var staleMs = lastOk ? (Date.now() - new Date(lastOk).getTime()) : Infinity;
  var hasErrors = gmail.ok === false;
  // Text labels: the redesign strips emoji from the page.
  el.textContent = (hasErrors ? "Bot errors · " : "Bot ok · ") + formatAgo(lastOk);
  el.style.color = hasErrors ? "#f87171" : (staleMs > 15 * 60 * 1000 ? "#fbbf24" : "#34d399");
  var lines = [
    "Gmail bot — last clean run: " + (lastOk ? new Date(lastOk).toLocaleString() : "never"),
    "Last run: " + (gmail.lastRunAt ? new Date(gmail.lastRunAt).toLocaleString() : "—")
  ];
  if (gmail.errors && gmail.errors.length) lines.push("Errors: " + gmail.errors.join(" | "));
  if (espn) lines.push("ESPN poller: " + (espn.ok ? "ok" : "failing") + (espn.errors && espn.errors.length ? " — " + espn.errors[0] : ""));
  el.title = lines.join("\n");
}

// Highest currentWeek seen in any shared_state snapshot this session.
var LAST_CLOUD_WEEK = 0;

// Pool-wide fields (poolMembers, leaderboard, liveScores, weekArchives, customGames,
// watchlist, currentWeek) are shared by every player. Only a verified commissioner may
// write them, and never while looking at an archived week. Every other client used to
// push its own copy, so 40-100 browsers overwrote each other (lost sheet imports,
// week flicker, a write->snapshot->re-render storm).
function canWriteSharedPoolState() {
  if (typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY) return false;
  if (typeof LIVE_ALERT_DEMO !== "undefined" && LIVE_ALERT_DEMO) return false; // sample scores on screen
  return typeof isVerifiedCommissioner === "function" && isVerifiedCommissioner();
}

// Week fields for a commissioner write; omitted if they would move the pool backward.
function sharedWeekFields() {
  var wk = parseInt(state.currentWeek, 10) || 0;
  if (!wk || wk < LAST_CLOUD_WEEK) return {};
  return { currentWeek: wk, weekLabel: "Week " + wk };
}

function pushWatchlistOrStandingsToFirebase() {
  if (isApplyingRemoteUpdate) return;
  state.liveScores = LIVE_SCORES;
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  if (!canWriteSharedPoolState()) return;
  var payload = Object.assign({
    watchlist: state.watchlist,
    leaderboard: state.leaderboard,
    poolMembers: state.poolMembers || [],
    liveScores: LIVE_SCORES,
    weekArchives: state.weekArchives || {},
    updatedAt: new Date().toISOString()
  }, sharedWeekFields());
  if (fsDb) {
    try { fsDb.collection("pickem_v14").doc("shared_state").set(payload, { merge: true }).catch(function(e) { reportCloudSaveFailure("standings", e); }); } catch (e) {}
  }
}

function pushCustomGamesToFirebase() {
  if (!canWriteSharedPoolState()) return;
  if (fsDb) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").set(Object.assign({
        customGames: GAMES,
        tiebreakerGameId: state.tiebreakerGameId || null,
        michael: state.michael,
        kinyion: state.kinyion,
        watchlist: state.watchlist,
        leaderboard: state.leaderboard,
        poolMembers: state.poolMembers || [],
        weekArchives: state.weekArchives || {},
        updatedAt: new Date().toISOString()
      }, sharedWeekFields()), { merge: true }).catch(function(e) { reportCloudSaveFailure("the slate", e); });
    } catch (e) {}
  }
}

function pullFromFirebaseCloud() {
  document.getElementById("cloud-status-text").textContent = "↻ Pulling latest state from Cloud Firestore (`football-pickem-46206`)...";
  if (fsDb) {
    fsDb.collection("pickem_v14").doc("shared_state").get().then(function(doc) {
      if (doc && doc.exists) {
        applyRemoteCloudData(doc.data(), "Cloud Firestore");
      } else {
        pushProfileToFirebase("michael");
        pushProfileToFirebase("kinyion");
        pushWatchlistOrStandingsToFirebase();
      }
    }).catch(function() {});
  }
}

