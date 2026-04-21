# Authentication And User Data Roadmap

This folder turns the current `moviePicker` codebase into a practical rollout plan for:

- adding Google-style sign-in
- introducing real user accounts
- moving saved data from browser-only storage into server-backed persistence
- doing it in phases without destabilizing the existing app

## Recommended implementation strategy

Use:

- Google Identity Services on the frontend for the sign-in UX
- server-side verification of Google ID tokens
- first-party session cookies managed by `server.js`
- Postgres tables for users, sessions, and saved entities

Do not start with:

- client-only JWT storage in `localStorage`
- Passport-heavy abstractions before the auth model is stable
- a full framework rewrite just to support login

This repo is currently a lightweight Node HTTP server with static HTML and vanilla JS. The lowest-risk professional path is to extend that architecture rather than replace it.

## Document map

- [01-current-state-analysis.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/01-current-state-analysis.md)
  Current codebase assessment, constraints, opportunities, and the target auth architecture.
- [02-phase-1-foundation.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/02-phase-1-foundation.md)
  Foundation work: decisions, config, schema, auth helpers, session primitives, and request plumbing.
- [03-phase-2-google-sign-in.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/03-phase-2-google-sign-in.md)
  Add the actual Google sign-in experience and account creation/login flow.
- [04-phase-3-user-data-sync.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/04-phase-3-user-data-sync.md)
  Move watchlist and saved people into authenticated server-backed persistence, with migration from existing browser state.
- [05-phase-4-hardening-launch.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/05-phase-4-hardening-launch.md)
  Security hardening, testing, rollout controls, and production launch checklist.
- [06-phase-5-account-sessions.md](/Users/dave/Documents/Projects/moviePicker/docs/auth/06-phase-5-account-sessions.md)
  Account settings, synced library overview, and active-session management after launch.

## Proposed phase order

1. Foundation
2. Google sign-in
3. Server-backed saved data
4. Hardening and launch
5. Account settings and session management

## High-level outcome

When all phases are complete, users should be able to:

- sign in with Google from any page
- stay logged in via secure HTTP-only sessions
- save titles and people to their account instead of only the current browser
- optionally import existing local saved data into their account once
- access the same saved state across devices

## Recommended delivery principle

Each phase should leave the app deployable.

That means:

- no partial auth flow merged without a usable fallback
- no forced data migration before server persistence is proven
- no removal of local saved-state support until account-backed storage is stable
