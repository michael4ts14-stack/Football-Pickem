import { initFirestoreAuth, readDoc, patchDoc, fetchJson } from "../lib/firestore-rest.mjs";

const ESPN_RANKINGS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings";

export async function fetchOfficialCfbRankings() {
  const data = await fetchJson(ESPN_RANKINGS_URL);
  if (!data || !Array.isArray(data.rankings)) {
    throw new Error("Invalid rankings payload from ESPN");
  }

  const officialPoll = data.rankings.find((p) =>
    p.type === "cfp" ||
    (p.name && /playoff|cfp|committee/i.test(p.name)) ||
    (p.shortName && /cfp/i.test(p.shortName))
  ) || data.rankings.find((p) =>
    p.name === "AP Top 25" || p.type === "ap"
  ) || data.rankings[0];

  if (!officialPoll || !Array.isArray(officialPoll.ranks)) {
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
