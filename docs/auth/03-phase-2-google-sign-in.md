# Phase 2: Google Sign-In

## Goal

Add a professional Google-style login experience that creates or resumes a first-party app session.

At the end of this phase:

- users can sign in with Google
- the backend verifies identity before creating a session
- the frontend reflects signed-in state consistently
- the app still uses local saved data until phase 3

## Recommended technical approach

Use Google Identity Services with backend token verification.

Recommended flow:

1. Load the Google Identity Services client script on pages that show sign-in controls.
2. Render a Google sign-in button in the shared auth UI.
3. Receive the Google credential response on the client.
4. POST the credential to `/api/auth/google`.
5. Verify the token on the server.
6. Find or create the local user and linked identity records.
7. Create a secure app session in `user_sessions`.
8. Set the HTTP-only session cookie.
9. Return the normalized user payload.
10. Refresh client auth state and re-render UI.

## Why this approach fits this codebase

- it works with a multi-page app
- it avoids putting long-lived auth state in `localStorage`
- it keeps your backend in control of authorization
- it avoids requiring a full OAuth redirect flow on day one

## Server responsibilities

The backend endpoint must validate:

- token signature
- token expiry
- issuer
- audience equals your `GOOGLE_CLIENT_ID`
- email presence
- email verification if your product requires it

Then it should:

- upsert the `users` record
- upsert the `user_identities` record for provider `google`
- create a session row
- set the cookie
- return a minimal user object

## Frontend responsibilities

The frontend should:

- show the Google sign-in button only when signed out
- show loading/error state if sign-in fails
- refresh auth state after successful login
- avoid assuming login means saved-data sync already happened

Recommended post-login copy:

- "Signed in successfully"
- "Your local saved titles can be imported to this account"

That makes phase 3 discoverable without mixing both concerns.

## Suggested endpoint contract

### `POST /api/auth/google`

Request body:

```json
{
  "credential": "google-id-token"
}
```

Response:

```json
{
  "authenticated": true,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "displayName": "Example User",
    "avatarUrl": "https://..."
  }
}
```

### `GET /api/auth/session`

Response:

```json
{
  "authenticated": true,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "displayName": "Example User",
    "avatarUrl": "https://..."
  }
}
```

Or when signed out:

```json
{
  "authenticated": false,
  "user": null
}
```

## UI changes to make in this phase

- title-bar account area on all pages
- optional lightweight signed-in badge in saved pages
- clear sign-out action
- polished sign-in pending/error states

Recommended UI rules:

- login entry point should be globally visible
- account state should not shift layout aggressively
- sign-out should be one click
- signed-out users should still be able to browse the app

## Testing checklist

- sign in with a valid Google account
- sign in with an expired or invalid credential
- refresh the page after login and remain authenticated
- sign out and confirm session invalidation
- verify anonymous browsing still works
- verify account UI appears correctly on every HTML page

## Acceptance criteria

- Google sign-in works end to end
- backend verifies Google credentials before session creation
- session cookie persists login across page loads
- sign-out clears the app session
- no saved-data regression for anonymous users

## Out of scope

- importing local saved state
- replacing local saved state with server state
- account management beyond sign-out
