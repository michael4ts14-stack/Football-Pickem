// ============================================================================
// SEND TO SEPARATED AT TURF: opens the official weekly Google Form pre-filled
// with your name, picks and tie-breaker (you review and tap Submit on Google's
// page). The form's questions and exact answer text come from
// live_games/week_N_form (tools/form, GitHub Actions). Nothing is submitted
// from here; the app only records when you opened it.
// ============================================================================
var OFFICIAL_FORM = null;          // live_games/week_N_form
var OFFICIAL_FORM_WEEK = null;
var _officialFormUnsub = null;
var OFFICIAL_FORM_NAME_KEY = "sat_official_form_name_v1";

function subscribeOfficialForm() {
  var wk = parseInt(state.currentWeek, 10) || 0;
  if (typeof fsDb === "undefined" || !fsDb || !wk || wk === OFFICIAL_FORM_WEEK) return;
  OFFICIAL_FORM_WEEK = wk;
  if (_officialFormUnsub) { try { _officialFormUnsub(); } catch (e) {} }
  OFFICIAL_FORM = null;
  try {
    _officialFormUnsub = fsDb.collection("live_games").doc("week_" + wk + "_form").onSnapshot(function(doc) {
      OFFICIAL_FORM = (doc && doc.exists) ? doc.data() : null;
      renderOfficialFormBar();
    }, function() {});
  } catch (e) {}
}

// Picks + tie-breaker as one string, to notice changes after sending.
function officialFormPicksSignature() {
  var picks = getMyPicksMap();
  var parts = GAMES.map(function(g) { return g.id + ":" + (getResolvedPickForGame(picks, g, false) || ""); });
  return parts.join("|") + "#" + String((state[activeProfile] && state[activeProfile].tiebreaker) || "");
}

function officialFormSentInfo() {
  var p = state[activeProfile];
  var s = p && p.officialFormSent;
  return (s && s.week === (parseInt(state.currentWeek, 10) || 0)) ? s : null;
}

// A full name: first and last, and the last name isn't just an initial ("Michael A").
function isFullName(name) {
  var parts = String(name || "").trim().split(/\s+/);
  return parts.length >= 2 && parts[parts.length - 1].replace(/\./g, "").length >= 2;
}

// The name for the official form, full first and last name when we know it: what you typed
// last time, else your Google account's name, else your pool name (Kinyion C -> Kinyon Cooper).
// Blank (you type it) when all we have is an initial.
function officialFormDefaultName() {
  var candidates = [
    safeGetStorage(OFFICIAL_FORM_NAME_KEY),
    (typeof fbAuth !== "undefined" && fbAuth && fbAuth.currentUser && fbAuth.currentUser.displayName) || "",
    AUTH_SESSION && AUTH_SESSION.displayName,
    AUTH_SESSION && AUTH_SESSION.linkedMemberName
  ];
  for (var i = 0; i < candidates.length; i++) {
    var n = fixDisplaySpelling(String(candidates[i] || "").trim());
    if (isFullName(n)) return n;
  }
  return "";
}

// What the form would get, and anything that blocks opening it.
function buildOfficialFormSubmission(name) {
  var f = OFFICIAL_FORM;
  var problems = [];
  if (!f || !f.viewformUrl) return { problems: ["This week's official form isn't available in the app yet."], filled: 0, total: GAMES.length };
  if (f.weekMismatch) problems.push("The official form is for week " + f.formWeek + ", but the app is on week " + f.week + ".");
  var picks = getMyPicksMap();
  var params = ["usp=pp_url"];
  var add = function(entry, val) { params.push(encodeURIComponent(entry) + "=" + encodeURIComponent(val)); };
  if (f.nameQuestion) {
    if (!name || !/\S+\s+\S+/.test(name)) problems.push("Enter your full first and last name.");
    else if (!isFullName(name)) problems.push("Enter your full last name, not just an initial.");
    else add(f.nameQuestion.entry, name.trim());
  }
  var filled = 0, missing = [], notOnForm = [];
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    var q = f.games && f.games[String(g.id)];
    var pick = getResolvedPickForGame(picks, g, false);
    if (!pick) { missing.push(g.away + " at " + g.home); continue; }
    var side = isSameTeamPick(pick, g.away, g) ? "away" : (isSameTeamPick(pick, g.home, g) ? "home" : null);
    var choice = q && side ? q.choices[side] : null;
    if (!choice) { notOnForm.push(g.away + " at " + g.home); continue; }
    add(q.entry, choice);
    filled++;
  }
  if (missing.length) problems.push("No pick yet: " + missing.join(", ") + ".");
  if (notOnForm.length) problems.push("Not found on the official form (the commissioner has been flagged): " + notOnForm.join(", ") + ".");
  var tb = String((state[activeProfile] && state[activeProfile].tiebreaker) || "").replace(/\s+/g, "");
  var tbOk = /^\d{1,3}-\d{1,3}$/.test(tb) && parseInt(tb.split("-")[0], 10) >= parseInt(tb.split("-")[1], 10);
  if (f.tiebreakerQuestion) {
    if (!tbOk) problems.push("Tie-breaker must be a score with the highest first, like 28-24.");
    else add(f.tiebreakerQuestion.entry, tb);
  }
  return {
    problems: problems, filled: filled, total: GAMES.length, tiebreaker: tbOk ? tb : "",
    url: f.viewformUrl.replace(/\?.*$/, "") + "?" + params.join("&")
  };
}

function formatSentTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ---------- Lock picks -> Send picks ----------
// The main picks button: "Lock picks" saves, locks and emails your receipt; once locked it
// becomes "Send picks", which opens the official form with your picks filled in.
function primaryPicksActionIsSend() {
  return isCurrentProfileManuallyLocked() || isWeekLockedForActiveProfile();
}

function onPrimaryPicksAction() {
  if (primaryPicksActionIsSend()) { sendPicksToOfficialForm(); return; }
  var picks = getMyPicksMap();
  var done = countMatchingPicksForSlate(picks, GAMES).matched;
  if (done < GAMES.length) {
    confirmDanger("You've picked " + done + " of " + GAMES.length + " games. Lock your picks anyway?", "Lock picks", lockAndSavePicks);
    return;
  }
  lockAndSavePicks();
}

function lockAndSavePicks() {
  toggleManualUserPickLock(true);
  if (!isCurrentProfileManuallyLocked()) return; // past the deadline: toggle explained why
  saveAndSendPickConfirmationReceipt();
}

// The tie-breaker bar's button: unlock to edit, or lock exactly like the main button.
function onTieBreakerLockToggle() {
  if (isCurrentProfileManuallyLocked()) toggleManualUserPickLock(false);
  else onPrimaryPicksAction();
}

// Opens the pre-filled official form straight away when nothing needs fixing (a click, so
// the browser allows the new tab); otherwise the sheet shows what's missing.
function sendPicksToOfficialForm() {
  var name = officialFormDefaultName();
  var sub = buildOfficialFormSubmission(name);
  if (sub.problems.length) { openOfficialFormSheet(); return; }
  safeSetStorage(OFFICIAL_FORM_NAME_KEY, name);
  recordOfficialFormOpened(sub);
  window.open(sub.url, "_blank", "noopener");
  showAppToast("Opened the official form with your picks. Check it, then tap Submit on Google's page.");
}

function recordOfficialFormOpened() {
  if (state[activeProfile]) {
    state[activeProfile].officialFormSent = { at: new Date().toISOString(), week: parseInt(state.currentWeek, 10) || 0, sig: officialFormPicksSignature() };
    saveCurrentState(activeProfile);
  }
  renderOfficialFormBar();
}

// Big button in the receipt window after locking.
function officialFormReceiptButtonHtml() {
  return '<button type="button" class="btn-submit is-ready receipt-send-btn" onclick="closeOppModal(); sendPicksToOfficialForm();">' +
    'Send picks to Separated at Turf</button>';
}

// Status chip in the tie-breaker bar once you've locked your picks (the main button sends).
function renderOfficialFormBar() {
  var slot = document.getElementById("official-form-slot");
  if (!slot) {
    var actions = document.querySelector(".tb-card-actions");
    if (!actions) return;
    actions.insertAdjacentHTML("beforeend", '<span id="official-form-slot" class="official-form-slot"></span>');
    slot = document.getElementById("official-form-slot");
  }
  var locked = isCurrentProfileManuallyLocked();
  if (!locked || !OFFICIAL_FORM) { slot.innerHTML = ""; return; }
  var sent = officialFormSentInfo();
  var changed = sent && sent.sig !== officialFormPicksSignature();
  var chip = !sent ? "" : (changed
    ? '<span class="form-chip is-changed">Changed since sent</span>'
    : '<span class="form-chip"><i data-lucide="check"></i>Sent ' + escapeShellHtml(formatSentTime(sent.at)) + '</span>');
  slot.innerHTML = chip;
}

function openOfficialFormSheet() {
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!bd || !body) return;
  closePanelSheet();
  document.getElementById("panel-sheet-title").textContent = "Send to Separated at Turf";
  body.innerHTML =
    '<p class="sheet-meta">Opens the official form with your picks filled in. Check it, then tap Submit on Google\'s page.</p>' +
    '<label class="form-name-field"><span>Full name on the form (first and last)</span>' +
      '<input type="text" id="official-form-name" class="search-input" autocomplete="name" value="' + escapeShellHtml(officialFormDefaultName()) + '" oninput="refreshOfficialFormSummary()" /></label>' +
    '<div id="official-form-summary"></div>';
  bd.hidden = false;
  refreshOfficialFormSummary();
}

function refreshOfficialFormSummary() {
  var el = document.getElementById("official-form-summary");
  if (!el) return;
  var nameEl = document.getElementById("official-form-name");
  var sub = buildOfficialFormSubmission(nameEl ? nameEl.value : "");
  var ok = !sub.problems.length;
  var sent = officialFormSentInfo();
  el.innerHTML =
    '<p class="form-summary-line"><strong>' + sub.filled + ' of ' + sub.total + ' picks</strong>' + (sub.tiebreaker ? ' + tie-breaker (' + escapeShellHtml(sub.tiebreaker) + ')' : '') + ' will be filled in.</p>' +
    (ok ? '' : '<ul class="form-problems">' + sub.problems.map(function(p) { return '<li>' + escapeShellHtml(p) + '</li>'; }).join("") + '</ul>') +
    (sent ? '<p class="muted-note">Last opened ' + escapeShellHtml(formatSentTime(sent.at)) + (sent.sig !== officialFormPicksSignature() ? ' · your picks changed since then.' : '.') + '</p>' : '') +
    '<button type="button" class="btn-submit' + (ok ? ' is-ready' : '') + '" ' + (ok ? '' : 'disabled ') + 'onclick="confirmOpenOfficialForm()">Open the official form</button>';
}

function confirmOpenOfficialForm() {
  var nameEl = document.getElementById("official-form-name");
  var name = nameEl ? nameEl.value.trim() : "";
  var sub = buildOfficialFormSubmission(name);
  if (sub.problems.length) { refreshOfficialFormSummary(); return; }
  safeSetStorage(OFFICIAL_FORM_NAME_KEY, name);
  window.open(sub.url, "_blank", "noopener");
  // Recorded on your profile (synced like your picks when signed in; this device otherwise).
  recordOfficialFormOpened(sub);
  closePanelSheet();
}

// Commissioner: games the form map couldn't place, so nobody's link is guessed.
function officialFormCommishNoteHtml() {
  var f = OFFICIAL_FORM;
  if (!f) return '<p class="muted-note">Official form: not read yet this week.</p>';
  var bad = (f.unmatchedGames || []);
  return '<div class="form-commish-note"><strong>Official form:</strong> ' + (f.matchedCount || 0) + ' of ' + (f.slateCount || GAMES.length) + ' games matched' +
    (f.requiresSignIn ? ' · form requires Google sign-in' : '') +
    (bad.length ? '<ul class="form-problems">' + bad.map(function(u) { return '<li>' + escapeShellHtml(u.matchup + ": " + u.reason) + '</li>'; }).join("") + '</ul>' : '') + '</div>';
}

var _officialFormPrevRenderAll = renderAll;
renderAll = function() {
  var res = _officialFormPrevRenderAll.apply(this, arguments);
  subscribeOfficialForm();
  renderOfficialFormBar();
  return res;
};

var _officialFormPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _officialFormPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (body && ACTIVE_COMMISH_TAB === "submissions" && isVerifiedCommissioner()) body.insertAdjacentHTML("afterbegin", officialFormCommishNoteHtml());
  return res;
};
