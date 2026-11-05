import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLocks, deadlineMs, kickoffsForSlate, locksAreCurrent } from "../../tools/locks/locks-lib.mjs";

const SAT = "2026-11-07T17:00:00Z";
const ev = (id, away, home, date) => ({ id, date, competitions: [{ competitors: [
  { homeAway: "away", team: { location: away } }, { homeAway: "home", team: { location: home } }] }] });

test("deadline matches the app: Friday 9 PM Central of the slate's week", () => {
  assert.equal(new Date(deadlineMs([Date.parse(SAT)])).toISOString(), "2026-11-07T03:00:00.000Z");
});

test("deadline honours the commissioner's day, time and zone", () => {
  const cfg = { deadlineConfig: { day: "Sat", time: "10:30", tz: "America/New_York" } };
  assert.equal(new Date(deadlineMs([Date.parse(SAT)], cfg)).toISOString(), "2026-11-07T15:30:00.000Z");
});

test("kickoffs: the slate's time wins, then the exact team pair in either order, never a namesake", () => {
  const games = [
    { id: 1, away: "Iowa", home: "Ohio State", kickoffIso: SAT },
    { id: 2, away: "Michigan", home: "Texas" },
    { id: 3, away: "Georgia", home: "Florida" },
    { id: 4, away: "Oregon", home: "Utah" },
  ];
  const events = [ev("a", "Texas", "Michigan", "2026-11-07T20:00:00Z"), ev("b", "Georgia Tech", "Florida", "2026-11-07T21:00:00Z"), ev("c", "Oregon State", "Utah", SAT)];
  const k = kickoffsForSlate(games, events);
  assert.deepEqual(Object.keys(k).sort(), ["1", "2"]);
  assert.equal(k["2"], Date.parse("2026-11-07T20:00:00Z"));
});

test("locks group games by kickoff and carry the commissioner's overrides", () => {
  const games = [{ id: 1, kickoffIso: SAT }, { id: 2, kickoffIso: SAT }, { id: 3, kickoffIso: "2026-11-08T01:00:00Z" }];
  const l = buildLocks(games, 10, { gameLockOverrides: { 1: "open", 3: "locked" } }, []);
  assert.equal(l.windows.length, 2);
  assert.deepEqual(l.windows[0].ids, ["1", "2"]);
  assert.equal(l.deadlineAt.toISOString(), "2026-11-07T03:00:00.000Z");
  assert.equal(l.revealAt.toISOString(), l.deadlineAt.toISOString());
  assert.deepEqual(l.openIds, ["1"]);
  assert.deepEqual(l.lockedIds, ["3"]);
  assert.equal(buildLocks(games, 10, { lockMode: "rolling_kickoff" }, []).revealAt.toISOString(), "2026-11-08T01:00:00.000Z");
});

test("too few matched games writes nothing", () => {
  const games = [{ id: 1, away: "A", home: "B" }, { id: 2, away: "C", home: "D" }, { id: 3, kickoffIso: SAT }];
  assert.equal(buildLocks(games, 10, {}, []), null);
});

test("a commissioner's locks for this week are left alone; last week's or incomplete ones aren't", () => {
  assert.equal(locksAreCurrent({ week: 10, deadlineAt: "x" }, 10), true);
  assert.equal(locksAreCurrent({ week: 9, deadlineAt: "x" }, 10), false);
  assert.equal(locksAreCurrent({ week: 10 }, 10), false);
  assert.equal(locksAreCurrent(null, 10), false);
});
