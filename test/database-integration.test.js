"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { replaceRecognition } = require("../scripts/refresh-person-recognition");
const { withHydrationLock } = require("../scripts/lib/hydration-lock");
const { hydrateBatch } = require("../scripts/hydrate-people");
const { findOrCreateUserFromGoogleIdentity } = require("../lib/auth/user-store");
const { importUserSavedState, getUserSavedState, saveUserTitle, saveUserWatchedTitle, removeUserTitle, removeUserWatchedTitle } = require("../lib/auth/saved-data-store");

// Never falls back to DATABASE_URL: these tests need an explicitly disposable DB.
const connectionString = process.env.TEST_DATABASE_URL;

test("Postgres account and pipeline integration", { skip: !connectionString }, async (t) => {
  const schema = `test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  for (const file of ["ingest-schema.sql", "auth-schema.sql"]) {
    await pool.query(await fs.readFile(path.join(__dirname, "../scripts/sql", file), "utf8"));
  }

  await t.test("legacy library migration preserves movies and separates TV saves with the same ID", async () => {
    // Recreate the previous table shape inside this test's disposable schema.
    await pool.query("ALTER TABLE user_saved_titles DROP COLUMN media_type");
    await pool.query("ALTER TABLE user_saved_titles ADD CONSTRAINT user_saved_titles_user_id_movie_id_key UNIQUE (user_id, movie_id)");
    const userId = (await pool.query("INSERT INTO users (email) VALUES ('legacy@example.test') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO user_saved_titles (user_id, movie_id, movie_payload) VALUES ($1, 42, $2)",
      [userId, JSON.stringify({ id: 42, title: "Existing movie", watched: true })]);
    const migration = await fs.readFile(path.join(__dirname, "../scripts/sql/auth-schema.sql"), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const queryDb = pool.query.bind(pool);
    await saveUserTitle({ queryDb, userId, movie: { id: "tv:42", title: "New TV show" } });
    await saveUserWatchedTitle({ queryDb, userId, movie: { id: "tv:42", title: "New TV show" } });
    let saved = await getUserSavedState({ queryDb, userId });
    assert.deepEqual(new Set(saved.watchlist), new Set([42, "tv:42"]));
    assert.deepEqual(new Set(saved.watched), new Set([42, "tv:42"]));
    await removeUserTitle({ queryDb, userId, movieId: "tv:42" });
    saved = await getUserSavedState({ queryDb, userId });
    assert.deepEqual(saved.watchlist, [42]);
    assert.deepEqual(new Set(saved.watched), new Set([42, "tv:42"]));
    await removeUserWatchedTitle({ queryDb, userId, movieId: "tv:42" });
    saved = await getUserSavedState({ queryDb, userId });
    assert.deepEqual(saved.watched, [42]);
    assert.equal(saved.watchlistMovies[0].title, "Existing movie");
  });

  await t.test("recognition tolerates unhydrated people and rolls back failed replacements", async () => {
    await pool.query("INSERT INTO people (person_id, name) VALUES (1, 'Known person')");
    const row = { personId: 1, popularRank: 1, trendingRank: null, recognitionScore: 100, sourceJson: "{}" };
    await replaceRecognition(pool, [row, { ...row, personId: 999 }]);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS total FROM person_recognition")).rows[0].total, 1);
    await assert.rejects(replaceRecognition(pool, [{ ...row, sourceJson: "invalid json" }]));
    assert.equal((await pool.query("SELECT recognition_score FROM person_recognition")).rows[0].recognition_score, 100);
  });

  await t.test("only one worker hydrates and abandoned claims are recovered", async () => {
    await pool.query("INSERT INTO people_raw (person_id, status, attempts) VALUES (1, 'in_progress', 3)");
    await withHydrationLock(pool, async () => {
      const row = (await pool.query("SELECT status, attempts FROM people_raw WHERE person_id = 1")).rows[0];
      assert.deepEqual(row, { status: "pending", attempts: 2 });
      const acquired = await withHydrationLock(pool, () => assert.fail("concurrent worker acquired lock"));
      assert.equal(acquired, false);
    });
    assert.equal(await withHydrationLock(pool, async () => {}), true);
  });

  await t.test("a bad person record does not strand the rest of the hydrate batch", async () => {
    await pool.query("INSERT INTO people_raw (person_id, status, attempts) VALUES (2, 'pending', 0), (3, 'pending', 0)");
    const tmdb = async (endpoint) => {
      const id = Number(endpoint.split("/")[2]);
      if (!endpoint.endsWith("movie_credits")) return { id, name: `Person ${id}` };
      return { cast: [{ id: 10 + id, title: `Movie ${id}`, vote_average: 8, vote_count: id === 2 ? 1.25 : 10 }], crew: [] };
    };
    await withHydrationLock(pool, () => hydrateBatch(pool, tmdb, { batchSize: 10, concurrency: 3, maxAttempts: 4 }));
    const rows = (await pool.query("SELECT person_id::int, status FROM people_raw ORDER BY person_id")).rows;
    assert.deepEqual(rows, [{ person_id: 1, status: "complete" }, { person_id: 2, status: "failed" }, { person_id: 3, status: "complete" }]);
  });

  await t.test("concurrent first sign-ins create one account for a Google subject", async () => {
    const googleIdentity = { provider: "google", providerSubject: "same-person", email: "same@example.test", emailVerified: true };
    const login = async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await findOrCreateUserFromGoogleIdentity({ dbClient: client, googleIdentity });
        await client.query("COMMIT");
        return user;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    };
    const users = await Promise.all([login(), login()]);
    assert.equal(users[0].id, users[1].id);
    const queryDb = pool.query.bind(pool);
    await importUserSavedState({ queryDb, userId: users[0].id, watchlistMovies: [{ id: 1, watched: "invalid" }], watchedMovies: [{ id: 2 }] });
    const saved = await getUserSavedState({ queryDb, userId: users[0].id });
    assert.deepEqual(saved.watchlist, [1]);
    assert.deepEqual(saved.watched, [2]);
  });
});
