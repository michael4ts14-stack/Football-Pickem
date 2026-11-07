"use strict";
// Player and commissioner emails stay out of everything anyone can read without signing in.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/account-security.js"), "utf8");
const a = src.indexOf("// ---------- Private emails: what to move ----------");
const b = src.indexOf("// ---------- Private emails: end of what to move ----------");
assert.ok(a !== -1 && b > a, "migration code exists");

const ctx = { rosterDisplayName: (low) => "Name of " + low, JSON, Object };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b), ctx);
const plain = (x) => JSON.parse(JSON.stringify(x));
const hasEmail = (x) => /@/.test(JSON.stringify(x));

test("flat and dotted-name entries both come out as name -> email", () => {
  // Dots in "f.f.f" were once saved as a path, so that entry is nested.
  const out = ctx.flattenEmailMap({ "steve m": "Steve@Example.com", f: { f: { f: "fff@example.com" } }, blank: "" });
  assert.deepStrictEqual(plain(out), { "steve m": "steve@example.com", "f.f.f": "fff@example.com" });
});

test("scrubEmailFields removes email fields at any depth and says if it changed anything", () => {
  const doc = { customUsers: [{ key: "u_a", email: "a@x.com", ownerEmail: "a@x.com", name: "A" }], kinyion: { ownerEmail: "k@x.com", picks: { 1: "Iowa" } }, note: "kept" };
  const r = ctx.scrubEmailFields(doc);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(plain(r.value), { customUsers: [{ key: "u_a", name: "A" }], kinyion: { picks: { 1: "Iowa" } }, note: "kept" });
  assert.strictEqual(ctx.scrubEmailFields({ a: { b: 1 } }).changed, false);
});

test("the migration lists every public email in shared_state and leaves the rest alone", () => {
  const shared = {
    currentWeek: 10,
    customUsers: [{ key: "u_a", name: "A", email: "a@x.com", ownerEmail: "a@x.com", ownerUid: "uid-a" }],
    kinyion: { ownerEmail: "k@x.com", picks: { 1: "Iowa" } },
    u_a: { ownerEmail: "a@x.com", picks: {} },
    commissionerConfig: {
      lockMode: "friday_9pm_cst",
      playerEmailsMap: { "steve m": "s@x.com", "steve two": "S@x.com", f: { f: { f: "fff@x.com" } } },
      primaryCommissionerEmail: "p@x.com",
      authorizedCommissioners: { "p@x.com": { enabled: true, assignedBy: "p@x.com" } },
      archivedProfiles: { u_old: { name: "Old", email: "o@x.com", uid: "uid-o", archivedBy: "p@x.com", record: { key: "u_old", email: "o@x.com", name: "Old" } } },
      savedReceiptsLog: { u_a: { player: "A", email: "a@x.com", sentAt: "t" } },
      blockedUsers: { "uid-b": { email: "b@x.com", name: "B" } },
    },
  };
  const m = ctx.buildEmailMigration(shared);
  assert.deepStrictEqual(plain(m.registered), {
    "s@x.com": { memberLows: ["steve m", "steve two"] },
    "fff@x.com": { memberLows: ["f.f.f"] },
  });
  assert.deepStrictEqual(plain(m.customUsers), [{ key: "u_a", name: "A", ownerUid: "uid-a" }]);
  const paths = m.deletePaths.map((p) => p.join(" > ")).sort();
  assert.deepStrictEqual(plain(paths), [
    "commissionerConfig > archivedProfiles > u_old > archivedBy",
    "commissionerConfig > archivedProfiles > u_old > email",
    "commissionerConfig > archivedProfiles > u_old > record > email",
    "commissionerConfig > authorizedCommissioners",
    "commissionerConfig > blockedUsers > uid-b > email",
    "commissionerConfig > playerEmailsMap",
    "commissionerConfig > primaryCommissionerEmail",
    "commissionerConfig > savedReceiptsLog > u_a > email",
    "kinyion > ownerEmail",
    "u_a > ownerEmail",
  ].sort());
});

test("after the migration has run there is nothing left to do", () => {
  const m = ctx.buildEmailMigration({ currentWeek: 10, customUsers: [{ key: "u_a", name: "A" }], u_a: { picks: {} }, commissionerConfig: { lockMode: "open" } });
  assert.deepStrictEqual(plain(m.registered), {});
  assert.deepStrictEqual(plain(m.deletePaths), []);
  assert.strictEqual(m.customUsers, null);
});

test("public saves of the commissioner's settings never carry the private fields", () => {
  const cfg = { lockMode: "open", playerEmailsMap: { a: "a@x.com" }, authorizedCommissioners: { "p@x.com": {} }, primaryCommissionerEmail: "p@x.com" };
  const pub = ctx.publicConfigOf(cfg);
  assert.deepStrictEqual(plain(pub), { lockMode: "open" });
  assert.strictEqual(hasEmail(pub), false);
  assert.strictEqual(cfg.lockMode, "open");
  assert.ok(cfg.playerEmailsMap, "this device's copy keeps them");
});
