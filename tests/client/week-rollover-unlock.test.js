"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mock browser globals for testing public/js logic in node
global.window = global;
global.state = {};
global.GAMES = [];
global.LIVE_SCORES = {};
global.AUTH_SESSION = null;
global.activeProfile = "michael";

// Mock helper functions used by simple-mode-commissioner & commissioner-admin
global.showAppToast = () => {};
global.saveLocalState = () => {};
global.renderSimpleGuestAccountBar = () => {};
global.renderAll = () => {};
global.syncManualLockButtonUI = () => {};
global.getProfileDisplayMeta = (p) => ({ name: p });
global.getProfileLinkedToMemberName = () => null;
global.standardizeParticipantName = (s) => String(s || "").trim();
global.forceUnlockFlagIsCurrent = () => false;
global.getAutoUnhideReason = () => "";
global.bindAuthenticatedAccountToProfile = async () => {};
global.pickSide = () => {};
global.pickSideForProfile = () => {};
global.saveCurrentWeekToArchive = () => {};
global.isVerifiedCommissioner = () => false;
global.saveCommissionerConfigToCloud = () => {};
global.openCommissionerModal = () => {};
global.renderGames = () => {};
global.updateSingleGameCardPickUI = () => {};
global.switchMainView = () => {};
global.renderCommissionerModalBody = () => {};
global.countMatchingPicksForSlate = () => ({ total: 0, matched: 0 });
global.document = {
  getElementById: () => null
};

// Load commissioner config, deadline functions, and firestore helpers
const simpleCommishSrc = fs.readFileSync(path.join(__dirname, "../../public/js/simple-mode-commissioner.js"), "utf8");
const commishAdminSrc = fs.readFileSync(path.join(__dirname, "../../public/js/commissioner-admin.js"), "utf8");
const firestoreSrc = fs.readFileSync(path.join(__dirname, "../../public/js/firestore.js"), "utf8");
const teamMatchSrc = fs.readFileSync(path.join(__dirname, "../../public/js/team-match.js"), "utf8");

global.TEAM_RANKS = {};
global.findGameById = function(id) {
  var targetId = Number(id);
  for (var i = 0; i < (global.GAMES || []).length; i++) {
    if (Number(global.GAMES[i].id) === targetId) return global.GAMES[i];
  }
  return null;
};

// Run in current context so top-level declarations bind to global
vm.runInThisContext(simpleCommishSrc);
vm.runInThisContext(commishAdminSrc);
vm.runInThisContext(firestoreSrc);
vm.runInThisContext(teamMatchSrc);

test("DEADLINE_DAYS starts on Sunday so Sunday does not falsely evaluate as past Friday deadline", () => {
  assert.strictEqual(DEADLINE_DAYS[0], "Sun");
  assert.strictEqual(DEADLINE_DAYS[5], "Fri");
  assert.strictEqual(DEADLINE_DAYS.indexOf("Sun") < DEADLINE_DAYS.indexOf("Fri"), true);
});

test("isPastPickDeadline returns false when slate has upcoming future games", () => {
  const futureMs = Date.now() + 48 * 3600000; // 2 days in the future
  global.GAMES = [
    { id: 101, away: "Georgia", home: "Texas", kickoffIso: new Date(futureMs).toISOString() },
    { id: 102, away: "Ohio State", home: "Penn State", kickoffIso: new Date(futureMs + 3600000).toISOString() }
  ];
  assert.strictEqual(isPastPickDeadline(), false);
});

test("unlockPicksForNewWeek unlocks all profiles, clears game overrides, and resets global lock", () => {
  global.state = {
    currentWeek: 9,
    michael: { picks: { 1: "H" }, userLockedPicks: true, userLockedWeek: 9 },
    kinyion: { picks: { 1: "A" }, userLockedPicks: true, userLockedWeek: 9 },
    commissionerConfig: {
      lockMode: "global_locked",
      gameLockOverrides: { "101": "locked" },
      savedReceiptsLog: { "receipt1": true }
    }
  };

  assert.strictEqual(isCurrentProfileManuallyLocked("michael"), true);
  assert.strictEqual(isCurrentProfileManuallyLocked("kinyion"), true);

  // Rollover to Week 10
  global.state.currentWeek = 10;
  unlockPicksForNewWeek(9, 10);

  // 1. User locks are cleared
  assert.strictEqual(global.state.michael.userLockedPicks, false);
  assert.strictEqual(global.state.kinyion.userLockedPicks, false);
  assert.strictEqual(global.state.michael.userLockedWeek, undefined);
  assert.strictEqual(isCurrentProfileManuallyLocked("michael"), false);
  assert.strictEqual(isCurrentProfileManuallyLocked("kinyion"), false);

  // 2. Commissioner lockMode is reset from global_locked to friday_9pm_cst
  assert.strictEqual(global.state.commissionerConfig.lockMode, "friday_9pm_cst");

  // 3. Game overrides and receipt logs are wiped
  assert.deepStrictEqual(global.state.commissionerConfig.gameLockOverrides, {});
  assert.deepStrictEqual(global.state.commissionerConfig.savedReceiptsLog, {});
});

test("isCurrentProfileManuallyLocked auto-unlocks legacy profile without userLockedWeek", () => {
  global.state = {
    currentWeek: 10,
    u_u2cantcme2: { picks: { 1: "H" }, userLockedPicks: true } // no userLockedWeek
  };
  global.activeProfile = "u_u2cantcme2";

  // Undefined userLockedWeek must NOT stay locked
  assert.strictEqual(isCurrentProfileManuallyLocked("u_u2cantcme2"), false);
  assert.strictEqual(global.state.u_u2cantcme2.userLockedPicks, false);
});

test("isCurrentProfileManuallyLocked auto-unlocks stale locks from prior weeks", () => {
  global.state = {
    currentWeek: 10,
    michael: { picks: { 1: "H" }, userLockedPicks: true, userLockedWeek: 9 }
  };
  global.activeProfile = "michael";

  // When checked in Week 10, a Week 9 lock auto-unlocks
  assert.strictEqual(isCurrentProfileManuallyLocked("michael"), false);
  assert.strictEqual(global.state.michael.userLockedPicks, false);
});

test("withStaleClearFlagDropped strips stale userLockedPicks from incoming cloud data", () => {
  global.state = { currentWeek: 10 };
  const incomingStale = { userLockedPicks: true, userLockedWeek: 9, picks: {} };
  const incomingLegacy = { userLockedPicks: true, picks: {} };
  const incomingCurrent = { userLockedPicks: true, userLockedWeek: 10, picks: {} };

  const cleanedStale = withStaleClearFlagDropped(incomingStale);
  assert.strictEqual(cleanedStale.userLockedPicks, false);

  const cleanedLegacy = withStaleClearFlagDropped(incomingLegacy);
  assert.strictEqual(cleanedLegacy.userLockedPicks, false);

  const keptCurrent = withStaleClearFlagDropped(incomingCurrent);
  assert.strictEqual(keptCurrent.userLockedPicks, true);
});

test("resolveTiebreakerGame resolves explicit state.tiebreakerGameId (Game 19 Miami at Notre Dame)", () => {
  global.GAMES = [
    { id: 9, away: "Arkansas", home: "Auburn", isTiebreaker: false, tier: "Core Lock" },
    { id: 19, away: "Miami", home: "Notre Dame", isTiebreaker: true, tier: "Lean (Tiebreaker Game)" }
  ];
  global.state = { tiebreakerGameId: 19 };
  const tb = resolveTiebreakerGame();
  assert.strictEqual(tb.id, 19);
  assert.strictEqual(tb.away, "Miami");
  assert.strictEqual(tb.home, "Notre Dame");
});

test("resolveTiebreakerGame falls back to isTiebreaker flag when state.tiebreakerGameId is null", () => {
  global.GAMES = [
    { id: 9, away: "Arkansas", home: "Auburn", isTiebreaker: false, tier: "Core Lock" },
    { id: 19, away: "Miami", home: "Notre Dame", isTiebreaker: true, tier: "Lean (Tiebreaker Game)" }
  ];
  global.state = { tiebreakerGameId: null };
  const tb = resolveTiebreakerGame();
  assert.strictEqual(tb.id, 19);
});
