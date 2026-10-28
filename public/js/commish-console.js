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

// ---------- Commissioner log: every action, who / what / when ----------
// Actions that don't write their own entry are wrapped here. A wrapped action that opens the
// confirm dialog logs only when it's confirmed; one that changes nothing (describe returns
// null) isn't logged. Actions with their own entries: pick overrides, force unlocks, game locks,
// danger zone (logCommissionerOverride), archive/restore and merge (account-security.js), dues
// (commish-dues.js), and the Users tab actions (commish-users.js).
function wrapCommishActionLog(name, describe) {
  var orig = window[name];
  if (typeof orig !== "function") return;
  window[name] = function() {
    var args = arguments;
    var cbBefore = typeof _confirmDangerCallback !== "undefined" ? _confirmDangerCallback : null;
    var res = orig.apply(this, args);
    var log = function() {
      if (!isVerifiedCommissioner()) return;
      var d = describe.apply(null, args);
      if (d) logCommishAction(d[0], d[1] || "", d[2] || "");
    };
    if (typeof _confirmDangerCallback !== "undefined" && _confirmDangerCallback && _confirmDangerCallback !== cbBefore) {
      var cb = _confirmDangerCallback;
      _confirmDangerCallback = function() { var r = cb.apply(this, arguments); log(); return r; };
    } else {
      log();
    }
    return res;
  };
}

(function() {
  var cfg = function() { return ensureCommissionerConfig(); };
  var nm = function(n) { return fixDisplaySpelling(standardizeParticipantName(n || "")); };
  var reqName = function(uid) {
    var r = (typeof LINK_REQUESTS !== "undefined" ? LINK_REQUESTS : []).filter(function(x) { return x && (x.claimId === uid || x.uid === uid); })[0] || {};
    return [r.authEmail || uid, r.requestedMember ? nm(r.requestedMember) : ""];
  };
  var actions = {
    setCommishLockMode: function(m) { return ["Pick lock mode set to " + m]; },
    setCommishScrapingMode: function(m) { return ["Site mode set to " + m]; },
    setDeadlineConfig: function(f, v) { return ["Pick deadline " + f + " set to " + v]; },
    setPaymentLink: function(f, v) { return ["Payment link " + f + " set to " + (v || "(blank)")]; },
    setPotSetting: function(f, v) { return ["Payout " + f + " set to " + v]; },
    commishSaveBanner: function() { var b = cfg().announcementBanner; return [b ? "Published banner: " + b : "Cleared the banner"]; },
    commishAddPoolMember: function() { return ["Added a player to the roster"]; },
    commishAdjustPlayerPriorPts: function(n, v) { return ["Set prior points to " + v, nm(n)]; },
    commishAutoFillMissingPlayers: function(s) { return ["Auto-filled missing players' picks (" + (s || "favorites") + ")"]; },
    commishPublishSelectedEspnSlate: function() { return ["Published a new slate (Week " + state.currentWeek + ", " + GAMES.length + " games)"]; },
    commishSwapIndividualGame: function(id) { var g = findGameById(id); return g ? ["Swapped game #" + id + " to " + g.away + " at " + g.home] : null; },
    commishUpdateGameSpread: function(id, line) { return ["Game #" + id + " line set to " + line]; },
    commishUpdateGameKick: function(id, k) { return ["Game #" + id + " kickoff set to " + k]; },
    setTiebreakerGame: function(id) { return ["Tiebreaker game set to #" + id]; },
    triggerWedThuAutomatedNudge: function() { return ["Sent the Wed/Thu nudge email"]; },
    triggerSaturdayMorningMasterSheetBroadcast: function() { return ["Sent the Saturday reveal / master sheet"]; },
    commishGrantRole: function(k, label) { var key = String(k || "").toLowerCase(); return cfg().authorizedCommissioners[key] || key.indexOf("@") === -1 ? ["Granted co-commissioner", label || k] : null; },
    commishRevokeRole: function(k) { return cfg().authorizedCommissioners[k] ? null : ["Revoked commissioner access", k]; },
    commishToggleRoleEnabled: function(k) { var r = cfg().authorizedCommissioners[k]; return r ? [(r.enabled ? "Re-enabled" : "Suspended") + " commissioner access", k] : null; },
    commishUpdatePrimaryEmail: function() { return ["Primary commissioner email set to " + cfg().primaryCommissionerEmail]; },
    approveLinkRequest: function(uid) { var r = reqName(uid); return ["Approved account link " + r[0], r[1]]; },
    rejectLinkRequest: function(uid, block) { var r = reqName(uid); return [(block ? "Blocked " : "Denied link for ") + r[0], r[1]]; },
    unlinkPlayerAccount: function(k) { return ["Unlinked the account from " + (getLinkedMemberNameForProfile(k) || k), getLinkedMemberNameForProfile(k) || k]; },
    unblockAccount: function(uid) { return ["Unblocked account " + uid]; },
    setRegisteredPlayerEmail: function(n) { var e = (cfg().playerEmailsMap || {})[memberLowOf(n)]; return [e ? "Pre-approved email " + e : "Cleared the pre-approved email", nm(n)]; },
    setRegistrationMode: function(m) { return ["League access set to " + m]; },
    commishDeletePlayerPicks: null, // logged by commish-hub's override wrapper
    startPlayerPreview: function(n) { return ["Previewed the app as", nm(n)]; },
    commishQuickImpersonate: function(n) { return ["Opened picks to edit as", nm(n)]; }
  };
  Object.keys(actions).forEach(function(name) { if (actions[name]) wrapCommishActionLog(name, actions[name]); });
})();
