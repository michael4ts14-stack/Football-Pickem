"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Players choose their own names, so a raw name in generated HTML runs code on every viewer,
// including the commissioner. Text-scan: any name concatenated into a line of HTML must be escaped.
const ROOT = path.join(__dirname, "../../public/js");
const RAW_NAME = /\+\s*([\w$.\[\]]*\.(?:name|shortName|displayName|memberName|linkedMemberName|email))\b(?:\.slice\([^)]*\))?\s*\+/g;
// Fixed labels from code, and a name already inside an escape call.
const ALLOWED = ["shell.js|m.name", "standings-ui.js|r.name"];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "data" ? [] : walk(path.join(dir, e.name))) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
}

test("player names are escaped wherever HTML is built", () => {
  const raw = [];
  for (const file of walk(ROOT)) {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (!/<[a-z]|title="/i.test(line)) return;
      for (const m of line.matchAll(RAW_NAME)) {
        if (!ALLOWED.includes(path.basename(file) + "|" + m[1])) raw.push(path.basename(file) + ":" + (i + 1) + " " + m[1]);
      }
    });
  }
  assert.deepStrictEqual(raw, []);
});
