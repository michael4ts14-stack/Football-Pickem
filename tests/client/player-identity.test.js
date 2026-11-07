"use strict";
// Players write their own pick doc and registry entry. Who a profile plays comes from its binding,
// and nothing a player typed can reach another screen's HTML as code.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/state.js"), "utf8");
const a = src.indexOf("// ---------- Who a profile plays ----------");
const b = src.indexOf("// A second profile for a player who already has one");
const c = src.indexOf("function getAllUserProfiles()");
const d = src.indexOf("// null for a key that isn't a registered profile");
assert.ok(a !== -1 && b > a && c !== -1 && d > c, "identity code exists");

const STEVE = { key: "u_stevem", name: "Steve M", linkedMemberName: "Steve M", color: "#84cc16", rank: "T-4th" };

function load(customUsers, bindings) {
  const ctx = {
    state: { customUsers, michael: { linkedMemberName: "Michael A" }, kinyion: { linkedMemberName: "Kinyon C" }, test: {} },
    BOUND_ACCOUNTS: bindings || {},
    standardizeParticipantName: (s) => String(s || "").replace(/\bKinyon C\b/, "Kinyion C").trim(),
    findLeaderboardEntryByName: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) + "\n" + src.slice(c, d), ctx);
  return ctx;
}

test("a bound player can't take over another row by naming it in their own entry", () => {
  const ctx = load([{ key: "u_mallory", name: "Mallory", linkedMemberName: "Steve M" }], { u_mallory: { uid: "x", memberName: "Mallory" } });
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Steve M"), null);
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Mallory").key, "u_mallory");
});

test("a bound player can't take over another row by renaming themselves", () => {
  const ctx = load([{ key: "u_mallory", name: "Steve M", linkedMemberName: "Mallory" }], { u_mallory: { uid: "x", memberName: "Mallory" } });
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Steve M"), null);
});

test("the two built-in players can't claim another row either", () => {
  const ctx = load([], { kinyion: { uid: "k", memberName: "Kinyion C" } });
  ctx.state.kinyion.linkedMemberName = "Steve M";
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Steve M"), null);
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Kinyon C").key, "kinyion");
});

test("a player with no binding still matches their entry", () => {
  const ctx = load([STEVE]);
  assert.strictEqual(ctx.getProfileLinkedToMemberName("Steve M").key, "u_stevem");
});

test("the commissioner's sheet name wins for a pick doc's clear flag", () => {
  const ctx = load([], { u_mallory: { uid: "x", memberName: "Mallory" } });
  assert.strictEqual(ctx.pickDocMemberName("u_mallory", { linkedMemberName: "Steve M", displayName: "Steve M" }), "Mallory");
  assert.strictEqual(ctx.pickDocMemberName("u_stevem", { linkedMemberName: "Steve M" }), "Steve M");
  assert.strictEqual(ctx.pickDocMemberName("u_stevem", { displayName: "Steve" }), "Steve");
});

test("a color that isn't a plain hex value never reaches the page", () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const ctx = load([{ key: "u_mallory", name: "Mallory", color: evil, rank: "1st" }]);
  const pf = ctx.getAllUserProfiles().filter((p) => p.key === "u_mallory")[0];
  assert.strictEqual(pf.color, "#10b981");
  assert.strictEqual(ctx.safeProfileColor("#84cc16"), "#84cc16");
  assert.strictEqual(ctx.safeProfileColor("red;background:url(x)"), "#10b981");
  assert.strictEqual(ctx.safeProfileColor(undefined), "#10b981");
});

test("markup in a player's rank is removed", () => {
  const ctx = load([{ key: "u_mallory", name: "Mallory", rank: '<img src=x onerror="alert(1)">T-4th' }]);
  const pf = ctx.getAllUserProfiles().filter((p) => p.key === "u_mallory")[0];
  assert.ok(!/[<>"'&]/.test(pf.defaultRank), pf.defaultRank);
  assert.match(pf.defaultRank, /T-4th/);
});
