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

  // 2. A pick save writes the profile but never currentWeek/weekLabel.
  const r2 = await page.evaluate(() => {
    const before = window.__writes.length;
    pushProfileToFirebase(activeProfile);
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
