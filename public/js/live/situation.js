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

// ============================================================================
// LIVE ALERTS: red zone, 4Q / OT sweats and upset alerts for the glowing card outlines.
// evaluateLiveGameAlertState(liveState, userPick, slateGame) -> {
//   isRedZone, possessingTeam, possessingCode, downDistanceText, yardsToEndzone,
//   is4QSweat, overtime, clockText, sweatTier: "upset-sweat" | "user-sweat" | "league-sweat" | null,
//   pickStatus: "HOLDING LEAD" | "TIED" | "CHASING" | null, pickPts, margin,
//   isUpsetAlert, isUpsetWatch,
//   alertState: "redzone-4q-combo" | "redzone" | "4q-sweat" | "upset-alert" | "none"
// }
// liveState is a LIVE_SCORES entry; userPick is the picked team's name (or null).
// ============================================================================
function evaluateLiveGameAlertState(liveState, userPick, slateGame) {
  var g = slateGame || {};
  var ls = liveState || {};
  var picks = null;
  if (userPick) { picks = {}; picks[g.id] = userPick; }
  var sit = getGameSituation(ls, g, picks);
  var live = sit.state === "live";
  var halftime = /half/i.test(String(ls.detail || ""));
  var a = typeof ls.awayScore === "number" ? ls.awayScore : 0;
  var h = typeof ls.homeScore === "number" ? ls.homeScore : 0;

  // Red zone: ESPN's flag, the ball inside the 20, or the demo override.
  var yl = typeof ls.yardLine100 === "number" ? ls.yardLine100 : null;
  var yardsToEndzone = (sit.possession && yl !== null) ? (sit.possession === "away" ? 100 - yl : yl) : null;
  var isRedZone = live && !halftime && (sit.redZone || ls.forceRedZone === true || g.forceRedZone === true);
  var possessingTeam = sit.possession ? (sit.possession === "away" ? g.away : g.home) : null;
  var possessingCode = sit.possession ? (sit.possession === "away" ? (ls.awayAbbr || g.awayCode) : (ls.homeAbbr || g.homeCode)) : null;

  // 4Q / OT sweat: one-possession game in the 4th quarter or overtime.
  var margin = Math.abs(a - h);
  var is4QSweat = live && (sit.period >= 4 || sit.overtime) && margin <= LIVE_SITUATION_CONFIG.closeMargin;

  var mySide = userPick ? (isSameTeamPick(userPick, g.away, g) ? "away" : (isSameTeamPick(userPick, g.home, g) ? "home" : null)) : null;
  var pickPts = mySide ? getGamePickPts(g, mySide === "away") : 0;
  var pickStatus = null;
  if (mySide && live) pickStatus = !sit.leader ? "TIED" : (sit.leader === mySide ? "HOLDING LEAD" : "CHASING");

  // Underdog worth 2x or 3x: "upset alert" when it leads in the 2nd half, "upset watch" when it
  // leads or is within one score.
  var dog = underdogForGame(g);
  var dogSide = dog ? (isSameTeamPick(dog, g.away, g) ? "away" : "home") : null;
  var dogPts = dogSide ? getGamePickPts(g, dogSide === "away") : 0;
  var isUpsetAlert = live && dogPts >= 2 && sit.period >= LIVE_SITUATION_CONFIG.upsetFromPeriod && sit.leader === dogSide;
  var isUpsetWatch = live && dogPts >= 2 && (sit.leader === dogSide || margin <= LIVE_SITUATION_CONFIG.closeMargin);

  var sweatTier = null;
  if (is4QSweat) {
    if (mySide && mySide === dogSide && pickPts >= 2) sweatTier = "upset-sweat";
    else if (mySide) sweatTier = "user-sweat";
    else {
      var own = (typeof getGamePoolOwnership === "function") ? getGamePoolOwnership(g) : null;
      // League swing: the pool is split, or someone gains big leverage on the outcome.
      if (own && (own.isHighLeverage || (own.total && own.awayPct >= 30 && own.awayPct <= 70))) sweatTier = "league-sweat";
    }
  }

  var alertState = (isRedZone && is4QSweat) ? "redzone-4q-combo"
    : (isRedZone ? "redzone" : (is4QSweat ? "4q-sweat" : (isUpsetAlert ? "upset-alert" : "none")));

  var clock = String(ls.detail || "").match(/\d{1,2}:\d{2}/);
  return {
    isRedZone: isRedZone, possessingTeam: possessingTeam, possessingCode: possessingCode,
    downDistanceText: ls.downDistanceText || "", yardsToEndzone: yardsToEndzone,
    is4QSweat: is4QSweat, overtime: sit.overtime, clockText: clock ? clock[0] : "",
    sweatTier: sweatTier, pickStatus: pickStatus, pickPts: pickPts, pickTeam: mySide ? userPick : null,
    margin: margin, isUpsetAlert: isUpsetAlert, isUpsetWatch: isUpsetWatch, alertState: alertState
  };
}

// Alert for a slate game from the current scores and the viewer's own (visible) pick.
// The live state alerts read: the demo sim's drive while this game is showing the sim
// (demo-sim.js), otherwise the real score.
function liveStateForAlerts(g) {
  var sim = typeof demoSimLiveState === "function" ? demoSimLiveState(g) : null;
  if (sim) return sim;
  return (typeof LIVE_SCORES !== "undefined" && LIVE_SCORES[g.id]) || null;
}

function liveAlertForGame(g) {
  var ls = liveStateForAlerts(g);
  if (!ls || !ls.inProgress || ls.completed) return null;
  var hidden = (typeof isProfileHiddenFromViewer === "function") && isProfileHiddenFromViewer(activeProfile, g.id);
  var pick = hidden ? null : getResolvedPickForGame(getMyPicksMap(), g, false);
  return evaluateLiveGameAlertState(ls, pick, g);
}

// Card classes: is-redzone, is-4q-sweat, is-redzone-4q-combo, is-upset-alert (+ is-upset-sweat).
function liveAlertClass(alert) {
  if (!alert || alert.alertState === "none") return "";
  var cls = { "redzone-4q-combo": " is-redzone-4q-combo", "redzone": " is-redzone", "4q-sweat": " is-4q-sweat", "upset-alert": " is-upset-alert" }[alert.alertState] || "";
  if (alert.sweatTier === "upset-sweat") cls += " is-upset-sweat";
  return cls;
}

// Header pills. Words carry the meaning (emoji are stripped app-wide); icons only decorate.
function liveAlertBadgesHtml(alert) {
  if (!alert || alert.alertState === "none") return "";
  var esc = escapeShellHtml;
  var html = "";
  if (alert.isRedZone) {
    html += '<span class="alert-pill is-redzone"><span class="alert-dot" aria-hidden="true"></span><i data-lucide="siren"></i>Red zone' +
      (alert.possessingCode ? ' · ' + esc(alert.possessingCode) + ' ball' : '') +
      (alert.downDistanceText ? ' (' + esc(alert.downDistanceText) + ')' : '') + '</span>';
  }
  if (alert.is4QSweat) {
    var label = alert.isRedZone ? (alert.overtime ? "OT crunch time" : "4Q crunch time") : (alert.overtime ? "OT sweat" : "4Q sweat");
    html += '<span class="alert-pill is-sweat"><i data-lucide="flame"></i>' + label + (alert.clockText && !alert.overtime ? ' · ' + esc(alert.clockText) + ' Q4' : '') + '</span>';
    if (alert.pickStatus) {
      var team = esc(alert.pickTeam) + ' +' + alert.pickPts + 'pt';
      var stake = alert.pickStatus === "HOLDING LEAD" ? ('Your pick (' + team + ') protecting a ' + alert.margin + '-pt lead')
        : (alert.pickStatus === "TIED" ? ('Your pick (' + team + ') tied') : ('Your pick (' + team + ') chasing by ' + alert.margin));
      html += '<span class="alert-pill is-stake' + (alert.pickStatus === "HOLDING LEAD" ? ' is-holding' : '') + '">' +
        '<i data-lucide="' + (alert.pickStatus === "HOLDING LEAD" ? 'shield' : 'timer') + '"></i>' + stake + '</span>';
    }
    if (alert.sweatTier === "upset-sweat") html += '<span class="alert-pill is-upset"><i data-lucide="zap"></i>' + alert.pickPts + 'x upset sweat</span>';
  } else if (alert.isUpsetAlert) {
    html += '<span class="alert-pill is-upset"><i data-lucide="zap"></i>Upset alert</span>';
  }
  return '<div class="alert-pills">' + html + '</div>';
}

// Counts for the Live filter pills and the nav badge.
function liveAlertCounts() {
  var out = { redzone: 0, sweat: 0, upset: 0, any: 0 };
  for (var i = 0; i < GAMES.length; i++) {
    var al = liveAlertForGame(GAMES[i]);
    if (!al) continue;
    if (al.isRedZone) out.redzone++;
    if (al.is4QSweat) out.sweat++;
    if (al.isUpsetWatch) out.upset++;
    if (al.isRedZone || al.is4QSweat) out.any++;
  }
  return out;
}
