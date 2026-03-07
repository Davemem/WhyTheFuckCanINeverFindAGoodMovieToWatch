# moviePicker

Movie discovery app with a browser UI and a small Node server that serves the frontend and `/api/*` endpoints.

## Run locally

```bash
npm start
```

The app starts on `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env` and fill in any API keys you want to use.

- `TMDB_BEARER_TOKEN`
- `TMDB_API_KEY`
- `OMDB_API_KEY`
- `DATABASE_URL` (required for Postgres pipeline and DB-first people endpoints)

If TMDb keys are not configured, the app falls back to demo mode.

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
npm run pipeline:auto -- --ingest-every-hours=24 --poll-seconds=30 --batch-size=500 --concurrency=6 --max-attempts=4 --max-ids=50000
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

## GitHub hosting

This project can be pushed to a GitHub repository without changes.

GitHub Pages is not enough to run the full app because the project depends on `server.js` for its API routes. To host the live app, use a platform that can run Node.js, such as Render, Railway, Fly.io, or Vercel with a serverless/API rewrite.
