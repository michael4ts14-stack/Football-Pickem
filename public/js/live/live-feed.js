// ============================================================================
// LIVE DRIVES FEED: drives, plays and win probability come from Firestore
// (live_games/week_N_drives_<gameId>, written by the game-day GitHub Actions
// job in tools/live). A game's document is only read while one of its field
// views is on screen (field tracker, game sheet, Theater). If the document is
// missing or stale while the game is on, that one game is fetched from ESPN,
// at most every 30 seconds.
// ============================================================================
var LIVE_DRIVES_FEED = {
  maxWatched: 6,                 // open listeners at once (oldest dropped first)
  staleMs: 90 * 1000,            // server copy older than this during a live game -> ESPN fallback
  espnEveryMs: 30 * 1000         // fallback fetch at most this often per game
};
var LIVE_DRIVE_WATCHES = {};     // gameId -> { key, unsub, lastUsed, waiters, updatedAt }
var LIVE_DRIVE_ESPN_AT = {};     // gameId -> last fallback fetch time
var LIVE_DRIVE_RENDER_TIMER = null;

function liveDrivesDocId(gameId) {
  return "week_" + (parseInt(state.currentWeek, 10) || 0) + "_drives_" + gameId;
}

function rerenderAfterDrives(gameId) {
  if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
  if (LIVE_DRIVE_RENDER_TIMER) return;
  LIVE_DRIVE_RENDER_TIMER = setTimeout(function() { LIVE_DRIVE_RENDER_TIMER = null; renderAll(); }, 400);
}

function espnFallbackForDrives(gameId, force) {
  var ls = LIVE_SCORES[gameId];
  if (!ls || !ls.eventId) return Promise.resolve();
  var last = LIVE_DRIVE_ESPN_AT[gameId] || 0;
  if (!force && Date.now() - last < LIVE_DRIVES_FEED.espnEveryMs) return Promise.resolve();
  LIVE_DRIVE_ESPN_AT[gameId] = Date.now();
  return fetchGameDriveSummary(gameId, ls.eventId).then(function() { rerenderAfterDrives(gameId); });
}

function serverDrivesAreStale(gameId, w) {
  var ls = LIVE_SCORES[gameId];
  if (!w || !w.exists) return true;
  if (ls && ls.inProgress) return !w.updatedAt || Date.now() - w.updatedAt > LIVE_DRIVES_FEED.staleMs;
  return false;
}

function dropOldestDriveWatch() {
  var ids = Object.keys(LIVE_DRIVE_WATCHES);
  if (ids.length < LIVE_DRIVES_FEED.maxWatched) return;
  ids.sort(function(a, b) { return LIVE_DRIVE_WATCHES[a].lastUsed - LIVE_DRIVE_WATCHES[b].lastUsed; });
  stopDriveWatch(ids[0]);
}

function stopDriveWatch(gameId) {
  var w = LIVE_DRIVE_WATCHES[gameId];
  if (!w) return;
  try { if (w.unsub) w.unsub(); } catch (e) {}
  delete LIVE_DRIVE_WATCHES[gameId];
}

// Make sure this game's drives are loaded and kept current. Resolves once data is in
// SUMMARY_PBP_CACHE (or there is none to get). freshCheck: also re-check staleness now.
function loadGameDrives(gameId, freshCheck) {
  var g = findGameById(gameId);
  var ls = LIVE_SCORES[gameId];
  if (!g || !ls || !(ls.inProgress || ls.completed)) return Promise.resolve();
  var key = liveDrivesDocId(gameId);
  var w = LIVE_DRIVE_WATCHES[gameId];
  if (w && w.key !== key) { stopDriveWatch(gameId); w = null; }

  if (w) {
    w.lastUsed = Date.now();
    if (w.ready && (freshCheck || !SUMMARY_PBP_CACHE[gameId]) && serverDrivesAreStale(gameId, w)) return espnFallbackForDrives(gameId);
    return w.ready ? Promise.resolve() : new Promise(function(res) { w.waiters.push(res); });
  }

  if (typeof fsDb === "undefined" || !fsDb) return espnFallbackForDrives(gameId);
  dropOldestDriveWatch();
  w = LIVE_DRIVE_WATCHES[gameId] = { key: key, unsub: null, lastUsed: Date.now(), waiters: [], ready: false, exists: false, updatedAt: 0 };
  return new Promise(function(resolve) {
    w.waiters.push(resolve);
    var settle = function() {
      var first = !w.ready;
      w.ready = true;
      var waiters = w.waiters; w.waiters = [];
      var done = function() { waiters.forEach(function(fn) { fn(); }); };
      if (first && serverDrivesAreStale(gameId, w)) espnFallbackForDrives(gameId).then(done, done);
      else done();
    };
    try {
      w.unsub = fsDb.collection("live_games").doc(key).onSnapshot(function(doc) {
        var data = doc && doc.exists ? doc.data() : null;
        w.exists = !!(data && data.summary);
        w.updatedAt = data && data.updatedAt ? Date.parse(data.updatedAt) || 0 : 0;
        var cur = LIVE_SCORES[gameId];
        if (w.exists && cur && String(data.eventId) === String(cur.eventId)) {
          // Don't let an older server copy replace a newer ESPN fetch of the same game.
          var cached = SUMMARY_PBP_CACHE[gameId];
          if (!cached || cached.fromServer || (cached.fetchedAt || 0) < w.updatedAt) {
            if (applyEspnSummaryToGame(gameId, data.eventId, data.summary, true)) rerenderAfterDrives(gameId);
          }
        }
        settle();
      }, function() { w.exists = false; settle(); });
    } catch (e) { settle(); }
  });
}

// Field views drop .field-mount placeholders; keep their games' drives loaded.
var _liveFeedPrevMount = mountFieldsIn;
mountFieldsIn = function(root) {
  var mounts = (root || document).querySelectorAll(".field-mount[data-field-game]");
  for (var i = 0; i < mounts.length; i++) loadGameDrives(+mounts[i].getAttribute("data-field-game"));
  return _liveFeedPrevMount.apply(this, arguments);
};
