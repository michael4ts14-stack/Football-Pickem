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


