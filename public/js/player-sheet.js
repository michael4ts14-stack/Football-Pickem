// ============================================================================
// PLAYER SHEET: tap a Standings row. Points breakdown, Compare H2H, the Rivals
// star, and the player's picks (privacy, Spy Shield and Blind mode respected
// through the same descriptor the H2H compare uses).
// ============================================================================
var PLAYER_SHEET_NAME = null;

function playerCompareKey(name) {
  var linked = null;
  try { linked = getProfileLinkedToMemberName(name); } catch (e) {}
  if (linked && !linked.isSandbox && linked.key !== getMyInstanceProfileKey()) return linked.key;
  return "pm:" + name;
}

// Same descriptor the H2H compare builds, without changing who you compare against.
function playerPicksDescriptor(name) {
  var meLow = getMyLeaderboardNameLower();
  if (meLow && String(name).toLowerCase() === meLow) {
    var myKey = getMyInstanceProfileKey();
    return { name: name, picks: (state[myKey] && state[myKey].picks) || {}, hasPicks: true, isPoolMember: false,
      isHiddenForGame: function() { return false; } };
  }
  var saved = state.compareTargetKey;
  try {
    state.compareTargetKey = playerCompareKey(name);
    return resolveCompareTargetDescriptor();
  } catch (e) {
    return null;
  } finally {
    state.compareTargetKey = saved;
  }
}

function playerPicksHtml(desc) {
  if (!desc || !desc.hasPicks) return '<p class="muted-note">No pick sheet for this week yet.</p>';
  if (desc.isHiddenForGame(null)) return '<p class="muted-note">Picks are hidden until kickoff.</p>';
  var rows = "";
  for (var i = 0; i < GAMES.length; i++) {
    var g = GAMES[i];
    if (desc.isHiddenForGame(g.id)) {
      rows += '<li class="pp-row"><span class="pp-game">' + escapeShellHtml(g.awayCode + " at " + g.homeCode) + '</span><span class="pp-pick is-hidden">Hidden until kickoff</span></li>';
      continue;
    }
    var pick = getResolvedPickForGame(desc.picks, g, !desc.isPoolMember);
    if (!pick) continue;
    var pts = getGamePickPts(g, isSameTeamPick(pick, g.away, g));
    var sit = getGameSituation(LIVE_SCORES[g.id], g, desc.picks);
    var w = PICK_STATUS_WORDS[sit.myPickStatus];
    rows += '<li class="pp-row"><span class="pp-game">' + escapeShellHtml(g.awayCode + " at " + g.homeCode) + '</span>' +
      '<span class="pp-pick">' + escapeShellHtml(pick) + (pts > 1 ? ' <span class="mult-badge mult-' + pts + '">' + pts + 'x</span>' : '') + '</span>' +
      '<span class="pick-status ' + (w ? w[1] : '') + '">' + (w ? w[0] : '') + '</span></li>';
  }
  return rows ? '<ol class="pp-list">' + rows + '</ol>' : '<p class="muted-note">No picks yet.</p>';
}

function openPlayerSheet(name) {
  if (!name) return;
  var list = computeStandingsRows();
  var r = null;
  for (var i = 0; i < list.length; i++) if (list[i].name === name) r = list[i];
  if (!r) return;
  closePanelSheet();
  PLAYER_SHEET_NAME = name;
  var bd = document.getElementById("panel-sheet-backdrop");
  var body = document.getElementById("panel-sheet-body");
  if (!bd || !body) return;
  document.getElementById("panel-sheet-title").textContent = name;

  var meLow = getMyLeaderboardNameLower();
  var isMe = meLow && name.toLowerCase() === meLow;
  var rival = isMyRival(name);
  var full = !rival && getMyRivals().length >= RIVALS_MAX;
  var status = String(r.breakdown || "").replace(/<[^>]*>/g, "").replace(/[^\x20-\x7E·•]/g, "").trim();
  var kv = function(label, val) { return '<div class="kv"><span>' + label + '</span><strong>' + val + '</strong></div>'; };

  body.innerHTML =
    '<p class="sheet-meta">' + (r.seasonTied ? 'T' : '') + r.seasonRank + ' of ' + list.length + ' this season' +
      (r.movement ? ' · ' + (r.movement > 0 ? 'up ' : 'down ') + Math.abs(r.movement) + ' since last week' : '') +
      (r.live ? ' · <span class="st-live">Live</span>' : '') + '</p>' +
    '<div class="pp-actions">' +
      (isMe ? '' : '<button type="button" class="tool-btn" onclick="comparePlayerH2H()"><i data-lucide="git-compare"></i><span>Compare H2H</span></button>') +
      (isMe ? '' : '<button type="button" class="tool-btn' + (rival ? ' is-on' : '') + '" onclick="togglePlayerSheetRival()" aria-pressed="' + rival + '"' + (full ? ' disabled' : '') + '>' +
        '<i data-lucide="star"></i><span>' + (rival ? 'Rival' : (full ? 'Rivals full (3)' : 'Add to Rivals')) + '</span></button>') +
    '</div>' +
    '<section class="sheet-section"><h3 class="sheet-h">Points</h3>' +
      kv("Prior season", r.priorPts) +
      kv("Live this week (in progress)", r.liveInProgPts) +
      kv("Final this week", r.finalPts) +
      kv("New total", '<span class="pp-total">' + r.seasonPts + '</span>') +
      (status ? kv("Status / multipliers", escapeShellHtml(status)) : '') +
    '</section>' +
    '<section class="sheet-section"><h3 class="sheet-h">Picks</h3>' + playerPicksHtml(playerPicksDescriptor(name)) + '</section>';
  bd.hidden = false;
}

function togglePlayerSheetRival() {
  if (!PLAYER_SHEET_NAME) return;
  toggleRival(PLAYER_SHEET_NAME);
  openPlayerSheet(PLAYER_SHEET_NAME);
}

function comparePlayerH2H() {
  if (!PLAYER_SHEET_NAME) return;
  var key = playerCompareKey(PLAYER_SHEET_NAME);
  closePanelSheet();
  setCompareTarget(key);
  switchMainView("live");
}

// The panel sheet is shared; clear the player when it closes.
var _playerSheetPrevClose = closePanelSheet;
closePanelSheet = function() {
  PLAYER_SHEET_NAME = null;
  var body = document.getElementById("panel-sheet-body");
  var res = _playerSheetPrevClose.apply(this, arguments);
  if (body) body.innerHTML = "";
  return res;
};

// Keep an open player sheet current on live updates.
var _playerSheetPrevStandings = renderStandingsList;
renderStandingsList = function() {
  var res = _playerSheetPrevStandings.apply(this, arguments);
  var bd = document.getElementById("panel-sheet-backdrop");
  if (PLAYER_SHEET_NAME && bd && !bd.hidden) {
    var keep = PLAYER_SHEET_NAME, scroll = document.getElementById("panel-sheet-body").scrollTop;
    openPlayerSheet(keep);
    document.getElementById("panel-sheet-body").scrollTop = scroll;
  }
  return res;
};
