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

// ESPN scoreboard fixture: one event per slate game, with given state.
function espnBoard(games, state, dateIso) {
  return {
    events: games.map((g, i) => ({
      id: "ev" + g.id,
      date: dateIso || "2026-10-31T16:00Z",
      competitions: [{
        status: { period: state === "in" ? 2 : 0, type: { state, completed: state === "post", shortDetail: state } },
        situation: {},
        competitors: [
          { homeAway: "away", score: "7", team: { id: "a" + i, location: g.away, displayName: g.away, abbreviation: g.awayCode } },
          { homeAway: "home", score: "3", team: { id: "h" + i, location: g.home, displayName: g.home, abbreviation: g.homeCode } },
        ],
      }],
    })),
  };
}
function weekStateWrites(h) {
  return h.patches().filter((c) => c.url.indexOf("/live_games/week_state") !== -1).map((c) => h.patchBody(c));
}
const realSlate = [
  { id: 1, away: "Arizona", awayCode: "Arizona", home: "Texas Tech", homeCode: "TTech" },
  { id: 2, away: "SMU", awayCode: "SMU", home: "Syracuse", homeCode: "Syr" },
];

test("ESPN sync takes the week from shared_state, ignoring a stale cached Week 8 slate", () => {
  const h = loadBot({
    cloud: baseCloud({ currentWeek: 9, customGames: realSlate }),
    scriptProps: { ACTIVE_SLATE_CACHE_JSON: JSON.stringify({ currentWeek: 8, games: slate(26) }) },
    espnBody: espnBoard(realSlate, "in"),
  });
  h.ctx.pollEspnLiveGamesSubMinute();
  const w = weekStateWrites(h).pop();
  assert.strictEqual(w.currentWeek, 9);
  assert.deepStrictEqual(Object.keys(w.games).sort(), ["1", "2"]);
});

test("ESPN outage leaves live state untouched and reports the error", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnStatus: 503 });
  h.ctx.pollEspnLiveGamesSubMinute();
  assert.strictEqual(weekStateWrites(h).length, 0);
  assert.match(botStatusWrites(h).pop().espn.errors[0], /ESPN scoreboard unavailable/);
});

test("forced sync with no matched games never writes an empty games map", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnBody: { events: [] } });
  h.ctx.syncEspnLiveStateToFirestore(true);
  assert.strictEqual(weekStateWrites(h).length, 0);
});

test("week_state is never moved backward", () => {
  const h = loadBot({
    cloud: baseCloud({ currentWeek: 8, customGames: realSlate }),
    scriptProps: { LIVE_STATE_HIGHEST_WEEK: "9" },
    espnBody: espnBoard(realSlate, "in"),
  });
  h.ctx.pollEspnLiveGamesSubMinute();
  assert.strictEqual(weekStateWrites(h).length, 0);
  assert.match(botStatusWrites(h).pop().espn.errors[0], /refusing to move week_state back/);
});

test("unreadable shared_state means no ESPN write (no Week 7 fallback)", () => {
  const h = loadBot({
    fetchHandler: (url) => require("./harness").makeResponse(url.indexOf("firestore") !== -1 ? 500 : 200, { events: [] }),
  });
  const res = h.ctx.syncEspnLiveStateToFirestore(true);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(weekStateWrites(h).length, 0);
});

test("idle (no live games): one pass, then polls are deferred until 15 min before kickoff", () => {
  const kickoff = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnBody: espnBoard(realSlate, "pre", kickoff) });
  const first = h.ctx.pollEspnLiveGamesSubMinute();
  assert.strictEqual(first.passesRun, 1);
  assert.strictEqual(h.sleeps.length, 0, "no 20s sleeps any more");
  const next = parseInt(h.scriptProps.getProperty("ESPN_NEXT_POLL_AT"), 10);
  assert.ok(next > Date.now() + 25 * 60 * 1000 && next <= Date.now() + 30 * 60 * 1000 + 1000, "idle: next poll ~30 min out");
  const callsBefore = h.calls.length;
  const second = h.ctx.pollEspnLiveGamesSubMinute();
  assert.strictEqual(second.idle, true);
  assert.strictEqual(h.calls.length, callsBefore, "deferred run makes zero requests");
});

test("live games: keep polling every minute", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnBody: espnBoard(realSlate, "in") });
  h.ctx.pollEspnLiveGamesSubMinute();
  assert.strictEqual(h.scriptProps.getProperty("ESPN_NEXT_POLL_AT"), null);
});

test("rollover whose shared_state write is rejected does not advance week_state and is retried", () => {
  const { makeResponse } = require("./harness");
  const formEmail = { id: "m-form-10b", subject: "Separated at Turf Week 10 Pick'em Form Is Live", body: "Week 10 https://docs.google.com/forms/d/e/x/viewform" };
  let h;
  h = loadBot({
    threads: [fakeThread([formEmail])],
    fetchHandler: (url, p) => {
      const m = (p.method || "get").toLowerCase();
      if (url.indexOf("espn.com") !== -1) return makeResponse(200, espnBoard(realSlate, "post"));
      if (m === "get") return makeResponse(200, { fields: h.ctx.toFirestoreValue(baseCloud({ customGames: realSlate })).mapValue.fields });
      if (url.indexOf("/pickem_v14/shared_state") !== -1) return makeResponse(403, { error: { status: "PERMISSION_DENIED" } });
      return makeResponse(200, {});
    },
  });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1);
  h.ctx.runMasterPickemEmailBot(false);
  const weeks = weekStateWrites(h).map((w) => w.currentWeek);
  assert.ok(!weeks.includes(10), "week_state must not jump to Week 10 when shared_state is still Week 9");
  const processed = JSON.parse(h.userProps.getProperty("PROCESSED_MSG_IDS") || "{}");
  assert.ok(!processed["m-form-10b"], "email stays unprocessed so the rollover retries");
  assert.match(botStatusWrites(h).pop().gmail.errors.join(" "), /rollover to Week 10 failed/);
});
