"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.window = global;
global.state = { currentWeek: 10 };
const urls = [];
let score = 7;
global.fetchJsonSafe = async (url) => {
  urls.push(url);
  return { week: { number: 10 }, season: { year: 2026, type: 2 }, events: [{
    id: "1", week: { number: 10 },
    competitions: [{ competitors: [{ homeAway: "away", score: String(score) }, { homeAway: "home", score: "0" }] }],
  }] };
};
const src = fs.readFileSync(path.join(__dirname, "../../public/js/espn.js"), "utf8");
vm.runInThisContext(src.slice(0, src.indexOf("function scoreGameAgainstEvent")));

test("a repeat poll reuses old days and week queries, and still gets fresh scores", async () => {
  const first = await fetchScoreboardEvents();
  const firstCount = urls.length;
  assert.ok(firstCount > 20, "first poll fetches everything: " + firstCount);
  assert.strictEqual(first[0].away.score, "7");

  urls.length = 0;
  score = 14;
  await new Promise((r) => setTimeout(r, 5));
  const second = await fetchScoreboardEvents();
  assert.ok(urls.length <= 5, "repeat poll made " + urls.length + " requests");
  assert.strictEqual(second.length, 1);
  assert.strictEqual(second[0].away.score, "14", "fresh score must beat the cached week query");
  assert.strictEqual(second[0].week, 10);
});

test("after the cache expires everything is fetched again", async (t) => {
  urls.length = 0;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 11 * 60 * 1000 });
  await fetchScoreboardEvents();
  assert.ok(urls.length > 20);
});
