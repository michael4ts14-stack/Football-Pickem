#!/usr/bin/env node
// Game-day play-by-play: while slate games are on, polls ESPN every ~30s and writes one
// small document per game to live_games/week_N_drives_<gameId> (drives, last plays, down &
// distance, win probability). Browsers read those documents instead of each fetching ESPN
// summaries on every poll. Runs on GitHub Actions (.github/workflows/live.yml).
//
//   node tools/live/build-live.mjs [--minutes 14] [--interval 30] [--dry-run] [--week N]
//
// Exits within seconds when no slate game is on or about to start.
import { readDoc, patchDoc, initFirestoreAuth, fetchJson } from "../lib/firestore-rest.mjs";
import { liveDocFromSummary, liveDocSignature, statusFromSummary } from "./live-lib.mjs";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DRY = args.includes("--dry-run");
const MINUTES = parseFloat(arg("--minutes", "14"));
const INTERVAL_S = parseFloat(arg("--interval", "30"));
const WEEK_ARG = parseInt(arg("--week", "0"), 10) || 0;
const KICKOFF_SOON_MS = 20 * 60 * 1000; // stay up if a game kicks off within 20 minutes

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function espn(path) {
  try { return await fetchJson(SITE + path, {}, 2); } catch (e) { log("ESPN:", e.message); return null; }
}

async function main() {
  const authed = await initFirestoreAuth().catch(() => false);
  log(authed ? "Firestore: service account" : "Firestore: unauthenticated");
  const shared = await readDoc("pickem_v14/shared_state", ["currentWeek", "customGames"]);
  const week = WEEK_ARG || (shared && parseInt(shared.currentWeek, 10)) || 0;
  const slate = ((shared && shared.customGames) || []).filter((g) => g && g.espnEventId);
  if (!week || !slate.length) { log("No week or no slate games with ESPN ids; nothing to do."); return; }

  const deadline = Date.now() + MINUTES * 60 * 1000;
  const lastSig = {};      // gameId -> signature written this run
  const finished = new Set();

  // Games already written as final in an earlier run don't need another look.
  for (const g of slate) {
    const d = await readDoc(`live_games/week_${week}_drives_${g.id}`, ["status"]).catch(() => null);
    if (d && d.status && d.status.completed) finished.add(String(g.id));
  }

  for (let round = 1; ; round++) {
    const sb = await espn(`/scoreboard?groups=80&limit=300&week=${week}`);
    const events = new Map(((sb && sb.events) || []).map((e) => [String(e.id), e]));
    const now = Date.now();
    const toFetch = [];
    let soon = false, anyIn = false;
    for (const g of slate) {
      const gid = String(g.id);
      if (finished.has(gid)) continue;
      const ev = events.get(String(g.espnEventId));
      const st = ev && ev.status && ev.status.type;
      const state = st ? st.state : null;
      if (state === "in") anyIn = true;
      if (state === "in" || state === "post" || !ev) toFetch.push(g); // not on the FBS board: check its summary
      else if (ev && Date.parse(ev.date) - now < KICKOFF_SOON_MS) soon = true;
    }

    for (const g of toFetch) {
      const gid = String(g.id);
      const summary = await espn(`/summary?event=${g.espnEventId}`);
      if (!summary) continue;
      const status = statusFromSummary(summary);
      if (status.state === "pre") continue;
      if (status.state === "in") anyIn = true;
      const doc = liveDocFromSummary(summary, { gameId: gid, eventId: g.espnEventId, week });
      const sig = liveDocSignature(doc);
      if (sig === lastSig[gid]) continue;
      doc.updatedAt = new Date().toISOString();
      doc.source = "ESPN via GitHub Actions (tools/live)";
      if (DRY) log(`[dry] week_${week}_drives_${gid}: ${status.state} ${status.detail} · ${sig}`);
      else {
        try { await patchDoc(`live_games/week_${week}_drives_${gid}`, doc); log(`wrote ${gid}: ${status.detail}`); }
        catch (e) { log(`write ${gid} failed:`, e.message); continue; }
      }
      lastSig[gid] = sig;
      if (status.completed) finished.add(gid);
    }

    if (!anyIn && !soon) { log(`Round ${round}: nothing on or about to start; done.`); return; }
    if (Date.now() + INTERVAL_S * 1000 > deadline) { log(`Round ${round}: run time used up; the next scheduled run takes over.`); return; }
    await sleep(INTERVAL_S * 1000);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
