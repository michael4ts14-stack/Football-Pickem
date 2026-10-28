var _origRenderAllV166 = renderAll;
renderAll = function() {
  ensureMondayLockedOddsOnGames();
  syncCommissionerVisibilityDOM();
  syncManualLockButtonUI();
  renderMultiBuyInEntryStrip();
  _origRenderAllV166();
};

// Boot sequence
var savedCardStyle = safeGetStorage("sat_simple_card_style_v16");
if (savedCardStyle === "detailed" || savedCardStyle === "condensed") {
  SIMPLE_CARD_LAYOUT_STYLE = savedCardStyle;
}
ensureMondayLockedOddsOnGames();
initSimpleModeAndCommish();
initState();
restoreAppearanceOnBoot();
enterGuestModeIfSignedOut();
renderAll();
syncCommissionerVisibilityDOM();
syncManualLockButtonUI();
renderMultiBuyInEntryStrip();
syncSimpleModeTabHighlights();
// Offline or Firestore unreachable: stop waiting for the pool's slate after 8 seconds.
setTimeout(function() {
  if (!CLOUD_HYDRATED) { CLOUD_HYDRATED = true; renderAll(); }
}, 8000);
setTimeout(function() {
  if (!window._fullWeekEnrichmentRunning) {
    syncAllLiveTrackingData(false);
  }
}, 450);
