# Firestore Service Account Setup (BUGS B22)

Why: `firestore.rules` now blocks anonymous writes to `live_games/*`. The GitHub jobs (form, live, matchups) must authenticate. Service accounts bypass rules through IAM, so the account needs `roles/datastore.user`.

Why a new secret and not `FIREBASE_SERVICE_ACCOUNT`: that key is for hosting deploys and may lack Firestore access. Reusing it also exposes a deploy-capable key to cron jobs that run `tools/**` code every few minutes. A Firestore-only key limits the damage.

Console steps (Google Cloud console, project `football-pickem-46206`):
1. IAM & Admin > Service Accounts > Create, name `pickem-jobs`.
2. Grant role **Cloud Datastore User**. Nothing else.
3. Keys > Add key > JSON. Paste the file contents into the GitHub secret `FIRESTORE_SERVICE_ACCOUNT`.

Behaviour in code (`tools/lib/firestore-rest.mjs`):
- The workflows map the secret to env `GOOGLE_SERVICE_ACCOUNT_JSON` and set `FIRESTORE_AUTH_REQUIRED=true`.
- With that flag, a missing or invalid credential throws and fails the job. Without it (local runs, dry runs), the tools stay anonymous.
