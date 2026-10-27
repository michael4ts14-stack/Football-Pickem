// Pure helpers for the official Separated at Turf Google Form: read its structure from
// FB_PUBLIC_LOAD_DATA_, match each slate game to its question and each team to its exact
// answer text, and build pre-filled links. No network calls here (tests/form).

export const NAME_QUESTION_RE = /\bname\b/i;
export const TIEBREAKER_RE = /pick the score|tie-?breaker/i;

export function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function fbDataFromHtml(html) {
  const m = String(html || "").match(/var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

// FB_PUBLIC_LOAD_DATA_ -> { title, settings, questions: [{ entry, title, description, type, required, choices }] }
// type: 0 short answer, 1 paragraph, 2 multiple choice, 3 dropdown, 4 checkboxes.
export function parseFormData(fb) {
  const info = (fb && fb[1]) || [];
  const questions = [];
  for (const it of info[1] || []) {
    const entries = it[4] || [];
    for (const e of entries) {
      questions.push({
        entry: "entry." + e[0],
        title: String(it[1] || ""),
        description: String(it[2] || ""),
        type: it[3],
        required: !!e[2],
        choices: (e[1] || []).map((o) => String(o[0])),
      });
    }
  }
  return { title: String(info[8] || fb[3] || ""), settings: info[10] || null, questions };
}

// "#22 Arizona 6-1 at #13 Texas Tech 6-1 (-3.5)" -> { first: "Arizona", second: "Texas Tech" }
export function splitMatchupTitle(title) {
  const clean = String(title || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\d+/g, " ")
    .replace(/\b\d+-\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = clean.match(/^(.*?)\s+(?:at|vs\.?|@)\s+(.*)$/i);
  return m ? { first: m[1].trim(), second: m[2].trim() } : null;
}

function teamMatches(text, name, code) {
  const t = norm(text), n = norm(name), c = norm(code);
  if (!t) return false;
  return t === n || t === c || n.startsWith(t) || t.startsWith(n);
}

// "SoCar" -> "South Carolina": same first letter, every letter in order.
function isAbbreviationOf(text, name) {
  const t = norm(text), n = norm(name);
  if (!t || !n || t[0] !== n[0]) return false;
  let i = 0;
  for (const ch of n) if (ch === t[i]) i++;
  return i === t.length;
}

// Which side of our game a form answer means: "away" | "home" | null (ambiguous).
// Exact names/codes first; an in-order abbreviation only when it fits exactly one team.
function sideForChoice(choice, g) {
  const pick = (a, h) => (a && !h ? "away" : (h && !a ? "home" : null));
  const strict = pick(teamMatches(choice, g.away, g.awayCode), teamMatches(choice, g.home, g.homeCode));
  if (strict) return strict;
  return pick(isAbbreviationOf(choice, g.away), isAbbreviationOf(choice, g.home));
}

// Map slate games to form questions. Never guesses: anything not matched exactly is reported.
export function matchFormToSlate(form, slateGames) {
  const gameQs = form.questions.filter((q) => (q.type === 2 || q.type === 3) && q.choices.length === 2);
  const used = new Set();
  const games = {};
  const unmatchedGames = [];
  for (const g of slateGames) {
    const hits = gameQs.filter((q) => {
      if (used.has(q.entry)) return false;
      const t = splitMatchupTitle(q.title);
      if (!t) return false;
      return (teamMatches(t.first, g.away, g.awayCode) && teamMatches(t.second, g.home, g.homeCode)) ||
        (teamMatches(t.first, g.home, g.homeCode) && teamMatches(t.second, g.away, g.awayCode));
    });
    if (hits.length !== 1) {
      unmatchedGames.push({ gameId: String(g.id), matchup: `${g.away} at ${g.home}`, reason: hits.length ? "more than one question fits" : "no question fits" });
      continue;
    }
    const q = hits[0];
    const s0 = sideForChoice(q.choices[0], g), s1 = sideForChoice(q.choices[1], g);
    if (!s0 || !s1 || s0 === s1) {
      unmatchedGames.push({ gameId: String(g.id), matchup: `${g.away} at ${g.home}`, reason: `answer choices "${q.choices.join('" / "')}" don't map to the two teams` });
      continue;
    }
    used.add(q.entry);
    games[String(g.id)] = {
      entry: q.entry,
      title: q.title,
      choices: { [s0]: q.choices[0], [s1]: q.choices[1] },
    };
  }
  const unmatchedQuestions = gameQs.filter((q) => !used.has(q.entry)).map((q) => q.title);
  const name = form.questions.find((q) => q.type === 0 && NAME_QUESTION_RE.test(q.title));
  const tb = form.questions.find((q) => (q.type === 0 || q.type === 1) && (TIEBREAKER_RE.test(q.title) || TIEBREAKER_RE.test(q.description)));
  return {
    games,
    unmatchedGames,
    unmatchedQuestions,
    nameQuestion: name ? { entry: name.entry, title: name.title, hint: name.description } : null,
    tiebreakerQuestion: tb ? { entry: tb.entry, title: tb.title, hint: tb.description } : null,
  };
}

// Pre-filled viewform link. picks: { gameId: "away" | "home" }. Returns { url, missing, unmapped }.
export function buildPrefillUrl(formDoc, { name, picks, tiebreaker }) {
  const params = new URLSearchParams();
  params.set("usp", "pp_url");
  if (formDoc.nameQuestion && name) params.append(formDoc.nameQuestion.entry, name);
  const missing = [], unmapped = [];
  for (const [gid, q] of Object.entries(formDoc.games || {})) {
    const side = picks[gid];
    if (!side) { missing.push(gid); continue; }
    const choice = q.choices[side];
    if (!choice) { unmapped.push(gid); continue; }
    params.append(q.entry, choice);
  }
  if (formDoc.tiebreakerQuestion && tiebreaker) params.append(formDoc.tiebreakerQuestion.entry, tiebreaker);
  return { url: formDoc.viewformUrl.replace(/\?.*$/, "") + "?" + params.toString(), missing, unmapped };
}
