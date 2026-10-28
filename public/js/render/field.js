// ============================================================================
// FIELD RENDERER: the full SVG field, the mini bar on live cards, the drive
// chart, the play list and the win-probability line.
// Each game's SVG is built once and kept; renders drop a .field-mount
// placeholder and mountFieldsIn() moves the kept SVG into it and updates it
// through transforms, so the ball glides (600ms ease-out) instead of redrawing.
// Demo controls stay in demo-sim.js. Colours come from tokens.css.
// ============================================================================
var FIELD_VIEW = { w: 740, h: 200, ez: 65, pxPerYd: 6.1, bigGainYds: 15 };
var FIELD_NODES = {};          // "gameId:variant" -> { svg, last }
var FIELD_SVG_NS = "http://www.w3.org/2000/svg";

function fieldClampYl(v) { return Math.max(0, Math.min(100, typeof v === "number" && !isNaN(v) ? v : 50)); }
function fieldX(yl100) { return +(FIELD_VIEW.ez + fieldClampYl(yl100) * FIELD_VIEW.pxPerYd).toFixed(1); }

function fieldEsc(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// ESPN team colour when we have it, otherwise a neutral grey (never the only signal).
function fieldTeamColor(g, isAway) {
  var id = null;
  try { id = lookupEspnTeamId(isAway ? g.away : g.home, g, isAway); } catch (e) {}
  var info = id && typeof ESPN_TEAM_INFO !== "undefined" && ESPN_TEAM_INFO[id];
  var c = info && info.color;
  return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#8a8d94";
}

function fieldTeamCode(g, isAway) {
  try { return teamShortCode(g, isAway, lookupEspnTeamId(isAway ? g.away : g.home, g, isAway)); } catch (e) {}
  return String((isAway ? g.awayCode : g.homeCode) || "").toUpperCase();
}

function fieldReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// "2nd & 6 at SYR 12" -> "2nd & 6 · SYR 12"
function fieldSituationText(tel) {
  var dd = String((tel && tel.downDistanceText) || "").replace(/\s+at\s+/i, " · ");
  if (dd && tel.possessionText && dd.indexOf(tel.possessionText) === -1 && !/·/.test(dd)) dd += " · " + tel.possessionText;
  return dd || (tel && tel.possessionText) || "";
}

// ---------- Full field (SVG, built once per game + variant) ----------
function buildFieldSvgElement(g) {
  var V = FIELD_VIEW, s = "";
  var awayC = fieldTeamColor(g, true), homeC = fieldTeamColor(g, false);
  s += '<rect class="fld-bg" x="0" y="0" width="' + V.w + '" height="' + V.h + '"/>';
  s += '<rect x="0" y="0" width="' + V.ez + '" height="' + V.h + '" fill="' + awayC + '" fill-opacity="0.25"/>';
  s += '<rect x="' + (V.w - V.ez) + '" y="0" width="' + V.ez + '" height="' + V.h + '" fill="' + homeC + '" fill-opacity="0.25"/>';
  s += '<text class="fld-ez-text" x="32.5" y="100" transform="rotate(-90 32.5 100)">' + fieldEsc(fieldTeamCode(g, true)) + '</text>';
  s += '<text class="fld-ez-text" x="' + (V.w - 32.5) + '" y="100" transform="rotate(90 ' + (V.w - 32.5) + ' 100)">' + fieldEsc(fieldTeamCode(g, false)) + '</text>';
  // Red-zone tint, shown only for the side the offense is attacking.
  s += '<rect class="fld-rz fld-rz-away" x="' + V.ez + '" y="0" width="' + (20 * V.pxPerYd) + '" height="' + V.h + '"/>';
  s += '<rect class="fld-rz fld-rz-home" x="' + fieldX(80) + '" y="0" width="' + (20 * V.pxPerYd) + '" height="' + V.h + '"/>';
  for (var yd = 5; yd <= 95; yd += 5) {
    s += '<line class="fld-yard" x1="' + fieldX(yd) + '" y1="0" x2="' + fieldX(yd) + '" y2="' + V.h + '"/>';
    if (yd % 10 === 0) {
      var n = yd <= 50 ? yd : 100 - yd;
      s += '<text class="fld-num" x="' + fieldX(yd) + '" y="34">' + n + '</text>';
      s += '<text class="fld-num" x="' + fieldX(yd) + '" y="186">' + n + '</text>';
    }
  }
  s += '<line class="fld-goal" x1="' + V.ez + '" y1="0" x2="' + V.ez + '" y2="' + V.h + '"/>';
  s += '<line class="fld-goal" x1="' + (V.w - V.ez) + '" y1="0" x2="' + (V.w - V.ez) + '" y2="' + V.h + '"/>';
  // Moving parts: drive bar (unit rect scaled), last-play arc, LOS, first-down line, ball.
  s += '<rect class="fld-drive fld-move" x="0" y="88" width="1" height="24"/>';
  s += '<path class="fld-arc" d="M0 0" fill="none" stroke-width="3" stroke-linecap="round"/>';
  s += '<g class="fld-los fld-move"><line x1="0" y1="0" x2="0" y2="' + V.h + '"/></g>';
  s += '<g class="fld-fd fld-move"><line x1="0" y1="0" x2="0" y2="' + V.h + '"/></g>';
  s += '<g class="fld-ball fld-move"><g class="fld-ball-dir">' +
         '<path class="fld-ball-arrow" d="M24 100 l-7 -5 v10 z"/>' +
         '<ellipse cx="0" cy="100" rx="11" ry="7"/>' +
         '<path class="fld-ball-laces" d="M-4 100h8M-2 97.5v5M2 97.5v5"/>' +
       '</g></g>';
  var wrap = document.createElement("div");
  wrap.innerHTML = '<svg class="field-svg" viewBox="0 0 ' + V.w + ' ' + V.h + '" xmlns="' + FIELD_SVG_NS + '" role="img" focusable="false">' + s + '</svg>';
  return wrap.firstChild;
}

function setFieldTransform(el, tx, sx) {
  if (!el) return;
  el.style.transform = "translateX(" + tx + "px)" + (typeof sx === "number" ? " scaleX(" + sx + ")" : "");
}

function updateFieldSvg(entry, g, tel) {
  var svg = entry.svg, V = FIELD_VIEW;
  var away = tel.possessionSide === "away";
  var ballX = fieldX(tel.yl100);
  var startX = fieldX(typeof tel.startYl100 === "number" ? tel.startYl100 : tel.yl100);
  var dist = tel.distYards || 10;
  var fdX = away ? Math.min(V.w - V.ez, ballX + dist * V.pxPerYd) : Math.max(V.ez, ballX - dist * V.pxPerYd);
  var offColor = fieldTeamColor(g, away);
  var prev = entry.last;

  // First draw, hidden tab or reduced motion: jump straight to the spot.
  var instant = !prev || document.hidden || fieldReducedMotion();
  svg.classList.toggle("is-instant", instant);
  if (instant) void svg.getBoundingClientRect();

  setFieldTransform(svg.querySelector(".fld-ball"), ballX);
  setFieldTransform(svg.querySelector(".fld-los"), ballX);
  setFieldTransform(svg.querySelector(".fld-fd"), +fdX.toFixed(1));
  svg.querySelector(".fld-fd").style.display = tel.bannerType === "final" ? "none" : "";
  var dir = svg.querySelector(".fld-ball-dir");
  dir.style.transform = away ? "" : "scaleX(-1)";
  var drive = svg.querySelector(".fld-drive");
  drive.style.fill = offColor;
  setFieldTransform(drive, Math.min(startX, ballX), Math.max(2, Math.abs(ballX - startX)));

  var rzAway = svg.querySelector(".fld-rz-away"), rzHome = svg.querySelector(".fld-rz-home");
  svg.classList.toggle("is-redzone", !!tel.isRedZone); // brighter zone + glowing ball (css)
  rzAway.style.display = (tel.isRedZone && !away) ? "" : "none";
  rzHome.style.display = (tel.isRedZone && away) ? "" : "none";

  // Last-play arc: only on big gains, in the offense's colour; drawn once.
  var arc = svg.querySelector(".fld-arc");
  var fromYl = typeof tel.prevYl100 === "number" ? tel.prevYl100 : (prev ? prev.yl100 : null);
  var gain = fromYl === null ? 0 : (away ? tel.yl100 - fromYl : fromYl - tel.yl100);
  if (fromYl !== null && Math.abs(gain) >= V.bigGainYds && (!prev || prev.yl100 !== tel.yl100)) {
    var fx = fieldX(fromYl), mid = (fx + ballX) / 2;
    arc.setAttribute("d", "M" + fx + " 100 Q" + mid.toFixed(1) + " 52 " + ballX + " 100");
    arc.style.stroke = offColor;
    arc.style.display = "";
    if (!instant) {
      var len = Math.abs(ballX - fx) * 1.3 + 20;
      arc.style.transition = "none";
      arc.style.strokeDasharray = len;
      arc.style.strokeDashoffset = len;
      void arc.getBoundingClientRect();
      arc.style.transition = "";
      arc.style.strokeDashoffset = "0";
    } else {
      arc.style.strokeDasharray = "";
      arc.style.strokeDashoffset = "";
    }
  } else if (!prev || prev.yl100 !== tel.yl100 || prev.possessionSide !== tel.possessionSide) {
    arc.style.display = "none";
  }

  var label = (away ? g.away : g.home) + " ball, " + (fieldSituationText(tel) || ("at " + formatYl100ToSpotText(tel.yl100, g)));
  svg.setAttribute("aria-label", label + (tel.isRedZone ? ", red zone" : ""));
  entry.last = { yl100: tel.yl100, possessionSide: tel.possessionSide };
}

// Placeholder for a full field. variant keeps the card / theater / sheet copies apart.
function fieldMountHtml(g, variant) {
  return '<div class="field-mount field-' + variant + '" data-field-game="' + g.id + '" data-field-variant="' + variant + '"></div>';
}

function mountFieldsIn(root) {
  var mounts = (root || document).querySelectorAll(".field-mount[data-field-game]");
  for (var i = 0; i < mounts.length; i++) {
    var m = mounts[i];
    var gid = m.getAttribute("data-field-game");
    var g = findGameById(isNaN(+gid) ? gid : +gid);
    if (!g) continue;
    var tel = resolveDriveTelemetryForGame(g, LIVE_SCORES[g.id] || null);
    if (!tel) { m.innerHTML = ""; continue; }
    var key = g.id + ":" + m.getAttribute("data-field-variant");
    var entry = FIELD_NODES[key];
    if (!entry) entry = FIELD_NODES[key] = { svg: buildFieldSvgElement(g), last: null };
    if (entry.svg.parentNode !== m) m.appendChild(entry.svg);
    updateFieldSvg(entry, g, tel);
  }
}

// Forget kept SVGs (new slate, matchup changed, slot reused).
function resetFieldNodes(gameId) {
  if (gameId === undefined || gameId === null) { FIELD_NODES = {}; return; }
  for (var k in FIELD_NODES) if (k.split(":")[0] === String(gameId)) delete FIELD_NODES[k];
}

// Mount whenever a render drops new placeholders in.
var FIELD_MOUNT_QUEUED = false;
function queueFieldMount() {
  if (FIELD_MOUNT_QUEUED) return;
  FIELD_MOUNT_QUEUED = true;
  (window.queueMicrotask || setTimeout)(function() { FIELD_MOUNT_QUEUED = false; mountFieldsIn(document); });
}
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.classList.contains("field-mount") || n.querySelector(".field-mount"))) { queueFieldMount(); return; }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
// Back from a hidden tab: settle every field on its spot without replaying missed motion.
document.addEventListener("visibilitychange", function() { if (!document.hidden) queueFieldMount(); });

// ---------- Mini bar (~28px) for live cards ----------
function fieldMiniPct(yl100) { return +((10 + fieldClampYl(yl100)) / 120 * 100).toFixed(2); }

function fieldMiniBarHtml(g, ls) {
  var demo = DEMO_FIELD_PREVIEW || GAME_DRIVE_VIEW_MODE[g.id] === "demo";
  if (!(ls && ls.inProgress) && !demo) return "";
  var tel = resolveDriveTelemetryForGame(g, ls);
  if (!tel || tel.bannerType === "final") return "";
  var away = tel.possessionSide === "away";
  var dist = tel.distYards || 10;
  var fdYl = away ? Math.min(100, tel.yl100 + dist) : Math.max(0, tel.yl100 - dist);
  var txt = fieldSituationText(tel);
  var team = away ? g.away : g.home;
  var aria = team + " ball" + (txt ? ", " + txt : "") + ", driving " + (away ? "right" : "left") + (tel.isRedZone ? ", red zone" : "");
  return '<div class="field-mini' + (tel.isRedZone ? ' is-redzone' : '') + '" role="img" aria-label="' + fieldEsc(aria) + '">' +
    '<span class="field-mini-strip" aria-hidden="true">' +
      '<span class="fm-ez" style="left:0;background:' + fieldTeamColor(g, true) + '"></span>' +
      '<span class="fm-ez" style="right:0;background:' + fieldTeamColor(g, false) + '"></span>' +
      (tel.isRedZone ? '<span class="fm-rz" style="' + (away ? 'left:' + fieldMiniPct(80) : 'left:' + fieldMiniPct(0)) + '%"></span>' : '') +
      '<span class="fm-fd" style="left:' + fieldMiniPct(fdYl) + '%"></span>' +
      '<span class="fm-ball' + (away ? '' : ' is-left') + '" style="left:' + fieldMiniPct(tel.yl100) + '%"></span>' +
    '</span>' +
    '<span class="field-mini-text">' + fieldEsc(txt) + '</span>' +
  '</div>';
}

// Down & distance and the last play, as text under the full field in the game sheet.
function fieldMiniTextLineHtml(g, ls) {
  var tel = resolveDriveTelemetryForGame(g, ls);
  if (!tel) return "";
  var team = tel.possessionSide === "away" ? g.away : g.home;
  return '<p class="field-caption"><strong>' + fieldEsc(team) + ' ball</strong> · ' + fieldEsc(fieldSituationText(tel)) +
    (ls.lastPlayText ? '<br><span class="field-caption-play">' + fieldEsc(ls.lastPlayText) + '</span>' : '') + '</p>';
}

// ---------- Play list ----------
function buildPlaysListHtml(tel, g, ls) {
  var plays = (tel && tel.plays) || [];
  if (!plays.length) {
    return '<p class="pbp-empty">No plays loaded yet. ' +
      '<button type="button" class="link-btn" onclick="refreshTheaterPlays(' + g.id + ')">Refresh</button></p>';
  }
  var html = "";
  for (var i = 0; i < plays.length; i++) {
    var pl = plays[i];
    var tag = pl.isScore ? '<span class="pbp-tag is-score">Score</span>' : (pl.isTurnover ? '<span class="pbp-tag is-turnover">Turnover</span>' : '');
    var yds = (typeof pl.statYardage === "number" && pl.statYardage !== 0)
      ? '<span class="pbp-yds ' + (pl.statYardage > 0 ? 'is-gain' : 'is-loss') + '">' + (pl.statYardage > 0 ? '+' : '') + pl.statYardage + ' yds</span>' : '';
    html += '<li class="pbp-item">' +
      '<div class="pbp-meta">' + (pl.clock ? '<span class="pbp-clock">' + fieldEsc(pl.clock) + '</span>' : '') + tag + yds + '</div>' +
      '<div class="pbp-text">' + (pl.header ? '<strong>' + fieldEsc(String(pl.header).replace(/:\s*$/, "")) + '</strong> ' : '') + fieldEsc(pl.text) + '</div>' +
    '</li>';
  }
  return '<ol class="pbp-list">' + html + '</ol>';
}

// ---------- Drive chart: one row per drive, start -> end, offense colour ----------
function fieldDriveChartHtml(g) {
  var cache = SUMMARY_PBP_CACHE[g.id];
  var drives = cache && cache.allDrives;
  if (!drives || !drives.length) return "";
  var rows = "";
  for (var i = 0; i < drives.length; i++) {
    var d = drives[i];
    var away = d.possessionSide === "away";
    var a = fieldMiniPct(d.startYl100), b = fieldMiniPct(d.yl100);
    rows += '<li class="drive-row' + (d.isScoringDrive ? ' is-score' : '') + '">' +
      '<span class="drive-team">' + fieldEsc(d.teamCode || fieldTeamCode(g, away)) + '</span>' +
      '<span class="drive-track" aria-hidden="true"><span class="drive-span" style="left:' + Math.min(a, b) + '%;width:' + Math.max(1, Math.abs(b - a)) + '%;background:' + fieldTeamColor(g, away) + '"></span></span>' +
      '<span class="drive-result">' + fieldEsc(d.result || "") + '</span>' +
    '</li>';
  }
  return '<section class="theater-section"><h4 class="theater-h">Drives</h4><ol class="drive-chart">' + rows + '</ol></section>';
}

// ---------- Win probability (only when ESPN's summary carried it) ----------
function fieldWinProbHtml(g) {
  var cache = SUMMARY_PBP_CACHE[g.id];
  var wp = cache && cache.winProb;
  if (!wp || wp.length < 2) return "";
  var W = 300, H = 80, pts = [];
  for (var i = 0; i < wp.length; i++) pts.push((i / (wp.length - 1) * W).toFixed(1) + "," + ((1 - wp[i]) * H).toFixed(1));
  var last = wp[wp.length - 1];
  var homeLead = last >= 0.5;
  var lbl = (homeLead ? g.home : g.away) + " " + Math.round((homeLead ? last : 1 - last) * 100) + "%";
  return '<section class="theater-section"><h4 class="theater-h">Win probability <span class="theater-h-sub">' + fieldEsc(lbl) + '</span></h4>' +
    '<div class="winprob-wrap">' +
      '<svg class="winprob" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Win probability, now ' + fieldEsc(lbl) + '">' +
        '<line class="winprob-mid" x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '"/>' +
        '<polyline class="winprob-line" points="' + pts.join(" ") + '"/>' +
      '</svg>' +
      // Higher on the chart = home team more likely to win.
      '<span class="winprob-label is-top">' + fieldEsc(g.home) + '</span><span class="winprob-label is-bottom">' + fieldEsc(g.away) + '</span>' +
    '</div></section>';
}

// ---------- Field tracker on Advanced pick cards (bar + optional full field) ----------
function renderInteractiveFieldTrackerHtml(g, ls) {
  var tel = resolveDriveTelemetryForGame(g, ls);
  if (!tel) return "";
  var isOpen = EXPANDED_FIELD_TRACKERS[g.id] === true;
  var head = tel.bannerType === "final"
    ? '<span class="field-tracker-title">' + fieldEsc(tel.activeMode === "scoring" ? "Last scoring drive" : "Final drive") + ' · ' + fieldEsc(tel.driveResult || "") + '</span>'
    : (fieldMiniBarHtml(g, ls) || '<span class="field-tracker-title">' + fieldEsc(fieldSituationText(tel)) + '</span>');
  var bar = '<div class="field-tracker-bar">' + head +
    '<button type="button" class="link-btn" onclick="toggleFieldTrackerAccordion(' + g.id + ', event)" aria-expanded="' + isOpen + '">' + (isOpen ? "Hide field" : "Field") + '</button>' +
    '<button type="button" class="link-btn" onclick="openFieldTheaterModal(' + g.id + ', event)">Big view</button>' +
  '</div>';
  if (!isOpen) return bar;
  return bar +
    '<div class="field-tracker-drawer">' +
      fieldModePillsHtml(g, ls, tel) +
      (tel.bannerType === "demo" && typeof demoSimControlsHtml === "function" ? demoSimControlsHtml(g) : '') +
      '<button type="button" class="field-tap" onclick="openFieldTheaterModal(' + g.id + ', event)" aria-label="Open big view">' + fieldMountHtml(g, "card") + '</button>' +
      '<div class="drive-meta-strip"><span>' + fieldEsc(fieldSituationText(tel)) + '</span><span>' + fieldEsc(tel.driveDesc || "") + '</span></div>' +
      buildPlaysListHtml(tel, g, ls) +
    '</div>';
}

function fieldModePillsHtml(g, ls, tel) {
  var b = function(mode, label, on) {
    return '<button type="button" class="field-mode-btn' + (on ? ' active' : '') + '" aria-pressed="' + !!on + '" onclick="setGameDriveViewMode(' + g.id + ', \'' + mode + '\', event)">' + label + '</button>';
  };
  var html = "";
  if (ls && ls.inProgress) html += b("live", "Live drive", tel.activeMode === "live");
  if (ls && ls.completed) {
    html += b("final", "Final drive", tel.activeMode === "final");
    html += b("scoring", "Last scoring drive", tel.activeMode === "scoring");
  }
  html += b("demo", "Demo sim", tel.activeMode === "demo");
  return '<div class="field-mode-pills">' + html + '</div>';
}

// Theater "Refresh" when no plays are loaded: one on-demand fetch for this game.
function refreshTheaterPlays(gameId) {
  espnFallbackForDrives(gameId, true);
}
