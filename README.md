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

## Email service

Pick receipts and pool emails (Wed/Thu nudge, Saturday master sheet) go through the Apps Script
Web App's `doPost` (`apps-script/Email.js`).

- **One URL for everyone.** The `/exec` URL lives in `pickem_v14_commissioners/email_service`
  (commissioners write it from Console › Banner & Recap › Email service; everyone reads it).
- **Every request is signed in.** The app sends the caller's Firebase ID token. `Email.js` checks
  `aud`/`iss`/`exp` and confirms the token with Identity Toolkit `accounts:lookup`. Receipts go only
  to the caller's own verified email, with picks read from Firestore on the server. Broadcasts are
  commissioner-only. Guests get "sign in".
- **Kill switch.** Script Property `BROADCASTS_ENABLED` (`true`/`false`, off when unset) gates the
  nudge, the master sheet and "email CSV to all". Commissioners flip it from the Console. Receipts
  aren't affected. A commissioner can always send to explicit test recipients.
- **Limits.** 45s duplicate guard and 5 receipts per user per hour. Every reply includes
  `MailApp.getRemainingDailyQuota()`. A broadcast with more recipients than the quota sends nothing.
- **Send log.** Every attempt is written to `pickem_v14_email_log` with the script owner's login.
  Only commissioners can read it (Console shows the last 50). The script owner needs access to the
  Firebase project (Owner or Cloud Datastore User); otherwise replies carry `logError`.

### Deploying Code.js / Email.js

The editor always runs the latest code, but the Web App (`/exec`) keeps running the version it was
deployed with until you publish a new version. Keep the same deployment so the URL never changes:

1. `cd apps-script && clasp push` (or paste `Code.js`, `Email.js` and `appsscript.json` into the editor).
2. In the editor: **Deploy › Manage deployments ›** pencil on the existing Web App ›
   **Version: New version** › Deploy. Execute as **Me**, Who has access **Anyone**.
   (CLI equivalent: `clasp deployments`, then `clasp deploy -i <deploymentId> -d "describe change"`.)
3. If Google asks to authorize new permissions (Firestore `datastore`), accept: run
   `authorizeAndTestEmailService` once in the editor.
4. Publish rules if they changed: `firebase deploy --only firestore:rules`.

The app checks `apiVersion` in every reply. An old deployment shows "The email service is running
an old version" in the app instead of failing silently.

## Firestore rules (who can change what)

`firestore.rules` is published by hand (`firebase deploy --only firestore:rules`); GitHub doesn't
deploy it. The Apps Script bot and email service use the owner's Google login, and Firebase
Hosting/Actions use service accounts, so none of them are limited by these rules.

| Data | Read | Write |
|---|---|---|
| `pickem_v14/shared_state` (pool) | everyone | commissioner: anything. Signed-in, unblocked player: the profile registry, privacy settings, and the one profile named in `lastProfileWriter`, only if that profile is bound to them |
| `pickem_v14_users/{profile}` (a player's picks) | everyone | the account bound to that profile, or a commissioner |
| `pickem_v14_bindings/{profile}` (which account plays a player) | everyone | commissioner (approve, unlink). A player creates their own only when: the commissioner registered their Google-verified email for that roster player (`playerEmailsMap`), the pick doc already named them as `ownerUid`, or (invite-code season) they're a new player with an invite pass |
| `pickem_v14_link_requests/{uid}` | that account, commissioner | that account files/cancels it (status `pending` only); commissioner decides |
| `pickem_v14_security/invite` (league invite code, `expiresAtTs`, `revoked`) | commissioner | commissioner |
| `pickem_v14_invite_passes/{uid}` | that account, commissioner | that account, only with the current code of a live link (not revoked, not past `expiresAtTs`) |
| `pickem_v14_accounts/{email_…}` (email, linked player, rivals) | owner, commissioner | owner, commissioner; no password hashes |
| `pickem_v14_commissioners/*` | everyone | commissioner |
| `pickem_v14_email_log` | commissioner | nobody (Apps Script only) |
| `pickem_v14_commish_log` (commissioner action log) | commissioner | commissioner: add entries under their own email; no edits or deletes |
| `live_games/*` | everyone | everyone, until the GitHub jobs get a service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) |

Invite links (`public/js/invite-links.js`): Commissioner › Roster & dues › League access makes,
regenerates, turns off and sets the expiry of the league link (`/?joinCode=…`). The code-free
status (`commissionerConfig.inviteLink`) lets the link's "You're invited" page say when it has
expired. That page offers "I'm new" or "I'm already in the league" (claim a roster name; names
linked to an account can't be picked). Removed players (`commissionerConfig.archivedProfiles`)
can't be claimed until restored from Commissioner › Users.

Account linking (`public/js/account-security.js`): League access is set in Commissioner ›
Roster › League access & security (`commissionerConfig.securityConfig.registrationMode`:
protected / invite code / registered emails only). Blocked accounts are
`commissionerConfig.blockedUsers` and can't write anything. The app checks whether these rules
are live (the bindings collection is readable) and links the old way until they are published.
When they go live, each existing player's binding is created the next time their app loads (from
`ownerUid` on their pick doc); tabs left open from before need a reload to save.

A commissioner is a signed-in account with a Google-verified email that is built in
(`michael4ts14@gmail.com`, `commissioner@separatedatturf.com`) or listed in
`pickem_v14_commissioners/roles`. Addresses at the typo domain `separatedatturt.com` never count.

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
cd tests/rules && npm install && npm test
```
