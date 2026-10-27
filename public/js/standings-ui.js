// ============================================================================
// STANDINGS SCREEN UI: Week / Season list with rank, points and points back.
// Uses buildPoolLeaderboardRows(), the same rows the full breakdown table uses.
// ============================================================================
var STANDINGS_SCOPE = "season"; // "season" | "week"

function setStandingsScope(scope) {
  STANDINGS_SCOPE = (scope === "week") ? "week" : "season";
  renderStandingsList();
}

function renderStandingsList() {
  var box = document.getElementById("standings-list");
  if (!box) return;
  var wk = document.getElementById("st-scope-week");
  var se = document.getElementById("st-scope-season");
  if (wk) wk.setAttribute("aria-pressed", STANDINGS_SCOPE === "week" ? "true" : "false");
  if (se) se.setAttribute("aria-pressed", STANDINGS_SCOPE === "season" ? "true" : "false");

  var rows = [];
  try { rows = buildPoolLeaderboardRows(); } catch (e) { rows = []; }
  var isWeek = STANDINGS_SCOPE === "week";
  var list = rows.map(function(r) {
    return {
      name: r.name,
      pts: isWeek ? Math.max(r.liveTotalWk || 0, r.finalPts || 0) : (r.newTotal || 0),
      waiting: !!r.awaitingSheet,
      live: isWeek && (r.liveInProgPts || 0) > 0
    };
  });
  list.sort(function(a, b) { return b.pts - a.pts; });

  var me = getMyLeaderboardNameLower();
  var qEl = document.getElementById("leaderboard-search-input");
  var q = (qEl ? qEl.value : "").trim().toLowerCase();
  var leaderPts = list.length ? list[0].pts : 0;

  var html = '<div class="st-row st-head" role="row">' +
    '<span role="columnheader">#</span><span role="columnheader">Player</span>' +
    '<span role="columnheader" class="num">Pts</span><span role="columnheader" class="num">Back</span></div>';
  var shown = 0;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var ahead = 0;
    while (ahead < i && list[ahead].pts > r.pts) ahead++;
    var rank = ahead + 1;
    var tied = (i > 0 && list[i - 1].pts === r.pts) || (i + 1 < list.length && list[i + 1].pts === r.pts);
    if (q && r.name.toLowerCase().indexOf(q) === -1) continue;
    shown++;
    var isMe = me && r.name.toLowerCase() === me;
    var back = leaderPts - r.pts;
    html += '<div class="st-row' + (isMe ? ' is-me' : '') + '" role="row">' +
      '<span class="rank' + (rank <= 3 ? ' top3' : '') + '" role="cell">' + (tied ? 'T' : '') + rank + '</span>' +
      '<span class="st-name" role="cell">' + escapeShellHtml(r.name) +
        (isMe ? '<span class="you-tag">You</span>' : '') +
        (isWeek && r.waiting ? '<span class="st-sub">No sheet yet</span>' : '') +
      '</span>' +
      '<span class="num st-pts" role="cell">' + r.pts + '</span>' +
      '<span class="num st-back" role="cell">' + (back > 0 ? back : '–') + '</span>' +
    '</div>';
  }
  if (!shown) html += '<p class="empty-note">' + (rows.length ? 'No players match that search.' : 'Standings appear once the pool syncs.') + '</p>';
  box.innerHTML = html;
  var cnt = document.getElementById("leaderboard-count-label");
  if (cnt) cnt.textContent = list.length ? (list.length + " entries" + (isWeek ? " · this week's points" : " · season points")) : "";
}

var _standingsUiPrevRender = renderStandingsAndGradingView;
renderStandingsAndGradingView = function() {
  var result = _standingsUiPrevRender.apply(this, arguments);
  renderStandingsList();
  return result;
};
