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
// KILL SWITCH FOR POOL BROADCAST EMAILS (nudge, Saturday master sheet, email-to-all).
// Stored in Script Properties (BROADCASTS_ENABLED = "true" / "false"), not in code, so a
// commissioner can flip it from the app's Console without a redeploy. Off unless set.
// Single-user pick receipts are never blocked by it.
// ============================================================================
function broadcastsEnabled_() {
  return PropertiesService.getScriptProperties().getProperty("BROADCASTS_ENABLED") === "true";
}

// Web App GET endpoint so index.html can trigger an instant Gmail scrape or live ESPN sync from any browser
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "";
  var force = e && e.parameter && e.parameter.force === "1";
  if (action === "emergencyStop") {
    var stopRes = emergencyStopEmailLoopAndCleanState();
    return ContentService
      .createTextOutput(JSON.stringify(stopRes))
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

// Web App POST endpoint: pick receipts and pool broadcasts, all signed in (see Email.js).
function doPost(e) {
  return handleEmailPost_(e);
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
  if (!broadcastsEnabled_()) {
    Logger.log("Scheduled outbound email check suppressed: pool emails are switched off (BROADCASTS_ENABLED).");
    return { ok: false, skipped: true, reason: "Pool emails are switched off (BROADCASTS_ENABLED)" };
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
  if (!acquireRunLease_("gmail", 360)) {
    Logger.log("⏭️ Gmail bot already running; skipping this run.");
    return { ok: false, skipped: true, reason: "Gmail bot already running" };
  }
  try {
    var stats = runMasterPickemEmailBotLocked_(forceRescan);
    writeBotStatus_("gmail", stats);
    return stats;
  } catch (e) {
    recordBotError_("Gmail bot crashed: " + e.message);
    writeBotStatus_("gmail", {});
    throw e;
  } finally {
    releaseRunLease_("gmail");
  }
}

function runMasterPickemEmailBotLocked_(forceRescan) {
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
      var keepUnprocessed = false;

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
        // Standings emails report on a finished week; they never change the active week
        // (only a new slate rollover or the commissioner does).
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
          var rolledOver = patchFirebaseNode("", {
            customGames: scrapedGames,
            currentWeek: newWkNum,
            weekLabel: newWkLabel,
            weekArchives: existingArchives,
            liveScores: {},
            poolMembers: resetMembers,
            watchlist: resetWl,
            scrapedAt: new Date().toISOString()
          });
          if (!rolledOver) {
            // shared_state still shows the old week: don't advance week_state either, and
            // leave this email unprocessed so the rollover is retried on the next run.
            recordBotError_("Week rollover to " + newWkLabel + " failed to save; will retry");
            keepUnprocessed = true;
          } else {
          try {
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
          }
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

          var isXlsx = attName.indexOf(".xlsx") !== -1;
          var isCsv = attName.indexOf(".csv") !== -1 || attName.indexOf(".tsv") !== -1;
          if (!isXlsx && !isCsv) continue;
          var curWkForSheet = parseInt(currentCloud.currentWeek, 10) || 0;
          if (msgWeekNum && curWkForSheet && msgWeekNum !== curWkForSheet) {
            // A sheet for another week must never be parsed against this week's slate.
            Logger.log("⏭️ Skipping " + att.getName() + ": it is for Week " + msgWeekNum + ", active week is " + curWkForSheet);
            continue;
          }
          var sheetGrid = isXlsx ? extractGridFromXlsxAttachment(att) : Utilities.parseCsv(att.getDataAsString());
          var poolResult = parsePoolSpreadsheetGrid(sheetGrid, activeGames, currentCloud);
          var parsedCount = poolResult ? poolResult.poolMembers.length : 0;
          if (parsedCount < 10) {
            recordBotError_("Sheet " + att.getName() + " parsed only " + parsedCount + " members (need 10); not imported");
            continue;
          }
          if (importPoolSheetResult_(poolResult, curWkForSheet || msgWeekNum, att.getName(), currentCloud)) {
            stats.importedPoolMembers = parsedCount;
            Logger.log("✓ Imported " + att.getName() + ": " + parsedCount + " pool members merged into Firebase");
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
            if (hasActiveInAppPicks_(targetProfile, currentCloud)) {
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

      if (!keepUnprocessed) {
        processedIds[msgId] = new Date().toISOString().slice(0, 10);
        saveProcessedIds_(props, processedIds);
      }
    }
  }

  return stats;
}

// Saved after every message, so a run killed by the 6-minute limit doesn't redo
// (and re-write) everything next time. Keeps the newest 150 IDs (~5 KB, under 9 KB).
function saveProcessedIds_(props, processedIds) {
  var keys = Object.keys(processedIds);
  if (keys.length > 150) {
    var keep = {};
    keys.slice(keys.length - 150).forEach(function(k) { keep[k] = processedIds[k]; });
    keys.slice(0, keys.length - 150).forEach(function(k) { delete processedIds[k]; });
    Object.assign(processedIds, keep);
  }
  props.setProperty("PROCESSED_MSG_IDS", JSON.stringify(processedIds));
}

// Reads one document by path (e.g. "pickem_v14_users/michael"). Returns null if
// missing or unreadable.
function fetchFirestoreDoc_(docPath) {
  try {
    var res = UrlFetchApp.fetch(FIRESTORE_BASE_URL + "/" + docPath, { muteHttpExceptions: true, headers: firestoreAuthHeaders_() });
    if (res.getResponseCode() !== 200) return null;
    var json = JSON.parse(res.getContentText());
    return json && json.fields ? fromFirestoreValue({ mapValue: { fields: json.fields } }) : null;
  } catch (e) {
    return null;
  }
}

// True if this player already saved picks in the app this week, in which case a
// Google Form confirmation email must not overwrite them.
function hasActiveInAppPicks_(targetProfile, currentCloud) {
  if (targetProfile.indexOf("pm:") === 0) {
    var nameLow = standardizeBotParticipantName(targetProfile.slice(3)).toLowerCase();
    var pms = (currentCloud && Array.isArray(currentCloud.poolMembers)) ? currentCloud.poolMembers : [];
    for (var i = 0; i < pms.length; i++) {
      if (standardizeBotParticipantName(pms[i].name).toLowerCase() === nameLow) {
        return Object.keys(pms[i].picks || {}).length >= 15;
      }
    }
    return false;
  }
  var userDoc = fetchFirestoreDoc_("pickem_v14_users/" + encodeURIComponent(targetProfile));
  return !!(userDoc && (userDoc._manualEditsThisWeek || (userDoc.picks && Object.keys(userDoc.picks).length >= 15)));
}

// Merges a parsed official sheet into shared_state.poolMembers: members in the sheet get
// the sheet's picks/tiebreaker; members NOT in the sheet are kept as they are (never dropped).
function importPoolSheetResult_(poolResult, sheetWkNum, fileName, currentCloud) {
  var existing = (currentCloud && Array.isArray(currentCloud.poolMembers)) ? currentCloud.poolMembers.slice() : [];
  var indexByName = {};
  for (var i = 0; i < existing.length; i++) {
    indexByName[standardizeBotParticipantName(existing[i].name).toLowerCase()] = i;
  }
  for (var j = 0; j < poolResult.poolMembers.length; j++) {
    var pm = poolResult.poolMembers[j];
    var key = pm.name.toLowerCase();
    if (indexByName[key] === undefined) {
      indexByName[key] = existing.length;
      existing.push(pm);
      continue;
    }
    var cur = existing[indexByName[key]];
    var merged = Object.assign({}, cur);
    merged.picks = Object.assign({}, cur.picks || {}, pm.picks);
    if (pm.tiebreaker && pm.tiebreaker !== "—") merged.tiebreaker = pm.tiebreaker;
    if (pm.priorPts) merged.priorPts = pm.priorPts;
    merged.awaitingSheet = false;
    existing[indexByName[key]] = merged;
  }

  var clearedDelMap = (currentCloud && currentCloud.deletedPicksByMember) ? Object.assign({}, currentCloud.deletedPicksByMember) : {};
  poolResult.poolMembers.forEach(function(pm) {
    delete clearedDelMap[pm.name.toLowerCase()];
  });
  var nowIso = new Date().toISOString();
  var ok = patchFirebaseNode("", {
    poolMembers: existing,
    leaderboard: poolResult.leaderboard,
    michael: poolResult.michael,
    kinyion: poolResult.kinyion,
    watchlist: poolResult.watchlist,
    officialSheetSyncedForWeek: sheetWkNum,
    lastScrapedFile: fileName,
    deletedPicksByMember: clearedDelMap,
    updatedAt: nowIso
  });
  if (!ok) return false;
  currentCloud.poolMembers = existing;
  currentCloud.officialSheetSyncedForWeek = sheetWkNum;
  if (poolResult.michael && poolResult.michael.picks) {
    patchFirestoreUserDoc("michael", { profileKey: "michael", displayName: "Michael A", linkedMemberName: "Michael A", picks: poolResult.michael.picks, tiebreaker: poolResult.michael.tiebreaker || "28-24", updatedAt: nowIso });
  }
  if (poolResult.kinyion && poolResult.kinyion.picks) {
    patchFirestoreUserDoc("kinyion", { profileKey: "kinyion", displayName: "Kinyon C", linkedMemberName: "Kinyon C", picks: poolResult.kinyion.picks, tiebreaker: poolResult.kinyion.tiebreaker || "31-24", updatedAt: nowIso });
  }
  return true;
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
  // Partial matches must not cross into a different school: "Michigan" is not
  // "Michigan State", "Texas" is not "Texas Tech" (isSafeBotTeamSubstrMatch blocks those).
  var matchAway = isSafeBotTeamSubstrMatch(aKey, norm) || isSafeBotTeamSubstrMatch(norm, aKey) || isSafeBotTeamSubstrMatch(aCode, norm);
  var matchHome = isSafeBotTeamSubstrMatch(hKey, norm) || isSafeBotTeamSubstrMatch(norm, hKey) || isSafeBotTeamSubstrMatch(hCode, norm);
  if (matchAway && !matchHome) return g.away;
  if (matchHome && !matchAway) return g.home;
  return null;
}

// A column header like "Arizona @ Texas Tech" / "SMU at Syracuse" / "Iowa vs Wisconsin"
// names both teams of one game; plain resolveBotSheetTeam rejects it as ambiguous.
function headerMatchesGame_(hCell, g) {
  var parts = String(hCell || "").split(/\s+(?:@|at|vs\.?|v\.?)\s+|\s*@\s*/i);
  if (parts.length !== 2) return false;
  var left = resolveBotSheetTeam(parts[0], g);
  var right = resolveBotSheetTeam(parts[1], g);
  return !!(left && right && left !== right);
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
          if (headerMatchesGame_(hCell, gObj) || resolveBotSheetTeam(hCell, gObj)) {
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

    // Only a plain number counts as points (parseFloat("28-24") would read a tiebreaker as 28).
    var isPtsCell = function(v) { return v !== undefined && v !== null && /^\d+(\.\d+)?$/.test(String(v).trim()); };
    var priorPts = 0;
    if (priorPtsCol !== -1 && isPtsCell(row[priorPtsCol])) {
      priorPts = parseFloat(row[priorPtsCol]) || 0;
    } else if (isPtsCell(row[36])) {
      priorPts = parseFloat(row[36]) || 0;
    } else if (isPtsCell(row[numGames + 1])) {
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
    var games = [];

    // One form question = one game: title "Away 6-1\nat Home 6-1 (-3.5)" (or "vs." for a
    // neutral site) and two answer choices that are the pool's team codes ("Arizona", "TTech").
    for (var i = 0; i < questions.length; i++) {
      var qTitle = questions[i][1] ? String(questions[i][1]).trim() : "";
      var titleLines = qTitle.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
      if (titleLines.length < 2) continue;
      var parsed = buildGamesArrayFromLines(titleLines);
      if (parsed.length !== 1) continue;
      var game = parsed[0];
      game.id = games.length + 1;
      game.rationale = "Auto-Scraped by Gmail Bot (Row #" + game.id + ")";
      var opts = (questions[i][4] && questions[i][4][0] && questions[i][4][0][1]) || [];
      if (opts.length === 2 && opts[0][0] && opts[1][0]) {
        game.awayCode = String(opts[0][0]).trim();
        game.homeCode = String(opts[1][0]).trim();
      }
      games.push(game);
    }
    return games;
  } catch (e) {
    Logger.log("Form scrape error: " + e.message);
    return [];
  }
}

function buildGamesArrayFromLines(lines) {
  var parsedGames = [];
  // "at Home" for a home game, "vs. Home" / "vs Home" for a neutral site (e.g. Florida vs. Georgia).
  var HOME_PREFIX = /^(?:at|vs\.?)\s+/i;
  for (var i = 0; i < lines.length - 1; i++) {
    if (HOME_PREFIX.test(lines[i + 1])) {
      var awayLine = lines[i];
      var homeLine = lines[i + 1].replace(HOME_PREFIX, "").trim();
      var candKick = lines[i + 2] || "";
      var nextAfterCand = lines[i + 3] || "";
      var isCandTeam = HOME_PREFIX.test(nextAfterCand) || /\(\s*-\d/.test(candKick) || /\b\d{1,2}-\d{1,2}\b/.test(candKick);
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
      var est = spreadWinProbEstimate_(spread);
      var dogProb = est.dog;
      var awayProb = favIsAway ? est.fav : est.dog;
      var homeProb = favIsAway ? est.dog : est.fav;
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
        // Fallback only: the app shows ESPN's predictor when it has one (getTeamWinProb in win-prob.js).
        awayProbEstimate: awayProb, homeProbEstimate: homeProb,
        rec: rec, grokPick: rec, kinyionDefault: rec,
        tier: dogPts === 2 && dogProb >= 0.28 ? "Multiplier Upside Play" : "Lean",
        sway: null,
        rationale: "Auto-Scraped by Gmail Bot (Row #" + (parsedGames.length + 1) + ")",
        insights: {
          vegas: "Pool Spread: " + (favIsAway ? away : home) + " -" + spread + " | Est. win prob (from spread): " + away + " " + Math.round(awayProb * 100) + "% vs " + home + " " + Math.round(homeProb * 100) + "%",
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
    var res = UrlFetchApp.fetch(FIRESTORE_DOC_URL, { muteHttpExceptions: true, headers: firestoreAuthHeaders_() });
    var code = res.getResponseCode();
    if (code !== 200) {
      recordBotError_("GET shared_state -> HTTP " + code + ": " + String(res.getContentText()).slice(0, 200));
      return null;
    }
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
  return patchFirestoreDocUrl(FIRESTORE_DOC_URL, payloadObj);
}

function patchFirestoreUserDoc(profKey, userObj) {
  if (!profKey || !userObj) return false;
  return patchFirestoreDocUrl(FIRESTORE_USERS_URL + "/" + encodeURIComponent(profKey), userObj);
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
// Merged into the sheet aliases above (a second `var BOT_TEAM_ALIASES = {...}` used to replace
// them, silently dropping 56 of the 70 aliases the spreadsheet matcher relies on).
Object.assign(BOT_TEAM_ALIASES, {
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
});

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
  if (!acquireRunLease_("espn", 360)) {
    Logger.log("⏭️ ESPN poller already running; skipping this run.");
    return { ok: false, skipped: true, reason: "ESPN poller already running" };
  }
  try {
    var res = pollEspnLiveGamesLocked_();
    if (res.idle) return res;
    var latest = res.latest || {};
    writeBotStatus_("espn", {
      week: latest.week || null,
      matchedGames: latest.matchedGames || 0,
      inProgressCount: latest.inProgressCount || 0,
      completedCount: latest.completedCount || 0,
      wroteToFirestore: !!latest.wroteToFirestore,
      skippedReason: latest.skippedReason || null,
      passesRun: res.passesRun
    });
    return res;
  } catch (e) {
    recordBotError_("ESPN poller crashed: " + e.message);
    writeBotStatus_("espn", {});
    throw e;
  } finally {
    releaseRunLease_("espn");
  }
}

// One ESPN pass per trigger run (the old 3-pass/40s-sleep loop burned most of the
// consumer account's 90 min/day trigger runtime). When nothing is live, the next real
// poll is deferred: every 30 min normally, every minute from 15 min before a kickoff.
var ESPN_IDLE_POLL_MS = 30 * 60 * 1000;
var ESPN_PREGAME_WINDOW_MS = 15 * 60 * 1000;

function pollEspnLiveGamesLocked_() {
  var props = PropertiesService.getScriptProperties();
  var nextAt = parseInt(props.getProperty("ESPN_NEXT_POLL_AT") || "0", 10);
  var nowMs = Date.now();
  if (nextAt > nowMs) {
    return { ok: true, passesRun: 0, idle: true, nextPollAt: new Date(nextAt).toISOString() };
  }
  var res = syncEspnLiveStateToFirestore(false);
  var next = 0;
  if (res && res.ok && res.inProgressCount === 0) {
    next = nowMs + ESPN_IDLE_POLL_MS;
    if (res.nextKickoffMs) next = Math.min(next, res.nextKickoffMs - ESPN_PREGAME_WINDOW_MS);
  } else if (res && res.skippedReason === "ESPN unavailable") {
    // ESPN refuses requests from Apps Script servers (HTTP 403); retrying every
    // minute only burns the daily trigger-runtime quota.
    next = nowMs + ESPN_IDLE_POLL_MS;
  }
  if (next > nowMs) props.setProperty("ESPN_NEXT_POLL_AT", String(next));
  else props.deleteProperty("ESPN_NEXT_POLL_AT");
  return { ok: true, passesRun: 1, latest: res };
}

function syncEspnLiveStateToFirestore(forceWrite, gamesOverride, weekNumOverride) {
  var scriptProps = PropertiesService.getScriptProperties();
  var activeGames = (gamesOverride && gamesOverride.length) ? gamesOverride : null;
  var curWeek = parseInt(weekNumOverride, 10) || 0;

  // Single source of truth: the active week and slate always come from shared_state.
  // No cached copy, no hardcoded Week 7/8 fallback: if we can't read it, we don't write.
  if (!activeGames || !curWeek) {
    var cloudState = fetchFirebaseNode("");
    if (!cloudState) {
      return { ok: false, skippedReason: "could not read shared_state", inProgressCount: 0, gamesMap: {} };
    }
    if (!activeGames) activeGames = (cloudState.customGames && cloudState.customGames.length) ? cloudState.customGames : null;
    if (!curWeek) curWeek = parseInt(cloudState.currentWeek, 10) || 0;
  }
  if (!activeGames || !curWeek) {
    recordBotError_("ESPN sync skipped: shared_state has no customGames/currentWeek");
    return { ok: false, skippedReason: "no active slate/week", inProgressCount: 0, gamesMap: {} };
  }

  // Fetch ESPN College Football Scoreboard (FBS group 80 + all groups + active week + rolling dates)
  var events = [];
  var seenEventIds = {};
  var nowDt = new Date();
  var dateStrToday = Utilities.formatDate(nowDt, "America/Chicago", "yyyyMMdd");

  // groups=80 (FBS) includes every game with an FBS team. The week query covers the whole
  // slate; today's date covers live games if ESPN's week number differs from the pool's.
  // (ESPN answers a YYYYMMDD-YYYYMMDD date range with HTTP 400 when combined with groups.)
  var urls = [
    ESPN_SB_BASE_URL + "?groups=80&limit=300&seasontype=2&week=" + curWeek,
    ESPN_SB_BASE_URL + "?groups=80&limit=300&dates=" + dateStrToday
  ];
  var scoreboardOkCount = 0;
  var scoreboardFailures = [];
  try {
    var sbResps = UrlFetchApp.fetchAll(urls.map(function(u) { return { url: u, muteHttpExceptions: true }; }));
    for (var r = 0; r < sbResps.length; r++) {
      if (sbResps[r].getResponseCode() !== 200) {
        scoreboardFailures.push("HTTP " + sbResps[r].getResponseCode() + " " + urls[r].split("?")[1]);
        continue;
      }
      scoreboardOkCount++;
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
    scoreboardFailures.push("threw: " + eFetch.message);
  }
  if (scoreboardOkCount === 0) {
    // ESPN outage: keep the last good live state in Firestore untouched.
    recordBotError_("ESPN scoreboard unavailable (" + scoreboardFailures.join("; ").slice(0, 220) + "); live state left unchanged");
    return { ok: false, week: curWeek, skippedReason: "ESPN unavailable", inProgressCount: 0, gamesMap: {} };
  }

  var gamesMap = {};
  var summaryQueue = [];
  var inProgressCount = 0;
  var completedCount = 0;
  var nextKickoffMs = 0;

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
    if (!isInProg && !isComp && matched.ev.date) {
      var kickMs = new Date(matched.ev.date).getTime();
      if (kickMs && (!nextKickoffMs || kickMs < nextKickoffMs)) nextKickoffMs = kickMs;
    }

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

    // Play-by-play summaries: live games every pass; finished games only on a forced
    // sync (week rollover archive), not every minute for the rest of the weekend.
    if (isInProg || (isComp && forceWrite)) {
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

  // Guards: never overwrite good scores with an empty map, and never move
  // live_games/week_state to an older week than it already shows.
  var highestWeek = parseInt(scriptProps.getProperty("LIVE_STATE_HIGHEST_WEEK") || "0", 10);
  var skippedReason = null;
  if (sortedKeys.length === 0) {
    skippedReason = "no slate games matched ESPN events";
  } else if (curWeek < highestWeek && !weekNumOverride) {
    skippedReason = "refusing to move week_state back from Week " + highestWeek + " to Week " + curWeek;
    recordBotError_(skippedReason);
  }

  var wroteToFirestore = false;
  if (!skippedReason && (forceWrite || newHash !== prevHash)) {
    var liveDocPayload = {
      currentWeek: curWeek,
      weekLabel: "Week " + curWeek,
      games: gamesMap,
      updatedAt: new Date().toISOString()
    };
    if (curWeek < highestWeek) {
      // Rollover archive pass for the outgoing week: keep week_state's week as-is.
      delete liveDocPayload.currentWeek;
      delete liveDocPayload.weekLabel;
    }
    wroteToFirestore = patchFirestoreDocUrl(FIRESTORE_LIVE_STATE_URL, liveDocPayload);
    if (wroteToFirestore) {
      scriptProps.setProperty("LAST_LIVE_STATE_HASH", newHash);
      if (curWeek > highestWeek) scriptProps.setProperty("LIVE_STATE_HIGHEST_WEEK", String(curWeek));
      Logger.log("✓ Pushed live_games/week_state (" + sortedKeys.length + " games, " + inProgressCount + " live, " + completedCount + " final)");
    }
  }

  return {
    ok: true,
    skippedReason: skippedReason,
    nextKickoffMs: nextKickoffMs,
    week: curWeek,
    matchedGames: sortedKeys.length,
    inProgressCount: inProgressCount,
    completedCount: completedCount,
    wroteToFirestore: wroteToFirestore,
    gamesMap: gamesMap,
    updatedAt: new Date().toISOString()
  };
}

// Firestore calls are made as the script owner (OAuth token with the datastore scope from
// appsscript.json). Owner/IAM-authenticated REST calls are not subject to security rules,
// so the bot keeps working when the rules stop accepting anonymous writes.
function firestoreAuthHeaders_() {
  return { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
}

// Every Firestore write goes through here. Returns true only on HTTP 2xx; failures are
// logged and collected so they show up in live_games/bot_status instead of vanishing.
function patchFirestoreDocUrl(docUrl, dataObj) {
  if (!docUrl || !dataObj) return false;
  var topKeys = Object.keys(dataObj);
  if (topKeys.length === 0) return false;
  var maskParams = topKeys.map(function(k) {
    return "updateMask.fieldPaths=" + encodeURIComponent(k);
  }).join("&");
  var fsDoc = toFirestoreValue(dataObj).mapValue;
  var docName = docUrl.split("/documents/")[1] || docUrl;
  try {
    var res = UrlFetchApp.fetch(docUrl + "?" + maskParams, {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(fsDoc),
      headers: firestoreAuthHeaders_(),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;
    recordBotError_("PATCH " + docName + " [" + topKeys.join(",") + "] -> HTTP " + code + ": " + String(res.getContentText()).slice(0, 200));
  } catch (e) {
    recordBotError_("PATCH " + docName + " threw: " + e.message);
  }
  return false;
}

// ============================================================================
// RUN GUARDS & BOT STATUS
// ============================================================================
var BOT_RUN_ERRORS = [];

function recordBotError_(msg) {
  Logger.log("❌ " + msg);
  BOT_RUN_ERRORS.push(String(msg).slice(0, 300));
}

// One run at a time per job. Triggers can overlap (a 1-minute trigger whose run takes
// longer than a minute, or a web-app call during a trigger run). The lease expires on
// its own after ttlSec so a run killed by the 6-minute limit can't block forever.
function acquireRunLease_(name, ttlSec) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = "RUN_LEASE_" + name;
    var until = parseInt(props.getProperty(key) || "0", 10);
    if (until > Date.now()) return false;
    props.setProperty(key, String(Date.now() + ttlSec * 1000));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function releaseRunLease_(name) {
  PropertiesService.getScriptProperties().deleteProperty("RUN_LEASE_" + name);
}

// Writes live_games/bot_status.<job> = { lastRunAt, lastSuccessAt, ok, errors, summary }.
// lastSuccessAt only moves forward on runs with no failed reads/writes.
function writeBotStatus_(job, summary) {
  var nowIso = new Date().toISOString();
  var props = PropertiesService.getScriptProperties();
  var ok = BOT_RUN_ERRORS.length === 0;
  if (ok) props.setProperty("LAST_SUCCESS_AT_" + job, nowIso);
  var entry = {
    lastRunAt: nowIso,
    lastSuccessAt: props.getProperty("LAST_SUCCESS_AT_" + job) || null,
    ok: ok,
    errors: BOT_RUN_ERRORS.slice(0, 10),
    summary: summary || {}
  };
  var payload = {};
  payload[job] = entry;
  var errorsBefore = BOT_RUN_ERRORS.length;
  patchFirestoreDocUrl(FIRESTORE_BASE_URL + "/live_games/bot_status", payload);
  BOT_RUN_ERRORS.length = errorsBefore;
}

// Spread -> win chance estimate. Same model as public/js/win-prob.js (spreadWinProbEstimate);
// used only when ESPN's predictor isn't available.
function spreadWinProbEstimate_(spread) {
  var s = Math.abs(parseFloat(spread) || 0);
  var fav = Math.min(0.92, 0.50 + s * 0.0235);
  return { fav: +fav.toFixed(2), dog: +(1 - fav).toFixed(2) };
}
