// ============================================================================
// GAMECAST THEATER: full field, down & distance, drive chart, win probability
// and the play list for one game. Drawing lives in render/field.js.
// ============================================================================
function openFieldTheaterModal(gameId, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  ACTIVE_THEATER_GAME_ID = gameId;
  var backdrop = document.getElementById("field-theater-backdrop");
  if (backdrop) backdrop.style.display = "flex";
  // Drives come from Firestore; only if that copy is missing or stale is this one game
  // fetched from ESPN (at most every 30s, see live-feed.js).
  loadGameDrives(gameId, true);
  renderFieldTheaterModalContent(gameId);
}

function closeFieldTheaterModal() {
  ACTIVE_THEATER_GAME_ID = null;
  var backdrop = document.getElementById("field-theater-backdrop");
  if (backdrop) backdrop.style.display = "none";
}

function theaterPickText(picks, g, hidden, allowRec) {
  if (hidden) return "Hidden";
  return getResolvedPickForGame(picks, g, allowRec) || "No pick";
}

function renderFieldTheaterModalContent(gameId) {
  var g = findGameById(gameId);
  var bodyEl = document.getElementById("theater-modal-body");
  if (!g || !bodyEl) return;

  var ls = LIVE_SCORES[gameId] || { awayScore: 0, homeScore: 0, inProgress: false, completed: false, detail: g.kick };
  var tel = resolveDriveTelemetryForGame(g, ls);
  if (!tel) {
    GAME_DRIVE_VIEW_MODE[gameId] = "demo";
    tel = resolveDriveTelemetryForGame(g, ls);
  }

  var titleEl = document.getElementById("theater-modal-title");
  var subEl = document.getElementById("theater-modal-subtitle");
  if (titleEl) titleEl.textContent = g.away + " " + (ls.awayScore || 0) + " – " + g.home + " " + (ls.homeScore || 0);
  if (subEl) {
    var parts = [ls.completed ? "Final" : (ls.inProgress ? (ls.detail || "Live") : g.kick)];
    var me = getProfileMetaByKey(activeProfile);
    parts.push(me.shortName + ": " + theaterPickText(state[activeProfile].picks, g, isProfileHiddenFromViewer(activeProfile, g.id), true));
    var cmp = null;
    try { cmp = SIMPLE_UI_MODE ? null : resolveCompareTargetDescriptor(); } catch (e) {}
    if (cmp) parts.push(cmp.shortName + ": " + (cmp.hasPicks ? theaterPickText(cmp.picks, g, cmp.isHiddenForGame(g.id), !cmp.isPoolMember) : "No sheet yet"));
    subEl.textContent = parts.join(" · ");
  }

  var cache = SUMMARY_PBP_CACHE[g.id];
  var driveSelect = "";
  if (cache && cache.allDrives && cache.allDrives.length) {
    var opt = function(val, label) { return '<option value="' + val + '"' + (tel.activeMode === val ? ' selected' : '') + '>' + fieldEsc(label) + '</option>'; };
    driveSelect = '<select class="compare-select theater-drive-select" aria-label="Choose a drive" onchange="setGameDriveViewMode(' + g.id + ', this.value)">';
    if (ls.inProgress) driveSelect += opt("live", "Live drive");
    driveSelect += opt("final", (ls.inProgress ? "Current" : "Final") + " drive (#" + cache.finalDrive.driveIndex + " " + cache.finalDrive.teamCode + " " + cache.finalDrive.result + ")");
    if (cache.lastScoringDrive) driveSelect += opt("scoring", "Last scoring drive (#" + cache.lastScoringDrive.driveIndex + " " + cache.lastScoringDrive.teamCode + " " + cache.lastScoringDrive.result + ")");
    for (var d = cache.allDrives.length - 1; d >= 0; d--) {
      var dv = cache.allDrives[d];
      driveSelect += opt("drive_" + dv.driveIndex, "Drive " + dv.driveIndex + ": " + dv.teamCode + " · " + dv.description + " · " + dv.result);
    }
    driveSelect += opt("demo", "Demo sim");
    driveSelect += '</select>';
  }

  var possTeam = tel.possessionSide === "away" ? g.away : g.home;
  var stat = function(label, val, sub) {
    return '<div class="theater-stat"><div class="theater-stat-label">' + label + '</div><div class="theater-stat-val">' + fieldEsc(val) + '</div>' +
      (sub ? '<div class="theater-stat-sub">' + fieldEsc(sub) + '</div>' : '') + '</div>';
  };

  var alert = liveAlertForGame(g);
  var modal = document.getElementById("field-theater-modal");
  if (modal) modal.className = liveAlertClass(alert).trim();
  bodyEl.innerHTML =
    liveAlertBadgesHtml(alert) +
    '<div class="theater-toolbar">' + fieldModePillsHtml(g, ls, tel) + driveSelect + '</div>' +
    (tel.bannerType === "demo" && typeof demoSimControlsHtml === "function" ? demoSimControlsHtml(g) : '') +
    '<div class="theater-stats">' +
      stat("Ball", possTeam, tel.driveResult) +
      stat("Spot", tel.possessionText || "", "Started at " + formatYl100ToSpotText(tel.startYl100, g)) +
      stat("Down", tel.downDistanceText || tel.driveResult || "", tel.clockStr || "") +
      stat("Drive", String(tel.driveDesc || "").split("•")[0].trim(), "") +
    '</div>' +
    fieldMountHtml(g, "theater") +
    fieldDriveChartHtml(g) +
    fieldWinProbHtml(g) +
    '<section class="theater-section"><h4 class="theater-h">Plays <span class="theater-h-sub">most recent first</span></h4>' + buildPlaysListHtml(tel, g, ls) + '</section>';
}
