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

global.document = {
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => []
};

// Global helper mocks needed by import-sheet-grading.js
global.normalizeTeamKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
global.resolveSheetTeamFromCell = (val, g) => {
  if (!val || !g) return null;
  const norm = global.normalizeTeamKey(val);
  if (norm === global.normalizeTeamKey(g.away)) return g.away;
  if (norm === global.normalizeTeamKey(g.home)) return g.home;
  return null;
};
global.getTeamWinProb = (g, side) => {
  return side === "away" ? (g.awayProb || 0.5) : (g.homeProb || 0.5);
};

const vm = require("node:vm");
// Load import-sheet-grading.js into this context
const gradingSrc = fs.readFileSync(path.join(__dirname, "../../public/js/import-sheet-grading.js"), "utf8");
vm.runInThisContext(gradingSrc);

test("getGamePickPts respects base, dog, and monday-locked multipliers", () => {
  const g1 = { id: 1, away: "Ohio State", home: "Indiana", awayPts: 1, homePts: 2 };
  assert.strictEqual(global.getGamePickPts(g1, true), 1);
  assert.strictEqual(global.getGamePickPts(g1, false), 2);

  // Monday locked pts should take precedence over live points
  const g2 = {
    id: 2, away: "Navy", home: "Army",
    awayPts: 1, homePts: 1,
    mondayAwayPts: 3, mondayHomePts: 1
  };
  assert.strictEqual(global.getGamePickPts(g2, true), 3);
  assert.strictEqual(global.getGamePickPts(g2, false), 1);

  // Null game fallback
  assert.strictEqual(global.getGamePickPts(null, true), 1);
});

test("isVoidedGame detects postponed, cancelled, suspended, and forfeited games", () => {
  assert.strictEqual(global.isVoidedGame(null), false);
  assert.strictEqual(global.isVoidedGame({ voided: true }), true);
  assert.strictEqual(global.isVoidedGame({ detail: "Game Cancelled due to weather" }), true);
  assert.strictEqual(global.isVoidedGame({ statusName: "Postponed to Sunday" }), true);
  assert.strictEqual(global.isVoidedGame({ detail: "Suspended in 3rd Quarter" }), true);
  assert.strictEqual(global.isVoidedGame({ statusName: "Forfeit" }), true);
  assert.strictEqual(global.isVoidedGame({ completed: true, awayScore: 24, homeScore: 17 }), false);
});

test("gradeOfPick accurately handles win, loss, push, live, and pending states", () => {
  const g = { id: 10, away: "Alabama", home: "LSU", awayPts: 1, homePts: 2 };

  // Pending (no live score)
  global.LIVE_SCORES = {};
  assert.strictEqual(global.gradeOfPick("Alabama", g), "pending");
  assert.strictEqual(global.gradeOfPick(null, g), "pending");

  // In progress (live)
  global.LIVE_SCORES[10] = { inProgress: true, completed: false, awayScore: 14, homeScore: 10 };
  assert.strictEqual(global.gradeOfPick("Alabama", g), "live");

  // Completed win
  global.LIVE_SCORES[10] = { inProgress: false, completed: true, awayScore: 28, homeScore: 21 };
  assert.strictEqual(global.gradeOfPick("Alabama", g), "win");
  assert.strictEqual(global.gradeOfPick("LSU", g), "loss");

  // Push / tie
  global.LIVE_SCORES[10] = { inProgress: false, completed: true, awayScore: 20, homeScore: 20 };
  assert.strictEqual(global.gradeOfPick("Alabama", g), "push");

  // Voided
  global.LIVE_SCORES[10] = { inProgress: false, completed: true, voided: true, awayScore: 28, homeScore: 21 };
  assert.strictEqual(global.gradeOfPick("Alabama", g), "push");
});

test("gradePickMap calculates full points and dog counts across a slate", () => {
  const g1 = { id: 1, away: "Georgia", home: "Florida", awayPts: 1, homePts: 3 };
  const g2 = { id: 2, away: "Texas", home: "Oklahoma", awayPts: 1, homePts: 2 };
  const g3 = { id: 3, away: "Michigan", home: "Michigan State", awayPts: 1, homePts: 1 };

  global.GAMES = [g1, g2, g3];
  global.LIVE_SCORES = {
    1: { inProgress: false, completed: true, awayScore: 34, homeScore: 20 }, // Georgia wins (1pt chalk win)
    2: { inProgress: false, completed: true, awayScore: 17, homeScore: 24 }, // Oklahoma wins (2pt dog win)
    3: { inProgress: true, completed: false, awayScore: 14, homeScore: 10 }  // Michigan leading (in progress)
  };

  const userPicks = {
    1: "Georgia",  // won 1x
    2: "Oklahoma", // won 2x dog
    3: "Michigan"  // in progress 1x
  };

  const grade = global.gradePickMap(userPicks, false, false);
  assert.strictEqual(grade.finalWonPts, 3); // 1 + 2
  assert.strictEqual(grade.wonGames, 2);
  assert.strictEqual(grade.won1x, 1);
  assert.strictEqual(grade.won2x, 1);
  assert.strictEqual(grade.won3x, 0);
  assert.strictEqual(grade.inProgressPts, 1);
  assert.strictEqual(grade.liveProjectedPts, 4); // 3 final + 1 in progress
  assert.strictEqual(grade.count2x, 1);
});
