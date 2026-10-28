// Behaviour checks for the week-flicker fixes, run in headless Edge against public/.
// Like smoke.js, all Firestore writes and Apps Script calls are blocked at the network
// layer; on top of that, DocumentReference.set/update are wrapped so we can count
// what the page *tried* to write. Usage: node scenarios.js   (exit code 1 on failure)
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const PUBLIC_DIR = path.resolve(path.join(__dirname, "..", "..", "public"));
const EDGE = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = path.join(PUBLIC_DIR, decodeURIComponent(req.url.split("?")[0]));
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, "index.html");
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "pickem-scn-")), args: ["--no-first-run"] });
  const page = await (await browser.createBrowserContext()).newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*firestore.googleapis.com*" }, { urlPattern: "*script.google*" }] });
  cdp.on("Fetch.requestPaused", (ev) => {
    const u = ev.request.url;
    const write = u.indexOf("script.google") !== -1 || /\/Write\/channel|:commit|:batchWrite/.test(u);
    cdp.send(write ? "Fetch.failRequest" : "Fetch.continueRequest", write ? { requestId: ev.requestId, errorReason: "BlockedByClient" } : { requestId: ev.requestId }).catch(() => {});
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));

  // Count attempted writes per document path, before any app code runs.
  await page.evaluateOnNewDocument(() => {
    window.__writes = [];
    const hook = () => {
      if (!window.firebase || !firebase.firestore || !firebase.firestore.DocumentReference) return setTimeout(hook, 5);
      const proto = firebase.firestore.DocumentReference.prototype;
      ["set", "update"].forEach((m) => {
        const orig = proto[m];
        proto[m] = function(data) {
          window.__writes.push({ path: this.path, keys: Object.keys(data || {}) });
          return orig.apply(this, arguments);
        };
      });
    };
    hook();
  });

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => /Firebase Live Sync/.test((document.getElementById("cloud-status-text") || {}).textContent || ""), { timeout: 25000 });
  await sleep(3000);

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };

  // 1. A normal (non-commissioner) device never writes pool-wide fields.
  const r1 = await page.evaluate(() => {
    const before = window.__writes.length;
    pushWatchlistOrStandingsToFirebase();
    pushCustomGamesToFirebase();
    saveCurrentWeekToArchive(false);
    const shared = window.__writes.slice(before).filter((w) => w.path === "pickem_v14/shared_state");
    return { isCommish: isVerifiedCommissioner(), shared };
  });
  check("non-commissioner pushes write nothing to shared_state", !r1.isCommish && r1.shared.length === 0, r1);

  // 2. A pick save writes the profile but never currentWeek/weekLabel. (Signed out, nothing is
  // saved at all, so the test signs in a stand-in session for the save.)
  const r2 = await page.evaluate(() => {
    const before = window.__writes.length;
    const prevSession = AUTH_SESSION;
    AUTH_SESSION = { uid: "scenario", email: "scenario@example.com", boundProfileKey: "michael" };
    try { pushProfileToFirebase("michael"); } finally { AUTH_SESSION = prevSession; }
    return window.__writes.slice(before).filter((w) => w.path === "pickem_v14/shared_state");
  });
  check("profile save does not write the week", r2.length === 1 && r2[0].keys.indexOf("currentWeek") === -1 && r2[0].keys.indexOf("weekLabel") === -1, r2);

  // 3. Viewing an archived week survives an incoming cloud snapshot.
  const r3 = await page.evaluate(() => {
    const liveWeek = state.currentWeek;
    const liveFirst = GAMES[0].away + "@" + GAMES[0].home;
    switchWeekArchive("week_7");
    const archFirst = GAMES[0].away + "@" + GAMES[0].home;
    const writesBefore = window.__writes.length;
    applyRemoteCloudData({ currentWeek: liveWeek, weekLabel: "Week " + liveWeek, customGames: LIVE_WEEK_SNAPSHOT.games }, "test");
    const afterSnapshot = { week: state.currentWeek, first: GAMES[0].away + "@" + GAMES[0].home, viewing: VIEWING_ARCHIVE_KEY, pending: !!PENDING_REMOTE_DATA };
    const michaelBefore = JSON.stringify(state.michael.picks);
    pickSide(GAMES[0].id, GAMES[0].awayCode);
    const pickChanged = JSON.stringify(state.michael.picks) !== michaelBefore;
    const writesDuringArchive = window.__writes.length - writesBefore;
    return { liveWeek, liveFirst, archFirst, afterSnapshot, pickChanged, writesDuringArchive };
  });
  check("archive view stays on Week 7 when a snapshot arrives", r3.afterSnapshot.week === 7 && r3.afterSnapshot.first === r3.archFirst && r3.afterSnapshot.viewing === "week_7" && r3.afterSnapshot.pending, r3);
  check("picks are blocked while viewing an archive", !r3.pickChanged && r3.writesDuringArchive === 0, r3);

  // 4. Returning to the live week restores live data and applies the held snapshot.
  const r4 = await page.evaluate((liveWeek) => {
    switchWeekArchive("week_" + liveWeek);
    return { week: state.currentWeek, first: GAMES[0].away + "@" + GAMES[0].home, viewing: VIEWING_ARCHIVE_KEY, pending: PENDING_REMOTE_DATA, selected: document.getElementById("week-archive-select").value };
  }, r3.liveWeek);
  check("returning restores the live week", r4.week === r3.liveWeek && r4.first === r3.liveFirst && r4.viewing === null && r4.pending === null && r4.selected === "week_" + r3.liveWeek, r4);

  // 6. A player linked to an app account with no picks this week keeps the official sheet's picks.
  const r6 = await page.evaluate(() => {
    const before = window.__writes.length;
    ensureMultiUserAndPrivacyState();
    state.customUsers.push({ key: "u_scenariosheet", name: "Scenario Sheet", linkedMemberName: "Scenario Sheet", priorPts: 100 });
    state.u_scenariosheet = { picks: {}, tiebreaker: "28-24", target: 20 };
    const sheet = {}; GAMES.forEach((g) => { sheet[g.id] = g.home; });
    state.poolMembers.push({ name: "Scenario Sheet", priorPts: 100, picks: sheet, awaitingSheet: false });
    regradeAllPoolMembersLive();
    const pm = findPoolMemberByName("Scenario Sheet");
    return { count: pm.submittedPicksCount, games: GAMES.length, awaiting: pm.awaitingSheet, writes: window.__writes.length - before };
  });
  check("linked account without app picks keeps its sheet picks", r6.count === r6.games && !r6.awaiting && r6.writes === 0, r6);

  // 7. Opening a dialog closes an open drawer, and page scroll is locked only while one is open.
  const r7 = await page.evaluate(async () => {
    openSettingsDrawer();
    await new Promise((r) => setTimeout(r, 0));
    const drawerLock = document.body.classList.contains("modal-open");
    openAuthModal();
    const drawerAfter = document.getElementById("settings-drawer-backdrop").style.display;
    closeAuthModal();
    return { drawerLock, drawerAfter };
  });
  await sleep(50);
  const lockAfterClose = await page.evaluate(() => document.body.classList.contains("modal-open"));
  check("one overlay at a time; scroll unlocks after closing", r7.drawerLock && r7.drawerAfter === "none" && !lockAfterClose, Object.assign({ lockAfterClose }, r7));

  // 8. A background update doesn't replace a tiebreaker the player is typing.
  const r8 = await page.evaluate(() => {
    const el = document.getElementById("simple-tiebreaker-input");
    el.focus(); el.value = "35-2";
    state[activeProfile].tiebreaker = "28-24";
    syncSimpleModeTabHighlights();
    const kept = el.value; el.blur();
    return kept;
  });
  check("typing in the tiebreaker survives a background update", r8 === "35-2", r8);

  // 9. A burst of pick taps is one Firestore save, made after the taps pause.
  const r9 = await page.evaluate(async () => {
    const prev = AUTH_SESSION;
    AUTH_SESSION = { uid: "scenario", email: "s@example.com", boundProfileKey: "michael" };
    const before = window.__writes.length;
    GAMES.slice(0, 5).forEach(() => { saveCurrentState("michael", true); });
    const during = window.__writes.length - before;
    await new Promise((r) => setTimeout(r, AUTOSAVE_DELAY_MS + 300));
    const after = window.__writes.filter((w, i) => i >= before && w.path.indexOf("pickem_v14_users/") === 0).length;
    AUTH_SESSION = prev;
    return { during, after };
  });
  check("pick taps are batched into one save", r9.during === 0 && r9.after === 1, r9);

  // 10. Name matching ignores case, extra spaces and a trailing period.
  const r10 = await page.evaluate(() => [standardizeParticipantName(" Chad  C. "), findRosterMatchForAccountName("chad c")]);
  check("player names match despite spacing and periods", r10[0] === "Chad C" && /^Chad C/.test(r10[1] || ""), r10);

  // 11. A new account with no roster match picks its row (or "new") from unclaimed names.
  const r11 = await page.evaluate(async () => {
    const p = chooseRosterNameForNewAccount("Someone Unknown");
    const first = document.querySelector("#roster-chooser-list .list-row");
    const name = first ? first.textContent : "";
    if (first) first.click();
    const chosen = await p;
    const p2 = chooseRosterNameForNewAccount("Someone Unknown");
    closePanelSheet();
    return { name, chosen, dismissed: await p2 };
  });
  check("roster chooser returns the chosen name, or new when closed", r11.name && r11.chosen === r11.name && r11.dismissed === "", r11);

  // 5. Commissioner bot-status pill reads live_games/bot_status.
  const pill = await page.evaluate(() => { const el = document.getElementById("bot-sync-pill"); return el ? { text: el.textContent, title: el.title } : null; });
  check("bot status pill shows the last clean bot run", pill && /^Bot (ok|errors) · (\d+[mhd] ago|never)$/.test(pill.text) && /Gmail bot/.test(pill.title), pill);

  // 13. Commissioner hub (role check stubbed; writes are blocked at the network): overrides are
  // logged, per-game locks apply, legacy tab names open Submissions, preview is read-only.
  const r13 = await page.evaluate(() => {
    const realVerify = isVerifiedCommissioner, realAssert = assertCommissionerRole, realPrompt = window.prompt;
    isVerifiedCommissioner = () => true; assertCommissionerRole = () => true;
    window.prompt = (m) => /Tiebreaker for/.test(m) ? "31-24" : "";
    const out = {};
    try {
      const logBefore = ensureCommissionerConfig().overrideAuditLog.length;
      overrideTiebreaker("Adam L");
      forceUnlockPicks("Adam L");
      out.tb = findPoolMemberByName("Adam L").tiebreaker;
      out.unlocked = isMemberForceUnlocked("Adam L");
      out.logged = ensureCommissionerConfig().overrideAuditLog.length - logBefore;
      setGameLockOverride(GAMES[1].id, "locked");
      out.gameLocked = isGameLockedByCommissioner(GAMES[1].id);
      setGameLockOverride(GAMES[1].id, "auto");
      openCommissionerModal("override");
      out.tab = ACTIVE_COMMISH_TAB;
      startPlayerPreview("Adam L");
      const before = JSON.stringify(state[activeProfile].picks);
      pickSide(GAMES[0].id, 1);
      out.readOnly = before === JSON.stringify(state[activeProfile].picks);
      out.banner = !document.getElementById("player-preview-banner").hidden;
      exitPlayerPreview();
      closeCommissionerModal();
      forceUnlockPicks("Adam L");
    } finally {
      isVerifiedCommissioner = realVerify; assertCommissionerRole = realAssert; window.prompt = realPrompt;
    }
    return out;
  });
  check("commissioner overrides are logged; game locks, tab guard and read-only preview work",
    r13.tb === "31-24" && r13.unlocked && r13.logged === 2 && r13.gameLocked && r13.tab === "submissions" && r13.readOnly && r13.banner, r13);

  // 14. Pick status line, "Next unpicked", and the review sheet before locking.
  const r14 = await page.evaluate(async () => {
    const line = (document.querySelector(".pick-status-line") || {}).textContent || "";
    jumpToNextUnpicked();
    const flashed = !!document.querySelector(".pick-card.is-flash");
    onPrimaryPicksAction();
    const title = document.getElementById("panel-sheet-title").textContent;
    const summary = myPicksSummaryText();
    closePanelSheet();
    return { line, flashed, title, summaryOk: /picked · .* favorites \(1x\)/.test(summary) && /Tiebreaker:/.test(summary) };
  });
  check("pick status, next unpicked and review sheet", /picked/.test(r14.line) && /Max \d+ pts/.test(r14.line) && r14.flashed && r14.title === "Review your picks" && r14.summaryOk, r14);

  // 12. Palette, custom colors and screen preset survive a reload (applied before first paint).
  await page.evaluate(() => { setAppTheme("turf"); applyCustomThemeColors({ accent: "#3b82f6" }); setScreenPreset("compact-grid"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const r12 = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    accent: document.documentElement.style.getPropertyValue("--accent"),
    onAccent: document.documentElement.style.getPropertyValue("--on-accent"),
    preset: document.documentElement.dataset.screenPreset
  }));
  await page.evaluate(() => { resetCustomThemeColors(); setScreenPreset("standard"); setAppTheme("dark"); });
  check("appearance settings persist across reloads", r12.theme === "turf" && r12.accent === "#3b82f6" && r12.onAccent === "#0e0f11" && r12.preset === "compact-grid", r12);

  check("no page errors", pageErrors.length === 0, pageErrors);

  let failed = 0;
  for (const r of results) {
    console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok ? "" : "\n     " + JSON.stringify(r.detail).slice(0, 600)));
    if (!r.ok) failed++;
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
