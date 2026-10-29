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
// Palettes are defined in css/tokens.css; the pre-paint script in index.html applies the saved one.
var APP_THEMES = [
  { id: "dark", name: "Stadium Night", bg: "#0e0f11", accent: "#c9a227" },
  { id: "light", name: "Daylight Broadcast", bg: "#f5f5f6", accent: "#b8860b" },
  { id: "turf", name: "Saturday Turf", bg: "#071710", accent: "#2ecc71" },
  { id: "gridiron-navy", name: "Prime Time Navy", bg: "#0a1120", accent: "#f4d35e" },
  { id: "crimson", name: "Tradition Crimson", bg: "#16090c", accent: "#e63946" },
  { id: "high-contrast", name: "High Contrast", bg: "#000000", accent: "#ffd60a" }
];

function getAppTheme() {
  var t = document.documentElement.getAttribute("data-theme");
  return APP_THEMES.some(function(x) { return x.id === t; }) ? t : "dark";
}

function setAppTheme(theme) {
  var t = APP_THEMES.some(function(x) { return x.id === theme; }) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", t);
  safeSetStorage(THEME_STORAGE_KEY, t);
  syncThemeColorMeta();
  if (currentMainView === "more") renderMoreView();
  if (isAppearanceSheetOpen()) renderAppearanceSheet();
}

function themeName(id) {
  var t = APP_THEMES.filter(function(x) { return x.id === id; })[0];
  return t ? t.name : "Stadium Night";
}

function screenPresetName(id) {
  var p = SCREEN_PRESETS.filter(function(x) { return x.id === id; })[0];
  return p ? p.name : "Standard matchup cards";
}

function syncThemeColorMeta() {
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (metaTheme && bg) metaTheme.setAttribute("content", bg);
}

// ---------- Custom colors ----------
var CUSTOM_COLORS_KEY = "pickem_custom_colors";
var CUSTOM_COLOR_VARS = ["--accent", "--accent-text", "--accent-soft", "--on-accent", "--bg", "--surface", "--raised", "--border"];

function hexToRgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map(function(v) { return ("0" + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join("");
}

function mixHex(a, b, amount) {
  var x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex([0, 1, 2].map(function(i) { return x[i] + (y[i] - x[i]) * amount; }));
}

// WCAG relative luminance and contrast ratio.
function relativeLuminance(hex) {
  var rgb = hexToRgb(hex) || [0, 0, 0];
  var c = rgb.map(function(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrastRatio(a, b) {
  var la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Inline overrides on <html> for the accent and backgrounds, plus the tokens that follow from
// them: a soft accent, button text that stays readable on the accent, and raised/border shades.
function customThemeVars(colors) {
  var vars = {};
  var accent = hexToRgb(colors.accent) ? colors.accent : null;
  var bg = hexToRgb(colors.bg) ? colors.bg : null;
  var surface = hexToRgb(colors.surface) ? colors.surface : null;
  var baseBg = bg || getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0e0f11";
  var darkBase = relativeLuminance(baseBg) < 0.2;
  if (accent) {
    vars["--accent"] = accent;
    vars["--accent-soft"] = accent + "26"; // 15% alpha
    vars["--on-accent"] = contrastRatio(accent, "#0e0f11") >= contrastRatio(accent, "#ffffff") ? "#0e0f11" : "#ffffff";
    var accentText = accent;
    for (var i = 0; i < 6 && contrastRatio(accentText, baseBg) < 4.5; i++) accentText = mixHex(accentText, darkBase ? "#ffffff" : "#000000", 0.2);
    vars["--accent-text"] = accentText;
  }
  if (bg) vars["--bg"] = bg;
  if (surface) {
    vars["--surface"] = surface;
    vars["--raised"] = mixHex(surface, darkBase ? "#ffffff" : "#000000", 0.06);
    vars["--border"] = mixHex(surface, darkBase ? "#ffffff" : "#000000", 0.14);
  }
  return vars;
}

function applyCustomThemeColors(colors) {
  var root = document.documentElement;
  CUSTOM_COLOR_VARS.forEach(function(k) { root.style.removeProperty(k); });
  var saved = { accent: colors.accent || "", bg: colors.bg || "", surface: colors.surface || "" };
  var vars = customThemeVars(saved);
  Object.keys(vars).forEach(function(k) { root.style.setProperty(k, vars[k]); });
  saved.vars = vars;
  safeSetStorage(CUSTOM_COLORS_KEY, JSON.stringify(saved));
  if (!state.uiPrefs) state.uiPrefs = {};
  state.uiPrefs.customColors = saved;
  syncThemeColorMeta();
}

function getCustomThemeColors() {
  try { return JSON.parse(safeGetStorage(CUSTOM_COLORS_KEY) || "null") || {}; } catch (e) { return {}; }
}

function resetCustomThemeColors() {
  var root = document.documentElement;
  CUSTOM_COLOR_VARS.forEach(function(k) { root.style.removeProperty(k); });
  try { localStorage.removeItem(CUSTOM_COLORS_KEY); } catch (e) {}
  if (state.uiPrefs) delete state.uiPrefs.customColors;
  syncThemeColorMeta();
  if (isAppearanceSheetOpen()) renderAppearanceSheet();
}

// ---------- Screen setup presets ----------
var SCREEN_PRESET_KEY = "pickem_screen_preset";
var SCREEN_PRESETS = [
  { id: "standard", name: "Standard matchup cards", sub: "Full cards with team details" },
  { id: "compact-grid", name: "Compact slate", sub: "Tighter cards, two columns on wider screens" },
  { id: "gameday-live", name: "Saturday Game Day", sub: "Opens to Live on Saturdays, live scores pinned on top, auto-refresh on" },
  { id: "quick-sheet", name: "Quick-pick sheet", sub: "One row per game for fast picking" }
];

function getScreenPreset() {
  var p = document.documentElement.dataset.screenPreset;
  return SCREEN_PRESETS.some(function(x) { return x.id === p; }) ? p : "standard";
}

function setScreenPreset(preset) {
  var p = SCREEN_PRESETS.some(function(x) { return x.id === preset; }) ? preset : "standard";
  document.documentElement.dataset.screenPreset = p;
  safeSetStorage(SCREEN_PRESET_KEY, p);
  if (!state.uiPrefs) state.uiPrefs = {};
  state.uiPrefs.screenPreset = p;
  if (p === "gameday-live") startGameDayAutoSync();
  renderAll();
  if (isAppearanceSheetOpen()) renderAppearanceSheet();
}

function isSaturdayCentral() {
  try { return new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }) === "Sat"; } catch (e) { return false; }
}

function startGameDayAutoSync() {
  if (typeof livePollTimer !== "undefined" && !livePollTimer && typeof toggleAutoPoll === "function") toggleAutoPoll(true);
}

// Boot: bring back appearance kept in state when this device's storage was cleared, and open
// Saturday's Game Day screen.
function restoreAppearanceOnBoot() {
  var prefs = state.uiPrefs || {};
  if (!safeGetStorage(CUSTOM_COLORS_KEY) && prefs.customColors && (prefs.customColors.accent || prefs.customColors.bg || prefs.customColors.surface)) {
    applyCustomThemeColors(prefs.customColors);
  }
  if (!safeGetStorage(SCREEN_PRESET_KEY) && prefs.screenPreset) {
    document.documentElement.dataset.screenPreset = prefs.screenPreset;
    safeSetStorage(SCREEN_PRESET_KEY, prefs.screenPreset);
  }
  syncThemeColorMeta();
  if (getScreenPreset() === "gameday-live" && isSaturdayCentral()) {
    switchMainView("live");
    startGameDayAutoSync();
  }
}

// Compact score strip for the Game Day preset, pinned above Picks and Standings.
function gameDayStripHtml() {
  var chips = [];
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i], ls = LIVE_SCORES[g.id];
    if (!ls || !(ls.inProgress || ls.completed)) continue;
    var al = ls.inProgress ? liveAlertForGame(g) : null;
    var alLabel = al && al.alertState !== "none" ? ({ "redzone-4q-combo": "Red zone · crunch time", "redzone": "Red zone", "4q-sweat": al.overtime ? "OT sweat" : "4Q sweat", "upset-alert": "Upset alert" }[al.alertState]) : "";
    chips.push('<button type="button" class="gd-chip' + (ls.inProgress ? ' is-live' : '') + liveAlertClass(al) + '" onclick="openGameDetail(' + g.id + ')"' + (alLabel ? ' aria-label="' + escapeShellHtml(g.away + " at " + g.home + ", " + alLabel) + '"' : '') + '>' +
      '<span>' + escapeShellHtml(g.awayCode) + ' ' + (ls.awayScore || 0) + '</span>' +
      '<span>' + escapeShellHtml(g.homeCode) + ' ' + (ls.homeScore || 0) + '</span>' +
      '<span class="gd-chip-status">' + escapeShellHtml(ls.completed ? "Final" : (alLabel ? alLabel + " · " : "") + (ls.detail || "Live")) + '</span>' +
    '</button>');
  }
  return chips.length ? chips.join("") : '<span class="gd-empty">No games have kicked off yet.</span>';
}

function renderGameDayStrips() {
  var on = getScreenPreset() === "gameday-live";
  ["full-cards-wrapper", "standings-view-container"].forEach(function(id) {
    var host = document.getElementById(id);
    if (!host) return;
    var strip = host.querySelector(":scope > .gameday-strip");
    if (!on) { if (strip) strip.hidden = true; return; }
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "gameday-strip";
      strip.setAttribute("aria-label", "Live scores");
      host.insertBefore(strip, host.firstChild);
    }
    strip.hidden = false;
    strip.innerHTML = gameDayStripHtml();
  });
}

// ---------- Live game day glow (More > Appearance) ----------
// html[data-glow]: "pulse" (default; static when the device asks for reduced motion), "static", "off".
var GLOW_MODE_KEY = "pickem_glow_mode";
var GLOW_MODES = [{ id: "pulse", name: "Animated pulse" }, { id: "static", name: "Static glow" }, { id: "off", name: "Off" }];

function getGlowMode() {
  var m = document.documentElement.dataset.glow;
  return GLOW_MODES.some(function(x) { return x.id === m; }) ? m : "pulse";
}

function setGlowMode(mode) {
  var m = GLOW_MODES.some(function(x) { return x.id === mode; }) ? mode : "pulse";
  document.documentElement.dataset.glow = m;
  safeSetStorage(GLOW_MODE_KEY, m);
  if (!state.uiPrefs) state.uiPrefs = {};
  state.uiPrefs.glowMode = m;
  if (isAppearanceSheetOpen()) renderAppearanceSheet();
}

// Count of red zone / 4Q sweat games on the Live nav buttons, so it shows from any screen.
function updateLiveNavBadge() {
  var n = (typeof liveAlertCounts === "function") ? liveAlertCounts().any : 0;
  ["tab-mode-live", "mnav-live"].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    var badge = btn.querySelector(".nav-alert-badge");
    if (!n) { if (badge) badge.remove(); btn.removeAttribute("data-alerts"); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-alert-badge";
      btn.appendChild(badge);
    }
    badge.textContent = n;
    badge.setAttribute("aria-label", n + (n === 1 ? " game" : " games") + " in the red zone or a 4th-quarter sweat");
    btn.setAttribute("data-alerts", n);
  });
}

// ---------- Appearance sheet (More > Appearance) ----------
function isAppearanceSheetOpen() {
  var bd = document.getElementById("panel-sheet-backdrop");
  var title = document.getElementById("panel-sheet-title");
  return !!(bd && !bd.hidden && title && title.textContent === "Appearance");
}

function openAppearanceSheet() {
  var bd = document.getElementById("panel-sheet-backdrop");
  if (!bd) return;
  closePanelSheet();
  document.getElementById("panel-sheet-title").textContent = "Appearance";
  renderAppearanceSheet();
  bd.hidden = false;
}

function currentTokenHex(name) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : (/^#[0-9a-f]{8}$/i.test(v) ? v.slice(0, 7) : "#000000");
}

function renderAppearanceSheet() {
  var body = document.getElementById("panel-sheet-body");
  if (!body) return;
  var theme = getAppTheme(), preset = getScreenPreset(), custom = getCustomThemeColors();
  var colorRow = function(key, label, token) {
    var val = custom[key] || currentTokenHex(token);
    return '<label class="color-row"><span class="color-row-label">' + label + '</span>' +
      '<input type="color" id="custom-color-' + key + '" value="' + val + '" oninput="onCustomColorInput()" />' +
      '<code class="color-hex" id="custom-color-' + key + '-hex">' + val.toUpperCase() + '</code></label>';
  };
  body.innerHTML =
    '<h3 class="sheet-subhead">Color palette</h3>' +
    '<div class="palette-grid">' +
      APP_THEMES.map(function(t) {
        return '<button type="button" class="palette-btn" aria-pressed="' + (t.id === theme) + '" onclick="setAppTheme(\'' + t.id + '\')">' +
          '<span class="palette-swatch" style="background:' + t.bg + '"><span style="background:' + t.accent + '"></span></span>' +
          '<span>' + escapeShellHtml(t.name) + '</span></button>';
      }).join("") +
    '</div>' +
    '<h3 class="sheet-subhead">Custom colors</h3>' +
    '<p class="sheet-meta">Applied on top of the palette. Button text switches between dark and light so it stays readable.</p>' +
    colorRow("accent", "Buttons and accent", "--accent") +
    colorRow("bg", "App background", "--bg") +
    colorRow("surface", "Cards", "--surface") +
    '<button type="button" class="btn-sm" onclick="resetCustomThemeColors()"' + ((custom.accent || custom.bg || custom.surface) ? '' : ' disabled') + '>Reset to theme default</button>' +
    '<h3 class="sheet-subhead">Live game day glow</h3>' +
    '<p class="sheet-meta">Outlines on games in the red zone or a one-score 4th quarter.</p>' +
    '<div class="segmented" role="group" aria-label="Live game day glow">' +
      GLOW_MODES.map(function(m) {
        return '<button type="button" aria-pressed="' + (m.id === getGlowMode()) + '" onclick="setGlowMode(\'' + m.id + '\')">' + m.name + '</button>';
      }).join("") +
    '</div>' +
    '<h3 class="sheet-subhead">Screen setup</h3>' +
    '<div class="list-card">' +
      SCREEN_PRESETS.map(function(p) {
        return '<button type="button" class="list-row preset-row" aria-pressed="' + (p.id === preset) + '" onclick="setScreenPreset(\'' + p.id + '\')">' +
          iconHtml(p.id === preset ? "circle-check" : "circle") +
          '<span class="list-row-text"><span class="list-row-title">' + escapeShellHtml(p.name) + '</span><span class="list-row-sub">' + escapeShellHtml(p.sub) + '</span></span></button>';
      }).join("") +
    '</div>';
}

// Color inputs update live without redrawing the sheet (a redraw would close the picker).
function onCustomColorInput() {
  var colors = {};
  ["accent", "bg", "surface"].forEach(function(k) {
    var el = document.getElementById("custom-color-" + k);
    var prev = getCustomThemeColors()[k];
    // Only colors the player changed become overrides.
    if (el && (prev || el.value.toLowerCase() !== currentTokenHex("--" + (k === "accent" ? "accent" : k)).toLowerCase())) colors[k] = el.value;
    var hex = document.getElementById("custom-color-" + k + "-hex");
    if (hex && el) hex.textContent = el.value.toUpperCase();
  });
  applyCustomThemeColors(colors);
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
// Display-only name fix. Pool sheets and the matching key spell him "Kinyion C"
// (standardizeParticipantName); he is Kinyon Cooper. Data, keys and Firestore keep their
// spelling; text on screen, tooltips, name boxes, receipts and emails show the real name.
// "Kinyion C" / "Kinyon C" -> "Kinyon Cooper"; any other "Kinyion" -> "Kinyon".
var DISPLAY_SPELLING_FIXES = [[/\bKinyi?on C\b\.?/g, "Kinyon Cooper"], [/\bKinyion\b/g, "Kinyon"]];
var DISPLAY_SPELLING_TEST = /\bKinyion\b|\bKinyon C\b/;
function fixDisplaySpelling(str) {
  str = String(str === undefined || str === null ? "" : str);
  for (var i = 0; i < DISPLAY_SPELLING_FIXES.length; i++) str = str.replace(DISPLAY_SPELLING_FIXES[i][0], DISPLAY_SPELLING_FIXES[i][1]);
  return str;
}
function fixDisplaySpellingAttrs(el) {
  var attrs = ["title", "aria-label", "placeholder"];
  for (var i = 0; i < attrs.length; i++) {
    var v = el.getAttribute && el.getAttribute(attrs[i]);
    if (v && DISPLAY_SPELLING_TEST.test(v)) el.setAttribute(attrs[i], fixDisplaySpelling(v));
  }
}

function scrubEmojiText(node) {
  if (!node) return;
  if (node.nodeType === 3 && DISPLAY_SPELLING_TEST.test(node.nodeValue)) {
    var pn = node.parentNode;
    // Generated text boxes (receipts, recap posts) too; what someone types never becomes a text node.
    if (pn && !(pn.closest && pn.closest("script, style"))) node.nodeValue = fixDisplaySpelling(node.nodeValue);
  }
  if (node.nodeType === 1) {
    fixDisplaySpellingAttrs(node);
    if (node.querySelectorAll) {
      var withAttrs = node.querySelectorAll("[title], [aria-label], [placeholder]");
      for (var a = 0; a < withAttrs.length; a++) fixDisplaySpellingAttrs(withAttrs[a]);
    }
  }
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
  var meta = getProfileDisplayMeta(activeProfile);
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
        moreRowHtml({ icon: "palette", title: "Appearance", sub: themeName(theme) + " · " + screenPresetName(getScreenPreset()), onclick: "openAppearanceSheet()" }) +
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
  try { renderGameDayStrips(); } catch (eGd) {}
  try { updateLiveNavBadge(); } catch (eNav) {}
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

// ---------- Overlays: one open at a time, page scroll locked only while one is open ----------
// Each overlay shows itself its own way (style.display, the hidden attribute or a class), so
// the scroll lock follows what is actually visible instead of each open/close toggling it.
var OVERLAY_CLOSERS = {
  "commish-modal-backdrop": function() { closeCommissionerModal(); },
  "settings-drawer-backdrop": function() { closeSettingsDrawer(); },
  "ev-sim-drawer-backdrop": function() { closeEvSimulatorDrawer(); },
  "auth-modal-backdrop": function() { closeAuthModal(); },
  "review-checklist-backdrop": function() { closeReviewChecklistModal(); },
  "panel-sheet-backdrop": function() { closePanelSheet(); },
  "detail-sheet-backdrop": function() { closeGameDetail(); },
  "opp-modal-backdrop": function() { closeOppModal(); },
  "rail-backdrop": function() { closeRailPanel(true); }
};
var OVERLAY_IDS = Object.keys(OVERLAY_CLOSERS).concat(["pin-modal-backdrop", "confirm-backdrop", "field-theater-backdrop"]);

function isOverlayVisible(el) {
  if (!el || el.hidden) return false;
  return window.getComputedStyle(el).display !== "none";
}

function syncOverlayScrollLock() {
  var any = OVERLAY_IDS.some(function(id) { return isOverlayVisible(document.getElementById(id)); });
  var wasLocked = document.body.classList.contains("modal-open");
  if (any === wasLocked) return;
  // overflow:hidden alone doesn't stop the page scrolling behind a sheet on iOS Safari, so pin the
  // body in place and put the scroll position back when the last overlay closes.
  var b = document.body;
  if (any) {
    overlayLockScrollY = window.pageYOffset || 0;
    b.style.top = "-" + overlayLockScrollY + "px";
    b.classList.add("modal-open");
  } else {
    b.classList.remove("modal-open");
    b.style.top = "";
    window.scrollTo(0, overlayLockScrollY);
  }
}
var overlayLockScrollY = 0;

function closeAllModalsExcept(activeModalId) {
  Object.keys(OVERLAY_CLOSERS).forEach(function(id) {
    if (id === activeModalId || !isOverlayVisible(document.getElementById(id))) return;
    try { OVERLAY_CLOSERS[id](); } catch (e) {}
  });
  syncOverlayScrollLock();
}

if (window.MutationObserver) {
  var overlayObserver = new MutationObserver(syncOverlayScrollLock);
  OVERLAY_IDS.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) overlayObserver.observe(el, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
  });
}

// Opening one of the full-screen dialogs or drawers closes whatever else is open first, so
// two darkened backdrops never stack.
[["openCommissionerModal", "commish-modal-backdrop"], ["openSettingsDrawer", "settings-drawer-backdrop"],
 ["openEvSimulatorDrawer", "ev-sim-drawer-backdrop"], ["openAuthModal", "auth-modal-backdrop"],
 ["openReviewChecklistModal", "review-checklist-backdrop"]].forEach(function(pair) {
  var name = pair[0], id = pair[1];
  var orig = window[name];
  if (typeof orig !== "function") return;
  window[name] = function() {
    closeAllModalsExcept(id);
    return orig.apply(this, arguments);
  };
});
