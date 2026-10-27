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
          text: (startAway ? g.away : g.home) + " tempo offense at the line — click '▶ Simulate Next Play' to animate the next snap!",
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
  if (mode !== "demo" && ls && ls.eventId && !SUMMARY_PBP_CACHE[gameId]) {
    fetchGameDriveSummary(gameId, ls.eventId).then(function() {
      renderAll();
      if (ACTIVE_THEATER_GAME_ID === gameId) renderFieldTheaterModalContent(gameId);
    });
  }
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
      text: "🚨 RED ZONE ALERT: " + offTeam + " snaps inside the " + defTeam + " 14-yard line!",
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
    playDesc = "🔥 TOUCHDOWN " + offTeam.toUpperCase() + "! Explosive " + gain + "-yard strike into the endzone!";
  } else {
    var roll = ((sim.playsCount * 7 + gameId * 3) % 10);
    var playTemplates = [
      { yds: 8, desc: offTeam + " quick slant completed across the hash for 8 yards." },
      { yds: 15, desc: "⚡ " + offTeam + " RPO seam pass hits stride in space for 15 yards!" },
      { yds: 5, desc: offTeam + " inside zone rush behind left guard picks up 5 tough yards." },
      { yds: -2, desc: defTeam + " edge blitz knifes through for a 2-yard tackle for loss!" },
      { yds: 19, desc: "🔥 " + offTeam + " deep comeback route on the sideline hauls in 19 yards!" },
      { yds: 4, desc: offTeam + " QB keeper scrambles out of bounds for a 4-yard gain." },
      { yds: 11, desc: offTeam + " screen pass in the flat follows blocks for 11 yards and a 1st Down!" },
      { yds: 6, desc: offTeam + " counter trey run off right tackle grinds out 6 yards." },
      { yds: 24, desc: "💣 " + offTeam + " slot fade down the seam connects for a 24-yard chunk play!" },
      { yds: 3, desc: offTeam + " power dive up the middle moves the pile 3 yards." }
    ];
    var chosen = playTemplates[roll];
    gain = Math.min(yardsToGoal, chosen.yds);
    if (gain >= yardsToGoal) {
      isScore = true;
      playDesc = "🔥 TOUCHDOWN " + offTeam.toUpperCase() + "! " + offTeam + " punches it in from " + gain + " yards out!";
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
        playDesc += " 🚨 TURNOVER ON DOWNS! " + defTeam + " takes over!";
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
  if (EXPANDED_FIELD_TRACKERS[gameId] && ls && ls.eventId && !SUMMARY_PBP_CACHE[gameId]) {
    fetchGameDriveSummary(gameId, ls.eventId).then(function() {
      renderAll();
    });
  }
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
      sitText: "🎮 LIVE DEMO SIM: " + ddStr,
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
      var modeTitle = (modeChoice === "scoring") ? "🔥 LAST SCORING DRIVE" : ("🏁 FINAL DRIVE (" + chosenDrv.result.toUpperCase() + ")");
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
    if (ls && ls.eventId && !SUMMARY_PBP_CACHE[g.id] && !LIVE_SCORES[g.id]._fetchingSummary) {
      LIVE_SCORES[g.id]._fetchingSummary = true;
      fetchGameDriveSummary(g.id, ls.eventId).then(function() {
        renderAll();
        if (ACTIVE_THEATER_GAME_ID === g.id) renderFieldTheaterModalContent(g.id);
      });
    }
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

function buildFieldSvgMarkup(g, tel, svgHeight, isTheater) {
  // High-contrast, large-typography SVG Field (viewBox 0 0 740 195)
  // Endzones: 0..65 (Away) and 675..740 (Home). Playing field: 65..675 (610px = 6.1px per yard)
  var startYl = Math.max(0, Math.min(100, typeof tel.startYl100 === "number" ? tel.startYl100 : tel.yl100));
  var curYl = Math.max(0, Math.min(100, typeof tel.yl100 === "number" ? tel.yl100 : 50));
  var startX = +(65 + startYl * 6.1).toFixed(1);
  var ballX = +(65 + curYl * 6.1).toFixed(1);
  var isAway = tel.possessionSide === "away";
  var dirArrow = isAway ? "▶" : "◀";

  var distYards = tel.distYards || 10;
  var firstDownX = isAway
    ? Math.min(675, +(ballX + distYards * 6.1).toFixed(1))
    : Math.max(65, +(ballX - distYards * 6.1).toFixed(1));

  var calloutX = Math.max(135, Math.min(605, ballX));
  var losPillX = Math.max(88, Math.min(652, ballX));
  var fdPillX = Math.max(92, Math.min(648, firstDownX));

  // Track previous coordinates per game so elements smoothly glide at 60fps from old spot -> new spot across innerHTML renders!
  var prevSnapYlHint = typeof tel.prevYl100 === "number" ? tel.prevYl100 : curYl;
  var prevSnapXHint = +(65 + Math.max(0, Math.min(100, prevSnapYlHint)) * 6.1).toFixed(1);
  var mem = FIELD_ANIM_MEMORY[g.id];
  if (!mem) {
    mem = {
      fromBallX: prevSnapXHint,
      fromFdX: firstDownX,
      fromStartX: startX,
      fromCalloutX: Math.max(135, Math.min(605, prevSnapXHint)),
      fromLosPillX: Math.max(88, Math.min(652, prevSnapXHint)),
      fromFdPillX: fdPillX,
      targetBallX: ballX,
      targetFdX: firstDownX,
      targetStartX: startX,
      targetCalloutX: calloutX,
      targetLosPillX: losPillX,
      targetFdPillX: fdPillX,
      prevPlayBallX: prevSnapXHint,
      currentRenderBallX: prevSnapXHint,
      animStartTime: performance.now(),
      animDuration: 750
    };
    FIELD_ANIM_MEMORY[g.id] = mem;
  } else if (Math.abs(mem.targetBallX - ballX) > 0.2 || Math.abs(mem.targetFdX - firstDownX) > 0.2) {
    var startFromBall = typeof mem.currentRenderBallX === "number" ? mem.currentRenderBallX : mem.targetBallX;
    var startFromFd = typeof mem.currentRenderFdX === "number" ? mem.currentRenderFdX : mem.targetFdX;
    mem.prevPlayBallX = mem.targetBallX;
    mem.fromBallX = startFromBall;
    mem.fromFdX = startFromFd;
    mem.fromStartX = mem.targetStartX;
    mem.fromCalloutX = typeof mem.currentRenderCalloutX === "number" ? mem.currentRenderCalloutX : Math.max(135, Math.min(605, startFromBall));
    mem.fromLosPillX = typeof mem.currentRenderLosPillX === "number" ? mem.currentRenderLosPillX : Math.max(88, Math.min(652, startFromBall));
    mem.fromFdPillX = typeof mem.currentRenderFdPillX === "number" ? mem.currentRenderFdPillX : Math.max(92, Math.min(648, startFromFd));
    mem.targetBallX = ballX;
    mem.targetFdX = firstDownX;
    mem.targetStartX = startX;
    mem.targetCalloutX = calloutX;
    mem.targetLosPillX = losPillX;
    mem.targetFdPillX = fdPillX;
    mem.animStartTime = performance.now();
    mem.animDuration = 750;
  }

  var initBallX = mem.fromBallX;
  var initFdX = mem.fromFdX;
  var initCalloutX = mem.fromCalloutX;
  var initLosPillX = mem.fromLosPillX;
  var initFdPillX = mem.fromFdPillX;

  // Yard lines & large readable numbers
  var yardLinesSvg = "";
  for (var yd = 10; yd <= 90; yd += 10) {
    var xPos = +(65 + yd * 6.1).toFixed(1);
    var labelNum = yd <= 50 ? yd : (100 - yd);
    var isMid = (yd === 50);
    yardLinesSvg +=
      '<line x1="' + xPos + '" y1="0" x2="' + xPos + '" y2="195" stroke="' + (isMid ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.32)') + '" stroke-width="' + (isMid ? '2.8' : '1.4') + '" />' +
      '<text x="' + xPos + '" y="26" fill="rgba(255,255,255,0.88)" font-size="14" font-weight="900" font-family="sans-serif" text-anchor="middle">' + labelNum + '</text>' +
      '<text x="' + xPos + '" y="184" fill="rgba(255,255,255,0.88)" font-size="14" font-weight="900" font-family="sans-serif" text-anchor="middle">' + labelNum + '</text>';
  }
  // 5-yard tick lines & hash marks
  for (var yd5 = 5; yd5 <= 95; yd5 += 5) {
    var hx = +(65 + yd5 * 6.1).toFixed(1);
    if (yd5 % 10 !== 0) {
      yardLinesSvg += '<line x1="' + hx + '" y1="0" x2="' + hx + '" y2="195" stroke="rgba(255,255,255,0.13)" stroke-width="1" />';
    }
    yardLinesSvg +=
      '<line x1="' + (hx - 2) + '" y1="68" x2="' + (hx + 2) + '" y2="68" stroke="rgba(255,255,255,0.35)" stroke-width="1.3" />' +
      '<line x1="' + (hx - 2) + '" y1="127" x2="' + (hx + 2) + '" y2="127" stroke="rgba(255,255,255,0.35)" stroke-width="1.3" />';
  }

  // Drive Progress Bar (smoothly animates width & x from initBallX -> ballX)
  var initDrvMinX = Math.min(startX, initBallX);
  var initDrvWidth = Math.max(4, Math.abs(initBallX - startX));
  var targetDrvMinX = Math.min(startX, ballX);
  var targetDrvWidth = Math.max(4, Math.abs(ballX - startX));
  var drvColor = isAway ? "rgba(56, 189, 248, 0.28)" : "rgba(192, 132, 252, 0.28)";
  var drvStroke = isAway ? "#38bdf8" : "#c084fc";
  var driveBarSvg = "";
  if (Math.abs(curYl - startYl) >= 1 || Math.abs(initBallX - startX) >= 4) {
    driveBarSvg =
      '<rect class="field-glide-rect" data-game-id="' + g.id + '" x="' + initDrvMinX + '" y="82" width="' + initDrvWidth + '" height="31" rx="4" data-from-x="' + initDrvMinX + '" data-target-x="' + targetDrvMinX + '" data-from-w="' + initDrvWidth + '" data-target-w="' + targetDrvWidth + '" fill="' + drvColor + '" stroke="' + drvStroke + '" stroke-width="1.5" stroke-dasharray="4,2" />' +
      '<circle cx="' + startX + '" cy="97.5" r="4.5" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5" />' +
      '<text x="' + Math.max(92, Math.min(648, startX)) + '" y="148" fill="#cbd5e1" font-size="10.5" font-weight="800" text-anchor="middle">START (' + formatYl100ToSpotText(startYl, g) + ')</text>';
  }

  // Last Play Arc / Gain Trail (shows the exact trajectory of the play that just happened!)
  var playArcSvg = "";
  var prevSnapYl = typeof tel.prevYl100 === "number" ? tel.prevYl100 : null;
  var prevSnapX = prevSnapYl !== null ? +(65 + prevSnapYl * 6.1).toFixed(1) : mem.prevPlayBallX;
  if (typeof prevSnapX === "number" && Math.abs(ballX - prevSnapX) >= 3 && Math.abs(ballX - prevSnapX) <= 450) {
    var midArcX = +((prevSnapX + ballX) / 2).toFixed(1);
    var gainYdsVal = Math.round((isAway ? (ballX - prevSnapX) : (prevSnapX - ballX)) / 6.1);
    var arcColor = gainYdsVal >= 0 ? "#34d399" : "#f87171";
    var gainTxt = (gainYdsVal > 0 ? "+" + gainYdsVal : gainYdsVal) + " YDS";
    playArcSvg =
      '<path class="play-gain-arc" data-game-id="' + g.id + '" d="M ' + prevSnapX + ' 97.5 Q ' + midArcX + ' 60 ' + ballX + ' 97.5" fill="none" stroke="' + arcColor + '" stroke-width="3" />' +
      '<circle cx="' + prevSnapX + '" cy="97.5" r="3.5" fill="' + arcColor + '" opacity="0.85" />' +
      '<rect x="' + (midArcX - 26) + '" y="62" width="52" height="15" rx="4" fill="rgba(9,13,22,0.9)" stroke="' + arcColor + '" stroke-width="1" />' +
      '<text x="' + midArcX + '" y="73" fill="' + arcColor + '" font-size="9.5" font-weight="900" text-anchor="middle">' + gainTxt + '</text>';
  }

  var ballLabel = dirArrow + " " + (tel.possessionSide === "away" ? g.awayCode : g.homeCode).toUpperCase() + " BALL • " + (tel.possessionText || formatYl100ToSpotText(curYl, g));

  scheduleFieldGlideAnimations();

  return '<svg viewBox="0 0 740 195" width="100%" height="' + (svgHeight || 168) + '" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#14532d;cursor:pointer;" onclick="' + (isTheater ? '' : ('openFieldTheaterModal(' + g.id + ', event)')) + '">' +
    '<!-- Alternating 10-yard turf stripes -->' +
    '<rect x="65" y="0" width="61" height="195" fill="rgba(0,0,0,0.08)" />' +
    '<rect x="187" y="0" width="61" height="195" fill="rgba(0,0,0,0.08)" />' +
    '<rect x="309" y="0" width="61" height="195" fill="rgba(0,0,0,0.08)" />' +
    '<rect x="431" y="0" width="61" height="195" fill="rgba(0,0,0,0.08)" />' +
    '<rect x="553" y="0" width="61" height="195" fill="rgba(0,0,0,0.08)" />' +
    '<!-- Away Endzone (Left) -->' +
    '<rect x="0" y="0" width="65" height="195" fill="#0f172a" />' +
    '<text x="32" y="97.5" fill="#38bdf8" font-size="16" font-weight="900" letter-spacing="1.5" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 32 97.5)">' + g.awayCode.toUpperCase() + '</text>' +
    '<!-- Home Endzone (Right) -->' +
    '<rect x="675" y="0" width="65" height="195" fill="#1e1b4b" />' +
    '<text x="708" y="97.5" fill="#c084fc" font-size="16" font-weight="900" letter-spacing="1.5" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 708 97.5)">' + g.homeCode.toUpperCase() + '</text>' +
    '<!-- Red-Zone Shading (20 yards each side = 122px) -->' +
    '<rect x="65" y="0" width="122" height="195" fill="rgba(239,68,68,0.13)" />' +
    '<rect x="553" y="0" width="122" height="195" fill="rgba(239,68,68,0.13)" />' +
    '<line x1="65" y1="0" x2="65" y2="195" stroke="#ffffff" stroke-width="3" />' +
    '<line x1="675" y1="0" x2="675" y2="195" stroke="#ffffff" stroke-width="3" />' +
    yardLinesSvg +
    driveBarSvg +
    playArcSvg +
    '<!-- Blue Line of Scrimmage (LOS) + Top Pill -->' +
    '<g class="field-glide-node" data-role="los" data-game-id="' + g.id + '" transform="translate(' + initBallX + ', 0)" data-from-x="' + initBallX + '" data-target-x="' + ballX + '">' +
      '<line class="los-line" x1="0" y1="0" x2="0" y2="195" stroke="#38bdf8" stroke-width="3" stroke-dasharray="5,3" />' +
    '</g>' +
    '<g class="field-glide-node" data-role="lospill" data-game-id="' + g.id + '" transform="translate(' + initLosPillX + ', 0)" data-from-x="' + initLosPillX + '" data-target-x="' + losPillX + '">' +
      '<rect x="-22" y="3" width="44" height="16" rx="4" fill="#0284c7" stroke="#e0f2fe" stroke-width="1" />' +
      '<text x="0" y="14" fill="#ffffff" font-size="10" font-weight="900" text-anchor="middle">LOS</text>' +
    '</g>' +
    '<!-- Yellow 1st-Down Marker Line + Bottom Pill -->' +
    '<g class="field-glide-node" data-role="fd" data-game-id="' + g.id + '" transform="translate(' + initFdX + ', 0)" data-from-x="' + initFdX + '" data-target-x="' + firstDownX + '">' +
      '<line class="first-down-line" x1="0" y1="0" x2="0" y2="195" stroke="#facc15" stroke-width="3.2" />' +
    '</g>' +
    '<g class="field-glide-node" data-role="fdpill" data-game-id="' + g.id + '" transform="translate(' + initFdPillX + ', 0)" data-from-x="' + initFdPillX + '" data-target-x="' + fdPillX + '">' +
      '<rect x="-28" y="176" width="56" height="16" rx="4" fill="#facc15" stroke="#000" stroke-width="1" />' +
      '<text x="0" y="187.5" fill="#000000" font-size="10" font-weight="900" text-anchor="middle">1ST DN</text>' +
    '</g>' +
    '<!-- Floating Spot Callout Pill -->' +
    '<g class="field-glide-node" data-role="callout" data-game-id="' + g.id + '" transform="translate(' + initCalloutX + ', 0)" data-from-x="' + initCalloutX + '" data-target-x="' + calloutX + '">' +
      '<rect x="-82" y="32" width="164" height="22" rx="6" fill="rgba(9,13,22,0.94)" stroke="#facc15" stroke-width="1.4" />' +
      '<text x="0" y="47" fill="#fef08a" font-size="11.5" font-weight="900" text-anchor="middle">' + ballLabel + '</text>' +
    '</g>' +
    '<!-- Gliding Football Marker -->' +
    '<g class="field-glide-node" data-game-id="' + g.id + '" data-is-ball="1" transform="translate(' + initBallX + ', 0)" data-from-x="' + initBallX + '" data-target-x="' + ballX + '">' +
      '<ellipse class="football-marker" cx="0" cy="97.5" rx="14" ry="9" fill="#78350f" stroke="#fef08a" stroke-width="2.2" />' +
      '<line x1="-5" y1="97.5" x2="5" y2="97.5" stroke="#ffffff" stroke-width="1.5" />' +
      '<line x1="-2.5" y1="94.5" x2="-2.5" y2="100.5" stroke="#ffffff" stroke-width="1.2" />' +
      '<line x1="2.5" y1="94.5" x2="2.5" y2="100.5" stroke="#ffffff" stroke-width="1.2" />' +
    '</g>' +
  '</svg>';
}

function buildPlaysListHtml(tel, g, ls) {
  var plays = tel.plays || [];
  if (plays.length === 0) {
    return '<div class="pbp-item" style="color:var(--muted);">' +
      '⏳ Loading official ESPN play-by-play drive log... <a href="javascript:void(0)" style="color:var(--accent);font-weight:800;" onclick="fetchGameDriveSummary(' + g.id + ', \'' + ((ls && ls.eventId) || '') + '\').then(renderAll)">Tap to Refresh Now</a>' +
    '</div>';
  }
  var html = "";
  for (var i = 0; i < plays.length; i++) {
    var pl = plays[i];
    var scoreBadge = pl.isScore
      ? '<span class="pbp-badge-score">🔥 SCORING PLAY</span>'
      : (pl.isTurnover ? '<span class="pbp-badge-turnover">🚨 TURNOVER</span>' : '');
    var clkBadge = pl.clock
      ? '<span style="background:#1e293b;color:#93c5fd;font-size:0.66rem;font-weight:800;padding:1px 6px;border-radius:4px;margin-right:6px;">' + pl.clock + '</span>'
      : '';
    var ydsBadge = (typeof pl.statYardage === "number" && pl.statYardage !== 0)
      ? '<span style="background:' + (pl.statYardage > 0 ? 'rgba(16,185,129,0.18);color:#6ee7b7;' : 'rgba(239,68,68,0.18);color:#fca5a5;') + 'font-size:0.66rem;font-weight:800;padding:1px 6px;border-radius:4px;margin-right:6px;">' + (pl.statYardage > 0 ? '+' + pl.statYardage : pl.statYardage) + ' YDS</span>'
      : '';
    html += '<div class="pbp-item">' + clkBadge + scoreBadge + ydsBadge + '<strong>' + (pl.header || '') + '</strong>' + pl.text + '</div>';
  }
  return html;
}

function renderInteractiveFieldTrackerHtml(g, ls) {
  var tel = resolveDriveTelemetryForGame(g, ls);
  if (!tel) return "";

  var isOpen = (EXPANDED_FIELD_TRACKERS[g.id] === true);
  var barClass = "drive-situation-bar";
  if (tel.isRedZone && tel.bannerType !== "final") barClass += " redzone-active";

  var badgeHtml = "";
  if (tel.bannerType === "demo") {
    badgeHtml = '<span class="pbp-badge-demo">🎮 DEMO SIMULATOR</span>';
  } else if (tel.bannerType === "final") {
    badgeHtml = '<span class="pbp-badge-final">' + (tel.activeMode === "scoring" ? "🔥 SCORING DRIVE" : "🏁 FINAL DRIVE") + '</span>';
  } else if (tel.isRedZone) {
    badgeHtml = '<span class="rz-pill">🚨 RED ZONE</span>';
  }

  var toggleLabel = isOpen
    ? "▲ Hide Field"
    : (tel.bannerType === "final" ? "🏁 View Field & Plays ▼" : (tel.bannerType === "demo" ? "🎮 Open Demo Field ▼" : "🏈 Live Field ▼"));

  var barHtml =
    '<div class="' + barClass + '" onclick="toggleFieldTrackerAccordion(' + g.id + ', event)" title="Click to toggle Interactive SVG Field Tracker & Play-by-Play">' +
      '<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:0.75rem;">' +
        '📍 <strong>' + tel.sitText + '</strong>' +
      '</span>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        badgeHtml +
        '<button class="btn-sm" style="padding:2px 7px;font-size:0.66rem;background:#1e1b4b;border-color:#38bdf8;color:#7dd3fc;" onclick="openFieldTheaterModal(' + g.id + ', event)" title="Open Big-Screen GameCast Theater">🔍 Big View ⛶</button>' +
        '<span style="font-size:0.68rem;color:var(--gold);font-weight:800;">' + toggleLabel + '</span>' +
      '</div>' +
    '</div>';

  if (!isOpen) return barHtml;

  var pbpCache = SUMMARY_PBP_CACHE[g.id];
  var hasScoringDiff = pbpCache && pbpCache.lastScoringDrive && pbpCache.finalDrive && (pbpCache.lastScoringDrive.driveIndex !== pbpCache.finalDrive.driveIndex);

  var modeBtnsHtml = '<div class="field-mode-pills">';
  if (ls && ls.inProgress) {
    modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "live" ? "active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'live\', event)">🔴 Live Drive</button>';
  }
  if (ls && ls.completed) {
    modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "final" ? "active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'final\', event)">🏁 Final Drive</button>';
    modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "scoring" ? "active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'scoring\', event)">🔥 Last Scoring Drive' + (hasScoringDiff ? ' ★' : '') + '</button>';
  }
  modeBtnsHtml += '<button class="field-mode-btn ' + (tel.activeMode === "demo" ? "demo-active" : "") + '" onclick="setGameDriveViewMode(' + g.id + ', \'demo\', event)">🎮 Test Demo Sim</button>';
  modeBtnsHtml += '</div>';

  var demoControlsHtml = "";
  if (tel.bannerType === "demo") {
    demoControlsHtml =
      '<div class="demo-sim-controls">' +
        '<span style="font-size:0.73rem;font-weight:800;color:#6ee7b7;">🎮 Interactive Live Drive Simulator:</span>' +
        '<div class="demo-btn-group" style="display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button class="demo-sim-btn primary" onclick="simulateNextDemoPlay(' + g.id + ', \'next\', event)">▶ Simulate Next Play</button>' +
          '<button class="demo-sim-btn" onclick="toggleDemoAutoLoop(' + g.id + ', event)">' + (DEMO_AUTO_TIMER ? '⏸ Stop Auto-Sim' : '⚡ Auto-Sim (2.4s)') + '</button>' +
          '<button class="demo-sim-btn" onclick="simulateNextDemoPlay(' + g.id + ', \'redzone\', event)">🚨 Red Zone</button>' +
          '<button class="demo-sim-btn" onclick="simulateNextDemoPlay(' + g.id + ', \'bigplay\', event)">💣 TD Play</button>' +
          '<button class="demo-sim-btn" onclick="simulateNextDemoPlay(' + g.id + ', \'reset\', event)">🔄 Flip/Reset</button>' +
        '</div>' +
      '</div>';
  }

  var possessingTeamName = tel.possessionSide === "away" ? g.away : g.home;
  var possessingCode = tel.possessionSide === "away" ? g.awayCode : g.homeCode;

  var drawerHtml =
    '<div class="field-tracker-drawer">' +
      '<div class="field-toolbar-row">' +
        modeBtnsHtml +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:0.68rem;color:var(--muted);">Tap field for Big View ⛶</span>' +
          '<button type="button" class="field-mode-btn" style="border-color:var(--amber);color:var(--gold);" onclick="toggleFieldTrackerAccordion(' + g.id + ', event)">▲ Hide Field</button>' +
        '</div>' +
      '</div>' +
      demoControlsHtml +
      '<div class="field-svg-wrap" title="Click field to open Big-Screen Theater View">' +
        buildFieldSvgMarkup(g, tel, 172, false) +
      '</div>' +
      '<div class="drive-meta-strip" style="font-size:0.76rem;padding:7px 10px;">' +
        '<span>🏈 Possession: <strong style="color:#facc15;">' + possessingTeamName + ' (' + possessingCode + ')</strong> • Spot: <strong style="color:#38bdf8;">' + tel.possessionText + '</strong></span>' +
        '<span>' + tel.driveDesc + '</span>' +
      '</div>' +
      '<div class="pbp-timeline">' + buildPlaysListHtml(tel, g, ls) + '</div>' +
    '</div>';

  return barHtml + drawerHtml;
}

