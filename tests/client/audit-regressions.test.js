"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.window = global;
global.state = {};
global.GAMES = [];
global.LIVE_SCORES = {};
global.AUTH_SESSION = null;
global.activeProfile = "michael";
global.showAppToast = () => {};
global.saveLocalState = () => {};
global.renderAll = () => {};
global.renderSimpleGuestAccountBar = () => {};
global.syncManualLockButtonUI = () => {};
global.isVerifiedCommissioner = () => true;
global.countMatchingPicksForSlate = () => ({ total: 0, matched: 0 });
global.document = { getElementById: () => null };
global.TEAM_RANKS = {};
global.getAutoUnhideReason = () => "";
global.bindAuthenticatedAccountToProfile = async () => {};
global.forceUnlockFlagIsCurrent = () => false;
global.getProfileLinkedToMemberName = () => null;
global.standardizeParticipantName = (s) => String(s || "").trim();
global.updateSingleGameCardPickUI = () => {};
global.findGameById = () => null;
global.pickSide = () => {};
global.pickSideForProfile = () => {};
global.saveCurrentWeekToArchive = () => {};
global.openCommissionerModal = () => {};
global.renderCommissionerModalBody = () => {};
global.renderGames = () => {};
global.switchMainView = () => {};
global.getProfileDisplayMeta = (p) => ({ name: p });

for (const f of ["simple-mode-commissioner.js", "firestore.js", "team-match.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../public/js", f), "utf8"));
}
global.saveCommissionerConfigToCloud = () => {};
global.saveCurrentState = () => {};
global.updateWeekBrandingUI = () => {};
global.regradeAllPoolMembersLive = () => {};

// Week of Mon Nov 2 2026. Times are UTC; Central is UTC-6 here.
const SAT_KICK = "2026-11-07T17:00:00Z";
const slate = (...isos) => isos.map((kickoffIso, i) => ({ id: i + 1, away: "A", home: "B", kickoffIso }));
const fridayDeadline = () => {
  global.state = { commissionerConfig: { deadlineConfig: { day: "Fri", time: "21:00", tz: "America/Chicago" } } };
};

function at(t, iso) { t.mock.timers.enable({ apis: ["Date"], now: new Date(iso) }); }

test("deadline is open before Friday 9 PM CT for this week's slate", (t) => {
  at(t, "2026-11-07T02:59:00Z"); fridayDeadline(); global.GAMES = slate(SAT_KICK);
  assert.strictEqual(isPastPickDeadline(), false);
});

test("deadline closes at Friday 9 PM CT even though kickoffs are over 12 hours away", (t) => {
  at(t, "2026-11-07T03:00:00Z"); fridayDeadline();
  global.GAMES = slate(SAT_KICK, "2026-11-08T03:30:00Z");
  assert.strictEqual(isPastPickDeadline(), true);
});

test("last week's slate stays closed on Sunday", (t) => {
  at(t, "2026-11-08T18:00:00Z"); fridayDeadline(); global.GAMES = slate(SAT_KICK);
  assert.strictEqual(isPastPickDeadline(), true);
});

test("a new slate posted on Sunday is open", (t) => {
  at(t, "2026-11-08T18:00:00Z"); fridayDeadline(); global.GAMES = slate("2026-11-14T17:00:00Z");
  assert.strictEqual(isPastPickDeadline(), false);
});

test("a Sunday deadline is not already passed on Tuesday", (t) => {
  at(t, "2026-11-03T18:00:00Z");
  global.state = { commissionerConfig: { deadlineConfig: { day: "Sun", time: "12:00", tz: "America/Chicago" } } };
  global.GAMES = slate(SAT_KICK);
  assert.strictEqual(isPastPickDeadline(), false);
});

test("one wrongly matched far-future game doesn't reopen a closed week", (t) => {
  at(t, "2026-11-07T04:00:00Z"); fridayDeadline();
  global.GAMES = slate(SAT_KICK, SAT_KICK, "2026-12-05T17:00:00Z");
  assert.strictEqual(isPastPickDeadline(), true);
});

test("without kickoff times the calendar week still applies", (t) => {
  at(t, "2026-11-08T18:00:00Z"); fridayDeadline(); global.GAMES = [{ id: 1, away: "A", home: "B" }];
  assert.strictEqual(isPastPickDeadline(), true);
});

test("new-week reset on a Saturday clears picks, the sheet guard and cloud clear flags", (t) => {
  at(t, "2026-11-07T20:00:00Z");
  const updates = [];
  global.fsDb = { collection: () => ({ doc: () => ({ update: (d) => { updates.push(d); return Promise.resolve(); } }) }) };
  global.canWriteSharedPoolState = () => true;
  global.LIVE_SCORES = {};
  global.state = {
    currentWeek: 11, lastScrapedFile: "Week 10.xlsx", deletedPicksByMember: { sam: true },
    commissionerConfig: {},
    poolMembers: [{ name: "Sam", picks: { 1: "A" } }],
  };
  resetPoolPicksForNewWeek(false);
  assert.deepStrictEqual(state.poolMembers[0].picks, {});
  assert.ok(!state.lastScrapedFile, "guard must allow the emptied pool to reach the cloud");
  assert.deepStrictEqual(updates, [{ deletedPicksByMember: {} }]);
});

test("a lock from a newer week survives a snapshot that arrives before the week does", () => {
  global.state = { currentWeek: 9 };
  const p = withStaleClearFlagDropped({ userLockedPicks: true, userLockedWeek: 10, picks: {} });
  assert.strictEqual(p.userLockedPicks, true);
  const old = withStaleClearFlagDropped({ userLockedPicks: true, userLockedWeek: 8, picks: {} });
  assert.strictEqual(old.userLockedPicks, false);
});

test("pickDeadlineMs gives the instant of Friday 9 PM Central for the slate's week", () => {
  fridayDeadline(); global.GAMES = slate(SAT_KICK);
  assert.strictEqual(new Date(pickDeadlineMs()).toISOString(), "2026-11-07T03:00:00.000Z");
  global.GAMES = [{ id: 1 }];
  assert.strictEqual(pickDeadlineMs(), null);
});

test("hidden picks stay out of everything public until the reveal", () => {
  global.getProfileLinkedToMemberName = (n) => (n === "Sam" ? { key: "u_sam" } : null);
  global.state = { profilePrivacy: { u_sam: { hidden: true } }, u_sam: { picks: { 1: "A" }, tiebreaker: "9-7", target: 5 }, u_pat: { picks: { 1: "B" } } };
  const pub = publicProfileCopy("u_sam");
  assert.deepStrictEqual(pub, { picks: {}, tiebreaker: "", target: 5, picksPrivate: true });
  assert.deepStrictEqual(state.u_sam.picks, { 1: "A" }, "the device's own copy is untouched");
  assert.deepStrictEqual(publicProfileCopy("u_pat").picks, { 1: "B" });
  const rows = publicRowsWithoutHiddenPicks([{ name: "Sam", picks: { 1: "A" }, tiebreaker: "9-7" }, { name: "Pat", picks: { 1: "B" } }]);
  assert.deepStrictEqual(rows[0].picks, {});
  assert.strictEqual(rows[0].tiebreaker, "");
  assert.deepStrictEqual(rows[1].picks, { 1: "B" });
  state.currentWeek = 10;
  state.forceRevealWeek = 9; // last week's reveal has expired
  assert.deepStrictEqual(publicRowsWithoutHiddenPicks([{ name: "Sam", picks: { 1: "A" } }])[0].picks, {});
  state.forceRevealWeek = 10; // a forced reveal can be undone, so it never reaches public rows
  assert.deepStrictEqual(publicRowsWithoutHiddenPicks([{ name: "Sam", picks: { 1: "A" } }])[0].picks, {});
});

test("a public copy without picks never wipes picks this device holds", () => {
  global.state = { u_sam: { picks: { 1: "A" }, tiebreaker: "9-7" } };
  assert.deepStrictEqual(mergePrivateProfile("u_sam", { picks: {}, tiebreaker: "", picksPrivate: true }).picks, { 1: "A" });
  assert.deepStrictEqual(mergePrivateProfile("u_sam", { picks: { 2: "B" } }).picks, { 2: "B" });
});

test("removing a player and deleting picks go through the hidden-picks filter", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "../../public/js", f), "utf8");
  assert.match(read("account-security.js"), /shared\.poolMembers = publicRowsWithoutHiddenPicks\(/);
  const del = read("commissioner-admin.js");
  assert.match(del, /sharedClearPatch\[pk\] = publicProfileCopy\(pk\)/);
  assert.match(del, /pickem_v14_private_picks/);
});

test("the team directory is loaded from this site: ESPN's /teams endpoint has no CORS header", () => {
  const espn = fs.readFileSync(path.join(__dirname, "../../public/js/espn.js"), "utf8");
  assert.doesNotMatch(espn, /college-football\/teams\?limit/);
  const dir = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/js/data/espn-teams.json"), "utf8"));
  const names = dir.sports[0].leagues[0].teams.map((t) => t.team.location);
  assert.ok(names.length >= 120 && names.length < 150 && names.includes("Alabama") && names.includes("Wyoming"));
});
