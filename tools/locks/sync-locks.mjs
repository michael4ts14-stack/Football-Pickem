// Hourly job: gives a bot-posted slate its server-side locks and reveal time without waiting for a
// commissioner to open the app. Does nothing once this week's locks exist.
import { initFirestoreAuth, readDoc, patchDoc, fetchJson } from "../lib/firestore-rest.mjs";
import { buildLocks, locksAreCurrent } from "./locks-lib.mjs";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const authed = await initFirestoreAuth();
  const shared = await readDoc("pickem_v14/shared_state", ["customGames", "currentWeek", "commissionerConfig"]);
  if (!shared || !Array.isArray(shared.customGames) || !shared.currentWeek) return console.log("No slate yet.");
  const week = shared.currentWeek;
  if (locksAreCurrent(await readDoc("pickem_v14/kickoff_locks"), week)) return console.log(`Week ${week} locks are current.`);
  const needEspn = shared.customGames.some((g) => !g.kickoffIso);
  const sb = needEspn ? await fetchJson(`${SCOREBOARD}?groups=80&limit=300&week=${week}`) : null;
  const locks = buildLocks(shared.customGames, week, shared.commissionerConfig || {}, sb && sb.events);
  if (!locks) throw new Error(`Too few of week ${week}'s ${shared.customGames.length} games matched ESPN; locks not written.`);
  console.log(`Week ${week}: ${locks.windows.length} kickoff windows, deadline ${locks.deadlineAt.toISOString()}`);
  if (dryRun || !authed) return console.log("Dry run: nothing written.");
  await patchDoc("pickem_v14/kickoff_locks", { ...locks, updatedAt: new Date().toISOString() });
  console.log("Locks written.");
}

main().catch((e) => { console.error("Failed:", e.message || e); process.exit(1); });
