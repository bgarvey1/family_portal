# FamilyHub

An AI-powered family memory portal designed for grandparents. Drop photos and documents into a shared Google Drive folder, and FamilyHub automatically classifies them, recognizes faces, and makes everything searchable through a warm, conversational chat interface.

## Features

- **Conversational Chat** -- Ask natural questions like "Show me photos of Mia skiing" or "What's the weather like where Ryan is?" Two-pass RAG retrieval finds relevant photos and documents, then Claude generates a warm, grandparent-friendly response.
- **Smart Vault** -- Google Drive sync with automatic AI classification (people, location, tags, sentiment) powered by Claude Sonnet. HEIC/HEIF photos are auto-converted for browser display.
- **Face Recognition** -- Click on a person in any photo to crop their face, then scan the entire vault to find them in other photos. Powered by Gemini 2.5 Flash multimodal vision. Supports accept/reject workflow with permanent human-decline tracking.
- **Family Profiles** -- Add family members with birthdays (auto-calculated age), schools, locations, activities, and links. Profile context is injected into every chat conversation.
- **Live Weather** -- Current conditions and 7-day forecast for each family member's location, displayed on the Chat tab. Powered by Open-Meteo (free, no API key needed).
- **Website Context** -- Add links to family profiles (e.g. a university website). When you ask about that person, the site is crawled in real-time and the content is used to ground the chat response.
- **Smart Label Propagation** -- Correct one photo's labels, then propagate those corrections to similar photos across the vault using AI-powered metadata matching.
- **Photo Upload** -- Upload photos directly through the app or via an Apple Shortcut for one-tap sharing from your phone.

## Architecture

```
familyhub-ui/          React frontend (Vite)
familyhub-backend/     Node.js + Express API (Cloud Run)
```

### Backend Services

| Service | Purpose |
|---------|---------|
| `classifier.js` | Claude Sonnet -- classifies photos and documents |
| `faces.js` | Gemini 2.5 Flash -- face crop, match, and vault scan |
| `weather.js` | Open-Meteo -- geocoding, current weather, 7-day forecast |
| `firestore.js` | Firestore -- manifests, knowledge, faces, profiles, deleted items |
| `drive.js` | Google Drive -- polls shared folder for new files |
| `sync.js` | Orchestrates Drive polling + classification pipeline |

### Firestore Collections

| Collection | Purpose |
|------------|---------|
| `vault_manifests` | Photo/document metadata + AI classification + corrections |
| `vault_meta` | Knowledge base entries (family facts) |
| `vault_faces` | Face reference crops for recognition |
| `vault_profiles` | Family member profiles |
| `vault_deleted` | Tracks deleted Drive files to prevent re-import |

## Setup

### Prerequisites

- Node.js 20+
- Google Cloud project with Firestore, Cloud Storage, and Cloud Run
- Google Drive API enabled
- Anthropic API key (Claude)
- Google AI Studio API key (Gemini)

### Environment Variables

**Backend** (set on Cloud Run via `--update-env-vars`):

```
API_KEY=<backend-api-key>
ANTHROPIC_API_KEY=<claude-api-key>
GEMINI_API_KEY=<gemini-api-key>
GCP_PROJECT_ID=<project-id>
DRIVE_FOLDER_ID=<shared-drive-folder-id>
```

**Frontend** (`familyhub-ui/.env`):

```
VITE_BACKEND_URL=https://<your-cloud-run-url>
VITE_BACKEND_KEY=<backend-api-key>
```

### Local Development

```bash
# Frontend
cd familyhub-ui
npm install
npm run dev

# Backend
cd familyhub-backend
npm install
node src/index.js
```

### Deployment

```bash
# Build and deploy backend to Cloud Run
cd familyhub-backend
gcloud builds submit --tag gcr.io/<project-id>/familyhub-backend:latest
gcloud run deploy familyhub-backend \
  --image gcr.io/<project-id>/familyhub-backend:latest \
  --region us-east1
```

**Important:** Never use `--set-env-vars` when deploying -- it replaces all env vars. Always use `--update-env-vars` to add/change specific variables.

## Security

- API keys are stored in environment variables, never in source code
- Backend endpoints are protected by API key authentication
- CORS is set to allow all origins (API key provides access control)
