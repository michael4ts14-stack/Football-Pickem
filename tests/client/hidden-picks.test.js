"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// firestore.js runs against a fake Firestore that records every write.
global.window = global;
global.fsDb = null;
global.countMatchingPicksForSlate = () => ({ total: 2, matched: 2 });
global.isApplyingRemoteUpdate = false;
global.lastLocalPickTs = 0;
global.USER_DOC_META = {};
global.state = {};
global.GAMES = [];
global.document = { getElementById: () => null, addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.AUTH_SESSION = { uid: "u1", boundProfileKey: "u_sam" };
global.activeProfile = "u_sam";
global.VIEWING_ARCHIVE_KEY = "";
global.isVerifiedCommissioner = () => false;
global.canSaveProfileToCloud = () => true;
global.getProfileMetaByKey = () => ({ name: "Sam" });
global.getLinkedMemberNameForProfile = () => "Sam";
global.bindingOwnerUid = () => "u1";
global.showAppToast = () => {};
global.isPickSheetClosedFor = () => false;
global.ensureCommissionerConfig = () => global.CFG;
global.sharedWeekFields = () => ({ currentWeek: 10 });
global.slateKickoffsMs = () => [];
global.pickDeadlineMs = () => null;
global.resolveTiebreakerGame = () => null;
global.isProfileArchived = () => false;
global.picksLookLikeAnotherWeek = () => false;
global.hasPendingProfileSave = () => false;
global.hasSubmittedPicksForCurrentSlate = (p) => Object.keys(p || {}).length > 0;
global.standardizeParticipantName = (s) => String(s || "");
global.boundMemberName = () => "";
global.pickDocMemberName = (id, d) => d.linkedMemberName || d.displayName || "";
global.safeProfileColor = (c) => c;
global.isDuplicateProfileKey = () => false;
global.ensureMultiUserAndPrivacyState = () => {};
global.invalidateDuesRosterCache = () => {};
global.getProfileLinkedToMemberName = (n) => (n === "Sam" ? { key: "u_sam" } : null);
global.firebase = { firestore: { FieldValue: { delete: () => "DELETE" }, Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) } } };

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../../public/js/firestore.js"), "utf8"));

function fakeDb(privateDocs = {}) {
  const writes = [];
  const ref = (col, id) => ({
    col, id,
    get: () => Promise.resolve(privateDocs[id] ? { exists: true, id, data: () => privateDocs[id] } : { exists: false, id, data: () => undefined }),
    set: (data) => { writes.push({ col, id, data }); return Promise.resolve(); },
  });
  return {
    writes,
    collection: (col) => ({ doc: (id) => ref(col, id), onSnapshot: () => () => {} }),
    batch: () => {
      const ops = [];
      return {
        set: (r, data) => ops.push({ col: r.col, id: r.id, data }),
        delete: (r) => ops.push({ col: r.col, id: r.id, deleted: true }),
        commit: () => { writes.push(...ops); return Promise.resolve(); },
      };
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 5));
const privateWrites = (db) => db.writes.filter((w) => w.col === "pickem_v14_private_picks");

function reset(db, extra) {
  fsDb = db;
  PRIVATE_DOC_LOADED = {};
  PRIVATE_MIGRATED = {};
  PUBLIC_PICK_DOCS = {};
  USER_DOC_META = {};
  KICKOFF_LOCKS_DOC = null;
  KICKOFF_LOCKS_SIG = "";
  global.CFG = { gameLockOverrides: {}, lockMode: "friday_9pm_cst" };
  global.isPickSheetClosedFor = () => false;
  state = Object.assign({ currentWeek: 10, customUsers: [], profilePrivacy: { u_sam: { hidden: true } }, u_sam: { picks: {}, tiebreaker: "28-24", target: 20 } }, extra);
  isApplyingRemoteUpdate = false;
  scheduleRemotePicksRender = () => {};
  pushWatchlistOrStandingsToFirebase = () => {};
}

test("signing in on a new device loads a hidden player's picks instead of erasing them", async () => {
  const db = fakeDb({ u_sam: { picks: { 1: "Iowa", 2: "Utah" }, tiebreaker: "20-10", ownerUid: "u1" } });
  reset(db);
  pushProfileToFirebase("u_sam");
  await flush();
  assert.strictEqual(privateWrites(db).length, 0, "nothing may be written before the private doc is read");
  assert.deepStrictEqual(state.u_sam.picks, { 1: "Iowa", 2: "Utah" });
  assert.strictEqual(state.u_sam.tiebreaker, "20-10");
});

test("a hidden player with no private doc yet saves normally, and later saves skip the read", async () => {
  const db = fakeDb();
  reset(db);
  state.u_sam.picks = { 1: "Iowa" };
  pushProfileToFirebase("u_sam");
  await flush();
  assert.deepStrictEqual(privateWrites(db)[0].data.picks, { 1: "Iowa" });
  assert.strictEqual(db.writes.find((w) => w.col === "pickem_v14_users").data.picks, "DELETE");
  state.u_sam.picks = { 1: "Utah" };
  pushProfileToFirebase("u_sam");
  assert.deepStrictEqual(privateWrites(db)[1].data.picks, { 1: "Utah" });
});

test("after the deadline a pick on a reopened game still saves; otherwise nothing is sent", () => {
  let db = fakeDb();
  reset(db, { profilePrivacy: {} });
  USER_DOC_META.u_sam = {};
  global.isPickSheetClosedFor = () => true;
  pushProfileToFirebase("u_sam");
  assert.strictEqual(db.writes.length, 0);
  global.CFG.gameLockOverrides = { 7: "open" };
  pushProfileToFirebase("u_sam");
  assert.ok(db.writes.some((w) => w.col === "pickem_v14_users"));
  db = fakeDb();
  reset(db, { profilePrivacy: {} });
  global.isPickSheetClosedFor = () => true;
  pushProfileToFirebase("u_sam"); // a brand-new profile has no doc yet
  assert.ok(db.writes.some((w) => w.col === "pickem_v14_users"));
});

test("migration keeps the newer picks: a form submission beats last week's private doc", async () => {
  const db = fakeDb({ u_sam: { picks: { 1: "Old" }, updatedAt: "2026-10-30T00:00:00Z" } });
  reset(db);
  PUBLIC_PICK_DOCS.u_sam = { picks: { 1: "New" }, updatedAt: "2026-11-04T00:00:00Z" };
  migrateExposedHiddenPicks();
  await flush();
  assert.deepStrictEqual(privateWrites(db)[0].data.picks, { 1: "New" });
});

test("migration doesn't overwrite a private doc that is newer", async () => {
  const db = fakeDb({ u_sam: { picks: { 1: "New" }, updatedAt: "2026-11-04T00:00:00Z" } });
  reset(db);
  PUBLIC_PICK_DOCS.u_sam = { picks: { 1: "Old" }, updatedAt: "2026-10-30T00:00:00Z" };
  migrateExposedHiddenPicks();
  await flush();
  assert.strictEqual(privateWrites(db).length, 0);
  assert.strictEqual(db.writes.find((w) => w.col === "pickem_v14_users").data.picks, "DELETE");
});

test("forcing a reveal never copies hidden picks into public rows; the timed reveal may", () => {
  reset(fakeDb(), { forceRevealWeek: 10 });
  const rows = [{ name: "Sam", picks: { 1: "Iowa" }, tiebreaker: "20-10" }];
  assert.deepStrictEqual(publicRowsWithoutHiddenPicks(rows)[0].picks, {});
  KICKOFF_LOCKS_DOC = { week: 10, revealAt: { toMillis: () => Date.now() - 1000 } };
  assert.deepStrictEqual(publicRowsWithoutHiddenPicks(rows)[0].picks, { 1: "Iowa" });
});

test("a device with no kickoff times keeps the locks already written, updating only the overrides", () => {
  const db = fakeDb();
  reset(db);
  global.isVerifiedCommissioner = () => true;
  const windows = [{ at: { toMillis: () => 5 }, ids: ["1"] }];
  const deadlineAt = { toMillis: () => 9 };
  KICKOFF_LOCKS_DOC = { week: 10, windows, deadlineAt, revealAt: deadlineAt, openIds: [], lockedIds: [] };
  KICKOFF_LOCKS_SIG = kickoffLocksSig(KICKOFF_LOCKS_DOC);
  GAMES = [{ id: 1 }, { id: 2 }];
  pushKickoffLocksToFirebase();
  assert.strictEqual(db.writes.length, 0, "unchanged locks aren't rewritten");
  global.CFG.gameLockOverrides = { 2: "locked" };
  pushKickoffLocksToFirebase();
  const w = db.writes[0].data;
  assert.strictEqual(w.deadlineAt, deadlineAt);
  assert.strictEqual(w.windows, windows);
  assert.deepStrictEqual(w.lockedIds, ["2"]);
  global.isVerifiedCommissioner = () => false;
});

test("no kickoff times and no locks for this week: nothing is written", () => {
  const db = fakeDb();
  reset(db);
  global.isVerifiedCommissioner = () => true;
  KICKOFF_LOCKS_DOC = { week: 9, deadlineAt: { toMillis: () => 9 } };
  GAMES = [{ id: 1 }, { id: 2 }];
  pushKickoffLocksToFirebase();
  assert.strictEqual(db.writes.length, 0);
  global.isVerifiedCommissioner = () => false;
});

test("a lock override on a new week's slate is saved even before kickoff times arrive, without last week's locks", () => {
  const db = fakeDb();
  reset(db);
  global.isVerifiedCommissioner = () => true;
  KICKOFF_LOCKS_DOC = { week: 9, windows: [{ at: { toMillis: () => 5 }, ids: ["1"] }], deadlineAt: { toMillis: () => 9 } };
  GAMES = [{ id: 1 }, { id: 2 }];
  global.CFG.gameLockOverrides = { 2: "locked" };
  pushKickoffLocksToFirebase();
  const w = db.writes[0].data;
  assert.deepStrictEqual(w.lockedIds, ["2"]);
  assert.deepStrictEqual(w.windows, []);
  assert.strictEqual(w.deadlineAt, null);
  global.isVerifiedCommissioner = () => false;
});

test("a private doc that arrives during a pending save doesn't count as loaded until it's applied", async () => {
  const db = fakeDb({ u_sam: { picks: { 1: "Iowa", 2: "Utah" }, tiebreaker: "20-10" } });
  reset(db);
  global.hasPendingProfileSave = () => true;
  onPrivatePickDoc("u_sam", { picks: { 1: "Iowa", 2: "Utah" } });
  assert.ok(!PRIVATE_DOC_LOADED.u_sam);
  global.hasPendingProfileSave = () => false;
  state.u_sam.picks = { 3: "One tap" };
  pushProfileToFirebase("u_sam");
  await flush();
  assert.strictEqual(privateWrites(db).length, 0, "the one-tap copy must not replace the saved picks");
  assert.deepStrictEqual(state.u_sam.picks, { 1: "Iowa", 2: "Utah" });
  clearTimeout(deferredPickDocsTimer);
  deferredPickDocsTimer = null;
  DEFERRED_PICK_DOCS = {};
});
