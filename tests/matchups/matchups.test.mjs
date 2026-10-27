// Offline tests for tools/matchups/matchups-lib.mjs, using trimmed real ESPN responses.
// Run: node --test tests/matchups/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  seasonStatsFromSummary, computeNationalRanks, matchupEdges, linesFromSummary, atsLineFromSummary,
  coverResult, atsRecord, leadersFromSummary, lastFiveFromSummary, gameInfoFromSummary,
  teamHeadersFromSummary, extraStatsFromTeamFeed, compact,
} from "../../tools/matchups/matchups-lib.mjs";

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const pre = fx("summary-pre.json");     // Arizona at Texas Tech, Week 9 2026, before kickoff
const final = fx("summary-final.json"); // Pitt at Miami, final 52-23, Miami -20.5

test("season stats come from a pre-game summary's boxscore", () => {
  const s = seasonStatsFromSummary(pre);
  assert.equal(s["12"].ppg, 36.1);          // Arizona
  assert.equal(s["12"].papg, 16.7);
  assert.equal(s["2641"].rypg, 189.7);      // Texas Tech
  assert.equal(typeof s["2641"].pyapg, "number");
});

test("a final's boxscore (single-game totals) is not used as season stats", () => {
  assert.deepEqual(seasonStatsFromSummary({ boxscore: { teams: [{ team: { id: "1" }, statistics: [{ name: "totalYards", displayValue: "400" }] }] } }), {});
});

test("national ranks: higher-is-better and lower-is-better, ties share a rank", () => {
  const { ranks, counts } = computeNationalRanks({
    a: { ppg: 40, papg: 10 }, b: { ppg: 30, papg: 10 }, c: { ppg: 30, papg: 25 }, d: { ppg: 20 },
  });
  assert.deepEqual([ranks.a.ppg, ranks.b.ppg, ranks.c.ppg, ranks.d.ppg], [1, 2, 2, 4]);
  assert.deepEqual([ranks.a.papg, ranks.b.papg, ranks.c.papg], [1, 1, 3]);
  assert.equal(ranks.d.papg, undefined);
  assert.equal(counts.ppg, 4);
});

test("matchup edges need a 40-spot gap and read offense vs defense", () => {
  const ranks = { o: { rypg: 8, pypg: 50, ppg: 30 }, d: { ryapg: 94, pyapg: 60, papg: 50 } };
  const edges = matchupEdges({ id: "o", shortName: "Texas" }, { id: "d", shortName: "Vanderbilt" }, ranks);
  assert.deepEqual(edges.map((e) => e.text), ["Texas rush O #8 vs Vanderbilt rush D #94"]);
});

test("matchup edges also flag a top defense facing a weak offense, max 3", () => {
  const ranks = { o: { rypg: 120, pypg: 110, ppg: 115 }, d: { ryapg: 2, pyapg: 3, papg: 1 } };
  const edges = matchupEdges({ id: "o", shortName: "A" }, { id: "d", shortName: "B" }, ranks);
  assert.equal(edges.length, 3);
  assert.ok(edges.every((e) => e.text.startsWith("B ")));
});

test("lines: opening and current spread from the pick center", () => {
  assert.deepEqual(linesFromSummary(pre), { provider: "DraftKings", homeOpen: -7.5, homeCurrent: -3.5, overUnder: 54.5, details: "TTU -3.5" });
  assert.equal(linesFromSummary({}), null);
});

test("ATS: cover / no cover / push, from either side", () => {
  const g = atsLineFromSummary("401858280", final);
  assert.equal(g.homeLine, -20.5);
  assert.equal(coverResult(g.homeId, g), "Y");   // Miami won by 29 laying 20.5
  assert.equal(coverResult(g.awayId, g), "N");
  const push = { homeId: "h", awayId: "a", homeScore: 27, awayScore: 20, homeLine: -7 };
  assert.equal(coverResult("h", push), "P");
  assert.equal(coverResult("h", { ...push, homeLine: null }), null);
  assert.deepEqual(atsRecord("h", [push, g, { ...push, homeScore: 30 }]), { w: 1, l: 0, p: 1 });
});

test("unfinished games are not cached as ATS results", () => {
  assert.equal(atsLineFromSummary("1", pre), null);
});

test("leaders: passer, rusher, receiver with stat line and headshot", () => {
  const l = leadersFromSummary(pre)["2641"];
  assert.deepEqual(l.map((x) => x.kind), ["passing", "rushing", "receiving"]);
  assert.match(l[0].statLine, /YDS/);
  assert.match(l[0].headshot, /^https:/);
  assert.equal(l[0].position, "QB");
});

test("last 5: opponent, score, result and home/away", () => {
  const l5 = lastFiveFromSummary(pre)["2641"];
  assert.equal(l5.length, 5);
  assert.ok(l5.every((e) => /^[WLT]$/.test(e.result) && e.eventId && e.oppAbbr));
  assert.ok(l5.some((e) => e.homeAway === "away"));
});

test("game info: kickoff, venue, weather, TV, predictor", () => {
  const i = gameInfoFromSummary(pre);
  assert.equal(i.state, "pre");
  assert.equal(i.venue.city, "Lubbock");
  assert.equal(i.weather.tempF, 61);
  assert.deepEqual(i.tv, ["ESPN"]);
  assert.deepEqual(i.predictor, { homePct: 67.1, awayPct: 32.9 });
});

test("team headers: rank only for the top 25, overall record", () => {
  const h = teamHeadersFromSummary(pre);
  assert.equal(h.home.abbr, "TTU");
  assert.equal(h.home.rank, 13);
  assert.equal(h.home.record, "6-1");
  assert.equal(teamHeadersFromSummary({ header: { competitions: [{ competitors: [{ homeAway: "home", rank: 99, team: { id: "1" } }] }] } }).home.rank, null);
});

test("turnover margin and 3rd-down % from the team-statistics feed", () => {
  const feed = { splits: { categories: [{ stats: [{ name: "turnOverDifferential", value: -1 }, { name: "thirdDownConvPct", value: 38.37 }] }] } };
  assert.deepEqual(extraStatsFromTeamFeed(feed), { toMargin: -1, thirdPct: 38.37 });
  assert.deepEqual(extraStatsFromTeamFeed(null), {});
});

test("compact drops empty values so the client never sees blanks or NaN", () => {
  assert.deepEqual(compact({ a: "", b: null, c: [], d: { e: NaN }, f: 0, g: [1, null], h: "x" }), { f: 0, g: [1], h: "x" });
});
