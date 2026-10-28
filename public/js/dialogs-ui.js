// ============================================================================
// DIALOGS: red confirm step for destructive actions, and a reusable panel sheet
// (used for Past weeks). The wrapped actions themselves are unchanged.
// ============================================================================
var _confirmDangerCallback = null;
var _confirmDangerReturnFocus = null;

function confirmDanger(message, confirmLabel, onConfirm) {
  var bd = document.getElementById("confirm-backdrop");
  if (!bd) { if (onConfirm) onConfirm(); return; }
  document.getElementById("confirm-message").textContent = message || "This can't be undone.";
  document.getElementById("confirm-ok").textContent = confirmLabel || "Confirm";
  _confirmDangerCallback = onConfirm || null;
  _confirmDangerReturnFocus = document.activeElement;
  bd.hidden = false;
  document.getElementById("confirm-cancel").focus();
}

function closeConfirmDanger(confirmed) {
  var bd = document.getElementById("confirm-backdrop");
  if (bd) bd.hidden = true;
  var cb = _confirmDangerCallback;
  _confirmDangerCallback = null;
  if (_confirmDangerReturnFocus && _confirmDangerReturnFocus.focus) _confirmDangerReturnFocus.focus();
  if (confirmed && cb) cb();
}

document.addEventListener("keydown", function(ev) {
  var bd = document.getElementById("confirm-backdrop");
  if (ev.key === "Escape" && bd && !bd.hidden) closeConfirmDanger(false);
  var ps = document.getElementById("panel-sheet-backdrop");
  if (ev.key === "Escape" && ps && !ps.hidden) closePanelSheet();
});

// Confirm only when a person starts these from a button; other code paths call them directly
// (e.g. publishing a new slate calls resetPoolPicksForNewWeek(false)).
var _dlgPrevNewWeekReset = resetPoolPicksForNewWeek;
resetPoolPicksForNewWeek = function(syncToCloud) {
  var self = this, args = arguments;
  if (syncToCloud !== true) return _dlgPrevNewWeekReset.apply(self, args);
  confirmDanger("Clear every other pool member's picks for the new week? The current week is archived first.", "Clear pool picks", function() {
    _dlgPrevNewWeekReset.apply(self, args);
  });
};

var _dlgPrevDeletePicks = commishDeletePlayerPicks;
commishDeletePlayerPicks = function(memberName) {
  var self = this, args = arguments;
  confirmDanger("Delete all of " + (memberName || "this player") + "'s picks for this week?", "Delete picks", function() {
    _dlgPrevDeletePicks.apply(self, args);
  });
};

var _dlgPrevRevokeRole = commishRevokeRole;
commishRevokeRole = function(key) {
  var self = this, args = arguments;
  confirmDanger("Revoke commissioner access for " + (key || "this account") + "?", "Revoke", function() {
    _dlgPrevRevokeRole.apply(self, args);
  });
};

// ---------- Panel sheet: shows an existing container, then puts it back ----------
var _panelSheetNode = null, _panelSheetHome = null, _panelSheetNext = null;

function openPanelSheet(title, nodeId) {
  var node = document.getElementById(nodeId);
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!node || !bd || !body) return;
  closePanelSheet();
  _panelSheetNode = node;
  _panelSheetHome = node.parentNode;
  _panelSheetNext = node.nextSibling;
  body.appendChild(node);
  document.getElementById("panel-sheet-title").textContent = title;
  bd.hidden = false;
}

function closePanelSheet() {
  var bd = document.getElementById("panel-sheet-backdrop");
  if (bd) bd.hidden = true;
  if (_panelSheetNode && _panelSheetHome) _panelSheetHome.insertBefore(_panelSheetNode, _panelSheetNext);
  _panelSheetNode = _panelSheetHome = _panelSheetNext = null;
}

// Past weeks (commissioner): the archive box opens as a sheet from anywhere, in both modes.
var _dlgPrevOpenMoreSection = openMoreSection;
openMoreSection = function(section) {
  if (section !== "weeks") return _dlgPrevOpenMoreSection.apply(this, arguments);
  closeSettingsDrawer();
  closeEvSimulatorDrawer();
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!bd || !body) return;
  closePanelSheet();
  body.innerHTML = '<div class="side-box" id="season-archive-hub-container"></div>';
  document.getElementById("panel-sheet-title").textContent = "Past weeks";
  bd.hidden = false;
  if (typeof renderSeasonArchiveHub === "function") renderSeasonArchiveHub();
};

// ---------- New account: which pool player are you? ----------
// Shown when a new account's name doesn't match a roster name, so the player links to their
// existing row instead of creating a duplicate. Resolves to the chosen name, or "" for a new player.
var _rosterChooserResolve = null;
var _rosterChooserPromise = null;

function unclaimedRosterNames() {
  var seen = {}, out = [];
  (state.leaderboard || []).concat(state.poolMembers || []).forEach(function(row) {
    var name = row && row.name ? standardizeParticipantName(row.name) : "";
    var low = name.toLowerCase();
    if (!name || seen[low]) return;
    seen[low] = true;
    var pf = getProfileLinkedToMemberName(name);
    var cu = pf && !pf.isBuiltIn ? (state.customUsers || []).filter(function(c) { return c.key === pf.key; })[0] : null;
    // With account bindings (account-security.js) a claimed player is one bound to an account;
    // otherwise any built-in or owned profile counts as taken.
    if (typeof ACCOUNT_SECURITY_LIVE !== "undefined" && ACCOUNT_SECURITY_LIVE) {
      if (isMemberClaimedByOther(name, AUTH_SESSION && AUTH_SESSION.uid)) return;
    } else if (pf && (pf.isBuiltIn || (cu && cu.ownerUid))) return; // already someone's account
    out.push(name);
  });
  return out.sort(function(a, b) { return a.localeCompare(b); });
}

function chooseRosterNameForNewAccount(accountName) {
  if (_rosterChooserPromise) return _rosterChooserPromise;
  var names = unclaimedRosterNames();
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!names.length || !bd || !body) return Promise.resolve("");
  closePanelSheet();
  _rosterChooserPromise = new Promise(function(resolve) { _rosterChooserResolve = resolve; });
  document.getElementById("panel-sheet-title").textContent = "Which player are you?";
  body.innerHTML =
    '<p class="sheet-meta">We couldn\'t match ' + escapeShellHtml(accountName || "your account") + ' to the pool roster. Pick your name so your points and picks stay together.</p>' +
    '<input type="search" class="search-input" id="roster-chooser-q" placeholder="Search names" oninput="filterRosterChooser(this.value)" style="width:100%;margin-bottom:10px;" />' +
    '<div class="list-card" id="roster-chooser-list">' +
      names.map(function(n) {
        return '<button type="button" class="list-row" data-name="' + escapeShellHtml(n.toLowerCase()) + '" onclick="finishRosterChooser(this.textContent)"><span class="list-row-title">' + escapeShellHtml(n) + '</span></button>';
      }).join("") +
    '</div>' +
    '<button type="button" class="btn-sm" style="margin-top:12px;width:100%;" onclick="finishRosterChooser(\'\')">I\'m new to the pool' +
      ((typeof ACCOUNT_SECURITY_LIVE !== "undefined" && ACCOUNT_SECURITY_LIVE && getSecurityConfig().registrationMode !== "invite_code_required") ? ' (the commissioner approves)' : '') + '</button>';
  bd.hidden = false;
  return _rosterChooserPromise;
}

function filterRosterChooser(q, listId) {
  q = String(q || "").trim().toLowerCase();
  var rows = document.querySelectorAll("#" + (listId || "roster-chooser-list") + " .list-row");
  for (var i = 0; i < rows.length; i++) rows[i].hidden = !!q && rows[i].getAttribute("data-name").indexOf(q) === -1;
}

function finishRosterChooser(name) {
  var resolve = _rosterChooserResolve;
  _rosterChooserResolve = null;
  _rosterChooserPromise = null;
  if (resolve) resolve(String(name || "").trim());
  closePanelSheet();
}

// Closing the sheet without choosing means a new player.
var _dlgPrevClosePanelSheet = closePanelSheet;
closePanelSheet = function() {
  if (_rosterChooserResolve) {
    var resolve = _rosterChooserResolve;
    _rosterChooserResolve = null;
    _rosterChooserPromise = null;
    resolve("");
  }
  return _dlgPrevClosePanelSheet.apply(this, arguments);
};

// ---------- Page scroll lock while an overlay is open ----------
// Scrolling inside an open overlay (Commissioner console, drawers, sheets, GameCast) used to
// scroll the page behind it too: iOS Safari ignores overflow:hidden on <body>, and Android
// Chrome chains the scroll once the overlay reaches its end. While any overlay is showing, the
// page is pinned with position:fixed at its current offset (works on iOS), overlays get
// overscroll-behavior: contain (css), and the offset is restored when the last one closes.
// Every overlay opens and closes by changing its own style/hidden/class, so one observer covers
// them all without touching each open/close function.
var OVERLAY_BACKDROP_IDS = ["commish-modal-backdrop", "auth-modal-backdrop", "pin-modal-backdrop", "opp-modal-backdrop",
  "field-theater-backdrop", "settings-drawer-backdrop", "ev-sim-drawer-backdrop", "confirm-backdrop",
  "panel-sheet-backdrop", "detail-sheet-backdrop", "review-checklist-backdrop", "rail-backdrop"];
var PAGE_SCROLL_LOCK = null; // { y } while locked

function isOverlayShowing(el) {
  if (!el || el.hidden) return false;
  var cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

function anyOverlayOpen() {
  for (var i = 0; i < OVERLAY_BACKDROP_IDS.length; i++) {
    if (isOverlayShowing(document.getElementById(OVERLAY_BACKDROP_IDS[i]))) return true;
  }
  // Phone sidebar drawer (base.css .mobile-drawer-open)
  return !!document.querySelector(".sidebar.mobile-drawer-open");
}

function syncPageScrollLock() {
  var open = anyOverlayOpen();
  var body = document.body;
  if (open && !PAGE_SCROLL_LOCK) {
    var y = window.scrollY || window.pageYOffset || 0;
    PAGE_SCROLL_LOCK = { y: y };
    body.style.top = (-y) + "px";
    body.classList.add("page-scroll-locked");
  } else if (!open && PAGE_SCROLL_LOCK) {
    var restoreY = PAGE_SCROLL_LOCK.y;
    PAGE_SCROLL_LOCK = null;
    body.classList.remove("page-scroll-locked");
    body.style.top = "";
    window.scrollTo({ top: restoreY, left: 0, behavior: "instant" });
  }
}

(function watchOverlaysForScrollLock() {
  var pending = false;
  var schedule = function() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function() { pending = false; syncPageScrollLock(); });
  };
  var observer = new MutationObserver(schedule);
  var attach = function() {
    OVERLAY_BACKDROP_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el._scrollLockWatched) {
        el._scrollLockWatched = true;
        observer.observe(el, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
      }
    });
    var sb = document.querySelector(".sidebar");
    if (sb && !sb._scrollLockWatched) {
      sb._scrollLockWatched = true;
      observer.observe(sb, { attributes: true, attributeFilter: ["class"] });
    }
    schedule();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
