// ============================================================================
// EMAIL SERVICE (doPost): pick receipts and pool broadcasts requested by the app.
//
// Every request carries the caller's Firebase ID token. Apps Script can't check an
// RS256 signature itself, so the token goes to Google's Identity Toolkit
// (accounts:lookup with this project's public web API key), which only answers for
// a valid, unexpired token issued for this Firebase project; the token's own aud /
// iss / exp claims are checked as well. The verified email decides what's allowed:
//   - sendPickReceipt: only to the caller's own verified email, with their own picks
//     read from Firestore here (nothing the browser sends about picks is used).
//   - broadcasts (nudge, Saturday master sheet, email CSV to all): commissioners only,
//     by the same rule firestore.rules uses.
// Responses are JSON; the app reads them (text/plain POST, no CORS preflight).
// ============================================================================
var EMAIL_API_VERSION = 2;
var FIREBASE_PROJECT_ID = "football-pickem-46206";
var FIREBASE_WEB_API_KEY = "AIzaSyCMEUZaBOSyQt_Bhyi4mN33_fEwMcDi4_A"; // public web key, same as public/js/config.js
// Same built-in list as isVerifiedCommissioner() in firestore.rules.
var BUILT_IN_COMMISSIONER_EMAILS = ["michael4ts14@gmail.com", "commissioner@separatedatturf.com", "commissioner@separatedatturt.com"];
var EMAIL_FROM_NAME = "Separated at Turf Pick'em";
var EMAIL_REPLY_TO = "separatedatturf@gmail.com";
var APP_URL = "https://football-pickem-46206.web.app";
var RECEIPTS_PER_HOUR = 5;

function remainingQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
}

function emailJson_(obj) {
  obj.apiVersion = EMAIL_API_VERSION;
  obj.quota = remainingQuota_();
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function emailError_(code, message, extra) {
  var e = new Error(message);
  e.emailCode = code;
  e.extra = extra || {};
  return e;
}

// ---------- Firestore reads (public documents) ----------
function readFirestoreDoc_(path) {
  var res = UrlFetchApp.fetch(FIRESTORE_BASE_URL + "/" + path, { muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() !== 200) throw emailError_("FIRESTORE_READ", "Couldn't read " + path + " (HTTP " + res.getResponseCode() + ").");
  var json = JSON.parse(res.getContentText());
  return json && json.fields ? fromFirestoreValue({ mapValue: { fields: json.fields } }) : {};
}

// ---------- ID token ----------
function decodeJwtPayload_(token) {
  var parts = String(token || "").split(".");
  if (parts.length !== 3) throw emailError_("INVALID_TOKEN", "Your sign-in couldn't be read. Sign in again.");
  var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString());
}

// Returns { uid, email, emailVerified } or throws an emailError_.
function verifyFirebaseIdToken_(idToken) {
  if (!idToken) throw emailError_("NOT_SIGNED_IN", "Sign in to your account to get emails.");
  var claims = decodeJwtPayload_(idToken);
  if (claims.aud !== FIREBASE_PROJECT_ID || claims.iss !== "https://securetoken.google.com/" + FIREBASE_PROJECT_ID) {
    throw emailError_("INVALID_TOKEN", "That sign-in is for a different app.");
  }
  var nowSec = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp <= nowSec) throw emailError_("TOKEN_EXPIRED", "Your sign-in expired. Try again.");

  var cache = CacheService.getScriptCache();
  var key = "idt_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_WEB_API_KEY, {
    method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw emailError_("INVALID_TOKEN", "Your sign-in couldn't be verified. Sign out and back in.");
  var users = (JSON.parse(res.getContentText()) || {}).users || [];
  var u = users[0];
  if (!u || (claims.user_id && u.localId !== claims.user_id)) throw emailError_("INVALID_TOKEN", "Your sign-in couldn't be verified. Sign out and back in.");
  var who = { uid: u.localId, email: String(u.email || "").toLowerCase(), emailVerified: !!u.emailVerified };
  if (!who.email) throw emailError_("NO_EMAIL", "Your account has no email address.");
  cache.put(key, JSON.stringify(who), Math.max(1, Math.min(300, claims.exp - nowSec)));
  return who;
}

function requireVerifiedEmail_(who) {
  if (!who.emailVerified) throw emailError_("EMAIL_NOT_VERIFIED", "Verify your email address first (check your inbox for the verification link).");
}

function isCommissionerEmail_(email) {
  email = String(email || "").toLowerCase();
  if (BUILT_IN_COMMISSIONER_EMAILS.indexOf(email) !== -1) return true;
  var roles = readFirestoreDoc_("pickem_v14_commissioners/roles") || {};
  if (String(roles.primaryCommissionerEmail || "").toLowerCase() === email) return true;
  return !!(roles.authorizedEmails && roles.authorizedEmails[email] === true);
}

function requireCommissioner_(who) {
  requireVerifiedEmail_(who);
  if (!isCommissionerEmail_(who.email)) throw emailError_("NOT_COMMISSIONER", "Only a commissioner can send pool emails.");
}

// ---------- The caller's own profile and picks ----------
function accountDocKey_(email) { return "email_" + String(email).toLowerCase().replace(/[^a-z0-9]/g, "_"); }

// Account doc by uid (after an email change the doc id still has the old address).
function findAccountByUid_(uid) {
  var res = UrlFetchApp.fetch(FIRESTORE_BASE_URL + ":runQuery", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: "pickem_v14_accounts" }],
      where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } }, limit: 1 } })
  });
  if (res.getResponseCode() !== 200) return null;
  var rows = JSON.parse(res.getContentText()) || [];
  var doc = rows[0] && rows[0].document;
  return doc && doc.fields ? fromFirestoreValue({ mapValue: { fields: doc.fields } }) : null;
}

function resolveCallerPicks_(who, shared) {
  var acct = readFirestoreDoc_("pickem_v14_accounts/" + accountDocKey_(who.email)) || findAccountByUid_(who.uid);
  var profKey = acct && acct.boundProfileKey;
  if (!profKey || profKey === "test") throw emailError_("NO_PROFILE", "Your account isn't linked to a pool entry yet.");
  var prof = (shared && shared[profKey]) || readFirestoreDoc_("pickem_v14_users/" + encodeURIComponent(profKey)) || {};
  var picks = prof.picks || {};
  if (!Object.keys(picks).length) {
    var userDoc = readFirestoreDoc_("pickem_v14_users/" + encodeURIComponent(profKey)) || {};
    picks = userDoc.picks || {};
    if (!prof.tiebreaker) prof.tiebreaker = userDoc.tiebreaker;
  }
  var name = (acct && (acct.linkedMemberName || acct.displayName)) || prof.linkedMemberName || profKey;
  return { profileKey: profKey, name: name, picks: picks, tiebreaker: String(prof.tiebreaker || "") };
}

// "Arizona at Texas Tech: Arizona (1x)" lines for the slate, from the stored picks.
function receiptLines_(games, picks) {
  var lines = [];
  for (var i = 0; i < games.length; i++) {
    var g = games[i];
    var p = picks[String(g.id)] || picks[g.id];
    var pts = !p ? "" : (String(p).toLowerCase() === String(g.away).toLowerCase() ? g.awayPts : (String(p).toLowerCase() === String(g.home).toLowerCase() ? g.homePts : ""));
    lines.push({ game: g.away + " at " + g.home, pick: p || "No pick", pts: pts || "" });
  }
  return lines;
}

// ---------- Router ----------
function handleEmailPost_(e) {
  var data = {};
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    data = raw ? JSON.parse(raw) : {};
  } catch (eParse) {
    return emailJson_({ ok: false, code: "BAD_REQUEST", error: "The request wasn't valid JSON." });
  }
  var action = String(data.action || "");
  try {
    if (action === "ping") return emailJson_({ ok: true, message: "pong" });

    var who = verifyFirebaseIdToken_(data.idToken);
    var shared = fetchFirebaseNode("") || {};

    if (action === "sendPickReceipt") return emailJson_(sendPickReceipt_(who, shared, data));
    if (action === "status") { requireCommissioner_(who); return emailJson_({ ok: true, broadcastsEnabled: broadcastsEnabled_() }); }
    if (action === "setBroadcastsEnabled") {
      requireCommissioner_(who);
      PropertiesService.getScriptProperties().setProperty("BROADCASTS_ENABLED", data.enabled ? "true" : "false");
      return emailJson_({ ok: true, broadcastsEnabled: broadcastsEnabled_() });
    }
    if (action === "sendWedThuNudge") { requireCommissioner_(who); requireBroadcastsAllowed_(data); return emailJson_(sendWedThuNudge_(who, shared, data)); }
    if (action === "sendSaturdayMasterSheet" || action === "emailMasterCsvToAll") { requireCommissioner_(who); requireBroadcastsAllowed_(data); return emailJson_(sendMasterSheet_(who, shared, data)); }
    throw emailError_("UNKNOWN_ACTION", "Unknown action: " + action);
  } catch (err) {
    if (!err.emailCode && /too many times|quota/i.test(String(err))) err = emailError_("QUOTA_EXCEEDED", "Daily email limit reached. Try again tomorrow.");
    return emailJson_(Object.assign({ ok: false, code: err.emailCode || "SERVER_ERROR", error: err.emailCode ? err.message : String(err) }, err.extra || {}));
  }
}

// ---------- Receipt ----------
function sendPickReceipt_(who, shared, data) {
  requireVerifiedEmail_(who);
  var curWeek = parseInt(shared.currentWeek, 10) || 8;
  var wk = shared.weekLabel || ("Week " + curWeek);
  var games = (shared.customGames && shared.customGames.length) ? shared.customGames : getDefaultWeek7GamesFallback();
  var mine = resolveCallerPicks_(who, shared);
  if (!Object.keys(mine.picks).length) throw emailError_("NO_PICKS", "No saved picks found for " + mine.name + " this week.");

  var cache = CacheService.getScriptCache();
  var dupKey = "rcpt_" + Utilities.base64EncodeWebSafe(who.email + "_" + wk).substring(0, 50);
  if (cache.get(dupKey)) return { ok: true, suppressedDuplicate: true, sentTo: who.email };
  // Per-user limit on top of the 45s duplicate guard.
  var rlKey = "rl_" + Utilities.base64EncodeWebSafe(who.email).substring(0, 50);
  var count = parseInt(cache.get(rlKey) || "0", 10);
  if (count >= RECEIPTS_PER_HOUR) throw emailError_("RATE_LIMITED", "You've requested " + RECEIPTS_PER_HOUR + " receipts in the last hour. Try again later.");
  cache.put(rlKey, String(count + 1), 3600);
  cache.put(dupKey, "sent", 45);

  var quota = remainingQuota_();
  if (quota !== null && quota < 1) throw emailError_("QUOTA_EXCEEDED", "Daily email limit reached. Try again tomorrow.");
  var lines = receiptLines_(games, mine.picks);
  var msg = buildReceiptEmail_(mine.name, wk, mine.tiebreaker || "—", lines);
  MailApp.sendEmail({ to: who.email, subject: msg.subject, body: msg.text, htmlBody: msg.html, name: EMAIL_FROM_NAME, replyTo: EMAIL_REPLY_TO });
  return { ok: true, sentTo: who.email, picks: lines.filter(function(l) { return l.pick !== "No pick"; }).length };
}

function buildReceiptEmail_(name, wk, tb, lines) {
  var text = "Hi " + name + ",\n\nYour picks for " + wk + " are saved.\n\nTie-breaker: " + tb + "\nYou can change picks until Friday 9:00 PM CT.\n\n" +
    lines.map(function(l) { return l.game + ": " + l.pick + (l.pts ? " (" + l.pts + "x)" : ""); }).join("\n") + "\n\n— Separated at Turf Pick'em\n" + APP_URL;
  var rows = lines.map(function(l) { return "<li>" + l.game + ": <strong>" + l.pick + "</strong>" + (l.pts ? " (" + l.pts + "x)" : "") + "</li>"; }).join("");
  var html = "<div><h2>Separated at Turf Pick'em</h2><p>Hi " + name + ", your picks for " + wk + " are saved. Tie-breaker: " + tb + ".</p><ul>" + rows + "</ul></div>";
  return { subject: "Separated at Turf — " + wk + " pick receipt (" + name + ")", text: text, html: html };
}

// ---------- Broadcasts ----------
// One kill switch for every pool email. A commissioner's test send to explicit
// testRecipients still works while it's off, so sends can be tested without the pool.
function requireBroadcastsAllowed_(data) {
  var isTest = Array.isArray(data.testRecipients) && data.testRecipients.length;
  if (!broadcastsEnabled_() && !isTest) throw emailError_("BROADCASTS_OFF", "Pool emails are switched off. A commissioner can turn them on in Console › Banner & Recap.");
}
function poolEmailRecipients_(shared) {
  var cfg = shared.commissionerConfig || {};
  var recMap = {};
  var map = cfg.playerEmailsMap || {};
  for (var k in map) if (map[k] && String(map[k]).indexOf("@") !== -1) recMap[String(map[k]).toLowerCase()] = true;
  (shared.poolMembers || []).forEach(function(pm) { if (pm.linkedAuthEmail && pm.linkedAuthEmail.indexOf("@") !== -1) recMap[pm.linkedAuthEmail.toLowerCase()] = true; });
  return Object.keys(recMap);
}

// Commissioners can pass testRecipients to send only to those addresses (testing).
function chooseRecipients_(data, fallback) {
  var list = Array.isArray(data.testRecipients) && data.testRecipients.length ? data.testRecipients : fallback;
  var seen = {}, out = [];
  list.forEach(function(r) { r = String(r || "").trim().toLowerCase(); if (r.indexOf("@") !== -1 && !seen[r]) { seen[r] = true; out.push(r); } });
  return out;
}

// Never send half a broadcast: stop first if the day's quota can't cover everyone.
function requireQuotaFor_(count) {
  var quota = remainingQuota_();
  if (quota !== null && count > quota) {
    throw emailError_("QUOTA_TOO_LOW", count + " recipients but only " + quota + " emails left today. Nothing was sent.", { recipients: count });
  }
}

function sendEach_(recipients, buildFn) {
  requireQuotaFor_(recipients.length);
  var sent = 0, failed = [];
  recipients.forEach(function(to) {
    try { var m = buildFn(to); MailApp.sendEmail({ to: to, subject: m.subject, body: m.text, htmlBody: m.html, attachments: m.attachments, name: EMAIL_FROM_NAME, replyTo: EMAIL_REPLY_TO }); sent++; }
    catch (eSend) { failed.push({ to: to, error: String(eSend.message || eSend) }); }
  });
  return { sent: sent, failed: failed };
}

function sendWedThuNudge_(who, shared, data) {
  var cfg = shared.commissionerConfig || {};
  var curWeek = parseInt(shared.currentWeek, 10) || 8;
  var wk = shared.weekLabel || ("Week " + curWeek);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw emailError_("BUSY", "Another send is in progress. Try again in a minute.");
  try {
    var dayKey = curWeek + "_" + Utilities.formatDate(new Date(), "America/Chicago", "u");
    var props = PropertiesService.getScriptProperties();
    var isTest = Array.isArray(data.testRecipients) && data.testRecipients.length;
    if (!isTest && props.getProperty("WED_THU_NUDGE_SENT_WEEK_" + dayKey)) throw emailError_("ALREADY_SENT", "Today's nudge was already sent.");
    var missing = [];
    (shared.poolMembers || []).forEach(function(pm) {
      if (!Object.keys(pm.picks || {}).length || pm.awaitingSheet) {
        var em = (cfg.playerEmailsMap || {})[standardizeBotParticipantName(pm.name).toLowerCase()] || pm.linkedAuthEmail;
        if (em) missing.push(em);
      }
    });
    var recipients = chooseRecipients_(data, missing);
    requireQuotaFor_(recipients.length);
    if (!isTest) props.setProperty("WED_THU_NUDGE_SENT_WEEK_" + dayKey, new Date().toISOString());
    var r = sendEach_(recipients, function() { return buildNudgeEmail_(wk); });
    return { ok: true, action: "sendWedThuNudge", recipients: recipients.length, sent: r.sent, failed: r.failed, skipped: 0, test: !!isTest };
  } finally { lock.releaseLock(); }
}

function buildNudgeEmail_(wk) {
  var text = "Hi,\n\nReminder: submit your picks for " + wk + " before Friday 9:00 PM CT.\n\nMake your picks: " + APP_URL + "\n\n— Separated at Turf Pick'em";
  return { subject: "Separated at Turf — " + wk + " picks due Friday 9:00 PM CT", text: text, html: "<p>" + text.replace(/\n/g, "<br>") + "</p>" };
}

function sendMasterSheet_(who, shared, data) {
  var curWeek = parseInt(shared.currentWeek, 10) || 8;
  var wk = shared.weekLabel || ("Week " + curWeek);
  var games = (shared.customGames && shared.customGames.length) ? shared.customGames : getDefaultWeek7GamesFallback();
  var csv = (shared.poolMembers && shared.poolMembers.length) ? generateMasterCsvFromCloud(shared.poolMembers, games) : "";
  if (!csv) throw emailError_("NO_SHEET", "There are no pool picks to send yet.");
  var recipients = chooseRecipients_(data, poolEmailRecipients_(shared));
  var blob = Utilities.newBlob(csv, "text/csv", "College_Pickem_26_" + wk.replace(/\s+/g, "_") + "_Master.csv");
  var r = sendEach_(recipients, function() { var m = buildMasterSheetEmail_(wk); m.attachments = [blob]; return m; });
  return { ok: true, action: "sendSaturdayMasterSheet", recipients: recipients.length, sent: r.sent, failed: r.failed, skipped: 0, test: !!(data.testRecipients && data.testRecipients.length) };
}

function buildMasterSheetEmail_(wk) {
  var text = "Hi everyone,\n\nAll picks for " + wk + " are locked. The master sheet with every player's picks is attached.\n\nGood luck this weekend!\n— Separated at Turf Pick'em\n" + APP_URL;
  return { subject: "Separated at Turf — " + wk + " master pick sheet", text: text, html: "<p>" + text.replace(/\n/g, "<br>") + "</p>" };
}
