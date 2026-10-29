// ============================================================================
// V16 WEEK-AWARE LIVE SCORE & POSSESSION FETCHER
// ============================================================================
var SB_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

function formatYyyyMmDd(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return "" + y + m + day;
}

function getRollingScoreboardDayStrings() {
  // Covers 10 days ago through 2 days ahead so Sunday/Monday after Saturday games ALWAYS includes the completed slate!
  // One YYYYMMDD per day: ESPN now rejects "dates=YYYYMMDD-YYYYMMDD" ranges with a 400.
  var out = [];
  var now = new Date();
  for (var d = -2; d <= 10; d++) {
    out.push(formatYyyyMmDd(new Date(now.getTime() - d * 86400000)));
  }
  return out;
}

async function fetchScoreboardEvents() {
  var recentDays = getRollingScoreboardDayStrings();
  var initUrls = [
    fetchJsonSafe(SB_BASE + "?groups=80&limit=300"),
    fetchJsonSafe(SB_BASE + "?limit=300")
  ];
  for (var rd = 0; rd < recentDays.length; rd++) {
    initUrls.push(fetchJsonSafe(SB_BASE + "?groups=80&limit=300&dates=" + recentDays[rd]));
  }
  var current = await Promise.all(initUrls);
  var weekNum = null, seasonYear = null, seasonType = null;
  for (var i = 0; i < current.length; i++) {
    var d = current[i];
    if (d && d.week && d.week.number && weekNum === null) weekNum = d.week.number;
    if (d && d.season && seasonYear === null) { seasonYear = d.season.year; seasonType = d.season.type; }
  }
  var extra = [];
  var minTargetWk = Math.max(8, parseInt(state.currentWeek, 10) || 8);
  var candidateWeeks = [minTargetWk, minTargetWk + 1];
  if (weekNum !== null && weekNum >= minTargetWk) {
    if (candidateWeeks.indexOf(weekNum) === -1) candidateWeeks.push(weekNum);
    if (candidateWeeks.indexOf(weekNum + 1) === -1) candidateWeeks.push(weekNum + 1);
  }
  var fallbackWeeks = [8, 9, 10];
  for (var fw = 0; fw < fallbackWeeks.length; fw++) {
    if (candidateWeeks.indexOf(fallbackWeeks[fw]) === -1) {
      candidateWeeks.push(fallbackWeeks[fw]);
    }
  }
  var extraPromises = [];
  for (var cw = 0; cw < candidateWeeks.length; cw++) {
    var wNum = candidateWeeks[cw];
    extraPromises.push(fetchJsonSafe(SB_BASE + "?groups=80&limit=300&seasontype=" + (seasonType || 2) + "&week=" + wNum));
    extraPromises.push(fetchJsonSafe(SB_BASE + "?limit=300&seasontype=" + (seasonType || 2) + "&week=" + wNum));
    if (seasonYear) {
      extraPromises.push(fetchJsonSafe(SB_BASE + "?groups=80&limit=300&dates=" + seasonYear + "&seasontype=" + (seasonType || 2) + "&week=" + wNum));
    }
  }
  extra = await Promise.all(extraPromises);
  // fetchJsonSafe turns every network/HTTP error into null: all of them null means ESPN was unreachable.
  if (!current.concat(extra).some(Boolean)) throw new Error("ESPN scoreboard unreachable");
  var seen = {}, events = [];
  // Process explicit week queries (extra) FIRST so every event gets its exact single-week number before multi-day date-range queries
  var all = extra.concat(current);
  for (var r = 0; r < all.length; r++) {
    var respObj = all[r];
    if (!respObj) continue;
    var isSingleWeekResp = (r < extra.length);
    var respWeek = (isSingleWeekResp && respObj.week && respObj.week.number) ? respObj.week.number : null;
    var evs = respObj.events || [];
    for (var e = 0; e < evs.length; e++) {
      var ev = evs[e];
      if (!ev || !ev.id) continue;
      var comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) continue;
      var awayComp = null, homeComp = null;
      for (var j = 0; j < comp.competitors.length; j++) {
        if (comp.competitors[j].homeAway === "away") awayComp = comp.competitors[j];
        if (comp.competitors[j].homeAway === "home") homeComp = comp.competitors[j];
      }
      if (!awayComp || !homeComp) continue;
      var evWeek = (ev.week && ev.week.number) || respWeek || null;
      if (seen[ev.id]) {
        if (evWeek && !seen[ev.id].week) seen[ev.id].week = evWeek;
        continue;
      }
      var itemObj = { ev: ev, comp: comp, away: awayComp, home: homeComp, week: evWeek };
      seen[ev.id] = itemObj;
      events.push(itemObj);
    }
  }
  return events;
}

function scoreGameAgainstEvent(g, item) {
  var aa = teamMatchScore(g.away, item.away), hh = teamMatchScore(g.home, item.home);
  var ah = teamMatchScore(g.away, item.home), ha = teamMatchScore(g.home, item.away);
  if (aa && hh) return { score: 10 + aa + hh, flipped: false };
  if (ah && ha) return { score: 8 + ah + ha, flipped: true };
  if (aa === 2 && teamLooseMatch(g.home, item.home)) return { score: 10, flipped: false };
  if (hh === 2 && teamLooseMatch(g.away, item.away)) return { score: 10, flipped: false };
  if (ah === 2 && teamLooseMatch(g.home, item.away)) return { score: 9, flipped: true };
  if (ha === 2 && teamLooseMatch(g.away, item.home)) return { score: 9, flipped: true };
  return { score: 0, flipped: false };
}

function matchGamesToEvents(events) {
  var byId = {};
  for (var i = 0; i < events.length; i++) byId[events[i].ev.id] = events[i];

  var weekVotes = {};
  var dateTimestamps = [];
  for (var g1 = 0; g1 < GAMES.length; g1++) {
    for (var e1 = 0; e1 < events.length; e1++) {
      if (scoreGameAgainstEvent(GAMES[g1], events[e1]).score >= 9) {
        var wk = events[e1].week;
        if (wk) weekVotes[wk] = (weekVotes[wk] || 0) + 1;
        if (events[e1].ev && events[e1].ev.date) {
          var dtMs = new Date(events[e1].ev.date).getTime();
          if (!isNaN(dtMs)) dateTimestamps.push(dtMs);
        }
      }
    }
  }
  var sheetWeek = null, best = 0;
  for (var w in weekVotes) if (weekVotes[w] > best) { best = weekVotes[w]; sheetWeek = w; }

  // Compute median game date of the active sheet so we never accidentally match a game from 7+ days earlier!
  var medianSheetDateMs = null;
  if (dateTimestamps.length >= 4) {
    dateTimestamps.sort(function(a, b) { return a - b; });
    medianSheetDateMs = dateTimestamps[Math.floor(dateTimestamps.length / 2)];
  }

  var isEventInActiveSheetWindow = function(item) {
    if (!item) return false;
    if (sheetWeek && item.week && String(item.week) !== String(sheetWeek)) return false;
    if (medianSheetDateMs && item.ev && item.ev.date) {
      var evMs = new Date(item.ev.date).getTime();
      if (!isNaN(evMs) && Math.abs(evMs - medianSheetDateMs) > 4.5 * 86400000) {
        return false;
      }
    }
    return true;
  };

  var matches = {}, usedEvents = {};
  for (var k = 0; k < GAMES.length; k++) {
    var g = GAMES[k];
    var locked = g.espnEventId && byId[g.espnEventId];
    if (locked) {
      var chk = scoreGameAgainstEvent(g, locked);
      if (chk.score >= 9 && isEventInActiveSheetWindow(locked)) {
        matches[g.id] = { item: locked, flipped: chk.flipped };
        usedEvents[locked.ev.id] = true;
        continue;
      }
    }
    var top = null;
    for (var e = 0; e < events.length; e++) {
      var item = events[e];
      if (usedEvents[item.ev.id]) continue;
      var res = scoreGameAgainstEvent(g, item);
      if (res.score < 9) continue;
      if (!isEventInActiveSheetWindow(item)) continue;
      var stType = (item.comp && item.comp.status && item.comp.status.type) ? item.comp.status.type : {};
      var isPlayedOrLive = (stType.completed === true || stType.state === "in");
      var weekBonus = (sheetWeek && item.week && String(item.week) === String(sheetWeek)) ? 2.0 : 0;
      var statusBonus = isPlayedOrLive ? 1.5 : 0;
      var rank = res.score + weekBonus + statusBonus;
      if (!top || rank > top.rank) top = { item: item, flipped: res.flipped, rank: rank };
    }
    if (top && !usedEvents[top.item.ev.id]) {
      matches[g.id] = top;
      usedEvents[top.item.ev.id] = true;
    }
  }
  if (sheetWeek && best >= 4) {
    matches._detectedWeek = parseInt(sheetWeek, 10) || sheetWeek;
  }
  return matches;
}

function parseEspnScore(s) {
  if (s && typeof s === "object") s = s.displayValue || s.value;
  var n = parseInt(s || "0", 10);
  return isNaN(n) ? 0 : n;
}


function hardResetToDefaults() {
  state.michael = { picks: {}, tiebreaker: "28-24", target: 20 };
  state.kinyion = { picks: {}, tiebreaker: "31-24", target: 20 };
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    state.michael.picks[g.id] = g.rec;
    state.kinyion.picks[g.id] = g.kinyionDefault;
  }
  ensureWatchlistDefaults();
  saveCurrentState("michael");
  saveCurrentState("kinyion");
  renderAll();
}

async function fetchJsonSafe(url) {
  try {
    var res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

function lookupEspnTeamId(teamName, gameObj, isAway) {
  if (gameObj) {
    if (isAway && gameObj.awayEspnId) return gameObj.awayEspnId;
    if (!isAway && gameObj.homeEspnId) return gameObj.homeEspnId;
  }
  if (!teamName) return null;
  var low = String(teamName).toLowerCase().trim();
  var cleanKey = low.replace(" (fl)", "");
  var norm = normalizeTeamKey(teamName);
  return ESPN_TEAM_MAP[norm] || ESPN_TEAM_MAP[cleanKey] || ESPN_TEAM_MAP[low] || null;
}

// Resolves true when the ESPN enrichment finished, false when it failed part-way.
async function syncAllLiveTrackingData(saveToCloudAfter) {
  var ok = true;
  var badge = document.getElementById("live-sync-badge") || document.createElement("span");
  badge.className = "sync-pill loading";
  badge.textContent = "↻ Syncing ESPN Schedules, Insights & Injuries...";

  try {
    if (Object.keys(ESPN_TEAM_MAP).length === 0) {
      var dirData = await fetchJsonSafe("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=400");
      if (dirData && dirData.sports && dirData.sports[0] && dirData.sports[0].leagues && dirData.sports[0].leagues[0]) {
        var teamsList = dirData.sports[0].leagues[0].teams || [];
        for (var d = 0; d < teamsList.length; d++) {
          var t = teamsList[d].team;
          if (t && t.id) {
            // Display-only: colour + short code for the logo fallback circles on the Picks screen.
            ESPN_TEAM_INFO[t.id] = { color: t.color ? "#" + t.color : "", abbr: t.abbreviation || "" };
            if (t.location) {
              ESPN_TEAM_MAP[t.location.toLowerCase()] = t.id;
              ESPN_TEAM_MAP[normalizeTeamKey(t.location)] = t.id;
            }
            if (t.displayName) {
              ESPN_TEAM_MAP[t.displayName.toLowerCase()] = t.id;
              ESPN_TEAM_MAP[normalizeTeamKey(t.displayName)] = t.id;
            }
            if (t.shortDisplayName) {
              ESPN_TEAM_MAP[t.shortDisplayName.toLowerCase()] = t.id;
              ESPN_TEAM_MAP[normalizeTeamKey(t.shortDisplayName)] = t.id;
            }
            if (t.nickname) {
              ESPN_TEAM_MAP[normalizeTeamKey(t.nickname)] = t.id;
            }
            if (t.abbreviation) {
              ESPN_TEAM_MAP[t.abbreviation.toLowerCase()] = t.id;
              ESPN_TEAM_MAP[normalizeTeamKey(t.abbreviation)] = t.id;
            }
          }
        }
        if (ESPN_TEAM_MAP["miami"]) ESPN_TEAM_MAP["miami (fl)"] = ESPN_TEAM_MAP["miami"];
        if (ESPN_TEAM_MAP["pitt"]) ESPN_TEAM_MAP["pittsburgh"] = ESPN_TEAM_MAP["pitt"];
      }
    }

    await pollLiveSaturdayScores(false);
    try {
      await fetchLiveCollegeFootballRankings(false);
      await fetchLiveCollegeFootballInjuries(true);
    } catch (eInjSync) {}

    var uniqueTeams = {};
    for (var m = 0; m < GAMES.length; m++) {
      var gmItem = GAMES[m];
      var aId = lookupEspnTeamId(gmItem.away, gmItem, true);
      var hId = lookupEspnTeamId(gmItem.home, gmItem, false);
      if (aId) uniqueTeams[gmItem.away] = aId;
      if (hId) uniqueTeams[gmItem.home] = hId;
    }

    var teamNames = Object.keys(uniqueTeams);
    var promises = [];
    for (var u = 0; u < teamNames.length; u++) {
      var tName = teamNames[u];
      promises.push(fetchAndStoreSingleTeamSchedule(tName, uniqueTeams[tName]));
    }
    await Promise.all(promises);

    // Rebuild dynamic 4-pillar insights immediately from scoreboard + team schedule data (zero wait)
    for (var c0 = 0; c0 < GAMES.length; c0++) {
      var gm0 = GAMES[c0];
      if (TEAM_LOGS[gm0.away] && TEAM_LOGS[gm0.away].l5) gm0.awayL5 = TEAM_LOGS[gm0.away].l5;
      if (TEAM_LOGS[gm0.home] && TEAM_LOGS[gm0.home].l5) gm0.homeL5 = TEAM_LOGS[gm0.home].l5;
      rebuildDynamicGameInsights(gm0);
    }
    renderSwayFeed();
    renderAll();

    // Gently enrich event summaries (official injuries & play-by-play drives) in small 4-at-a-time chunks
    var gamesNeedingSummary = [];
    for (var s = 0; s < GAMES.length; s++) {
      var gs = GAMES[s];
      if (gs.espnEventId && (!gs._summaryEnriched || isPlaceholderText(gs.rationale))) {
        gamesNeedingSummary.push({ id: gs.id, eventId: gs.espnEventId });
      }
    }
    for (var bIdx = 0; bIdx < gamesNeedingSummary.length; bIdx += 4) {
      var batch = gamesNeedingSummary.slice(bIdx, bIdx + 4);
      await Promise.all(batch.map(function(item) {
        return fetchGameDriveSummary(item.id, item.eventId);
      }));
    }

    for (var c = 0; c < GAMES.length; c++) {
      var gm = GAMES[c];
      if (TEAM_LOGS[gm.away] && TEAM_LOGS[gm.away].l5) gm.awayL5 = TEAM_LOGS[gm.away].l5;
      if (TEAM_LOGS[gm.home] && TEAM_LOGS[gm.home].l5) gm.homeL5 = TEAM_LOGS[gm.home].l5;
      rebuildDynamicGameInsights(gm);
    }

    // Ensure Michael/Kinyion default picks on a newly scraped slate use the enriched EV recommendations
    sanitizeStateForActiveSlate();
    regradeAllPoolMembersLive();
    safeSetStorage("sat_week7_official_v14", JSON.stringify(state));

    if (state.poolMembers && state.poolMembers.length > 0 && countScoredGamesInLiveScores() > 0) {
      pushWatchlistOrStandingsToFirebase();
    }

    if (saveToCloudAfter) {
      pushCustomGamesToFirebase();
    }

    var cstNow = new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" });
    badge.className = "sync-pill";
    badge.textContent = "● Synced " + cstNow + " CST";
  } catch (e) {
    ok = false;
    badge.className = "sync-pill";
    badge.textContent = "● CST Logs Active";
  }
  renderSwayFeed();
  renderAll();
  return ok;
}

async function fetchAndStoreSingleTeamSchedule(teamName, teamId) {
  try {
    var data = await fetchJsonSafe("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/" + teamId + "/schedule");
    if (!data || !data.events) return;
    var completed = [];
    for (var i = 0; i < data.events.length; i++) {
      var e = data.events[i];
      if (e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type && e.competitions[0].status.type.completed) {
        completed.push(e);
      }
    }
    if (completed.length === 0) return;

    // Also check if any event in this team's schedule matches a game on the current sheet and can backfill LIVE_SCORES
    for (var sIdx = 0; sIdx < data.events.length; sIdx++) {
      var sEv = data.events[sIdx];
      var sComp = sEv && sEv.competitions && sEv.competitions[0];
      if (!sComp || !sComp.competitors || sComp.competitors.length < 2) continue;
      var sStType = (sComp.status && sComp.status.type) ? sComp.status.type : {};
      if (!sStType.completed && sStType.state !== "in") continue;
      if (/CANCEL|POSTPON|SUSPEND|FORFEIT/i.test(String(sStType.name || ""))) continue;
      var sAway = null, sHome = null;
      for (var sc = 0; sc < sComp.competitors.length; sc++) {
        if (sComp.competitors[sc].homeAway === "away") sAway = sComp.competitors[sc];
        if (sComp.competitors[sc].homeAway === "home") sHome = sComp.competitors[sc];
      }
      if (!sAway || !sHome) continue;
      var candidateItem = { ev: sEv, comp: sComp, away: sAway, home: sHome, week: (sEv.week && sEv.week.number) || null };
      for (var gmIdx = 0; gmIdx < GAMES.length; gmIdx++) {
        var gmObj = GAMES[gmIdx];
        var existingLs = LIVE_SCORES[gmObj.id];
        if (existingLs && (existingLs.completed || existingLs.inProgress)) continue;
        // If we are on a new week's slate (Week 8+), ignore completed schedule games from > 4 days ago
        if (!isHardcodedWeek7Slate(GAMES) && sEv.date) {
          var sEvMs = new Date(sEv.date).getTime();
          if (!isNaN(sEvMs) && (Date.now() - sEvMs) > 4.5 * 86400000) continue;
        }
        var mRes = scoreGameAgainstEvent(gmObj, candidateItem);
        if (mRes.score >= 10) {
          var shAway = mRes.flipped ? sHome : sAway;
          var shHome = mRes.flipped ? sAway : sHome;
          LIVE_SCORES[gmObj.id] = {
            matchupKey: gameMatchupKey(gmObj),
            awayScore: parseEspnScore(shAway.score),
            homeScore: parseEspnScore(shHome.score),
            awayAbbr: (shAway.team && shAway.team.abbreviation) || gmObj.awayCode,
            homeAbbr: (shHome.team && shHome.team.abbreviation) || gmObj.homeCode,
            period: (sComp.status && sComp.status.period) ? sComp.status.period : 4,
            detail: sStType.shortDetail || (sStType.completed ? "Final" : "LIVE"),
            inProgress: sStType.state === "in",
            completed: sStType.completed === true,
            eventId: sEv.id,
            possessionSide: null,
            yardLine: 50,
            yardLine100: 50,
            downDistanceText: "",
            possessionText: "",
            isRedZone: false,
            lastPlayText: ""
          };
        }
      }
    }

    var wins = 0, losses = 0;
    var homeW = 0, homeL = 0, roadW = 0, roadL = 0;
    var totalPtsFor = 0, totalPtsAgainst = 0, scoredCount = 0;
    var curStreakType = null, curStreakCount = 0;
    var myCurRank = null;
    var parsedGames = [];
    for (var j = 0; j < completed.length; j++) {
      var ev = completed[j];
      var comp = ev.competitions[0];
      var me = null, opp = null;
      for (var k = 0; k < comp.competitors.length; k++) {
        if (String(comp.competitors[k].id) === String(teamId)) me = comp.competitors[k];
        else opp = comp.competitors[k];
      }
      var isWin = me && me.winner === true;
      if (isWin) wins++; else losses++;
      var isHome = (me && me.homeAway === "home");
      if (isHome) { if (isWin) homeW++; else homeL++; }
      else { if (isWin) roadW++; else roadL++; }

      var wlChar = isWin ? "W" : "L";
      if (curStreakType === wlChar) curStreakCount++;
      else { curStreakType = wlChar; curStreakCount = 1; }

      if (me && me.curatedRank && me.curatedRank.current && me.curatedRank.current <= 25) {
        myCurRank = me.curatedRank.current;
      }

      var loc = isHome ? "vs" : "at";
      var myScore = (me && me.score) ? (me.score.displayValue || me.score.value || me.score) : "";
      var oppScore = (opp && opp.score) ? (opp.score.displayValue || opp.score.value || opp.score) : "";
      var myNum = parseInt(myScore, 10), oppNum = parseInt(oppScore, 10);
      if (!isNaN(myNum) && !isNaN(oppNum)) {
        totalPtsFor += myNum;
        totalPtsAgainst += oppNum;
        scoredCount++;
      }
      var oppName = (opp && opp.team) ? (opp.team.location || opp.team.shortDisplayName || opp.team.displayName) : "Opponent";
      var oppRank = (opp && opp.curatedRank && opp.curatedRank.current && opp.curatedRank.current <= 25) ? opp.curatedRank.current : null;
      if (opp && opp.team && opp.team.id) {
        ESPN_TEAM_MAP[oppName.toLowerCase()] = opp.team.id;
        ESPN_TEAM_MAP[normalizeTeamKey(oppName)] = opp.team.id;
      }
      var wkNum = (ev.week && ev.week.number) ? ("W" + ev.week.number) : ("G" + (j + 1));
      parsedGames.push({
        wk: wkNum,
        wl: wlChar,
        loc: loc,
        opp: oppName,
        oppRank: oppRank,
        score: myScore + "-" + oppScore
      });
    }

    var ppg = scoredCount > 0 ? (totalPtsFor / scoredCount).toFixed(1) : null;
    var oppPpg = scoredCount > 0 ? (totalPtsAgainst / scoredCount).toFixed(1) : null;
    var streakBadge = curStreakCount >= 2 ? ((curStreakType === "W" ? "🔥 " : "📉 ") + curStreakCount + curStreakType + " Streak") : "";
    var lastGm = parsedGames.length > 0 ? parsedGames[parsedGames.length - 1] : null;
    var lastGmText = lastGm ? ((lastGm.wl === "W" ? "beat " : "lost to ") + lastGm.opp + " " + lastGm.score + " in " + lastGm.wk) : "";

    var official2026Rank = (TEAM_RANKS[teamName] && teamName !== "Mississippi State" && teamName !== "Oklahoma")
      ? parseInt(TEAM_RANKS[teamName].replace("#", ""), 10)
      : null;

    TEAM_LOGS[teamName] = {
      rec: wins + "-" + losses,
      rank: official2026Rank,
      ppg: ppg,
      oppPpg: oppPpg,
      homeRec: homeW + "-" + homeL,
      roadRec: roadW + "-" + roadL,
      streak: streakBadge,
      lastGameSummary: lastGmText,
      l5: parsedGames.slice(-5).reverse()
    };
  } catch (err) {}
}

function renderSwayFeed() {
  var sways = [];
  for (var i = 0; i < GAMES.length; i++) {
    if (GAMES[i].sway) sways.push(GAMES[i]);
  }
  document.getElementById("sway-count-badge").textContent = sways.length + " Active Sways";
  var html = "";
  for (var j = 0; j < sways.length; j++) {
    var g = sways[j];
    html += '<div class="sway-item ' + (g.sway.level === "critical" ? "critical" : "") + '" onclick="focusGame(' + g.id + ')">' +
      '<div style="font-weight:800;color:var(--text);">#' + g.id + ' ' + g.awayCode + ' at ' + g.homeCode + ': ' + g.sway.title + '</div>' +
      '<div style="color:var(--muted);margin-top:2px;">' + g.sway.detail + '</div></div>';
  }
  document.getElementById("sway-feed-list").innerHTML = html;
}

function focusGame(id) {
  toggleMobileSidebar(false);
  switchMainView("cards");
  setFilter("all");
  var el = document.getElementById("game-card-" + id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function countScoredGamesInLiveScores() {
  var cnt = 0;
  for (var k in LIVE_SCORES) {
    if (LIVE_SCORES[k] && (LIVE_SCORES[k].completed || LIVE_SCORES[k].inProgress)) cnt++;
  }
  return cnt;
}



// A full ESPN sync already running is shared rather than started twice.
var LIVE_SYNC_IN_FLIGHT = null;
var _syncAllLiveTrackingDataCore = syncAllLiveTrackingData;
syncAllLiveTrackingData = function(saveToCloudAfter) {
  if (LIVE_SYNC_IN_FLIGHT) return LIVE_SYNC_IN_FLIGHT;
  LIVE_SYNC_IN_FLIGHT = _syncAllLiveTrackingDataCore(saveToCloudAfter).then(function(v) { LIVE_SYNC_IN_FLIGHT = null; return v; }, function(e) { LIVE_SYNC_IN_FLIGHT = null; throw e; });
  return LIVE_SYNC_IN_FLIGHT;
};
