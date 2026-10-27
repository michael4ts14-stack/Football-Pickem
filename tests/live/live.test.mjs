// node --test "tests/live/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  trimDrive, thinWinProb, liveDocFromSummary, liveDocSignature, PAST_DRIVE_PLAYS,
} from "../../tools/live/live-lib.mjs";

const summary = JSON.parse(readFileSync(new URL("./fixtures/summary-final-drives.json", import.meta.url)));

test("trimDrive keeps the first play, the newest plays and the real play count", () => {
  const d = summary.drives.previous.find((x) => x.plays.length > PAST_DRIVE_PLAYS + 2);
  const t = trimDrive(d, PAST_DRIVE_PLAYS);
  assert.equal(t.plays.length, PAST_DRIVE_PLAYS + 1);
  assert.equal(t.plays[0].id, d.plays[0].id);
  assert.equal(t.plays.at(-1).id, d.plays.at(-1).id);
  assert.equal(t.offensivePlays, d.offensivePlays);
  assert.equal(t.team.id, d.team.id);
});

test("thinWinProb caps the points and ends on the latest value", () => {
  const raw = Array.from({ length: 450 }, (_, i) => ({ homeWinPercentage: i / 449, playId: String(i) }));
  const out = thinWinProb(raw, 200);
  assert.equal(out.length, 200);
  assert.equal(out[0].homeWinPercentage, 0);
  assert.equal(out.at(-1).homeWinPercentage, 1);
  assert.equal(thinWinProb(undefined).length, 0);
});

test("the live document is small and its signature is stable", () => {
  const doc = liveDocFromSummary(summary, { gameId: 3, eventId: "401871055", week: 8 });
  const bytes = JSON.stringify(doc).length;
  assert.ok(bytes < 60000, `doc is ${bytes} bytes`);
  assert.equal(doc.status.state, "post");
  assert.equal(doc.summary.drives.previous.length, summary.drives.previous.length);
  assert.equal(liveDocSignature(doc), liveDocSignature(liveDocFromSummary(summary, { gameId: 3, eventId: "401871055", week: 8 })));
});

// Runs the browser's own parser (public/js/render/field-tracker.js) on the full ESPN
// summary and on the trimmed copy: the drives the field and drive chart use must match.
function loadBrowserParser() {
  const g = { id: 3, away: "Middle Tennessee", home: "Florida International", awayCode: "MTSU", homeCode: "FIU", awayEspnId: "2393", homeEspnId: "2229" };
  const ctx = {
    console, Date, Math, JSON, parseInt, parseFloat, isNaN, String, Array, Object, RegExp,
    SUMMARY_PBP_CACHE: {}, LIVE_SCORES: {}, activeSlateEpoch: 1,
    findGameById: (id) => (String(id) === "3" ? g : null),
    gameMatchupKey: (x) => x.away + "@" + x.home,
    scoreGameAgainstEvent: () => ({ score: 10 }),
    normalizeTeamKey: (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  };
  const importHub = readFileSync(new URL("../../public/js/import-hub.js", import.meta.url), "utf8");
  const helper = importHub.slice(importHub.indexOf("function isSafeClientSubstrMatch"), importHub.indexOf("\n}\n", importHub.indexOf("function isSafeClientSubstrMatch")) + 3);
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);
  vm.runInContext(readFileSync(new URL("../../public/js/render/field-tracker.js", import.meta.url), "utf8"), ctx);
  return ctx;
}

test("browser parser reads the trimmed copy the same way as the full summary", () => {
  const full = loadBrowserParser();
  assert.ok(full.applyEspnSummaryToGame(3, "401871055", summary, true));
  const trimmed = loadBrowserParser();
  const doc = liveDocFromSummary(summary, { gameId: 3, eventId: "401871055", week: 8 });
  assert.ok(trimmed.applyEspnSummaryToGame(3, "401871055", JSON.parse(JSON.stringify(doc.summary)), true));

  // JSON round-trip: the vm context has its own Array/Object, which deepEqual treats as different.
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const a = plain(full.SUMMARY_PBP_CACHE[3]), b = plain(trimmed.SUMMARY_PBP_CACHE[3]);
  assert.equal(b.allDrives.length, a.allDrives.length);
  for (let i = 0; i < a.allDrives.length; i++) {
    const { lastPlays: pa, ...da } = a.allDrives[i];
    const { lastPlays: pb, ...db } = b.allDrives[i];
    assert.deepEqual(db, da, `drive ${i + 1}`);
    assert.deepEqual(pb.slice(0, PAST_DRIVE_PLAYS), pa.slice(0, PAST_DRIVE_PLAYS), `drive ${i + 1} newest plays`);
  }
  assert.equal(b.lastScoringDrive.driveIndex, a.lastScoringDrive.driveIndex);
  assert.ok(b.winProb.length > 10 && b.winProb.length <= 200);
  assert.equal(b.winProb.at(-1), a.winProb.at(-1));
});
