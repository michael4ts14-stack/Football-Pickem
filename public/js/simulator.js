// ============================================================================
// FEATURE B: MONTE CARLO POOL FINISH SIMULATOR (5,000 TRIALS IN-BROWSER)
// ============================================================================
var MONTE_CARLO_CACHE = null;
var MONTE_CARLO_MODE = "weekly"; // "weekly" or "season"

function setMonteCarloSimMode(mode) {
  MONTE_CARLO_MODE = (mode === "season") ? "season" : "weekly";
  runMonteCarloPoolSimulation(5000, true);
  renderStandingsAndGradingView();
}

function runMonteCarloPoolSimulation(numTrials, forceRecompute) {
  var trials = numTrials || 5000;
  var cmpDesc = resolveCompareTargetDescriptor();
  var sig = [
    activeProfile,
    cmpDesc ? cmpDesc.key : "kinyion",
    MONTE_CARLO_MODE,
    state.currentWeek || 8,
    countScoredGamesInLiveScores(),
    JSON.stringify(state[activeProfile] ? state[activeProfile].picks : {}),
    JSON.stringify(cmpDesc ? cmpDesc.picks : {})
  ].join("|");

  if (!forceRecompute && MONTE_CARLO_CACHE && MONTE_CARLO_CACHE.sig === sig) {
    return MONTE_CARLO_CACHE;
  }

  var numGames = GAMES.length;
  var gameAwayPts = new Array(numGames);
  var gameHomePts = new Array(numGames);
  var gameAwayProb = new Array(numGames);
  var gameLockedResult = new Array(numGames); // 1 = away won, 0 = home won, -1 = simulate

  for (var i = 0; i < numGames; i++) {
    var g = GAMES[i];
    gameAwayPts[i] = g.awayPts || 1;
    gameHomePts[i] = g.homePts || 1;
    gameAwayProb[i] = g.awayProb || 0.5;
    var ls = LIVE_SCORES[g.id];
    if (ls && ls.completed && ls.awayScore !== ls.homeScore) {
      gameLockedResult[i] = (ls.awayScore > ls.homeScore) ? 1 : 0;
    } else {
      gameLockedResult[i] = -1;
    }
  }

  var encodePicksBitmask = function(picksMap, allowFallback) {
    var arr = new Array(numGames);
    var validCnt = 0;
    for (var idx = 0; idx < numGames; idx++) {
      var gm = GAMES[idx];
      var p = getResolvedPickForGame(picksMap, gm, allowFallback);
      if (!p) {
        arr[idx] = (gm.awayProb >= gm.homeProb) ? 1 : 0;
      } else {
        validCnt++;
        arr[idx] = isSameTeamPick(p, gm.away, gm) ? 1 : 0;
      }
    }
    return { choices: arr, validCnt: validCnt };
  };

  var actMeta = getProfileMetaByKey(activeProfile);
  var participants = [];
  var seenNames = {};

  // Build contender list from state.poolMembers
  var isWk7Now = isHardcodedWeek7Slate(GAMES);
  var pmList = (state.poolMembers && Array.isArray(state.poolMembers)) ? state.poolMembers : [];
  for (var pIdx = 0; pIdx < pmList.length; pIdx++) {
    var pm = pmList[pIdx];
    if (!pm || !pm.name) continue;
    var stdName = standardizeParticipantName(pm.name);
    var lowKey = stdName.toLowerCase();
    if (seenNames[lowKey]) continue;
    seenNames[lowKey] = true;

    var linkedPf = getProfileLinkedToMemberName(stdName);
    var pMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
    var encoded = encodePicksBitmask(pMap, !!linkedPf);
    var rawPrior = parseFloat(pm.priorPts) || 0;
    var basePrior = (isWk7Now && rawPrior >= 80 && pm.wk7PriorPts !== undefined && rawPrior > pm.wk7PriorPts) ? pm.wk7PriorPts : rawPrior;

    participants.push({
      name: stdName,
      profileKey: linkedPf ? linkedPf.key : ("pm:" + stdName),
      isAct: (linkedPf && linkedPf.key === activeProfile),
      isCmp: (cmpDesc && ((cmpDesc.isPoolMember && lowKey === standardizeParticipantName(cmpDesc.name).toLowerCase()) || (!cmpDesc.isPoolMember && linkedPf && linkedPf.key === cmpDesc.key))),
      priorPts: basePrior,
      choices: encoded.choices,
      hasSheet: encoded.validCnt > 0,
      win1st: 0,
      top5: 0,
      top10: 0,
      sumScore: 0,
      sumRank: 0
    });
  }

  // Ensure Active Profile is always in participants (e.g. if Test Sim or unlinked custom profile)
  var actParticipant = null;
  for (var a = 0; a < participants.length; a++) {
    if (participants[a].isAct) { actParticipant = participants[a]; break; }
  }
  if (!actParticipant) {
    var actEnc = encodePicksBitmask(state[activeProfile] ? state[activeProfile].picks : {}, true);
    actParticipant = {
      name: actMeta.name,
      profileKey: activeProfile,
      isAct: true,
      isCmp: false,
      priorPts: parseFloat(actMeta.priorPts) || 111,
      choices: actEnc.choices,
      hasSheet: true,
      win1st: 0,
      top5: 0,
      top10: 0,
      sumScore: 0,
      sumRank: 0
    };
    participants.unshift(actParticipant);
  }

  var cmpParticipant = null;
  for (var c = 0; c < participants.length; c++) {
    if (participants[c].isCmp) { cmpParticipant = participants[c]; break; }
  }
  if (!cmpParticipant && cmpDesc) {
    var cmpEnc = encodePicksBitmask(cmpDesc.picks || {}, !cmpDesc.isPoolMember);
    cmpParticipant = {
      name: cmpDesc.name,
      profileKey: cmpDesc.key,
      isAct: false,
      isCmp: true,
      priorPts: parseFloat(cmpDesc.priorPts) || 112,
      choices: cmpEnc.choices,
      hasSheet: cmpDesc.hasPicks,
      win1st: 0,
      top5: 0,
      top10: 0,
      sumScore: 0,
      sumRank: 0
    };
    participants.push(cmpParticipant);
  }

  var nContenders = participants.length;
  var scoresBuf = new Array(nContenders);
  var h2hWins = 0, h2hLosses = 0, h2hTies = 0;

  // Track conditional Top-5 finish rate when Active Profile's pick wins vs loses each game
  var gamePickWonTrials = new Array(numGames);
  var gamePickWonTop5 = new Array(numGames);
  var gamePickLostTrials = new Array(numGames);
  var gamePickLostTop5 = new Array(numGames);
  for (var gi = 0; gi < numGames; gi++) {
    gamePickWonTrials[gi] = 0;
    gamePickWonTop5[gi] = 0;
    gamePickLostTrials[gi] = 0;
    gamePickLostTop5[gi] = 0;
  }

  var simOutcome = new Array(numGames);
  var useSeasonMode = (MONTE_CARLO_MODE === "season");

  for (var t = 0; t < trials; t++) {
    for (var gIdx = 0; gIdx < numGames; gIdx++) {
      if (gameLockedResult[gIdx] !== -1) {
        simOutcome[gIdx] = gameLockedResult[gIdx];
      } else {
        simOutcome[gIdx] = (Math.random() < gameAwayProb[gIdx]) ? 1 : 0;
      }
    }

    var maxScore = -1;
    for (var p = 0; p < nContenders; p++) {
      var pt = participants[p];
      var ch = pt.choices;
      var wkPts = 0;
      for (var gmI = 0; gmI < numGames; gmI++) {
        if (ch[gmI] === simOutcome[gmI]) {
          wkPts += (simOutcome[gmI] === 1) ? gameAwayPts[gmI] : gameHomePts[gmI];
        }
      }
      var tot = useSeasonMode ? (pt.priorPts + wkPts) : wkPts;
      scoresBuf[p] = tot;
      pt.sumScore += tot;
      if (tot > maxScore) maxScore = tot;
    }

    var actScore = scoresBuf[participants.indexOf(actParticipant)];
    if (cmpParticipant) {
      var cmpScore = scoresBuf[participants.indexOf(cmpParticipant)];
      if (actScore > cmpScore) h2hWins++;
      else if (cmpScore > actScore) h2hLosses++;
      else h2hTies++;
    }

    // Compute each contender's rank in this trial (1 + number of contenders with strictly higher score)
    for (var p2 = 0; p2 < nContenders; p2++) {
      var mySc = scoresBuf[p2];
      var better = 0;
      for (var q = 0; q < nContenders; q++) {
        if (scoresBuf[q] > mySc) better++;
      }
      var rk = better + 1;
      var pt2 = participants[p2];
      pt2.sumRank += rk;
      if (rk === 1) pt2.win1st++;
      if (rk <= 5) pt2.top5++;
      if (rk <= 10) pt2.top10++;
    }

    // Conditional root-for tracking for Active Profile
    var actBetter = 0;
    for (var q2 = 0; q2 < nContenders; q2++) {
      if (scoresBuf[q2] > actScore) actBetter++;
    }
    var actIsTop5 = (actBetter + 1) <= 5;
    for (var gmJ = 0; gmJ < numGames; gmJ++) {
      if (actParticipant.choices[gmJ] === simOutcome[gmJ]) {
        gamePickWonTrials[gmJ]++;
        if (actIsTop5) gamePickWonTop5[gmJ]++;
      } else {
        gamePickLostTrials[gmJ]++;
        if (actIsTop5) gamePickLostTop5[gmJ]++;
      }
    }
  }

  // Compute Top 3 Root-For Swing Games for Active Profile
  var swingGames = [];
  for (var gmK = 0; gmK < numGames; gmK++) {
    if (gameLockedResult[gmK] !== -1) continue; // Already final
    var wTrials = gamePickWonTrials[gmK];
    var lTrials = gamePickLostTrials[gmK];
    if (wTrials < 20 || lTrials < 20) continue;
    var top5WhenWin = (gamePickWonTop5[gmK] / wTrials) * 100;
    var top5WhenLose = (gamePickLostTop5[gmK] / lTrials) * 100;
    var boost = +(top5WhenWin - top5WhenLose).toFixed(1);
    var gObj = GAMES[gmK];
    var pickedAway = actParticipant.choices[gmK] === 1;
    var pickedTeam = pickedAway ? gObj.away : gObj.home;
    var pickedPts = pickedAway ? gObj.awayPts : gObj.homePts;
    var ownInfo = getGamePoolOwnership(gObj);
    var fieldOwnPct = pickedAway ? ownInfo.awayPct : ownInfo.homePct;
    swingGames.push({
      gameId: gObj.id,
      matchup: gObj.awayCode + " at " + gObj.homeCode,
      pickedTeam: pickedTeam,
      pickedPts: pickedPts,
      fieldOwnPct: fieldOwnPct,
      top5Boost: boost
    });
  }
  swingGames.sort(function(a, b) { return b.top5Boost - a.top5Boost; });

  var leaderboardSim = participants.map(function(p) {
    return {
      name: p.name,
      isAct: p.isAct,
      isCmp: p.isCmp,
      priorPts: p.priorPts,
      avgScore: +(p.sumScore / trials).toFixed(1),
      avgRank: +(p.sumRank / trials).toFixed(1),
      win1stPct: +((p.win1st / trials) * 100).toFixed(1),
      top5Pct: +((p.top5 / trials) * 100).toFixed(1),
      top10Pct: +((p.top10 / trials) * 100).toFixed(1)
    };
  });
  leaderboardSim.sort(function(a, b) {
    if (b.win1stPct !== a.win1stPct) return b.win1stPct - a.win1stPct;
    if (b.top5Pct !== a.top5Pct) return b.top5Pct - a.top5Pct;
    return a.avgRank - b.avgRank;
  });

  var actResult = leaderboardSim.find(function(x) { return x.isAct; }) || leaderboardSim[0];
  var cmpResult = leaderboardSim.find(function(x) { return x.isCmp; }) || null;

  MONTE_CARLO_CACHE = {
    sig: sig,
    trials: trials,
    mode: MONTE_CARLO_MODE,
    contendersCount: nContenders,
    active: actResult,
    compare: cmpResult,
    h2hWinPct: +((h2hWins / trials) * 100).toFixed(1),
    h2hLossPct: +((h2hLosses / trials) * 100).toFixed(1),
    h2hTiePct: +((h2hTies / trials) * 100).toFixed(1),
    topSwingGames: swingGames.slice(0, 3),
    topContenders: leaderboardSim.slice(0, 10)
  };
  return MONTE_CARLO_CACHE;
}

function renderMonteCarloSimulatorBox() {
  var el = document.getElementById("monte-carlo-sim-container");
  if (!el) return;

  var sim = runMonteCarloPoolSimulation(5000, false);
  var actMeta = getProfileMetaByKey(activeProfile);
  var cmpDesc = resolveCompareTargetDescriptor();
  var actHidden = isProfileHiddenFromViewer(activeProfile, null);
  var cmpHidden = cmpDesc ? cmpDesc.isHiddenForGame(null) : false;

  var modeLabel = sim.mode === "season" ? "Overall Season Standings" : (state.weekLabel || "Weekly") + " High Score";

  var swingHtml = "";
  if (actHidden) {
    swingHtml = '<span style="color:var(--muted);">🔒 Unlock active profile to view your Top 3 Root-For Leverage Games.</span>';
  } else if (sim.topSwingGames.length === 0) {
    swingHtml = '<span style="color:var(--green);font-weight:700;">✅ All 23 games are completed — final standings locked!</span>';
  } else {
    for (var s = 0; s < sim.topSwingGames.length; s++) {
      var sg = sim.topSwingGames[s];
      swingHtml += '<span class="badge badge-leverage" style="padding:4px 8px;font-size:0.7rem;cursor:pointer;" onclick="focusGame(' + sg.gameId + ')">' +
        '#' + sg.gameId + ' <strong>' + sg.pickedTeam + ' (' + sg.pickedPts + 'x)</strong> • Pool: ' + sg.fieldOwnPct + '% • <span style="color:#6ee7b7;">+' + sg.top5Boost + '% Top-5 Odds</span>' +
      '</span>';
    }
  }

  var topRowsHtml = "";
  for (var i = 0; i < sim.topContenders.length; i++) {
    var c = sim.topContenders[i];
    var rCls = c.isAct ? "row-highlight-michael" : (c.isCmp ? "row-highlight-kinyion" : "");
    topRowsHtml += '<tr class="' + rCls + '">' +
      '<td><strong>#' + (i + 1) + '</strong></td>' +
      '<td><strong style="color:' + (c.isAct ? actMeta.color : (c.isCmp && cmpDesc ? cmpDesc.color : '#fff')) + ';">' + c.name + (c.isAct ? ' (You)' : (c.isCmp ? ' (H2H)' : '')) + '</strong></td>' +
      '<td>' + c.avgScore + ' pts</td>' +
      '<td><strong>#' + c.avgRank + '</strong></td>' +
      '<td style="color:var(--gold);font-weight:800;">' + c.win1stPct + '%</td>' +
      '<td style="color:var(--green);font-weight:800;">' + c.top5Pct + '%</td>' +
      '<td style="color:var(--accent);font-weight:700;">' + c.top10Pct + '%</td>' +
    '</tr>';
  }

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--border-muted);">' +
      '<div>' +
        '<strong style="font-size:0.9rem;color:#fff;">🎲 Monte Carlo Pool Finish Simulator (' + sim.trials.toLocaleString() + ' Simulated Saturdays vs. ' + sim.contendersCount + ' Pool Entries)</strong>' +
        '<div style="font-size:0.71rem;color:var(--muted);">Simulates all unplayed matchups using true game win probabilities against every pool member\'s actual sheet picks (' + modeLabel + ').</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
        '<button type="button" class="btn-sm' + (sim.mode === "weekly" ? " active" : "") + '" onclick="setMonteCarloSimMode(\'weekly\')">🏆 Weekly Finish Odds</button>' +
        '<button type="button" class="btn-sm' + (sim.mode === "season" ? " active" : "") + '" onclick="setMonteCarloSimMode(\'season\')">📈 Season Standings Odds</button>' +
        '<button type="button" class="btn-sm" style="background:linear-gradient(90deg,#0284c7,#4f46e5);color:#fff;border:none;font-weight:800;" onclick="runMonteCarloPoolSimulation(5000, true); renderStandingsAndGradingView(); showAppToast(\'🎲 Ran 5,000 fresh Monte Carlo simulations!\');">🎲 Re-Run 5,000 Sims</button>' +
      '</div>' +
    '</div>' +
    '<div class="mc-kpi-grid">' +
      '<div class="mc-kpi-card" style="border-color:rgba(250,204,21,0.45);">' +
        '<div class="metric-label">🥇 ' + actMeta.shortName + ' 1st Place Odds</div>' +
        '<div class="metric-val" style="color:var(--gold);">' + (actHidden ? '🔒' : (sim.active.win1stPct + '%')) + '</div>' +
        '<div class="metric-sub">' + modeLabel + ' #1 Finish</div>' +
      '</div>' +
      '<div class="mc-kpi-card" style="border-color:rgba(16,185,129,0.45);">' +
        '<div class="metric-label">🔥 ' + actMeta.shortName + ' Top-5 / Top-10</div>' +
        '<div class="metric-val" style="color:var(--green);">' + (actHidden ? '🔒' : (sim.active.top5Pct + '%')) + ' <span style="font-size:0.8rem;color:var(--accent);">(' + (actHidden ? '🔒' : (sim.active.top10Pct + '% T10')) + ')</span></div>' +
        '<div class="metric-sub">Sim Avg: ' + (actHidden ? '🔒' : (sim.active.avgScore + ' pts')) + '</div>' +
      '</div>' +
      '<div class="mc-kpi-card" style="border-color:rgba(56,189,248,0.45);">' +
        '<div class="metric-label">📊 Expected Pool Rank</div>' +
        '<div class="metric-val" style="color:var(--accent);">' + (actHidden ? '🔒' : ('#' + sim.active.avgRank)) + ' <span style="font-size:0.78rem;color:var(--muted);">of ' + sim.contendersCount + '</span></div>' +
        '<div class="metric-sub">' + (sim.compare ? (cmpDesc.shortName + ' Proj Rank: #' + sim.compare.avgRank) : '') + '</div>' +
      '</div>' +
      '<div class="mc-kpi-card" style="border-color:rgba(192,132,252,0.45);">' +
        '<div class="metric-label">⚔️ Beat ' + (cmpDesc ? cmpDesc.shortName : 'Rival') + ' H2H Odds</div>' +
        '<div class="metric-val" style="color:#e9d5ff;">' + ((actHidden || cmpHidden) ? '🔒' : (sim.h2hWinPct + '%')) + '</div>' +
        '<div class="metric-sub">' + ((actHidden || cmpHidden) ? 'Locked' : ('Lose: ' + sim.h2hLossPct + '% • Tie: ' + sim.h2hTiePct + '%')) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin:8px 0;padding:8px 10px;background:rgba(9,13,22,0.75);border:1px solid var(--border-muted);border-radius:8px;font-size:0.73rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">' +
      '<span style="font-weight:800;color:#bae6fd;">🎯 Top 3 Root-For Leverage Games (Biggest Boost to Your Top-5 Finish Odds):</span>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + swingHtml + '</div>' +
    '</div>' +
    '<details style="margin-top:6px;font-size:0.73rem;">' +
      '<summary style="cursor:pointer;color:var(--accent);font-weight:800;user-select:none;">📋 View Top 10 Simulated Pool Contenders (' + modeLabel + ')</summary>' +
      '<div style="overflow-x:auto;margin-top:8px;">' +
        '<table class="condensed-table">' +
          '<thead><tr><th>Sim #</th><th>Participant</th><th>Sim Avg Pts</th><th>Avg Finish Rank</th><th>🥇 1st Place %</th><th>🔥 Top 5 %</th><th>Top 10 %</th></tr></thead>' +
          '<tbody>' + topRowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
    '</details>';
}

