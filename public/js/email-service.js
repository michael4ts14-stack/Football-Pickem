// ============================================================================
// EMAIL SERVICE: one Apps Script Web App URL for everyone.
// The URL lives in Firestore at pickem_v14_commissioners/email_service (anyone can
// read it, only commissioners can write it, per firestore.rules) and is loaded at
// startup for every user and device. Commissioners update it from Import / Bot.
// ============================================================================
var EMAIL_SERVICE_DOC_PATH = ["pickem_v14_commissioners", "email_service"];
// Used only until the Firestore document exists (the deployment this repo already used).
var EMAIL_SERVICE_DEFAULT_URL = "https://script.google.com/macros/s/AKfycbzHXlDx7P8u5so0jGxPN4N3ONeWU0t1qrNWHavmCqmdCdnhKLG82DOOIaoer4biU8vE/exec";
var EMAIL_SERVICE_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
var EMAIL_SERVICE = { url: "", fromFirestore: false, loaded: false };

function emailServiceUrl() {
  return EMAIL_SERVICE.url || "";
}

function applyEmailServiceUrl(url, fromFirestore) {
  EMAIL_SERVICE.url = url || "";
  EMAIL_SERVICE.fromFirestore = !!fromFirestore;
  EMAIL_SERVICE.loaded = true;
  state.gasWebAppUrl = EMAIL_SERVICE.url; // older code paths read this
}

function loadEmailServiceConfig() {
  applyEmailServiceUrl(EMAIL_SERVICE_DEFAULT_URL, false);
  if (typeof fsDb === "undefined" || !fsDb) return;
  try {
    fsDb.collection(EMAIL_SERVICE_DOC_PATH[0]).doc(EMAIL_SERVICE_DOC_PATH[1]).onSnapshot(function(doc) {
      var d = doc && doc.exists ? doc.data() : null;
      if (d && d.webAppUrl && EMAIL_SERVICE_URL_RE.test(d.webAppUrl)) applyEmailServiceUrl(d.webAppUrl, true);
      if (typeof renderEmailServicePanel === "function") renderEmailServicePanel();
    }, function() {});
  } catch (e) {}
}

// Commissioners only (Firestore rules enforce it too). Returns a message for the UI.
function saveEmailServiceUrl(url) {
  url = String(url || "").trim();
  if (!isVerifiedCommissioner()) return Promise.resolve("Only a commissioner can change the email service URL.");
  if (!EMAIL_SERVICE_URL_RE.test(url)) return Promise.resolve("That doesn't look like an Apps Script Web App URL (https://script.google.com/macros/s/…/exec).");
  if (url === EMAIL_SERVICE.url && EMAIL_SERVICE.fromFirestore) return Promise.resolve("");
  return fsDb.collection(EMAIL_SERVICE_DOC_PATH[0]).doc(EMAIL_SERVICE_DOC_PATH[1]).set({
    webAppUrl: url,
    updatedAt: new Date().toISOString(),
    updatedBy: (AUTH_SESSION && AUTH_SESSION.email) || ""
  }, { merge: true }).then(function() { applyEmailServiceUrl(url, true); return "Saved for everyone."; },
    function(err) { return "Couldn't save: " + ((err && err.message) || err); });
}

// Import / Bot "Run Gmail Bot": a commissioner's URL is saved for everyone first.
var _emailSvcPrevTriggerScraper = triggerAppsScriptGmailScraper;
triggerAppsScriptGmailScraper = function() {
  var inp = document.getElementById("gas-webapp-url-input");
  var url = inp ? inp.value.trim() : "";
  if (url && url !== EMAIL_SERVICE.url && isVerifiedCommissioner()) saveEmailServiceUrl(url);
  return _emailSvcPrevTriggerScraper.apply(this, arguments);
};

// The signed-in user's Firebase ID token; the email service checks it on every call.
// Guests (no Firebase user) have none, so their requests stop here.
function getEmailIdToken() {
  var u = (typeof fbAuth !== "undefined" && fbAuth) ? fbAuth.currentUser : null;
  return u ? u.getIdToken() : Promise.resolve(null);
}

// One call to the email service. Always resolves to { ok, code?, error?, ... } that the UI
// can show as is. A plain-text POST is a "simple" request (no CORS preflight); Apps Script
// redirects to googleusercontent.com, whose reply the browser lets us read.
var EMAIL_API_VERSION = 2; // must match EMAIL_API_VERSION in apps-script/Email.js
var EMAIL_ERROR_TEXT = {
  NOT_CONFIGURED: "Email service not configured. A commissioner can set it in Console › Banner & Recap.",
  NOT_SIGNED_IN: "Not signed in. Create an account or sign in to get email receipts.",
  NETWORK: "Couldn't reach the email service. Check your connection and try again.",
  BAD_RESPONSE: "The email service URL didn't answer like the email service. Check the URL, and that the Web App is deployed for \"Anyone\".",
  STALE_DEPLOYMENT: "The email service is running an old version. A commissioner needs to redeploy it in Apps Script (Manage deployments › New version)."
};

function callEmailService(action, extra) {
  var url = emailServiceUrl();
  if (!url) return Promise.resolve({ ok: false, code: "NOT_CONFIGURED", error: EMAIL_ERROR_TEXT.NOT_CONFIGURED });
  return getEmailIdToken().then(function(idToken) {
    if (!idToken && action !== "ping" && action !== "status") return { ok: false, code: "NOT_SIGNED_IN", error: EMAIL_ERROR_TEXT.NOT_SIGNED_IN };
    var body = Object.assign({ action: action, idToken: idToken || "" }, extra || {});
    return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function(res) { return res.text(); })
      .then(function(text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) {}
        if (!json || typeof json !== "object") return { ok: false, code: "BAD_RESPONSE", error: EMAIL_ERROR_TEXT.BAD_RESPONSE };
        if (!json.apiVersion || json.apiVersion < EMAIL_API_VERSION) return { ok: false, code: "STALE_DEPLOYMENT", error: EMAIL_ERROR_TEXT.STALE_DEPLOYMENT, quota: json.quota };
        if (!json.ok && !json.error) json.error = "The email service said no (" + (json.code || "unknown") + ").";
        if (typeof json.quota === "number" && EMAIL_SVC_STATUS) EMAIL_SVC_STATUS.quota = json.quota;
        return json;
      }, function() { return { ok: false, code: "NETWORK", error: EMAIL_ERROR_TEXT.NETWORK }; });
  }, function() { return { ok: false, code: "NOT_SIGNED_IN", error: EMAIL_ERROR_TEXT.NOT_SIGNED_IN }; });
}

// ---------- Pick receipt: "Sending receipt…" then the real result ----------
var LAST_RECEIPT_RESULT = null;

// The service reads your picks from Firestore, so wait until the save just made is confirmed.
function waitForSavedPicks() {
  if (typeof fsDb === "undefined" || !fsDb || typeof fsDb.waitForPendingWrites !== "function") return Promise.resolve();
  return Promise.race([fsDb.waitForPendingWrites().catch(function() {}), new Promise(function(r) { setTimeout(r, 8000); })]);
}

function startPickReceiptSend() {
  return waitForSavedPicks().then(function() { return callEmailService("sendPickReceipt"); })
    .then(function(res) { LAST_RECEIPT_RESULT = res; return res; });
}

function receiptStatusHtml(res) {
  if (!res) return '<span class="email-status-line"><span class="spinner" aria-hidden="true"></span>Sending receipt…</span>';
  if (res.ok) {
    return '<span class="email-status-line is-ok"><i data-lucide="check"></i>' +
      (res.suppressedDuplicate ? 'Receipt already sent to ' : 'Receipt sent to ') + escapeShellHtml(res.sentTo || "your email") + '</span>';
  }
  var guest = res.code === "NOT_SIGNED_IN";
  return '<span class="email-status-line is-error"><i data-lucide="circle-alert"></i>' + escapeShellHtml(res.error || "The receipt wasn't sent.") + '</span>' +
    (guest
      ? '<button type="button" class="link-btn" onclick="closeOppModal(); openAuthModalCarryingGuestPicks(\'signup\');">Create an account</button>'
      : (res.code === "EMAIL_NOT_VERIFIED"
          ? '<button type="button" class="link-btn" onclick="resendEmailVerification()">Send verification email</button>'
          : '<button type="button" class="link-btn" onclick="retryPickReceipt()">Retry</button>'));
}

function showReceiptSendStatus(promise) {
  var el = document.getElementById("receipt-email-status");
  if (el) el.innerHTML = receiptStatusHtml(null);
  promise.then(function(res) {
    var box = document.getElementById("receipt-email-status");
    if (box) box.innerHTML = receiptStatusHtml(res);
  });
}

function retryPickReceipt() { showReceiptSendStatus(startPickReceiptSend()); }

function resendEmailVerification() {
  var u = (typeof fbAuth !== "undefined" && fbAuth) ? fbAuth.currentUser : null;
  var box = document.getElementById("receipt-email-status");
  if (!u) return;
  u.sendEmailVerification().then(function() {
    if (box) box.innerHTML = '<span class="email-status-line">Verification email sent to ' + escapeShellHtml(u.email || "") + '. Open the link, then tap Retry.</span><button type="button" class="link-btn" onclick="retryPickReceipt()">Retry</button>';
  }, function(err) {
    if (box) box.innerHTML = '<span class="email-status-line is-error">' + escapeShellHtml((err && err.message) || "Couldn't send the verification email.") + '</span>';
  });
}

// ---------- Pool emails (nudge, master sheet): sent / skipped / failed ----------
var LAST_POOL_EMAIL_RESULT = null;

function poolEmailSummary(label, res) {
  if (!res.ok) return label + " not sent: " + (res.error || "unknown error");
  var failed = (res.failed || []).length;
  return label + (res.test ? " (test)" : "") + ": " + (res.sent || 0) + " sent, " + (res.skipped || 0) + " skipped, " + failed + " failed" +
    (res.recipients !== undefined ? " of " + res.recipients : "") + ".";
}

function reportPoolEmailResult(label, res) {
  LAST_POOL_EMAIL_RESULT = { label: label, res: res, at: new Date().toISOString() };
  showAppToast(poolEmailSummary(label, res));
  if (typeof renderCommissionerModalBody === "function") renderCommissionerModalBody();
}

// ---------- Commissioner console: status, kill switch ----------
var EMAIL_SVC_STATUS = null;   // last "status" reply: { ok, broadcastsEnabled, quota, ... }
var EMAIL_SVC_STATUS_AT = 0;

function refreshEmailServiceStatus(force) {
  if (!force && Date.now() - EMAIL_SVC_STATUS_AT < 60000) return;
  EMAIL_SVC_STATUS_AT = Date.now();
  callEmailService("status").then(function(res) { EMAIL_SVC_STATUS = res; renderEmailServicePanel(); });
}

function setPoolEmailsEnabled(on) {
  var go = function() {
    callEmailService("setBroadcastsEnabled", { enabled: !!on }).then(function(res) {
      EMAIL_SVC_STATUS = Object.assign({}, EMAIL_SVC_STATUS || {}, res);
      if (!res.ok) showAppToast(res.error);
      renderEmailServicePanel();
    });
  };
  if (on) confirmDanger("Turn on pool emails? The Wed/Thu nudge and the Saturday master sheet will email the whole pool when sent.", "Turn on", go);
  else go();
}

function emailServiceStatusHtml() {
  var st = EMAIL_SVC_STATUS;
  if (!emailServiceUrl()) return "";
  if (!st) return '<p class="muted-note">Checking the email service…</p>';
  if (!st.ok && st.code !== "BROADCASTS_OFF") return '<p class="email-svc-last is-error">' + escapeShellHtml(st.error || "The email service didn't answer.") + '</p>';
  var on = !!st.broadcastsEnabled;
  var quota = (typeof st.quota === "number") ? st.quota : null;
  return (quota !== null ? '<p class="email-svc-quota"><strong>' + quota + '</strong> emails left today (Google\'s daily limit for this account)</p>' : '') +
    '<div class="list-row static email-svc-switch">' +
      '<span class="list-row-text"><span class="list-row-title">Pool emails</span>' +
      '<span class="list-row-sub">Nudge, Saturday master sheet and email-to-all. Receipts to one player always work.</span></span>' +
      '<button type="button" class="switch" role="switch" aria-checked="' + on + '" aria-label="Pool emails" onclick="setPoolEmailsEnabled(' + !on + ')"><span></span></button>' +
    '</div>';
}

// ---------- Commissioner console: Email service panel ----------
function emailServicePanelHtml() {
  var url = emailServiceUrl();
  return '<section class="email-svc" id="email-svc-panel">' +
    '<h3 class="console-h">Email service</h3>' +
    '<p class="email-svc-status"><span class="status-dot' + (!url ? ' is-off' : (EMAIL_SVC_STATUS && !EMAIL_SVC_STATUS.ok && EMAIL_SVC_STATUS.code !== "BROADCASTS_OFF" ? ' is-stale-bad' : '')) + '"></span>' +
      (!url ? 'Not configured' : ((EMAIL_SVC_STATUS && EMAIL_SVC_STATUS.ok) ? 'Connected' : 'Configured') + (EMAIL_SERVICE.fromFirestore ? '' : ' (default URL; save it once to share it)')) + '</p>' +
    emailServiceStatusHtml() +
    '<div class="email-svc-url"><input type="url" id="email-svc-url" class="search-input" value="' + escapeShellHtml(url) + '" placeholder="https://script.google.com/macros/s/…/exec" aria-label="Apps Script Web App URL" />' +
      '<button type="button" class="tool-btn" onclick="saveEmailServiceUrlFromConsole()">Save for everyone</button></div>' +
    '<p class="muted-note" id="email-svc-msg"></p>' +
    (LAST_POOL_EMAIL_RESULT ? '<p class="email-svc-last' + (LAST_POOL_EMAIL_RESULT.res.ok ? '' : ' is-error') + '">Last pool email: ' + escapeShellHtml(poolEmailSummary(LAST_POOL_EMAIL_RESULT.label, LAST_POOL_EMAIL_RESULT.res)) +
      ((LAST_POOL_EMAIL_RESULT.res.failed || []).length ? '<br>Failed: ' + escapeShellHtml(LAST_POOL_EMAIL_RESULT.res.failed.map(function(f) { return f.to; }).join(", ")) : '') + '</p>' : '') +
  '</section>';
}

function saveEmailServiceUrlFromConsole() {
  var inp = document.getElementById("email-svc-url");
  var msg = document.getElementById("email-svc-msg");
  saveEmailServiceUrl(inp ? inp.value : "").then(function(m) { if (msg) msg.textContent = m; renderEmailServicePanel(); });
}

function renderEmailServicePanel() {
  var el = document.getElementById("email-svc-panel");
  if (el) el.outerHTML = emailServicePanelHtml();
}

var _emailSvcPrevCommishBody = renderCommissionerModalBody;
renderCommissionerModalBody = function() {
  var res = _emailSvcPrevCommishBody.apply(this, arguments);
  var body = document.getElementById("commish-modal-body");
  if (body && ACTIVE_COMMISH_TAB === "comms" && isVerifiedCommissioner()) {
    body.insertAdjacentHTML("afterbegin", emailServicePanelHtml());
    refreshEmailServiceStatus();
  }
  return res;
};

loadEmailServiceConfig();
