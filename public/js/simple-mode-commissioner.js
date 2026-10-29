// ============================================================================
// V16.6 DEFAULT SIMPLE MODE, GUEST-TO-ACCOUNT ONBOARDING, TOP 5 WEEKLY WINNERS,
// FRIDAY 9:00 PM CST LOCK, INSTANT EMAIL RECEIPTS & PER-GAME SLATE SWAPPER
// ============================================================================
var SIMPLE_UI_MODE = true; // Simple Mode ON by default for all users!
var GUEST_BROWSING_MODE = false;
var ACTIVE_COMMISH_TAB = "submissions";
var COMMISH_SUBMISSION_FILTER = "all"; // "all" | "submitted" | "missing"
var ESPN_CANDIDATE_SLATE_GAMES = [];

function ensureCommissionerConfig() {
  if (!state.commissionerConfig || typeof state.commissionerConfig !== "object") {
    state.commissionerConfig = {
      scrapingMode: "hybrid", // "hybrid" (Gmail/WordPress scraper active) or "standalone" (Next-season full site)
      lockMode: "friday_9pm_cst", // "friday_9pm_cst" | "rolling_kickoff" | "global_locked" | "open"
      missedPickPolicy: "none",
      entryFeeDollars: 25,
      weeklyPayoutDollars: 50,
      announcementBanner: "",
      autoEmailReceiptOnSave: true,
      autoWedThuNudgeEnabled: true,
      autoSatMorningSheetEmail: true,
      lastWedThuNudgeSentAt: "",
      lastSatSheetSentAt: "",
      duesPaidMap: {},
      playerEmailsMap: {},
      savedReceiptsLog: {}
    };
  }
  var cfg = state.commissionerConfig;
  if (!cfg.lockMode) cfg.lockMode = "friday_9pm_cst";
  if (cfg.autoEmailReceiptOnSave === undefined) cfg.autoEmailReceiptOnSave = true;
  if (cfg.autoWedThuNudgeEnabled === undefined) cfg.autoWedThuNudgeEnabled = true;
  if (cfg.autoSatMorningSheetEmail === undefined) cfg.autoSatMorningSheetEmail = true;
  if (!cfg.duesPaidMap) cfg.duesPaidMap = {};
  if (!cfg.playerEmailsMap) cfg.playerEmailsMap = {};
  if (!cfg.savedReceiptsLog) cfg.savedReceiptsLog = {};
  if (!cfg.deadlineConfig || typeof cfg.deadlineConfig !== "object") cfg.deadlineConfig = { day: "Fri", time: "21:00", tz: "America/Chicago" };
  if (!cfg.gameLockOverrides || typeof cfg.gameLockOverrides !== "object") cfg.gameLockOverrides = {};
  if (!cfg.forceUnlocked || typeof cfg.forceUnlocked !== "object") cfg.forceUnlocked = {};
  if (!cfg.paymentLinks || typeof cfg.paymentLinks !== "object") cfg.paymentLinks = { venmoHandle: "", paypalLink: "", cashAppTag: "" };
  return cfg;
}

// ---------- Pick deadline (Locks tab) ----------
// The weekly deadline: a weekday and time in a time zone (default Friday 9:00 PM Central).
// A pick week runs Monday to Sunday, so the deadline has passed from that moment until Monday.
var DEADLINE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var DEADLINE_ZONES = { "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Los_Angeles": "PT" };

function getDeadlineConfig() {
  var d = ensureCommissionerConfig().deadlineConfig;
  return {
    day: DEADLINE_DAYS.indexOf(d.day) !== -1 ? d.day : "Fri",
    time: /^\d{1,2}:\d{2}$/.test(d.time || "") ? d.time : "21:00",
    tz: DEADLINE_ZONES[d.tz] ? d.tz : "America/Chicago"
  };
}

function isPastPickDeadline() {
  var d = getDeadlineConfig();
  try {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: d.tz, weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
    var wkday = "", hr = 0, min = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "weekday") wkday = parts[i].value;
      if (parts[i].type === "hour") hr = parseInt(parts[i].value, 10) % 24;
      if (parts[i].type === "minute") min = parseInt(parts[i].value, 10);
    }
    var nowIdx = DEADLINE_DAYS.indexOf(wkday), dIdx = DEADLINE_DAYS.indexOf(d.day);
    var tp = d.time.split(":");
    var dMins = parseInt(tp[0], 10) * 60 + parseInt(tp[1], 10);
    return nowIdx > dIdx || (nowIdx === dIdx && hr * 60 + min >= dMins);
  } catch (e) {}
  return false;
}

// "Fri 9:00 PM CT"
function pickDeadlineLabel() {
  var d = getDeadlineConfig();
  var tp = d.time.split(":"), h = parseInt(tp[0], 10);
  return d.day + " " + ((h % 12) || 12) + ":" + tp[1] + " " + (h < 12 ? "AM" : "PM") + " " + DEADLINE_ZONES[d.tz];
}

// Kept for older callers: the deadline is configurable now.
function isPastFriday9PmCST() {
  return isPastPickDeadline();
}

// Hidden picks open to everyone once that player's picks are closed for the week: a commissioner
// lock, or the configured deadline in deadline-lock mode (unless they were let past it). In the
// other modes picks stay editable until kickoff, so each game reveals at its own kickoff.
function isPickSheetClosedFor(profKey) {
  var cfg = ensureCommissionerConfig();
  if (cfg.lockMode === "global_locked") return true;
  return cfg.lockMode === "friday_9pm_cst" && isPastPickDeadline() && !isProfileForceUnlocked(profKey);
}

var _origGetAutoUnhideReason = getAutoUnhideReason;
getAutoUnhideReason = function(profKey, gameId) {
  if (isPickSheetClosedFor(profKey)) {
    return "Pick Deadline Passed";
  }
  return _origGetAutoUnhideReason(profKey, gameId);
};

// Wrap bindAuthenticatedAccountToProfile so if a user made picks as a Guest first, those 26 picks + tiebreaker
// automatically carry over into their newly created or signed-in account!
var _origBindAuthenticatedAccountToProfile = bindAuthenticatedAccountToProfile;
bindAuthenticatedAccountToProfile = async function(authUser, chosenMemberName) {
  // Coming back from Google, the redirect result and the sign-in watcher both bind the same
  // account; only the first one runs (a second could reload the account's empty picks).
  var bindUid = authUser && authUser.uid;
  if (bindUid && window._bindingAccountUid === bindUid) return;
  window._bindingAccountUid = bindUid;
  try {
    return await _bindCarryingGuestPicks(authUser, chosenMemberName);
  } finally {
    window._bindingAccountUid = null;
  }
};

async function _bindCarryingGuestPicks(authUser, chosenMemberName) {
  // Only games the guest actually tapped this week carry over (not the prefilled
  // recommendations or an older sandbox), and only into games the account hasn't picked.
  var touchedIds = typeof guestTouchedGameIds === "function" ? guestTouchedGameIds() : [];
  var guestPicks = (state.test && state.test.picks) || {};
  var guestPicksCopy = {};
  for (var t = 0; t < touchedIds.length; t++) {
    if (guestPicks[touchedIds[t]]) guestPicksCopy[touchedIds[t]] = guestPicks[touchedIds[t]];
  }
  var guestTbCopy = (touchedIds.length && state.test && state.test.tiebreaker) ? state.test.tiebreaker : null;

  await _origBindAuthenticatedAccountToProfile(authUser, chosenMemberName);

  GUEST_BROWSING_MODE = false;
  safeSetStorage("sat_carry_guest_picks_v1", "");
  safeSetStorage("sat_guest_picks_touched_week_v1", "");

  if (!AUTH_SESSION || !AUTH_SESSION.boundProfileKey) return;
  var bKey = AUTH_SESSION.boundProfileKey;
  var existing = (state[bKey] && state[bKey].picks) || {};
  var toCarry = {};
  var count = 0;
  for (var id in guestPicksCopy) {
    if (existing[id]) continue;
    if (typeof isGameLockedByCommissioner === "function" && isGameLockedByCommissioner(id)) continue;
    toCarry[id] = guestPicksCopy[id];
    count++;
  }
  var carryTb = guestTbCopy && !(state[bKey] && state[bKey].tiebreaker);
  if (!count && !carryTb) return;

  confirmDanger("Add the " + count + " pick" + (count === 1 ? "" : "s") + " you made as a guest to " + (AUTH_SESSION.displayName || "your account") +
    "? Only games your account hasn't picked yet are filled; your existing picks stay as they are.", "Add picks", function() {
    if (!AUTH_SESSION || AUTH_SESSION.boundProfileKey !== bKey) return;
    if (!state[bKey]) state[bKey] = { picks: {}, tiebreaker: "", target: 20 };
    if (!state[bKey].picks) state[bKey].picks = {};
    for (var cid in toCarry) {
      if (!state[bKey].picks[cid]) state[bKey].picks[cid] = toCarry[cid];
    }
    if (carryTb && !state[bKey].tiebreaker) state[bKey].tiebreaker = guestTbCopy;
    state[bKey]._manualEditsThisWeek = true;
    if (AUTH_SESSION.email) {
      ensureCommissionerConfig().playerEmailsMap[standardizeParticipantName(AUTH_SESSION.displayName || "").toLowerCase()] = AUTH_SESSION.email;
    }
    saveCurrentState(bKey, false);
    regradeAllPoolMembersLive();
    renderAll();
    showAppToast("✅ Added your guest picks to " + AUTH_SESSION.displayName + ".");
  });
}

function startGuestPickingMode() {
  GUEST_BROWSING_MODE = true;
  if (!state.test) state.test = { picks: {}, tiebreaker: "28-24", target: 20, linkedMemberName: "" };
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (!state.test.picks[g.id]) state.test.picks[g.id] = g.rec;
  }
  activeProfile = "test";
  syncActiveProfileControlsUI();
  renderAll();
  showAppToast("👋 Guest Mode Active: Make all 23 picks below, then click 'Save Picks to an Account' to create your account!");
}

function openAuthModalCarryingGuestPicks(defaultMode) {
  AUTH_MODAL_MODE = defaultMode || "signup";
  openAuthModal();
}

function renderSimpleGuestAccountBar() {
  var el = document.getElementById("simple-guest-account-strip");
  if (!el) return;
  var cfg = ensureCommissionerConfig();
  var myPicks = (state[activeProfile] && state[activeProfile].picks) ? state[activeProfile].picks : {};
  var cStats = countMatchingPicksForSlate(myPicks, GAMES);

  // Lock line in the Picks head
  var lockPill = document.getElementById("simple-lock-deadline-pill");
  if (lockPill) {
    var lockedNow = isWeekLockedForActiveProfile();
    lockPill.className = "lock-text";
    if (cfg.lockMode === "friday_9pm_cst") {
      lockPill.textContent = lockedNow ? "Locked" : "Locks " + pickDeadlineLabel();
    } else if (cfg.lockMode === "global_locked") {
      lockPill.textContent = "Locked by the commissioner";
    } else if (cfg.lockMode === "rolling_kickoff") {
      lockPill.textContent = "Each game locks at kickoff";
    } else {
      lockPill.textContent = "Picks open";
    }
  }

  var recLog = cfg.savedReceiptsLog && cfg.savedReceiptsLog[activeProfile];
  var recTxtEl = document.getElementById("simple-receipt-status-text");
  if (recTxtEl) {
    recTxtEl.textContent = (recLog && recLog.sentAt)
      ? ("Submitted " + recLog.sentAt + ". You can still change picks until " + pickDeadlineLabel() + ".")
      : "";
    recTxtEl.style.color = "";
  }

  if (AUTH_SESSION && AUTH_SESSION.boundProfileKey && !GUEST_BROWSING_MODE) {
    // Signed in: the avatar and More > Account cover account and privacy.
    el.innerHTML = "";
  } else {
    var isGuestSim = (GUEST_BROWSING_MODE || activeProfile === "test");
    el.innerHTML =
      '<span>' + (isGuestSim ? 'Picking as a guest' : 'Not signed in') + '</span>' +
      '<span class="account-note-links">' +
        '<button type="button" class="link-btn" onclick="AUTH_MODAL_MODE = \'signin\'; openAuthModal()">Sign in</button>' +
        '<button type="button" class="link-btn" onclick="openAuthModalCarryingGuestPicks(\'signup\')" title="Your picks carry over to the new account">Create account</button>' +
        (!isGuestSim ? '<button type="button" class="link-btn" onclick="startGuestPickingMode()">Guest</button>' : '') +
      '</span>';
  }
}

async function saveAndSendPickConfirmationReceipt() {
  var cfg = ensureCommissionerConfig();
  if (isWeekLockedForActiveProfile()) {
    showAppToast("🔒 Picks are locked for the week (the " + pickDeadlineLabel() + " deadline has passed)!");
    return;
  }
  // If user is in Guest Mode and hasn't created an account yet, prompt them to enter an email or create an account while keeping their picks!
  var meta = getProfileDisplayMeta(activeProfile);
  var shownName = fixDisplaySpelling(meta.name); // Kinyion C -> Kinyon Cooper
  var userEmail = (AUTH_SESSION && AUTH_SESSION.email) || cfg.playerEmailsMap[standardizeParticipantName(meta.name).toLowerCase()] || "";

  saveCurrentState(activeProfile, false);
  var nowTime = new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CST";

  var picks = state[activeProfile] ? state[activeProfile].picks : {};
  var tb = (state[activeProfile] && state[activeProfile].tiebreaker) ? state[activeProfile].tiebreaker : "28-24";
  var summaryLines = [];
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var p = getResolvedPickForGame(picks, g, false);
    if (!p) {
      summaryLines.push("#" + g.id + " [NO PICK SELECTED]");
      continue;
    }
    var pts = getGamePickPts(g, isSameTeamPick(p, g.away, g));
    summaryLines.push("#" + g.id + " " + p + " (" + pts + "x)");
  }

  cfg.savedReceiptsLog[activeProfile] = {
    player: meta.name,
    email: userEmail || "Saved in Cloud Firestore",
    sentAt: nowTime,
    tiebreaker: tb,
    editableUntil: pickDeadlineLabel()
  };
  saveCommissionerConfigToCloud();
  renderSimpleGuestAccountBar();

  // Email receipt: the service sends your own saved picks to your verified email.
  var receiptPromise = startPickReceiptSend(true);
  // Only the signed-in account's own email is shown (never another member's from the pool list).
  var accountEmail = (typeof fbAuth !== "undefined" && fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || "";

  // Open a clean Confirmation Receipt modal with 1-click Email / Copy / Guest-to-Account upgrade
  document.getElementById("modal-team-title").textContent = "✅ Picks Saved & Confirmation Receipt (" + (state.weekLabel || ("Week " + state.currentWeek)) + ")";
  document.getElementById("modal-team-body").innerHTML =
    '<div style="background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">' +
      '<div style="font-size:0.88rem;font-weight:900;color:var(--text);margin-bottom:4px;">Picks saved at ' + nowTime + '</div>' +
      '<div id="receipt-email-status" class="email-status" role="status" aria-live="polite"></div>' +
      (typeof officialFormReceiptButtonHtml === "function" ? officialFormReceiptButtonHtml() : '') +
      '<div style="font-size:0.74rem;color:var(--text);line-height:1.45;">' +
        '• <strong>Player:</strong> ' + escapeShellHtml(shownName) + (accountEmail ? (' (' + escapeShellHtml(accountEmail) + ')') : '') + '<br>' +
        '• <strong>Tie-Breaker:</strong> ' + escapeHtml(tb) + '<br>' +
        '• <strong>🔒 Locked:</strong> tap <strong>Unlock picks</strong> to change anything before the official deadline, <strong>' + pickDeadlineLabel() + '</strong>. Then lock and send again.' +
      '</div>' +
    '</div>' +
    ((!AUTH_SESSION || GUEST_BROWSING_MODE) ? (
      '<div style="background:var(--raised);border:1px solid var(--border);border-radius:9px;padding:10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<span style="font-size:0.74rem;color:var(--text);">👋 <strong>Playing as a Guest?</strong> Create an account now and all 23 picks above will automatically attach to your account!</span>' +
        '<button type="button" class="btn-sm" style="background:var(--raised);color:var(--text);border:none;font-weight:900;" onclick="closeOppModal(); openAuthModalCarryingGuestPicks(\'signup\');">✨ Make an Account & Keep My Picks</button>' +
      '</div>'
    ) : '') +
    '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">' +
      '<input type="email" id="receipt-email-input" class="search-input" style="flex:1;padding:6px 9px;font-size:0.75rem;" placeholder="Your account email" value="' + String(accountEmail).replace(/"/g, '&quot;') + '" />' +
      '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:800;padding:6px 12px;" onclick="sendReceiptToCustomEmail()">📨 Send Email Receipt</button>' +
      '<button type="button" class="btn-sm" onclick="copyPicksToClipboard()">📋 Copy Receipt Text</button>' +
    '</div>' +
    '<textarea readonly rows="8" class="search-input" style="width:100%;font-family:monospace;font-size:0.71rem;color:var(--text);">' +
      'SEPARATED AT TURF PICK\'EM — ' + (state.weekLabel || ('Week ' + state.currentWeek)).toUpperCase() + ' CONFIRMATION RECEIPT\n' +
      'Player: ' + shownName + ' | Saved: ' + nowTime + '\n' +
      'Status: SAVED (Editable until ' + pickDeadlineLabel() + ' official lock)\n' +
      'Tie-Breaker: ' + tb + '\n' +
      '----------------------------------------\n' +
      summaryLines.join('\n') +
    '</textarea>';
  document.getElementById("opp-modal-backdrop").style.display = "flex";
  showReceiptSendStatus(receiptPromise);
}

// Receipts only go to your verified account email. A different address goes through
// Firebase's verified email change first (a link to the new address), then receipts go there.
function sendReceiptToCustomEmail() {
  var inp = document.getElementById("receipt-email-input");
  var email = inp ? String(inp.value || "").trim().toLowerCase() : "";
  var user = (typeof fbAuth !== "undefined" && fbAuth) ? fbAuth.currentUser : null;
  var box = document.getElementById("receipt-email-status");
  var say = function(html) { if (box) box.innerHTML = html; };
  if (!user) {
    say(receiptStatusHtml({ ok: false, code: "NOT_SIGNED_IN", error: EMAIL_ERROR_TEXT.NOT_SIGNED_IN }));
    return;
  }
  var accountEmail = String(user.email || "").toLowerCase();
  if (!email || email === accountEmail) {
    showReceiptSendStatus(startPickReceiptSend(true));
    return;
  }
  if (email.indexOf("@") === -1) {
    say('<span class="email-status-line is-error">Enter a valid email address.</span>');
    return;
  }
  confirmDanger("Receipts only go to your account email (" + accountEmail + "). We'll send a confirmation link to " + email +
    ". Once you open it, " + email + " becomes your account email and receipts go there.", "Send confirmation link", function() {
    user.verifyBeforeUpdateEmail(email).then(function() {
      say('<span class="email-status-line">Confirmation link sent to ' + escapeShellHtml(email) + '. Open it, sign in again, then tap Retry.</span>' +
        '<button type="button" class="link-btn" onclick="retryPickReceipt()">Retry</button>');
    }, function(err) {
      var code = err && err.code;
      var msg = code === "auth/requires-recent-login" ? "For your security, sign out and back in, then try again."
        : (code === "auth/operation-not-allowed" ? "This account's email can't be changed here (Google sign-in uses your Google address)."
        : ((err && err.message) || "Couldn't start the email change."));
      say('<span class="email-status-line is-error">' + escapeShellHtml(msg) + '</span>');
    });
  });
}

// "31-24", "31 - 24", "31 to 24" -> { high, low, total }; "55" -> { total: 55 }; else null.
function parseTiebreakerScore(tbStr) {
  var s = String(tbStr == null ? "" : tbStr).trim();
  var m = s.match(/(\d{1,3})\s*(?:-|–|—|to|:)\s*(\d{1,3})/i);
  if (m) {
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b)) return { high: Math.max(a, b), low: Math.min(a, b), total: a + b };
  }
  var t = s.match(/^(\d{1,3})$/);
  if (t && Number.isFinite(parseInt(t[1], 10))) return { high: null, low: null, total: parseInt(t[1], 10) };
  return null;
}

// Distance from the actual tiebreaker score; a blank or unreadable tiebreaker sorts last (999).
function parseTiebreakerDiff(tbStr, actualHigh, actualLow) {
  var tb = parseTiebreakerScore(tbStr);
  var hi = Number(actualHigh), lo = Number(actualLow);
  if (!tb || !Number.isFinite(hi) || !Number.isFinite(lo)) return 999;
  if (tb.high === null) return Math.abs(tb.total - (hi + lo));
  return Math.abs(tb.high - hi) + Math.abs(tb.low - lo);
}

function getTop5WeeklyWinnersList() {
  regradeAllPoolMembersLive();
  var pmList = (state.poolMembers || []).slice();
  var tbGame = resolveTiebreakerGame();
  var tbLs = tbGame ? LIVE_SCORES[tbGame.id] : null;
  var actualHigh = 28, actualLow = 24;
  if (tbLs && (tbLs.completed || tbLs.inProgress)) {
    actualHigh = Math.max(Number(tbLs.awayScore) || 0, Number(tbLs.homeScore) || 0);
    actualLow = Math.min(Number(tbLs.awayScore) || 0, Number(tbLs.homeScore) || 0);
  }

  var scoredList = [];
  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    if (!pm || pm.awaitingSheet) continue;
    var wkPts = Math.max(pm.livePts || 0, pm.finalPts || 0);
    // If no games have started yet for the active week, rank by projected EV or show Week 7's official weekly points if available
    var fallbackWk7Pts = (!countScoredGamesInLiveScores() && typeof pm.wk7ScoredPts === "number") ? pm.wk7ScoredPts : 0;
    var displayWkPts = countScoredGamesInLiveScores() > 0 ? wkPts : fallbackWk7Pts;
    var tbDiff = parseTiebreakerDiff(pm.tiebreaker, actualHigh, actualLow);
    scoredList.push({
      name: standardizeParticipantName(pm.name),
      wkPts: displayWkPts,
      won2x: pm.won2x || 0,
      won3x: pm.won3x || 0,
      tiebreaker: pm.tiebreaker || "—",
      tbDiff: tbDiff,
      newTotal: pm.newLiveTotal || pm.priorPts || 0
    });
  }

  scoredList.sort(function(a, b) {
    if (b.wkPts !== a.wkPts) return b.wkPts - a.wkPts;
    if (a.tbDiff !== b.tbDiff) return a.tbDiff - b.tbDiff;
    return b.newTotal - a.newTotal;
  });

  return scoredList.slice(0, 5);
}

function renderTop5WeeklyWinnersPodium() {
  var container = document.getElementById("top5-weekly-winners-container");
  if (!container) return;
  var top5 = getTop5WeeklyWinnersList();
  var hasLiveThisWeek = countScoredGamesInLiveScores() > 0;
  var wkTitle = hasLiveThisWeek
    ? (state.weekLabel || "Week 8") + " — Top 5 Weekly Winners (Most Points Gained This Week)"
    : "🏅 Top 5 Weekly Winners Podium — Most Points Gained in a Single Week (Last Completed Slate)";

  var cardsHtml = "";
  var medals = ["🥇 #1 Weekly Winner", "🥈 #2 Weekly", "🥉 #3 Weekly", "🏅 #4 Weekly", "🏅 #5 Weekly"];
  for (var i = 0; i < top5.length; i++) {
    var w = top5[i];
    var dogHits = [];
    if (w.won3x > 0) dogHits.push(w.won3x + "× 3pt Dog");
    if (w.won2x > 0) dogHits.push(w.won2x + "× 2pt Dog");
    var dogStr = dogHits.length > 0 ? dogHits.join(" + ") : "1x Core Slate";

    cardsHtml +=
      '<div class="top5-podium-card' + (i === 0 ? ' rank-1' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:0.68rem;font-weight:900;color:' + (i === 0 ? 'var(--gold)' : '#6ee7b7') + ';">' + medals[i] + '</span>' +
          '<span class="badge badge-ev" style="font-size:0.7rem;">+' + w.wkPts + ' pts</span>' +
        '</div>' +
        '<div style="font-size:0.92rem;font-weight:900;color:var(--text);margin-top:2px;">' + escapeHtml(w.name) + '</div>' +
        '<div style="font-size:0.69rem;color:var(--muted);">🎯 TB: <strong style="color:var(--text);">' + escapeHtml(w.tiebreaker) + '</strong> • ' + dogStr + '</div>' +
        '<div style="font-size:0.68rem;color:var(--text);">Overall Total: <strong>' + w.newTotal + ' pts</strong></div>' +
      '</div>';
  }

  container.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">' +
      '<div>' +
        '<strong style="font-size:0.88rem;color:var(--text);">' + wkTitle + '</strong>' +
        '<div style="font-size:0.71rem;color:var(--win);">Tracks the Top 5 players who gained the most points during the week (broken by closest Tie-Breaker score).</div>' +
      '</div>' +
      '<span class="badge badge-ev">🏆 Top 5 Weekly Standings</span>' +
    '</div>' +
    '<div class="top5-podium-grid">' + cardsHtml + '</div>';
}

function initSimpleModeAndCommish() {
  ensureCommissionerConfig();
  var savedSimple = safeGetStorage("sat_simple_ui_mode_v16");
  // Simple Mode is ON by default unless the user explicitly toggled Advanced Mode ("0")
  if (savedSimple === "0") {
    SIMPLE_UI_MODE = false;
  } else {
    SIMPLE_UI_MODE = true;
  }
  applySimpleUiModeDOM();
  renderCommishAnnouncementBanner();
  renderSimpleGuestAccountBar();
}

function toggleSimpleUiMode(forceVal) {
  SIMPLE_UI_MODE = (typeof forceVal === "boolean") ? forceVal : !SIMPLE_UI_MODE;
  safeSetStorage("sat_simple_ui_mode_v16", SIMPLE_UI_MODE ? "1" : "0");
  if (SIMPLE_UI_MODE && currentMainView === "condensed") {
    switchMainView("cards");
  }
  if (SIMPLE_UI_MODE && (currentFilter === "plusev" || currentFilter === "leverage" || currentFilter === "sway" || currentFilter === "diffs")) {
    setFilter("all");
  }
  applySimpleUiModeDOM();
  renderAll();
  showAppToast(SIMPLE_UI_MODE
    ? "✨ Simple Mode ON (Default): Clean Picks, Injuries, Last 5 Games, Live Scores & Top 5 Weekly/Season Leaderboard!"
    : "🧠 Advanced Mode ON: Unlocked EV Math, Pool Ownership Leverage, 5,000-Sim Monte Carlo & Side-by-Side Matrix!");
}

function applySimpleUiModeDOM() {
  if (!document.body) return;
  document.body.classList.toggle("simple-ui-mode", !!SIMPLE_UI_MODE);
  var btn = document.getElementById("btn-simple-mode-toggle");
  if (btn) {
    var lbl = btn.querySelector(".adv-label");
    if (lbl) lbl.textContent = SIMPLE_UI_MODE ? "Advanced: OFF" : "Advanced: ON";
    else btn.textContent = SIMPLE_UI_MODE ? "Advanced: OFF" : "Advanced: ON";
    btn.className = "btn-sm hdr-btn" + (!SIMPLE_UI_MODE ? " active" : "");
    btn.setAttribute("aria-pressed", SIMPLE_UI_MODE ? "false" : "true");
  }

  var sTb = document.getElementById("simple-tiebreaker-input");
  if (sTb && state[activeProfile]) {
    setInputValueUnlessEditing(sTb, state[activeProfile].tiebreaker || "28-24");
  }
}

function syncSimpleTiebreakerInput(val) {
  if (blockTiebreakerEditIfLocked()) return;
  var mainTb = document.getElementById("tiebreaker-input");
  if (mainTb) mainTb.value = val;
  lastLocalPickTs = Date.now(); // the cloud echo of an earlier save must not undo this edit
  saveCurrentState(activeProfile, true);
}

// A game is locked once ESPN shows it started or its scheduled kickoff has passed (ESPN's
// status can lag a few minutes; Thursday and Friday games lock on their own kickoff).
function hasGameKickedOff(gameId) {
  if (isGameStartedOrFinal(gameId)) return true;
  var g = findGameById(gameId);
  var ms = g && g.kickoffIso ? new Date(g.kickoffIso).getTime() : NaN;
  return !isNaN(ms) && Date.now() >= ms;
}

// A game ESPN never matched has no kickoff time, so it can't lock at kickoff on its own.
function hasKickoffTime(gameId) {
  var g = findGameById(gameId);
  return !!(g && g.kickoffIso && !isNaN(new Date(g.kickoffIso).getTime()));
}

// Players the commissioner let past this week's deadline (Submissions > Force unlock), keyed by
// standardized name with the week it applies to.
function isProfileForceUnlocked(profKey) {
  var cfg = ensureCommissionerConfig();
  var name = getLinkedMemberNameForProfile(profKey);
  var wk = name ? cfg.forceUnlocked[standardizeParticipantName(name).toLowerCase()] : null;
  return forceUnlockFlagIsCurrent(wk);
}

// The whole week is closed for the active player (as opposed to single games locking at kickoff).
function isWeekLockedForActiveProfile() {
  var cfg = ensureCommissionerConfig();
  if (AUTH_SESSION && AUTH_SESSION.adminUnlock) return false;
  if (cfg.lockMode === "global_locked") return true;
  if (cfg.lockMode === "friday_9pm_cst") return isPastPickDeadline() && !isProfileForceUnlocked(activeProfile);
  return false;
}

// The tiebreaker closes with the week, and at the tiebreaker game's kickoff whatever the lock
// mode. The sandbox ignores locks, as in pickSide.
function isTiebreakerLocked() {
  if (activeProfile === "test" || (AUTH_SESSION && AUTH_SESSION.adminUnlock)) return false;
  if (isWeekLockedForActiveProfile()) return true;
  var tbGame = resolveTiebreakerGame();
  return !!tbGame && (isGameLockedByCommissioner(tbGame.id) || hasGameKickedOff(tbGame.id));
}

// Puts the tiebreaker inputs back to the saved value when it is locked. True when it blocked.
function blockTiebreakerEditIfLocked() {
  if (!isTiebreakerLocked()) return false;
  var saved = (state[activeProfile] && state[activeProfile].tiebreaker) || "28-24";
  ["tiebreaker-input", "simple-tiebreaker-input"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = saved;
  });
  showAppToast("🔒 The tie-breaker is locked.");
  return true;
}

function isGameLockedByCommissioner(gameId) {
  var cfg = ensureCommissionerConfig();
  if (AUTH_SESSION && AUTH_SESSION.adminUnlock) return false;
  // Per-game override from the Slate tab (e.g. lock a Thursday game early, reopen a delayed one).
  var gameOverride = cfg.gameLockOverrides[String(gameId)];
  if (gameOverride === "locked") return true;
  if (gameOverride === "open") return false;
  if (cfg.lockMode === "global_locked") return true;
  if (cfg.lockMode === "friday_9pm_cst") {
    // A force-unlocked player can still change games that haven't kicked off.
    var pastDeadline = isPastPickDeadline() && !isProfileForceUnlocked(activeProfile);
    return pastDeadline || hasGameKickedOff(gameId);
  }
  if (cfg.lockMode === "rolling_kickoff") {
    // No kickoff time: lock at the pick deadline instead of never.
    return hasGameKickedOff(gameId) || (!hasKickoffTime(gameId) && isPastPickDeadline());
  }
  return false;
}

// The fields that differ between two commissionerConfigs: [{ path, value }], value undefined
// meaning delete. Maps are compared key by key; anything else (arrays, values) is one field.
function diffCommissionerConfig(base, next) {
  var changes = [];
  var isMap = function(v) { return !!v && typeof v === "object" && !Array.isArray(v); };
  var walk = function(a, b, path) {
    Object.keys(b).forEach(function(k) {
      if (b[k] === undefined) return;
      if (isMap(a[k]) && isMap(b[k])) walk(a[k], b[k], path.concat(k));
      else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changes.push({ path: path.concat(k), value: JSON.parse(JSON.stringify(b[k])) });
    });
    Object.keys(a).forEach(function(k) {
      if (a[k] !== undefined && b[k] === undefined) changes.push({ path: path.concat(k), value: undefined });
    });
  };
  walk(base || {}, next || {}, []);
  return changes;
}

function applyCommissionerConfigChanges(cfg, changes) {
  changes.forEach(function(c) {
    var o = cfg;
    for (var i = 0; i < c.path.length - 1; i++) {
      var k = c.path[i];
      if (!o[k] || typeof o[k] !== "object" || Array.isArray(o[k])) o[k] = {};
      o = o[k];
    }
    var last = c.path[c.path.length - 1];
    if (c.value === undefined) delete o[last]; else o[last] = c.value;
  });
}

// Writes `next` as per-field updates against `base` (a commissioner on another device, or the
// dues list, may have changed other fields since this device read them). With no base (the
// doc hasn't been read yet) the whole config is written. Only commissioners can write it
// (firestore.rules). Resolves once saved; the cloud copy then includes these changes.
function writeCommissionerConfigChanges(base, next) {
  var ref = fsDb.collection("pickem_v14").doc("shared_state");
  var now = new Date().toISOString();
  var whole = function() { return ref.set({ commissionerConfig: next, updatedAt: now }, { merge: true }); };
  var write;
  var changes = base ? diffCommissionerConfig(base, next) : null;
  if (!changes) {
    write = ref.update({ commissionerConfig: next, updatedAt: now });
  } else if (!changes.length) {
    return Promise.resolve();
  } else {
    var FP = firebase.firestore.FieldPath;
    var args = [];
    changes.forEach(function(c) {
      args.push(Reflect.construct(FP, ["commissionerConfig"].concat(c.path)), c.value === undefined ? firebase.firestore.FieldValue.delete() : c.value);
    });
    args.push("updatedAt", now);
    write = ref.update.apply(ref, args);
  }
  return write.catch(function(e) {
    if (e && e.code === "not-found") return whole();
    throw e;
  }).then(function() {
    if (!changes) CLOUD_COMMISSIONER_CONFIG = JSON.parse(JSON.stringify(next));
    else if (CLOUD_COMMISSIONER_CONFIG) applyCommissionerConfigChanges(CLOUD_COMMISSIONER_CONFIG, changes);
  });
}

// Saves this device's commissionerConfig: only what changed since the last cloud read (a key
// deleted here, like an unblocked account or a removed lock override, is deleted there). The
// returned promise rejects when the save fails or is skipped (`code` says why), and a failure
// is shown unless the device simply isn't the commissioner's.
function saveCommissionerConfigToCloud() {
  ensureCommissionerConfig();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  var job;
  if (!(typeof isVerifiedCommissioner === "function" && isVerifiedCommissioner())) job = Promise.reject({ code: "not-commissioner" });
  else if (!fsDb) job = Promise.reject({ code: "offline" });
  else if (isApplyingRemoteUpdate) job = Promise.reject({ code: "remote-update-in-progress" });
  else job = writeCommissionerConfigChanges(CLOUD_COMMISSIONER_CONFIG, state.commissionerConfig);
  // Handled here so callers that ignore the promise cause no unhandled rejection. Players hit
  // "not-commissioner" on every pick receipt, so that skip is silent.
  job.catch(function(e) { if (!e || e.code !== "not-commissioner") reportCloudSaveFailure("commissioner settings", e); });
  renderCommishAnnouncementBanner();
  renderSimpleGuestAccountBar();
  return job;
}

// Applies `mutate` to a copy of commissionerConfig, saves only what it changed, and only then
// makes it this device's config, so the screen shows what the cloud confirmed. Resolves with
// the new config.
function commitCommissionerConfig(mutate) {
  ensureCommissionerConfig();
  var before = JSON.parse(JSON.stringify(state.commissionerConfig));
  var next = JSON.parse(JSON.stringify(state.commissionerConfig));
  mutate(next);
  if (!fsDb || !(typeof isVerifiedCommissioner === "function" && isVerifiedCommissioner())) {
    return Promise.reject({ code: "permission-denied" });
  }
  return writeCommissionerConfigChanges(before, next).then(function() {
    state.commissionerConfig = next;
    safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
    return next;
  });
}

function renderCommishAnnouncementBanner() {
  var cfg = ensureCommissionerConfig();
  var bar = document.getElementById("commish-announcement-banner");
  var txt = document.getElementById("commish-announcement-text");
  if (!bar || !txt) return;
  var msg = String(cfg.announcementBanner || "").trim();
  if (msg && !window._dismissedCommishBannerSession) {
    txt.innerHTML = "📣 <strong>Commissioner Bulletin:</strong> " + escapeHtml(msg);
    bar.style.display = "flex";
  } else {
    bar.style.display = "none";
  }
}

function dismissCommishBanner() {
  window._dismissedCommishBannerSession = true;
  var bar = document.getElementById("commish-announcement-banner");
  if (bar) bar.style.display = "none";
}

function openCommissionerModal(defaultTab) {
  ensureCommissionerConfig();
  ACTIVE_COMMISH_TAB = defaultTab || ACTIVE_COMMISH_TAB || "submissions";
  var bd = document.getElementById("commish-modal-backdrop");
  if (bd) bd.style.display = "flex";
  switchCommissionerTab(ACTIVE_COMMISH_TAB);
}

function closeCommissionerModal() {
  var bd = document.getElementById("commish-modal-backdrop");
  if (bd) bd.style.display = "none";
}

function switchCommissionerTab(tabName) {
  ACTIVE_COMMISH_TAB = tabName;
  var tabs = ["submissions", "slate", "locks", "roster", "comms"];
  for (var i = 0; i < tabs.length; i++) {
    var b = document.getElementById("cm-tab-" + tabs[i]);
    if (b) b.className = "hub-tab-btn" + (tabs[i] === tabName ? " active" : "");
  }
  var cfg = ensureCommissionerConfig();
  var pill = document.getElementById("commish-mode-pill");
  if (pill) {
    pill.textContent = cfg.scrapingMode === "standalone"
      ? "🏟️ Standalone Site Mode"
      : "🤖 Hybrid Mode (WordPress/Gmail Scraper Active)";
  }
  renderCommissionerModalBody();
}

function setCommishSubFilter(flt) {
  COMMISH_SUBMISSION_FILTER = flt;
  renderCommissionerModalBody();
}

function applyCustomGameSwapInline(gameId) {
  var g = findGameById(gameId);
  if (!g) return;
  var aInp = document.getElementById("custom-swap-away-" + gameId);
  var hInp = document.getElementById("custom-swap-home-" + gameId);
  var newAway = aInp ? String(aInp.value || "").trim() : "";
  var newHome = hInp ? String(hInp.value || "").trim() : "";
  if (!newAway || !newHome) {
    showAppToast("⚠️ Enter both Away and Home team names.");
    return;
  }
  g.away = newAway;
  g.awayCode = getCleanTeamCode(newAway);
  g.home = newHome;
  g.homeCode = getCleanTeamCode(newHome);
  g.poolLine = newHome + " -3.5";
  g.liveLine = g.poolLine;
  commishUpdateGameSpread(gameId, g.poolLine);
  showAppToast("🔄 Swapped Game #" + gameId + " to " + newAway + " at " + newHome + "!");
}

function commishSwapIndividualGame(gameId, candidateIdxStr) {
  if (candidateIdxStr === "" || candidateIdxStr === null) return;
  var g = findGameById(gameId);
  if (!g) return;
  if (candidateIdxStr === "__CUSTOM__") {
    var box = document.getElementById("custom-swap-inline-" + gameId);
    if (box) box.style.display = "flex";
    return;
  }
  var cIdx = parseInt(candidateIdxStr, 10);
  var cg = ESPN_CANDIDATE_SLATE_GAMES[cIdx];
  if (!cg) return;

  var est = spreadWinProbEstimate(cg.spread);
  g.espnEventId = cg.espnEventId;
  g.cstWindow = cstWindowFromIsoDate(cg.dateIso) || g.cstWindow || "11:00 AM CST Window";
  g.away = cg.away;
  g.awayCode = getCleanTeamCode(cg.away);
  g.awayRec = cg.awayRec || "";
  g.home = cg.home;
  g.homeCode = getCleanTeamCode(cg.home);
  g.homeRec = cg.homeRec || "";
  g.poolLine = cg.spreadStr;
  g.liveLine = cg.spreadStr;
  g.awayPts = cg.favIsAway ? 1 : cg.dogPts;
  g.homePts = cg.favIsAway ? cg.dogPts : 1;
  g.awayProbEstimate = cg.favIsAway ? est.fav : est.dog;
  g.homeProbEstimate = cg.favIsAway ? est.dog : est.fav;
  g.rec = cg.favIsAway ? cg.away : cg.home;
  g.grokPick = g.rec;
  g.kinyionDefault = g.rec;
  g.mondayPoolLine = g.poolLine;
  g.mondayAwayPts = g.awayPts;
  g.mondayHomePts = g.homePts;
  g._mondayLockKey = normalizeTeamKey(g.away) + "@" + normalizeTeamKey(g.home);
  rebuildDynamicGameInsights(g);
  sanitizeStateForActiveSlate();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  pushCustomGamesToFirebase(); // other devices (and this one after a refresh) load the slate from the cloud
  renderAll();
  renderCommissionerModalBody();
  showAppToast("🔄 Swapped Game #" + gameId + " to " + g.away + " at " + g.home + " (" + g.poolLine + ")!");
}

function triggerWedThuAutomatedNudge() {
  var cfg = ensureCommissionerConfig();
  var pmList = state.poolMembers || [];
  var missing = [];
  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    var linkedPf = getProfileLinkedToMemberName(pm.name);
    var pMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
    var c = countMatchingPicksForSlate(pMap, GAMES);
    if (c.matched === 0 || pm.awaitingSheet) missing.push(pm.name);
  }
  var nowStr = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) + " CST";
  copyMissingPlayersList();
  showAppToast("Sending the Wed/Thu nudge…");
  callEmailService("sendWedThuNudge").then(function(res) {
    if (res.ok && !res.test) { cfg.lastWedThuNudgeSentAt = nowStr; saveCommissionerConfigToCloud(); }
    reportPoolEmailResult("Wed/Thu nudge", res);
  });
}

function triggerSaturdayMorningMasterSheetBroadcast() {
  var cfg = ensureCommissionerConfig();
  var nowStr = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) + " CST";
  state.fridayNightRevealOverride = true;
  saveCommissionerConfigToCloud();
  exportOfficialMasterCsv();
  renderAll();
  showAppToast("Picks revealed. Emailing the master sheet…");
  callEmailService("sendSaturdayMasterSheet").then(function(res) {
    if (res.ok && !res.test) { cfg.lastSatSheetSentAt = nowStr; saveCommissionerConfigToCloud(); }
    reportPoolEmailResult("Master sheet email", res);
  });
}

function renderCommissionerModalBody() {
  var body = document.getElementById("commish-modal-body");
  if (!body) return;
  var cfg = ensureCommissionerConfig();
  regradeAllPoolMembersLive();

  if (ACTIVE_COMMISH_TAB === "submissions") {
    var pmList = state.poolMembers || [];
    var submittedCount = 0;
    var missingList = [];
    var rowsHtml = "";

    for (var i = 0; i < pmList.length; i++) {
      var pm = pmList[i];
      var linkedPf = getProfileLinkedToMemberName(pm.name);
      var picksMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
      var cStats = countMatchingPicksForSlate(picksMap, GAMES);
      var isComplete = (cStats.matched >= GAMES.length);
      var hasAny = (cStats.matched > 0 && !pm.awaitingSheet);
      if (isComplete || hasAny) submittedCount++;
      else missingList.push(pm.name);

      if (COMMISH_SUBMISSION_FILTER === "submitted" && !hasAny) continue;
      if (COMMISH_SUBMISSION_FILTER === "missing" && hasAny) continue;

      var tbVal = (linkedPf && state[linkedPf.key] && state[linkedPf.key].tiebreaker) ? state[linkedPf.key].tiebreaker : (pm.tiebreaker || "—");
      var statusBadge = isComplete
        ? '<span class="badge badge-ev">✅ ' + cStats.matched + '/' + GAMES.length + ' Saved (Editable til ' + pickDeadlineLabel() + ')</span>'
        : (hasAny ? '<span class="badge badge-2x">⚠️ Partial (' + cStats.matched + '/' + GAMES.length + ')</span>' : '<span class="badge badge-3x">⏳ Missing (0/' + GAMES.length + ')</span>');

      var safeName = jsArgAttr(pm.name);
      rowsHtml += '<tr>' +
        '<td><strong>' + escapeHtml(pm.name) + '</strong>' + (linkedPf ? ' <span class="linked-lb-pill">App Account</span>' : '') + '</td>' +
        '<td>' + (pm.priorPts || 0) + ' pts</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><strong>' + escapeHtml(tbVal) + '</strong></td>' +
        '<td>' +
          '<button type="button" class="btn-sm" style="padding:3px 8px;font-size:0.67rem;border-color:var(--border);color:var(--warn);" onclick="commishQuickImpersonate(\'' + safeName + '\')">✏️ Enter/Edit Picks</button>' +
        '</td>' +
      '</tr>';
    }

    var missingCount = pmList.length - submittedCount;
    body.innerHTML =
      '<div class="commish-kpi-strip">' +
        '<div class="commish-kpi"><div class="metric-label">Active Week</div><div class="metric-val" style="color:var(--legacy-accent);">' + (state.weekLabel || "Week 8") + '</div><div class="metric-sub">' + GAMES.length + ' Games • Lock: ' + pickDeadlineLabel() + '</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Sheets Saved</div><div class="metric-val" style="color:var(--green);">' + submittedCount + ' / ' + pmList.length + '</div><div class="metric-sub">' + Math.round((submittedCount / Math.max(1, pmList.length)) * 100) + '% Pool Completion</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Wed/Thu Nudge Target</div><div class="metric-val" style="color:' + (missingCount > 0 ? 'var(--amber)' : 'var(--green)') + ';">' + missingCount + ' Missing</div><div class="metric-sub">' + (cfg.lastWedThuNudgeSentAt ? ('Last Nudge: ' + cfg.lastWedThuNudgeSentAt) : 'Auto Wed & Thu Nudge Ready') + '</div></div>' +
        '<div class="commish-kpi"><div class="metric-label">Sat Morning Sheet</div><div class="metric-val" style="color:var(--win);font-size:0.95rem;">' + (cfg.lastSatSheetSentAt ? 'Sent!' : 'Auto 8AM Sat') + '</div><div class="metric-sub">Reveals & Emails All Picks</div></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
        '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "all" ? " active" : "") + '" onclick="setCommishSubFilter(\'all\')">All (' + pmList.length + ')</button>' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "submitted" ? " active" : "") + '" onclick="setCommishSubFilter(\'submitted\')">✅ Saved (' + submittedCount + ')</button>' +
          '<button type="button" class="btn-sm' + (COMMISH_SUBMISSION_FILTER === "missing" ? " active" : "") + '" onclick="setCommishSubFilter(\'missing\')">⏳ Missing (' + missingCount + ')</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm" style="border-color:var(--amber);color:var(--warn);font-weight:800;" onclick="triggerWedThuAutomatedNudge()">⏰ Send Wed/Thu Nudge (' + missingCount + ')</button>' +
          '<button type="button" class="btn-sm" style="background:var(--raised);color:var(--text);border:none;font-weight:900;" onclick="triggerSaturdayMorningMasterSheetBroadcast()">📊 Trigger Sat Morning Reveal & Master CSV</button>' +
        '</div>' +
      '</div>' +
      '<div style="max-height:380px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:10px;">' +
        '<table class="condensed-table">' +
          '<thead><tr><th>Participant</th><th>Prior Pts</th><th>Submission Status</th><th>Tie-Breaker</th><th>Commissioner Action</th></tr></thead>' +
          '<tbody>' + (rowsHtml || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No players match that filter.</td></tr>') + '</tbody>' +
        '</table>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "slate") {
    var swapOptionsBase = '<option value="">🔄 Swap Game...</option><option value="__CUSTOM__">✏️ Type Custom Matchup...</option>';
    for (var sc = 0; sc < ESPN_CANDIDATE_SLATE_GAMES.length; sc++) {
      var cand = ESPN_CANDIDATE_SLATE_GAMES[sc];
      swapOptionsBase += '<option value="' + sc + '">🏈 ' + cand.away + ' at ' + cand.home + ' (' + cand.spreadStr + ')</option>';
    }

    var gameRows = "";
    for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
      var g = GAMES[gIdx];
      var isTb = (state.tiebreakerGameId === g.id || g.isTiebreaker);
      gameRows += '<tr>' +
        '<td><strong>#' + g.id + '</strong></td>' +
        '<td>' +
          '<div><strong>' + g.away + '</strong> <span style="color:var(--muted);">(' + g.awayPts + 'x)</span> at <strong>' + g.home + '</strong> <span style="color:var(--muted);">(' + g.homePts + 'x)</span></div>' +
          '<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><select class="search-input" style="padding:2px 6px;font-size:0.68rem;max-width:230px;color:var(--text);border-color:var(--border);" onchange="commishSwapIndividualGame(' + g.id + ', this.value)">' + swapOptionsBase + '</select></div>' +
          '<div id="custom-swap-inline-' + g.id + '" style="display:none;gap:4px;margin-top:4px;flex-wrap:wrap;align-items:center;">' +
            '<input type="text" id="custom-swap-away-' + g.id + '" class="search-input" style="width:98px;min-width:0;padding:3px 6px;font-size:0.68rem;" placeholder="Away Team" value="' + g.away.replace(/"/g, '&quot;') + '" />' +
            '<span style="font-size:0.66rem;color:var(--muted);">at</span>' +
            '<input type="text" id="custom-swap-home-' + g.id + '" class="search-input" style="width:98px;min-width:0;padding:3px 6px;font-size:0.68rem;" placeholder="Home Team" value="' + g.home.replace(/"/g, '&quot;') + '" />' +
            '<button type="button" class="btn-sm" style="padding:2px 7px;font-size:0.66rem;background:var(--accent);color:var(--on-accent);border:none;font-weight:800;" onclick="applyCustomGameSwapInline(' + g.id + ')">✓ Swap</button>' +
          '</div>' +
        '</td>' +
        '<td><input type="text" class="search-input" style="min-width:135px;padding:4px 7px;font-size:0.72rem;" value="' + (g.poolLine || "").replace(/"/g, '&quot;') + '" onchange="commishUpdateGameSpread(' + g.id + ', this.value)" title="Format: Favorite -Spread (e.g. Texas -10.5). Automatically recalculates 1x/2x/3x multiplier!" /></td>' +
        '<td><span class="badge ' + (Math.max(g.awayPts, g.homePts) === 3 ? 'badge-3x' : (Math.max(g.awayPts, g.homePts) === 2 ? 'badge-2x' : 'badge-1x')) + '">' + g.awayCode + ' ' + g.awayPts + 'x / ' + g.homeCode + ' ' + g.homePts + 'x</span></td>' +
        '<td><input type="text" class="search-input" style="min-width:130px;padding:4px 7px;font-size:0.71rem;" value="' + (g.kick || "").replace(/"/g, '&quot;') + '" onchange="commishUpdateGameKick(' + g.id + ', this.value)" /></td>' +
        '<td><input type="radio" name="commish-tb-radio" ' + (isTb ? 'checked' : '') + ' onchange="setTiebreakerGame(' + g.id + ', false); renderCommissionerModalBody();" /> TB</td>' +
        '<td>' + gameLockSelectHtml(g.id) + '</td>' +
      '</tr>';
    }

    var candidateHtml = "";
    if (ESPN_CANDIDATE_SLATE_GAMES.length > 0) {
      var candItems = "";
      for (var c = 0; c < ESPN_CANDIDATE_SLATE_GAMES.length; c++) {
        var cg = ESPN_CANDIDATE_SLATE_GAMES[c];
        candItems += '<label style="display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border-muted);padding:6px 8px;border-radius:7px;font-size:0.72rem;cursor:pointer;">' +
          '<input type="checkbox" class="espn-cand-chk" value="' + c + '" ' + (cg.preselected ? 'checked' : '') + ' />' +
          '<span><strong>' + cg.away + '</strong> at <strong>' + cg.home + '</strong> <span style="color:var(--legacy-accent);">(' + cg.spreadStr + ' • ' + cg.dogPts + 'x)</span></span>' +
        '</label>';
      }
      candidateHtml =
        '<div style="margin-top:10px;padding:10px;background:var(--raised);border:1px solid var(--border);border-radius:10px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
            '<strong style="font-size:0.78rem;color:var(--win);">🏈 ESPN Automated Candidate Games (' + ESPN_CANDIDATE_SLATE_GAMES.length + ' Found — Top 26 Pre-Checked, or Check/Uncheck Any Game You Want!):</strong>' +
            '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="commishPublishSelectedEspnSlate()">🚀 Publish Checked Games as Active Slate</button>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px;max-height:210px;overflow-y:auto;">' + candItems + '</div>' +
        '</div>';
    }

    body.innerHTML =
      '<div style="background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<div>' +
          '<div style="font-size:0.82rem;font-weight:800;color:var(--text);">🗓️ Automated 23-Game ESPN Slate Builder + Per-Game Swapper</div>' +
          '<div style="font-size:0.71rem;color:var(--muted);">Pull an automated 23-game list from ESPN, then <strong>swap any individual game</strong> using the <code>🔄 Swap Game...</code> dropdown on any row (or check/uncheck games before publishing)!</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
          '<input type="number" id="commish-espn-wk-input" class="search-input" style="width:78px;min-width:0;padding:5px 7px;font-size:0.74rem;font-weight:800;" value="' + (state.currentWeek || 8) + '" min="1" max="16" title="CFB Week Number" />' +
          '<button type="button" class="btn-sm" style="background:var(--raised);color:var(--text);border:none;font-weight:800;" onclick="commishFetchEspnCandidateGames()">⚡ Pull Automated ESPN Game List</button>' +
          '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--win);font-weight:800;" onclick="pushCustomGamesToFirebase(); showAppToast(\'☁️ Saved active 26-game slate & swaps to Firebase!\');">💾 Save Slate to Cloud</button>' +
        '</div>' +
      '</div>' +
      candidateHtml +
      '<div style="max-height:360px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:10px;margin-top:8px;">' +
        '<table class="condensed-table">' +
          '<thead><tr><th>#</th><th>Matchup & Individual Game Swapper</th><th>Locked Pool Spread</th><th>Multiplier</th><th>Kickoff / TV</th><th>Tiebreaker</th><th>Lock</th></tr></thead>' +
          '<tbody>' + gameRows + '</tbody>' +
        '</table>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "locks") {
    body.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">' +
        '<div class="side-box">' +
          '<div class="side-title"><span>🔒 Weekly Deadline Lock & Editable-All-Week Rule</span></div>' +
          '<div style="font-size:0.73rem;color:var(--muted);margin-bottom:8px;">Players can save picks on Tuesday/Wednesday, get an email receipt immediately, and still change their picks if injuries or second thoughts come up until Friday night:</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;font-size:0.75rem;">' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:8px;border-radius:8px;border:1px solid ' + (cfg.lockMode === "friday_9pm_cst" ? "#10b981" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-lock-mode" ' + (cfg.lockMode === "friday_9pm_cst" ? "checked" : "") + ' onchange="setCommishLockMode(\'friday_9pm_cst\')" />' +
              '<div><strong style="color:var(--win);">🌙 Weekly Deadline Lock: ' + pickDeadlineLabel() + ' (Editable All Week + Sat Morning Reveal)</strong><div style="font-size:0.69rem;color:var(--muted);">Even after saving & receiving an email receipt on Tuesday/Wednesday, players can freely revise picks until the deadline (' + pickDeadlineLabel() + ', set below). Saturday morning reveals all picks & emails the master spreadsheet!</div></div>' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:8px;border-radius:8px;border:1px solid ' + (cfg.lockMode === "rolling_kickoff" ? "#38bdf8" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-lock-mode" ' + (cfg.lockMode === "rolling_kickoff" ? "checked" : "") + ' onchange="setCommishLockMode(\'rolling_kickoff\')" />' +
              '<div><strong style="color:var(--text);">⏱️ Rolling Per-Game Kickoff Lock</strong><div style="font-size:0.69rem;color:var(--muted);">Each individual game locks automatically when it kicks off.</div></div>' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:8px;border-radius:8px;border:1px solid ' + (cfg.lockMode === "global_locked" ? "#ef4444" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-lock-mode" ' + (cfg.lockMode === "global_locked" ? "checked" : "") + ' onchange="setCommishLockMode(\'global_locked\')" />' +
              '<div><strong style="color:var(--loss);">🔒 Force Immediate Global Lock (Lock All 23 Now)</strong><div style="font-size:0.69rem;color:var(--muted);">Freezes all 23 games immediately for all players.</div></div>' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:8px;border-radius:8px;border:1px solid ' + (cfg.lockMode === "open" ? "#facc15" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-lock-mode" ' + (cfg.lockMode === "open" ? "checked" : "") + ' onchange="setCommishLockMode(\'open\')" />' +
              '<div><strong style="color:var(--warn);">🔓 Force Open / Unlocked</strong><div style="font-size:0.69rem;color:var(--muted);">Overrides the clock so players can edit picks at any time.</div></div>' +
            '</label>' +
          '</div>' +
        '</div>' +

        '<div class="side-box">' +
          '<div class="side-title"><span>📧 Automated Weekly Email Pipeline & WordPress Compatibility</span></div>' +
          '<div style="font-size:0.73rem;color:var(--muted);margin-bottom:8px;">Configure the automated emails for next season while keeping your current WordPress/Gmail scraper 100% active right now:</div>' +
          '<div style="display:flex;flex-direction:column;gap:7px;font-size:0.74rem;color:var(--text);margin-bottom:10px;">' +
            '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="checkbox" ' + (cfg.autoEmailReceiptOnSave !== false ? 'checked' : '') + ' onchange="state.commissionerConfig.autoEmailReceiptOnSave=this.checked; saveCommissionerConfigToCloud();" /> 📧 <strong>Instant Pick Confirmation Email on Save</strong> (Notes picks stay editable until ' + pickDeadlineLabel() + ')</label>' +
            '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="checkbox" ' + (cfg.autoWedThuNudgeEnabled !== false ? 'checked' : '') + ' onchange="state.commissionerConfig.autoWedThuNudgeEnabled=this.checked; saveCommissionerConfigToCloud();" /> ⏰ <strong>Automated Wednesday & Thursday Nudge Emails</strong> (Reminds players who haven\'t submitted yet)</label>' +
            '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="checkbox" ' + (cfg.autoSatMorningSheetEmail !== false ? 'checked' : '') + ' onchange="state.commissionerConfig.autoSatMorningSheetEmail=this.checked; saveCommissionerConfigToCloud();" /> 📊 <strong>Saturday Morning Auto-Reveal & Master Spreadsheet Email</strong> (Unlocks all picks & emails CSV to pool)</label>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--border-muted);font-size:0.74rem;">' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:7px;border-radius:7px;border:1px solid ' + (cfg.scrapingMode !== "standalone" ? "#10b981" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-scrape-mode" ' + (cfg.scrapingMode !== "standalone" ? "checked" : "") + ' onchange="setCommishScrapingMode(\'hybrid\')" />' +
              '<div><strong style="color:var(--win);">🤖 Current Season: Hybrid WordPress + Gmail Scraper Active</strong><div style="font-size:0.68rem;color:var(--muted);">Relies on your existing Gmail/WordPress sheet workflow with zero disruption.</div></div>' +
            '</label>' +
            '<label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;background:var(--panel-alt);padding:7px;border-radius:7px;border:1px solid ' + (cfg.scrapingMode === "standalone" ? "#38bdf8" : "var(--border-muted)") + ';">' +
              '<input type="radio" name="cm-scrape-mode" ' + (cfg.scrapingMode === "standalone" ? "checked" : "") + ' onchange="setCommishScrapingMode(\'standalone\')" />' +
              '<div><strong style="color:var(--text);">🏟️ Next Season Demo: 100% Standalone League Host</strong><div style="font-size:0.68rem;color:var(--muted);">Replaces WordPress & Google Forms completely next season.</div></div>' +
            '</label>' +
          '</div>' +
        '</div>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "roster") {
    var pmListR = state.poolMembers || [];
    var rosterRows = "";

    for (var r = 0; r < pmListR.length; r++) {
      var pmR = pmListR[r];
      var safeN = jsArgAttr(pmR.name);

      rosterRows += '<tr>' +
        '<td><strong>' + escapeHtml(pmR.name) + '</strong></td>' +
        '<td><input type="number" class="search-input" style="width:76px;min-width:0;padding:4px 6px;font-size:0.73rem;font-weight:800;" value="' + (pmR.priorPts || 0) + '" onchange="commishAdjustPlayerPriorPts(\'' + safeN + '\', this.value)" /></td>' +
        '<td><strong>' + (pmR.newLiveTotal || pmR.priorPts || 0) + ' pts</strong></td>' +
        '<td>' + (typeof accountLinkCellHtml === "function" ? accountLinkCellHtml(pmR.name) : '') + '</td>' +
        '<td style="display:flex;gap:4px;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm" style="padding:3px 8px;font-size:0.67rem;" onclick="manuallySetPlayerPicks(\'' + safeN + '\')">✏️ Edit Picks</button>' +
          '<button type="button" class="btn-sm" style="padding:3px 8px;font-size:0.67rem;" onclick="startPlayerPreview(\'' + safeN + '\')">Preview as player</button>' +
        '</td>' +
      '</tr>';
    }

    body.innerHTML =
      '<div class="commish-kpi-strip">' +
        '<div class="commish-kpi"><div class="metric-label">Total Pool Roster</div><div class="metric-val">' + pmListR.length + ' Players</div><div class="metric-sub">Active League Entries</div></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;background:var(--panel-alt);padding:8px 10px;border-radius:9px;border:1px solid var(--border-muted);">' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
          '<input type="text" id="commish-new-player-name" class="search-input" style="width:175px;min-width:0;padding:5px 8px;font-size:0.74rem;" placeholder="New Player Name (e.g. Alex B)" />' +
          '<input type="number" id="commish-new-player-pts" class="search-input" style="width:85px;min-width:0;padding:5px 8px;font-size:0.74rem;" placeholder="Prior Pts" value="0" />' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:800;" onclick="commishAddPoolMember()">➕ Add Player to Pool</button>' +
        '</div>' +
      '</div>' +
      '<div data-keep-scroll="roster-table" style="max-height:360px;overflow-y:auto;border:1px solid var(--border-muted);border-radius:10px;">' +
        '<table class="condensed-table">' +
          '<thead><tr><th>Player Name</th><th>Prior Season Pts (Editable)</th><th>New Live Total</th><th>Account</th><th>Picks</th></tr></thead>' +
          '<tbody>' + rosterRows + '</tbody>' +
        '</table>' +
      '</div>';
    return;
  }

  if (ACTIVE_COMMISH_TAB === "comms") {
    var recapText = generateCommissionerWeeklyRecapText();
    body.innerHTML =
      '<div class="side-box" style="margin-bottom:12px;">' +
        '<div class="side-title"><span>📌 Pin League-Wide Commissioner Announcement Banner</span></div>' +
        '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:6px;">Appears at the very top of the app for all connected users (leave blank to clear):</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<input type="text" id="commish-banner-input" class="search-input" style="flex:1;padding:7px 10px;font-size:0.78rem;" placeholder="e.g. Week 8 Picks Lock Friday at 9:00 PM CST! Everyone\'s picks reveal Saturday morning." value="' + escapeHtml(cfg.announcementBanner || "") + '" />' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:900;" onclick="commishSaveBanner()">📌 Publish Banner</button>' +
          '<button type="button" class="btn-sm" onclick="document.getElementById(\'commish-banner-input\').value=\'\'; commishSaveBanner();">Clear</button>' +
        '</div>' +
      '</div>' +
      '<div class="side-box">' +
        '<div class="side-title">' +
          '<span>📝 Auto-Generated Top 5 Weekly Winners & Overall Standings Post</span>' +
          '<button type="button" class="btn-sm" style="background:var(--accent);color:var(--on-accent);border:none;font-weight:800;" onclick="copyCommishRecapPost()">📋 Copy Recap & Standings Post</button>' +
        '</div>' +
        '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:6px;">Automatically lists the <strong>Top 5 Weekly Winners</strong> (who gained the most points that week) plus the full 89-player Overall Standings table:</div>' +
        '<textarea id="commish-recap-textarea" rows="12" class="search-input" style="width:100%;font-family:monospace;font-size:0.72rem;color:var(--text);">' + escapeHtml(recapText) + '</textarea>' +
      '</div>';
  }
}

function commishQuickImpersonate(memberName) {
  // Only a signed-in, verified commissioner (never a stand-in session) can edit another player.
  if (!AUTH_SESSION || !assertCommissionerRole("editing another player's picks")) return;
  AUTH_SESSION.adminUnlock = true;
  closeCommissionerModal();
  commissionerSwitchToMember(memberName);
  switchMainView("cards");
}

function copyMissingPlayersList() {
  var pmList = state.poolMembers || [];
  var missing = [];
  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    var linkedPf = getProfileLinkedToMemberName(pm.name);
    var pMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
    var c = countMatchingPicksForSlate(pMap, GAMES);
    if (c.matched === 0 || pm.awaitingSheet) missing.push(pm.name);
  }
  var txt = "⏰ Separated at Turf — " + (state.weekLabel || "Week 8") + " Wed/Thu Picks Nudge (Deadline: " + pickDeadlineLabel() + " • " + missing.length + " Missing):\n" + (missing.join(", ") || "All 89 players have submitted!");
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  showAppToast("📧 Copied " + missing.length + " missing player names to clipboard!");
}

// One CSV field: always quoted, quotes doubled, line breaks flattened (the app's own importer and
// the bot both read the file back line by line), so commas or quotes in a name never shift columns.
function csvCell(v) {
  return '"' + String(v == null ? "" : v).replace(/\r?\n|\r/g, " ").replace(/"/g, '""') + '"';
}

function exportOfficialMasterCsv() {
  regradeAllPoolMembersLive();
  var headers = ["Contestants"];
  for (var g = 0; g < GAMES.length; g++) {
    headers.push("G" + GAMES[g].id + " (" + GAMES[g].awayCode + "/" + GAMES[g].homeCode + ")");
  }
  headers.push("Prior Pts", "Tiebreaker", "Weekly Pts", "New Total");
  var csvRows = [headers.map(csvCell).join(",")];

  var pmList = (state.poolMembers || []).filter(function(pm) { return pm && pm.name; }).sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    var linkedPf = getProfileLinkedToMemberName(pm.name);
    var pMap = (linkedPf && state[linkedPf.key] && state[linkedPf.key].picks) ? state[linkedPf.key].picks : (pm.picks || {});
    var tb = (linkedPf && state[linkedPf.key] && state[linkedPf.key].tiebreaker) ? state[linkedPf.key].tiebreaker : (pm.tiebreaker || "");
    var row = [pm.name];
    for (var j = 0; j < GAMES.length; j++) {
      row.push(getResolvedPickForGame(pMap, GAMES[j], false) || "");
    }
    var wkPts = pm.awaitingSheet ? 0 : Math.max(pm.livePts || 0, pm.finalPts || 0);
    var totPts = (parseFloat(pm.priorPts) || 0) + wkPts;
    row.push(parseFloat(pm.priorPts) || 0, tb, wkPts, totPts);
    csvRows.push(row.map(csvCell).join(","));
  }

  var blob = new Blob([csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "College_Pickem_26_" + (state.weekLabel || "Week_8").replace(/\s+/g, "_") + "_Master.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  showAppToast("📊 Downloaded Official Master .CSV Spreadsheet (" + pmList.length + " players)!");
}

function commishUpdateGameSpread(gameId, newPoolLine) {
  var g = findGameById(gameId);
  if (!g || !newPoolLine) return;
  g.poolLine = String(newPoolLine).trim();
  var m = g.poolLine.match(/^(.+?)\s*-(\d+\.?\d*)/);
  if (m) {
    var favName = m[1].replace(/\*/g, "").trim();
    var sp = parseFloat(m[2]) || 3.5;
    var favIsAway = isSameTeamPick(favName, g.away, g) || normalizeTeamKey(g.away).indexOf(normalizeTeamKey(favName)) === 0;
    var dogPts = sp >= 14.5 ? 3 : (sp >= 7.5 ? 2 : 1);
    var est = spreadWinProbEstimate(sp);
    g.awayPts = favIsAway ? 1 : dogPts;
    g.homePts = favIsAway ? dogPts : 1;
    g.awayProbEstimate = favIsAway ? est.fav : est.dog;
    g.homeProbEstimate = favIsAway ? est.dog : est.fav;
  }
  g.mondayPoolLine = g.poolLine;
  g.mondayAwayPts = g.awayPts;
  g.mondayHomePts = g.homePts;
  g._mondayLockKey = normalizeTeamKey(g.away) + "@" + normalizeTeamKey(g.home);
  rebuildDynamicGameInsights(g);
  regradeAllPoolMembersLive();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  pushCustomGamesToFirebase(); // other devices (and this one after a refresh) load the slate from the cloud
  renderAll();
  renderCommissionerModalBody();
}

function commishUpdateGameKick(gameId, newKick) {
  var g = findGameById(gameId);
  if (!g) return;
  g.kick = String(newKick || "").trim();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  pushCustomGamesToFirebase(); // other devices (and this one after a refresh) load the slate from the cloud
  renderAll();
}

async function commishFetchEspnCandidateGames() {
  var wkInp = document.getElementById("commish-espn-wk-input");
  var wkNum = wkInp ? (parseInt(wkInp.value, 10) || 8) : 8;
  showAppToast("↻ Fetching Week " + wkNum + " FBS matchups & spreads from ESPN...");
  try {
    var data = await fetchJsonSafe(SB_BASE + "?groups=80&limit=300&seasontype=2&week=" + wkNum);
    var evs = (data && data.events) ? data.events : [];
    var cands = [];
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      var comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors || comp.competitors.length < 2) continue;
      var awayC = comp.competitors.find(function(x) { return x.homeAway === "away"; });
      var homeC = comp.competitors.find(function(x) { return x.homeAway === "home"; });
      if (!awayC || !homeC || !awayC.team || !homeC.team) continue;

      var awayName = awayC.team.location || awayC.team.shortDisplayName;
      var homeName = homeC.team.location || homeC.team.shortDisplayName;
      var spread = 3.5;
      var favIsAway = false;
      var spreadStr = homeName + " -3.5";
      if (comp.odds && comp.odds[0] && comp.odds[0].details) {
        spreadStr = comp.odds[0].details;
        var spM = spreadStr.match(/^([A-Za-z&.' -]+?)\s*-(\d+\.?\d*)/);
        if (spM) {
          spread = parseFloat(spM[2]) || 3.5;
          var favAbbr = spM[1].trim().toUpperCase();
          favIsAway = (awayC.team.abbreviation && awayC.team.abbreviation.toUpperCase() === favAbbr);
        }
      }
      var dogPts = spread >= 14.5 ? 3 : (spread >= 7.5 ? 2 : 1);
      var aRk = (awayC.curatedRank && awayC.curatedRank.current && awayC.curatedRank.current <= 25) ? awayC.curatedRank.current : 99;
      var hRk = (homeC.curatedRank && homeC.curatedRank.current && homeC.curatedRank.current <= 25) ? homeC.curatedRank.current : 99;
      var marqueeScore = (aRk <= 25 ? (30 - aRk) : 0) + (hRk <= 25 ? (30 - hRk) : 0);

      cands.push({
        espnEventId: ev.id,
        dateIso: ev.date,
        away: awayName,
        home: homeName,
        awayRec: (awayC.records && awayC.records[0]) ? awayC.records[0].summary : "",
        homeRec: (homeC.records && homeC.records[0]) ? homeC.records[0].summary : "",
        spread: spread,
        favIsAway: favIsAway,
        spreadStr: (favIsAway ? awayName : homeName) + " -" + spread,
        dogPts: dogPts,
        marqueeScore: marqueeScore,
        weekNum: wkNum
      });
    }
    cands.sort(function(a, b) { return b.marqueeScore - a.marqueeScore; });
    for (var j = 0; j < cands.length; j++) {
      cands[j].preselected = (j < 23);
    }
    ESPN_CANDIDATE_SLATE_GAMES = cands;
    renderCommissionerModalBody();
    showAppToast("✅ Loaded " + cands.length + " FBS games for Week " + wkNum + "! Use '🔄 Swap Game...' on any row or check/uncheck games.");
  } catch (e) {
    showAppToast("⚠️ Could not reach ESPN schedule endpoint.");
  }
}

async function commishPublishSelectedEspnSlate() {
  var chks = document.querySelectorAll(".espn-cand-chk:checked");
  if (!chks || chks.length === 0) {
    showAppToast("⚠️ Select at least 1 game to build a slate.");
    return;
  }
  // Every game needs a kickoff time so it locks at kickoff.
  for (var ci = 0; ci < chks.length; ci++) {
    var chk = ESPN_CANDIDATE_SLATE_GAMES[parseInt(chks[ci].value, 10)];
    if (chk && !chk.dateIso) {
      showAppToast("⚠️ " + chk.away + " at " + chk.home + " has no kickoff time from ESPN. Swap it out or reload the schedule.");
      return;
    }
  }
  saveCurrentWeekToArchive(false);
  var newGames = [];
  var targetWk = state.currentWeek || 8;
  for (var i = 0; i < chks.length; i++) {
    var idx = parseInt(chks[i].value, 10);
    var cg = ESPN_CANDIDATE_SLATE_GAMES[idx];
    if (!cg) continue;
    targetWk = cg.weekNum || targetWk;
    var est = spreadWinProbEstimate(cg.spread);
    var dogProb = est.dog;
    var awayProb = cg.favIsAway ? est.fav : est.dog;
    var homeProb = cg.favIsAway ? est.dog : est.fav;
    var awayPts = cg.favIsAway ? 1 : cg.dogPts;
    var homePts = cg.favIsAway ? cg.dogPts : 1;
    var rec = cg.favIsAway ? cg.away : cg.home;
    newGames.push({
      id: newGames.length + 1,
      espnEventId: cg.espnEventId,
      cstWindow: cstWindowFromIsoDate(cg.dateIso) || "11:00 AM CST Window",
      kickoffIso: cg.dateIso || "",
      away: cg.away, awayCode: getCleanTeamCode(cg.away), awayRec: cg.awayRec,
      home: cg.home, homeCode: getCleanTeamCode(cg.home), homeRec: cg.homeRec,
      kick: "Saturday CST",
      poolLine: cg.spreadStr,
      liveLine: cg.spreadStr,
      awayPts: awayPts, homePts: homePts,
      awayProbEstimate: awayProb, homeProbEstimate: homeProb,
      rec: rec, grokPick: rec, kinyionDefault: rec,
      tier: cg.dogPts >= 2 && dogProb >= 0.28 ? "Multiplier Upside Play" : "Lean",
      sway: null,
      rationale: "Published via Native Commissioner ESPN Slate Builder",
      insights: { vegas: cg.spreadStr, stats: "", matchup: "", splits: "" },
      awayInj: [], homeInj: []
    });
  }
  GAMES = newGames;
  LIVE_SCORES = {};
  state.currentWeek = targetWk;
  state.weekLabel = "Week " + targetWk;
  resetPoolPicksForNewWeek(false);
  // Push the slate first: an ESPN failure while enriching must not leave it local-only.
  var pushed = await pushCustomGamesToFirebase();
  var enriched = await syncAllLiveTrackingData(true);
  renderCommissionerModalBody();
  if (!pushed) showAppToast("⚠️ Week " + targetWk + " is NOT published: the cloud save failed, so only this device has the slate.");
  else if (!enriched) showAppToast("🚀 Published Week " + targetWk + " (" + GAMES.length + " games), but ESPN details didn't load. Tap Sync Live ESPN to retry.");
  else showAppToast("🚀 Published Week " + targetWk + " (" + GAMES.length + " games) to Cloud Firestore!");
}

function setCommishLockMode(mode) {
  ensureCommissionerConfig().lockMode = mode;
  saveCommissionerConfigToCloud();
  renderCommissionerModalBody();
  showAppToast("🔒 Updated Weekly Pick Lock Mode: " + mode.toUpperCase());
}

function setCommishScrapingMode(mode) {
  ensureCommissionerConfig().scrapingMode = mode;
  saveCommissionerConfigToCloud();
  switchCommissionerTab(ACTIVE_COMMISH_TAB);
  showAppToast(mode === "standalone"
    ? "🏟️ Standalone Site Mode enabled!"
    : "🤖 Hybrid Mode enabled (WordPress/Gmail weekly scraper active & protected)!");
}

function commishAutoFillMissingPlayers(strategy) {
  var pmList = state.poolMembers || [];
  var filledPlayers = 0;
  for (var i = 0; i < pmList.length; i++) {
    var pm = pmList[i];
    var c = countMatchingPicksForSlate(pm.picks || {}, GAMES);
    if (c.matched > 0 && !pm.awaitingSheet) continue;
    pm.picks = {};
    for (var g = 0; g < GAMES.length; g++) {
      var gm = GAMES[g];
      pm.picks[gm.id] = (strategy === "away") ? gm.away : (getTeamWinProb(gm, "away") >= getTeamWinProb(gm, "home") ? gm.away : gm.home);
    }
    pm.awaitingSheet = false;
    filledPlayers++;
  }
  regradeAllPoolMembersLive();
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  renderCommissionerModalBody();
  showAppToast("🛠️ Auto-filled picks for " + filledPlayers + " missing player(s)!");
}

function commishAdjustPlayerPriorPts(memberName, newPts) {
  var val = parseFloat(newPts) || 0;
  var pm = findPoolMemberByName(memberName);
  if (pm) pm.priorPts = val;
  var lb = findLeaderboardEntryByName(memberName);
  if (lb) lb.priorPts = val;
  regradeAllPoolMembersLive();
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  showAppToast("✅ Updated " + memberName + " prior points to " + val + " pts!");
}

function commishAddPoolMember() {
  var nameInp = document.getElementById("commish-new-player-name");
  var ptsInp = document.getElementById("commish-new-player-pts");
  var rawName = nameInp ? String(nameInp.value || "").trim() : "";
  if (!rawName) {
    showAppToast("⚠️ Enter a player name first.");
    return;
  }
  var stdName = standardizeParticipantName(rawName);
  if (findPoolMemberByName(stdName)) {
    showAppToast("ℹ️ " + stdName + " is already on the pool roster.");
    return;
  }
  var prior = ptsInp ? (parseFloat(ptsInp.value) || 0) : 0;
  if (!Array.isArray(state.poolMembers)) state.poolMembers = [];
  if (!Array.isArray(state.leaderboard)) state.leaderboard = [];
  state.poolMembers.push({
    name: stdName,
    priorPts: prior,
    priorRank: "New",
    tiebreaker: "28-24",
    picks: {},
    awaitingSheet: true,
    livePts: 0,
    inProgressPts: 0,
    finalPts: 0,
    newLiveTotal: prior
  });
  state.leaderboard.push({
    rank: String(state.leaderboard.length + 1),
    name: stdName,
    priorPts: prior,
    note: "Added by Commissioner"
  });
  if (nameInp) nameInp.value = "";
  regradeAllPoolMembersLive();
  pushWatchlistOrStandingsToFirebase();
  renderAll();
  renderCommissionerModalBody();
  showAppToast("✅ Added " + stdName + " to the pool roster & leaderboard!");
}

function commishSaveBanner() {
  var inp = document.getElementById("commish-banner-input");
  ensureCommissionerConfig().announcementBanner = inp ? String(inp.value || "").trim() : "";
  window._dismissedCommishBannerSession = false;
  saveCommissionerConfigToCloud();
  showAppToast(state.commissionerConfig.announcementBanner ? "📌 Published Commissioner Banner to all users!" : "Cleared Commissioner Banner.");
}

function generateCommissionerWeeklyRecapText() {
  regradeAllPoolMembersLive();
  var wkLbl = state.weekLabel || "Week 8";
  var top5 = getTop5WeeklyWinnersList();
  var pmList = (state.poolMembers || []).slice();

  var byTotal = pmList.slice().sort(function(a, b) {
    return (b.newLiveTotal || b.priorPts || 0) - (a.newLiveTotal || a.priorPts || 0);
  });

  var lines = [];
  lines.push("🏈 SEPARATED AT TURF PICK'EM — " + wkLbl.toUpperCase() + " OFFICIAL STANDINGS & TOP 5 WEEKLY WINNERS");
  lines.push("==========================================================================");
  lines.push("🏅 TOP 5 WEEKLY WINNERS (MOST POINTS GAINED THIS WEEK):");
  for (var w = 0; w < top5.length; w++) {
    lines.push("  #" + (w + 1) + " " + top5[w].name + " — +" + top5[w].wkPts + " pts (TB: " + top5[w].tiebreaker + " • Overall: " + top5[w].newTotal + " pts)");
  }
  lines.push("");
  if (byTotal[0]) {
    lines.push("👑 OVERALL SEASON LEADER: " + byTotal[0].name + " (" + (byTotal[0].newLiveTotal || byTotal[0].priorPts || 0) + " pts)");
  }
  lines.push("");
  lines.push("OVERALL STANDINGS (" + byTotal.length + " CONTESTANTS):");
  var prevPts = null, prevRank = 1;
  for (var i = 0; i < byTotal.length; i++) {
    var p = byTotal[i];
    var tot = p.newLiveTotal || p.priorPts || 0;
    var rkStr = "";
    if (tot === prevPts) {
      rkStr = "T-" + prevRank;
    } else {
      var tiedNext = (i + 1 < byTotal.length && (byTotal[i + 1].newLiveTotal || byTotal[i + 1].priorPts || 0) === tot);
      prevRank = i + 1;
      prevPts = tot;
      rkStr = tiedNext ? ("T-" + prevRank) : String(prevRank);
    }
    lines.push(rkStr + ". " + p.name + " - " + tot);
  }
  return lines.join("\n");
}

function copyCommishRecapPost() {
  var ta = document.getElementById("commish-recap-textarea");
  var txt = ta ? ta.value : generateCommissionerWeeklyRecapText();
  try { navigator.clipboard.writeText(txt); } catch (e) {}
  showAppToast("📋 Copied Top 5 Weekly Winners & Overall Standings Post to clipboard!");
}

