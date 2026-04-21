"use strict";

const MAX_SAVED_MOVIES_PER_IMPORT = 500;
const MAX_SAVED_PEOPLE_PER_IMPORT = 500;
const MAX_JSON_STRING_LENGTH = 2000;
const MAX_PERSON_NAME_LENGTH = 200;
const MAX_BUCKET_LENGTH = 40;

function normalizeSavedMoviePayload(movie) {
  if (!movie || !Number.isFinite(Number(movie.id))) {
    return null;
  }

  const normalizedId = Number(movie.id);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    return null;
  }

  return {
    ...sanitizeObject(movie),
    id: normalizedId,
  };
}

function normalizeSavedPersonPayload(person) {
  const personId = person?.id;
  if (personId === null || personId === undefined || String(personId).trim() === "") {
    return null;
  }

  const normalizedName = sanitizeText(person?.name, MAX_PERSON_NAME_LENGTH);
  if (!normalizedName) {
    return null;
  }

  return {
    ...sanitizeObject(person),
    id: sanitizeText(personId, 128),
    name: normalizedName,
    bucket: typeof person.bucket === "string" ? sanitizeText(person.bucket, MAX_BUCKET_LENGTH) : null,
  };
}

async function listUserSavedTitles({ queryDb, userId }) {
  const result = await queryDb(
    `
      SELECT movie_id, movie_payload, created_at, updated_at
      FROM user_saved_titles
      WHERE user_id = $1
      ORDER BY created_at DESC, movie_id DESC
    `,
    [userId],
  );

  return result.rows
    .map((row) => {
      const payload = row.movie_payload && typeof row.movie_payload === "object"
        ? row.movie_payload
        : {};
      return {
        ...payload,
        id: Number(row.movie_id),
        savedAt: payload.savedAt || row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter((movie) => Number.isFinite(Number(movie.id)));
}

async function listUserSavedPeople({ queryDb, userId }) {
  const result = await queryDb(
    `
      SELECT person_id, bucket, person_payload, created_at, updated_at
      FROM user_saved_people
      WHERE user_id = $1
      ORDER BY created_at DESC, person_id DESC
    `,
    [userId],
  );

  return result.rows
    .map((row) => {
      const payload = row.person_payload && typeof row.person_payload === "object"
        ? row.person_payload
        : {};
      return {
        ...payload,
        id: String(row.person_id),
        bucket: row.bucket || payload.bucket || null,
        savedAt: payload.savedAt || row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter((person) => person.id && person.name);
}

async function saveUserTitle({ queryDb, userId, movie }) {
  const normalizedMovie = normalizeSavedMoviePayload(movie);
  if (!normalizedMovie) {
    throw new Error("A valid movie payload with a numeric id is required.");
  }

  await queryDb(
    `
      INSERT INTO user_saved_titles (
        user_id,
        movie_id,
        movie_payload
      )
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, movie_id) DO UPDATE
      SET
        movie_payload = EXCLUDED.movie_payload,
        updated_at = NOW()
    `,
    [userId, normalizedMovie.id, JSON.stringify(normalizedMovie)],
  );

  return normalizedMovie;
}

async function removeUserTitle({ queryDb, userId, movieId }) {
  const normalizedMovieId = Number(movieId);
  if (!Number.isFinite(normalizedMovieId)) {
    throw new Error("A valid movie id is required.");
  }

  await queryDb(
    `
      DELETE FROM user_saved_titles
      WHERE user_id = $1
        AND movie_id = $2
    `,
    [userId, normalizedMovieId],
  );

  return normalizedMovieId;
}

async function saveUserPerson({ queryDb, userId, person }) {
  const normalizedPerson = normalizeSavedPersonPayload(person);
  if (!normalizedPerson) {
    throw new Error("A valid person payload with an id is required.");
  }

  await queryDb(
    `
      INSERT INTO user_saved_people (
        user_id,
        person_id,
        bucket,
        person_payload
      )
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (user_id, person_id) DO UPDATE
      SET
        bucket = EXCLUDED.bucket,
        person_payload = EXCLUDED.person_payload,
        updated_at = NOW()
    `,
    [userId, normalizedPerson.id, normalizedPerson.bucket, JSON.stringify(normalizedPerson)],
  );

  return normalizedPerson;
}

async function removeUserPerson({ queryDb, userId, personId }) {
  const normalizedPersonId = String(personId || "").trim();
  if (!normalizedPersonId) {
    throw new Error("A valid person id is required.");
  }

  await queryDb(
    `
      DELETE FROM user_saved_people
      WHERE user_id = $1
        AND person_id = $2
    `,
    [userId, normalizedPersonId],
  );

  return normalizedPersonId;
}

async function importUserSavedState({ queryDb, userId, watchlistMovies, savedPeople }) {
  const normalizedMovies = (Array.isArray(watchlistMovies) ? watchlistMovies : [])
    .slice(0, MAX_SAVED_MOVIES_PER_IMPORT)
    .map(normalizeSavedMoviePayload)
    .filter(Boolean);
  const normalizedPeople = (Array.isArray(savedPeople) ? savedPeople : [])
    .slice(0, MAX_SAVED_PEOPLE_PER_IMPORT)
    .map(normalizeSavedPersonPayload)
    .filter(Boolean);

  for (const movie of normalizedMovies) {
    await saveUserTitle({ queryDb, userId, movie });
  }

  for (const person of normalizedPeople) {
    await saveUserPerson({ queryDb, userId, person });
  }

  return {
    importedTitles: normalizedMovies.length,
    importedPeople: normalizedPeople.length,
  };
}

async function getUserSavedState({ queryDb, userId }) {
  const [watchlistMovies, savedPeople] = await Promise.all([
    listUserSavedTitles({ queryDb, userId }),
    listUserSavedPeople({ queryDb, userId }),
  ]);

  return {
    watchlist: watchlistMovies.map((movie) => movie.id),
    watchlistMovies,
    savedPeople,
  };
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === "string" && key.length <= 100)
      .map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue)]),
  );
}

function sanitizeJsonValue(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeText(value, MAX_JSON_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(sanitizeJsonValue);
  }

  if (typeof value === "object") {
    return sanitizeObject(value);
  }

  return null;
}

function sanitizeText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, maxLength);
}

module.exports = {
  getUserSavedState,
  importUserSavedState,
  listUserSavedPeople,
  listUserSavedTitles,
  normalizeSavedMoviePayload,
  normalizeSavedPersonPayload,
  removeUserPerson,
  removeUserTitle,
  saveUserPerson,
  saveUserTitle,
  MAX_SAVED_MOVIES_PER_IMPORT,
  MAX_SAVED_PEOPLE_PER_IMPORT,
};
