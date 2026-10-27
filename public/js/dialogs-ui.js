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
  document.body.classList.add("sheet-open");
}

function closePanelSheet() {
  var bd = document.getElementById("panel-sheet-backdrop");
  if (bd) bd.hidden = true;
  document.body.classList.remove("sheet-open");
  if (_panelSheetNode && _panelSheetHome) _panelSheetHome.insertBefore(_panelSheetNode, _panelSheetNext);
  _panelSheetNode = _panelSheetHome = _panelSheetNext = null;
}

// Past weeks (commissioner): the archive box opens as a sheet from anywhere, in both modes.
var _dlgPrevOpenMoreSection = openMoreSection;
openMoreSection = function(section) {
  if (section !== "weeks") return _dlgPrevOpenMoreSection.apply(this, arguments);
  closeSettingsDrawer();
  closeEvSimulatorDrawer();
  if (typeof renderSeasonArchiveHub === "function") renderSeasonArchiveHub();
  openPanelSheet("Past weeks", "season-archive-hub-container");
};
