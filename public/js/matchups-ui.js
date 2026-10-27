// ============================================================================
// MATCHUP INFO: reads live_games/week_N_matchups (built from ESPN by the GitHub Actions
// job in tools/matchups) and renders it on pick cards and in the game detail sheet.
// Browsers never call ESPN for this data. Any value that is missing hides its row.
// ============================================================================
var MATCHUPS = {};            // slate game id -> matchup entry
var MATCHUPS_WEEK = 0;
var _matchupsUnsub = null;
var UPSET_POOL_PCT = 75;      // pool on one side at or above this...
var UPSET_WIN_PCT = 60;       // ...while ESPN gives that side less than this

function subscribeMatchupsForWeek() {
  var wk = parseInt(state.currentWeek, 10) || 0;
  if (!fsDb || !wk || wk === MATCHUPS_WEEK) return;
  MATCHUPS_WEEK = wk;
  if (_matchupsUnsub) { try { _matchupsUnsub(); } catch (e) {} }
  MATCHUPS = {};
  try {
    _matchupsUnsub = fsDb.collection("live_games").doc("week_" + wk + "_matchups").onSnapshot(function(doc) {
      MATCHUPS = (doc && doc.exists && doc.data() && doc.data().games) ? doc.data().games : {};
      if (currentMainView === "cards") renderGames();
      else renderGameDetailSheet();
    }, function(err) {});
  } catch (e) {}
}

function getMatchup(g) {
  return (g && MATCHUPS[String(g.id)]) || null;
}

function isNum(v) { return typeof v === "number" && isFinite(v); }
function fmtNum(v, digits) {
  if (!isNum(v)) return "";
  var d = (typeof digits === "number") ? digits : (Math.abs(v) < 100 && v % 1 !== 0 ? 1 : 0);
  return v.toFixed(d);
}
function fmtSpread(v) {
  if (!isNum(v)) return "";
  if (v === 0) return "PK";
  return (v < 0 ? "−" : "+") + Math.abs(v);
}

// ESPN win % for each side, or null.
function matchupWinPct(m) {
  if (!m || !m.predictor || !isNum(m.predictor.awayPct) || !isNum(m.predictor.homePct)) return null;
  return { away: m.predictor.awayPct, home: m.predictor.homePct };
}

// ---------- Pool features ----------
// "Upset alert": 75%+ of the pool on one side but ESPN gives that side under 60%.
// Uses the pool split, so like the split it only shows once the game is locked.
function upsetAlertFor(g, ownInfo) {
  var wp = matchupWinPct(getMatchup(g));
  if (!wp || !ownInfo || !ownInfo.total || !isGameLockedByCommissioner(g.id)) return null;
  if (ownInfo.awayPct >= UPSET_POOL_PCT && wp.away < UPSET_WIN_PCT) return { team: g.away, poolPct: ownInfo.awayPct, winPct: wp.away };
  if (ownInfo.homePct >= UPSET_POOL_PCT && wp.home < UPSET_WIN_PCT) return { team: g.home, poolPct: ownInfo.homePct, winPct: wp.home };
  return null;
}

// Your season record when you picked `teamName` (archived weeks + finished games this week).
function mySeasonRecordPicking(teamName) {
  var me = (typeof getMyLeaderboardNameLower === "function") ? getMyLeaderboardNameLower() : "";
  if (!me || !teamName) return null;
  var w = 0, l = 0;
  var tally = function(games, picks, scores) {
    if (!games || !picks || !scores) return;
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      var ls = scores[g.id] || scores[String(g.id)];
      if (!ls || !ls.completed || ls.awayScore === ls.homeScore) continue;
      var pick = getResolvedPickForGame(picks, g, false);
      if (!pick || !isSameTeamPick(pick, teamName, g)) continue;
      var winner = ls.awayScore > ls.homeScore ? g.away : g.home;
      if (isSameTeamPick(pick, winner, g)) w++; else l++;
    }
  };
  var memberPicks = function(list) {
    for (var i = 0; i < (list || []).length; i++) {
      if (standardizeParticipantName(list[i].name).toLowerCase() === me) return list[i].picks;
    }
    return null;
  };
  var curWk = parseInt(state.currentWeek, 10) || 0;
  var arch = state.weekArchives || {};
  for (var key in arch) {
    var snap = arch[key];
    if (!snap || !snap.weekNum || snap.weekNum >= curWk) continue;
    tally(snap.games, memberPicks(snap.poolMembers), snap.liveScores);
  }
  tally(GAMES, getMyPicksMap(), LIVE_SCORES);
  return (w + l) ? { w: w, l: l } : null;
}

// ---------- Pick card: one extra line ----------
function lastFiveLettersHtml(t) {
  var l5 = (t && t.last5) || [];
  if (!l5.length) return '<span class="l5-letters"></span>';
  var html = l5.slice(0, 5).map(function(e) {
    var r = String(e.result || "").charAt(0);
    return '<span class="l5-' + (r === "W" ? "w" : (r === "L" ? "l" : "t")) + '">' + escapeShellHtml(r) + '</span>';
  }).join("");
  return '<span class="l5-letters" aria-label="' + escapeShellHtml((t.abbr || t.shortName || "") + " last 5: " + l5.map(function(e) { return e.result; }).join(" ")) + '">' + html + '</span>';
}

function winBarHtml(wp, awayLabel, homeLabel, large) {
  if (!wp) return "";
  var a = Math.round(wp.away), h = Math.round(wp.home);
  return '<span class="win-bar' + (large ? ' is-large' : '') + '" role="img" aria-label="ESPN win probability: ' + escapeShellHtml(awayLabel) + ' ' + a + '%, ' + escapeShellHtml(homeLabel) + ' ' + h + '%">' +
    '<span class="win-num">' + a + '%</span>' +
    '<span class="win-track"><span class="win-away" style="width:' + a + '%"></span><span class="win-home" style="width:' + h + '%"></span></span>' +
    '<span class="win-num">' + h + '%</span>' +
  '</span>';
}

function matchupCardLineHtml(g) {
  var m = getMatchup(g);
  if (!m) return "";
  var wp = matchupWinPct(m);
  var hasL5 = (m.away && m.away.last5) || (m.home && m.home.last5);
  if (!wp && !hasL5) return "";
  return '<div class="matchup-line">' +
    lastFiveLettersHtml(m.away) +
    (wp ? winBarHtml(wp, g.away, g.home, false) : '<span></span>') +
    lastFiveLettersHtml(m.home) +
  '</div>';
}

// ---------- Detail sheet sections (in the owner's order) ----------
function sheetSection(title, inner) {
  return inner ? '<section class="sheet-section"><h3 class="sheet-h">' + title + '</h3>' + inner + '</section>' : "";
}

function matchupSheetSectionsHtml(g) {
  var m = getMatchup(g);
  if (!m) return "";
  var a = m.away || {}, h = m.home || {};
  var aName = a.shortName || g.away, hName = h.shortName || g.home;
  var html = "";

  // 1. Win probability + spread (opening -> current; arrow when it moved 1.5+ points)
  var wp = matchupWinPct(m);
  var spreadHtml = "";
  var sp = m.spread || {};
  if (isNum(sp.homeCurrent)) {
    var homeAbbr = h.abbr || hName;
    var fav = (sp.homeCurrent <= 0) ? homeAbbr : (a.abbr || aName);
    var favLine = (sp.homeCurrent <= 0) ? sp.homeCurrent : -sp.homeCurrent;
    var openFavLine = isNum(sp.homeOpen) ? ((sp.homeCurrent <= 0) ? sp.homeOpen : -sp.homeOpen) : null;
    var moved = isNum(openFavLine) ? (favLine - openFavLine) : 0;
    spreadHtml = '<div class="kv"><span>Spread' + (sp.provider ? ' (' + escapeShellHtml(sp.provider) + ')' : '') + '</span><strong>' +
      escapeShellHtml(fav) + ' ' +
      (isNum(openFavLine) && openFavLine !== favLine ? '<span class="muted">' + fmtSpread(openFavLine) + '</span> → ' : '') +
      fmtSpread(favLine) +
      (Math.abs(moved) >= 1.5 ? ' <i data-lucide="' + (moved > 0 ? 'trending-down' : 'trending-up') + '"></i><span class="sr-only">' + (moved > 0 ? ' line moved toward the underdog' : ' line moved toward the favorite') + '</span>' : '') +
      '</strong></div>' +
      (isNum(sp.overUnder) ? '<div class="kv"><span>Over / under</span><strong>' + fmtNum(sp.overUnder, 1) + '</strong></div>' : '');
  }
  html += sheetSection("Win probability", (wp ? winBarHtml(wp, aName, hName, true) + '<div class="win-labels"><span>' + escapeShellHtml(aName) + '</span><span>ESPN predictor</span><span>' + escapeShellHtml(hName) + '</span></div>' : '') + spreadHtml);

  // 2. Key players
  var playersCol = function(t, name) {
    if (!t.leaders || !t.leaders.length) return "";
    return '<div class="players-col"><div class="sub-col-title">' + escapeShellHtml(name) + '</div>' +
      t.leaders.map(function(p) {
        return '<div class="player-row">' +
          '<span class="headshot">' + (p.headshot ? '<img src="' + escapeShellHtml(p.headshot) + '" alt="" loading="lazy" onerror="this.remove()" />' : '') + '</span>' +
          '<span class="player-text"><span class="player-name">' + escapeShellHtml(p.name) + (p.position ? ' <span class="muted">' + escapeShellHtml(p.position) + '</span>' : '') + '</span>' +
          '<span class="player-stat">' + escapeShellHtml(p.statLine) + '</span></span>' +
        '</div>';
      }).join("") + '</div>';
  };
  var players = playersCol(a, aName) + playersCol(h, hName);
  html += sheetSection("Key players", players ? '<div class="players-grid">' + players + '</div>' : "");

  // 3. Team comparison: side-by-side bars
  var rows = [
    ["ppg", "Points per game", true, 1], ["papg", "Points allowed", false, 1], ["ypg", "Yards per game", true, 1],
    ["yapg", "Yards allowed", false, 1], ["toMargin", "Turnover margin", true, 0], ["thirdPct", "3rd-down %", true, 1],
  ];
  var cmp = "";
  var as = a.stats || {}, hs = h.stats || {}, ar = a.ranks || {}, hr = h.ranks || {};
  for (var i = 0; i < rows.length; i++) {
    var k = rows[i][0], label = rows[i][1], higher = rows[i][2], dig = rows[i][3];
    if (!isNum(as[k]) || !isNum(hs[k])) continue;
    var av = as[k], hv = hs[k];
    var aBetter = higher ? av > hv : av < hv, hBetter = higher ? hv > av : hv < av;
    var lo = Math.min(av, hv, 0), span = Math.max(Math.abs(av - lo), Math.abs(hv - lo)) || 1;
    var aw = Math.max(4, Math.round(Math.abs(av - lo) / span * 100)), hw = Math.max(4, Math.round(Math.abs(hv - lo) / span * 100));
    var sign = function(v) { return (k === "toMargin" && v > 0 ? "+" : "") + fmtNum(v, dig); };
    cmp += '<div class="cmp-row">' +
      '<span class="cmp-label">' + label + '</span>' +
      '<span class="cmp-val' + (aBetter ? ' is-better' : '') + '">' + sign(av) + (isNum(ar[k]) ? ' <span class="cmp-rank">#' + ar[k] + '</span>' : '') + '</span>' +
      '<span class="cmp-bar away' + (aBetter ? ' is-better' : '') + '"><span style="width:' + aw + '%"></span></span>' +
      '<span class="cmp-bar home' + (hBetter ? ' is-better' : '') + '"><span style="width:' + hw + '%"></span></span>' +
      '<span class="cmp-val' + (hBetter ? ' is-better' : '') + '">' + (isNum(hr[k]) ? '<span class="cmp-rank">#' + hr[k] + '</span> ' : '') + sign(hv) + '</span>' +
    '</div>';
  }
  html += sheetSection("Team comparison", cmp ? '<div class="cmp-head"><span>' + escapeShellHtml(aName) + '</span><span>' + escapeShellHtml(hName) + '</span></div>' + cmp +
    (m.rankOf ? '<p class="sheet-note">#: national rank among ' + m.rankOf + ' FBS teams.</p>' : '') : "");

  // 4. Matchup edges
  var edges = (m.edges || []).filter(Boolean);
  html += sheetSection("Matchup edges", edges.length ? '<ul class="edge-list">' + edges.map(function(e) { return '<li>' + escapeShellHtml(e) + '</li>'; }).join("") + '</ul>' : "");
  return html;
}

// Section 6: last 5 (opponent, score, covered) + ATS record, from the matchup doc.
function matchupLastFiveHtml(g) {
  var m = getMatchup(g);
  if (!m) return "";
  var col = function(t, name) {
    var l5 = (t && t.last5) || [];
    if (!l5.length) return "";
    var ats = t.ats;
    return '<div><div class="sub-col-title"><span>' + escapeShellHtml(name) + '</span>' +
        (ats ? '<span class="muted">ATS ' + ats.w + '–' + ats.l + (ats.p ? '–' + ats.p : '') + '</span>' : '') + '</div>' +
      '<table class="l5-table"><tbody>' + l5.map(function(e) {
        return '<tr><td><span class="wl-badge wl-' + escapeShellHtml(e.result) + '">' + escapeShellHtml(e.result) + '</span></td>' +
          '<td>' + (e.homeAway === "away" ? "at " : "vs ") + escapeShellHtml(e.oppAbbr || e.oppName) + '</td>' +
          '<td class="num">' + escapeShellHtml(e.score) + '</td>' +
          '<td class="num">' + (e.covered === "Y" ? 'Covered' : (e.covered === "N" ? '<span class="muted">Didn\'t cover</span>' : (e.covered === "P" ? 'Push' : ''))) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  };
  var html = col(m.away, (m.away && m.away.shortName) || g.away) + col(m.home, (m.home && m.home.shortName) || g.home);
  return html ? '<div class="dual-panel">' + html + '</div><p class="sheet-note">Covered = beat the closing spread (our calculation from ESPN lines).</p>' : "";
}

// Section 7: venue, weather, TV (no head-to-head history: ESPN doesn't provide it).
var WEATHER_WORDS = { "1": "Sunny", "2": "Mostly sunny", "3": "Partly sunny", "4": "Intermittent clouds", "5": "Hazy", "6": "Mostly cloudy", "7": "Cloudy", "8": "Overcast", "11": "Fog", "12": "Showers", "15": "Thunderstorms", "18": "Rain", "19": "Flurries", "22": "Snow", "33": "Clear", "34": "Mostly clear", "35": "Partly cloudy", "38": "Mostly cloudy" };
function matchupGameInfoHtml(g) {
  var m = getMatchup(g);
  var rows = [];
  if (m && m.venue && m.venue.name) {
    rows.push(['Venue', m.venue.name + (m.venue.city ? ' · ' + m.venue.city + (m.venue.state ? ', ' + m.venue.state : '') : '') + (m.neutralSite ? ' (neutral site)' : '')]);
  }
  if (m && m.weather && isNum(m.weather.tempF) && !(m.venue && m.venue.indoor)) {
    var wd = WEATHER_WORDS[m.weather.conditionId] || "";
    rows.push(['Weather', Math.round(m.weather.tempF) + '°F' + (wd ? ' · ' + wd : '') + (isNum(m.weather.precipPct) ? ' · ' + Math.round(m.weather.precipPct) + '% rain' : '')]);
  }
  var tv = (m && m.tv && m.tv.length) ? m.tv.join(", ") : parseKickParts(g.kick).net;
  if (tv) rows.push(['TV', tv]);
  return rows.map(function(r) { return '<div class="kv"><span>' + r[0] + '</span><strong>' + escapeShellHtml(r[1]) + '</strong></div>'; }).join("");
}

// Re-subscribe when the week changes (new slate published, archive switch back).
var _matchupsPrevRenderAll = renderAll;
renderAll = function() {
  subscribeMatchupsForWeek();
  return _matchupsPrevRenderAll.apply(this, arguments);
};
