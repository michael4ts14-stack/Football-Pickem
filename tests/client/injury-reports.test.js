"use strict";
// Injury reports saved by the bot (RotoWire) are matched to slate team names without mixing up
// look-alike schools, and replace the slate's own injury rows.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/data/teams.js"), "utf8").replace(/\r\n/g, "\n");
const lib = new Function(src.slice(src.indexOf("var INJURY_REPORTS"), src.indexOf("function enrichGameInjuries")) +
  ";return { set: (v) => { INJURY_REPORTS = v; }, injuryReportFor };")();

test("team names match RotoWire's, and look-alike schools don't", () => {
  lib.set({ teams: { "Miami (OH)": { list: [1] }, "Texas A&M": { list: [2] }, "Mississippi State": { list: [3] }, Iowa: { list: [4] } } });
  assert.strictEqual(lib.injuryReportFor("Miami OH").list[0], 1);
  assert.strictEqual(lib.injuryReportFor("Texas A&M").list[0], 2);
  assert.strictEqual(lib.injuryReportFor("Mississippi St").list[0], 3);
  assert.strictEqual(lib.injuryReportFor("Iowa").list[0], 4);
  assert.strictEqual(lib.injuryReportFor("Iowa State"), null);
  assert.strictEqual(lib.injuryReportFor("Miami"), null);
  lib.set(null);
  assert.strictEqual(lib.injuryReportFor("Iowa"), null);
});
