// ============================================================================
// CONDENSED TABLE WITH MICHAEL, KINYION, WATCHLIST RIVALS & AUTO-GRADING
// ============================================================================
var condensedLayoutOverride = null; // null = auto (cards <= 768px, table > 768px), 'cards', or 'table'
var condensedShowAllProfiles = false; // false = clean 2-Way Compare (Active vs Compare Target); true = All Profiles

function setCondensedLayoutMode(mode) {
  condensedLayoutOverride = mode;
  syncCondensedLayoutModeUI();
}

function toggleCondensedShowAllProfiles() {
  condensedShowAllProfiles = !condensedShowAllProfiles;
  var btn = document.getElementById("btn-cond-col-scope");
  if (btn) {
    btn.textContent = condensedShowAllProfiles ? "👥 All Profiles" : "⚔️ 2-Way Compare";
    btn.className = "cond-mode-pill active";
  }
  renderCondensedTable();
}

function syncCondensedLayoutModeUI() {
  var wrap = document.getElementById("condensed-view-container");
  var btnCards = document.getElementById("btn-cond-layout-cards");
  var btnTable = document.getElementById("btn-cond-layout-table");
  var btnScope = document.getElementById("btn-cond-col-scope");
  if (!wrap) return;

  var isMobileViewport = (typeof window !== "undefined" && window.innerWidth <= 768);
  var effectiveMode = condensedLayoutOverride || (isMobileViewport ? "cards" : "table");

  wrap.classList.remove("force-mobile-cards", "force-desktop-table");
  if (effectiveMode === "cards") {
    wrap.classList.add("force-mobile-cards");
  } else {
    wrap.classList.add("force-desktop-table");
  }

  if (btnCards) btnCards.className = "cond-mode-pill" + (effectiveMode === "cards" ? " active" : "");
  if (btnTable) btnTable.className = "cond-mode-pill" + (effectiveMode === "table" ? " active" : "");
  if (btnScope) btnScope.textContent = condensedShowAllProfiles ? "👥 All Profiles" : "⚔️ 2-Way Compare";
}

function renderCondensedTable() {
  ensureWatchlistDefaults();
  ensureMultiUserAndPrivacyState();
  syncCondensedLayoutModeUI();
  var tbody = document.getElementById("condensed-tbody");
  var theadRow = document.getElementById("condensed-thead-row");
  var mobileList = document.getElementById("condensed-mobile-list");
  if (!tbody) return;
  var diffOnly = document.getElementById("chk-cond-diff-only") && document.getElementById("chk-cond-diff-only").checked;

  var allProfs = getAllUserProfiles();
  var actMeta = getProfileMetaByKey(activeProfile);
  var cmpTarget = resolveCompareTargetDescriptor();

  // Decide which user profiles to display as columns:
  // By default (condensedShowAllProfiles === false), show ONLY Active Profile + Compare Target (if it's a user profile)
  var displayProfs = [];
  if (condensedShowAllProfiles) {
    displayProfs = allProfs;
  } else {
    displayProfs.push(actMeta);
    if (cmpTarget && !cmpTarget.isPoolMember && cmpTarget.key !== actMeta.key) {
      displayProfs.push(getProfileMetaByKey(cmpTarget.key));
    }
  }

  if (theadRow) {
    var thHtml = '<th>#</th><th>Matchup (CST)</th><th>Sheet Line</th>';
    for (var pIdx = 0; pIdx < displayProfs.length; pIdx++) {
      var pf = displayProfs[pIdx];
      var isLockedHdr = isProfileHiddenFromViewer(pf.key, null);
      thHtml += '<th>' + pf.icon + ' ' + pf.shortName + (isLockedHdr ? ' 🔒' : '') + '</th>';
    }
    if (cmpTarget && cmpTarget.isPoolMember) {
      thHtml += '<th style="color:var(--warn);">🏆 ' + cmpTarget.shortName + ' (Compare)</th>';
    }
    thHtml += '<th>👀 Watchlist Rivals (Tap to Set)</th><th>Status / Grade / Swing</th>';
    theadRow.innerHTML = thHtml;
  }

  var html = "";
  var mobileHtml = "";
  var actHiddenGlobal = isProfileHiddenFromViewer(activeProfile, null);
  var cmpHiddenGlobal = cmpTarget ? cmpTarget.isHiddenForGame(null) : false;

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var actHidden = isProfileHiddenFromViewer(activeProfile, g.id);
    var cmpHidden = cmpTarget ? cmpTarget.isHiddenForGame(g.id) : false;
    var anyPairHidden = actHidden || cmpHidden;

    var mPick = getResolvedPickForGame(state[activeProfile].picks, g, true);
    var kPick = (cmpTarget && cmpTarget.hasPicks) ? getResolvedPickForGame(cmpTarget.picks, g, !cmpTarget.isPoolMember) : null;
    var isDiff = (anyPairHidden || !kPick) ? false : !isSameTeamPick(mPick, kPick, g);
    if (diffOnly && !isDiff) continue;

    var mPts = isSameTeamPick(mPick, g.away, g) ? g.awayPts : g.homePts;
    var kPts = isSameTeamPick(kPick, g.away, g) ? g.awayPts : g.homePts;
    var swingPts = isDiff ? (mPts + kPts) : 0;

    var ls = LIVE_SCORES[g.id];
    var liveStr = ls && (ls.inProgress || ls.completed)
      ? (' <span style="color:var(--win);font-weight:800;">[' + ls.awayScore + '-' + ls.homeScore + (ls.completed ? ' F' : '') + ']</span>')
      : "";

    var wlBtns = "";
    for (var w = 0; w < state.watchlist.length; w++) {
      var rv = state.watchlist[w];
      var rPick = getResolvedPickForGame(rv.picks, g, false);
      var rCode = rPick ? (isSameTeamPick(rPick, g.away, g) ? g.awayCode : g.homeCode) : "—";
      var btnCls = rPick ? "cond-btn w-active" : "cond-btn";
      wlBtns += '<button type="button" class="' + btnCls + '" title="Tap to cycle ' + rv.name + '\'s pick (Away → Home → Clear)" onclick="toggleWatchlistPick(' + w + ', ' + g.id + ')">' +
        rv.name.slice(0, 6) + ': ' + rCode +
      '</button>';
    }

    var statusHtml = anyPairHidden
      ? '<span class="swing-pill swing-agree">🔒 Locked</span>'
      : (!mPick
          ? '<span class="swing-pill swing-agree">— No Pick</span>'
          : (isDiff
              ? '<span class="swing-pill swing-diff">⚔️ ' + swingPts + 'pt Swing</span>'
              : '<span class="swing-pill swing-agree">✓ Both: ' + String(mPick).slice(0, 8) + '</span>'));

    if (ls && ls.completed) {
      var winner = ls.awayScore > ls.homeScore ? g.away : (ls.homeScore > ls.awayScore ? g.home : null);
      if (winner && !anyPairHidden && kPick) {
        var mWon = isSameTeamPick(mPick, winner, g);
        var kWon = isSameTeamPick(kPick, winner, g);
        statusHtml += ' <span class="badge ' + (mWon ? 'badge-ev' : 'badge-3x') + '">' + actMeta.shortName.slice(0, 2) + ':' + (mWon ? '+' + mPts : '0') + '</span>' +
                      ' <span class="badge ' + (kWon ? 'badge-ev' : 'badge-3x') + '">' + cmpTarget.shortName.slice(0, 2) + ':' + (kWon ? '+' + kPts : '0') + '</span>';
      }
    }

    var profTdsHtml = "";
    var profMobileBoxesHtml = "";
    for (var u = 0; u < displayProfs.length; u++) {
      var uMeta = displayProfs[u];
      var isEditableMine = isMyOwnInstanceProfile(uMeta.key);
      var uHidden = isProfileHiddenFromViewer(uMeta.key, g.id);
      var uPick = (state[uMeta.key] && state[uMeta.key].picks) ? getResolvedPickForGame(state[uMeta.key].picks, g, false) : null;
      var uPts = uPick ? (isSameTeamPick(uPick, g.away, g) ? g.awayPts : g.homePts) : 0;
      var uCode = uPick ? (isSameTeamPick(uPick, g.away, g) ? g.awayCode : g.homeCode) : "—";

      if (uHidden) {
        profTdsHtml += '<td><span class="cond-locked-pill" style="cursor:default;opacity:0.85;" title="Hidden on ' + uMeta.name + '\'s account until kickoff">🔒 Hidden Until Kickoff</span></td>';
        profMobileBoxesHtml += '<div class="cond-m-prof-box">' +
          '<div class="cond-m-prof-label" style="color:' + uMeta.color + ';"><span>⚔️ ' + uMeta.shortName + '</span><span>🔒</span></div>' +
          '<div style="text-align:center;font-weight:800;font-size:0.68rem;color:var(--loss);padding:4px 0;">🔒 Hidden Pre-Kickoff</div>' +
        '</div>';
      } else if (!isEditableMine) {
        // Read-only display for compared user profile — you cannot click to edit another user's picks!
        profTdsHtml += '<td><span class="badge ' + (uPts === 3 ? 'badge-3x' : (uPts === 2 ? 'badge-2x' : 'badge-1x')) + '" style="font-size:0.72rem;padding:4px 8px;">⚔️ ' + uCode + ' (' + uPts + 'x)</span></td>';
        profMobileBoxesHtml += '<div class="cond-m-prof-box" style="border-color:var(--border);">' +
          '<div class="cond-m-prof-label" style="color:' + uMeta.color + ';"><span>⚔️ ' + uMeta.shortName + ' (Read-Only)</span><span>' + uPts + 'x</span></div>' +
          '<div style="text-align:center;font-weight:800;font-size:0.74rem;color:var(--text);padding:4px 0;">' + uCode + ' (' + uPts + 'x)</div>' +
        '</div>';
      } else {
        profTdsHtml += '<td>' +
          '<div class="cond-pick-group">' +
            '<button type="button" class="cond-btn ' + (isSameTeamPick(uPick, g.away, g) ? uMeta.btnClass : '') + '" onclick="pickSideForProfile(\'' + uMeta.key + '\', ' + g.id + ', 1)">' + g.awayCode + '</button>' +
            '<button type="button" class="cond-btn ' + (isSameTeamPick(uPick, g.home, g) ? uMeta.btnClass : '') + '" onclick="pickSideForProfile(\'' + uMeta.key + '\', ' + g.id + ', 2)">' + g.homeCode + '</button>' +
          '</div>' +
        '</td>';
        profMobileBoxesHtml += '<div class="cond-m-prof-box">' +
          '<div class="cond-m-prof-label" style="color:' + uMeta.color + ';"><span>🏈 ' + uMeta.shortName + ' (You)</span><span>' + uPts + 'x</span></div>' +
          '<div class="cond-m-btn-pair">' +
            '<button type="button" class="cond-btn ' + (isSameTeamPick(uPick, g.away, g) ? uMeta.btnClass : '') + '" onclick="pickSideForProfile(\'' + uMeta.key + '\', ' + g.id + ', 1)">' + g.awayCode + '</button>' +
            '<button type="button" class="cond-btn ' + (isSameTeamPick(uPick, g.home, g) ? uMeta.btnClass : '') + '" onclick="pickSideForProfile(\'' + uMeta.key + '\', ' + g.id + ', 2)">' + g.homeCode + '</button>' +
          '</div>' +
        '</div>';
      }
    }
    if (cmpTarget && cmpTarget.isPoolMember) {
      var pmPick = cmpTarget.hasPicks ? getResolvedPickForGame(cmpTarget.picks, g, false) : null;
      var pmCode = pmPick ? (isSameTeamPick(pmPick, g.away, g) ? g.awayCode : g.homeCode) : "⏳ No Sheet";
      var pmPts = pmPick ? (isSameTeamPick(pmPick, g.away, g) ? g.awayPts : g.homePts) : 1;
      profTdsHtml += '<td><span class="badge badge-2x" style="font-size:0.7rem;">🏆 ' + pmCode + (pmPick ? ' (' + pmPts + 'x)' : '') + '</span></td>';
      profMobileBoxesHtml += '<div class="cond-m-prof-box" style="border-color:var(--border);">' +
        '<div class="cond-m-prof-label" style="color:var(--warn);"><span>🏆 ' + cmpTarget.shortName + '</span><span>' + (pmPick ? pmPts + 'x' : '⏳') + '</span></div>' +
        '<div style="text-align:center;font-weight:800;font-size:0.72rem;color:var(--warn);padding:4px 0;">' + pmCode + '</div>' +
      '</div>';
    }

    html += '<tr class="' + (isDiff ? 'diff-row' : '') + '">' +
      '<td><strong>#' + g.id + '</strong></td>' +
      '<td><strong>' + g.away + '</strong> <span style="color:var(--muted);">(' + g.awayPts + 'x)</span> at <strong>' + g.home + '</strong> <span style="color:var(--muted);">(' + g.homePts + 'x)</span>' + liveStr + '</td>' +
      '<td style="color:var(--muted);"><div>' + g.poolLine + '</div><div style="font-size:0.65rem;color:var(--text);">👥 ' + g.awayCode + ' ' + getGamePoolOwnership(g).awayPct + '% / ' + g.homeCode + ' ' + getGamePoolOwnership(g).homePct + '%</div></td>' +
      profTdsHtml +
      '<td><div class="cond-pick-group" style="flex-wrap:wrap;">' + wlBtns + '</div></td>' +
      '<td>' + statusHtml + '</td>' +
    '</tr>';

    var maxPts = Math.max(g.awayPts, g.homePts);
    var multCardCls = maxPts === 3 ? " mult-3x-card" : (maxPts === 2 ? " mult-2x-card" : "");
    var aBadge = g.awayPts > 1 ? (' <span style="color:var(--amber);font-weight:900;">(' + g.awayPts + 'x)</span>') : '';
    var hBadge = g.homePts > 1 ? (' <span style="color:var(--amber);font-weight:900;">(' + g.homePts + 'x)</span>') : '';
    var gridColsClass = (!condensedShowAllProfiles && displayProfs.length + (cmpTarget && cmpTarget.isPoolMember ? 1 : 0) <= 2) ? "cond-m-profiles-grid two-col-grid" : "cond-m-profiles-grid";

    mobileHtml += '<div class="cond-m-card' + (isDiff ? ' diff-card' : '') + multCardCls + '">' +
      '<div class="cond-m-header">' +
        '<div class="cond-m-title">' +
          '<span class="cond-m-num">#' + g.id + '</span>' +
          '<span>' + g.away + aBadge + ' <span style="color:var(--muted);font-weight:600;">at</span> ' + g.home + hBadge + '</span>' +
          liveStr +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">' +
          '<span class="cond-m-line-pill">' + g.poolLine + ' • 👥 ' + getGamePoolOwnership(g).awayPct + '%/' + getGamePoolOwnership(g).homePct + '%</span>' +
          statusHtml +
        '</div>' +
      '</div>' +
      '<div class="' + gridColsClass + '">' +
        profMobileBoxesHtml +
      '</div>' +
      '<div class="cond-m-rivals-row">' +
        '<span class="cond-m-rivals-label">👀 Rivals (Tap):</span>' +
        '<div class="cond-m-rivals-btns">' + wlBtns + '</div>' +
      '</div>' +
    '</div>';
  }
  var emptyMsg = (actHiddenGlobal || cmpHiddenGlobal)
    ? "🔒 Head-to-Head Differences are hidden while one of the compared profiles is locked."
    : "No Head-to-Head Differences found between " + actMeta.name + " and " + (cmpTarget ? cmpTarget.name : "Rival") + ".";
  tbody.innerHTML = html || ('<tr><td colspan="' + (displayProfs.length + 5) + '" style="text-align:center;padding:14px;color:var(--muted);">' + emptyMsg + '</td></tr>');
  if (mobileList) {
    mobileList.innerHTML = mobileHtml || ('<div class="side-box" style="text-align:center;color:var(--muted);">' + emptyMsg + '</div>');
  }
}

function printCheckmarkSheet() {
  if (isProfileHiddenFromViewer(activeProfile, null)) {
    unlockProfileWithPrompt(activeProfile, function() { printCheckmarkSheet(); });
    return;
  }
  var profName = getProfileMetaByKey(activeProfile).name;
  var picks = state[activeProfile].picks;
  var rowsHtml = "";
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var p = getResolvedPickForGame(picks, g, true);
    var leftChecked = isSameTeamPick(p, g.away, g);
    var rightChecked = isSameTeamPick(p, g.home, g);
    rowsHtml += '<tr>' +
      '<td><strong>#' + g.id + '</strong></td>' +
      '<td class="' + (leftChecked ? 'print-checked' : '') + '">' + (leftChecked ? '☑ ' : '☐ ') + g.awayCode + ' — ' + g.away + ' (' + g.awayPts + ' pt)</td>' +
      '<td class="' + (rightChecked ? 'print-checked' : '') + '">' + (rightChecked ? '☑ ' : '☐ ') + g.homeCode + ' — ' + g.home + ' (' + g.homePts + ' pt)</td>' +
      '<td>' + g.poolLine + '</td>' +
    '</tr>';
  }
  var printEl = document.getElementById("print-sheet-area");
  printEl.innerHTML =
    '<h2>Separated at Turf — ' + (state.weekLabel || 'Week 8') + ' Official 2-Column Checkmark Sheet</h2>' +
    '<p><strong>Player:</strong> ' + profName + ' &nbsp;|&nbsp; <strong>Tie-Breaker (Highest Score First):</strong> ' + state[activeProfile].tiebreaker + '</p>' +
    '<table class="print-table">' +
      '<thead><tr><th>Row #</th><th>LEFT COLUMN (Away Team)</th><th>RIGHT COLUMN (Home Team)</th><th>Locked Sheet Line</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
    '</table>';
  window.print();
}

function updateTargetSlider(val) {
  state[activeProfile].target = parseInt(val, 10);
  saveCurrentState(activeProfile);
  updateScoreboard();
}

function getTeamLog(team) {
  if (TEAM_LOGS[team]) return TEAM_LOGS[team];
  return {
    rec: "2026 FBS",
    l5: [
      { wk: "2026", wl: "W", loc: "vs", opp: "Click Sync ESPN", score: "--" }
    ]
  };
}

function renderInsightsPanel(g) {
  var ins = g.insights || {
    vegas: "Sheet Spread: " + g.poolLine + " | Live Vegas: " + g.liveLine,
    stats: g.away + " vs " + g.home + " key player stat lines.",
    matchup: "Positional trench matchup favoring " + g.rec + ".",
    splits: g.kick + " situational splits."
  };
  return '<div id="ins-' + g.id + '" class="insights-grid ' + (showAllIns ? '' : 'hidden') + '">' +
    '<div class="insight-pillar"><div class="pillar-title">📈 Vegas & Implied Win Math</div><div class="pillar-body">' + ins.vegas + '</div></div>' +
    '<div class="insight-pillar"><div class="pillar-title">🔥 Key Player Stat Lines</div><div class="pillar-body">' + ins.stats + '</div></div>' +
    '<div class="insight-pillar"><div class="pillar-title">⚔️ Positional & Trench Matchup</div><div class="pillar-body">' + ins.matchup + '</div></div>' +
    '<div class="insight-pillar"><div class="pillar-title">🏟️ Situational & Home/Away Splits</div><div class="pillar-body">' + ins.splits + '</div></div>' +
    '</div>';
}

function renderL5Column(teamName, sheetRec, commonMap) {
  var data = getTeamLog(teamName);
  var rows = "";
  for (var i = 0; i < data.l5.length; i++) {
    var item = data.l5[i];
    var normOpp = normalizeTeamKey(item.opp);
    var isCommon = commonMap && normOpp && commonMap[normOpp];
    var displayOpp = formatOppWithRank(item.opp, item.oppRank);
    rows += '<tr class="' + (isCommon ? 'common-opp-row' : '') + '">' +
      '<td style="color:var(--muted);">' + item.wk + '</td>' +
      '<td><span class="wl-badge wl-' + item.wl + '">' + item.wl + '</span></td>' +
      '<td>' + item.loc + ' <button class="opp-link-btn" data-opp="' + item.opp + '" onmouseenter="showOppTooltip(event, this.getAttribute(\'data-opp\'))" onmouseleave="hideOppTooltip()" onclick="openOppModal(this.getAttribute(\'data-opp\'))">' + displayOpp + '</button>' +
      (isCommon ? '<span class="common-star">★ Common</span>' : '') +
      '</td>' +
      '<td style="text-align:right;font-weight:700;">' + item.score + '</td></tr>';
  }
  return '<div><div class="sub-col-title"><span>' + teamName + ' (' + (sheetRec || data.rec) + ')</span><span style="font-size:0.64rem;color:var(--muted);">Tap Opp</span></div><table class="l5-table">' + rows + '</table></div>';
}

async function showOppTooltip(ev, teamName) {
  if (window.innerWidth <= 640) return;
  var tt = document.getElementById("opp-tooltip");
  if (!TEAM_LOGS[teamName] && ESPN_TEAM_MAP[teamName.toLowerCase()]) {
    await fetchAndStoreSingleTeamSchedule(teamName, ESPN_TEAM_MAP[teamName.toLowerCase()]);
  }
  var data = getTeamLog(teamName);
  var rows = "";
  for (var i = 0; i < data.l5.length; i++) {
    var r = data.l5[i];
    var dispOpp = formatOppWithRank(r.opp, r.oppRank);
    rows += '<div style="margin:2px 0;"><span class="wl-badge wl-' + r.wl + '">' + r.wl + '</span> ' + r.wk + ': ' + r.loc + ' ' + dispOpp + ' (<strong>' + r.score + '</strong>)</div>';
  }
  var headerName = formatOppWithRank(teamName);
  tt.innerHTML = '<div style="font-weight:800;color:var(--text);margin-bottom:4px;border-bottom:1px solid var(--border);padding-bottom:3px;">' + headerName + ' (' + data.rec + ') — Last 5 Games</div>' + rows;
  tt.style.display = "block";
  tt.style.left = Math.min(window.innerWidth - 315, ev.clientX + 14) + "px";
  tt.style.top = Math.min(window.innerHeight - 190, ev.clientY + 14) + "px";
}

function hideOppTooltip() {
  document.getElementById("opp-tooltip").style.display = "none";
}

async function openOppModal(teamName) {
  hideOppTooltip();
  if (!TEAM_LOGS[teamName] && ESPN_TEAM_MAP[teamName.toLowerCase()]) {
    await fetchAndStoreSingleTeamSchedule(teamName, ESPN_TEAM_MAP[teamName.toLowerCase()]);
  }
  var data = getTeamLog(teamName);
  var headerName = formatOppWithRank(teamName);
  document.getElementById("modal-team-title").textContent = headerName + " (" + data.rec + ") — 2026 Last 5 Games";
  var rows = "";
  for (var i = 0; i < data.l5.length; i++) {
    var r = data.l5[i];
    var dispOpp = formatOppWithRank(r.opp, r.oppRank);
    rows += '<tr><td>' + r.wk + '</td><td><span class="wl-badge wl-' + r.wl + '">' + r.wl + '</span></td>' +
      '<td>' + r.loc + ' <button class="opp-link-btn" data-opp="' + r.opp + '" onclick="openOppModal(this.getAttribute(\'data-opp\'))">' + dispOpp + '</button></td>' +
      '<td style="text-align:right;font-weight:700;">' + r.score + '</td></tr>';
  }
  document.getElementById("modal-team-body").innerHTML = '<table class="l5-table">' + rows + '</table>';
  document.getElementById("opp-modal-backdrop").style.display = "flex";
}

function renderInjColumn(teamName, list) {
  var items = "";
  if (list && Array.isArray(list) && list.length > 0) {
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      var stCode = it.st || "FULL";
      var stClass = "st-" + stCode;
      var stLabel = stCode === "FULL" ? "ACTIVE" : stCode;
      var pName = it.p || (teamName + " Roster");
      var pPos = it.pos ? (" (" + it.pos + ")") : "";
      var pNote = it.note || "Active on Availability Report";
      items += '<div class="inj-item"><span class="inj-status ' + stClass + '">' + stLabel + '</span><strong>' + pName + '</strong>' + pPos + ' — <span style="color:var(--muted);">' + pNote + '</span></div>';
    }
  }
  if (!items) {
    items = '<div style="font-size:0.75rem;color:var(--muted);padding:4px 0;">No active injury concerns or player outs reported.</div>';
  }
  return '<div><div class="sub-col-title"><span>🚑 ' + teamName + ' Availability</span></div>' + items + '</div>';
}

