#!/usr/bin/env node
// Builds live_games/week_N_matchups from ESPN and writes it to Firestore.
// Runs on GitHub Actions (.github/workflows/matchups.yml): ESPN often refuses Google's Apps
// Script servers, so this job does not live in Code.gs. Browsers only read the result.
//
//   node tools/matchups/build-matchups.mjs [--dry-run] [--force] [--out file.json] [--week N]
//
// --dry-run   fetch and build, print a summary, write nothing to Firestore
// --force     full refresh even if one ran in the last 20 hours
// Auth: if GOOGLE_SERVICE_ACCOUNT_JSON is set, Firestore calls use that service account;
// otherwise they are unauthenticated (firestore.rules now rejects those writes). With
// FIRESTORE_AUTH_REQUIRED=true (the workflows) a missing credential fails the run.
import { writeFileSync } from "node:fs";
import {
  seasonStatsFromSummary, extraStatsFromTeamFeed, computeNationalRanks, matchupEdges,
  linesFromSummary, atsLineFromSummary, coverResult, atsRecord, leadersFromSummary,
  lastFiveFromSummary, gameInfoFromSummary, teamHeadersFromSummary, compact,
} from "./matchups-lib.mjs";

import { fetchJson, initFirestoreAuth, readDoc, patchDoc } from "../lib/firestore-rest.mjs";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";
const FULL_REFRESH_EVERY_MS = 20 * 60 * 60 * 1000;
const PREKICK_WINDOW_MS = 2.5 * 60 * 60 * 1000; // refresh lines/predictor once inside 2.5h of kickoff
const PREKICK_MIN_MS = 1.5 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const weekIdx = args.indexOf("--week");
const WEEK_ARG = weekIdx >= 0 ? parseInt(args[weekIdx + 1], 10) : 0;

const log = (...a) => console.log(...a);
let espnCalls = 0, espnFailures = 0;

async function espn(path) {
  espnCalls++;
  try {
    return await fetchJson(path.startsWith("http") ? path : SITE + path);
  } catch (e) {
    espnFailures++;
    log("  ESPN fetch failed:", e.message);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- Build ----------
function eventIdsFromScoreboard(sb) {
  return ((sb && sb.events) || []).map((e) => String(e.id));
}

async function main() {
  const authed = await initFirestoreAuth();
  log(authed ? "Firestore: using service account" : "Firestore: unauthenticated");

  const shared = await readDoc("pickem_v14/shared_state", ["currentWeek", "customGames"]);
  const week = WEEK_ARG || (shared && parseInt(shared.currentWeek, 10)) || 0;
  const slate = (shared && shared.customGames) || [];
  if (!week || !slate.length) throw new Error("shared_state has no currentWeek/customGames");
  log(`Week ${week}: ${slate.length} games on the slate`);

  const docPath = `live_games/week_${week}_matchups`;
  const prev = (await readDoc(docPath)) || {};
  const prevGames = prev.games || {};
  const now = Date.now();
  const fullDue = FORCE || !prev.fullRefreshAt || now - Date.parse(prev.fullRefreshAt) > FULL_REFRESH_EVERY_MS;

  // Games whose kickoff is 1.5-2.5h away and that haven't had their pre-kickoff refresh.
  const preKick = slate.filter((g) => {
    const p = prevGames[String(g.id)];
    const ko = p && p.kickoff ? Date.parse(p.kickoff) : NaN;
    return p && !p.preKickRefreshed && ko - now <= PREKICK_WINDOW_MS && ko - now >= PREKICK_MIN_MS - 30 * 60 * 1000 && ko > now;
  });
  if (!fullDue && !preKick.length) {
    log("Nothing to do: last full refresh", prev.fullRefreshAt, "and no game inside its pre-kickoff window.");
    return;
  }

  // Summaries for the slate (always) ...
  const slateSummaries = {};
  const slateIds = slate.map((g) => String(g.espnEventId || "")).filter(Boolean);
  await mapLimit(slateIds, 8, async (id) => { slateSummaries[id] = await espn(`/summary?event=${id}`); });

  let games;
  if (!fullDue) {
    // Pre-kickoff refresh: only lines, predictor and weather for the games about to start.
    games = { ...prevGames };
    for (const g of preKick) {
      const s = slateSummaries[String(g.espnEventId)];
      if (!s) continue;
      const cur = { ...games[String(g.id)] };
      const info = gameInfoFromSummary(s);
      cur.spread = compact(linesFromSummary(s)) || cur.spread;
      if (info.predictor) cur.predictor = info.predictor;
      if (info.weather) cur.weather = info.weather;
      cur.preKickRefreshed = true;
      cur.updatedAt = new Date().toISOString();
      games[String(g.id)] = cur;
    }
    log(`Pre-kickoff refresh for ${preKick.length} game(s)`);
  } else {
    games = await fullBuild(week, slate, slateSummaries, prevGames);
  }

  const doc = {
    week,
    updatedAt: new Date().toISOString(),
    fullRefreshAt: fullDue ? new Date().toISOString() : prev.fullRefreshAt,
    source: "ESPN via GitHub Actions (tools/matchups)",
    games,
  };
  log(`ESPN calls: ${espnCalls}, failed: ${espnFailures}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(doc, null, 1));
  if (DRY) { log("Dry run: not writing to Firestore"); return; }
  await patchDoc(docPath, doc);
  log(`Wrote ${docPath} (${Object.keys(games).length} games)`);
}

async function fullBuild(week, slate, slateSummaries, prevGames) {
  // 1. Season stats for every FBS team: pre-game summaries from this week's and next week's games.
  const fbsList = await espn(`${CORE}/groups/80/teams?limit=300`);
  const fbsIds = new Set(((fbsList && fbsList.items) || []).map((it) => (String(it.$ref).match(/teams\/(\d+)/) || [])[1]).filter(Boolean));
  const statsByTeam = {};
  for (const wk of [week, week + 1]) {
    const sb = await espn(`/scoreboard?groups=80&limit=300&week=${wk}`);
    const ids = eventIdsFromScoreboard(sb).filter((id) => !slateSummaries[id]);
    const sums = await mapLimit(ids, 8, (id) => espn(`/summary?event=${id}`));
    const all = [...sums, ...(wk === week ? Object.values(slateSummaries) : [])];
    for (const s of all) {
      for (const [tid, st] of Object.entries(seasonStatsFromSummary(s))) {
        if (fbsIds.size && !fbsIds.has(tid)) continue;
        if (!statsByTeam[tid]) statsByTeam[tid] = st; // this week's numbers win over next week's
      }
    }
  }
  // 2. Turnover margin + 3rd-down % (team-statistics feed), for every FBS team so they can be ranked.
  const teamIds = Object.keys(statsByTeam);
  const anySummary = Object.values(slateSummaries).find((s) => s && s.header && s.header.season);
  const seasonYear = (anySummary && anySummary.header.season.year) || new Date().getFullYear();
  await mapLimit(teamIds, 8, async (tid) => {
    const feed = await espn(`${CORE}/seasons/${seasonYear}/types/2/teams/${tid}/statistics`);
    Object.assign(statsByTeam[tid], extraStatsFromTeamFeed(feed));
  });
  const { ranks, counts } = computeNationalRanks(statsByTeam);
  log(`Ranked ${teamIds.length} FBS teams`);

  // 3. ATS: closing lines of every finished game the slate teams played (cached across runs).
  const cache = (await readDoc("live_games/ats_lines")) || {};
  const lines = cache.lines || {};
  const slateTeamIds = new Set();
  for (const s of Object.values(slateSummaries)) for (const t of Object.values(teamHeadersFromSummary(s))) slateTeamIds.add(t.id);
  const scheduleByTeam = {};
  await mapLimit([...slateTeamIds], 6, async (tid) => {
    const sch = await espn(`/teams/${tid}/schedule`);
    scheduleByTeam[tid] = ((sch && sch.events) || [])
      .filter((e) => e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type && e.competitions[0].status.type.completed)
      .map((e) => String(e.id));
  });
  const lastFive = {};
  for (const s of Object.values(slateSummaries)) Object.assign(lastFive, lastFiveFromSummary(s));
  const needed = new Set();
  for (const ids of Object.values(scheduleByTeam)) ids.forEach((id) => { if (!lines[id]) needed.add(id); });
  for (const l5 of Object.values(lastFive)) l5.forEach((e) => { if (e.eventId && !lines[e.eventId]) needed.add(e.eventId); });
  await mapLimit([...needed], 8, async (id) => {
    const l = atsLineFromSummary(id, await espn(`/summary?event=${id}`));
    if (l) lines[id] = l;
  });
  log(`ATS lines: ${needed.size} fetched, ${Object.keys(lines).length} cached`);
  if (!DRY && needed.size) await patchDoc("live_games/ats_lines", { lines, updatedAt: new Date().toISOString() });

  // 4. One entry per slate game.
  const games = {};
  for (const g of slate) {
    const gid = String(g.id);
    const s = slateSummaries[String(g.espnEventId || "")];
    const prev = prevGames[gid] || {};
    if (!s) { if (Object.keys(prev).length) games[gid] = prev; continue; }
    const heads = teamHeadersFromSummary(s);
    const info = gameInfoFromSummary(s);
    const leaders = leadersFromSummary(s);
    const sideObj = (side) => {
      const h = heads[side];
      if (!h || !h.id) return undefined;
      const st = statsByTeam[h.id] || {};
      const sched = (scheduleByTeam[h.id] || []).map((id) => lines[id]).filter(Boolean);
      const ats = atsRecord(h.id, sched);
      return {
        ...h,
        leaders: leaders[h.id],
        stats: st,
        ranks: ranks[h.id],
        ats: (ats.w + ats.l + ats.p) ? ats : undefined,
        last5: (lastFive[h.id] || []).map((e) => ({ ...e, covered: coverResult(h.id, lines[e.eventId]) || undefined })),
      };
    };
    const away = sideObj("away"), home = sideObj("home");
    const entry = {
      gameId: gid,
      espnEventId: String(g.espnEventId),
      updatedAt: new Date().toISOString(),
      kickoff: info.kickoff,
      state: info.state,
      neutralSite: info.neutralSite,
      venue: info.venue,
      weather: info.weather,
      tv: info.tv,
      // ESPN drops the predictor once a game starts; keep the last pre-game number.
      predictor: info.predictor || prev.predictor,
      spread: linesFromSummary(s) || prev.spread,
      away, home,
      edges: (away && home) ? matchupEdges(away, home, ranks).map((e) => e.text) : undefined,
      rankOf: counts.ppg || undefined,
      preKickRefreshed: prev.preKickRefreshed && prev.kickoff === info.kickoff ? true : undefined,
    };
    games[gid] = compact(entry) || {};
  }
  return games;
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
