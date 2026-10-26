// ============================================================================
// V16 MASTER GMAIL -> FIREBASE AUTOMATION BOT (Code.gs)
// Automatically runs under whatever Google account deploys this Web App:
//   1. Weekly `.xlsx` / `.csv` Pool Pick Spreadsheets ("College Pick'em '26 - Week X Spreadsheet")
//      -> Uses native Utilities.unzip() + XmlService (ZERO Advanced Drive API setup required!)
//   2. New Weekly 26-Game Slates (WordPress / Google Form)
//   3. Confirmation Emails (Michael, Kinyon & Watchlist Opponents)
//   4. Weekly Pool Standings / Leaderboard Emails (including tied ranks!)
// Pushes directly to Cloud Firestore (`football-pickem-46206`)!
// ============================================================================

var FIRESTORE_BASE_URL = "https://firestore.googleapis.com/v1/projects/football-pickem-46206/databases/(default)/documents";
var FIRESTORE_DOC_URL = FIRESTORE_BASE_URL + "/pickem_v14/shared_state";
var FIRESTORE_USERS_URL = FIRESTORE_BASE_URL + "/pickem_v14_users";
var FIRESTORE_LIVE_STATE_URL = FIRESTORE_BASE_URL + "/live_games/week_state";
var ESPN_SB_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
var ESPN_SUMMARY_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=";

// ============================================================================
// EMERGENCY KILL SWITCH FOR OUTBOUND POOL BROADCAST EMAILS (MANDATORY FIX 1)
// Set to false to immediately stop all automated mass emails to the pool!
// Must be explicitly enabled by Commissioner to send mass emails.
// ============================================================================
var ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS = false;

// Web App GET endpoint so index.html can trigger an instant Gmail scrape or live ESPN sync from any browser
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "";
  var force = e && e.parameter && (e.parameter.force === "1" || e.parameter.force === "true");
  if (action === "emergencyStop") {
    var stopRes = emergencyStopEmailLoopAndCleanState();
    return ContentService
      .createTextOutput(JSON.stringify(stopRes))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "resetCache") {
    resetProcessedEmailHistory();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, message: "Cleared all slate, email & live state caches!" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "debugGmail") {
    var debugRes = debugInspectGmailPickemThreads();
    return ContentService
      .createTextOutput(JSON.stringify(debugRes, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "syncEspn") {
    var espnRes = syncEspnLiveStateToFirestore(true);
    return ContentService
      .createTextOutput(JSON.stringify(espnRes))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "pollSubMinute") {
    var subRes = pollEspnLiveGamesSubMinute();
    return ContentService
      .createTextOutput(JSON.stringify(subRes))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var summary = runMasterPickemEmailBot(force);
  var liveSync = syncEspnLiveStateToFirestore(force);
  summary.espnLiveSync = liveSync;
  return ContentService
    .createTextOutput(JSON.stringify(summary))
    .setMimeType(ContentService.MimeType.JSON);
}

// Web App POST endpoint to dispatch pick receipts, master spreadsheet emails, and nudges
// Web App POST endpoint to dispatch pick receipts, master spreadsheet emails, and nudges
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    var data = raw ? JSON.parse(raw) : {};
    var action = data.action || "";

    var currentCloud = fetchFirebaseNode("") || {};
    var curWeek = (currentCloud && currentCloud.currentWeek) || 8;
    var wkLabel = data.weekLabel || (currentCloud && currentCloud.weekLabel) || ("Week " + curWeek);
    var activeGames = (currentCloud && currentCloud.customGames && currentCloud.customGames.length)
      ? currentCloud.customGames
      : getDefaultWeek7GamesFallback();
    var cfg = (currentCloud && currentCloud.commissionerConfig) ? currentCloud.commissionerConfig : {};
    if (!cfg.playerEmailsMap) cfg.playerEmailsMap = {};

    if (action === "sendPickReceipt") {
      var recipient = String(data.email || "").trim().toLowerCase();
      if (recipient) {
        var pName = data.playerName || "Player";
        var wk = wkLabel;
        var tb = data.tiebreaker || "28-24";
        var pSummary = data.picksSummary || "";

        // De-duplication guard: prevent duplicate emails to the same recipient within 45 seconds
        try {
          var cache = CacheService.getScriptCache();
          var cacheKey = "rcpt_" + Utilities.base64Encode(recipient + "_" + wk).substring(0, 50);
          if (cache && cache.get(cacheKey)) {
            Logger.log("Duplicate receipt request suppressed for: " + recipient + " within 45s");
            return ContentService.createTextOutput(JSON.stringify({ ok: true, suppressedDuplicate: true, sentTo: recipient })).setMimeType(ContentService.MimeType.JSON);
          }
          if (cache) cache.put(cacheKey, "sent", 45);
        } catch (eCache) {}

        var subj = "✅ Separated at Turf — " + wk + " Pick Confirmation Receipt (" + pName + ")";
        var body = "Hi " + pName + ",\n\n" +
          "Your picks for " + wk + " have been saved to the Separated at Turf pool!\n\n" +
          "Player: " + pName + "\n" +
          "Tie-Breaker: " + tb + "\n" +
          "Lock Deadline: Friday 9:00 PM CST\n\n" +
          "YOUR 26 PICKS:\n" +
          "----------------------------------------\n" +
          pSummary + "\n" +
          "----------------------------------------\n\n" +
          "Note: You can still change your picks anytime until Friday at 9:00 PM CST!\n\n" +
          "— Separated at Turf Pick'em";

        var htmlPicksRows = pSummary.split("\n").map(function(line) {
          return "<li style='padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:13px;font-family:monospace;'>" + line + "</li>";
        }).join("");

        var htmlBody = "<div style='font-family:-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;'>" +
          "<div style='background:#0f172a;color:#ffffff;padding:16px 20px;border-radius:6px;margin-bottom:16px;'>" +
            "<h2 style='margin:0;font-size:18px;color:#38bdf8;'>🏈 Separated at Turf Pick'em</h2>" +
            "<div style='font-size:14px;color:#94a3b8;margin-top:4px;'>Official " + wk + " Pick Receipt</div>" +
          "</div>" +
          "<p style='font-size:15px;color:#334155;'>Hi <strong>" + pName + "</strong>,</p>" +
          "<p style='font-size:14px;color:#475569;'>Your 26 picks for <strong>" + wk + "</strong> have been safely recorded in the pool database.</p>" +
          "<div style='background:#f8fafc;border-left:4px solid #10b981;padding:12px 16px;margin:16px 0;'>" +
            "<div style='font-size:13px;color:#64748b;'><strong>Contestant:</strong> " + pName + "</div>" +
            "<div style='font-size:13px;color:#64748b;'><strong>Tie-Breaker:</strong> " + tb + "</div>" +
            "<div style='font-size:13px;color:#059669;font-weight:700;margin-top:4px;'>🔒 Official Deadline: Friday 9:00 PM CST</div>" +
          "</div>" +
          "<h4 style='margin:16px 0 8px;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;'>Your Submitted Picks</h4>" +
          "<ul style='list-style:none;padding:0;margin:0;background:#f1f5f9;border-radius:6px;padding:8px 14px;'>" +
            htmlPicksRows +
          "</ul>" +
          "<p style='font-size:13px;color:#64748b;margin-top:16px;'><em>💡 Note: You can edit and re-submit your picks anytime before Friday at 9:00 PM CST.</em></p>" +
          "<div style='border-top:1px solid #e2e8f0;margin-top:20px;padding-top:12px;font-size:12px;color:#94a3b8;text-align:center;'>Separated at Turf Pick'em — Have a great gameday!</div>" +
        "</div>";

        MailApp.sendEmail({
          to: recipient,
          subject: subj,
          body: body,
          htmlBody: htmlBody,
          name: "Separated at Turf Pick'em",
          replyTo: "separatedatturf@gmail.com"
        });
        return ContentService.createTextOutput(JSON.stringify({ ok: true, sentTo: recipient })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === "sendSaturdayMasterSheet" || action === "emailMasterCsvToAll") {
      var wk = wkLabel;
      var csvData = data.csvData || "";
      if (!csvData && currentCloud.poolMembers && currentCloud.poolMembers.length > 0) {
        csvData = generateMasterCsvFromCloud(currentCloud.poolMembers, activeGames);
      }

      var recipients = data.recipients || [];
      if (typeof recipients === "string") recipients = recipients.split(",").map(function(s) { return s.trim(); });
      if (recipients.length === 0) {
        // Collect all pool email addresses from playerEmailsMap and poolMembers
        var recMap = {};
        for (var k in cfg.playerEmailsMap) {
          if (cfg.playerEmailsMap[k] && cfg.playerEmailsMap[k].indexOf("@") !== -1) {
            recMap[cfg.playerEmailsMap[k].toLowerCase()] = true;
          }
        }
        if (Array.isArray(currentCloud.poolMembers)) {
          for (var pmi = 0; pmi < currentCloud.poolMembers.length; pmi++) {
            var pem = currentCloud.poolMembers[pmi].linkedAuthEmail;
            if (pem && pem.indexOf("@") !== -1) recMap[pem.toLowerCase()] = true;
          }
        }
        recipients = Object.keys(recMap);
      }
      if (recipients.length === 0 && cfg.primaryCommissionerEmail) {
        recipients = [cfg.primaryCommissionerEmail];
      }

      var subj = "📊 Separated at Turf — " + wk + " Official Master Pick'em Spreadsheet";
      var body = "Hi Everyone,\n\n" +
        "All picks for " + wk + " are now locked and officially revealed!\n\n" +
        "Attached is the master CSV spreadsheet containing every player's 26 picks, tiebreaker, and prior points.\n\n" +
        "Best of luck this weekend!\n— Separated at Turf Pick'em";

      var blob = Utilities.newBlob(csvData, "text/csv", "College_Pickem_26_" + wk.replace(/\s+/g, "_") + "_Master.csv");
      var validRecips = [];
      var seenRecips = {};
      for (var r = 0; r < recipients.length; r++) {
        var rec = String(recipients[r] || "").trim();
        if (rec && rec.indexOf("@") !== -1 && !seenRecips[rec.toLowerCase()]) {
          seenRecips[rec.toLowerCase()] = true;
          validRecips.push(rec);
        }
      }

      var chunkSize = 40;
      var sentBatches = 0;
      for (var c = 0; c < validRecips.length; c += chunkSize) {
        var chunk = validRecips.slice(c, c + chunkSize);
        try {
          if (chunk.length === 1) {
            MailApp.sendEmail({
              to: chunk[0],
              subject: subj,
              body: body,
              attachments: [blob],
              name: "Separated at Turf Pick'em",
              replyTo: "separatedatturf@gmail.com"
            });
          } else {
            MailApp.sendEmail(chunk[0], subj, body, {
              attachments: [blob],
              name: "Separated at Turf Pick'em",
              replyTo: "separatedatturf@gmail.com",
              bcc: chunk.slice(1).join(",")
            });
          }
          sentBatches++;
        } catch (eM) {}
      }

      // Automatically reveal picks and stamp Firestore
      var nowStr = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
      cfg.lastSatSheetSentAt = nowStr;
      cfg.lastSatSheetSentWeek = curWeek;
      patchFirebaseNode("", {
        fridayNightRevealOverride: true,
        commissionerConfig: cfg
      });

      return ContentService.createTextOutput(JSON.stringify({ ok: true, sentCount: validRecips.length, batches: sentBatches, revealed: true })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "sendWedThuNudge") {
      // 1. EMERGENCY KILL-SWITCH CHECK (MANDATORY FIX 1)
      if (!ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS) {
        Logger.log("🚫 OUTBOUND NUDGE BLOCKED: ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS is false.");
        return ContentService.createTextOutput(JSON.stringify({
          ok: false,
          skipped: true,
          reason: "Outbound pool broadcast emails currently disabled by kill switch (ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS = false)."
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // 2. ACQUIRE ATOMIC SCRIPT LOCK (MANDATORY FIX 1)
      var scriptLock = LockService.getScriptLock();
      var hasLock = scriptLock.tryLock(5000);
      if (!hasLock) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, skipped: true, reason: "Concurrent execution in progress" })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        var cstDayStr = Utilities.formatDate(new Date(), "America/Chicago", "u");
        var dayKey = curWeek + "_" + cstDayStr;
        var props = PropertiesService.getScriptProperties();
        var lockKey = "WED_THU_NUDGE_SENT_WEEK_" + dayKey;
        if (props.getProperty(lockKey) || (cfg && cfg.lastWedThuNudgeDayKey === dayKey)) {
          return ContentService.createTextOutput(JSON.stringify({ ok: false, skipped: true, reason: "Already nudged for " + dayKey })).setMimeType(ContentService.MimeType.JSON);
        }

        // Set lock BEFORE sending!
        props.setProperty(lockKey, new Date().toISOString());
        cfg.lastWedThuNudgeDayKey = dayKey;
        cfg.lastWedThuNudgeSentAt = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
        patchFirebaseNode("", { commissionerConfig: cfg });

        var wk = wkLabel;
        var rawEmails = data.emails || [];
        if (typeof rawEmails === "string") rawEmails = rawEmails.split(",").map(function(s) { return s.trim(); });

        if (rawEmails.length === 0 && data.missingPlayers && Array.isArray(data.missingPlayers)) {
          for (var mp = 0; mp < data.missingPlayers.length; mp++) {
            var mpStd = standardizeBotParticipantName(data.missingPlayers[mp]).toLowerCase();
            if (cfg.playerEmailsMap[mpStd]) {
              rawEmails.push(cfg.playerEmailsMap[mpStd]);
            }
          }
        }

        if (rawEmails.length === 0 && Array.isArray(currentCloud.poolMembers)) {
          for (var pmIdx = 0; pmIdx < currentCloud.poolMembers.length; pmIdx++) {
            var pMem = currentCloud.poolMembers[pmIdx];
            var pStdKey = standardizeBotParticipantName(pMem.name).toLowerCase();
            var pPicks = pMem.picks || {};
            var pCnt = Object.keys(pPicks).length;
            if (pCnt === 0 || pMem.awaitingSheet) {
              if (cfg.playerEmailsMap[pStdKey]) rawEmails.push(cfg.playerEmailsMap[pStdKey]);
              else if (pMem.linkedAuthEmail) rawEmails.push(pMem.linkedAuthEmail);
            }
          }
        }

        var validEmails = [];
        var seenNudge = {};
        for (var m = 0; m < rawEmails.length; m++) {
          var em = String(rawEmails[m] || "").trim();
          if (em && em.indexOf("@") !== -1 && !seenNudge[em.toLowerCase()]) {
            seenNudge[em.toLowerCase()] = true;
            validEmails.push(em);
          }
        }

        var nSubj = "⏰ Separated at Turf — " + wk + " Picks Due Friday 9:00 PM CST";
        var nBody = "Hi,\n\n" +
          "This is a friendly reminder to submit your 26 picks for " + wk + " before the Friday 9:00 PM CST deadline!\n\n" +
          "Picks remain editable right up until Friday at 9:00 PM CST.\n\n" +
          "Make your picks now: https://cfb-pickem.web.app\n\n" +
          "— Separated at Turf Pick'em";

        var nHtmlBody = "<div style='font-family:-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;'>" +
          "<div style='background:#0f172a;color:#ffffff;padding:16px 20px;border-radius:6px;margin-bottom:16px;'>" +
            "<h2 style='margin:0;font-size:18px;color:#f59e0b;'>⏰ Separated at Turf Pick'em</h2>" +
            "<div style='font-size:14px;color:#94a3b8;margin-top:4px;'>Pick Reminder: " + wk + "</div>" +
          "</div>" +
          "<p style='font-size:15px;color:#334155;'>Hi,</p>" +
          "<p style='font-size:14px;color:#475569;'>This is a friendly reminder to submit your 26 picks for <strong>" + wk + "</strong>.</p>" +
          "<div style='background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;'>" +
            "<div style='font-size:14px;color:#b45309;font-weight:700;'>🔒 Deadline: Friday at 9:00 PM CST</div>" +
            "<div style='font-size:12px;color:#78350f;margin-top:4px;'>You can edit and re-submit your picks anytime until the deadline.</div>" +
          "</div>" +
          "<div style='text-align:center;margin:24px 0;'>" +
            "<a href='https://cfb-pickem.web.app' style='background:#0284c7;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;'>Submit Picks Online &rarr;</a>" +
          "</div>" +
          "<div style='border-top:1px solid #e2e8f0;margin-top:20px;padding-top:12px;font-size:12px;color:#94a3b8;text-align:center;'>Separated at Turf Pick'em</div>" +
        "</div>";

        var nSent = 0;
        for (var ne = 0; ne < validEmails.length; ne++) {
          try {
            MailApp.sendEmail({
              to: validEmails[ne],
              subject: nSubj,
              body: nBody,
              htmlBody: nHtmlBody,
              name: "Separated at Turf Pick'em",
              replyTo: "separatedatturf@gmail.com"
            });
            nSent++;
          } catch (eNe) {}
        }

        return ContentService.createTextOutput(JSON.stringify({ ok: true, sentNudges: nSent, targetCount: validEmails.length })).setMimeType(ContentService.MimeType.JSON);
      } finally {
        scriptLock.releaseLock();
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, message: "Action received: " + action })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Run this function in the Apps Script editor to grant MailApp sending permissions and verify your inbox:
function authorizeAndTestEmailService() {
  var remaining = MailApp.getRemainingDailyQuota();
  Logger.log("MailApp is active! Daily emails remaining: " + remaining);
  var myEmail = Session.getActiveUser().getEmail();
  MailApp.sendEmail(myEmail, "✅ Pick'em Email Bot Verified!", "Your Google Apps Script Pick'em Bot is now fully authorized to send emails!\n\nDaily email quota remaining: " + remaining);
  Logger.log("✓ Sent test verification email to: " + myEmail);
}

// Run this function ONCE in the Apps Script editor to install automated triggers:
// 1. Every 1 Minute: `pollEspnLiveGamesSubMinute` (tracks ESPN live scores & play-by-play every 20s during live games!)
// 2. Every 5 Minutes: `autoScrapeWeeklyPickemToFirebase` (scrapes Gmail .xlsx/.csv sheets, standings & new slates)
// ============================================================================
// 1-CLICK EMERGENCY STOP & RESET BAD SATURDAY SCRAPE (MANDATORY FIX 4)
// Run this function in the Apps Script Editor or visit ?action=emergencyStop
// ============================================================================
function emergencyStopEmailLoopAndCleanState() {
  Logger.log("🚨 INITIATING EMERGENCY STOP FOR OUTBOUND EMAIL LOOP & CLEANING STATE...");

  // 1. Delete rogue time-based triggers calling outbound emails
  var triggers = ScriptApp.getProjectTriggers();
  var deletedTriggers = [];
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "checkAndDispatchScheduledOutboundEmails" ||
        fn === "sendSaturdayMasterSheet" ||
        fn === "sendWedThuNudge" ||
        fn === "checkAndRunScheduledEmails") {
      deletedTriggers.push(fn);
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log("✓ Deleted rogue outbound email triggers: " + (deletedTriggers.length ? deletedTriggers.join(", ") : "none found"));

  // 2. Set permanent ScriptProperties locks for current week and Week 8
  var props = PropertiesService.getScriptProperties();
  var curWeek = 8;
  try {
    var currentCloud = fetchFirebaseNode("") || {};
    if (currentCloud && currentCloud.currentWeek) curWeek = parseInt(currentCloud.currentWeek, 10);
  } catch (eW) {}

  props.setProperty("SAT_MASTER_CSV_SENT_WEEK_" + curWeek, new Date().toISOString());
  props.setProperty("SAT_MASTER_CSV_SENT_WEEK_8", new Date().toISOString());
  props.setProperty("SAT_MASTER_CSV_SENT_WEEK_7", new Date().toISOString());
  Logger.log("✓ ScriptProperties locks set for SAT_MASTER_CSV_SENT_WEEK_" + curWeek + " & Week 8");

  // 3. Inspect Firestore shared_state: if lastScrapedFile was self-generated, clean it!
  try {
    var cloud = fetchFirebaseNode("") || {};
    var lastFile = String(cloud.lastScrapedFile || "").toLowerCase();
    var cfg = cloud.commissionerConfig || {};
    cfg.lastSatSheetSentWeek = curWeek;
    cfg.lastSatSheetSentAt = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + " (EMERGENCY LOCKED)";
    cfg.autoSatMorningSheetEmail = false;

    var cleanPatch = { commissionerConfig: cfg };
    if (lastFile.indexOf("college_pickem_26_") !== -1 || lastFile.indexOf("_master.csv") !== -1 || lastFile.indexOf("master_grid") !== -1) {
      Logger.log("⚠️ Detected that lastScrapedFile (" + cloud.lastScrapedFile + ") was a self-generated CSV. Resetting officialSheetSyncedForWeek to null!");
      cleanPatch.officialSheetSyncedForWeek = null;
      cleanPatch.lastScrapedFile = "waiting_for_official_separatedatturf_sheet";
    }
    patchFirebaseNode("", cleanPatch);
    Logger.log("✓ Firestore updated: autoSatMorningSheetEmail disabled, lastSatSheetSentWeek locked to " + curWeek);
  } catch (eF) {
    Logger.log("Error updating Firestore: " + eF.message);
  }

  Logger.log("✅ EMERGENCY STOP COMPLETE: Outbound emails are completely halted and locked.");
  return { ok: true, deletedTriggers: deletedTriggers, weekLocked: curWeek };
}

function setupLiveEspnAndEmailTriggers() {
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log("MailApp sending quota available: " + quota);
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var fn = existing[i].getHandlerFunction();
    if (fn === "pollEspnLiveGamesSubMinute" || fn === "syncEspnLiveStateToFirestore" ||
        fn === "autoScrapeWeeklyPickemToFirebase" || fn === "checkAndDispatchScheduledOutboundEmails" ||
        fn === "sendSaturdayMasterSheet" || fn === "sendWedThuNudge" || fn === "checkAndRunScheduledEmails") {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger("pollEspnLiveGamesSubMinute").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("autoScrapeWeeklyPickemToFirebase").timeBased().everyMinutes(5).create();
  Logger.log("✓ Installed 1-minute ESPN Live Score trigger + 5-minute Gmail Bot trigger (Outbound mass email trigger deleted/disabled).");
}

function autoScrapeWeeklyPickemToFirebase() {
  // STRICT INBOUND SCRAPER ONLY: Scrapes inbound emails from separatedatturf@gmail.com
  // NEVER DISPATCHES OUTBOUND EMAILS! (MANDATORY FIX 1)
  return runMasterPickemEmailBot(false);
}

// Scheduled automated outbound email dispatcher:
// 1. Wed/Thu Reminder Email: checks if day is Wed/Thu >= 10:00 AM CST and sends if not already sent today
// 2. Sat Morning Master Spreadsheet Email: checks if day is Sat >= 8:00 AM CST (or sheet synced) and emails master CSV
function checkAndDispatchScheduledOutboundEmails() {
  // 1. EMERGENCY KILL-SWITCH CHECK (MANDATORY FIX 1)
  if (!ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS) {
    Logger.log("🚫 Scheduled outbound email check suppressed: ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS is false.");
    return { ok: false, skipped: true, reason: "ENABLE_OUTBOUND_POOL_BROADCAST_EMAILS is false" };
  }
  var now = new Date();
  var cstDayStr = Utilities.formatDate(now, "America/Chicago", "u"); // 1=Mon .. 7=Sun (ISO)
  var cstDay = parseInt(cstDayStr, 10);
  var cstHour = parseInt(Utilities.formatDate(now, "America/Chicago", "H"), 10); // 0..23

  var currentCloud = fetchFirebaseNode("") || {};
  var curWeek = (currentCloud && currentCloud.currentWeek) || 8;
  var wkLabel = (currentCloud && currentCloud.weekLabel) || ("Week " + curWeek);
  var cfg = (currentCloud && currentCloud.commissionerConfig) ? currentCloud.commissionerConfig : {};
  if (!cfg.playerEmailsMap) cfg.playerEmailsMap = {};

  // CHECK 1: Wednesday & Thursday Pick Reminders (ISO days: 3=Wednesday, 4=Thursday)
  if ((cstDay === 3 || cstDay === 4) && cstHour >= 10 && cfg.autoWedThuNudgeEnabled !== false) {
    var dayKey = curWeek + "_" + cstDay;
    if (cfg.lastWedThuNudgeDayKey !== dayKey) {
      Logger.log("Triggering automated Wed/Thu reminder email for " + wkLabel + " (Day " + cstDay + ")...");
      var missingList = [];
      var pms = currentCloud.poolMembers || [];
      for (var p = 0; p < pms.length; p++) {
        var pm = pms[p];
        var pMap = pm.picks || {};
        if (Object.keys(pMap).length === 0 || pm.awaitingSheet) {
          missingList.push(pm.name);
        }
      }
      doPost({
        postData: {
          contents: JSON.stringify({
            action: "sendWedThuNudge",
            weekLabel: wkLabel,
            missingPlayers: missingList
          })
        }
      });
      cfg.lastWedThuNudgeDayKey = dayKey;
      patchFirebaseNode("", { commissionerConfig: cfg });
      Logger.log("✓ Automated Wed/Thu reminder finished for " + wkLabel);
    }
  }

  // CHECK 2: Saturday Morning Master Spreadsheet Email & Reveal (ISO day: 6=Saturday)
  var isSatMorning = (cstDay === 6 && cstHour >= 8);
  var isSheetSyncedForWeek = (currentCloud.officialSheetSyncedForWeek && String(currentCloud.officialSheetSyncedForWeek) === String(curWeek));
  if ((isSatMorning || isSheetSyncedForWeek) && cfg.autoSatMorningSheetEmail !== false) {
    if (cfg.lastSatSheetSentWeek !== curWeek) {
      Logger.log("Triggering automated Saturday morning master sheet email for " + wkLabel + "...");
      var activeGames = (currentCloud && currentCloud.customGames && currentCloud.customGames.length)
        ? currentCloud.customGames
        : getDefaultWeek7GamesFallback();
      var csvData = generateMasterCsvFromCloud(currentCloud.poolMembers, activeGames);
      doPost({
        postData: {
          contents: JSON.stringify({
            action: "sendSaturdayMasterSheet",
            weekLabel: wkLabel,
            csvData: csvData
          })
        }
      });
      Logger.log("✓ Automated Saturday master sheet sent for " + wkLabel);
    }
  }
}

function generateMasterCsvFromCloud(poolMembers, activeGames) {
  if (!poolMembers || !Array.isArray(poolMembers) || !activeGames || !Array.isArray(activeGames)) return "";
  var headers = ["Contestant"];
  for (var g = 0; g < activeGames.length; g++) {
    var gm = activeGames[g];
    headers.push(gm.away + " @ " + gm.home);
  }
  headers.push("Prior Pts", "Tiebreaker");

  var rows = [headers.map(escapeCsvValue).join(",")];
  for (var m = 0; m < poolMembers.length; m++) {
    var pm = poolMembers[m];
    var row = [pm.name || "Player"];
    var picks = pm.picks || {};
    for (var g2 = 0; g2 < activeGames.length; g2++) {
      var gm2 = activeGames[g2];
      var pickVal = picks[gm2.id] || picks["game_" + gm2.id] || picks[String(gm2.id)] || "";
      row.push(pickVal);
    }
    row.push(pm.priorPts !== undefined ? pm.priorPts : 0);
    row.push(pm.tiebreaker || "—");
    rows.push(row.map(escapeCsvValue).join(","));
  }
  return rows.join("\r\n");
}

function escapeCsvValue(val) {
  var s = String(val === undefined || val === null ? "" : val);
  if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function forceRescanLatestSpreadsheetEmail() {
  return runMasterPickemEmailBot(true);
}

function runMasterPickemEmailBot(forceRescan) {
  var props = PropertiesService.getUserProperties();
  var processedIds = forceRescan ? {} : JSON.parse(props.getProperty("PROCESSED_MSG_IDS") || "{}");
  // Quota protection: prune old keys so UserProperties value never exceeds the 9KB limit
  var pKeys = Object.keys(processedIds);
  if (pKeys.length > 50) {
    var pruned = {};
    pKeys.slice(pKeys.length - 40).forEach(function(k) { pruned[k] = processedIds[k]; });
    processedIds = pruned;
  }

  // STRICT QUERY FILTERING: Grab real "College Pick'em '26 - Week X Spreadsheet", exclude self-generated emails
  var query = '(from:separatedatturf@gmail.com OR subject:"College Pick\'em" OR "Separated at Turf") -from:me -in:sent -in:drafts -subject:"Official Master" -subject:"Master Pick\'em Spreadsheet" -subject:"Confirmation Receipt" -subject:"Picks Nudge" newer_than:10d';
  var threads = GmailApp.search(query, 0, 20);

  var currentCloud = fetchFirebaseNode("") || {};
  var activeGames = (currentCloud && currentCloud.customGames && currentCloud.customGames.length)
    ? currentCloud.customGames
    : getDefaultWeek7GamesFallback();

  var stats = { ok: true, scannedMessages: 0, importedPoolMembers: 0, importedStandings: 0, importedGames: 0, updatedAt: new Date().toISOString() };

  // Process oldest to newest so latest emails win
  for (var t = threads.length - 1; t >= 0; t--) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var msgId = msg.getId();
      var subject = msg.getSubject() || "";
      var plainBody = msg.getPlainBody() || "";
      var htmlBody = msg.getBody() || "";
      var attachments = msg.getAttachments() || [];
      var subjectLow = subject.toLowerCase();

      var curWkTarget = (currentCloud && currentCloud.currentWeek) ? parseInt(currentCloud.currentWeek, 10) : 8;
      var needsOfficialSheet = (!currentCloud.officialSheetSyncedForWeek || String(currentCloud.officialSheetSyncedForWeek) !== String(curWkTarget));
      var isCandidateSheetEmail = (subjectLow.indexOf("spreadsheet") !== -1 || attachments.length > 0);

      // If we are still waiting for the official sheet, NEVER skip candidate spreadsheet emails due to processed cache!
      if (!forceRescan && processedIds[msgId] && !(needsOfficialSheet && isCandidateSheetEmail)) {
        continue;
      }
      stats.scannedMessages++;

      // SENDER & SELF-SCRAPE GUARD (MANDATORY FIX 3)
      var mySelfEmail = String(Session.getActiveUser().getEmail() || "").toLowerCase().trim();
      var senderRaw = String(msg.getFrom() || "").toLowerCase();

      // BLOCK SELF-GENERATED EMAILS: Never scrape our own sent emails or app broadcasts!
      if ((mySelfEmail && senderRaw.indexOf(mySelfEmail) !== -1) ||
          senderRaw.indexOf("commissioner@separatedatturf.com") !== -1 ||
          subjectLow.indexOf("official master") !== -1 ||
          subjectLow.indexOf("master pick'em spreadsheet") !== -1) {
        Logger.log("⏭️ Skipping app-generated / self-sent email: " + subject + " from " + senderRaw);
        continue;
      }

      // TARGET OFFICIAL LEAGUE SPREADSHEET: "College Pick'em '26 - Week 8 Spreadsheet"
      var isOfficialSpreadsheetSubject = (subjectLow.indexOf("college pick'em") !== -1 && subjectLow.indexOf("spreadsheet") !== -1) ||
                                         (subjectLow.indexOf("separated at turf") !== -1 && subjectLow.indexOf("spreadsheet") !== -1);
      var isFromOfficialOrg = (senderRaw.indexOf("separatedatturf@gmail.com") !== -1) || isOfficialSpreadsheetSubject;

      if (isOfficialSpreadsheetSubject) {
        Logger.log("🎯 FOUND TARGET SPREADSHEET EMAIL: " + subject + " from " + senderRaw + " (" + attachments.length + " attachments)");
      } else {
        Logger.log("Inspecting email: " + subject + " from " + senderRaw + " (" + attachments.length + " attachments)");
      }

      var wkMatchMsg = (subject + " " + plainBody.slice(0, 400)).match(/week\s*(\d{1,2})/i);
      var msgWeekNum = wkMatchMsg ? parseInt(wkMatchMsg[1], 10) : null;

      // ----------------------------------------------------------------------
      // PIPELINE 1: Check for Weekly Standings / Leaderboard Table in Email FIRST
      // (So any new priorPts are applied to poolMembers & watchlist immediately!)
      // ----------------------------------------------------------------------
      var standingsRows = isFromOfficialOrg ? parseStandingsFromText(plainBody, htmlBody) : [];
      if (standingsRows.length >= 5) {
        var ptsByName = {};
        var rkByName = {};
        for (var sr = 0; sr < standingsRows.length; sr++) {
          var sKey = standardizeBotParticipantName(standingsRows[sr].name).toLowerCase();
          ptsByName[sKey] = standingsRows[sr].priorPts;
          rkByName[sKey] = standingsRows[sr].rank;
        }
        var existingMembers = (currentCloud && currentCloud.poolMembers && Array.isArray(currentCloud.poolMembers)) ? currentCloud.poolMembers : [];
        var seenM = {};
        for (var em = 0; em < existingMembers.length; em++) {
          var mName = standardizeBotParticipantName(existingMembers[em].name);
          existingMembers[em].name = mName;
          var mKey = mName.toLowerCase();
          seenM[mKey] = true;
          if (ptsByName[mKey] !== undefined) existingMembers[em].priorPts = ptsByName[mKey];
          if (rkByName[mKey] !== undefined) existingMembers[em].priorRank = rkByName[mKey];
        }
        for (var sr2 = 0; sr2 < standingsRows.length; sr2++) {
          var stName = standardizeBotParticipantName(standingsRows[sr2].name);
          var stKey = stName.toLowerCase();
          if (!seenM[stKey]) {
            existingMembers.push({
              name: stName,
              priorPts: standingsRows[sr2].priorPts,
              priorRank: standingsRows[sr2].rank,
              tiebreaker: "—",
              picks: {},
              livePts: 0,
              inProgressPts: 0,
              finalPts: 0
            });
          }
        }
        currentCloud.leaderboard = standingsRows;
        currentCloud.poolMembers = existingMembers;
        var stPatch = {
          leaderboard: standingsRows,
          poolMembers: existingMembers,
          standingsUpdatedAt: new Date().toISOString()
        };
        if (msgWeekNum && msgWeekNum >= 1) {
          stPatch.currentWeek = msgWeekNum;
          stPatch.weekLabel = "Week " + msgWeekNum;
          currentCloud.currentWeek = msgWeekNum;
          currentCloud.weekLabel = "Week " + msgWeekNum;
        }
        patchFirebaseNode("", stPatch);
        stats.importedStandings = standingsRows.length;
        Logger.log("✓ Pushed " + standingsRows.length + " standings rows & updated poolMembers priorPts in Firebase!");
      }

      // ----------------------------------------------------------------------
      // PIPELINE 2: Check for a New Weekly Game Slate (Google Form / WordPress)
      // IMPORTANT: Before resetting the week, we FIRST run a final ESPN live score &
      // play-by-play sync for the outgoing week, grade all pool members, and snapshot
      // the outgoing week into `weekArchives` & `live_games/week_X_archive`!
      // ----------------------------------------------------------------------
      var isSatOrFriNight = false;
      try {
        var cstDayNow = parseInt(Utilities.formatDate(new Date(), "America/Chicago", "u"), 10);
        if (cstDayNow === 6 || cstDayNow === 5) isSatOrFriNight = true;
      } catch (eDay) {}

      var hasSpreadsheetAtt = attachments.some(function(att) {
        var aName = (att.getName() || "").toLowerCase();
        return aName.indexOf(".xlsx") !== -1 || aName.indexOf(".csv") !== -1 || aName.indexOf(".tsv") !== -1;
      });
      var isSpreadsheetSubject = /spreadsheet|master\s*grid|picks|selections/i.test(subject);

      // ONLY allow Pipeline 2 to archive & reset if from official org, NO spreadsheet attachments, NOT Saturday, and strictly a NEW FUTURE WEEK!
      var formUrl = (isFromOfficialOrg && !hasSpreadsheetAtt && !isSpreadsheetSubject && !isSatOrFriNight) ? extractGoogleFormUrl(htmlBody, plainBody) : null;
      if (formUrl && subject.toLowerCase().indexOf("response") === -1) {
        var scrapedGames = scrapeGoogleFormGames(formUrl);
        if (scrapedGames && scrapedGames.length >= 15) {
          var curWkNum = (currentCloud && currentCloud.currentWeek) ? parseInt(currentCloud.currentWeek, 10) : 8;
          var newWkNum = msgWeekNum || (curWkNum + 1);

          // NEVER reset picks if newWkNum <= curWkNum (current or past week)!
          if (newWkNum > curWkNum) {
          var prevWkNum = curWkNum;
          var newWkLabel = "Week " + newWkNum;

          // STEP 1 (PRE-RESET): Pull final ESPN scores & play-by-play drives for the outgoing week before resetting!
          var finalOutgoingSync = syncEspnLiveStateToFirestore(true, activeGames, prevWkNum);
          var finalOutgoingScores = (finalOutgoingSync && finalOutgoingSync.gamesMap && Object.keys(finalOutgoingSync.gamesMap).length > 0)
            ? finalOutgoingSync.gamesMap
            : ((currentCloud && currentCloud.liveScores) ? currentCloud.liveScores : {});

          // STEP 2 (PRE-RESET): Archive the outgoing week's games, picks, leaderboard, and final ESPN scores/drives
          var existingArchives = (currentCloud && currentCloud.weekArchives && typeof currentCloud.weekArchives === "object")
            ? currentCloud.weekArchives
            : {};
          var prevArchKey = "week_" + prevWkNum;
          existingArchives[prevArchKey] = {
            weekNum: prevWkNum,
            weekLabel: (currentCloud && currentCloud.weekLabel) || ("Week " + prevWkNum),
            archivedAt: new Date().toISOString(),
            games: activeGames,
            michael: (currentCloud && currentCloud.michael) || {},
            kinyion: (currentCloud && currentCloud.kinyion) || {},
            watchlist: (currentCloud && currentCloud.watchlist) || [],
            leaderboard: (currentCloud && currentCloud.leaderboard) || [],
            poolMembers: (currentCloud && currentCloud.poolMembers) || [],
            liveScores: finalOutgoingScores
          };
          patchFirestoreDocUrl(FIRESTORE_BASE_URL + "/live_games/" + prevArchKey + "_archive", {
            currentWeek: prevWkNum,
            weekLabel: "Week " + prevWkNum,
            games: finalOutgoingScores,
            archivedAt: new Date().toISOString()
          });
          Logger.log("✓ Archived outgoing Week " + prevWkNum + " final ESPN scores & drives before resetting for " + newWkLabel);

          // STEP 3: Reset pool picks & initialize `live_games/week_state` for the new week
          var resetMembers = (currentCloud && currentCloud.poolMembers && Array.isArray(currentCloud.poolMembers)) ? currentCloud.poolMembers : [];
          for (var rm = 0; rm < resetMembers.length; rm++) {
            resetMembers[rm].picks = {};
            resetMembers[rm].livePts = 0;
            resetMembers[rm].inProgressPts = 0;
            resetMembers[rm].finalPts = 0;
          }
          var resetWl = (currentCloud && currentCloud.watchlist && Array.isArray(currentCloud.watchlist)) ? currentCloud.watchlist : [];
          for (var rw = 0; rw < resetWl.length; rw++) {
            resetWl[rw].picks = {};
          }
          patchFirebaseNode("", {
            customGames: scrapedGames,
            currentWeek: newWkNum,
            weekLabel: newWkLabel,
            weekArchives: existingArchives,
            liveScores: {},
            poolMembers: resetMembers,
            watchlist: resetWl,
            scrapedAt: new Date().toISOString()
          });
          try {
            PropertiesService.getScriptProperties().setProperty("ACTIVE_SLATE_CACHE_JSON", JSON.stringify({
              currentWeek: newWkNum,
              weekLabel: newWkLabel,
              games: scrapedGames
            }));
            PropertiesService.getScriptProperties().deleteProperty("LAST_LIVE_STATE_HASH");
          } catch (eProp) {}

          activeGames = scrapedGames;
          currentCloud.customGames = scrapedGames;
          currentCloud.currentWeek = newWkNum;
          currentCloud.weekLabel = newWkLabel;
          currentCloud.weekArchives = existingArchives;
          // Immediately seed `live_games/week_state` with the new week's ESPN schedule & initial state
          syncEspnLiveStateToFirestore(true, scrapedGames, newWkNum);
          stats.importedGames = scrapedGames.length;
          Logger.log("✓ Pushed " + scrapedGames.length + " new weekly games (" + newWkLabel + "), archived outgoing week, & initialized live_games/week_state!");
          } else {
            Logger.log("ℹ️ Skipping slate reset: Week " + newWkNum + " is not greater than active Week " + curWkNum);
          }
        }
      }

      // ----------------------------------------------------------------------
      // PIPELINE 3: Check for Master Weekly `.xlsx` or `.csv` Pool Spreadsheet Attachment
      // (e.g., "College Pick'em '26 - Week 7 Spreadsheet" -> "College Pick'em '26 - Week 7.xlsx")
      // ----------------------------------------------------------------------
      // STRICT SPREADSHEET IMPORT: Only from separatedatturf@gmail.com, skip self-generated exports
      if (isFromOfficialOrg) {
        for (var a = 0; a < attachments.length; a++) {
          var att = attachments[a];
          var attName = String(att.getName() || "").toLowerCase();

          // Reject any self-generated app master CSV export (MANDATORY FIX 3)
          if (attName.indexOf("college_pickem_26_") !== -1 || attName.indexOf("_master.csv") !== -1 || attName.indexOf("master_grid") !== -1) {
            Logger.log("⏭️ Skipping app self-generated master CSV attachment: " + att.getName());
            continue;
          }

          if (attName.indexOf(".xlsx") !== -1) {
          var grid = extractGridFromXlsxAttachment(att);
          var poolResult = parsePoolSpreadsheetGrid(grid, activeGames, currentCloud);
          if (poolResult && poolResult.poolMembers.length >= 10) {
            var sheetWkNum = msgWeekNum || (currentCloud && currentCloud.currentWeek) || 8;
            var clearedDelMap = (currentCloud && currentCloud.deletedPicksByMember) ? Object.assign({}, currentCloud.deletedPicksByMember) : {};
            poolResult.poolMembers.forEach(function(pm) {
              var pmLow = pm.name.toLowerCase();
              if (clearedDelMap[pmLow]) delete clearedDelMap[pmLow];
            });
            patchFirebaseNode("", {
              poolMembers: poolResult.poolMembers,
              leaderboard: poolResult.leaderboard,
              michael: poolResult.michael,
              kinyion: poolResult.kinyion,
              watchlist: poolResult.watchlist,
              officialSheetSyncedForWeek: sheetWkNum,
              lastScrapedFile: att.getName(),
              deletedPicksByMember: clearedDelMap,
              updatedAt: new Date().toISOString()
            });
            if (poolResult.michael && poolResult.michael.picks) {
              patchFirestoreUserDoc("michael", { profileKey: "michael", displayName: "Michael A", linkedMemberName: "Michael A", picks: poolResult.michael.picks, tiebreaker: poolResult.michael.tiebreaker || "28-24", updatedAt: new Date().toISOString() });
            }
            if (poolResult.kinyion && poolResult.kinyion.picks) {
              patchFirestoreUserDoc("kinyion", { profileKey: "kinyion", displayName: "Kinyon C", linkedMemberName: "Kinyon C", picks: poolResult.kinyion.picks, tiebreaker: poolResult.kinyion.tiebreaker || "31-24", updatedAt: new Date().toISOString() });
            }
            stats.importedPoolMembers = poolResult.poolMembers.length;
            Logger.log("✓ Auto-scraped .xlsx attachment (" + att.getName() + "): " + poolResult.poolMembers.length + " pool members pushed to Firebase!");
          }
        } else if (attName.indexOf(".csv") !== -1 || attName.indexOf(".tsv") !== -1) {
          var csvText = att.getDataAsString();
          var csvGrid = Utilities.parseCsv(csvText);
          var csvPoolResult = parsePoolSpreadsheetGrid(csvGrid, activeGames, currentCloud);
          if (csvPoolResult && csvPoolResult.poolMembers.length >= 10) {
            var csvWkNum = msgWeekNum || (currentCloud && currentCloud.currentWeek) || 8;
            var clearedDelMapCsv = (currentCloud && currentCloud.deletedPicksByMember) ? Object.assign({}, currentCloud.deletedPicksByMember) : {};
            csvPoolResult.poolMembers.forEach(function(pm) {
              var pmLow = pm.name.toLowerCase();
              if (clearedDelMapCsv[pmLow]) delete clearedDelMapCsv[pmLow];
            });
            patchFirebaseNode("", {
              poolMembers: csvPoolResult.poolMembers,
              leaderboard: csvPoolResult.leaderboard,
              michael: csvPoolResult.michael,
              kinyion: csvPoolResult.kinyion,
              watchlist: csvPoolResult.watchlist,
              officialSheetSyncedForWeek: csvWkNum,
              lastScrapedFile: att.getName(),
              deletedPicksByMember: clearedDelMapCsv,
              updatedAt: new Date().toISOString()
            });
            if (csvPoolResult.michael && csvPoolResult.michael.picks) {
              patchFirestoreUserDoc("michael", { profileKey: "michael", displayName: "Michael A", linkedMemberName: "Michael A", picks: csvPoolResult.michael.picks, tiebreaker: csvPoolResult.michael.tiebreaker || "28-24", updatedAt: new Date().toISOString() });
            }
            if (csvPoolResult.kinyion && csvPoolResult.kinyion.picks) {
              patchFirestoreUserDoc("kinyion", { profileKey: "kinyion", displayName: "Kinyon C", linkedMemberName: "Kinyon C", picks: csvPoolResult.kinyion.picks, tiebreaker: csvPoolResult.kinyion.tiebreaker || "31-24", updatedAt: new Date().toISOString() });
            }
            stats.importedPoolMembers = csvPoolResult.poolMembers.length;
            Logger.log("✓ Auto-scraped .csv attachment: " + csvPoolResult.poolMembers.length + " pool members pushed to Firebase!");
          }
        }
      }
      }

      // ----------------------------------------------------------------------
      // PIPELINE 4: Check for Individual Pick Confirmation Emails
      // ----------------------------------------------------------------------
      var isReceiptSender = senderRaw.indexOf("forms-receipts-noreply@google.com") !== -1 || isFromOfficialOrg;
      if (isReceiptSender && activeGames && activeGames.length > 0 && attachments.length === 0) {
        var pickResult = parsePicksFromEmailText(plainBody, activeGames);
        if (pickResult.matchedCount >= 15) {
          var targetProfile = detectProfileOwner(subject, plainBody, msg.getFrom(), currentCloud);
          if (targetProfile) {
            // Guard: Never overwrite in-app picks if player already has active saved picks in Firestore!
            var userDoc = fetchFirebaseNode("pickem_v14_users/" + targetProfile);
            if (userDoc && (userDoc._manualEditsThisWeek || (userDoc.picks && Object.keys(userDoc.picks).length >= 15))) {
              Logger.log("ℹ️ Skipping confirmation email for " + targetProfile + ": player already has active in-app picks in Firestore.");
            } else {
              savePicksToTargetProfile(targetProfile, pickResult, currentCloud);
              Logger.log("✓ Imported " + pickResult.matchedCount + " picks for " + targetProfile);
            }
          } else {
            Logger.log("ℹ️ Skipping pick confirmation email from " + msg.getFrom() + " (could not resolve to specific contestant; Michael A protected)");
          }
        }
      }

      processedIds[msgId] = new Date().toISOString();
    }
  }

  props.setProperty("PROCESSED_MSG_IDS", JSON.stringify(processedIds));
  return stats;
}

// ============================================================================
// NATIVE ZERO-CONFIG .XLSX ATTACHMENT PARSER (Unzips XML directly in memory)
// ============================================================================
function extractGridFromXlsxAttachment(att) {
  try {
    var zipBlob = att.copyBlob().setContentType("application/zip");
    var files = Utilities.unzip(zipBlob);
    var sharedStringsXml = null;
    var candidateSheets = [];

    for (var i = 0; i < files.length; i++) {
      var fname = (files[i].getName() || "").toLowerCase();
      if (fname === "xl/sharedstrings.xml") {
        sharedStringsXml = files[i].getDataAsString();
      } else if (fname.indexOf("xl/worksheets/") === 0 && fname.indexOf(".xml") !== -1) {
        var str = files[i].getDataAsString();
        candidateSheets.push({ name: files[i].getName(), xml: str, len: str.length });
      }
    }
    if (candidateSheets.length === 0) return [];

    // Sort by largest XML content so main sheet with all players & games is chosen
    candidateSheets.sort(function(a, b) { return b.len - a.len; });
    var sheet1Xml = candidateSheets[0].xml;

    var sharedStrings = [];
    if (sharedStringsXml) {
      var ssMatches = sharedStringsXml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
      for (var s = 0; s < ssMatches.length; s++) {
        var tParts = ssMatches[s].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        var combinedStr = "";
        for (var tp = 0; tp < tParts.length; tp++) {
          combinedStr += tParts[tp].replace(/<[^>]+>/g, "");
        }
        sharedStrings.push(decodeXmlEntities(combinedStr));
      }
    }

    var grid = [];
    var rowMatches = sheet1Xml.match(/<row[\s>][\s\S]*?<\/row>/g) || [];
    for (var r = 0; r < rowMatches.length; r++) {
      var rowXml = rowMatches[r];
      var cellMatches = rowXml.match(/<c[\s>][\s\S]*?(?:<\/c>|\/>)/g) || [];
      var rowArr = [];
      for (var c = 0; c < cellMatches.length; c++) {
        var cXml = cellMatches[c];
        var refMatch = cXml.match(/\br="([A-Z]+)\d+"/);
        var colIdx = refMatch ? colLettersToIndex(refMatch[1]) : c;
        var typeMatch = cXml.match(/\bt="([^"]+)"/);
        var cType = typeMatch ? typeMatch[1] : "";
        var vMatch = cXml.match(/<v>([\s\S]*?)<\/v>/);
        var val = "";
        if (cType === "s" && vMatch) {
          var idx = parseInt(vMatch[1], 10);
          val = sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
        } else if (cType === "inlineStr") {
          var isMatch = cXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          val = isMatch ? decodeXmlEntities(isMatch[1]) : "";
        } else if (vMatch) {
          val = decodeXmlEntities(vMatch[1]);
        }
        while (rowArr.length <= colIdx) rowArr.push("");
        rowArr[colIdx] = String(val).trim();
      }
      if (rowArr.length > 0) grid.push(rowArr);
    }
    return grid;
  } catch (e) {
    Logger.log("XLSX unzip parse error: " + e.message);
    return [];
  }
}

function colLettersToIndex(letters) {
  var num = 0;
  for (var i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64);
  }
  return num - 1;
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function standardizeBotParticipantName(rawName) {
  var clean = String(rawName || "").replace(/\s+/g, " ").trim();
  var low = clean.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (low === "michael" || low === "michael a" || low.indexOf("michael adams") === 0) return "Michael A";
  if (low === "kinyon" || low === "kinyon c" || low === "kinyion" || low === "kinyion c" || low.indexOf("kinyon") === 0 || low.indexOf("kinyion") === 0 || low.indexOf("kenyon") === 0) return "Kinyon C";
  return clean;
}

var BOT_TEAM_ALIASES = {
  "miamifl": "miami", "miamiflorida": "miami", "theu": "miami",
  "pitt": "pittsburgh",
  "unc": "northcarolina",
  "southerncalifornia": "usc", "southerncal": "usc",
  "byu": "byu",
  "lsu": "lsu",
  "tcu": "tcu",
  "smu": "smu",
  "texasam": "texasam", "tamu": "texasam", "am": "texasam", "taam": "texasam", "tam": "texasam",
  "vandy": "vanderbilt", "van": "vanderbilt",
  "cal": "california", "calberkeley": "california",
  "bama": "alabama", "ala": "alabama",
  "uga": "georgia",
  "cincy": "cincinnati", "cin": "cincinnati",
  "clem": "clemson",
  "kent": "kentucky", "uk": "kentucky",
  "hou": "houston", "uh": "houston",
  "utes": "utah",
  "missst": "mississippistate", "msst": "mississippistate", "missstate": "mississippistate",
  "scar": "southcarolina", "sc": "southcarolina", "socar": "southcarolina",
  "vatech": "virginiatech", "vt": "virginiatech", "vtech": "virginiatech",
  "gatech": "georgiatech", "gt": "georgiatech",
  "kstate": "kansasstate", "ksu": "kansasstate",
  "oklast": "oklahomastate", "okst": "oklahomastate", "okstate": "oklahomastate",
  "michst": "michiganstate", "msu": "michiganstate",
  "arizst": "arizonastate", "asu": "arizonastate",
  "iowast": "iowastate", "isu": "iowastate",
  "nwest": "northwestern", "nw": "northwestern", "nu": "northwestern",
  "ttech": "texastech", "ttu": "texastech",
  "colo": "colorado",
  "okla": "oklahoma", "ou": "oklahoma",
  "mich": "michigan",
  "wisc": "wisconsin", "wis": "wisconsin",
  "syr": "syracuse",
  "minn": "minnesota",
  "illini": "illinois",
  "bc": "bostoncollege",
  "wvu": "westvirginia", "wva": "westvirginia"
};

function normalizeBotKey(str) {
  var raw = String(str || "");
  if (!raw) return "";
  var s = raw.toLowerCase()
    .replace(/#\d+\s*/g, "")
    .replace(/&/g, "")
    .replace(/\buniv(ersity)?( of)?\b/g, "")
    .replace(/\bst\.?(?=\s|\)|$)/g, "state")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return BOT_TEAM_ALIASES[s] || s;
}

function isFakeContestantName(name) {
  if (!name) return true;
  var low = String(name).trim().toLowerCase();
  return (
    low === "dates" || low === "channel" || low === "time" || low.indexOf("time") === 0 ||
    low.indexOf("college") === 0 || low === "name" || low === "player" || low === "contestants" ||
    low === "scoreboard" || low === "total" || low === "points" || low === "tie-brkr" ||
    low === "weekly" || low === "game" || low === "point" || low === "winners" || low === "value" ||
    low === "how to score" || /^\d+$/.test(low)
  );
}

function isSafeBotTeamSubstrMatch(hayNorm, needleNorm) {
  if (!hayNorm || !needleNorm) return false;
  if (hayNorm === needleNorm) return true;
  if (needleNorm.length < 4 || hayNorm.length < 4) return false;
  var idx = hayNorm.indexOf(needleNorm);
  if (idx === -1) return false;
  var prefix = hayNorm.slice(0, idx);
  var suffix = hayNorm.slice(idx + needleNorm.length);
  var blockedPrefixes = /(west|south|north|east|central|middle|coastal|western|eastern|northern|southern)$/;
  var blockedSuffixes = /^(state|st|tech|am|oh|ohio|fl|christian|southern|northern|eastern|western|international|atlantic|college)/;
  if (prefix && blockedPrefixes.test(prefix)) return false;
  if (suffix && blockedSuffixes.test(suffix)) return false;
  return true;
}

function resolveBotSheetTeam(cellVal, g) {
  if (!cellVal || !g) return null;
  var norm = normalizeBotKey(cellVal);
  if (!norm) return null;
  var aKey = normalizeBotKey(g.away);
  var hKey = normalizeBotKey(g.home);
  var aCode = normalizeBotKey(g.awayCode);
  var hCode = normalizeBotKey(g.homeCode);
  if (norm === aKey || norm === aCode) return g.away;
  if (norm === hKey || norm === hCode) return g.home;
  var matchAway = (aKey.length >= 4 && aKey.indexOf(norm) !== -1) || (norm.length >= 4 && norm.indexOf(aKey) !== -1) || (aCode.length >= 3 && aCode.indexOf(norm) !== -1) || isSafeBotTeamSubstrMatch(norm, aKey);
  var matchHome = (hKey.length >= 4 && hKey.indexOf(norm) !== -1) || (norm.length >= 4 && norm.indexOf(hKey) !== -1) || (hCode.length >= 3 && hCode.indexOf(norm) !== -1) || isSafeBotTeamSubstrMatch(norm, hKey);
  if (matchAway && !matchHome) return g.away;
  if (matchHome && !matchAway) return g.home;
  return null;
}

function parsePoolSpreadsheetGrid(grid, gamesList, currentCloud) {
  if (!grid || !grid.length || !gamesList || !gamesList.length) return null;
  var numGames = gamesList.length;
  var poolMembers = [];

  // STEP 1: Scan first 6 rows to locate header row and map columns to games if available
  var colToGameId = {};
  var nameCol = 0;
  var priorPtsCol = -1;
  var tbCol = -1;

  for (var hRowIdx = 0; hRowIdx < Math.min(6, grid.length); hRowIdx++) {
    var hRow = grid[hRowIdx];
    if (!hRow || hRow.length < 5) continue;
    for (var c = 0; c < hRow.length; c++) {
      var hCell = String(hRow[c] || "").trim();
      var hLow = hCell.toLowerCase();
      if (hLow.indexOf("contestant") !== -1 || hLow === "name" || hLow === "player" || hLow === "member") {
        nameCol = c;
      } else if (priorPtsCol === -1 && (hLow.indexOf("prior") !== -1 || hLow.indexOf("season") !== -1 || hLow === "pts" || hLow === "total" || hLow === "points")) {
        priorPtsCol = c;
      } else if (tbCol === -1 && (hLow.indexOf("tie") !== -1 || hLow === "tb" || hLow.indexOf("score") !== -1 || hLow.indexOf("tie-brkr") !== -1 || hLow.indexOf("om / tex") !== -1)) {
        tbCol = c;
      } else {
        // Test if header matches a game
        for (var gi = 0; gi < gamesList.length; gi++) {
          var gObj = gamesList[gi];
          if (colToGameId[c] !== undefined) continue;
          if (resolveBotSheetTeam(hCell, gObj)) {
            colToGameId[c] = gObj.id;
            break;
          }
        }
      }
    }
  }

  // If column headers didn't match at least 15 games, fall back to sequential columns 1..numGames
  if (Object.keys(colToGameId).length < 15) {
    for (var gSeq = 1; gSeq <= numGames; gSeq++) {
      colToGameId[gSeq] = gSeq;
    }
  }

  // STEP 2: Process contestant rows
  var seenNames = {};
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    if (!row || row.length < 5) continue;

    var rawName = String(row[nameCol] || row[0] || "").trim();
    if (!rawName || isFakeContestantName(rawName)) continue;
    var lowName = rawName.toLowerCase();
    if (seenNames[lowName]) continue;

    // Reject header-like row numbers (e.g., "1", "2") if next cell is a name
    if (/^\d{1,3}$/.test(rawName) && row[nameCol + 1] && /[a-zA-Z]/.test(row[nameCol + 1])) {
      rawName = String(row[nameCol + 1]).trim();
      lowName = rawName.toLowerCase();
      if (seenNames[lowName] || isFakeContestantName(rawName)) continue;
    }

    var picksMap = {};
    var matchedGames = 0;

    // A. Use mapped columns first
    for (var colIdx in colToGameId) {
      var gid = colToGameId[colIdx];
      var gObj2 = null;
      for (var gg = 0; gg < gamesList.length; gg++) {
        if (gamesList[gg].id === gid) { gObj2 = gamesList[gg]; break; }
      }
      if (gObj2) {
        var cellVal = row[parseInt(colIdx, 10)];
        var picked = resolveBotSheetTeam(cellVal, gObj2);
        if (picked) {
          picksMap[gid] = picked;
          matchedGames++;
        }
      }
    }

    // B. If mapped columns found fewer than 15 picks, scan sequentially (column 1..numGames)
    if (matchedGames < 15) {
      for (var gIdx = 0; gIdx < numGames; gIdx++) {
        var gm = gamesList[gIdx];
        if (picksMap[gm.id]) continue;
        var cellStr = row[gIdx + 1];
        var resolvedTeam = resolveBotSheetTeam(cellStr, gm);
        if (resolvedTeam) {
          picksMap[gm.id] = resolvedTeam;
          matchedGames++;
        }
      }
    }

    // C. If still under threshold, scan all remaining cells in the row against all games
    if (matchedGames < 15) {
      for (var c2 = 0; c2 < row.length; c2++) {
        if (c2 === nameCol || c2 === priorPtsCol || c2 === tbCol) continue;
        var cVal = row[c2];
        if (!cVal || /^\d+\.?\d*$/.test(cVal) || /^\d+-\d+$/.test(cVal)) continue;
        for (var g3 = 0; g3 < gamesList.length; g3++) {
          var gm3 = gamesList[g3];
          if (picksMap[gm3.id]) continue;
          var rTeam = resolveBotSheetTeam(cVal, gm3);
          if (rTeam) {
            picksMap[gm3.id] = rTeam;
            matchedGames++;
            break;
          }
        }
      }
    }

    // Skip formula/zero grid rows (e.g. secondary scoring table with 0s)
    if (matchedGames === 0 || matchedGames < Math.floor(numGames * 0.4)) continue;
    seenNames[lowName] = true;

    var priorPts = 0;
    if (priorPtsCol !== -1 && row[priorPtsCol]) {
      priorPts = parseFloat(row[priorPtsCol]) || 0;
    } else if (row[36] && /^\d+(\.\d+)?$/.test(String(row[36]).trim())) {
      priorPts = parseFloat(row[36]) || 0;
    } else if (row[numGames + 1]) {
      priorPts = parseFloat(row[numGames + 1]) || 0;
    }

    var tbRaw = "";
    if (tbCol !== -1 && row[tbCol]) {
      tbRaw = String(row[tbCol]).trim();
    } else if (row[37] && /^\d{1,2}\s*-\s*\d{1,2}$/.test(String(row[37]).trim())) {
      tbRaw = String(row[37]).trim();
    } else if (row[numGames + 2]) {
      tbRaw = String(row[numGames + 2]).trim();
    }
    // Scan for tiebreaker pattern "XX-YY" if missing
    if (!tbRaw || tbRaw === "—") {
      for (var tc = 0; tc < row.length; tc++) {
        if (/^\d{1,2}\s*-\s*\d{1,2}$/.test(String(row[tc] || "").trim())) {
          tbRaw = String(row[tc]).trim();
          break;
        }
      }
    }

    var stdName = standardizeBotParticipantName(rawName);

    poolMembers.push({
      name: stdName,
      priorPts: priorPts,
      tiebreaker: tbRaw || "—",
      picks: picksMap,
      livePts: 0,
      inProgressPts: 0,
      finalPts: 0
    });
  }

  if (poolMembers.length === 0) return null;

  // Build sorted leaderboard from priorPts
  var sorted = poolMembers.slice().sort(function(a, b) {
    if (b.priorPts !== a.priorPts) return b.priorPts - a.priorPts;
    return a.name.localeCompare(b.name);
  });

  var leaderboard = [];
  var prevPts = null, prevRank = 1;
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    var rkStr = "";
    if (p.priorPts === prevPts) {
      rkStr = "T-" + prevRank;
    } else {
      var hasTie = (i + 1 < sorted.length && sorted[i + 1].priorPts === p.priorPts);
      prevRank = i + 1;
      prevPts = p.priorPts;
      rkStr = hasTie ? ("T-" + prevRank) : String(prevRank);
    }
    leaderboard.push({
      rank: rkStr,
      name: p.name,
      priorPts: p.priorPts,
      note: p.name === "Michael A" ? "Active Profile (You)" : (p.name === "Kinyon C" ? "Active Profile (H2H)" : "Pool Member")
    });
  }

  var michaelObj = (currentCloud && currentCloud.michael) ? currentCloud.michael : { picks: {}, tiebreaker: "28-24", target: 20 };
  var kinyionObj = (currentCloud && currentCloud.kinyion) ? currentCloud.kinyion : { picks: {}, tiebreaker: "31-24", target: 20 };

  for (var j = 0; j < poolMembers.length; j++) {
    if (poolMembers[j].name === "Michael A") {
      if (Object.keys(poolMembers[j].picks).length > 0) {
        michaelObj.picks = poolMembers[j].picks;
      } else if (michaelObj.picks && Object.keys(michaelObj.picks).length > 0) {
        // Restore Michael A's picks from cloud if sheet had empty picks!
        poolMembers[j].picks = michaelObj.picks;
      }
      if (poolMembers[j].tiebreaker && poolMembers[j].tiebreaker !== "—") michaelObj.tiebreaker = poolMembers[j].tiebreaker;
    } else if (poolMembers[j].name === "Kinyon C") {
      if (Object.keys(poolMembers[j].picks).length > 0) {
        kinyionObj.picks = poolMembers[j].picks;
      } else if (kinyionObj.picks && Object.keys(kinyionObj.picks).length > 0) {
        poolMembers[j].picks = kinyionObj.picks;
      }
      if (poolMembers[j].tiebreaker && poolMembers[j].tiebreaker !== "—") kinyionObj.tiebreaker = poolMembers[j].tiebreaker;
    }
  }

  // Auto-populate Watchlist with Top 3 Pool Leaders (excluding Michael & Kinyon)
  var topRivals = [];
  for (var k = 0; k < sorted.length && topRivals.length < 3; k++) {
    if (sorted[k].name !== "Michael A" && sorted[k].name !== "Kinyon C") {
      topRivals.push({
        id: "w" + (topRivals.length + 1),
        name: sorted[k].name,
        rank: leaderboard[k].rank,
        priorPts: sorted[k].priorPts,
        picks: sorted[k].picks
      });
    }
  }

  return {
    poolMembers: poolMembers,
    leaderboard: leaderboard,
    michael: michaelObj,
    kinyion: kinyionObj,
    watchlist: topRivals
  };
}

// ============================================================================
// HELPER 1: Extract Google Form URL from Email or Linked WordPress Post
// ============================================================================
function extractGoogleFormUrl(htmlBody, plainBody) {
  var combined = htmlBody + "\n" + plainBody;
  var directForm = combined.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[^"'\s<>]+/i);
  if (directForm) return directForm[0].replace(/&amp;/g, "&");

  var wpMatch = combined.match(/https:\/\/[a-z0-9.-]*separatedatturf[a-z0-9.-]*\/[^"'\s<>]+/i);
  if (wpMatch) {
    try {
      var wpHtml = UrlFetchApp.fetch(wpMatch[0], { muteHttpExceptions: true }).getContentText();
      var embedded = wpHtml.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[^"'\s<>]+/i);
      if (embedded) return embedded[0].replace(/&amp;/g, "&");
    } catch (e) {}
  }
  return null;
}

// ============================================================================
// HELPER 2: Scrape 26 Games & Spreads from Google Form `FB_PUBLIC_LOAD_DATA_`
// ============================================================================
function scrapeGoogleFormGames(formUrl) {
  try {
    var cleanUrl = formUrl.replace(/\/viewResponse.*$/i, "/viewform");
    var html = UrlFetchApp.fetch(cleanUrl, { muteHttpExceptions: true }).getContentText();
    var match = html.match(/var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[\s*null[\s\S]*?\]);\s*<\/script>/);
    if (!match || !match[1]) return [];

    var data = JSON.parse(match[1]);
    var questions = (data[1] && data[1][1]) ? data[1][1] : [];
    var rawLines = [];

    for (var i = 0; i < questions.length; i++) {
      var qTitle = questions[i][1] ? String(questions[i][1]).trim() : "";
      if (qTitle) {
        var parts = qTitle.split(/\r?\n/);
        for (var p = 0; p < parts.length; p++) {
          if (parts[p].trim()) rawLines.push(parts[p].trim());
        }
      }
    }
    return buildGamesArrayFromLines(rawLines);
  } catch (e) {
    Logger.log("Form scrape error: " + e.message);
    return [];
  }
}

function buildGamesArrayFromLines(lines) {
  var parsedGames = [];
  for (var i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1].toLowerCase().indexOf("at ") === 0) {
      var awayLine = lines[i];
      var homeLine = lines[i + 1].substring(3).trim();
      var candKick = lines[i + 2] || "";
      var nextAfterCand = lines[i + 3] || "";
      var isCandTeam = (nextAfterCand.toLowerCase().indexOf("at ") === 0) || /\(\s*-\d/.test(candKick) || /\b\d{1,2}-\d{1,2}\b/.test(candKick);
      var kickLine = (!candKick || isCandTeam) ? "Saturday CST" : candKick;

      var spAway = awayLine.match(/\(\s*-(\d+\.?\d*)/);
      var spHome = homeLine.match(/\(\s*-(\d+\.?\d*)/);
      var favIsAway = !!spAway;
      var spread = spAway ? parseFloat(spAway[1]) : (spHome ? parseFloat(spHome[1]) : 3.5);

      var awayRecMatch = awayLine.match(/(?:#\d+\s*)?\d+-\d+/);
      var homeRecMatch = homeLine.match(/(?:#\d+\s*)?\d+-\d+/);

      var away = awayLine.replace(/#\d+/g, "").replace(/\d+-\d+/g, "").replace(/\([^)]*\)/g, "").replace(/\$|\=/g, "").trim();
      var home = homeLine.replace(/#\d+/g, "").replace(/\d+-\d+/g, "").replace(/\([^)]*\)/g, "").replace(/\$|\=/g, "").trim();
      if (!away || !home) continue;

      var dogPts = spread >= 14.5 ? 3 : (spread >= 7.5 ? 2 : 1);
      var favProb = Math.min(0.92, 0.50 + spread * 0.0235);
      var dogProb = +(1 - favProb).toFixed(2);
      var awayProb = favIsAway ? +favProb.toFixed(2) : dogProb;
      var homeProb = favIsAway ? dogProb : +favProb.toFixed(2);
      var awayPts = favIsAway ? 1 : dogPts;
      var homePts = favIsAway ? dogPts : 1;
      var rec = favIsAway ? away : home;

      var cstWin = "11:00 AM CST Window";
      if (kickLine.indexOf("2:30") !== -1 || kickLine.indexOf("3:00") !== -1) cstWin = "2:30 PM CST Window";
      else if (kickLine.indexOf("6:00") !== -1 || kickLine.indexOf("6:30") !== -1) cstWin = "6:00 PM / 6:30 PM CST Primetime";
      else if (kickLine.indexOf("9:") !== -1 || kickLine.indexOf("10:") !== -1) cstWin = "9:15 PM+ CST Late Night Window";

      parsedGames.push({
        id: parsedGames.length + 1,
        cstWindow: cstWin,
        away: away, awayCode: away.replace(/State$/i, "St").slice(0, 7), awayRec: awayRecMatch ? awayRecMatch[0] : "",
        home: home, homeCode: home.replace(/State$/i, "St").slice(0, 7), homeRec: homeRecMatch ? homeRecMatch[0] : "",
        kick: kickLine,
        poolLine: (favIsAway ? away : home) + " -" + spread,
        liveLine: (favIsAway ? away : home) + " -" + spread,
        awayPts: awayPts, homePts: homePts,
        awayProb: awayProb, homeProb: homeProb,
        rec: rec, grokPick: rec, kinyionDefault: rec,
        tier: dogPts === 2 && dogProb >= 0.28 ? "Multiplier Upside Play" : "Lean",
        sway: null,
        rationale: "Auto-Scraped by Gmail Bot (Row #" + (parsedGames.length + 1) + ")",
        insights: {
          vegas: "Pool Spread: " + (favIsAway ? away : home) + " -" + spread + " | Win Prob: " + away + " " + Math.round(awayProb * 100) + "% vs " + home + " " + Math.round(homeProb * 100) + "%",
          stats: away + " vs " + home + " live statistical profile.",
          matchup: "Positional matchup favoring " + rec + ".",
          splits: kickLine
        },
        awayInj: [{ p: away + " Active Roster", pos: "TEAM", st: "FULL", note: "Synced via ESPN" }],
        homeInj: [{ p: home + " Active Roster", pos: "TEAM", st: "FULL", note: "Synced via ESPN" }]
      });
    }
  }
  return parsedGames;
}

// ============================================================================
// HELPER 3: Parse Confirmation Email Picks & Route to Michael/Kinyon/Watchlist
// ============================================================================
// normalizeBotKey defined above with BOT_TEAM_ALIASES

function parsePicksFromEmailText(plainBody, gamesList) {
  var lines = String(plainBody || "").split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  var picks = {};
  var matchedCount = 0;
  var usedLineIdx = {};

  for (var i = 0; i < gamesList.length; i++) {
    var g = gamesList[i];
    var aKey = normalizeBotKey(g.away);
    var hKey = normalizeBotKey(g.home);
    var aCode = normalizeBotKey(g.awayCode);
    var hCode = normalizeBotKey(g.homeCode);

    for (var j = 0; j < lines.length; j++) {
      if (usedLineIdx[j]) continue;
      var rawLine = lines[j];
      var numPrefix = rawLine.match(/^#?(\d{1,2})[.):\s-]+(.+)$/);
      if (numPrefix && parseInt(numPrefix[1], 10) !== Number(g.id)) continue;
      var cleanCandidate = numPrefix ? numPrefix[2] : rawLine;
      var lNorm = normalizeBotKey(cleanCandidate.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, ""));
      if (!lNorm) continue;
      var hasAway = (lNorm === aKey || lNorm === aCode || isSafeBotTeamSubstrMatch(lNorm, aKey));
      var hasHome = (lNorm === hKey || lNorm === hCode || isSafeBotTeamSubstrMatch(lNorm, hKey));
      if (hasAway && !hasHome) {
        picks[g.id] = g.away;
        usedLineIdx[j] = true;
        matchedCount++;
        break;
      } else if (hasHome && !hasAway) {
        picks[g.id] = g.home;
        usedLineIdx[j] = true;
        matchedCount++;
        break;
      }
    }
  }

  var tbMatch = plainBody.match(/\b(\d{2}\s*-\s*\d{2})\b/);
  return {
    picks: picks,
    tiebreaker: tbMatch ? tbMatch[1].replace(/\s+/g, "") : null,
    matchedCount: matchedCount
  };
}

function detectProfileOwner(subject, body, sender, currentCloud) {
  var hay = (subject + " " + body.slice(0, 1000) + " " + sender).toLowerCase();
  var senderLow = String(sender || "").toLowerCase();

  // Strict check for Michael Adams / Michael A (NEVER generic "michael", do not match Michael D or Michael W!)
  if (hay.match(/\bmichael\s*a\b/i) || hay.match(/\bmichael\s*adams\b/i) || senderLow.indexOf("michael4ts14@gmail.com") !== -1) {
    if (!hay.match(/\bmichael\s*d\b/i) && !hay.match(/\bmichael\s*w\b/i)) {
      return "michael";
    }
  }
  // Check for Kinyon Cooper / Kinyon C
  if (hay.match(/\bkinyon\s*c\b/i) || hay.match(/\bkinyion\s*c\b/i) || hay.match(/\bkinyon\s*cooper\b/i) || hay.match(/\bkenyon\s*cooper\b/i)) {
    return "kinyion";
  }
  if (hay.indexOf("watchlist 1") !== -1 || hay.indexOf("pool leader") !== -1) return "w0";
  if (hay.indexOf("watchlist 2") !== -1 || hay.indexOf("rival 2") !== -1) return "w1";
  if (hay.indexOf("watchlist 3") !== -1 || hay.indexOf("rival 3") !== -1) return "w2";

  // Match against current pool members & accounts
  if (currentCloud && Array.isArray(currentCloud.poolMembers)) {
    for (var p = 0; p < currentCloud.poolMembers.length; p++) {
      var pm = currentCloud.poolMembers[p];
      if (!pm || !pm.name) continue;
      var stdPName = standardizeBotParticipantName(pm.name).toLowerCase();
      var authEm = String(pm.linkedAuthEmail || "").toLowerCase();
      if ((authEm && senderLow.indexOf(authEm) !== -1) || hay.indexOf(stdPName) !== -1) {
        return "pm:" + pm.name;
      }
    }
  }

  // Match against playerEmailsMap in commissionerConfig
  var emMap = (currentCloud && currentCloud.commissionerConfig && currentCloud.commissionerConfig.playerEmailsMap) || {};
  for (var nameKey in emMap) {
    var regEmail = String(emMap[nameKey] || "").toLowerCase();
    if (regEmail && senderLow.indexOf(regEmail) !== -1) {
      return "pm:" + nameKey;
    }
  }

  // NEVER default unknown emails to "michael" — return null to prevent overwriting Michael A's picks!
  return null;
}

function savePicksToTargetProfile(target, pickResult, currentCloud) {
  if (!target) return;
  var curWk = (currentCloud && currentCloud.currentWeek) || 8;
  var nowIso = new Date().toISOString();

  if (target === "michael" || target === "kinyion" || target.indexOf("u_") === 0) {
    var existing = (currentCloud && currentCloud[target]) ? currentCloud[target] : { picks: {}, tiebreaker: "28-24", target: 20 };
    existing.picks = pickResult.picks;
    if (pickResult.tiebreaker) existing.tiebreaker = pickResult.tiebreaker;
    existing.manualEditsWeek = curWk;
    existing.updatedAt = nowIso;
    patchFirebaseNode("/" + target, existing);
    patchFirestoreUserDoc(target, {
      profileKey: target,
      picks: existing.picks,
      tiebreaker: existing.tiebreaker || "28-24",
      manualEditsWeek: curWk,
      updatedAt: nowIso
    });
  } else if (target.indexOf("pm:") === 0) {
    var mName = target.slice(3);
    var pms = (currentCloud && Array.isArray(currentCloud.poolMembers)) ? currentCloud.poolMembers : [];
    for (var m = 0; m < pms.length; m++) {
      if (standardizeBotParticipantName(pms[m].name).toLowerCase() === standardizeBotParticipantName(mName).toLowerCase()) {
        pms[m].picks = pickResult.picks;
        if (pickResult.tiebreaker) pms[m].tiebreaker = pickResult.tiebreaker;
        pms[m].awaitingSheet = false;
        patchFirebaseNode("", { poolMembers: pms });
        break;
      }
    }
  } else if (target.indexOf("w") === 0) {
    var wIdx = parseInt(target.slice(1), 10);
    var wl = (currentCloud && currentCloud.watchlist) ? currentCloud.watchlist : [];
    if (wl[wIdx]) {
      wl[wIdx].picks = pickResult.picks;
      patchFirebaseNode("", { watchlist: wl });
    }
  }
}

// ============================================================================
// HELPER 4: Parse Weekly Standings / Leaderboard Rows (Supports Tied Blocks!)
// ============================================================================
function parseStandingsFromText(plainBody, htmlBody) {
  var text = String(plainBody || "");
  var overallIdx = text.toLowerCase().indexOf("overall standings");
  var sliceText = overallIdx !== -1 ? text.slice(overallIdx) : text;
  var lines = sliceText.split(/\r?\n/).map(function(l) { return l.replace(/\*/g, "").trim(); }).filter(Boolean);
  var rows = [];
  var currentRank = "1";

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^(overall standings|week\s*\d+|congratulations|we have a brand|trying to stay)/i.test(line)) {
      if (rows.length >= 15 && /^we have a brand|trying to stay/i.test(line)) break;
      continue;
    }
    var mRanked = line.match(/^(T?-?\d+)[.)\s\t-]+([A-Za-z0-9_ .,']+?)[\s\t:-]+(\d{1,3})(?:\s*pts|\s*points)?$/i);
    if (mRanked) {
      currentRank = mRanked[1].trim();
      rows.push({
        rank: currentRank,
        name: standardizeBotParticipantName(mRanked[2].trim()),
        priorPts: parseInt(mRanked[3], 10),
        note: "Auto-Synced via Gmail Bot"
      });
      continue;
    }
    if (rows.length > 0 && rows.length < 150) {
      var mTied = line.match(/^([A-Za-z][A-Za-z0-9_ .,']+?)[\s\t:-]+(\d{1,3})(?:\s*pts|\s*points)?$/i);
      if (mTied && !/^(week|game|saturday|sunday|friday|thursday)\b/i.test(mTied[1].trim())) {
        var prevRow = rows[rows.length - 1];
        var ptsVal = parseInt(mTied[2], 10);
        if (ptsVal <= prevRow.priorPts && ptsVal >= 0) {
          var tieRank = (ptsVal === prevRow.priorPts)
            ? (currentRank.indexOf("T-") === 0 ? currentRank : ("T-" + currentRank))
            : String(rows.length + 1);
          if (ptsVal === prevRow.priorPts) prevRow.rank = tieRank;
          else currentRank = tieRank;
          rows.push({
            rank: tieRank,
            name: standardizeBotParticipantName(mTied[1].trim()),
            priorPts: ptsVal,
            note: "Auto-Synced via Gmail Bot"
          });
        }
      }
    }
  }
  return rows;
}

function getDefaultWeek7GamesFallback() {
  return [
    { id: 1, away: "Ohio State", awayCode: "OhioSt", home: "Indiana", homeCode: "Indiana" },
    { id: 2, away: "Florida", awayCode: "Florida", home: "Texas", homeCode: "Texas" },
    { id: 3, away: "Mississippi State", awayCode: "MissSt", home: "LSU", homeCode: "LSU" },
    { id: 4, away: "Virginia", awayCode: "Virginia", home: "SMU", homeCode: "SMU" },
    { id: 5, away: "Northwestern", awayCode: "Nwest", home: "Michigan State", homeCode: "MichSt" },
    { id: 6, away: "Cincinnati", awayCode: "Cincy", home: "West Virginia", homeCode: "WVu" },
    { id: 7, away: "Kansas", awayCode: "Kansas", home: "Kansas State", homeCode: "KState" },
    { id: 8, away: "Pittsburgh", awayCode: "Pitt", home: "Boston College", homeCode: "BC" },
    { id: 9, away: "Alabama", awayCode: "Bama", home: "Tennessee", homeCode: "Tenn" },
    { id: 10, away: "Missouri", awayCode: "Mizzou", home: "Ole Miss", homeCode: "OleMiss" },
    { id: 11, away: "Auburn", awayCode: "Auburn", home: "Georgia", homeCode: "Georgia" },
    { id: 12, away: "Arizona State", awayCode: "ArizSt", home: "Texas Tech", homeCode: "TTech" },
    { id: 13, away: "Georgia Tech", awayCode: "GaTech", home: "Virginia Tech", homeCode: "VaTech" },
    { id: 14, away: "North Carolina", awayCode: "UNC", home: "Duke", homeCode: "Duke" },
    { id: 15, away: "Penn State", awayCode: "PennSt", home: "Michigan", homeCode: "Mich" },
    { id: 16, away: "Florida State", awayCode: "FSU", home: "Miami (FL)", homeCode: "Miami" },
    { id: 17, away: "Arkansas", awayCode: "Ark", home: "Vanderbilt", homeCode: "Vandy" },
    { id: 18, away: "TCU", awayCode: "TCU", home: "Baylor", homeCode: "Baylor" },
    { id: 19, away: "Notre Dame", awayCode: "ND", home: "BYU", homeCode: "BYU" },
    { id: 20, away: "Oklahoma State", awayCode: "OklaSt", home: "Houston", homeCode: "Hou" },
    { id: 21, away: "Wisconsin", awayCode: "Wisc", home: "UCLA", homeCode: "UCLA" },
    { id: 22, away: "Kentucky", awayCode: "Kent", home: "Oklahoma", homeCode: "Okla" },
    { id: 23, away: "Louisville", awayCode: "Lville", home: "Syracuse", homeCode: "Syr" },
    { id: 24, away: "Utah", awayCode: "Utah", home: "Colorado", homeCode: "Colo" },
    { id: 25, away: "Wake Forest", awayCode: "Wake", home: "California", homeCode: "Cal" },
    { id: 26, away: "Nebraska", awayCode: "Neb", home: "Oregon", homeCode: "Oregon" }
  ];
}

// ============================================================================
// CLOUD FIRESTORE REST API BRIDGE (100% Cloud Firestore — No RTDB Needed!)
// ============================================================================
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (!isFinite(val)) return { integerValue: "0" };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    var fields = {};
    for (var k in val) {
      if (Object.prototype.hasOwnProperty.call(val, k) && val[k] !== undefined) {
        fields[k] = toFirestoreValue(val[k]);
      }
    }
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(fVal) {
  if (!fVal || typeof fVal !== "object") return null;
  if ("nullValue" in fVal) return null;
  if ("booleanValue" in fVal) return Boolean(fVal.booleanValue);
  if ("integerValue" in fVal) return parseInt(fVal.integerValue, 10);
  if ("doubleValue" in fVal) return parseFloat(fVal.doubleValue);
  if ("stringValue" in fVal) return String(fVal.stringValue);
  if ("timestampValue" in fVal) return String(fVal.timestampValue);
  if ("arrayValue" in fVal) {
    var arr = (fVal.arrayValue && fVal.arrayValue.values) ? fVal.arrayValue.values : [];
    return arr.map(fromFirestoreValue);
  }
  if ("mapValue" in fVal) {
    var obj = {};
    var fields = (fVal.mapValue && fVal.mapValue.fields) ? fVal.mapValue.fields : {};
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        obj[k] = fromFirestoreValue(fields[k]);
      }
    }
    return obj;
  }
  return null;
}

function fetchFirebaseNode(subPath) {
  try {
    var res = UrlFetchApp.fetch(FIRESTORE_DOC_URL, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());
    if (!json || !json.fields) return {};
    var fullDoc = fromFirestoreValue({ mapValue: { fields: json.fields } }) || {};
    if (subPath && subPath.charAt(0) === "/") {
      var key = subPath.slice(1);
      return fullDoc[key] || null;
    }
    return fullDoc;
  } catch (e) {
    Logger.log("Firestore fetch error: " + e.message);
    return null;
  }
}

function patchFirebaseNode(subPath, dataObj) {
  var payloadObj = dataObj;
  if (subPath && subPath.charAt(0) === "/") {
    var key = subPath.slice(1);
    payloadObj = {};
    payloadObj[key] = dataObj;
  }
  var topKeys = Object.keys(payloadObj || {});
  if (topKeys.length === 0) return;
  var maskParams = topKeys.map(function(k) {
    return "updateMask.fieldPaths=" + encodeURIComponent(k);
  }).join("&");
  var fsDoc = toFirestoreValue(payloadObj).mapValue;
  UrlFetchApp.fetch(FIRESTORE_DOC_URL + "?" + maskParams, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(fsDoc),
    muteHttpExceptions: true
  });
}

function patchFirestoreUserDoc(profKey, userObj) {
  if (!profKey || !userObj) return;
  var keys = Object.keys(userObj);
  if (!keys.length) return;
  var mask = keys.map(function(k) { return "updateMask.fieldPaths=" + encodeURIComponent(k); }).join("&");
  var fsDoc = toFirestoreValue(userObj).mapValue;
  UrlFetchApp.fetch(FIRESTORE_USERS_URL + "/" + encodeURIComponent(profKey) + "?" + mask, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(fsDoc),
    muteHttpExceptions: true
  });
}

function resetProcessedEmailHistory() {
  PropertiesService.getUserProperties().deleteProperty("PROCESSED_MSG_IDS");
  PropertiesService.getScriptProperties().deleteProperty("LAST_LIVE_STATE_HASH");
  Logger.log("Cleared processed email & live state cache!");
}

// ============================================================================
// SERVER-SIDE ESPN LIVE SCORE & PLAY-BY-PLAY TRACKER (`live_games/week_state`)
// Tracks live scores, quarter/clock, team possession, yardLine (0..100),
// down & distance, red-zone status, and real-time play-by-play drive timelines
// on the same timing as ESPN so the client SVG field graphics glide in real time!
// ============================================================================
var BOT_TEAM_ALIASES = {
  "miamifl": "miami", "miamiflorida": "miami", "theu": "miami",
  "miamiohio": "miamioh", "miamiofohio": "miamioh",
  "mississippi": "olemiss", "pitt": "pittsburgh",
  "northcarolinastate": "ncstate", "unc": "northcarolina",
  "southerncalifornia": "usc", "southerncal": "usc",
  "centralflorida": "ucf", "connecticut": "uconn", "massachusetts": "umass",
  "brighamyoung": "byu", "louisianastate": "lsu", "texaschristian": "tcu",
  "southernmethodist": "smu", "floridainternational": "fiu", "floridaatlantic": "fau",
  "texassanantonio": "utsa", "texaselpaso": "utep", "nevadalasvegas": "unlv",
  "alabamabirmingham": "uab", "louisianamonroe": "ulmonroe", "ulm": "ulmonroe",
  "louisianalafayette": "louisiana", "ullafayette": "louisiana",
  "appalachianstate": "appstate", "jacksonvillestate": "jaxstate",
  "middletennesseestate": "middletennessee", "mtsu": "middletennessee",
  "westernkentucky": "westernkentucky", "wku": "westernkentucky",
  "georgiasouthern": "georgiasouthern", "gasouthern": "georgiasouthern",
  "samhoustonstate": "samhouston", "texasam": "texasam", "tamu": "texasam",
  "vandy": "vanderbilt", "cal": "california", "calberkeley": "california",
  "bama": "alabama", "uga": "georgia", "ecu": "eastcarolina", "niu": "northernillinois"
};

function normalizeBotTeamKey(str) {
  var s = String(str || "").toLowerCase()
    .replace(/#\d+\s*/g, "")
    .replace(/&/g, "")
    .replace(/\buniv(ersity)?( of)?\b/g, "")
    .replace(/\bst\.?(?=\s|\)|$)/g, "state")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return BOT_TEAM_ALIASES[s] || s;
}

function getBotCompetitorKeys(espnComp) {
  var t = (espnComp && espnComp.team) || {};
  var raw = [t.location, t.shortDisplayName, t.displayName, t.nickname];
  var keys = [];
  for (var i = 0; i < raw.length; i++) {
    var k = normalizeBotTeamKey(raw[i]);
    if (k && keys.indexOf(k) === -1) keys.push(k);
  }
  return keys;
}

function botTeamMatchScore(sheetTeamName, espnComp) {
  if (!espnComp || !espnComp.team) return 0;
  var target = normalizeBotTeamKey(sheetTeamName);
  if (!target) return 0;
  if (getBotCompetitorKeys(espnComp).indexOf(target) !== -1) return 2;
  var abbr = normalizeBotTeamKey(espnComp.team.abbreviation);
  if (abbr && target.length <= 5 && target === abbr) return 1;
  return 0;
}

function scoreBotGameAgainstEvent(g, awayComp, homeComp) {
  var aa = botTeamMatchScore(g.away, awayComp);
  var hh = botTeamMatchScore(g.home, homeComp);
  var ah = botTeamMatchScore(g.away, homeComp);
  var ha = botTeamMatchScore(g.home, awayComp);
  if (aa && hh) return { score: 10 + aa + hh, flipped: false };
  if (ah && ha) return { score: 8 + ah + ha, flipped: true };
  return { score: 0, flipped: false };
}

function parseBotSpotTextToYl100(spotText, g, awayAbbr, homeAbbr, possSide, yardsToEndzone) {
  var txt = String(spotText || "").trim();
  if (txt) {
    if (txt === "50" || /50\s*(?:yd|yard)?/i.test(txt)) return 50;
    var m = txt.match(/^([A-Za-z&.' -]+?)\s+(\d{1,2})$/);
    if (m) {
      var prefixNorm = normalizeBotTeamKey(m[1].trim());
      var yd = parseInt(m[2], 10);
      if (!isNaN(yd) && yd >= 0 && yd <= 50) {
        var aNorm = normalizeBotTeamKey(g.away);
        var hNorm = normalizeBotTeamKey(g.home);
        var aCode = normalizeBotTeamKey(awayAbbr || g.awayCode);
        var hCode = normalizeBotTeamKey(homeAbbr || g.homeCode);
        if (prefixNorm === aNorm || prefixNorm === aCode) return Math.max(0, Math.min(100, yd));
        if (prefixNorm === hNorm || prefixNorm === hCode) return Math.max(0, Math.min(100, 100 - yd));
      }
    }
  }
  if (typeof yardsToEndzone === "number" && !isNaN(yardsToEndzone) && yardsToEndzone >= 0 && yardsToEndzone <= 100) {
    if (possSide === "away") return Math.max(0, Math.min(100, 100 - yardsToEndzone));
    if (possSide === "home") return Math.max(0, Math.min(100, yardsToEndzone));
  }
  return null;
}

function formatBotYl100ToSpot(yl100, g) {
  var y = Math.round(Math.max(0, Math.min(100, yl100)));
  if (y === 50) return "50";
  var aCode = (g.awayCode || g.away || "AWAY").toUpperCase();
  var hCode = (g.homeCode || g.home || "HOME").toUpperCase();
  if (y <= 0) return aCode + " Endzone";
  if (y >= 100) return hCode + " Endzone";
  if (y < 50) return aCode + " " + y;
  return hCode + " " + (100 - y);
}

function parseBotSingleDrive(drv, g, awayTeamId, homeTeamId, awayAbbr, homeAbbr, driveIdx) {
  if (!drv || !g) return null;
  var playsArr = Array.isArray(drv.plays) ? drv.plays : [];
  var firstPlay = playsArr.length > 0 ? playsArr[0] : null;
  var realLastPlay = null;
  for (var i = playsArr.length - 1; i >= 0; i--) {
    var cand = playsArr[i];
    var pType = (cand && cand.type && cand.type.text) || "";
    var pTxt = (cand && (cand.text || cand.shortText)) || "";
    if (pType !== "End Period" && pType !== "End of Game" && !/^End of/i.test(pTxt)) {
      realLastPlay = cand;
      break;
    }
  }
  if (!realLastPlay && playsArr.length > 0) realLastPlay = playsArr[playsArr.length - 1];

  var possSide = null;
  if (drv.team) {
    var dTid = drv.team.id ? String(drv.team.id) : "";
    if (dTid && awayTeamId && dTid === String(awayTeamId)) possSide = "away";
    else if (dTid && homeTeamId && dTid === String(homeTeamId)) possSide = "home";
    if (!possSide) {
      var dNorm = normalizeBotTeamKey(drv.team.abbreviation || drv.team.location || drv.team.displayName);
      if (dNorm === normalizeBotTeamKey(g.away) || dNorm === normalizeBotTeamKey(awayAbbr)) possSide = "away";
      else if (dNorm === normalizeBotTeamKey(g.home) || dNorm === normalizeBotTeamKey(homeAbbr)) possSide = "home";
    }
  }
  if (!possSide) possSide = "away";

  var drvResult = String(drv.displayResult || drv.result || "").trim();
  var lastPlayTxt = realLastPlay ? String(realLastPlay.text || realLastPlay.shortText || "") : "";
  var isTdDrive = /^td|touchdown/i.test(drvResult) || (realLastPlay && realLastPlay.scoringPlay && /touchdown/i.test(lastPlayTxt));
  var isFgDrive = /^fg|field goal/i.test(drvResult) || (realLastPlay && realLastPlay.scoringPlay && /field goal good/i.test(lastPlayTxt));
  var isScoringDrive = !!drv.isScore || isTdDrive || isFgDrive || (realLastPlay && realLastPlay.scoringPlay === true);

  var startSpotRaw = (drv.start && drv.start.text) || (firstPlay && firstPlay.start && firstPlay.start.possessionText) || "";
  var startYte = (firstPlay && firstPlay.start && typeof firstPlay.start.yardsToEndzone === "number") ? firstPlay.start.yardsToEndzone : null;
  var startYl100 = parseBotSpotTextToYl100(startSpotRaw, g, awayAbbr, homeAbbr, possSide, startYte);
  if (startYl100 === null) startYl100 = (possSide === "away") ? 25 : 75;

  var endSpotRaw = "";
  var endYl100 = null;
  if (isTdDrive) {
    endYl100 = (possSide === "away") ? 100 : 0;
    endSpotRaw = (possSide === "away" ? (g.homeCode || g.home) : (g.awayCode || g.away)).toUpperCase() + " Endzone (TD)";
  }
  if (endYl100 === null && realLastPlay && realLastPlay.end && realLastPlay.end.possessionText) {
    endSpotRaw = realLastPlay.end.possessionText;
    endYl100 = parseBotSpotTextToYl100(endSpotRaw, g, awayAbbr, homeAbbr, possSide, realLastPlay.end.yardsToEndzone);
  }
  if (endYl100 === null && drv.end && drv.end.text && drv.end.text !== "0") {
    endSpotRaw = drv.end.text;
    endYl100 = parseBotSpotTextToYl100(endSpotRaw, g, awayAbbr, homeAbbr, possSide, null);
  }
  if (endYl100 === null) {
    var netYds = typeof drv.yards === "number" ? drv.yards : 0;
    endYl100 = Math.max(2, Math.min(98, possSide === "away" ? (startYl100 + netYds) : (startYl100 - netYds)));
    endSpotRaw = formatBotYl100ToSpot(endYl100, g);
  }

  var prevYl100 = endYl100;
  if (realLastPlay && realLastPlay.start && (realLastPlay.start.possessionText || typeof realLastPlay.start.yardsToEndzone === "number")) {
    var parsedStartSnap = parseBotSpotTextToYl100(realLastPlay.start.possessionText || "", g, awayAbbr, homeAbbr, possSide, realLastPlay.start.yardsToEndzone);
    if (parsedStartSnap !== null) prevYl100 = parsedStartSnap;
  } else if (realLastPlay && typeof realLastPlay.statYardage === "number") {
    prevYl100 = Math.max(0, Math.min(100, possSide === "away" ? (endYl100 - realLastPlay.statYardage) : (endYl100 + realLastPlay.statYardage)));
  }

  var lastDownDist = "";
  var distYards = 10;
  if (realLastPlay && realLastPlay.end && realLastPlay.end.downDistanceText && !drvResult) {
    lastDownDist = realLastPlay.end.downDistanceText;
    if (typeof realLastPlay.end.distance === "number" && realLastPlay.end.distance > 0) distYards = realLastPlay.end.distance;
  } else if (realLastPlay && realLastPlay.start && realLastPlay.start.downDistanceText) {
    lastDownDist = realLastPlay.start.downDistanceText;
    if (typeof realLastPlay.start.distance === "number" && realLastPlay.start.distance > 0) distYards = realLastPlay.start.distance;
  }

  var clockStr = "";
  if (realLastPlay && realLastPlay.period && realLastPlay.period.number) {
    var pNum = realLastPlay.period.number;
    var qtrStr = pNum > 4 ? ("OT" + (pNum - 4)) : ("Q" + pNum);
    var clk = (realLastPlay.clock && realLastPlay.clock.displayValue) ? realLastPlay.clock.displayValue : "";
    clockStr = qtrStr + (clk ? " " + clk : "");
  }

  var recentPlays = playsArr.slice(-5).reverse().map(function(p) {
    var txt = p.text || p.shortText || "Play recorded";
    var pClock = "";
    if (p.period && p.period.number) {
      pClock = (p.period.number > 4 ? "OT" : ("Q" + p.period.number)) + ((p.clock && p.clock.displayValue) ? " " + p.clock.displayValue : "");
    }
    var ddHdr = (p.start && p.start.downDistanceText)
      ? (p.start.downDistanceText + (p.start.possessionText ? " at " + p.start.possessionText : ""))
      : (p.end && p.end.possessionText ? ("At " + p.end.possessionText) : "");
    var statYds = typeof p.statYardage === "number" ? p.statYardage : null;
    var isScore = p.scoringPlay === true || /touchdown|field goal good|safety/i.test(txt);
    var isTurnover = /intercept|fumble/i.test(txt) && /recovered by|intercepted by|turnover/i.test(txt);
    return {
      clock: pClock,
      header: ddHdr ? (ddHdr + ": ") : "",
      text: txt,
      statYardage: statYds,
      isScore: isScore,
      isTurnover: isTurnover
    };
  });

  return {
    driveIndex: driveIdx,
    possessionSide: possSide,
    teamName: possSide === "away" ? g.away : g.home,
    teamCode: possSide === "away" ? (g.awayCode || awayAbbr) : (g.homeCode || homeAbbr),
    startSpotText: startSpotRaw || formatBotYl100ToSpot(startYl100, g),
    startYl100: startYl100,
    prevYl100: prevYl100,
    endSpotText: endSpotRaw || formatBotYl100ToSpot(endYl100, g),
    yl100: endYl100,
    downDistanceText: lastDownDist,
    distYards: distYards,
    clockStr: clockStr,
    result: drvResult || (isScoringDrive ? "Scoring Drive" : "Drive Active"),
    isScoringDrive: isScoringDrive,
    isTdDrive: isTdDrive,
    isRedZone: (possSide === "away" && endYl100 >= 80) || (possSide === "home" && endYl100 <= 20),
    playsCount: (drv.offensivePlays !== undefined ? drv.offensivePlays : playsArr.length) || 0,
    yards: drv.yards !== undefined ? drv.yards : 0,
    timeElapsed: (drv.timeElapsed && drv.timeElapsed.displayValue) ? drv.timeElapsed.displayValue : "0:00",
    description: drv.description || ((playsArr.length || 0) + " plays, " + (drv.yards || 0) + " yds"),
    lastPlays: recentPlays
  };
}

// Sub-minute ESPN live poller: runs 3 passes (0s, 20s, 40s) inside a 1-minute Apps Script trigger
// when live games are in progress so the SVG field graphics & play-by-play move on ESPN's exact cadence!
function pollEspnLiveGamesSubMinute() {
  var passResults = [];
  for (var pass = 0; pass < 3; pass++) {
    if (pass > 0) {
      Utilities.sleep(20000);
    }
    var res = syncEspnLiveStateToFirestore(false);
    passResults.push(res);
    // If no games are actively in progress on pass 1, exit immediately (<0.5s runtime, 0 extra polls)
    if (!res || res.inProgressCount === 0) {
      break;
    }
  }
  return {
    ok: true,
    passesRun: passResults.length,
    latest: passResults[passResults.length - 1]
  };
}

function syncEspnLiveStateToFirestore(forceWrite, gamesOverride, weekNumOverride) {
  var scriptProps = PropertiesService.getScriptProperties();
  var activeGames = gamesOverride || null;
  var curWeek = weekNumOverride || 8;

  if (!activeGames || !activeGames.length) {
    try {
      var cachedJson = scriptProps.getProperty("ACTIVE_SLATE_CACHE_JSON");
      if (cachedJson) {
        var parsedCache = JSON.parse(cachedJson);
        if (parsedCache && Array.isArray(parsedCache.games) && parsedCache.games.length > 0) {
          activeGames = parsedCache.games;
          if (!weekNumOverride && parsedCache.currentWeek) curWeek = parsedCache.currentWeek;
        }
      }
    } catch (eCache) {}
  }

  if (!activeGames || !activeGames.length) {
    var cloudState = fetchFirebaseNode("") || {};
    activeGames = (cloudState.customGames && cloudState.customGames.length)
      ? cloudState.customGames
      : getDefaultWeek7GamesFallback();
    curWeek = weekNumOverride || cloudState.currentWeek || 8;
    try {
      scriptProps.setProperty("ACTIVE_SLATE_CACHE_JSON", JSON.stringify({
        currentWeek: curWeek,
        weekLabel: "Week " + curWeek,
        games: activeGames
      }));
    } catch (eSaveCache) {}
  }

  // Fetch ESPN College Football Scoreboard (FBS group 80 + all groups + active week + rolling dates)
  var events = [];
  var seenEventIds = {};
  var nowDt = new Date();
  var dateStrToday = Utilities.formatDate(nowDt, "America/Chicago", "yyyyMMdd");
  var yesterdayDt = new Date(nowDt.getTime() - 86400000);
  var dateStrYest = Utilities.formatDate(yesterdayDt, "America/Chicago", "yyyyMMdd");
  var tomorrowDt = new Date(nowDt.getTime() + 86400000);
  var dateStrTom = Utilities.formatDate(tomorrowDt, "America/Chicago", "yyyyMMdd");
  var rollingDates = dateStrYest + "-" + dateStrTom;

  var urls = [
    ESPN_SB_BASE_URL + "?groups=80&limit=300",
    ESPN_SB_BASE_URL + "?limit=300",
    ESPN_SB_BASE_URL + "?groups=80&limit=300&seasontype=2&week=" + curWeek,
    ESPN_SB_BASE_URL + "?limit=300&seasontype=2&week=" + curWeek,
    ESPN_SB_BASE_URL + "?groups=80&limit=300&dates=" + rollingDates
  ];
  try {
    var sbResps = UrlFetchApp.fetchAll(urls.map(function(u) { return { url: u, muteHttpExceptions: true }; }));
    for (var r = 0; r < sbResps.length; r++) {
      if (sbResps[r].getResponseCode() !== 200) continue;
      var data = JSON.parse(sbResps[r].getContentText() || "{}");
      var evs = data.events || [];
      for (var e = 0; e < evs.length; e++) {
        var ev = evs[e];
        if (!ev || !ev.id || seenEventIds[ev.id]) continue;
        var comp = ev.competitions && ev.competitions[0];
        if (!comp || !comp.competitors) continue;
        var awayC = null, homeC = null;
        for (var c = 0; c < comp.competitors.length; c++) {
          if (comp.competitors[c].homeAway === "away") awayC = comp.competitors[c];
          if (comp.competitors[c].homeAway === "home") homeC = comp.competitors[c];
        }
        if (!awayC || !homeC) continue;
        seenEventIds[ev.id] = true;
        events.push({ ev: ev, comp: comp, away: awayC, home: homeC });
      }
    }
  } catch (eFetch) {
    Logger.log("ESPN scoreboard fetch error: " + eFetch.message);
  }

  var gamesMap = {};
  var summaryQueue = [];
  var inProgressCount = 0;
  var completedCount = 0;

  for (var i = 0; i < activeGames.length; i++) {
    var g = activeGames[i];
    var bestMatch = null;
    for (var j = 0; j < events.length; j++) {
      var item = events[j];
      var mScore = scoreBotGameAgainstEvent(g, item.away, item.home);
      if (mScore.score >= 9 && (!bestMatch || mScore.score > bestMatch.score)) {
        bestMatch = { item: item, flipped: mScore.flipped, score: mScore.score };
      }
    }
    if (!bestMatch) continue;

    var matched = bestMatch.item;
    var compObj = matched.comp;
    var stType = (compObj.status && compObj.status.type) ? compObj.status.type : {};
    var shAway = bestMatch.flipped ? matched.home : matched.away;
    var shHome = bestMatch.flipped ? matched.away : matched.home;

    var awayScore = parseInt((shAway.score && (shAway.score.value || shAway.score)) || "0", 10) || 0;
    var homeScore = parseInt((shHome.score && (shHome.score.value || shHome.score)) || "0", 10) || 0;
    var awayTeamId = (shAway.team && shAway.team.id) ? String(shAway.team.id) : "";
    var homeTeamId = (shHome.team && shHome.team.id) ? String(shHome.team.id) : "";
    var awayAbbr = (shAway.team && shAway.team.abbreviation) || g.awayCode || "AWAY";
    var homeAbbr = (shHome.team && shHome.team.abbreviation) || g.homeCode || "HOME";

    var sit = compObj.situation || {};
    var possId = sit.possession ? String(sit.possession) : "";
    var possSide = null;
    if (possId && possId === awayTeamId) possSide = "away";
    else if (possId && possId === homeTeamId) possSide = "home";

    var ddText = sit.downDistanceText || sit.shortDownDistanceText || "";
    var downNum = (typeof sit.down === "number" && sit.down > 0) ? sit.down : null;
    var distNum = (typeof sit.distance === "number" && sit.distance >= 0) ? sit.distance : null;
    if (!downNum && ddText) {
      var md = ddText.match(/([1-4])(?:st|nd|rd|th)/i);
      if (md) downNum = parseInt(md[1], 10);
    }
    if (distNum === null && ddText) {
      var mdist = ddText.match(/&\s*(\d+|goal)/i);
      if (mdist) distNum = mdist[1].toLowerCase() === "goal" ? "Goal" : parseInt(mdist[1], 10);
    }

    var possText = sit.possessionText || "";
    var ylRaw = typeof sit.yardLine === "number" ? sit.yardLine : 50;
    var yl100 = parseBotSpotTextToYl100(possText, g, awayAbbr, homeAbbr, possSide, ylRaw);
    if (yl100 === null) yl100 = ylRaw;

    var isInProg = (stType.state === "in");
    var isComp = (stType.completed === true);
    if (isInProg) inProgressCount++;
    if (isComp) completedCount++;

    var qtr = (compObj.status && compObj.status.period) ? compObj.status.period : 0;
    var clk = stType.shortDetail || (isComp ? "Final" : "Scheduled");
    var lastPlayStr = (sit.lastPlay && sit.lastPlay.text) ? sit.lastPlay.text : "";

    var gidKey = String(g.id);
    gamesMap[gidKey] = {
      gameId: g.id,
      matchupKey: normalizeBotTeamKey(g.away) + "@" + normalizeBotTeamKey(g.home),
      score: { away: awayScore, home: homeScore, display: awayScore + "-" + homeScore },
      awayScore: awayScore,
      homeScore: homeScore,
      awayAbbr: awayAbbr,
      homeAbbr: homeAbbr,
      quarter: qtr,
      period: qtr,
      clock: clk,
      detail: clk,
      possession: possSide,
      possessionSide: possSide,
      possessionText: possText || formatBotYl100ToSpot(yl100, g),
      yardLine: ylRaw,
      yardLine100: yl100,
      prevYl100: yl100,
      down: downNum,
      distance: distNum,
      downDistanceText: ddText,
      isRedZone: sit.isRedZone === true,
      lastPlay: lastPlayStr,
      lastPlayText: lastPlayStr,
      inProgress: isInProg,
      completed: isComp,
      eventId: matched.ev.id,
      finalDrive: null,
      lastScoringDrive: null
    };

    if (isInProg || isComp) {
      summaryQueue.push({
        gidKey: gidKey,
        game: g,
        eventId: matched.ev.id,
        awayTeamId: awayTeamId,
        homeTeamId: homeTeamId,
        awayAbbr: awayAbbr,
        homeAbbr: homeAbbr
      });
    }
  }

  // Parallel-fetch ESPN Game Summary Play-by-Play Drives for all live/completed games
  if (summaryQueue.length > 0) {
    try {
      var sumReqs = summaryQueue.map(function(sq) {
        return { url: ESPN_SUMMARY_BASE_URL + sq.eventId, muteHttpExceptions: true };
      });
      var sumResps = UrlFetchApp.fetchAll(sumReqs);
      for (var s = 0; s < sumResps.length; s++) {
        if (sumResps[s].getResponseCode() !== 200) continue;
        var sqItem = summaryQueue[s];
        var sumData = JSON.parse(sumResps[s].getContentText() || "{}");
        if (!sumData || !sumData.drives) continue;

        var rawDrives = [];
        if (Array.isArray(sumData.drives.previous)) rawDrives = sumData.drives.previous.slice();
        if (sumData.drives.current) rawDrives.push(sumData.drives.current);
        if (rawDrives.length === 0) continue;

        var finalDrv = parseBotSingleDrive(rawDrives[rawDrives.length - 1], sqItem.game, sqItem.awayTeamId, sqItem.homeTeamId, sqItem.awayAbbr, sqItem.homeAbbr, rawDrives.length);
        var lastScoringDrv = null;
        for (var dIdx = rawDrives.length - 1; dIdx >= 0; dIdx--) {
          var candDrv = parseBotSingleDrive(rawDrives[dIdx], sqItem.game, sqItem.awayTeamId, sqItem.homeTeamId, sqItem.awayAbbr, sqItem.homeAbbr, dIdx + 1);
          if (candDrv && candDrv.isScoringDrive) {
            lastScoringDrv = candDrv;
            break;
          }
        }

        var gEntry = gamesMap[sqItem.gidKey];
        if (gEntry && finalDrv) {
          gEntry.finalDrive = finalDrv;
          gEntry.lastScoringDrive = lastScoringDrv || finalDrv;
          if (gEntry.inProgress) {
            if (!gEntry.possessionSide && finalDrv.possessionSide) {
              gEntry.possession = finalDrv.possessionSide;
              gEntry.possessionSide = finalDrv.possessionSide;
            }
            if (typeof finalDrv.yl100 === "number") {
              gEntry.yardLine100 = finalDrv.yl100;
              gEntry.prevYl100 = typeof finalDrv.prevYl100 === "number" ? finalDrv.prevYl100 : finalDrv.yl100;
              gEntry.possessionText = finalDrv.endSpotText || gEntry.possessionText;
            }
            if (!gEntry.downDistanceText && finalDrv.downDistanceText) {
              gEntry.downDistanceText = finalDrv.downDistanceText;
            }
            if (!gEntry.lastPlay && finalDrv.lastPlays && finalDrv.lastPlays[0]) {
              gEntry.lastPlay = finalDrv.lastPlays[0].text;
              gEntry.lastPlayText = finalDrv.lastPlays[0].text;
            }
          }
        }
      }
    } catch (eSum) {
      Logger.log("ESPN summary play-by-play fetch warning: " + eSum.message);
    }
  }

  // Delta-check so we only write to `live_games/week_state` when a score, clock, spot, or play actually changes
  var digestParts = [];
  var sortedKeys = Object.keys(gamesMap).sort();
  for (var k = 0; k < sortedKeys.length; k++) {
    var gm = gamesMap[sortedKeys[k]];
    digestParts.push([
      gm.gameId,
      gm.awayScore,
      gm.homeScore,
      gm.clock,
      gm.possessionSide || "",
      gm.yardLine100,
      gm.downDistanceText || "",
      (gm.lastPlay || "").slice(0, 60)
    ].join(":"));
  }
  var newHash = curWeek + "__" + digestParts.join("||");
  var prevHash = scriptProps.getProperty("LAST_LIVE_STATE_HASH") || "";

  var wroteToFirestore = false;
  if (forceWrite || (sortedKeys.length > 0 && newHash !== prevHash)) {
    var liveDocPayload = {
      currentWeek: curWeek,
      weekLabel: "Week " + curWeek,
      games: gamesMap,
      updatedAt: new Date().toISOString()
    };
    patchFirestoreDocUrl(FIRESTORE_LIVE_STATE_URL, liveDocPayload);
    scriptProps.setProperty("LAST_LIVE_STATE_HASH", newHash);
    wroteToFirestore = true;
    Logger.log("✓ Pushed live_games/week_state (" + sortedKeys.length + " games, " + inProgressCount + " live, " + completedCount + " final)");
  }

  return {
    ok: true,
    week: curWeek,
    matchedGames: sortedKeys.length,
    inProgressCount: inProgressCount,
    completedCount: completedCount,
    wroteToFirestore: wroteToFirestore,
    gamesMap: gamesMap,
    updatedAt: new Date().toISOString()
  };
}



function debugInspectGmailPickemThreads() {
  var query = '(from:separatedatturf@gmail.com OR subject:"College Pick\'em" OR "Separated at Turf" OR subject:"Spreadsheet") -from:me -in:sent -in:drafts -subject:"Confirmation Receipt" -subject:"Picks Nudge" newer_than:14d';
  var threads = GmailApp.search(query, 0, 25);
  var scanned = [];
  var mySelfEmail = String(Session.getActiveUser().getEmail() || "").toLowerCase().trim();

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var subject = msg.getSubject() || "";
      var sender = String(msg.getFrom() || "");
      var senderLow = sender.toLowerCase();
      var atts = msg.getAttachments() || [];
      var attList = [];
      for (var a = 0; a < atts.length; a++) {
        attList.push({ name: atts[a].getName(), size: atts[a].getSize(), contentType: atts[a].getContentType() });
      }
      var isSelf = (mySelfEmail && senderLow.indexOf(mySelfEmail) !== -1) || senderLow.indexOf("commissioner@separatedatturf.com") !== -1;
      scanned.push({
        id: msg.getId(),
        subject: subject,
        from: sender,
        date: msg.getDate() ? msg.getDate().toISOString() : "",
        isSelfSent: isSelf,
        attachmentCount: atts.length,
        attachments: attList,
        plainSnippet: (msg.getPlainBody() || "").slice(0, 200)
      });
    }
  }
  return {
    ok: true,
    userEmail: mySelfEmail,
    searchQuery: query,
    threadCount: threads.length,
    messageCount: scanned.length,
    messages: scanned
  };
}


function extractGamesFromGrid(grid) {
  if (!grid || grid.length < 5) return [];

  var nameCol = -1;
  var priorPtsCol = -1;
  var tbCol = -1;

  for (var r = 0; r < Math.min(6, grid.length); r++) {
    var row = grid[r];
    if (!row) continue;
    for (var c = 0; c < row.length; c++) {
      var val = String(row[c] || "").trim().toLowerCase();
      if (nameCol === -1 && (val.indexOf("contestant") !== -1 || val === "name" || val === "player" || val === "member")) {
        nameCol = c;
      } else if (priorPtsCol === -1 && (val.indexOf("prior") !== -1 || val.indexOf("season") !== -1 || val === "total" || val === "pts" || val === "points")) {
        priorPtsCol = c;
      } else if (tbCol === -1 && (val.indexOf("tie") !== -1 || val === "tb" || val.indexOf("tie-brkr") !== -1 || val.indexOf("score") !== -1)) {
        tbCol = c;
      }
    }
  }
  if (nameCol === -1) nameCol = 0;

  var contestantRows = [];
  for (var r2 = 0; r2 < grid.length; r2++) {
    var rawName = String(grid[r2][nameCol] || grid[r2][0] || "").trim();
    if (!rawName || isFakeContestantName(rawName)) continue;
    contestantRows.push(grid[r2]);
  }
  if (contestantRows.length < 10) return [];

  var maxCols = 0;
  for (var cr = 0; cr < contestantRows.length; cr++) {
    if (contestantRows[cr].length > maxCols) maxCols = contestantRows[cr].length;
  }

  var extractedGames = [];
  for (var col = 0; col < maxCols; col++) {
    if (col === nameCol || col === priorPtsCol || col === tbCol) continue;

    var tally = {};
    for (var cr2 = 0; cr2 < contestantRows.length; cr2++) {
      var cell = String(contestantRows[cr2][col] || "").trim();
      if (!cell || /^\d+(\.\d+)?$/.test(cell) || /^\d+-\d+$/.test(cell)) continue;
      tally[cell] = (tally[cell] || 0) + 1;
    }

    var sortedTeams = Object.keys(tally).sort(function(a, b) { return tally[b] - tally[a]; });
    if (sortedTeams.length >= 2 && (tally[sortedTeams[0]] + tally[sortedTeams[1]]) >= Math.floor(contestantRows.length * 0.35)) {
      var teamA = sortedTeams[0];
      var teamB = sortedTeams[1];

      var headerText = "";
      for (var hr = 0; hr < Math.min(6, grid.length); hr++) {
        var hVal = String(grid[hr][col] || "").trim();
        if (hVal) headerText += " " + hVal;
      }

      var spMatch = headerText.match(/[-+](\d+\.?\d*)/);
      var lineStr = spMatch ? (teamA + " " + spMatch[0]) : (teamA + " -3.5");

      var chanMatch = headerText.match(/\b(ABC|ESPN2|ESPNU|ESPN|FOX|FS1|CBS|CBSSN|NBC|PEACOCK|CW|BTN|SEC NETWORK|ACC NETWORK|TNT)\b/i);
      var chan = chanMatch ? chanMatch[1].toUpperCase() : "ESPN";

      var timeMatch = headerText.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i);
      var kickTime = timeMatch ? timeMatch[1] : "11:00 AM";

      var cstWin = "11:00 AM CST Window";
      if (kickTime.indexOf("2:30") !== -1 || kickTime.indexOf("3:00") !== -1) cstWin = "2:30 PM CST Window";
      else if (kickTime.indexOf("6:00") !== -1 || kickTime.indexOf("6:30") !== -1 || kickTime.indexOf("7:00") !== -1) cstWin = "6:00 PM / 6:30 PM CST Primetime";
      else if (kickTime.indexOf("9:") !== -1 || kickTime.indexOf("10:") !== -1) cstWin = "9:15 PM+ CST Late Night Window";

      var gid = extractedGames.length + 1;
      extractedGames.push({
        id: gid,
        cstWindow: cstWin,
        away: teamA,
        awayCode: teamA.replace(/State$/i, "St").slice(0, 7),
        awayRec: "",
        awaySit: "",
        home: teamB,
        homeCode: teamB.replace(/State$/i, "St").slice(0, 7),
        homeRec: "",
        homeSit: "",
        kick: "Sat " + kickTime + " CST   " + chan,
        poolLine: lineStr,
        liveLine: lineStr,
        awayPts: 1,
        homePts: 1,
        awayProb: 0.50,
        homeProb: 0.50,
        rec: teamA,
        grokPick: teamA,
        kinyionDefault: teamA,
        tier: "Lean",
        keyInjHeader: "",
        sway: null,
        rationale: teamA + " vs " + teamB + " (Pool Matchup)",
        insights: { vegas: lineStr, stats: "", matchup: "", splits: "Sat " + kickTime + " CST" },
        awayInj: [],
        homeInj: []
      });
    }
  }
  return extractedGames;
}

function patchFirestoreDocUrl(docUrl, dataObj) {
  if (!docUrl || !dataObj) return;
  var topKeys = Object.keys(dataObj);
  if (topKeys.length === 0) return;
  var maskParams = topKeys.map(function(k) {
    return "updateMask.fieldPaths=" + encodeURIComponent(k);
  }).join("&");
  var fsDoc = toFirestoreValue(dataObj).mapValue;
  UrlFetchApp.fetch(docUrl + "?" + maskParams, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(fsDoc),
    muteHttpExceptions: true
  });
}
