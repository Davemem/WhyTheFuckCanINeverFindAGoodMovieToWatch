"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCsrfToken, isValidCsrfToken } = require("../lib/auth/csrf");
const { createAllowedOrigins, isTrustedOriginRequest } = require("../lib/auth/request-guards");
const {
  importUserSavedState,
  normalizeSavedMoviePayload,
  normalizeSavedPersonPayload,
} = require("../lib/auth/saved-data-store");
const {
  cleanupExpiredSessions,
  listUserSessions,
  revokeOtherUserSessions,
  revokeUserSessionById,
} = require("../lib/auth/session");
const { getUserAccountOverview } = require("../lib/auth/account-store");

test("createCsrfToken derives a stable token from the session", () => {
  const token = createCsrfToken("session-token", "super-secret");
  assert.equal(token, createCsrfToken("session-token", "super-secret"));
  assert.notEqual(token, createCsrfToken("other-session", "super-secret"));
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("isValidCsrfToken accepts the matching request header", () => {
  const expectedToken = createCsrfToken("session-token", "super-secret");
  const req = { headers: { "x-csrf-token": expectedToken } };
  assert.equal(isValidCsrfToken(req, expectedToken), true);
  assert.equal(isValidCsrfToken({ headers: { "x-csrf-token": "wrong" } }, expectedToken), false);
});

test("createAllowedOrigins includes app and configured origins", () => {
  const allowedOrigins = createAllowedOrigins(
    "https://moviepicker.example",
    "https://staging.moviepicker.example, http://localhost:3000",
  );

  assert.equal(allowedOrigins.has("https://moviepicker.example"), true);
  assert.equal(allowedOrigins.has("https://staging.moviepicker.example"), true);
  assert.equal(allowedOrigins.has("http://localhost:3000"), true);
});

test("isTrustedOriginRequest matches request origin and referer", () => {
  const allowedOrigins = createAllowedOrigins("https://moviepicker.example");
  assert.equal(
    isTrustedOriginRequest({ headers: { origin: "https://moviepicker.example" } }, allowedOrigins),
    true,
  );
  assert.equal(
    isTrustedOriginRequest(
      { headers: { referer: "https://moviepicker.example/saved.html" } },
      allowedOrigins,
    ),
    true,
  );
  assert.equal(
    isTrustedOriginRequest({ headers: { origin: "https://evil.example" } }, allowedOrigins),
    false,
  );
});

test("saved payload normalization rejects invalid ids and trims oversized values", () => {
  assert.equal(normalizeSavedMoviePayload({ id: "abc" }), null);

  const normalizedMovie = normalizeSavedMoviePayload({
    id: "42",
    title: "A".repeat(5000),
  });
  assert.equal(normalizedMovie.id, 42);
  assert.equal(normalizedMovie.title.length, 2000);

  const normalizedPerson = normalizeSavedPersonPayload({
    id: "person-1",
    name: `  ${"B".repeat(300)}  `,
    bucket: "actors",
  });
  assert.equal(normalizedPerson.id, "person-1");
  assert.equal(normalizedPerson.name.length, 200);
  assert.equal(normalizedPerson.bucket, "actors");
  assert.equal(normalizeSavedPersonPayload({ id: "", name: "Nope" }), null);
});

test("importUserSavedState deduplicates via store upserts and counts normalized entries", async () => {
  const savedTitles = [];
  const savedPeople = [];
  const queryDb = async (sql, params = []) => {
    if (sql.includes("INSERT INTO user_saved_titles")) {
      savedTitles.push(params[1]);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO user_saved_people")) {
      savedPeople.push(params[1]);
      return { rows: [] };
    }
    return { rows: [] };
  };

  const result = await importUserSavedState({
    queryDb,
    userId: 7,
    watchlistMovies: [{ id: 1 }, { id: 1 }, { id: 2 }],
    savedPeople: [{ id: "p1", name: "One" }, { id: "p1", name: "One Again" }],
  });

  assert.deepEqual(result, { importedTitles: 3, importedPeople: 2 });
  assert.deepEqual(savedTitles, [1, 1, 2]);
  assert.deepEqual(savedPeople, ["p1", "p1"]);
});

test("cleanupExpiredSessions throttles repeated cleanup work", async () => {
  const calls = [];
  const queryDb = async (sql) => {
    calls.push(sql);
    return { rows: [] };
  };

  assert.equal(await cleanupExpiredSessions({ queryDb, now: 1000 * 60 * 20 }), true);
  assert.equal(await cleanupExpiredSessions({ queryDb, now: 1000 * 60 * 21 }), false);
  assert.equal(calls.length, 1);
});

test("listUserSessions marks the current session and normalizes fields", async () => {
  const queryDb = async () => ({
    rows: [
      {
        id: 11,
        created_at: "2026-04-01T10:00:00.000Z",
        last_seen_at: "2026-04-21T10:00:00.000Z",
        expires_at: "2026-05-01T10:00:00.000Z",
        ip_address: "127.0.0.1",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)",
      },
      {
        id: 7,
        created_at: "2026-03-30T09:00:00.000Z",
        last_seen_at: "2026-04-20T08:00:00.000Z",
        expires_at: "2026-04-30T09:00:00.000Z",
        ip_address: null,
        user_agent: "",
      },
    ],
  });

  const sessions = await listUserSessions({
    queryDb,
    userId: 5,
    currentSessionId: 11,
  });

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].isCurrent, true);
  assert.equal(sessions[0].ipAddress, "127.0.0.1");
  assert.equal(sessions[1].isCurrent, false);
  assert.equal(sessions[1].userAgent, "");
});

test("revokeUserSessionById validates session ids and reports whether a session was revoked", async () => {
  const calls = [];
  const queryDb = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 19 }] };
  };

  await assert.rejects(
    () => revokeUserSessionById({ queryDb, userId: 4, sessionId: "nope" }),
    /valid session id/i,
  );

  const revoked = await revokeUserSessionById({ queryDb, userId: 4, sessionId: 19 });
  assert.equal(revoked, true);
  assert.deepEqual(calls[0].params, [19, 4]);
});

test("revokeOtherUserSessions excludes the current session and returns a count", async () => {
  const queryDb = async (sql, params) => {
    assert.match(sql, /id <> \$2/);
    assert.deepEqual(params, [8, 33]);
    return { rows: [{ id: 2 }, { id: 3 }] };
  };

  const revokedCount = await revokeOtherUserSessions({
    queryDb,
    userId: 8,
    currentSessionId: 33,
  });

  assert.equal(revokedCount, 2);
});

test("getUserAccountOverview normalizes numeric summary counts", async () => {
  const queryDb = async () => ({
    rows: [
      {
        saved_titles_count: "12",
        saved_people_count: "5",
        active_sessions_count: "3",
      },
    ],
  });

  const overview = await getUserAccountOverview({
    queryDb,
    userId: 42,
  });

  assert.deepEqual(overview, {
    savedTitlesCount: 12,
    savedPeopleCount: 5,
    activeSessionsCount: 3,
  });
});
