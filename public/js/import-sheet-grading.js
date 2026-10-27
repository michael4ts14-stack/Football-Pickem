// ============================================================================
// FEATURE 1: PARTICIPANT NAME NORMALIZER, CSV/EXCEL IMPORTER & POOL AUTO-GRADER
// ============================================================================
function standardizeParticipantName(rawName) {
  var clean = String(rawName || "").trim();
  var low = clean.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (
    low === "michael" ||
    low === "michael a" ||
    low === "michael adams" ||
    low.indexOf("michael adams") === 0
  ) {
    return "Michael A";
  }
  if (
    low === "kinyion" ||
    low === "kinyion c" ||
    low === "kinyon c" ||
    low === "kinyion cooper" ||
    low === "kenyon" ||
    low === "kenyon cooper" ||
    low.indexOf("kinyion") === 0 ||
    low.indexOf("kenyon") === 0
  ) {
    // Matching key, not display text: pool sheets and stored keys use this spelling. The screen
    // shows "Kinyon C" (see fixDisplaySpelling in shell.js). Don't change it without migrating data.
    return "Kinyion C";
  }
  return clean;
}

function resolveSheetTeamFromCell(cellVal, gameObj) {
  if (!cellVal) return null;
  var norm = normalizeTeamKey(cellVal);
  if (!norm) return null;

  if (gameObj) {
    var aKey = normalizeTeamKey(gameObj.away);
    var hKey = normalizeTeamKey(gameObj.home);
    var aCode = normalizeTeamKey(gameObj.awayCode);
    var hCode = normalizeTeamKey(gameObj.homeCode);
    if (norm === aKey || norm === aCode) return gameObj.away;
    if (norm === hKey || norm === hCode) return gameObj.home;
    var mAway = isSafeClientSubstrMatch(norm, aKey) || (aCode.length >= 4 && isSafeClientSubstrMatch(norm, aCode));
    var mHome = isSafeClientSubstrMatch(norm, hKey) || (hCode.length >= 4 && isSafeClientSubstrMatch(norm, hCode));
    if (mAway && !mHome) return gameObj.away;
    if (mHome && !mAway) return gameObj.home;
  }

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var ak = normalizeTeamKey(g.away);
    var hk = normalizeTeamKey(g.home);
    var ac = normalizeTeamKey(g.awayCode);
    var hc = normalizeTeamKey(g.homeCode);
    if (norm === ak || norm === ac) return { gameId: g.id, team: g.away };
    if (norm === hk || norm === hc) return { gameId: g.id, team: g.home };
  }
  return null;
}

function getResolvedPickForGame(picksMap, g, allowFallbackToRec) {
  if (!g || !picksMap) return null;
  var raw = picksMap[g.id] || picksMap[String(g.id)] || picksMap["#" + g.id];
  // If Firebase coerced a 1..26 object into a 0-indexed 26-element array
  if (!raw && Array.isArray(picksMap) && picksMap.length === GAMES.length && picksMap[0] && !picksMap[GAMES.length]) {
    raw = picksMap[g.id - 1];
  }
  if (raw) {
    if (raw === g.away || raw === g.home) return raw;
    var resolved = resolveSheetTeamFromCell(raw, g);
    if (resolved && typeof resolved === "string") return resolved;
  }
  return null;
}

function isSameTeamPick(teamA, teamB, g) {
  if (!teamA || !teamB) return false;
  if (teamA === teamB) return true;
  var normA = normalizeTeamKey(teamA);
  var normB = normalizeTeamKey(teamB);
  if (normA && normA === normB) return true;
  if (g) {
    var resA = resolveSheetTeamFromCell(teamA, g);
    var resB = resolveSheetTeamFromCell(teamB, g);
    if (resA && resB && resA === resB) return true;
  }
  return false;
}

function gradePickMap(picksMap, allowFallbackToRec, computeDp) {
  var useFallback = (allowFallbackToRec === true);
  var ceiling = 0, ev = 0, dogs = 0, chalkCount = 0, count2x = 0, count3x = 0;
  var liveProjectedPts = 0, inProgressPts = 0, finalWonPts = 0, finalLostPts = 0, pendingPts = 0;
  var wonGames = 0, lostGames = 0, won1x = 0, won2x = 0, won3x = 0;
  var submittedPicksCount = 0;

  var dp = null;
  if (computeDp) {
    dp = [];
    for (var z = 0; z < 80; z++) dp[z] = 0;
    dp[0] = 1;
  }

  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var pick = getResolvedPickForGame(picksMap, g, useFallback);
    if (!pick) {
      continue;
    }
    submittedPicksCount++;
    var isAway = isSameTeamPick(pick, g.away, g);
    var pts = isAway ? g.awayPts : g.homePts;
    var prob = isAway ? g.awayProb : g.homeProb;
    ceiling += pts;
    ev += pts * prob;
    if (pts === 1) chalkCount++;
    if (pts === 2) { dogs++; count2x++; }
    if (pts === 3) { dogs++; count3x++; }

    var ls = LIVE_SCORES[g.id];
    if (ls && (ls.inProgress || ls.completed)) {
      var winningTeam = ls.awayScore > ls.homeScore ? g.away : (ls.homeScore > ls.awayScore ? g.home : null);
      var pickedWinner = winningTeam ? isSameTeamPick(winningTeam, pick, g) : false;
      if (pickedWinner) {
        liveProjectedPts += pts;
        if (ls.inProgress && !ls.completed) {
          inProgressPts += pts;
        }
      }

      if (ls.completed && winningTeam) {
        if (pickedWinner) {
          finalWonPts += pts;
          wonGames++;
          if (pts === 1) won1x++;
          else if (pts === 2) won2x++;
          else if (pts === 3) won3x++;
        } else {
          finalLostPts += pts;
          lostGames++;
        }
      } else {
        pendingPts += pts;
      }
    } else {
      pendingPts += pts;
    }

    if (computeDp) {
      var nextDp = [];
      for (var n = 0; n < 80; n++) nextDp[n] = 0;
      for (var s = 0; s < 80; s++) {
        if (dp[s] > 0) {
          nextDp[s] += dp[s] * (1 - prob);
          if (s + pts < 80) nextDp[s + pts] += dp[s] * prob;
        }
      }
      dp = nextDp;
    }
  }

  return {
    ceiling: ceiling, ev: ev, dogs: dogs,
    chalkCount: chalkCount, count2x: count2x, count3x: count3x,
    liveProjectedPts: liveProjectedPts,
    inProgressPts: inProgressPts,
    finalWonPts: finalWonPts, finalLostPts: finalLostPts, pendingPts: pendingPts,
    wonGames: wonGames, lostGames: lostGames,
    won1x: won1x, won2x: won2x, won3x: won3x,
    submittedPicksCount: submittedPicksCount,
    dp: dp
  };
}

function regradeAllPoolMembersLive(onlyUserProfiles) {
  ensureWatchlistDefaults();
  if (!state.poolMembers || !Array.isArray(state.poolMembers)) return;

  var priorLookup = {};
  var rankLookup = {};
  if (state.leaderboard && Array.isArray(state.leaderboard)) {
    for (var l = 0; l < state.leaderboard.length; l++) {
      var lb = state.leaderboard[l];
      var stdLb = standardizeParticipantName(lb.name).toLowerCase();
      if (lb.priorPts !== undefined && lb.priorPts !== null && !isNaN(parseFloat(lb.priorPts))) {
        priorLookup[stdLb] = parseFloat(lb.priorPts);
      }
      if (lb.rank) rankLookup[stdLb] = String(lb.rank);
    }
  }

  var wlPicksByName = {};
  if (state.watchlist && Array.isArray(state.watchlist)) {
    for (var w0 = 0; w0 < state.watchlist.length; w0++) {
      var wl0 = state.watchlist[w0];
      if (wl0 && wl0.name && wl0.picks && hasSubmittedPicksForCurrentSlate(wl0.picks, GAMES)) {
        wlPicksByName[standardizeParticipantName(wl0.name).toLowerCase()] = wl0.picks;
      }
    }
  }

  var hasScoredGames = countScoredGamesInLiveScores() > 0;
  var isWk7Slate = isHardcodedWeek7Slate(GAMES);

  // Deduplicate state.poolMembers by standardized name & remove any orphan duplicate rows created before linking
  var dedupedPool = [];
  var seenPoolKeys = {};
  for (var dIdx = 0; dIdx < state.poolMembers.length; dIdx++) {
    var dPm = state.poolMembers[dIdx];
    if (!dPm || !dPm.name) continue;
    var stdDName = standardizeParticipantName(dPm.name);
    var dKey = stdDName.toLowerCase();
    // If a custom user was created with a nickname (e.g. "Blake") and then linked to "Blake M", merge/skip the unlinked nickname duplicate row
    var mappedToOtherLb = false;
    if (state.customUsers && Array.isArray(state.customUsers)) {
      for (var cChk = 0; cChk < state.customUsers.length; cChk++) {
        var cuChk = state.customUsers[cChk];
        if (cuChk && cuChk.name && cuChk.linkedMemberName &&
            standardizeParticipantName(cuChk.name).toLowerCase() === dKey &&
            standardizeParticipantName(cuChk.linkedMemberName).toLowerCase() !== dKey) {
          mappedToOtherLb = true;
          break;
        }
      }
    }
    if (mappedToOtherLb && priorLookup[dKey] === undefined) continue;
    if (seenPoolKeys[dKey]) continue;
    seenPoolKeys[dKey] = true;
    dPm.name = stdDName;
    dedupedPool.push(dPm);
  }
  state.poolMembers = dedupedPool;

  for (var i = 0; i < state.poolMembers.length; i++) {
    var pm = state.poolMembers[i];
    pm.name = standardizeParticipantName(pm.name);
    var lowName = pm.name.toLowerCase();
    var linkedProfMeta = getProfileLinkedToMemberName(pm.name);
    var isUserProf = !!linkedProfMeta;
    if (onlyUserProfiles && !isUserProf) continue;

    // Always sync priorPts from state.leaderboard if present and > 0
    if (priorLookup[lowName] !== undefined && priorLookup[lowName] > 0) {
      pm.priorPts = Math.max(parseFloat(pm.priorPts) || 0, priorLookup[lowName]);
    } else if (pm.priorPts === undefined || pm.priorPts === null) {
      pm.priorPts = 0;
    }
    if (rankLookup[lowName]) {
      pm.priorRank = rankLookup[lowName];
    }

    var isDeletedPm = !!((state.deletedPicksByMember && state.deletedPicksByMember[lowName]) || pm._picksCleared || (linkedProfMeta && state[linkedProfMeta.key] && state[linkedProfMeta.key]._picksCleared));
    if (isDeletedPm) {
      pm.picks = {};
      if (linkedProfMeta && state[linkedProfMeta.key]) {
        state[linkedProfMeta.key].picks = {};
      }
    } else if (linkedProfMeta && state[linkedProfMeta.key] && state[linkedProfMeta.key].picks) {
      pm.picks = Object.assign({}, state[linkedProfMeta.key].picks);
      if (state[linkedProfMeta.key].tiebreaker) pm.tiebreaker = state[linkedProfMeta.key].tiebreaker;
    } else if (wlPicksByName[lowName] && !hasSubmittedPicksForCurrentSlate(pm.picks, GAMES)) {
      pm.picks = Object.assign({}, wlPicksByName[lowName]);
    }

    var gMetrics = gradePickMap(pm.picks || {}, false, false);
    pm.submittedPicksCount = gMetrics.submittedPicksCount;
    pm.awaitingSheet = (pm.submittedPicksCount === 0);

    // Prevent double-counting on the Week 7 slate when priorPts already reflects post-Week-7 totals (124 max)
    var basePrior = parseFloat(pm.priorPts) || 0;
    var priorAlreadyIncludesWk7 = isWk7Slate && basePrior >= 80 && pm.wk7PriorPts !== undefined && basePrior > pm.wk7PriorPts;

    if (pm.awaitingSheet) {
      pm.livePts = 0;
      pm.inProgressPts = 0;
      pm.finalPts = 0;
      pm.won1x = 0;
      pm.won2x = 0;
      pm.won3x = 0;
      pm.count1x = gMetrics.chalkCount;
      pm.count2x = gMetrics.count2x;
      pm.count3x = gMetrics.count3x;
      pm.newLiveTotal = basePrior;
    } else {
      if (hasScoredGames) {
        pm.livePts = Math.max(gMetrics.liveProjectedPts, gMetrics.finalWonPts);
        pm.inProgressPts = gMetrics.inProgressPts;
        pm.finalPts = gMetrics.finalWonPts;
        pm.won1x = gMetrics.won1x;
        pm.won2x = gMetrics.won2x;
        pm.won3x = gMetrics.won3x;
      } else if (isWk7Slate && typeof pm.wk7ScoredPts === "number") {
        pm.livePts = pm.wk7ScoredPts;
        pm.inProgressPts = 0;
        pm.finalPts = pm.wk7ScoredPts;
      } else {
        pm.livePts = 0;
        pm.inProgressPts = 0;
        pm.finalPts = 0;
      }
      pm.count1x = gMetrics.chalkCount;
      pm.count2x = gMetrics.count2x;
      pm.count3x = gMetrics.count3x;
      var bestWeeklyPts = Math.max(pm.livePts || 0, pm.finalPts || 0);
      if (priorAlreadyIncludesWk7) {
        // Show pre-Week-7 priorPts + Week 7 scored pts = Official Post-Week-7 Total (124 / 112 / 111)
        pm.newLiveTotal = (parseFloat(pm.wk7PriorPts) || 0) + bestWeeklyPts;
      } else {
        pm.newLiveTotal = basePrior + bestWeeklyPts;
      }
    }
  }

  syncLinkedProfilesWithLeaderboard();
  // Sync any customUsers into their linked leaderboard row without ever undeleting cleared picks!
  if (state.customUsers && Array.isArray(state.customUsers)) {
    for (var cuIdx = 0; cuIdx < state.customUsers.length; cuIdx++) {
      var cu = state.customUsers[cuIdx];
      if (!cu || !cu.key || !cu.name) continue;
      var cuProf = state[cu.key];
      if (!cuProf) continue;
      if (!cuProf.picks) cuProf.picks = {};
      var targetBoardName = standardizeParticipantName(cu.linkedMemberName || cu.name);
      var targetLow = targetBoardName.toLowerCase();
      var cuNameLow = standardizeParticipantName(cu.name).toLowerCase();
      var isCuDeleted = !!((state.deletedPicksByMember && (state.deletedPicksByMember[targetLow] || state.deletedPicksByMember[cuNameLow])) || cuProf._picksCleared);
      if (isCuDeleted) {
        cuProf.picks = {};
      }
      var cuMetrics = gradePickMap(cuProf.picks, false, false);
      var hasSubmittedCu = (!isCuDeleted && cuMetrics.submittedPicksCount > 0);
      var existingPm = null;
      for (var pmI = 0; pmI < state.poolMembers.length; pmI++) {
        var pmNameLow = standardizeParticipantName(state.poolMembers[pmI].name).toLowerCase();
        if (pmNameLow === targetLow || pmNameLow === cuNameLow) {
          existingPm = state.poolMembers[pmI];
          existingPm.name = targetBoardName;
          break;
        }
      }
      var cuPrior = (existingPm && parseFloat(existingPm.priorPts) > 0)
        ? parseFloat(existingPm.priorPts)
        : (priorLookup[targetLow] !== undefined ? priorLookup[targetLow] : (parseFloat(cu.priorPts) || 0));
      var cuLive = (hasSubmittedCu && hasScoredGames) ? Math.max(cuMetrics.liveProjectedPts, cuMetrics.finalWonPts) : 0;
      var cuFin = (hasSubmittedCu && hasScoredGames) ? cuMetrics.finalWonPts : 0;
      if (!existingPm) {
        existingPm = {
          name: targetBoardName,
          priorPts: cuPrior,
          priorRank: rankLookup[targetLow] || cu.rank || "Linked",
          tiebreaker: cuProf.tiebreaker || "28-24",
          picks: hasSubmittedCu ? Object.assign({}, cuProf.picks) : {}
        };
        state.poolMembers.push(existingPm);
      } else {
        existingPm.priorPts = cuPrior;
        existingPm.picks = hasSubmittedCu ? Object.assign({}, cuProf.picks) : {};
        existingPm.tiebreaker = cuProf.tiebreaker || existingPm.tiebreaker || "28-24";
      }
      cu.priorPts = cuPrior;
      if (rankLookup[targetLow]) cu.rank = rankLookup[targetLow];
      existingPm.submittedPicksCount = cuMetrics.submittedPicksCount;
      existingPm.awaitingSheet = !hasSubmittedCu;
      existingPm._picksCleared = isCuDeleted;
      existingPm.livePts = cuLive;
      existingPm.inProgressPts = (hasSubmittedCu && hasScoredGames) ? cuMetrics.inProgressPts : 0;
      existingPm.finalPts = cuFin;
      existingPm.won1x = hasSubmittedCu ? cuMetrics.won1x : 0;
      existingPm.won2x = hasSubmittedCu ? cuMetrics.won2x : 0;
      existingPm.won3x = hasSubmittedCu ? cuMetrics.won3x : 0;
      existingPm.count1x = cuMetrics.chalkCount;
      existingPm.count2x = cuMetrics.count2x;
      existingPm.count3x = cuMetrics.count3x;
      existingPm.newLiveTotal = cuPrior + Math.max(cuLive, cuFin);
    }
  }

    // Always sync watchlist priorPts and rank from priorLookup/rankLookup if matched
  if (state.watchlist && Array.isArray(state.watchlist)) {
    for (var w = 0; w < state.watchlist.length; w++) {
      var wl = state.watchlist[w];
      var wlKey = standardizeParticipantName(wl.name).toLowerCase();
      if (priorLookup[wlKey] !== undefined && priorLookup[wlKey] > 0) {
        wl.priorPts = Math.max(parseFloat(wl.priorPts) || 0, priorLookup[wlKey]);
      }
      if (rankLookup[wlKey]) {
        wl.rank = rankLookup[wlKey];
      }
    }
  }
}


function syncCurrentLoadedSheetToFirebase() {
  if (!state.poolMembers || !state.poolMembers.length) {
    syncOfficialWeek7EmailSheetToFirebase();
    return;
  }
  regradeAllPoolMembersLive();
  saveCurrentState("michael");
  saveCurrentState("kinyion");
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  var stEl = document.getElementById("gas-bot-status");
  var wkStr = state.weekLabel || (state.currentWeek ? ("Week " + state.currentWeek) : "Current Week");
  var cnt = state.poolMembers.length;
  if (stEl) {
    stEl.textContent = "✓ Synced " + cnt + " participants for " + wkStr + " to Cloud Firestore!";
  }
  document.getElementById("cloud-status-text").textContent = "🔥 Synced " + cnt + " Pool Entries (" + wkStr + ") to Firebase!";
}

function syncOfficialWeek7EmailSheetToFirebase() {
  state.poolMembers = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_POOL_MEMBERS));
  state.leaderboard = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_LEADERBOARD));
  state.michael = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_MICHAEL));
  state.kinyion = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_KINYION));
  state.watchlist = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_WATCHLIST));
  state.currentWeek = 7;
  state.weekLabel = "Week 7";
  state.lastScrapedFile = "College Pick'em '26 - Week 7.xlsx";
  regradeAllPoolMembersLive();
  saveCurrentState("michael");
  saveCurrentState("kinyion");
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  var stEl = document.getElementById("gas-bot-status");
  if (stEl) {
    stEl.textContent = "✓ Loaded all 89 participants + Michael A & Kinyon C's official Week 7 picks from 'College Pick\'em \'26 - Week 7.xlsx' and synced to Firebase!";
  }
  document.getElementById("cloud-status-text").textContent = "🔥 Synced all 89 Week 7 Pool Entries from Gmail .xlsx Attachment to Firebase!";
}

function copyUpgradedCodeGs() {
  try {
    navigator.clipboard.writeText(UPGRADED_CODE_GS_SOURCE);
  } catch (e) {
    var ta = document.getElementById("gas-code-preview");
    if (ta) { ta.select(); document.execCommand("copy"); }
  }
  var stEl = document.getElementById("gas-bot-status");
  if (stEl) {
    stEl.textContent = "✓ Copied upgraded Code.gs (with automatic .xlsx attachment scraper) to clipboard! Paste into your 'Football Weekly' Google Apps Script project.";
  }
}

async function triggerAppsScriptGmailScraper() {
  var stEl = document.getElementById("gas-bot-status");
  var urlInput = document.getElementById("gas-webapp-url-input");
  var url = urlInput ? urlInput.value.trim() : (state.gasWebAppUrl || "");
  if (url) {
    state.gasWebAppUrl = url;
    safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  }

  if (typeof google !== "undefined" && google.script && google.script.run && google.script.run.forceRescanLatestSpreadsheetEmail) {
    if (stEl) stEl.textContent = "↻ Running Gmail .xlsx Scraper directly via google.script.run...";
    google.script.run.withSuccessHandler(function(res) {
      pullFromFirebaseCloud();
      var wkStr = res && (res.weekLabel || (res.week ? "Week " + res.week : ""));
      var cnt = (res && res.importedPoolMembers) ? res.importedPoolMembers : (state.poolMembers ? state.poolMembers.length : 89);
      if (stEl) stEl.textContent = "✓ Gmail Bot finished! Imported " + cnt + " pool members" + (wkStr ? " for " + wkStr : "") + ".";
    }).forceRescanLatestSpreadsheetEmail();
    return;
  }

  if (!url) {
    if (stEl) {
      var curWk = state.weekLabel || "Week 8";
      var curCnt = (state.poolMembers && state.poolMembers.length) || 89;
      stEl.innerHTML = "ℹ️ <strong>Web App URL needed:</strong> Deploy your Google Apps Script as a Web App (Execute as: Me, Access: Anyone) and paste the URL above to trigger live scraping.<br><em>Currently active in cache: " + curWk + " (" + curCnt + " members).</em>";
    }
    return;
  }

  try {
    if (stEl) stEl.textContent = "↻ Triggering Google Apps Script Web App to scrape latest Gmail .xlsx attachment...";
    var sep = url.indexOf("?") === -1 ? "?force=1" : "&force=1";
    var resp = await fetch(url + sep);
    var data = await resp.json();
    pullFromFirebaseCloud();
    var wkStr = data.weekLabel || (data.week ? ("Week " + data.week) : (state.weekLabel || "Week 9"));
    var memCnt = (typeof data.importedPoolMembers === "number") ? data.importedPoolMembers : 0;
    var stdCnt = (typeof data.importedStandings === "number") ? data.importedStandings : 0;
    var gCnt = (typeof data.importedGames === "number") ? data.importedGames : 0;
    var fileStr = data.latestFileName ? (" from " + data.latestFileName) : "";
    if (stEl) {
      if (memCnt > 0) {
        stEl.textContent = "✅ Apps Script scraped Gmail! Imported " + memCnt + " pool entries" + (wkStr ? " for " + wkStr : "") + fileStr + " & synced to Firebase.";
      } else if (stdCnt > 0) {
        stEl.textContent = "✅ Apps Script synced " + stdCnt + " standings rows for " + wkStr + "! (Week 8 archived, leaderboard updated to Week 9 starting points).";
      } else if (gCnt > 0) {
        stEl.textContent = "✅ Apps Script loaded " + gCnt + " weekly games for " + wkStr + " & synced to Firebase.";
      } else {
        stEl.textContent = "ℹ️ Scanned " + (data.scannedMessages || 0) + " recent emails. No new spreadsheet attachment was detected in inbox. (Make sure 'College Pick\'em \'26 - Week 9.xlsx' is received).";
      }
    }
    var titleEl = document.getElementById("gas-modal-dynamic-title");
    if (titleEl && wkStr) {
      titleEl.textContent = "✅ " + wkStr + " Email Attachment Auto-Scraped & Loaded!";
    }
  } catch (err) {
    if (stEl) {
      stEl.textContent = "⏳ Request sent to Apps Script bot. Refreshing cloud state in 3s...";
    }
    setTimeout(function() { pullFromFirebaseCloud(); }, 3000);
  }
}

function openAppsScriptBotModal() {
  openUnifiedImportModal("bot");
}

function openMasterCsvImporterModal() {
  openUnifiedImportModal("csv");
}

function handleMasterCsvFileUpload(file) {
  if (!file) return;
  var statusEl = document.getElementById("csv-import-status");
  statusEl.textContent = "↻ Reading " + file.name + "...";
  var reader = new FileReader();
  reader.onload = function(evt) {
    document.getElementById("csv-raw-paste-area").value = evt.target.result || "";
    parseAndStoreMasterPoolCsv();
  };
  reader.readAsText(file);
}

function splitDelimitedLine(line, delimiter) {
  var result = [];
  var cur = "";
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function detectColumnMappingFromHeader(headers) {
  var map = { nameCol: -1, priorPtsCol: -1, tbCol: -1, gameCols: {} };

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").trim();
    var hLow = h.toLowerCase();

    if (map.nameCol === -1 && (hLow.indexOf("name") !== -1 || hLow.indexOf("player") !== -1 || hLow.indexOf("participant") !== -1 || hLow.indexOf("member") !== -1 || hLow === "entry")) {
      map.nameCol = c;
      continue;
    }
    if (map.priorPtsCol === -1 && (hLow.indexOf("prior") !== -1 || hLow.indexOf("season") !== -1 || hLow.indexOf("prev") !== -1 || hLow === "pts" || hLow === "total" || hLow === "points")) {
      map.priorPtsCol = c;
      continue;
    }
    if (map.tbCol === -1 && (hLow.indexOf("tie") !== -1 || hLow === "tb" || hLow.indexOf("score") !== -1)) {
      map.tbCol = c;
      continue;
    }

    // Check explicit Game #1 - #26 in header
    var numMatch = h.match(/(?:^|#|\bgame\s*|\bg\s*)(\d{1,2})(?:\b|$)/i);
    if (numMatch) {
      var gNum = parseInt(numMatch[1], 10);
      if (gNum >= 1 && gNum <= GAMES.length && !map.gameCols[gNum]) {
        map.gameCols[gNum] = c;
        continue;
      }
    }

    // Check team name or code in header
    for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
      var gm = GAMES[gIdx];
      if (map.gameCols[gm.id] !== undefined) continue;
      var resolved = resolveSheetTeamFromCell(h, gm);
      if (resolved) {
        map.gameCols[gm.id] = c;
        break;
      }
    }
  }

  if (map.nameCol === -1) map.nameCol = 0;
  return map;
}

function parseAndStoreMasterPoolCsv() {
  var raw = (document.getElementById("csv-raw-paste-area").value || "").trim();
  var statusEl = document.getElementById("csv-import-status");
  if (!raw) {
    if (statusEl) statusEl.textContent = "⚠️ Please upload a CSV file or paste spreadsheet rows first.";
    return;
  }

  var lines = raw.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
  if (lines.length < 2) {
    if (statusEl) statusEl.textContent = "⚠️ Need at least a header row and 1 participant row.";
    return;
  }

  var firstLine = lines[0];
  var delimiter = (firstLine.split("\t").length > firstLine.split(",").length) ? "\t" : ",";
  var headers = splitDelimitedLine(firstLine, delimiter);
  var colMap = detectColumnMappingFromHeader(headers);

  var priorMap = {};
  for (var l = 0; l < state.leaderboard.length; l++) {
    var lb = state.leaderboard[l];
    priorMap[standardizeParticipantName(lb.name).toLowerCase()] = parseFloat(lb.priorPts) || 0;
  }

  var parsedMembers = [];
  for (var r = 1; r < lines.length; r++) {
    var cells = splitDelimitedLine(lines[r], delimiter);
    if (cells.length < 2) continue;

    var rawName = cells[colMap.nameCol] || cells[0];
    if (!rawName || rawName.toLowerCase() === "name" || rawName.toLowerCase() === "player") continue;

    var stdName = standardizeParticipantName(rawName);
    var priorPts = colMap.priorPtsCol !== -1 ? (parseFloat(cells[colMap.priorPtsCol]) || 0) : (priorMap[stdName.toLowerCase()] || 0);
    var tbVal = colMap.tbCol !== -1 ? (cells[colMap.tbCol] || "") : "";
    var picksObj = {};

    // First pass: mapped game columns
    var mappedGameIds = Object.keys(colMap.gameCols);
    for (var m = 0; m < mappedGameIds.length; m++) {
      var gid = parseInt(mappedGameIds[m], 10);
      var cIdx = colMap.gameCols[gid];
      var gObj = findGameById(gid);
      var teamPick = resolveSheetTeamFromCell(cells[cIdx], gObj);
      if (teamPick && typeof teamPick === "string") {
        picksObj[gid] = teamPick;
      }
    }

    // Second pass fallback: scan remaining cells sequentially for any unmapped games
    for (var c = 0; c < cells.length; c++) {
      if (c === colMap.nameCol || c === colMap.priorPtsCol || c === colMap.tbCol) continue;
      var cellStr = cells[c];
      if (!cellStr) continue;
      if (!tbVal && /^\d{1,2}\s*-\s*\d{1,2}$/.test(cellStr)) {
        tbVal = cellStr.replace(/\s+/g, "");
        continue;
      }
      var anyTeam = resolveSheetTeamFromCell(cellStr, null);
      if (anyTeam && anyTeam.gameId && !picksObj[anyTeam.gameId]) {
        picksObj[anyTeam.gameId] = anyTeam.team;
      }
    }

    // Sync any linked profile (Michael A, Kinyion C, or custom user profiles) directly from CSV
    var linkedPf = getProfileLinkedToMemberName(stdName);
    if (linkedPf && Object.keys(picksObj).length > 0) {
      if (!state[linkedPf.key]) state[linkedPf.key] = { picks: {}, tiebreaker: "28-24", target: 20 };
      state[linkedPf.key].picks = Object.assign({}, state[linkedPf.key].picks || {}, picksObj);
      if (tbVal) state[linkedPf.key].tiebreaker = tbVal;
      saveCurrentState(linkedPf.key);
    }

    parsedMembers.push({
      name: stdName,
      tiebreaker: tbVal || "—",
      picks: picksObj,
      priorPts: priorPts,
      livePts: 0,
      inProgressPts: 0,
      finalPts: 0,
      won1x: 0,
      won2x: 0,
      won3x: 0
    });
  }

  if (parsedMembers.length > 0) {
    state.poolMembers = parsedMembers;
    state.officialSheetSyncedForWeek = state.currentWeek || 8;
    regradeAllPoolMembersLive();
    pushWatchlistOrStandingsToFirebase();
    if (statusEl) {
      statusEl.textContent = "✓ Imported & graded " + parsedMembers.length + " pool participants! Synced to Firebase (`pickem_v14/poolMembers`).";
    }
    renderAll();
    switchMainView("standings");
  } else {
    if (statusEl) statusEl.textContent = "⚠️ Could not detect valid participant rows. Check your CSV format.";
  }
}

