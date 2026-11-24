// ============================================================================
// FEATURE C: MULTI-WEEK SEASON HISTORY ARCHIVE (FIRESTORE + LOCAL SNAPSHOTS)
// ============================================================================
function ensureWeekArchivesState() {
  if (!state.weekArchives || typeof state.weekArchives !== "object") {
    state.weekArchives = {};
  }
  populateWeekArchiveDropdown();
}

// Picks of app-only (custom) profiles, keyed by profile key (B30).
function customUserStates() {
  var out = {};
  (state.customUsers || []).forEach(function(u) {
    if (u && u.key && state[u.key]) out[u.key] = state[u.key];
  });
  return out;
}

function saveCurrentWeekToArchive(notifyToast) {
  ensureWeekArchivesState();
  var wkNum = parseInt(state.currentWeek, 10) || 0;
  if (!wkNum) return; // week not known yet: never archive under a guessed week
  var key = "week_" + wkNum;
  state.weekArchives[key] = {
    weekNum: wkNum,
    weekLabel: state.weekLabel || ("Week " + wkNum),
    archivedAt: new Date().toISOString(),
    tiebreakerGameId: state.tiebreakerGameId || null,
    games: JSON.parse(JSON.stringify(GAMES)),
    michael: JSON.parse(JSON.stringify(state.michael || {})),
    kinyion: JSON.parse(JSON.stringify(state.kinyion || {})),
    test: JSON.parse(JSON.stringify(state.test || {})),
    customPicks: JSON.parse(JSON.stringify(customUserStates())),
    customUsers: JSON.parse(JSON.stringify(state.customUsers || [])),
    watchlist: JSON.parse(JSON.stringify(state.watchlist || [])),
    leaderboard: JSON.parse(JSON.stringify(state.leaderboard || [])),
    poolMembers: JSON.parse(JSON.stringify(state.poolMembers || [])),
    liveScores: JSON.parse(JSON.stringify(LIVE_SCORES || {}))
  };
  var entry = state.weekArchives[key];
  var willSave = fsDb && !isApplyingRemoteUpdate && canWriteSharedPoolState();
  // Until the cloud confirms it, an older copy arriving from shared_state must not replace it.
  if (willSave) entry._unsyncedLocal = true;
  saveLocalState();
  if (willSave) {
    try {
      var cloudEntry = weekArchiveForCloud(entry);
      // One doc per week (B08): archives inside shared_state would push it past 1 MiB.
      // Rules published before that collection existed refuse it, so the archive then goes
      // where it lived before (shared_state.weekArchives) rather than not being saved at all.
      var saveToSharedState = function() {
        return fsDb.collection("pickem_v14").doc("shared_state")
          .update(new firebase.firestore.FieldPath("weekArchives", key), cloudEntry);
      };
      var job = ARCHIVE_COLLECTION_OK === false ? saveToSharedState()
        : fsDb.collection("pickem_v14_archives").doc(key).set(cloudEntry).catch(function(e) {
          if (e && e.code === "permission-denied") return saveToSharedState();
          throw e;
        });
      job.then(function() {
        delete entry._unsyncedLocal;
        saveLocalState();
      }, function(e) { reportCloudSaveFailure("the week archive", e); });
    } catch (e) {}
  }
  populateWeekArchiveDropdown();
  if (notifyToast) {
    showAppToast("💾 Archived " + (state.weekLabel || ("Week " + wkNum)) + " to Season History (" + GAMES.length + " games)!");
  }
  if (currentMainView === "standings") {
    renderSeasonArchiveHub();
  }
}

// While a past week is on screen, the live week's data is parked in LIVE_WEEK_SNAPSHOT and
// incoming cloud snapshots wait in PENDING_REMOTE_DATA instead of yanking the view back
// to the live week (the "flickers between weeks" bug). Picks and saves are blocked.
var VIEWING_ARCHIVE_KEY = null;
var LIVE_WEEK_SNAPSHOT = null;
var PENDING_REMOTE_DATA = null;

function liveWeekNum() {
  return parseInt(VIEWING_ARCHIVE_KEY ? LIVE_WEEK_SNAPSHOT.currentWeek : state.currentWeek, 10) || 0;
}

function captureLiveWeekSnapshot() {
  var copy = function(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  return {
    games: copy(GAMES),
    liveScores: copy(LIVE_SCORES),
    currentWeek: state.currentWeek,
    weekLabel: state.weekLabel,
    tiebreakerGameId: state.tiebreakerGameId,
    michael: copy(state.michael),
    kinyion: copy(state.kinyion),
    customPicks: copy(customUserStates()),
    watchlist: copy(state.watchlist),
    poolMembers: copy(state.poolMembers),
    leaderboard: copy(state.leaderboard)
  };
}

function returnToLiveWeek() {
  if (!VIEWING_ARCHIVE_KEY) return;
  var snap = LIVE_WEEK_SNAPSHOT;
  isApplyingRemoteUpdate = true;
  clearAllSlateCaches();
  GAMES = snap.games;
  LIVE_SCORES = snap.liveScores || {};
  state.liveScores = LIVE_SCORES;
  state.currentWeek = snap.currentWeek;
  state.weekLabel = snap.weekLabel;
  state.tiebreakerGameId = snap.tiebreakerGameId;
  ["michael", "kinyion", "watchlist", "poolMembers", "leaderboard"].forEach(function(k) {
    if (snap[k] !== undefined) state[k] = snap[k];
  });
  Object.keys(snap.customPicks || {}).forEach(function(k) { state[k] = snap.customPicks[k]; });
  MONTE_CARLO_CACHE = null;
  VIEWING_ARCHIVE_KEY = null;
  LIVE_WEEK_SNAPSHOT = null;
  isApplyingRemoteUpdate = false;

  var pending = PENDING_REMOTE_DATA;
  PENDING_REMOTE_DATA = null;
  if (pending) {
    applyRemoteCloudData(pending, "Cloud Firestore");
  } else {
    regradeAllPoolMembersLive();
    syncActiveProfileControlsUI();
    renderSwayFeed();
    renderAll();
  }
  var brandEl = document.getElementById("sheet-title-brand");
  if (brandEl) brandEl.textContent = state.weekLabel;
  populateWeekArchiveDropdown();
  showAppToast("🏈 Back to " + state.weekLabel + " (live)");
}

function isViewingArchiveWeek(actionLabel) {
  if (!VIEWING_ARCHIVE_KEY) return false;
  showAppToast("📚 You're viewing an archived week. Switch back to Week " + liveWeekNum() + " to " + (actionLabel || "make changes") + ".");
  return true;
}

function switchWeekArchive(weekKey) {
  ensureWeekArchivesState();
  if (weekKey === "week_" + liveWeekNum()) {
    // The live week always shows live data, never an archived copy of it.
    returnToLiveWeek();
    populateWeekArchiveDropdown();
    return;
  }
  var targetSnap = state.weekArchives[weekKey];
  if (!targetSnap) return;

  if (!VIEWING_ARCHIVE_KEY) {
    // Auto-save the currently active week ONLY if games were completed/scored and not unplayed Week 9
    var curKey = "week_" + (parseInt(state.currentWeek, 10) || 0);
    if (curKey !== weekKey && typeof countScoredGamesInLiveScores === "function" && countScoredGamesInLiveScores() > 0 && curKey !== "week_9") {
      saveCurrentWeekToArchive(false);
    }
    LIVE_WEEK_SNAPSHOT = captureLiveWeekSnapshot();
  }
  VIEWING_ARCHIVE_KEY = weekKey;

  isApplyingRemoteUpdate = true;
  try {
    clearAllSlateCaches();
    GAMES = JSON.parse(JSON.stringify(targetSnap.games || []));
    state.currentWeek = parseInt(targetSnap.weekNum, 10) || 8;
    state.weekLabel = targetSnap.weekLabel || ("Week " + state.currentWeek);
    state.tiebreakerGameId = targetSnap.tiebreakerGameId || null;

    if (targetSnap.michael) state.michael = JSON.parse(JSON.stringify(targetSnap.michael));
    if (targetSnap.kinyion) state.kinyion = JSON.parse(JSON.stringify(targetSnap.kinyion));
    Object.keys(targetSnap.customPicks || {}).forEach(function(k) { state[k] = JSON.parse(JSON.stringify(targetSnap.customPicks[k])); });
    // A player with no saved picks that week shows none, not this week's picks on old games
    // (returnToLiveWeek restores them from LIVE_WEEK_SNAPSHOT).
    // Players without app picks that week get their pool-sheet row for it.
    (state.customUsers || []).forEach(function(u) {
      if (!u || !u.key || !state[u.key] || (targetSnap.customPicks || {})[u.key]) return;
      var found = archivedWeekPicks(targetSnap, u.key);
      state[u.key] = Object.assign({}, state[u.key], { picks: found ? found.picks : {}, tiebreaker: found ? found.tiebreaker : "" });
    });
    if (targetSnap.watchlist) state.watchlist = JSON.parse(JSON.stringify(targetSnap.watchlist));
    if (targetSnap.poolMembers) state.poolMembers = JSON.parse(JSON.stringify(targetSnap.poolMembers));
    if (targetSnap.leaderboard) state.leaderboard = JSON.parse(JSON.stringify(targetSnap.leaderboard));

    LIVE_SCORES = JSON.parse(JSON.stringify(targetSnap.liveScores || {}));
    state.liveScores = LIVE_SCORES;
    MONTE_CARLO_CACHE = null;

    var brandEl = document.getElementById("sheet-title-brand");
    if (brandEl) {
      brandEl.textContent = state.weekLabel; // the eyebrow says "Past week"
    }

    regradeAllPoolMembersLive();
    syncActiveProfileControlsUI();
    renderSwayFeed();
    populateWeekArchiveDropdown();
    renderAll();
  } finally {
    isApplyingRemoteUpdate = false;
  }
  showAppToast("📚 Loaded " + state.weekLabel + " from Season Archive!");
}

function populateWeekArchiveDropdown() {
  var sel = document.getElementById("week-archive-select");
  if (!sel) return;
  if (!state.weekArchives || typeof state.weekArchives !== "object") return;

  var curWk = liveWeekNum();
  var curKey = "week_" + curWk;
  var selectedKey = VIEWING_ARCHIVE_KEY || curKey;
  var keys = Object.keys(state.weekArchives);
  if (keys.indexOf(curKey) === -1) keys.push(curKey);

  keys.sort(function(a, b) {
    var na = parseInt(a.replace("week_", ""), 10) || 0;
    var nb = parseInt(b.replace("week_", ""), 10) || 0;
    return nb - na;
  });

  var html = "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var snap = state.weekArchives[k];
    var wNum = parseInt(k.replace("week_", ""), 10) || curWk;
    var lbl = (snap && snap.weekLabel) ? snap.weekLabel : ("Week " + wNum);
    var liveGames = VIEWING_ARCHIVE_KEY ? LIVE_WEEK_SNAPSHOT.games : GAMES;
    var gmCount = (k === curKey) ? liveGames.length : ((snap && snap.games && snap.games.length) ? snap.games.length : GAMES.length);
    var tag = (k === curKey) ? ("Live • " + gmCount + " Games") : ((wNum === 7) ? "Archived • 89 Graded" : ("Archived • " + gmCount + " Games"));
    if (k === curKey) lbl = "Week " + curWk;
    html += '<option value="' + k + '"' + (k === selectedKey ? ' selected' : '') + '>📚 ' + lbl + ' (' + tag + ')</option>';
  }
  sel.innerHTML = html;
}

// A player's picks for an archived week: their app picks, else their row from that week's pool
// sheet (by linked pool name), else null.
function archivedWeekPicks(snap, key) {
  var prof = (snap.customPicks && snap.customPicks[key]) || ((key === "michael" || key === "kinyion") ? snap[key] : null);
  if (prof && prof.picks && Object.keys(prof.picks).length) return { picks: prof.picks, tiebreaker: prof.tiebreaker || "" };
  var name = typeof getLinkedMemberNameForProfile === "function" ? getLinkedMemberNameForProfile(key) : "";
  var std = name ? standardizeParticipantName(name).toLowerCase() : "";
  var row = std && (snap.poolMembers || []).find(function(m) { return m && standardizeParticipantName(m.name).toLowerCase() === std; });
  return row && row.picks && Object.keys(row.picks).length ? { picks: row.picks, tiebreaker: row.tiebreaker || "" } : null;
}

// A player's record for an archived week: { won, lost, pts } from those picks and the final
// scores, or null when no picks were saved for them that week.
function archivedWeekResult(snap, key) {
  var found = archivedWeekPicks(snap, key);
  var picks = found && found.picks;
  if (!picks || !Object.keys(picks).length) return null;
  var r = { won: 0, lost: 0, pts: 0 };
  (snap.games || []).forEach(function(g) {
    var pick = getResolvedPickForGame(picks, g, false);
    var ls = (snap.liveScores || {})[g.id];
    if (!pick || !ls || !ls.completed || isVoidedGame(ls)) return;
    var a = Number(ls.awayScore) || 0, h = Number(ls.homeScore) || 0;
    if (a === h) return;
    if (isSameTeamPick(a > h ? g.away : g.home, pick, g)) { r.won++; r.pts += getGamePickPts(g, isSameTeamPick(pick, g.away, g)); }
    else r.lost++;
  });
  return r;
}

// Past weeks: every player sees their own record per finished week and can open the week
// (slate, final scores, their picks graded). Snapshot buttons are the commissioner's only.
// Opens a finished week on the Picks screen, where its games, scores and your picks show.
function openPastWeek(weekKey) {
  switchWeekArchive(weekKey);
  if (typeof closePanelSheet === "function") closePanelSheet();
  switchMainView("cards");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSeasonArchiveHub() {
  var box = document.getElementById("season-archive-hub-container");
  if (!box) return;
  ensureWeekArchivesState();
  var commish = typeof isVerifiedCommissioner === "function" && isVerifiedCommissioner();
  var liveKey = "week_" + liveWeekNum();
  var keys = Object.keys(state.weekArchives).filter(function(k) { return /^week_\d+$/.test(k) && k !== liveKey; }).sort(function(a, b) {
    return (parseInt(b.replace("week_", ""), 10) || 0) - (parseInt(a.replace("week_", ""), 10) || 0);
  });
  var me = typeof isSignedInUser === "function" && !isSignedInUser() ? "" : activeProfile;

  var cardsHtml = keys.map(function(k) {
    var snap = state.weekArchives[k];
    if (!snap) return "";
    var label = escapeHtml(snap.weekLabel || ("Week " + snap.weekNum));
    var viewing = VIEWING_ARCHIVE_KEY === k;
    var r = me ? archivedWeekResult(snap, me) : null;
    var line = r ? '<strong>' + r.pts + ' pts</strong> · ' + r.won + '–' + r.lost
      : '<span class="muted-note">' + (me ? 'No picks saved for you' : 'Sign in to see your picks') + '</span>';
    return '<div class="archive-week-card' + (viewing ? ' active-wk' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
        '<strong style="font-size:0.85rem;color:var(--text);">' + label + '</strong>' +
        '<span style="font-size:0.8rem;color:var(--text);">' + line + '</span>' +
      '</div>' +
      '<button type="button" class="btn-sm" style="width:100%;margin-top:6px;font-weight:800;" onclick="' + (viewing ? 'returnToLiveWeek()' : 'openPastWeek(\'' + k + '\')') + '">' +
        (viewing ? 'Back to this week' : 'See ' + label + ' picks and scores') + '</button>' +
    '</div>';
  }).join("");

  box.innerHTML =
    (commish ? '<div style="display:flex;justify-content:flex-end;"><button type="button" class="btn-sm" style="padding:3px 9px;font-size:0.69rem;" onclick="saveCurrentWeekToArchive(true)">Snapshot this week</button></div>' : '') +
    (VIEWING_ARCHIVE_KEY ? '<button type="button" class="btn-sm" style="width:100%;margin:6px 0;font-weight:800;" onclick="returnToLiveWeek(); renderSeasonArchiveHub();">Back to this week</button>' : '') +
    '<div style="font-size:0.75rem;color:var(--muted);">Open a finished week to see the games, final scores and your picks graded.</div>' +
    '<div class="archive-week-strip">' + (cardsHtml || '<p class="muted-note">No finished weeks saved yet.</p>') + '</div>';
}

function renderAll() {
  var lfltBtn = document.getElementById("lflt-all");
  if (lfltBtn) lfltBtn.textContent = "All " + GAMES.length;
  var fltBtn = document.getElementById("flt-all");
  if (fltBtn) fltBtn.textContent = "All " + GAMES.length;

  updateScoreboard(true);
  if (typeof renderSimpleGuestAccountBar === "function") renderSimpleGuestAccountBar();
  if (currentMainView === "condensed") {
    renderCondensedTable();
  } else if (currentMainView === "live") {
    renderLiveScoreboardTab();
  } else if (currentMainView === "standings") {
    renderStandingsAndGradingView();
  } else {
    renderGames();
  }
}



// Picks can't be changed while a past week is on screen.
var _origPickSideArchive = pickSide;
pickSide = function(gameId, sideCode) {
  if (isViewingArchiveWeek("make picks")) return;
  return _origPickSideArchive.apply(this, arguments);
};
var _origPickSideForProfileArchive = pickSideForProfile;
pickSideForProfile = function(profKey, gameId, sideCode) {
  if (isViewingArchiveWeek("make picks")) return;
  return _origPickSideForProfileArchive.apply(this, arguments);
};
