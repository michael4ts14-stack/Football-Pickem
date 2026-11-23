"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// B100: a commissioner tab on last week must not save its old slate over the bot's new week.
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

function txDb(cloud) {
  const sets = [];
  const ref = { id: "shared_state" };
  return {
    sets,
    collection: () => ({ doc: () => ref }),
    runTransaction: (fn) => fn({
      get: () => Promise.resolve({ exists: true, data: () => cloud }),
      set: (r, data, opts) => { sets.push({ data, opts }); },
    }),
  };
}

test("a tab still on last week does not save over the newer week, and switches to it", async () => {
  const db = txDb({ currentWeek: 13, customGames: [{ id: 1 }] });
  fsDb = db;
  state = { currentWeek: 12 };
  let applied = null;
  applyRemoteCloudData = (d) => { applied = d; };
  const saved = await setSharedIfNotStale({ customGames: [{ id: 99 }] }, { merge: true });
  assert.strictEqual(saved, false);
  assert.strictEqual(db.sets.length, 0);
  assert.strictEqual(applied.currentWeek, 13);
});

test("a tab on the current week still saves", async () => {
  const db = txDb({ currentWeek: 13 });
  fsDb = db;
  state = { currentWeek: 13 };
  assert.strictEqual(await setSharedIfNotStale({ leaderboard: [] }, { merge: true }), true);
  assert.strictEqual(db.sets.length, 1);
});
