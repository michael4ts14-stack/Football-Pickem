// Pure helpers for the matchup builder: they turn ESPN responses into the
// live_games/week_N_matchups document. No network calls here, so they are unit-tested
// with saved ESPN responses (tests/matchups).

// Season stats we keep per team. `higher` says whether a bigger number is better.
export const TEAM_STAT_FIELDS = {
  ppg: { espn: "totalPointsPerGame", higher: true, label: "Points per game" },
  papg: { espn: "totalPointsPerGameAllowed", higher: false, label: "Points allowed" },
  ypg: { espn: "yardsPerGame", higher: true, label: "Yards per game" },
  yapg: { espn: "yardsPerGameAllowed", higher: false, label: "Yards allowed" },
  rypg: { espn: "rushingYardsPerGame", higher: true, label: "Rush yards per game" },
  ryapg: { espn: "rushingYardsPerGameAllowed", higher: false, label: "Rush yards allowed" },
  pypg: { espn: "passingYardsPerGame", higher: true, label: "Pass yards per game" },
  pyapg: { espn: "passingYardsPerGameAllowed", higher: false, label: "Pass yards allowed" },
  // These two come from ESPN's team-statistics feed, not the game summary.
  toMargin: { espn: "turnOverDifferential", higher: true, label: "Turnover margin" },
  thirdPct: { espn: "thirdDownConvPct", higher: true, label: "3rd-down %" },
};

// Offense unit vs the opposing defense unit, used for "matchup edges".
export const EDGE_PAIRS = [
  { off: "rypg", def: "ryapg", offLabel: "rush O", defLabel: "rush D" },
  { off: "pypg", def: "pyapg", offLabel: "pass O", defLabel: "pass D" },
  { off: "ppg", def: "papg", offLabel: "scoring O", defLabel: "scoring D" },
];
export const EDGE_MIN_RANK_GAP = 40;

export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Season stats for both teams from a game summary's boxscore: { teamId: { ppg, papg, ... } }.
export function seasonStatsFromSummary(summary) {
  const out = {};
  const teams = (summary && summary.boxscore && summary.boxscore.teams) || [];
  for (const t of teams) {
    const id = t.team && String(t.team.id);
    if (!id) continue;
    const byName = {};
    for (const s of t.statistics || []) byName[s.name] = num(s.value !== undefined ? s.value : s.displayValue);
    const stats = {};
    for (const [key, def] of Object.entries(TEAM_STAT_FIELDS)) {
      if (byName[def.espn] !== undefined && byName[def.espn] !== null) stats[key] = byName[def.espn];
    }
    // Only pre-game summaries carry season averages; a final's boxscore holds that game's totals.
    if (stats.ppg !== undefined || stats.papg !== undefined) out[id] = stats;
  }
  return out;
}

// Turnover margin and 3rd-down % from ESPN's team-statistics feed (any of its shapes).
export function extraStatsFromTeamFeed(feed) {
  const out = {};
  const cats = (feed && feed.splits && feed.splits.categories) ||
    (feed && feed.results && feed.results.stats && feed.results.stats.categories) || [];
  for (const c of cats) {
    for (const s of c.stats || []) {
      if (s.name === "turnOverDifferential" && out.toMargin === undefined) out.toMargin = num(s.value);
      if (s.name === "thirdDownConvPct" && out.thirdPct === undefined) out.thirdPct = num(s.value);
    }
  }
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

// National ranks (1 = best) for every stat, computed across all teams we have numbers for.
// Ties share the better rank. Returns { teamId: { ppg: 12, ... } } and the team count per stat.
export function computeNationalRanks(statsByTeam) {
  const ranks = {};
  const counts = {};
  for (const [key, def] of Object.entries(TEAM_STAT_FIELDS)) {
    const rows = Object.entries(statsByTeam)
      .filter(([, s]) => s && typeof s[key] === "number")
      .map(([id, s]) => ({ id, v: s[key] }));
    rows.sort((a, b) => (def.higher ? b.v - a.v : a.v - b.v));
    counts[key] = rows.length;
    let prevV = null, prevRank = 0;
    rows.forEach((r, i) => {
      const rank = (prevV !== null && r.v === prevV) ? prevRank : i + 1;
      prevV = r.v; prevRank = rank;
      (ranks[r.id] = ranks[r.id] || {})[key] = rank;
    });
  }
  return { ranks, counts };
}

// "Texas rush O #8 vs Vanderbilt rush D #94" when an offense out-ranks the defense it faces by 40+.
export function matchupEdges(away, home, ranks) {
  const edges = [];
  const sides = [[away, home], [home, away]];
  for (const [o, d] of sides) {
    const ro = ranks[o.id] || {}, rd = ranks[d.id] || {};
    for (const p of EDGE_PAIRS) {
      if (typeof ro[p.off] !== "number" || typeof rd[p.def] !== "number") continue;
      const gap = rd[p.def] - ro[p.off];
      if (gap >= EDGE_MIN_RANK_GAP) {
        edges.push({ gap, text: `${o.shortName} ${p.offLabel} #${ro[p.off]} vs ${d.shortName} ${p.defLabel} #${rd[p.def]}`, team: o.id });
      }
      // The defense side: a top defense facing a much weaker offense.
      const gapD = ro[p.off] - rd[p.def];
      if (gapD >= EDGE_MIN_RANK_GAP) {
        edges.push({ gap: gapD, text: `${d.shortName} ${p.defLabel} #${rd[p.def]} vs ${o.shortName} ${p.offLabel} #${ro[p.off]}`, team: d.id });
      }
    }
  }
  edges.sort((a, b) => b.gap - a.gap);
  const seen = new Set();
  return edges.filter((e) => (seen.has(e.text) ? false : seen.add(e.text))).slice(0, 3);
}

// Closing (and opening) line from a summary's pick center, from the home team's side.
export function linesFromSummary(summary) {
  const pc = (summary && summary.pickcenter) || [];
  for (const p of pc) {
    const ps = p.pointSpread || {};
    const homeClose = num(ps.home && ps.home.close && ps.home.close.line);
    const homeOpen = num(ps.home && ps.home.open && ps.home.open.line);
    const fallback = num(p.spread);
    const current = homeClose !== null ? homeClose : fallback;
    if (current === null && homeOpen === null) continue;
    return {
      provider: (p.provider && p.provider.name) || "",
      homeOpen: homeOpen,
      homeCurrent: current,
      overUnder: num(p.overUnder),
      details: p.details || "",
    };
  }
  return null;
}

// A finished game's result for the ATS cache: scores + closing home line.
export function atsLineFromSummary(eventId, summary) {
  const comp = summary && summary.header && summary.header.competitions && summary.header.competitions[0];
  if (!comp || !comp.status || !comp.status.type || !comp.status.type.completed) return null;
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  const lines = linesFromSummary(summary);
  if (!home || !away) return null;
  return {
    eventId: String(eventId),
    date: comp.date || "",
    homeId: String(home.team.id), awayId: String(away.team.id),
    homeScore: num(home.score), awayScore: num(away.score),
    homeLine: lines ? lines.homeCurrent : null,
  };
}

// Did `teamId` cover in this cached game? "Y", "N", "P" (push) or null when there was no line.
export function coverResult(teamId, g) {
  if (!g || g.homeLine === null || g.homeLine === undefined || g.homeScore === null || g.awayScore === null) return null;
  const isHome = String(g.homeId) === String(teamId);
  if (!isHome && String(g.awayId) !== String(teamId)) return null; // not this team's game
  const teamLine = isHome ? g.homeLine : -g.homeLine;
  const margin = isHome ? g.homeScore - g.awayScore : g.awayScore - g.homeScore;
  const adj = margin + teamLine;
  if (adj > 0) return "Y";
  if (adj < 0) return "N";
  return "P";
}

export function atsRecord(teamId, games) {
  const rec = { w: 0, l: 0, p: 0 };
  for (const g of games) {
    const r = coverResult(teamId, g);
    if (r === "Y") rec.w++;
    else if (r === "N") rec.l++;
    else if (r === "P") rec.p++;
  }
  return rec;
}

const LEADER_CATS = { passingYards: "passing", rushingYards: "rushing", receivingYards: "receiving" };

export function leadersFromSummary(summary) {
  const out = {};
  for (const t of (summary && summary.leaders) || []) {
    const id = t.team && String(t.team.id);
    if (!id) continue;
    const list = [];
    for (const cat of t.leaders || []) {
      const kind = LEADER_CATS[cat.name];
      const l = cat.leaders && cat.leaders[0];
      if (!kind || !l || !l.athlete) continue;
      list.push({
        kind,
        name: l.athlete.displayName || "",
        position: (l.athlete.position && l.athlete.position.abbreviation) || "",
        statLine: l.displayValue || "",
        headshot: (l.athlete.headshot && l.athlete.headshot.href) || "",
      });
    }
    if (list.length) out[id] = list;
  }
  return out;
}

export function lastFiveFromSummary(summary) {
  const out = {};
  for (const t of (summary && summary.lastFiveGames) || []) {
    const id = t.team && String(t.team.id);
    if (!id) continue;
    out[id] = (t.events || []).map((e) => ({
      eventId: String(e.id || ""),
      date: e.gameDate || "",
      result: e.gameResult || "",
      score: e.score || "",
      homeAway: e.atVs === "@" ? "away" : "home",
      oppName: (e.opponent && e.opponent.displayName) || "",
      oppAbbr: (e.opponent && e.opponent.abbreviation) || "",
    }));
  }
  return out;
}

export function gameInfoFromSummary(summary) {
  const comp = (summary && summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const gi = (summary && summary.gameInfo) || {};
  const venue = gi.venue || {};
  const addr = venue.address || {};
  const w = gi.weather || null;
  const tv = (comp.broadcasts || []).map((b) => (b.media && b.media.shortName) || "").filter(Boolean);
  const pred = summary && summary.predictor;
  const info = {
    kickoff: comp.date || "",
    state: (comp.status && comp.status.type && comp.status.type.state) || "",
    neutralSite: !!comp.neutralSite,
    venue: venue.fullName ? { name: venue.fullName, city: addr.city || "", state: addr.state || "", indoor: venue.indoor === true } : null,
    weather: w && num(w.temperature) !== null ? { tempF: num(w.temperature), precipPct: num(w.precipitation), conditionId: String(w.conditionId || "") } : null,
    tv,
    predictor: null,
  };
  if (pred && pred.homeTeam && pred.awayTeam) {
    const h = num(pred.homeTeam.gameProjection), a = num(pred.awayTeam.gameProjection);
    if (h !== null && a !== null) info.predictor = { homePct: h, awayPct: a };
  }
  return info;
}

export function teamHeadersFromSummary(summary) {
  const comp = (summary && summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const out = {};
  for (const c of comp.competitors || []) {
    const t = c.team || {};
    const overall = (c.record || []).find((r) => r.type === "total") || (c.record || [])[0];
    out[c.homeAway] = {
      id: String(t.id || ""),
      name: t.displayName || t.location || "",
      shortName: t.location || t.shortDisplayName || t.displayName || "",
      abbr: t.abbreviation || "",
      color: t.color ? "#" + t.color : "",
      logo: (t.logos && t.logos[0] && t.logos[0].href) || "",
      rank: num(c.rank) && num(c.rank) <= 25 ? num(c.rank) : null,
      record: (overall && overall.summary) || "",
    };
  }
  return out;
}

// Drops empty values so the client never has to guard against "", null, NaN or [].
export function compact(v) {
  if (Array.isArray(v)) {
    const arr = v.map(compact).filter((x) => x !== undefined);
    return arr.length ? arr : undefined;
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const c = compact(x);
      if (c !== undefined) o[k] = c;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && !Number.isFinite(v)) return undefined;
  return v;
}
