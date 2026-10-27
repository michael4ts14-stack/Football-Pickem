// ============================================================================
// GAME SITUATION: the single source of truth for live-game states.
// Every live view (Live cards, pick cards, filters, the field) asks this module
// instead of re-deriving "sweat" / red zone / winning on its own.
// Pure: no DOM, no globals except the ones passed in.
// ============================================================================
var LIVE_SITUATION_CONFIG = {
  closeMargin: 8,           // "Close · Q4" and crunch time: within this many points
  crunchSeconds: 5 * 60,    // crunch time: Q4 under 5:00 (or any OT)
  redZoneYards: 20,         // inside the opponent's 20
  upsetFromPeriod: 3        // upset watch: underdog leading from the 2nd half on
};

// "8:42 - 3rd" / "0:35 - 4th" / "2:15 - OT" -> seconds left in the period, or null.
function parseClockSeconds(detail) {
  var m = String(detail || "").match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// The pool's Monday line decides the favorite; returns the underdog's name or null (pick'em).
function underdogForGame(game) {
  if (!game) return null;
  var line = String(game.mondayPoolLine || game.poolLine || "");
  var m = line.match(/^(.*?)\s*([-+]?\d+(?:\.\d+)?)\s*$/);
  if (!m || !m[1].trim() || parseFloat(m[2]) === 0) return null;
  var fav = m[1].trim();
  if (isSameTeamPick(fav, game.home, game)) return game.away;
  if (isSameTeamPick(fav, game.away, game)) return game.home;
  return null;
}

/**
 * getGameSituation(liveState, game, userPicks) -> {
 *   state: "pre" | "live" | "final",
 *   period, clockSeconds, overtime,
 *   possession: "away" | "home" | null,
 *   redZone, goalToGo, closeLate, crunchTime, upsetWatch,
 *   leader: "away" | "home" | null, margin,
 *   myPick: team name | null,
 *   myPickStatus: "leading" | "trailing" | "tied" | "won" | "lost" | "not-started" | null,
 *   tags: [{ key, label }]   // words shown on cards; never colour alone
 * }
 */
function getGameSituation(liveState, game, userPicks) {
  var cfg = LIVE_SITUATION_CONFIG;
  var ls = liveState || {};
  var live = !!ls.inProgress && !ls.completed;
  var final = !!ls.completed;
  var a = typeof ls.awayScore === "number" ? ls.awayScore : 0;
  var h = typeof ls.homeScore === "number" ? ls.homeScore : 0;
  var period = parseInt(ls.period, 10) || 0;
  var clock = parseClockSeconds(ls.detail);
  var overtime = (live || final) && (period > 4 || /\bOT\b/i.test(String(ls.detail || "")));
  var margin = Math.abs(a - h);
  var leader = (live || final) ? (a > h ? "away" : (h > a ? "home" : null)) : null;
  var possession = live && (ls.possessionSide === "away" || ls.possessionSide === "home") ? ls.possessionSide : null;

  // Field position: 0 = away end zone, 100 = home end zone. Away attacks toward 100.
  var yl = typeof ls.yardLine100 === "number" ? ls.yardLine100 : null;
  var yardsToGo = (possession && yl !== null) ? (possession === "away" ? 100 - yl : yl) : null;
  var redZone = live && (ls.isRedZone === true || (yardsToGo !== null && yardsToGo <= cfg.redZoneYards && yardsToGo > 0));
  var goalToGo = live && /&\s*goal/i.test(String(ls.downDistanceText || ""));

  var closeLate = live && (period >= 4 || overtime) && margin <= cfg.closeMargin;
  var crunchTime = live && margin <= cfg.closeMargin &&
    (overtime || (period === 4 && clock !== null && clock <= cfg.crunchSeconds));

  var dog = underdogForGame(game);
  var dogSide = dog ? (dog === (game && game.away) ? "away" : "home") : null;
  var upsetWatch = live && period >= cfg.upsetFromPeriod && dogSide !== null && leader === dogSide;

  var myPick = (userPicks && game) ? getResolvedPickForGame(userPicks, game, false) : null;
  var myPickStatus = null;
  if (myPick) {
    var mySide = isSameTeamPick(myPick, game.away, game) ? "away" : (isSameTeamPick(myPick, game.home, game) ? "home" : null);
    if (!live && !final) myPickStatus = "not-started";
    else if (!mySide || !leader) myPickStatus = "tied";
    else if (final) myPickStatus = leader === mySide ? "won" : "lost";
    else myPickStatus = leader === mySide ? "leading" : "trailing";
  }

  var tags = [];
  if (overtime && live) tags.push({ key: "ot", label: "OT" });
  if (crunchTime) tags.push({ key: "crunch", label: "Crunch time" });
  else if (closeLate) tags.push({ key: "close", label: overtime ? "Close · OT" : "Close · Q4" });
  if (goalToGo) tags.push({ key: "goal", label: "Goal to go" });
  else if (redZone) tags.push({ key: "redzone", label: "Red zone" });
  if (upsetWatch) tags.push({ key: "upset", label: "Upset watch" });

  return {
    state: final ? "final" : (live ? "live" : "pre"),
    period: period, clockSeconds: clock, overtime: overtime,
    possession: possession,
    redZone: redZone, goalToGo: goalToGo, closeLate: closeLate, crunchTime: crunchTime, upsetWatch: upsetWatch,
    leader: leader, margin: margin,
    myPick: myPick, myPickStatus: myPickStatus,
    tags: tags
  };
}

// The Live "4Q / red zone" filter: games worth watching right now.
function isSweatGame(sit) {
  return !!(sit && (sit.closeLate || sit.crunchTime || (sit.redZone && sit.period >= 4)));
}
