function switchMainView(mode) {
  currentMainView = mode;
  var cardsEl = document.getElementById("full-cards-wrapper");
  var condEl = document.getElementById("condensed-view-container");
  var liveEl = document.getElementById("live-tracker-view-container");
  var standEl = document.getElementById("standings-view-container");

  cardsEl.classList.toggle("hidden", mode !== "cards");
  condEl.classList.toggle("hidden", mode !== "condensed");
  liveEl.classList.toggle("hidden", mode !== "live");
  standEl.classList.toggle("hidden", mode !== "standings");

  document.getElementById("tab-mode-cards").className = "mode-tab-btn" + (mode === "cards" ? " active" : "");
  document.getElementById("tab-mode-condensed").className = "mode-tab-btn" + (mode === "condensed" ? " active" : "");
  document.getElementById("tab-mode-live").className = "mode-tab-btn live-tab" + (mode === "live" ? " active" : "");
  document.getElementById("tab-mode-standings").className = "mode-tab-btn standings-tab" + (mode === "standings" ? " active" : "");

  document.getElementById("mnav-cards").className = "m-nav-btn" + (mode === "cards" ? " active" : "");
  document.getElementById("mnav-condensed").className = "m-nav-btn" + (mode === "condensed" ? " active" : "");
  document.getElementById("mnav-live").className = "m-nav-btn" + (mode === "live" ? " active" : "");
  document.getElementById("mnav-standings").className = "m-nav-btn" + (mode === "standings" ? " active" : "");

  if (mode === "live") {
    pollLiveSaturdayScores(false);
    renderLiveScoreboardTab();
  } else if (mode === "condensed") {
    renderCondensedTable();
  } else if (mode === "standings") {
    renderStandingsAndGradingView();
  } else {
    renderGames();
  }
}

function toggleMobileSidebar(forceState) {
  var sb = document.getElementById("main-sidebar");
  var btn = document.getElementById("mnav-drawer");
  var isOpen = sb.classList.contains("mobile-drawer-open");
  var nextState = (typeof forceState === "boolean") ? forceState : !isOpen;
  if (nextState) {
    sb.classList.add("mobile-drawer-open");
    if (btn) btn.classList.add("active");
  } else {
    sb.classList.remove("mobile-drawer-open");
    if (btn) btn.classList.remove("active");
  }
}

function setLiveTabFilter(flt) {
  liveTabFilter = flt;
  var list = ["all", "active", "redzone", "sweat", "upset", "diff"];
  for (var i = 0; i < list.length; i++) {
    var k = list[i];
    var b = document.getElementById("lflt-" + k);
    if (b) b.className = "btn-sm" + (k === flt ? " active" : "");
  }
  renderLiveScoreboardTab();
}


function buildTeamPickPillsHtml(g, teamName) {
  // Clean Research Cards: ONLY show Active User's pick + currently selected Compare Target's pick (if unhidden) + Watchlist Rivals
  // Never clutter Research Cards with hidden-pick badges or every extra profile!
  var html = "";
  var actMeta = getProfileDisplayMeta(activeProfile);
  if (!isProfileHiddenFromViewer(activeProfile, g.id) && state[activeProfile] && state[activeProfile].picks) {
    var actPick = getResolvedPickForGame(state[activeProfile].picks, g, true);
    if (isSameTeamPick(actPick, teamName, g)) {
      html += '<span class="p-tag ' + actMeta.tagClass + '">✓ ' + escapeHtml(actMeta.shortName) + '</span>';
    }
  }

  var cmp = resolveCompareTargetDescriptor();
  if (cmp && cmp.key !== activeProfile && !cmp.isHiddenForGame(g.id) && cmp.hasPicks) {
    var cmpPick = getResolvedPickForGame(cmp.picks, g, !cmp.isPoolMember);
    if (cmpPick && isSameTeamPick(cmpPick, teamName, g)) {
      html += '<span class="p-tag ' + cmp.tagClass + '">⚔️ ' + escapeHtml(cmp.shortName) + '</span>';
    }
  }

  if (!BLIND_MODE) {
    for (var w = 0; w < (state.watchlist || []).length; w++) {
      var rv = state.watchlist[w];
      // Avoid duplicating if the compare target is already this watchlist rival
      if (cmp && cmp.isPoolMember && standardizeParticipantName(cmp.name).toLowerCase() === standardizeParticipantName(rv.name).toLowerCase()) continue;
      var rvPick = getResolvedPickForGame(rv.picks, g, false);
      if (isSameTeamPick(rvPick, teamName, g)) {
        html += '<span class="p-tag p-tag-w">👀 ' + rv.name.slice(0, 7) + '</span>';
      }
    }
  }
  return html;
}

function buildLockedProfilesHeaderBadgesHtml(g) {
  // Intentionally empty so Research Cards are never cluttered with hidden pick badges
  return "";
}

function updateSingleGameCardPickUI(g) {
  if (!g) return false;
  var cardEl = document.getElementById("game-card-" + g.id);
  if (!cardEl) return false;
  var btns = cardEl.querySelectorAll(".teams-grid .team-btn");
  if (!btns || btns.length < 2) return false;

  var activeMeta = getProfileDisplayMeta(activeProfile);
  var activePick = isProfileHiddenFromViewer(activeProfile, g.id) ? null : getResolvedPickForGame(state[activeProfile].picks, g, true);
  var selClass = activeMeta.selClass || "selected-custom";

  btns[0].classList.remove("selected-michael", "selected-kinyion", "selected-test", "selected-custom");
  btns[1].classList.remove("selected-michael", "selected-kinyion", "selected-test", "selected-custom");
  if (activePick && isSameTeamPick(activePick, g.away, g)) btns[0].classList.add(selClass);
  if (activePick && isSameTeamPick(activePick, g.home, g)) btns[1].classList.add(selClass);

  var pills0 = btns[0].querySelector(".profile-pills");
  if (pills0) pills0.innerHTML = buildTeamPickPillsHtml(g, g.away);
  var pills1 = btns[1].querySelector(".profile-pills");
  if (pills1) pills1.innerHTML = buildTeamPickPillsHtml(g, g.home);

  var leaderRival = state.watchlist[0];
  var leaderPick = leaderRival ? getResolvedPickForGame(leaderRival.picks, g, false) : null;
  var stratEl = cardEl.querySelector(".wl-defense-badge, .wl-offense-badge, .watchlist-pill");
  if (stratEl && leaderRival) {
    if (!leaderPick) {
      stratEl.className = "watchlist-pill";
      stratEl.textContent = "⏳ " + leaderRival.name + ": No Pick Yet";
    } else if (isSameTeamPick(activePick, leaderPick, g)) {
      stratEl.className = "wl-defense-badge";
      stratEl.textContent = "🛡️ Defense (Matches " + leaderRival.name + ")";
    } else {
      stratEl.className = "wl-offense-badge";
      stratEl.textContent = "⚔️ Offense (Diffs " + leaderRival.name + ")";
    }
  }
  return true;
}

function pickSide(gameId, sideCode) {
  var g = findGameById(gameId);
  if (!g || isAwaitingFirstSlate()) return;
  if (typeof isGameLockedByCommissioner === "function" && isGameLockedByCommissioner(g.id) && activeProfile !== "test") {
    showAppToast("🔒 Game #" + g.id + " (" + g.awayCode + " at " + g.homeCode + ") is locked (Kickoff / Commissioner Lock)!");
    return;
  }
  lastLocalPickTs = Date.now();
  var chosen = g.rec;
  if (sideCode === 1) chosen = g.away;
  if (sideCode === 2) chosen = g.home;
  var numId = Number(g.id);
  clearDeletedFlagForProfile(activeProfile);
  if (!state[activeProfile].picks) state[activeProfile].picks = {};
  state[activeProfile].picks[numId] = chosen;
  state[activeProfile]._manualEditsThisWeek = true;
  state[activeProfile].picks[String(numId)] = chosen;

  // Instant <1ms surgical DOM update when on Research Cards view
  if (currentMainView === "cards" && currentFilter !== "diffs" && updateSingleGameCardPickUI(g)) {
    regradeAllPoolMembersLive(true);
    updateScoreboard(true);
    if (typeof renderSimpleGuestAccountBar === "function") renderSimpleGuestAccountBar();
    saveCurrentState(activeProfile, true);
    return;
  }
  regradeAllPoolMembersLive(true);
  saveCurrentState(activeProfile, true);
  renderAll();
}

function pickSideForProfile(profKey, gameId, sideCode) {
  var g = findGameById(gameId);
  if (!g) return;
  if (typeof isGameLockedByCommissioner === "function" && isGameLockedByCommissioner(g.id) && profKey !== "test") {
    showAppToast("🔒 Game #" + g.id + " (" + g.awayCode + " at " + g.homeCode + ") is locked (Kickoff / Commissioner Lock)!");
    return;
  }
  if (isAccountInstanceLocked() && !canEditProfileInCurrentInstance(profKey)) {
    var myMeta = getProfileDisplayMeta(AUTH_SESSION.boundProfileKey);
    var otherMeta = getProfileDisplayMeta(profKey);
    showAppToast("🔒 Instance Locked to " + myMeta.name + ": " + otherMeta.name + "'s picks are read-only on your instance.");
    return;
  }
  if (isProfileHiddenFromViewer(profKey, g.id)) {
    if (!unlockProfileWithPrompt(profKey)) return;
  }
  lastLocalPickTs = Date.now();
  var chosen = (sideCode === 1) ? g.away : g.home;
  var numId = Number(g.id);
  clearDeletedFlagForProfile(profKey);
  if (!state[profKey]) state[profKey] = { picks: {}, tiebreaker: "28-24", target: 20 };
  if (!state[profKey].picks) state[profKey].picks = {};
  state[profKey].picks[numId] = chosen;
  state[profKey]._manualEditsThisWeek = true;
  state[profKey].picks[String(numId)] = chosen;
  regradeAllPoolMembersLive(true);
  saveCurrentState(profKey, true);
  renderAll();
}

function pickSideForWatchlist(watchIdx, gameId, sideCode) {
  var g = findGameById(gameId);
  if (!g || !state.watchlist[watchIdx]) return;
  lastLocalPickTs = Date.now();
  var numId = Number(g.id);
  state.watchlist[watchIdx].picks[numId] = (sideCode === 1) ? g.away : g.home;
  state.watchlist[watchIdx].picks[String(numId)] = (sideCode === 1) ? g.away : g.home;
  pushWatchlistOrStandingsToFirebase();
  renderAll();
}

function toggleWatchlistPick(watchIdx, gameId) {
  var g = findGameById(gameId);
  if (!g || !state.watchlist[watchIdx]) return;
  lastLocalPickTs = Date.now();
  var numId = Number(g.id);
  var cur = getResolvedPickForGame(state.watchlist[watchIdx].picks, g, false);
  if (!cur) {
    state.watchlist[watchIdx].picks[numId] = g.away;
    state.watchlist[watchIdx].picks[String(numId)] = g.away;
  } else if (isSameTeamPick(cur, g.away, g)) {
    state.watchlist[watchIdx].picks[numId] = g.home;
    state.watchlist[watchIdx].picks[String(numId)] = g.home;
  } else {
    delete state.watchlist[watchIdx].picks[numId];
    delete state.watchlist[watchIdx].picks[String(numId)];
  }
  pushWatchlistOrStandingsToFirebase();
  renderAll();
}

function toggleShadowProfiles() {
  showShadowBadges = !showShadowBadges;
  renderAll();
}

function getCommonOpponentsMap(awayTeam, homeTeam) {
  var aLog = getTeamLog(awayTeam).l5 || [];
  var hLog = getTeamLog(homeTeam).l5 || [];
  var aSet = {};
  var common = {};
  for (var i = 0; i < aLog.length; i++) {
    var op = normalizeTeamKey(aLog[i].opp);
    if (op && op.indexOf("sync") === -1) aSet[op] = aLog[i];
  }
  for (var j = 0; j < hLog.length; j++) {
    var hop = normalizeTeamKey(hLog[j].opp);
    if (hop && aSet[hop]) {
      common[hop] = {
        awayRes: aSet[hop],
        homeRes: hLog[j]
      };
    }
  }
  return common;
}

function recalcImpliedTiebreaker() {
  var ou = parseFloat(document.getElementById("calc-ou").value) || 51.5;
  var sp = Math.abs(parseFloat(document.getElementById("calc-spread").value) || 3.5);
  var favScore = Math.round((ou / 2) + (sp / 2));
  var dogScore = Math.round((ou / 2) - (sp / 2));
  if (favScore === dogScore) favScore += 1;
  var high = Math.max(favScore, dogScore);
  var low = Math.min(favScore, dogScore);
  document.getElementById("calc-result-text").textContent = high + "-" + low + " (" + (high + low) + " pts)";
  return high + "-" + low;
}

function applyCalculatedTiebreaker() {
  if (blockTiebreakerEditIfLocked()) return;
  var scoreStr = recalcImpliedTiebreaker();
  document.getElementById("tiebreaker-input").value = scoreStr;
  saveCurrentState(activeProfile);
}

function toggleAutoPoll(enabled) {
  if (livePollTimer) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
  if (enabled) {
    pollLiveSaturdayScores(true);
    livePollTimer = setInterval(function() {
      // A hidden tab doesn't poll; coming back refreshes at once (below).
      if (document.visibilityState === "hidden") return;
      pollLiveSaturdayScores(false);
    }, 60000);
  }
}

document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "visible" && livePollTimer) pollLiveSaturdayScores(false);
});

