# Phase 3: User Data Sync And Migration

## Goal

Move saved titles and saved people from browser-only storage to authenticated account storage, while preserving a safe path for existing users with local data.

At the end of this phase:

- signed-in users save to the backend
- signed-out users can still use local-only saved state if you keep that fallback
- existing local data can be imported into the signed-in account
- saved pages read from the correct source of truth

## Current saved-data surfaces

Today the app stores:

- watchlist IDs
- watchlist movie payloads
- saved people payloads

These appear in:

- `app.js`
- `people.js`
- `saved.js`
- `saved-titles.js`

Because this logic is duplicated across multiple files, phase 3 should begin by introducing a shared saved-data client abstraction.

## Recommended new database tables

### `user_saved_titles`

- `id BIGSERIAL PRIMARY KEY`
- `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `movie_id BIGINT NOT NULL`
- `movie_payload JSONB`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- unique index on `(user_id, movie_id)`

### `user_saved_people`

- `id BIGSERIAL PRIMARY KEY`
- `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `person_id BIGINT NOT NULL`
- `bucket TEXT`
- `person_payload JSONB`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- unique index on `(user_id, person_id)`

Storing payload snapshots is appropriate here because the UI already depends on denormalized saved objects. You can always normalize more aggressively later.

## Recommended API surface

### Read endpoints

- `GET /api/me/watchlist`
- `GET /api/me/saved-people`
- optional `GET /api/me/saved` for one combined bootstrap payload

### Write endpoints

- `POST /api/me/watchlist`
- `DELETE /api/me/watchlist/:movieId`
- `POST /api/me/saved-people`
- `DELETE /api/me/saved-people/:personId`

### Import endpoint

- `POST /api/me/saved/import`

Import payload example:

```json
{
  "watchlist": [],
  "watchlistMovies": [],
  "savedPeople": []
}
```

The import endpoint should be idempotent enough that retrying does not create duplicates.

## Migration strategy

Recommended behavior after login:

1. Fetch account-backed saved data.
2. Inspect local browser saved data.
3. If local data exists and account data is empty or meaningfully different, show an import prompt.
4. Let the user import once.
5. After successful import, mark import completion locally so the prompt does not keep appearing.

Avoid auto-importing silently on first login. It is convenient, but it makes debugging and user support harder if something looks duplicated or unexpected.

## Source-of-truth rules

When signed out:

- local storage is the source of truth

When signed in and account data has loaded successfully:

- server data is the source of truth

When signed in but server data fails to load:

- show an error state
- do not silently write conflicting local changes as though they were synced

This rule is important. Silent fallback writes are one of the fastest ways to create data inconsistency.

## Frontend refactor recommendation

Create a shared saved-data module that hides whether data is local or remote.

Suggested responsibilities:

- `getSavedState()`
- `saveTitle(movie)`
- `removeTitle(movieId)`
- `savePerson(person)`
- `removePerson(personId)`
- `importLocalState()`

Then page scripts call the abstraction rather than directly touching `window.localStorage`.

This is likely the most important code-quality improvement in the whole auth rollout.

## UX recommendations

- show a gentle prompt after first authenticated load if local data exists
- explain clearly that importing brings existing browser saves into the account
- show a success confirmation after import
- keep signed-out flows usable

Recommended copy:

- "Import saved titles and people from this browser"
- "This brings your existing local saves into your account so they follow you across devices."

## Acceptance criteria

- signed-in users can save and remove titles through the backend
- signed-in users can save and remove people through the backend
- saved pages render account-backed data correctly
- existing local users can import browser data once
- anonymous local save behavior is either preserved intentionally or removed intentionally with clear UX

## Out of scope

- collaborative sharing
- favorites/privacy settings
- full user profile management
