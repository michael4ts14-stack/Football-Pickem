#!/usr/bin/env node
// Finds this week's official Separated at Turf Google Form (linked from the College Pick'em
// page the weekly email points to), reads its questions and writes live_games/week_N_form:
// viewform / formResponse URLs, the name and tie-breaker questions, and for each slate game
// its question entry id and the exact answer text for each team. Games that can't be matched
// are listed for the commissioner instead of guessed. Read-only toward the form: nothing is
// ever submitted. Runs on GitHub Actions (.github/workflows/form.yml).
//
//   node tools/form/build-form.mjs [--dry-run] [--out file.json] [--form <viewform url>]
import { writeFileSync } from "node:fs";
import { readDoc, patchDoc, initFirestoreAuth } from "../lib/firestore-rest.mjs";
import { fbDataFromHtml, parseFormData, matchFormToSlate } from "./form-lib.mjs";

const POOL_PAGE = "https://separatedatturf.wordpress.com/college-pickem/";
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const OUT = arg("--out");
const log = (...a) => console.log(...a);
const UA = { "User-Agent": "Mozilla/5.0 (pickem form reader)" };

async function getText(url) {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { status: res.status, url: res.url, text: await res.text() };
}

async function findFormUrl() {
  const explicit = arg("--form");
  if (explicit) return explicit;
  const page = await getText(POOL_PAGE);
  const m = page.text.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform/);
  return m ? m[0] : null;
}

async function main() {
  const authed = await initFirestoreAuth();
  log(authed ? "Firestore: service account" : "Firestore: unauthenticated");
  const shared = await readDoc("pickem_v14/shared_state", ["currentWeek", "customGames"]);
  const week = (shared && parseInt(shared.currentWeek, 10)) || 0;
  const slate = (shared && shared.customGames) || [];
  if (!week || !slate.length) throw new Error("shared_state has no currentWeek/customGames");

  const viewformUrl = await findFormUrl();
  if (!viewformUrl) { log("No form link on the pool page yet."); return; }
  const page = await getText(viewformUrl);
  // A form that needs a Google account redirects anonymous visitors to the sign-in page.
  const requiresSignIn = /accounts\.google\.com/.test(page.url);
  const fb = requiresSignIn ? null : fbDataFromHtml(page.text);
  const form = fb ? parseFormData(fb) : { title: "", settings: null, questions: [] };
  const weekInTitle = parseInt((form.title.match(/week\s*(\d+)/i) || [])[1], 10) || null;

  const match = matchFormToSlate(form, slate);
  const doc = {
    week,
    formWeek: weekInTitle,
    weekMismatch: !!(weekInTitle && weekInTitle !== week),
    title: form.title,
    viewformUrl: viewformUrl.replace(/\?.*$/, ""),
    formResponseUrl: viewformUrl.replace(/\/viewform.*$/, "/formResponse"),
    requiresSignIn,
    // Without sign-in Google can't limit responses or verify emails; with it we can't read them.
    limitsOneResponse: requiresSignIn ? null : false,
    collectsEmails: requiresSignIn ? null : /name="emailAddress"/.test(page.text),
    nameQuestion: match.nameQuestion,
    tiebreakerQuestion: match.tiebreakerQuestion,
    games: match.games,
    unmatchedGames: match.unmatchedGames,
    unmatchedQuestions: match.unmatchedQuestions,
    matchedCount: Object.keys(match.games).length,
    slateCount: slate.length,
    updatedAt: new Date().toISOString(),
    source: "Google Form via GitHub Actions (tools/form)",
  };
  log(`${form.title || "(no title)"}: ${doc.matchedCount}/${slate.length} games matched; sign-in required: ${requiresSignIn}; unmatched: ${JSON.stringify(match.unmatchedGames)}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(doc, null, 1));
  if (DRY) { log("Dry run: not writing to Firestore"); return; }
  await patchDoc(`live_games/week_${week}_form`, doc);
  log(`Wrote live_games/week_${week}_form`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
