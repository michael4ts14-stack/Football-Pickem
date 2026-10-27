// ============================================================================
// BIG-SCREEN GAMECAST THEATER MODAL (Full-Size Field + All Drives Selector)
// ============================================================================
function openFieldTheaterModal(gameId, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  ACTIVE_THEATER_GAME_ID = gameId;
  var backdrop = document.getElementById("field-theater-backdrop");
  if (backdrop) backdrop.style.display = "flex";
  var ls = LIVE_SCORES[gameId];
  if (ls && ls.eventId && !SUMMARY_PBP_CACHE[gameId]) {
    fetchGameDriveSummary(gameId, ls.eventId).then(function() {
      if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
      renderAll();
    });
  }
  renderFieldTheaterModalContent(gameId);
}

function closeFieldTheaterModal() {
  ACTIVE_THEATER_GAME_ID = null;
  var backdrop = document.getElementById("field-theater-backdrop");
  if (backdrop) backdrop.style.display = "none";
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
  if (titleEl) {
    titleEl.textContent = "🏈 #" + g.id + " " + g.away + " (" + ls.awayScore + ") at " + g.home + " (" + ls.homeScore + ") — " + (ls.completed ? "FINAL" : (ls.inProgress ? "LIVE (" + ls.detail + ")" : g.kick));
  }
  if (subEl) {
    var actMetaTh = getProfileMetaByKey(activeProfile);
    var cmpTargetTh = resolveCompareTargetDescriptor();
    var actHidTh = isProfileHiddenFromViewer(activeProfile, g.id);
    var cmpHidTh = cmpTargetTh ? cmpTargetTh.isHiddenForGame(g.id) : false;
    var actPickTh = actHidTh ? "🔒 Hidden" : (getResolvedPickForGame(state[activeProfile].picks, g, true) || g.rec);
    var cmpPickTh = !cmpTargetTh ? "—" : (cmpHidTh ? "🔒 Hidden" : (cmpTargetTh.hasPicks ? (getResolvedPickForGame(cmpTargetTh.picks, g, !cmpTargetTh.isPoolMember) || "—") : "⏳ No Sheet"));
    subEl.textContent = "Sheet Spread: " + g.poolLine + " • Live Vegas: " + g.liveLine + " • " + actMetaTh.shortName + " Pick: " + actPickTh + (cmpTargetTh ? (" • " + cmpTargetTh.shortName + " Pick: " + cmpPickTh) : "");
  }

  var pbpCache = SUMMARY_PBP_CACHE[g.id];
  var driveOptionsHtml = "";
  if (pbpCache && pbpCache.allDrives && pbpCache.allDrives.length > 0) {
    driveOptionsHtml = '<select class="search-input" style="max-width:340px;padding:5px 9px;font-size:0.76rem;font-weight:700;" onchange="setGameDriveViewMode(' + g.id + ', this.value)">';
    driveOptionsHtml += '<option value="final" ' + (tel.activeMode === "final" ? "selected" : "") + '>🏁 Final Drive (Drive #' + pbpCache.finalDrive.driveIndex + ' — ' + pbpCache.finalDrive.teamCode + ' ' + pbpCache.finalDrive.result + ')</option>';
    if (pbpCache.lastScoringDrive) {
      driveOptionsHtml += '<option value="scoring" ' + (tel.activeMode === "scoring" ? "selected" : "") + '>🔥 Last Scoring Drive (Drive #' + pbpCache.lastScoringDrive.driveIndex + ' — ' + pbpCache.lastScoringDrive.teamCode + ' ' + pbpCache.lastScoringDrive.result + ')</option>';
    }
    for (var d = pbpCache.allDrives.length - 1; d >= 0; d--) {
      var drvItem = pbpCache.allDrives[d];
      var valKey = "drive_" + drvItem.driveIndex;
      driveOptionsHtml += '<option value="' + valKey + '" ' + (tel.activeMode === valKey ? "selected" : "") + '>Drive #' + drvItem.driveIndex + ': ' + drvItem.teamCode + ' (' + drvItem.description + ' — ' + drvItem.result + ')</option>';
    }
    driveOptionsHtml += '<option value="demo" ' + (tel.activeMode === "demo" ? "selected" : "") + '>🎮 Interactive Demo Simulator</option>';
    driveOptionsHtml += '</select>';
  }

  var modeBtnsHtml = '<div class="field-mode-pills">';
  if (ls && ls.completed) {
    modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "final" ? "active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'final\', event)">🏁 Final Drive</button>';
    modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "scoring" ? "active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'scoring\', event)">🔥 Last Scoring Drive</button>';
  }
  modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "demo" ? "demo-active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'demo\', event)">🎮 Interactive Demo Sim</button>';
  modeBtnsHtml += '</div>';

  var demoSimBar = "";
  if (tel.bannerType === "demo") {
    demoSimBar =
      '<div class="demo-sim-controls" style="margin-bottom:12px;padding:10px 12px;">' +
        '<span style="font-size:0.82rem;font-weight:800;color:#6ee7b7;">🎮 Live Animation Test Controls:</span>' +
        '<div class="demo-btn-group" style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="demo-sim-btn primary" style="padding:6px 12px;font-size:0.78rem;" onclick="simulateNextDemoPlay(' + g.id + ', \'next\', event)">▶ Simulate Next Play</button>' +
          '<button class="demo-sim-btn" style="padding:6px 12px;font-size:0.78rem;" onclick="toggleDemoAutoLoop(' + g.id + ', event)">' + (DEMO_AUTO_TIMER ? '⏸ Stop Auto-Sim' : '⚡ Auto-Play Drive (Every 2.4s)') + '</button>' +
          '<button class="demo-sim-btn" style="padding:6px 12px;font-size:0.78rem;" onclick="simulateNextDemoPlay(' + g.id + ', \'redzone\', event)">🚨 Jump to Red Zone</button>' +
          '<button class="demo-sim-btn" style="padding:6px 12px;font-size:0.78rem;" onclick="simulateNextDemoPlay(' + g.id + ', \'bigplay\', event)">💣 Trigger TD Play</button>' +
          '<button class="demo-sim-btn" style="padding:6px 12px;font-size:0.78rem;" onclick="simulateNextDemoPlay(' + g.id + ', \'reset\', event)">🔄 Flip Possession / New Drive</button>' +
        '</div>' +
      '</div>';
  }

  var possTeam = tel.possessionSide === "away" ? g.away : g.home;

  bodyEl.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">' +
      modeBtnsHtml +
      driveOptionsHtml +
    '</div>' +
    demoSimBar +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:12px;">' +
      '<div class="metric-card"><div class="metric-label">Possession Team</div><div class="metric-val" style="color:#facc15;font-size:1.05rem;">🏈 ' + possTeam + '</div><div class="metric-sub">' + tel.driveResult + '</div></div>' +
      '<div class="metric-card"><div class="metric-label">Ball Location</div><div class="metric-val" style="color:#38bdf8;font-size:1.05rem;">' + tel.possessionText + '</div><div class="metric-sub">Started at ' + formatYl100ToSpotText(tel.startYl100, g) + '</div></div>' +
      '<div class="metric-card"><div class="metric-label">Situation / Result</div><div class="metric-val" style="color:#fff;font-size:1.0rem;">' + (tel.downDistanceText || tel.driveResult) + '</div><div class="metric-sub">' + (tel.clockStr || '') + '</div></div>' +
      '<div class="metric-card"><div class="metric-label">Drive Summary</div><div class="metric-val" style="color:#34d399;font-size:1.0rem;">' + tel.driveDesc.split("•")[0] + '</div><div class="metric-sub">' + (tel.driveDesc.split("•")[1] || 'ESPN Drive Log') + '</div></div>' +
    '</div>' +
    '<div class="field-svg-wrap" style="margin-bottom:12px;border:2px solid #38bdf866;border-radius:10px;">' +
      buildFieldSvgMarkup(g, tel, 255, true) +
    '</div>' +
    '<div style="font-size:0.82rem;font-weight:800;color:#fff;margin-bottom:6px;">📋 Drive Play-by-Play Timeline (Most Recent First):</div>' +
    '<div class="pbp-timeline" style="gap:7px;">' + buildPlaysListHtml(tel, g, ls) + '</div>';
}

