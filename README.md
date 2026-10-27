# Separated at Turf Pick'em

## Layout

| Path | What it is | How it gets deployed |
|---|---|---|
| `public/` | The web app (Firebase Hosting, project `football-pickem-46206`). `index.html` is markup only; styles are in `public/css/`, scripts in `public/js/`, loaded in order by plain `<script>` tags. | Merging into `main` runs `.github/workflows/deploy.yml`. |
| `apps-script/` | The Gmail/ESPN bot (Apps Script project "Football Weekly"). `Code.js` is the source of truth. | `cd apps-script && clasp push` (not deployed by GitHub). |
| `firestore.rules` | Firestore security rules. | `firebase deploy --only firestore:rules` (not deployed by GitHub). |
| `tests/` | Offline tests (see below). | Not deployed. |

Do not edit the bot in the Apps Script web editor, and do not run `firebase deploy` from another
folder: the next deploy from this repo will overwrite those changes.

## Bot health

The bot writes `live_games/bot_status` on every run (`gmail` and `espn` entries with
`lastRunAt`, `lastSuccessAt`, `errors`). Commissioners see this as the 🤖 pill in the top bar.

## Tests

```sh
# Bot (Code.js) — offline, stubbed Apps Script services
node --test "tests/apps-script/*.test.js"

# Web app — headless Edge; Firestore writes and Apps Script calls are blocked
cd tests/client && npm install
node smoke.js report.json            # loads public/, clicks through every view
node scenarios.js                    # week-flicker / write-permission checks
SMOKE_URL=https://football-pickem-46206.web.app/ node smoke.js live.json   # against production

# Firestore rules — local emulator (needs Java 21)
cd tests/rules && npm install && cd ../..
firebase emulators:exec --config tests/rules/firebase.json --only firestore --project demo-pickem "node --test tests/rules/rules.test.js"
```
