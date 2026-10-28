// ============================================================================
// COMMISSIONER › USERS: account info only (no picks). One row per player: name, email /
// username, join date, role, dues, last active. Actions: edit name, change role,
// archive / restore, resend invite. Merge duplicates (pick the record to keep). Every action
// is logged (logCommishAction / the archive audit entries).
//
// Sources: roster (leaderboard + pool rows), app profiles (state.customUsers), removed players
// (commissionerConfig.archivedProfiles), account links (BOUND_ACCOUNTS), account records
// (pickem_v14_accounts, commissioner-readable; loaded when the tab opens) and each pick doc's
// updatedAt (USER_DOC_META, from the pick-doc listener).
// ============================================================================
var USERS_FILTER = "all"; // all | linked | unlinked | commissioners | archived
var USERS_QUERY = "";
var ACCOUNTS_CACHE = null; // { byEmail: {}, byKey: {}, loadedAt } once loaded
var ACCOUNTS_LOADING = false;

function loadAccountsForUsersTab(force) {
  if ((ACCOUNTS_CACHE && !force) || ACCOUNTS_LOADING || !fsDb || !isVerifiedCommissioner()) return;
  ACCOUNTS_LOADING = true;
  fsDb.collection("pickem_v14_accounts").get().then(function(snap) {
    var byEmail = {}, byKey = {};
    snap.forEach(function(d) {
      var a = d.data() || {};
      a._id = d.id;
      if (a.email) byEmail[String(a.email).toLowerCase()] = a;
      if (a.boundProfileKey) byKey[a.boundProfileKey] = a;
    });
    ACCOUNTS_CACHE = { byEmail: byEmail, byKey: byKey, loadedAt: Date.now() };
  }, function() {
    ACCOUNTS_CACHE = { byEmail: {}, byKey: {}, error: true };
  }).then(function() {
    ACCOUNTS_LOADING = false;
    if (ACTIVE_COMMISH_TAB === "users") renderCommissionerModalBody();
  });
}

function usersRoleOf(email) {
  email = String(email || "").toLowerCase();
  if (!email) return { id: "none", label: "—" };
  var cfg = ensureCommissionerConfig();
  var primary = String(cfg.primaryCommissionerEmail || "").toLowerCase();
  if (email === primary || email === "michael4ts14@gmail.com" || email === "commissioner@separatedatturf.com") return { id: "owner", label: "Commissioner" };
  var rec = (cfg.authorizedCommissioners || {})[email];
  if (rec && rec.enabled !== false) return { id: "co", label: "Co-commissioner" };
  return { id: "player", label: "Player" };
}

function laterIso(a, b) {
  if (!a) return b || "";
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function shortDate(iso) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function userRecords() {
  var cfg = ensureCommissionerConfig();
  var out = [], seenKeys = {}, seenLow = {};
  var acct = ACCOUNTS_CACHE || { byEmail: {}, byKey: {} };
  var add = function(r) {
    var b = BOUND_ACCOUNTS[r.key] || null;
    var a = acct.byKey[r.key] || null;
    var email = String((b && b.email) || r.email || (a && a.email) || "").toLowerCase();
    if (!a && email) a = acct.byEmail[email] || null;
    var meta = (typeof USER_DOC_META !== "undefined" && USER_DOC_META[r.key]) || {};
    r.binding = b;
    r.account = a;
    r.email = email;
    r.preApproved = !email && r.low ? String((cfg.playerEmailsMap || {})[r.low] || "") : "";
    r.displayName = (b && b.displayName) || (a && a.displayName) || "";
    r.joined = (b && b.boundAt) || (r.archived && r.archived.record && r.archived.record.joinedAt) || "";
    r.lastActive = laterIso(meta.updatedAt || "", (a && a.updatedAt) || "");
    r.role = usersRoleOf(b ? email : "");
    r.duesPaid = r.low ? !!cfg.duesPaidMap[r.low] : null;
    out.push(r);
    seenKeys[r.key] = true;
    if (r.low) seenLow[r.low] = true;
  };
  // Roster = the leaderboard plus pool rows that aren't the row grading adds for an app-only
  // profile (those are listed as app profiles below).
  var appKeys = {};
  appOnlyProfiles().forEach(function(cu) { appKeys[cu.key] = true; });
  var rosterNames = [];
  (state.leaderboard || []).concat(state.poolMembers || []).forEach(function(row) {
    var n = row && row.name ? standardizeParticipantName(row.name) : "";
    var low = n.toLowerCase();
    if (!n || seenLow[low]) return;
    if (!findLeaderboardEntryByName(n) && appKeys[profileKeyForMember(n)]) return;
    seenLow[low] = true;
    rosterNames.push(n);
  });
  seenLow = {};
  rosterNames.forEach(function(n) {
    var key = profileKeyForMember(n);
    if (!key || seenKeys[key] || isProfileArchived(key)) return;
    add({ key: key, name: fixDisplaySpelling(rosterDisplayName(n)), low: n.toLowerCase(), kind: "roster" });
  });
  (state.customUsers || []).forEach(function(cu) {
    if (!cu || !cu.key || seenKeys[cu.key] || isProfileArchived(cu.key)) return;
    add({ key: cu.key, name: cu.name, low: "", kind: "app", email: cu.email || "", isDuplicate: isDuplicateProfile(cu) });
  });
  var arch = cfg.archivedProfiles || {};
  Object.keys(arch).forEach(function(k) {
    var e = arch[k] || {};
    add({ key: k, name: e.name || k, low: "", kind: "archived", email: e.email || "", archived: e, archivedAt: e.archivedAt });
  });
  return out;
}

function userMatchesFilter(r) {
  if (USERS_QUERY) {
    var q = USERS_QUERY.toLowerCase();
    if ((r.name + " " + r.email + " " + r.displayName + " " + r.key).toLowerCase().indexOf(q) === -1) return false;
  }
  if (USERS_FILTER === "archived") return r.kind === "archived";
  if (r.kind === "archived") return false;
  if (USERS_FILTER === "linked") return !!r.binding;
  if (USERS_FILTER === "unlinked") return !r.binding;
  if (USERS_FILTER === "commissioners") return r.role.id === "owner" || r.role.id === "co";
  return true;
}

function userRowHtml(r) {
  var k = jsArgAttr(r.key);
  var esc = escapeShellHtml;
  var canArchive = r.kind !== "archived" && (state.customUsers || []).some(function(c) { return c.key === r.key; });
  var actions = [];
  if (r.kind !== "archived") {
    if (r.binding || r.account || r.kind === "app") actions.push('<button type="button" class="btn-sm" onclick="editUserDisplayName(\'' + k + '\')">Edit name</button>');
    if (r.binding && r.email && r.role.id !== "owner") {
      actions.push('<label class="users-role"><span class="sr-only">Role for ' + esc(r.name) + '</span><select class="search-input" onchange="setUserRole(\'' + k + '\', this.value, this)">' +
        '<option value="player"' + (r.role.id === "player" ? " selected" : "") + '>Player</option>' +
        '<option value="co"' + (r.role.id === "co" ? " selected" : "") + '>Co-commissioner</option></select></label>');
    }
    actions.push('<button type="button" class="btn-sm" onclick="resendUserInvite(\'' + k + '\')">' + (r.binding ? "Send link" : "Resend invite") + '</button>');
    if (canArchive) actions.push('<button type="button" class="btn-sm acct-danger" onclick="removeAppOnlyPlayer(\'' + k + '\')">Archive</button>');
  } else {
    actions.push('<button type="button" class="btn-sm" onclick="restoreArchivedPlayer(\'' + k + '\')">Restore</button>');
  }
  var tags = '';
  if (r.kind === "app") tags += ' <span class="acct-tag">' + (r.isDuplicate ? "Duplicate" : "App only") + '</span>';
  if (r.kind === "archived") tags += ' <span class="acct-tag is-warn">Archived ' + esc(shortDate(r.archivedAt)) + '</span>';
  var email = r.email ? esc(r.email) : (r.preApproved ? 'Pre-approved: ' + esc(r.preApproved) : '<span class="muted-note">No account</span>');
  return '<li class="users-row" data-user-key="' + esc(r.key) + '">' +
    '<div class="users-main">' +
      '<div class="users-name">' + esc(r.name) + tags + '</div>' +
      '<div class="users-sub">' + email + (r.displayName && r.displayName !== r.name ? ' · shows as ' + esc(r.displayName) : '') + '</div>' +
    '</div>' +
    '<dl class="users-facts">' +
      '<div><dt>Joined</dt><dd>' + (esc(shortDate(r.joined)) || "—") + '</dd></div>' +
      '<div><dt>Role</dt><dd>' + esc(r.role.label) + '</dd></div>' +
      '<div><dt>Dues</dt><dd>' + (r.duesPaid === null ? "—" : (r.duesPaid ? '<span class="users-paid">Paid</span>' : '<span class="users-unpaid">Unpaid</span>')) + '</dd></div>' +
      '<div><dt>Last active</dt><dd>' + (r.lastActive ? esc(formatAgo(r.lastActive)) : "—") + '</dd></div>' +
    '</dl>' +
    '<div class="users-actions">' + actions.join("") + '</div>' +
  '</li>';
}

function usersMergeHtml(all) {
  var live = all.filter(function(r) { return r.kind !== "archived"; });
  var keepOpts = live.slice().sort(function(a, b) { return a.name.localeCompare(b.name); }).map(function(r) {
    return '<option value="' + escapeShellHtml(r.key) + '">' + escapeShellHtml(r.name + (r.email ? " · " + r.email : "") + (r.kind === "app" ? " (app only)" : "")) + '</option>';
  }).join("");
  var dupOpts = live.filter(function(r) { return r.kind === "app"; }).map(function(r) {
    return '<option value="' + escapeShellHtml(r.key) + '">' + escapeShellHtml(r.name + (r.email ? " · " + r.email : "") + (r.isDuplicate ? " (duplicate)" : "")) + '</option>';
  }).join("");
  return '<details class="acct-details users-merge"><summary>Merge duplicates</summary>' +
    '<p class="muted-note">Pick the record to keep and the duplicate to fold into it. The duplicate\'s account moves to the kept record, its picks fill any game the kept record hasn\'t picked this week (the kept record\'s own picks and tiebreaker win), and the duplicate is archived with its pick history, so it can be restored. Roster rows and past weeks\' standings aren\'t changed.</p>' +
    (dupOpts ? '<div class="users-merge-row">' +
      '<label>Keep <select class="search-input" id="users-merge-keep">' + keepOpts + '</select></label>' +
      '<label>Merge away <select class="search-input" id="users-merge-dup">' + dupOpts + '</select></label>' +
      '<button type="button" class="btn-sm" onclick="mergeDuplicateUsers()">Review merge</button></div>'
      : '<p class="empty-note">No app-only or duplicate records to merge.</p>') +
  '</details>';
}

function usersTabHtml() {
  loadAccountsForUsersTab();
  var all = userRecords();
  var shown = all.filter(userMatchesFilter).sort(function(a, b) { return a.name.localeCompare(b.name); });
  var count = function(f) { var keep = USERS_FILTER; USERS_FILTER = f; var q = USERS_QUERY; USERS_QUERY = ""; var n = all.filter(userMatchesFilter).length; USERS_FILTER = keep; USERS_QUERY = q; return n; };
  var chip = function(id, label) {
    return '<button type="button" class="btn-sm' + (USERS_FILTER === id ? ' active' : '') + '" aria-pressed="' + (USERS_FILTER === id) + '" onclick="setUsersFilter(\'' + id + '\')">' + label + ' (' + count(id) + ')</button>';
  };
  return '<section class="console-section users-tab" aria-labelledby="users-h">' +
    '<h3 class="console-h" id="users-h">Users</h3>' +
    '<p class="muted-note">Account details only; picks live in Submissions. ' +
      (ACCOUNTS_CACHE ? (ACCOUNTS_CACHE.error ? "Account records couldn't be loaded, so some emails and last-active times are missing." : "") : "Loading account records…") + '</p>' +
    '<div class="users-toolbar">' +
      '<input type="search" id="users-search" class="search-input" placeholder="Search name or email" aria-label="Search users" value="' + escapeShellHtml(USERS_QUERY) + '" oninput="USERS_QUERY=this.value; refreshUsersList();" />' +
      '<div class="chip-row" role="group" aria-label="Show">' + chip("all", "All") + chip("linked", "Linked") + chip("unlinked", "No account") + chip("commissioners", "Commissioners") + chip("archived", "Archived") + '</div>' +
    '</div>' +
    '<ul class="users-list" id="users-list" data-keep-scroll="users-list">' + (shown.length ? shown.map(userRowHtml).join("") : '<li class="empty-note">No users match.</li>') + '</ul>' +
    usersMergeHtml(all) +
    auditLogHtml() +
  '</section>';
}

function refreshUsersList() {
  var list = document.getElementById("users-list");
  if (!list) return;
  var shown = userRecords().filter(userMatchesFilter).sort(function(a, b) { return a.name.localeCompare(b.name); });
  list.innerHTML = shown.length ? shown.map(userRowHtml).join("") : '<li class="empty-note">No users match.</li>';
}

function setUsersFilter(f) {
  USERS_FILTER = f;
  renderCommissionerModalBody();
}

function findUserRecord(key) {
  return userRecords().filter(function(r) { return r.key === key; })[0] || null;
}

// ---------- Actions ----------
// Edits the name the account shows as (link record, account record, and an app-only profile's
// own name). A roster name is what weekly sheets and standings match on, so it isn't renamed here.
function editUserDisplayName(key) {
  if (!assertCommissionerRole("editing names")) return;
  var r = findUserRecord(key);
  if (!r) return;
  var current = r.kind === "app" ? r.name : (r.displayName || r.name);
  var val = window.prompt("Display name for " + r.name + (r.kind === "roster" ? " (the roster name used for standings stays " + r.name + ")" : "") + ":", current);
  if (val === null) return;
  val = String(val).trim().replace(/\s+/g, " ");
  if (!val || val === current) return;
  if (val.length > 40) { showAppToast("Keep names under 40 characters."); return; }
  var jobs = [];
  if (r.binding) jobs.push(fsDb.collection("pickem_v14_bindings").doc(key).update({ displayName: val }));
  if (r.account && r.account._id) jobs.push(fsDb.collection("pickem_v14_accounts").doc(r.account._id).set({ displayName: val }, { merge: true }));
  var cuList = null;
  if (r.kind === "app") {
    cuList = (state.customUsers || []).map(function(c) { return c.key === key ? Object.assign({}, c, { name: val }) : c; });
    jobs.push(fsDb.collection("pickem_v14").doc("shared_state").set({ customUsers: cuList, updatedAt: new Date().toISOString() }, { merge: true }));
  }
  if (!jobs.length) { showAppToast(r.name + " has no account or app profile to rename."); return; }
  Promise.all(jobs).then(function() {
    if (cuList) state.customUsers = cuList;
    if (r.binding) BOUND_ACCOUNTS[key].displayName = val;
    if (r.account) r.account.displayName = val;
    logCommishAction("Renamed " + r.name + " to " + val, r.name, "");
    renderAll();
    renderCommissionerModalBody();
    showAppToast("Saved: " + r.name + " now shows as " + val + ".");
  }, function(e) { showAppToast("Couldn't rename (" + ((e && e.code) || "error") + "). Nothing was changed."); });
}

function setUserRole(key, role, selectEl) {
  if (!assertCommissionerRole("changing roles")) return;
  var r = findUserRecord(key);
  if (!r || !r.email) return;
  var reset = function() { if (selectEl) selectEl.value = r.role.id === "co" ? "co" : "player"; };
  if ((role === "co") === (r.role.id === "co")) return;
  confirmDanger(role === "co"
    ? "Make " + r.name + " (" + r.email + ") a co-commissioner? They get the full Commissioner console, including picks overrides, dues and this Users tab."
    : "Remove " + r.name + "'s co-commissioner access? They become a regular player.", role === "co" ? "Make co-commissioner" : "Remove access", function() {
    if (role === "co") commishGrantRole(r.email, r.name);
    else commishRevokeRole(r.email);
  });
  // Cancelling leaves the dropdown on the current role.
  var bd = document.getElementById("confirm-backdrop");
  if (bd) {
    var watch = new MutationObserver(function() { if (bd.hidden) { watch.disconnect(); setTimeout(function() { if (ACTIVE_COMMISH_TAB === "users") refreshUsersList(); else reset(); }, 0); } });
    watch.observe(bd, { attributes: true, attributeFilter: ["hidden"] });
  }
}

function resendUserInvite(key) {
  if (!assertCommissionerRole("sending invites")) return;
  var r = findUserRecord(key);
  if (!r) return;
  var link = typeof leagueInviteLink === "function" ? leagueInviteLink() : "";
  var appUrl = window.location.origin + "/";
  var url = link || appUrl;
  var body = "Hi " + r.name.split(" ")[0] + ",\n\nHere's your link to the Separated at Turf pick'em:\n" + url + "\n\n" +
    (r.binding ? "Sign in with " + r.email + " and you'll land on your picks." : "Open it, sign in, and choose \"I'm already in the league\" to claim " + r.name + ".") + "\n";
  var email = r.email || r.preApproved;
  var copy = function() {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(body).catch(function() {});
  };
  copy();
  if (email) {
    window.location.href = "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent("Your pick'em link") + "&body=" + encodeURIComponent(body);
    showAppToast("Opening an email to " + email + " (the message is also copied).");
  } else {
    showAppToast("No email on file for " + r.name + ". The invite message is copied; send it however you reach them.");
  }
  if (!link) showAppToast("No league invite link is active, so the plain app link was used. Create one under Roster › League access.");
  logCommishAction("Sent invite link to " + r.name + (email ? " (" + email + ")" : " (copied)"), r.name, "");
}

function mergeDuplicateUsers() {
  var keepKey = (document.getElementById("users-merge-keep") || {}).value;
  var dupKey = (document.getElementById("users-merge-dup") || {}).value;
  if (!keepKey || !dupKey) return;
  if (keepKey === dupKey) { showAppToast("Choose two different records."); return; }
  var keep = findUserRecord(keepKey);
  if (!keep) return;
  // mergeProfileInto takes the kept record's member name.
  var keepName = keep.kind === "roster" ? keep.name : (getLinkedMemberNameForProfile(keepKey) || keep.name);
  mergeProfileInto(dupKey, keepName);
}

// ---------- Console wiring ----------
var _usersPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _usersPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (body && ACTIVE_COMMISH_TAB === "users" && isVerifiedCommissioner()) body.innerHTML = usersTabHtml();
  return res;
};
