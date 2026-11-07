"use strict";
// Every commissioner screen and the master sheet show the picks grading counts: a linked app
// profile's only when they're for this week's games, otherwise the sheet's (Steve M, Week 10).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/import-sheet-grading.js"), "utf8");
const a = src.indexOf("// The picks a pool row counts this week");
const b = src.indexOf("function regradeAllPoolMembersLive");
assert.ok(a !== -1 && b > a, "helper exists");

const GAMES = [{ id: 1 }, { id: 2 }, { id: 3 }];
function load(stateExtra, linkedKey) {
  const ctx = {
    GAMES,
    state: Object.assign({}, stateExtra),
    getProfileLinkedToMemberName: () => (linkedKey ? { key: linkedKey } : null),
    hasSubmittedPicksForCurrentSlate: (p) => GAMES.filter((g) => p && p[g.id]).length >= 2,
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  return ctx;
}

const SHEET = { name: "Steve M", picks: { 1: "A", 2: "B", 3: "C" }, tiebreaker: "27-20" };

test("an app profile holding last week's picks doesn't hide the sheet's", () => {
  const ctx = load({ u_stevem: { picks: { 101: "X", 102: "Y" }, tiebreaker: "34-20" } }, "u_stevem");
  const src = ctx.memberPicksSource(SHEET);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(src.picks)), SHEET.picks);
  assert.strictEqual(src.tiebreaker, "27-20");
});

test("an app profile with this week's picks wins, with its tiebreaker", () => {
  const ctx = load({ u_stevem: { picks: { 1: "A", 2: "Z" }, tiebreaker: "31-24" } }, "u_stevem");
  const src = ctx.memberPicksSource(SHEET);
  assert.strictEqual(src.picks[2], "Z");
  assert.strictEqual(src.tiebreaker, "31-24");
});

test("a player with no app profile shows the sheet", () => {
  const ctx = load({}, null);
  const src = ctx.memberPicksSource(SHEET);
  assert.strictEqual(src.picks[3], "C");
  assert.strictEqual(src.linked, null);
});
