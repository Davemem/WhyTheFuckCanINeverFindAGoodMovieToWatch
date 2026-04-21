# moviePicker

Movie discovery app with a browser UI and a small Node server that serves the frontend and `/api/*` endpoints.

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
APP_BASE_URL=https://your-web-service-url
AUTH_ALLOWED_ORIGINS=https://your-web-service-url
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

The script checks that your local `HEAD` matches `origin/<current-branch>` before it triggers Render, which helps avoid trying to deploy a commit that has not been pushed yet.

To deploy automatically from GitHub on every push to `main`, add these repository secrets in GitHub under `Settings -> Secrets and variables -> Actions`:

```bash
RENDER_WEB_DEPLOY_HOOK_URL=...
RENDER_WORKER_DEPLOY_HOOK_URL=...
```

This repo includes the workflow [deploy-render.yml](/Users/dave/Documents/Projects/moviePicker/.github/workflows/deploy-render.yml), which posts to those hooks on every push to `main` and also supports manual runs from the GitHub Actions tab.

## GitHub hosting

This project can be pushed to a GitHub repository without changes.

GitHub Pages is not enough to run the full app because the project depends on `server.js` for its API routes. To host the live app, use a platform that can run Node.js, such as Render, Railway, Fly.io, or Vercel with a serverless/API rewrite.
