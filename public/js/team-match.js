// ============================================================================
// CLAUDE V16 STRICT BOTH-TEAMS MATCHER & ALIASES FOR ESPN LIVE SCORES
// ============================================================================
var TEAM_ALIASES = {
  "miamifl": "miami", "miamiflorida": "miami", "theu": "miami",
  "miamiohio": "miamioh", "miamiofohio": "miamioh",
  "mississippi": "olemiss",
  "pitt": "pittsburgh",
  "northcarolinastate": "ncstate",
  "unc": "northcarolina",
  "southerncalifornia": "usc", "southerncal": "usc",
  "centralflorida": "ucf",
  "connecticut": "uconn",
  "massachusetts": "umass",
  "brighamyoung": "byu",
  "louisianastate": "lsu",
  "texaschristian": "tcu",
  "southernmethodist": "smu",
  "floridainternational": "fiu",
  "floridaatlantic": "fau",
  "texassanantonio": "utsa",
  "texaselpaso": "utep",
  "nevadalasvegas": "unlv",
  "alabamabirmingham": "uab",
  "louisianamonroe": "ulmonroe", "ulm": "ulmonroe",
  "louisianalafayette": "louisiana", "ullafayette": "louisiana",
  "appalachianstate": "appstate",
  "jacksonvillestate": "jaxstate",
  "middletennesseestate": "middletennessee", "mtsu": "middletennessee",
  "westernkentucky": "westernkentucky", "wku": "westernkentucky",
  "georgiasouthern": "georgiasouthern", "gasouthern": "georgiasouthern",
  "samhoustonstate": "samhouston",
  "hawaii": "hawaii",
  "texasam": "texasam", "tamu": "texasam",
  "vandy": "vanderbilt",
  "cal": "california", "calberkeley": "california",
  "bama": "alabama",
  "uga": "georgia",
  "ecu": "eastcarolina",
  "niu": "northernillinois",
  "army": "army", "armywestpoint": "army",
  "navy": "navy",
  "airforce": "airforce",
  "ndsu": "northdakotastate",
  "sjsu": "sanjosestate"
};

var NORM_TEAM_KEY_CACHE = {};
function normalizeTeamKey(str) {
  var raw = String(str || "");
  if (!raw) return "";
  if (NORM_TEAM_KEY_CACHE[raw] !== undefined) return NORM_TEAM_KEY_CACHE[raw];
  var s = raw;
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
  s = s.toLowerCase()
    .replace(/#\d+\s*/g, "")
    .replace(/&/g, "")
    .replace(/\buniv(ersity)?( of)?\b/g, "")
    .replace(/\bst\.?(?=\s|\)|$)/g, "state")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  var res = TEAM_ALIASES[s] || s;
  NORM_TEAM_KEY_CACHE[raw] = res;
  return res;
}

function competitorKeys(espnComp) {
  var t = (espnComp && espnComp.team) || {};
  var keys = [];
  var raw = [t.location, t.shortDisplayName, t.displayName, t.nickname];
  if (t.displayName && t.name && t.displayName.slice(-t.name.length) === t.name) {
    raw.push(t.displayName.slice(0, t.displayName.length - t.name.length));
  }
  for (var i = 0; i < raw.length; i++) {
    var k = normalizeTeamKey(raw[i]);
    if (k && keys.indexOf(k) === -1) keys.push(k);
  }
  return keys;
}

function teamMatchScore(sheetTeamName, espnComp) {
  if (!espnComp || !espnComp.team) return 0;
  var target = normalizeTeamKey(sheetTeamName);
  if (!target) return 0;
  if (competitorKeys(espnComp).indexOf(target) !== -1) return 2;
  var abbr = normalizeTeamKey(espnComp.team.abbreviation);
  if (abbr && target.length <= 5 && target === abbr) return 1;
  return 0;
}

function teamMatchesCompetitor(sheetTeamName, espnComp) {
  return teamMatchScore(sheetTeamName, espnComp) > 0;
}

function teamLooseMatch(sheetTeamName, espnComp) {
  var target = normalizeTeamKey(sheetTeamName);
  if (target.length < 4) return false;
  var keys = competitorKeys(espnComp);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.length < 4) continue;
    if (k.indexOf(target) === 0 || target.indexOf(k) === 0) {
      var longer = k.length > target.length ? k : target;
      var shorter = k.length > target.length ? target : k;
      var tail = longer.slice(shorter.length);
      if (tail === "state" || tail === "tech" || tail === "oh") continue;
      return true;
    }
  }
  return false;
}

function cstWindowFromMinutes(mins) {
  if (mins < 13 * 60) return "11:00 AM CST Window";
  if (mins < 17 * 60) return "2:30 PM CST Window";
  if (mins < 20 * 60 + 30) return "6:00 PM / 6:30 PM CST Primetime";
  return "9:15 PM+ CST Late Night Window";
}

function cstWindowFromIsoDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  var parts = d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":");
  var h = parseInt(parts[0], 10) % 24, m = parseInt(parts[1], 10) || 0;
  return cstWindowFromMinutes(h * 60 + m);
}

function gameMatchupKey(g) {
  return normalizeTeamKey(g.away) + "@" + normalizeTeamKey(g.home);
}

function isLikelyKickoffLine(candidateLine, nextLineAfterCandidate) {
  if (!candidateLine) return false;
  if (nextLineAfterCandidate && String(nextLineAfterCandidate).trim().toLowerCase().indexOf("at ") === 0) {
    return false;
  }
  var s = String(candidateLine).trim();
  if (/\(\s*-\d/.test(s) || /\b\d{1,2}-\d{1,2}\b/.test(s)) {
    return false;
  }
  return /\b(am|pm|cst|cdt|est|sat|fri|thu|sun|noon|espn|fox|abc|cbs|nbc|sec|acc|peacock|fs1|btn|cw|tnt|kick|saturday|friday|thursday)\b/i.test(s) || /\d{1,2}:\d{2}/.test(s);
}

var lastLocalPickTs = 0;
var hasLockedCustomSlate = false;
var activeSlateEpoch = 1;
var saveStateDebounceTimer = null;

function clearAllSlateCaches() {
  activeSlateEpoch++;
  LIVE_SCORES = {};
  if (state) state.liveScores = LIVE_SCORES;
  SUMMARY_PBP_CACHE = {};
  if (typeof resetFieldNodes === "function") resetFieldNodes();
  DEMO_SIM_STATE = {};
  EXPANDED_FIELD_TRACKERS = {};
  GAME_DRIVE_VIEW_MODE = {};
}

function isHardcodedWeek7Slate(gamesArr) {
  var list = gamesArr || GAMES || [];
  if (list.length < 2) return false;
  return normalizeTeamKey(list[0].away) === "ohiostate" &&
         normalizeTeamKey(list[0].home) === "indiana" &&
         normalizeTeamKey(list[1].away) === "florida" &&
         normalizeTeamKey(list[1].home) === "texas";
}

function getSlateSignature(gamesArr) {
  var list = gamesArr || GAMES || [];
  if (!Array.isArray(list) || list.length === 0) return "";
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    var g = list[i] || {};
    parts.push((i + 1) + ":" + normalizeTeamKey(g.away) + "@" + normalizeTeamKey(g.home));
  }
  return parts.join("|");
}

function isPlaceholderText(str) {
  if (!str) return true;
  var s = String(str);
  return s.indexOf("Auto-Scraped by Gmail Bot") !== -1 ||
         s.indexOf("Imported from Separated at Turf PDF") !== -1 ||
         s.indexOf("live statistical profile") !== -1 ||
         s.indexOf("Positional matchup favoring") !== -1 ||
         s.indexOf("Active Roster") !== -1 ||
         s.indexOf("Starting Unit") !== -1 ||
         s.indexOf("Starting Roster") !== -1 ||
         s.indexOf("Starters") !== -1 ||
         s.indexOf("No critical outs reported") !== -1 ||
         s.indexOf("No critical injuries reported") !== -1 ||
         s.indexOf("Synced via ESPN") !== -1;
}

function isGameEnrichedWithEspnData(g) {
  if (!g) return false;
  var hasRealRationale = g.rationale && !isPlaceholderText(g.rationale);
  var hasRealStats = g.insights && g.insights.stats && !isPlaceholderText(g.insights.stats);
  var hasRealL5 = (g.awayL5 && g.awayL5.length > 0) || (TEAM_LOGS[g.away] && TEAM_LOGS[g.away].l5 && TEAM_LOGS[g.away].l5.length > 0 && TEAM_LOGS[g.away].l5[0].opp.indexOf("Sync") === -1);
  return !!(hasRealRationale && hasRealStats && hasRealL5);
}

function mergeEnrichedGameFields(targetGame, sourceGame) {
  if (!targetGame || !sourceGame) return;
  if (normalizeTeamKey(targetGame.away) !== normalizeTeamKey(sourceGame.away) ||
      normalizeTeamKey(targetGame.home) !== normalizeTeamKey(sourceGame.home)) {
    return;
  }
  var keepFields = [
    "espnEventId", "awayEspnId", "homeEspnId", "awayL5", "homeL5",
    "awaySit", "homeSit", "keyInjHeader", "sway", "cliffTrap",
    "venueText", "awayLeaderText", "homeLeaderText", "ouTotal", "liveSpreadNum"
  ];
  for (var k = 0; k < keepFields.length; k++) {
    var f = keepFields[k];
    if (sourceGame[f] && !targetGame[f]) targetGame[f] = sourceGame[f];
  }
  if (sourceGame.awayRec && (!targetGame.awayRec || targetGame.awayRec.length < sourceGame.awayRec.length)) {
    targetGame.awayRec = sourceGame.awayRec;
  }
  if (sourceGame.homeRec && (!targetGame.homeRec || targetGame.homeRec.length < sourceGame.homeRec.length)) {
    targetGame.homeRec = sourceGame.homeRec;
  }
  var aKey = normalizeTeamKey(targetGame.away);
  var hKey = normalizeTeamKey(targetGame.home);
  if (aKey === "mississippistate" || aKey === "missst" || aKey === "oklahoma" || aKey === "okla") {
    if (targetGame.awayRec) targetGame.awayRec = targetGame.awayRec.replace(/#\d+\s*•?\s*/g, "").trim();
  }
  if (hKey === "mississippistate" || hKey === "missst" || hKey === "oklahoma" || hKey === "okla") {
    if (targetGame.homeRec) targetGame.homeRec = targetGame.homeRec.replace(/#\d+\s*•?\s*/g, "").trim();
  }
  if (sourceGame.kick && sourceGame.kick !== "Saturday CST" && (!targetGame.kick || targetGame.kick === "Saturday CST" || !isLikelyKickoffLine(targetGame.kick, null))) {
    targetGame.kick = sourceGame.kick;
  }
  if (sourceGame.cstWindow && (!targetGame.cstWindow || sourceGame.cstWindow !== "11:00 AM CST Window")) {
    targetGame.cstWindow = sourceGame.cstWindow;
  }
  if (sourceGame.liveLine && sourceGame.liveLine !== sourceGame.poolLine && (!targetGame.liveLine || targetGame.liveLine === targetGame.poolLine)) {
    targetGame.liveLine = sourceGame.liveLine;
  }
  if (sourceGame.rationale && !isPlaceholderText(sourceGame.rationale) && isPlaceholderText(targetGame.rationale)) {
    targetGame.rationale = sourceGame.rationale;
  }
  if (sourceGame.insights && targetGame.insights) {
    if (sourceGame.insights.vegas && !isPlaceholderText(sourceGame.insights.vegas)) targetGame.insights.vegas = sourceGame.insights.vegas;
    if (sourceGame.insights.stats && !isPlaceholderText(sourceGame.insights.stats)) targetGame.insights.stats = sourceGame.insights.stats;
    if (sourceGame.insights.matchup && !isPlaceholderText(sourceGame.insights.matchup)) targetGame.insights.matchup = sourceGame.insights.matchup;
    if (sourceGame.insights.splits && sourceGame.insights.splits !== "Saturday CST") targetGame.insights.splits = sourceGame.insights.splits;
  }
  if (sourceGame.awayInj && sourceGame.awayInj.length && (!targetGame.awayInj || !targetGame.awayInj.length || isPlaceholderText(targetGame.awayInj[0].p) || isPlaceholderText(targetGame.awayInj[0].note))) {
    targetGame.awayInj = sourceGame.awayInj;
  }
  if (sourceGame.homeInj && sourceGame.homeInj.length && (!targetGame.homeInj || !targetGame.homeInj.length || isPlaceholderText(targetGame.homeInj[0].p) || isPlaceholderText(targetGame.homeInj[0].note))) {
    targetGame.homeInj = sourceGame.homeInj;
  }
}

function rebuildDynamicGameInsights(g) {
  if (!g) return;
  // Do not overwrite hardcoded Week 7 curated insights unless they are placeholders
  if (isHardcodedWeek7Slate(GAMES) && !isPlaceholderText(g.rationale) && g.insights && !isPlaceholderText(g.insights.stats)) {
    return;
  }

  var aLog = TEAM_LOGS[g.away] || null;
  var hLog = TEAM_LOGS[g.home] || null;

  // Strict 2026 ranking enforcement: ONLY teams present in TEAM_RANKS receive a rank prefix
  var aClean = (g.awayRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
  var hClean = (g.homeRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
  var aRank = TEAM_RANKS[g.away] || null;
  var hRank = TEAM_RANKS[g.home] || null;
  g.awayRec = (aRank ? (aRank + " • ") : "") + (aLog && aLog.rec ? aLog.rec : (aClean || "2026"));
  g.homeRec = (hRank ? (hRank + " • ") : "") + (hLog && hLog.rec ? hLog.rec : (hClean || "2026"));

  if (aLog && aLog.streak && !g.awaySit) g.awaySit = aLog.streak;
  if (hLog && hLog.streak && !g.homeSit) g.homeSit = hLog.streak;

  var awayEV = +(getTeamWinProb(g, "away") * g.awayPts).toFixed(2);
  var homeEV = +(getTeamWinProb(g, "home") * g.homePts).toFixed(2);
  var favIsAway = getTeamWinProb(g, "away") >= getTeamWinProb(g, "home");
  var favTeam = favIsAway ? g.away : g.home;
  var dogTeam = favIsAway ? g.home : g.away;
  var dogPts = favIsAway ? g.homePts : g.awayPts;
  var dogProb = favIsAway ? getTeamWinProb(g, "home") : getTeamWinProb(g, "away");
  var favProb = favIsAway ? getTeamWinProb(g, "away") : getTeamWinProb(g, "home");
  var dogEV = +(dogProb * dogPts).toFixed(2);
  var favEV = +(favProb * 1).toFixed(2);

  // Parse spread number from poolLine
  var poolSpreadMatch = String(g.poolLine || "").match(/-(\d+\.?\d*)/);
  var poolSpreadNum = poolSpreadMatch ? parseFloat(poolSpreadMatch[1]) : 3.5;
  var liveSpreadNum = (typeof g.liveSpreadNum === "number" && !isNaN(g.liveSpreadNum)) ? g.liveSpreadNum : poolSpreadNum;
  var ouTotal = (typeof g.ouTotal === "number" && !isNaN(g.ouTotal)) ? g.ouTotal : 51.5;

  var favImplied = Math.round((ouTotal / 2) + (liveSpreadNum / 2));
  var dogImplied = Math.round((ouTotal / 2) - (liveSpreadNum / 2));

  // Pillar 1: Vegas & Implied Win Math
  var vegasText = "Sheet Line: " + (g.poolLine || (favTeam + " -" + poolSpreadNum)) +
    " • Live Line: " + (g.liveLine || g.poolLine) +
    ". Implied Score: " + favTeam + " " + favImplied + ", " + dogTeam + " " + dogImplied +
    ". EV Math: " + g.away + " (" + g.awayPts + "x = " + awayEV.toFixed(2) + " EV) vs " + g.home + " (" + g.homePts + "x = " + homeEV.toFixed(2) + " EV).";

  // Pillar 2: Key Player Stat Lines & Scoring Profile
  var aStatParts = [];
  if (aLog && aLog.ppg) aStatParts.push(g.away + " (" + aLog.rec + ") averages " + aLog.ppg + " PPG (allows " + aLog.oppPpg + " PPG)" + (aLog.lastGameSummary ? " and " + aLog.lastGameSummary : ""));
  if (g.awayLeaderText) aStatParts.push("Leaders: " + g.awayLeaderText);

  var hStatParts = [];
  if (hLog && hLog.ppg) hStatParts.push(g.home + " (" + hLog.rec + ") averages " + hLog.ppg + " PPG (allows " + hLog.oppPpg + " PPG)" + (hLog.lastGameSummary ? " and " + hLog.lastGameSummary : ""));
  if (g.homeLeaderText) hStatParts.push("Leaders: " + g.homeLeaderText);

  var statsText = "";
  if (aStatParts.length || hStatParts.length) {
    statsText = (aStatParts.join(" — ") || (g.away + " (" + (g.awayRec || "2026") + ")")) + " | " +
                (hStatParts.join(" — ") || (g.home + " (" + (g.homeRec || "2026") + ")"));
  } else {
    statsText = g.away + " (" + (g.awayRec || "FBS") + ") vs " + g.home + " (" + (g.homeRec || "FBS") + ") — click Sync Live to pull latest ESPN game logs.";
  }

  // Pillar 3: Positional & Trench Matchup
  var matchupParts = [];
  if (aLog && hLog && aLog.ppg && hLog.oppPpg) {
    matchupParts.push(g.away + " offense (" + aLog.ppg + " PPG) vs " + g.home + " defense (" + hLog.oppPpg + " PPG allowed); " +
                      g.home + " offense (" + hLog.ppg + " PPG) vs " + g.away + " defense (" + aLog.oppPpg + " PPG allowed).");
  }
  if (g.keyInjHeader) {
    matchupParts.push("Availability Impact: " + g.keyInjHeader + ".");
  }
  if (dogPts > 1) {
    if (dogEV >= favEV) {
      matchupParts.push("Multiplier Edge: " + dogTeam + " (" + dogPts + "x dog, " + Math.round(dogProb * 100) + "% win prob) generates +" + (dogEV - favEV).toFixed(2) + " higher EV (" + dogEV.toFixed(2) + " vs " + favEV.toFixed(2) + ").");
    } else {
      matchupParts.push("Chalk Safety: " + favTeam + " (" + Math.round(favProb * 100) + "% win prob, " + favEV.toFixed(2) + " EV) holds a +" + (favEV - dogEV).toFixed(2) + " EV edge over the " + dogPts + "x dog.");
    }
  } else {
    matchupParts.push("1x Straight-Up Matchup: " + favTeam + " holds a " + Math.round(favProb * 100) + "% to " + Math.round(dogProb * 100) + "% outright probability edge.");
  }
  var matchupText = matchupParts.join(" ");

  // Pillar 4: Situational & Home/Away Splits
  var commonMap = getCommonOpponentsMap(g.away, g.home);
  var commonKeys = Object.keys(commonMap);
  var commonStr = "";
  if (commonKeys.length > 0) {
    var ck = commonMap[commonKeys[0]];
    commonStr = " • Common Opp (" + ck.awayRes.opp + "): " + g.awayCode + " " + ck.awayRes.wl + " " + ck.awayRes.score + " vs " + g.homeCode + " " + ck.homeRes.wl + " " + ck.homeRes.score + ".";
  }
  var splitsText = (g.kick || "Saturday CST") + (g.venueText ? (" • Venue: " + g.venueText) : "") +
    (aLog && aLog.roadRec ? (" • " + g.awayCode + " Road: " + aLog.roadRec) : "") +
    (hLog && hLog.homeRec ? (" • " + g.homeCode + " Home: " + hLog.homeRec) : "") +
    commonStr;

  if (!g.insights) g.insights = {};
  g.insights.vegas = vegasText;
  g.insights.stats = statsText;
  g.insights.matchup = matchupText;
  g.insights.splits = splitsText;

  // Dynamic Rationale & Optimal EV Recommendation
  if (dogPts > 1 && dogEV >= 0.66 && dogEV >= favEV - 0.03) {
    g.rec = dogTeam;
    g.tier = "Multiplier Upside Play (" + dogPts + "x Dog)";
    g.rationale = "🔥 +EV " + dogPts + "x MULTIPLIER PLAY (" + dogEV.toFixed(2) + " EV): " + dogTeam + " pays " + dogPts + " full points on the sheet (" + g.poolLine + ") with a " + Math.round(dogProb * 100) + "% outright win probability. " +
      (aLog && hLog ? (g.away + " (" + aLog.rec + ", " + aLog.ppg + " PPG) at " + g.home + " (" + hLog.rec + ", " + hLog.ppg + " PPG).") : "");
  } else if (dogPts === 1 && dogProb >= 0.45 && ((dogTeam === g.away && aLog && hLog && parseFloat(aLog.ppg) > parseFloat(hLog.ppg) + 4) || (dogTeam === g.home && hLog && aLog && parseFloat(hLog.ppg) > parseFloat(aLog.ppg) + 3))) {
    g.rec = dogTeam;
    g.tier = "Sharp 1x Toss-Up";
    g.rationale = "⚔️ 1x LEVERAGE SPOT: Near coin-flip (" + g.poolLine + ") where " + dogTeam + " (" + Math.round(dogProb * 100) + "% win prob) brings strong scoring efficiency (" + (dogTeam === g.away ? aLog.ppg : hLog.ppg) + " PPG)." + (g.keyInjHeader ? " Note: " + g.keyInjHeader + "." : "");
  } else {
    g.rec = favTeam;
    g.tier = favProb >= 0.75 ? "Core Lock" : "Lean";
    g.rationale = (favProb >= 0.75 ? "🔒 CORE 1x LOCK: " : "📈 OPTIMAL 1x FAVORITE: ") + favTeam + " (" + Math.round(favProb * 100) + "% win prob, " + favEV.toFixed(2) + " EV) is favored at " + g.poolLine +
      (dogPts > 1 ? (" and out-values the " + dogPts + "x underdog shot (" + dogTeam + " " + dogEV.toFixed(2) + " EV). ") : ". ") +
      (aLog && hLog && aLog.ppg && hLog.ppg ? (g.awayCode + " (" + aLog.rec + ", " + aLog.ppg + " PPG) vs " + g.homeCode + " (" + hLog.rec + ", " + hLog.ppg + " PPG).") : "") +
      (g.keyInjHeader ? (" " + g.keyInjHeader + ".") : "");
  }

  // Upgrade placeholder injury arrays with CFB_MASTER_INJURIES
  enrichGameInjuries(g);
  if (!g.awayInj || !g.awayInj.length) {
    g.awayInj = [{
      p: g.away + " Active Roster",
      pos: "TEAM",
      st: "FULL",
      note: aLog && aLog.rec ? ("Active (" + aLog.rec + ")") : "Active"
    }];
  }
  if (!g.homeInj || !g.homeInj.length) {
    g.homeInj = [{
      p: g.home + " Active Roster",
      pos: "TEAM",
      st: "FULL",
      note: hLog && hLog.rec ? ("Active (" + hLog.rec + ")") : "Active"
    }];
  }
}

function countMatchingPicksForSlate(picksMap, gamesArr) {
  var list = gamesArr || GAMES || [];
  if (!picksMap || typeof picksMap !== "object") return { total: 0, matched: 0 };
  var total = 0, matched = 0;
  var keys = Object.keys(picksMap);
  for (var k = 0; k < keys.length; k++) {
    var val = picksMap[keys[k]];
    if (val !== undefined && val !== null && String(val).trim() !== "") total++;
  }
  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    var raw = picksMap[g.id] || picksMap[String(g.id)] || picksMap["#" + g.id];
    if (!raw && Array.isArray(picksMap) && picksMap.length === list.length && picksMap[0] && !picksMap[list.length]) {
      raw = picksMap[g.id - 1];
    }
    if (!raw) continue;
    if (raw === g.away || raw === g.home || resolveSheetTeamFromCell(raw, g)) {
      matched++;
    }
  }
  return { total: total, matched: matched };
}

function hasSubmittedPicksForCurrentSlate(picksMap, gamesArr) {
  var c = countMatchingPicksForSlate(picksMap, gamesArr);
  if (c.matched === 0) return false;
  if (c.total >= 5 && c.matched < Math.ceil(c.total * 0.5)) return false;
  return true;
}

function getMaxPriorPts(list) {
  if (!list || !Array.isArray(list) || list.length === 0) return 0;
  var mx = 0;
  for (var i = 0; i < list.length; i++) {
    var p = parseFloat(list[i] && list[i].priorPts) || 0;
    if (p > mx) mx = p;
  }
  return mx;
}

function parseWeekNumFromLabel(lbl) {
  var m = String(lbl || "").match(/(\d{1,2})/);
  return m ? parseInt(m[1], 10) : 0;
}

var CLEAN_TEAM_CODES = {
  "pittsburgh": "Pitt",
  "miamifl": "Miami",
  "miami": "Miami",
  "ohiostate": "OhioSt",
  "indiana": "Indiana",
  "florida": "Florida",
  "texas": "Texas",
  "mississippistate": "MissSt",
  "lsu": "LSU",
  "virginia": "UVA",
  "smu": "SMU",
  "northwestern": "Nwest",
  "michiganstate": "MichSt",
  "cincinnati": "Cincy",
  "westvirginia": "WVU",
  "kansas": "Kansas",
  "kansasstate": "KState",
  "bostoncollege": "BC",
  "alabama": "Bama",
  "tennessee": "Tenn",
  "missouri": "Mizzou",
  "olemiss": "OleMiss",
  "auburn": "Auburn",
  "georgia": "Georgia",
  "arizonastate": "ArizSt",
  "texastech": "TTech",
  "georgiatech": "GaTech",
  "virginiatech": "VaTech",
  "northcarolina": "UNC",
  "duke": "Duke",
  "pennstate": "PennSt",
  "michigan": "Mich",
  "floridastate": "FSU",
  "arkansas": "Ark",
  "vanderbilt": "Vandy",
  "tcu": "TCU",
  "baylor": "Baylor",
  "notredame": "ND",
  "byu": "BYU",
  "oklahomastate": "OklaSt",
  "houston": "Houston",
  "wisconsin": "Wisc",
  "ucla": "UCLA",
  "kentucky": "UK",
  "oklahoma": "OU",
  "louisville": "Lville",
  "syracuse": "Syr",
  "utah": "Utah",
  "colorado": "Colo",
  "wakeforest": "Wake",
  "california": "Cal",
  "nebraska": "Neb",
  "oregon": "Oregon",
  "southcarolina": "SCar",
  "texasam": "TAMU",
  "iowastate": "IowaSt",
  "iowa": "Iowa",
  "clemson": "Clemson",
  "usc": "USC",
  "washington": "Wash",
  "washingtonstate": "Wazzu",
  "oregonstate": "OregonSt",
  "boisestate": "BoiseSt",
  "illinois": "Illini",
  "minnesota": "Minn",
  "rutgers": "Rutgers",
  "maryland": "MD",
  "purdue": "Purdue",
  "stanford": "Stan",
  "ncstate": "NCState",
  "ucf": "UCF",
  "arizona": "Arizona",
  "unlv": "UNLV",
  "tulane": "Tulane",
  "memphis": "Memphis",
  "army": "Army",
  "navy": "Navy",
  "airforce": "AirForce"
};

function getCleanTeamCode(teamName, existingCode) {
  if (!teamName) return existingCode || "TEAM";
  var norm = normalizeTeamKey(teamName);
  if (CLEAN_TEAM_CODES[norm]) return CLEAN_TEAM_CODES[norm];
  var clean = String(teamName).replace(/^#\d+\s*/, "").replace(/\([^)]*\)/g, "").trim();
  if (clean.length <= 7) return clean;
  var words = clean.split(/\s+/);
  if (words.length >= 2) {
    if (words[1].toLowerCase() === "state") return words[0].slice(0, 5) + "St";
    if (words[1].toLowerCase() === "tech") return words[0].slice(0, 4) + "Tech";
  }
  return existingCode && existingCode.length <= 7 ? existingCode : clean.slice(0, 6);
}

function detectTiebreakerGameFromLines(lines, gamesList) {
  if (!lines || !lines.length || !gamesList || !gamesList.length) return null;
  var tbText = "";
  for (var i = 0; i < lines.length; i++) {
    var l = String(lines[i] || "");
    if (/tie[\s-]*breaker/i.test(l)) {
      tbText = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 5)).join(" ");
      break;
    }
  }
  if (tbText) {
    var tbNorm = normalizeTeamKey(tbText);
    for (var gIdx = 0; gIdx < gamesList.length; gIdx++) {
      var gm = gamesList[gIdx];
      var aKey = normalizeTeamKey(gm.away);
      var hKey = normalizeTeamKey(gm.home);
      var aCode = normalizeTeamKey(gm.awayCode);
      var hCode = normalizeTeamKey(gm.homeCode);
      var hasAway = (aKey && tbNorm.indexOf(aKey) !== -1) || (aCode && aCode.length >= 3 && tbNorm.indexOf(aCode) !== -1);
      var hasHome = (hKey && tbNorm.indexOf(hKey) !== -1) || (hCode && hCode.length >= 3 && tbNorm.indexOf(hCode) !== -1);
      if (hasAway && hasHome) {
        return gm.id;
      }
    }
  }
  return null;
}

function resolveTiebreakerGame() {
  if (!GAMES || !GAMES.length) return null;
  // 1. Explicit state.tiebreakerGameId if valid
  if (state.tiebreakerGameId) {
    var byStateId = findGameById(state.tiebreakerGameId);
    if (byStateId) return byStateId;
  }
  // 2. Explicit g.isTiebreaker flag on a game object
  for (var i = 0; i < GAMES.length; i++) {
    if (GAMES[i].isTiebreaker) return GAMES[i];
  }
  // 3. Explicit "Tiebreaker Game" tag in g.tier or g.rationale
  for (var j = 0; j < GAMES.length; j++) {
    var tj = String(GAMES[j].tier || "") + " " + String(GAMES[j].rationale || "");
    if (/tie[\s-]*breaker/i.test(tj)) return GAMES[j];
  }
  // 4. Smart marquee / final-game fallback when a custom slate was scraped without an explicit tiebreaker tag:
  //    Prefer the highest-profile ranked vs. ranked matchup (e.g., #5 Georgia at #19 Texas, #13 Alabama at #11 Tennessee, etc.)
  //    or the final game on the sheet (Game #26), rather than blindly defaulting to an unflagged 11:00 AM Game #1 like Pitt at Miami.
  var bestCandidate = null;
  var bestScore = -999;
  for (var k = 0; k < GAMES.length; k++) {
    var gk = GAMES[k];
    var aRkStr = TEAM_RANKS[gk.away] || (gk.awayRec && gk.awayRec.match(/^#(\d+)/) ? ("#" + gk.awayRec.match(/^#(\d+)/)[1]) : null);
    var hRkStr = TEAM_RANKS[gk.home] || (gk.homeRec && gk.homeRec.match(/^#(\d+)/) ? ("#" + gk.homeRec.match(/^#(\d+)/)[1]) : null);
    var aRk = aRkStr ? parseInt(aRkStr.replace("#", ""), 10) : 99;
    var hRk = hRkStr ? parseInt(hRkStr.replace("#", ""), 10) : 99;
    var score = 0;
    if (aRk <= 25 && hRk <= 25) {
      score += 100 - (aRk + hRk);
    } else if (aRk <= 15 || hRk <= 15) {
      score += 25 - Math.min(aRk, hRk);
    }
    var spM = String(gk.poolLine || "").match(/-(\d+\.?\d*)/);
    var spVal = spM ? parseFloat(spM[1]) : 7;
    score -= spVal * 1.2;
    if (k === GAMES.length - 1) score += 15; // Game #26 tiebreaker convention bonus
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = gk;
    }
  }
  return bestCandidate || GAMES[GAMES.length - 1] || GAMES[0];
}

function syncTiebreakerCalculatorToGame(tbGame) {
  if (!tbGame) return;
  var ouEl = document.getElementById("calc-ou");
  var spEl = document.getElementById("calc-spread");
  if (!ouEl || !spEl) return;

  var ouVal = (typeof tbGame.ouTotal === "number" && !isNaN(tbGame.ouTotal)) ? tbGame.ouTotal : null;
  if (!ouVal && tbGame.liveLine) {
    var ouM = String(tbGame.liveLine).match(/O\/U\s*(\d+\.?\d*)/i);
    if (ouM) ouVal = parseFloat(ouM[1]);
  }
  var spVal = (typeof tbGame.liveSpreadNum === "number" && !isNaN(tbGame.liveSpreadNum)) ? tbGame.liveSpreadNum : null;
  if (spVal === null) {
    var spM = String(tbGame.liveLine || tbGame.poolLine || "").match(/-(\d+\.?\d*)/);
    if (spM) spVal = parseFloat(spM[1]);
  }
  if (ouVal) ouEl.value = ouVal;
  if (spVal !== null) spEl.value = -Math.abs(spVal);
  recalcImpliedTiebreaker();
}

function setTiebreakerGame(gameId, skipCloudSync) {
  var numId = parseInt(gameId, 10);
  var target = findGameById(numId);
  if (!target) return;
  state.tiebreakerGameId = target.id;
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (g.id === target.id) {
      g.isTiebreaker = true;
      if (g.tier && g.tier.indexOf("Tiebreaker") === -1) {
        g.tier = g.tier + " (Tiebreaker Game)";
      }
    } else {
      g.isTiebreaker = false;
      if (g.tier && g.tier.indexOf(" (Tiebreaker Game)") !== -1) {
        g.tier = g.tier.replace(" (Tiebreaker Game)", "");
      }
    }
  }
  updateWeekBrandingUI();
  syncTiebreakerCalculatorToGame(target);
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  if (!skipCloudSync) {
    pushCustomGamesToFirebase();
  }
  renderGames();
}

function updateWeekBrandingUI() {
  var isWk7 = isHardcodedWeek7Slate(GAMES);
  var hasWk8Standings = getMaxPriorPts(state.leaderboard) >= 120 || getMaxPriorPts(state.poolMembers) >= 120;
  var minWeek = (!isWk7 || hasWk8Standings) ? 8 : 7;
  var curWkNum = Math.max(parseInt(state.currentWeek, 10) || 0, parseWeekNumFromLabel(state.weekLabel), minWeek);
  state.currentWeek = curWkNum;
  state.weekLabel = "Week " + curWkNum;
  var brandEl = document.getElementById("sheet-title-brand");
  if (brandEl) {
    brandEl.textContent = state.weekLabel;
  }
  var tbGame = resolveTiebreakerGame();
  if (tbGame) {
    state.tiebreakerGameId = tbGame.id;
    var aDisp = formatOppWithRank(tbGame.away);
    var hDisp = formatOppWithRank(tbGame.home);
    var tbTitleEl = document.getElementById("tiebreaker-box-title");
    if (tbTitleEl) {
      tbTitleEl.textContent = "🎯 Official Tie-Breaker (#" + tbGame.id + " " + aDisp + " at " + hDisp + ")";
    }
    var selEl = document.getElementById("tiebreaker-game-select");
    if (selEl) {
      var optsHtml = "";
      for (var i = 0; i < GAMES.length; i++) {
        var gm = GAMES[i];
        var gmAway = formatOppWithRank(gm.away);
        var gmHome = formatOppWithRank(gm.home);
        var selAttr = (gm.id === tbGame.id) ? " selected" : "";
        optsHtml += '<option value="' + gm.id + '"' + selAttr + '>Game #' + gm.id + ': ' + gmAway + ' at ' + gmHome + ' (' + gm.poolLine + ')</option>';
      }
      selEl.innerHTML = optsHtml;
    }
    if (window._lastSyncedTbCalcGameId !== tbGame.id) {
      window._lastSyncedTbCalcGameId = tbGame.id;
      syncTiebreakerCalculatorToGame(tbGame);
    }
  }
  var presetBtns = document.querySelectorAll(".preset-grid .preset-btn");
  if (presetBtns && presetBtns.length >= 3) {
    if (!isWk7) {
      presetBtns[0].textContent = "★ Optimal EV (Best +EV Dogs + Core)";
      presetBtns[2].textContent = "🚀 Chaser (Live 2x/3x Multiplier Dogs)";
    } else {
      presetBtns[0].textContent = "★ Optimal EV (BYU 2x + Sharp 1x)";
      presetBtns[2].textContent = "🚀 Chaser (BYU + GT 2x Dogs)";
    }
  }
}

function sanitizeStateForActiveSlate() {
  var cleanedAny = false;
  // 1. Clean any g.kick that accidentally swallowed the next game's Away team line from Google Forms
  if (GAMES && Array.isArray(GAMES)) {
    for (var i = 0; i < GAMES.length; i++) {
      var g = GAMES[i];
      if (g.kick && !isLikelyKickoffLine(g.kick, null)) {
        g.kick = "Saturday CST";
        if (g.insights && g.insights.splits && !isLikelyKickoffLine(g.insights.splits, null)) {
          g.insights.splits = "Saturday CST";
        }
        cleanedAny = true;
      }
      var cleanAwCode = getCleanTeamCode(g.away, g.awayCode);
      var cleanHmCode = getCleanTeamCode(g.home, g.homeCode);
      if (g.awayCode !== cleanAwCode) { g.awayCode = cleanAwCode; cleanedAny = true; }
      if (g.homeCode !== cleanHmCode) { g.homeCode = cleanHmCode; cleanedAny = true; }
      var aRank = TEAM_RANKS[g.away] || null;
      var hRank = TEAM_RANKS[g.home] || null;
      var aClean = (g.awayRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
      var hClean = (g.homeRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
      var expectedAway = (aRank ? (aRank + " • ") : "") + aClean;
      var expectedHome = (hRank ? (hRank + " • ") : "") + hClean;
      if (g.awayRec !== expectedAway) { g.awayRec = expectedAway; cleanedAny = true; }
      if (g.homeRec !== expectedHome) { g.homeRec = expectedHome; cleanedAny = true; }

      if (enrichGameInjuries(g)) cleanedAny = true;
    }
  }

  // 2. Ensure week header reflects Week 8+ and never stays stuck on Week 6 or Week 7
  var prevWkLabel = state.weekLabel;
  var prevWkNum = state.currentWeek;
  updateWeekBrandingUI();
  if (state.weekLabel !== prevWkLabel || state.currentWeek !== prevWkNum) cleanedAny = true;

  // 2b. Ensure state.leaderboard & state.poolMembers never revert to pre-Week-7 points (max 107) when official Week 8 standings (max 124) are available!
  var curMaxLbPts = getMaxPriorPts(state.leaderboard);
  var officialWk8MaxPts = getMaxPriorPts(WEEK7_OFFICIAL_LEADERBOARD);
  if (curMaxLbPts < officialWk8MaxPts) {
    state.leaderboard = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_LEADERBOARD));
    cleanedAny = true;
  }
  var latestPtsLookup = {};
  var latestRankLookup = {};
  if (state.leaderboard && Array.isArray(state.leaderboard)) {
    for (var lbIdx = 0; lbIdx < state.leaderboard.length; lbIdx++) {
      var lbItem = state.leaderboard[lbIdx];
      var lbKey = standardizeParticipantName(lbItem.name).toLowerCase();
      latestPtsLookup[lbKey] = parseFloat(lbItem.priorPts) || 0;
      if (lbItem.rank) latestRankLookup[lbKey] = lbItem.rank;
    }
  }
  if (state.poolMembers && Array.isArray(state.poolMembers)) {
    for (var pmIdx = 0; pmIdx < state.poolMembers.length; pmIdx++) {
      var pmObj = state.poolMembers[pmIdx];
      var pmKey = standardizeParticipantName(pmObj.name).toLowerCase();
      if (latestPtsLookup[pmKey] !== undefined && (parseFloat(pmObj.priorPts) || 0) < latestPtsLookup[pmKey]) {
        pmObj.priorPts = latestPtsLookup[pmKey];
        if (latestRankLookup[pmKey]) pmObj.priorRank = latestRankLookup[pmKey];
        cleanedAny = true;
      }
    }
  }
  if (state.watchlist && Array.isArray(state.watchlist)) {
    // If watchlist still has Week 7's default top 3 (Taylor C 107, Chris H 106, Raukeese L 106), upgrade to Week 8's Top 3 (Raukeese L 124, Steve M 123, F.F.F. 123)
    if (state.watchlist.length >= 3 && state.watchlist[0].name === "Taylor C" && (parseFloat(state.watchlist[0].priorPts) || 0) <= 107) {
      state.watchlist = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_WATCHLIST));
      if (!isHardcodedWeek7Slate(GAMES)) {
        for (var wClr = 0; wClr < state.watchlist.length; wClr++) state.watchlist[wClr].picks = {};
      }
      cleanedAny = true;
    } else {
      for (var wUp = 0; wUp < state.watchlist.length; wUp++) {
        var wlItem = state.watchlist[wUp];
        var wlKey = standardizeParticipantName(wlItem.name).toLowerCase();
        if (latestPtsLookup[wlKey] !== undefined && (parseFloat(wlItem.priorPts) || 0) < latestPtsLookup[wlKey]) {
          wlItem.priorPts = latestPtsLookup[wlKey];
          if (latestRankLookup[wlKey]) wlItem.rank = latestRankLookup[wlKey];
          cleanedAny = true;
        }
      }
    }
  }

  // 3. Check if state.poolMembers has stale picks from a previous week's slate
  if (state.poolMembers && Array.isArray(state.poolMembers)) {
    for (var p = 0; p < state.poolMembers.length; p++) {
      var pm = state.poolMembers[p];
      if (!pm.picks) pm.picks = {};
      var pmCounts = countMatchingPicksForSlate(pm.picks, GAMES);
      if (pmCounts.total >= 5 && pmCounts.matched < Math.ceil(pmCounts.total * 0.5)) {
        pm.picks = {};
        pm.livePts = 0;
        pm.inProgressPts = 0;
        pm.finalPts = 0;
        pm.won1x = 0;
        pm.won2x = 0;
        pm.won3x = 0;
        pm.awaitingSheet = true;
        cleanedAny = true;
      } else if (pmCounts.matched === 0) {
        pm.awaitingSheet = true;
        pm.livePts = 0;
        pm.inProgressPts = 0;
        pm.finalPts = 0;
        pm.won1x = 0;
        pm.won2x = 0;
        pm.won3x = 0;
      } else {
        pm.awaitingSheet = false;
      }
    }
  }

  // 4. Check if state.watchlist has stale picks from a previous week's slate (NEVER invent default picks!)
  if (state.watchlist && Array.isArray(state.watchlist)) {
    for (var w = 0; w < state.watchlist.length; w++) {
      var wl = state.watchlist[w];
      if (!wl.picks) wl.picks = {};
      var wlCounts = countMatchingPicksForSlate(wl.picks, GAMES);
      if (wlCounts.total >= 5 && wlCounts.matched < Math.ceil(wlCounts.total * 0.5)) {
        wl.picks = {};
        cleanedAny = true;
      }
    }
  }

  // 5. Validate existing picks for Michael A, Kinyion C, Test Sim & all customUsers WITHOUT auto-filling empty/deleted profiles!
  ensureMultiUserAndPrivacyState();
  var profiles = getAllUserProfiles().map(function(p) { return p.key; });
  for (var pr = 0; pr < profiles.length; pr++) {
    var pk = profiles[pr];
    if (!state[pk]) state[pk] = { picks: {}, tiebreaker: "28-24", target: 20 };
    if (!state[pk].picks) state[pk].picks = {};
    if (state[pk]._picksCleared) {
      state[pk].picks = {};
      continue;
    }
    for (var gmIdx = 0; gmIdx < GAMES.length; gmIdx++) {
      var gm = GAMES[gmIdx];
      var curPick = state[pk].picks[gm.id] || state[pk].picks[String(gm.id)];
      if (!curPick) continue;
      var resolved = resolveSheetTeamFromCell(curPick, gm);
      if (!resolved) {
        delete state[pk].picks[gm.id];
        delete state[pk].picks[String(gm.id)];
        cleanedAny = true;
      } else if (curPick !== resolved) {
        state[pk].picks[gm.id] = resolved;
        state[pk].picks[String(gm.id)] = resolved;
      }
    }
  }

  // 6. Clean any LIVE_SCORES or SUMMARY_PBP_CACHE entry whose matchupKey doesn't match the current game at g.id
  for (var lsId in LIVE_SCORES) {
    var gObj = findGameById(parseInt(lsId, 10));
    var lsItem = LIVE_SCORES[lsId];
    if (!gObj || !lsItem) {
      delete LIVE_SCORES[lsId];
      delete SUMMARY_PBP_CACHE[lsId];
      continue;
    }
    var expectedKey = gameMatchupKey(gObj);
    if (!lsItem.matchupKey || lsItem.matchupKey !== expectedKey) {
      delete LIVE_SCORES[lsId];
      delete SUMMARY_PBP_CACHE[lsId];
      if (typeof resetFieldNodes === "function") resetFieldNodes(lsId);
      cleanedAny = true;
    }
  }
  for (var pbpId in SUMMARY_PBP_CACHE) {
    var gPbp = findGameById(parseInt(pbpId, 10));
    var pbpItem = SUMMARY_PBP_CACHE[pbpId];
    if (!gPbp || !pbpItem || pbpItem.matchupKey !== gameMatchupKey(gPbp)) {
      delete SUMMARY_PBP_CACHE[pbpId];
      if (typeof resetFieldNodes === "function") resetFieldNodes(pbpId);
    }
  }

  return cleanedAny;
}

function resetPoolPicksForNewWeek(syncToCloud) {
  saveCurrentWeekToArchive(false);
  if (state.poolMembers && Array.isArray(state.poolMembers)) {
    for (var i = 0; i < state.poolMembers.length; i++) {
      state.poolMembers[i].picks = {};
      state.poolMembers[i].livePts = 0;
      state.poolMembers[i].inProgressPts = 0;
      state.poolMembers[i].finalPts = 0;
      state.poolMembers[i].won1x = 0;
      state.poolMembers[i].won2x = 0;
      state.poolMembers[i].won3x = 0;
      state.poolMembers[i].awaitingSheet = true;
    }
  }
  if (state.watchlist && Array.isArray(state.watchlist)) {
    for (var w = 0; w < state.watchlist.length; w++) {
      state.watchlist[w].picks = {};
    }
  }
  updateWeekBrandingUI();
  regradeAllPoolMembersLive();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  if (syncToCloud) {
    pushWatchlistOrStandingsToFirebase();
    var st = document.getElementById("cloud-status-text");
    if (st) st.textContent = "🧹 Cleared pool & watchlist picks for " + (state.weekLabel || "New Week") + " (Awaiting Friday/Saturday Selection Sheet)!";
  }
  renderAll();
}

function ensureWatchlistDefaults() {
  if (!state.watchlist || !Array.isArray(state.watchlist) || state.watchlist.length === 0) {
    state.watchlist = [
      { id: "w1", name: "Pool Leader", rank: "1st", priorPts: 112, picks: {} },
      { id: "w2", name: "Rival #2", rank: "T-10th", priorPts: 105, picks: {} },
      { id: "w3", name: "Rival #3", rank: "T-25th", priorPts: 101, picks: {} }
    ];
  }
  if (!state.poolMembers || !Array.isArray(state.poolMembers) || state.poolMembers.length < 10) {
    state.poolMembers = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_POOL_MEMBERS));
  }
  if (!state.leaderboard || !Array.isArray(state.leaderboard) || state.leaderboard.length < 10) {
    state.leaderboard = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_LEADERBOARD));
  }
  if (state.watchlist && state.watchlist[0] && state.watchlist[0].name === "Pool Leader") {
    state.watchlist = JSON.parse(JSON.stringify(WEEK7_OFFICIAL_WATCHLIST));
  }
  for (var w = 0; w < state.watchlist.length; w++) {
    if (!state.watchlist[w].picks) state.watchlist[w].picks = {};
  }
}


