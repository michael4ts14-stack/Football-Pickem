"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.window = global;
global.GAMES = [];
global.LIVE_SCORES = {};
global.state = {};
global.TEAM_LOGS = {};
global.document = { getElementById: () => null };
global.normalizeTeamKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
global.invalidateDuesRosterCache = () => {};
global.dropDuplicateAppPoolRows = () => {};
global.ensureWatchlistDefaults = () => {};
global.hasSubmittedPicksForCurrentSlate = () => false;
global.countScoredGamesInLiveScores = () => 0;
global.isHardcodedWeek7Slate = () => false;
global.syncLinkedProfilesWithLeaderboard = () => {};
global.getTeamWinProb = () => 0.5;
global.isProfileArchived = () => false;
global.fixDisplaySpelling = (s) => s;
global.rosterDisplayName = (s) => s;
global.isDuplicateProfileKey = () => false;

const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../public/js", f), "utf8"));
try { load("import-sheet-grading.js"); } catch (e) { if (!(e instanceof ReferenceError)) throw e; }

function player(extra) {
  return Object.assign({ name: "Sam", picks: {}, priorPts: 12 }, extra);
}

test("a leaderboard correction down to exactly 0 points takes effect", () => {
  global.getProfileLinkedToMemberName = () => null;
  global.state = { leaderboard: [{ name: "Sam", priorPts: 0 }, { name: "Pat", priorPts: 40 }], poolMembers: [player()] };
  regradeAllPoolMembersLive();
  assert.strictEqual(state.poolMembers[0].priorPts, 0);
  assert.strictEqual(state.poolMembers[0].newLiveTotal, 0);
});

test("a player with no leaderboard row keeps their points", () => {
  global.getProfileLinkedToMemberName = () => null;
  global.state = { leaderboard: [{ name: "Pat", priorPts: 40 }], poolMembers: [player()] };
  regradeAllPoolMembersLive();
  assert.strictEqual(state.poolMembers[0].priorPts, 12);
});

test("an app account linked to the player doesn't bring old points back", () => {
  global.getProfileLinkedToMemberName = () => null;
  global.state = {
    leaderboard: [{ name: "Sam", priorPts: 0 }],
    poolMembers: [player()],
    customUsers: [{ key: "u_sam", name: "Sam", linkedMemberName: "Sam", priorPts: 12 }],
    u_sam: { picks: {} },
  };
  regradeAllPoolMembersLive();
  assert.strictEqual(state.poolMembers[0].priorPts, 0);
  assert.strictEqual(state.customUsers[0].priorPts, 0);
});
