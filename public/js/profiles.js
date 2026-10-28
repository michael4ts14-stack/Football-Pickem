// ============================================================================
// MULTI-USER PROFILE MANAGER & ANTI-SPY HIDDEN PICKS MODAL
// ============================================================================
function buildLeaderboardLinkSelectHtml(profKey, currentLinkedName) {
  var allNames = [];
  var seen = {};
  if (state.leaderboard && Array.isArray(state.leaderboard)) {
    for (var i = 0; i < state.leaderboard.length; i++) {
      var n = standardizeParticipantName(state.leaderboard[i].name);
      var low = n.toLowerCase();
      if (!seen[low]) {
        seen[low] = true;
        allNames.push({ name: n, pts: state.leaderboard[i].priorPts, rank: state.leaderboard[i].rank });
      }
    }
  }
  if (state.poolMembers && Array.isArray(state.poolMembers)) {
    for (var j = 0; j < state.poolMembers.length; j++) {
      var n2 = standardizeParticipantName(state.poolMembers[j].name);
      var low2 = n2.toLowerCase();
      if (!seen[low2]) {
        seen[low2] = true;
        allNames.push({ name: n2, pts: state.poolMembers[j].priorPts, rank: state.poolMembers[j].priorRank || "" });
      }
    }
  }
  var curLow = standardizeParticipantName(currentLinkedName || "").toLowerCase();
  var html = '<select class="search-input" style="min-width:155px;max-width:210px;padding:3px 6px;font-size:0.7rem;color:var(--win);border-color:var(--border);" onchange="linkUserProfileToLeaderboard(\'' + profKey + '\', this.value)">';
  html += '<option value="">— Not Linked to Pool —</option>';
  for (var k = 0; k < allNames.length; k++) {
    var item = allNames[k];
    var sel = (item.name.toLowerCase() === curLow) ? " selected" : "";
    html += '<option value="' + item.name.replace(/"/g, '&quot;') + '"' + sel + '>🔗 ' + item.name + ' (' + item.pts + ' pts' + (item.rank ? ' • ' + item.rank : '') + ')</option>';
  }
  html += '</select>';
  return html;
}

function linkUserProfileToLeaderboard(profKey, memberName, pullPicksNow) {
  ensureMultiUserAndPrivacyState();
  var cleanName = String(memberName || "").trim();
  if (profKey === "michael" && state.michael) {
    state.michael.linkedMemberName = cleanName;
  } else if (profKey === "kinyion" && state.kinyion) {
    state.kinyion.linkedMemberName = cleanName;
  } else if (profKey === "test" && state.test) {
    state.test.linkedMemberName = cleanName;
  } else if (state.customUsers && Array.isArray(state.customUsers)) {
    for (var i = 0; i < state.customUsers.length; i++) {
      if (state.customUsers[i].key === profKey) {
        state.customUsers[i].linkedMemberName = cleanName;
        var lb = findLeaderboardEntryByName(cleanName);
        if (lb) {
          state.customUsers[i].priorPts = parseFloat(lb.priorPts) || 0;
          state.customUsers[i].rank = lb.rank || "Linked";
        }
        break;
      }
    }
  }

  // If that leaderboard member already has weekly spreadsheet picks loaded, pull them into this profile
  if (cleanName) {
    var pm = findPoolMemberByName(cleanName);
    if (pm && !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES)) {
      if (!state[profKey]) state[profKey] = { picks: {}, tiebreaker: "28-24", target: 20 };
      state[profKey].picks = Object.assign({}, pm.picks);
      if (pm.tiebreaker && pm.tiebreaker !== "—") state[profKey].tiebreaker = pm.tiebreaker;
      delete state[profKey]._manualEditsThisWeek;
    }
  }

  regradeAllPoolMembersLive();
  pushMultiUserAndPrivacyToFirebase();
  renderAll();
  if (document.getElementById("opp-modal-backdrop") && document.getElementById("opp-modal-backdrop").style.display === "flex") {
    openUserAndPrivacyModal();
  }
}

function claimOrCompareFromLeaderboard(memberName, mode) {
  var stdName = standardizeParticipantName(memberName);
  if (mode === "compare") {
    setCompareTarget("pm:" + stdName);
    switchMainView("condensed");
    return;
  }
  // Check if a profile is already linked to this leaderboard member
  var existingLinkedPf = getProfileLinkedToMemberName(stdName);
  if (existingLinkedPf) {
    switchProfile(existingLinkedPf.key);
    return;
  }
  // Otherwise, create a new linked user profile for this leaderboard participant & switch to them!
  var cleanKey = "u_" + stdName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14) + "_" + (Date.now() % 10000);
  var pm = findPoolMemberByName(stdName);
  var lb = findLeaderboardEntryByName(stdName);
  var priorPts = lb ? (parseFloat(lb.priorPts) || 0) : (pm ? (parseFloat(pm.priorPts) || 0) : 0);
  var rankStr = lb && lb.rank ? lb.rank : (pm && pm.priorRank ? pm.priorRank : "Linked");

  var isDeletedLb = !!((state.deletedPicksByMember && state.deletedPicksByMember[stdName.toLowerCase()]) || (pm && pm._picksCleared));
  var initialPicks = {};
  var hasSheet = !isDeletedLb && pm && !pm.awaitingSheet && pm.picks && hasSubmittedPicksForCurrentSlate(pm.picks, GAMES);
  if (hasSheet) {
    for (var gIdx = 0; gIdx < GAMES.length; gIdx++) {
      var gm = GAMES[gIdx];
      if (pm.picks[gm.id]) initialPicks[gm.id] = pm.picks[gm.id];
    }
  }

  state.customUsers.push({
    key: cleanKey,
    name: stdName,
    linkedMemberName: stdName,
    priorPts: priorPts,
    rank: rankStr,
    color: "#10b981"
  });
  state[cleanKey] = {
    picks: initialPicks,
    tiebreaker: (pm && pm.tiebreaker && pm.tiebreaker !== "—") ? pm.tiebreaker : "28-24",
    target: 20,
    linkedMemberName: stdName
  };
  state.profilePrivacy[cleanKey] = {
    hidden: false,
    pin: "",
    revealAtKickoff: true,
    autoUnhideOnSheet: true,
    autoUnhideFridayNight: true
  };
  SESSION_UNLOCKED_PROFILES[cleanKey] = true;
  activeProfile = cleanKey;
  regradeAllPoolMembersLive();
  pushMultiUserAndPrivacyToFirebase();
  pushProfileToFirebase(cleanKey);
  renderAll();
}

function openUserAndPrivacyModal() {
  ensureMultiUserAndPrivacyState();
  var myKey = getMyInstanceProfileKey();
  var myMeta = getProfileMetaByKey(myKey);
  var myPriv = state.profilePrivacy[myKey] || { hidden: false, revealAtKickoff: true, autoUnhideOnSheet: false, autoUnhideFridayNight: false };
  var cmpDesc = resolveCompareTargetDescriptor();

  document.getElementById("modal-team-title").textContent = "🔒 My Pick Privacy & Head-to-Head Settings";
  document.getElementById("modal-team-body").innerHTML =
    '<div style="background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
        '<strong style="font-size:0.88rem;color:var(--text);">👤 Your Bound Instance: <span style="color:var(--win);">' + myMeta.name + '</span></strong>' +
        '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);font-weight:800;" onclick="closeOppModal(); openAuthModal();">🔐 Account & Google/Email Sign-In</button>' +
      '</div>' +
      '<div style="font-size:0.73rem;color:var(--text);line-height:1.4;">' +
        '🛡️ <strong>No Profile Swapping or PIN Bypass:</strong> Each user signs into their own account on their own device. Nobody can switch into your profile or enter a PIN to peek at your hidden picks.' +
      '</div>' +
    '</div>' +

    '<div style="background:var(--card);border:1px solid var(--border-muted);border-radius:10px;padding:12px;margin-bottom:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
        '<div>' +
          '<div style="font-size:0.84rem;font-weight:800;color:var(--text);">🕵️ Pre-Kickoff Anti-Spy Pick Visibility</div>' +
          '<div style="font-size:0.71rem;color:var(--muted);">When hidden, your picks stay 100% visible to YOU on your signed-in device, but show as <code>🔒 Hidden Until Kickoff</code> on everyone else\'s screens.</div>' +
        '</div>' +
        '<button type="button" class="btn-sm" style="padding:7px 14px;font-weight:900;' + (myPriv.hidden ? 'background:var(--raised);border-color:var(--border);color:var(--loss);' : 'background:var(--raised);border-color:var(--border);color:var(--win);') + '" onclick="toggleQuickLockActiveProfile()">' +
          (myPriv.hidden ? '🔒 Currently Hidden From Others (Click to Make Public)' : '👁️ Currently Public (Click to Hide From Others)') +
        '</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:7px;font-size:0.74rem;color:var(--text);padding-top:8px;border-top:1px solid var(--border);">' +
        '<label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" ' + (myPriv.revealAtKickoff !== false ? 'checked' : '') + ' onchange="toggleProfilePrivacyOption(\'' + myKey + '\', \'revealAtKickoff\', this.checked)" /> 🏈 Automatically reveal each individual game\'s pick to other users as soon as that game kicks off</label>' +
        '<label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" ' + (myPriv.autoUnhideOnSheet === true ? 'checked' : '') + ' onchange="toggleProfilePrivacyOption(\'' + myKey + '\', \'autoUnhideOnSheet\', this.checked)" /> 📊 Automatically reveal all my picks once the official weekly pool spreadsheet is imported</label>' +
        '<label style="cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" ' + (myPriv.autoUnhideFridayNight === true ? 'checked' : '') + ' onchange="toggleProfilePrivacyOption(\'' + myKey + '\', \'autoUnhideFridayNight\', this.checked)" /> 🌙 Automatically reveal my picks starting Friday at 5:00 PM CST</label>' +
      '</div>' +
    '</div>' +

    '<div style="background:var(--panel-alt);border:1px solid var(--border-muted);border-radius:10px;padding:12px;">' +
      '<div style="font-size:0.82rem;font-weight:800;color:var(--text);margin-bottom:6px;">⚔️ Read-Only Head-to-Head Comparison Target</div>' +
      '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;">Select any other signed-in user or any of the 89 pool leaderboard members to compare picks against side-by-side (read-only):</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<span style="font-size:0.76rem;color:var(--text);font-weight:800;">Currently Comparing vs: <span style="color:var(--warn);">' + (cmpDesc ? cmpDesc.name : 'Nobody yet') + '</span></span>' +
        '<button type="button" class="btn-sm" style="border-color:var(--border);color:var(--text);font-weight:800;" onclick="closeOppModal(); switchMainView(\'condensed\');">📋 Open Side-by-Side Comparison</button>' +
      '</div>' +
    '</div>';

  document.getElementById("opp-modal-backdrop").style.display = "flex";
}

function toggleProfilePrivacyOption(profKey, fieldName, checked) {
  ensureMultiUserAndPrivacyState();
  var myKey = getMyInstanceProfileKey();
  var targetKey = isMyOwnInstanceProfile(profKey) ? profKey : myKey;
  if (!state.profilePrivacy[targetKey]) {
    state.profilePrivacy[targetKey] = { hidden: false, pin: "", revealAtKickoff: true, autoUnhideOnSheet: false, autoUnhideFridayNight: false };
  }
  state.profilePrivacy[targetKey][fieldName] = !!checked;
  if ((fieldName === "autoUnhideOnSheet" || fieldName === "autoUnhideFridayNight") && checked) {
    state.profilePrivacy[targetKey].manualLockOverride = false;
  }
  pushMultiUserAndPrivacyToFirebase();
  renderAll();
  refreshUserModalIfOpen();
}

function syncActiveProfileControlsUI() {
  var meta = getProfileMetaByKey(activeProfile);
  var topProf = document.getElementById("top-profile-name");
  if (topProf) topProf.textContent = meta.name;
  if (!state[activeProfile]) state[activeProfile] = { picks: {}, tiebreaker: "28-24", target: 20 };
  var tbVal = state[activeProfile].tiebreaker || "28-24";
  var tbEl = document.getElementById("tiebreaker-input");
  var simpleTbEl = document.getElementById("simple-tiebreaker-input");
  var slEl = document.getElementById("target-slider");
  setInputValueUnlessEditing(tbEl, tbVal);
  setInputValueUnlessEditing(simpleTbEl, tbVal);
  setInputValueUnlessEditing(slEl, state[activeProfile].target || 20);
}


