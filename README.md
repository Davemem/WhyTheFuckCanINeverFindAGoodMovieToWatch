# flickstuck

Live website: [flickstuck.onrender.com](https://flickstuck.onrender.com).

Movie and TV discovery app with a browser UI and a small Node server that serves the frontend and `/api/*` endpoints.

The home page is the single discovery surface: choose Movies, TV shows, or Both, quick-add a known title, or explore actors, writers, directors, producers, and studios. Award searches verify OMDb summaries against established TMDb candidates. Saved-person catalogues include movies and television. Older `/people.html` directory links redirect into the equivalent home-page state.

TV cards show series creators, season and episode counts, status, first/last aired years, episode runtime, and available series ratings. Watched status applies to the whole series. Streaming availability is looked up separately for each media type and country.

`GET /api/title-search?query=...&mediaType=movie|tv|both` searches the selected catalogues. `/api/discover` accepts the same media filter. Legacy `/api/movie-search` remains movie-only unless a media filter is supplied. TV enrichment and viewing links use IDs such as `tv:1396`; movie IDs remain numeric for compatibility. TV credits and details use cached live TMDb requests; the existing bulk people-ranking pipeline still ranks movie credits.

On startup, when `DATABASE_URL` is configured, the server applies the idempotent account schema in a transaction before accepting requests. Existing saved records default to movies, and the new `(user_id, media_type, movie_id)` key lets movies and shows share a catalogue number safely. Browser storage keys and authentication cookie names remain compatible with existing saves and sessions.

The flickstuck address uses a replacement Render web service with the existing Postgres database and worker. Account-backed saves remain available after signing in again. Cookies and guest-only browser saves belong to the old origin and do not automatically move between domains.

## Run locally

```bash
npm start
```

The app starts on `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env` and fill in any API keys you want to use.

- `APP_BASE_URL` (`http://localhost:3000` for local development)
- `AUTH_ALLOWED_ORIGINS` (comma-separated trusted write origins; defaults to `APP_BASE_URL`)
- `TMDB_BEARER_TOKEN`
- `TMDB_API_KEY`
- `OMDB_API_KEY`
- `DATABASE_URL` (required for Postgres pipeline and DB-first people endpoints)
- `GOOGLE_CLIENT_ID` (required for Google Identity Services sign-in)
- `SESSION_COOKIE_NAME` (defaults to `moviepicker_session`)
- `SESSION_SECRET` (required for signed-in session lookup; use a long random value)

If TMDb keys are not configured, the app falls back to demo mode.

## Authentication Status

Authentication Phases 1 through 5 are implemented in the current codebase.

The app now has production-oriented auth and account-backed saved data while keeping anonymous browsing and the localStorage fallback flows intact for signed-out users.

The app now ships:

- Postgres auth tables for `users`, `user_identities`, and `user_sessions`
- server-side session lookup primitives in the existing custom Node HTTP server
- secure first-party HTTP-only session cookie handling
- hashed session token storage in Postgres
- session-bound CSRF protection on authenticated writes
- trusted-origin validation for cookie-backed JSON writes
- lazy revocation of expired sessions
- structured auth and saved-data lifecycle logs
- `GET /api/auth/session`
- `POST /api/auth/google`
- `POST /api/auth/logout`
- server-side Google ID token verification
- local user and Google identity linking in Postgres
- shared frontend account/session bootstrap across the main HTML pages
- shared nav/header account UI for signed-out, sign-in pending, and signed-in states
- Google Identity Services sign-in across the existing multi-page vanilla HTML app
- dedicated account settings page at `/account.html`
- active-session visibility for signed-in users
- revoke-one-session and sign-out-other-sessions controls

Signed-in users also get:

- server-backed watchlist persistence
- server-backed saved-people persistence
- explicit local-to-account import for existing browser saves

Signed-out users keep:

- anonymous browsing on every page
- localStorage-backed saved titles and saved people

## Authentication Foundation Setup

Apply the auth schema to Postgres before using the auth/session endpoints:

```bash
psql "$DATABASE_URL" -f scripts/sql/auth-schema.sql
```

This migration creates:

- `users`
- `user_identities`
- `user_sessions`

New auth endpoints:

- `GET /api/auth/session`
- `POST /api/auth/google`
- `POST /api/auth/logout`

Frontend pages now load a shared account bootstrap script that shows:

- signed out: Google sign-in while anonymous browsing stays available
- signed in: account name/avatar plus `Sign out`

## Google Sign-In Setup

Create a Google OAuth web client in Google Cloud, then add your local and deployed origins to its allowed JavaScript origins.

Set these variables for the web app:

```bash
APP_BASE_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_oauth_web_client_id
SESSION_COOKIE_NAME=moviepicker_session
SESSION_SECRET=replace_with_a_long_random_secret
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

The server verifies Google ID tokens against `GOOGLE_CLIENT_ID`, creates or updates the local `users` and `user_identities` rows, then issues its own HTTP-only session cookie. The browser never stores the app session token in `localStorage`.

For production, also set:

```bash
AUTH_ALLOWED_ORIGINS=https://your-web-service-url
```

If you use multiple trusted origins during rollout, provide them as a comma-separated list.

## Offline People Ingestion Pipeline

This project includes a Postgres ingestion pipeline to scale beyond live TMDb calls.

It builds and hydrates normalized tables:
- `people_raw` (queued IDs from TMDb exports)
- `people`
- `movies`
- `person_movie_credits`

Run the full pipeline:

```bash
npm run pipeline:people
```

Or run step-by-step:

```bash
npm run db:init
npm run ingest:person-ids
npm run hydrate:people
```

Run continuously (automatic ingest + hydrate worker):

```bash
npm run pipeline:auto
```

Optional worker flags:

```bash
npm run pipeline:auto -- --ingest-every-hours=24 --poll-seconds=30 --batch-size=300 --concurrency=4 --max-attempts=4 --max-ids=100000
```

Useful flags:

```bash
npm run ingest:person-ids -- --max-ids=50000
npm run hydrate:people -- --batch-size=500 --concurrency=6 --max-attempts=4
```

## Render + Postgres

Use `render.yaml` to provision:
- web service
- worker service
- Postgres database

Set `DATABASE_URL` on both web and worker. The worker runs:

```bash
npm run pipeline:auto -- --ingest-every-hours=24 --poll-seconds=30 --batch-size=500 --concurrency=6 --max-attempts=4
```

Set these additional variables on the web service for auth/session support:

```bash
APP_BASE_URL=https://flickstuck.onrender.com
AUTH_ALLOWED_ORIGINS=https://flickstuck.onrender.com
GOOGLE_CLIENT_ID=...
SESSION_COOKIE_NAME=moviepicker_session
SESSION_SECRET=...
```

To trigger a fresh deploy of the latest pushed commit from your local machine, add Render deploy hook URLs to `.env`:

```bash
RENDER_WEB_DEPLOY_HOOK_URL=...
RENDER_WORKER_DEPLOY_HOOK_URL=...
```

Then run:

```bash
npm run deploy:render
```

The script checks for a clean working tree and compares the requested commit with the current branch on GitHub before triggering Render. Hook requests have a 30-second timeout and deploy that exact commit.

The production web service is `flickstuck` (`srv-daft4vf40ujc73cs0abg`). Its new deploy hook replaces the legacy web hook in the local, ignored `.env`; the worker hook is unchanged. When configuring another machine or GitHub Actions, copy the hook from this service's Render settings, not from `flickstuck-legacy` (`srv-d6jk83q4d50c738vgkug`). Keep the existing database and worker when migrating an existing installation; do not provision replacements from the Blueprint.

The Google OAuth web client must include `https://flickstuck.onrender.com` in its authorized JavaScript origins. Origin changes can take time to propagate. The old web service may be suspended after verifying the new website; retain it for rollback instead of deleting it.

To deploy automatically from GitHub on every push to `main`, add these repository secrets in GitHub under `Settings -> Secrets and variables -> Actions`:

```bash
RENDER_WEB_DEPLOY_HOOK_URL=...
RENDER_WORKER_DEPLOY_HOOK_URL=...
```

This repo includes the workflow [deploy-render.yml](.github/workflows/deploy-render.yml), which runs syntax, browser-state, API, and Postgres integration tests before posting the tested commit to configured deploy hooks. When no GitHub hooks are configured, the deployment job is explicitly skipped; use the local deploy script. Manual runs are also available from GitHub Actions.

## GitHub hosting

This project can be pushed to a GitHub repository without changes.

GitHub Pages is not enough to run the full app because the project depends on `server.js` for its API routes. To host the live app, use a platform that can run Node.js, such as Render, Railway, Fly.io, or Vercel with a serverless/API rewrite.

## Validation and deployment checks

```bash
npm ci
npm run check
npm test
```

Browser regression tests use jsdom and mocked API responses. The Postgres integration suite runs only with an explicit `TEST_DATABASE_URL`; it creates and removes a temporary schema and never falls back to `DATABASE_URL`. GitHub Actions provisions its own disposable Postgres database for this suite.

The Render configuration uses Node 22 and the npm lockfile. Both services run syntax and regression checks during builds. The web build also refreshes the local people index from a streamed TMDb export. If services were created manually, keep their build commands in sync with `render.yaml`; changing the file alone does not update those services.

`GET /api/health` reports server readiness and the `RENDER_GIT_COMMIT` when available, so a live deployment can be checked against the pushed commit.

Account imports run in batches of 20 records per collection, with each server request committed in one transaction. Google sign-in requires a verified email and preserves identity ownership by Google's subject identifier; a new subject cannot take over an existing account just by sharing its email address.

The hydration worker uses a Postgres session lock to prevent overlapping batches. If a worker exits mid-batch, its lock is released and the next worker requeues unfinished records. Recognition updates are transactional and only include people already hydrated in the database.
