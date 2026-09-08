"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { readJsonBody } = require("../lib/auth/http");
const { normalizeSavedMoviePayload, removeUserTitle } = require("../lib/auth/saved-data-store");
const { findOrCreateUserFromGoogleIdentity } = require("../lib/auth/user-store");
const { createJsonCache } = require("../lib/json-cache");
const { streamTopPeopleFromExport } = require("../scripts/lib/common");

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("JSON bodies preserve names split across UTF-8 network chunks", async () => {
  const request = new PassThrough();
  const result = readJsonBody(request);
  const body = Buffer.from('{"name":"Björk 🎬"}');
  for (const byte of body) request.write(Buffer.from([byte]));
  request.end();
  assert.deepEqual(await result, { name: "Björk 🎬" });
});

test("JSON API bodies reject null, arrays, and primitive values", async () => {
  for (const body of ["null", "[]", '"text"', "true", "42"]) {
    const request = new PassThrough();
    const result = readJsonBody(request);
    request.end(body);
    await assert.rejects(result, /Invalid JSON body/);
  }
});

test("oversized JSON gets a 413 response without resetting the socket", async (t) => {
  const base = await listen(t, async (req, res) => {
    try {
      await readJsonBody(req, { maxBytes: 8 });
      res.end("ok");
    } catch (error) {
      res.writeHead(error.statusCode || 400);
      res.end(error.message);
    }
  });
  const response = await fetch(base, { method: "POST", body: JSON.stringify({ too: "large" }) });
  assert.equal(response.status, 413);
  assert.match(await response.text(), /too large/);
});

test("saved movies normalize library flags and bound recursive JSON", () => {
  const nested = { id: 1, watched: "invalid boolean", savedToWatchlist: "false" };
  nested.metadata = nested;
  const normalized = normalizeSavedMoviePayload(nested);
  assert.equal(normalized.watched, false);
  assert.equal(normalized.savedToWatchlist, true);
  assert.doesNotThrow(() => JSON.stringify(normalized));
  for (const id of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeSavedMoviePayload({ id }), null);
  }
});

test("invalid movie deletions never reach the database", async () => {
  for (const movieId of [0, -1, 1.25, "nope"]) {
    await assert.rejects(removeUserTitle({ movieId, userId: 1, queryDb: () => assert.fail("queried database") }), /valid movie id/);
  }
});

test("unverified Google identities cannot access account linking", async () => {
  await assert.rejects(findOrCreateUserFromGoogleIdentity({
    googleIdentity: { emailVerified: false, email: "victim@example.test" },
    dbClient: { query: () => assert.fail("queried database") },
  }), /verified Google email/);
});

test("a new Google subject cannot claim an existing account by email", async () => {
  await assert.rejects(findOrCreateUserFromGoogleIdentity({
    googleIdentity: { emailVerified: true, email: "victim@example.test", provider: "google", providerSubject: "different-subject" },
    dbClient: { async query(sql) {
      if (sql.includes("pg_advisory")) return { rows: [] };
      if (sql.includes("FROM user_identities")) return { rows: [] };
      if (sql.includes("FROM users")) return { rows: [{ id: 1 }] };
      assert.fail("must not write or reassign an existing account");
    } },
  }), /another sign-in identity/);
});

async function cacheFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moviepicker-cache-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const memory = new Map();
  return { cache: createJsonCache({ directory, memory }), memory, directory };
}

test("simultaneous cache misses share one upstream request and survive memory eviction", async (t) => {
  const { cache, memory, directory } = await cacheFixture(t);
  let calls = 0;
  const loader = async () => { calls += 1; return { movies: [1, 2] }; };
  const results = await Promise.all(Array.from({ length: 30 }, () => cache.getOrLoad("movies", loader, 10000)));
  assert.equal(calls, 1);
  assert.ok(results.every((value) => value.movies.length === 2));
  memory.clear();
  assert.deepEqual(await cache.getOrLoad("movies", loader, 10000), { movies: [1, 2] });
  assert.equal(calls, 1);
  assert.ok((await fs.readdir(directory)).every((file) => file.endsWith(".json")));
});

test("failed upstream requests are retried instead of cached permanently", async (t) => {
  const { cache } = await cacheFixture(t);
  let calls = 0;
  const loader = async () => { if (++calls === 1) throw new Error("temporary"); return { ok: true }; };
  await assert.rejects(cache.getOrLoad("retry", loader, 10000), /temporary/);
  assert.deepEqual(await cache.getOrLoad("retry", loader, 10000), { ok: true });
});

test("expired and corrupt disk cache entries are refreshed", async (t) => {
  const { cache, memory, directory } = await cacheFixture(t);
  await cache.write("expired", { value: "old", expiresAt: 1 });
  assert.equal(await cache.getOrLoad("expired", async () => "new", 10000), "new");
  memory.clear();
  for (const file of await fs.readdir(directory)) await fs.writeFile(path.join(directory, file), "broken");
  assert.equal(await cache.getOrLoad("expired", async () => "recovered", 10000), "recovered");
});

test("streamed exports wait for both decompression and process completion", async (t) => {
  const data = [{ id: 1, popularity: 4 }, { id: 2, popularity: 9 }, { id: 3, popularity: 2 }];
  const base = await listen(t, (req, res) => {
    res.setHeader("Content-Type", "application/gzip");
    res.end(zlib.gzipSync(data.map((row) => JSON.stringify(row)).join("\n")));
  });
  for (let repeat = 0; repeat < 5; repeat += 1) {
    const rows = await streamTopPeopleFromExport(base, 2);
    assert.deepEqual(rows.map((row) => row.id), [2, 1]);
  }
});
