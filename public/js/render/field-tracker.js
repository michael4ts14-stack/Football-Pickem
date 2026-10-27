// ============================================================================
// FEATURE 2: INTERACTIVE SVG FIELD TRACKER, REAL ESPN FINAL/SCORING DRIVE PARSER
//            & INTERACTIVE DEMO PLAY-BY-PLAY SIMULATOR + BIG-SCREEN THEATER
// ============================================================================
var CFB_TEAM_ALIASES = {
  ohiostate: ["osu", "ohst", "ohiost", "ohiostatebuckeyes"],
  indiana: ["ind", "iu", "indianahoosiers"],
  florida: ["fla", "uf", "floridagators"],
  texas: ["tex", "texaslonghorns"],
  mississippistate: ["msst", "missst", "mississippistatebulldogs"],
  lsu: ["lsu", "lsutigers", "louisianastate"],
  virginia: ["uva", "virg", "virginiacavaliers"],
  smu: ["smu", "smumustangs", "southernmethodist"],
  northwestern: ["nw", "nu", "nwest", "northwesternwildcats"],
  michiganstate: ["msu", "michst", "michiganstatespartans"],
  cincinnati: ["cin", "cincy", "cincinnatibearcats"],
  westvirginia: ["wvu", "wva", "westvirginiamountaineers"],
  kansas: ["ku", "kan", "kansasjayhawks"],
  kansasstate: ["ksu", "kstate", "kansasstatewildcats"],
  pittsburgh: ["pitt", "pittsburghpanthers"],
  bostoncollege: ["bc", "bostoncollegeeagles"],
  alabama: ["bama", "ala", "alabamacrimsontide"],
  tennessee: ["tenn", "vols", "tennesseevolunteers"],
  missouri: ["mizzou", "mizz", "missouritigers"],
  olemiss: ["miss", "olemiss", "olemissrebels", "mississippirebels"],
  auburn: ["aub", "auburntigers"],
  georgia: ["uga", "georgiabulldogs"],
  arizonastate: ["asu", "arizst", "arizonastatesundevils"],
  texastech: ["ttu", "ttech", "texastechredraiders"],
  georgiatech: ["gt", "gatech", "georgiatechyellowjackets"],
  virginiatech: ["vt", "vatech", "virginiatechhokies"],
  northcarolina: ["unc", "northcarolinatarheels"],
  duke: ["duke", "dukebluedevils"],
  pennstate: ["psu", "pennst", "pennstatenittanylions"],
  michigan: ["mich", "michiganwolverines"],
  floridastate: ["fsu", "floridastateseminoles"],
  miamifl: ["mia", "miamihurricanes", "miami", "miamifl"],
  miami: ["mia", "miamihurricanes", "miamifl"],
  arkansas: ["ark", "arkansasrazorbacks"],
  vanderbilt: ["vandy", "van", "vanderbiltcommodores"],
  tcu: ["tcu", "tcuhornedfrogs", "texaschristian"],
  baylor: ["bay", "baylorbears"],
  notredame: ["nd", "notredamefightingirish"],
  byu: ["byu", "byucougars", "brighamyoung"],
  oklahomastate: ["okst", "oklast", "oklahomastatecowboys"],
  houston: ["hou", "uh", "houstoncougars"],
  wisconsin: ["wisc", "wis", "wisconsinbadgers"],
  ucla: ["ucla", "uclabruins"],
  kentucky: ["uk", "kent", "kentuckywildcats"],
  oklahoma: ["ou", "okla", "oklahomasooners"],
  louisville: ["lou", "lville", "louisvillecardinals"],
  syracuse: ["syr", "syracuseorange"],
  utah: ["utah", "utahutes"],
  colorado: ["colo", "coloradobuffaloes"],
  wakeforest: ["wake", "wakeforestdemondeacons"],
  california: ["cal", "californiagoldenbears"],
  nebraska: ["neb", "nebraskacornhuskers"],
  oregon: ["ore", "oregonducks"],
  southcarolina: ["scar", "sc", "southcarolinagamecocks"],
  texasam: ["tamu", "texasamaggies"],
  iowastate: ["isu", "iowast", "iowastatecyclones"],
  iowa: ["iowa", "iowahawkeyes"],
  clemson: ["clem", "clemsontigers"],
  usc: ["usc", "usctrojans", "southerncalifornia"]
};

var CFB_MASCOT_SUFFIXES = [
  "crimson tide", "fighting irish", "nittany lions", "golden bears", "demon deacons",
  "yellow jackets", "tar heels", "blue devils", "red raiders", "horned frogs",
  "sun devils", "wolfpack", "mountaineers", "cornhuskers", "cavaliers", "volunteers",
  "commodores", "wolverines", "razorbacks", "seminoles", "gamecocks", "hurricanes",
  "buckeyes", "hoosiers", "longhorns", "mustangs", "spartans", "bearcats", "jayhawks",
  "panthers", "bulldogs", "wildcats", "badgers", "sooners", "cardinals", "buffaloes",
  "cyclones", "hawkeyes", "trojans", "aggies", "gators", "tigers", "eagles", "rebels",
  "hokies", "bruins", "cougars", "cowboys", "orange", "ducks", "bears", "utes"
];

function stripMascotFromTeamName(rawName) {
  var s = String(rawName || "").trim();
  var low = s.toLowerCase();
  for (var i = 0; i < CFB_MASCOT_SUFFIXES.length; i++) {
    var m = CFB_MASCOT_SUFFIXES[i];
    if (low.length > m.length + 2 && low.slice(-m.length) === m && low.charAt(low.length - m.length - 1) === " ") {
      return s.slice(0, s.length - m.length - 1).trim();
    }
  }
  return s;
}

function teamKeyMatches(searchStr, teamFullName, teamSheetCode) {
  if (!searchStr || (!teamFullName && !teamSheetCode)) return false;
  var sFull = normalizeTeamKey(searchStr);
  var sSchool = normalizeTeamKey(stripMascotFromTeamName(searchStr));
  var f = normalizeTeamKey(teamFullName);
  var c = normalizeTeamKey(teamSheetCode);
  if (!sFull) return false;
  // Exact match on normalized school name or sheet code
  if (sFull === f || sFull === c || (sSchool && (sSchool === f || sSchool === c))) return true;
  // Safe word-boundary match (blocks State, Tech, A&M, OH, College, Southern, etc.)
  if (f && f.length >= 4 && sSchool && sSchool.length >= 4 && isSafeClientSubstrMatch(sSchool, f)) return true;
  var aliases = (CFB_TEAM_ALIASES[f] || []).concat(CFB_TEAM_ALIASES[c] || []);
  for (var a = 0; a < aliases.length; a++) {
    if (sFull === aliases[a] || (sSchool && sSchool === aliases[a])) return true;
  }
  return false;
}

function matchSideFromTeamText(rawTeamStr, g, ls, awayComp, homeComp) {
  if (!rawTeamStr || !g) return null;
  var norm = normalizeTeamKey(rawTeamStr);
  if (!norm) return null;

  var aAbbr = (ls && ls.awayAbbr) ? normalizeTeamKey(ls.awayAbbr) : (awayComp && awayComp.team ? normalizeTeamKey(awayComp.team.abbreviation) : "");
  var hAbbr = (ls && ls.homeAbbr) ? normalizeTeamKey(ls.homeAbbr) : (homeComp && homeComp.team ? normalizeTeamKey(homeComp.team.abbreviation) : "");

  if (aAbbr && norm === aAbbr) return "away";
  if (hAbbr && norm === hAbbr) return "home";

  if (awayComp && teamMatchesCompetitor(rawTeamStr, awayComp)) return "away";
  if (homeComp && teamMatchesCompetitor(rawTeamStr, homeComp)) return "home";

  var awayMatch = teamKeyMatches(rawTeamStr, g.away, g.awayCode);
  var homeMatch = teamKeyMatches(rawTeamStr, g.home, g.homeCode);

  if (awayMatch && !homeMatch) return "away";
  if (homeMatch && !awayMatch) return "home";

  var aName = normalizeTeamKey(g.away);
  var hName = normalizeTeamKey(g.home);
  if (aName.indexOf(norm) === 0 && hName.indexOf(norm) !== 0) return "away";
  if (hName.indexOf(norm) === 0 && aName.indexOf(norm) !== 0) return "home";

  return null;
}

function parseSpotTextToYl100(spotText, g, ls, awayComp, homeComp, possSide, yardsToEndzone) {
  // Converts an ESPN yard line string (e.g. "IND 28", "OSU 14", "50", "COLO 4") or yardsToEndzone
  // into a 0..100 coordinate where 0 = Away Endzone (Left) and 100 = Home Endzone (Right).
  var txt = String(spotText || "").trim();
  if (txt) {
    if (txt === "50" || /50\s*(?:yd|yard)?/i.test(txt)) return 50;
    var m = txt.match(/^([A-Za-z&.' -]+?)\s+(\d{1,2})$/);
    if (m) {
      var sidePrefix = m[1].trim();
      var yd = parseInt(m[2], 10);
      if (!isNaN(yd) && yd >= 0 && yd <= 50) {
        var side = matchSideFromTeamText(sidePrefix, g, ls, awayComp, homeComp);
        if (side === "away") return Math.max(0, Math.min(100, yd));
        if (side === "home") return Math.max(0, Math.min(100, 100 - yd));
      }
    }
  }
  if (typeof yardsToEndzone === "number" && !isNaN(yardsToEndzone) && yardsToEndzone >= 0 && yardsToEndzone <= 100) {
    if (possSide === "away") return Math.max(0, Math.min(100, 100 - yardsToEndzone));
    if (possSide === "home") return Math.max(0, Math.min(100, yardsToEndzone));
  }
  return null;
}

function formatYl100ToSpotText(yl100, g) {
  var y = Math.round(Math.max(0, Math.min(100, yl100)));
  if (y === 50) return "50";
  if (y <= 0) return g.awayCode.toUpperCase() + " Endzone";
  if (y >= 100) return g.homeCode.toUpperCase() + " Endzone";
  if (y < 50) return g.awayCode.toUpperCase() + " " + y;
  return g.homeCode.toUpperCase() + " " + (100 - y);
}

function parseYardLine100FromSituation(sit, awayComp, homeComp, possSide, g, ls) {
  if (!sit) return 50;
  var possText = String(sit.possessionText || "").trim();
  var fromSpot = parseSpotTextToYl100(possText, g, ls, awayComp, homeComp, possSide, sit.yardLine);
  if (fromSpot !== null) return fromSpot;
  if (typeof sit.yardLine === "number" && !isNaN(sit.yardLine)) {
    return Math.max(0, Math.min(100, sit.yardLine));
  }
  return 50;
}

function parseSingleEspnDrive(drv, g, ls, driveIndex) {
  if (!drv || !g) return null;
  var playsArr = Array.isArray(drv.plays) ? drv.plays : [];
  var firstPlay = playsArr.length > 0 ? playsArr[0] : null;
  var lastPlay = playsArr.length > 0 ? playsArr[playsArr.length - 1] : null;

  // Walk backwards to find the real final scrimmage snap, skipping period-ending dummy items (e.g. "End of 4th Quarter", "End of Game")
  var realLastPlay = null;
  for (var lpIdx = playsArr.length - 1; lpIdx >= 0; lpIdx--) {
    var pCandidate = playsArr[lpIdx];
    var pType = (pCandidate && pCandidate.type && pCandidate.type.text) || "";
    var pTxt = (pCandidate && (pCandidate.text || pCandidate.shortText)) || "";
    if (pType !== "End Period" && pType !== "End of Game" && !/^End of/i.test(pTxt)) {
      realLastPlay = pCandidate;
      break;
    }
  }
  if (!realLastPlay) realLastPlay = lastPlay;

  // 1. Identify which team actually had possession on this drive
  var possSide = null;
  if (drv.team) {
    var drvTeamId = drv.team.id ? String(drv.team.id) : "";
    if (drvTeamId && g.awayEspnId && drvTeamId === String(g.awayEspnId)) possSide = "away";
    else if (drvTeamId && g.homeEspnId && drvTeamId === String(g.homeEspnId)) possSide = "home";
    if (!possSide) {
      possSide = matchSideFromTeamText(drv.team.abbreviation || drv.team.location || drv.team.shortDisplayName || drv.team.displayName, g, ls, null, null);
    }
  }
  if (!possSide && realLastPlay && realLastPlay.start && realLastPlay.start.team && realLastPlay.start.team.id) {
    var lpTeamId = String(realLastPlay.start.team.id);
    if (g.awayEspnId && lpTeamId === String(g.awayEspnId)) possSide = "away";
    else if (g.homeEspnId && lpTeamId === String(g.homeEspnId)) possSide = "home";
  }
  if (!possSide) possSide = "away";

  var drvResult = String(drv.displayResult || drv.result || "").trim();
  var lastPlayTxt = realLastPlay ? String(realLastPlay.text || realLastPlay.shortText || "") : "";
  var isTdDrive = /^td|touchdown/i.test(drvResult) || (realLastPlay && realLastPlay.scoringPlay && /touchdown/i.test(lastPlayTxt));
  var isFgDrive = /^fg|field goal/i.test(drvResult) || (realLastPlay && realLastPlay.scoringPlay && /field goal good/i.test(lastPlayTxt));
  var isScoringDrive = !!drv.isScore || isTdDrive || isFgDrive || (realLastPlay && realLastPlay.scoringPlay === true);

  // 2. Determine Start of Drive yard line (0..100)
  var startSpotRaw = (drv.start && drv.start.text) || (firstPlay && firstPlay.start && firstPlay.start.possessionText) || "";
  var startYte = (firstPlay && firstPlay.start && typeof firstPlay.start.yardsToEndzone === "number") ? firstPlay.start.yardsToEndzone : null;
  var startYl100 = parseSpotTextToYl100(startSpotRaw, g, ls, null, null, possSide, startYte);
  if (startYl100 === null) startYl100 = (possSide === "away") ? 25 : 75;

  // 3. Determine End / Current Ball Spot of Drive (0..100)
  var endSpotRaw = "";
  var endYl100 = null;

  if (isTdDrive) {
    endYl100 = (possSide === "away") ? 100 : 0;
    endSpotRaw = (possSide === "away" ? g.homeCode : g.awayCode).toUpperCase() + " Endzone (TD)";
  }
  if (endYl100 === null && realLastPlay && realLastPlay.end && realLastPlay.end.possessionText) {
    endSpotRaw = realLastPlay.end.possessionText;
    endYl100 = parseSpotTextToYl100(endSpotRaw, g, ls, null, null, possSide, realLastPlay.end.yardsToEndzone);
  }
  if (endYl100 === null && drv.end && drv.end.text && drv.end.text !== "0" && !/ 0$/.test(drv.end.text)) {
    endSpotRaw = drv.end.text;
    endYl100 = parseSpotTextToYl100(endSpotRaw, g, ls, null, null, possSide, null);
  }
  if (endYl100 === null && realLastPlay && realLastPlay.start && realLastPlay.start.possessionText) {
    endSpotRaw = realLastPlay.start.possessionText;
    endYl100 = parseSpotTextToYl100(endSpotRaw, g, ls, null, null, possSide, realLastPlay.start.yardsToEndzone);
  }
  if (endYl100 === null && realLastPlay && realLastPlay.text) {
    var mText = realLastPlay.text.match(/(?:to the|at the)\s+([A-Za-z&.' -]+?\s+\d{1,2}|50(?:\s*yard line)?)/i);
    if (mText) {
      endSpotRaw = mText[1].replace(/yard line/i, "").trim();
      endYl100 = parseSpotTextToYl100(endSpotRaw, g, ls, null, null, possSide, null);
    }
  }
  if (endYl100 === null) {
    var netYds = typeof drv.yards === "number" ? drv.yards : 0;
    endYl100 = Math.max(2, Math.min(98, possSide === "away" ? (startYl100 + netYds) : (startYl100 - netYds)));
    endSpotRaw = formatYl100ToSpotText(endYl100, g);
  }
  if (!endSpotRaw) endSpotRaw = formatYl100ToSpotText(endYl100, g);

  // 4. Down & Distance on the last snap
  var lastDownDist = "";
  var distYards = 10;
  if (realLastPlay && realLastPlay.end && realLastPlay.end.downDistanceText && !drvResult) {
    lastDownDist = realLastPlay.end.downDistanceText;
    if (typeof realLastPlay.end.distance === "number" && realLastPlay.end.distance > 0) distYards = realLastPlay.end.distance;
  } else if (realLastPlay && realLastPlay.start && realLastPlay.start.downDistanceText) {
    lastDownDist = realLastPlay.start.downDistanceText;
    if (typeof realLastPlay.start.distance === "number" && realLastPlay.start.distance > 0) distYards = realLastPlay.start.distance;
  }
  var clockStr = "";
  if (realLastPlay && realLastPlay.period && realLastPlay.period.number) {
    var pNum = realLastPlay.period.number;
    var qtrStr = pNum > 4 ? ("OT" + (pNum - 4)) : ("Q" + pNum);
    var clk = (realLastPlay.clock && realLastPlay.clock.displayValue) ? realLastPlay.clock.displayValue : "";
    clockStr = qtrStr + (clk ? " " + clk : "");
  }

  var isRz = (possSide === "away" && endYl100 >= 80) || (possSide === "home" && endYl100 <= 20);

  // 5. Parse last 5 plays of this drive (newest first)
  var recentPlays = playsArr.slice(-5).reverse().map(function(p) {
    var txt = p.text || p.shortText || "Play recorded";
    var pClock = "";
    if (p.period && p.period.number) {
      pClock = (p.period.number > 4 ? "OT" : ("Q" + p.period.number)) + ((p.clock && p.clock.displayValue) ? " " + p.clock.displayValue : "");
    }
    var ddHdr = (p.start && p.start.downDistanceText)
      ? (p.start.downDistanceText + (p.start.possessionText ? " at " + p.start.possessionText : ""))
      : (p.end && p.end.possessionText ? ("At " + p.end.possessionText) : "");
    var statYds = typeof p.statYardage === "number" ? p.statYardage : null;
    var isScore = p.scoringPlay === true || /touchdown|field goal good|safety/i.test(txt);
    var isTurnover = /intercept|fumble/i.test(txt) && /recovered by|intercepted by|turnover/i.test(txt);
    return {
      clock: pClock,
      header: ddHdr ? (ddHdr + ": ") : "",
      text: txt,
      statYardage: statYds,
      isScore: isScore,
      isTurnover: isTurnover
    };
  });

  var teamDisplay = possSide === "away" ? g.away : g.home;
  var teamCode = possSide === "away" ? g.awayCode : g.homeCode;

  return {
    driveIndex: driveIndex,
    possessionSide: possSide,
    teamName: teamDisplay,
    teamCode: teamCode,
    startSpotText: startSpotRaw || formatYl100ToSpotText(startYl100, g),
    startYl100: startYl100,
    endSpotText: endSpotRaw,
    yl100: endYl100,
    downDistanceText: lastDownDist,
    distYards: distYards,
    clockStr: clockStr,
    result: drvResult || (isScoringDrive ? "Scoring Drive" : "Drive Complete"),
    isScoringDrive: isScoringDrive,
    isTdDrive: isTdDrive,
    isRedZone: isRz,
    playsCount: (drv.offensivePlays !== undefined ? drv.offensivePlays : playsArr.length) || 0,
    yards: drv.yards !== undefined ? drv.yards : 0,
    timeElapsed: (drv.timeElapsed && drv.timeElapsed.displayValue) ? drv.timeElapsed.displayValue : "0:00",
    description: drv.description || ((playsArr.length || 0) + " plays, " + (drv.yards || 0) + " yds"),
    lastPlays: recentPlays
  };
}

function normalizeInjuryStatusCode(rawStatus) {
  var s = String(rawStatus || "").toUpperCase();
  if (s.indexOf("OUT") !== -1 || s.indexOf("IR") !== -1 || s.indexOf("INJURED RESERVE") !== -1) return "OUT";
  if (s.indexOf("DOUBT") !== -1 || s.indexOf("QUESTION") !== -1 || s === "Q" || s === "D") return "QUESTIONABLE";
  if (s.indexOf("PROB") !== -1 || s === "P") return "PROBABLE";
  return "FULL";
}

function computeKeyInjHeaderFromLists(g, forceRecompute) {
  if (!g) return "";
  if (!forceRecompute && g.keyInjHeader && !isPlaceholderText(g.keyInjHeader)) {
    // Verify the cached header doesn't reference a stale 2024 player
    var lowHdr = String(g.keyInjHeader).toLowerCase();
    var hasStale = false;
    for (var stName in STALE_2024_INJURY_NAMES) {
      if (lowHdr.indexOf(stName) !== -1) { hasStale = true; break; }
    }
    if (!hasStale) return g.keyInjHeader;
  }
  var alerts = [];
  var checkList = function(list, code) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.p || isPlaceholderText(it.p) || isStale2024InjuryPlayer(it.p)) continue;
      if (it.st === "OUT" || it.st === "QUESTIONABLE") {
        var icon = it.st === "OUT" ? "🚨 " : "⚠️ ";
        alerts.push(icon + (code || "").toUpperCase() + " " + (it.pos && it.pos !== "TEAM" && it.pos !== "POS" ? (it.pos + " ") : "") + it.p + " " + it.st);
        if (alerts.length >= 2) break;
      }
    }
  };
  checkList(g.awayInj, g.awayCode);
  checkList(g.homeInj, g.homeCode);
  return alerts.join(" • ");
}

var CFB_RANKINGS_CACHE = null;
var CFB_RANKINGS_LAST_FETCH = 0;

async function fetchLiveCollegeFootballRankings(force) {
  var now = Date.now();
  if (!force && CFB_RANKINGS_CACHE && (now - CFB_RANKINGS_LAST_FETCH < 300000)) {
    return false;
  }
  try {
    var url = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings";
    var data = await fetchJsonSafe(url);
    if (data && Array.isArray(data.rankings)) {
      var apPoll = data.rankings.find(function(p) { return p.name === "AP Top 25"; }) || data.rankings[0];
      if (apPoll && Array.isArray(apPoll.ranks) && apPoll.ranks.length >= 20) {
        CFB_RANKINGS_CACHE = data;
        CFB_RANKINGS_LAST_FETCH = now;
        var newRanks = {};
        for (var i = 0; i < apPoll.ranks.length; i++) {
          var rk = apPoll.ranks[i];
          if (rk && rk.current && rk.team) {
            var loc = rk.team.location || rk.team.name;
            var rankStr = "#" + rk.current;
            if (loc) {
              newRanks[loc] = rankStr;
              if (loc === "Miami") newRanks["Miami (FL)"] = rankStr;
            }
          }
        }
        if (Object.keys(newRanks).length >= 20) {
          for (var k in TEAM_RANKS) {
            delete TEAM_RANKS[k];
          }
          Object.assign(TEAM_RANKS, newRanks);

          if (Array.isArray(GAMES)) {
            var anyChanged = false;
            for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
              var gm = GAMES[gIdx];
              var aRk = TEAM_RANKS[gm.away] || null;
              var hRk = TEAM_RANKS[gm.home] || null;
              var aCln = (gm.awayRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
              var hCln = (gm.homeRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
              var expAway = (aRk ? (aRk + " • ") : "") + aCln;
              var expHome = (hRk ? (hRk + " • ") : "") + hCln;
              if (gm.awayRec !== expAway) { gm.awayRec = expAway; anyChanged = true; }
              if (gm.homeRec !== expHome) { gm.homeRec = expHome; anyChanged = true; }
            }
            if (anyChanged) {
              if (typeof renderGames === "function") renderGames();
              if (typeof renderLiveScoreboardTab === "function") renderLiveScoreboardTab();
            }
          }
          return true;
        }
      }
    }
  } catch (eRanks) {}
  return false;
}

var CFB_INJURIES_CACHE = null;
var CFB_INJURIES_LAST_FETCH = 0;

async function fetchLiveCollegeFootballInjuries(force) {
  var now = Date.now();
  if (!force && CFB_INJURIES_CACHE && (now - CFB_INJURIES_LAST_FETCH < 120000)) {
    return applyCfbInjuriesData(CFB_INJURIES_CACHE);
  }
  try {
    var url = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/injuries";
    var data = await fetchJsonSafe(url);
    if (data && Array.isArray(data.injuries)) {
      CFB_INJURIES_CACHE = data;
      CFB_INJURIES_LAST_FETCH = now;
      return applyCfbInjuriesData(data);
    }
  } catch (e) {}
  return false;
}

function matchEspnInjuryBlockToSide(teamBlock, g) {
  if (!teamBlock || !g) return null;
  var tObj = teamBlock.team || teamBlock;
  var tId = tObj.id ? String(tObj.id) : (teamBlock.id ? String(teamBlock.id) : "");
  var awayId = g.awayEspnId || lookupEspnTeamId(g.away, g, true);
  var homeId = g.homeEspnId || lookupEspnTeamId(g.home, g, false);

  // If the ESPN block has a team ID and we know the game's ESPN team IDs, match STRICTLY by ID so other FBS teams never bleed in!
  if (tId && awayId && tId === String(awayId)) return "away";
  if (tId && homeId && tId === String(homeId)) return "home";
  if (tId && awayId && homeId) return null;

  var tName = tObj.location || tObj.shortDisplayName || tObj.displayName || teamBlock.displayName || teamBlock.name || "";
  var matchAw = (!awayId) && teamKeyMatches(tName, g.away, g.awayCode);
  var matchHm = (!homeId) && teamKeyMatches(tName, g.home, g.homeCode);
  if (matchAw && !matchHm) return "away";
  if (matchHm && !matchAw) return "home";
  return null;
}

function applyCfbInjuriesData(data) {
  if (!data || !Array.isArray(data.injuries) || data.injuries.length === 0) return false;
  var anyUpdated = false;

  for (var k = 0; k < GAMES.length; k++) {
    var g = GAMES[k];
    var awayInjList = [];
    var homeInjList = [];

    for (var i = 0; i < data.injuries.length; i++) {
      var teamBlock = data.injuries[i];
      if (!teamBlock || !Array.isArray(teamBlock.injuries) || teamBlock.injuries.length === 0) continue;

      var side = matchEspnInjuryBlockToSide(teamBlock, g);
      if (!side) continue;

      for (var j = 0; j < teamBlock.injuries.length; j++) {
        var inj = teamBlock.injuries[j];
        var ath = inj.athlete || {};
        var pName = ath.displayName || ath.shortName || inj.displayName || "Player";
        if (isStale2024InjuryPlayer(pName)) continue;
        var pos = (ath.position && ath.position.abbreviation) ? ath.position.abbreviation : "POS";
        var stCode = normalizeInjuryStatusCode(inj.status || (inj.type && inj.type.description));
        var det = (inj.details && (inj.details.type || inj.details.detail)) ? (inj.details.type || inj.details.detail) : "";
        var comment = inj.shortComment || det || (inj.status ? ("Listed " + inj.status) : "ESPN Availability Report");
        var entry = { p: pName, pos: pos, st: stCode, note: comment };

        if (side === "away") awayInjList.push(entry);
        else homeInjList.push(entry);
      }
    }

    if (awayInjList.length > 0) {
      g.awayInj = awayInjList.slice(0, 8);
      anyUpdated = true;
    }
    if (homeInjList.length > 0) {
      g.homeInj = homeInjList.slice(0, 8);
      anyUpdated = true;
    }
    var freshHdr = computeKeyInjHeaderFromLists(g, true);
    if (freshHdr !== (g.keyInjHeader || "")) {
      g.keyInjHeader = freshHdr;
      anyUpdated = true;
    }
  }
  return anyUpdated;
}

function enrichGameFromEspnSummaryData(g, data) {
  if (!g || !data) return;
  g._summaryEnriched = true;

  // 1. Extract Official Team Injuries from data.injuries (if available on event summary)
  if (Array.isArray(data.injuries) && data.injuries.length > 0) {
    var awayInjList = [];
    var homeInjList = [];

    for (var idx = 0; idx < data.injuries.length; idx++) {
      var teamBlock = data.injuries[idx];
      if (!teamBlock || !Array.isArray(teamBlock.injuries)) continue;
      var side = matchEspnInjuryBlockToSide(teamBlock, g);
      if (!side) continue;

      var rawInjs = teamBlock.injuries;
      for (var j = 0; j < rawInjs.length; j++) {
        var inj = rawInjs[j];
        var ath = inj.athlete || {};
        var pName = ath.displayName || ath.shortName || "Player";
        if (isStale2024InjuryPlayer(pName)) continue;
        var pos = (ath.position && ath.position.abbreviation) ? ath.position.abbreviation : "POS";
        var stCode = normalizeInjuryStatusCode(inj.status || (inj.type && inj.type.description));
        var det = (inj.details && (inj.details.type || inj.details.detail)) ? (inj.details.type || inj.details.detail) : "";
        var comment = inj.shortComment || det || (inj.status ? ("Listed " + inj.status) : "ESPN Availability Report");
        var entry = { p: pName, pos: pos, st: stCode, note: comment };
        if (side === "away") awayInjList.push(entry);
        else homeInjList.push(entry);
      }
    }

    if (awayInjList.length > 0) g.awayInj = awayInjList.slice(0, 8);
    if (homeInjList.length > 0) g.homeInj = homeInjList.slice(0, 8);
    g.keyInjHeader = computeKeyInjHeaderFromLists(g, true);
  } else {
    g.keyInjHeader = computeKeyInjHeaderFromLists(g, true);
  }

  // 2. Extract Season / Game Stat Leaders from data.leaders
  if (Array.isArray(data.leaders) && data.leaders.length > 0) {
    for (var l = 0; l < data.leaders.length; l++) {
      var lBlock = data.leaders[l];
      if (!lBlock || !Array.isArray(lBlock.leaders)) continue;
      var lSide = matchEspnInjuryBlockToSide(lBlock, g);
      if (!lSide) continue;

      var snippets = [];
      for (var c = 0; c < lBlock.leaders.length && snippets.length < 3; c++) {
        var cat = lBlock.leaders[c];
        var topLeader = (cat && Array.isArray(cat.leaders) && cat.leaders[0]) ? cat.leaders[0] : null;
        if (topLeader && topLeader.athlete) {
          var aName = topLeader.athlete.shortName || topLeader.athlete.displayName || "";
          var dispVal = topLeader.displayValue || "";
          if (aName && dispVal) snippets.push(aName + " (" + dispVal + ")");
        }
      }
      if (snippets.length > 0) {
        if (lSide === "away") g.awayLeaderText = snippets.join(", ");
        else g.homeLeaderText = snippets.join(", ");
      }
    }
  }

  // 3. Extract Pickcenter / Live Vegas Spread & O/U if present
  if (Array.isArray(data.pickcenter) && data.pickcenter.length > 0) {
    var pc = data.pickcenter[0];
    if (pc && pc.details) {
      var ouStr = pc.overUnder ? (" (O/U " + pc.overUnder + ")") : "";
      g.liveLine = pc.details + ouStr;
      if (typeof pc.overUnder === "number") g.ouTotal = pc.overUnder;
      var spM = String(pc.details).match(/-(\d+\.?\d*)/);
      if (spM) g.liveSpreadNum = parseFloat(spM[1]);
    }
  }

  rebuildDynamicGameInsights(g);
}

// ESPN summary "winprobability" -> home win chance per play (0..1), thinned to <= 200 points.
function summaryWinProbSeries(data) {
  var raw = data && Array.isArray(data.winprobability) ? data.winprobability : [];
  var out = [];
  var step = Math.max(1, Math.ceil(raw.length / 200));
  for (var i = 0; i < raw.length; i += step) {
    var v = raw[i] && raw[i].homeWinPercentage;
    if (typeof v === "number" && !isNaN(v)) out.push(Math.max(0, Math.min(1, v)));
  }
  var lastRaw = raw.length && raw[raw.length - 1].homeWinPercentage;
  if (typeof lastRaw === "number" && out.length && (raw.length - 1) % step !== 0) out.push(Math.max(0, Math.min(1, lastRaw)));
  return out;
}

async function fetchGameDriveSummary(gameId, eventId) {
  if (!eventId) return;
  var reqEpoch = activeSlateEpoch;
  var gBefore = findGameById(gameId);
  if (!gBefore) return;
  var reqMatchupKey = gameMatchupKey(gBefore);

  try {
    var url = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=" + eventId;
    var data = await fetchJsonSafe(url);
    if (!data) return;

    // Abort if the slate changed while the fetch was in flight
    var g = findGameById(gameId);
    if (!g || reqEpoch !== activeSlateEpoch || gameMatchupKey(g) !== reqMatchupKey) return;

    // Verify from data.header.competitions[0].competitors that this ESPN event actually belongs to BOTH g.away and g.home!
    var hdrComp = data.header && data.header.competitions && data.header.competitions[0];
    if (hdrComp && Array.isArray(hdrComp.competitors) && hdrComp.competitors.length >= 2) {
      var hAway = null, hHome = null;
      for (var hc = 0; hc < hdrComp.competitors.length; hc++) {
        if (hdrComp.competitors[hc].homeAway === "away") hAway = hdrComp.competitors[hc];
        if (hdrComp.competitors[hc].homeAway === "home") hHome = hdrComp.competitors[hc];
      }
      if (hAway && hHome) {
        var verifyScore = scoreGameAgainstEvent(g, { away: hAway, home: hHome });
        if (verifyScore.score < 9) {
          // Stale eventId from a previous week's matchup! Purge it immediately.
          delete SUMMARY_PBP_CACHE[gameId];
          delete LIVE_SCORES[gameId];
          return;
        }
      }
    }

    var ls = LIVE_SCORES[gameId] || null;
    enrichGameFromEspnSummaryData(g, data);

    if (!data.drives) return;

    var rawDrives = [];
    if (Array.isArray(data.drives.previous)) {
      rawDrives = data.drives.previous.slice();
    }
    if (data.drives.current) {
      rawDrives.push(data.drives.current);
    }
    if (rawDrives.length === 0) return;

    var parsedDrives = [];
    for (var i = 0; i < rawDrives.length; i++) {
      var pd = parseSingleEspnDrive(rawDrives[i], g, ls, i + 1);
      if (pd) parsedDrives.push(pd);
    }
    if (parsedDrives.length === 0) return;

    var finalDrv = parsedDrives[parsedDrives.length - 1];
    var lastScoringDrv = null;
    for (var j = parsedDrives.length - 1; j >= 0; j--) {
      if (parsedDrives[j].isScoringDrive) {
        lastScoringDrv = parsedDrives[j];
        break;
      }
    }

    SUMMARY_PBP_CACHE[gameId] = {
      eventId: String(eventId),
      matchupKey: gameMatchupKey(g),
      playsCount: finalDrv.playsCount,
      yards: finalDrv.yards,
      timeElapsed: finalDrv.timeElapsed,
      description: finalDrv.description,
      last3Plays: finalDrv.lastPlays,
      finalDrive: finalDrv,
      lastScoringDrive: lastScoringDrv || finalDrv,
      allDrives: parsedDrives,
      winProb: summaryWinProbSeries(data),
      fetchedAt: Date.now()
    };
  } catch (e) {}
}

