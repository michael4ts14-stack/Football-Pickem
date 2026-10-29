// ============================================================================
// COMMISSIONER HUB: pick overrides on Submissions rows, audit log, pick deadline and per-game
// locks, the Slate tab's Danger Zone, dues payment links, and read-only "Preview as player".
// Loaded after commissioner-admin.js; adds sections to the Console tabs it renders.
// ============================================================================

function commishEmailForLog() {
  try {
    var u = fbAuth && fbAuth.currentUser;
    if (u && u.email) return u.email.toLowerCase();
  } catch (e) {}
  return (AUTH_SESSION && AUTH_SESSION.email) || "";
}

// ---------- Commissioner log (who / what / when) ----------
// Entries live in pickem_v14_commish_log, one doc each, readable and writable only by
// commissioners (firestore.rules). The older log was an array in commissionerConfig, which
// every visitor can read; moveLegacyLogToPrivate() copies it over and deletes it.
var COMMISH_LOG = [];           // newest first, last 100 (commissioner only)
var COMMISH_LOG_WATCHING = false;

function logCommishAction(action, targetPlayer, reason) {
  if (!fsDb || !isVerifiedCommissioner()) return Promise.resolve();
  var entry = { timestamp: new Date().toISOString(), commishEmail: commishEmailForLog(), targetPlayer: targetPlayer || "", action: action, reason: reason || "" };
  COMMISH_LOG.unshift(entry);
  return fsDb.collection("pickem_v14_commish_log").add(entry).catch(function(e) { reportCloudSaveFailure("the commissioner log", e); });
}

// Overrides change a setting, then log: the setting is saved here, the entry goes to the log.
function logCommissionerOverride(targetPlayer, action, reason) {
  logCommishAction(action, targetPlayer, reason);
  saveCommissionerConfigToCloud();
}

function watchCommishLog() {
  if (COMMISH_LOG_WATCHING || !fsDb || !isVerifiedCommissioner()) return;
  COMMISH_LOG_WATCHING = true;
  fsDb.collection("pickem_v14_commish_log").orderBy("timestamp", "desc").limit(100).onSnapshot(function(snap) {
    COMMISH_LOG = snap.docs.map(function(d) { return d.data(); });
    var sec = document.getElementById("commish-audit-log");
    if (sec) sec.outerHTML = auditLogHtml();
  }, function() { COMMISH_LOG_WATCHING = false; });
}

function legacyAuditLog() {
  var cfg = state.commissionerConfig || {};
  return Array.isArray(cfg.overrideAuditLog) ? cfg.overrideAuditLog : [];
}

// One-time move of the old public log (commissionerConfig.overrideAuditLog) into the private
// collection, then the old array is deleted from the pool doc. Run from the Users tab.
function moveLegacyLogToPrivate() {
  if (!assertCommissionerRole("moving the log")) return;
  var old = legacyAuditLog().slice(0, 450);
  if (!old.length) return;
  confirmDanger("Move " + old.length + " older log entries to the commissioner-only log? They're copied first, then removed from the pool settings every visitor can read.", "Move entries", function() {
    var batch = fsDb.batch();
    var col = fsDb.collection("pickem_v14_commish_log");
    old.forEach(function(e) {
      batch.set(col.doc(), { timestamp: e.timestamp || "", commishEmail: e.commishEmail || "", targetPlayer: e.targetPlayer || "", action: e.action || "", reason: e.reason || "", migrated: true });
    });
    batch.commit().then(function() {
      return fsDb.collection("pickem_v14").doc("shared_state").update(new firebase.firestore.FieldPath("commissionerConfig", "overrideAuditLog"), firebase.firestore.FieldValue.delete());
    }).then(function() {
      delete state.commissionerConfig.overrideAuditLog;
      logCommishAction("Moved " + old.length + " older log entries to the commissioner-only log", "", "");
      showAppToast("Moved " + old.length + " entries. The log is now commissioner-only.");
      renderCommissionerModalBody();
    }, function(e) { showAppToast("Couldn't move the log (" + ((e && e.code) || "error") + "). Are the latest Firestore rules published?"); });
  });
}

// ---------- Submissions row actions ----------
function manuallySetPlayerPicks(memberName) {
  if (!assertCommissionerRole("Edit Picks")) return;
  logCommissionerOverride(memberName, "Opened the pick editor", "");
  commishQuickImpersonate(memberName);
}

function overrideTiebreaker(memberName) {
  if (!assertCommissionerRole("Override Tiebreaker")) return;
  var stdName = standardizeParticipantName(memberName);
  var pm = findPoolMemberByName(stdName);
  var linked = getProfileLinkedToMemberName(stdName);
  var current = (linked && state[linked.key] && state[linked.key].tiebreaker) || (pm && pm.tiebreaker) || "";
  var val = window.prompt("Tiebreaker for " + stdName + " (higher score first, e.g. 31-24):", current === "—" ? "" : current);
  if (val === null) return;
  val = String(val).trim();
  if (!/^\d{1,3}\s*-\s*\d{1,3}$/.test(val)) { showAppToast("Use a score like 31-24."); return; }
  val = val.replace(/\s+/g, "");
  var reason = window.prompt("Reason (optional, shown in the override log):", "") || "";
  if (pm) pm.tiebreaker = val;
  if (linked && state[linked.key]) {
    state[linked.key].tiebreaker = val;
    pushProfileToFirebase(linked.key);
  }
  pushWatchlistOrStandingsToFirebase();
  logCommissionerOverride(stdName, "Tiebreaker set to " + val + (current && current !== "—" ? " (was " + current + ")" : ""), reason);
  renderCommissionerModalBody();
  showAppToast("Tiebreaker for " + stdName + " is now " + val + ".");
}

// Stored as "season:week" so a flag can't re-activate in the same week number next season (B49).
// Older flags are bare week numbers; they count only for the season in progress when this shipped.
function forceUnlockToken() {
  return duesSeason() + ":" + (parseInt(state.currentWeek, 10) || 0);
}

function forceUnlockFlagIsCurrent(wk) {
  if (!wk) return false;
  if (typeof wk === "string" && wk.indexOf(":") !== -1) return wk === forceUnlockToken();
  return duesSeason() === DUES_LEGACY_SEASON && parseInt(wk, 10) === parseInt(state.currentWeek, 10);
}

function isMemberForceUnlocked(memberName) {
  return forceUnlockFlagIsCurrent(ensureCommissionerConfig().forceUnlocked[standardizeParticipantName(memberName).toLowerCase()]);
}

// Lets one player keep changing games that haven't kicked off after the weekly deadline (this week only).
function forceUnlockPicks(memberName) {
  if (!assertCommissionerRole("Force Unlock")) return;
  var cfg = ensureCommissionerConfig();
  var low = standardizeParticipantName(memberName).toLowerCase();
  var on = !isMemberForceUnlocked(memberName);
  if (on) cfg.forceUnlocked[low] = forceUnlockToken();
  else delete cfg.forceUnlocked[low];
  logCommissionerOverride(standardizeParticipantName(memberName), on ? "Force unlocked past the deadline" : "Removed force unlock", "");
  renderCommissionerModalBody();
  renderAll();
}

function forceUnlockButtonHtml(memberName) {
  var on = isMemberForceUnlocked(memberName);
  var safe = jsArgAttr(memberName);
  return '<button type="button" class="btn-sm" aria-pressed="' + on + '" style="padding:3px 7px;font-size:0.66rem;border-color:var(--border);color:' + (on ? 'var(--accent-text)' : 'var(--text)') + ';" ' +
    'title="Let this player change games that haven\'t kicked off after the deadline (this week only)" onclick="forceUnlockPicks(\'' + safe + '\')">' + (on ? 'Unlocked ✓' : 'Force unlock') + '</button>';
}

function auditLogHtml() {
  watchCommishLog();
  var legacy = legacyAuditLog();
  var log = COMMISH_LOG.concat(legacy).sort(function(a, b) {
    return String(b.timestamp || "").localeCompare(String(a.timestamp || ""));
  }).slice(0, 100);
  var rows = log.map(function(e) {
    var when = e.timestamp ? new Date(e.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return '<tr><td>' + escapeShellHtml(when) + '</td><td>' + escapeShellHtml(e.commishEmail || "") + '</td><td>' + escapeShellHtml(e.targetPlayer || "") + '</td><td>' + escapeShellHtml(e.action || "") + '</td><td>' + escapeShellHtml(e.reason || "") + '</td></tr>';
  }).join("");
  return '<section class="console-section" id="commish-audit-log">' +
    '<h3 class="console-h">Commissioner log</h3>' +
    '<p class="sheet-meta">Who did what and when: pick edits, overrides, dues, roles, links, removals and settings. Newest first, last 100. Only commissioners can see it.</p>' +
    (legacy.length
      ? '<div class="acct-link-row"><span class="muted-note">' + legacy.length + ' older entries are still in the pool settings, which anyone can read.</span>' +
        '<button type="button" class="btn-sm" onclick="moveLegacyLogToPrivate()">Move them to the private log</button></div>'
      : '') +
    (rows
      ? '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;"><table class="condensed-table"><thead><tr><th>When</th><th>Commissioner</th><th>Player</th><th>Action</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="empty-note">Nothing logged yet.</p>') +
  '</section>';
}

// Delete / auto-pick are overrides too.
var _hubPrevDeletePicks = commishDeletePlayerPicks;
commishDeletePlayerPicks = function(memberName) {
  var res = _hubPrevDeletePicks.apply(this, arguments);
  if (isVerifiedCommissioner()) logCommissionerOverride(standardizeParticipantName(memberName || ""), "Deleted picks", "");
  return res;
};
var _hubPrevAutoSelect = commishAutoSelectPlayerPicks;
commishAutoSelectPlayerPicks = function(memberName, strategy) {
  var res = _hubPrevAutoSelect.apply(this, arguments);
  if (isVerifiedCommissioner()) logCommissionerOverride(standardizeParticipantName(memberName || ""), "Auto-picked (" + (strategy || "optimal") + ")", "");
  return res;
};

// ---------- Locks tab: pick deadline ----------
function setDeadlineConfig(field, value) {
  if (!assertCommissionerRole("Pick Deadline")) return;
  var cfg = ensureCommissionerConfig();
  cfg.deadlineConfig[field] = value;
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
  renderAll();
}

function deadlineSettingsHtml() {
  var d = getDeadlineConfig();
  var dayOpts = DEADLINE_DAYS.map(function(x) { return '<option' + (x === d.day ? ' selected' : '') + '>' + x + '</option>'; }).join("");
  var tzOpts = Object.keys(DEADLINE_ZONES).map(function(z) { return '<option value="' + z + '"' + (z === d.tz ? ' selected' : '') + '>' + DEADLINE_ZONES[z] + ' (' + z.split("/")[1].replace("_", " ") + ')</option>'; }).join("");
  var unlocked = Object.keys(ensureCommissionerConfig().forceUnlocked).filter(isMemberForceUnlocked);
  return '<section class="console-section">' +
    '<h3 class="console-h">Pick deadline</h3>' +
    '<p class="sheet-meta">Used by the weekly deadline lock. Games still lock at their own kickoff, so Thursday and Friday games close on time. Now: <strong>' + escapeShellHtml(pickDeadlineLabel()) + '</strong>' + (isPastPickDeadline() ? ' (passed)' : '') + '.</p>' +
    '<div class="console-fields">' +
      '<label>Day <select class="search-input" onchange="setDeadlineConfig(\'day\', this.value)">' + dayOpts + '</select></label>' +
      '<label>Time <input type="time" class="search-input" value="' + d.time + '" onchange="setDeadlineConfig(\'time\', this.value)" /></label>' +
      '<label>Time zone <select class="search-input" onchange="setDeadlineConfig(\'tz\', this.value)">' + tzOpts + '</select></label>' +
    '</div>' +
    '<p class="sheet-meta" style="margin-top:10px;">Force unlocked this week: ' + (unlocked.length ? escapeShellHtml(unlocked.join(", ")) : 'nobody') + '. Set per player on the Submissions tab.</p>' +
  '</section>';
}

// ---------- Slate tab: per-game locks and Danger Zone ----------
function gameLockSelectHtml(gameId) {
  var cur = ensureCommissionerConfig().gameLockOverrides[String(gameId)] || "auto";
  var opt = function(v, label) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + label + '</option>'; };
  return '<select class="search-input" style="padding:2px 6px;font-size:0.7rem;" aria-label="Lock for game ' + gameId + '" onchange="setGameLockOverride(' + gameId + ', this.value)">' +
    opt("auto", "Auto") + opt("locked", "Locked") + opt("open", "Open") + '</select>';
}

function setGameLockOverride(gameId, value) {
  if (!assertCommissionerRole("Game Lock")) return;
  var cfg = ensureCommissionerConfig();
  if (value === "locked" || value === "open") cfg.gameLockOverrides[String(gameId)] = value;
  else delete cfg.gameLockOverrides[String(gameId)];
  var g = findGameById(gameId);
  logCommissionerOverride(g ? (g.away + " at " + g.home) : ("Game " + gameId), "Game lock set to " + (value || "auto"), "");
  renderCommissionerModalBody();
  renderAll();
}

function dangerZoneHtml() {
  return '<details class="danger-zone">' +
    '<summary>Danger Zone</summary>' +
    '<p class="sheet-meta">These change the whole pool. Each asks twice.</p>' +
    '<div class="danger-zone-actions">' +
      '<button type="button" class="btn-sm danger-btn" onclick="dangerZoneNewWeekReset()">New week reset (archive, then clear pool picks)</button>' +
      '<button type="button" class="btn-sm danger-btn" onclick="dangerZoneReimportSlate()">Re-import the slate (paste or upload)</button>' +
      '<button type="button" class="btn-sm danger-btn" onclick="dangerZoneClearOverrides()">Clear game lock overrides and force unlocks</button>' +
    '</div>' +
  '</details>';
}

// Two steps: a confirm, then typing the week number.
function confirmTwice(message, label, action) {
  confirmDanger(message, label, function() {
    var wk = String(state.currentWeek || "");
    var typed = window.prompt("To confirm, type the week number (" + wk + "):", "");
    if (typed === null) return;
    if (String(typed).trim() !== wk) { showAppToast("Week number didn't match. Nothing changed."); return; }
    action();
  });
}

function dangerZoneNewWeekReset() {
  if (!assertCommissionerRole("New week reset")) return;
  confirmTwice("Archive Week " + state.currentWeek + " and clear every pool member's picks?", "Reset week", function() {
    _dlgPrevNewWeekReset(true);
    logCommissionerOverride("Everyone", "New week reset", "");
  });
}

function dangerZoneReimportSlate() {
  if (!assertCommissionerRole("Re-import slate")) return;
  confirmTwice("Re-importing replaces this week's games and clears pool picks. Continue?", "Re-import", function() {
    logCommissionerOverride("Everyone", "Opened slate re-import", "");
    closeCommissionerModal();
    openUnifiedImportModal("pdf");
  });
}

function dangerZoneClearOverrides() {
  if (!assertCommissionerRole("Clear overrides")) return;
  confirmTwice("Remove every per-game lock override and force unlock?", "Clear", function() {
    var cfg = ensureCommissionerConfig();
    cfg.gameLockOverrides = {};
    cfg.forceUnlocked = {};
    logCommissionerOverride("Everyone", "Cleared game lock overrides and force unlocks", "");
    renderCommissionerModalBody();
    renderAll();
  });
}

// ---------- Roster tab: payment links and pot ----------
function setPaymentLink(field, value) {
  if (!assertCommissionerRole("Payment links")) return;
  ensureCommissionerConfig().paymentLinks[field] = String(value || "").trim();
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
}

function setPotSetting(field, value) {
  if (!assertCommissionerRole("Payouts")) return;
  ensureCommissionerConfig()[field] = Math.max(0, parseFloat(value) || 0);
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
}

function potSummary() {
  var cfg = ensureCommissionerConfig();
  var fee = isNaN(parseFloat(cfg.entryFeeDollars)) ? 25 : parseFloat(cfg.entryFeeDollars);
  var roster = cachedDuesRoster();
  var paid = roster.list.filter(function(r) { return isDuesPaid(r.low, roster); }).length;
  var weekly = parseFloat(cfg.weeklyPayoutDollars) || 0;
  var weeks = cfg.seasonWeeks === undefined ? 14 : (parseFloat(cfg.seasonWeeks) || 0);
  var season = parseFloat(cfg.seasonPrizeDollars) || 0;
  return { fee: fee, paid: paid, collected: paid * fee, projected: weekly * weeks + season, weekly: weekly, weeks: weeks, season: season };
}

function paymentSettingsHtml() {
  var cfg = ensureCommissionerConfig();
  var pl = cfg.paymentLinks;
  var pot = potSummary();
  var field = function(key, label, ph) {
    return '<label>' + label + ' <input type="text" class="search-input" value="' + escapeShellHtml(pl[key] || "") + '" placeholder="' + ph + '" onchange="setPaymentLink(\'' + key + '\', this.value)" /></label>';
  };
  var num = function(key, label, val) {
    return '<label>' + label + ' <input type="number" min="0" class="search-input" value="' + val + '" onchange="setPotSetting(\'' + key + '\', this.value)" /></label>';
  };
  return '<section class="console-section">' +
    '<h3 class="console-h">Dues and payouts</h3>' +
    '<div class="commish-kpi-strip">' +
      '<div class="commish-kpi"><div class="metric-label">Collected pot</div><div class="metric-val">$' + pot.collected + '</div><div class="metric-sub">' + pot.paid + ' paid × $' + pot.fee + '</div></div>' +
      '<div class="commish-kpi"><div class="metric-label">Projected payouts</div><div class="metric-val">$' + pot.projected + '</div><div class="metric-sub">$' + pot.weekly + ' × ' + pot.weeks + ' weeks + $' + pot.season + ' season</div></div>' +
      '<div class="commish-kpi"><div class="metric-label">Balance</div><div class="metric-val" style="color:' + (pot.collected >= pot.projected ? 'var(--win)' : 'var(--loss)') + ';">' + (pot.collected < pot.projected ? '-' : '') + '$' + Math.abs(pot.collected - pot.projected) + '</div><div class="metric-sub">Collected minus projected</div></div>' +
    '</div>' +
    '<div class="console-fields">' +
      num("weeklyPayoutDollars", "Weekly payout ($)", pot.weekly) +
      num("seasonWeeks", "Weeks", pot.weeks) +
      num("seasonPrizeDollars", "Season prize ($)", pot.season) +
    '</div>' +
    '<p class="sheet-meta" style="margin-top:10px;">Payment links: unpaid players see a small "Dues unpaid" banner with one-tap links once at least one link is set.</p>' +
    '<div class="console-fields">' +
      field("venmoHandle", "Venmo", "@handle") +
      field("paypalLink", "PayPal", "paypal.me/name") +
      field("cashAppTag", "Cash App", "$cashtag") +
    '</div>' +
  '</section>';
}

// ---------- Player-facing dues banner ----------
function duesPayLinks() {
  var cfg = ensureCommissionerConfig();
  var pl = cfg.paymentLinks || {};
  var fee = isNaN(parseFloat(cfg.entryFeeDollars)) ? 25 : parseFloat(cfg.entryFeeDollars);
  var links = [];
  var venmo = String(pl.venmoHandle || "").replace(/^@/, "");
  if (venmo) links.push({ label: "Venmo", href: "https://venmo.com/u/" + encodeURIComponent(venmo) });
  var pp = String(pl.paypalLink || "");
  if (pp) links.push({ label: "PayPal", href: /^https?:\/\//.test(pp) ? pp : "https://" + pp.replace(/^\/+/, "") });
  var cash = String(pl.cashAppTag || "").replace(/^\$/, "");
  if (cash) links.push({ label: "Cash App", href: "https://cash.app/$" + encodeURIComponent(cash) + "/" + fee });
  return links;
}

function renderDuesBanner() {
  var host = document.getElementById("full-cards-wrapper");
  if (!host) return;
  var el = document.getElementById("dues-banner");
  var name = isSignedInUser() ? getMyLeaderboardNameLower() : "";
  var cfg = ensureCommissionerConfig();
  var links = duesPayLinks();
  var dismissedKey = "pickem_dues_banner_hidden_wk";
  var show = !!name && links.length && !isDuesPaid(duesKeyForName(name)) && !PLAYER_PREVIEW &&
    String(safeGetStorage(dismissedKey) || "") !== String(state.currentWeek);
  if (!show) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "dues-banner";
    el.className = "dues-banner";
    el.setAttribute("role", "status");
    var head = host.querySelector(".page-head");
    host.insertBefore(el, head ? head.nextSibling : host.firstChild);
  }
  el.hidden = false;
  el.innerHTML = '<span>Dues unpaid ($' + (isNaN(parseFloat(cfg.entryFeeDollars)) ? 25 : parseFloat(cfg.entryFeeDollars)) + '). Pay via</span>' +
    links.map(function(l) { return '<a href="' + escapeShellHtml(l.href) + '" target="_blank" rel="noopener">' + escapeShellHtml(l.label) + '</a>'; }).join("") +
    '<button type="button" class="link-btn" onclick="safeSetStorage(\'' + dismissedKey + '\', String(state.currentWeek)); renderDuesBanner();">Hide this week</button>';
}

// ---------- Preview as player (read-only) ----------
// Shows Picks and Standings with one player's picks and standing. Nothing is switched or
// saved: picks, tiebreaker and lock actions are blocked until the preview ends.
var PLAYER_PREVIEW = null;

function startPlayerPreview(memberName) {
  if (!assertCommissionerRole("Preview as player")) return;
  var stdName = standardizeParticipantName(memberName);
  var pm = findPoolMemberByName(stdName);
  var linked = getProfileLinkedToMemberName(stdName);
  var appPicks = linked && state[linked.key] && state[linked.key].picks;
  var picks = (appPicks && hasSubmittedPicksForCurrentSlate(appPicks, GAMES)) ? appPicks : ((pm && pm.picks) || {});
  PLAYER_PREVIEW = { name: stdName, picks: Object.assign({}, picks), tiebreaker: (linked && state[linked.key] && state[linked.key].tiebreaker) || (pm && pm.tiebreaker) || "—" };
  closeCommissionerModal();
  switchMainView("cards");
  renderAll();
  window.scrollTo({ top: 0 });
}

function exitPlayerPreview() {
  PLAYER_PREVIEW = null;
  renderAll();
  openCommissionerModal("roster");
}

function renderPreviewBanner() {
  var el = document.getElementById("player-preview-banner");
  // The banner is fixed at the top; the page leaves room for it so it never sits on content.
  document.body.classList.toggle("has-preview-banner", !!PLAYER_PREVIEW);
  if (!PLAYER_PREVIEW) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "player-preview-banner";
    el.className = "preview-banner";
    el.setAttribute("role", "status");
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.hidden = false;
  el.innerHTML = '<span>Previewing as <strong>' + escapeShellHtml(PLAYER_PREVIEW.name) + '</strong> · tiebreaker ' + escapeShellHtml(PLAYER_PREVIEW.tiebreaker) + ' · read-only</span>' +
    '<button type="button" class="btn-sm" onclick="exitPlayerPreview()">Exit preview</button>';
}

var _hubPrevGetMyPicksMap = getMyPicksMap;
getMyPicksMap = function() {
  return PLAYER_PREVIEW ? PLAYER_PREVIEW.picks : _hubPrevGetMyPicksMap.apply(this, arguments);
};
var _hubPrevMyLbName = getMyLeaderboardNameLower;
getMyLeaderboardNameLower = function() {
  return PLAYER_PREVIEW ? PLAYER_PREVIEW.name.toLowerCase() : _hubPrevMyLbName.apply(this, arguments);
};
var _hubPrevManualLocked = isCurrentProfileManuallyLocked;
isCurrentProfileManuallyLocked = function() {
  return PLAYER_PREVIEW ? true : _hubPrevManualLocked.apply(this, arguments);
};
["pickSide", "pickSideForProfile", "toggleManualUserPickLock", "onPrimaryPicksAction", "syncSimpleTiebreakerInput"].forEach(function(fn) {
  var orig = window[fn];
  if (typeof orig !== "function") return;
  window[fn] = function() {
    if (PLAYER_PREVIEW) { showAppToast("Preview is read-only. Exit preview to make changes."); return; }
    return orig.apply(this, arguments);
  };
});

// ---------- Console tab additions ----------
var _hubPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _hubPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (!body || !isVerifiedCommissioner()) return res;
  if (ACTIVE_COMMISH_TAB === "locks") body.insertAdjacentHTML("beforeend", deadlineSettingsHtml());
  if (ACTIVE_COMMISH_TAB === "slate") body.insertAdjacentHTML("beforeend", dangerZoneHtml());
  if (ACTIVE_COMMISH_TAB === "roster") body.insertAdjacentHTML("beforeend", paymentSettingsHtml());
  return res;
};

// One entry point: unknown or legacy tab names (e.g. "override" from old links or saved state)
// open Submissions. Also highlights the Master Grid and Admins tabs, which the original skipped.
var COMMISH_TABS = ["submissions", "mastersheet", "slate", "locks", "roster", "users", "comms", "admin"];
var _hubPrevSwitchTab = switchCommissionerTab;
switchCommissionerTab = function(tabName) {
  var tab = COMMISH_TABS.indexOf(tabName) !== -1 ? tabName : "submissions";
  var res = _hubPrevSwitchTab.call(this, tab);
  COMMISH_TABS.forEach(function(t) {
    var b = document.getElementById("cm-tab-" + t);
    if (b) b.className = "hub-tab-btn" + (t === tab ? " active" : "");
  });
  return res;
};

var _hubPrevRenderAll = renderAll;
renderAll = function() {
  var res = _hubPrevRenderAll.apply(this, arguments);
  try { renderPreviewBanner(); } catch (e) {}
  try { renderDuesBanner(); } catch (e2) {}
  return res;
};
