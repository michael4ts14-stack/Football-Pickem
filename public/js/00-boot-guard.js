if (window.__V16_COMMAND_CENTER_BOOTED__) {
  console.warn("Duplicate V16 script block detected and halted.");
  throw new Error("V16_DUPLICATE_SCRIPT_HALTED");
}
window.__V16_COMMAND_CENTER_BOOTED__ = true;
// Self-healing DOM guard in case duplicate HTML blocks were pasted in an editor
(function deduplicateDomIfNeeded() {
  try {
    var selectors = [".topbar", "#main-layout", ".mobile-bottom-nav", "#print-sheet-area", "#opp-tooltip", "#opp-modal-backdrop", "#field-theater-backdrop"];
    for (var s = 0; s < selectors.length; s++) {
      var nodes = document.querySelectorAll(selectors[s]);
      for (var n = 1; n < nodes.length; n++) {
        if (nodes[n] && nodes[n].parentNode) nodes[n].parentNode.removeChild(nodes[n]);
      }
    }
  } catch (e) {}
})();
