# Phase 5: Account Settings And Session Management

## Goal

Build the first real post-launch account management surface on top of the shipped auth/session foundation.

At the end of this phase:

- signed-in users can open a dedicated account page
- account-backed library totals are visible in one place
- active sessions are visible across browsers/devices
- users can revoke older sessions without breaking the current session

## Why this is the right next step

Phase 4 made cookie-backed auth and writes production-ready.

The next highest-value follow-up is not a rewrite or a second auth provider. It is giving signed-in users confidence and control over the account/session model that now exists:

- "Am I really signed in?"
- "How much data is actually synced to my account?"
- "Where else is this account active?"
- "Can I sign out a lost or stale browser?"

This phase also directly uses data the server already stores in `user_sessions`, which keeps the implementation low-risk and aligned with the current architecture.

## Scope

Implement:

- `GET /api/me/account`
  Returns the signed-in account profile plus high-level counts for saved titles, saved people, and active sessions.
- `GET /api/me/sessions`
  Returns active sessions for the current user, including current-session labeling.
- `POST /api/me/sessions/revoke-other`
  Revokes every active session except the current one.
- `DELETE /api/me/sessions/:id`
  Revokes a specific non-current session owned by the signed-in user.
- `account.html`
  Dedicated account/settings page in the existing multi-page vanilla app.
- shared navigation entry points
  So the page is reachable without hiding or changing anonymous browsing.

## Constraints

- keep the existing custom Node HTTP server
- keep anonymous browsing intact
- do not replace Google sign-in or current saved-data flows
- protect session-management writes with the same trusted-origin and CSRF posture already used for account-backed saves
- do not require a schema rewrite if the current `user_sessions` table is sufficient

## Product behavior

### Signed out

- `/account.html` still loads
- the page explains that anonymous browsing remains available
- no account-only data is shown

### Signed in

- the page shows the signed-in account identity
- the page shows account-backed saved-title and saved-people counts
- the page shows active sessions with current-session labeling
- users can sign out one older session or all others
- current-session sign-out still goes through the existing logout flow

## Non-goals

- editing profile fields managed by Google
- replacing import UX
- adding another auth provider
- adding preferences sync beyond saved titles/people
- introducing a framework or SPA rewrite

## Validation

Automated coverage should include:

- session listing normalization/current-session labeling
- revoking one session
- revoking all non-current sessions
- account overview counts

Manual verification should include:

- signed-out visit to `/account.html`
- signed-in visit to `/account.html`
- revoking another session
- revoking all other sessions
- confirming current session stays active
