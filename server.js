const http = require("node:http");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { Pool } = require("pg");

loadEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 3000);
const tmdbToken = process.env.TMDB_BEARER_TOKEN || "";
const tmdbApiKey = process.env.TMDB_API_KEY || "";
const omdbApiKey = process.env.OMDB_API_KEY || "";
const databaseUrl = process.env.DATABASE_URL || "";
const staticRoot = __dirname;
const cache = new Map();
const cacheDir = path.join(__dirname, ".cache");
const peopleIndexPath = path.join(cacheDir, "people-index-v1.json");
const DISCOVER_RESULT_LIMIT = 60;
const DISCOVER_HYDRATE_LIMIT = 6;
const ENRICH_BATCH_LIMIT = 2;
const PERSON_RESULT_LIMIT = 200;
const FEATURED_PEOPLE_PAGE_COUNT = 15;
const FEATURED_PEOPLE_LIMIT = 5;
const DB_FEATURED_LIMIT = 5000;
const DB_BOOTSTRAP_LIMIT = 20;
const DB_STATUS_CACHE_TTL_MS = 1000 * 30;
const DB_DIRECTORY_CACHE_TTL_MS = 1000 * 60 * 5;
const DB_PEOPLE_SEARCH_CACHE_TTL_MS = 1000 * 30;
const DISCOVER_CACHE_TTL_MS = 1000 * 60 * 2;
const STATIC_ASSET_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const demoGenres = [
  { id: 18, name: "Drama" },
  { id: 35, name: "Comedy" },
  { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" },
  { id: 12, name: "Adventure" },
];
const demoMovies = [
  {
    id: 1001,
    title: "Dune: Part Two",
    year: 2024,
    runtime: "166 min",
    imdb: 8.5,
    rt: 92,
    metacritic: 79,
    tmdb: 8.3,
    genres: ["Adventure", "Drama", "Sci-Fi"],
    genreIds: [12, 18, 878],
    cast: ["Timothee Chalamet", "Zendaya", "Florence Pugh", "Rebecca Ferguson"],
    director: "Denis Villeneuve",
    producers: ["Mary Parent", "Cale Boyter", "Tanya Lapointe"],
    logline:
      "Paul Atreides steps into prophecy, empire, and revenge in a desert war epic.",
    posterUrl: "",
  },
  {
    id: 1002,
    title: "Poor Things",
    year: 2023,
    runtime: "141 min",
    imdb: 7.8,
    rt: 92,
    metacritic: 88,
    tmdb: 7.8,
    genres: ["Comedy", "Drama", "Sci-Fi"],
    genreIds: [35, 18, 878],
    cast: ["Emma Stone", "Mark Ruffalo", "Willem Dafoe"],
    director: "Yorgos Lanthimos",
    producers: ["Ed Guiney", "Andrew Lowe", "Emma Stone"],
    logline:
      "A resurrected woman tears through convention, class, and continents.",
    posterUrl: "",
  },
  {
    id: 1003,
    title: "Arrival",
    year: 2016,
    runtime: "116 min",
    imdb: 7.9,
    rt: 94,
    metacritic: 81,
    tmdb: 7.6,
    genres: ["Drama", "Sci-Fi", "Thriller"],
    genreIds: [18, 878, 53],
    cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker"],
    director: "Denis Villeneuve",
    producers: ["Shawn Levy", "Dan Levine", "Aaron Ryder"],
    logline:
      "A linguist learns that language can reorder time, memory, and grief.",
    posterUrl: "",
  },
  {
    id: 1004,
    title: "La La Land",
    year: 2016,
    runtime: "128 min",
    imdb: 8.0,
    rt: 91,
    metacritic: 94,
    tmdb: 7.9,
    genres: ["Comedy", "Drama"],
    genreIds: [35, 18],
    cast: ["Emma Stone", "Ryan Gosling", "John Legend"],
    director: "Damien Chazelle",
    producers: ["Fred Berger", "Jordan Horowitz", "Gary Gilbert"],
    logline:
      "A romantic Los Angeles musical about ambition, timing, and compromise.",
    posterUrl: "",
  },
  {
    id: 1005,
    title: "The Social Network",
    year: 2010,
    runtime: "120 min",
    imdb: 7.8,
    rt: 96,
    metacritic: 95,
    tmdb: 7.4,
    genres: ["Drama", "Thriller"],
    genreIds: [18, 53],
    cast: ["Jesse Eisenberg", "Andrew Garfield", "Rooney Mara"],
    director: "David Fincher",
    producers: ["Scott Rudin", "Dana Brunetti", "Michael De Luca"],
    logline:
      "A startup origin story turns into a surgical breakup movie about status.",
    posterUrl: "",
  },
  {
    id: 1006,
    title: "Whiplash",
    year: 2014,
    runtime: "106 min",
    imdb: 8.5,
    rt: 94,
    metacritic: 89,
    tmdb: 8.4,
    genres: ["Drama", "Thriller"],
    genreIds: [18, 53],
    cast: ["Miles Teller", "J.K. Simmons", "Melissa Benoist"],
    director: "Damien Chazelle",
    producers: ["Jason Blum", "Helen Estabrook", "David Lancaster"],
    logline:
      "A drummer and a teacher grind talent into obsession and self-destruction.",
    posterUrl: "",
  },
];
const demoPeople = [
  {
    id: 201,
    name: "Denis Villeneuve",
    department: "Director",
    knownFor: ["Dune: Part Two", "Arrival"],
    profileUrl: "",
    ratingLabel: "Known-for average 8.0",
  },
  {
    id: 202,
    name: "Emma Stone",
    department: "Acting / Producer",
    knownFor: ["Poor Things", "La La Land"],
    profileUrl: "",
    ratingLabel: "Known-for average 7.9",
  },
  {
    id: 203,
    name: "Damien Chazelle",
    department: "Director",
    knownFor: ["La La Land", "Whiplash"],
    profileUrl: "",
    ratingLabel: "Known-for average 8.2",
  },
  {
    id: 204,
    name: "David Fincher",
    department: "Director",
    knownFor: ["The Social Network"],
    profileUrl: "",
    ratingLabel: "Known-for average 7.8",
  },
  {
    id: 205,
    name: "Florence Pugh",
    department: "Acting",
    knownFor: ["Dune: Part Two", "Midsommar", "Little Women"],
    profileUrl: "",
    ratingLabel: "Known-for average 7.8",
  },
];

ensureCacheDir();
let preferredDbPool = null;
const dbPools = createDbPools();

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(requestUrl, res);
      return;
    }

    serveStatic(requestUrl.pathname, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Server error",
        detail: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

server.listen(port, () => {
  process.stdout.write(`Server running at http://localhost:${port}\n`);
});

async function handleApi(requestUrl, res) {
  if (!tmdbToken && !tmdbApiKey) {
    handleDemoApi(requestUrl, res);
    return;
  }

  if (requestUrl.pathname === "/api/bootstrap") {
    const mode = requestUrl.searchParams.get("mode");
    const bootstrap = await buildBootstrapPayload({ includePeople: mode !== "lite" });
    sendJson(res, 200, bootstrap);
    return;
  }

  if (requestUrl.pathname === "/api/featured-people") {
    const featuredPayload = await buildFeaturedPeoplePayload();
    sendJson(res, 200, featuredPayload);
    return;
  }

  if (requestUrl.pathname === "/api/index-status") {
    const dbStatus = await getIndexStatusFromPostgres();
    if (dbStatus) {
      sendJson(res, 200, dbStatus);
      return;
    }

    const localPeopleIndex = readPeopleIndex();
    sendJson(res, 200, buildIndexStatus(localPeopleIndex));
    return;
  }

  if (requestUrl.pathname === "/api/people-directory") {
    const department = requestUrl.searchParams.get("department") || "actors";
    const query = requestUrl.searchParams.get("q")?.trim() || "";
    const sort = requestUrl.searchParams.get("sort") || "score";
    const requestedLimit = clampNumber(requestUrl.searchParams.get("limit"), 10, 1, DB_FEATURED_LIMIT);
    const directory = await getPeopleDirectoryFromPostgres(Math.max(requestedLimit, DB_BOOTSTRAP_LIMIT));
    const source = directory ? peopleDirectorySlice(directory, department) : [];
    const filtered = filterPeopleDirectory(source, query);
    const sorted = sortPeopleDirectory(filtered, sort);
    const people = sorted.slice(0, requestedLimit);
    sendJson(res, 200, {
      department,
      total: filtered.length,
      people,
    });
    return;
  }

  if (requestUrl.pathname === "/api/people") {
    const query = requestUrl.searchParams.get("query")?.trim();
    if (!query) {
      sendJson(res, 200, { results: [] });
      return;
    }

    const dbResults = await searchPeopleFromPostgres(query);
    sendJson(res, 200, { results: dbResults });
    return;
  }

  if (requestUrl.pathname === "/api/discover") {
    const filters = {
      personQuery: requestUrl.searchParams.get("personQuery")?.trim() || "",
      role: requestUrl.searchParams.get("role") || "any",
      genreId: requestUrl.searchParams.get("genre") || "all",
      decade: requestUrl.searchParams.get("decade") || "all",
      sort: requestUrl.searchParams.get("sort") || "match",
      imdbMin: Number(requestUrl.searchParams.get("imdbMin") || "0"),
      rtMin: Number(requestUrl.searchParams.get("rtMin") || "0"),
    };

    const cacheKey = buildDiscoverCacheKey(filters);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      sendJson(res, 200, cached.value);
      return;
    }

    const diskCached = readDiskCache(cacheKey);
    if (diskCached && diskCached.expiresAt > Date.now()) {
      cache.set(cacheKey, diskCached);
      sendJson(res, 200, diskCached.value);
      return;
    }

    const payload = await buildDiscoverPayload(filters);
    const entry = { value: payload, expiresAt: Date.now() + DISCOVER_CACHE_TTL_MS };
    cache.set(cacheKey, entry);
    writeDiskCache(cacheKey, entry);

    sendJson(res, 200, payload);
    return;
  }

  if (requestUrl.pathname === "/api/enrich") {
    const ids = (requestUrl.searchParams.get("ids") || "")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .slice(0, ENRICH_BATCH_LIMIT);

    if (!ids.length) {
      sendJson(res, 200, { movies: [] });
      return;
    }

    const items = ids.map((id) => ({ id, reasons: [] }));
    const movies = await hydrateMoviesSequential(items, {
      imdbMin: 0,
      rtMin: 0,
      sort: "match",
    });
    sendJson(res, 200, { movies });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function handleDemoApi(requestUrl, res) {
  if (requestUrl.pathname === "/api/bootstrap") {
    const mode = requestUrl.searchParams.get("mode");
    const payload = {
      config: {
        hasOmdb: true,
        imageBaseUrl: "",
        mode: "demo",
      },
      genres: demoGenres,
    };
    if (mode !== "lite") {
      payload.featuredActors = demoPeople.filter((person) => isActingDepartment(person.department));
      payload.featuredDirectors = demoPeople.filter((person) => isDirectorDepartment(person.department));
      payload.featuredProducers = demoPeople.filter((person) => isProducerDepartment(person.department));
    }
    sendJson(res, 200, payload);
    return;
  }

  if (requestUrl.pathname === "/api/featured-people") {
    sendJson(res, 200, {
      featuredActors: demoPeople.filter((person) => isActingDepartment(person.department)),
      featuredDirectors: demoPeople.filter((person) => isDirectorDepartment(person.department)),
      featuredProducers: demoPeople.filter((person) => isProducerDepartment(person.department)),
    });
    return;
  }

  if (requestUrl.pathname === "/api/index-status") {
    sendJson(res, 200, buildIndexStatus(null));
    return;
  }

  if (requestUrl.pathname === "/api/people") {
    const query = requestUrl.searchParams.get("query")?.trim().toLowerCase() || "";
    const results = query
      ? demoPeople.filter((person) => person.name.toLowerCase().includes(query))
      : [];
    sendJson(res, 200, { results });
    return;
  }

  if (requestUrl.pathname === "/api/people-directory") {
    const department = requestUrl.searchParams.get("department") || "actors";
    const people = department === "directors"
      ? demoPeople.filter((person) => isDirectorDepartment(person.department))
      : department === "producers"
        ? demoPeople.filter((person) => isProducerDepartment(person.department))
        : demoPeople.filter((person) => isActingDepartment(person.department));
    sendJson(res, 200, { department, total: people.length, people });
    return;
  }

  if (requestUrl.pathname === "/api/discover") {
    const filters = {
      personQuery: requestUrl.searchParams.get("personQuery")?.trim() || "",
      role: requestUrl.searchParams.get("role") || "any",
      genreId: requestUrl.searchParams.get("genre") || "all",
      decade: requestUrl.searchParams.get("decade") || "all",
      sort: requestUrl.searchParams.get("sort") || "match",
      imdbMin: Number(requestUrl.searchParams.get("imdbMin") || "0"),
      rtMin: Number(requestUrl.searchParams.get("rtMin") || "0"),
    };
    sendJson(res, 200, buildDemoDiscoverPayload(filters));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function buildDemoDiscoverPayload(filters) {
  const personQuery = filters.personQuery.toLowerCase();
  const matchedPerson =
    demoPeople.find((person) => person.name.toLowerCase().includes(personQuery)) || null;

  const movies = demoMovies
    .map((movie) => {
      const reasons = [];
      const castMatch = movie.cast.filter((name) => name.toLowerCase().includes(personQuery));
      const directorMatch = movie.director.toLowerCase().includes(personQuery);
      const producerMatch = movie.producers.filter((name) => name.toLowerCase().includes(personQuery));

      if (castMatch.length) {
        reasons.push(`Cast: ${castMatch.join(", ")}`);
      }
      if (directorMatch) {
        reasons.push(`Director: ${movie.director}`);
      }
      if (producerMatch.length) {
        reasons.push(`Producer: ${producerMatch.join(", ")}`);
      }

      return {
        ...movie,
        matchReason: reasons.length ? reasons.join(" / ") : "Demo discovery result.",
      };
    })
    .filter((movie) => passesDemoFilters(movie, filters))
    .sort((left, right) => sortMovies(left, right, filters.sort));

  return {
    matchedPerson,
    movies,
  };
}

async function buildBootstrapPayload(options = {}) {
  const includePeople = options.includePeople !== false;
  const localPeopleIndex = includePeople ? await getAvailablePeopleDirectory(DB_BOOTSTRAP_LIMIT) : null;
  const hasLocalPeopleIndex = includePeople
    ? Boolean(localPeopleIndex)
    : await isLocalPeopleIndexAvailableFast();
  const resolvedGenres = await getGenresFast();

  const payload = {
    config: {
      hasOmdb: Boolean(omdbApiKey),
      imageBaseUrl: "https://image.tmdb.org/t/p/w500",
      hasLocalPeopleIndex,
    },
    genres: resolvedGenres,
  };

  if (includePeople) {
    const featured = await buildFeaturedPeoplePayload(localPeopleIndex);
    payload.featuredActors = featured.featuredActors;
    payload.featuredDirectors = featured.featuredDirectors;
    payload.featuredProducers = featured.featuredProducers;
  }

  return payload;
}

async function buildFeaturedPeoplePayload(localPeopleIndex = null) {
  const localSource = localPeopleIndex || (await getAvailablePeopleDirectory(DB_BOOTSTRAP_LIMIT));
  const rankedPeople = localSource
    ? normalizeFeaturedPeopleSource(localSource)
    : {
        actors: [],
        directors: [],
        producers: [],
      };

  return {
    featuredActors: rankedPeople.actors,
    featuredDirectors: rankedPeople.directors,
    featuredProducers: rankedPeople.producers,
  };
}

function passesDemoFilters(movie, filters) {
  const role = filters.role;
  const query = filters.personQuery.toLowerCase();
  const hasQuery = Boolean(query);
  const castMatch = movie.cast.some((name) => name.toLowerCase().includes(query));
  const directorMatch = movie.director.toLowerCase().includes(query);
  const producerMatch = movie.producers.some((name) => name.toLowerCase().includes(query));

  const personOk =
    !hasQuery ||
    (role === "any" && (castMatch || directorMatch || producerMatch)) ||
    (role === "cast" && castMatch) ||
    (role === "director" && directorMatch) ||
    (role === "producer" && producerMatch);

  const genreOk =
    filters.genreId === "all" || movie.genreIds.includes(Number(filters.genreId));
  const decadeOk =
    filters.decade === "all" ||
    (movie.year >= Number(filters.decade) && movie.year <= Number(filters.decade) + 9);
  const imdbOk = movie.imdb >= filters.imdbMin;
  const rtOk = movie.rt >= filters.rtMin;

  return personOk && genreOk && decadeOk && imdbOk && rtOk;
}

async function buildDiscoverPayload(filters) {
  if (filters.personQuery) {
    return discoverByPerson(filters);
  }

  return discoverBroad(filters);
}

async function discoverBroad(filters) {
  const requestedLimit = DISCOVER_RESULT_LIMIT;
  const pageCount = Math.min(Math.max(1, Math.ceil(requestedLimit / 20)), 3);
  const params = {
    include_adult: "false",
    include_video: "false",
    language: "en-US",
    page: "1",
    sort_by: mapSort(filters.sort),
    vote_count_gte: "200",
  };

  if (filters.genreId !== "all") {
    params.with_genres = filters.genreId;
  }

  if (filters.decade !== "all") {
    const start = Number(filters.decade);
    params["primary_release_date.gte"] = `${start}-01-01`;
    params["primary_release_date.lte"] = `${start + 9}-12-31`;
  }

  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, index) =>
      tmdb("/discover/movie", { ...params, page: String(index + 1) }),
    ),
  );
  const allResults = pages.flatMap((page) => page.results ?? []);
  const baseResults = allResults.slice(0, requestedLimit);
  const needsRatings = filters.imdbMin > 0 || filters.rtMin > 0;
  const movies = needsRatings
    ? await hydrateMovies(baseResults.slice(0, DISCOVER_HYDRATE_LIMIT), filters)
    : baseResults.map(normalizeDiscoverMovie);

  return {
    matchedPerson: null,
    totalMatches: pages[0]?.total_results ?? movies.length,
    movies: movies
      .filter((movie) => passesRatingFilters(movie, filters))
      .sort((left, right) => sortMovies(left, right, filters.sort)),
  };
}

async function discoverByPerson(filters) {
  const dbResults = await searchPeopleFromPostgres(filters.personQuery);
  const person = dbResults[0];
  if (!person) {
    return { matchedPerson: null, totalMatches: 0, movies: [] };
  }

  const allCredits = await fetchPersonMoviesFromPostgres(person.id, filters, PERSON_RESULT_LIMIT);
  const movies = allCredits.map(normalizeDbCreditMovie);

  return {
    matchedPerson: person,
    totalMatches: allCredits.length,
    movies: movies
      .filter((movie) => passesRatingFilters(movie, filters))
      .sort((left, right) => sortMovies(left, right, filters.sort)),
  };
}

async function fetchPersonMoviesFromPostgres(personId, filters, limit) {
  if (!dbPools) {
    return [];
  }

  const params = [personId];
  const whereParts = [];
  whereParts.push(buildRoleSqlFilter(filters.role, "pmc"));

  if (filters.genreId !== "all") {
    params.push(String(filters.genreId));
    whereParts.push(`
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(m.genre_ids_json, '[]'::jsonb)) AS g(value)
        WHERE g.value = $${params.length}
      )
    `);
  }

  if (filters.decade !== "all") {
    const start = Number(filters.decade);
    params.push(`${start}-01-01`);
    params.push(`${start + 9}-12-31`);
    whereParts.push(`m.release_date IS NOT NULL AND m.release_date >= $${params.length - 1} AND m.release_date <= $${params.length}`);
  }

  params.push(limit);
  const sql = `
    SELECT
      m.movie_id AS id,
      m.title,
      m.release_date,
      m.vote_average,
      m.vote_count,
      m.genre_ids_json,
      m.tmdb_json,
      bool_or(pmc.credit_type = 'cast') AS cast_match,
      bool_or(pmc.credit_type = 'crew' AND pmc.job = 'Director') AS director_match,
      bool_or(pmc.credit_type = 'crew' AND pmc.job ILIKE '%producer%') AS producer_match
    FROM person_movie_credits pmc
    JOIN movies m ON m.movie_id = pmc.movie_id
    WHERE
      pmc.person_id = $1
      AND (${whereParts.join(" AND ")})
    GROUP BY
      m.movie_id,
      m.title,
      m.release_date,
      m.vote_average,
      m.vote_count,
      m.genre_ids_json,
      m.tmdb_json
    ORDER BY ${buildMovieSortSql(filters.sort)}
    LIMIT $${params.length}
  `;

  const result = await queryDb(sql, params);
  return result.rows;
}

function buildRoleSqlFilter(role, alias) {
  if (role === "cast") {
    return `${alias}.credit_type = 'cast'`;
  }
  if (role === "director") {
    return `${alias}.credit_type = 'crew' AND ${alias}.job = 'Director'`;
  }
  if (role === "producer") {
    return `${alias}.credit_type = 'crew' AND ${alias}.job ILIKE '%producer%'`;
  }
  return `(
    ${alias}.credit_type = 'cast'
    OR (${alias}.credit_type = 'crew' AND ${alias}.job = 'Director')
    OR (${alias}.credit_type = 'crew' AND ${alias}.job ILIKE '%producer%')
  )`;
}

function buildMovieSortSql(sort) {
  switch (sort) {
    case "year-asc":
      return "m.release_date ASC NULLS LAST, m.vote_average DESC NULLS LAST, m.vote_count DESC NULLS LAST";
    case "year-desc":
      return "m.release_date DESC NULLS LAST, m.vote_average DESC NULLS LAST, m.vote_count DESC NULLS LAST";
    case "imdb":
    case "rt":
      return "m.vote_average DESC NULLS LAST, m.vote_count DESC NULLS LAST, m.release_date DESC NULLS LAST";
    case "match":
    default:
      return "m.vote_count DESC NULLS LAST, m.vote_average DESC NULLS LAST, m.release_date DESC NULLS LAST";
  }
}

function normalizeDbCreditMovie(row) {
  const tmdbJson = row.tmdb_json && typeof row.tmdb_json === "object" ? row.tmdb_json : {};
  const reasons = [];
  if (row.cast_match) {
    reasons.push("Cast");
  }
  if (row.director_match) {
    reasons.push("Director");
  }
  if (row.producer_match) {
    reasons.push("Producer");
  }

  return {
    id: Number(row.id),
    title: row.title,
    year: row.release_date ? Number(String(row.release_date).slice(0, 4)) : null,
    runtime: "Runtime on detail view",
    imdb: null,
    rt: null,
    metacritic: null,
    tmdb: typeof row.vote_average === "number" ? Number(Number(row.vote_average).toFixed(1)) : null,
    genres: [],
    genreIds: Array.isArray(row.genre_ids_json) ? row.genre_ids_json : [],
    cast: [],
    director: "",
    producers: [],
    logline: tmdbJson.overview || "No overview available yet.",
    posterUrl: tmdbJson.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbJson.poster_path}` : "",
    matchReason: reasons.length ? reasons.join(" / ") : "Matched by person credit.",
    isEnriched: false,
  };
}

function upsertCredit(creditMap, credit, role, personName, filters) {
  if (filters.role !== "any" && filters.role !== role) {
    return;
  }

  const existing = creditMap.get(credit.id) || {
    id: credit.id,
    title: credit.title,
    release_date: credit.release_date,
    genre_ids: credit.genre_ids || [],
    popularity: credit.popularity || 0,
    vote_average: credit.vote_average,
    vote_count: credit.vote_count || 0,
    reasons: [],
  };

  existing.reasons.push(`${capitalizeRole(role)}: ${personName}`);
  creditMap.set(credit.id, existing);
}

async function hydrateMovies(items, filters) {
  const detailedMovies = await Promise.allSettled(
    items.map(async (item) => {
      const details = await tmdb(`/movie/${item.id}`, { append_to_response: "credits" });
      const omdbRatings = details.imdb_id ? await lookupOmdb(details.imdb_id) : null;
      const movie = normalizeMovie(details, item.reasons || [], omdbRatings);
      return movie;
    }),
  );

  return detailedMovies
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .filter((movie) => passesRatingFilters(movie, filters))
    .sort((left, right) => sortMovies(left, right, filters.sort));
}

async function hydrateMoviesSequential(items, filters) {
  const movies = [];

  for (const item of items) {
    try {
      const details = await tmdb(`/movie/${item.id}`, { append_to_response: "credits" });
      const omdbRatings = details.imdb_id ? await lookupOmdb(details.imdb_id) : null;
      movies.push(normalizeMovie(details, item.reasons || [], omdbRatings));
    } catch {
      // Skip failed enrichments and let the frontend retry later.
    }
  }

  return movies
    .filter((movie) => passesRatingFilters(movie, filters))
    .sort((left, right) => sortMovies(left, right, filters.sort));
}

function normalizeMovie(details, reasons, omdbRatings) {
  const director = (details.credits?.crew ?? []).find((person) => person.job === "Director");
  const producers = (details.credits?.crew ?? [])
    .filter((person) => person.job === "Producer")
    .slice(0, 3)
    .map((person) => person.name);
  const cast = (details.credits?.cast ?? []).slice(0, 4).map((person) => person.name);
  const year = details.release_date ? Number(details.release_date.slice(0, 4)) : null;

  return {
    id: details.id,
    title: details.title,
    year,
    runtime: details.runtime ? `${details.runtime} min` : "Unknown runtime",
    imdb: omdbRatings?.imdb ?? null,
    rt: omdbRatings?.rt ?? null,
    metacritic: omdbRatings?.metacritic ?? null,
    tmdb: typeof details.vote_average === "number" ? Number(details.vote_average.toFixed(1)) : null,
    genres: (details.genres ?? []).map((genre) => genre.name),
    cast,
    director: director?.name || "Unknown",
    producers,
    logline: details.overview || "No overview available yet.",
    posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "",
    matchReason: reasons.length ? reasons.join(" / ") : "Live discovery result.",
    isEnriched: true,
  };
}

function normalizePerson(person) {
  const rating = personKnownForScore(person);
  return {
    id: person.id,
    name: person.name,
    department: person.known_for_department || "Person",
    score: rating,
    popularity: Number(person.popularity || 0),
    knownFor: (person.known_for ?? [])
      .map((credit) => credit.title || credit.name)
      .filter(Boolean)
      .slice(0, 3),
    profileUrl: person.profile_path ? `https://image.tmdb.org/t/p/w500${person.profile_path}` : "",
    ratingLabel: rating ? `Known-for average ${rating.toFixed(1)}` : "Known-for score unavailable",
  };
}

function normalizeFeaturedPeopleSource(source) {
  if (
    source &&
    Array.isArray(source.actors) &&
    Array.isArray(source.directors) &&
    Array.isArray(source.producers)
  ) {
    return {
      actors: source.actors.slice(0, FEATURED_PEOPLE_LIMIT),
      directors: source.directors.slice(0, FEATURED_PEOPLE_LIMIT),
      producers: source.producers.slice(0, FEATURED_PEOPLE_LIMIT),
    };
  }

  if (source && Array.isArray(source.actors) && Array.isArray(source.filmmakers)) {
    return {
      actors: source.actors.slice(0, FEATURED_PEOPLE_LIMIT),
      directors: source.filmmakers
        .filter((person) => isDirectorDepartment(person.department))
        .slice(0, FEATURED_PEOPLE_LIMIT),
      producers: source.filmmakers
        .filter((person) => isProducerDepartment(person.department))
        .slice(0, FEATURED_PEOPLE_LIMIT),
    };
  }

  return curateFeaturedPeople(source);
}

function curateFeaturedPeople(results, limit = FEATURED_PEOPLE_LIMIT) {
  const normalized = dedupePeople(results).map(normalizePerson);
  const actors = normalized
    .filter((person) => isActingDepartment(person.department))
    .sort(compareFeaturedPeople)
    .slice(0, limit);
  const directors = normalized
    .filter((person) => isDirectorDepartment(person.department))
    .sort(compareFeaturedPeople)
    .slice(0, limit);
  const producers = normalized
    .filter((person) => isProducerDepartment(person.department))
    .sort(compareFeaturedPeople)
    .slice(0, limit);

  return { actors, directors, producers };
}

function dedupePeople(results) {
  const byId = new Map();
  for (const person of results) {
    if (!person || !Number.isFinite(person.id) || byId.has(person.id)) {
      continue;
    }

    byId.set(person.id, person);
  }

  return [...byId.values()];
}

function compareFeaturedPeople(left, right) {
  const leftScore = Number.isFinite(left.score) ? left.score : -1;
  const rightScore = Number.isFinite(right.score) ? right.score : -1;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const leftPopularity = Number.isFinite(left.popularity) ? left.popularity : -1;
  const rightPopularity = Number.isFinite(right.popularity) ? right.popularity : -1;
  if (leftPopularity !== rightPopularity) {
    return rightPopularity - leftPopularity;
  }

  return left.name.localeCompare(right.name);
}

function personKnownForScore(person) {
  const credits = (person.known_for ?? []).filter(
    (credit) => credit.media_type === "movie" && typeof credit.vote_average === "number",
  );
  if (!credits.length) {
    return null;
  }

  const totalWeight = credits.reduce((sum, credit) => sum + Math.max(credit.vote_count || 1, 1), 0);
  if (!totalWeight) {
    return null;
  }

  const weightedScore = credits.reduce(
    (sum, credit) => sum + credit.vote_average * Math.max(credit.vote_count || 1, 1),
    0,
  );
  return Number((weightedScore / totalWeight).toFixed(1));
}

async function getAvailablePeopleDirectory(limit = DB_FEATURED_LIMIT) {
  return (await getPeopleDirectoryFromPostgres(limit)) || readPeopleIndex() || null;
}

async function isLocalPeopleIndexAvailable() {
  const dbStatus = await getIndexStatusFromPostgres();
  if (dbStatus && dbStatus.ready) {
    return true;
  }

  const localIndex = readPeopleIndex();
  return Boolean(localIndex);
}

async function isLocalPeopleIndexAvailableFast() {
  try {
    const status = await withTimeout(getIndexStatusFromPostgres(), 1500);
    if (status && status.ready) {
      return true;
    }
  } catch {
    // Fall through to local file check.
  }

  const localIndex = readPeopleIndex();
  return Boolean(localIndex);
}

async function getGenresFast() {
  const cacheKey = "genres:v1";
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const diskCached = readDiskCache(cacheKey);
  if (diskCached && diskCached.expiresAt > Date.now()) {
    cache.set(cacheKey, diskCached);
    return diskCached.value;
  }

  try {
    const response = await withTimeout(tmdb("/genre/movie/list"), 3500);
    const genres = Array.isArray(response?.genres) ? response.genres : demoGenres;
    const entry = { value: genres, expiresAt: Date.now() + 1000 * 60 * 60 * 24 };
    cache.set(cacheKey, entry);
    writeDiskCache(cacheKey, entry);
    return genres;
  } catch {
    return demoGenres;
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function readPeopleIndex() {
  try {
    if (!fs.existsSync(peopleIndexPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(peopleIndexPath, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.actors) ||
      (!Array.isArray(parsed.filmmakers) &&
        (!Array.isArray(parsed.directors) || !Array.isArray(parsed.producers)))
    ) {
      return null;
    }

    if (Array.isArray(parsed.directors) && Array.isArray(parsed.producers)) {
      return parsed;
    }

    return {
      ...parsed,
      directors: (parsed.filmmakers || []).filter((person) => isDirectorDepartment(person.department)),
      producers: (parsed.filmmakers || []).filter((person) => isProducerDepartment(person.department)),
    };
  } catch (error) {
    logServerError("getIndexStatusFromPostgres", error);
    return null;
  }
}

function isActingDepartment(department) {
  return String(department || "").toLowerCase().includes("acting");
}

function isDirectorDepartment(department) {
  return String(department || "").toLowerCase().includes("direct");
}

function isProducerDepartment(department) {
  return String(department || "").toLowerCase().includes("produc");
}

function buildIndexStatus(index) {
  return {
    ready: Boolean(index),
    generatedAt: index?.generatedAt || null,
    counts: {
      actors: index?.actors?.length || 0,
      directors: index?.directors?.length || 0,
      producers: index?.producers?.length || 0,
    },
  };
}

function peopleDirectorySlice(directory, department) {
  if (department === "directors") {
    return directory.directors || [];
  }

  if (department === "producers") {
    return directory.producers || [];
  }

  if (department === "filmmakers") {
    return [...(directory.directors || []), ...(directory.producers || [])].sort(compareFeaturedPeople);
  }

  return directory.actors || [];
}

function filterPeopleDirectory(people, query) {
  const normalizedQuery = normalizeName(query || "");
  if (!normalizedQuery) {
    return [...people];
  }

  return people.filter((person) => {
    const haystack = [person.name, person.department, ...(person.knownFor || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function sortPeopleDirectory(people, sort) {
  const sorted = [...people];
  sorted.sort((left, right) => {
    if (sort === "name") {
      return String(left.name || "").localeCompare(String(right.name || ""));
    }
    if (sort === "popularity") {
      return (Number(right.popularity || 0) - Number(left.popularity || 0))
        || String(left.name || "").localeCompare(String(right.name || ""));
    }
    return (Number(right.score || 0) - Number(left.score || 0))
      || String(left.name || "").localeCompare(String(right.name || ""));
  });
  return sorted;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function searchLocalPeopleIndex(index, query) {
  const normalizedQuery = normalizeName(query);
  const combined = dedupePeople([
    ...(index.actors || []),
    ...(index.directors || []),
    ...(index.producers || []),
  ]);

  return combined
    .filter((person) => {
      const haystack = [person.name, person.department, ...(person.knownFor || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftStarts = normalizeName(left.name).startsWith(normalizedQuery) ? 1 : 0;
      const rightStarts = normalizeName(right.name).startsWith(normalizedQuery) ? 1 : 0;
      if (leftStarts !== rightStarts) {
        return rightStarts - leftStarts;
      }
      return compareFeaturedPeople(left, right);
    })
    .slice(0, 8);
}

function selectBestPersonMatch(results, query) {
  if (!results.length) {
    return null;
  }

  const normalizedQuery = normalizeName(query);
  const exactMatch = results.find((person) => normalizeName(person.name) === normalizedQuery);
  if (exactMatch) {
    return exactMatch;
  }

  const startsWithMatch = results.find((person) =>
    normalizeName(person.name).startsWith(normalizedQuery),
  );
  if (startsWithMatch) {
    return startsWithMatch;
  }

  return [...results].sort((left, right) => {
    const leftScore = personMatchScore(left, normalizedQuery);
    const rightScore = personMatchScore(right, normalizedQuery);
    return rightScore - leftScore;
  })[0];
}

function personMatchScore(person, normalizedQuery) {
  const normalizedName = normalizeName(person.name);
  let score = 0;

  if (normalizedName.includes(normalizedQuery)) {
    score += 100;
  }

  if (person.known_for_department === "Acting") {
    score += 25;
  }

  score += person.popularity || 0;
  return score;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildDiscoverCacheKey(filters) {
  const normalized = {
    personQuery: normalizeName(filters.personQuery || ""),
    role: filters.role || "any",
    genreId: filters.genreId || "all",
    decade: filters.decade || "all",
    sort: filters.sort || "match",
    imdbMin: Number.isFinite(Number(filters.imdbMin)) ? Number(filters.imdbMin) : 0,
    rtMin: Number.isFinite(Number(filters.rtMin)) ? Number(filters.rtMin) : 0,
  };

  return `discover:v1:${JSON.stringify(normalized)}`;
}

function normalizeDiscoverMovie(movie) {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
    runtime: "Runtime on detail view",
    imdb: null,
    rt: null,
    metacritic: null,
    tmdb: typeof movie.vote_average === "number" ? Number(movie.vote_average.toFixed(1)) : null,
    genres: [],
    genreIds: movie.genre_ids || [],
    cast: [],
    director: "",
    producers: [],
    logline: movie.overview || "No overview available yet.",
    posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : "",
    matchReason: "Live discovery result.",
    isEnriched: false,
  };
}

function normalizeCreditMovie(movie) {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
    runtime: "Runtime on detail view",
    imdb: null,
    rt: null,
    metacritic: null,
    tmdb: typeof movie.vote_average === "number" ? Number(movie.vote_average.toFixed(1)) : null,
    genres: [],
    genreIds: movie.genre_ids || [],
    cast: [],
    director: "",
    producers: [],
    logline: "Expanded credits available when detail hydration is needed.",
    posterUrl: "",
    matchReason: (movie.reasons || []).join(" / ") || "Matched by person credit.",
    isEnriched: false,
  };
}

async function lookupOmdb(imdbId) {
  if (!omdbApiKey) {
    return null;
  }

  let response;
  try {
    response = await cachedJson(
      `omdb:${imdbId}`,
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbApiKey)}&i=${encodeURIComponent(imdbId)}`,
      { ttlMs: 1000 * 60 * 60 * 6 },
    );
  } catch {
    return null;
  }

  if (!response || response.Response === "False") {
    return null;
  }

  const ratings = response.Ratings || [];
  const rotten = ratings.find((rating) => rating.Source === "Rotten Tomatoes")?.Value || null;
  const metacritic = response.Metascore && response.Metascore !== "N/A" ? Number(response.Metascore) : null;

  return {
    imdb: response.imdbRating && response.imdbRating !== "N/A" ? Number(response.imdbRating) : null,
    rt: rotten ? Number(rotten.replace("%", "")) : null,
    metacritic,
  };
}

async function tmdb(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  if (tmdbApiKey) {
    url.searchParams.set("api_key", tmdbApiKey);
    return cachedJson(`tmdb:${url.pathname}?${url.searchParams.toString()}`, url.toString(), {
      ttlMs: 1000 * 60 * 15,
      headers: {
        Accept: "application/json",
      },
    });
  }

  if (!tmdbToken) {
    throw new Error("TMDb credentials are missing.");
  }

  try {
    return await cachedJson(`tmdb:${url.pathname}?${url.searchParams.toString()}`, url.toString(), {
      ttlMs: 1000 * 60 * 15,
      headers: {
        Authorization: `Bearer ${tmdbToken}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!tmdbApiKey || (!message.includes("401") && !message.includes("403"))) {
      throw error;
    }

    const fallbackUrl = new URL(url);
    fallbackUrl.searchParams.set("api_key", tmdbApiKey);
    return cachedJson(`tmdb:${fallbackUrl.pathname}?${fallbackUrl.searchParams.toString()}`, fallbackUrl.toString(), {
      ttlMs: 1000 * 60 * 15,
      headers: {
        Accept: "application/json",
      },
    });
  }
}

async function cachedJson(key, url, options = {}) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const diskCached = readDiskCache(key);
  if (diskCached && diskCached.expiresAt > Date.now()) {
    cache.set(key, diskCached);
    return diskCached.value;
  }

  const response = await requestJson(url, options.headers || {});
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Upstream request failed: ${response.statusCode} ${response.statusMessage}${
        response.body ? ` - ${response.body}` : ""
      }`,
    );
  }

  const value = JSON.parse(response.body);
  const entry = { value, expiresAt: Date.now() + (options.ttlMs || 0) };
  cache.set(key, entry);
  writeDiskCache(key, entry);
  return value;
}

function requestJson(url, headers) {
  return requestViaCurl(url, headers);
}

function requestViaCurl(url, headers) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-L",
      "--connect-timeout",
      "5",
      "--max-time",
      "20",
      "--retry",
      "2",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      "-w",
      "\n%{http_code}",
    ];

    Object.entries(headers || {}).forEach(([key, value]) => {
      args.push("-H", `${key}: ${value}`);
    });

    args.push(url);

    execFile("curl", args, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`curl failed for ${url}: ${stderr || error.message}`));
        return;
      }

      const trimmed = stdout.trimEnd();
      const lastNewline = trimmed.lastIndexOf("\n");
      if (lastNewline === -1) {
        reject(new Error("Unexpected curl response format"));
        return;
      }

      const body = trimmed.slice(0, lastNewline);
      const statusCode = Number(trimmed.slice(lastNewline + 1));

      if (!Number.isFinite(statusCode)) {
        reject(new Error(`Unexpected curl status for ${url}`));
        return;
      }

      resolve({
        statusCode,
        statusMessage: statusCode >= 200 && statusCode < 300 ? "OK" : "Upstream error",
        body,
      });
    });
  });
}

function mapSort(sort) {
  switch (sort) {
    case "year-asc":
      return "primary_release_date.asc";
    case "year-desc":
      return "primary_release_date.desc";
    case "imdb":
    case "rt":
      return "vote_average.desc";
    case "match":
    default:
      return "popularity.desc";
  }
}

function matchesGenreAndDecade(credit, filters) {
  const genreOk =
    filters.genreId === "all" || (credit.genre_ids || []).includes(Number(filters.genreId));
  const decadeOk =
    filters.decade === "all" ||
    (credit.release_date && credit.release_date.startsWith(String(filters.decade)));

  if (filters.decade === "all") {
    return genreOk;
  }

  if (!credit.release_date) {
    return false;
  }

  const year = Number(credit.release_date.slice(0, 4));
  return genreOk && year >= Number(filters.decade) && year <= Number(filters.decade) + 9;
}

function passesRatingFilters(movie, filters) {
  const imdbCandidate = movie.imdb ?? movie.tmdb ?? null;
  const rtCandidate = movie.rt ?? (movie.tmdb !== null && movie.tmdb !== undefined ? Math.round(movie.tmdb * 10) : null);
  const imdbOk = filters.imdbMin <= 0 || (imdbCandidate !== null && imdbCandidate >= filters.imdbMin);
  const rtOk = filters.rtMin <= 0 || (rtCandidate !== null && rtCandidate >= filters.rtMin);
  return imdbOk && rtOk;
}

function sortMovies(left, right, sortBy) {
  switch (sortBy) {
    case "imdb":
      return (right.imdb ?? -1) - (left.imdb ?? -1) || (right.tmdb ?? -1) - (left.tmdb ?? -1);
    case "rt":
      return (right.rt ?? -1) - (left.rt ?? -1) || (right.imdb ?? -1) - (left.imdb ?? -1);
    case "year-asc":
      return (left.year ?? 0) - (right.year ?? 0);
    case "year-desc":
      return (right.year ?? 0) - (left.year ?? 0);
    case "match":
    default:
      return (right.imdb ?? right.tmdb ?? -1) - (left.imdb ?? left.tmdb ?? -1);
  }
}

function sortCreditCandidates(left, right, sortBy) {
  switch (sortBy) {
    case "year-asc":
      return compareYears(left.release_date, right.release_date);
    case "year-desc":
      return compareYears(right.release_date, left.release_date);
    case "imdb":
    case "rt":
      return (
        (right.vote_average || 0) - (left.vote_average || 0) ||
        (right.vote_count || 0) - (left.vote_count || 0) ||
        (right.popularity || 0) - (left.popularity || 0)
      );
    case "match":
    default:
      return (
        (right.popularity || 0) - (left.popularity || 0) ||
        (right.vote_count || 0) - (left.vote_count || 0) ||
        (right.vote_average || 0) - (left.vote_average || 0) ||
        compareYears(right.release_date, left.release_date)
      );
  }
}

function compareYears(leftDate, rightDate) {
  const leftYear = leftDate ? Number(leftDate.slice(0, 4)) : 0;
  const rightYear = rightDate ? Number(rightDate.slice(0, 4)) : 0;
  return leftYear - rightYear;
}

function normalizeCrewRole(job) {
  if (job === "Director") {
    return "director";
  }

  if (job === "Producer") {
    return "producer";
  }

  return null;
}

function capitalizeRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function createDbPools() {
  if (!databaseUrl) {
    return null;
  }

  const baseConfig = {
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  const pools = { ssl: null, plain: null };
  const prefersSsl = shouldUseDbSsl(databaseUrl);
  preferredDbPool = prefersSsl ? "ssl" : "plain";

  try {
    pools.ssl = new Pool({
      ...baseConfig,
      ssl: { rejectUnauthorized: false },
    });
  } catch (error) {
    logServerError("createDbPools-ssl", error);
  }

  try {
    pools.plain = new Pool({
      ...baseConfig,
      ssl: false,
    });
  } catch (error) {
    logServerError("createDbPools-plain", error);
  }

  if (!pools.ssl && !pools.plain) {
    logServerError("createDbPools", "No database pool could be created");
    return null;
  }

  if (preferredDbPool === "ssl" && !pools.ssl) {
    preferredDbPool = "plain";
  } else if (preferredDbPool === "plain" && !pools.plain) {
    preferredDbPool = "ssl";
  }

  return pools;
}

function shouldUseDbSsl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get("sslmode") === "disable") {
      return false;
    }
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

async function getIndexStatusFromPostgres() {
  if (!dbPools) {
    return null;
  }

  const cacheKey = "pg:index-status:v1";
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const diskCached = readDiskCache(cacheKey);
  if (diskCached && diskCached.expiresAt > Date.now()) {
    cache.set(cacheKey, diskCached);
    return diskCached.value;
  }

  try {
    const result = await withTimeout(
      queryDb(`
      SELECT
        (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'cast')::int AS actors_count,
        (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'crew' AND pmc.job = 'Director')::int AS directors_count,
        (SELECT COUNT(DISTINCT pmc.person_id) FROM person_movie_credits pmc WHERE pmc.credit_type = 'crew' AND pmc.job ILIKE '%producer%')::int AS producers_count,
        (SELECT MAX(updated_at) FROM people) AS generated_at
    `),
      3000,
    );
    const row = result.rows[0];
    const total = Number(row.actors_count || 0) + Number(row.directors_count || 0) + Number(row.producers_count || 0);
    const value = {
      ready: total > 0,
      generatedAt: row.generated_at || null,
      counts: {
        actors: Number(row.actors_count || 0),
        directors: Number(row.directors_count || 0),
        producers: Number(row.producers_count || 0),
      },
    };
    const entry = { value, expiresAt: Date.now() + DB_STATUS_CACHE_TTL_MS };
    cache.set(cacheKey, entry);
    writeDiskCache(cacheKey, entry);
    return value;
  } catch (error) {
    logServerError("getIndexStatusFromPostgres", error);
    return null;
  }
}

async function getPeopleDirectoryFromPostgres(limit = DB_FEATURED_LIMIT) {
  if (!dbPools) {
    return null;
  }

  const cacheKey = `pg:people-directory:v1:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const diskCached = readDiskCache(cacheKey);
  if (diskCached && diskCached.expiresAt > Date.now()) {
    cache.set(cacheKey, diskCached);
    return diskCached.value;
  }

  try {
    const [actors, directors, producers] = await Promise.all([
      fetchRankedPeopleFromPostgres("actors", limit),
      fetchRankedPeopleFromPostgres("directors", limit),
      fetchRankedPeopleFromPostgres("producers", limit),
    ]);
    if (!actors.length && !directors.length && !producers.length) {
      return null;
    }
    const value = { actors, directors, producers };
    const entry = { value, expiresAt: Date.now() + DB_DIRECTORY_CACHE_TTL_MS };
    cache.set(cacheKey, entry);
    writeDiskCache(cacheKey, entry);
    return value;
  } catch (error) {
    logServerError("getPeopleDirectoryFromPostgres", error);
    return null;
  }
}

async function fetchRankedPeopleFromPostgres(role, limit) {
  const roleFilter = roleToSqlFilter(role, "pmc");
  const knownForRoleFilter = roleToSqlFilter(role, "pmc2");
  const sql = `
    WITH ranked AS (
      SELECT
        p.person_id AS id,
        p.name,
        COALESCE(p.known_for_department, 'Person') AS department,
        p.profile_path,
        COALESCE(p.popularity, 0) AS popularity,
        ROUND(
          (
            SUM(COALESCE(m.vote_average, 0) * GREATEST(COALESCE(m.vote_count, 0), 1))
            / NULLIF(SUM(GREATEST(COALESCE(m.vote_count, 0), 1)), 0)
          )::numeric,
          1
        ) AS score
      FROM people p
      JOIN person_movie_credits pmc ON pmc.person_id = p.person_id
      JOIN movies m ON m.movie_id = pmc.movie_id
      WHERE ${roleFilter}
      GROUP BY p.person_id, p.name, p.known_for_department, p.profile_path, p.popularity
      ORDER BY score DESC NULLS LAST, popularity DESC NULLS LAST, p.name ASC
      LIMIT $1
    )
    SELECT
      r.id,
      r.name,
      r.department,
      r.profile_path,
      r.popularity,
      r.score,
      COALESCE((
        SELECT ARRAY(
          SELECT m2.title
          FROM person_movie_credits pmc2
          JOIN movies m2 ON m2.movie_id = pmc2.movie_id
          WHERE pmc2.person_id = r.id AND ${knownForRoleFilter}
          GROUP BY m2.movie_id, m2.title, m2.vote_average, m2.vote_count
          ORDER BY m2.vote_average DESC NULLS LAST, m2.vote_count DESC NULLS LAST
          LIMIT 3
        )
      ), ARRAY[]::text[]) AS known_for
    FROM ranked r
    ORDER BY r.score DESC NULLS LAST, r.popularity DESC NULLS LAST, r.name ASC
  `;

  const result = await queryDb(sql, [limit]);
  return result.rows.map(normalizeDbPersonRow);
}

function roleToSqlFilter(role, alias) {
  if (role === "actors") {
    return `${alias}.credit_type = 'cast'`;
  }

  if (role === "directors") {
    return `${alias}.credit_type = 'crew' AND ${alias}.job = 'Director'`;
  }

  return `${alias}.credit_type = 'crew' AND ${alias}.job ILIKE '%producer%'`;
}

async function searchPeopleFromPostgres(query) {
  if (!dbPools) {
    return [];
  }

  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const cacheKey = `pg:people-search:v1:${normalizedQuery}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const diskCached = readDiskCache(cacheKey);
  if (diskCached && diskCached.expiresAt > Date.now()) {
    cache.set(cacheKey, diskCached);
    return diskCached.value;
  }

  try {
    const result = await queryDb(
      `
        SELECT
          p.person_id AS id,
          p.name,
          COALESCE(p.known_for_department, 'Person') AS department,
          p.profile_path,
          COALESCE(p.popularity, 0) AS popularity,
          ROUND((
            SELECT
              SUM(COALESCE(m.vote_average, 0) * GREATEST(COALESCE(m.vote_count, 0), 1))
              / NULLIF(SUM(GREATEST(COALESCE(m.vote_count, 0), 1)), 0)
            FROM person_movie_credits pmc
            JOIN movies m ON m.movie_id = pmc.movie_id
            WHERE pmc.person_id = p.person_id
          )::numeric, 1) AS score,
          COALESCE((
            SELECT ARRAY(
              SELECT m2.title
              FROM person_movie_credits pmc2
              JOIN movies m2 ON m2.movie_id = pmc2.movie_id
              WHERE pmc2.person_id = p.person_id
              GROUP BY m2.movie_id, m2.title, m2.vote_average, m2.vote_count
              ORDER BY m2.vote_average DESC NULLS LAST, m2.vote_count DESC NULLS LAST
              LIMIT 3
            )
          ), ARRAY[]::text[]) AS known_for
        FROM people p
        WHERE p.name ILIKE $1
        ORDER BY
          CASE WHEN LOWER(p.name) = LOWER($2) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(p.name) LIKE LOWER($3) THEN 0 ELSE 1 END,
          p.popularity DESC NULLS LAST,
          p.name ASC
        LIMIT 8
      `,
      [`%${query}%`, query, `${query}%`],
    );
    const value = result.rows.map(normalizeDbPersonRow);
    const entry = { value, expiresAt: Date.now() + DB_PEOPLE_SEARCH_CACHE_TTL_MS };
    cache.set(cacheKey, entry);
    writeDiskCache(cacheKey, entry);
    return value;
  } catch (error) {
    logServerError("searchPeopleFromPostgres", error);
    return [];
  }
}

async function queryDb(sql, params = []) {
  if (!dbPools) {
    throw new Error("Database pool not configured");
  }

  const order = preferredDbPool === "plain" ? ["plain", "ssl"] : ["ssl", "plain"];
  let lastError = null;
  for (const mode of order) {
    const pool = dbPools[mode];
    if (!pool) {
      continue;
    }
    try {
      const result = await pool.query(sql, params);
      preferredDbPool = mode;
      return result;
    } catch (error) {
      lastError = error;
      logServerError(`db-query-${mode}`, error);
    }
  }

  throw lastError || new Error("Database query failed");
}

function logServerError(scope, error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[${new Date().toISOString()}] ${scope}: ${detail}\n`);
}

function normalizeDbPersonRow(row) {
  const score = Number.isFinite(Number(row.score)) ? Number(row.score) : null;
  return {
    id: Number(row.id),
    name: row.name,
    department: row.department || "Person",
    score,
    popularity: Number(row.popularity || 0),
    knownFor: Array.isArray(row.known_for) ? row.known_for.filter(Boolean).slice(0, 3) : [],
    profileUrl: row.profile_path ? `https://image.tmdb.org/t/p/w500${row.profile_path}` : "",
    ratingLabel: score !== null ? `Career score ${score.toFixed(1)}` : "Known-for score unavailable",
  };
}

function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(staticRoot, `.${normalizedPath}`);

  if (!filePath.startsWith(`${staticRoot}${path.sep}`) && filePath !== path.join(staticRoot, "index.html")) {
    sendPlain(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendPlain(res, 404, "Not found");
      return;
    }

    const etag = `"${stats.size}-${Number(stats.mtimeMs).toString(16)}"`;
    if (res.req?.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }

    const immutableAsset =
      filePath.endsWith(".css") ||
      filePath.endsWith(".js") ||
      filePath.endsWith(".woff2") ||
      filePath.endsWith(".png") ||
      filePath.endsWith(".jpg") ||
      filePath.endsWith(".jpeg") ||
      filePath.endsWith(".webp") ||
      filePath.endsWith(".svg");
    const cacheControl = immutableAsset
      ? `public, max-age=${STATIC_ASSET_CACHE_TTL_SECONDS}, immutable`
      : "no-cache";

    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": cacheControl,
      ETag: etag,
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendPlain(res, 500, "Failed to read static file");
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendPlain(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function ensureCacheDir() {
  fs.mkdirSync(cacheDir, { recursive: true });
}

function cacheFilePath(key) {
  const digest = crypto.createHash("sha1").update(key).digest("hex");
  return path.join(cacheDir, `${digest}.json`);
}

function readDiskCache(key) {
  try {
    const filePath = cacheFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDiskCache(key, entry) {
  try {
    fs.writeFileSync(cacheFilePath(key), JSON.stringify(entry));
  } catch {
    // Ignore cache persistence failures.
  }
}
