// ============================================================================
// FEATURE C: MULTI-WEEK SEASON HISTORY ARCHIVE (FIRESTORE + LOCAL SNAPSHOTS)
// ============================================================================
function buildOfficialWeek7ArchiveEntry() {
  var wk7Members = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_POOL_MEMBERS));
  for (var i = 0; i < wk7Members.length; i++) {
    var m = wk7Members[i];
    if (m.wk7PriorPts !== undefined) m.priorPts = m.wk7PriorPts;
    m.awaitingSheet = false;
  }
  return {
    weekNum: 7,
    weekLabel: "Week 7",
    archivedAt: "2026-10-18T04:00:00.000Z",
    tiebreakerGameId: 1,
    games: JSON.parse(JSON.stringify(DEFAULT_WEEK7_GAMES)),
    michael: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_MICHAEL)),
    kinyion: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_KINYION)),
    watchlist: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_WATCHLIST)),
    poolMembers: wk7Members,
    liveScores: JSON.parse(JSON.stringify(WEEK7_OFFICIAL_LIVE_SCORES))
  };
}

function ensureWeekArchivesState() {
  if (!state.weekArchives || typeof state.weekArchives !== "object") {
    state.weekArchives = {};
  }
  if (!state.weekArchives["week_7"]) {
    state.weekArchives["week_7"] = buildOfficialWeek7ArchiveEntry();
  }
  populateWeekArchiveDropdown();
}

function saveCurrentWeekToArchive(notifyToast) {
  ensureWeekArchivesState();
  var wkNum = parseInt(state.currentWeek, 10) || 8;
  if (typeof isHardcodedWeek7Slate === "function" && isHardcodedWeek7Slate(GAMES)) {
    wkNum = 7;
  } else if (GAMES && GAMES[0] && (GAMES[0].away === "Pittsburgh" || GAMES[0].home === "Miami")) {
    wkNum = 8;
  }
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
    customUsers: JSON.parse(JSON.stringify(state.customUsers || [])),
    watchlist: JSON.parse(JSON.stringify(state.watchlist || [])),
    leaderboard: JSON.parse(JSON.stringify(state.leaderboard || [])),
    poolMembers: JSON.parse(JSON.stringify(state.poolMembers || [])),
    liveScores: JSON.parse(JSON.stringify(LIVE_SCORES || {}))
  };
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  if (fsDb && !isApplyingRemoteUpdate && canWriteSharedPoolState()) {
    try {
      fsDb.collection("pickem_v14").doc("shared_state").set({
        weekArchives: state.weekArchives,
        updatedAt: new Date().toISOString()
      }, { merge: true });
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
    var curKey = "week_" + (parseInt(state.currentWeek, 10) || 8);
    if (curKey !== weekKey && typeof countScoredGamesInLiveScores === "function" && countScoredGamesInLiveScores() > 0 && curKey !== "week_9") {
      saveCurrentWeekToArchive(false);
    }
    LIVE_WEEK_SNAPSHOT = captureLiveWeekSnapshot();
  }
  VIEWING_ARCHIVE_KEY = weekKey;

  isApplyingRemoteUpdate = true;
  clearAllSlateCaches();
  GAMES = JSON.parse(JSON.stringify(targetSnap.games || DEFAULT_WEEK7_GAMES));
  state.currentWeek = parseInt(targetSnap.weekNum, 10) || 8;
  state.weekLabel = targetSnap.weekLabel || ("Week " + state.currentWeek);
  state.tiebreakerGameId = targetSnap.tiebreakerGameId || null;

  if (targetSnap.michael) state.michael = JSON.parse(JSON.stringify(targetSnap.michael));
  if (targetSnap.kinyion) state.kinyion = JSON.parse(JSON.stringify(targetSnap.kinyion));
  if (targetSnap.watchlist) state.watchlist = JSON.parse(JSON.stringify(targetSnap.watchlist));
  if (targetSnap.poolMembers) state.poolMembers = JSON.parse(JSON.stringify(targetSnap.poolMembers));
  if (targetSnap.leaderboard) state.leaderboard = JSON.parse(JSON.stringify(targetSnap.leaderboard));

  LIVE_SCORES = JSON.parse(JSON.stringify(targetSnap.liveScores || {}));
  state.liveScores = LIVE_SCORES;
  MONTE_CARLO_CACHE = null;

  var brandEl = document.getElementById("sheet-title-brand");
  if (brandEl) {
    brandEl.textContent = state.weekLabel + " · Past week";
  }

  regradeAllPoolMembersLive();
  syncActiveProfileControlsUI();
  renderSwayFeed();
  populateWeekArchiveDropdown();
  renderAll();
  isApplyingRemoteUpdate = false;
  showAppToast("📚 Loaded " + state.weekLabel + " from Season Archive!");
}

function populateWeekArchiveDropdown() {
  var sel = document.getElementById("week-archive-select");
  if (!sel) return;
  if (!state.weekArchives || typeof state.weekArchives !== "object") return;

  var curWk = liveWeekNum() || 8;
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

function renderSeasonArchiveHub() {
  var box = document.getElementById("season-archive-hub-container");
  if (!box) return;
  ensureWeekArchivesState();

  var curKey = "week_" + (parseInt(state.currentWeek, 10) || 8);
  var keys = Object.keys(state.weekArchives).sort(function(a, b) {
    return (parseInt(b.replace("week_", ""), 10) || 0) - (parseInt(a.replace("week_", ""), 10) || 0);
  });

  var cardsHtml = "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var snap = state.weekArchives[k];
    if (!snap) continue;
    var isCurrent = (k === curKey);
    var gList = snap.games || [];
    var lsMap = snap.liveScores || {};
    var compCount = 0;
    for (var gid in lsMap) {
      if (lsMap[gid] && lsMap[gid].completed) compCount++;
    }
    var mPts = "—", kPts = "—";
    if (snap.weekNum === 7) {
      mPts = "15 pts (96→111)";
      kPts = "17 pts (95→112)";
    } else if (isCurrent) {
      var mG = calcProfileMetrics("michael");
      var kG = calcProfileMetrics("kinyion");
      mPts = Math.max(mG.liveProjectedPts, mG.finalWonPts) + " pts (" + mG.ev.toFixed(1) + " EV)";
      kPts = Math.max(kG.liveProjectedPts, kG.finalWonPts) + " pts (" + kG.ev.toFixed(1) + " EV)";
    }
    var firstMatchup = (gList[0] ? (gList[0].awayCode + " @ " + gList[0].homeCode) : "26 Games");

    cardsHtml += '<div class="archive-week-card' + (isCurrent ? ' active-wk' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<strong style="font-size:0.82rem;color:var(--text);">📚 ' + (snap.weekLabel || ("Week " + snap.weekNum)) + '</strong>' +
        (isCurrent ? '<span class="badge badge-ev">Active View</span>' : '<span class="badge badge-1x">Archived</span>') +
      '</div>' +
      '<div style="color:var(--muted);">Slate: <strong>' + gList.length + ' Games</strong> (' + firstMatchup + '...) • Graded: <strong>' + compCount + '/' + gList.length + '</strong></div>' +
      '<div style="color:var(--text);">👤 Michael: <strong style="color:var(--text);">' + mPts + '</strong> • 👤 Kinyion: <strong style="color:var(--text);">' + kPts + '</strong></div>' +
      '<div style="margin-top:4px;display:flex;gap:6px;">' +
        (isCurrent
          ? '<button type="button" class="btn-sm" style="width:100%;border-color:var(--border);color:var(--win);font-weight:800;" onclick="saveCurrentWeekToArchive(true)">💾 Update Snapshot in Firestore</button>'
          : '<button type="button" class="btn-sm" style="width:100%;background:var(--accent);color:var(--on-accent);border:none;font-weight:800;" onclick="switchWeekArchive(\'' + k + '\')">📂 Load ' + (snap.weekLabel || ("Week " + snap.weekNum)) + ' Slate & Grades</button>') +
      '</div>' +
    '</div>';
  }

  box.innerHTML =
    '<div class="side-title" style="flex-wrap:wrap;gap:6px;">' +
      '<span>📚 Multi-Week Season History Archive (Synced to Cloud Firestore)</span>' +
      '<button type="button" class="btn-sm" style="padding:3px 9px;font-size:0.69rem;border-color:var(--border);color:var(--text);" onclick="saveCurrentWeekToArchive(true)">💾 Snapshot Current Week</button>' +
    '</div>' +
    '<div style="font-size:0.73rem;color:var(--muted);">Switch between any archived week and your active week at any time from the top bar or below. Importing a new weekly PDF/CSV automatically snapshots the prior week first.</div>' +
    '<div class="archive-week-strip">' + cardsHtml + '</div>';
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
