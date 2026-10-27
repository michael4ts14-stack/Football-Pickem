// node --test "tests/form/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFormData, splitMatchupTitle, matchFormToSlate, buildPrefillUrl } from "../../tools/form/form-lib.mjs";

const fb = JSON.parse(readFileSync(new URL("./fixtures/form-week9.json", import.meta.url)));
const slate = JSON.parse(readFileSync(new URL("./fixtures/slate-week9.json", import.meta.url)));

test("reads every question with its entry id and exact choices", () => {
  const f = parseFormData(fb);
  assert.match(f.title, /Week 9/);
  assert.equal(f.questions.length, 25);
  assert.deepEqual(f.questions[1].choices, ["Arizona", "TTech"]);
  assert.match(f.questions[1].entry, /^entry\.\d+$/);
});

test("splits matchup titles with ranks, records, spreads and vs.", () => {
  assert.deepEqual(splitMatchupTitle("#22 Arizona 6-1 at #13 Texas Tech 6-1 (-3.5)"), { first: "Arizona", second: "Texas Tech" });
  assert.deepEqual(splitMatchupTitle("#17 Florida 5-2 vs. #3 Georgia 6-1 (-10.5)"), { first: "Florida", second: "Georgia" });
});

test("maps all 23 slate games and both teams to exact choice text", () => {
  const m = matchFormToSlate(parseFormData(fb), slate.games);
  assert.deepEqual(m.unmatchedGames, []);
  assert.deepEqual(m.unmatchedQuestions, []);
  assert.equal(Object.keys(m.games).length, 23);
  assert.deepEqual(m.games["1"].choices, { away: "Arizona", home: "TTech" });
  assert.ok(m.nameQuestion && m.tiebreakerQuestion);
  assert.match(m.tiebreakerQuestion.title, /PICK THE SCORE/);
});

test("flags a game it can't place instead of guessing", () => {
  const games = slate.games.slice(0, 2).concat([{ id: 99, away: "Nowhere State", home: "Atlantis", awayCode: "NoSt", homeCode: "Atl" }]);
  const m = matchFormToSlate(parseFormData(fb), games);
  assert.equal(m.unmatchedGames.length, 1);
  assert.equal(m.unmatchedGames[0].gameId, "99");
});

test("pre-filled link carries the name, every pick and the tie-breaker", () => {
  const doc = { viewformUrl: "https://docs.google.com/forms/d/e/X/viewform", ...matchFormToSlate(parseFormData(fb), slate.games) };
  const picks = {};
  slate.games.forEach((g, i) => { picks[String(g.id)] = i % 2 ? "home" : "away"; });
  const r = buildPrefillUrl(doc, { name: "Michael Adams", picks, tiebreaker: "31-24" });
  assert.deepEqual(r.missing, []);
  const u = new URL(r.url);
  assert.equal(u.searchParams.get("usp"), "pp_url");
  assert.equal(u.searchParams.get(doc.nameQuestion.entry), "Michael Adams");
  assert.equal(u.searchParams.get(doc.games["1"].entry), "Arizona");
  assert.equal(u.searchParams.get(doc.games["2"].entry), "Syr");
  assert.equal(u.searchParams.get(doc.tiebreakerQuestion.entry), "31-24");
  const partial = buildPrefillUrl(doc, { name: "x", picks: { 1: "away" }, tiebreaker: "" });
  assert.equal(partial.missing.length, 22);
});
