// Pure helpers for the live game-day job: they shrink an ESPN game summary to what the
// field, drive chart, play list and win-probability line need, keeping ESPN's own shape so
// the browser parses it with the same code it uses for a summary it fetched itself
// (parseSingleEspnDrive in public/js/render/field-tracker.js). No network calls here.

export const CURRENT_DRIVE_PLAYS = 10; // plays kept from the drive in progress (newest)
export const PAST_DRIVE_PLAYS = 3;     // plays kept from finished drives (plus their first play)
export const WIN_PROB_POINTS = 200;

const pick = (o, keys) => {
  if (!o || typeof o !== "object") return undefined;
  const out = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") out[k] = o[k];
  return Object.keys(out).length ? out : undefined;
};

// Only what parseSingleEspnDrive reads.
const SPOT_KEYS = ["distance", "yardsToEndzone", "downDistanceText", "possessionText"];

export function trimPlay(p) {
  if (!p) return undefined;
  const out = pick(p, ["id", "text", "scoringPlay", "statYardage"]) || {};
  if (!out.text && p.shortText) out.text = p.shortText;
  if (p.type && p.type.text) out.type = { text: p.type.text };
  if (p.period && p.period.number) out.period = { number: p.period.number };
  if (p.clock && p.clock.displayValue) out.clock = { displayValue: p.clock.displayValue };
  const start = pick(p.start, SPOT_KEYS);
  if (start) {
    if (p.start.team && p.start.team.id) start.team = { id: String(p.start.team.id) };
    out.start = start;
  }
  const end = pick(p.end, SPOT_KEYS);
  if (end) out.end = end;
  return out;
}

// Keeps the first play (where the drive started) and the last `keepLast` plays.
export function trimDrive(d, keepLast) {
  if (!d) return undefined;
  const plays = Array.isArray(d.plays) ? d.plays : [];
  const kept = plays.length <= keepLast + 1 ? plays : [plays[0], ...plays.slice(-keepLast)];
  const out = pick(d, ["id", "description", "yards", "isScore", "result", "displayResult", "shortDisplayResult"]) || {};
  // offensivePlays must survive the trim, or the browser would count the kept plays instead.
  out.offensivePlays = typeof d.offensivePlays === "number" ? d.offensivePlays : plays.length;
  if (d.team) out.team = pick(d.team, ["id", "abbreviation", "displayName", "shortDisplayName", "location"]);
  if (d.start && d.start.text) out.start = { text: d.start.text };
  if (d.end && d.end.text) out.end = { text: d.end.text };
  if (d.timeElapsed && d.timeElapsed.displayValue) out.timeElapsed = { displayValue: d.timeElapsed.displayValue };
  out.plays = kept.map(trimPlay).filter(Boolean);
  return out;
}

// Home win chance per play, thinned to at most `max` points but always ending on the latest.
export function thinWinProb(raw, max = WIN_PROB_POINTS) {
  const arr = (Array.isArray(raw) ? raw : []).filter((w) => w && typeof w.homeWinPercentage === "number");
  if (arr.length <= max) return arr.map((w) => ({ homeWinPercentage: w.homeWinPercentage }));
  const step = (arr.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push({ homeWinPercentage: arr[Math.round(i * step)].homeWinPercentage });
  return out;
}

export function competitorsFromSummary(summary) {
  const comp = summary && summary.header && summary.header.competitions && summary.header.competitions[0];
  return ((comp && comp.competitors) || []).map((c) => ({
    homeAway: c.homeAway,
    score: c.score,
    team: pick(c.team, ["id", "abbreviation", "displayName", "location"]),
  }));
}

export function statusFromSummary(summary) {
  const comp = summary && summary.header && summary.header.competitions && summary.header.competitions[0];
  const st = comp && comp.status;
  return {
    state: (st && st.type && st.type.state) || "pre",
    completed: !!(st && st.type && st.type.completed),
    period: (st && st.period) || 0,
    detail: (st && st.type && st.type.shortDetail) || "",
  };
}

// The document the browser reads for one game: live_games/week_N_drives_<gameId>.
export function liveDocFromSummary(summary, { gameId, eventId, week }) {
  const drives = (summary && summary.drives) || {};
  const status = statusFromSummary(summary);
  const previous = (drives.previous || []).map((d) => trimDrive(d, PAST_DRIVE_PLAYS)).filter(Boolean);
  // While a game is on, ESPN's last "previous" drive is often the one in progress; keep more of it.
  const current = drives.current ? trimDrive(drives.current, CURRENT_DRIVE_PLAYS) : undefined;
  if (!current && status.state === "in" && previous.length) {
    previous[previous.length - 1] = trimDrive(drives.previous[drives.previous.length - 1], CURRENT_DRIVE_PLAYS);
  }
  const doc = {
    gameId: String(gameId),
    eventId: String(eventId),
    week,
    status,
    summary: {
      header: { competitions: [{ competitors: competitorsFromSummary(summary) }] },
      drives: current ? { previous, current } : { previous },
      winprobability: thinWinProb(summary && summary.winprobability),
    },
  };
  return doc;
}

// A stable fingerprint of what the browser would see, so unchanged games are not re-written.
export function liveDocSignature(doc) {
  const s = doc.summary;
  const all = [...(s.drives.previous || []), ...(s.drives.current ? [s.drives.current] : [])];
  const last = all[all.length - 1];
  const lastPlay = last && last.plays && last.plays[last.plays.length - 1];
  return [doc.status.state, doc.status.detail, all.length, last && last.plays && last.plays.length,
    lastPlay && (lastPlay.id || lastPlay.text), s.winprobability.length].join("|");
}
