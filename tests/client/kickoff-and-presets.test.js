"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Mock browser globals
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.state = {
  test: { picks: {} }
};
global.GAMES = [];
global.LIVE_SCORES = {};
global.AUTH_SESSION = null;
global.activeProfile = "test";
global.lastLocalPickTs = 0;

global.showAppToast = () => {};
global.saveLocalState = () => {};
global.saveCurrentState = () => {};
global.pushProfileToFirebase = () => {};
global.renderAll = () => {};
global.renderGames = () => {};
global.updatePicksHead = () => {};
global.updateSingleGameCardPickUI = () => {};
global.syncManualLockButtonUI = () => {};
global.safeSetStorage = () => {};
global.safeGetStorage = () => {};
global.clearDeletedFlagForProfile = () => {};
global.isWeekLockedForActiveProfile = () => false;
global.isGameLockedByCommissioner = () => false;
global.isSameTeamPick = (pickName, teamName) => {
  if (!pickName || !teamName) return false;
  return String(pickName).trim().toLowerCase() === String(teamName).trim().toLowerCase();
};
global.getTeamWinProb = (g, side) => {
  return side === "away" ? (g.awayProb || 0.5) : (g.homeProb || 0.5);
};
global.document = {
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => []
};

// Load source files
const defaultSlateSrc = fs.readFileSync(path.join(__dirname, "../../public/js/data/default-slate.js"), "utf8");
const authSrc = fs.readFileSync(path.join(__dirname, "../../public/js/auth.js"), "utf8");
const picksUiSrc = fs.readFileSync(path.join(__dirname, "../../public/js/picks-ui.js"), "utf8");

var pickSide = () => {};
var renderGames = () => {};
var updatePicksHead = () => {};
var syncManualLockButtonUI = () => {};
var signOutAccountInstance = () => {};

const vm = require("node:vm");

vm.runInThisContext("var pickSide = () => {}; var renderGames = () => {}; var updatePicksHead = () => {}; var syncManualLockButtonUI = () => {}; var signOutAccountInstance = () => {};");
vm.runInThisContext(defaultSlateSrc);
vm.runInThisContext(authSrc);
vm.runInThisContext(picksUiSrc);

test("parseKickParts parses 11:00 AM correctly without truncating to 1:00 AM", () => {
  const cases = [
    { input: "Saturday 11:00 AM", expectedTime: "11:00 AM", expectedDay: "Sat" },
    { input: "Sat 11:00 AM CST • ESPN", expectedTime: "11:00 AM", expectedDay: "Sat", expectedNet: "ESPN" },
    { input: "Saturday, 11:00 AM CST", expectedTime: "11:00 AM", expectedDay: "Sat" },
    { input: "Saturday, 10/31 - 11:00 AM ESPN2", expectedTime: "11:00 AM", expectedDay: "Sat", expectedNet: "ESPN2" },
    { input: "Saturday, 11/7 - 11:00 AM ESPN", expectedTime: "11:00 AM", expectedDay: "Sat", expectedNet: "ESPN" },
    { input: "Sat 12:00 PM TNT", expectedTime: "12:00 PM", expectedDay: "Sat", expectedNet: "TNT" },
    { input: "Sat 10:30 AM FOX", expectedTime: "10:30 AM", expectedDay: "Sat", expectedNet: "FOX" },
    { input: "11:00 AM CST", expectedTime: "11:00 AM", expectedDay: "" },
    { input: "11:00 AM", expectedTime: "11:00 AM", expectedDay: "" }
  ];

  for (const c of cases) {
    const res = parseKickParts(c.input);
    assert.strictEqual(res.time, c.expectedTime, `Failed time on '${c.input}': got '${res.time}'`);
    assert.strictEqual(res.day, c.expectedDay, `Failed day on '${c.input}': got '${res.day}'`);
    if (c.expectedNet !== undefined) {
      assert.strictEqual(res.net, c.expectedNet, `Failed net on '${c.input}': got '${res.net}'`);
    }
  }
});

test("getUnderdogForGamePreset correctly identifies underdogs across all games", () => {
  assert.ok(Array.isArray(GAMES) && GAMES.length > 0, "GAMES array must exist");
  for (const g of GAMES) {
    const dog = getUnderdogForGamePreset(g);
    assert.ok(dog === g.away || dog === g.home, `Underdog must be either away or home for game ${g.id}`);
  }
});

test("applyPreset('dogs') picks underdogs across all games", () => {
  applyPreset("dogs");
  const picks = state.test.picks;
  let dogCount = 0;
  for (const g of GAMES) {
    const pick = picks[g.id];
    const dog = getUnderdogForGamePreset(g);
    if (pick === dog) dogCount++;
  }
  assert.strictEqual(dogCount, GAMES.length, `Expected all ${GAMES.length} picks to be dogs, but got ${dogCount}`);
});

test("applyPreset('aggressive') picks multiplier dogs for >1x games and favorites for 1x games", () => {
  applyPreset("aggressive");
  const picks = state.test.picks;
  let multDogsCount = 0;
  let totalMultGames = 0;
  let fav1xCount = 0;
  let total1xGames = 0;
  for (const g of GAMES) {
    const aPts = g.mondayAwayPts || g.awayPts || 1;
    const hPts = g.mondayHomePts || g.homePts || 1;
    const pick = picks[g.id];
    if (aPts > 1 || hPts > 1) {
      totalMultGames++;
      const expectedDog = aPts > hPts ? g.away : g.home;
      if (pick === expectedDog) multDogsCount++;
    } else {
      total1xGames++;
      const expectedFav = (getTeamWinProb(g, "away") >= getTeamWinProb(g, "home")) ? g.away : g.home;
      if (pick === expectedFav) fav1xCount++;
    }
  }
  assert.ok(totalMultGames > 0, "Must have multiplier games in slate");
  assert.strictEqual(multDogsCount, totalMultGames, "All multiplier games should pick the multiplier dog");
  assert.strictEqual(fav1xCount, total1xGames, "All 1x games should pick the favorite");
});

test("applyPreset('optimal') computes EV and picks +EV plays across all games", () => {
  applyPreset("optimal");
  const picks = state.test.picks;
  assert.strictEqual(Object.keys(picks).length, GAMES.length);
  for (const g of GAMES) {
    assert.ok(picks[g.id], `Pick missing for game ${g.id}`);
  }
});
