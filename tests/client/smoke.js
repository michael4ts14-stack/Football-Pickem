// Headless smoke test for public/. Serves the folder like Firebase Hosting (unknown paths
// fall back to index.html), loads it in Edge, clicks through the main views, and writes a
// JSON report of console errors, page errors, asset loads, and the DOM ids present.
//
// SAFETY: every Firestore *write* channel and every Apps Script call is aborted at the
// network layer, so the test can read production data but can never change it.
//
// Usage: node smoke.js <report.json> [publicDir]
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const REPORT = process.argv[2] || "smoke-report.json";
const PUBLIC_DIR = path.resolve(process.argv[3] || path.join(__dirname, "..", "..", "public"));
const EDGE = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let file = path.join(PUBLIC_DIR, urlPath);
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(PUBLIC_DIR, "index.html"); // firebase.json rewrite "**" -> /index.html
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function isBlockedWrite(url) {
  if (url.indexOf("script.google.com") !== -1 || url.indexOf("script.googleusercontent.com") !== -1) return true;
  if (url.indexOf("firestore.googleapis.com") === -1) return false;
  return /\/Write\/channel|:commit|:batchWrite|:runTransaction|:beginTransaction/.test(url);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // SMOKE_URL=https://football-pickem-46206.web.app/ tests the deployed site instead of public/.
  const server = process.env.SMOKE_URL ? null : await serve();
  const base = process.env.SMOKE_URL || ("http://127.0.0.1:" + server.address().port + "/");
  const profileDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "pickem-smoke-"));
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    userDataDir: profileDir,
    args: ["--no-first-run", "--disable-extensions", "--no-default-browser-check"],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const report = { consoleErrors: [], pageErrors: [], blockedWrites: 0, localAssets: [], views: {}, steps: [] };
  // Intercept only Firestore + Apps Script traffic (page-wide interception breaks ESPN's CORS).
  const cdp = await page.createCDPSession();
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*firestore.googleapis.com*" },
    { urlPattern: "*script.google.com*" },
    { urlPattern: "*script.googleusercontent.com*" },
  ] });
  cdp.on("Fetch.requestPaused", (ev) => {
    if (isBlockedWrite(ev.request.url)) {
      report.blockedWrites++;
      cdp.send("Fetch.failRequest", { requestId: ev.requestId, errorReason: "BlockedByClient" }).catch(() => {});
    } else {
      cdp.send("Fetch.continueRequest", { requestId: ev.requestId }).catch(() => {});
    }
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.startsWith(base) && u !== base) {
      report.localAssets.push({ path: u.slice(base.length), status: res.status(), type: (res.headers()["content-type"] || "").split(";")[0] });
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => report.pageErrors.push(String(err && err.message || err).slice(0, 300)));

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the first Firestore snapshot to be applied (status text changes), max 25 s.
  const synced = await page.waitForFunction(() => {
    const el = document.getElementById("cloud-status-text");
    return el && /Firebase Live Sync|Saved|Synced/.test(el.textContent);
  }, { timeout: 25000 }).then(() => true).catch(() => false);
  report.steps.push({ step: "initial-sync", ok: synced });
  await sleep(4000);

  async function step(name, fn) {
    const before = report.pageErrors.length;
    let threw = null;
    try { await page.evaluate(fn); } catch (e) { threw = String(e.message).slice(0, 300); }
    await sleep(1200);
    report.steps.push({ step: name, threw, newPageErrors: report.pageErrors.slice(before) });
  }

  for (const view of ["cards", "condensed", "live", "standings"]) {
    await step("view:" + view, new Function("if (typeof switchMainView === 'function') switchMainView('" + view + "');"));
    report.views[view] = await page.evaluate(() => {
      const main = document.getElementById("main-layout") || document.body;
      return { textLength: (main.innerText || "").length };
    });
  }
  await step("view:cards-again", () => switchMainView("cards"));
  await step("pick-first-game", () => {
    if (typeof GAMES !== "undefined" && GAMES[0] && typeof pickSide === "function") pickSide(GAMES[0].id, GAMES[0].awayCode || "away");
  });
  await step("open-week-archive", () => {
    const keys = Object.keys((state && state.weekArchives) || {});
    if (keys.length && typeof switchWeekArchive === "function") switchWeekArchive(keys[0]);
  });
  await step("open-commissioner-modal", () => { if (typeof openCommissionerModal === "function") openCommissionerModal(); });
  await step("render-all", () => { if (typeof renderAll === "function") renderAll(); });

  report.globals = await page.evaluate(() => ({
    gamesCount: typeof GAMES !== "undefined" ? GAMES.length : null,
    currentWeek: typeof state !== "undefined" ? state.currentWeek : null,
    renderAllType: typeof renderAll,
    hasFirestore: typeof fsDb !== "undefined" && !!fsDb,
  }));
  report.domIds = await page.evaluate(() => Array.from(document.querySelectorAll("[id]")).map((e) => e.id).sort());

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    report: REPORT,
    initialSync: synced,
    pageErrors: report.pageErrors.length,
    consoleErrors: report.consoleErrors.length,
    blockedWrites: report.blockedWrites,
    stepsThatThrew: report.steps.filter((s) => s.threw).map((s) => s.step),
    badAssets: report.localAssets.filter((a) => a.status !== 200 || (/\.js$/.test(a.path.split("?")[0]) && a.type !== "text/javascript") || (/\.css$/.test(a.path.split("?")[0]) && a.type !== "text/css")),
    globals: report.globals,
    domIdCount: report.domIds.length,
  }, null, 1));
  await browser.close();
  if (server) server.close();
})().catch((e) => { console.error(e); process.exit(1); });
