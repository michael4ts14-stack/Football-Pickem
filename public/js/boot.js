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
syncCommissionerVisibilityDOM();
syncManualLockButtonUI();
renderMultiBuyInEntryStrip();
syncSimpleModeTabHighlights();
setTimeout(function() {
  if (!window._fullWeekEnrichmentRunning) {
    syncAllLiveTrackingData(false);
  }
}, 450);
