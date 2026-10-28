// ============================================================================
// DESKTOP LAYOUT: the right rail (season summary) as an overlay panel opened
// from the page header; at 1280px+ it's pinned as a column by default. Layout only.
// ============================================================================
var RAIL_PIN_KEY = "sat_rail_pinned_v1";
var RAIL_PIN_MIN_WIDTH = 1280;

function railPinAllowed() { return window.innerWidth >= RAIL_PIN_MIN_WIDTH; }
function isRailPinned() { return safeGetStorage(RAIL_PIN_KEY) !== "0"; } // pinned unless you unpinned it

function syncRailPinnedClass() {
  var pinned = isRailPinned() && railPinAllowed();
  document.body.classList.toggle("rail-pinned", pinned);
  var pin = document.getElementById("rail-pin-btn");
  if (pin) {
    pin.setAttribute("aria-pressed", isRailPinned() ? "true" : "false");
    pin.disabled = !railPinAllowed();
    pin.title = railPinAllowed() ? (isRailPinned() ? "Unpin panel" : "Keep this panel open") : "Pinning needs a window at least 1280px wide";
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

// ============================================================================
// DESKTOP SIDEBAR: a 64px icon rail that opens over the content (the CSS animates only its
// clip, so nothing reflows). Hover intent: opens after 150ms, closes 300ms after the pointer
// leaves, re-entry cancels. Keyboard focus opens it, Esc closes it and returns focus. The pin
// keeps it open as a column. Only classes change here; renderAll never rebuilds these nodes.
// ============================================================================
var SIDEBAR_PIN_KEY = "sat_sidebar_pinned_v1";
var SIDEBAR_OPEN_DELAY_MS = 150;
var SIDEBAR_CLOSE_DELAY_MS = 300;
var _sidebarOpen = false;
var _sidebarTimer = null;
var _sidebarPointerInside = false;
var _sidebarHoverBlocked = false;   // after a nav click, until the pointer leaves
var _sidebarReturnFocus = null;     // where focus was before the keyboard entered the sidebar

function isSidebarPinned() { return safeGetStorage(SIDEBAR_PIN_KEY) !== "0"; } // pinned unless you unpinned it
function appSidebarEl() { return document.querySelector(".app-sidebar"); }

// Applies the current state as classes; safe to call on every render (no-op if nothing changed).
function syncSidebarState() {
  var el = appSidebarEl();
  if (!el) return;
  var pinned = isSidebarPinned();
  if (pinned) _sidebarOpen = false;
  document.body.classList.toggle("sidebar-pinned", pinned);
  el.classList.toggle("is-expanded", _sidebarOpen);
  var pin = document.getElementById("sidebar-pin-btn");
  if (pin) {
    var pressed = pinned ? "true" : "false";
    if (pin.getAttribute("aria-pressed") !== pressed) {
      pin.setAttribute("aria-pressed", pressed);
      pin.title = pinned ? "Let the menu collapse" : "Keep the menu open";
      var lbl = pin.querySelector("span");
      if (lbl) lbl.textContent = pinned ? "Unpin menu" : "Keep menu open";
    }
  }
  var more = document.getElementById("nav-rail-more");
  if (more) more.classList.toggle("active", typeof currentMainView !== "undefined" && currentMainView === "more");
}

function setSidebarExpanded(on) {
  clearTimeout(_sidebarTimer);
  on = !!on && !isSidebarPinned();
  if (on === _sidebarOpen) return;
  _sidebarOpen = on;
  syncSidebarState();
}

function scheduleSidebar(on, ms) {
  clearTimeout(_sidebarTimer);
  if (!!on === _sidebarOpen) return;
  _sidebarTimer = setTimeout(function() { setSidebarExpanded(on); }, ms);
}

function toggleSidebarPinned() {
  safeSetStorage(SIDEBAR_PIN_KEY, isSidebarPinned() ? "0" : "1");
  // Unpinning under the pointer leaves it open until the pointer leaves.
  _sidebarOpen = !isSidebarPinned() && _sidebarPointerInside;
  syncSidebarState();
}

(function wireSidebar() {
  var el = appSidebarEl();
  if (!el) return;
  // Transitions only after the first paint, so a pinned sidebar doesn't animate on load.
  requestAnimationFrame(function() { requestAnimationFrame(function() { el.classList.add("is-animated"); }); });

  el.addEventListener("pointerenter", function(e) {
    if (e.pointerType === "touch") return;
    _sidebarPointerInside = true;
    if (!_sidebarHoverBlocked) scheduleSidebar(true, SIDEBAR_OPEN_DELAY_MS);
    else clearTimeout(_sidebarTimer);
  });
  el.addEventListener("pointerleave", function(e) {
    if (e.pointerType === "touch") return;
    _sidebarPointerInside = false;
    _sidebarHoverBlocked = false;
    if (el.contains(document.activeElement) && document.activeElement.matches(":focus-visible")) return;
    scheduleSidebar(false, SIDEBAR_CLOSE_DELAY_MS);
  });

  // A nav click navigates, then the menu closes once and stays closed until the pointer leaves.
  el.addEventListener("click", function(e) {
    var btn = e.target.closest(".mode-tab-btn, .nav-item");
    if (!btn || btn.id === "sidebar-pin-btn" || isSidebarPinned()) return;
    _sidebarHoverBlocked = _sidebarPointerInside;
    setSidebarExpanded(false);
  });

  // Keyboard focus opens it (a mouse click doesn't; hover handles that).
  el.addEventListener("focusin", function(e) {
    if (e.relatedTarget && !el.contains(e.relatedTarget)) _sidebarReturnFocus = e.relatedTarget;
    var keyboard = false;
    try { keyboard = e.target.matches(":focus-visible"); } catch (err) {}
    if (keyboard && !_sidebarHoverBlocked) setSidebarExpanded(true);
  });
  el.addEventListener("focusout", function(e) {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    // No new target: a re-render removed the focused node, or the window lost focus.
    if (!e.relatedTarget && (_sidebarPointerInside || !document.hasFocus())) return;
    if (!_sidebarPointerInside) setSidebarExpanded(false);
  });
  document.addEventListener("keydown", function(e) {
    if (e.key !== "Escape" || !_sidebarOpen) return;
    var hadFocus = el.contains(document.activeElement);
    _sidebarHoverBlocked = _sidebarPointerInside;
    setSidebarExpanded(false);
    if (!hadFocus) return;
    var back = _sidebarReturnFocus && document.contains(_sidebarReturnFocus) ? _sidebarReturnFocus : document.getElementById("app-content");
    _sidebarReturnFocus = null;
    if (back) back.focus();
  });
})();

var _layoutPrevRenderAllSidebar = renderAll;
renderAll = function() {
  var res = _layoutPrevRenderAllSidebar.apply(this, arguments);
  syncSidebarState();
  return res;
};
syncSidebarState();
