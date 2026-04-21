# Phase 4: Hardening, QA, And Launch

## Goal

Take the now-functional auth and saved-data system from "working" to "production-ready".

At the end of this phase:

- authentication is secured appropriately
- rollout and rollback steps are documented
- production env/config is complete
- the team has confidence in launch behavior

## Security hardening checklist

## Cookies

- mark session cookies `HttpOnly`
- mark session cookies `Secure` in production
- set `SameSite=Lax` or stricter unless a specific cross-site flow requires otherwise
- define explicit expiration and renewal rules

## Session lifecycle

- hash stored session tokens
- revoke session on logout
- expire stale sessions with a cleanup job or lazy revocation
- update `last_seen_at` carefully to avoid excessive DB writes

## CSRF

Because authenticated writes will use cookies, add CSRF protection before launch.

Practical options:

- synchronizer token pattern
- double-submit cookie
- strict same-site posture plus origin checking for JSON writes

For a professional launch, combine `SameSite` with request origin validation and a CSRF token for state-changing endpoints.

## Input and auth validation

- validate request bodies on all auth and saved-data endpoints
- reject malformed IDs and oversized payloads
- return consistent auth error payloads
- avoid leaking internal verification details in client-visible errors

## Logging and observability

Add structured logs for:

- login success
- login failure
- logout
- session lookup failures
- import success/failure
- saved-data write failures

Do not log raw Google credentials or raw session tokens.

## Testing strategy

## Automated tests

Recommended minimum coverage:

- session creation and lookup
- auth-required endpoint rejection
- Google token verification failure path
- user creation on first sign-in
- repeat sign-in for existing user
- watchlist CRUD for authenticated users
- saved-people CRUD for authenticated users
- import endpoint deduplication behavior

## Manual QA

Test:

- anonymous browsing on all pages
- login from home page
- login from saved pages
- logout from every page
- import existing local saved data
- save/remove title while logged in
- save/remove person while logged in
- refresh page and confirm saved state persists
- open from another browser/device and confirm account-backed data appears

## Deployment checklist

- add Google app configuration for local and production origins
- set production env vars on Render
- verify cookie security settings under HTTPS
- run auth schema migration before enabling UI
- keep a rollback path that can hide login UI while preserving anonymous browsing

## Recommended rollout plan

1. Deploy backend/session foundations behind dormant UI.
2. Enable Google sign-in for internal testing.
3. Enable account-backed saved data for internal testing.
4. Test import flow with realistic local browser state.
5. Release publicly after verification.

## Nice-to-have follow-ups after launch

- account settings page
- explicit "merge vs replace" import choices
- multiple active session management
- optional email-only fallback auth
- preference syncing beyond saved titles/people

## Final acceptance criteria

- signed-in and signed-out states are both stable
- user data persists across devices
- session and write flows meet basic web security expectations
- rollout docs and env configuration are complete
- no core movie-discovery journeys regress
