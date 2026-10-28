// ============================================================================
// PICKS SCREEN UI: page head, clean pick cards, Quick picks / options menus,
// search toggle and the game detail sheet.
// Visual layer only. Picking still goes through pickSide(); saving, grading and
// sync are untouched.
// ============================================================================
var DETAIL_SHEET_GAME_ID = null;
var _detailSheetReturnFocus = null;

// ---------- Small helpers ----------
function parseKickParts(kick) {
  // "Saturday, 10/31 - 11:00 AM ESPN2" -> { day: "Sat", time: "11:00 AM", net: "ESPN2" }
  var str = String(kick || "");
  var m = str.match(/^\s*([A-Za-z]+)[^0-9]*[\d/]*\s*-?\s*(\d{1,2}:\d{2}\s*[AP]M)\s*(.*)$/i);
  if (!m) return { day: "", time: str, net: "" };
  return { day: m[1].slice(0, 3), time: m[2].toUpperCase(), net: (m[3] || "").replace(/\bCST\b|\bCDT\b|\bCT\b/g, "").trim() };
}

function parseTeamRecord(rec) {
  // "#22 • 6-1" -> { rank: "22", record: "6-1" }
  var str = String(rec || "");
  var rank = (str.match(/#\s*(\d+)/) || [])[1] || "";
  var record = (str.match(/(\d+-\d+)/) || [])[1] || "";
  return { rank: rank, record: record };
}

function spreadForTeam(g, teamName) {
  // Returns "−3.5" for the favorite, "" for the underdog (as in the design), from the locked Monday line.
  var line = String(g.mondayPoolLine || g.poolLine || "");
  var m = line.match(/^(.*?)\s*([-+]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return "";
  var favName = m[1].trim();
  var num = Math.abs(parseFloat(m[2]));
  if (!favName || isNaN(num) || num === 0) return num === 0 ? "PK" : "";
  return isSameTeamPick(favName, teamName, g) ? ("−" + num) : "";
}

function teamShortCode(g, isAway, espnId) {
  var info = espnId && ESPN_TEAM_INFO[espnId];
  if (info && info.abbr) return info.abbr;
  var code = isAway ? (g.awayCode || g.away) : (g.homeCode || g.home);
  return String(code || "").replace(/[^A-Za-z&]/g, "").slice(0, 4).toUpperCase();
}

function teamLogoHtml(g, isAway) {
  var name = isAway ? g.away : g.home;
  var espnId = null;
  try { espnId = lookupEspnTeamId(name, g, isAway); } catch (e) {}
  var info = espnId && ESPN_TEAM_INFO[espnId];
  var code = escapeShellHtml(teamShortCode(g, isAway, espnId));
  var bg = (info && info.color) ? (' style="--team-color:' + info.color + ';"') : '';
  var img = "";
  if (espnId) {
    var variant = getAppTheme() === "light" ? "500" : "500-dark";
    img = '<img src="https://a.espncdn.com/i/teamlogos/ncaa/' + variant + '/' + espnId + '.png" alt="" loading="lazy" onerror="this.remove()" />';
  }
  return '<span class="team-logo' + (info && info.color ? ' has-color' : '') + '"' + bg + ' aria-hidden="true"><span class="team-logo-code">' + code + '</span>' + img + '</span>';
}

function getMyPicksMap() {
  return (state[activeProfile] && state[activeProfile].picks) ? state[activeProfile].picks : {};
}

function initialsFromName(name) {
  var parts = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function gameStatusHtml(g) {
  var ls = LIVE_SCORES[g.id];
  if (ls && ls.completed) {
    return '<span class="game-status">Final · ' + ls.awayScore + '–' + ls.homeScore + '</span>';
  }
  if (ls && ls.inProgress) {
    return '<span class="game-status is-live"><span class="live-dot" aria-hidden="true"></span>' + escapeShellHtml(ls.detail || "Live") + ' · ' + ls.awayScore + '–' + ls.homeScore + '</span>';
  }
  var k = parseKickParts(g.kick);
  return '<span class="game-status">' + escapeShellHtml((k.day ? k.day + " " : "") + k.time) + '</span>';
}

// "Leading" / "Trailing" / "Won" / "Lost" for your pick, from getGameSituation.
var PICK_STATUS_WORDS = { leading: ["Leading", "is-win"], trailing: ["Trailing", "is-loss"], tied: ["Tied", ""], won: ["Won", "is-win"], lost: ["Lost", "is-loss"] };
function pickStatusWordHtml(sit) {
  var w = sit && PICK_STATUS_WORDS[sit.myPickStatus];
  return w ? '<span class="pick-status ' + w[1] + '">' + w[0] + '</span>' : '';
}

// ---------- Pick cards ----------
function teamPickButtonHtml(g, isAway, pickedName, isLocked, ownInfo) {
  var name = isAway ? g.away : g.home;
  var pts = isAway ? (g.mondayAwayPts || g.awayPts || 1) : (g.mondayHomePts || g.homePts || 1);
  var prob = isAway ? getTeamWinProb(g, "away") : getTeamWinProb(g, "home");
  var rec = parseTeamRecord(isAway ? g.awayRec : g.homeRec);
  var spread = spreadForTeam(g, name);
  var subParts = [];
  if (rec.rank) subParts.push("#" + rec.rank);
  if (rec.record) subParts.push(rec.record);
  if (spread) subParts.push(spread);

  // Stats line: the multiplier for everyone (win % lives only in the ESPN bar under the game);
  // EV and leverage in Advanced mode, marked "est." when ESPN has no predictor yet.
  var stats = [];
  if (!SIMPLE_UI_MODE) {
    var estimated = isWinProbEstimated(g);
    var estTip = estimated ? ' title="Estimated from the spread; ESPN data not available yet."' : '';
    stats.push('<span' + estTip + '>EV ' + (prob * pts).toFixed(2) + (estimated ? ' est.' : '') + '</span>');
    var lev = ownInfo ? (isAway ? ownInfo.awayLev : ownInfo.homeLev) : 0;
    if (lev >= 10) stats.push('<span' + estTip + '>+' + lev + '% lev' + (estimated ? ' est.' : '') + '</span>');
  }

  var picked = !!pickedName && isSameTeamPick(pickedName, name, g);
  var inj = countTeamInjuries(isAway ? g.awayInj : g.homeInj);
  var injText = [inj.out ? inj.out + " out" : "", inj.q ? inj.q + " questionable" : ""].filter(Boolean).join(", ");
  var injIcon = injText
    ? '<span class="inj-icon' + (inj.out ? ' is-out' : '') + '" title="Injuries: ' + injText + '"><i data-lucide="bandage"></i></span>'
    : '';
  var label = (picked ? "Picked: " : "Pick ") + name + ", " + pts + "x" + (injText ? ", injuries: " + injText : "");
  return '<button type="button" class="team-pick ' + (isAway ? 'is-away' : 'is-home') + (picked ? ' is-picked' : '') + (isLocked ? ' is-locked' : '') + '"' +
      ' aria-pressed="' + picked + '" aria-label="' + escapeShellHtml(label) + '" onclick="pickSide(' + g.id + ', ' + (isAway ? 1 : 2) + ')">' +
    teamLogoHtml(g, isAway) +
    '<span class="team-pick-text">' +
      '<span class="team-pick-name-row"><span class="team-pick-name">' + escapeShellHtml(name) + '</span>' + injIcon + '</span>' +
      '<span class="team-pick-sub">' + escapeShellHtml(subParts.join(" · ")) + '</span>' +
      '<span class="team-pick-stats"><span class="mult-badge mult-' + pts + '">' + pts + 'x</span>' + stats.join("") + '</span>' +
    '</span>' +
  '</button>';
}

function countTeamInjuries(list) {
  var out = 0, q = 0;
  (list || []).forEach(function(it) {
    if (!it) return;
    if (it.st === "OUT") out++;
    else if (it.st === "QUESTIONABLE") q++;
  });
  return { out: out, q: q };
}

function countInjuryFlags(g) {
  var out = 0, q = 0;
  [g.awayInj, g.homeInj].forEach(function(list) {
    (list || []).forEach(function(it) {
      if (!it) return;
      if (it.st === "OUT") out++;
      else if (it.st === "QUESTIONABLE") q++;
    });
  });
  return { out: out, q: q };
}

// Head-to-head target's pick for one game: { name, text } (respects their privacy settings).
function h2hPickForGame(cmp, g) {
  if (!cmp) return null;
  var hiddenForGame = cmp.isHiddenForGame ? cmp.isHiddenForGame(g.id) : false;
  if (hiddenForGame) return { name: cmp.shortName || cmp.name, text: "Hidden", pick: null };
  var pick = cmp.hasPicks ? getResolvedPickForGame(cmp.picks, g, !cmp.isPoolMember) : null;
  return { name: cmp.shortName || cmp.name, text: pick || "No pick yet", pick: pick };
}

// Same rules as the original research-card filters, plus Missing.
function gamePassesPicksFilter(g, myPick, q, ownInfo, h2h) {
  var aPts = g.mondayAwayPts || g.awayPts || 1;
  var hPts = g.mondayHomePts || g.homePts || 1;
  var maxPts = Math.max(aPts, hPts);
  if (currentFilter === "missing" && myPick) return false;
  if (currentFilter === "2x" && maxPts !== 2) return false;
  if (currentFilter === "3x" && maxPts !== 3) return false;
  if (currentFilter === "inj") {
    var flags = countInjuryFlags(g);
    if (!(g.keyInjHeader || computeKeyInjHeaderFromLists(g)) && flags.out === 0 && flags.q === 0) return false;
  }
  if (currentFilter === "plusev" || currentFilter === "ev") {
    var awayEV = getTeamWinProb(g, "away") * g.awayPts, homeEV = getTeamWinProb(g, "home") * g.homePts;
    var plusEvDog = (g.awayPts > 1 && awayEV >= 0.65) || (g.homePts > 1 && homeEV >= 0.65);
    var tier = String(g.tier || "");
    if (!(plusEvDog || tier.indexOf("Multiplier") !== -1 || tier.indexOf("Sharp") !== -1 || tier.indexOf("Contrarian") !== -1)) return false;
  }
  if (currentFilter === "leverage" && !(ownInfo && ownInfo.isHighLeverage)) return false;
  if (currentFilter === "sway" && !g.sway && !g.cliffTrap) return false;
  if (currentFilter === "diffs") {
    if (!myPick || !h2h || !h2h.pick || isSameTeamPick(myPick, h2h.pick, g)) return false;
  }
  if (q) {
    var l5Opps = getTeamLog(g.away).l5.concat(getTeamLog(g.home).l5).map(function(x) { return x.opp; }).join(" ");
    var hay = (g.away + " " + g.home + " " + g.awayCode + " " + g.homeCode + " " + (g.mondayPoolLine || g.poolLine || "") + " " + l5Opps + " " + (g.rationale || "") + " " +
      (g.awayInj || []).map(function(x) { return (x.p || "") + " " + (x.note || ""); }).join(" ") + " " +
      (g.homeInj || []).map(function(x) { return (x.p || "") + " " + (x.note || ""); }).join(" ")).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

function renderPickCardsHtml() {
  ensureMondayLockedOddsOnGames();
  var qEl = document.getElementById("team-search");
  var q = (qEl ? qEl.value : "").trim().toLowerCase();
  var picks = getMyPicksMap();
  var hidden = isProfileHiddenFromViewer(activeProfile, null);
  var userLocked = isCurrentProfileManuallyLocked();
  var cmp = null;
  try { cmp = resolveCompareTargetDescriptor(); } catch (e) {}
  var openPanels = (SIMPLE_CARD_LAYOUT_STYLE === "detailed");
  var html = "";

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var myPick = hidden ? null : getResolvedPickForGame(picks, g, false);
    var ownInfo = null;
    try { ownInfo = getGamePoolOwnership(g); } catch (e1) {}
    var h2h = h2hPickForGame(cmp, g);
    if (!gamePassesPicksFilter(g, myPick, q, ownInfo, h2h)) continue;

    var commishLocked = isGameLockedByCommissioner(g.id);
    var locked = commishLocked || userLocked;
    var k = parseKickParts(g.kick);
    var matchup = g.away + " at " + g.home;
    var commonMap = getCommonOpponentsMap(g.away, g.home);
    var commonCount = Object.keys(commonMap).length;
    var ls = LIVE_SCORES[g.id];

    // Pool split + head-to-head, always visible.
    var infoParts = [];
    // Pool split stays hidden until the game locks (Friday 9 PM CT by default).
    var showPoolSplit = commishLocked && ownInfo && ownInfo.total;
    if (showPoolSplit) {
      infoParts.push('<span class="card-info-item"><span class="card-info-label">Pool</span> ' +
        escapeShellHtml(g.awayCode) + ' ' + ownInfo.awayPct + '% · ' + escapeShellHtml(g.homeCode) + ' ' + ownInfo.homePct + '%</span>');
    }
    // Head-to-head is an Advanced feature, and only with a chosen target (h2h is null without one).
    if (h2h && !SIMPLE_UI_MODE) {
      var isDiff = !!(myPick && h2h.pick && !isSameTeamPick(myPick, h2h.pick, g));
      infoParts.push('<span class="card-info-item"><span class="card-info-label">' + escapeShellHtml(h2h.name) + '</span> ' + escapeShellHtml(h2h.text) +
        (isDiff ? ' <span class="diff-tag">Diff</span>' : '') + '</span>');
    }
    var poolBar = showPoolSplit
      ? '<div class="pool-bar" aria-hidden="true"><span style="width:' + ownInfo.awayPct + '%"></span></div>'
      : '';

    // Advanced-only flags on the meta row.
    var advFlags = "";
    if (!SIMPLE_UI_MODE) {
      if (g.sway) advFlags += '<span class="card-flag">Sway</span>';
      if (g.cliffTrap) advFlags += '<span class="card-flag">Trap</span>';
      if (ownInfo && ownInfo.isHighLeverage) advFlags += '<span class="card-flag">Leverage ' + escapeShellHtml(ownInfo.bestLevCode) + '</span>';
    }

    var fieldHtml = "";
    if (!SIMPLE_UI_MODE && ((ls && (ls.inProgress || ls.completed)) || DEMO_FIELD_PREVIEW)) {
      try { fieldHtml = '<div class="card-field">' + renderInteractiveFieldTrackerHtml(g, ls || null) + '</div>'; } catch (e2) {}
    }

    html +=
      '<article class="pick-card' + (myPick ? '' : ' is-missing') + '" id="game-card-' + g.id + '" aria-label="' + escapeShellHtml(matchup) + '" onclick="onPickCardClick(event, ' + g.id + ')">' +
        '<button type="button" class="pick-card-meta" onclick="openGameDetail(' + g.id + ')" aria-label="Details for ' + escapeShellHtml(matchup) + '">' +
          gameStatusHtml(g) +
          pickStatusWordHtml(getGameSituation(ls, g, myPick ? picks : null)) +
          '<span class="pick-card-net">' +
            (typeof upsetAlertFor === "function" && upsetAlertFor(g, ownInfo) ? '<span class="card-flag is-alert">Upset alert</span>' : '') +
            advFlags +
            (commishLocked ? '<span class="lock-flag"><i data-lucide="lock"></i>Locked</span>' : '') +
            escapeShellHtml(k.net) + '<i data-lucide="chevron-right"></i>' +
          '</span>' +
        '</button>' +
        '<div class="pick-card-teams">' +
          teamPickButtonHtml(g, true, myPick, locked, ownInfo) +
          teamPickButtonHtml(g, false, myPick, locked, ownInfo) +
        '</div>' +
        (typeof matchupCardLineHtml === "function" ? matchupCardLineHtml(g) : '') +
        poolBar +
        (infoParts.length ? '<div class="card-info">' + infoParts.join("") + '</div>' : '') +
        '<div class="pick-card-extras">' +
          '<button type="button" class="link-btn" onclick="toggleCardIdx(' + g.id + ', 2)">Last 5' + (commonCount ? ' · ' + commonCount + ' common' : '') + '</button>' +
          (!SIMPLE_UI_MODE ? '<button type="button" class="link-btn" onclick="toggleCardIdx(' + g.id + ', 1)">Insights</button>' : '') +
        '</div>' +
        '<div id="l5-' + g.id + '" class="dual-panel ' + ((showAllL5 || openPanels) ? '' : 'hidden') + '">' + renderL5Column(g.away, g.awayRec, commonMap) + renderL5Column(g.home, g.homeRec, commonMap) + '</div>' +
        (!SIMPLE_UI_MODE ? renderInsightsPanel(g) : '') +
        fieldHtml +
      '</article>';
  }
  if (!html) {
    html = (currentFilter === "diffs" && !cmp)
      ? compareChooserHtml("Pick someone to see where your picks differ")
      : '<p class="empty-note">' + (currentFilter === "missing" ? "Every game has a pick." : "No games match that filter.") + '</p>';
  }
  return html;
}

// ---------- Page head ----------
function updatePicksHead() {
  var picks = getMyPicksMap();
  var total = GAMES.length;
  var done = countMatchingPicksForSlate(picks, GAMES).matched;
  var complete = total > 0 && done >= total;

  var txt = document.getElementById("picks-progress-text");
  if (txt) txt.innerHTML = '<strong>' + done + '</strong> of ' + total + ' picked';
  var bar = document.getElementById("picks-progress-bar");
  if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
  var wrap = document.getElementById("picks-progress-bar-wrap");
  if (wrap) { wrap.setAttribute("aria-valuemax", total); wrap.setAttribute("aria-valuenow", done); }

  // One main button: "Lock picks" until you lock them, then "Send picks" (opens the official form).
  var sendMode = typeof primaryPicksActionIsSend === "function" && primaryPicksActionIsSend();
  var subLabel = sendMode ? "Send picks" : "Lock picks";
  ["btn-submit-desk", "btn-submit-picks"].forEach(function(id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.textContent = subLabel;
    b.classList.toggle("is-ready", sendMode || complete);
    b.title = sendMode ? "Open the official Separated at Turf form with your picks filled in" : (complete ? "Lock your picks and get a receipt" : done + " of " + total + " picked");
  });

  var lockText = document.getElementById("simple-lock-deadline-pill");
  var eyeLock = document.getElementById("picks-eyebrow-lock");
  if (eyeLock && lockText) eyeLock.textContent = lockText.textContent;
  var eyePhone = document.getElementById("picks-eyebrow");
  if (eyePhone) eyePhone.textContent = (typeof VIEWING_ARCHIVE_KEY !== "undefined" && VIEWING_ARCHIVE_KEY) ? "Past week" : "Separated at Turf";

  var nameEl = document.getElementById("top-profile-name");
  var ini = document.getElementById("top-profile-initials");
  var av = document.getElementById("top-profile-pill");
  var signedIn = isSignedInUser();
  if (ini) {
    if (signedIn && nameEl) ini.textContent = initialsFromName(nameEl.textContent);
    else ini.innerHTML = '<i data-lucide="user-round"></i>';
  }
  if (av) {
    av.classList.toggle("is-guest", !signedIn);
    av.setAttribute("aria-label", signedIn && nameEl ? ("Account: " + nameEl.textContent) : "Guest: sign in or create an account");
  }

  var tbTitle = document.getElementById("tb-card-matchup");
  if (tbTitle) {
    var tbGame = null;
    try { tbGame = resolveTiebreakerGame(); } catch (e) {}
    tbTitle.textContent = tbGame
      ? (tbGame.away + " at " + tbGame.home + " · total points, highest score first (e.g. 28-24)")
      : "Total points, highest score first (e.g. 28-24)";
  }

  var sb = document.getElementById("sandbox-note");
  if (sb) {
    if (activeProfile === "test" && AUTH_SESSION) {
      sb.hidden = false;
      sb.innerHTML = '<span>Sandbox: these picks are only a what-if and are never submitted.</span>' +
        '<button type="button" class="link-btn" onclick="switchProfile(getMyInstanceProfileKey())">Back to my picks</button>';
    } else {
      sb.hidden = true;
      sb.innerHTML = "";
    }
  }

  var lockLbl = document.getElementById("menu-lock-label");
  if (lockLbl) lockLbl.textContent = isCurrentProfileManuallyLocked() ? "Unlock picks" : "Lock picks";

  var weekLbl = state.weekLabel || ("Week " + (state.currentWeek || ""));
  var eyes = document.querySelectorAll(".week-eyebrow");
  for (var e = 0; e < eyes.length; e++) eyes[e].textContent = weekLbl;
}

// ---------- Menus ----------
function closeMenus() {
  var menus = document.querySelectorAll(".menu");
  for (var i = 0; i < menus.length; i++) menus[i].hidden = true;
  var triggers = document.querySelectorAll('[aria-haspopup="true"]');
  for (var j = 0; j < triggers.length; j++) triggers[j].setAttribute("aria-expanded", "false");
}

function toggleMenu(menuId, trigger) {
  var menu = document.getElementById(menuId);
  if (!menu) return;
  var willOpen = menu.hidden;
  closeMenus();
  if (willOpen) {
    menu.hidden = false;
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    var first = menu.querySelector("button");
    if (first) first.focus();
  }
}

document.addEventListener("click", function(ev) {
  if (!ev.target.closest || ev.target.closest(".menu-wrap")) return;
  closeMenus();
});

function togglePicksSearch(force) {
  var row = document.getElementById("picks-search-row");
  var btn = document.getElementById("btn-picks-search");
  if (!row) return;
  var open = (typeof force === "boolean") ? force : row.classList.contains("hidden");
  row.classList.toggle("hidden", !open);
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    var inp = document.getElementById("team-search");
    if (inp) inp.focus();
  }
}

// ---------- Game detail sheet ----------
// A click anywhere on a game card opens its details, except on the card's own controls
// (team pick buttons, links, the Last 5 / Insights panels and the live field).
function onPickCardClick(e, gameId) {
  var t = e && e.target;
  if (t && t.closest && t.closest("button, a, input, select, textarea, label, .dual-panel, .insights-grid, .card-field")) return;
  if (window.getSelection && String(window.getSelection())) return; // selecting text, not clicking
  openGameDetail(gameId);
}

function openGameDetail(gameId) {
  var g = findGameById(gameId);
  var bd = document.getElementById("detail-sheet-backdrop");
  if (!g || !bd) return;
  DETAIL_SHEET_GAME_ID = g.id;
  _detailSheetReturnFocus = document.activeElement;
  renderGameDetailSheet();
  bd.hidden = false;
  document.body.classList.add("sheet-open");
  var closeBtn = document.getElementById("detail-sheet-close");
  if (closeBtn) closeBtn.focus();
}

function closeGameDetail() {
  var bd = document.getElementById("detail-sheet-backdrop");
  if (bd) bd.hidden = true;
  document.body.classList.remove("sheet-open");
  DETAIL_SHEET_GAME_ID = null;
  if (_detailSheetReturnFocus && _detailSheetReturnFocus.focus) _detailSheetReturnFocus.focus();
  _detailSheetReturnFocus = null;
}

function renderGameDetailSheet() {
  if (DETAIL_SHEET_GAME_ID === null) return;
  var g = findGameById(DETAIL_SHEET_GAME_ID);
  var body = document.getElementById("detail-sheet-body");
  var title = document.getElementById("detail-sheet-title");
  if (!g || !body) return;
  var k = parseKickParts(g.kick);
  var picks = getMyPicksMap();
  var hidden = isProfileHiddenFromViewer(activeProfile, null);
  var myPick = hidden ? null : getResolvedPickForGame(picks, g, false);
  var locked = isGameLockedByCommissioner(g.id) || isCurrentProfileManuallyLocked();
  var ls = LIVE_SCORES[g.id];
  var commonMap = getCommonOpponentsMap(g.away, g.home);

  if (title) title.textContent = g.away + " at " + g.home;

  // Head-to-head: your compare target's pick on this game (respects their privacy settings).
  var h2hHtml = "";
  try {
    var cmp = SIMPLE_UI_MODE ? null : resolveCompareTargetDescriptor();
    if (cmp) {
      var cmpHidden = cmp.isHiddenForGame ? cmp.isHiddenForGame(g.id) : false;
      var cmpPick = (!cmpHidden && cmp.hasPicks) ? getResolvedPickForGame(cmp.picks, g, !cmp.isPoolMember) : null;
      h2hHtml = '<div class="kv"><span>' + escapeShellHtml(cmp.name || "Compare target") + '</span><strong>' +
        (cmpHidden ? "Hidden until kickoff" : escapeShellHtml(cmpPick || "No pick yet")) + '</strong></div>';
    }
  } catch (e) {}
  var ownHtml = "";
  if (isGameLockedByCommissioner(g.id)) {
    try {
      var own = getGamePoolOwnership(g);
      ownHtml = '<div class="kv"><span>Pool split (' + escapeShellHtml(own.sourceLabel) + ')</span><strong>' +
        escapeShellHtml(g.awayCode) + ' ' + own.awayPct + '% · ' + escapeShellHtml(g.homeCode) + ' ' + own.homePct + '%</strong></div>';
    } catch (e2) {}
  } else {
    ownHtml = '<p class="muted-note">Pool split shows once picks lock.</p>';
  }

  var gamecastHtml = (ls && (ls.inProgress || ls.completed)) || DEMO_FIELD_PREVIEW
    ? fieldMountHtml(g, "sheet") + (ls && ls.inProgress ? fieldMiniTextLineHtml(g, ls) : '') +
      '<button type="button" class="tool-btn" onclick="closeGameDetail(); openFieldTheaterModal(' + g.id + ')"><i data-lucide="radio"></i><span>Drives and plays</span></button>'
    : '<p class="muted-note">GameCast opens at kickoff.</p>';

  var sheetOwn = null;
  try { sheetOwn = getGamePoolOwnership(g); } catch (e3) {}
  var gameInfoHtml = (typeof matchupGameInfoHtml === "function") ? matchupGameInfoHtml(g) : "";
  var upset = (typeof upsetAlertFor === "function") ? upsetAlertFor(g, sheetOwn) : null;
  var upsetHtml = upset ? '<div class="kv"><span>Upset alert</span><strong>' + Math.round(upset.poolPct) + '% of the pool on ' + escapeShellHtml(upset.team) + ', ESPN gives them ' + Math.round(upset.winPct) + '%</strong></div>' : '';
  var recordHtml = "";
  if (typeof mySeasonRecordPicking === "function") {
    [g.away, g.home].forEach(function(team) {
      var r = mySeasonRecordPicking(team);
      if (r) recordHtml += '<div class="kv"><span>You picking ' + escapeShellHtml(team) + ' this season</span><strong>' + r.w + '–' + r.l + '</strong></div>';
    });
  }
  var insightsHtml = "";
  if (!SIMPLE_UI_MODE) {
    var recLine = [];
    if (g.rec) recLine.push('<div class="kv"><span>Recommended (Gemini)</span><strong>' + escapeShellHtml(g.rec) + '</strong></div>');
    if (g.grokPick || g.rec) recLine.push('<div class="kv"><span>Recommended (Grok)</span><strong>' + escapeShellHtml(g.grokPick || g.rec) + '</strong></div>');
    insightsHtml = (g.sway || g.cliffTrap
        ? '<section class="sheet-section"><h3 class="sheet-h">Sway alert</h3>' +
            (g.sway ? '<p><strong>' + escapeShellHtml(g.sway.title || "") + '</strong> ' + escapeShellHtml(g.sway.detail || "") + '</p>' : '') +
            (g.cliffTrap ? '<p class="sheet-note">' + escapeShellHtml(g.cliffTrap) + '</p>' : '') +
          '</section>'
        : '') +
      '<section class="sheet-section"><h3 class="sheet-h">Picks to consider</h3>' + recLine.join("") + '</section>' +
      '<section class="sheet-section"><h3 class="sheet-h">Insights</h3>' +
      renderInsightsPanel(g).replace(/\sid="ins-\d+"/, "").replace(/\bhidden\b/, "") +
      (g.rationale ? '<p class="sheet-note">' + g.rationale + '</p>' : '') +
    '</section>';
  }

  body.innerHTML =
    '<p class="sheet-meta">' + escapeShellHtml([(k.day ? k.day + " " : "") + k.time, k.net, g.mondayPoolLine || g.poolLine].filter(Boolean).join(" · ")) + '</p>' +
    '<div class="pick-card-teams sheet-teams">' + teamPickButtonHtml(g, true, myPick, locked, sheetOwn) + teamPickButtonHtml(g, false, myPick, locked, sheetOwn) + '</div>' +
    (ls && ls.inProgress ? '<section class="sheet-section"><h3 class="sheet-h">Live</h3>' + gamecastHtml + '</section>' : '') +
    (typeof matchupSheetSectionsHtml === "function" ? matchupSheetSectionsHtml(g) : '') +
    '<section class="sheet-section"><h3 class="sheet-h">Injuries and outs</h3><div class="dual-panel">' + renderInjColumn(g.away, g.awayInj) + renderInjColumn(g.home, g.homeInj) + '</div></section>' +
    '<section class="sheet-section"><h3 class="sheet-h">Last 5</h3>' + ((typeof matchupLastFiveHtml === "function" && matchupLastFiveHtml(g)) || ('<div class="dual-panel">' + renderL5Column(g.away, g.awayRec, commonMap) + renderL5Column(g.home, g.homeRec, commonMap) + '</div>')) + '</section>' +
    (gameInfoHtml ? '<section class="sheet-section"><h3 class="sheet-h">Game info</h3>' + gameInfoHtml + '</section>' : '') +
    '<section class="sheet-section"><h3 class="sheet-h">Pool</h3>' + (h2hHtml || '') + ownHtml + upsetHtml + recordHtml + '</section>' +
    insightsHtml +
    (ls && ls.inProgress ? '' : '<section class="sheet-section"><h3 class="sheet-h">GameCast</h3>' + gamecastHtml + '</section>');
}

document.addEventListener("keydown", function(ev) {
  if (ev.key !== "Escape") return;
  closeMenus();
  if (DETAIL_SHEET_GAME_ID !== null) closeGameDetail();
});

// ---------- Hook into the existing render flow ----------
var _picksUiPrevRenderGames = renderGames; // kept for reference; both modes now use the cards below
renderGames = function() {
  ensureWatchlistDefaults();
  ensureMondayLockedOddsOnGames();
  syncSubpanelToggleButtons();
  syncManualLockButtonUI();
  renderMultiBuyInEntryStrip();
  renderCommishActiveEditBar();
  var container = document.getElementById("games-container");
  if (container) container.innerHTML = renderPickCardsHtml();
  var bCond = document.getElementById("btn-simple-style-condensed");
  var bDet = document.getElementById("btn-simple-style-detailed");
  if (bCond) bCond.setAttribute("aria-checked", SIMPLE_CARD_LAYOUT_STYLE === "condensed" ? "true" : "false");
  if (bDet) bDet.setAttribute("aria-checked", SIMPLE_CARD_LAYOUT_STYLE === "detailed" ? "true" : "false");
  updatePicksHead();
  renderGameDetailSheet();
};

updateSingleGameCardPickUI = function(g) {
  renderGames();
  return true;
};

var _picksUiPrevSyncLock = syncManualLockButtonUI;
syncManualLockButtonUI = function() {
  _picksUiPrevSyncLock.apply(this, arguments);
  updatePicksHead();
};

// ---------- Signed-out visitors start as guests ----------
// They pick in the local sandbox ("test"), which is never written to the cloud.
function enterGuestModeIfSignedOut() {
  if (AUTH_SESSION) return;
  GUEST_BROWSING_MODE = true;
  if (!state.test) state.test = { picks: {}, tiebreaker: "28-24", target: 20, linkedMemberName: "" };
  if (!state.test.picks) state.test.picks = {};
  activeProfile = "test";
  syncActiveProfileControlsUI();
}

var _guestPrevSignOut = signOutAccountInstance;
signOutAccountInstance = function() {
  var r = _guestPrevSignOut.apply(this, arguments);
  enterGuestModeIfSignedOut();
  renderAll();
  return r;
};

// Remember that this guest session made picks (used when carrying them into a new account).
var _guestPrevPickSide = pickSide;
pickSide = function() {
  if (!AUTH_SESSION && activeProfile === "test") window._guestPicksTouched = true;
  return _guestPrevPickSide.apply(this, arguments);
};
var _guestPrevApplyPreset = applyPreset;
applyPreset = function() {
  if (!AUTH_SESSION && activeProfile === "test") window._guestPicksTouched = true;
  return _guestPrevApplyPreset.apply(this, arguments);
};
