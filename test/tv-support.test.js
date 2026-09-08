"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { identity } = require("../title-identity");
const { createTvCatalog, normalizeTv, genreIdsFor } = require("../lib/tv-catalog");
const { browser, json, signIn, tick } = require("../test-support/browser");

test("public demo APIs support TV search, mixed discovery, enrichment and streaming IDs", async (t) => {
  for (const name of ["TMDB_API_KEY", "TMDB_BEARER_TOKEN", "OMDB_API_KEY", "DATABASE_URL"]) process.env[name] = "";
  const { server } = require("../server");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (route) => {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const search = await get("/api/title-search?query=Breaking&mediaType=tv");
  assert.equal(search.results[0].id, "tv:1396");
  assert.equal((await get("/api/movie-search?query=Breaking")).results.length, 0);
  const mixed = await get("/api/discover?mediaType=both");
  assert.ok(mixed.movies.some((title) => title.mediaType === "tv"));
  assert.ok(mixed.movies.some((title) => title.mediaType !== "tv"));
  const shows = await get("/api/discover?mediaType=tv&decade=2000");
  assert.deepEqual(shows.movies.map((title) => title.id), ["tv:1396"]);
  const details = await get("/api/enrich?ids=tv:1396,1001");
  assert.equal(details.movies.length, 2);
  assert.equal(details.movies.find((title) => title.id === "tv:1396").seasons, 5);
  assert.equal((await get("/api/watch-providers?movieId=tv%3A1396&region=AU")).movieId, "tv:1396");
  assert.equal((await fetch(base + "/api/title-search", { method: "POST" })).status, 405);
});

test("TV and legacy movie identities cannot collide or accept malformed IDs", () => {
  assert.deepEqual(identity(1396), { id: 1396, tmdbId: 1396, mediaType: "movie" });
  assert.deepEqual(identity({ id: 1396, mediaType: "tv" }), { id: "tv:1396", tmdbId: 1396, mediaType: "tv" });
  assert.equal(identity("tv:1396").id, "tv:1396");
  for (const invalid of ["tv:0", "tv:-1", "tv:1.5", "tv:abc", { id: "tv:1396", mediaType: "movie" }]) {
    assert.equal(identity(invalid), null);
  }
});

test("TV details use first air date, series creators, aggregate credits, and external ratings", () => {
  const show = normalizeTv({ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20", last_air_date: "2013-09-29",
    created_by: [{ name: "Vince Gilligan" }], number_of_seasons: 5, number_of_episodes: 62, status: "Ended",
    last_episode_to_air: { runtime: 55 }, genres: [{ id: 18, name: "Drama" }],
    aggregate_credits: { cast: [{ name: "Bryan Cranston" }], crew: [{ name: "Producer", jobs: [{ job: "Executive Producer" }] }] },
  }, { imdb: 9.5, awards: "Won 16 Primetime Emmys." }, true);
  assert.equal(show.id, "tv:1396");
  assert.equal(show.title, "Breaking Bad");
  assert.equal(show.year, 2008);
  assert.equal(show.endYear, 2013);
  assert.equal(show.seasons, 5);
  assert.equal(show.runtime, "55 min / episode");
  assert.deepEqual(show.creators, ["Vince Gilligan"]);
  assert.deepEqual(show.producers, ["Producer"]);
  assert.equal(show.imdb, 9.5);
});

const filters = { role: "any", genreId: "all", decade: "all", sort: "match", imdbMin: 0, rtMin: 0, award: "all" };
function catalog(tmdb) {
  return createTvCatalog({ tmdb, lookupOmdb: async () => ({ imdb: 9 }),
    searchPeople: async () => ({ results: [{ id: 12, name: "Person" }] }), selectPerson: (people) => people[0],
    searchStudios: async () => [{ id: 25, name: "Studio" }], selectStudio: (studios) => studios[0],
    passesFilters: () => true, sortMovies: () => 0, needsHydration: () => false, hydrateLimit: () => 10 });
}

test("TV discovery maps movie genres, first-air-date ranges, companies, and sorts", async () => {
  const calls = [];
  const tv = catalog(async (endpoint, params) => {
    calls.push({ endpoint, params });
    return { results: [{ id: 10, name: "Show", first_air_date: "2009-01-01" }], total_results: 1 };
  });
  const result = await tv.discover({ ...filters, searchType: "studio", personQuery: "Studio", genreId: "28", decade: "2000", sort: "year-asc" });
  assert.equal(result.movies.length, 1, "deduplicates overlapping result pages");
  assert.equal(result.movies[0].id, "tv:10");
  assert.equal(calls[0].endpoint, "/discover/tv");
  assert.equal(calls[0].params.with_companies, "25");
  assert.equal(calls[0].params.with_genres, "10759");
  assert.equal(calls[0].params["first_air_date.lte"], "2009-12-31");
  assert.equal(calls[0].params.sort_by, "first_air_date.asc");
  assert.deepEqual(genreIdsFor("10765", "movie"), [878, 14]);
});

test("person TV credits respect roles and dates and combine duplicate jobs", async () => {
  const tv = catalog(async () => ({ cast: [{ id: 10, name: "Acted only", first_air_date: "2004-01-01" }], crew: [
    { id: 20, name: "Created show", job: "Creator", first_air_date: "2008-01-01", genre_ids: [18] },
    { id: 20, name: "Created show", job: "Writer", first_air_date: "2008-01-01", genre_ids: [18] },
    { id: 30, name: "Later show", job: "Writer", first_air_date: "2024-01-01", genre_ids: [18] },
  ] }));
  const result = await tv.discover({ ...filters, personQuery: "Person", role: "writer", decade: "2000", genreId: "18" });
  assert.deepEqual(result.movies.map((show) => show.id), ["tv:20"]);
  assert.equal(result.matchedPerson.name, "Person");
});

test("TV enrichment uses external IDs and preserves the TV namespace", async () => {
  const calls = [];
  const tv = catalog(async (endpoint, params) => {
    calls.push({ endpoint, params });
    return { id: 44, name: "Show", external_ids: { imdb_id: "tt123" } };
  });
  const shows = await tv.hydrate([{ id: "tv:44" }], filters);
  assert.equal(calls[0].endpoint, "/tv/44");
  assert.equal(calls[0].params.append_to_response, "aggregate_credits,external_ids");
  assert.equal(shows[0].id, "tv:44");
  assert.equal(shows[0].imdb, 9);
});

test("browser library preserves movie/TV collisions across reload, watching, removal and import", async (t) => {
  const app = browser(); t.after(app.close);
  app.load("saved-data-client.js");
  const client = app.window.savedDataClient;
  await client.toggleTitle({ id: 42, title: "Movie" });
  await client.toggleTitle({ id: 42, mediaType: "tv", title: "TV show" });
  await client.toggleWatched({ id: "tv:42", title: "TV show" });
  await client.refresh();
  assert.deepEqual(Array.from(client.getSnapshot().watchlistIds), [42, "tv:42"]);
  assert.deepEqual(Array.from(client.getSnapshot().watchedIds), ["tv:42"]);
  await client.removeTitle("tv:42");
  assert.deepEqual(Array.from(client.getSnapshot().watchlistIds), [42]);
  assert.deepEqual(Array.from(client.getSnapshot().watchedIds), ["tv:42"]);
  let imported;
  app.window.fetch = async (url, options) => {
    if (options.method === "POST") imported = JSON.parse(options.body);
    return json({ watchlist: [], watched: [], savedPeople: [], watchlistMovies: [], watchedMovies: [] });
  };
  signIn(app.window); await tick();
  await client.importLocalState();
  assert.equal(imported.watchlistMovies[0].id, 42);
  assert.equal(imported.watchedMovies[0].id, "tv:42");
});

test("saved library cards, filters, watched actions and streaming use the TV identity", async (t) => {
  const app = browser("saved-titles.html"); t.after(app.close);
  app.load("saved-data-client.js");
  const client = app.window.savedDataClient;
  await client.toggleTitle({ id: 42, title: "Film", genres: [], isEnriched: true });
  await client.toggleTitle({ id: "tv:42", title: "Series", mediaType: "tv", seasons: 2, episodes: 12, status: "Ended", genres: [], isEnriched: true });
  app.load("movie-results.js"); app.load("saved-titles.js");
  const document = app.window.document;
  assert.equal(document.querySelectorAll("#saved-titles-grid .movie-card").length, 2);
  const select = document.querySelector("#saved-titles-media-type");
  select.value = "tv"; select.dispatchEvent(new app.window.Event("change"));
  assert.equal(document.querySelectorAll("#saved-titles-grid .movie-card").length, 1);
  assert.match(document.querySelector("#saved-titles-grid").textContent, /2 seasons · 12 episodes · Ended/);
  document.querySelector('[data-watched-id="tv:42"]').click(); await tick();
  assert.deepEqual(Array.from(client.getSnapshot().watchedIds), ["tv:42"]);
  let requested;
  app.window.fetch = async (url) => { requested = url; return json({ available: false, providers: {} }); };
  document.querySelector('[data-watch-provider-movie-id="tv:42"]').click(); await tick();
  assert.match(requested, /movieId=tv%3A42/);
  assert.equal(document.querySelector(".watch-provider-dialog").open, true);
});

test("switching discovery media invalidates pending results and persists the choice in links", async (t) => {
  const app = browser(); t.after(app.close);
  app.window.fetch = async (url) => json(url.includes("bootstrap") ? { genres: [], tvGenres: [], config: {} } : { movies: [], people: [], results: [] });
  app.load("movie-results.js"); app.load("app.js"); await tick(); await tick();
  const calls = [];
  app.window.fetch = async (url) => { calls.push(url); return json({ movies: [] }); };
  const select = app.window.document.querySelector("#media-type");
  select.value = "tv"; select.dispatchEvent(new app.window.Event("change")); await tick();
  assert.ok(calls.some((url) => url.includes("/api/discover?") && url.includes("mediaType=tv")));
  assert.equal(new URL(app.window.location.href).searchParams.get("mediaType"), "tv");
});

test("enriching a TV discovery card preserves the reason it matched the selected person", async (t) => {
  const app = browser(); t.after(app.close);
  app.window.fetch = async (url) => json(url.includes("bootstrap") ? { genres: [], config: {} } : { movies: [], people: [], results: [] });
  app.load("movie-results.js"); app.load("app.js"); await tick(); await tick();
  app.evaluate('liveState.movies = [{ id: "tv:1396", mediaType: "tv", title: "Breaking Bad", matchReason: "Cast: Bryan Cranston" }]; renderMovies(liveState.movies);');
  await new Promise((resolve) => app.window.requestAnimationFrame(resolve));
  app.window.fetch = async () => json({ movies: [{ id: "tv:1396", mediaType: "tv", title: "Breaking Bad", isEnriched: true, matchReason: "TV discovery result." }] });
  await app.evaluate("enrichVisibleMovies(liveState.requestId)");
  assert.equal(app.window.document.querySelector("#results-grid .match-reason").textContent, "Cast: Bryan Cranston");
});
