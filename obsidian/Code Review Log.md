# Code Review Log: commit 8b184a5

| # | Finding | Fix |
|---|---|---|
| 1 | Deploy secret may lack Firestore write role | Dedicated `FIRESTORE_SERVICE_ACCOUNT` with `roles/datastore.user`; steps in [[Firestore Service Account Setup]] |
| 2 | Missing secret silently went anonymous | `FIRESTORE_AUTH_REQUIRED=true` in workflows; job fails with a clear message |
| 3 | Docs named the wrong secret | BUGS.md, README.md, firestore.rules and code comments updated |
| 4 | Deploy key exposed to cron jobs | Same fix as 1: deploy key left in `deploy.yml` only |
| 5 | Stale "Optional" comment in matchups.yml | Rewritten as required |

Still manual: [[TODO - Your Steps]].
