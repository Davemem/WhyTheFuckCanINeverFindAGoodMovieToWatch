# Phase 1: Foundation

## Goal

Prepare the codebase for authentication and account-owned data without changing core browsing behavior yet.

At the end of this phase:

- the app still works for anonymous users
- the database can store users and sessions
- the backend can parse cookies and identify the current user
- the frontend can ask whether a user is signed in
- no saved-data migration is required yet

## Why this phase matters

This repo does not yet have the primitive building blocks auth depends on:

- user tables
- session tables
- cookie parsing
- request body helpers for auth endpoints
- reusable auth lookup logic

Building those first makes the Google login phase straightforward instead of tangled.

## Scope

## Backend

- add user/account schema
- add user session schema
- add auth utility modules
- add session cookie issuance and lookup helpers
- add `/api/auth/session`
- add `/api/auth/logout`

## Frontend

- add a shared auth bootstrap script
- add placeholder account UI regions in nav/header
- render signed-out vs signed-in states from `/api/auth/session`

## Config

- define required env vars
- document local and Render setup

## Recommended schema

Suggested tables:

### `users`

- `id BIGSERIAL PRIMARY KEY`
- `email TEXT NOT NULL UNIQUE`
- `display_name TEXT`
- `avatar_url TEXT`
- `email_verified BOOLEAN NOT NULL DEFAULT FALSE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `last_login_at TIMESTAMPTZ`

### `user_identities`

- `id BIGSERIAL PRIMARY KEY`
- `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `provider TEXT NOT NULL`
- `provider_subject TEXT NOT NULL`
- `provider_email TEXT`
- `profile_json JSONB`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- unique index on `(provider, provider_subject)`

Even if Google is the only provider now, this table avoids baking provider assumptions into `users`.

### `user_sessions`

- `id BIGSERIAL PRIMARY KEY`
- `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `session_token_hash TEXT NOT NULL UNIQUE`
- `expires_at TIMESTAMPTZ NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `ip_address TEXT`
- `user_agent TEXT`
- `revoked_at TIMESTAMPTZ`

Store only a hash of the session token server-side, not the raw token.

## Environment variables to add

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` only if later moving to a full OAuth authorization code flow
- `SESSION_COOKIE_NAME`
- `SESSION_SECRET` or a server secret used for token generation and signing utilities
- `APP_BASE_URL`

For the initial Google Identity Services plus ID-token verification flow, `GOOGLE_CLIENT_ID` is the main required Google setting.

## Backend implementation plan

1. Create a new SQL migration file for auth tables.
2. Add small reusable helpers instead of growing `server.js` monolithically.
3. Implement cookie parsing and cookie setting helpers.
4. Implement session token generation and hashing.
5. Implement session lookup from incoming requests.
6. Attach `currentUser` resolution to auth endpoints first, then generalize if needed.

## Suggested backend module split

- `lib/auth/cookies.js`
  Parse `Cookie` headers and serialize `Set-Cookie` values.
- `lib/auth/session.js`
  Generate raw session token, hash it, persist it, resolve authenticated user.
- `lib/auth/http.js`
  Parse JSON request bodies and centralize auth JSON responses.
- `lib/db/users.js`
  Create/find/update user and linked identity records.

If you prefer fewer files, the minimum acceptable split is auth helpers separated from content-serving code.

## Frontend implementation plan

1. Add a shared auth UI container to each page layout.
2. Create one shared client script that:
   - calls `/api/auth/session`
   - updates nav/header UI
   - exposes signed-in state to page scripts if needed
3. Keep signed-out behavior unchanged.

Recommended UI states:

- signed out: "Sign in"
- signed in: avatar, name, and "Sign out"

Do not add the live Google button yet in this phase if you want to keep the rollout tightly controlled. A neutral account placeholder is enough.

## Acceptance criteria

- anonymous browsing still works on all existing pages
- user/session tables exist in Postgres
- backend can create and clear app sessions
- `/api/auth/session` returns a consistent payload for both anonymous and authenticated requests
- all pages can render account state without errors
- no existing local watchlist or saved-people behavior is broken

## Deliverables

- auth migration SQL
- auth utility modules
- session API endpoints
- shared client auth bootstrap
- minimal nav account UI placeholder
- README updates for env vars and setup

## Out of scope

- Google sign-in button
- syncing local saved data to server
- account settings page
- multi-provider auth
- password login
