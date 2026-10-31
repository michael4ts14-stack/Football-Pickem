# Codebase Map

| Path | What |
|---|---|
| `public/` | Hosted web app (Firebase Hosting) |
| `firestore.rules` | Security rules; `live_games/*` is service-account or commissioner write |
| `tools/lib/firestore-rest.mjs` | Shared Firestore REST client and service-account auth for the jobs |
| `tools/form`, `tools/live`, `tools/matchups` | Scheduled job scripts |
| `.github/workflows/` | `deploy.yml` (hosting, `FIREBASE_SERVICE_ACCOUNT`), `form.yml`, `live.yml`, `matchups.yml` (`FIRESTORE_SERVICE_ACCOUNT`) |
| `apps-script/` | Google Apps Script bot (writes with the owner's login) |
| `tests/` | `node --test "tests/<area>/*.test.mjs"` |
| `BUGS.md`, `README.md`, `docs/` | Bug list, overview, feature parity |

Branch: `claude/sat-ui-redesign-ogkerh`.
