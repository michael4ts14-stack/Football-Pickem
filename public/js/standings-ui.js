// ============================================================================
// STANDINGS SCREEN UI: Week / Season, "Your spot", Rivals, top 10 + you ±2,
// search across everyone, and weekly winners. Uses buildPoolLeaderboardRows(),
// the same rows the full breakdown table uses; nothing here changes grading.
// ============================================================================
var STANDINGS_SCOPE = "season"; // "season" | "week"
var STANDINGS_SHOW_ALL = false;
var STANDINGS_TOP_N = 10;
var STANDINGS_AROUND_ME = 2;
var RIVALS_MAX = 3;
var STANDINGS_LAYOUT = "list";   // "list" | "table" (Table is Advanced only)
var STANDINGS_SORT = { key: "rank", dir: 1 };
var FINISH_ODDS_OPEN = false;

function setStandingsScope(scope) {
  STANDINGS_SCOPE = (scope === "week") ? "week" : "season";
  renderStandingsList();
}

function toggleStandingsShowAll() {
  STANDINGS_SHOW_ALL = !STANDINGS_SHOW_ALL;
  renderStandingsList();
}

// ---------- Rivals: up to 3 players each person pins (account doc when signed in, device otherwise) ----------
var MY_RIVALS = null;          // array of display names
var MY_RIVALS_LOADED_FOR = null;
var RIVALS_DEVICE_KEY = "sat_rivals_v1";

function rivalsAccountDocKey() {
  var email = AUTH_SESSION && AUTH_SESSION.email ? String(AUTH_SESSION.email).toLowerCase() : "";
  return email ? "email_" + email.replace(/[^a-z0-9]/g, "_") : "";
}

function getMyRivals() {
  var who = rivalsAccountDocKey() || "device";
  if (MY_RIVALS && MY_RIVALS_LOADED_FOR === who) return MY_RIVALS;
  MY_RIVALS_LOADED_FOR = who;
  MY_RIVALS = [];
  try { MY_RIVALS = JSON.parse(safeGetStorage(RIVALS_DEVICE_KEY + ":" + who) || "[]") || []; } catch (e) { MY_RIVALS = []; }
  var docKey = rivalsAccountDocKey();
  if (docKey && typeof fsDb !== "undefined" && fsDb) {
    fsDb.collection("pickem_v14_accounts").doc(docKey).get().then(function(snap) {
      var list = snap && snap.exists && snap.data() && snap.data().rivals;
      if (Array.isArray(list) && MY_RIVALS_LOADED_FOR === docKey) {
        MY_RIVALS = list.slice(0, RIVALS_MAX);
        safeSetStorage(RIVALS_DEVICE_KEY + ":" + docKey, JSON.stringify(MY_RIVALS));
        renderStandingsList();
      }
    }).catch(function() {});
  }
  return MY_RIVALS;
}

function isMyRival(name) {
  var low = String(name || "").toLowerCase();
  return getMyRivals().some(function(n) { return String(n).toLowerCase() === low; });
}

// Returns false (and changes nothing) when 3 rivals are already starred.
function toggleRival(name) {
  var list = getMyRivals().slice();
  var low = String(name || "").toLowerCase();
  var idx = -1;
  for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === low) idx = i;
  if (idx >= 0) list.splice(idx, 1);
  else if (list.length >= RIVALS_MAX) return false;
  else list.push(name);
  MY_RIVALS = list;
  var who = rivalsAccountDocKey() || "device";
  safeSetStorage(RIVALS_DEVICE_KEY + ":" + who, JSON.stringify(list));
  var docKey = rivalsAccountDocKey();
  if (docKey && typeof fsDb !== "undefined" && fsDb) {
    try { fsDb.collection("pickem_v14_accounts").doc(docKey).set({ rivals: list }, { merge: true }).catch(function() {}); } catch (e) {}
  }
  renderStandingsList();
  return true;
}

// ---------- Rows ----------
function rankLabel(r) { return (r.tied ? "T" : "") + r.rank; }

// Every player with week and season points, ranks (ties share a rank) and last week's rank.
function computeStandingsRows() {
  var raw = [];
  try { raw = buildPoolLeaderboardRows(); } catch (e) { raw = []; }
  var isWeek = STANDINGS_SCOPE === "week";
  var list = raw.map(function(r) {
    return {
      name: r.name,
      weekPts: Math.max(r.liveTotalWk || 0, r.finalPts || 0),
      seasonPts: r.newTotal || 0,
      priorPts: r.priorPts || 0,
      finalPts: r.finalPts || 0,
      liveTotalWk: r.liveTotalWk || 0,
      liveInProgPts: r.liveInProgPts || 0,
      waiting: !!r.awaitingSheet,
      breakdown: r.breakdown,
      live: (r.liveInProgPts || 0) > 0
    };
  });
  list.forEach(function(r) { r.pts = isWeek ? r.weekPts : r.seasonPts; });
  // Stable sort keeps the leaderboard's own order (total, then final points) inside ties.
  list.sort(function(a, b) { return b.pts - a.pts; });

  var countAbove = function(arr, key, v) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i][key] > v) n++; return n; };
  var countEq = function(arr, key, v) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i][key] === v) n++; return n; };
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    r.rank = countAbove(list, "pts", r.pts) + 1;
    r.tied = countEq(list, "pts", r.pts) > 1;
    r.back = list.length ? list[0].pts - r.pts : 0;
    r.seasonRank = countAbove(list, "seasonPts", r.seasonPts) + 1;
    r.seasonTied = countEq(list, "seasonPts", r.seasonPts) > 1;
    r.lastWeekRank = countAbove(list, "priorPts", r.priorPts) + 1;
    r.movement = r.lastWeekRank - r.seasonRank; // + moved up
    r.index = i;
  }
  return list;
}

function movementHtml(r) {
  if (!r || !r.movement) return '<span class="st-move is-flat">No change since last week</span>';
  var up = r.movement > 0;
  return '<span class="st-move ' + (up ? 'is-up' : 'is-down') + '"><i data-lucide="' + (up ? 'arrow-up' : 'arrow-down') + '"></i>' +
    (up ? 'Up ' : 'Down ') + Math.abs(r.movement) + ' since last week</span>';
}

function standingsRowHtml(r, meLow) {
  var isMe = meLow && r.name.toLowerCase() === meLow;
  var rival = isMyRival(r.name);
  var isWeek = STANDINGS_SCOPE === "week";
  return '<button type="button" class="st-row' + (isMe ? ' is-me' : '') + '" role="row" data-key="' + escapeShellHtml(r.name.toLowerCase()) + '" ' +
      'onclick="openPlayerSheet(this.getAttribute(\'data-name\'))" data-name="' + escapeShellHtml(r.name) + '" aria-label="' + escapeShellHtml(rankLabel(r) + ", " + r.name + ", " + r.pts + " points") + '">' +
    '<span class="rank' + (r.rank <= 3 ? ' top3' : '') + '" role="cell">' + rankLabel(r) + '</span>' +
    '<span class="st-name" role="cell">' +
      (rival ? '<i data-lucide="star" class="st-star" aria-label="Rival"></i>' : '') +
      escapeShellHtml(r.name) +
      (isMe ? '<span class="you-tag">You</span>' : '') +
      (r.live ? '<span class="st-live">Live</span>' : '') +
      (isWeek && r.waiting ? '<span class="st-sub">No sheet yet</span>' : '') +
    '</span>' +
    '<span class="num st-pts" role="cell">' + r.pts + '</span>' +
    '<span class="num st-back" role="cell">' + (r.back > 0 ? r.back : '–') + '</span>' +
  '</button>';
}

// Replace only rows whose markup changed when the order is the same; otherwise redraw.
function patchStandingsBlock(el, items, extraHtml) {
  if (!el) return;
  var sig = items.map(function(it) { return it.key; }).join("|") + "#" + (extraHtml || "");
  if (el.getAttribute("data-sig") === sig) {
    var kids = el.querySelectorAll(":scope > [data-key]");
    if (kids.length === items.length) {
      for (var i = 0; i < items.length; i++) {
        if (kids[i].getAttribute("data-html") !== String(items[i].html.length) + ":" + hashStr(items[i].html)) {
          var tmp = document.createElement("div");
          tmp.innerHTML = items[i].html;
          var node = tmp.firstChild;
          node.setAttribute("data-html", String(items[i].html.length) + ":" + hashStr(items[i].html));
          el.replaceChild(node, kids[i]);
        }
      }
      return;
    }
  }
  el.innerHTML = items.map(function(it) { return it.html; }).join("") + (extraHtml || "");
  var nodes = el.querySelectorAll(":scope > [data-key]");
  for (var j = 0; j < nodes.length && j < items.length; j++) nodes[j].setAttribute("data-html", String(items[j].html.length) + ":" + hashStr(items[j].html));
  el.setAttribute("data-sig", sig);
}

function hashStr(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function renderStandingsList() {
  var box = document.getElementById("standings-list");
  if (!box) return;
  var wk = document.getElementById("st-scope-week");
  var se = document.getElementById("st-scope-season");
  if (wk) wk.setAttribute("aria-pressed", STANDINGS_SCOPE === "week" ? "true" : "false");
  if (se) se.setAttribute("aria-pressed", STANDINGS_SCOPE === "season" ? "true" : "false");

  var list = computeStandingsRows();
  var meLow = getMyLeaderboardNameLower();
  var me = null;
  for (var i = 0; i < list.length; i++) if (meLow && list[i].name.toLowerCase() === meLow) me = list[i];
  var qEl = document.getElementById("leaderboard-search-input");
  var q = (qEl ? qEl.value : "").trim().toLowerCase();
  var isWeek = STANDINGS_SCOPE === "week";

  renderYourSpot(me, list.length);
  renderRivals(list, meLow, q);
  renderWeeklyWinners(list);

  // Which rows: search -> everyone matching; "Show all" -> everyone; else top 10, then you ±2.
  var items = [];
  var push = function(r) { items.push({ key: r.name.toLowerCase(), html: standingsRowHtml(r, meLow) }); };
  var extra = "";
  if (q) {
    list.forEach(function(r) { if (r.name.toLowerCase().indexOf(q) !== -1) push(r); });
    if (!items.length) extra = '<p class="empty-note">No players match that search.</p>';
  } else if (STANDINGS_SHOW_ALL || list.length <= STANDINGS_TOP_N + STANDINGS_AROUND_ME * 2 + 1) {
    list.forEach(push);
  } else {
    list.slice(0, STANDINGS_TOP_N).forEach(push);
    if (me && me.index >= STANDINGS_TOP_N) {
      var from = Math.max(STANDINGS_TOP_N, me.index - STANDINGS_AROUND_ME);
      if (from > STANDINGS_TOP_N) items.push({ key: "gap", html: '<div class="st-gap" data-key="gap" role="presentation"><span>···</span></div>' });
      list.slice(from, me.index + STANDINGS_AROUND_ME + 1).forEach(push);
    }
  }
  if (!list.length) extra = '<p class="empty-note">Standings appear once the pool syncs.</p>';
  if (!q && list.length > STANDINGS_TOP_N + STANDINGS_AROUND_ME * 2 + 1) {
    extra += '<button type="button" class="st-show-all" onclick="toggleStandingsShowAll()">' +
      (STANDINGS_SHOW_ALL ? 'Show fewer' : 'Show all ' + list.length + ' players') + '</button>';
  }

  var head = document.getElementById("standings-list-head");
  if (head) head.hidden = !items.length;
  patchStandingsBlock(box, items, extra);

  var cnt = document.getElementById("leaderboard-count-label");
  if (cnt) cnt.textContent = list.length ? (list.length + " players" + (isWeek ? " · this week's points" : " · season points")) : "";
}

function renderYourSpot(me, total) {
  var el = document.getElementById("standings-your-spot");
  if (!el) return;
  if (!me) {
    el.innerHTML = '<p class="spot-label">Your spot</p>' +
      (isSignedInUser()
        ? '<p class="spot-empty">You aren\'t on the board yet. Your spot shows once your account is linked to a pool entry.</p>'
        : '<p class="spot-empty">Sign in to see your spot. <button type="button" class="link-btn" onclick="openAuthModal()">Sign in</button></p>');
    return;
  }
  var isWeek = STANDINGS_SCOPE === "week";
  el.innerHTML =
    '<p class="spot-label">Your spot · ' + (isWeek ? 'this week' : 'season') + '</p>' +
    '<button type="button" class="spot-main" onclick="openPlayerSheet(this.getAttribute(\'data-name\'))" data-name="' + escapeShellHtml(me.name) + '">' +
      '<span class="spot-rank' + (me.rank <= 3 ? ' top3' : '') + '">' + rankLabel(me) + '<span class="spot-of"> of ' + total + '</span></span>' +
      '<span class="spot-stat"><strong>' + me.pts + '</strong> pts</span>' +
      '<span class="spot-stat"><strong>' + (me.back > 0 ? me.back : 0) + '</strong> back</span>' +
    '</button>' +
    (isWeek ? '' : movementHtml(me)) +
    (me.live ? '<span class="st-live">Live</span>' : '');
}

function renderRivals(list, meLow, q) {
  var el = document.getElementById("standings-rivals");
  if (!el) return;
  var names = getMyRivals();
  var rows = [];
  names.forEach(function(n) {
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === String(n).toLowerCase()) rows.push(list[i]);
  });
  rows.sort(function(a, b) { return a.index - b.index; });
  if (q || !rows.length) {
    el.hidden = !!q || !list.length;
    el.innerHTML = q ? '' : '<p class="st-section-label">Rivals</p><p class="muted-note st-rivals-hint">Tap a player and star them to pin up to 3 rivals here.</p>';
    el.removeAttribute("data-sig");
    return;
  }
  el.hidden = false;
  var label = '<p class="st-section-label" data-key="label">Rivals</p>';
  patchStandingsBlock(el, [{ key: "label", html: label }].concat(rows.map(function(r) {
    return { key: r.name.toLowerCase(), html: standingsRowHtml(r, meLow) };
  })), "");
}

function renderWeeklyWinners(list) {
  var el = document.getElementById("standings-weekly-winners");
  if (!el) return;
  var wk = list.slice().filter(function(r) { return r.weekPts > 0; })
    .sort(function(a, b) { return (b.weekPts - a.weekPts) || a.name.localeCompare(b.name); }).slice(0, 5);
  if (!wk.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  var anyLive = wk.some(function(r) { return r.live; });
  var html = '<p class="st-section-label">Weekly winners' + (anyLive ? ' <span class="st-sub-inline">so far</span>' : '') + '</p><ol class="ww-list">';
  for (var i = 0; i < wk.length; i++) {
    var r = wk[i];
    var above = 0;
    for (var j = 0; j < wk.length; j++) if (wk[j].weekPts > r.weekPts) above++;
    var tied = wk.filter(function(x) { return x.weekPts === r.weekPts; }).length > 1;
    html += '<li><button type="button" class="ww-row" data-name="' + escapeShellHtml(r.name) + '" onclick="openPlayerSheet(this.getAttribute(\'data-name\'))">' +
      '<span class="rank' + (above < 3 ? ' top3' : '') + '">' + (tied ? 'T' : '') + (above + 1) + '</span>' +
      '<span class="st-name">' + escapeShellHtml(r.name) + (r.live ? '<span class="st-live">Live</span>' : '') + '</span>' +
      '<span class="num">' + r.weekPts + '</span></button></li>';
  }
  el.innerHTML = html + '</ol>';
}

// ---------- Table (Advanced): every column, sortable, name column stays put ----------
function setStandingsLayout(layout) {
  STANDINGS_LAYOUT = layout === "table" ? "table" : "list";
  renderStandingsList();
}

function sortStandingsTable(key) {
  STANDINGS_SORT = { key: key, dir: STANDINGS_SORT.key === key ? -STANDINGS_SORT.dir : (key === "name" || key === "rank" ? 1 : -1) };
  renderStandingsTable(computeStandingsRows());
}

var STANDINGS_TABLE_COLS = [
  { key: "rank", label: "#", num: true },
  { key: "name", label: "Player" },
  { key: "priorPts", label: "Prior", num: true },
  { key: "liveInProgPts", label: "Live wk", num: true },
  { key: "finalPts", label: "Final wk", num: true },
  { key: "seasonPts", label: "Total", num: true },
  { key: "breakdown", label: "Status / multipliers" }
];

function renderStandingsTable(list) {
  var el = document.getElementById("standings-table-view");
  if (!el) return;
  var meLow = getMyLeaderboardNameLower();
  var qEl = document.getElementById("leaderboard-search-input");
  var q = (qEl ? qEl.value : "").trim().toLowerCase();
  var sk = STANDINGS_SORT.key, dir = STANDINGS_SORT.dir;
  var rows = list.filter(function(r) { return !q || r.name.toLowerCase().indexOf(q) !== -1; });
  rows.sort(function(a, b) {
    var x = sk === "rank" ? a.index : a[sk], y = sk === "rank" ? b.index : b[sk];
    if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || ""));
    return dir * ((x || 0) - (y || 0)) || (a.index - b.index);
  });
  var head = STANDINGS_TABLE_COLS.map(function(c) {
    var on = c.key === sk;
    return '<th scope="col" class="' + (c.num ? 'num' : '') + (c.key === "name" ? ' st-sticky' : '') + '" aria-sort="' + (on ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
      '<button type="button" onclick="sortStandingsTable(\'' + c.key + '\')">' + c.label + (on ? '<i data-lucide="' + (dir > 0 ? 'chevron-up' : 'chevron-down') + '"></i>' : '') + '</button></th>';
  }).join("");
  var body = rows.map(function(r) {
    var isMe = meLow && r.name.toLowerCase() === meLow;
    var status = String(r.breakdown || "").replace(/<[^>]*>/g, "").trim();
    return '<tr' + (isMe ? ' class="is-me"' : '') + '>' +
      '<td class="num"><span class="rank' + (r.seasonRank <= 3 ? ' top3' : '') + '">' + (r.seasonTied ? 'T' : '') + r.seasonRank + '</span></td>' +
      '<th scope="row" class="st-sticky"><button type="button" class="link-btn" data-name="' + escapeShellHtml(r.name) + '" onclick="openPlayerSheet(this.getAttribute(\'data-name\'))">' + escapeShellHtml(r.name) + '</button>' +
        (r.live ? '<span class="st-live">Live</span>' : '') + '</th>' +
      '<td class="num">' + r.priorPts + '</td><td class="num">' + r.liveInProgPts + '</td><td class="num">' + r.finalPts + '</td>' +
      '<td class="num"><strong>' + r.seasonPts + '</strong></td><td class="st-status">' + escapeShellHtml(status) + '</td></tr>';
  }).join("");
  el.innerHTML = '<div class="st-table-scroll" role="region" aria-label="Full standings table" tabindex="0"><table class="st-table"><thead><tr>' + head + '</tr></thead><tbody>' +
    (body || '<tr><td colspan="7" class="muted-note">No players match that search.</td></tr>') + '</tbody></table></div>';
}

// Table needs Advanced mode; in Simple mode the list always shows.
var _standingsListOnly = renderStandingsList;
renderStandingsList = function() {
  var table = STANDINGS_LAYOUT === "table" && !SIMPLE_UI_MODE;
  var li = document.getElementById("st-layout-list"), ta = document.getElementById("st-layout-table");
  if (li) li.setAttribute("aria-pressed", table ? "false" : "true");
  if (ta) ta.setAttribute("aria-pressed", table ? "true" : "false");
  var wrap = document.getElementById("standings-view-container");
  if (wrap) wrap.classList.toggle("is-table", table);
  var tv = document.getElementById("standings-table-view");
  if (tv) tv.hidden = !table;
  var res = _standingsListOnly.apply(this, arguments);
  if (table) renderStandingsTable(computeStandingsRows());
  if (FINISH_ODDS_OPEN && !SIMPLE_UI_MODE && typeof renderMonteCarloSimulatorBox === "function") renderMonteCarloSimulatorBox();
  return res;
};

// ---------- Finish odds (Advanced): simulations only run while the section is open ----------
function onFinishOddsToggle(el) {
  FINISH_ODDS_OPEN = !!(el && el.open);
  if (FINISH_ODDS_OPEN && typeof renderMonteCarloSimulatorBox === "function") renderMonteCarloSimulatorBox();
}

var _standingsUiPrevRender = renderStandingsAndGradingView;
renderStandingsAndGradingView = function() {
  var result = _standingsUiPrevRender.apply(this, arguments);
  renderStandingsList();
  return result;
};

// ---------- Commissioner pieces live in the Console (Submissions tab) ----------
// Grading cards and the pool-wide watchlist editor are parked in #console-parking;
// they move into the Console while it shows Submissions and go back before each redraw.
var CONSOLE_PARKED_IDS = ["automated-grading-cards", "standings-watchlist-box"];
function parkConsolePieces() {
  var park = document.getElementById("console-parking");
  if (!park) return;
  CONSOLE_PARKED_IDS.forEach(function(id) {
    var n = document.getElementById(id);
    if (n && n.parentNode !== park) park.appendChild(n);
  });
  var sec = document.getElementById("console-grading-section");
  if (sec) sec.parentNode.removeChild(sec);
}
var _standingsPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  parkConsolePieces();
  var res = _standingsPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (body && ACTIVE_COMMISH_TAB === "submissions" && isVerifiedCommissioner()) {
    var sec = document.createElement("section");
    sec.id = "console-grading-section";
    sec.className = "console-grading";
    sec.innerHTML = '<h3 class="console-h">Grading and watchlist</h3>';
    CONSOLE_PARKED_IDS.forEach(function(id) { var n = document.getElementById(id); if (n) sec.appendChild(n); });
    body.appendChild(sec);
  }
  return res;
};
var _standingsPrevCloseCommish = closeCommissionerModal;
closeCommissionerModal = function() {
  parkConsolePieces();
  return _standingsPrevCloseCommish.apply(this, arguments);
};
