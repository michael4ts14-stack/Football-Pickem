// ============================================================================
// INTERACTIVE DEMO PLAY-BY-PLAY SIMULATOR (Lets you test live animations anytime!)
// ============================================================================
function ensureDemoSimState(g) {
  if (!g) return null;
  if (!DEMO_SIM_STATE[g.id]) {
    var startAway = (g.id % 2 === 1);
    var possSide = startAway ? "away" : "home";
    var startYl = startAway ? 25 : 75;
    var curYl = startAway ? 64 : 36;
    var spotTxt = formatYl100ToSpotText(curYl, g);
    DEMO_SIM_STATE[g.id] = {
      possessionSide: possSide,
      startYl100: startYl,
      yl100: curYl,
      down: 1,
      distance: 10,
      firstDownYl100: startAway ? Math.min(100, curYl + 10) : Math.max(0, curYl - 10),
      playsCount: 4,
      yards: 39,
      clockSec: 412,
      quarter: 4,
      lastResultBanner: "",
      plays: [
        {
          clock: "Q4 6:52",
          header: "1st & 10 at " + spotTxt + ": ",
          text: (startAway ? g.away : g.home) + " tempo offense at the line — tap Simulate next play to run the next snap.",
          statYardage: 14,
          isScore: false,
          isTurnover: false
        },
        {
          clock: "Q4 7:28",
          header: "2nd & 6 at " + formatYl100ToSpotText(50, g) + ": ",
          text: "Play-action dart over the middle for 14 yards and a 1st Down!",
          statYardage: 14,
          isScore: false,
          isTurnover: false
        },
        {
          clock: "Q4 8:05",
          header: "1st & 10 at " + formatYl100ToSpotText(startAway ? 25 : 75, g) + ": ",
          text: "Zone read keeper off left end bursts for 21 yards across midfield.",
          statYardage: 21,
          isScore: false,
          isTurnover: false
        }
      ]
    };
  }
  return DEMO_SIM_STATE[g.id];
}

function setGameDriveViewMode(gameId, mode, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  GAME_DRIVE_VIEW_MODE[gameId] = mode;
  EXPANDED_FIELD_TRACKERS[gameId] = true;
  var g = findGameById(gameId);
  if (mode === "demo" && g) {
    ensureDemoSimState(g);
  }
  var ls = LIVE_SCORES[gameId];
  if (mode !== "demo" && ls && ls.eventId && !SUMMARY_PBP_CACHE[gameId]) loadGameDrives(gameId);
  renderAll();
  if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
}

function simulateNextDemoPlay(gameId, actionType, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  var g = findGameById(gameId);
  if (!g) return;
  GAME_DRIVE_VIEW_MODE[gameId] = "demo";
  EXPANDED_FIELD_TRACKERS[gameId] = true;
  var sim = ensureDemoSimState(g);
  sim.prevYl100 = sim.yl100;

  var isAway = sim.possessionSide === "away";
  var offTeam = isAway ? g.away : g.home;
  var defTeam = isAway ? g.home : g.away;

  if (actionType === "reset") {
    delete DEMO_SIM_STATE[gameId];
    sim = ensureDemoSimState(g);
    sim.possessionSide = isAway ? "home" : "away";
    sim.startYl100 = sim.possessionSide === "away" ? 25 : 75;
    sim.yl100 = sim.startYl100;
    sim.firstDownYl100 = sim.possessionSide === "away" ? 35 : 65;
    sim.down = 1;
    sim.distance = 10;
    sim.playsCount = 1;
    sim.yards = 0;
    sim.plays = [{
      clock: "Q4 9:45",
      header: "1st & 10 at " + formatYl100ToSpotText(sim.yl100, g) + ": ",
      text: "New drive started for " + (sim.possessionSide === "away" ? g.away : g.home) + " after touchback.",
      statYardage: 0,
      isScore: false,
      isTurnover: false
    }];
    renderAll();
    if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
    return;
  }

  if (actionType === "redzone") {
    sim.yl100 = isAway ? 86 : 14;
    sim.firstDownYl100 = isAway ? 96 : 4;
    sim.down = 1;
    sim.distance = 10;
    var rzSpot = formatYl100ToSpotText(sim.yl100, g);
    sim.plays.unshift({
      clock: "Q4 3:12",
      header: "1st & 10 at " + rzSpot + ": ",
      text: "Red zone: " + offTeam + " snaps inside the " + defTeam + " 14-yard line!",
      statYardage: 22,
      isScore: false,
      isTurnover: false
    });
    renderAll();
    if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
    return;
  }

  var preSpot = formatYl100ToSpotText(sim.yl100, g);
  var preDd = sim.down + (sim.down === 1 ? "st" : (sim.down === 2 ? "nd" : (sim.down === 3 ? "rd" : "th"))) + " & " + sim.distance + " at " + preSpot;

  var yardsToGoal = isAway ? (100 - sim.yl100) : sim.yl100;
  var gain = 0;
  var playDesc = "";
  var isScore = false;
  var isTurnover = false;

  if (actionType === "bigplay" || yardsToGoal <= 7) {
    gain = yardsToGoal;
    isScore = true;
    playDesc = "Touchdown " + offTeam.toUpperCase() + "! Explosive " + gain + "-yard strike into the endzone!";
  } else {
    var roll = ((sim.playsCount * 7 + gameId * 3) % 10);
    var playTemplates = [
      { yds: 8, desc: offTeam + " quick slant completed across the hash for 8 yards." },
      { yds: 15, desc: offTeam + " RPO seam pass hits stride in space for 15 yards!" },
      { yds: 5, desc: offTeam + " inside zone rush behind left guard picks up 5 tough yards." },
      { yds: -2, desc: defTeam + " edge blitz knifes through for a 2-yard tackle for loss!" },
      { yds: 19, desc: offTeam + " deep comeback route on the sideline hauls in 19 yards!" },
      { yds: 4, desc: offTeam + " QB keeper scrambles out of bounds for a 4-yard gain." },
      { yds: 11, desc: offTeam + " screen pass in the flat follows blocks for 11 yards and a 1st Down!" },
      { yds: 6, desc: offTeam + " counter trey run off right tackle grinds out 6 yards." },
      { yds: 24, desc: offTeam + " slot fade down the seam connects for a 24-yard chunk play!" },
      { yds: 3, desc: offTeam + " power dive up the middle moves the pile 3 yards." }
    ];
    var chosen = playTemplates[roll];
    gain = Math.min(yardsToGoal, chosen.yds);
    if (gain >= yardsToGoal) {
      isScore = true;
      playDesc = "Touchdown " + offTeam.toUpperCase() + "! " + offTeam + " punches it in from " + gain + " yards out!";
    } else {
      playDesc = chosen.desc;
    }
  }

  sim.playsCount += 1;
  sim.yards += gain;
  sim.clockSec = Math.max(15, sim.clockSec - 26);
  var mins = Math.floor(sim.clockSec / 60);
  var secs = sim.clockSec % 60;
  var clkStr = "Q" + sim.quarter + " " + mins + ":" + (secs < 10 ? "0" + secs : secs);

  if (isScore) {
    sim.yl100 = isAway ? 100 : 0;
    sim.down = 1;
    sim.distance = 10;
    sim.firstDownYl100 = sim.yl100;
  } else {
    sim.yl100 = isAway ? Math.min(99, Math.max(1, sim.yl100 + gain)) : Math.max(1, Math.min(99, sim.yl100 - gain));
    var reachedFirst = isAway ? (sim.yl100 >= sim.firstDownYl100) : (sim.yl100 <= sim.firstDownYl100);
    if (reachedFirst) {
      sim.down = 1;
      var remGoal = isAway ? (100 - sim.yl100) : sim.yl100;
      sim.distance = Math.min(10, remGoal);
      sim.firstDownYl100 = isAway ? Math.min(100, sim.yl100 + sim.distance) : Math.max(0, sim.yl100 - sim.distance);
      playDesc += " (1ST DOWN!)";
    } else {
      sim.down += 1;
      sim.distance = Math.max(1, Math.round(isAway ? (sim.firstDownYl100 - sim.yl100) : (sim.yl100 - sim.firstDownYl100)));
      if (sim.down > 4) {
        isTurnover = true;
        playDesc += " Turnover on downs. " + defTeam + " takes over!";
        sim.possessionSide = isAway ? "home" : "away";
        sim.startYl100 = sim.yl100;
        sim.down = 1;
        sim.distance = 10;
        sim.playsCount = 1;
        sim.yards = 0;
        sim.firstDownYl100 = sim.possessionSide === "away" ? Math.min(100, sim.yl100 + 10) : Math.max(0, sim.yl100 - 10);
      }
    }
  }

  sim.plays.unshift({
    clock: clkStr,
    header: preDd + ": ",
    text: playDesc,
    statYardage: gain,
    isScore: isScore,
    isTurnover: isTurnover
  });
  if (sim.plays.length > 6) sim.plays.pop();

  renderAll();
  if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
}

function toggleDemoAutoLoop(gameId, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  if (DEMO_AUTO_TIMER) {
    clearInterval(DEMO_AUTO_TIMER);
    DEMO_AUTO_TIMER = null;
    renderAll();
    if (ACTIVE_THEATER_GAME_ID) renderFieldTheaterModalContent(ACTIVE_THEATER_GAME_ID);
    return;
  }
  simulateNextDemoPlay(gameId, "next");
  DEMO_AUTO_TIMER = setInterval(function() {
    var sim = DEMO_SIM_STATE[gameId];
    if (sim && (sim.yl100 <= 0 || sim.yl100 >= 100)) {
      simulateNextDemoPlay(gameId, "reset");
    } else {
      simulateNextDemoPlay(gameId, "next");
    }
  }, 2400);
  renderAll();
  if (ACTIVE_THEATER_GAME_ID) renderFieldTheaterModalContent(ACTIVE_THEATER_GAME_ID);
}

function toggleFieldTrackerAccordion(gameId, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  var isCurrentlyOpen = (EXPANDED_FIELD_TRACKERS[gameId] === true);
  if (isCurrentlyOpen) {
    delete EXPANDED_FIELD_TRACKERS[gameId];
  } else {
    EXPANDED_FIELD_TRACKERS[gameId] = true;
  }
  var ls = LIVE_SCORES[gameId];
  if (EXPANDED_FIELD_TRACKERS[gameId] && ls && ls.eventId && !SUMMARY_PBP_CACHE[gameId]) loadGameDrives(gameId);
  renderAll();
}

function resolveDriveTelemetryForGame(g, ls) {
  var curMatchupKey = gameMatchupKey(g);
  if (ls && ls.matchupKey && ls.matchupKey !== curMatchupKey) {
    ls = null;
  }
  var pbpCache = SUMMARY_PBP_CACHE[g.id] || null;
  if (pbpCache) {
    if (pbpCache.matchupKey !== curMatchupKey || (ls && ls.eventId && pbpCache.eventId && String(pbpCache.eventId) !== String(ls.eventId))) {
      delete SUMMARY_PBP_CACHE[g.id];
      pbpCache = null;
    }
  }
  var customMode = GAME_DRIVE_VIEW_MODE[g.id] || null;
  var isLive = !!(ls && ls.inProgress);
  var isCompleted = !!(ls && ls.completed);

  // Priority 1: Explicit Demo Mode (either global DEMO_FIELD_PREVIEW or per-game "demo" tab)
  if (customMode === "demo" || (DEMO_FIELD_PREVIEW && customMode !== "final" && customMode !== "scoring")) {
    var sim = ensureDemoSimState(g);
    var spotTxt = formatYl100ToSpotText(sim.yl100, g);
    var ddStr = sim.down + (sim.down === 1 ? "st" : (sim.down === 2 ? "nd" : (sim.down === 3 ? "rd" : "th"))) +
      ( (sim.possessionSide === "away" ? (100 - sim.yl100) : sim.yl100) <= sim.distance ? " & Goal" : (" & " + sim.distance) ) +
      " at " + spotTxt;
    var isRzDemo = (sim.possessionSide === "away" && sim.yl100 >= 80) || (sim.possessionSide === "home" && sim.yl100 <= 20);
    return {
      bannerType: "demo",
      activeMode: "demo",
      sitText: "Demo sim: " + ddStr,
      possessionSide: sim.possessionSide,
      possessionText: spotTxt,
      downDistanceText: ddStr,
      startYl100: sim.startYl100,
      prevYl100: typeof sim.prevYl100 === "number" ? sim.prevYl100 : sim.yl100,
      lastGainYds: (sim.plays && sim.plays[0] && typeof sim.plays[0].statYardage === "number") ? sim.plays[0].statYardage : 0,
      yl100: sim.yl100,
      distYards: sim.distance,
      isRedZone: isRzDemo,
      driveResult: "Interactive Simulation",
      driveDesc: sim.playsCount + " plays, " + sim.yards + " yds • Start: " + formatYl100ToSpotText(sim.startYl100, g),
      clockStr: sim.plays[0] ? sim.plays[0].clock : "Q4",
      plays: sim.plays
    };
  }

  // Priority 2: Actively Live In-Progress Game
  if (isLive && (!customMode || customMode === "live")) {
    var liveDrv = pbpCache ? pbpCache.finalDrive : null;
    var possSideLive = ls.possessionSide || (liveDrv ? liveDrv.possessionSide : "away");
    var ylLive = typeof ls.yardLine100 === "number" ? ls.yardLine100 : (liveDrv ? liveDrv.yl100 : 50);
    var startYlLive = liveDrv ? liveDrv.startYl100 : ylLive;
    var possTxtLive = ls.possessionText || (liveDrv ? liveDrv.endSpotText : formatYl100ToSpotText(ylLive, g));
    var ddLive = ls.downDistanceText || (liveDrv ? liveDrv.downDistanceText : ("Ball at " + possTxtLive));
    var distLive = 10;
    if (ddLive) {
      var dm = ddLive.match(/&\s*(\d+)/i);
      if (dm) distLive = parseInt(dm[1], 10);
      else if (/goal/i.test(ddLive)) distLive = possSideLive === "away" ? (100 - ylLive) : ylLive;
    }
    return {
      bannerType: "live",
      activeMode: "live",
      sitText: ddLive + (possTxtLive && ddLive.indexOf(possTxtLive) === -1 ? " at " + possTxtLive : ""),
      possessionSide: possSideLive,
      possessionText: possTxtLive,
      downDistanceText: ddLive,
      startYl100: startYlLive,
      yl100: ylLive,
      distYards: distLive || 10,
      isRedZone: !!ls.isRedZone,
      driveResult: "Live Drive",
      driveDesc: liveDrv ? (liveDrv.description + " • TOP: " + liveDrv.timeElapsed) : "Live ESPN Telemetry",
      clockStr: ls.detail || "LIVE",
      plays: (liveDrv && liveDrv.lastPlays && liveDrv.lastPlays.length) ? liveDrv.lastPlays : (ls.lastPlayText ? [{ clock: ls.detail || "", header: "Last Play: ", text: ls.lastPlayText, isScore: /touchdown|field goal good/i.test(ls.lastPlayText), isTurnover: /intercept|fumble/i.test(ls.lastPlayText) }] : [])
    };
  }

  // Priority 3: Completed / Final Game (Uses REAL ESPN Drive Telemetry from SUMMARY_PBP_CACHE!)
  if (isCompleted) {
    var modeChoice = customMode || "final";
    var chosenDrv = null;
    if (pbpCache) {
      if (modeChoice === "scoring" && pbpCache.lastScoringDrive) {
        chosenDrv = pbpCache.lastScoringDrive;
      } else if (modeChoice && modeChoice.indexOf("drive_") === 0 && pbpCache.allDrives) {
        var dIdx = parseInt(modeChoice.replace("drive_", ""), 10) - 1;
        chosenDrv = pbpCache.allDrives[dIdx] || pbpCache.finalDrive;
      } else {
        chosenDrv = pbpCache.finalDrive;
      }
    }

    if (chosenDrv) {
      var modeTitle = (modeChoice === "scoring") ? "Last scoring drive" : ("Final drive (" + chosenDrv.result.toUpperCase() + ")");
      var sitSummary = modeTitle + ": " + chosenDrv.teamName + " — " + chosenDrv.description + " → Ended at " + chosenDrv.endSpotText;
      return {
        bannerType: "final",
        activeMode: modeChoice,
        sitText: sitSummary,
        possessionSide: chosenDrv.possessionSide,
        possessionText: chosenDrv.endSpotText,
        downDistanceText: chosenDrv.downDistanceText || chosenDrv.result,
        startYl100: chosenDrv.startYl100,
        yl100: chosenDrv.yl100,
        distYards: chosenDrv.distYards || 10,
        isRedZone: chosenDrv.isRedZone,
        driveResult: chosenDrv.result,
        driveDesc: chosenDrv.description + " (Start: " + chosenDrv.startSpotText + " → End: " + chosenDrv.endSpotText + ") • TOP: " + chosenDrv.timeElapsed,
        clockStr: chosenDrv.clockStr || "FINAL",
        plays: chosenDrv.lastPlays || []
      };
    }

    // While ESPN Summary is still loading in background, trigger fetch & show accurate Final Score status (no fake 25-yard line!)
    if (ls && ls.eventId && !SUMMARY_PBP_CACHE[g.id]) loadGameDrives(g.id);
    var winTeam = (ls.awayScore > ls.homeScore) ? g.away : g.home;
    var winSide = (ls.awayScore > ls.homeScore) ? "away" : "home";
    return {
      bannerType: "final",
      activeMode: "final",
      sitText: "FINAL: " + g.away + " " + ls.awayScore + " — " + g.home + " " + ls.homeScore + " (" + winTeam + " Win • Click to view Drive Telemetry)",
      possessionSide: winSide,
      possessionText: "Midfield",
      downDistanceText: "Final",
      startYl100: 50,
      yl100: 50,
      distYards: 10,
      isRedZone: false,
      driveResult: "Final",
      driveDesc: "Loading ESPN Play-by-Play Drive Archive...",
      clockStr: "FINAL",
      plays: []
    };
  }

  return null;
}

// Demo controls for the field (the field itself is drawn by render/field.js).
function demoSimControlsHtml(g) {
  var b = function(action, label, primary) {
    return '<button type="button" class="demo-sim-btn' + (primary ? ' primary' : '') + '" onclick="simulateNextDemoPlay(' + g.id + ', \'' + action + '\', event)">' + label + '</button>';
  };
  return '<div class="demo-sim-controls">' +
    '<span class="demo-sim-label">Demo sim</span>' +
    '<div class="demo-btn-group">' +
      b("next", "Simulate next play", true) +
      '<button type="button" class="demo-sim-btn" onclick="toggleDemoAutoLoop(' + g.id + ', event)">' + (DEMO_AUTO_TIMER ? 'Stop auto-sim' : 'Auto-sim') + '</button>' +
      b("redzone", "Jump to red zone") +
      b("bigplay", "Trigger TD play") +
      b("reset", "Flip possession") +
    '</div>' +
  '</div>';
}

// ---------- "Simulate live alerts" (Live header) ----------
// Puts three sample games on screen so the red zone / 4Q sweat outlines can be checked any day:
//   1. red zone (1st & Goal at the 6, Q2 4:12)
//   2. 4Q sweat (Q4 2:18, 24-21, your pick ahead by 3)
//   3. red zone + 4Q crunch time (Q4 0:48, 27-24, the trailing 2x/3x underdog at the 11)
// This device only: the real scores are kept aside and put back when it's turned off, nothing
// demo is ever published (canWriteSharedPoolState) or reloaded from storage (initState).
var LIVE_ALERT_DEMO = null;

function liveAlertDemoGames() {
  var g1 = GAMES[0], g2 = GAMES[1];
  var g3 = null;
  for (var i = 2; i < GAMES.length && !g3; i++) {
    if (underdogForGame(GAMES[i]) && Math.max(GAMES[i].awayPts || 1, GAMES[i].homePts || 1) >= 2) g3 = GAMES[i];
  }
  return [g1, g2, g3 || GAMES[2]].filter(Boolean);
}

function buildLiveAlertDemoEntries() {
  var picks = getMyPicksMap();
  var games = liveAlertDemoGames();
  var out = {};
  var base = function(g, extra) {
    return Object.assign({
      _demo: true, matchupKey: gameMatchupKey(g), eventId: "demo-" + g.id, inProgress: true, completed: false,
      awayAbbr: g.awayCode, homeAbbr: g.homeCode, possessionText: "", lastPlayText: ""
    }, extra);
  };
  if (games[0]) {
    var g = games[0];
    out[g.id] = base(g, { awayScore: 7, homeScore: 10, period: 2, detail: "4:12 - 2nd", possessionSide: "away",
      yardLine100: 94, yardLine: 6, isRedZone: true, downDistanceText: "1st & Goal at " + g.homeCode + " 6" });
  }
  if (games[1]) {
    var g2 = games[1];
    var mine = getResolvedPickForGame(picks, g2, false);
    var awayMine = !mine || isSameTeamPick(mine, g2.away, g2);
    out[g2.id] = base(g2, { awayScore: awayMine ? 24 : 21, homeScore: awayMine ? 21 : 24, period: 4, detail: "2:18 - 4th",
      possessionSide: awayMine ? "home" : "away", yardLine100: 45, yardLine: 45, isRedZone: false, downDistanceText: "2nd & 6" });
  }
  if (games[2]) {
    var g3 = games[2];
    var dog = underdogForGame(g3) || g3.away;
    var dogAway = isSameTeamPick(dog, g3.away, g3);
    // The underdog trails 24-27 and has the ball at the favorite's 11.
    out[g3.id] = base(g3, { awayScore: dogAway ? 24 : 27, homeScore: dogAway ? 27 : 24, period: 4, detail: "0:48 - 4th",
      possessionSide: dogAway ? "away" : "home", yardLine100: dogAway ? 89 : 11, yardLine: 11, isRedZone: true,
      downDistanceText: "2nd & 4 at " + (dogAway ? g3.homeCode : g3.awayCode) + " 11" });
  }
  return out;
}

function applyLiveAlertDemo() {
  if (!LIVE_ALERT_DEMO) return;
  var entries = LIVE_ALERT_DEMO.entries;
  for (var id in entries) LIVE_SCORES[id] = entries[id];
}

function toggleLiveAlertDemo() {
  if (LIVE_ALERT_DEMO) {
    var saved = LIVE_ALERT_DEMO.saved;
    for (var id in LIVE_ALERT_DEMO.entries) {
      if (saved[id]) LIVE_SCORES[id] = saved[id];
      else delete LIVE_SCORES[id];
    }
    LIVE_ALERT_DEMO = null;
    regradeAllPoolMembersLive();
    showAppToast("Live alert demo off. Real scores are back.");
  } else {
    var entries = buildLiveAlertDemoEntries();
    var keep = {};
    for (var k in entries) keep[k] = LIVE_SCORES[k] || null;
    LIVE_ALERT_DEMO = { entries: entries, saved: keep };
    applyLiveAlertDemo();
    showAppToast("Showing sample red zone and 4Q sweat games on this device.");
  }
  var btn = document.getElementById("btn-simulate-alerts");
  if (btn) {
    btn.setAttribute("aria-pressed", LIVE_ALERT_DEMO ? "true" : "false");
    btn.textContent = LIVE_ALERT_DEMO ? "Stop alert demo" : "Simulate live alerts";
  }
  renderAll();
}

