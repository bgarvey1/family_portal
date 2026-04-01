# Family Hub — Claude Code Build Spec
## Complete setup, deploy, and wire-up from scratch

---

## Context

This spec deploys a Node.js backend called **Family Hub** to Google Cloud Run.
The backend polls a Google Drive folder, classifies new files with Claude Vision,
stores structured manifests in Firestore, and exposes a REST API for a React frontend.

All source code is already written. This spec covers:
1. Installing prerequisites (gcloud, Node.js)
2. GCP project setup (APIs, Firestore, service account, Drive sharing)
3. Local test run
4. Cloud Run deploy
5. Cloud Scheduler setup
6. Frontend wire-up

**Working directory:** assume the `familyhub-backend/` folder is present in the
current directory. If not, ask the user where it is before proceeding.

---

## Variables — collect these before starting

Before running any commands, ask the user for the following. Do not guess or
substitute defaults. Collect all of them upfront in a single prompt:

```
ANTHROPIC_API_KEY     = sk-ant-...
GCP_PROJECT_ID        = (existing project ID, or we will create one)
DRIVE_FOLDER_ID       = (from Drive URL: drive.google.com/drive/folders/FOLDER_ID)
REGION                = us-east1   ← confirm or change
POLL_INTERVAL_MINUTES = 15         ← confirm or change
```

Generate `API_KEY` automatically:
```bash
openssl rand -hex 32
```
Store this value — you will need it for both the Cloud Run deploy and the frontend.

---

## Phase 1 — Prerequisites

### 1.1 Check for Homebrew
```bash
which brew
```
If not found, install it:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
After install on Apple Silicon, ensure brew is on PATH:
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 1.2 Install gcloud CLI
```bash
brew install --cask google-cloud-sdk
```
Verify:
```bash
gcloud --version
```
Expected: `Google Cloud SDK 4xx.x.x` or similar.

### 1.3 Install Node.js (v20+)
```bash
node --version
```
If not found or version < 20:
```bash
brew install node
```
Verify:
```bash
node --version   # must be v20 or higher
npm --version
```

### 1.4 Authenticate gcloud
```bash
gcloud auth login
```
This opens a browser. Tell the user:
> "A browser window will open — sign in with the Google account you want to
> use for this project. Come back here when done."

Wait for confirmation before continuing.

Also set application default credentials (needed by the backend locally):
```bash
gcloud auth application-default login
```

---

## Phase 2 — GCP Project

### 2.1 Set or create project

If the user provided an existing `GCP_PROJECT_ID`:
```bash
gcloud config set project $GCP_PROJECT_ID
```

If they want a new project:
```bash
gcloud projects create familyhub-$(openssl rand -hex 3) --name="Family Hub"
# Capture the generated project ID
GCP_PROJECT_ID=$(gcloud projects list --filter="name:Family Hub" --format="value(projectId)" | head -1)
gcloud config set project $GCP_PROJECT_ID
echo "Project ID: $GCP_PROJECT_ID"
```

Verify the active project:
```bash
gcloud config get-value project
```

### 2.2 Enable billing (required for Cloud Run)

Check if billing is already enabled:
```bash
gcloud billing projects describe $GCP_PROJECT_ID --format="value(billingEnabled)"
```

If output is `False` or empty, tell the user:
> "Billing must be enabled before we can use Cloud Run and the other APIs.
> Please go to: console.cloud.google.com/billing and link a billing account
> to project **$GCP_PROJECT_ID**. Come back here when done.
> Note: this project will cost essentially nothing — well within free tiers."

Wait for confirmation, then re-run the check.

### 2.3 Enable required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  drive.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  --project=$GCP_PROJECT_ID
```
This takes 1–2 minutes. Wait for it to complete.

Verify all are enabled:
```bash
gcloud services list --enabled --project=$GCP_PROJECT_ID \
  --filter="name:(run.googleapis.com OR firestore.googleapis.com OR drive.googleapis.com OR cloudscheduler.googleapis.com OR cloudbuild.googleapis.com)" \
  --format="table(name,state)"
```
Expected: 5 rows, all state `ENABLED`.

### 2.4 Create Firestore database
```bash
gcloud firestore databases create \
  --location=$REGION \
  --type=firestore-native \
  --project=$GCP_PROJECT_ID
```

If this fails with "database already exists", that's fine — continue.

### 2.5 Create service account
```bash
gcloud iam service-accounts create familyhub-sa \
  --display-name="Family Hub Service Account" \
  --project=$GCP_PROJECT_ID
```

Grant Firestore access:
```bash
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Grant Cloud Run invoker access (needed for Scheduler → Cloud Run calls):
```bash
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### 2.6 Create local service account key (for local dev/test)
```bash
gcloud iam service-accounts keys create familyhub-backend/service-account.json \
  --iam-account=familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com
```

Add to .gitignore:
```bash
echo "service-account.json" >> familyhub-backend/.gitignore
```

### 2.7 Share the Drive folder

The service account email is:
```
familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com
```

Display it clearly:
```bash
echo ""
echo "==================================================="
echo "ACTION REQUIRED — Share your Drive folder"
echo "==================================================="
echo ""
echo "Service account email:"
echo "  familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com"
echo ""
echo "Steps:"
echo "  1. Open Google Drive in a browser"
echo "  2. Right-click your 'Family Vault' folder → Share"
echo "  3. Add the email above as a Viewer"
echo "  4. Click Send (it will say the account doesn't have a Google account — that's ok, proceed)"
echo ""
echo "Come back here when done."
echo "==================================================="
```

Wait for user confirmation before continuing.

---

## Phase 3 — Local Setup and Test

### 3.1 Install npm dependencies
```bash
cd familyhub-backend
npm install
```

### 3.2 Create .env file
```bash
cat > .env << EOF
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GCP_PROJECT_ID=$GCP_PROJECT_ID
DRIVE_FOLDER_ID=$DRIVE_FOLDER_ID
POLL_INTERVAL_MINUTES=$POLL_INTERVAL_MINUTES
API_KEY=$API_KEY
PORT=8080
NODE_ENV=development
ALLOWED_ORIGINS=https://claude.ai,http://localhost:3000
EOF
```

### 3.3 Start local server
```bash
npm run dev &
SERVER_PID=$!
sleep 3
```

### 3.4 Health check
```bash
curl -s http://localhost:8080/api/health | python3 -m json.tool
```
Expected:
```json
{ "status": "ok", "ts": "..." }
```

If this fails, check the server output for errors before continuing.

### 3.5 Test sync (this will actually hit Drive and Firestore)
```bash
curl -s -X POST http://localhost:8080/api/sync/await \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```
Expected: `{ "status": "done", "processed": N, "skipped": 0, "errors": [] }`

If `processed` is 0 and the folder has files, the Drive sharing in 2.7 may not
have propagated yet. Wait 60 seconds and retry.

### 3.6 Check manifests
```bash
curl -s http://localhost:8080/api/manifests \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```
Expected: `{ "manifests": [...], "count": N }`

### 3.7 Stop local server
```bash
kill $SERVER_PID 2>/dev/null
cd ..
```

---

## Phase 4 — Cloud Run Deploy

### 4.1 Build and push container
```bash
cd familyhub-backend

gcloud builds submit \
  --tag gcr.io/$GCP_PROJECT_ID/familyhub-backend \
  --project=$GCP_PROJECT_ID
```

This takes 3–5 minutes. Wait for `SUCCESS` before continuing.

### 4.2 Deploy to Cloud Run
```bash
gcloud run deploy familyhub-backend \
  --image gcr.io/$GCP_PROJECT_ID/familyhub-backend \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --service-account familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,\
DRIVE_FOLDER_ID=$DRIVE_FOLDER_ID,\
POLL_INTERVAL_MINUTES=$POLL_INTERVAL_MINUTES,\
API_KEY=$API_KEY,\
ALLOWED_ORIGINS=https://claude.ai,\
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 2 \
  --project=$GCP_PROJECT_ID
```

### 4.3 Capture service URL
```bash
SERVICE_URL=$(gcloud run services describe familyhub-backend \
  --region $REGION \
  --project $GCP_PROJECT_ID \
  --format 'value(status.url)')

echo ""
echo "Service URL: $SERVICE_URL"
echo ""
```

### 4.4 Smoke test deployed service

Health check (no auth):
```bash
curl -s $SERVICE_URL/api/health | python3 -m json.tool
```

Authenticated manifest list:
```bash
curl -s $SERVICE_URL/api/manifests \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```

Sync status:
```bash
curl -s $SERVICE_URL/api/sync/status \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```

All three must return valid JSON before proceeding.

---

## Phase 5 — Cloud Scheduler

### 5.1 Create polling job
```bash
gcloud scheduler jobs create http familyhub-sync \
  --location $REGION \
  --schedule "*/$POLL_INTERVAL_MINUTES * * * *" \
  --uri "$SERVICE_URL/api/sync" \
  --http-method POST \
  --oidc-service-account-email familyhub-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --oidc-token-audience "$SERVICE_URL" \
  --project=$GCP_PROJECT_ID
```

### 5.2 Trigger a manual run to verify end-to-end
```bash
gcloud scheduler jobs run familyhub-sync \
  --location $REGION \
  --project=$GCP_PROJECT_ID
```

Wait 10 seconds, then check sync status:
```bash
curl -s $SERVICE_URL/api/sync/status \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```

`lastSyncAt` should now be populated.

---

## Phase 6 — Frontend Wire-up

### 6.1 Display final values clearly
```bash
echo ""
echo "==================================================="
echo "DEPLOYMENT COMPLETE"
echo "==================================================="
echo ""
echo "Paste these two values into FamilyHub.jsx:"
echo ""
echo "  const BACKEND_URL = '$SERVICE_URL';"
echo "  const API_KEY     = '$API_KEY';"
echo ""
echo "They go at the very top of the file, lines 8-9."
echo "==================================================="
echo ""
```

### 6.2 Update FamilyHub.jsx automatically

Find and update the two constants in FamilyHub.jsx.
The file is a React artifact — locate it and replace the placeholder lines:

```
const BACKEND_URL = '';  // e.g. 'https://familyhub-backend-xxxx-ue.a.run.app'
const BACKEND_KEY = '';  // your API_KEY from .env
```

Replace with:
```
const BACKEND_URL = '$SERVICE_URL';
const BACKEND_KEY = '$API_KEY';
```

If FamilyHub.jsx is not in the current directory, ask the user where it is.

---

## Phase 7 — End-to-End Verification

Walk through this checklist and confirm each step passes:

```
[ ] curl $SERVICE_URL/api/health                → { "status": "ok" }
[ ] curl $SERVICE_URL/api/manifests (with key)  → manifests array (may be empty if Drive folder empty)
[ ] curl $SERVICE_URL/api/sync/await (with key) → { "status": "done", ... }
[ ] curl $SERVICE_URL/api/sync/status (with key)→ lastSyncAt is populated
[ ] Open FamilyHub artifact in Claude.ai        → "🟢 Live" badge appears in header
[ ] Add a photo to the Drive folder             → press Sync Now in Admin → Vault tab shows new item
[ ] Ask grandparent chat about the photo        → response cites the correct vault item
```

If any step fails, capture the error output and investigate before marking done.

---

## Troubleshooting Reference

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Drive API 403 | Service account not added as Viewer on folder | Re-share folder; wait 60s |
| Cloud Run 403 on /api/sync | Scheduler OIDC token issue | Check service account has `roles/run.invoker` |
| `DRIVE_FOLDER_ID is not set` | Env var missing in Cloud Run | Edit service, add env var, redeploy |
| Manifests empty after sync | Files added before service account was granted access | Re-share, delete Firestore sync cursor doc, re-sync |
| `ShadingType` import error | Wrong `sharp` binary for platform | Run `npm rebuild sharp` |
| CORS error in artifact | ALLOWED_ORIGINS missing `https://claude.ai` | Update env var in Cloud Run, redeploy |
| `processed: 0` after first sync | Drive sharing not propagated yet | Wait 60–120s, retry |

### Delete sync cursor to force full re-scan
If you need to re-index everything from scratch:
```bash
# Install gcloud firestore emulator or use REST
curl -X DELETE \
  "https://firestore.googleapis.com/v1/projects/$GCP_PROJECT_ID/databases/(default)/documents/vault_meta/sync_config" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```
Then trigger a manual sync.

---

## Cost Estimate

| Service | Free tier | Expected usage | Cost |
|---------|-----------|----------------|------|
| Cloud Run | 2M req/mo, 360K CPU-sec | ~3K req/mo | $0 |
| Firestore | 1 GiB storage, 50K reads/day | <100 docs | $0 |
| Cloud Scheduler | 3 jobs free | 1 job | $0 |
| Cloud Build | 120 min/day | Build only | $0 |
| Claude API | — | ~50 classifications/mo | ~$0.10 |
| **Total** | | | **< $1/month** |

---

## Summary of what was built

When this spec completes, you will have:

- **Cloud Run service** at `$SERVICE_URL` — polls Drive, classifies with Claude, writes Firestore
- **Firestore database** — `vault_manifests` collection (manifests) + `vault_meta` (sync cursor)
- **Cloud Scheduler job** — fires every `$POLL_INTERVAL_MINUTES` minutes automatically
- **FamilyHub.jsx** — updated with live backend URL and key, showing `🟢 Live` mode
- **End-to-end flow verified** — drop file in Drive → classified → retrievable in chat
