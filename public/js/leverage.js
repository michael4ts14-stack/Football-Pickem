// ============================================================================
// FEATURE A: POOL-WIDE PICK OWNERSHIP % & LEVERAGE CALCULATOR
// ============================================================================
function getGamePoolOwnership(g) {
  if (!g) return { awayCount: 0, homeCount: 0, total: 0, awayPct: 50, homePct: 50, awayLev: 0, homeLev: 0, isHighLeverage: false, bestLevTeam: "", bestLevEdge: 0, sourceLabel: "Model" };
  var awayCount = 0, homeCount = 0;
  var pmList = (state.poolMembers && Array.isArray(state.poolMembers)) ? state.poolMembers : [];
  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    if (!pm || pm.awaitingSheet || !pm.picks) continue;
    var p = getResolvedPickForGame(pm.picks, g, false);
    if (!p) continue;
    if (isSameTeamPick(p, g.away, g)) awayCount++;
    else if (isSameTeamPick(p, g.home, g)) homeCount++;
  }
  var sourceLabel = "Pool";
  if (awayCount + homeCount < 5) {
    // Fallback to active user profiles + watchlist rivals before Friday/Saturday pool sheet arrives
    sourceLabel = "Early";
    var allProfs = getAllUserProfiles();
    for (var u = 0; u < allProfs.length; u++) {
      var pf = allProfs[u];
      if (pf.isSandbox) continue;
      var up = (state[pf.key] && state[pf.key].picks) ? getResolvedPickForGame(state[pf.key].picks, g, true) : null;
      if (up) {
        if (isSameTeamPick(up, g.away, g)) awayCount++;
        else if (isSameTeamPick(up, g.home, g)) homeCount++;
      }
    }
    if (state.watchlist && Array.isArray(state.watchlist)) {
      for (var w = 0; w < state.watchlist.length; w++) {
        var wp = getResolvedPickForGame(state.watchlist[w].picks, g, false);
        if (wp) {
          if (isSameTeamPick(wp, g.away, g)) awayCount++;
          else if (isSameTeamPick(wp, g.home, g)) homeCount++;
        }
      }
    }
  }
  var total = awayCount + homeCount;
  var awayPct = total > 0 ? Math.round((awayCount / total) * 100) : Math.round(g.awayProb * 100);
  var homePct = total > 0 ? (100 - awayPct) : Math.round(g.homeProb * 100);

  var awayWinPct = Math.round(g.awayProb * 100);
  var homeWinPct = Math.round(g.homeProb * 100);

  // Leverage = Win Probability % minus Pool Ownership % (plus multiplier bonus for 2x/3x dogs)
  var awayLev = (awayWinPct - awayPct) + (g.awayPts > 1 ? Math.round((g.awayProb * g.awayPts - g.awayProb) * 35) : 0);
  var homeLev = (homeWinPct - homePct) + (g.homePts > 1 ? Math.round((g.homeProb * g.homePts - g.homeProb) * 35) : 0);

  var bestSideIsAway = awayLev >= homeLev;
  var bestLevTeam = bestSideIsAway ? g.away : g.home;
  var bestLevCode = bestSideIsAway ? g.awayCode : g.homeCode;
  var bestLevEdge = bestSideIsAway ? awayLev : homeLev;
  var bestLevOwn = bestSideIsAway ? awayPct : homePct;
  var bestLevWin = bestSideIsAway ? awayWinPct : homeWinPct;
  var bestLevPts = bestSideIsAway ? g.awayPts : g.homePts;

  var isHighLeverage = (bestLevEdge >= 12 && bestLevWin >= 26) || (bestLevPts >= 2 && bestLevOwn <= 28 && bestLevWin >= 31);

  return {
    awayCount: awayCount,
    homeCount: homeCount,
    total: total,
    awayPct: awayPct,
    homePct: homePct,
    awayLev: awayLev,
    homeLev: homeLev,
    bestLevTeam: bestLevTeam,
    bestLevCode: bestLevCode,
    bestLevEdge: bestLevEdge,
    bestLevOwn: bestLevOwn,
    bestLevWin: bestLevWin,
    isHighLeverage: isHighLeverage,
    sourceLabel: sourceLabel
  };
}

