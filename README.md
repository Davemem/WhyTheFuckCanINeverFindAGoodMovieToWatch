# moviePicker

Movie discovery app with a browser UI and a small Node server that serves the frontend and `/api/*` endpoints.

## Run locally

```bash
node server.js
```

The app starts on `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env` and fill in any API keys you want to use.

- `TMDB_BEARER_TOKEN`
- `TMDB_API_KEY`
- `OMDB_API_KEY`

If TMDb keys are not configured, the app falls back to demo mode.

## GitHub hosting

This project can be pushed to a GitHub repository without changes.

GitHub Pages is not enough to run the full app because the project depends on `server.js` for its API routes. To host the live app, use a platform that can run Node.js, such as Render, Railway, Fly.io, or Vercel with a serverless/API rewrite.
