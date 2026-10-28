// ============================================================================
// COMMISSIONER CONSOLE BEHAVIOUR (loaded after every file that wraps the console renderer, so
// this wrapper is the outermost):
// - A re-render (a link request arriving, a save, the master grid filter) keeps the console's
//   scroll position, any inner list marked data-keep-scroll, and the focused field with its
//   caret. Before, typing in the master grid filter lost focus after every letter.
// - Switching tabs starts the new tab at the top and scrolls its tab button into view on the
//   phone's one-row tab strip.
// ============================================================================
var _consolePrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var box = document.getElementById("commish-modal-box");
  var tabBefore = ACTIVE_COMMISH_TAB;
  var keep = { box: box ? box.scrollTop : 0 };
  document.querySelectorAll("#commish-modal-body [data-keep-scroll]").forEach(function(el) { keep[el.getAttribute("data-keep-scroll")] = el.scrollTop; });
  var active = document.activeElement;
  var focus = (active && active.id && active.closest && active.closest("#commish-modal-body") && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;

  var res = _consolePrevCommishBody.apply(this, arguments);

  if (box && tabBefore === ACTIVE_COMMISH_TAB) {
    box.scrollTop = keep.box;
    document.querySelectorAll("#commish-modal-body [data-keep-scroll]").forEach(function(el) {
      var k = el.getAttribute("data-keep-scroll");
      if (keep[k] !== undefined) el.scrollTop = keep[k];
    });
  }
  if (focus) {
    var again = document.getElementById(focus.id);
    if (again && again !== document.activeElement) {
      again.focus({ preventScroll: true });
      try { if (typeof focus.start === "number") again.setSelectionRange(focus.start, focus.end); } catch (e) {}
    }
  }
  return res;
};

var _consolePrevSwitchTab = switchCommissionerTab;
switchCommissionerTab = function(tab) {
  var box = document.getElementById("commish-modal-box");
  var changed = tab !== ACTIVE_COMMISH_TAB;
  var res = _consolePrevSwitchTab.apply(this, arguments);
  if (box && changed) box.scrollTop = 0;
  document.querySelectorAll("#commish-modal-box .hub-tab-btn").forEach(function(b) {
    var on = b.classList.contains("active");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", on ? "true" : "false");
    if (on && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  return res;
};
