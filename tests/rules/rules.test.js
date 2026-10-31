// Firestore rules tests against the local emulator (fake project, no production access).
// From the repo root:
//   firebase emulators:exec --config tests/rules/firebase.json --only firestore --project demo-pickem "node --test tests/rules/rules.test.js"
// RULES_FILE=path overrides which rules file is loaded (e.g. to test the old rules).
"use strict";
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc } = require("firebase/firestore");

const RULES = fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
let env;

const MICHAEL = { email: "michael4ts14@gmail.com", email_verified: true };
const FAKE_COMMISH = { email: "commissioner@separatedatturf.com", email_verified: false };
const PLAYER_A = { email: "alice@example.com", email_verified: false };
const PLAYER_B = { email: "bob@example.com", email_verified: true };

test.before(async () => {
  // emulators:exec sets FIRESTORE_EMULATOR_HOST to wherever the emulator actually started.
  env = await initializeTestEnvironment({ projectId: "demo-pickem", firestore: { rules: RULES } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "pickem_v14/shared_state"), {
      currentWeek: 9, weekLabel: "Week 9", poolMembers: [{ name: "Adam L" }], customUsers: [],
      fridayNightRevealOverride: false, commissionerConfig: { lockMode: "friday_9pm_cst" },
    });
    await setDoc(doc(db, "pickem_v14_users/u_alice"), { ownerUid: "alice-uid", picks: { 1: "Arizona" } });
    await setDoc(doc(db, "live_games/week_state"), { currentWeek: 9 });
  });
});

const as = (uid, token) => env.authenticatedContext(uid, token).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const merge = { merge: true };

test("an unverified account named commissioner@... is NOT a commissioner", async () => {
  await assertFails(setDoc(doc(as("x", FAKE_COMMISH), "pickem_v14/shared_state"), { commissionerConfig: { lockMode: "global_locked" } }, merge));
});

test("the verified commissioner can change pool fields and the week", async () => {
  await assertSucceeds(setDoc(doc(as("m", MICHAEL), "pickem_v14/shared_state"), { currentWeek: 10, poolMembers: [] }, merge));
});

test("a signed-in player can save their own profile entry", async () => {
  await assertSucceeds(setDoc(doc(as("alice-uid", PLAYER_A), "pickem_v14/shared_state"),
    { u_alice: { picks: { 1: "Arizona" } }, lastWriterProfileKey: "u_alice", updatedAt: "now" }, merge));
});

test("a player cannot write someone else's profile entry in shared_state", async () => {
  const db = as("bob-uid", PLAYER_B);
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { u_alice: { picks: {} }, lastWriterProfileKey: "u_alice" }, merge));
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { u_alice: { picks: {} }, lastWriterProfileKey: "u_bob" }, merge));
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { u_alice: { picks: {} } }, merge));
});

test("account docs are private to their owner and commissioners", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "pickem_v14_accounts/email_alice_example_com"), { uid: "alice-uid", email: "alice@example.com" });
  });
  const bob = as("bob-uid", PLAYER_B);
  await assertFails(getDoc(doc(bob, "pickem_v14_accounts/email_alice_example_com")));
  await assertFails(setDoc(doc(bob, "pickem_v14_accounts/email_alice_example_com"), { linkedMemberName: "Bob" }, merge));
  await assertFails(getDoc(doc(anon(), "pickem_v14_accounts/email_alice_example_com")));
  await assertSucceeds(setDoc(doc(as("alice-uid", PLAYER_A), "pickem_v14_accounts/email_alice_example_com"), { linkedMemberName: "Alice" }, merge));
  await assertSucceeds(getDoc(doc(as("m", MICHAEL), "pickem_v14_accounts/email_alice_example_com")));
});

test("only commissioners can read the commissioner list", async () => {
  await assertFails(getDoc(doc(as("bob-uid", PLAYER_B), "pickem_v14_commissioners/roles")));
  await assertSucceeds(getDoc(doc(as("m", MICHAEL), "pickem_v14_commissioners/roles")));
});

test("a player's save that re-sends unchanged pool fields still works", async () => {
  await assertSucceeds(setDoc(doc(as("alice-uid", PLAYER_A), "pickem_v14/shared_state"),
    { customUsers: [{ key: "u_alice" }], profilePrivacy: {}, fridayNightRevealOverride: false, updatedAt: "now" }, merge));
});

test("a player cannot move the week or overwrite poolMembers", async () => {
  const db = as("alice-uid", PLAYER_A);
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { currentWeek: 8 }, merge));
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { poolMembers: [] }, merge));
  await assertFails(setDoc(doc(db, "pickem_v14/shared_state"), { liveScores: {} }, merge));
});

test("signed-out visitors can read but not write", async () => {
  await assertSucceeds(getDoc(doc(anon(), "pickem_v14/shared_state")));
  await assertFails(setDoc(doc(anon(), "pickem_v14/shared_state"), { u_x: {} }, merge));
  await assertFails(setDoc(doc(anon(), "live_games/week_state"), { currentWeek: 3 }, merge));
});

test("only the commissioner (or the bot) writes live_games", async () => {
  await assertFails(setDoc(doc(as("bob-uid", PLAYER_B), "live_games/week_state"), { currentWeek: 3 }, merge));
  await assertSucceeds(setDoc(doc(as("m", MICHAEL), "live_games/week_state"), { currentWeek: 10 }, merge));
});

test("players can't overwrite someone else's owned pick document", async () => {
  await assertFails(setDoc(doc(as("bob-uid", PLAYER_B), "pickem_v14_users/u_alice"), { picks: {} }, merge));
  await assertSucceeds(setDoc(doc(as("alice-uid", PLAYER_A), "pickem_v14_users/u_alice"), { picks: { 1: "Texas Tech" } }, merge));
  await assertSucceeds(setDoc(doc(as("bob-uid", PLAYER_B), "pickem_v14_users/u_bob"), { ownerUid: "bob-uid", picks: {} }, merge));
  await assertSucceeds(setDoc(doc(as("m", MICHAEL), "pickem_v14_users/u_alice"), { picks: {} }, merge));
});
