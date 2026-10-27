// ============================================================================
// FIREBASE REAL-TIME SYNC ENGINE (100% CLOUD FIRESTORE + PER-USER INSTANCE DOCS)
// Supports 6 users now and scales to 80+ concurrent users without profile switching
// or cross-user pick overwrites!
// ============================================================================
function startFirebaseRealtimeListeners() {
  if (fsDb) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").onSnapshot(function(doc) {
        if (doc && doc.exists) {
          applyRemoteCloudData(doc.data(), "Cloud Firestore");
        }
      }, function(err) {});
    } catch (e) {}

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

          // While a past week is on screen, live picks belong to the parked live week.
          var viewingArchive = typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY && LIVE_WEEK_SNAPSHOT;
          var store = (viewingArchive && (docId === "michael" || docId === "kinyion")) ? LIVE_WEEK_SNAPSHOT : state;
          var matchStats = countMatchingPicksForSlate(uData.picks, viewingArchive ? LIVE_WEEK_SNAPSHOT.games : GAMES);
          if (matchStats.total >= 5 && matchStats.matched < Math.ceil(matchStats.total * 0.5)) continue;

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

          var isClearedDoc = !!(uData._picksCleared || (uData.picks && Object.keys(uData.picks).length === 0));
          var linkedLow = standardizeParticipantName(uData.linkedMemberName || uData.displayName || "").toLowerCase();
          if (isClearedDoc) {
            if (!state.deletedPicksByMember) state.deletedPicksByMember = {};
            if (linkedLow) state.deletedPicksByMember[linkedLow] = true;
          } else if (linkedLow && state.deletedPicksByMember && state.deletedPicksByMember[linkedLow]) {
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

        if (anyRemoteApplied) {
          isApplyingRemoteUpdate = true;
          regradeAllPoolMembersLive();
          safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
          renderAll();
          isApplyingRemoteUpdate = false;
        }
      }, function(err2) {});
    } catch (e2) {}
  }
}

function applyRemoteCloudData(data, sourceLabel) {
  if (!data) return;

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
    if (withinLocalPickLock) return false;
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
    // Merge customUsers list without dropping any locally created profile
    var mergedCu = data.customUsers.slice();
    var seenCuKeys = {};
    for (var mcI = 0; mcI < mergedCu.length; mcI++) {
      if (mergedCu[mcI] && mergedCu[mcI].key) seenCuKeys[mergedCu[mcI].key] = true;
    }
    if (state.customUsers && Array.isArray(state.customUsers)) {
      for (var lcI = 0; lcI < state.customUsers.length; lcI++) {
        var lcu = state.customUsers[lcI];
        if (lcu && lcu.key && !seenCuKeys[lcu.key]) {
          mergedCu.push(lcu);
          seenCuKeys[lcu.key] = true;
        }
      }
    }
    state.customUsers = mergedCu;
    for (var cuIdx = 0; cuIdx < state.customUsers.length; cuIdx++) {
      var cKey = state.customUsers[cuIdx].key;
      if (cKey && data[cKey] && data[cKey].picks && shouldAcceptProfile(cKey)) {
        var cMatch = countMatchingPicksForSlate(data[cKey].picks, GAMES);
        if (cMatch.total < 5 || cMatch.matched >= Math.ceil(cMatch.total * 0.5)) {
          state[cKey] = data[cKey];
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
  document.getElementById("tiebreaker-input").value = state[activeProfile].tiebreaker || "28-24";
  document.getElementById("target-slider").value = state[activeProfile].target || 20;

  renderSwayFeed();
  renderAll();
  var nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  document.getElementById("cloud-status-text").textContent = "🔥 Firebase Live Sync (" + sourceLabel + " • " + nowStr + ") — Michael, Kinyion & Pool Synced!";
  isApplyingRemoteUpdate = false;

  if ((neededClean || slateChanged || cloudLbStale) && !window._pushedSlateCleanup) {
    window._pushedSlateCleanup = true;
    pushCustomGamesToFirebase();
    pushWatchlistOrStandingsToFirebase();
  }

  // 3. AUTO-ENRICH NEW WEEK SLATE: When a new week arrives (or games still have Code.gs stub text),
  //    immediately run full ESPN schedule + insights + injury sync and save back to Firebase!
  if ((slateChanged || needsEspnEnrichment) && !window._fullWeekEnrichmentRunning) {
    window._fullWeekEnrichmentRunning = true;
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
  var profObj = state[profKey];
  if (!profObj) return;
  var meta = getProfileMetaByKey(profKey);
  var nowIso = new Date().toISOString();

  // 1. Write to dedicated per-user document (`pickem_v14_users/{profKey}`) for 80+ user scalability
  if (fsDb) {
    try {
      fsDb.collection("pickem_v14_users").doc(profKey).set({
        profileKey: profKey,
        displayName: meta ? meta.name : profKey,
        linkedMemberName: getLinkedMemberNameForProfile(profKey) || (meta ? meta.name : ""),
        priorPts: meta ? (parseFloat(meta.priorPts) || 0) : 0,
        rank: meta ? (meta.defaultRank || "") : "",
        color: meta ? (meta.color || "#10b981") : "#10b981",
        ownerUid: (AUTH_SESSION && AUTH_SESSION.boundProfileKey === profKey) ? (AUTH_SESSION.uid || AUTH_SESSION.email || "") : "",
        picks: profObj.picks || {},
        tiebreaker: profObj.tiebreaker || "28-24",
        target: profObj.target || 20,
        currentWeek: state.currentWeek || 8,
        updatedAt: nowIso
      }, { merge: true }).catch(function() {});
    } catch (eUserDoc) {}
  }

  // 2. Also merge ONLY this profile's key into `pickem_v14/shared_state` (never touching other users' keys!)
  //    The active week is NOT written here: a pick save must never move everyone's week.
  var payload = {};
  payload[profKey] = profObj;
  payload.updatedAt = nowIso;

  if (fsDb) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").set(payload, { merge: true }).then(function() {
        var t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        document.getElementById("cloud-status-text").textContent = "✓ Saved " + profKey.toUpperCase() + " to Cloud Firestore (" + t + ")";
      }).catch(function() {});
    } catch (e) {}
  }
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
    try { fsDb.collection("pickem_v14").doc("shared_state").set(payload, { merge: true }); } catch (e) {}
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
      }, sharedWeekFields()), { merge: true });
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

