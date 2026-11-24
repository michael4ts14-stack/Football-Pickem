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
  assert.ok(archiveWrite(h, "week_9"), "outgoing week 9 is archived to pickem_v14_archives before the reset");
  assert.ok(!h.patches().some((c) => c.url.indexOf("/live_games/week_9_archive") !== -1), "no write-only live_games copy");
  assert.ok(!("weekArchives" in sharedStateWrites(h).find((w) => w.currentWeek === 10)), "shared_state stays small (B118)");
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

test("a hidden player's form picks go only to their private doc", () => {
  const games = slate(23);
  const picks = {}; games.forEach((g) => { picks[g.id] = g.away; });
  const cloud = baseCloud({ profilePrivacy: { u_sam: { hidden: true } }, u_sam: { picks: {}, tiebreaker: "", target: 20, picksPrivate: true } });
  const h = loadBot({ cloud });
  h.ctx.savePicksToTargetProfile("u_sam", { picks, tiebreaker: "20-10", matchedCount: 23 }, cloud);
  const priv = h.patches().find((c) => c.url.indexOf("/pickem_v14_private_picks/u_sam") !== -1);
  assert.strictEqual(Object.keys(h.patchBody(priv).picks).length, 23);
  assert.strictEqual(h.patchBody(priv).tiebreaker, "20-10");
  const pub = h.patches().find((c) => c.url.indexOf("/pickem_v14_users/u_sam") !== -1);
  assert.strictEqual(h.patchBody(pub).picks, undefined);
  assert.strictEqual(h.patchBody(pub).tiebreaker, undefined);
  assert.ok(pub.url.indexOf("updateMask.fieldPaths=picks") !== -1, "the mask deletes any public picks");
  const mirror = sharedStateWrites(h).pop().u_sam;
  assert.strictEqual(Object.keys(mirror.picks || {}).length, 0);
  assert.strictEqual(mirror.tiebreaker, "");
  assert.strictEqual(mirror.picksPrivate, true);
});

test("a form email matched by name still goes to a hidden player's private doc", () => {
  const games = slate(23);
  const picks = {}; games.forEach((g) => { picks[g.id] = g.away; });
  const cloud = baseCloud({
    profilePrivacy: { u_sam: { hidden: true } },
    customUsers: [{ key: "u_sam", name: "Sam B", linkedMemberName: "Sam B" }],
    poolMembers: [{ name: "Sam B", picks: {} }],
  });
  const h = loadBot({ cloud });
  h.ctx.savePicksToTargetProfile("pm:Sam B", { picks, matchedCount: 23 }, cloud);
  assert.ok(h.patches().some((c) => c.url.indexOf("/pickem_v14_private_picks/u_sam") !== -1));
  assert.ok(!sharedStateWrites(h).some((w) => w.poolMembers), "the public row isn't touched");
});

test("in-app picks of a hidden player matched by name aren't overwritten by a form email", () => {
  const games = slate(23);
  const picks = {}; games.forEach((g) => { picks[g.id] = g.away; });
  const cloud = baseCloud({
    profilePrivacy: { u_sam: { hidden: true } },
    customUsers: [{ key: "u_sam", name: "Sam B", linkedMemberName: "Sam B" }],
    poolMembers: [{ name: "Sam B", picks: {} }],
  });
  const h = loadBot({ cloud });
  h.ctx.fetchFirestoreDoc_ = (p) => (p === "pickem_v14_private_picks/u_sam" ? { picks } : null);
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("pm:Sam B", cloud, games), true);
});

test("if a hidden player's private doc can't be written, the public copies stay and the email is retried", () => {
  const cloud = baseCloud({ profilePrivacy: { u_sam: { hidden: true } }, u_sam: { picks: {}, tiebreaker: "", target: 20 } });
  const h = loadBot({ cloud });
  const before = h.patches().length;
  h.ctx.patchFirestoreDocUrl = () => false;
  assert.strictEqual(h.ctx.savePicksToTargetProfile("u_sam", { picks: { 1: "x" }, matchedCount: 1 }, cloud), false);
  assert.strictEqual(h.patches().length, before);
});

test("a form email clears the stale picks-cleared flag on a hidden player's row", () => {
  const cloud = baseCloud({
    profilePrivacy: { u_sam: { hidden: true } },
    customUsers: [{ key: "u_sam", name: "Sam B", linkedMemberName: "Sam B" }],
    poolMembers: [{ name: "Sam B", picks: {}, _picksCleared: true }],
  });
  const h = loadBot({ cloud });
  h.ctx.savePicksToTargetProfile("pm:Sam B", { picks: { 1: "x" }, matchedCount: 1 }, cloud);
  const row = sharedStateWrites(h).filter((w) => w.poolMembers).pop().poolMembers[0];
  assert.strictEqual(row._picksCleared, undefined);
  assert.strictEqual(Object.keys(row.picks || {}).length, 0);
});

test("an unreadable private doc counts as having picks, so a form email can't overwrite them", () => {
  const cloud = baseCloud({ profilePrivacy: { u_sam: { hidden: true } } });
  const h = loadBot({ cloud });
  h.ctx.fetchFirestoreDoc_ = (p, ifUnreadable) => ifUnreadable;
  assert.strictEqual(h.ctx.hasActiveInAppPicks_("u_sam", cloud, slate(23)), true);
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
  for (const g of games) {
    if (/11:00\s*AM|10:00\s*AM|10:30\s*AM/i.test(g.kick)) {
      assert.strictEqual(g.cstWindow, "11:00 AM CST Window");
    } else if (/2:30\s*PM|3:00\s*PM/i.test(g.kick)) {
      assert.strictEqual(g.cstWindow, "2:30 PM CST Window");
    } else if (/6:00\s*PM|6:30\s*PM/i.test(g.kick)) {
      assert.strictEqual(g.cstWindow, "6:00 PM / 6:30 PM CST Primetime");
    } else if (/9:15\s*PM|10:00\s*PM/i.test(g.kick)) {
      assert.strictEqual(g.cstWindow, "9:15 PM+ CST Late Night Window");
    }
  }
});

test("Firestore requests carry the owner's OAuth token; ESPN requests don't", () => {
  const h = loadBot({ cloud: baseCloud({ customGames: realSlate }), espnBody: espnBoard(realSlate, "in") });
  h.ctx.pollEspnLiveGamesSubMinute();
  const fs = h.calls.filter((c) => c.url.indexOf("firestore.googleapis.com") !== -1);
  const espn = h.calls.filter((c) => c.url.indexOf("espn.com") !== -1);
  assert.ok(fs.length > 0 && fs.every((c) => c.params.headers && c.params.headers.Authorization === "Bearer owner-token"));
  assert.ok(espn.length > 0 && espn.every((c) => !c.params.headers));
});

test("missing cloud picks triggers automatic re-scan of cached spreadsheet email", () => {
  const email = {
    id: "m-sheet9-cached", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const wipedMembers = [
    { name: "Adam L", priorPts: 120, picks: {}, awaitingSheet: true }
  ];
  const h = loadBot({
    cloud: baseCloud({ customGames: sheetSlate, poolMembers: wipedMembers, officialSheetSyncedForWeek: 9 }),
    threads: [fakeThread([email])],
    userProps: { PROCESSED_MSG_IDS: JSON.stringify({ "m-sheet9-cached": "2026-10-31" }) },
  });
  h.ctx.runMasterPickemEmailBot(false);
  const w = sharedStateWrites(h).filter((x) => x.poolMembers).pop();
  assert.ok(w, "candidate spreadsheet email was re-scanned to self-heal missing picks");
  const byName = Object.fromEntries(w.poolMembers.map((m) => [m.name, m]));
  assert.strictEqual(byName["Adam L"].picks["2"], "SMU", "picks were restored");
});

test("a sheet with no points column can't wipe the standings; one real 0 goes through", () => {
  const { ctx } = loadBot({ cloud: {} });
  const real = [{ name: "A", priorPts: 40 }, { name: "B", priorPts: 12 }];
  const blank = [{ name: "A", priorPts: 0 }, { name: "B", priorPts: 0 }];
  const corrected = [{ name: "A", priorPts: 40 }, { name: "B", priorPts: 0 }];
  assert.strictEqual(ctx.keepRealLeaderboard_(blank, real), real);
  assert.strictEqual(ctx.keepRealLeaderboard_(corrected, real), corrected);
  assert.strictEqual(ctx.keepRealLeaderboard_(blank, []), blank);
});

// ---------- Who the bot believes (it writes with the owner's login, past the security rules) ----------
const FORGED = '"separatedatturf@gmail.com" <attacker@example.com>';

test("senderAddress_ reads the address itself, whatever the display text says", () => {
  const h = loadBot({ cloud: baseCloud() });
  assert.strictEqual(h.ctx.senderAddress_("Separated At Turf <SeparatedAtTurf@gmail.com>"), "separatedatturf@gmail.com");
  assert.strictEqual(h.ctx.senderAddress_("separatedatturf@gmail.com"), "separatedatturf@gmail.com");
  assert.strictEqual(h.ctx.senderAddress_(FORGED), "attacker@example.com");
});

test("a sheet with the official subject from a stranger is not imported", () => {
  const email = {
    id: "m-evil-1", from: "Stranger <attacker@example.com>", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const h = loadBot({ cloud: baseCloud({ customGames: sheetSlate, officialSheetSyncedForWeek: 8 }), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(sharedStateWrites(h).filter((w) => w.poolMembers).length, 0);
});

test("the official address in a forged display name is not trusted", () => {
  const sheet = {
    id: "m-evil-2", from: FORGED, subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const standings = {
    id: "m-evil-3", from: FORGED, subject: "Separated at Turf Week 9 Standings",
    body: "Overall Standings\n1. Adam L 120\n2. Bob K 118\n3. Cat M 117\n4. Dee N 110\n5. Eve O 100\n6. Fay P 99",
  };
  const h = loadBot({ cloud: baseCloud({ customGames: sheetSlate, officialSheetSyncedForWeek: 8 }), threads: [fakeThread([sheet, standings])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.deepStrictEqual(sharedStateWrites(h).filter((w) => w.poolMembers || w.leaderboard), []);
});

test("a forged form email can't start a new week", () => {
  const email = { id: "m-evil-4", from: FORGED, subject: "Separated at Turf Week 10 Pick'em Form Is Live", body: "Week 10 https://docs.google.com/forms/d/e/abc123/viewform" };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.deepStrictEqual(sharedStateWrites(h).filter((w) => w.currentWeek), []);
});

test("a forged Google Forms receipt can't change anyone's picks", () => {
  const games = slate(23);
  const body = "Michael A\n" + games.map((g) => g.away + " at " + g.home + ": " + g.away).join("\n");
  const email = { id: "m-evil-5", from: '"forms-receipts-noreply@google.com" <attacker@example.com>', subject: "Your picks", body };
  const h = loadBot({ cloud: baseCloud({ customGames: games }), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.deepStrictEqual(h.patches().filter((c) => /pickem_v14_users|private_picks/.test(c.url)), []);
});

test("the real sheet from the official address still imports", () => {
  const email = {
    id: "m-real-1", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const h = loadBot({ cloud: baseCloud({ customGames: sheetSlate, officialSheetSyncedForWeek: 8 }), threads: [fakeThread([email])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(sharedStateWrites(h).filter((w) => w.poolMembers).length, 1);
});

// ---------- A failed read must never look like an empty pool ----------
function failingRead() {
  return (url, params) => (url.indexOf("pickem_v14/shared_state") !== -1 && (params.method || "get").toLowerCase() === "get")
    ? { getResponseCode: () => 503, getContentText: () => "unavailable" } : null;
}

test("the Gmail bot writes nothing when the pool can't be read", () => {
  const email = {
    id: "m-503", subject: "College Pick'em '26 - Week 9 Spreadsheet", body: "Overall Standings\n1. Adam L 120\n2. Bob K 118\n3. Cat M 117\n4. Dee N 110\n5. Eve O 100\n6. Fay P 99",
    attachments: [csvAttachment("College Pick'em '26 - Week 9.csv", officialSheet())],
  };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([email])], extraFetch: failingRead() });
  const out = h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(out.ok, false);
  assert.deepStrictEqual(sharedStateWrites(h), []);
  assert.deepStrictEqual(h.patches().filter((c) => c.url.indexOf("bot_status") === -1), []);
  assert.strictEqual(h.userProps.getProperty("PROCESSED_MSG_IDS"), null);
});

test("the emergency stop doesn't replace the settings when the pool can't be read", () => {
  const h = loadBot({ cloud: baseCloud(), extraFetch: failingRead() });
  h.ctx.emergencyStopEmailLoopAndCleanState();
  assert.deepStrictEqual(sharedStateWrites(h).filter((w) => w.commissionerConfig), []);
});

test("a pick receipt that arrives after the deadline changes nothing", () => {
  const locks = { week: 9, deadlineAt: "2026-11-06T03:00:00Z" };
  const h = loadBot({ cloud: baseCloud(), docs: { "pickem_v14/kickoff_locks": locks } });
  assert.strictEqual(h.ctx.receiptIsLate_(new Date("2026-11-07T18:00:00Z"), baseCloud()), true);
  assert.strictEqual(h.ctx.receiptIsLate_(new Date("2026-11-05T18:00:00Z"), baseCloud()), false);
  assert.strictEqual(h.ctx.receiptIsLate_(new Date("2026-11-07T18:00:00Z"), baseCloud({ currentWeek: 10 })), false, "last week's deadline");
  assert.strictEqual(loadBot({ cloud: baseCloud() }).ctx.receiptIsLate_(new Date(), baseCloud()), false, "no locks yet");

  const games = slate(23);
  const body = ["Michael A"].concat(games.map((g) => g.home)).join("\n");
  const email = { id: "m-late", from: "Separated At Turf <separatedatturf@gmail.com>", subject: "College Pick'em", body, date: new Date("2026-11-07T18:00:00Z") };
  const late = loadBot({ cloud: baseCloud(), docs: { "pickem_v14/kickoff_locks": locks }, threads: [fakeThread([email])] });
  late.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(late.patches().filter((c) => /pickem_v14_users|shared_state/.test(c.url)).length, 0);
  const early = loadBot({ cloud: baseCloud(), docs: { "pickem_v14/kickoff_locks": locks }, threads: [fakeThread([Object.assign({}, email, { date: new Date("2026-11-05T18:00:00Z") })])] });
  early.ctx.runMasterPickemEmailBot(false);
  assert.ok(early.patches().some((c) => c.url.indexOf("pickem_v14_users/michael") !== -1), "an on-time receipt still imports");
});

test("a Google Forms receipt sets nobody's picks (anyone can make a form that mails one here)", () => {
  const body = ["Michael A"].concat(slate(23).map((g) => g.home)).join("\n");
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([{ id: "m-form", from: "Google Forms <forms-receipts-noreply@google.com>", subject: "College Pick'em", body }])] });
  h.ctx.runMasterPickemEmailBot(false);
  assert.strictEqual(h.patches().filter((c) => /pickem_v14_users|shared_state/.test(c.url)).length, 0);
});

test("the dead scheduled-email job is gone (it could save empty settings)", () => {
  assert.strictEqual(typeof loadBot({ cloud: baseCloud() }).ctx.checkAndDispatchScheduledOutboundEmails, "undefined");
});

// Week 13 form layout (2026-11-23): optional rivalry line, record before the team, no "at",
// kickoff in the question description. The old parser read 0 games and the week never reset.
function formHtml(titles) {
  const qs = [[1, "NAME (First   Last)", "Ex: John Doe", 0, null]].concat(titles.map((t, i) => [i + 2, t, "Friday, 11/27 - 2:30 ABC", 2, [[i, [["A" + i, null, null, null, 0], ["H" + i, null, null, null, 0]]]]]));
  return "<script>var FB_PUBLIC_LOAD_DATA_ = " + JSON.stringify([null, ["desc", qs]]) + ";</script>";
}
const NEW_TITLES = ["(7-4) Nebraska\n(9-2) #13 Iowa (-5.5)", "Egg Bowl\n(5-6) Mississippi State\n(7-4) #23 Ole Miss (-18.5)", "(10-1) #3 Notre Dame (-24.5)\n(5-6)   Syracuse"];

test("form questions in the new layout (no 'at', record first, rivalry line) are read", () => {
  const titles = [];
  for (let i = 0; i < 20; i++) titles.push(NEW_TITLES[i % 3]);
  const h = loadBot({ cloud: baseCloud(), extraFetch: (u) => (u.indexOf("docs.google.com/forms") !== -1 ? require("./harness").makeResponse(200, formHtml(titles)) : null) });
  const games = h.ctx.scrapeGoogleFormGames("https://docs.google.com/forms/d/e/x/viewform?embedded=true");
  assert.strictEqual(games.length, 20);
  assert.strictEqual(games[0].away, "Nebraska");
  assert.strictEqual(games[0].home, "Iowa");
  assert.strictEqual(games[0].poolLine, "Iowa -5.5");
  assert.strictEqual(games[1].away, "Mississippi State");
  assert.strictEqual(games[1].home, "Ole Miss");
  assert.strictEqual(games[2].poolLine, "Notre Dame -24.5");
  assert.strictEqual(games[0].kick, "Fri 11/27 2:30 PM ABC");
  assert.strictEqual(games[0].cstWindow, "2:30 PM CST Window");
  assert.strictEqual(games[0].awayCode, "A0");
});

test("a slate email whose form can't be read is reported, logged, and retried", () => {
  const email = { id: "m-slate-13", subject: "College Pick'em '26 - Week 13 Pick Sheet", body: "Week 13 https://docs.google.com/forms/d/e/abc/viewform" };
  const h = loadBot({ cloud: baseCloud(), threads: [fakeThread([email])] });
  h.ctx.scrapeGoogleFormGames = () => [];
  h.ctx.runMasterPickemEmailBot(false);
  const status = botStatusWrites(h).pop().gmail;
  assert.strictEqual(status.ok, false);
  assert.ok(status.errors.some((e) => /Week 13/.test(e) && /0 games/.test(e)), status.errors.join());
  assert.ok(status.log.some((l) => /Week 13 Pick Sheet/.test(l)), "the run's log is saved for the commissioner");
  assert.ok(!JSON.parse(h.ctx.PropertiesService.getUserProperties().getProperty("PROCESSED_MSG_IDS") || "{}")["m-slate-13"], "kept for the next run");
});

test("the bot calls the ESPN host that still answers Apps Script", () => {
  const h = loadBot({ cloud: baseCloud() });
  assert.ok(h.ctx.ESPN_SB_BASE_URL.startsWith("https://site.web.api.espn.com/"));
  assert.ok(h.ctx.ESPN_SUMMARY_BASE_URL.startsWith("https://site.web.api.espn.com/"));
});

test("bot writes of standings or members carry a pool version stamp (B103)", () => {
  const h = loadBot({ cloud: baseCloud() });
  h.ctx.patchFirebaseNode("", { leaderboard: [] });
  h.ctx.patchFirebaseNode("", { weekLabel: "Week 9" });
  const bodies = h.patches().filter((c) => /shared_state/.test(c.url)).map((c) => h.patchBody(c));
  assert.ok(bodies[0].poolUpdatedAt, "stamped");
  assert.strictEqual(bodies[1].poolUpdatedAt, undefined, "other writes untouched");
});

test("form kickoff text gets AM/PM and the right window", () => {
  const h = loadBot({ cloud: baseCloud() });
  assert.strictEqual(h.ctx.normalizeFormKick_("Friday, 11/27 - 11:00 CBS"), "Fri 11/27 11:00 AM CBS");
  assert.strictEqual(h.ctx.normalizeFormKick_("Saturday, 11/28 - 8:00 FOX"), "Sat 11/28 8:00 PM FOX");
  assert.strictEqual(h.ctx.normalizeFormKick_("Saturday, 11/28 - 2:30 PM ESPN"), "Sat 11/28 2:30 PM ESPN");
  assert.strictEqual(h.ctx.normalizeFormKick_("TBD"), "TBD");
  const win = (k) => h.ctx.buildGamesArrayFromLines(["Away 5-6", "at Home 7-4 (-3.5)", k])[0].cstWindow;
  assert.strictEqual(win("Sat 11/28 11:00 AM ABC"), "11:00 AM CST Window");
  assert.strictEqual(win("Sat 11/28 2:00 PM CW"), "2:30 PM CST Window");
  assert.strictEqual(win("Fri 11/27 8:00 PM FOX"), "6:00 PM / 6:30 PM CST Primetime");
  assert.strictEqual(win("Sat 11/28 9:15 PM ESPN"), "9:15 PM+ CST Late Night Window");
});

test("standings record the last finished week they include", () => {
  const h = loadBot({ cloud: baseCloud() });
  assert.strictEqual(h.ctx.standingsThroughWeek_("College Pick'em '26 - Week 13 Pick Sheet / Standings", "Week 12 - Top 5\n1 Mike W 22", 13), 12);
  assert.strictEqual(h.ctx.standingsThroughWeek_("College Pick'em '26 - Week 13 Pick Sheet / Standings", "no top five here", 13), 12);
  assert.strictEqual(h.ctx.standingsThroughWeek_("Separated at Turf Week 8 Standings", "Overall", 8), 8);
  assert.strictEqual(h.ctx.standingsThroughWeek_("Standings", "Overall", null), null);
  const email = { id: "m-st8b", subject: "Separated at Turf Week 8 Standings",
    body: "Overall Standings\n1. Adam L 120\n2. Bob K 118\n3. Cat M 117\n4. Dee N 110\n5. Eve O 100\n6. Fay P 99" };
  const run = loadBot({ cloud: baseCloud(), threads: [fakeThread([email])] });
  run.ctx.runMasterPickemEmailBot(false);
  assert.ok(sharedStateWrites(run).some((w) => w.standingsThroughWeek === 8));
});

test("the standings email's Week Top 5 and comment become the weekly recap", () => {
  const h = loadBot({ cloud: baseCloud() });
  const body = "*Good Morning!!*\n\n Week 12 - Top 5\n1 Mike W 22\nGarrett M 22\n3 Chad C 21\n\nMike W wins on a tiebreaker!!\nTennessee beat LSU 27-13.\n\n*Overall Standings*\n1 Steve M 209";
  const r = h.ctx.parseWeekRecap_(body);
  assert.strictEqual(r.week, 12);
  assert.strictEqual(JSON.stringify(r.top.map((t) => [t.rank, t.name, t.pts])), JSON.stringify([[1, "Mike W", 22], [1, "Garrett M", 22], [3, "Chad C", 21]]));
  assert.strictEqual(r.note, "Mike W wins on a tiebreaker!! Tennessee beat LSU 27-13.");
  assert.strictEqual(h.ctx.parseWeekRecap_("Overall Standings\n1 Steve M 209"), null);
});

test("injury feed rows become per-team reports; old games are dropped, new teams merged", () => {
  const feed = [
    { player: "Hank Brown", position: "QB", IR: "Out", injury_type: "Shoulder", ReturnDate: "", RotoSchoolName: "Iowa", game_datetime: "2026-11-27 17:00:00" },
    { player: "Rae Jones", position: "WR", IR: "Out For Season", injury_type: "Knee", RotoSchoolName: "Iowa", game_datetime: "2026-11-27 17:00:00" },
    { player: "Ty Rule", position: "RB", IR: "Questionable", injury_type: "Ankle", RotoSchoolName: "Nebraska", game_datetime: "2026-11-27 17:00:00" },
  ];
  const old = { teams: { "Kent State": { list: [{ p: "X", st: "OUT" }], gameAt: "2020-01-01 00:00:00" }, "Ohio State": { list: [{ p: "Y", st: "OUT" }], gameAt: "2099-01-01 00:00:00" } } };
  const h = loadBot({ cloud: baseCloud(), docs: { "live_games/injuries": old }, extraFetch: (u) => (u.indexOf("rotowire.com") !== -1 ? require("./harness").makeResponse(200, feed) : null) });
  const t = h.ctx.injuryTeamsFromFeed_(feed);
  assert.strictEqual(t.Iowa.list.length, 2);
  assert.strictEqual(t.Iowa.list[1].st, "OUT");
  assert.ok(/season/.test(t.Iowa.list[1].note));
  assert.strictEqual(t.Nebraska.list[0].st, "QUESTIONABLE");
  const r = h.ctx.syncInjuryReports_();
  assert.strictEqual(r.changed, true);
  const w = h.patches().filter((c) => /live_games\/injuries/.test(c.url)).map((c) => h.patchBody(c)).pop();
  assert.deepStrictEqual(Object.keys(w.teams).sort(), ["Iowa", "Nebraska", "Ohio State"], "Kent State's old game dropped, Ohio State kept");
  assert.strictEqual(w.source, "RotoWire");
});

// Next season's Week 1: the bot must start a new season (week 1, standings at 0, last season's
// history kept under "s<year>_week_N"), but a lower week mid-season must never reset anything.
function seasonRun(cloudOver, now, docs) {
  const formEmail = { id: "m-form-s1", subject: "Separated at Turf Week 1 Pick'em Form Is Live", body: "Week 1 https://docs.google.com/forms/d/e/x/viewform" };
  const cloud = baseCloud(Object.assign({ currentWeek: 14, weekLabel: "Week 14", poolMembers: [{ name: "Adam L", priorPts: 300, priorRank: 1, picks: {} }] }, cloudOver));
  const h = loadBot({ cloud, docs: Object.assign({ "pickem_v14/shared_state": cloud }, docs), threads: [fakeThread([formEmail])], isoDay: 2 });
  const RealDate = Date;
  h.ctx.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return new RealDate(now).getTime(); } };
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1);
  h.ctx.runMasterPickemEmailBot(false);
  return h;
}

test("next season's Week 1 slate starts a new season and keeps last season's history", () => {
  const h = seasonRun({}, "2027-08-20T15:00:00Z", { "pickem_v14_archives/week_13": { weekNum: 13, games: [] } });
  const w = sharedStateWrites(h).find((x) => x.currentWeek === 1);
  assert.ok(w, "rolled over to Week 1");
  assert.strictEqual(w.season, 2027);
  assert.strictEqual(w.poolMembers[0].priorPts, 0);
  assert.strictEqual(Object.keys(w.weekArchives).length, 0);
  assert.ok(h.patches().some((c) => /pickem_v14_archives\/s2026_week_13$/.test(c.url.split("?")[0])), "week 13 copied to 2026 history");
  assert.ok(archiveWrite(h, "week_14"), "outgoing week 14 saved (renamed with the rest when listed)");
  assert.ok(h.calls.some((c) => (c.params.method || "") === "delete" && /pickem_v14_archives\/week_13$/.test(c.url)), "old week_13 doc removed");
});

test("a lower week mid-season, or before July, never resets the pool", () => {
  for (const now of ["2026-11-25T15:00:00Z", "2027-01-05T15:00:00Z"]) {
    const h = seasonRun({}, now);
    assert.ok(!sharedStateWrites(h).some((x) => x.currentWeek === 1), "no reset on " + now);
  }
});

test("rollover keeps each player's app picks for the outgoing week (Past weeks)", () => {
  const formEmail = { id: "m-form-10p", subject: "Separated at Turf Week 10 Pick'em Form Is Live", body: "Week 10 https://docs.google.com/forms/d/e/x/viewform" };
  const cloud = baseCloud();
  const h = loadBot({
    cloud, threads: [fakeThread([formEmail])], isoDay: 2,
    docs: {
      "pickem_v14/shared_state": cloud,
      "pickem_v14_users/adam": { displayName: "Adam L", currentWeek: 9, picks: { 1: "Away Team 0" }, tiebreaker: "28-24" },
      "pickem_v14_users/old": { displayName: "Old", currentWeek: 8, picks: { 1: "Home Team 0" } },
    },
  });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1).map((g) => Object.assign({}, g, { away: "New " + g.away }));
  h.ctx.runMasterPickemEmailBot(false);
  const w = sharedStateWrites(h).find((x) => x.currentWeek === 10);
  const cp = archiveWrite(h, "week_9").customPicks;
  assert.strictEqual(cp.adam.picks["1"], "Away Team 0");
  assert.strictEqual(cp.adam.tiebreaker, "28-24");
  assert.strictEqual(cp.old, undefined, "a doc still on an older week is left out");
});

// B113: the archive and the new week's reset shared the same member rows, so clearing picks
// for the new week also emptied them in the archive (Weeks 9-12 lost everyone's sheet picks).
test("rollover archive keeps last week's pool picks after the reset clears them", () => {
  const formEmail = { id: "m-form-10q", subject: "Separated at Turf Week 10 Pick'em Form Is Live", body: "Week 10 https://docs.google.com/forms/d/e/x/viewform" };
  const cloud = baseCloud({ poolMembers: [{ name: "Adam L", picks: { 1: "Away Team 0" } }], watchlist: [{ name: "Adam L", picks: { 1: "Away Team 0" } }] });
  const h = loadBot({ cloud, threads: [fakeThread([formEmail])], isoDay: 2 });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1).map((g) => Object.assign({}, g, { away: "New " + g.away }));
  h.ctx.runMasterPickemEmailBot(false);
  const w = sharedStateWrites(h).find((x) => x.currentWeek === 10);
  assert.strictEqual(Object.keys(w.poolMembers[0].picks).length, 0, "new week starts empty");
  const arch = archiveWrite(h, "week_9");
  assert.strictEqual(arch.poolMembers[0].picks["1"], "Away Team 0", "archive keeps the picks");
  assert.strictEqual(arch.watchlist[0].picks["1"], "Away Team 0");
});


function archiveWrite(h, key) {
  const c = h.patches().filter((x) => x.url.split("?")[0].endsWith("/pickem_v14_archives/" + key)).pop();
  return c ? h.patchBody(c) : null;
}

test("if the archive doc can't be written, the week is kept in shared_state as before", () => {
  const { makeResponse } = require("./harness");
  const formEmail = { id: "m-form-10r", subject: "Separated at Turf Week 10 Pick'em Form Is Live", body: "Week 10 https://docs.google.com/forms/d/e/x/viewform" };
  let h;
  h = loadBot({
    threads: [fakeThread([formEmail])], isoDay: 2,
    fetchHandler: (url, p) => {
      const m = (p.method || "get").toLowerCase();
      if (url.indexOf("espn.com") !== -1) return makeResponse(200, { events: [] });
      if (m === "get") return url.indexOf("/pickem_v14/shared_state") !== -1 ? makeResponse(200, { fields: h.ctx.toFirestoreValue(baseCloud()).mapValue.fields }) : makeResponse(200, { documents: [] });
      if (url.indexOf("/pickem_v14_archives/") !== -1) return makeResponse(403, { error: { status: "PERMISSION_DENIED" } });
      return makeResponse(200, {});
    },
  });
  h.ctx.scrapeGoogleFormGames = () => slate(23, 1).map((g) => Object.assign({}, g, { away: "New " + g.away }));
  h.ctx.runMasterPickemEmailBot(false);
  const w = sharedStateWrites(h).find((x) => x.currentWeek === 10);
  assert.ok(w && w.weekArchives && w.weekArchives.week_9, "week 9 kept in shared_state.weekArchives");
});
