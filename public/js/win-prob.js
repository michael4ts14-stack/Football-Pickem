// ============================================================================
// WIN PROBABILITY: the one place the app gets a team's chance to win.
// ESPN's predictor (live_games/week_N_matchups, the bar under each game) when
// it's there; otherwise an estimate from the locked pool spread. EV, leverage,
// strategies (Optimal EV / Safe Core / Chaser) and the simulators all use this.
// ============================================================================
var WIN_PROB_SPREAD_MODEL = { base: 0.50, perPoint: 0.0235, max: 0.92 };

// Favorite's and underdog's chance from a spread (points, positive number).
function spreadWinProbEstimate(spread) {
  var s = Math.abs(parseFloat(spread) || 0);
  var fav = Math.min(WIN_PROB_SPREAD_MODEL.max, WIN_PROB_SPREAD_MODEL.base + s * WIN_PROB_SPREAD_MODEL.perPoint);
  return { fav: +fav.toFixed(2), dog: +(1 - fav).toFixed(2) };
}

// ESPN predictor for this game as 0..1 per side, or null.
function espnWinProb(g) {
  if (!g || typeof MATCHUPS === "undefined" || !MATCHUPS) return null;
  var m = MATCHUPS[String(g.id)];
  var p = m && m.predictor;
  if (!p || typeof p.awayPct !== "number" || typeof p.homePct !== "number" || !isFinite(p.awayPct) || !isFinite(p.homePct)) return null;
  var tot = p.awayPct + p.homePct;
  if (tot <= 0) return null;
  return { away: p.awayPct / tot, home: p.homePct / tot };
}

// side: "away" | "home". Returns 0..1.
function getTeamWinProb(g, side) {
  if (!g) return 0.5;
  var espn = espnWinProb(g);
  if (espn) return espn[side === "home" ? "home" : "away"];
  // Fallback: the spread estimate stored on the game (older slates call it awayProb / homeProb).
  var est = side === "home"
    ? (typeof g.homeProbEstimate === "number" ? g.homeProbEstimate : g.homeProb)
    : (typeof g.awayProbEstimate === "number" ? g.awayProbEstimate : g.awayProb);
  return (typeof est === "number" && isFinite(est)) ? est : 0.5;
}

// True when getTeamWinProb() is using the spread estimate for this game.
function isWinProbEstimated(g) { return !espnWinProb(g); }
