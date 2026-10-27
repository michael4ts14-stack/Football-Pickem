// ============================================================================
// UPDATED POLL LIVE SCORES, SCOREBOARD, STANDINGS, LIVE TAB & RESEARCH CARDS
// ============================================================================
async function pollLiveSaturdayScores(manual) {
  var badge = document.getElementById("live-sync-badge");
  if (manual) badge.textContent = "↻ Fetching CST Scores & Possession...";
  var gamesChanged = false;
  try {
    var events = await fetchScoreboardEvents();
    try {
      await fetchLiveCollegeFootballRankings(manual);
      await fetchLiveCollegeFootballInjuries(manual);
    } catch (eInj) {}
    var matches = matchGamesToEvents(events);
    var minAllowedWk = Math.max(8, parseInt(state.currentWeek, 10) || 8);
    if (matches._detectedWeek && !isHardcodedWeek7Slate(GAMES) && matches._detectedWeek >= minAllowedWk) {
      state.currentWeek = matches._detectedWeek;
      state.weekLabel = "Week " + matches._detectedWeek;
    }
    updateWeekBrandingUI();
    var unmatched = [];
    var inProgSummaryPromises = [];
    var completedToFetch = [];

    for (var k = 0; k < GAMES.length; k++) {
      var g = GAMES[k];
      if (!g.keyInjHeader) {
        var compInj = computeKeyInjHeaderFromLists(g);
        if (compInj) g.keyInjHeader = compInj;
      }
      var m = matches[g.id];
      if (!m) {
        if (LIVE_SCORES[g.id] && LIVE_SCORES[g.id].matchupKey !== gameMatchupKey(g)) {
          delete LIVE_SCORES[g.id];
          delete SUMMARY_PBP_CACHE[g.id];
        }
        unmatched.push(g.away + " @ " + g.home);
        continue;
      }
      var item = m.item, comp = item.comp;
      var stType = (comp.status && comp.status.type) ? comp.status.type : {};
      var sheetAwayComp = m.flipped ? item.home : item.away;
      var sheetHomeComp = m.flipped ? item.away : item.home;

      if (g.espnEventId !== item.ev.id) gamesChanged = true;
      g.espnEventId = item.ev.id;
      if (sheetAwayComp.team && sheetAwayComp.team.id) g.awayEspnId = sheetAwayComp.team.id;
      if (sheetHomeComp.team && sheetHomeComp.team.id) g.homeEspnId = sheetHomeComp.team.id;
      if (g.awayEspnId) {
        ESPN_TEAM_MAP[g.away.toLowerCase()] = g.awayEspnId;
        ESPN_TEAM_MAP[normalizeTeamKey(g.away)] = g.awayEspnId;
      }
      if (g.homeEspnId) {
        ESPN_TEAM_MAP[g.home.toLowerCase()] = g.homeEspnId;
        ESPN_TEAM_MAP[normalizeTeamKey(g.home)] = g.homeEspnId;
      }

      // Extract records & Top-25 rankings from 2026 TEAM_RANKS authority
      var aRecSummary = (sheetAwayComp.records && sheetAwayComp.records[0] && sheetAwayComp.records[0].summary) ? sheetAwayComp.records[0].summary : "";
      var hRecSummary = (sheetHomeComp.records && sheetHomeComp.records[0] && sheetHomeComp.records[0].summary) ? sheetHomeComp.records[0].summary : "";
      var aRankDisplay = TEAM_RANKS[g.away] || null;
      var hRankDisplay = TEAM_RANKS[g.home] || null;
      if (aRecSummary) g.awayRec = (aRankDisplay ? (aRankDisplay + " • ") : "") + aRecSummary;
      if (hRecSummary) g.homeRec = (hRankDisplay ? (hRankDisplay + " • ") : "") + hRecSummary;

      // Extract Venue & Live Vegas Odds from scoreboard competition
      if (comp.venue && comp.venue.fullName) {
        g.venueText = comp.venue.fullName + (comp.venue.address && comp.venue.address.city ? (" (" + comp.venue.address.city + ")") : "");
      }
      if (comp.odds && comp.odds[0] && comp.odds[0].details) {
        var od = comp.odds[0];
        var ouPart = od.overUnder ? (" (O/U " + od.overUnder + ")") : "";
        g.liveLine = od.details + ouPart;
        if (typeof od.overUnder === "number") g.ouTotal = od.overUnder;
        var liveSpMatch = String(od.details).match(/-(\d+\.?\d*)/);
        var poolSpMatch = String(g.poolLine || "").match(/-(\d+\.?\d*)/);
        if (liveSpMatch) {
          g.liveSpreadNum = parseFloat(liveSpMatch[1]);
          if (poolSpMatch && !isHardcodedWeek7Slate(GAMES)) {
            var pSp = parseFloat(poolSpMatch[1]);
            var lSp = g.liveSpreadNum;
            var diffSp = +(lSp - pSp).toFixed(1);
            if (Math.abs(diffSp) >= 1.5 && !g.sway) {
              g.sway = {
                level: Math.abs(diffSp) >= 2.5 ? "critical" : "warn",
                title: "Line Moved " + (diffSp > 0 ? "+" + diffSp : diffSp) + " Pts vs Sheet (" + g.poolLine + " → " + od.details + ")",
                detail: "Pool locked at " + g.poolLine + ", while live Vegas line is now " + g.liveLine + "."
              };
            }
            if ((pSp <= 7.0 && lSp >= 7.5) || (pSp >= 7.5 && lSp <= 7.0) || (pSp <= 14.0 && lSp >= 14.5) || (pSp >= 14.5 && lSp <= 14.0)) {
              g.cliffTrap = "⚠️ Cliff Move: " + pSp + " (Sheet) → " + lSp + " (Live)";
            }
          }
        }
      }

      // Extract Competitor Stat Leaders from scoreboard if available
      var extractCompLeaders = function(compObj) {
        if (!compObj || !Array.isArray(compObj.leaders)) return "";
        var arr = [];
        for (var li = 0; li < compObj.leaders.length && arr.length < 3; li++) {
          var lc = compObj.leaders[li];
          var tl = (lc && Array.isArray(lc.leaders) && lc.leaders[0]) ? lc.leaders[0] : null;
          if (tl && tl.athlete) {
            arr.push((tl.athlete.shortName || tl.athlete.displayName) + " (" + (tl.displayValue || "") + ")");
          }
        }
        return arr.join(", ");
      };
      var aLead = extractCompLeaders(sheetAwayComp);
      var hLead = extractCompLeaders(sheetHomeComp);
      if (aLead && !g.awayLeaderText) g.awayLeaderText = aLead;
      if (hLead && !g.homeLeaderText) g.homeLeaderText = hLead;
      if (g.cstWindowAuto !== false && item.ev.date) {
        var win = cstWindowFromIsoDate(item.ev.date);
        if (win && win !== g.cstWindow) { g.cstWindow = win; gamesChanged = true; }
        if (!g.kick || g.kick === "Saturday CST" || !isLikelyKickoffLine(g.kick, null)) {
          try {
            var kd = new Date(item.ev.date);
            if (!isNaN(kd.getTime())) {
              var dayStr = kd.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" });
              var tmStr = kd.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
              var tvNet = "";
              if (comp.broadcasts && comp.broadcasts[0] && comp.broadcasts[0].names && comp.broadcasts[0].names[0]) {
                tvNet = comp.broadcasts[0].names[0];
              } else if (comp.geoBroadcasts && comp.geoBroadcasts[0] && comp.geoBroadcasts[0].media && comp.geoBroadcasts[0].media.shortName) {
                tvNet = comp.geoBroadcasts[0].media.shortName;
              }
              g.kick = dayStr + " " + tmStr + " CST" + (tvNet ? " • " + tvNet : "");
            }
          } catch (eKick) {}
        }
      }

      var sit = comp.situation || {};
      var possId = sit.possession ? String(sit.possession) : null;
      var awayTeamId = sheetAwayComp.team ? String(sheetAwayComp.team.id) : "";
      var homeTeamId = sheetHomeComp.team ? String(sheetHomeComp.team.id) : "";
      var awayAbbr = (sheetAwayComp.team && sheetAwayComp.team.abbreviation) ? sheetAwayComp.team.abbreviation : g.awayCode;
      var homeAbbr = (sheetHomeComp.team && sheetHomeComp.team.abbreviation) ? sheetHomeComp.team.abbreviation : g.homeCode;
      var possSide = null;
      if (possId && possId === awayTeamId) possSide = "away";
      else if (possId && possId === homeTeamId) possSide = "home";

      var downDist = sit.downDistanceText || sit.shortDownDistanceText || "";
      var possText = sit.possessionText || "";
      var isRz = sit.isRedZone === true;
      var lastPlay = (sit.lastPlay && sit.lastPlay.text) ? sit.lastPlay.text : "";

      var isInProg = stType.state === "in";
      var isComp = stType.completed === true;
      var prevObj = LIVE_SCORES[g.id] || {};
      var lsEntry = {
        matchupKey: gameMatchupKey(g),
        awayScore: parseEspnScore(sheetAwayComp.score),
        homeScore: parseEspnScore(sheetHomeComp.score),
        awayAbbr: awayAbbr,
        homeAbbr: homeAbbr,
        period: (comp.status && comp.status.period) ? comp.status.period : 0,
        detail: stType.shortDetail || "Scheduled",
        inProgress: isInProg,
        completed: isComp,
        eventId: item.ev.id,
        possessionSide: possSide,
        yardLine: typeof sit.yardLine === "number" ? sit.yardLine : 50,
        yardLine100: 50,
        downDistanceText: downDist,
        possessionText: possText,
        isRedZone: isRz,
        lastPlayText: lastPlay,
        _fetchingSummary: prevObj._fetchingSummary || false
      };
      lsEntry.yardLine100 = parseYardLine100FromSituation(sit, sheetAwayComp, sheetHomeComp, possSide, g, lsEntry);
      if (prevObj && prevObj.completed && prevObj.matchupKey === lsEntry.matchupKey && String(prevObj.eventId) === String(lsEntry.eventId) && !lsEntry.completed && !lsEntry.inProgress) {
        // Keep completed score for the exact same eventId & matchup
      } else {
        if (SUMMARY_PBP_CACHE[g.id] && String(SUMMARY_PBP_CACHE[g.id].eventId) !== String(lsEntry.eventId)) {
          delete SUMMARY_PBP_CACHE[g.id];
        }
        LIVE_SCORES[g.id] = lsEntry;
      }

      if (isInProg && item.ev.id) {
        inProgSummaryPromises.push(fetchGameDriveSummary(g.id, item.ev.id));
      } else if (isComp && item.ev.id && (!SUMMARY_PBP_CACHE[g.id] || manual)) {
        completedToFetch.push({ gameId: g.id, eventId: item.ev.id });
      }
    }

    if (inProgSummaryPromises.length > 0) {
      await Promise.all(inProgSummaryPromises);
    }

    // Also fetch real Final Drive / Last Scoring Drive summaries for completed games
    if (completedToFetch.length > 0) {
      Promise.all(completedToFetch.map(function(c) {
        return fetchGameDriveSummary(c.gameId, c.eventId);
      })).then(function() {
        renderAll();
        if (ACTIVE_THEATER_GAME_ID) renderFieldTheaterModalContent(ACTIVE_THEATER_GAME_ID);
      });
    }

    // Re-grade every participant in state.poolMembers against LIVE_SCORES
    state.liveScores = LIVE_SCORES;
    regradeAllPoolMembersLive();
    if (state.poolMembers && state.poolMembers.length > 0 && countScoredGamesInLiveScores() > 0) {
      pushWatchlistOrStandingsToFirebase();
    }

    var cstNow = new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" });
    badge.textContent = "🔴 CST Synced (" + cstNow + ")" + (unmatched.length ? " • " + unmatched.length + " unmatched" : "");
    badge.title = unmatched.length ? ("Not found on ESPN: " + unmatched.join(", ")) : "All " + GAMES.length + " games matched to ESPN";
    var clkEl = document.getElementById("live-tab-clock");
    if (clkEl) clkEl.textContent = cstNow + " CST";
  } catch (e) {
    badge.textContent = "● CST Ready";
  }
  renderAll();
  return gamesChanged;
}

function updateScoreboard(skipFullRegrade) {
  ensureWatchlistDefaults();
  if (!skipFullRegrade) regradeAllPoolMembersLive(false);
  ensureMultiUserAndPrivacyState();
  var m = calcProfileMetrics("michael");
  var k = calcProfileMetrics("kinyion");
  var t = (state.test && state.test.picks) ? calcProfileMetrics("test") : null;
  var cur = calcProfileMetrics(activeProfile) || m;

  var mPrior = 111, kPrior = 112;
  var mLiveRank = "T-64th", kLiveRank = "T-57th";
  if (state.poolMembers && state.poolMembers.length > 0) {
    var getPmTotal = function(x) {
      return (typeof x.newLiveTotal === "number" && !isNaN(x.newLiveTotal))
        ? x.newLiveTotal
        : ((parseFloat(x.priorPts) || 0) + Math.max(x.livePts || 0, x.finalPts || 0));
    };
    var sortedPm = state.poolMembers.slice().sort(function(a, b) {
      var totA = getPmTotal(a);
      var totB = getPmTotal(b);
      if (totB !== totA) return totB - totA;
      return (b.finalPts || 0) - (a.finalPts || 0);
    });
    var pScore = null, pRank = 1;
    for (var sIdx = 0; sIdx < sortedPm.length; sIdx++) {
      var spm = sortedPm[sIdx];
      var sTot = getPmTotal(spm);
      var rkLabel = "";
      if (sTot === pScore) {
        rkLabel = "T-" + pRank;
      } else {
        var tiedNext = (sIdx + 1 < sortedPm.length) && (getPmTotal(sortedPm[sIdx + 1]) === sTot);
        pRank = sIdx + 1;
        pScore = sTot;
        rkLabel = (tiedNext ? "T-" : "#") + pRank;
      }
      var sLow = standardizeParticipantName(spm.name).toLowerCase();
      if (sLow === "michael a") { mPrior = parseFloat(spm.priorPts) || 111; mLiveRank = rkLabel; }
      if (sLow === "kinyion c") { kPrior = parseFloat(spm.priorPts) || 112; kLiveRank = rkLabel; }
    }
  }
  var mWkBest = Math.max(m.liveProjectedPts, m.finalWonPts);
  var kWkBest = Math.max(k.liveProjectedPts, k.finalWonPts);
  var mNewTot = mPrior + mWkBest;
  var kNewTot = kPrior + kWkBest;



  populateCompareTargetSelectors();
  var cmpDesc = resolveCompareTargetDescriptor();
  var activeHidden = isProfileHiddenFromViewer(activeProfile, null);
  var otherHidden = cmpDesc ? cmpDesc.isHiddenForGame(null) : false;
  var diffs = 0;
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var p1D = getResolvedPickForGame(state[activeProfile].picks, g, true);
    var p2D = (cmpDesc && cmpDesc.hasPicks) ? getResolvedPickForGame(cmpDesc.picks, g, !cmpDesc.isPoolMember) : null;
    if (p2D && !isSameTeamPick(p1D, p2D, g)) diffs++;
  }
  var diffsEl = document.getElementById("h2h-diffs");
  if (diffsEl) {
    diffsEl.textContent = (activeHidden || otherHidden) ? "🔒 Hidden" : (cmpDesc && !cmpDesc.hasPicks ? "⏳ No Sheet" : (diffs + " games"));
  }
  var diffLabelEl = document.getElementById("h2h-diffs-label");
  if (diffLabelEl) {
    diffLabelEl.textContent = getProfileMetaByKey(activeProfile).shortName + " vs " + (cmpDesc ? cmpDesc.shortName : "Rival") + " Diffs:";
  }
  var fltDiffBtn = document.getElementById("flt-diffs");
  if (fltDiffBtn) {
    fltDiffBtn.textContent = "Diffs vs " + (cmpDesc ? cmpDesc.shortName : "rival");
  }
// Legacy Show Kinyion compare-pin button removed per V16.7 UI cleanup

  // Render ONLY your own 2 personal instance modes (Official Picks + Sandbox Sim) — NO profile swapping!
  var myKey = getMyInstanceProfileKey();
  var myMeta = getProfileMetaByKey(myKey);
  var myMetrics = calcProfileMetrics(myKey) || m;
  var myWkBest = Math.max(myMetrics.liveProjectedPts, myMetrics.finalWonPts);
  var myTotPts = (parseFloat(myMeta.priorPts) || 0) + myWkBest;
  var myPriv = state.profilePrivacy[myKey] || { hidden: false };

  var tabsWrap = document.getElementById("dynamic-profile-tabs");
  var tbodyH2h = document.getElementById("h2h-dynamic-tbody");
  if (tabsWrap && tbodyH2h) {
    var isOfficialActive = (activeProfile !== "test");
    var isSandboxActive = (activeProfile === "test");
    var mySubLabel = myTotPts + " pts (" + (myKey === "michael" ? mLiveRank : (myKey === "kinyion" ? kLiveRank : (myMeta.defaultRank || "Linked"))) + (myWkBest > 0 ? " • +" + myWkBest + " wk" : "") + ")";
    var testMetrics = calcProfileMetrics("test") || m;

    tabsWrap.style.gridTemplateColumns = "1fr 1fr";
    tabsWrap.innerHTML =
      '<button type="button" class="profile-tab ' + (isOfficialActive ? myMeta.tabClass : '') + '" onclick="switchProfile(\'' + myKey + '\')" title="Your bound official picks instance">' +
        '🏈 ' + myMeta.name + ' (You)' + (myPriv.hidden ? ' 🔒' : '') + '<br><span style="font-size:0.66rem;font-weight:500;">' + mySubLabel + '</span>' +
      '</button>' +
      '<button type="button" class="profile-tab ' + (isSandboxActive ? 'active-test' : '') + '" onclick="switchProfile(\'test\')" title="Your personal device-local What-If Sandbox">' +
        '🧪 My Sandbox Sim<br><span style="font-size:0.66rem;font-weight:500;">' + testMetrics.ev.toFixed(1) + ' EV (' + testMetrics.ceiling + ' ceil)</span>' +
      '</button>';

    // Build clean 3-row H2H table: 1) Your Official Profile, 2) Selected Compare Target (Read-Only), 3) Your Sandbox Sim
    var cmpRowHtml = "";
    if (cmpDesc) {
      var cmpM = cmpDesc.isPoolMember
        ? gradePickMap(cmpDesc.picks || {}, false, false)
        : (calcProfileMetrics(cmpDesc.key) || gradePickMap(cmpDesc.picks || {}, true, false));
      var cmpHid = cmpDesc.isHiddenForGame(null);
      var cmpWkBest = (!cmpDesc.hasPicks || cmpHid) ? 0 : Math.max(cmpM.liveProjectedPts, cmpM.finalWonPts);
      cmpRowHtml = '<tr>' +
        '<td><strong style="color:' + cmpDesc.color + ';">⚔️ ' + cmpDesc.name + ' (H2H)</strong>' + (cmpHid ? ' <span style="font-size:0.62rem;color:var(--loss);">🔒 Pre-Kickoff</span>' : '') + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (!cmpDesc.hasPicks ? '⏳' : (cmpM.ceiling + ' pts'))) + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (!cmpDesc.hasPicks ? '⏳' : cmpM.ev.toFixed(1))) + '</td>' +
        '<td style="color:var(--green);font-weight:800;">' + (cmpHid ? '🔒' : ('+' + cmpWkBest)) + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (cmpM.wonGames + '-' + cmpM.lostGames + ' (' + cmpM.finalWonPts + 'p)')) + '</td>' +
      '</tr>';
    }

    var testWkBest = Math.max(testMetrics.liveProjectedPts, testMetrics.finalWonPts);
    tbodyH2h.innerHTML =
      '<tr>' +
        '<td><strong style="color:' + myMeta.color + ';">🏈 ' + myMeta.name + ' (You)</strong></td>' +
        '<td>' + myMetrics.ceiling + ' pts</td>' +
        '<td>' + myMetrics.ev.toFixed(1) + '</td>' +
        '<td style="color:var(--green);font-weight:800;">+' + myWkBest + '</td>' +
        '<td>' + myMetrics.wonGames + '-' + myMetrics.lostGames + ' (' + myMetrics.finalWonPts + 'p)</td>' +
      '</tr>' +
      cmpRowHtml +
      '<tr>' +
        '<td><strong style="color:var(--warn);">🧪 Sandbox Sim</strong></td>' +
        '<td>' + testMetrics.ceiling + ' pts</td>' +
        '<td>' + testMetrics.ev.toFixed(1) + '</td>' +
        '<td style="color:var(--green);font-weight:800;">+' + testWkBest + '</td>' +
        '<td>' + testMetrics.wonGames + '-' + testMetrics.lostGames + ' (' + testMetrics.finalWonPts + 'p)</td>' +
      '</tr>';
  }

  // Update active profile privacy status bar (controls whether OTHER users can see your picks before kickoff)
  var privStatusEl = document.getElementById("active-privacy-status-pill");
  var quickHideBtn = document.getElementById("btn-quick-hide-active");
  if (privStatusEl && quickHideBtn) {
    var myKeyPriv = getMyInstanceProfileKey();
    var curPriv = state.profilePrivacy[myKeyPriv] || { hidden: false };
    var curMeta = getProfileMetaByKey(myKeyPriv);
    if (curPriv.hidden) {
      privStatusEl.innerHTML = '🔒 <strong>' + curMeta.shortName + '</strong> Hidden From Others Until Kickoff';
      privStatusEl.style.color = "var(--win)";
      quickHideBtn.textContent = "👁️ Make Public";
      quickHideBtn.style.borderColor = "var(--border)";
      quickHideBtn.style.color = "var(--win)";
    } else {
      privStatusEl.innerHTML = '👁️ <strong>' + curMeta.shortName + '</strong> Visible to Pool' + (BLIND_MODE ? ' (🙈 Blind ON)' : '');
      privStatusEl.style.color = "var(--text)";
      quickHideBtn.textContent = "🔒 Hide From Others";
      quickHideBtn.style.borderColor = "";
      quickHideBtn.style.color = "";
    }
  }

  document.getElementById("rm-chalk").textContent = cur.chalkCount;
  document.getElementById("rm-2x").textContent = cur.count2x;
  document.getElementById("rm-3x").textContent = cur.count3x;
  document.getElementById("top-ceiling").textContent = cur.ceiling;
  document.getElementById("top-ev").textContent = cur.ev.toFixed(1);

  document.getElementById("stat-ceiling").textContent = cur.ceiling + " pts";
  document.getElementById("stat-dogs-sub").textContent = cur.dogs + " multiplier dog(s)";
  document.getElementById("stat-ev").textContent = cur.ev.toFixed(2);
  document.getElementById("stat-target-prob").textContent = Math.round(cur.hitProb * 100) + "%";
  var tgt = state[activeProfile].target || 20;
  document.getElementById("stat-target-label").textContent = "Chance >= " + tgt + " pts";
  document.getElementById("slider-val").textContent = tgt;
  document.getElementById("stat-range").textContent = cur.p25 + "–" + cur.p75 + " pts";

  var buckets = [
    { label: "<= 15 pts", min: 0, max: 15 },
    { label: "16–18 pts", min: 16, max: 18 },
    { label: "19–21 pts", min: 19, max: 21 },
    { label: "22–24 pts", min: 22, max: 24 },
    { label: "25+ pts", min: 25, max: 79 }
  ];
  var chartHtml = "";
  for (var b = 0; b < buckets.length; b++) {
    var bk = buckets[b];
    var p = 0;
    for (var s = bk.min; s <= bk.max; s++) p += cur.dp[s] || 0;
    var pct = Math.round(p * 100);
    chartHtml += '<div class="dist-row"><span class="dist-label">' + bk.label + '</span>' +
      '<div class="dist-bar-wrap"><div class="dist-bar" style="width:' + Math.min(100, pct * 1.8) + '%"></div></div>' +
      '<span class="dist-pct">' + pct + '%</span></div>';
  }
  var mcQuick = runMonteCarloPoolSimulation(1500, false);
  var mcSummaryStrip = '<div style="margin-top:8px;padding:6px 8px;background:var(--raised);border:1px solid var(--border);border-radius:6px;display:flex;justify-content:space-between;align-items:center;font-size:0.7rem;cursor:pointer;" onclick="switchMainView(\'standings\'); toggleMobileSidebar(false);" title="Tap to open full 5,000-Trial Monte Carlo Simulator">' +
    '<span>🎲 <strong>Pool Sim:</strong> 🥇 1st: <strong style="color:var(--gold);">' + (activeHidden ? '🔒' : (mcQuick.active.win1stPct + '%')) + '</strong></span>' +
    '<span>🔥 Top 5: <strong style="color:var(--green);">' + (activeHidden ? '🔒' : (mcQuick.active.top5Pct + '%')) + '</strong></span>' +
    '<span>Proj: <strong>#' + (activeHidden ? '🔒' : mcQuick.active.avgRank) + '</strong></span>' +
  '</div>';
  document.getElementById("dist-chart").innerHTML = chartHtml + mcSummaryStrip;

  var wlSb = document.getElementById("sidebar-watchlist-summary");
  if (wlSb) {
    var wlHtml = "";
    var activePicks = state[activeProfile].picks;
    for (var w = 0; w < state.watchlist.length; w++) {
      var rival = state.watchlist[w];
      var rGrade = gradePickMap(rival.picks, false);
      var hasRivalPicks = rGrade.submittedPicksCount > 0;
      var diffCnt = 0;
      if (hasRivalPicks) {
        for (var gmIdx = 0; gmIdx < GAMES.length; gmIdx++) {
          var gmObj = GAMES[gmIdx];
          var myP = getResolvedPickForGame(activePicks, gmObj, true);
          var rvP = getResolvedPickForGame(rival.picks, gmObj, false);
          if (rvP && !isSameTeamPick(myP, rvP, gmObj)) diffCnt++;
        }
      }
      var rWkPts = hasRivalPicks ? Math.max(rGrade.liveProjectedPts, rGrade.finalWonPts) : 0;
      var rNewTot = (parseFloat(rival.priorPts) || 0) + rWkPts;
      var rightText = hasRivalPicks
        ? ('<span style="color:var(--warn);font-weight:700;">Tot: ' + rNewTot + 'p (+' + rWkPts + ') • ' + diffCnt + ' diffs</span>')
        : ('<span style="color:var(--muted);font-weight:700;">Tot: ' + rNewTot + 'p • ⏳ No picks yet</span>');
      wlHtml += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--panel-alt);padding:5px 8px;border-radius:6px;border:1px solid var(--border-muted);">' +
        '<span><strong>' + rival.name + '</strong> <span style="color:var(--muted);">(' + rival.rank + ' • Prior ' + rival.priorPts + 'p)</span></span>' +
        rightText +
      '</div>';
    }
    wlSb.innerHTML = wlHtml;
  }
}

// Season leaderboard rows (pool members + leaderboard entries), sorted by new total.
// Shared by the Standings table and the desktop right rail.
function buildPoolLeaderboardRows() {
  var rows = [];
  var seenNames = {};

  if (state.poolMembers && state.poolMembers.length > 0) {
    for (var p = 0; p < state.poolMembers.length; p++) {
      var pm = state.poolMembers[p];
      var stdName = standardizeParticipantName(pm.name);
      seenNames[stdName.toLowerCase()] = true;
      var rawPrior = parseFloat(pm.priorPts) || 0;
      var isWk7Now = isHardcodedWeek7Slate(GAMES);
      var prior = (isWk7Now && rawPrior >= 80 && pm.wk7PriorPts !== undefined && rawPrior > pm.wk7PriorPts) ? pm.wk7PriorPts : rawPrior;
      var isAwaiting = !!pm.awaitingSheet;
      var liveTotalWk = isAwaiting ? 0 : (pm.livePts || 0);
      var finPts = isAwaiting ? 0 : (pm.finalPts || 0);
      var computedTot = (typeof pm.newLiveTotal === "number" && !isNaN(pm.newLiveTotal)) ? pm.newLiveTotal : (prior + Math.max(liveTotalWk, finPts));
      var brkStr = isAwaiting
        ? ('<span class="watchlist-pill">⏳ Awaiting ' + (state.weekLabel || 'Weekly') + ' Selection Sheet</span>')
        : ("1x: " + (pm.won1x || 0) + "/" + (pm.count1x || 0) + " • 2x: " + (pm.won2x || 0) + "/" + (pm.count2x || 0) + " • 3x: " + (pm.won3x || 0) + "/" + (pm.count3x || 0));
      rows.push({
        name: stdName,
        priorPts: prior,
        awaitingSheet: isAwaiting,
        liveInProgPts: isAwaiting ? 0 : (pm.inProgressPts || 0),
        liveTotalWk: liveTotalWk,
        finalPts: finPts,
        newTotal: computedTot,
        breakdown: brkStr
      });
    }
  }

  // Ensure Michael A, Kinyion C, and Leaderboard entries appear even before a CSV is uploaded
  for (var l = 0; l < state.leaderboard.length; l++) {
    var entry = state.leaderboard[l];
    var sName = standardizeParticipantName(entry.name);
    var nLow = sName.toLowerCase();
    if (seenNames[nLow]) continue;
    seenNames[nLow] = true;

    var gData = null;
    for (var w2 = 0; w2 < state.watchlist.length; w2++) {
      if (standardizeParticipantName(state.watchlist[w2].name).toLowerCase() === nLow) {
        var candidateGrade = gradePickMap(state.watchlist[w2].picks, false);
        if (candidateGrade.submittedPicksCount > 0) gData = candidateGrade;
        break;
      }
    }

    var pr = parseFloat(entry.priorPts) || 0;
    var isAw = !gData;
    var wkLive = gData ? gData.liveProjectedPts : 0;
    var wkInProg = gData ? gData.inProgressPts : 0;
    var wkFin = gData ? gData.finalWonPts : 0;
    var brk = gData
      ? ("1x: " + gData.won1x + "/" + gData.chalkCount + " • 2x: " + gData.won2x + "/" + gData.count2x + " • 3x: " + gData.won3x + "/" + gData.count3x)
      : ('<span class="watchlist-pill">⏳ Awaiting ' + (state.weekLabel || 'Weekly') + ' Selection Sheet</span>');

    rows.push({
      name: sName,
      priorPts: pr,
      awaitingSheet: isAw,
      liveInProgPts: wkInProg,
      liveTotalWk: wkLive,
      finalPts: wkFin,
      newTotal: pr + Math.max(wkLive, wkFin),
      breakdown: brk
    });
  }

  rows.sort(function(a, b) {
    if (b.newTotal !== a.newTotal) return b.newTotal - a.newTotal;
    return b.finalPts - a.finalPts;
  });
  return rows;
}

function renderStandingsAndGradingView() {
  ensureWatchlistDefaults();
  regradeAllPoolMembersLive();
  populateCompareTargetSelectors();

  var actMeta = getProfileMetaByKey(activeProfile);
  var cmpTarget = resolveCompareTargetDescriptor();
  var m = calcProfileMetrics(activeProfile) || calcProfileMetrics("michael");
  var k = cmpTarget
    ? (cmpTarget.isPoolMember
        ? gradePickMap(cmpTarget.picks || {}, false, false)
        : (calcProfileMetrics(cmpTarget.key) || gradePickMap(cmpTarget.picks || {}, true, false)))
    : calcProfileMetrics("kinyion");

  var actHiddenGlobal = isProfileHiddenFromViewer(activeProfile, null);
  var cmpHiddenGlobal = cmpTarget ? cmpTarget.isHiddenForGame(null) : false;

  var mNetDiff = m.finalWonPts - k.finalWonPts;
  var mLiveDiff = m.liveProjectedPts - k.liveProjectedPts;

  var swingCompletedWinsM = 0, swingCompletedWinsK = 0, swingRemainingCount = 0;
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var actHidG = isProfileHiddenFromViewer(activeProfile, g.id);
    var cmpHidG = cmpTarget ? cmpTarget.isHiddenForGame(g.id) : false;
    if (actHidG || cmpHidG || (cmpTarget && !cmpTarget.hasPicks)) continue;
    var mp = getResolvedPickForGame(state[activeProfile].picks, g, true);
    var kp = cmpTarget ? getResolvedPickForGame(cmpTarget.picks, g, !cmpTarget.isPoolMember) : null;
    if (mp && kp && !isSameTeamPick(mp, kp, g)) {
      var ls = LIVE_SCORES[g.id];
      if (ls && ls.completed) {
        var winTeam = ls.awayScore > ls.homeScore ? g.away : (ls.homeScore > ls.awayScore ? g.home : null);
        if (winTeam && isSameTeamPick(winTeam, mp, g)) swingCompletedWinsM += (isSameTeamPick(mp, g.away, g) ? g.awayPts : g.homePts);
        if (winTeam && isSameTeamPick(winTeam, kp, g)) swingCompletedWinsK += (isSameTeamPick(kp, g.away, g) ? g.awayPts : g.homePts);
      } else {
        swingRemainingCount++;
      }
    }
  }

  var mPriorPts = parseFloat(actMeta.priorPts) || 0;
  var kPriorPts = cmpTarget ? (parseFloat(cmpTarget.priorPts) || 0) : 0;
  var actLinkedName = getLinkedMemberNameForProfile(activeProfile);
  var cmpLinkedName = cmpTarget ? (cmpTarget.isPoolMember ? cmpTarget.name : getLinkedMemberNameForProfile(cmpTarget.key)) : "";
  for (var pIdx = 0; pIdx < (state.poolMembers || []).length; pIdx++) {
    var pmItem = state.poolMembers[pIdx];
    var pLow = standardizeParticipantName(pmItem.name).toLowerCase();
    if (actLinkedName && pLow === standardizeParticipantName(actLinkedName).toLowerCase() && pmItem.priorPts !== undefined) {
      mPriorPts = parseFloat(pmItem.priorPts) || mPriorPts;
    }
    if (cmpLinkedName && pLow === standardizeParticipantName(cmpLinkedName).toLowerCase() && pmItem.priorPts !== undefined) {
      kPriorPts = parseFloat(pmItem.priorPts) || kPriorPts;
    }
  }
  var mWkPts = Math.max(m.liveProjectedPts, m.finalWonPts);
  var kWkPts = (cmpTarget && !cmpTarget.hasPicks) ? 0 : Math.max(k.liveProjectedPts, k.finalWonPts);
  var mNewLiveTotal = mPriorPts + mWkPts;
  var kNewLiveTotal = kPriorPts + kWkPts;

  var cmpName = cmpTarget ? cmpTarget.name : "Kinyion C";
  var cmpShort = cmpTarget ? cmpTarget.shortName : "Kinyion";
  var cmpIcon = cmpTarget ? cmpTarget.icon : "👤";
  var cmpColor = cmpTarget ? cmpTarget.color : "var(--purple)";

  var cardsEl = document.getElementById("automated-grading-cards");
  if (cardsEl) {
    var mBadgesHtml = actHiddenGlobal
      ? '<span class="badge badge-3x" style="cursor:pointer;" onclick="unlockProfileWithPrompt(\'' + activeProfile + '\')">🔒 Picks Hidden (Tap to Unlock)</span>'
      : ('<span class="badge badge-1x">1x: ' + m.won1x + '/' + m.chalkCount + '</span>' +
         '<span class="badge badge-2x">2x: ' + m.won2x + '/' + m.count2x + ' (' + (m.won2x * 2) + 'p)</span>' +
         '<span class="badge badge-3x">3x: ' + m.won3x + '/' + m.count3x + ' (' + (m.won3x * 3) + 'p)</span>');

    var kBadgesHtml = "";
    if (cmpHiddenGlobal && cmpTarget && !cmpTarget.isPoolMember) {
      kBadgesHtml = '<span class="badge badge-3x" style="cursor:pointer;" onclick="unlockProfileWithPrompt(\'' + cmpTarget.key + '\')">🔒 Picks Hidden (Tap to Unlock)</span>';
    } else if (cmpTarget && !cmpTarget.hasPicks) {
      kBadgesHtml = '<span class="watchlist-pill">⏳ Awaiting Selection Sheet Picks</span>';
    } else {
      kBadgesHtml = '<span class="badge badge-1x">1x: ' + k.won1x + '/' + k.chalkCount + '</span>' +
                    '<span class="badge badge-2x">2x: ' + k.won2x + '/' + k.count2x + ' (' + (k.won2x * 2) + 'p)</span>' +
                    '<span class="badge badge-3x">3x: ' + k.won3x + '/' + k.count3x + ' (' + (k.won3x * 3) + 'p)</span>';
    }

    var h2hLeadHeadline = (actHiddenGlobal || cmpHiddenGlobal)
      ? '🔒 H2H Locked (Unlock Profile to View)'
      : ((cmpTarget && !cmpTarget.hasPicks)
          ? ('⏳ Awaiting ' + cmpShort + ' Sheet Picks')
          : (mLiveDiff > 0 ? (actMeta.shortName + ' Leads Live by +' + mLiveDiff + ' pts') : (mLiveDiff < 0 ? (cmpShort + ' Leads Live by +' + Math.abs(mLiveDiff) + ' pts') : 'Tied Live (0 pt diff)')));

    cardsEl.innerHTML =
      '<div class="grading-card" style="border-color:' + actMeta.color + ';">' +
        '<div style="font-size:0.74rem;font-weight:800;color:' + actMeta.color + ';text-transform:uppercase;">' + actMeta.icon + ' ' + actMeta.name + ' (Active) — Auto-Grade Report</div>' +
        '<div style="font-size:1.3rem;font-weight:900;color:var(--text);margin:4px 0;">New Live Total: <span style="color:' + actMeta.color + ';">' + mNewLiveTotal + ' pts</span> <span style="font-size:0.8rem;color:var(--green);">(+' + mWkPts + ' wk • Prior ' + mPriorPts + 'p)</span></div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Record: <strong>' + m.wonGames + 'W - ' + m.lostGames + 'L</strong> • Final Won: <strong>' + m.finalWonPts + 'p</strong> • Lost Pts: <strong style="color:var(--red);">' + m.finalLostPts + '</strong> • Max Left: <strong>' + (actHiddenGlobal ? '🔒' : ((mPriorPts + m.finalWonPts + m.pendingPts) + 'p')) + '</strong></div>' +
        '<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">' + mBadgesHtml + '</div>' +
      '</div>' +
      '<div class="grading-card" style="border-color:' + cmpColor + ';">' +
        '<div style="font-size:0.74rem;font-weight:800;color:' + cmpColor + ';text-transform:uppercase;">' + cmpIcon + ' ' + cmpName + ' (H2H Rival) — Auto-Grade Report</div>' +
        '<div style="font-size:1.3rem;font-weight:900;color:var(--text);margin:4px 0;">New Live Total: <span style="color:' + cmpColor + ';">' + kNewLiveTotal + ' pts</span> <span style="font-size:0.8rem;color:var(--green);">(+' + kWkPts + ' wk • Prior ' + kPriorPts + 'p)</span></div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Record: <strong>' + k.wonGames + 'W - ' + k.lostGames + 'L</strong> • Final Won: <strong>' + k.finalWonPts + 'p</strong> • Lost Pts: <strong style="color:var(--red);">' + k.finalLostPts + '</strong> • Max Left: <strong>' + ((cmpHiddenGlobal || (cmpTarget && !cmpTarget.hasPicks)) ? '—' : ((kPriorPts + k.finalWonPts + k.pendingPts) + 'p')) + '</strong></div>' +
        '<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">' + kBadgesHtml + '</div>' +
      '</div>' +
      '<div class="grading-card" style="border-color:var(--amber);">' +
        '<div style="font-size:0.74rem;font-weight:800;color:var(--amber);text-transform:uppercase;">⚔️ ' + actMeta.shortName + ' vs. ' + cmpShort + ' — Weekly Swing Summary</div>' +
        '<div style="font-size:1.22rem;font-weight:900;color:var(--text);margin:4px 0;">' + h2hLeadHeadline + '</div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Final Graded Margin: <strong>' + (mNetDiff >= 0 ? '+' + mNetDiff : mNetDiff) + ' pts</strong> • Swing Pts Won: <strong>' + actMeta.shortName + ' ' + swingCompletedWinsM + 'p vs ' + cmpShort + ' ' + swingCompletedWinsK + 'p</strong></div>' +
        '<div style="margin-top:6px;font-size:0.73rem;color:var(--warn);">⚡ <strong>' + ((actHiddenGlobal || cmpHiddenGlobal) ? '🔒' : swingRemainingCount) + '</strong> H2H disagreement game(s) still pending/in-progress.</div>' +
      '</div>';
  }

  var wlGrid = document.getElementById("watchlist-editor-grid");
  if (wlGrid) {
    var wHtml = "";
    for (var w = 0; w < state.watchlist.length; w++) {
      var rv = state.watchlist[w];
      var rg = gradePickMap(rv.picks, false);
      var hasRvPicks = rg.submittedPicksCount > 0;
      var statusSub = hasRvPicks
        ? ('<span>Wk: <strong style="color:var(--green);">+' + Math.max(rg.liveProjectedPts, rg.finalWonPts) + 'p</strong> • New Tot: <strong style="color:var(--legacy-accent);">' + ((parseFloat(rv.priorPts) || 0) + Math.max(rg.liveProjectedPts, rg.finalWonPts)) + 'p</strong></span>')
        : ('<span style="color:var(--amber);font-weight:700;">⏳ No Picks Submitted Yet (Prior ' + rv.priorPts + 'p)</span>');
      wHtml += '<div class="metric-card">' +
        '<div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:5px;">' +
          '<input type="text" class="search-input" style="min-width:0;padding:4px 7px;font-size:0.76rem;font-weight:800;" value="' + rv.name + '" onchange="updateWatchlistMeta(' + w + ', \'name\', this.value)" />' +
          '<input type="text" class="search-input" style="max-width:68px;min-width:0;padding:4px 6px;font-size:0.73rem;" value="' + rv.rank + '" onchange="updateWatchlistMeta(' + w + ', \'rank\', this.value)" placeholder="Rank" />' +
          '<input type="number" class="search-input" style="max-width:68px;min-width:0;padding:4px 6px;font-size:0.73rem;" value="' + rv.priorPts + '" onchange="updateWatchlistMeta(' + w + ', \'priorPts\', this.value)" placeholder="Pts" />' +
        '</div>' +
        '<div style="font-size:0.71rem;color:var(--muted);display:flex;justify-content:space-between;align-items:center;">' +
          statusSub +
          '<button class="btn-sm" style="padding:2px 7px;font-size:0.66rem;" onclick="switchMainView(\'condensed\')">Set Picks in Table →</button>' +
        '</div>' +
      '</div>';
    }
    wlGrid.innerHTML = wHtml;
  }

  // Build Full Pool Leaderboard (merges state.poolMembers + fallback state.leaderboard)
  var lbTbody = document.getElementById("pool-leaderboard-tbody");
  if (!lbTbody) return;

  var searchQ = "";
  var searchEl = document.getElementById("leaderboard-search-input");
  if (searchEl) searchQ = (searchEl.value || "").trim().toLowerCase();

  var rows = buildPoolLeaderboardRows();

  var countLbl = document.getElementById("leaderboard-count-label");
  if (countLbl) countLbl.textContent = rows.length + " Pool Entries Synced";

  var lbHtml = "";
  var prevTot = null, prevRankNum = 1;
  for (var r = 0; r < rows.length; r++) {
    var rw = rows[r];
    var rankStr = "";
    if (rw.newTotal === prevTot) {
      rankStr = "T-" + prevRankNum;
    } else {
      var isTiedWithNext = (r + 1 < rows.length && rows[r + 1].newTotal === rw.newTotal);
      prevRankNum = r + 1;
      prevTot = rw.newTotal;
      rankStr = isTiedWithNext ? ("T-" + prevRankNum) : ("#" + prevRankNum);
    }
    if (searchQ && rw.name.toLowerCase().indexOf(searchQ) === -1) continue;

    var linkedRowProf = getProfileLinkedToMemberName(rw.name);
    var isMichael = rw.name === "Michael A";
    var isKinyion = rw.name === "Kinyion C";
    var rowClass = isMichael ? "row-highlight-michael" : (isKinyion ? "row-highlight-kinyion" : (linkedRowProf ? "row-highlight-michael" : ""));
    var nameColor = isMichael ? "color:var(--text);" : (isKinyion ? "color:var(--text);" : (linkedRowProf ? ("color:" + (linkedRowProf.color || "var(--win)") + ";") : "color:var(--text);"));

    var liveColHtml = rw.awaitingSheet
      ? '<td style="color:var(--muted);">— <span style="font-size:0.66rem;">(No Picks Yet)</span></td>'
      : '<td style="color:var(--amber);font-weight:800;">+' + rw.liveTotalWk + ' pts <span style="font-size:0.66rem;color:var(--muted);">(' + rw.liveInProgPts + ' in-prog)</span></td>';
    var finColHtml = rw.awaitingSheet
      ? '<td style="color:var(--muted);">—</td>'
      : '<td style="color:var(--green);font-weight:800;">+' + rw.finalPts + ' pts</td>';
    var totColHtml = rw.awaitingSheet
      ? '<td style="color:var(--legacy-accent);font-weight:900;font-size:0.86rem;">' + rw.newTotal + ' pts</td>'
      : '<td style="color:var(--legacy-accent);font-weight:900;font-size:0.86rem;">' + rw.newTotal + ' pts <span style="font-size:0.66rem;color:var(--green);">(' + rw.priorPts + '+' + Math.max(rw.liveTotalWk, rw.finalPts) + ')</span></td>';

    var safeRwName = rw.name.replace(/'/g, "\\'");
    var myKeyLb = getMyInstanceProfileKey();
    var isLinkedToActive = (linkedRowProf && linkedRowProf.key === myKeyLb);
    var linkBadgeHtml = "";
    if (isLinkedToActive) {
      linkBadgeHtml = '<span class="linked-lb-pill" style="margin-left:6px;">✓ Your Bound Instance</span>';
    } else if (linkedRowProf) {
      linkBadgeHtml = '<span class="badge badge-1x" style="margin-left:6px;font-size:0.62rem;">⚡ App User</span>';
    }
    var cmpTargetVal = linkedRowProf ? linkedRowProf.key : ("pm:" + safeRwName);
    var cmpQuickBtn = (!isLinkedToActive)
      ? '<button type="button" class="btn-sm" style="padding:2px 7px;font-size:0.64rem;margin-left:6px;border-color:var(--border);color:var(--text);" onclick="setCompareTarget(\'' + cmpTargetVal + '\'); switchMainView(\'condensed\');" title="Compare your picks side-by-side against ' + rw.name + ' (Read-Only)">⚔️ Compare H2H</button>'
      : "";

    lbHtml += '<tr class="' + rowClass + '">' +
      '<td><strong>' + rankStr + '</strong></td>' +
      '<td><strong style="' + nameColor + '">' + rw.name + '</strong>' + linkBadgeHtml + cmpQuickBtn + '</td>' +
      '<td>' + rw.priorPts + ' pts</td>' +
      liveColHtml +
      finColHtml +
      totColHtml +
      '<td style="font-size:0.7rem;color:var(--muted);">' + rw.breakdown + '</td>' +
    '</tr>';
  }

  lbTbody.innerHTML = lbHtml || '<tr><td colspan="7" style="text-align:center;padding:12px;color:var(--muted);">No participants match that filter.</td></tr>';
  if (typeof renderTop5WeeklyWinnersPodium === "function") renderTop5WeeklyWinnersPodium();
  renderMonteCarloSimulatorBox();
  renderSeasonArchiveHub();
}

function renderLiveScoreboardTab() {
  var container = document.getElementById("live-scoreboard-groups");
  if (!container) return;

  ensureMultiUserAndPrivacyState();
  populateCompareTargetSelectors();

  var actMeta = getProfileMetaByKey(activeProfile);
  var cmpTarget = resolveCompareTargetDescriptor();
  var actPicksMap = (state[activeProfile] && state[activeProfile].picks) ? state[activeProfile].picks : {};
  var cmpPicksMap = (cmpTarget && cmpTarget.hasPicks && cmpTarget.picks) ? cmpTarget.picks : {};
  var cmpShort = cmpTarget ? cmpTarget.shortName : "Rival";
  var cmpName = cmpTarget ? cmpTarget.name : "Rival";
  var cmpIcon = cmpTarget ? cmpTarget.icon : "👤";
  var cmpColor = cmpTarget ? cmpTarget.color : "#c084fc";

  var lfltDiffBtn = document.getElementById("lflt-diff");
  if (lfltDiffBtn) {
    lfltDiffBtn.textContent = "⚔️ " + actMeta.shortName + " vs " + cmpShort + " Swings";
  }

  var windowsOrder = [
    "11:00 AM CST Window",
    "2:30 PM CST Window",
    "6:00 PM / 6:30 PM CST Primetime",
    "9:15 PM+ CST Late Night Window"
  ];
  var groups = {};
  for (var w = 0; w < windowsOrder.length; w++) groups[windowsOrder[w]] = [];

  var mLivePts = 0, kLivePts = 0, mWinCnt = 0, kWinCnt = 0, inProgCnt = 0, finalCnt = 0, totalDiffCnt = 0;

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var mHiddenG = isProfileHiddenFromViewer(activeProfile, g.id);
    var kHiddenG = cmpTarget ? cmpTarget.isHiddenForGame(g.id) : false;

    var mPick = getResolvedPickForGame(actPicksMap, g, true);
    var kPick = (cmpTarget && cmpTarget.hasPicks) ? getResolvedPickForGame(cmpPicksMap, g, !cmpTarget.isPoolMember) : null;
    var isDiff = (!mHiddenG && !kHiddenG && mPick && kPick) ? !isSameTeamPick(mPick, kPick, g) : false;
    if (isDiff) totalDiffCnt++;

    var ls = LIVE_SCORES[g.id] || {
      awayScore: 0, homeScore: 0, period: 0, detail: g.kick,
      inProgress: false, completed: false,
      possessionSide: null, downDistanceText: "", possessionText: "", isRedZone: false, lastPlayText: "", yardLine100: 50
    };

    if (ls.inProgress) inProgCnt++;
    if (ls.completed) finalCnt++;

    var leader = null;
    if (ls.inProgress || ls.completed) {
      if (ls.awayScore > ls.homeScore) leader = g.away;
      else if (ls.homeScore > ls.awayScore) leader = g.home;
    }

    var mPts = isSameTeamPick(mPick, g.away, g) ? g.awayPts : g.homePts;
    var kPts = kPick ? (isSameTeamPick(kPick, g.away, g) ? g.awayPts : g.homePts) : 1;

    if (leader && mPick && isSameTeamPick(leader, mPick, g)) { mLivePts += mPts; mWinCnt++; }
    if (leader && kPick && isSameTeamPick(leader, kPick, g)) { kLivePts += kPts; kWinCnt++; }

    var isSweat = ls.inProgress && ((ls.period >= 4 && Math.abs(ls.awayScore - ls.homeScore) <= 8) || ls.isRedZone);

    if (liveTabFilter === "active" && !ls.inProgress) continue;
    if (liveTabFilter === "sweat" && !isSweat) continue;
    if (liveTabFilter === "diff" && !isDiff) continue;

    var wKey = g.cstWindow || "11:00 AM CST Window";
    if (!groups[wKey]) groups[wKey] = [];
    groups[wKey].push({
      g: g, ls: ls, leader: leader,
      mPick: mPick, kPick: kPick,
      mPts: mPts, kPts: kPts,
      mHiddenG: mHiddenG, kHiddenG: kHiddenG,
      isDiff: isDiff, isSweat: isSweat
    });
  }

  var mLblEl = document.getElementById("live-tab-m-label");
  if (mLblEl) mLblEl.textContent = actMeta.icon + " " + actMeta.name + " Live / Final Pts";
  var mPtsEl = document.getElementById("live-tab-m-pts");
  if (mPtsEl) {
    mPtsEl.style.color = actMeta.color || "#38bdf8";
    mPtsEl.textContent = mLivePts + " pts";
  }
  var mRecEl = document.getElementById("live-tab-m-rec");
  if (mRecEl) mRecEl.textContent = "Leading/Won: " + mWinCnt + " games";

  var kLblEl = document.getElementById("live-tab-k-label");
  if (kLblEl) kLblEl.textContent = cmpIcon + " " + cmpName + " Live / Final Pts";
  var kPtsEl = document.getElementById("live-tab-k-pts");
  if (kPtsEl) {
    kPtsEl.style.color = cmpColor || "#c084fc";
    kPtsEl.textContent = (cmpTarget && !cmpTarget.hasPicks) ? "⏳ No Sheet" : (kLivePts + " pts");
  }
  var kRecEl = document.getElementById("live-tab-k-rec");
  if (kRecEl) {
    kRecEl.textContent = (cmpTarget && !cmpTarget.hasPicks)
      ? "Awaiting weekly pick sheet"
      : ("Leading/Won: " + kWinCnt + " games • " + totalDiffCnt + " H2H diffs");
  }

  document.getElementById("live-tab-inprog").textContent = inProgCnt;
  document.getElementById("live-tab-final").textContent = "Completed: " + finalCnt + " / " + GAMES.length;

  var outHtml = "";
  for (var x = 0; x < windowsOrder.length; x++) {
    var winName = windowsOrder[x];
    var list = groups[winName] || [];
    if (list.length === 0) continue;

    outHtml += '<div class="cst-window-header">' +
      '<span>🕒 ' + winName + '</span>' +
      '<span style="font-size:0.7rem;color:var(--legacy-accent);">' + list.length + ' Game(s)</span>' +
    '</div><div class="live-grid">';

    for (var y = 0; y < list.length; y++) {
      var item = list[y];
      var gm = item.g;
      var lsObj = item.ls;
      var tileClass = "live-tile" + (item.isSweat ? " sweat-4q" : (lsObj.inProgress ? " in-progress" : ""));
      var statusBadge = lsObj.inProgress
        ? '<span class="badge badge-ev">🔴 LIVE • ' + lsObj.detail + '</span>'
        : (lsObj.completed ? '<span class="badge badge-1x">FINAL</span>' : '<span class="badge badge-ev" style="opacity:0.85;">🟢 ESPN Linked • ' + gm.kick + '</span>');

      var mHiddenLive = item.mHiddenG;
      var kHiddenLive = item.kHiddenG;
      var mStatusClass = (!mHiddenLive && item.leader && item.mPick) ? (isSameTeamPick(item.leader, item.mPick, gm) ? "win" : "lose") : "";
      var kStatusClass = (!kHiddenLive && item.leader && item.kPick) ? (isSameTeamPick(item.leader, item.kPick, gm) ? "win" : "lose") : "";
      var mLiveLabel = mHiddenLive ? "🔒 Hidden" : (!item.mPick ? "— None" : (isSameTeamPick(item.mPick, gm.away, gm) ? gm.awayCode : gm.homeCode));
      var kLiveLabel = kHiddenLive
        ? "🔒 Hidden"
        : (!item.kPick ? "⏳ No Sheet" : (isSameTeamPick(item.kPick, gm.away, gm) ? gm.awayCode : gm.homeCode));

      var awayPossBadge = (lsObj.inProgress && lsObj.possessionSide === "away") ? '<span class="poss-glow">🏈 BALL</span>' : '';
      var homePossBadge = (lsObj.inProgress && lsObj.possessionSide === "home") ? '<span class="poss-glow">🏈 BALL</span>' : '';

      var situationHtml = renderInteractiveFieldTrackerHtml(gm, lsObj);

      var tileInjHdr = gm.keyInjHeader || computeKeyInjHeaderFromLists(gm);
      var injBadgeHtml = tileInjHdr
        ? '<div style="margin:2px 0 6px 0;font-size:0.68rem;line-height:1.25;"><span class="badge ' + (tileInjHdr.indexOf("OUT") !== -1 ? 'badge-key-inj-out' : 'badge-key-inj-q') + '" style="font-size:0.66rem;padding:2px 6px;display:inline-block;white-space:normal;border-radius:4px;">' + tileInjHdr + '</span></div>'
        : '';

      var swingHeaderPill = item.isDiff
        ? ' <span class="badge badge-2x" style="font-size:0.62rem;padding:1px 5px;">⚔️ ' + (item.mPts + item.kPts) + 'pt Swing</span>'
        : '';

      var mClickAttr = mHiddenLive ? ('unlockProfileWithPrompt(\'' + activeProfile + '\')') : '';
      var kClickAttr = (kHiddenLive && cmpTarget && !cmpTarget.isPoolMember) ? ('unlockProfileWithPrompt(\'' + cmpTarget.key + '\')') : '';

      outHtml += '<div class="' + tileClass + '">' +
        '<div class="live-tile-top">' +
          '<span><strong>#' + gm.id + '</strong> • Sheet: ' + gm.poolLine + swingHeaderPill + '</span>' +
          statusBadge +
        '</div>' +
        injBadgeHtml +
        '<div class="live-team-row ' + (item.leader === gm.away ? 'leader' : '') + '">' +
          '<span>' + gm.away + ' <span style="font-size:0.68rem;color:var(--muted);">(' + gm.awayRec + ' • ' + gm.awayPts + 'x • 👥 ' + getGamePoolOwnership(gm).awayPct + '%)</span>' + awayPossBadge + '</span>' +
          '<span class="live-score-num">' + (lsObj.inProgress || lsObj.completed ? lsObj.awayScore : '—') + '</span>' +
        '</div>' +
        '<div class="live-team-row ' + (item.leader === gm.home ? 'leader' : '') + '">' +
          '<span>' + gm.home + ' <span style="font-size:0.68rem;color:var(--muted);">(' + gm.homeRec + ' • ' + gm.homePts + 'x • 👥 ' + getGamePoolOwnership(gm).homePct + '%)</span>' + homePossBadge + '</span>' +
          '<span class="live-score-num">' + (lsObj.inProgress || lsObj.completed ? lsObj.homeScore : '—') + '</span>' +
        '</div>' +
        situationHtml +
        '<div class="live-picks-footer">' +
          '<div class="live-pick-Status ' + mStatusClass + '" style="' + (mHiddenLive ? 'cursor:pointer;' : '') + '" onclick="' + mClickAttr + '">' +
            '<span>' + actMeta.icon + ' ' + actMeta.shortName + ': <strong>' + mLiveLabel + '</strong></span>' +
            '<span>' + (mHiddenLive ? '🔒' : (item.mPts + 'x')) + '</span>' +
          '</div>' +
          '<div class="live-pick-Status ' + kStatusClass + '" style="' + (kClickAttr ? 'cursor:pointer;' : '') + '" onclick="' + kClickAttr + '">' +
            '<span>' + cmpIcon + ' ' + cmpShort + ': <strong>' + kLiveLabel + '</strong></span>' +
            '<span>' + (kHiddenLive ? '🔒' : (!item.kPick ? '—' : (item.kPts + 'x'))) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    outHtml += '</div>';
  }

  var emptyLiveMsg = (liveTabFilter === "diff")
    ? ('No Head-to-Head swing games found between ' + actMeta.name + ' and ' + cmpName + ' (or one of the profiles is currently locked). Tap "All 23 Games" to view the full CST schedule.')
    : 'No games match that live filter right now. Tap "All 23 Games" to view the full CST schedule.';
  container.innerHTML = outHtml || ('<div class="side-box" style="text-align:center;color:var(--muted);">' + emptyLiveMsg + '</div>');
}

function renderGames() {
  ensureWatchlistDefaults();
  syncSubpanelToggleButtons();
  var q = (document.getElementById("team-search").value || "").trim().toLowerCase();
  var container = document.getElementById("games-container");
  var html = "";

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var maxPts = Math.max(g.awayPts, g.homePts);
    var cmpCardDesc = resolveCompareTargetDescriptor();
    var actPickForDiff = getResolvedPickForGame(state[activeProfile].picks, g, true);
    var otherPickForDiff = (cmpCardDesc && cmpCardDesc.hasPicks) ? getResolvedPickForGame(cmpCardDesc.picks, g, !cmpCardDesc.isPoolMember) : null;
    var isDiffHidden = isProfileHiddenFromViewer(activeProfile, g.id) || (cmpCardDesc ? cmpCardDesc.isHiddenForGame(g.id) : false);
    var isDiff = (isDiffHidden || !otherPickForDiff) ? false : !isSameTeamPick(actPickForDiff, otherPickForDiff, g);
    var awayEVNum = +(g.awayProb * g.awayPts).toFixed(2);
    var homeEVNum = +(g.homeProb * g.homePts).toFixed(2);
    var isPlusEvDog = (g.awayPts > 1 && awayEVNum >= 0.65) || (g.homePts > 1 && homeEVNum >= 0.65);
    var isBestValueOrDiff = isPlusEvDog || g.tier.indexOf("Multiplier") !== -1 || g.tier.indexOf("Sharp") !== -1 || g.tier.indexOf("Contrarian") !== -1;

    var cardInjHdr = g.keyInjHeader || computeKeyInjHeaderFromLists(g);
    var outCount = 0, qCount = 0;
    var countOuts = function(list) {
      if (!Array.isArray(list)) return;
      for (var idx = 0; idx < list.length; idx++) {
        var it = list[idx];
        if (!it) continue;
        if (it.st === "OUT") outCount++;
        else if (it.st === "QUESTIONABLE") qCount++;
      }
    };
    countOuts(g.awayInj);
    countOuts(g.homeInj);

    var ownInfo = getGamePoolOwnership(g);
    if ((currentFilter === "plusev" || currentFilter === "ev") && !isBestValueOrDiff) continue;
    if (currentFilter === "leverage" && !ownInfo.isHighLeverage) continue;
    if (currentFilter === "sway" && !g.sway && !g.cliffTrap) continue;
    if (currentFilter === "2x" && maxPts !== 2) continue;
    if (currentFilter === "3x" && maxPts !== 3) continue;
    if (currentFilter === "diffs" && !isDiff) continue;
    if (currentFilter === "inj" && !cardInjHdr && outCount === 0 && qCount === 0) continue;
    if (currentFilter === "missing" && getResolvedPickForGame(state[activeProfile].picks, g, false)) continue;

    if (q) {
      var awayL5 = getTeamLog(g.away).l5.map(function(x) { return x.opp; }).join(" ");
      var homeL5 = getTeamLog(g.home).l5.map(function(x) { return x.opp; }).join(" ");
      var awayInjNames = (g.awayInj || []).map(function(x) { return (x.p || "") + " " + (x.note || ""); }).join(" ");
      var homeInjNames = (g.homeInj || []).map(function(x) { return (x.p || "") + " " + (x.note || ""); }).join(" ");
      var curInjHdr = cardInjHdr || "";
      var hay = (g.away + " " + g.home + " " + g.awayCode + " " + g.homeCode + " " + awayL5 + " " + homeL5 + " " + g.rationale + " " + curInjHdr + " " + awayInjNames + " " + homeInjNames).toLowerCase();
      if (hay.indexOf(q) === -1) continue;
    }

    var activeMetaObj = getProfileMetaByKey(activeProfile);
    var activeIsHidden = isProfileHiddenFromViewer(activeProfile, g.id);
    var activePick = activeIsHidden ? null : getResolvedPickForGame(state[activeProfile].picks, g, true);
    var leaderRival = state.watchlist[0];
    var leaderPick = leaderRival ? getResolvedPickForGame(leaderRival.picks, g, false) : null;
    var awayEV = awayEVNum.toFixed(2);
    var homeEV = homeEVNum.toFixed(2);

    var cardMultClass = maxPts === 3 ? "mult-3x" : (maxPts === 2 ? "mult-2x" : "");
    var swayClass = g.sway ? "sway-active" : "";
    var selClsName = activeMetaObj.selClass || "selected-custom";
    var awaySelClass = (activePick && isSameTeamPick(activePick, g.away, g)) ? selClsName : "";
    var homeSelClass = (activePick && isSameTeamPick(activePick, g.home, g)) ? selClsName : "";

    var ls = LIVE_SCORES[g.id];
    var awayLiveClass = "", homeLiveClass = "", liveBannerHtml = "";
    var awayPossHtml = "", homePossHtml = "";

    if (ls && (ls.inProgress || ls.completed)) {
      var diffScore = Math.abs(ls.awayScore - ls.homeScore);
      var isSweat4Q = ls.inProgress && ((ls.period >= 4 && diffScore <= 8) || ls.isRedZone);
      if (isSweat4Q) {
        awayLiveClass = "live-sweat-4q";
        homeLiveClass = "live-sweat-4q";
      } else if (ls.awayScore > ls.homeScore) {
        awayLiveClass = "live-winning";
        homeLiveClass = "live-losing";
      } else if (ls.homeScore > ls.awayScore) {
        homeLiveClass = "live-winning";
        awayLiveClass = "live-losing";
      }

      if (ls.inProgress && ls.possessionSide === "away") awayPossHtml = '<span class="poss-glow">🏈 BALL</span>';
      if (ls.inProgress && ls.possessionSide === "home") homePossHtml = '<span class="poss-glow">🏈 BALL</span>';

      liveBannerHtml = '<div class="live-score-banner">' +
        '<span>🔴 <strong>' + (ls.completed ? 'FINAL' : 'LIVE (' + ls.detail + ')') + ':</strong> ' + g.away + ' <strong>' + ls.awayScore + '</strong> — ' + g.home + ' <strong>' + ls.homeScore + '</strong></span>' +
        '<div>' +
          (ls.isRedZone ? '<span class="rz-pill" style="margin-right:4px;">🚨 RED ZONE</span>' : '') +
          (isSweat4Q ? '<span class="badge badge-sway">⚡ 4Q SWEAT!</span>' : '') +
        '</div>' +
      '</div>' +
      ((ls.inProgress || ls.completed || DEMO_FIELD_PREVIEW) ? '<div style="margin-bottom:8px;">' + renderInteractiveFieldTrackerHtml(g, ls) + '</div>' : '');
    } else if (DEMO_FIELD_PREVIEW) {
      liveBannerHtml = '<div style="margin-bottom:8px;">' + renderInteractiveFieldTrackerHtml(g, null) + '</div>';
    }

    var commonMap = getCommonOpponentsMap(g.away, g.home);
    var commonCount = Object.keys(commonMap).length;

    var awayWlTags = "", homeWlTags = "";
    for (var w = 0; w < state.watchlist.length; w++) {
      var rv = state.watchlist[w];
      var rvPick = getResolvedPickForGame(rv.picks, g, false);
      if (rvPick === g.away) awayWlTags += '<span class="p-tag p-tag-w">👀 ' + rv.name.slice(0, 7) + '</span>';
      if (rvPick === g.home) homeWlTags += '<span class="p-tag p-tag-w">👀 ' + rv.name.slice(0, 7) + '</span>';
    }

    var strategyBadge = !leaderPick
      ? '<span class="watchlist-pill">⏳ ' + (leaderRival ? leaderRival.name : 'Rivals') + ': No Pick Yet</span>'
      : ((activePick === leaderPick)
          ? '<span class="wl-defense-badge">🛡️ Defense (Matches ' + leaderRival.name + ')</span>'
          : '<span class="wl-offense-badge">⚔️ Offense (Diffs ' + leaderRival.name + ')</span>');

    html += '<div id="game-card-' + g.id + '" class="game-card ' + cardMultClass + ' ' + swayClass + '">' +
      '<div class="game-header">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          '<span class="game-num">#' + g.id + '</span>' +
          '<span style="font-size:0.74rem;color:var(--muted);">' + g.kick + ' • Sheet: <strong>' + g.poolLine + '</strong> • Live: <strong>' + g.liveLine + '</strong></span>' +
          (cardInjHdr ? '<span class="badge ' + (cardInjHdr.indexOf("OUT") !== -1 ? 'badge-key-inj-out' : 'badge-key-inj-q') + '">' + cardInjHdr + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">' +
          buildLockedProfilesHeaderBadgesHtml(g) +
          strategyBadge +
          (ownInfo.isHighLeverage ? '<span class="badge badge-leverage" title="Win Probability exceeds Pool Ownership %">💎 Leverage: ' + ownInfo.bestLevCode + ' (+' + ownInfo.bestLevEdge + '% vs Pool)</span>' : '') +
          (isPlusEvDog ? '<span class="badge badge-plus-ev-glow">🔥 +EV Dog</span>' : '') +
          (g.cliffTrap ? '<span class="badge badge-cliff-trap">' + g.cliffTrap + '</span>' : '') +
          '<span class="badge ' + (maxPts === 3 ? 'badge-3x' : (maxPts === 2 ? 'badge-2x' : 'badge-1x')) + '">' +
            (maxPts === 3 ? '3x Dog' : (maxPts === 2 ? '2x Dog' : '1x Game')) +
          '</span>' +
          '<span class="badge badge-ev">★ Rec: ' + g.rec + '</span>' +
        '</div>' +
      '</div>' +
      liveBannerHtml +
      (g.sway ? '<div class="sway-banner"><div><strong>⚡ ' + g.sway.title + ':</strong> ' + g.sway.detail + '</div></div>' : '') +
      '<div class="teams-grid">' +
        '<button class="team-btn ' + awaySelClass + ' ' + awayLiveClass + '" onclick="pickSide(' + g.id + ', 1)">' +
          '<div class="team-top"><div><span class="team-name">' + g.away + '</span><span class="sheet-code">[' + g.awayCode + ']</span>' + awayPossHtml +
          (g.awaySit ? '<div><span class="sit-pill">' + g.awaySit + '</span></div>' : '') +
          '<div style="font-size:0.7rem;color:var(--muted);margin-top:2px;">' + g.awayRec + ' • Away</div></div>' +
          '<span class="pts-pill ' + (g.awayPts === 3 ? 'pts-3x' : (g.awayPts === 2 ? 'pts-2x' : '')) + '">' + g.awayPts + ' pt' + (g.awayPts > 1 ? 's (' + g.awayPts + 'x)' : '') + '</span></div>' +
          '<div class="team-meta"><span>Win: <strong>' + Math.round(g.awayProb * 100) + '%</strong></span><span>👥 ' + ownInfo.sourceLabel + ': <strong>' + ownInfo.awayPct + '%</strong></span><span>EV: <strong>' + awayEV + '</strong> ' + (ownInfo.awayLev >= 10 ? '<span class="lev-pill">💎 +' + ownInfo.awayLev + '% Lev</span>' : (g.awayPts > 1 && awayEVNum >= 0.65 ? '🔥' : '')) + '</span></div>' +
          '<div class="profile-pills">' +
            buildTeamPickPillsHtml(g, g.away) +
          '</div>' +
          (showShadowBadges ? '<div class="shadow-badge-row">' +
            (g.rec === g.away ? '<span class="shadow-pill shadow-gemini">🤖 Gemini</span>' : '') +
            ((g.grokPick || g.rec) === g.away ? '<span class="shadow-pill shadow-grok">⚡ Grok</span>' : '') +
          '</div>' : '') +
        '</button>' +
        '<button class="team-btn ' + homeSelClass + ' ' + homeLiveClass + '" onclick="pickSide(' + g.id + ', 2)">' +
          '<div class="team-top"><div><span class="team-name">' + g.home + '</span><span class="sheet-code">[' + g.homeCode + ']</span>' + homePossHtml +
          (g.homeSit ? '<div><span class="sit-pill">' + g.homeSit + '</span></div>' : '') +
          '<div style="font-size:0.7rem;color:var(--muted);margin-top:2px;">' + g.homeRec + ' • Home</div></div>' +
          '<span class="pts-pill ' + (g.homePts === 3 ? 'pts-3x' : (g.homePts === 2 ? 'pts-2x' : '')) + '">' + g.homePts + ' pt' + (g.homePts > 1 ? 's (' + g.homePts + 'x)' : '') + '</span></div>' +
          '<div class="team-meta"><span>Win: <strong>' + Math.round(g.homeProb * 100) + '%</strong></span><span>👥 ' + ownInfo.sourceLabel + ': <strong>' + ownInfo.homePct + '%</strong></span><span>EV: <strong>' + homeEV + '</strong> ' + (ownInfo.homeLev >= 10 ? '<span class="lev-pill">💎 +' + ownInfo.homeLev + '% Lev</span>' : (g.homePts > 1 && homeEVNum >= 0.65 ? '🔥' : '')) + '</span></div>' +
          '<div class="profile-pills">' +
            buildTeamPickPillsHtml(g, g.home) +
          '</div>' +
          (showShadowBadges ? '<div class="shadow-badge-row">' +
            (g.rec === g.home ? '<span class="shadow-pill shadow-gemini">🤖 Gemini</span>' : '') +
            ((g.grokPick || g.rec) === g.home ? '<span class="shadow-pill shadow-grok">⚡ Grok</span>' : '') +
          '</div>' : '') +
        '</button>' +
      '</div>' +
      '<div class="own-bar-wrap">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:var(--text);font-weight:700;">👥 ' + g.awayCode + ' ' + ownInfo.sourceLabel + ': ' + ownInfo.awayPct + '% (' + ownInfo.awayCount + ')</span>' +
          '<span style="color:var(--muted);font-size:0.64rem;">' + (ownInfo.isHighLeverage ? ('💎 Leverage Edge: ' + ownInfo.bestLevTeam + ' (+' + ownInfo.bestLevEdge + '% vs Field)') : ('Pool Pick Split (' + ownInfo.total + ' entries)')) + '</span>' +
          '<span style="color:var(--text);font-weight:700;">' + g.homeCode + ' ' + ownInfo.sourceLabel + ': ' + ownInfo.homePct + '% (' + ownInfo.homeCount + ') 👥</span>' +
        '</div>' +
        '<div class="own-bar-track">' +
          '<div class="own-bar-away" style="width:' + ownInfo.awayPct + '%"></div>' +
          '<div class="own-bar-home" style="width:' + ownInfo.homePct + '%"></div>' +
        '</div>' +
      '</div>' +
      '<div class="rationale-box">' + g.rationale + '</div>' +
      '<div class="sub-toggles">' +
        '<button class="btn-sm" style="border-color:var(--legacy-accent);color:var(--legacy-accent);" onclick="toggleCardIdx(' + g.id + ', 1)">🧠 Insights</button>' +
        '<button class="btn-sm" onclick="toggleCardIdx(' + g.id + ', 2)">📅 Last 5 ' + (commonCount > 0 ? '<span style="color:var(--gold);">★' + commonCount + '</span>' : '') + '</button>' +
        '<button class="btn-sm" onclick="toggleCardIdx(' + g.id + ', 3)">🚑 Injuries' + (outCount > 0 ? (' <span style="background:var(--loss);color:var(--text);font-size:0.62rem;font-weight:900;padding:1px 5px;border-radius:999px;">' + outCount + ' OUT</span>') : (qCount > 0 ? (' <span style="background:var(--accent);color:var(--on-accent);font-size:0.62rem;font-weight:900;padding:1px 5px;border-radius:999px;">' + qCount + ' Q</span>') : '')) + '</button>' +
      '</div>' +
      renderInsightsPanel(g) +
      '<div id="l5-' + g.id + '" class="dual-panel ' + (showAllL5 ? '' : 'hidden') + '">' + renderL5Column(g.away, g.awayRec, commonMap) + renderL5Column(g.home, g.homeRec, commonMap) + '</div>' +
      '<div id="inj-' + g.id + '" class="dual-panel ' + (showAllInj ? '' : 'hidden') + '">' + renderInjColumn(g.away, g.awayInj) + renderInjColumn(g.home, g.homeInj) + '</div>' +
    '</div>';
  }

  container.innerHTML = html || '<div class="side-box">No games match your current filter.</div>';
}

function toggleCardIdx(gameId, panelCode) {
  var prefix = panelCode === 1 ? "ins-" : (panelCode === 2 ? "l5-" : "inj-");
  var el = document.getElementById(prefix + gameId);
  if (el) el.classList.toggle("hidden");
}

function syncSubpanelToggleButtons() {
  var bIns = document.getElementById("btn-toggle-all-ins");
  var bL5 = document.getElementById("btn-toggle-all-l5");
  var bInj = document.getElementById("btn-toggle-all-inj");
  if (bIns) bIns.className = "btn-sm" + (showAllIns ? " active" : "");
  if (bL5) bL5.className = "btn-sm" + (showAllL5 ? " active" : "");
  if (bInj) bInj.className = "btn-sm" + (showAllInj ? " active" : "");
}

function toggleAllSubpanels(type) {
  if (type === "ins") showAllIns = !showAllIns;
  if (type === "l5") showAllL5 = !showAllL5;
  if (type === "inj") showAllInj = !showAllInj;
  syncSubpanelToggleButtons();
  renderGames();
}

function setFilter(flt) {
  currentFilter = flt;
  var list = ["all", "missing", "plusev", "leverage", "sway", "ev", "2x", "3x", "diffs", "inj"];
  for (var i = 0; i < list.length; i++) {
    var k = list[i];
    var btn = document.getElementById("flt-" + k);
    if (btn) btn.className = "btn-sm" + (k === flt ? " active" : "");
  }
  renderGames();
}

function clearSearch() {
  document.getElementById("team-search").value = "";
  renderGames();
}

function openPasteSheetModal() {
  openUnifiedImportModal("pdf");
}

function triggerFileInputClick() {
  var inp = document.getElementById("pdf-file-input");
  if (inp) inp.click();
}

async function handlePdfFileSelect(file) {
  if (!file) return;
  var statusEl = document.getElementById("pdf-parse-status");
  statusEl.textContent = "↻ Reading PDF & extracting games...";
  try {
    var arrayBuffer = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var fullLines = [];
    var KNOWN_CODES = {
      'arizona':1, 'ttech':1, 'smu':1, 'syr':1, 'wisc':1, 'iowa':1, 'bc':1, 'duke':1, 'illinois':1, 'mary':1, 'mich':1,
      'rutgers':1, 'auburn':1, 'olemiss':1, 'kstate':1, 'colo':1, 'florida':1, 'georgia':1, 'minn':1, 'indiana':1,
      'arizst':1, 'byu':1, 'nwest':1, 'oregon':1, 'utah':1, 'cincy':1, 'virginia':1, 'wake':1, 'socar':1, 'okla':1,
      'oklast':1, 'iowast':1, 'clem':1, 'fsu':1, 'miami':1, 'unc':1, 'ohiost':1, 'usc':1, 'missst':1, 'texas':1,
      'gatech':1, 'pitt':1, 'mizzou':1, 'ark':1, 'wash':1, 'neb':1
    };

    for (var pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      var page = await pdf.getPage(pageNum);
      var textContent = await page.getTextContent();
      var rows = {};
      for (var j = 0; j < textContent.items.length; j++) {
        var item = textContent.items[j];
        var y = Math.round(item.transform[5] / 4) * 4;
        if (!rows[y]) rows[y] = [];
        rows[y].push({ x: item.transform[4], str: item.str });
      }
      var sortedY = Object.keys(rows).map(Number).sort(function(a, b) { return b - a; });
      for (var k = 0; k < sortedY.length; k++) {
        var yKey = sortedY[k];
        var lineStr = rows[yKey].sort(function(a, b) { return a.x - b.x; }).map(function(i) { return i.str; }).join(" ").trim();
        if (!lineStr) continue;
        if (KNOWN_CODES[lineStr.toLowerCase()]) continue; // skip isolated radio button codes
        // If attached at front of line, strip it
        var words = lineStr.split(/\s+/);
        if (words.length > 1 && KNOWN_CODES[words[0].toLowerCase()] && (words[1].indexOf("#") === 0 || words[1].toLowerCase() === "at" || words[1].toLowerCase().indexOf("vs") === 0)) {
          lineStr = words.slice(1).join(" ");
        }
        fullLines.push(lineStr);
      }
    }
    document.getElementById("raw-sheet-text").value = fullLines.join("\n");
    statusEl.textContent = "✓ Extracted PDF! Crawling ESPN & syncing to Firebase...";
    await importStrictSheetText();
  } catch (err) {
    statusEl.textContent = "Error reading PDF: " + err.message;
  }
}

async function importStrictSheetText() {
  var raw = (document.getElementById("raw-sheet-text").value || "").trim();
  if (!raw) return;
  var rawLines = raw.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
  var KNOWN_CODES = {
    'arizona':1, 'ttech':1, 'smu':1, 'syr':1, 'wisc':1, 'iowa':1, 'bc':1, 'duke':1, 'illinois':1, 'mary':1, 'mich':1,
    'rutgers':1, 'auburn':1, 'olemiss':1, 'kstate':1, 'colo':1, 'florida':1, 'georgia':1, 'minn':1, 'indiana':1,
    'arizst':1, 'byu':1, 'nwest':1, 'oregon':1, 'utah':1, 'cincy':1, 'virginia':1, 'wake':1, 'socar':1, 'okla':1,
    'oklast':1, 'iowast':1, 'clem':1, 'fsu':1, 'miami':1, 'unc':1, 'ohiost':1, 'usc':1, 'missst':1, 'texas':1,
    'gatech':1, 'pitt':1, 'mizzou':1, 'ark':1, 'wash':1, 'neb':1
  };

  var lines = [];
  for (var rl = 0; rl < rawLines.length; rl++) {
    var l = rawLines[rl];
    if (KNOWN_CODES[l.toLowerCase()]) continue;
    var words = l.split(/\s+/);
    if (words.length > 1 && KNOWN_CODES[words[0].toLowerCase()] && (words[1].indexOf("#") === 0 || words[1].toLowerCase() === "at" || words[1].toLowerCase().indexOf("vs") === 0)) {
      l = words.slice(1).join(" ");
    }
    lines.push(l);
  }

  var parsedGames = [];

  for (var i = 0; i < lines.length - 1; i++) {
    var nextLine = lines[i + 1].trim();
    var mMatch = nextLine.match(/^(?:at|vs\.?)\s+(.*)/i);
    if (mMatch) {
      var awayLine = lines[i];
      var homeLine = mMatch[1].trim();
      var candKick = lines[i + 2] || "";
      var nextAfterCand = lines[i + 3] || "";
      var kickLine = isLikelyKickoffLine(candKick, nextAfterCand) ? candKick : "Saturday CST";

      // Robust spread parsing: supports (-3.5), (- 3.5), (-14), etc.
      var spAway = awayLine.match(/\(\s*-\s*(\d+\.?\d*)\s*\)/);
      var spHome = homeLine.match(/\(\s*-\s*(\d+\.?\d*)\s*\)/);
      var favIsAway = !!spAway;
      var spread = spAway ? parseFloat(spAway[1]) : (spHome ? parseFloat(spHome[1]) : 3.5);

      var awayRecMatch = awayLine.match(/(?:#\d+\s*)?\d+-\d+/);
      var homeRecMatch = homeLine.match(/(?:#\d+\s*)?\d+-\d+/);

      var away = awayLine.replace(/#\d+/g, "").replace(/\d+-\d+/g, "").replace(/\([^)]*\)/g, "").replace(/\$|\=|\*/g, "").trim();
      var home = homeLine.replace(/#\d+/g, "").replace(/\d+-\d+/g, "").replace(/\([^)]*\)/g, "").replace(/\$|\=|\*/g, "").trim();
      if (!away || !home) continue;

      var dogPts = spread >= 14.5 ? 3 : (spread >= 7.5 ? 2 : 1);
      var favProb = Math.min(0.92, 0.50 + spread * 0.0235);
      var dogProb = +(1 - favProb).toFixed(2);
      var awayProb = favIsAway ? +favProb.toFixed(2) : dogProb;
      var homeProb = favIsAway ? dogProb : +favProb.toFixed(2);
      var awayPts = favIsAway ? 1 : dogPts;
      var homePts = favIsAway ? dogPts : 1;
      var rec = favIsAway ? away : home;
      var poolLine = (favIsAway ? away : home) + " -" + spread;

      var cstWin = "11:00 AM CST Window";
      if (kickLine.indexOf("2:30") !== -1 || kickLine.indexOf("3:00") !== -1) cstWin = "2:30 PM CST Window";
      else if (kickLine.indexOf("6:00") !== -1 || kickLine.indexOf("6:30") !== -1 || kickLine.indexOf("7:00") !== -1) cstWin = "6:00 PM / 6:30 PM CST Primetime";
      else if (kickLine.indexOf("9:") !== -1 || kickLine.indexOf("10:") !== -1) cstWin = "9:15 PM+ CST Late Night Window";

      var isTb = (away.toLowerCase().indexOf("florida") !== -1 && home.toLowerCase().indexOf("georgia") !== -1) ||
                 (home.toLowerCase().indexOf("florida") !== -1 && away.toLowerCase().indexOf("georgia") !== -1);

      parsedGames.push({
        id: parsedGames.length + 1,
        num: parsedGames.length + 1,
        cstWindow: cstWin,
        away: away, awayCode: getCleanTeamCode(away), awayRec: awayRecMatch ? awayRecMatch[0] : "",
        home: home, homeCode: getCleanTeamCode(home), homeRec: homeRecMatch ? homeRecMatch[0] : "",
        kick: kickLine,
        poolLine: poolLine,
        liveLine: poolLine,
        mondayPoolLine: poolLine,
        mondayAwayPts: awayPts,
        mondayHomePts: homePts,
        awayPts: awayPts, homePts: homePts,
        awayProb: awayProb, homeProb: homeProb,
        rec: rec, grokPick: rec, kinyionDefault: rec,
        tier: isTb ? (dogPts + "x (Tiebreaker Game)") : (dogPts + "x"),
        isTiebreaker: isTb,
        sway: null,
        rationale: "Official Week Slate Matchup #" + (parsedGames.length + 1) + ". Tier " + dogPts + "x (" + spread + " pt spread).",
        insights: {
          vegas: "Pool Spread: " + poolLine + " | Win Prob: " + away + " " + Math.round(awayProb * 100) + "% vs " + home + " " + Math.round(homeProb * 100) + "%",
          stats: away + " vs " + home + " official sheet matchup.",
          matchup: "Positional matchup favoring " + rec + ".",
          splits: kickLine
        },
        awayInj: [{ p: away + " Starters", pos: "TEAM", st: "FULL", note: "Synced via ESPN" }],
        homeInj: [{ p: home + " Starters", pos: "TEAM", st: "FULL", note: "Synced via ESPN" }]
      });
    }
  }

  closeOppModal();
  if (parsedGames.length > 0) {
    var detectedTbId = null;
    for (var tbi = 0; tbi < parsedGames.length; tbi++) {
      if (parsedGames[tbi].isTiebreaker) {
        detectedTbId = parsedGames[tbi].id;
        break;
      }
    }
    state.tiebreakerGameId = detectedTbId || 9;
    state.tiebreakerOverUnder = 56.5;
    GAMES = parsedGames;
    LIVE_SCORES = {};
    var wkMatch = raw.match(/week\s*(\d{1,2})/i);
    if (wkMatch) {
      state.currentWeek = parseInt(wkMatch[1], 10);
      state.weekLabel = "Week " + state.currentWeek;
    } else {
      state.currentWeek = 9;
      state.weekLabel = "Week 9";
    }
    resetPoolPicksForNewWeek(false);
    hardResetToDefaults();
    await syncAllLiveTrackingData(true);
    pushCustomGamesToFirebase();
    pushWatchlistOrStandingsToFirebase();
    renderAll();
    showAppToast("✓ Imported " + parsedGames.length + " official games with correct lines!");
  }
}


function closeOppModal() {
  document.getElementById("opp-modal-backdrop").style.display = "none";
}

function copyPicksToClipboard() {
  if (isProfileHiddenFromViewer(activeProfile, null)) {
    unlockProfileWithPrompt(activeProfile, function() { copyPicksToClipboard(); });
    return;
  }
  var picks = state[activeProfile].picks;
  var lines = [];
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var pick = getResolvedPickForGame(picks, g, false);
    if (!pick) {
      lines.push(g.id + ". [NO PICK SELECTED]");
      continue;
    }
    var isAw = isSameTeamPick(pick, g.away, g);
    var code = isAw ? g.awayCode : g.homeCode;
    var pts = isAw ? g.awayPts : g.homePts;
    lines.push(g.id + ". " + code + " (" + pick + ") [" + pts + " pt" + (pts > 1 ? "s" : "") + "]");
  }
  lines.push("Tie-Breaker: " + state[activeProfile].tiebreaker);
  var outText = lines.join("\n");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(outText).catch(function() {});
    } else {
      throw new Error("clipboard_fallback");
    }
  } catch (e) {
    var tmpTa = document.createElement("textarea");
    tmpTa.value = outText;
    tmpTa.style.position = "fixed";
    tmpTa.style.opacity = "0";
    document.body.appendChild(tmpTa);
    tmpTa.select();
    try { document.execCommand("copy"); } catch (e2) {}
    document.body.removeChild(tmpTa);
  }
  document.getElementById("copy-status").textContent = "✓ Copied all 23 official form picks + Tie-Breaker!";
  setTimeout(function() { document.getElementById("copy-status").textContent = ""; }, 3000);
}


