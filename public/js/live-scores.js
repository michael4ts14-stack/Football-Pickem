// ============================================================================
// UPDATED POLL LIVE SCORES, SCOREBOARD, STANDINGS, LIVE TAB & RESEARCH CARDS
// ============================================================================
async function pollLiveSaturdayScores(manual) {
  var badge = document.getElementById("live-sync-badge") || document.createElement("span");
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
      if (item.ev.date && g.kickoffIso !== item.ev.date) g.kickoffIso = item.ev.date; // pick locks
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

      // Cancelled / postponed / suspended games are voided: never graded as a loss.
      var isVoid = /CANCEL|POSTPON|SUSPEND|FORFEIT/i.test(String(stType.name || ""));
      var isInProg = stType.state === "in" && !isVoid;
      var isComp = stType.completed === true && !isVoid;
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
        voided: isVoid,
        statusName: stType.name || "",
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

      // Drives and plays are no longer fetched here for every game on every poll: field views
      // load them on demand from Firestore (js/live/live-feed.js).
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
  var mLiveRank = "", kLiveRank = "";
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
    diffsEl.textContent = !cmpDesc ? "–" : ((activeHidden || otherHidden) ? "🔒 Hidden" : (!cmpDesc.hasPicks ? "⏳ No Sheet" : (diffs + " games")));
  }
  var diffLabelEl = document.getElementById("h2h-diffs-label");
  if (diffLabelEl) {
    diffLabelEl.textContent = getProfileMetaByKey(activeProfile).shortName + " vs " + (cmpDesc ? cmpDesc.shortName : "nobody chosen") + " Diffs:";
  }
  var fltDiffBtn = document.getElementById("flt-diffs");
  if (fltDiffBtn) {
    fltDiffBtn.textContent = cmpDesc ? "Diffs vs " + cmpDesc.shortName : "H2H Diffs";
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
    // Real rank from the pool leaderboard; the old hardcoded "T-64th"/"T-57th" defaults are gone.
    var myRankLabel = (typeof getMyPoolRankLabel === "function" && getMyPoolRankLabel()) ||
      (myKey === "michael" ? mLiveRank : (myKey === "kinyion" ? kLiveRank : "")) || "Unranked";
    var mySubLabel = myTotPts + " pts (" + myRankLabel + (myWkBest > 0 ? " • +" + myWkBest + " wk" : "") + ")";
    var testMetrics = calcProfileMetrics("test") || m;

    tabsWrap.style.gridTemplateColumns = "1fr 1fr";
    tabsWrap.innerHTML =
      '<button type="button" class="profile-tab ' + (isOfficialActive ? myMeta.tabClass : '') + '" onclick="switchProfile(\'' + myKey + '\')" title="Your bound official picks instance">' +
        '🏈 ' + escapeHtml(myMeta.name) + ' (You)' + (myPriv.hidden ? ' 🔒' : '') + '<br><span style="font-size:0.66rem;font-weight:500;">' + mySubLabel + '</span>' +
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
        '<td><strong style="color:' + cmpDesc.color + ';">⚔️ ' + escapeHtml(cmpDesc.name) + ' (H2H)</strong>' + (cmpHid ? ' <span style="font-size:0.62rem;color:var(--loss);">🔒 Pre-Kickoff</span>' : '') + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (!cmpDesc.hasPicks ? '⏳' : (cmpM.ceiling + ' pts'))) + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (!cmpDesc.hasPicks ? '⏳' : cmpM.ev.toFixed(1))) + '</td>' +
        '<td style="color:var(--green);font-weight:800;">' + (cmpHid ? '🔒' : ('+' + cmpWkBest)) + '</td>' +
        '<td>' + (cmpHid ? '🔒' : (cmpM.wonGames + '-' + cmpM.lostGames + ' (' + cmpM.finalWonPts + 'p)')) + '</td>' +
      '</tr>';
    }

    var testWkBest = Math.max(testMetrics.liveProjectedPts, testMetrics.finalWonPts);
    tbodyH2h.innerHTML =
      '<tr>' +
        '<td><strong style="color:' + myMeta.color + ';">🏈 ' + escapeHtml(myMeta.name) + ' (You)</strong></td>' +
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
      privStatusEl.innerHTML = '🔒 <strong>' + escapeHtml(curMeta.shortName) + '</strong> Hidden From Others Until Kickoff';
      privStatusEl.style.color = "var(--win)";
      quickHideBtn.textContent = "👁️ Make Public";
      quickHideBtn.style.borderColor = "var(--border)";
      quickHideBtn.style.color = "var(--win)";
    } else {
      privStatusEl.innerHTML = '👁️ <strong>' + escapeHtml(curMeta.shortName) + '</strong> Visible to Pool' + (BLIND_MODE ? ' (🙈 Blind ON)' : '');
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
  // Only shows a simulation that already ran (Standings › Finish odds or the EV drawer); never runs one here.
  var mcQuick = (typeof MONTE_CARLO_CACHE !== "undefined") ? MONTE_CARLO_CACHE : null;
  var mcSummaryStrip = !mcQuick ? '' : '<div style="margin-top:8px;padding:6px 8px;background:var(--raised);border:1px solid var(--border);border-radius:6px;display:flex;justify-content:space-between;align-items:center;font-size:0.7rem;cursor:pointer;" onclick="switchMainView(\'standings\'); toggleMobileSidebar(false);" title="Tap to open full 5,000-Trial Monte Carlo Simulator">' +
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
        '<span><strong>' + escapeHtml(rival.name) + '</strong> <span style="color:var(--muted);">(' + rival.rank + ' • Prior ' + rival.priorPts + 'p)</span></span>' +
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
    : gradePickMap({}, false, false); // no compare target: nobody to grade against

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
        if (winTeam && isSameTeamPick(winTeam, mp, g)) swingCompletedWinsM += getGamePickPts(g, isSameTeamPick(mp, g.away, g));
        if (winTeam && isSameTeamPick(winTeam, kp, g)) swingCompletedWinsK += getGamePickPts(g, isSameTeamPick(kp, g.away, g));
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

  var cmpName = cmpTarget ? cmpTarget.name : "";
  var cmpShort = cmpTarget ? cmpTarget.shortName : "";
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
        '<div style="font-size:0.74rem;font-weight:800;color:' + actMeta.color + ';text-transform:uppercase;">' + actMeta.icon + ' ' + escapeHtml(actMeta.name) + ' (Active) — Auto-Grade Report</div>' +
        '<div style="font-size:1.3rem;font-weight:900;color:var(--text);margin:4px 0;">New Live Total: <span style="color:' + actMeta.color + ';">' + mNewLiveTotal + ' pts</span> <span style="font-size:0.8rem;color:var(--green);">(+' + mWkPts + ' wk • Prior ' + mPriorPts + 'p)</span></div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Record: <strong>' + m.wonGames + 'W - ' + m.lostGames + 'L</strong> • Final Won: <strong>' + m.finalWonPts + 'p</strong> • Lost Pts: <strong style="color:var(--red);">' + m.finalLostPts + '</strong> • Max Left: <strong>' + (actHiddenGlobal ? '🔒' : ((mPriorPts + m.finalWonPts + m.pendingPts) + 'p')) + '</strong></div>' +
        '<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">' + mBadgesHtml + '</div>' +
      '</div>' +
      '<div class="grading-card" style="border-color:' + cmpColor + ';">' +
        '<div style="font-size:0.74rem;font-weight:800;color:' + cmpColor + ';text-transform:uppercase;">' + cmpIcon + ' ' + escapeHtml(cmpName) + ' (H2H Rival) — Auto-Grade Report</div>' +
        '<div style="font-size:1.3rem;font-weight:900;color:var(--text);margin:4px 0;">New Live Total: <span style="color:' + cmpColor + ';">' + kNewLiveTotal + ' pts</span> <span style="font-size:0.8rem;color:var(--green);">(+' + kWkPts + ' wk • Prior ' + kPriorPts + 'p)</span></div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Record: <strong>' + k.wonGames + 'W - ' + k.lostGames + 'L</strong> • Final Won: <strong>' + k.finalWonPts + 'p</strong> • Lost Pts: <strong style="color:var(--red);">' + k.finalLostPts + '</strong> • Max Left: <strong>' + ((cmpHiddenGlobal || (cmpTarget && !cmpTarget.hasPicks)) ? '—' : ((kPriorPts + k.finalWonPts + k.pendingPts) + 'p')) + '</strong></div>' +
        '<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">' + kBadgesHtml + '</div>' +
      '</div>' +
      '<div class="grading-card" style="border-color:var(--amber);">' +
        '<div style="font-size:0.74rem;font-weight:800;color:var(--amber);text-transform:uppercase;">⚔️ ' + escapeHtml(actMeta.shortName) + ' vs. ' + escapeHtml(cmpShort) + ' — Weekly Swing Summary</div>' +
        '<div style="font-size:1.22rem;font-weight:900;color:var(--text);margin:4px 0;">' + h2hLeadHeadline + '</div>' +
        '<div style="font-size:0.74rem;color:var(--muted);">Final Graded Margin: <strong>' + (mNetDiff >= 0 ? '+' + mNetDiff : mNetDiff) + ' pts</strong> • Swing Pts Won: <strong>' + actMeta.shortName + ' ' + swingCompletedWinsM + 'p vs ' + cmpShort + ' ' + swingCompletedWinsK + 'p</strong></div>' +
        '<div style="margin-top:6px;font-size:0.73rem;color:var(--warn);">⚡ <strong>' + ((actHiddenGlobal || cmpHiddenGlobal) ? '🔒' : swingRemainingCount) + '</strong> H2H disagreement game(s) still pending/in-progress.</div>' +
      '</div>';
  }

  // Without a compare target only your own report shows, plus a picker.
  if (cardsEl && !cmpTarget && cardsEl.firstElementChild) {
    cardsEl.innerHTML = cardsEl.firstElementChild.outerHTML + '<div class="grading-card">' + compareChooserHtml() + '</div>';
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
          '<input type="text" class="search-input" style="min-width:0;padding:4px 7px;font-size:0.76rem;font-weight:800;" value="' + escapeHtml(rv.name) + '" onchange="updateWatchlistMeta(' + w + ', \'name\', this.value)" />' +
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

    var safeRwName = jsArgAttr(rw.name);
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
      '<td><strong style="' + nameColor + '">' + escapeHtml(rw.name) + '</strong>' + linkBadgeHtml + cmpQuickBtn + '</td>' +
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

// Live tab and pick cards are rendered by live-ui.js and picks-ui.js; these names stay
// defined so the wrappers in commissioner-admin.js have something to wrap.
function renderLiveScoreboardTab() {}

function renderGames() {}

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
      var est = spreadWinProbEstimate(spread);
      var awayProb = favIsAway ? est.fav : est.dog;
      var homeProb = favIsAway ? est.dog : est.fav;
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
        awayProbEstimate: awayProb, homeProbEstimate: homeProb,
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
    }
    resetPoolPicksForNewWeek(false);
    await syncAllLiveTrackingData(true);
    pushCustomGamesToFirebase();
    pushWatchlistOrStandingsToFirebase();
    renderAll();
    // Sheet games get their kickoff time from ESPN; any it couldn't match lock at the deadline.
    var noKick = GAMES.filter(function(g) { return !hasKickoffTime(g.id); }).map(function(g) { return "#" + g.id; });
    showAppToast("✓ Imported " + parsedGames.length + " official games with correct lines!" +
      (noKick.length ? " ⚠️ No ESPN kickoff time for " + noKick.join(", ") + ": they lock at the pick deadline." : ""));
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
    var pts = getGamePickPts(g, isAw);
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



// One score poll at a time: a slow ESPN response never stacks overlapping polls (the auto-poll,
// switching to Live and a manual refresh all share the poll that's already running).
var LIVE_POLL_IN_FLIGHT = null;
var _pollLiveSaturdayScoresCore = pollLiveSaturdayScores;
pollLiveSaturdayScores = function(manual) {
  if (LIVE_POLL_IN_FLIGHT) return LIVE_POLL_IN_FLIGHT;
  LIVE_POLL_IN_FLIGHT = _pollLiveSaturdayScoresCore(manual).then(function(v) { LIVE_POLL_IN_FLIGHT = null; return v; }, function(e) { LIVE_POLL_IN_FLIGHT = null; throw e; });
  return LIVE_POLL_IN_FLIGHT;
};
