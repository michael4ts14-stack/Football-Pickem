// ============================================================================
// APP SHELL: theme, Picks / Live / Standings / More navigation, icons, right rail.
// Loaded after commissioner-admin.js so it wraps the final switchMainView().
// Visual layer only: no pick, grading, sync or Firestore logic lives here.
// ============================================================================
var THEME_STORAGE_KEY = "sat_theme_v1";
var MAIN_VIEW_CONTAINER_IDS = ["full-cards-wrapper", "condensed-view-container", "live-tracker-view-container", "standings-view-container"];
var MORE_ACTIVE_SECTION = "";

function escapeShellHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// ---------- Theme ----------
function getAppTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setAppTheme(theme) {
  var t = (theme === "light") ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  safeSetStorage(THEME_STORAGE_KEY, t);
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", t === "light" ? "#f5f5f6" : "#0e0f11");
  if (currentMainView === "more") renderMoreView();
}

// ---------- Icons (Lucide) ----------
// Any <i data-lucide="name"> added by a render function is swapped for an SVG on the next frame.
var _iconRefreshQueued = false;
function refreshIcons() {
  if (_iconRefreshQueued) return;
  _iconRefreshQueued = true;
  requestAnimationFrame(function() {
    _iconRefreshQueued = false;
    if (!window.lucide || !document.querySelector("i[data-lucide]")) return;
    try {
      window.lucide.createIcons({ attrs: { "aria-hidden": "true", focusable: "false" } });
    } catch (e) {}
  });
}
// ---------- Emoji clean-up ----------
// Older render functions still put emoji in their labels. The redesign uses text (and Lucide
// icons) instead, so emoji are removed from on-screen text as it is rendered. Inputs, textareas
// and the printable pick sheet (which uses checkbox glyphs) are left alone.
var UI_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
var UI_EMOJI_TEST = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
function scrubEmojiText(node) {
  if (!node) return;
  if (node.nodeType === 3) {
    var t = node.nodeValue;
    if (!UI_EMOJI_TEST.test(t)) return;
    var p = node.parentNode;
    if (!p || p.closest && p.closest("textarea, script, style, #print-sheet-area")) return;
    var cleaned = t.replace(UI_EMOJI_RE, "").replace(/ {2,}/g, " ");
    if (!cleaned.trim()) {
      // A symbol-only label such as "✕" on a close button: keep it readable.
      var btn = p.closest && p.closest("button");
      if (btn && /[\u2715\u2716\u274C]/.test(t)) { cleaned = "Close"; }
      else if (btn && !btn.textContent.replace(t, "").trim()) { return; }
    } else if (/^\s/.test(t) === false) {
      cleaned = cleaned.replace(/^\s+/, "");
    }
    if (cleaned !== t) node.nodeValue = cleaned;
    return;
  }
  if (node.nodeType !== 1) return;
  var tag = node.nodeName;
  if (tag === "TEXTAREA" || tag === "SCRIPT" || tag === "STYLE" || node.id === "print-sheet-area") return;
  var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
  var list = [], n;
  while ((n = walker.nextNode())) list.push(n);
  for (var i = 0; i < list.length; i++) scrubEmojiText(list[i]);
}

if (window.MutationObserver) {
  new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "characterData") scrubEmojiText(m.target);
      for (var j = 0; j < m.addedNodes.length; j++) scrubEmojiText(m.addedNodes[j]);
    }
    refreshIcons();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  scrubEmojiText(document.body);
}

function iconHtml(name) {
  return '<i data-lucide="' + name + '"></i>';
}

// ---------- Navigation ----------
function syncNavAriaCurrent() {
  var ids = ["tab-mode-cards", "tab-mode-live", "tab-mode-standings", "mnav-cards", "mnav-live", "mnav-standings", "mnav-drawer"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) continue;
    if (el.classList.contains("active")) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }
  var sideItems = document.querySelectorAll(".app-sidebar .nav-item[data-more-section]");
  for (var j = 0; j < sideItems.length; j++) {
    var on = currentMainView === "more" && sideItems[j].getAttribute("data-more-section") === MORE_ACTIVE_SECTION;
    sideItems[j].classList.toggle("active", on);
    if (on) sideItems[j].setAttribute("aria-current", "page");
    else sideItems[j].removeAttribute("aria-current");
  }
}

var _shellOrigSwitchMainView = switchMainView;
switchMainView = function(mode) {
  var moreEl = document.getElementById("more-view-container");
  var moreTab = document.getElementById("mnav-drawer");
  if (mode === "more") {
    currentMainView = "more";
    for (var i = 0; i < MAIN_VIEW_CONTAINER_IDS.length; i++) {
      var c = document.getElementById(MAIN_VIEW_CONTAINER_IDS[i]);
      if (c) c.classList.add("hidden");
    }
    if (moreEl) moreEl.classList.remove("hidden");
    ["tab-mode-cards", "tab-mode-condensed", "tab-mode-live", "tab-mode-standings"].forEach(function(id) {
      var t = document.getElementById(id);
      if (t) t.classList.remove("active");
    });
    ["mnav-cards", "mnav-condensed", "mnav-live", "mnav-standings"].forEach(function(id) {
      var b = document.getElementById(id);
      if (b) b.className = "m-nav-btn";
    });
    if (moreTab) moreTab.className = "m-nav-btn active";
    renderMoreView();
    syncNavAriaCurrent();
    return;
  }
  MORE_ACTIVE_SECTION = "";
  if (moreEl) moreEl.classList.add("hidden");
  if (moreTab) moreTab.className = "m-nav-btn";
  var result = _shellOrigSwitchMainView.apply(this, arguments);
  // The table view belongs to Picks, so the phone Picks tab stays lit.
  if (currentMainView === "condensed") {
    var mCards = document.getElementById("mnav-cards");
    if (mCards) mCards.className = "m-nav-btn active";
    var tCards = document.getElementById("tab-mode-cards");
    if (tCards) tCards.className = "mode-tab-btn active";
  }
  syncNavAriaCurrent();
  return result;
};

// Opens a More section. On desktop the sidebar "More" items land here too.
function openMoreSection(section) {
  closeSettingsDrawer();
  closeEvSimulatorDrawer();
  if (section === "weeks") {
    // Past weeks currently live in the commissioner's Season archive box on Standings.
    switchMainView("standings");
    var hub = document.getElementById("season-archive-hub-container");
    if (hub) hub.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  MORE_ACTIVE_SECTION = section || "";
  switchMainView("more");
  var target = document.getElementById("more-sec-" + section);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- More screen ----------
function moreRowHtml(opts) {
  return '<button type="button" class="list-row' + (opts.danger ? " danger" : "") + '" onclick="' + opts.onclick + '">' +
    iconHtml(opts.icon) +
    '<span class="list-row-text"><span class="list-row-title">' + escapeShellHtml(opts.title) + '</span>' +
      (opts.sub ? '<span class="list-row-sub">' + escapeShellHtml(opts.sub) + '</span>' : '') +
    '</span>' +
    (opts.trailing || iconHtml("chevron-right")) +
  '</button>';
}

function renderMoreView() {
  var box = document.getElementById("more-view-container");
  if (!box) return;
  var isCommish = isVerifiedCommissioner();
  var meta = getProfileMetaByKey(activeProfile);
  var signedIn = !!AUTH_SESSION;
  var theme = getAppTheme();

  var accountSub = signedIn
    ? (meta.name + (AUTH_SESSION.email ? " · " + AUTH_SESSION.email : ""))
    : "Not signed in · picks are saved on this device";

  var html =
    '<header class="page-head"><div><p class="eyebrow">Separated at Turf</p><h1 class="page-title">More</h1></div></header>' +

    '<section class="list-section" id="more-sec-account" aria-labelledby="more-h-account">' +
      '<h2 class="section-label" id="more-h-account">Account</h2>' +
      '<div class="list-card">' +
        moreRowHtml({ icon: "circle-user", title: signedIn ? "My account" : "Sign in or create account", sub: accountSub, onclick: "openAuthModal()" }) +
        moreRowHtml({ icon: "eye-off", title: "Pick privacy", sub: "Hide my picks, Spy Shield, head-to-head settings", onclick: "openUserAndPrivacyModal()" }) +
        (!isCommish ? moreRowHtml({ icon: "crown", title: "Commissioner login", onclick: "quickSignInAsVerifiedCommissioner()" }) : '') +
      '</div>' +
    '</section>' +

    '<section class="list-section" id="more-sec-tools" aria-labelledby="more-h-tools">' +
      '<h2 class="section-label" id="more-h-tools">Tools</h2>' +
      '<div class="list-card">' +
        (isCommish ? moreRowHtml({ icon: "history", title: "Past weeks", sub: "Load an archived week's slate and grades", onclick: "openMoreSection('weeks')" }) : '') +
        moreRowHtml({ icon: "dices", title: "EV simulator", sub: "Expected points and 5,000-trial finish odds", onclick: "openEvSimulatorDrawer()" }) +
      '</div>' +
    '</section>' +

    '<section class="list-section" id="more-sec-export" aria-labelledby="more-h-export">' +
      '<h2 class="section-label" id="more-h-export">Export</h2>' +
      '<div class="list-card">' +
        moreRowHtml({ icon: "printer", title: "Print pick sheet", onclick: "printCheckmarkSheet()" }) +
        moreRowHtml({ icon: "copy", title: "Copy my picks", sub: "Plain text, ready to paste", onclick: "copyPicksToClipboard()" }) +
        (isCommish ? moreRowHtml({ icon: "download", title: "Download master .CSV", onclick: "exportOfficialMasterCsv()" }) : '') +
        (isCommish ? moreRowHtml({ icon: "upload", title: "Import / bot hub", sub: "Gmail bot, CSV / Excel, PDF slate, email, cloud", onclick: "openUnifiedImportModal('bot')" }) : '') +
      '</div>' +
    '</section>' +

    '<section class="list-section" id="more-sec-settings" aria-labelledby="more-h-settings">' +
      '<h2 class="section-label" id="more-h-settings">Settings</h2>' +
      '<div class="list-card">' +
        '<div class="list-row static">' + iconHtml(theme === "light" ? "sun" : "moon") +
          '<span class="list-row-text"><span class="list-row-title">Theme</span></span>' +
          '<div class="segmented" role="group" aria-label="Theme">' +
            '<button type="button" aria-pressed="' + (theme === "dark") + '" onclick="setAppTheme(\'dark\')">Dark</button>' +
            '<button type="button" aria-pressed="' + (theme === "light") + '" onclick="setAppTheme(\'light\')">Light</button>' +
          '</div>' +
        '</div>' +
        '<div class="list-row static">' + iconHtml("sliders-horizontal") +
          '<span class="list-row-text"><span class="list-row-title">Advanced mode</span><span class="list-row-sub">EV, ownership, leverage, table view and simulators</span></span>' +
          '<button type="button" class="switch" role="switch" aria-checked="' + (!SIMPLE_UI_MODE) + '" aria-label="Advanced mode" onclick="toggleSimpleUiMode(); renderMoreView();"><span></span></button>' +
        '</div>' +
        moreRowHtml({ icon: "settings", title: "All settings", sub: "Entries, layout, privacy, live sync, Field Sim", onclick: "openSettingsDrawer()" }) +
      '</div>' +
    '</section>' +

    (isCommish
      ? '<section class="list-section" id="more-sec-commish" aria-labelledby="more-h-commish">' +
          '<h2 class="section-label" id="more-h-commish">Commissioner</h2>' +
          '<div class="list-card">' +
            moreRowHtml({ icon: "crown", title: "Commissioner console", sub: "Submissions, master sheet, slate, locks, roster, banner, admins", onclick: "openCommissionerModal('submissions')" }) +
            '<div class="list-row static" id="more-bot-slot">' + iconHtml("bot") + '<span class="list-row-text"><span class="list-row-title">Gmail / ESPN bot</span></span></div>' +
          '</div>' +
        '</section>'
      : '');

  box.innerHTML = html;
  placeBotStatusPill();
}

// One bot-status element: sidebar footer on desktop, More > Commissioner on phones.
function placeBotStatusPill() {
  var pill = document.getElementById("bot-sync-pill");
  if (!pill) return;
  var slot = document.getElementById("more-bot-slot");
  var foot = document.querySelector(".app-sidebar .sidebar-foot");
  if (slot && window.innerWidth < 900) slot.appendChild(pill);
  else if (foot && pill.parentNode !== foot) foot.insertBefore(pill, foot.firstChild);
}

// ---------- Desktop right rail ----------
function renderRightRail() {
  var top5El = document.getElementById("rail-season-top5");
  var lastEl = document.getElementById("rail-last-week");
  if (!top5El || !lastEl) return;

  var rows = [];
  try { rows = buildPoolLeaderboardRows(); } catch (e) { rows = []; }
  var myName = (typeof getMyLeaderboardNameLower === "function") ? getMyLeaderboardNameLower() : "";

  var listHtml = "";
  var prevTot = null, prevRank = 1;
  for (var i = 0; i < rows.length && i < 5; i++) {
    var rw = rows[i];
    var tied = (rw.newTotal === prevTot) || (i + 1 < rows.length && rows[i + 1].newTotal === rw.newTotal);
    if (rw.newTotal !== prevTot) { prevRank = i + 1; prevTot = rw.newTotal; }
    var isMe = myName && rw.name.toLowerCase() === myName;
    listHtml += '<li class="rail-row' + (isMe ? ' is-me' : '') + '">' +
      '<span class="rank' + (prevRank <= 3 ? ' top3' : '') + '">' + (tied ? 'T' : '') + prevRank + '</span>' +
      '<span class="rail-name">' + escapeShellHtml(rw.name) + (isMe ? ' <span class="you-tag">You</span>' : '') + '</span>' +
      '<span class="rail-pts">' + rw.newTotal + '</span>' +
    '</li>';
  }
  top5El.innerHTML =
    '<div class="rail-card-head"><h2 class="rail-title">Season standings</h2>' +
      '<button type="button" class="link-btn" onclick="switchMainView(\'standings\')">View all</button></div>' +
    (listHtml ? '<ol class="rail-list">' + listHtml + '</ol>' : '<p class="muted-note">Standings appear once the pool syncs.</p>');

  // Last week: most recent archived week before the current one, as one sentence.
  var lastHtml = '<p class="rail-summary">No past weeks archived yet.</p>';
  var lastTitle = "Last week";
  try {
    var curNum = parseInt(state.currentWeek, 10) || 0;
    var arch = state.weekArchives || {};
    var best = null;
    for (var key in arch) {
      var snap = arch[key];
      if (!snap || !snap.weekNum || snap.weekNum >= curNum) continue;
      if (!best || snap.weekNum > best.weekNum) best = snap;
    }
    if (best) {
      var scored = (best.poolMembers || []).filter(function(pm) { return pm && !pm.awaitingSheet; }).map(function(pm) {
        return { name: standardizeParticipantName(pm.name), pts: Math.max(pm.finalPts || 0, pm.livePts || 0) };
      }).sort(function(x, y) { return y.pts - x.pts; });
      var mine = null, myPlace = 0;
      for (var m = 0; m < scored.length; m++) {
        if (myName && scored[m].name.toLowerCase() === myName) {
          mine = scored[m].pts;
          myPlace = 1 + scored.filter(function(o) { return o.pts > mine; }).length;
          break;
        }
      }
      var top = scored[0];
      var sentence = (mine !== null)
        ? 'You scored <strong>' + mine + ' pts</strong> in ' + escapeShellHtml(best.weekLabel || ("Week " + best.weekNum)) + ', ' + ordinalSuffix(myPlace) + ' best in the pool.'
        : (top ? escapeShellHtml(top.name) + ' had the top score in ' + escapeShellHtml(best.weekLabel || ("Week " + best.weekNum)) + ' with <strong>' + top.pts + ' pts</strong>.' : 'No scores recorded.');
      lastHtml = '<p class="rail-summary">' + sentence + '</p>';
    }
  } catch (e3) {}
  var ageEl = document.getElementById("live-sync-age");
  var syncLabel = (typeof LAST_LIVE_SYNC_AT !== "undefined" && LAST_LIVE_SYNC_AT && ageEl) ? ("Scores " + ageEl.textContent.toLowerCase()) : "";
  lastEl.innerHTML = '<div class="rail-card-head"><h2 class="rail-title">' + escapeShellHtml(lastTitle) + '</h2></div>' + lastHtml +
    (syncLabel ? '<p class="rail-sync"><span class="status-dot" aria-hidden="true"></span><span id="rail-sync-text">' + escapeShellHtml(syncLabel) + '</span></p>' : '');
}

function ordinalSuffix(n) {
  var s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

var _shellOrigRenderAll = renderAll;
renderAll = function() {
  var result = _shellOrigRenderAll.apply(this, arguments);
  try { renderRightRail(); } catch (e) {}
  if (currentMainView === "more") renderMoreView();
  return result;
};

var _shellOrigSyncCommishVis = syncCommissionerVisibilityDOM;
syncCommissionerVisibilityDOM = function() {
  var result = _shellOrigSyncCommishVis.apply(this, arguments);
  var isCommish = isVerifiedCommissioner();
  ["nav-more-weeks", "nav-more-commish"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle("commish-only-hidden", !isCommish);
  });
  return result;
};
