// Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadBot, fakeThread } = require("./harness");

function slate(n, startId) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: (startId || 1) + i, away: "Away Team " + i, awayCode: "A" + i, home: "Home Team " + i, homeCode: "H" + i });
  }
  return out;
}

function baseCloud(over) {
  return Object.assign({
    currentWeek: 9,
    weekLabel: "Week 9",
    customGames: slate(23),
    poolMembers: [],
    weekArchives: {},
    officialSheetSyncedForWeek: 9,
  }, over || {});
}

test("week rollover from a Google Form email does not crash (prevWkNum)", () => {
  const formEmail = {
    id: "m-form-10",
    subject: "Separated at Turf Week 10 Pick'em Form Is Live",
    body: "Week 10 is here! https://docs.google.com/forms/d/e/abc123/viewform",
  };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([formEmail])], isoDay: 2 });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1).map((g) => Object.assign({}, g, { away: "New " + g.away }));
  assert.doesNotThrow(() => h.ctx.runMasterPickemEmailBot(false));
  const archived = h.patches().some((c) => c.url.indexOf("/live_games/week_9_archive") !== -1);
  assert.ok(archived, "outgoing week 9 should be archived before the reset");
});

function botStatusWrites(h) {
  return h.patches().filter((c) => c.url.indexOf("/live_games/bot_status") !== -1).map((c) => h.patchBody(c));
}

test("a second Gmail run is skipped while one holds the lease", () => {
  const h = loadBot({ cloud: baseCloud(), scriptProps: { RUN_LEASE_gmail: String(Date.now() + 60000) } });
  const res = h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(res.skipped, true);
  assert.strictEqual(h.calls.length, 0, "skipped run must not touch Gmail/Firestore");
});

test("an expired lease (run killed by the 6-min limit) does not block the next run", () => {
  const h = loadBot({ cloud: baseCloud(), scriptProps: { RUN_LEASE_gmail: String(Date.now() - 1000) } });
  const res = h.ctx.runMasterPickemEmailBot(false);
  assert.notStrictEqual(res.skipped, true);
  assert.strictEqual(h.scriptProps.getProperty("RUN_LEASE_gmail"), null, "lease released after run");
});

test("rejected Firestore writes are reported in bot_status instead of silently ignored", () => {
  const sheetEmail = {
    id: "m-standings",
    subject: "Separated at Turf Week 9 Standings",
    body: "Overall Standings\n1. Adam L 120\n2. Bob K 118\n3. Cat M 117\n4. Dee N 110\n5. Eve O 100\n6. Fay P 99",
  };
  let n = 0;
  const h = loadBot({
    cloud: baseCloud(),
    threads: [fakeThread([sheetEmail])],
    fetchHandler: (url, p) => {
      const m = (p.method || "get").toLowerCase();
      if (m === "patch" && url.indexOf("bot_status") === -1) {
        n++;
        return require("./harness").makeResponse(403, { error: { status: "PERMISSION_DENIED" } });
      }
      if (m === "patch") return require("./harness").makeResponse(200, {});
      return require("./harness").makeResponse(200, { fields: h.ctx.toFirestoreValue(baseCloud()).mapValue.fields });
    },
  });
  h.ctx.runMasterPickemEmailBot(false);
  assert.ok(n > 0, "standings write attempted");
  const status = botStatusWrites(h).pop().gmail;
  assert.strictEqual(status.ok, false);
  assert.match(status.errors[0], /HTTP 403/);
  assert.strictEqual(status.lastSuccessAt, null, "no success timestamp after a failed write");
});

test("a clean ESPN poll records lastSuccessAt", () => {
  const h = loadBot({ cloud: baseCloud() });
  h.ctx.pollEspnLiveGamesSubMinute();
  const status = botStatusWrites(h).pop().espn;
  assert.strictEqual(status.ok, true);
  assert.ok(status.lastSuccessAt);
  assert.strictEqual(h.scriptProps.getProperty("RUN_LEASE_espn"), null);
});

test("a crash inside the ESPN poller still releases the lease and reports the error", () => {
  const h = loadBot({ cloud: baseCloud() });
  h.ctx.syncEspnLiveStateToFirestore = () => { throw new Error("boom"); };
  assert.throws(() => h.ctx.pollEspnLiveGamesSubMinute(), /boom/);
  assert.strictEqual(h.scriptProps.getProperty("RUN_LEASE_espn"), null);
  assert.match(botStatusWrites(h).pop().espn.errors[0], /boom/);
});
