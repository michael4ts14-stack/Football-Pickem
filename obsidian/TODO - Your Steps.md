# TODO: Your Steps (only you can do these)

Do them in order. Do not deploy `firestore.rules` before step 4.

- [ ] 1. Create a dedicated service account, role `Cloud Datastore User` (`roles/datastore.user`), in project `football-pickem-46206`. Details: [[Firestore Service Account Setup]].
- [ ] 2. Create a JSON key for it.
- [ ] 3. GitHub repo, Settings > Secrets and variables > Actions > New repository secret. Name: `FIRESTORE_SERVICE_ACCOUNT`. Value: the whole JSON file contents.
- [ ] 4. Run the **matchups** workflow manually (Actions tab, Run workflow, tick force). The log must say `Firestore: using service account`. If it fails with "FIRESTORE_AUTH_REQUIRED is set but...", the secret is missing or misnamed.
- [ ] 5. Then run the **live** and **form** workflows once the same way.
- [ ] 6. Only now deploy the locked rules: `firebase deploy --only firestore:rules`.
- [ ] 7. Delete the downloaded JSON key from your machine.
- [ ] 8. Confirm the Apps Script bot's owner login still writes `live_games` (it bypasses rules via IAM).
- [ ] 9. Leave `FIREBASE_SERVICE_ACCOUNT` alone. It is for hosting deploy only now.
