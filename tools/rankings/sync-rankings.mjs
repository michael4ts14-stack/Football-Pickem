import { initFirestoreAuth, readDoc, patchDoc, fetchJson } from "../lib/firestore-rest.mjs";

const ESPN_RANKINGS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings";

// Same as fetchLatestCfpPoll in public/js/render/field-tracker.js.
export async function fetchLatestCfpPoll(now = new Date()) {
  const season = now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
  const idx = await fetchJson("https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/rankings");
  const item = (idx?.items || []).find((it) => it?.$ref?.includes(`/seasons/${season}/`) && /\/rankings\/21(\?|$)/.test(it.$ref));
  if (!item) return null;
  const poll = await fetchJson(item.$ref.replace(/^http:/, "https:"));
  if (!Array.isArray(poll?.ranks) || poll.ranks.length < 20) return null;
  const teams = await fetchJson("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000&groups=80");
  const byId = {};
  for (const t of teams?.sports?.[0]?.leagues?.[0]?.teams || []) if (t?.team) byId[t.team.id] = t.team.location || t.team.name;
  const ranks = poll.ranks.map((r) => {
    const m = r?.team?.$ref?.match(/teams\/(\d+)/);
    return { current: r.current, team: { location: m ? byId[m[1]] : null } };
  }).filter((r) => r.team.location);
  return ranks.length >= 20 ? { name: poll.name || "Playoff Committee Rankings", type: "cfp", ranks } : null;
}

export async function fetchOfficialCfbRankings() {
  const data = await fetchJson(ESPN_RANKINGS_URL);
  if (!data || !Array.isArray(data.rankings)) {
    throw new Error("Invalid rankings payload from ESPN");
  }

  // An announced poll with no teams yet must not strip every rank from the slate.
  const polls = data.rankings.filter((p) => p && Array.isArray(p.ranks) && p.ranks.length >= 20);
  // The site feed drops CFP between a weekend's games and the next Tuesday release; the latest CFP
  // poll (ESPN core poll 21) still wins over AP then.
  if (!polls.some((p) => p.type === "cfp" || /playoff|cfp|committee/i.test(p.name || ""))) {
    const cfp = await fetchLatestCfpPoll().catch(() => null);
    if (cfp) polls.unshift(cfp);
  }
  const officialPoll = polls.find((p) =>
    p.type === "cfp" ||
    (p.name && /playoff|cfp|committee/i.test(p.name)) ||
    (p.shortName && /cfp/i.test(p.shortName))
  ) || polls.find((p) =>
    p.name === "AP Top 25" || p.type === "ap"
  ) || polls[0];

  if (!officialPoll) {
    throw new Error("No ranked teams found in ESPN poll");
  }

  const ranks = {};
  for (const rk of officialPoll.ranks) {
    if (rk && rk.current && rk.team) {
      const loc = rk.team.location || rk.team.name;
      const str = `#${rk.current}`;
      if (loc) {
        ranks[loc] = str;
        if (loc === "Miami") ranks["Miami (FL)"] = str;
        if (loc === "Ole Miss") ranks["Mississippi"] = str;
        if (loc === "Mississippi") ranks["Ole Miss"] = str;
      }
    }
  }

  return { pollName: officialPoll.name || officialPoll.shortName || "CFP Rankings", ranks };
}

export async function syncRankingsToSharedState({ dryRun = false } = {}) {
  const authed = await initFirestoreAuth();
  console.log(`Firestore auth: ${authed ? "authenticated" : "unauthenticated"}`);

  const { pollName, ranks } = await fetchOfficialCfbRankings();
  console.log(`Using poll: ${pollName} (${Object.keys(ranks).length} teams mapped)`);
  console.log(`Top 5: Alabama=${ranks["Alabama"]}, UCLA=${ranks["UCLA"]}, Texas=${ranks["Texas"]}, Utah=${ranks["Utah"]}`);

  const state = await readDoc("pickem_v14/shared_state", ["customGames", "tiebreakerGame", "tiebreakerGameId", "weekLabel", "currentWeek"]);
  if (!state || !Array.isArray(state.customGames)) {
    console.log("No customGames found in pickem_v14/shared_state.");
    return { updated: false, changes: 0 };
  }

  let changes = 0;
  const games = state.customGames.map((g) => {
    const aRk = ranks[g.away] || null;
    const hRk = ranks[g.home] || null;
    const aCln = (g.awayRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
    const hCln = (g.homeRec || "").replace(/#\d+\s*•?\s*/g, "").trim();
    const newAwayRec = (aRk ? `${aRk} • ` : "") + aCln;
    const newHomeRec = (hRk ? `${hRk} • ` : "") + hCln;

    if (g.awayRec !== newAwayRec || g.homeRec !== newHomeRec) {
      console.log(`Game #${g.id} (${g.away} at ${g.home}): away '${g.awayRec}' -> '${newAwayRec}', home '${g.homeRec}' -> '${newHomeRec}'`);
      changes++;
    }

    return {
      ...g,
      awayRec: newAwayRec,
      homeRec: newHomeRec,
    };
  });

  let tiebreakerGame = state.tiebreakerGame;
  const tbId = state.tiebreakerGameId || (games.find((x) => x.isTiebreaker) || games[games.length - 1])?.id;
  if (tbId) {
    const tb = games.find((x) => x.id === tbId);
    if (tb) {
      const aRk = ranks[tb.away] ? `${ranks[tb.away]} ` : "";
      const hRk = ranks[tb.home] ? `${ranks[tb.home]} ` : "";
      tiebreakerGame = `${aRk}${tb.away} at ${hRk}${tb.home}`;
      if (tiebreakerGame !== state.tiebreakerGame) {
        console.log(`Tiebreaker game title updated: '${state.tiebreakerGame}' -> '${tiebreakerGame}'`);
        changes++;
      }
    }
  }

  if (changes === 0) {
    console.log("All games on the active slate already match official rankings. Nothing to update.");
    return { updated: false, changes: 0 };
  }

  if (dryRun || !authed) {
    console.log(`Dry run / unauthenticated: ${changes} game changes would be written to Firestore.`);
    return { updated: true, changes, dryRun: true };
  }

  console.log(`Writing ${changes} ranking updates to Firestore pickem_v14/shared_state...`);
  await patchDoc("pickem_v14/shared_state", {
    customGames: games,
    tiebreakerGame,
    updatedAt: new Date().toISOString(),
  });
  console.log("Successfully patched pickem_v14/shared_state in Firestore!");
  return { updated: true, changes, dryRun: false };
}

// Direct CLI invocation
if (process.argv[1] && process.argv[1].endsWith("sync-rankings.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  syncRankingsToSharedState({ dryRun })
    .then((r) => {
      console.log("Done:", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Failed:", e.message || e);
      process.exit(1);
    });
}
