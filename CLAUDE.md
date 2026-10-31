# Separated at Turf Pick'em

College football pick'em web app (Firebase project `football-pickem-46206`) plus a Gmail/ESPN Apps Script bot. Vault notes: `G:\ObsidianVault\WIKI\Football-Pickem\`.

## Layout and deploys
| Path | What | Deploy |
|---|---|---|
| `public/` | Web app. `index.html` is markup; `public/css/`, `public/js/` loaded by plain `<script>` tags in order | Merge into `main` runs `.github/workflows/deploy.yml` |
| `apps-script/Code.js` | The bot (source of truth) | `cd apps-script && clasp push` |
| `firestore.rules` | Security rules | `firebase deploy --only firestore:rules` |
| `tests/` | Offline tests | not deployed |

Never edit the bot in the Apps Script web editor, never `firebase deploy` from another folder.

## Tests (run what your change touches, all before merging)
- Bot: `node --test "tests/apps-script/*.test.js"`
- Web app: `cd tests/client && npm install`, then `node smoke.js report.json` and `node scenarios.js` (headless Edge, writes blocked)
- Rules: `cd tests/rules && npm install && cd ../..` then `firebase emulators:exec --config tests/rules/firebase.json --only firestore --project demo-pickem "node --test tests/rules/rules.test.js"` (needs Java 21)
- Production smoke: `SMOKE_URL=https://football-pickem-46206.web.app/ node tests/client/smoke.js live.json`

## Safety
- Real players use this. No deploy with failing tests; rules changes need the rules tests first.
- Never commit `.env` or service-account files. Push and merge only when the owner asks.
- Unmerged branches: `fix/security-hardening`, `claude/sat-ui-redesign-ogkerh` (see Master To-Do).

## Workflow (skills for this project)
- Bug: `superpowers:systematic-debugging` → failing test first → fix root cause → run the suite.
- UI: `frontend-design` + Playwright to look at the page; check mobile width.
- Firestore rules: write the rules test first; `security-guidance` stays on.
- Library questions (Firebase, Apps Script): Context7.
- Big change before merge: `/code-review`. Ponytail `full` (set in `.claude/settings.json` on `main`).
- Done: tests pass, small commit, OUTPUT note in `G:\ObsidianVault\OUTPUT\Football-Pickem\`.
