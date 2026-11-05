// Builds pickem_v14/kickoff_locks for a slate no commissioner's device has processed yet (the bot
// posts slates without kickoff times). No network calls here. Same result as
// pushKickoffLocksToFirebase and pickDeadlineMs in public/js.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function wallClock(ms, tz) {
  const v = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms))) v[p.type] = p.value;
  return { y: +v.year, mo: +v.month, d: +v.day, hr: +v.hour % 24, min: +v.minute, dayIdx: DAYS.indexOf(v.weekday) };
}

export function deadlineMs(kicksMs, cfg = {}) {
  if (!kicksMs.length) return null;
  const d = cfg.deadlineConfig || {};
  const day = DAYS.includes(d.day) ? d.day : "Fri";
  const time = /^\d{1,2}:\d{2}$/.test(d.time || "") ? d.time : "21:00";
  const tz = d.tz || "America/Chicago";
  const sorted = [...kicksMs].sort((a, b) => a - b);
  const k = wallClock(sorted[Math.floor(sorted.length / 2)], tz);
  const [h, m] = time.split(":").map(Number);
  const target = Date.UTC(k.y, k.mo - 1, k.d + DAYS.indexOf(day) - k.dayIdx, h, m);
  let ms = target;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(ms, tz);
    ms += target - Date.UTC(w.y, w.mo - 1, w.d, w.hr, w.min);
  }
  return ms;
}

// Kickoff per game id: the slate's own time, else the ESPN event with this exact pair of teams.
export function kickoffsForSlate(games, events) {
  const names = (c) => { const t = (c && c.team) || {}; return [t.location, t.displayName, t.shortDisplayName, t.name].filter(Boolean).map(norm); };
  const out = {};
  for (const g of games) {
    let iso = g.kickoffIso;
    if (!iso) {
      const hit = (events || []).find((ev) => {
        if (g.espnEventId && String(ev.id) === String(g.espnEventId)) return true;
        const cs = (ev.competitions && ev.competitions[0] && ev.competitions[0].competitors) || [];
        if (cs.length < 2) return false;
        const [a, b] = [names(cs[0]), names(cs[1])];
        const ga = norm(g.away), gh = norm(g.home);
        return (a.includes(ga) && b.includes(gh)) || (a.includes(gh) && b.includes(ga));
      });
      iso = hit && hit.date;
    }
    const ms = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isNaN(ms)) out[String(g.id)] = ms;
  }
  return out;
}

// A commissioner's device owns the locks once it has written this week's deadline.
export function locksAreCurrent(locks, week) {
  return !!locks && String(locks.week) === String(week) && !!locks.deadlineAt;
}

// null when too few games have a kickoff time to trust the result.
export function buildLocks(games, week, cfg, events) {
  const kicks = kickoffsForSlate(games, events);
  const ids = Object.keys(kicks);
  if (!games.length || ids.length < Math.ceil(games.length / 2)) return null;
  const byTime = {};
  for (const id of ids) (byTime[kicks[id]] = byTime[kicks[id]] || []).push(id);
  const times = Object.keys(byTime).map(Number).sort((a, b) => a - b);
  const deadline = deadlineMs(times.flatMap((t) => byTime[t].map(() => t)), cfg);
  const mode = (cfg && cfg.lockMode) || "friday_9pm_cst";
  const overrides = (cfg && cfg.gameLockOverrides) || {};
  const reveal = mode === "friday_9pm_cst" || mode === "global_locked" ? deadline : times[times.length - 1];
  return {
    week,
    windows: times.map((t) => ({ at: new Date(t), ids: byTime[t] })),
    deadlineAt: new Date(deadline),
    revealAt: new Date(reveal),
    openIds: Object.keys(overrides).filter((id) => overrides[id] === "open"),
    lockedIds: Object.keys(overrides).filter((id) => overrides[id] === "locked"),
  };
}
