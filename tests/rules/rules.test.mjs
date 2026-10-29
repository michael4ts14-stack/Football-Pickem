// firestore.rules against the Firestore emulator. Run: cd tests/rules && npm install && npm test
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, deleteField, deleteDoc, Timestamp, FieldPath } from "firebase/firestore";

let env;
const J = { uid: "uid-justin", email: "justin@example.com" };      // owns u_justinc
const O = { uid: "uid-other", email: "other@example.com" };        // another player
const L = { uid: "uid-legacy", email: "legacy@example.com" };      // owns u_legacy by account id
const M = { uid: "uid-michael", email: "michael4ts14@gmail.com" }; // commissioner
const S = { uid: "uid-steve", email: "steve@example.com" };        // pre-registered for Steve M
const K = { uid: "uid-kin", email: "kin@example.com" };            // pre-registered for Kinyion C
const B = { uid: "uid-blocked", email: "spam@example.com" };       // blocked by the commissioner
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
    await setDoc(SS(d), { currentWeek: 9, customGames: [{ id: 1 }], poolMembers: [], customUsers: [],
      commissionerConfig: { x: 1, playerEmailsMap: { "steve m": "steve@example.com", "kinyion c": "kin@example.com" },
        blockedUsers: { [B.uid]: { email: B.email } }, securityConfig: { registrationMode: "midseason_protected" } },
      profilePrivacy: {}, u_justinc: { picks: {} }, michael: { picks: {} }, u_legacy: { picks: {} }, u_old: { picks: {} } });
    await setDoc(doc(d, "pickem_v14_bindings/u_justinc"), { uid: J.uid, email: J.email, verifiedBy: "commish_approved" });
    await setDoc(doc(d, "pickem_v14_bindings/michael"), { uid: M.uid, email: M.email, verifiedBy: "commish_approved" });
    await setDoc(doc(d, "pickem_v14_security/invite"), { code: "TURF2026" });
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
  await assertFails(save(db(L), "u_legacy"));                                     // legacy owner: bind first
  await assertSucceeds(setDoc(doc(db(L), "pickem_v14_bindings/u_legacy"), bind(L, "Legacy", "legacy_owner")));
  await assertSucceeds(save(db(L), "u_legacy"));
  await assertFails(save(db(O), "u_old"));                                        // unowned: no binding
});

test("pool state: players can update the registry and privacy, nothing pool-wide", async () => {
  await seed();
  await assertSucceeds(setDoc(SS(db(J)), { customUsers: [{ key: "u_justinc" }], profilePrivacy: { u_justinc: { hidden: true } }, lastProfileWriter: "u_justinc", updatedAt: "t" }, { merge: true }));
  for (const field of ["customGames", "commissionerConfig", "poolMembers", "leaderboard", "currentWeek", "weekArchives", "deletedPicksByMember", "fridayNightRevealOverride", "liveScores"]) {
    await assertFails(setDoc(SS(db(J)), { [field]: 1, updatedAt: "t" }, { merge: true }), field);
  }
});

test("pool state: players change only their own privacy and registry entry", async () => {
  await seed();
  const steve = { key: "u_stevem", name: "Steve M" };
  await env.withSecurityRulesDisabled((c) => setDoc(SS(c.firestore()), { customUsers: [steve], profilePrivacy: { michael: { hidden: true } } }, { merge: true }));
  const reg = (who, data) => setDoc(SS(db(who)), Object.assign({ updatedAt: "t" }, data), { merge: true });
  const mine = { key: "u_justinc", name: "Justin C" };
  // Someone else's privacy, with or without naming them as the writer.
  await assertFails(reg(J, { profilePrivacy: { michael: { hidden: false } }, lastProfileWriter: "u_justinc" }));
  await assertFails(reg(J, { profilePrivacy: { michael: { hidden: false } }, lastProfileWriter: "michael" }));
  await assertFails(reg(J, { profilePrivacy: { u_justinc: { hidden: true } } }));                       // writer not named
  await assertFails(reg(O, { profilePrivacy: { u_other: { hidden: true } }, lastProfileWriter: "u_other" })); // not bound
  await assertSucceeds(reg(J, { profilePrivacy: { u_justinc: { hidden: true } }, lastProfileWriter: "u_justinc" }));
  // The registry: no removing, editing or reordering entries, no adding someone else's.
  await assertFails(reg(J, { customUsers: [], lastProfileWriter: "u_justinc" }));
  await assertFails(reg(J, { customUsers: [{ key: "u_stevem", name: "Steve", priorPts: 99 }], lastProfileWriter: "u_justinc" }));
  await assertFails(reg(J, { customUsers: [mine, steve], lastProfileWriter: "u_justinc" }));
  await assertFails(reg(J, { customUsers: [steve, { key: "u_x" }], lastProfileWriter: "u_justinc" }));
  await assertFails(reg(J, { customUsers: [steve, mine, mine], lastProfileWriter: "u_justinc" }));
  await assertFails(reg(O, { customUsers: [steve, { key: "u_other" }], lastProfileWriter: "u_other" }));
  // The app's own write (saveRegistryChangesToCloud): the whole list plus field-path privacy.
  await assertFails(updateDoc(SS(db(J)), "customUsers", [steve, mine], "updatedAt", "t",
    new FieldPath("profilePrivacy", "michael"), { hidden: false }, "lastProfileWriter", "u_justinc"));
  await assertSucceeds(updateDoc(SS(db(J)), "customUsers", [steve, mine], "updatedAt", "t",
    new FieldPath("profilePrivacy", "u_justinc"), { hidden: false }, "lastProfileWriter", "u_justinc"));
  await assertSucceeds(updateDoc(SS(db(J)), "customUsers", [steve, mine], "updatedAt", "t2", "lastProfileWriter", "u_justinc"));
  // Once added, the player's own entry stays as it is too (commissioners edit it).
  await assertFails(reg(J, { customUsers: [steve, { key: "u_justinc", name: "JC" }], lastProfileWriter: "u_justinc" }));
  await assertSucceeds(reg(M, { customUsers: [steve, { key: "u_justinc", name: "JC" }], profilePrivacy: { michael: { hidden: false } } }));
});

test("pool state: commissioner writes anything; unverified or typo-domain accounts don't count", async () => {
  await seed();
  await assertSucceeds(setDoc(SS(db(M)), { customGames: [{ id: 2 }], u_justinc: { picks } }, { merge: true }));
  await assertFails(setDoc(SS(db(M, false)), { customGames: [] }, { merge: true }));
  await assertFails(setDoc(SS(db({ uid: "t", email: "commissioner@separatedatturt.com" })), { customGames: [] }, { merge: true }));
});

test("pick docs: only the bound account or a commissioner writes", async () => {
  await seed();
  const U = (d, k) => doc(d, "pickem_v14_users/" + k);
  await assertSucceeds(getDoc(U(guest(), "u_justinc")));
  await assertSucceeds(setDoc(U(db(J), "u_justinc"), { picks, ownerUid: J.uid }, { merge: true }));
  await assertFails(setDoc(U(db(O), "u_justinc"), { picks, ownerUid: O.uid }, { merge: true }));
  await assertFails(setDoc(U(db(J), "u_justinc"), { ownerUid: O.uid }, { merge: true }));
  await assertFails(setDoc(U(guest(), "u_justinc"), { picks }, { merge: true }));
  await assertFails(setDoc(U(db(O), "u_new"), { picks, ownerUid: O.uid }));              // no binding
  await assertFails(setDoc(U(db(O), "u_old"), { picks, ownerUid: O.uid }, { merge: true })); // unowned can't be claimed
  await assertSucceeds(setDoc(U(db(M), "u_justinc"), { picks }, { merge: true }));          // commissioner edit
  await assertSucceeds(setDoc(U(db(M), "u_brandnew"), { picks }));
});

const bind = (who, memberName, verifiedBy) => ({ uid: who.uid, email: who.email, displayName: memberName, memberName,
  memberLow: memberName.toLowerCase(), boundAt: "t", verifiedBy });
const BD = (d, k) => doc(d, "pickem_v14_bindings/" + k);

test("bindings: a pre-registered, Google-verified email links itself; nothing else does", async () => {
  await seed();
  await assertSucceeds(getDoc(BD(guest(), "u_justinc")));
  await assertSucceeds(setDoc(BD(db(S), "u_stevem"), bind(S, "Steve M", "email_match")));
  await assertSucceeds(setDoc(BD(db(K), "kinyion"), bind(K, "Kinyion C", "email_match")));
  await seed();
  await assertFails(setDoc(BD(db(S, false), "u_stevem"), bind(S, "Steve M", "email_match")));   // unverified email
  await assertFails(setDoc(BD(db(O), "u_stevem"), bind(O, "Steve M", "email_match")));          // not their email
  await assertFails(setDoc(BD(db(S), "u_justinc"), bind(S, "Steve M", "email_match")));         // key doesn't match name
  await assertFails(setDoc(BD(db(S), "u_stevem"), Object.assign(bind(S, "Steve M", "email_match"), { uid: O.uid })));
  await assertFails(setDoc(BD(db(S), "u_stevem"), bind(S, "Steve M", "commish_approved")));     // can't self-approve
  await assertFails(setDoc(BD(db(O), "u_justinc"), bind(O, "Justin C", "legacy_owner")));       // already bound
  await assertFails(setDoc(BD(db(O), "u_old"), bind(O, "Old", "legacy_owner")));                // pick doc has no owner
  await assertFails(setDoc(BD(db(O), "u_newguy"), bind(O, "New Guy", "self_new")));             // midseason: no self-adds
  await assertSucceeds(setDoc(BD(db(M), "u_old"), bind(O, "Old", "commish_approved")));          // commissioner approves
  await assertFails(setDoc(BD(db(O), "u_old"), bind(O, "Old", "commish_approved"), { merge: true })); // only commish edits
  await assertSucceeds(deleteDoc(BD(db(M), "u_old")));                                           // commissioner unlinks
});

test("blocked accounts write nothing", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "pickem_v14_bindings/u_blk"), { uid: B.uid });
  });
  await assertFails(setDoc(doc(db(B), "pickem_v14_users/u_blk"), { picks, ownerUid: B.uid }));
  await assertFails(save(db(B), "u_blk"));
  await assertFails(setDoc(doc(db(B), "pickem_v14_link_requests/" + B.uid), { uid: B.uid, authEmail: B.email, status: "pending" }));
});

test("link requests: filed by the account itself, approved only by a commissioner", async () => {
  await seed();
  const R = (d, uid) => doc(d, "pickem_v14_link_requests/" + uid);
  const req = (who, status = "pending") => ({ uid: who.uid, authEmail: who.email, authDisplayName: "x", requestedMember: "Old",
    requestedMemberLow: "old", requestedPlayerKey: "u_old", requestedAt: "t", status });
  await assertSucceeds(setDoc(R(db(O), O.uid), req(O)));
  await assertSucceeds(getDoc(R(db(O), O.uid)));
  await assertFails(getDoc(R(db(J), O.uid)));                         // someone else's
  await assertFails(getDocs(collection(db(J), "pickem_v14_link_requests")));
  await assertSucceeds(getDocs(collection(db(M), "pickem_v14_link_requests")));
  await assertFails(setDoc(R(db(J), O.uid), req(O)));                 // filing for another account
  await assertFails(setDoc(R(db(O), O.uid), req(O, "approved")));     // can't approve yourself
  await assertSucceeds(setDoc(R(db(M), O.uid), req(O, "rejected")));  // commissioner rejects
  await assertSucceeds(setDoc(R(db(O), O.uid), req(O)));              // asks again
  await assertSucceeds(deleteDoc(R(db(O), O.uid)));                   // cancels
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "pickem_v14/shared_state"), { commissionerConfig: { securityConfig: { registrationMode: "whitelist_strict" } } }, { merge: true });
  });
  await assertFails(setDoc(R(db(O), O.uid), req(O)));                 // whitelist: no requests
});

test("invite code season: right code gets a pass, then new players add themselves", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "pickem_v14/shared_state"), { commissionerConfig: { securityConfig: { registrationMode: "invite_code_required" } } }, { merge: true });
  });
  const P = (d, uid) => doc(d, "pickem_v14_invite_passes/" + uid);
  await assertFails(getDoc(doc(db(O), "pickem_v14_security/invite")));   // the code is secret
  await assertSucceeds(getDoc(doc(db(M), "pickem_v14_security/invite")));
  await assertFails(setDoc(doc(db(O), "pickem_v14_security/invite"), { code: "mine" }));
  await assertFails(setDoc(BD(db(O), "u_newguy"), bind(O, "New Guy", "self_new")));        // no pass yet
  const R = doc(db(O), "pickem_v14_link_requests/" + O.uid);
  const req = { uid: O.uid, authEmail: O.email, status: "pending", requestedPlayerKey: "u_old" };
  await assertFails(setDoc(R, req));                                                        // no pass yet
  await assertFails(setDoc(P(db(O), O.uid), { code: "WRONG" }));
  await assertFails(setDoc(P(db(O), J.uid), { code: "TURF2026" }));                          // someone else's pass
  await assertSucceeds(setDoc(P(db(O), O.uid), { code: "TURF2026" }));
  await assertSucceeds(setDoc(R, req));
  await assertSucceeds(setDoc(BD(db(O), "u_newguy"), bind(O, "New Guy", "self_new")));
  await assertFails(setDoc(BD(db(O), "u_old"), bind(O, "Old", "self_new")));                // existing player isn't "new"
  await assertSucceeds(setDoc(doc(db(O), "pickem_v14_users/u_newguy"), { picks, ownerUid: O.uid }));
});

test("invite links: a revoked or expired link gives no pass; a live one with an expiry does", async () => {
  await seed();
  const P = (d, uid) => doc(d, "pickem_v14_invite_passes/" + uid);
  const setInvite = (v) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "pickem_v14_security/invite"), v));
  await setInvite({ code: "TURF2026", revoked: true });
  await assertFails(setDoc(P(db(O), O.uid), { code: "TURF2026" }));                        // turned off
  await setInvite({ code: "TURF2026", revoked: false, expiresAtTs: Timestamp.fromMillis(Date.now() - 60000) });
  await assertFails(setDoc(P(db(O), O.uid), { code: "TURF2026" }));                        // expired
  await setInvite({ code: "", revoked: true });
  await assertFails(setDoc(P(db(O), O.uid), { code: "" }));                                // no code
  await setInvite({ code: "NEWCODE8", revoked: false, expiresAtTs: Timestamp.fromMillis(Date.now() + 3600000) });
  await assertFails(setDoc(P(db(O), O.uid), { code: "TURF2026" }));                        // old code after regenerate
  await assertSucceeds(setDoc(P(db(O), O.uid), { code: "NEWCODE8" }));
  await setInvite({ code: "NEVEREXP", revoked: false, expiresAtTs: null });
  await assertSucceeds(setDoc(P(db(J), J.uid), { code: "NEVEREXP" }));                     // no expiry
});

test("commissioner log: commissioners only; entries under your own email; never edited", async () => {
  await seed();
  const C = (d) => collection(d, "pickem_v14_commish_log");
  const E = (d, id) => doc(d, "pickem_v14_commish_log/" + id);
  const entry = (email) => ({ timestamp: "t", commishEmail: email, targetPlayer: "", action: "x", reason: "" });
  await assertSucceeds(setDoc(E(db(M), "a"), entry(M.email)));
  await assertFails(setDoc(E(db(M), "b"), entry("someone@else.com")));                        // not your email
  await assertSucceeds(setDoc(E(db(M), "c"), Object.assign(entry("old@commish.com"), { migrated: true }))); // moved old entries
  await assertFails(setDoc(E(db(M), "a"), entry(M.email)));                                   // no edits
  await assertFails(deleteDoc(E(db(M), "a")));
  await assertSucceeds(getDocs(C(db(M))));
  await assertFails(getDocs(C(db(J))));                                                       // players can't read it
  await assertFails(getDocs(C(guest())));
  await assertFails(setDoc(E(db(J), "d"), entry(J.email)));
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
  // live_games: everyone reads; only commissioners write (the GitHub jobs use a service account).
  await assertSucceeds(getDoc(doc(guest(), "live_games/week_9_matchups")));
  await assertFails(setDoc(doc(guest(), "live_games/week_9_matchups"), { x: 1 }));
  await assertFails(setDoc(doc(db(J), "live_games/bot_status"), { x: 1 }));
  await assertSucceeds(setDoc(doc(db(M), "live_games/week_9_matchups"), { x: 1 }));
});

const ago = (mins) => Timestamp.fromMillis(Date.now() + mins * 60000);
const LOCKS = (d) => doc(d, "pickem_v14/kickoff_locks");
async function seedKickoffs() {
  await seed();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(SS(d), { u_justinc: { picks: { 1: "Arizona", 2: "Iowa" } } }, { merge: true });
    await setDoc(doc(d, "pickem_v14_users/u_justinc"), { ownerUid: J.uid, picks: { 1: "Arizona", 2: "Iowa" } });
    // Game 1 kicked off 2 minutes ago, game 2 kicks off in an hour, game 3 has no kickoff time.
    await setDoc(LOCKS(d), { week: 9, windows: [{ at: ago(-2), ids: ["1"] }, { at: ago(60), ids: ["2"] }] });
  });
}
const pickDoc = (d, p) => setDoc(doc(d, "pickem_v14_users/u_justinc"), { ownerUid: J.uid, picks: p }, { mergeFields: ["ownerUid", "picks"] });
const sharedPicks = (d, p) => setDoc(SS(d), { u_justinc: { picks: p }, lastProfileWriter: "u_justinc", updatedAt: "t" }, { mergeFields: ["u_justinc", "lastProfileWriter", "updatedAt"] });

test("week archives: everyone reads; only commissioners write", async () => {
  await seed();
  const A = (d) => doc(d, "pickem_v14_archives/week_8");
  await assertSucceeds(setDoc(A(db(M)), { weekNum: 8, games: [{ id: 1 }] }));
  await assertSucceeds(getDoc(A(guest())));
  await assertFails(setDoc(A(guest()), { weekNum: 8 }));
  await assertFails(setDoc(A(db(J)), { weekNum: 8 }));
  await assertFails(deleteDoc(A(db(J))));
  await assertSucceeds(deleteDoc(A(db(M))));
  // A commissioner clears the old copy out of shared_state.
  await assertSucceeds(setDoc(SS(db(M)), { weekArchives: deleteField() }, { merge: true }));
});

test("kickoff lock: a player can't change a pick once that game kicked off", async () => {
  await seedKickoffs();
  await assertSucceeds(pickDoc(db(J), { 1: "Arizona", 2: "Wisconsin", 3: "SMU" }));  // future / untimed games
  await assertFails(pickDoc(db(J), { 1: "Texas Tech", 2: "Wisconsin", 3: "SMU" }));   // started game changed
  await assertFails(pickDoc(db(J), { 2: "Wisconsin", 3: "SMU" }));                    // started pick removed
  await assertSucceeds(sharedPicks(db(J), { 1: "Arizona", 2: "Wisconsin" }));
  await assertFails(sharedPicks(db(J), { 1: "Texas Tech", 2: "Wisconsin" }));
  await assertFails(sharedPicks(db(J), { 2: "Wisconsin" }));
});

test("kickoff lock: a new pick doc can't add a pick for a started game", async () => {
  await seedKickoffs();
  await env.withSecurityRulesDisabled(async (c) => { await deleteDoc(doc(c.firestore(), "pickem_v14_users/u_justinc")); });
  await assertFails(pickDoc(db(J), { 1: "Arizona" }));
  await assertSucceeds(pickDoc(db(J), { 2: "Iowa" }));
});

test("kickoff lock: locks from another week don't apply", async () => {
  await seedKickoffs();
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(SS(c.firestore()), { currentWeek: 10 }, { merge: true }); });
  await assertSucceeds(pickDoc(db(J), { 1: "Texas Tech" }));
  await env.withSecurityRulesDisabled(async (c) => { await deleteDoc(LOCKS(c.firestore())); });
  await assertSucceeds(pickDoc(db(J), { 1: "Arizona" }));                             // no locks doc at all
});

test("kickoff lock: commissioners write the locks and can still correct started games", async () => {
  await seedKickoffs();
  await assertSucceeds(pickDoc(db(M), { 1: "Texas Tech", 2: "Iowa" }));
  await assertSucceeds(sharedPicks(db(M), { 1: "Texas Tech", 2: "Iowa" }));
  await assertSucceeds(setDoc(LOCKS(db(M)), { week: 9, windows: [] }));
  await assertFails(setDoc(LOCKS(db(J)), { week: 9, windows: [] }));
  await assertSucceeds(getDoc(LOCKS(guest())));
});

test("kickoff lock: 30 games in 20 windows, 90 players, every pick changed stays inside the rules' limit", async () => {
  await seed();
  const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
  const windows = Array.from({ length: 20 }, (_, w) => ({ at: ago(w === 19 ? -5 : 60 + w), ids: w < 10 ? ids.slice(w * 2, w * 2 + 2) : [ids[w + 10]] }));
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    const players = Object.fromEntries(Array.from({ length: 90 }, (_, i) => ["u_p" + i, { picks: Object.fromEntries(ids.map((id) => [id, "A"])) }]));
    await setDoc(SS(d), Object.assign(players, { customGames: ids.map((id) => ({ id: +id })) }), { merge: true });
    await setDoc(LOCKS(d), { week: 9, windows });
  });
  const open = Object.fromEntries(ids.slice(0, 29).map((id) => [id, "B"]));             // game 30 (window 20) started
  await assertSucceeds(pickDoc(db(J), open));
  await assertSucceeds(sharedPicks(db(J), open));
  await assertFails(pickDoc(db(J), Object.assign({}, open, { 30: "B" })));
  await assertFails(sharedPicks(db(J), Object.assign({}, open, { 30: "B" })));
});

test("standings save: liveScores is replaced whole, so removed games don't come back", async () => {
  await seed();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(SS(c.firestore()), { liveScores: { 1: { completed: true }, 2: { inProgress: true } } }, { merge: true });
  });
  const payload = { watchlist: [], leaderboard: [], poolMembers: [], liveScores: { 3: { inProgress: true } }, updatedAt: "t" };
  await assertSucceeds(setDoc(SS(db(M)), payload, { mergeFields: Object.keys(payload) }));
  const data = (await getDoc(SS(guest()))).data();
  assert.deepEqual(data.liveScores, { 3: { inProgress: true } });
  assert.equal(data.currentWeek, 9); // fields not listed are left alone
});
