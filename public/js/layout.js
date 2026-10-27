// ============================================================================
// DESKTOP LAYOUT: the right rail (season summary) as an overlay panel opened
// from the page header, pinnable as a column at 1600px+. Layout only.
// ============================================================================
var RAIL_PIN_KEY = "sat_rail_pinned_v1";
var RAIL_PIN_MIN_WIDTH = 1600;

function railPinAllowed() { return window.innerWidth >= RAIL_PIN_MIN_WIDTH; }
function isRailPinned() { return safeGetStorage(RAIL_PIN_KEY) === "1"; }

function syncRailPinnedClass() {
  var pinned = isRailPinned() && railPinAllowed();
  document.body.classList.toggle("rail-pinned", pinned);
  var pin = document.getElementById("rail-pin-btn");
  if (pin) {
    pin.setAttribute("aria-pressed", isRailPinned() ? "true" : "false");
    pin.disabled = !railPinAllowed();
    pin.title = railPinAllowed() ? (isRailPinned() ? "Unpin panel" : "Keep this panel open") : "Pinning needs a window at least 1600px wide";
  }
  if (pinned) closeRailPanel(true);
}

function openRailPanel() {
  var rail = document.getElementById("app-rail");
  if (!rail || document.body.classList.contains("rail-pinned")) return;
  rail.classList.add("is-open");
  var bd = document.getElementById("rail-backdrop");
  if (bd) bd.hidden = false;
  var btns = document.querySelectorAll(".rail-open-btn");
  for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-expanded", "true");
  var close = rail.querySelector(".rail-close-btn");
  if (close) close.focus();
}

function closeRailPanel(silent) {
  var rail = document.getElementById("app-rail");
  var wasOpen = rail && rail.classList.contains("is-open");
  if (rail) rail.classList.remove("is-open");
  var bd = document.getElementById("rail-backdrop");
  if (bd) bd.hidden = true;
  var btns = document.querySelectorAll(".rail-open-btn");
  for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-expanded", "false");
  if (wasOpen && !silent) {
    var vis = Array.prototype.filter.call(btns, function(b) { return b.offsetParent; });
    if (vis[0]) vis[0].focus();
  }
}

function toggleRailPinned() {
  if (!railPinAllowed()) return;
  safeSetStorage(RAIL_PIN_KEY, isRailPinned() ? "0" : "1");
  syncRailPinnedClass();
  if (!isRailPinned()) closeRailPanel(true);
}

// The old "Hide side panel" control now pins / unpins the rail.
toggleDesktopSidebarCollapse = toggleRailPinned;

// One "Season" button at the right end of each page header (desktop only).
function addRailButtonsToHeaders() {
  var heads = document.querySelectorAll(".page-head");
  for (var i = 0; i < heads.length; i++) {
    if (heads[i].querySelector(".rail-open-btn")) continue;
    heads[i].insertAdjacentHTML("beforeend",
      '<button type="button" class="icon-btn rail-open-btn" onclick="openRailPanel()" aria-controls="app-rail" aria-expanded="false" ' +
      'aria-label="Season summary" title="Season summary"><i data-lucide="panel-right"></i></button>');
  }
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    var rail = document.getElementById("app-rail");
    if (rail && rail.classList.contains("is-open")) closeRailPanel();
  }
});
window.addEventListener("resize", function() { syncRailPinnedClass(); });

var _layoutPrevRenderAll = renderAll;
renderAll = function() {
  var res = _layoutPrevRenderAll.apply(this, arguments);
  addRailButtonsToHeaders();
  return res;
};

addRailButtonsToHeaders();
syncRailPinnedClass();

