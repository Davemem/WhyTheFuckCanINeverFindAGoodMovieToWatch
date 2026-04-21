# Current State Analysis

## Executive summary

The codebase is in a good position to add authentication without a rewrite.

Why:

- the backend already exists in `server.js`
- Postgres is already part of the deployed architecture
- the app already has a concept of user-owned data, but it is stored entirely in browser storage
- the frontend is simple enough that a shared auth client module can be introduced cleanly

The main gap is that there is no user identity model yet. The app knows about movies, people, and ingestion state, but not about accounts, sessions, or per-user ownership.

## What the codebase looks like today

## Runtime architecture

- `server.js` is a custom Node HTTP server
- static files are served directly from the repo root
- API endpoints live under `/api/*`
- the backend already uses Postgres via `pg`
- there is no Express, no auth middleware stack, and no session library yet

This matters because the best-fit solution is incremental server-side auth inside the existing server, not a framework migration.

## Frontend architecture

- `index.html`, `people.html`, `saved.html`, and `saved-titles.html` are plain static pages
- `app.js`, `people.js`, `saved.js`, and `saved-titles.js` hold page behavior
- the frontend already has established UI regions where account state can surface, especially the title bar and saved-state areas

This is good for auth rollout because a shared auth script can be loaded on each page without major restructuring.

## Current persistence model

Saved user state is currently browser-local only:

- `app.js` stores watchlist IDs, watchlist movie payloads, and saved people in `localStorage`
- `saved.js` reads and mutates the same local storage records
- `saved-titles.js` reads and mutates watchlist records from `localStorage`
- `people.js` also reads and mutates saved people in `localStorage`

Current storage keys:

- `wtfcineverfind-watchlist`
- `wtfcineverfind-watchlist-movies`
- `wtfcineverfind-saved-people`

Implication:

- users cannot access saved state across devices
- clearing browser storage loses saved state
- there is no secure ownership boundary
- login cannot merely be visual; persistence needs a server-backed model

## Existing database posture

The Postgres schema already supports:

- people ingestion
- movie metadata
- person/movie credits
- recognition scoring
- generated site snapshots

The current schema does not support:

- users
- linked external identities
- login sessions
- user-saved titles
- user-saved people
- audit timestamps for account actions

This is not a problem. It means auth can be added as a parallel domain rather than tangled into ingestion tables.

## Deployment posture

The app already targets Render with:

- a Node web service
- a Node worker
- a managed Postgres database

That makes production auth feasible with minimal platform churn. Additional environment variables and secure cookie settings are the main deployment additions.

## Constraints that should shape the design

## Constraint 1: custom HTTP server

Because the app uses `http.createServer`, anything added for auth must work well in a lower-level request model.

Recommendation:

- add small internal request utilities for cookies, body parsing, auth lookup, and JSON responses
- avoid introducing a large middleware framework just for authentication

## Constraint 2: static multi-page frontend

There is no SPA router or centralized state store.

Recommendation:

- create a small shared client auth module
- load auth state on every page
- render account UI consistently in the title bar

## Constraint 3: browser data already exists

Users may already have saved titles and people locally.

Recommendation:

- do not break existing local behavior immediately
- introduce a one-time import/sync path after login
- keep local read support during transition

## Constraint 4: no session or CSRF model yet

The app currently has no need for user-authenticated writes.

Recommendation:

- use secure HTTP-only cookies for session IDs
- add CSRF protection before enabling authenticated write endpoints

## Recommended target architecture

## Identity flow

Use Google Identity Services for sign-in, but do not trust the browser alone.

Recommended flow:

1. Frontend renders a Google sign-in button using Google Identity Services.
2. Google returns an ID token to the frontend.
3. Frontend posts that token to a backend endpoint such as `/api/auth/google`.
4. Backend verifies the token against Google public keys and expected audience.
5. Backend finds or creates a local user record.
6. Backend creates a first-party session record in Postgres.
7. Backend sets a secure HTTP-only session cookie.
8. Frontend asks `/api/auth/session` for the authenticated user profile.

This gives you Google login UX with your own application sessions, which is the most maintainable model for this app.

## Data model

Recommended new tables:

- `users`
- `user_identities`
- `user_sessions`
- `user_saved_titles`
- `user_saved_people`

Optional later:

- `user_preferences`
- `user_audit_events`

## Session model

Use opaque session IDs stored in cookies, not long-lived bearer tokens in browser storage.

Why:

- safer against token theft via XSS than `localStorage` JWTs
- simpler for this multi-page app
- easier to invalidate server-side
- cleaner separation between Google identity proof and app session lifecycle

## API surface to add

Recommended auth/session endpoints:

- `POST /api/auth/google`
- `POST /api/auth/logout`
- `GET /api/auth/session`

Recommended saved-data endpoints:

- `GET /api/me/saved`
- `POST /api/me/saved/import`
- `GET /api/me/watchlist`
- `POST /api/me/watchlist`
- `DELETE /api/me/watchlist/:movieId`
- `GET /api/me/saved-people`
- `POST /api/me/saved-people`
- `DELETE /api/me/saved-people/:personId`

The exact route names can vary, but the important design principle is to separate:

- auth/session lifecycle
- account-scoped resource access
- optional one-time migration/import

## Major risks if implemented poorly

## Risk 1: mixing local and remote truth without rules

If the frontend writes to both `localStorage` and the server without a clear precedence model, users will see duplicates, disappearing state, or inconsistent counts.

Mitigation:

- define a migration strategy explicitly
- once authenticated state is loaded successfully, server data becomes the primary source of truth
- keep local storage only as import source or signed-out fallback

## Risk 2: trusting Google response in the browser only

If the browser treats Google login as proof of identity without backend verification, the system is vulnerable.

Mitigation:

- always verify tokens server-side
- validate audience, issuer, expiry, and email verification claims

## Risk 3: introducing authenticated writes before CSRF protection

Cookie-based sessions require CSRF thinking for write endpoints.

Mitigation:

- implement CSRF token or same-site strategy before launching mutation endpoints
- prefer `SameSite=Lax` or stricter where possible

## Risk 4: over-scoping phase 1

Trying to add Google UI, session storage, user tables, saved-data migration, and polished account settings in one step will slow delivery and increase breakage.

Mitigation:

- keep phases deployable
- prove session/auth before migrating saved data

## File impact forecast

Most likely files to change in implementation:

- `server.js`
- `package.json`
- `.env.example`
- `README.md`
- `render.yaml`
- `styles.css`
- `index.html`
- `people.html`
- `saved.html`
- `saved-titles.html`
- `app.js`
- `people.js`
- `saved.js`
- `saved-titles.js`
- `scripts/sql/*.sql` for schema additions

Recommended new files/modules:

- `lib/auth/cookies.js`
- `lib/auth/session.js`
- `lib/auth/google.js`
- `lib/auth/csrf.js`
- `lib/db/users.js`
- `lib/db/user-saved-data.js`
- `public/auth.js` or `auth-client.js`

Exact file naming can vary, but splitting auth logic out of `server.js` early will keep the code maintainable.

## Professional implementation recommendation

If the goal is "Google style login, then user login option to save data", the most professional sequence is:

1. Create account/session foundations first.
2. Add Google sign-in against those foundations.
3. Move saved state to account-backed storage.
4. Harden, test, and launch.

That sequence is slower than a quick UI-only sign-in button, but it avoids building a login that looks real while the data model is still temporary.
