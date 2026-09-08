"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { browser, deferred, json, signIn, tick } = require("../test-support/browser");

const library = (ids = []) => ({ watchlist: ids, watchlistMovies: ids.map((id) => ({ id, title: `Movie ${id}` })), savedPeople: [], watched: [], watchedMovies: [] });

function savedBrowser(t) {
  const app = browser();
  t.after(app.close);
  app.load("saved-data-client.js");
  return app;
}

test("a saved-library response arriving after sign-out cannot replace browser saves", async (t) => {
  const app = savedBrowser(t);
  const reply = deferred();
  app.window.fetch = () => reply.promise;
  await app.window.savedDataClient.toggleTitle({ id: 10, title: "Local" });
  signIn(app.window);
  await tick();
  signIn(app.window, null);
  reply.resolve(json(library([20])));
  await tick();
  const state = app.window.savedDataClient.getSnapshot();
  assert.equal(state.source, "local");
  assert.deepEqual(Array.from(state.watchlistIds), [10]);
});

test("a previous account response cannot overwrite the newly signed-in account", async (t) => {
  const app = savedBrowser(t);
  const old = deferred();
  app.window.fetch = () => old.promise;
  signIn(app.window, 1);
  await tick();
  app.window.fetch = async () => json(library([22]));
  signIn(app.window, 2);
  await tick();
  old.resolve(json(library([11])));
  await tick();
  const state = app.window.savedDataClient.getSnapshot();
  assert.equal(state.user.id, 2);
  assert.deepEqual(Array.from(state.watchlistIds), [22]);
});

test("rapid toggles are serialized and use the last confirmed account state", async (t) => {
  const app = savedBrowser(t);
  const first = deferred();
  const methods = [];
  app.window.fetch = async (url, options) => {
    methods.push(options.method || "GET");
    if (options.method === "POST") return first.promise;
    return json(library());
  };
  signIn(app.window);
  await tick();
  const add = app.window.savedDataClient.toggleTitle({ id: 1 });
  const remove = app.window.savedDataClient.toggleTitle({ id: 1 });
  await tick();
  assert.deepEqual(methods, ["GET", "POST"]);
  first.resolve(json(library([1])));
  await Promise.all([add, remove]);
  assert.deepEqual(methods, ["GET", "POST", "DELETE"]);
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchlistIds), []);
});

test("queued account writes are cancelled when the account changes", async (t) => {
  const app = savedBrowser(t);
  const reply = deferred();
  const requests = [];
  app.window.fetch = async (url, options) => {
    requests.push(options.method || "GET");
    return options.method ? reply.promise : json(library());
  };
  signIn(app.window);
  await tick();
  const first = app.window.savedDataClient.toggleTitle({ id: 1 }).catch((e) => e.name);
  const second = app.window.savedDataClient.toggleTitle({ id: 2 }).catch((e) => e.name);
  await tick();
  signIn(app.window, null);
  reply.resolve(json(library([1])));
  assert.deepEqual(await Promise.all([first, second]), ["AbortError", "AbortError"]);
  assert.deepEqual(requests, ["GET", "POST"]);
});

test("imports split large libraries into bounded requests without losing titles", async (t) => {
  const app = browser();
  t.after(app.close);
  const movies = Array.from({ length: 505 }, (_, index) => ({ id: index + 1, title: `Movie ${index + 1}` }));
  app.window.localStorage.setItem("wtfcineverfind-watchlist", JSON.stringify(movies.map((m) => m.id)));
  app.window.localStorage.setItem("wtfcineverfind-watchlist-movies", JSON.stringify(movies));
  const imported = [];
  let batches = 0;
  app.window.fetch = async (url, options) => {
    if (!options.method) return json(library());
    const body = JSON.parse(options.body);
    assert.ok(body.watchlistMovies.length <= 20);
    imported.push(...body.watchlistMovies.map((m) => m.id));
    batches += 1;
    return json({ ...library(imported), imported: { importedTitles: body.watchlistMovies.length } });
  };
  app.load("saved-data-client.js");
  signIn(app.window);
  await tick();
  await app.window.savedDataClient.importLocalState();
  assert.equal(batches, 26);
  assert.equal(new Set(imported).size, 505);
  assert.equal(app.window.savedDataClient.getSnapshot().importPrompt.visible, false);
});

test("saved data follows storage updates from other tabs", async (t) => {
  const app = savedBrowser(t);
  app.window.localStorage.setItem("wtfcineverfind-watchlist", "[12]");
  app.window.dispatchEvent(new app.window.StorageEvent("storage", { key: "wtfcineverfind-watchlist" }));
  assert.deepEqual(Array.from(app.window.savedDataClient.getSnapshot().watchlistIds), [12]);
});

async function discoveryBrowser(t) {
  const app = browser();
  t.after(app.close);
  app.window.fetch = async (url) => json(url.includes("bootstrap")
    ? { genres: [], config: { mode: "demo" } }
    : { people: [], results: [], movies: [] });
  app.load("movie-results.js");
  app.load("app.js");
  await tick();
  await tick();
  return app;
}

test("repeating an in-flight discovery search does not discard its result", async (t) => {
  const app = await discoveryBrowser(t);
  const reply = deferred();
  app.window.fetch = () => reply.promise;
  app.window.document.querySelector("#award-filter").value = "oscar-winner";
  const first = app.evaluate("refreshMovies()");
  await app.evaluate("refreshMovies()");
  reply.resolve(json({ movies: [{ id: 1, title: "Result", genres: [], cast: [], producers: [], isEnriched: true }] }));
  await first;
  assert.equal(app.evaluate("liveState.movies.length"), 1);
});

test("reset invalidates pending movie results and enrichment", async (t) => {
  const app = await discoveryBrowser(t);
  const reply = deferred();
  app.window.fetch = () => reply.promise;
  const request = app.evaluate("refreshMovies()");
  app.evaluate("resetFilters()");
  reply.resolve(json({ movies: [{ id: 1, title: "Stale", isEnriched: true }] }));
  await request;
  assert.equal(app.evaluate("liveState.movies.length"), 0);
});

test("suggestions from an old category cannot populate a new category", async (t) => {
  const app = await discoveryBrowser(t);
  const reply = deferred();
  app.window.fetch = () => reply.promise;
  app.window.document.querySelector("#person-search").value = "Chris";
  const lookup = app.evaluate("updatePersonSuggestions()");
  app.window.document.querySelector("#search-type").value = "writers";
  reply.resolve(json({ results: [{ id: 1, name: "Chris Actor" }] }));
  await lookup;
  assert.equal(app.window.document.querySelector("#people-suggestions").children.length, 0);
});

test("movie metadata enrichment does not copy account saves into anonymous storage", async (t) => {
  const app = savedBrowser(t);
  app.window.fetch = async () => json(library([4]));
  signIn(app.window);
  await tick();
  app.window.savedDataClient.updateMovieDetails([{ id: 4, title: "Account movie" }]);
  assert.equal(app.window.localStorage.getItem("wtfcineverfind-watchlist-movies"), null);
});

test("account settings ignore responses for a previous account", async (t) => {
  const app = browser("account.html");
  t.after(app.close);
  const old = deferred();
  app.window.fetch = () => old.promise;
  app.load("account.js");
  signIn(app.window, 1);
  await tick();
  app.window.fetch = async () => json({ overview: { savedTitlesCount: 2 }, sessions: [] });
  signIn(app.window, 2);
  await tick();
  old.resolve(json({ overview: { savedTitlesCount: 99 }, sessions: [] }));
  await tick();
  assert.equal(app.window.document.querySelector("#account-saved-titles-count").textContent, "2");
});

test("saved-person enrichment requests every movie in server-sized batches", async (t) => {
  const app = browser("saved.html");
  t.after(app.close);
  app.load("saved-data-client.js");
  app.load("movie-results.js");
  app.load("saved.js");
  app.evaluate(`personCatalogCache.set("1", { status: "loaded", movies: Array.from({length: 6}, (_, i) => ({id: i + 1, title: "Movie", matchReason: "Cast match"})) });`);
  const requests = [];
  app.window.fetch = async (url) => {
    const ids = new URL(url, "https://test.invalid").searchParams.get("ids").split(",").map(Number);
    requests.push(ids);
    return json({ movies: ids.slice(0, 2).map((id) => ({ id, title: "Enriched", isEnriched: true, matchReason: "Generic" })) });
  };
  await app.evaluate('ensureCatalogEnrichment("1", 0, 6)');
  assert.deepEqual(requests, [[1, 2], [3, 4], [5, 6]]);
  assert.equal(app.evaluate('personCatalogCache.get("1").movies.filter((m) => m.isEnriched).length'), 6);
  assert.equal(app.evaluate('personCatalogCache.get("1").movies[0].matchReason'), "Cast match");
});

test("an old session refresh cannot undo a completed sign-out", async (t) => {
  const app = browser("account.html");
  t.after(app.close);
  const session = { authenticated: true, user: { id: 1, email: "user@test.invalid" }, csrfToken: "csrf" };
  app.window.fetch = async () => json({ session, config: {} });
  app.load("auth-client.js");
  await tick();
  const old = deferred();
  app.window.fetch = async (url) => url.endsWith("logout") ? json({ session: { authenticated: false, user: null } }) : old.promise;
  app.window.dispatchEvent(new app.window.Event("auth:refresh"));
  await tick();
  app.window.document.querySelector('[data-auth-action="logout"]').click();
  await tick();
  old.resolve(json({ session, config: {} }));
  await tick();
  assert.equal(app.window.moviePickerAuth.session.authenticated, false);
  assert.match(app.window.document.querySelector("[data-auth-root]").textContent, /Guest profile/);
});
