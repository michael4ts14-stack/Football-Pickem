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
  const cloud = baseCloud({ poolMembers: [{ name: "Adam L", picks: { 1: "x" }, _picksCleared: true }], deletedPicksByMember: { "adam l": true } });
  const h = loadBot({ cloud, threads: [fakeThread([formEmail])], isoDay: 2 });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1).map((g) => Object.assign({}, g, { away: "New " + g.away }));
  assert.doesNotThrow(() => h.ctx.runMasterPickemEmailBot(false));
  const archived = h.patches().some((c) => c.url.indexOf("/live_games/week_9_archive") !== -1);
  assert.ok(archived, "outgoing week 9 should be archived before the reset");
  const reset = sharedStateWrites(h).find((w) => w.currentWeek === 10);
  assert.strictEqual(JSON.stringify(reset.deletedPicksByMember), "{}", "last week's picks-cleared flags are dropped");
  assert.strictEqual(reset.poolMembers[0]._picksCleared, undefined);
  assert.strictEqual(reset.poolMembers[0].awaitingSheet, true);
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

function sharedStateWrites(h) {
  return h.patches().filter((c) => c.url.indexOf("/pickem_v14/shared_state") !== -1).map((c) => h.patchBody(c));
}
function csvAttachment(name, rows) {
  return { getName: () => name, getDataAsString: () => rows.map((r) => r.join(",")).join("\n") };
}
const sheetNames = ["Adam L", "Bob K", "Cat M", "Dee N", "Eve O", "Fay P", "Gus Q", "Hal R", "Ivy S", "Jo T"];
const sheetSlate = [
  { id: 1, away: "Arizona", awayCode: "Arizona", home: "Texas Tech", homeCode: "TTech" },
  { id: 2, away: "SMU", awayCode: "SMU", home: "Syracuse", homeCode: "Syr" },
  { id: 3, away: "Wisconsin", awayCode: "Wisc", home: "Iowa", homeCode: "Iowa" },
  { id: 4, away: "Boston College", awayCode: "BC", home: "Duke", homeCode: "Duke" },
  { id: 5, away: "Illinois", awayCode: "Illinois", home: "Maryland", homeCode: "Mary" },
  { id: 6, away: "Michigan", awayCode: "Mich", home: "Rutgers", homeCode: "Rutgers" },
];
function officialSheet() {
  const rows = [["Contestant"].concat(sheetSlate.map((g) => g.away + " @ " + g.home)).concat(["Tiebreaker"])];
  sheetNames.forEach((n, i) => rows.push([n, i % 2 ? "Arizona" : "Texas Tech", "SMU", "Iowa", "Duke", "Illinois", "Michigan", "28-24"]));
  return rows;
}

test("a standings email for last week never changes the active week", () => {
  const email = {
    id: "m-st8", subject: "Separated at Turf Week 8 Standings",
    body: "Overall Standings\n1. Adam L 120\n2. Bob K 118\n3. Cat M 117\n4. Dee N 110\n5. Eve O 100\n6. Fay P 99",
  };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  const writes = sharedStateWrites(h);
  assert.ok(writes.length > 0, "standings still imported");
  writes.forEach((w) => assert.strictEqual(w.currentWeek, undefined));
});

test("a spreadsheet for a different week is not parsed against this week's slate", () => {
  const email = {
    id: "m-sheet8", subject: "College Pick'em '26 - Week 8 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 8.csv", officialSheet())],
  };
  const h = loadBot({ cloud: baseCloud({ customGames: sheetSlate, officialSheetSyncedForWeek: 8 }), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(sharedStateWrites(h).filter((w) => w.poolMembers).length, 0);
});

test("importing this week's sheet merges picks and keeps members who are not in the sheet", () => {
  const email = {
    id: "m-sheet9", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const existing = [
    { name: "Adam L", priorPts: 120, picks: { 1: "Texas Tech" }, tiebreaker: "30-20" },
    { name: "Late Larry", priorPts: 90, picks: { 1: "Arizona", 2: "Syracuse" }, tiebreaker: "21-17" },
  ];
  const h = loadBot({
    cloud: baseCloud({ customGames: sheetSlate, poolMembers: existing, officialSheetSyncedForWeek: 8 }),
    threads: [fakeThread([email])],
  });
  h.ctx.runMasterPickemEmailBot(false);
  const w = sharedStateWrites(h).filter((x) => x.poolMembers).pop();
  assert.ok(w, "sheet imported");
  assert.strictEqual(w.officialSheetSyncedForWeek, 9);
  const byName = Object.fromEntries(w.poolMembers.map((m) => [m.name, m]));
  assert.ok(byName["Late Larry"], "member missing from the sheet is kept");
  assert.strictEqual(JSON.stringify(byName["Late Larry"].picks), JSON.stringify({ 1: "Arizona", 2: "Syracuse" }));
  assert.strictEqual(byName["Adam L"].priorPts, 120, "existing fields preserved");
  assert.strictEqual(byName["Adam L"].picks["2"], "SMU", "sheet picks merged in");
  assert.strictEqual(w.poolMembers.length, 11);
});

test("a sheet that parses fewer than 10 members is reported, not imported", () => {
  const email = {
    id: "m-sheet-bad", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet().slice(0, 4))],
  };
  const h = loadBot({ cloud: baseCloud({ customGames: sheetSlate, officialSheetSyncedForWeek: 8 }), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(sharedStateWrites(h).filter((w) => w.poolMembers).length, 0);
  assert.match(botStatusWrites(h).pop().gmail.errors.join(" "), /parsed only 3 members/);
});

test("confirmation-email guard reads the player's own user doc", () => {
  const games = slate(23);
  const picks = {}; games.forEach((g) => { picks[g.id] = g.home; });
  const h = loadBot({ cloud: baseCloud(), docs: { "pickem_v14_users/michael": { picks } } });
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("michael", baseCloud(), games), true);
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("kinyion", baseCloud(), games), false, "no user doc -> no in-app picks");
  const cloud = baseCloud({ poolMembers: [{ name: "Adam L", picks }] });
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("pm:Adam L", cloud, games), true);
});

test("confirmation-email guard ignores last week's leftover picks", () => {
  const games = slate(23);
  const old = {}; for (let i = 1; i <= 29; i++) old[i] = "Last Week Team " + i;
  old[1] = games[0].away; old[2] = games[1].home; // a couple of teams play again
  const h = loadBot({ cloud: baseCloud(), docs: { "pickem_v14_users/u_x": { picks: old } } });
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("u_x", baseCloud(), games), false);
  const cloud = baseCloud({ poolMembers: [{ name: "Adam L", picks: old }] });
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("pm:Adam L", cloud, games), false);
});

test("a confirmation email clears a leftover picks-cleared flag", () => {
  const games = slate(23);
  const picks = {}; games.forEach((g) => { picks[g.id] = g.away; });
  const cloud = baseCloud({ poolMembers: [{ name: "Adam L", picks: {}, _picksCleared: true }], deletedPicksByMember: { "adam l": true, "bob s": true } });
  const h = loadBot({ cloud });
  h.ctx.savePicksToTargetProfile("pm:Adam L", { picks, matchedCount: 23 }, cloud);
  const w = sharedStateWrites(h).pop();
  assert.strictEqual(JSON.stringify(w.deletedPicksByMember), JSON.stringify({ "bob s": true }));
  assert.strictEqual(w.poolMembers[0]._picksCleared, undefined);
  assert.strictEqual(Object.keys(w.poolMembers[0].picks).length, 23);
});

test("processed email IDs are saved as each message finishes", () => {
  const ok = { id: "m-ok", subject: "Separated at Turf hello", body: "nothing" };
  const boom = { id: "m-boom", subject: "Separated at Turf boom", body: "x" };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([ok, boom])] });
  const realParse = h.ctx.parseStandingsFromText;
  h.ctx.parseStandingsFromText = (p, html) => { if (p === "x") throw new Error("parse crash"); return realParse(p, html); };
  assert.throws(() => h.ctx.runMasterPickemEmailBot(false), /parse crash/);
  const saved = JSON.parse(h.userProps.getProperty("PROCESSED_MSG_IDS"));
  assert.ok(saved["m-ok"], "first message stays processed even though the run crashed later");
});

test("when ESPN refuses the bot (HTTP 403) the poller backs off 30 min", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnStatus: 403 });
  h.ctx.pollEspnLiveGamesSubMinute();
  const next = parseInt(h.scriptProps.getProperty("ESPN_NEXT_POLL_AT"), 10);
  assert.ok(next > Date.now() + 25 * 60 * 1000, "next poll deferred");
  assert.match(botStatusWrites(h).pop().espn.errors[0], /HTTP 403/);
});

test("team matcher: a school never matches its 'State'/'Tech' namesake", () => {
  const h = loadBot({ cloud: baseCloud() });
  const r = h.ctx.resolveBotSheetTeam;
  const msuGame = { id: 1, away: "Michigan State", awayCode: "MichSt", home: "Indiana", homeCode: "Indiana" };
  const ttGame = { id: 2, away: "Arizona", awayCode: "Arizona", home: "Texas Tech", homeCode: "TTech" };
  assert.strictEqual(r("Michigan", msuGame), null);
  assert.strictEqual(r("Michigan State", msuGame), "Michigan State");
  assert.strictEqual(r("Texas", ttGame), null);
  assert.strictEqual(r("Arizona State", ttGame), null);
  assert.strictEqual(r("Arizona Wildcats", ttGame), "Arizona");
  assert.strictEqual(r("Texas Tech Red Raiders", ttGame), "Texas Tech");
});

test("sheet aliases from the first alias table survive (OklaSt, KState, TTech)", () => {
  const h = loadBot({ cloud: baseCloud() });
  assert.strictEqual(h.ctx.normalizeBotKey("OklaSt"), "oklahomastate");
  assert.strictEqual(h.ctx.normalizeBotKey("KState"), "kansasstate");
  assert.strictEqual(h.ctx.normalizeBotKey("TTech"), "texastech");
  assert.strictEqual(h.ctx.normalizeBotTeamKey("Miami (OH)"), "miamioh", "ESPN-side aliases still present");
});

test("'Away @ Home' headers map columns even with extra columns before the games", () => {
  const h = loadBot({ cloud: baseCloud() });
  const header = ["Rank", "Contestant", "Email"].concat(sheetSlate.map((g) => g.away + " @ " + g.home)).concat(["Tiebreaker", "Prior Pts"]);
  const rows = [header];
  sheetNames.forEach((n, i) => rows.push([String(i + 1), n, n.toLowerCase().replace(" ", "") + "@x.com",
    "Texas Tech", "Syracuse", "Wisconsin", "Duke", "Maryland", "Rutgers", "31-17", String(100 - i)]));
  const res = h.ctx.parsePoolSpreadsheetGrid(rows, sheetSlate, {});
  assert.strictEqual(res.poolMembers.length, 10);
  const adam = res.poolMembers.find((m) => m.name === "Adam L");
  assert.strictEqual(JSON.stringify(adam.picks), JSON.stringify({ 1: "Texas Tech", 2: "Syracuse", 3: "Wisconsin", 4: "Duke", 5: "Maryland", 6: "Rutgers" }));
  assert.strictEqual(adam.tiebreaker, "31-17");
  assert.strictEqual(adam.priorPts, 100);
});

test("real Week 9 Google Form: all 23 games, including the neutral-site 'vs.' game, with the form's team codes", () => {
  const formHtml = require("fs").readFileSync(require("path").join(__dirname, "fixtures", "week9-form.html"), "utf8");
  const { makeResponse } = require("./harness");
  const h = loadBot({ fetchHandler: () => makeResponse(200, formHtml) });
  const games = h.ctx.scrapeGoogleFormGames("https://docs.google.com/forms/d/e/x/viewform");
  assert.strictEqual(games.length, 23);
  assert.deepStrictEqual([games[8].id, games[8].away, games[8].home], [9, "Florida", "Georgia"]);
  assert.deepStrictEqual([games[0].awayCode, games[0].homeCode], ["Arizona", "TTech"]);
  assert.deepStrictEqual([games[10].away, games[10].awayCode], ["Arizona State", "ArizSt"]);
  assert.strictEqual(games[22].id, 23);
});

test("Firestore requests carry the owner's OAuth token; ESPN requests don't", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnBody: espnBoard(realSlate, "in") });
  h.ctx.pollEspnLiveGamesSubMinute();
  const fs = h.calls.filter((c) => c.url.indexOf("firestore.googleapis.com") !== -1);
  const espn = h.calls.filter((c) => c.url.indexOf("espn.com") !== -1);
  assert.ok(fs.length > 0 && fs.every((c) => c.params.headers && c.params.headers.Authorization === "Bearer owner-token"));
  assert.ok(espn.length > 0 && espn.every((c) => !c.params.headers));
});
