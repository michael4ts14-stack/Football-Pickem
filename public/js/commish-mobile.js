// ============================================================================
// COMMISSIONER CONSOLE ON PHONES (<= 768px)
// - Submissions: a pinned search + status filter bar and one tap-to-expand card per player.
//   An open card shows that player's whole slate as a 2-column chip grid, Prev/Next player
//   buttons and the Edit picks / Tiebreaker / Force unlock actions.
// - Master grid: By player (default), By game (who picked who) and Full matrix (sticky
//   player column).
// Desktop keeps the tables from commissioner-admin.js: every branch here checks
// isCommishMobile() first. Loaded right after commissioner-admin.js so the later console
// wrappers (link requests, official form note, grading section, scroll keeper) still run.
// ============================================================================
var COMMISH_MOBILE_MQ = window.matchMedia ? window.matchMedia("(max-width: 768px)") : null;
var CM_MOBILE = { q: "", filter: "all", open: "", rows: [], msMode: "player", msPlayer: "", msQ: "", msGame: null };

function isCommishMobile() {
  return !!(COMMISH_MOBILE_MQ && COMMISH_MOBILE_MQ.matches);
}

// The week is closed for everyone who isn't force unlocked.
function cmWeekClosed() {
  var cfg = ensureCommissionerConfig();
  return cfg.lockMode === "global_locked" || (cfg.lockMode === "friday_9pm_cst" && isPastPickDeadline());
}

function cmMemberInfo(pm) {
  var linked = getProfileLinkedToMemberName(pm.name);
  var prof = linked ? state[linked.key] : null;
  var picks = (prof && prof.picks) ? prof.picks : (pm.picks || {});
  var tb = (prof && prof.tiebreaker) ? prof.tiebreaker : (pm.tiebreaker || "");
  var c = countMatchingPicksForSlate(picks, GAMES);
  var forceUnlocked = typeof isMemberForceUnlocked === "function" && isMemberForceUnlocked(pm.name);
  var weekPts = pm.awaitingSheet ? 0 : Math.max(pm.livePts || 0, pm.finalPts || 0);
  return {
    pm: pm,
    name: pm.name,
    linked: !!linked,
    picks: pm.awaitingSheet ? {} : picks,
    tb: tb === "—" ? "" : String(tb),
    matched: c.matched,
    hasAny: c.matched > 0 && !pm.awaitingSheet,
    complete: GAMES.length > 0 && c.matched >= GAMES.length,
    locked: !!(prof && prof.userLockedPicks) || (cmWeekClosed() && !forceUnlocked),
    forceUnlocked: forceUnlocked,
    savedAt: (prof && prof.updatedAt) || pm.updatedAt || pm.submittedAt || "",
    weekPts: weekPts,
    total: pm.newLiveTotal || ((parseFloat(pm.priorPts) || 0) + weekPts)
  };
}

function cmSavedLabel(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return "Saved " + d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// One game for one pick: team, multiplier and grade (win / loss / push / live / pending).
function cmPickCell(picks, g) {
  var pick = getResolvedPickForGame(picks, g, false);
  if (!pick) return null;
  var isAway = isSameTeamPick(pick, g.away, g);
  var pts = getGamePickPts(g, isAway);
  var grade = gradeOfPick(pick, g);
  return { isAway: isAway, pts: pts, grade: grade, code: isAway ? g.awayCode : g.homeCode };
}

var CM_GRADE_DOT = { win: "🟢", loss: "🔴", push: "⚪", live: "🟡", pending: "⏳" };
var CM_GRADE_LABEL = { win: "Win", loss: "Loss", push: "No contest", live: "Live", pending: "Pending" };

function cmChipHtml(info, g) {
  var c = cmPickCell(info.picks, g);
  if (!c) {
    return '<li class="cm-m-chip is-none"><span class="cm-m-gnum">#' + g.id + '</span><span class="cm-m-pick">No pick</span></li>';
  }
  return '<li class="cm-m-chip is-' + c.grade + '" title="' + escapeHtml(g.away + ' at ' + g.home) + '">' +
    '<span class="cm-m-gnum">#' + g.id + '</span>' +
    '<span class="cm-m-pick">' + teamLogoHtml(g, c.isAway) + '<span>' + escapeHtml(c.code) + '</span></span>' +
    (c.pts > 1 ? '<span class="badge ' + (c.pts === 3 ? 'badge-3x' : 'badge-2x') + '">' + c.pts + 'x</span>' : '') +
    '<span class="cm-m-grade" aria-label="' + CM_GRADE_LABEL[c.grade] + '">' + CM_GRADE_DOT[c.grade] + '</span>' +
  '</li>';
}

function cmPanelHtml(info) {
  var arg = jsArgAttr(info.name);
  var chips = "";
  for (var i = 0; i < GAMES.length; i++) chips += cmChipHtml(info, GAMES[i]);
  return '<div class="cm-m-panel">' +
    '<div class="cm-m-jump">' +
      '<button type="button" class="btn-sm" onclick="cmMobileStep(-1)">‹ Prev player</button>' +
      '<span class="cm-m-jump-pos" data-cm-pos></span>' +
      '<button type="button" class="btn-sm" onclick="cmMobileStep(1)">Next player ›</button>' +
    '</div>' +
    '<div class="cm-m-stats">' +
      '<span>Week <strong>' + (info.pm.awaitingSheet ? '—' : '+' + info.weekPts) + '</strong></span>' +
      '<span>Total <strong>' + info.total + '</strong></span>' +
      '<span>Tiebreaker <strong>' + escapeHtml(info.tb || "—") + '</strong></span>' +
    '</div>' +
    (GAMES.length ? '<ol class="cm-m-chips">' + chips + '</ol>' : '<p class="cm-m-empty">No games on the slate yet.</p>') +
    '<div class="cm-m-actions">' +
      '<button type="button" class="btn-sm" onclick="manuallySetPlayerPicks(\'' + arg + '\')">✏️ Edit / Override Picks</button>' +
      '<button type="button" class="btn-sm" onclick="overrideTiebreaker(\'' + arg + '\')">🎯 Edit Tiebreaker</button>' +
      '<button type="button" class="btn-sm" aria-pressed="' + info.forceUnlocked + '" onclick="forceUnlockPicks(\'' + arg + '\')">' + (info.forceUnlocked ? '🔓 Unlocked ✓' : '🔓 Force Unlock') + '</button>' +
    '</div>' +
  '</div>';
}

function cmCardHtml(info, idx) {
  var open = CM_MOBILE.open === info.name;
  var countCls = info.complete ? "is-full" : (info.hasAny ? "is-partial" : "is-missing");
  var saved = cmSavedLabel(info.savedAt);
  return '<li class="cm-m-card' + (open ? ' is-open' : '') + '" data-idx="' + idx + '" data-name="' + escapeHtml(info.name.toLowerCase()) + '"' +
      ' data-sub="' + (info.hasAny ? 1 : 0) + '" data-locked="' + (info.locked ? 1 : 0) + '">' +
    '<button type="button" class="cm-m-card-head" aria-expanded="' + open + '" onclick="cmMobileToggle(' + idx + ')">' +
      '<span class="cm-m-who">' +
        '<strong class="cm-m-name">' + escapeHtml(info.name) + '</strong>' +
        '<span class="cm-m-tags">' +
          (info.linked ? '<span class="linked-lb-pill">✓ App account</span>' : '') +
          (info.locked ? '<span class="cm-m-tag">🔒 Locked</span>' : '') +
        '</span>' +
        (saved ? '<span class="cm-m-time">' + escapeHtml(saved) + '</span>' : '') +
      '</span>' +
      '<span class="cm-m-meta">' +
        '<span class="cm-m-count ' + countCls + '">' + info.matched + '/' + GAMES.length + '</span>' +
        '<span class="cm-m-tb">TB ' + escapeHtml(info.tb || "—") + '</span>' +
        '<span class="cm-m-toggle">' + (open ? 'Hide ▴' : 'View Picks ▾') + '</span>' +
      '</span>' +
    '</button>' +
    (open ? cmPanelHtml(info) : '') +
  '</li>';
}

function cmMobileSubmissionsHtml() {
  var cfg = ensureCommissionerConfig();
  var pmList = state.poolMembers || [];
  var rows = [];
  var sub = 0, locked = 0;
  for (var i = 0; i < pmList.length; i++) {
    if (!pmList[i] || !pmList[i].name) continue;
    var info = cmMemberInfo(pmList[i]);
    rows.push(info);
    if (info.hasAny) sub++;
    if (info.locked) locked++;
  }
  CM_MOBILE.rows = rows;
  var missing = rows.length - sub;
  var pill = function(key, label) {
    return '<button type="button" class="cm-m-pill' + (CM_MOBILE.filter === key ? ' active' : '') + '" aria-pressed="' + (CM_MOBILE.filter === key) + '" onclick="cmMobileSetFilter(\'' + key + '\')">' + label + '</button>';
  };
  var cards = rows.map(cmCardHtml).join("");
  return '<div class="cm-m-toolbar">' +
      '<input type="search" id="cm-m-search" class="search-input cm-m-search" placeholder="Search player name..." autocomplete="off" aria-label="Search player name" value="' + escapeHtml(CM_MOBILE.q) + '" oninput="cmMobileSetQuery(this.value)" />' +
      '<div class="cm-m-pills" role="group" aria-label="Filter players">' +
        pill("all", "All (" + rows.length + ")") +
        pill("submitted", "✓ Submitted (" + sub + ")") +
        pill("missing", "⚠️ Missing (" + missing + ")") +
        pill("locked", "🔒 Locked (" + locked + ")") +
      '</div>' +
    '</div>' +
    '<div class="cm-m-summary">' +
      '<span>' + escapeHtml(state.weekLabel || ("Week " + (state.currentWeek || ""))) + ' · ' + GAMES.length + ' games · Lock ' + escapeHtml(pickDeadlineLabel()) + '</span>' +
      (cfg.lastWedThuNudgeSentAt ? '<span>Last nudge ' + escapeHtml(cfg.lastWedThuNudgeSentAt) + '</span>' : '') +
    '</div>' +
    '<div class="cm-m-bulk">' +
      '<button type="button" class="btn-sm" onclick="commishAutoFillMissingPlayers(\'chalk\')">⚡ Auto-fill missing (' + missing + ')</button>' +
      '<button type="button" class="btn-sm" onclick="triggerWedThuAutomatedNudge()">⏰ Send nudge</button>' +
      '<button type="button" class="btn-sm" onclick="triggerSaturdayMorningMasterSheetBroadcast()">📊 Sat reveal &amp; CSV</button>' +
    '</div>' +
    '<ul class="cm-m-list" id="cm-m-list">' + cards + '</ul>' +
    '<p class="cm-m-empty" id="cm-m-empty" hidden>No players match.</p>';
}

// Search and filter hide cards in place: no re-render, so the keyboard stays up.
function cmCardVisible(li) {
  var q = CM_MOBILE.q.trim().toLowerCase();
  if (q && li.getAttribute("data-name").indexOf(q) === -1) return false;
  var f = CM_MOBILE.filter;
  if (f === "submitted") return li.getAttribute("data-sub") === "1";
  if (f === "missing") return li.getAttribute("data-sub") !== "1";
  if (f === "locked") return li.getAttribute("data-locked") === "1";
  return true;
}

function cmApplyMobileFilters() {
  var list = document.getElementById("cm-m-list");
  if (!list) return;
  var shown = 0;
  list.querySelectorAll(".cm-m-card").forEach(function(li) {
    var vis = cmCardVisible(li);
    li.hidden = !vis;
    if (vis) shown++;
  });
  var empty = document.getElementById("cm-m-empty");
  if (empty) empty.hidden = shown > 0;
  cmUpdateJumpPos();
}

function cmMobileSetQuery(v) {
  CM_MOBILE.q = String(v || "");
  cmApplyMobileFilters();
}

function cmMobileSetFilter(f) {
  CM_MOBILE.filter = f;
  document.querySelectorAll("#commish-modal-body .cm-m-pill").forEach(function(b) {
    var on = b.getAttribute("onclick").indexOf("'" + f + "'") !== -1;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  cmApplyMobileFilters();
}

function cmVisibleCards() {
  return Array.prototype.slice.call(document.querySelectorAll("#cm-m-list .cm-m-card")).filter(function(li) { return !li.hidden; });
}

function cmUpdateJumpPos() {
  var pos = document.querySelector("#cm-m-list [data-cm-pos]");
  if (!pos) return;
  var vis = cmVisibleCards();
  var openLi = pos.closest(".cm-m-card");
  var at = vis.indexOf(openLi);
  pos.textContent = at === -1 ? "" : (at + 1) + " / " + vis.length;
}

function cmCloseOpenCard() {
  var prev = document.querySelector("#cm-m-list .cm-m-card.is-open");
  if (!prev) return;
  var idx = parseInt(prev.getAttribute("data-idx"), 10);
  var info = CM_MOBILE.rows[idx];
  if (info) prev.outerHTML = cmCardHtml(info, idx);
}

function cmOpenCard(idx, scroll) {
  var info = CM_MOBILE.rows[idx];
  var li = document.querySelector('#cm-m-list .cm-m-card[data-idx="' + idx + '"]');
  if (!info || !li) return;
  cmCloseOpenCard();
  CM_MOBILE.open = info.name;
  li = document.querySelector('#cm-m-list .cm-m-card[data-idx="' + idx + '"]');
  li.outerHTML = cmCardHtml(info, idx);
  li = document.querySelector('#cm-m-list .cm-m-card[data-idx="' + idx + '"]');
  li.hidden = !cmCardVisible(li);
  cmUpdateJumpPos();
  if (scroll && li.scrollIntoView) li.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cmMobileToggle(idx) {
  var info = CM_MOBILE.rows[idx];
  if (!info) return;
  if (CM_MOBILE.open === info.name) {
    CM_MOBILE.open = "";
    var li = document.querySelector('#cm-m-list .cm-m-card[data-idx="' + idx + '"]');
    if (li) { li.outerHTML = cmCardHtml(info, idx); cmApplyMobileFilters(); }
    return;
  }
  cmOpenCard(idx, true);
}

function cmMobileStep(dir) {
  var vis = cmVisibleCards();
  if (!vis.length) return;
  var openLi = document.querySelector("#cm-m-list .cm-m-card.is-open");
  var at = vis.indexOf(openLi);
  var next = vis[(at + dir + vis.length) % vis.length];
  cmOpenCard(parseInt(next.getAttribute("data-idx"), 10), true);
}

// ---------- Master grid on phones ----------
function cmMasterRows() {
  return (state.poolMembers || []).filter(function(pm) { return pm && pm.name; }).map(cmMemberInfo).sort(function(a, b) {
    return (b.total - a.total) || a.name.localeCompare(b.name);
  });
}

function cmMsSegHtml() {
  var seg = function(key, label) {
    return '<button type="button" role="tab" aria-selected="' + (CM_MOBILE.msMode === key) + '" class="cm-m-seg-btn' + (CM_MOBILE.msMode === key ? ' active' : '') + '" onclick="cmMsSetMode(\'' + key + '\')">' + label + '</button>';
  };
  return '<div class="cm-m-seg" role="tablist" aria-label="Master grid view">' +
    seg("player", "👤 By Player") + seg("game", "🏈 By Game") + seg("matrix", "📊 Full Matrix") +
  '</div>';
}

function cmMsPlayerHtml(rows) {
  if (!rows.length) return '<p class="cm-m-empty">No players on the roster yet.</p>';
  var sel = rows.filter(function(r) { return r.name === CM_MOBILE.msPlayer; })[0] || rows[0];
  CM_MOBILE.msPlayer = sel.name;
  var q = CM_MOBILE.msQ.trim().toLowerCase();
  var pills = rows.map(function(r, i) {
    var hide = q && r.name.toLowerCase().indexOf(q) === -1;
    return '<button type="button" class="cm-m-pill' + (r === sel ? ' active' : '') + '" data-name="' + escapeHtml(r.name.toLowerCase()) + '"' + (hide ? ' hidden' : '') +
      ' onclick="cmMsPickPlayer(\'' + jsArgAttr(r.name) + '\')">' + (i + 1) + '. ' + escapeHtml(r.name) + '</button>';
  }).join("");
  var list = GAMES.map(function(g) {
    var c = cmPickCell(sel.picks, g);
    return '<li class="cm-m-row' + (c ? ' is-' + c.grade : ' is-none') + '">' +
      '<span class="cm-m-gnum">#' + g.id + '</span>' +
      '<span class="cm-m-matchup">' + escapeHtml(g.awayCode + ' @ ' + g.homeCode) + '<small>' + escapeHtml(g.mondayPoolLine || g.poolLine || "") + '</small></span>' +
      (c ? '<span class="cm-m-pick">' + teamLogoHtml(g, c.isAway) + '<strong>' + escapeHtml(c.code) + '</strong>' +
            (c.pts > 1 ? '<span class="badge ' + (c.pts === 3 ? 'badge-3x' : 'badge-2x') + '">' + c.pts + 'x</span>' : '') + '</span>' +
            '<span class="cm-m-grade" aria-label="' + CM_GRADE_LABEL[c.grade] + '">' + CM_GRADE_DOT[c.grade] + '</span>'
         : '<span class="cm-m-pick cm-m-muted">No pick</span>') +
    '</li>';
  }).join("");
  return '<input type="search" id="cm-ms-q" class="search-input cm-m-search" placeholder="Search player name..." autocomplete="off" aria-label="Search player name" value="' + escapeHtml(CM_MOBILE.msQ) + '" oninput="cmMsFilterPills(this.value)" />' +
    '<div class="cm-m-pillrow" id="cm-ms-pills">' + pills + '</div>' +
    '<div class="cm-m-card is-open cm-ms-player">' +
      '<div class="cm-m-card-head is-static">' +
        '<span class="cm-m-who"><strong class="cm-m-name">' + escapeHtml(sel.name) + '</strong>' +
          '<span class="cm-m-time">' + sel.matched + '/' + GAMES.length + ' picks</span></span>' +
        '<span class="cm-m-meta"><span class="cm-m-count is-full">' + sel.total + ' pts</span><span class="cm-m-tb">TB ' + escapeHtml(sel.tb || "—") + '</span></span>' +
      '</div>' +
      '<div class="cm-m-stats"><span>Week <strong>' + (sel.pm.awaitingSheet ? '—' : '+' + sel.weekPts) + '</strong></span><span>Prior <strong>' + (parseFloat(sel.pm.priorPts) || 0) + '</strong></span>' +
        '<button type="button" class="btn-sm" onclick="manuallySetPlayerPicks(\'' + jsArgAttr(sel.name) + '\')">✏️ Edit picks</button></div>' +
      '<ol class="cm-m-rows">' + list + '</ol>' +
    '</div>';
}

function cmMsGameHtml(rows) {
  if (!GAMES.length) return '<p class="cm-m-empty">No games on the slate yet.</p>';
  return '<ol class="cm-m-games">' + GAMES.map(function(g) {
    var away = [], home = [];
    rows.forEach(function(r) {
      var pick = getResolvedPickForGame(r.picks, g, false);
      if (!pick) return;
      (isSameTeamPick(pick, g.away, g) ? away : home).push(r.name);
    });
    var n = away.length + home.length;
    var aPct = n ? Math.round(away.length / n * 100) : 0;
    var hPct = n ? 100 - aPct : 0;
    var open = CM_MOBILE.msGame === g.id;
    var names = function(list) {
      return list.length ? list.map(function(x) { return '<li>' + escapeHtml(x) + '</li>'; }).join("") : '<li class="cm-m-muted">Nobody</li>';
    };
    var aPts = getGamePickPts(g, true), hPts = getGamePickPts(g, false);
    var grade = LIVE_SCORES && LIVE_SCORES[g.id];
    return '<li class="cm-m-game' + (open ? ' is-open' : '') + '">' +
      '<button type="button" class="cm-m-game-head" aria-expanded="' + open + '" onclick="cmMsToggleGame(' + g.id + ')">' +
        '<span class="cm-m-gnum">#' + g.id + '</span>' +
        '<span class="cm-m-matchup">' + escapeHtml(g.away) + (aPts > 1 ? ' <span class="badge badge-' + aPts + 'x">' + aPts + 'x</span>' : '') +
          ' @ ' + escapeHtml(g.home) + (hPts > 1 ? ' <span class="badge badge-' + hPts + 'x">' + hPts + 'x</span>' : '') +
          (grade && (grade.inProgress || grade.completed) ? '<small>' + escapeHtml(g.awayCode + ' ' + grade.awayScore + ' – ' + grade.homeScore + ' ' + g.homeCode + ' · ' + (grade.detail || "")) + '</small>' : '') +
        '</span>' +
        '<span class="cm-m-split"><span class="cm-m-split-bar"><span style="width:' + aPct + '%"></span></span>' +
          '<span class="cm-m-split-txt">' + escapeHtml(g.awayCode) + ' ' + aPct + '% · ' + escapeHtml(g.homeCode) + ' ' + hPct + '%</span></span>' +
      '</button>' +
      (open ? '<div class="cm-m-who-picked">' +
        '<div><h4>' + escapeHtml(g.awayCode) + ' (' + away.length + ')</h4><ul>' + names(away) + '</ul></div>' +
        '<div><h4>' + escapeHtml(g.homeCode) + ' (' + home.length + ')</h4><ul>' + names(home) + '</ul></div>' +
      '</div>' : '') +
    '</li>';
  }).join("") + '</ol>';
}

function cmMsMatrixHtml(rows) {
  var head = '<th class="cm-m-sticky">Player · Pts</th><th>TB</th>' + GAMES.map(function(g) {
    return '<th title="' + escapeHtml(g.away + ' at ' + g.home) + '">G' + g.id + '<br><small>' + escapeHtml(g.awayCode + '/' + g.homeCode) + '</small></th>';
  }).join("");
  var body = rows.map(function(r, i) {
    var cells = GAMES.map(function(g) {
      var c = cmPickCell(r.picks, g);
      if (!c) return '<td class="cm-m-muted">—</td>';
      return '<td class="is-' + c.grade + '">' + escapeHtml(c.code) + (c.pts > 1 ? ' <small>' + c.pts + 'x</small>' : '') + '</td>';
    }).join("");
    return '<tr><th scope="row" class="cm-m-sticky"><span class="cm-m-mx-name">' + (i + 1) + '. ' + escapeHtml(r.name) + '</span><span class="cm-m-mx-pts">' + r.total + '</span></th>' +
      '<td>' + escapeHtml(r.tb || "—") + '</td>' + cells + '</tr>';
  }).join("");
  return '<div class="cm-m-matrix-wrap"><table class="cm-m-matrix"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function cmMobileMasterHtml() {
  var rows = cmMasterRows();
  var inner = CM_MOBILE.msMode === "game" ? cmMsGameHtml(rows) : (CM_MOBILE.msMode === "matrix" ? cmMsMatrixHtml(rows) : cmMsPlayerHtml(rows));
  return '<div class="cm-m-toolbar">' + cmMsSegHtml() + '</div>' +
    '<div class="cm-m-bulk"><button type="button" class="btn-sm" onclick="exportOfficialMasterCsv()">📥 Download Master .CSV</button></div>' +
    inner;
}

function cmMsSetMode(mode) {
  CM_MOBILE.msMode = mode;
  renderCommissionerModalBody();
}

function cmMsPickPlayer(name) {
  CM_MOBILE.msPlayer = name;
  renderCommissionerModalBody();
}

function cmMsFilterPills(v) {
  CM_MOBILE.msQ = String(v || "");
  var q = CM_MOBILE.msQ.trim().toLowerCase();
  document.querySelectorAll("#cm-ms-pills .cm-m-pill").forEach(function(b) {
    b.hidden = !!q && b.getAttribute("data-name").indexOf(q) === -1;
  });
}

function cmMsToggleGame(id) {
  CM_MOBILE.msGame = CM_MOBILE.msGame === id ? null : id;
  renderCommissionerModalBody();
}

// ---------- Console wiring ----------
var _mobilePrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var body = document.getElementById("commish-modal-body");
  if (!body || !isCommishMobile() || !isVerifiedCommissioner() ||
      (ACTIVE_COMMISH_TAB !== "submissions" && ACTIVE_COMMISH_TAB !== "mastersheet")) {
    return _mobilePrevCommishBody.apply(this, arguments);
  }
  ensureCommissionerConfig();
  regradeAllPoolMembersLive();
  if (ACTIVE_COMMISH_TAB === "submissions") {
    body.innerHTML = cmMobileSubmissionsHtml();
    cmApplyMobileFilters();
  } else {
    body.innerHTML = cmMobileMasterHtml();
    var pill = document.querySelector("#cm-ms-pills .cm-m-pill.active");
    if (pill && pill.parentNode) pill.parentNode.scrollLeft = pill.offsetLeft - 16;
  }
};

// The pinned filter bar sits under the sticky console header, whatever its height.
function cmSyncHeadHeight() {
  var box = document.getElementById("commish-modal-box");
  var head = box && box.querySelector(".commish-modal-head");
  if (head) box.style.setProperty("--cm-head-h", head.offsetHeight + "px");
}

(function() {
  var head = document.querySelector("#commish-modal-box .commish-modal-head");
  if (head && window.ResizeObserver) new ResizeObserver(cmSyncHeadHeight).observe(head);
  // Rotating or resizing across 768px swaps between the phone and desktop layouts.
  if (COMMISH_MOBILE_MQ) {
    var onChange = function() {
      var bd = document.getElementById("commish-modal-backdrop");
      if (bd && bd.style.display === "flex") renderCommissionerModalBody();
    };
    if (COMMISH_MOBILE_MQ.addEventListener) COMMISH_MOBILE_MQ.addEventListener("change", onChange);
    else if (COMMISH_MOBILE_MQ.addListener) COMMISH_MOBILE_MQ.addListener(onChange);
  }
})();
