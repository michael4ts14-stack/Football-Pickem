// firestore.rules against the Firestore emulator. Run: cd tests/rules && npm install && npm test
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, getDocs, collection, deleteField } from "firebase/firestore";

let env;
const J = { uid: "uid-justin", email: "justin@example.com" };      // owns u_justinc
const O = { uid: "uid-other", email: "other@example.com" };        // another player
const L = { uid: "uid-legacy", email: "legacy@example.com" };      // owns u_legacy by account id
const M = { uid: "uid-michael", email: "michael4ts14@gmail.com" }; // commissioner
const db = (who, verified = true) => env.authenticatedContext(who.uid, { email: who.email, email_verified: verified }).firestore();
const guest = () => env.unauthenticatedContext().firestore();
const SS = (d) => doc(d, "pickem_v14/shared_state");
const picks = { 1: "Arizona", 2: "Iowa" };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pickem",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8089 },
  });
});
after(async () => { await env.cleanup(); });

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(SS(d), { currentWeek: 9, customGames: [{ id: 1 }], commissionerConfig: { x: 1 }, poolMembers: [], customUsers: [],
      profilePrivacy: {}, u_justinc: { picks: {} }, michael: { picks: {} }, u_legacy: { picks: {} }, u_old: { picks: {} } });
    await setDoc(doc(d, "pickem_v14_users/u_justinc"), { ownerUid: J.uid, picks: {} });
    await setDoc(doc(d, "pickem_v14_users/michael"), { ownerUid: M.uid, picks: {} });
    await setDoc(doc(d, "pickem_v14_users/u_legacy"), { ownerUid: "email_legacy_example_com", picks: {} });
    await setDoc(doc(d, "pickem_v14_users/u_old"), { picks: {} });
    await setDoc(doc(d, "pickem_v14_accounts/email_justin_example_com"), { uid: J.uid, email: J.email, boundProfileKey: "u_justinc" });
    await setDoc(doc(d, "pickem_v14_accounts/email_other_example_com"), { uid: O.uid, email: O.email, passwordHash: "old" });
    await setDoc(doc(d, "pickem_v14_commissioners/roles"), { primaryCommissionerEmail: "commissioner@separatedatturf.com",
      authorizedEmails: { "michael4ts14@gmail.com": true, "commissioner@separatedatturt.com": true } });
    await setDoc(doc(d, "pickem_v14_email_log/a"), { ok: true });
  });
}

// (A write that changes nothing is allowed for anyone; it can't alter data.)
const save = (d, key, extra = {}) => setDoc(SS(d), Object.assign({ [key]: { picks }, lastProfileWriter: key, updatedAt: "t" }, extra), { merge: true });

test("pool state: everyone reads; signed-out visitors write nothing", async () => {
  await seed();
  await assertSucceeds(getDoc(SS(guest())));
  await assertFails(setDoc(SS(guest()), { u_justinc: { picks } }, { merge: true }));
  await assertFails(setDoc(SS(guest()), { customUsers: [] , updatedAt: "x" }, { merge: true }));
});

test("pool state: a player saves their own profile, not anyone else's", async () => {
  await seed();
  await assertSucceeds(save(db(J), "u_justinc"));
  await assertFails(save(db(O), "u_justinc", { u_justinc: { picks: { 1: "Texas Tech" } } })); // not the owner
  const other = { picks: { 2: "Wisconsin" } };
  await assertFails(setDoc(SS(db(O)), { u_justinc: other, lastProfileWriter: "u_other" }, { merge: true })); // key not named
  await assertFails(setDoc(SS(db(J)), { u_justinc: other, michael: other, lastProfileWriter: "u_justinc" }, { merge: true }));
  await assertFails(setDoc(doc(guest(), "x/y"), { a: 1 }));
  await assertFails(setDoc(SS(db(O)), { u_justinc: other }, { merge: true }));     // no lastProfileWriter
  await assertSucceeds(save(db(L), "u_legacy"));                                  // legacy owner (account id)
  await assertFails(save(db(O), "u_old"));                                        // unowned: claim the pick doc first
});

test("pool state: players can update the registry and privacy, nothing pool-wide", async () => {
  await seed();
  await assertSucceeds(setDoc(SS(db(J)), { customUsers: [{ key: "u_justinc" }], profilePrivacy: { u_justinc: { hidden: true } }, updatedAt: "t" }, { merge: true }));
  for (const field of ["customGames", "commissionerConfig", "poolMembers", "leaderboard", "currentWeek", "weekArchives", "deletedPicksByMember", "fridayNightRevealOverride", "liveScores"]) {
    await assertFails(setDoc(SS(db(J)), { [field]: 1, updatedAt: "t" }, { merge: true }), field);
  }
});

test("pool state: commissioner writes anything; unverified or typo-domain accounts don't count", async () => {
  await seed();
  await assertSucceeds(setDoc(SS(db(M)), { customGames: [{ id: 2 }], u_justinc: { picks } }, { merge: true }));
  await assertFails(setDoc(SS(db(M, false)), { customGames: [] }, { merge: true }));
  await assertFails(setDoc(SS(db({ uid: "t", email: "commissioner@separatedatturt.com" })), { customGames: [] }, { merge: true }));
});

test("pick docs: owner or commissioner only; owner can't be handed off; unowned can be claimed", async () => {
  await seed();
  const U = (d, k) => doc(d, "pickem_v14_users/" + k);
  await assertSucceeds(getDoc(U(guest(), "u_justinc")));
  await assertSucceeds(setDoc(U(db(J), "u_justinc"), { picks, ownerUid: J.uid }, { merge: true }));
  await assertFails(setDoc(U(db(O), "u_justinc"), { picks, ownerUid: O.uid }, { merge: true }));
  await assertFails(setDoc(U(db(J), "u_justinc"), { ownerUid: O.uid }, { merge: true }));
  await assertFails(setDoc(U(guest(), "u_justinc"), { picks }, { merge: true }));
  await assertSucceeds(setDoc(U(db(O), "u_new"), { picks, ownerUid: O.uid }));
  await assertFails(setDoc(U(db(O), "u_new2"), { picks, ownerUid: J.uid }));
  await assertSucceeds(setDoc(U(db(O), "u_old"), { picks, ownerUid: O.uid }, { merge: true }));
  await assertFails(setDoc(U(db(J), "u_old"), { picks, ownerUid: J.uid }, { merge: true })); // already claimed
  await assertSucceeds(setDoc(U(db(L), "u_legacy"), { picks, ownerUid: L.uid }, { merge: true }));
  await assertSucceeds(setDoc(U(db(M), "u_justinc"), { picks }, { merge: true }));          // commissioner edit
});

test("account records: private to their owner and commissioners; no password hashes", async () => {
  await seed();
  const A = (d, id) => doc(d, "pickem_v14_accounts/" + id);
  await assertSucceeds(getDoc(A(db(J), "email_justin_example_com")));
  await assertFails(getDoc(A(db(O), "email_justin_example_com")));
  await assertFails(getDoc(A(guest(), "email_justin_example_com")));
  await assertFails(getDocs(collection(db(J), "pickem_v14_accounts")));
  await assertSucceeds(getDocs(collection(db(M), "pickem_v14_accounts")));
  await assertSucceeds(setDoc(A(db(J), "email_justin_example_com"), { rivals: ["x"], uid: J.uid }, { merge: true }));
  await assertFails(setDoc(A(db(J), "email_justin_example_com"), { passwordHash: "abc" }, { merge: true }));
  await assertFails(setDoc(A(db(J), "email_other_example_com"), { rivals: [] }, { merge: true }));
  await assertFails(setDoc(A(db(J), "email_justin_example_com"), { uid: O.uid }, { merge: true }));
  await assertSucceeds(setDoc(A(db(O), "email_other_example_com"), { rivals: ["y"] }, { merge: true }));               // old hash kept
  await assertSucceeds(setDoc(A(db(O), "email_other_example_com"), { passwordHash: deleteField() }, { merge: true })); // hash removed
  await assertSucceeds(setDoc(A(db({ uid: "new", email: "New.Person+x@Example.com" }), "email_new_person_x_example_com"), { uid: "new", email: "new.person+x@example.com" }));
});

test("commissioner settings, send log and live data", async () => {
  await seed();
  await assertSucceeds(getDoc(doc(guest(), "pickem_v14_commissioners/email_service")));
  await assertFails(setDoc(doc(db(J), "pickem_v14_commissioners/email_service"), { webAppUrl: "x" }));
  await assertSucceeds(setDoc(doc(db(M), "pickem_v14_commissioners/email_service"), { webAppUrl: "x" }));
  await assertSucceeds(getDoc(doc(db(M), "pickem_v14_email_log/a")));
  await assertFails(getDoc(doc(db(J), "pickem_v14_email_log/a")));
  await assertFails(setDoc(doc(db(M), "pickem_v14_email_log/b"), { ok: true }));
  await assertSucceeds(setDoc(doc(guest(), "live_games/week_9_matchups"), { x: 1 })); // still open (GitHub jobs)
});
