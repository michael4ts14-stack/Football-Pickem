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

// ---------- Commissioner console: Email service panel ----------
function emailServicePanelHtml() {
  var url = emailServiceUrl();
  return '<section class="email-svc" id="email-svc-panel">' +
    '<h3 class="console-h">Email service</h3>' +
    '<p class="email-svc-status"><span class="status-dot' + (url ? '' : ' is-off') + '"></span>' +
      (url ? 'Configured' + (EMAIL_SERVICE.fromFirestore ? '' : ' (default URL; save it once to share it)') : 'Not configured') + '</p>' +
    '<div class="email-svc-url"><input type="url" id="email-svc-url" class="search-input" value="' + escapeShellHtml(url) + '" placeholder="https://script.google.com/macros/s/…/exec" aria-label="Apps Script Web App URL" />' +
      '<button type="button" class="tool-btn" onclick="saveEmailServiceUrlFromConsole()">Save for everyone</button></div>' +
    '<p class="muted-note" id="email-svc-msg"></p>' +
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
  if (body && ACTIVE_COMMISH_TAB === "comms" && isVerifiedCommissioner()) body.insertAdjacentHTML("afterbegin", emailServicePanelHtml());
  return res;
};

loadEmailServiceConfig();
