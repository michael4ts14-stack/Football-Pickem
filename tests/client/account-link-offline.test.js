"use strict";
// Offline, Firestore reports its empty local cache as a bindings result (seen on SDK 9.23.0).
// That must not read as "nobody is linked": it filed link requests for accounts already bound
// and dropped them to the unlinked screen, so Kinyon kept having to re-link.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/account-security.js"), "utf8");
const a = src.indexOf("// ---------- Bindings: load once, then live ----------");
const b = src.indexOf("// ---------- Link requests (player side) ----------");
assert.ok(a !== -1 && b !== -1, "bindings and gate block exist");

const UID = "kinyon-uid";
const KINYON = { uid: UID, memberName: "Kinyion C" };

function snap(docs, fromCache) {
  const list = Object.keys(docs).map((id) => ({ id, data: () => docs[id] }));
  return { metadata: { fromCache }, forEach: (fn) => list.forEach(fn) };
}

function load() {
  const log = [];
  const ctx = {
    Promise, console, setTimeout,
    BOUND_ACCOUNTS: {}, BOUND_ACCOUNTS_READY: null, ACCOUNT_SECURITY_LIVE: false, MY_LINK_REQUEST: null,
    AUTH_SESSION: { uid: UID, email: "k@example.com", displayName: "Kinyon", provider: "google.com", boundProfileKey: "kinyion" },
    fbAuth: null,
    fsDb: {
      collection: () => ({
        onSnapshot: (...args) => { ctx.emit = args.find((x) => typeof x === "function"); },
        doc: () => ({ get: () => Promise.reject(new Error("offline")) }),
      }),
    },
    listenWithRetry: (label, subscribe, onNext) => subscribe(onNext, () => {}),
    enterUnlinkedAccountSession: () => log.push("unlinked"),
    fileLinkRequest: () => { log.push("request filed"); return Promise.resolve(true); },
    bindAuthenticatedAccountToProfile: () => Promise.resolve(),
    renderAccountSecurityBits: () => {},
    showAppToast: () => {},
    fixDisplaySpelling: (s) => s,
    standardizeParticipantName: (s) => s,
    rosterDisplayName: (s) => s,
    getLinkedMemberNameForProfile: () => "Kinyion C",
    profileKeyForMember: () => "kinyion",
    isProfileArchived: () => false,
    isAccountBlocked: () => false,
    isCommissionerAccountEmail: () => false,
    isRosterMemberName: () => true,
    memberForRegisteredEmail: () => "",
    memberLowOf: (s) => String(s).toLowerCase(),
    getSecurityConfig: () => ({ registrationMode: "midseason_protected" }),
    ensureCommissionerConfig: () => ({}),
    ownedProfileKeys: (uid) => Object.keys(ctx.BOUND_ACCOUNTS).filter((k) => ctx.BOUND_ACCOUNTS[k].uid === uid),
    bindingOwnerUid: (k) => (ctx.BOUND_ACCOUNTS[k] ? ctx.BOUND_ACCOUNTS[k].uid : ""),
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  return { ctx, log };
}

const settled = (p) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 20))]);

test("offline, an empty cached bindings result is not treated as the real list", async () => {
  const { ctx } = load();
  const ready = ctx.loadBoundAccounts();
  ctx.emit(snap({}, true));
  assert.strictEqual(await settled(ready), false, "still waiting for the server");
  assert.strictEqual(ctx.ACCOUNT_SECURITY_LIVE, false);
  ctx.emit(snap({ kinyion: KINYON }, false));
  assert.strictEqual(await settled(ready), true);
  assert.strictEqual(ctx.ACCOUNT_SECURITY_LIVE, true);
  assert.strictEqual(ctx.BOUND_ACCOUNTS.kinyion.uid, UID);
});

test("a bound account opening the app offline keeps its link and files no request", { timeout: 3000 }, async () => {
  const { ctx, log } = load();
  ctx.loadBoundAccounts();
  ctx.emit(snap({}, true));
  const gate = ctx.gateAccountLink({ uid: UID, email: "k@example.com", emailVerified: true, displayName: "Kinyon" }, "Kinyion C", false);
  await new Promise((r) => setTimeout(r, 5));
  ctx.emit(snap({ kinyion: KINYON }, false));
  const res = await gate;
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.memberName, "Kinyion C");
  assert.deepStrictEqual(log, []);
});

test("losing the connection later doesn't unlink the account", async () => {
  const { ctx, log } = load();
  ctx.loadBoundAccounts();
  ctx.emit(snap({ kinyion: KINYON }, false));
  ctx.emit(snap({}, true));
  assert.strictEqual(ctx.BOUND_ACCOUNTS.kinyion.uid, UID);
  assert.deepStrictEqual(log, []);
});

test("the commissioner really removing the link still unlinks the account", async () => {
  const { ctx, log } = load();
  ctx.loadBoundAccounts();
  ctx.emit(snap({ kinyion: KINYON }, false));
  ctx.emit(snap({}, false));
  assert.deepStrictEqual(log, ["unlinked"]);
});

test("the server saying there are no bindings at all still finishes loading", async () => {
  const { ctx } = load();
  const ready = ctx.loadBoundAccounts();
  ctx.emit(snap({}, false));
  assert.strictEqual(await settled(ready), true);
  assert.strictEqual(ctx.ACCOUNT_SECURITY_LIVE, true);
});
