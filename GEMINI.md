# Separated at Turf Pick'em (Gemini / Antigravity Guide)

College football pick'em web app (Firebase project `football-pickem-46206`) plus a Gmail/ESPN Apps Script bot.
Vault documentation: `G:\ObsidianVault\WIKI\Football-Pickem\` and `G:\ObsidianVault\OUTPUT\Football-Pickem\`.

## Autonomous Operating Pipeline & Ponytail Policy
- **Ponytail Default:** Always use **`ponytail-full`** on every prompt. Smallest complete change, zero unrequested bloat, minimal diffs.
- **Skill Engine:**
  - Bugs & sync failures: `superpowers:systematic-debugging` (reproduce first with a failing test).
  - New logic / grading: `superpowers:test-driven-development`.
  - UI / Leaderboard: `modern-web-guidance` and `generative_ui` (verify responsiveness on mobile).
  - Code Review: `ponytail:ponytail-review` before committing changes.
  - New capabilities (Docker, CI/CD, styling): query `find-skills` and recommend 1 match.
  - Evidence before completion: verify all tests pass before declaring done (`verification-before-completion`).
  - Auto-Vault: write OUTPUT note in `OUTPUT/Football-Pickem/YYYY-MM-DD <title>.md`.

## Layout & Architecture
| Path | Purpose | Deploy |
|---|---|---|
| `public/` | Web app (`index.html`, `public/css/`, `public/js/` loaded in order) | Merge to `main` triggers GitHub Actions `.github/workflows/deploy.yml` |
| `apps-script/Code.js` | Backend scoring & email bot | `cd apps-script && clasp push` |
| `firestore.rules` | Security rules (zero-write client model) | `firebase deploy --only firestore:rules` |
| `tests/` | Offline automated test suites | Not deployed |

*Never edit the bot in the web editor, never run `firebase deploy` outside this project.*

## Tests (Run Before Committing)
- **Bot:** `node --test "tests/apps-script/*.test.js"`
- **Web App:** `cd tests/client && npm install && node smoke.js report.json`
- **Firestore Rules:** `firebase emulators:exec --config tests/rules/firebase.json --only firestore --project demo-pickem "node --test tests/rules/rules.test.js"`
- **Production Smoke:** `SMOKE_URL=https://football-pickem-46206.web.app/ node tests/client/smoke.js live.json`

## Safety Boundaries
- Real users depend on this system during live games.
- Never commit credentials (`.env`, `football-pickem-*.json`, service accounts).
- All live score syncing runs client-side (30s interval); avoid unnecessary Firestore database writes.
