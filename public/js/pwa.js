// ============================================================================
// INSTALLED APP (PWA): service worker registration, the "Update available"
// bar, Install app (Chrome / Edge / Android), the Add to Home Screen hint
// (iPhone), sign-in in standalone mode and external links. No app logic here.
// ============================================================================
var PWA_DEFERRED_PROMPT = null;
var PWA_RELOAD_ON_UPDATE = false;
var PWA_KEYS = { headerLineSeen: "sat_install_line_seen_v1", iosHintDismissed: "sat_ios_install_hint_dismissed_v1" };

function isStandaloneApp() {
  return !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
}

function isIosDevice() {
  var ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

document.documentElement.classList.toggle("is-standalone", isStandaloneApp());

// ---------- Service worker + Update bar ----------
function showUpdateBar(worker) {
  var bar = document.getElementById("pwa-update-bar");
  if (!bar || !worker) return;
  bar.hidden = false;
  var btn = document.getElementById("pwa-update-reload");
  if (btn) btn.onclick = function() {
    PWA_RELOAD_ON_UPDATE = true;
    btn.disabled = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  };
}

function watchForWaitingWorker(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
  reg.addEventListener("updatefound", function() {
    var nw = reg.installing;
    if (!nw) return;
    nw.addEventListener("statechange", function() {
      // Only an update (a page already controlled) gets the bar; the first install doesn't.
      if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateBar(nw);
    });
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    navigator.serviceWorker.register("/sw.js").then(function(reg) {
      watchForWaitingWorker(reg);
      // Check for a new deploy when the app comes back to the front, and every 30 minutes.
      document.addEventListener("visibilitychange", function() { if (!document.hidden) reg.update().catch(function() {}); });
      setInterval(function() { reg.update().catch(function() {}); }, 30 * 60 * 1000);
    }).catch(function() {});
  });
  // Reload only after the person tapped Reload on the bar.
  navigator.serviceWorker.addEventListener("controllerchange", function() {
    if (PWA_RELOAD_ON_UPDATE) window.location.reload();
  });
}

// ---------- Install app (Chrome / Edge / Android) ----------
window.addEventListener("beforeinstallprompt", function(e) {
  e.preventDefault();
  PWA_DEFERRED_PROMPT = e;
  showInstallHeaderLine();
  if (typeof currentMainView !== "undefined" && currentMainView === "more" && typeof renderMoreView === "function") renderMoreView();
});

window.addEventListener("appinstalled", function() {
  PWA_DEFERRED_PROMPT = null;
  hideInstallHeaderLine(true);
  if (typeof renderMoreView === "function") renderMoreView();
});

function promptInstallApp() {
  if (!PWA_DEFERRED_PROMPT) return;
  var p = PWA_DEFERRED_PROMPT;
  PWA_DEFERRED_PROMPT = null;
  p.prompt();
  (p.userChoice || Promise.resolve()).then(function() {
    hideInstallHeaderLine(true);
    if (typeof renderMoreView === "function") renderMoreView();
  });
}

// One dismissible line under the Picks header, shown once.
function showInstallHeaderLine() {
  var el = document.getElementById("install-line");
  if (!el || isStandaloneApp() || safeGetStorage(PWA_KEYS.headerLineSeen)) return;
  el.hidden = false;
  safeSetStorage(PWA_KEYS.headerLineSeen, "1");
}
function hideInstallHeaderLine(remember) {
  var el = document.getElementById("install-line");
  if (el) el.hidden = true;
  if (remember) safeSetStorage(PWA_KEYS.headerLineSeen, "1");
}

function dismissIosInstallHint() {
  safeSetStorage(PWA_KEYS.iosHintDismissed, "1");
  if (typeof renderMoreView === "function") renderMoreView();
}

// More › Settings: "Install app" (when the browser offers it) or the iPhone hint.
function installSettingsRowHtml() {
  if (isStandaloneApp()) return "";
  if (PWA_DEFERRED_PROMPT) {
    return moreRowHtml({ icon: "download", title: "Install app", sub: "Add SAT Pick'em to your home screen or desktop", onclick: "promptInstallApp()" });
  }
  if (isIosDevice() && !safeGetStorage(PWA_KEYS.iosHintDismissed)) {
    return '<div class="list-row static install-hint">' + iconHtml("share") +
      '<span class="list-row-text"><span class="list-row-title">Add to Home Screen</span>' +
      '<span class="list-row-sub">Tap Share <i data-lucide="share" class="inline-icon" aria-label="Share"></i>, then Add to Home Screen. You\'ll sign in once more in the installed app.</span></span>' +
      '<button type="button" class="icon-btn" onclick="dismissIosInstallHint()" aria-label="Dismiss"><i data-lucide="x"></i></button>' +
    '</div>';
  }
  return "";
}

var _pwaPrevRenderMoreView = renderMoreView;
renderMoreView = function() {
  var res = _pwaPrevRenderMoreView.apply(this, arguments);
  var row = installSettingsRowHtml();
  var card = document.querySelector("#more-sec-settings .list-card");
  if (row && card) card.insertAdjacentHTML("afterbegin", row);
  return res;
};

// ---------- Sign-in inside the installed app ----------
// iPhone home-screen apps can't complete Google's popup reliably, so they use the
// redirect flow there. Everywhere else the popup stays (it already falls back to
// redirect when the popup is blocked).
var _pwaPrevGoogleSignIn = signInWithGoogleAccount;
signInWithGoogleAccount = function(useRedirect) {
  return _pwaPrevGoogleSignIn.call(this, useRedirect || (isStandaloneApp() && isIosDevice()));
};

// ---------- External links open in the system browser ----------
document.addEventListener("click", function(e) {
  if (!isStandaloneApp()) return;
  var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  var url;
  try { url = new URL(a.href, window.location.href); } catch (err) { return; }
  if (url.origin === window.location.origin || !/^https?:$/.test(url.protocol)) return;
  e.preventDefault();
  window.open(url.href, "_blank", "noopener");
}, true);
