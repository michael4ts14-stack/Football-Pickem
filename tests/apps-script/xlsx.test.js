// Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadBot } = require("./harness");

const cell = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
const sheetXml = (rows) => `<worksheet><sheetData>${rows.map((cells, i) =>
  `<row r="${i + 1}">${cells.map((v, c) => cell(String.fromCharCode(65 + c) + (i + 1), v)).join("")}</row>`).join("")}</sheetData></worksheet>`;
const file = (name, data) => ({ getName: () => name, getDataAsString: () => data });
const att = { copyBlob: () => ({ setContentType: () => ({}) }) };

// A Scoreboard tab that is larger than the Picks tab must not be mistaken for the picks grid.
test("xlsx: picks tab wins over a larger Scoreboard tab", () => {
  const h = loadBot({});
  const picks = sheetXml([["Adam L", "TTech", "SMU"], ["Amanda S", "Arizona", "SMU"]]);
  const filler = sheetXml(Array.from({ length: 40 }, (_, i) => ["Player " + i, "0", "0", "0"]));
  h.ctx.Utilities.unzip = () => [
    file("xl/workbook.xml", '<workbook><sheets><sheet name="Picks" sheetId="1" r:id="rId1"/><sheet name="Scoreboard" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    file("xl/worksheets/sheet1.xml", picks),
    file("xl/worksheets/sheet2.xml", filler),
  ];
  assert.ok(filler.length > picks.length);
  const sheets = h.ctx.extractGridsFromXlsxAttachment(att);
  assert.strictEqual(sheets.map((s) => s.name).join(","), "Picks,Scoreboard");
  assert.strictEqual(sheets[0].grid[0][0], "Adam L");
  assert.strictEqual(sheets[0].grid[0][1], "TTech");
  assert.strictEqual(h.ctx.extractGridFromXlsxAttachment(att)[1][1], "Arizona");
});

test("xlsx: without workbook.xml the largest sheet is still tried first", () => {
  const h = loadBot({});
  h.ctx.Utilities.unzip = () => [
    file("xl/worksheets/sheet1.xml", sheetXml([["A", "x"]])),
    file("xl/worksheets/sheet2.xml", sheetXml([["B", "y"], ["C", "z"], ["D", "w"]])),
  ];
  assert.strictEqual(h.ctx.extractGridsFromXlsxAttachment(att)[0].grid.length, 3);
});
