// ============================================================================
// LIVE SCREEN UI: summary tiles, one card per game, "Synced Ns ago" indicator.
// Visual layer only: scores still come from pollLiveSaturdayScores() /
// syncAllLiveTrackingData(), and grading is unchanged.
// ============================================================================
var LAST_LIVE_SYNC_AT = 0;

function isSignedInUser() {
  return !!(AUTH_SESSION && AUTH_SESSION.boundProfileKey && !GUEST_BROWSING_MODE);
}

// Your leaderboard name, or "" for a signed-out visitor (who is a guest, not the default profile).
function getMyLeaderboardNameLower() {
  if (!isSignedInUser()) return "";
  try {
    return standardizeParticipantName(getLinkedMemberNameForProfile(getMyInstanceProfileKey()) || "").toLowerCase();
  } catch (e) { return ""; }
}

// "4th", "T4th" from the season leaderboard; "" if you aren't on it.
function getMyPoolRankLabel() {
  var me = getMyLeaderboardNameLower();
  if (!me) return "";
  var rows = [];
  try { rows = buildPoolLeaderboardRows(); } catch (e) { return ""; }
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].name.toLowerCase() !== me) continue;
    var tot = rows[i].newTotal;
    var ahead = rows.filter(function(r) { return r.newTotal > tot; }).length;
    var tied = rows.filter(function(r) { return r.newTotal === tot; }).length > 1;
    return (tied ? "T" : "") + ordinalSuffix(ahead + 1);
  }
  return "";
}

// Situation words from getGameSituation ("Red zone", "Crunch time", ...). Text, never colour alone.
function situationTagsHtml(sit) {
  var html = "";
  for (var i = 0; sit && i < sit.tags.length; i++) {
    html += '<span class="card-flag sit-' + sit.tags[i].key + '">' + escapeShellHtml(sit.tags[i].label) + '</span>';
  }
  return html;
}

function liveResultFor(pick, g, ls) {
  // Returns { word, cls } for your pick on this game, or null when there is nothing to grade yet.
  if (!pick || !ls || !(ls.inProgress || ls.completed)) return null;
  var pickedAway = isSameTeamPick(pick, g.away, g);
  var mine = pickedAway ? ls.awayScore : ls.homeScore;
  var theirs = pickedAway ? ls.homeScore : ls.awayScore;
  var pts = getGamePickPts(g, pickedAway);
  if (ls.completed) {
    if (mine > theirs) return { word: "Win +" + pts, cls: "is-win" };
    if (mine < theirs) return { word: "Loss", cls: "is-loss" };
    return { word: "Tie", cls: "" };
  }
  if (mine > theirs) return { word: "Leading", cls: "is-win" };
  if (mine < theirs) return { word: "Trailing", cls: "is-loss" };
  return { word: "Tied", cls: "" };
}

// Small football for "has the ball". The words are in the aria-label, so the icon is never the only signal.
var POSSESSION_ICON_SVG = '<svg viewBox="0 0 20 12" width="16" height="10" aria-hidden="true" focusable="false">' +
  '<ellipse cx="10" cy="6" rx="9" ry="5" fill="currentColor"/>' +
  '<path d="M6 6h8M8 4.6v2.8M10 4.6v2.8M12 4.6v2.8" stroke="var(--surface)" stroke-width="1" fill="none"/></svg>';

// Last score we drew per game, so a change gets one 1.5s highlight (none on first draw).
var LIVE_DRAWN_SCORES = {};

function liveTeamRowHtml(g, isAway, ls, myPick, myHidden, flash) {
  var name = isAway ? g.away : g.home;
  var score = isAway ? ls.awayScore : ls.homeScore;
  var other = isAway ? ls.homeScore : ls.awayScore;
  var started = ls.inProgress || ls.completed;
  var losing = started && score < other;
  var isMine = !myHidden && myPick && isSameTeamPick(myPick, name, g);
  var hasBall = ls.inProgress && ls.possessionSide === (isAway ? "away" : "home");
  var pts = getGamePickPts(g, isAway);
  return '<div class="live-team' + (losing ? ' is-behind' : '') + (flash ? ' score-changed' : '') + '">' +
    teamLogoHtml(g, isAway) +
    '<span class="live-team-name">' + escapeShellHtml(name) +
      (pts > 1 ? ' <span class="mult-badge mult-' + pts + '">' + pts + 'x</span>' : '') +
      (hasBall ? ' <span class="poss-icon" role="img" aria-label="Has the ball" title="Has the ball">' + POSSESSION_ICON_SVG + '</span>' : '') +
      (isMine ? ' <span class="your-pick">· Your pick</span>' : '') +
    '</span>' +
    '<span class="live-score">' + (started ? score : '') + '</span>' +
  '</div>';
}

renderLiveScoreboardTab = function() {
  var container = document.getElementById("live-scoreboard-groups");
  if (!container) return;
  ensureMultiUserAndPrivacyState();
  populateCompareTargetSelectors();

  var cmp = null;
  try { cmp = resolveCompareTargetDescriptor(); } catch (e) {}
  var myPicks = getMyPicksMap();
  var wins = 0, losses = 0;
  // Advanced totals (same rules as before: points for picks currently leading or won).
  var mLivePts = 0, kLivePts = 0, mWinCnt = 0, kWinCnt = 0, inProgCnt = 0, finalCnt = 0, diffCnt = 0;
  var windows = {}, order = [];
  var pinned = []; // alert cards pulled to the top when "Pin red zone & 4Q sweats" is on
  var pinAlerts = getLivePinAlerts();
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var ls = LIVE_SCORES[g.id] || { awayScore: 0, homeScore: 0, inProgress: false, completed: false };
    var myHidden = isProfileHiddenFromViewer(activeProfile, g.id);
    var myPick = getResolvedPickForGame(myPicks, g, false);
    var res = myHidden ? null : liveResultFor(myPick, g, ls);
    if (ls.completed && res) { if (res.cls === "is-win") wins++; else if (res.cls === "is-loss") losses++; }

    var h2h = h2hPickForGame(cmp, g);
    var isDiff = !!(myPick && !myHidden && h2h && h2h.pick && !isSameTeamPick(myPick, h2h.pick, g));
    if (isDiff) diffCnt++;
    if (ls.inProgress) inProgCnt++;
    if (ls.completed) finalCnt++;
    if (ls.inProgress || ls.completed) {
      var leader = ls.awayScore > ls.homeScore ? g.away : (ls.homeScore > ls.awayScore ? g.home : null);
      if (leader && myPick && !myHidden && isSameTeamPick(leader, myPick, g)) { mLivePts += getGamePickPts(g, isSameTeamPick(myPick, g.away, g)); mWinCnt++; }
      if (leader && h2h && h2h.pick && isSameTeamPick(leader, h2h.pick, g)) { kLivePts += getGamePickPts(g, isSameTeamPick(h2h.pick, g.away, g)); kWinCnt++; }
    }
    var sit = getGameSituation(ls, g, myHidden ? null : myPicks);
    var alertLs = liveStateForAlerts(g); // the demo sim's drive when this game is running it
    var alert = (alertLs && alertLs.inProgress && !alertLs.completed) ? evaluateLiveGameAlertState(alertLs, myHidden ? null : myPick, g) : null;
    if (liveTabFilter === "active" && !ls.inProgress) continue;
    if (liveTabFilter === "redzone" && !(alert && alert.isRedZone)) continue;
    if (liveTabFilter === "sweat" && !(alert && alert.is4QSweat)) continue;
    if (liveTabFilter === "upset" && !(alert && alert.isUpsetWatch)) continue;
    if (liveTabFilter === "diff" && !isDiff) continue;

    var k = parseKickParts(g.kick);
    var status = ls.completed
      ? '<span class="live-status">Final</span>'
      : (ls.inProgress
          ? '<span class="live-status is-live"><span class="live-dot" aria-hidden="true"></span>' + escapeShellHtml(ls.detail || "Live") + '</span>'
          : '<span class="live-status">' + escapeShellHtml((k.day ? k.day + " " : "") + k.time + (k.net ? " · " + k.net : "")) + '</span>');
    var tags = situationTagsHtml(sit);
    var situation = fieldMiniBarHtml(g, ls) || ((ls.inProgress && (ls.downDistanceText || ls.possessionText))
      ? '<div class="live-situation">' + escapeShellHtml([ls.downDistanceText, ls.possessionText].filter(Boolean).join(" · ")) + '</div>'
      : '');
    var h2hLine = (h2h && !SIMPLE_UI_MODE)
      ? '<div class="card-info"><span class="card-info-item"><span class="card-info-label">' + escapeShellHtml(h2h.name) + '</span> ' + escapeShellHtml(h2h.text) +
          (isDiff ? ' <span class="diff-tag">Diff</span>' : '') + '</span></div>'
      : '';
    var started = ls.inProgress || ls.completed || DEMO_FIELD_PREVIEW;
    var action = started ? ('openFieldTheaterModal(' + g.id + ')') : ('openGameDetail(' + g.id + ')');
    var actionLabel = (started ? "Open GameCast: " : "Details: ") + g.away + " at " + g.home;

    var prevDrawn = LIVE_DRAWN_SCORES[g.id];
    var flashAway = !!(prevDrawn && (ls.inProgress || ls.completed) && prevDrawn.a !== ls.awayScore);
    var flashHome = !!(prevDrawn && (ls.inProgress || ls.completed) && prevDrawn.h !== ls.homeScore);
    if (ls.inProgress || ls.completed) LIVE_DRAWN_SCORES[g.id] = { a: ls.awayScore, h: ls.homeScore };

    var cardHtml =
      '<article class="live-card' + (ls.inProgress ? ' is-live' : '') + (ls.completed ? ' is-final' : '') + (sit.crunchTime ? ' is-crunch' : '') + liveAlertClass(alert) + '" data-game-id="' + g.id + '">' +
        liveAlertBadgesHtml(alert) +
        '<button type="button" class="live-card-btn" onclick="' + action + '" aria-label="' + escapeShellHtml(actionLabel) + '">' +
          '<div class="live-card-top">' + status + '<span class="live-card-right">' + tags +
            (res ? '<span class="live-result ' + res.cls + '">' + res.word + '</span>' : '') + '</span></div>' +
          liveTeamRowHtml(g, true, ls, myPick, myHidden, flashAway) +
          liveTeamRowHtml(g, false, ls, myPick, myHidden, flashHome) +
          situation +
        '</button>' +
        h2hLine +
      '</article>';

    if (pinAlerts && alert && (alert.isRedZone || alert.is4QSweat)) {
      // Combo first, then red zone, then 4Q sweats.
      pinned.push({ rank: alert.alertState === "redzone-4q-combo" ? 0 : (alert.isRedZone ? 1 : 2), html: cardHtml });
      continue;
    }
    var wKey = g.cstWindow || "Other games";
    if (!windows[wKey]) { windows[wKey] = []; order.push(wKey); }
    windows[wKey].push(cardHtml);
  }

  var html = "";
  if (pinned.length) {
    pinned.sort(function(x, y) { return x.rank - y.rank; });
    html += '<h2 class="section-label live-window">Red zone &amp; 4Q sweats</h2>' +
      '<div class="live-grid">' + pinned.map(function(p) { return p.html; }).join("") + '</div>';
  }
  for (var w = 0; w < order.length; w++) {
    html += '<h2 class="section-label live-window">' + escapeShellHtml(order[w].replace(/\bCST\b/g, "CT")) + '</h2>' +
      '<div class="live-grid">' + windows[order[w]].join("") + '</div>';
  }
  container.innerHTML = html || ((liveTabFilter === "diff" && !cmp)
    ? compareChooserHtml("Pick someone to see your head-to-head swing games")
    : '<p class="empty-note">No games match that filter.</p>');

  var setText = function(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
  var actMeta = getProfileMetaByKey(activeProfile);
  setText("live-tab-inprog", inProgCnt);
  setText("live-tab-final", "Completed " + finalCnt + " of " + GAMES.length);
  setText("live-tab-m-label", actMeta.shortName || actMeta.name);
  setText("live-tab-m-pts", mLivePts + " pts");
  setText("live-tab-m-rec", "(" + mWinCnt + " leading or won)");
  setText("live-tab-k-label", cmp ? (cmp.shortName || cmp.name) : "Compare");
  setText("live-tab-k-pts", (cmp && !cmp.hasPicks) ? "No sheet yet" : (kLivePts + " pts"));
  setText("live-tab-k-rec", (cmp && !cmp.hasPicks) ? "" : ("(" + kWinCnt + " leading or won · " + diffCnt + " diffs)"));

  var recEl = document.getElementById("live-rec-val");
  if (recEl) recEl.textContent = wins + "–" + losses;
  var rankEl = document.getElementById("live-rank-val");
  if (rankEl) rankEl.textContent = getMyPoolRankLabel() || "–";
  var diffBtn = document.getElementById("lflt-diff");
  if (diffBtn) diffBtn.textContent = "H2H swings" + (cmp ? " vs " + (cmp.shortName || cmp.name) : "");
  var lflt = document.getElementById("lflt-all");
  if (lflt) lflt.textContent = "All games";
  var counts = liveAlertCounts();
  setText("lflt-redzone", "Red zone (" + counts.redzone + ")");
  setText("lflt-sweat", "4Q sweats (" + counts.sweat + ")");
  setText("lflt-upset", "2x/3x upset watch (" + counts.upset + ")");
  var pinChk = document.getElementById("chk-live-pin-alerts");
  if (pinChk) pinChk.checked = pinAlerts;
};

// "Pin red zone & 4Q sweats to top": on unless turned off on this device.
var LIVE_PIN_ALERTS_KEY = "pickem_live_pin_alerts";
function getLivePinAlerts() {
  return safeGetStorage(LIVE_PIN_ALERTS_KEY) !== "off";
}
function setLivePinAlerts(on) {
  safeSetStorage(LIVE_PIN_ALERTS_KEY, on ? "on" : "off");
  renderLiveScoreboardTab();
}

// ---------- "Synced Ns ago" ----------
function updateLiveSyncAge() {
  var ageEl = document.getElementById("live-sync-age");
  var dot = document.getElementById("live-sync-dot");
  var btn = document.getElementById("live-sync-status");
  var badge = document.getElementById("live-sync-badge");
  if (!ageEl || !dot) return;
  var syncing = badge && badge.classList.contains("loading");
  if (btn && badge) btn.title = (badge.textContent || "").replace(/^[^A-Za-z0-9]+/, "") + " · tap to sync now";
  if (syncing) { ageEl.textContent = "Syncing…"; dot.className = "status-dot"; return; }
  if (!LAST_LIVE_SYNC_AT) { ageEl.textContent = "Sync scores"; dot.className = "status-dot is-off"; return; }
  var secs = Math.max(0, Math.round((Date.now() - LAST_LIVE_SYNC_AT) / 1000));
  ageEl.textContent = "Synced " + (secs < 60 ? secs + "s" : Math.floor(secs / 60) + "m") + " ago";
  dot.className = "status-dot" + (secs > 300 ? " is-stale-bad" : (secs > 120 ? " is-stale" : ""));
  var railTxt = document.getElementById("rail-sync-text");
  if (railTxt) {
    railTxt.textContent = "Scores " + ageEl.textContent.toLowerCase();
    if (railTxt.previousSibling) railTxt.previousSibling.className = dot.className;
  }
}

function markLiveSynced(promise) {
  return Promise.resolve(promise).then(function(v) {
    LAST_LIVE_SYNC_AT = Date.now();
    updateLiveSyncAge();
    return v;
  });
}

var _liveUiPrevPoll = pollLiveSaturdayScores;
pollLiveSaturdayScores = function() {
  return markLiveSynced(_liveUiPrevPoll.apply(this, arguments));
};
var _liveUiPrevSyncAll = syncAllLiveTrackingData;
syncAllLiveTrackingData = function() {
  updateLiveSyncAge();
  return markLiveSynced(_liveUiPrevSyncAll.apply(this, arguments));
};
setInterval(updateLiveSyncAge, 5000);

// "Simulate live alerts" (demo-sim.js): score polls and cloud snapshots rewrite LIVE_SCORES, so
// every redraw puts the sample games back. (Wrapped here: renderAll exists once archive.js loads.)
var _liveUiPrevRenderAll = renderAll;
renderAll = function() {
  applyLiveAlertDemo();
  return _liveUiPrevRenderAll.apply(this, arguments);
};
