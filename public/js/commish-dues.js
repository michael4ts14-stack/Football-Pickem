// ============================================================================
// COMMISSIONER DUES (Roster tab): paid / owed totals, All / Paid / Unpaid filter, multi-select
// with Mark paid / Mark unpaid, Mark all paid (each bulk change asks first).
// Tapping Paid changes that one row in place and saves just that player's flag
// (commissionerConfig.duesPaidMap.<name>), so the list never re-renders, refetches or jumps.
// A failed save puts the row back. Loaded after account-security.js; its
// renderCommissionerModalBody wrapper adds the panel to the Roster tab.
// ============================================================================
var DUES_FILTER = "all"; // "all" | "paid" | "unpaid"
var DUES_SELECTED = {};  // low name -> true

// Dues are keyed by profile key when the player has a profile (so a rename keeps the flag) and by
// lowercase name otherwise, and scoped to a season (B42). Flags saved before this change are plain
// name keys; they still count for DUES_LEGACY_SEASON, the season in progress when this shipped.
var DUES_LEGACY_SEASON = "2026";

function duesSeason() {
  return String(ensureCommissionerConfig().duesSeason || new Date().getFullYear());
}

function duesKeyForName(name) {
  var low = standardizeParticipantName(name).toLowerCase();
  var prof = getProfileLinkedToMemberName(name);
  return prof && !prof.isSandbox ? prof.key : low;
}

function duesStorageKey(key) {
  return duesSeason() + ":" + key;
}

function duesLegacyKey(key, roster) {
  var hit = (roster || cachedDuesRoster()).index[key];
  return hit ? standardizeParticipantName(hit.name).toLowerCase() : key;
}

// The roster is rebuilt from poolMembers + customUsers with a profile lookup per player. Every
// row's isDuesPaid needs it, so it is cached. Each lookup checks a 32-bit FNV-1a hash of what
// the roster is built from (names, profile keys and links), so a name or link changed in place
// anywhere rebuilds it without anyone having to say so. Renders resolve the roster once and
// pass it down, so a list of n players hashes once, not n times.
var DUES_ROSTER_CACHE = null;
function computeFastDuesSignature() {
  var h = fnv1aMix(2166136261, DUES_ROSTER_SEQ);
  var pm = state.poolMembers, cu = state.customUsers;
  if (Array.isArray(pm)) {
    h = fnv1aMix(h, pm.length);
    for (var i = 0; i < pm.length; i++) {
      var m = pm[i];
      h = fnv1aMix(h, m ? m.name || "" : "");
    }
  }
  if (Array.isArray(cu)) {
    h = fnv1aMix(h, cu.length);
    for (var j = 0; j < cu.length; j++) {
      var u = cu[j];
      if (!u) continue;
      h = fnv1aMix(h, u.key || "");
      h = fnv1aMix(h, u.name || "");
      h = fnv1aMix(h, u.linkedMemberName === undefined ? "\u0000" : u.linkedMemberName);
      h = fnv1aMix(h, u.isSandbox ? 1 : 0);
    }
  }
  ["michael", "kinyion", "test"].forEach(function(k) {
    var p = state[k];
    h = fnv1aMix(h, p && p.linkedMemberName !== undefined ? p.linkedMemberName : "\u0000");
  });
  return h;
}
function cachedDuesRoster() {
  var sig = computeFastDuesSignature();
  var c = DUES_ROSTER_CACHE;
  if (c && c.sig === sig) return c;
  var list = buildDuesRoster(), index = {};
  list.forEach(function(r) { index[r.low] = r; });
  DUES_ROSTER_CACHE = { sig: sig, list: list, index: index };
  return DUES_ROSTER_CACHE;
}

function duesRosterIndex() {
  return cachedDuesRoster().index;
}

function duesRoster() {
  return cachedDuesRoster().list.slice();
}

function buildDuesRoster() {
  var seen = {}, out = [];
  var add = function(key, name) {
    if (!key || !name || seen[key]) return;
    seen[key] = true;
    out.push({ low: key, name: standardizeParticipantName(name) });
  };
  (state.poolMembers || []).forEach(function(pm) { if (pm && pm.name) add(duesKeyForName(pm.name), pm.name); });
  (state.customUsers || []).forEach(function(cu) { if (cu && cu.key && cu.name) add(cu.key, cu.linkedMemberName || cu.name); });
  return out.sort(function(a, b) { return fixDisplaySpelling(a.name).localeCompare(fixDisplaySpelling(b.name)); });
}

function duesDisplayName(low) {
  var hit = duesRosterIndex()[low];
  return fixDisplaySpelling(hit ? hit.name : low);
}

function duesFee() {
  var fee = parseFloat(ensureCommissionerConfig().entryFeeDollars);
  return isNaN(fee) ? 25 : fee;
}

// roster: the cachedDuesRoster() a caller looping over many rows already resolved.
function isDuesPaid(key, roster) {
  var map = ensureCommissionerConfig().duesPaidMap;
  var sk = duesStorageKey(key);
  if (Object.prototype.hasOwnProperty.call(map, sk)) return !!map[sk];
  return duesSeason() === DUES_LEGACY_SEASON && !!map[duesLegacyKey(key, roster)];
}

function duesTotals() {
  var roster = cachedDuesRoster();
  var list = roster.list, fee = duesFee(), paid = 0;
  list.forEach(function(r) { if (isDuesPaid(r.low, roster)) paid++; });
  return { count: list.length, paid: paid, unpaid: list.length - paid, fee: fee, paidDollars: paid * fee, owedDollars: (list.length - paid) * fee };
}

function duesRowHtml(r, roster) {
  var paid = isDuesPaid(r.low, roster);
  var low = escapeShellHtml(r.low);
  var arg = jsArgAttr(r.low);
  return '<li class="dues-row' + (paid ? ' is-paid' : '') + '" data-dues-key="' + low + '">' +
    '<label class="dues-check"><input type="checkbox" ' + (DUES_SELECTED[r.low] ? 'checked ' : '') + 'onchange="toggleDuesSelected(\'' + arg + '\', this.checked)" aria-label="Select ' + escapeShellHtml(fixDisplaySpelling(r.name)) + '" /></label>' +
    '<span class="dues-name">' + escapeShellHtml(fixDisplaySpelling(r.name)) + '</span>' +
    '<button type="button" class="dues-toggle' + (paid ? ' is-paid' : '') + '" aria-pressed="' + paid + '" onclick="toggleDuesPaidInPlace(\'' + arg + '\')">' +
      (paid ? 'Paid' : 'Unpaid') + '</button>' +
  '</li>';
}

function duesListHtml() {
  var roster = cachedDuesRoster();
  var rows = roster.list.filter(function(r) {
    if (DUES_FILTER === "paid") return isDuesPaid(r.low, roster);
    if (DUES_FILTER === "unpaid") return !isDuesPaid(r.low, roster);
    return true;
  });
  return rows.length ? rows.map(function(r) { return duesRowHtml(r, roster); }).join("") : '<li class="dues-empty">No players match this filter.</li>';
}

function duesTotalsHtml() {
  var t = duesTotals();
  return '<div class="dues-total"><span class="dues-total-label">Paid</span><strong>$' + t.paidDollars + '</strong><span class="dues-total-sub">' + t.paid + ' of ' + t.count + '</span></div>' +
    '<div class="dues-total is-owed"><span class="dues-total-label">Owed</span><strong>$' + t.owedDollars + '</strong><span class="dues-total-sub">' + t.unpaid + ' unpaid × $' + t.fee + '</span></div>';
}

function duesFilterChipsHtml() {
  var t = duesTotals();
  var chip = function(id, label) {
    return '<button type="button" class="btn-sm' + (DUES_FILTER === id ? ' active' : '') + '" aria-pressed="' + (DUES_FILTER === id) + '" onclick="setDuesFilter(\'' + id + '\')">' + label + '</button>';
  };
  return chip("all", "All (" + t.count + ")") + chip("paid", "Paid (" + t.paid + ")") + chip("unpaid", "Unpaid (" + t.unpaid + ")");
}

function selectedDuesCount() {
  return Object.keys(DUES_SELECTED).filter(function(k) { return DUES_SELECTED[k]; }).length;
}

function duesPanelHtml() {
  var n = selectedDuesCount();
  return '<section class="console-section dues-panel" aria-labelledby="dues-h">' +
    '<h3 class="console-h" id="dues-h">League dues</h3>' +
    '<div class="dues-totals" id="dues-totals">' + duesTotalsHtml() + '</div>' +
    '<div class="dues-toolbar">' +
      '<div class="chip-row" role="group" aria-label="Show" id="dues-filter-chips">' + duesFilterChipsHtml() + '</div>' +
      '<label class="dues-fee">Entry fee $<input type="number" min="0" class="search-input" value="' + duesFee() + '" onchange="setDuesEntryFee(this.value)" /></label>' +
    '</div>' +
    '<div class="dues-bulk">' +
      '<label class="dues-check"><input type="checkbox" id="dues-select-all" onchange="selectAllShownDues(this.checked)" aria-label="Select all shown" /> <span>Select shown</span></label>' +
      '<span class="dues-selected-count" id="dues-selected-count" aria-live="polite">' + (n ? n + ' selected' : '') + '</span>' +
      '<button type="button" class="btn-sm" id="dues-mark-paid" onclick="bulkSetDues(true)"' + (n ? '' : ' disabled') + '>Mark paid</button>' +
      '<button type="button" class="btn-sm" id="dues-mark-unpaid" onclick="bulkSetDues(false)"' + (n ? '' : ' disabled') + '>Mark unpaid</button>' +
      '<button type="button" class="btn-sm dues-all-paid" onclick="markAllDuesPaid()">Mark all paid</button>' +
    '</div>' +
    '<ul class="dues-list" id="dues-list" data-keep-scroll="dues-list">' + duesListHtml() + '</ul>' +
  '</section>';
}

// ---------- In-place updates (no list re-render) ----------
function refreshDuesChrome() {
  var totals = document.getElementById("dues-totals");
  if (totals) totals.innerHTML = duesTotalsHtml();
  var chips = document.getElementById("dues-filter-chips");
  if (chips) chips.innerHTML = duesFilterChipsHtml();
  var n = selectedDuesCount();
  var cnt = document.getElementById("dues-selected-count");
  if (cnt) cnt.textContent = n ? n + " selected" : "";
  ["dues-mark-paid", "dues-mark-unpaid"].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = !n; });
}

function paintDuesRow(low) {
  var row = document.querySelector('.dues-row[data-dues-key="' + (window.CSS && CSS.escape ? CSS.escape(low) : low) + '"]');
  if (!row) return;
  var paid = isDuesPaid(low);
  row.classList.toggle("is-paid", paid);
  var btn = row.querySelector(".dues-toggle");
  if (btn) {
    btn.classList.toggle("is-paid", paid);
    btn.setAttribute("aria-pressed", String(paid));
    btn.textContent = paid ? "Paid" : "Unpaid";
  }
  var chk = row.querySelector('input[type="checkbox"]');
  if (chk) chk.checked = !!DUES_SELECTED[low];
}

// Saves only the given players' flags plus one audit entry; the rest of commissionerConfig
// is untouched, so two commissioners marking different players never overwrite each other.
function saveDuesFlags(changes, auditText) {
  if (!fsDb || !isVerifiedCommissioner()) return Promise.reject({ code: "permission-denied" });
  var FP = firebase.firestore.FieldPath;
  var args = [];
  Object.keys(changes).forEach(function(low) { args.push(new FP("commissionerConfig", "duesPaidMap", duesStorageKey(low)), !!changes[low]); });
  args.push("updatedAt", new Date().toISOString());
  var ref = fsDb.collection("pickem_v14").doc("shared_state");
  return ref.update.apply(ref, args).then(function() {
    if (typeof logCommishAction === "function") logCommishAction(auditText, "", "");
  });
}

function applyDuesChanges(changes, auditText) {
  var map = ensureCommissionerConfig().duesPaidMap;
  var before = {};
  Object.keys(changes).forEach(function(low) { before[low] = isDuesPaid(low); map[duesStorageKey(low)] = !!changes[low]; paintDuesRow(low); });
  refreshDuesChrome();
  safeSetStorage("sat_week7_official_v14", JSON.stringify(state));
  return saveDuesFlags(changes, auditText).catch(function(e) {
    Object.keys(before).forEach(function(low) { map[duesStorageKey(low)] = before[low]; paintDuesRow(low); });
    refreshDuesChrome();
    reportCloudSaveFailure("dues", e);
    throw e;
  });
}

function toggleDuesPaidInPlace(low) {
  if (!assertCommissionerRole("Dues")) return;
  var next = !isDuesPaid(low);
  var ch = {};
  ch[low] = next;
  applyDuesChanges(ch, "Dues: " + duesDisplayName(low) + " marked " + (next ? "paid" : "unpaid")).catch(function() {});
}

// The roster table's old toggle goes through the same in-place path.
function commishToggleDuesPaid(memberName) {
  toggleDuesPaidInPlace(duesKeyForName(memberName));
}

function toggleDuesSelected(low, on) {
  if (on) DUES_SELECTED[low] = true; else delete DUES_SELECTED[low];
  refreshDuesChrome();
}

function selectAllShownDues(on) {
  var rows = document.querySelectorAll("#dues-list .dues-row");
  for (var i = 0; i < rows.length; i++) {
    var low = rows[i].getAttribute("data-dues-key");
    if (on) DUES_SELECTED[low] = true; else delete DUES_SELECTED[low];
    paintDuesRow(low);
  }
  refreshDuesChrome();
}

function setDuesFilter(f) {
  DUES_FILTER = f;
  var list = document.getElementById("dues-list");
  if (list) { list.innerHTML = duesListHtml(); list.scrollTop = 0; }
  var all = document.getElementById("dues-select-all");
  if (all) all.checked = false;
  refreshDuesChrome();
}

function bulkSetDues(paid) {
  if (!assertCommissionerRole("Dues")) return;
  var keys = Object.keys(DUES_SELECTED).filter(function(k) { return DUES_SELECTED[k] && isDuesPaid(k) !== paid; });
  if (!keys.length) { showAppToast("The selected players are already " + (paid ? "paid" : "unpaid") + "."); return; }
  var names = keys.map(duesDisplayName);
  confirmDanger("Mark " + keys.length + " player" + (keys.length === 1 ? "" : "s") + " " + (paid ? "paid" : "unpaid") + "?\n\n" + names.slice(0, 12).join(", ") + (names.length > 12 ? " and " + (names.length - 12) + " more" : ""), paid ? "Mark paid" : "Mark unpaid", function() {
    var ch = {};
    keys.forEach(function(k) { ch[k] = paid; });
    applyDuesChanges(ch, "Dues: marked " + keys.length + " " + (paid ? "paid" : "unpaid") + " (" + names.join(", ") + ")").then(function() {
      DUES_SELECTED = {};
      keys.forEach(paintDuesRow);
      var all = document.getElementById("dues-select-all");
      if (all) all.checked = false;
      refreshDuesChrome();
      showAppToast("Marked " + keys.length + " " + (paid ? "paid" : "unpaid") + ".");
    }, function() {});
  });
}

function markAllDuesPaid() {
  if (!assertCommissionerRole("Dues")) return;
  var roster = cachedDuesRoster();
  var keys = roster.list.map(function(r) { return r.low; }).filter(function(k) { return !isDuesPaid(k, roster); });
  if (!keys.length) { showAppToast("Everyone is already paid."); return; }
  confirmDanger("Mark all " + keys.length + " unpaid players paid? Total collected becomes $" + (duesTotals().count * duesFee()) + ".", "Mark all paid", function() {
    var ch = {};
    keys.forEach(function(k) { ch[k] = true; });
    applyDuesChanges(ch, "Dues: marked all " + keys.length + " unpaid players paid").then(function() {
      showAppToast("Everyone is marked paid.");
    }, function() {});
  });
}

function setDuesEntryFee(v) {
  if (!assertCommissionerRole("Dues")) return;
  var fee = Math.max(0, parseFloat(v) || 0);
  ensureCommissionerConfig().entryFeeDollars = fee;
  refreshDuesChrome();
  var ref = fsDb && fsDb.collection("pickem_v14").doc("shared_state");
  if (ref) ref.update(new firebase.firestore.FieldPath("commissionerConfig", "entryFeeDollars"), fee).catch(function(e) { reportCloudSaveFailure("the entry fee", e); });
  if (typeof logCommishAction === "function") logCommishAction("Dues: entry fee set to $" + fee, "", "");
}

// ---------- Console wiring ----------
var _duesPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _duesPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (body && ACTIVE_COMMISH_TAB === "roster" && isVerifiedCommissioner()) {
    var anchor = body.querySelector(".commish-kpi-strip");
    if (anchor) anchor.insertAdjacentHTML("afterend", duesPanelHtml());
    else body.insertAdjacentHTML("afterbegin", duesPanelHtml());
  }
  return res;
};
