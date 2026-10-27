var activeProfile = "michael";
var currentMainView = "cards";
var currentFilter = "all";
var liveTabFilter = "all";
var showShadowBadges = true;
var isMobileInit = (typeof window !== "undefined" && window.innerWidth <= 640);
var showAllIns = false;
var showAllL5 = false;
var showAllInj = false;
var livePollTimer = null;
var LIVE_SCORES = window.LIVE_SCORES || {};

// Replace your existing `var state = { ... };` block with:
var EXPANDED_FIELD_TRACKERS = {};
var SUMMARY_PBP_CACHE = {};
var DEMO_FIELD_PREVIEW = false;
var GAME_DRIVE_VIEW_MODE = {}; // per gameId: "final" | "scoring" | "demo" | "live" | "drive_N"
var DEMO_SIM_STATE = {};       // per gameId interactive play-by-play simulation state
var DEMO_AUTO_TIMER = null;
var ACTIVE_THEATER_GAME_ID = null;

var FIELD_ANIM_MEMORY = {};
var FIELD_GLIDE_RAF = null;

function scheduleFieldGlideAnimations() {
  if (FIELD_GLIDE_RAF) return;
  FIELD_GLIDE_RAF = requestAnimationFrame(stepFieldGlideAnimations);
}

function stepFieldGlideAnimations(nowTs) {
  FIELD_GLIDE_RAF = null;
  var anyActive = false;
  var now = typeof nowTs === "number" ? nowTs : performance.now();

  var nodes = document.querySelectorAll(".field-glide-node[data-from-x][data-target-x]");
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var gid = node.getAttribute("data-game-id");
    var mem = gid ? FIELD_ANIM_MEMORY[gid] : null;
    var fromX = parseFloat(node.getAttribute("data-from-x"));
    var targetX = parseFloat(node.getAttribute("data-target-x"));
    if (isNaN(fromX) || isNaN(targetX)) continue;

    var startTs = (mem && mem.animStartTime) ? mem.animStartTime : now;
    var dur = (mem && mem.animDuration) ? mem.animDuration : 750;
    var elapsed = Math.max(0, now - startTs);
    var t = Math.min(1, elapsed / dur);
    // Smooth cubic ease-out
    var ease = 1 - Math.pow(1 - t, 3);
    var curX = +(fromX + (targetX - fromX) * ease).toFixed(2);

    // Optional slight arc hop on the football itself while moving
    var isBall = node.getAttribute("data-is-ball") === "1";
    var hopY = (isBall && Math.abs(targetX - fromX) > 3 && t < 1)
      ? +(-Math.sin(t * Math.PI) * Math.min(14, Math.abs(targetX - fromX) * 0.12)).toFixed(2)
      : 0;

    node.setAttribute("transform", "translate(" + curX + ", " + hopY + ")");
    var role = node.getAttribute("data-role") || "";
    if (mem) {
      if (isBall) mem.currentRenderBallX = curX;
      else if (role === "fd") mem.currentRenderFdX = curX;
      else if (role === "callout") mem.currentRenderCalloutX = curX;
      else if (role === "lospill") mem.currentRenderLosPillX = curX;
      else if (role === "fdpill") mem.currentRenderFdPillX = curX;
    }
    if (t < 1) {
      if (Math.abs(targetX - fromX) > 0.1) anyActive = true;
    } else if (mem && isBall) {
      mem.fromBallX = mem.targetBallX;
      mem.fromFdX = mem.targetFdX;
      mem.fromStartX = mem.targetStartX;
      mem.fromCalloutX = mem.targetCalloutX;
      mem.fromLosPillX = mem.targetLosPillX;
      mem.fromFdPillX = mem.targetFdPillX;
      mem.currentRenderBallX = mem.targetBallX;
      mem.currentRenderFdX = mem.targetFdX;
      mem.currentRenderCalloutX = mem.targetCalloutX;
      mem.currentRenderLosPillX = mem.targetLosPillX;
      mem.currentRenderFdPillX = mem.targetFdPillX;
    }
  }

  var rects = document.querySelectorAll(".field-glide-rect[data-from-x][data-target-x]");
  for (var r = 0; r < rects.length; r++) {
    var rect = rects[r];
    var rgid = rect.getAttribute("data-game-id");
    var rmem = rgid ? FIELD_ANIM_MEMORY[rgid] : null;
    var rFromX = parseFloat(rect.getAttribute("data-from-x"));
    var rTargetX = parseFloat(rect.getAttribute("data-target-x"));
    var rFromW = parseFloat(rect.getAttribute("data-from-w"));
    var rTargetW = parseFloat(rect.getAttribute("data-target-w"));
    if (isNaN(rFromX) || isNaN(rTargetX)) continue;

    var rStart = (rmem && rmem.animStartTime) ? rmem.animStartTime : now;
    var rDur = (rmem && rmem.animDuration) ? rmem.animDuration : 750;
    var rt = Math.min(1, Math.max(0, now - rStart) / rDur);
    var rEase = 1 - Math.pow(1 - rt, 3);
    var curRx = +(rFromX + (rTargetX - rFromX) * rEase).toFixed(2);
    var curRw = +(rFromW + (rTargetW - rFromW) * rEase).toFixed(2);
    rect.setAttribute("x", curRx);
    rect.setAttribute("width", Math.max(4, curRw));
    if (rt < 1 && (Math.abs(rTargetX - rFromX) > 0.2 || Math.abs(rTargetW - rFromW) > 0.2)) {
      anyActive = true;
    }
  }

  var arcs = document.querySelectorAll(".play-gain-arc[data-game-id]");
  for (var a = 0; a < arcs.length; a++) {
    var arc = arcs[a];
    var agid = arc.getAttribute("data-game-id");
    var amem = agid ? FIELD_ANIM_MEMORY[agid] : null;
    var aStart = (amem && amem.animStartTime) ? amem.animStartTime : now;
    var aDur = (amem && amem.animDuration) ? amem.animDuration : 750;
    var at = Math.min(1, Math.max(0, now - aStart) / aDur);
    var aEase = 1 - Math.pow(1 - at, 3);
    var dashOffset = +(260 * (1 - aEase)).toFixed(1);
    arc.style.strokeDashoffset = String(dashOffset);
    if (at < 1) anyActive = true;
  }

  if (anyActive) {
    FIELD_GLIDE_RAF = requestAnimationFrame(stepFieldGlideAnimations);
  }
}

function toggleDemoFieldPreview() {
  DEMO_FIELD_PREVIEW = !DEMO_FIELD_PREVIEW;
  var btn = document.getElementById("btn-demo-field-toggle");
  if (btn) {
    btn.textContent = DEMO_FIELD_PREVIEW ? "🎮 Field Sim: ON" : "🏈 Field Sim: OFF";
    btn.style.background = DEMO_FIELD_PREVIEW ? "rgba(16,185,129,0.32)" : "rgba(56,189,248,0.2)";
    btn.style.borderColor = DEMO_FIELD_PREVIEW ? "#34d399" : "#38bdf8";
  }
  if (DEMO_FIELD_PREVIEW) {
    for (var i = 0; i < GAMES.length; i++) {
      var gid = GAMES[i].id;
      GAME_DRIVE_VIEW_MODE[gid] = "demo";
      delete EXPANDED_FIELD_TRACKERS[gid];
      ensureDemoSimState(GAMES[i]);
    }
  } else {
    if (DEMO_AUTO_TIMER) {
      clearInterval(DEMO_AUTO_TIMER);
      DEMO_AUTO_TIMER = null;
    }
    for (var j = 0; j < GAMES.length; j++) {
      var g2 = GAMES[j].id;
      if (GAME_DRIVE_VIEW_MODE[g2] === "demo") delete GAME_DRIVE_VIEW_MODE[g2];
      delete EXPANDED_FIELD_TRACKERS[g2];
    }
  }
  renderAll();
  if (ACTIVE_THEATER_GAME_ID) renderFieldTheaterModalContent(ACTIVE_THEATER_GAME_ID);
}


