"use strict";

const { identity } = require("../title-identity");

const TV_GENRES = [
  [10759, "Action & Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"],
  [99, "Documentary"], [18, "Drama"], [10751, "Family"], [10762, "Kids"],
  [9648, "Mystery"], [10763, "News"], [10764, "Reality"], [10765, "Sci-Fi & Fantasy"],
  [10766, "Soap"], [10767, "Talk"], [10768, "War & Politics"], [37, "Western"],
].map(([id, name]) => ({ id, name }));

// TMDb uses separate genre categories for movies and television.
function genreIdsFor(genre, mediaType) {
  if (!genre || genre === "all") return [];
  const id = Number(genre);
  const mappings = mediaType === "tv"
    ? { 28: [10759], 12: [10759], 878: [10765], 14: [10765], 10752: [10768] }
    : { 10759: [28, 12], 10765: [878, 14], 10768: [10752] };
  return mappings[id] || [id];
}

function normalizeTv(show, ratings = null, enriched = false) {
  const titleIdentity = identity({ id: show.id, mediaType: "tv" });
  if (!titleIdentity || !(show.name || show.title)) return null;
  const crew = show.aggregate_credits?.crew || show.credits?.crew || [];
  const cast = show.aggregate_credits?.cast || show.credits?.cast || [];
  const hasJob = (person, pattern) => [person.job, ...(person.jobs || []).map((job) => job.job)]
    .some((job) => pattern.test(job || ""));
  const creators = (show.created_by || []).map((person) => person.name);
  const episodeRuntime = (show.episode_run_time || []).find((minutes) => minutes > 0)
    || show.last_episode_to_air?.runtime;
  const seasons = Number.isInteger(show.number_of_seasons) ? show.number_of_seasons : null;
  return {
    ...titleIdentity,
    title: show.name || show.title,
    year: show.first_air_date ? Number(show.first_air_date.slice(0, 4)) : null,
    endYear: show.last_air_date ? Number(show.last_air_date.slice(0, 4)) : null,
    runtime: episodeRuntime ? `${episodeRuntime} min / episode` : "Episode runtime unknown",
    seasons,
    episodes: show.number_of_episodes ?? null,
    status: show.status || "",
    creators,
    imdb: ratings?.imdb ?? null,
    rt: ratings?.rt ?? null,
    metacritic: ratings?.metacritic ?? null,
    tmdb: typeof show.vote_average === "number" ? Number(show.vote_average.toFixed(1)) : null,
    matchScore: Number(show.vote_count || 0),
    genres: (show.genres || TV_GENRES.filter((genre) => (show.genre_ids || []).includes(genre.id))).map((genre) => genre.name),
    genreIds: show.genre_ids || (show.genres || []).map((genre) => genre.id),
    cast: cast.slice(0, 4).map((person) => person.name),
    director: creators.join(", "),
    producers: crew.filter((person) => hasJob(person, /producer/i)).slice(0, 3).map((person) => person.name),
    logline: show.overview || "No overview available yet.",
    posterUrl: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : "",
    awards: ratings?.awards || "",
    matchReason: (show.reasons || []).join(" / ") || "TV discovery result.",
    isEnriched: enriched,
  };
}

function createTvCatalog({ tmdb, lookupOmdb, searchPeople, selectPerson, searchStudios, selectStudio,
  passesFilters, sortMovies, needsHydration, hydrateLimit }) {
  async function hydrate(items, filters) {
    const results = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, 4) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          const key = identity(item);
          const details = await tmdb(`/tv/${key.tmdbId}`, {
            append_to_response: "aggregate_credits,external_ids", language: "en-US",
          });
          const ratings = details.external_ids?.imdb_id ? await lookupOmdb(details.external_ids.imdb_id) : null;
          const show = normalizeTv({ ...details, reasons: item.reasons }, ratings, true);
          if (show && passesFilters(show, filters)) results.push(show);
        } catch {
          // Leave base cards available; the client retries enrichment.
        }
      }
    }));
    return results.sort((a, b) => sortMovies(a, b, filters.sort));
  }

  async function discover(filters) {
    let matchedPerson = null;
    let matchedEntity = null;
    let candidates = [];
    let total = 0;
    const genreIds = genreIdsFor(filters.genreId, "tv");
    if (filters.personQuery && filters.searchType !== "studio") {
      if (filters.personId > 0) {
        const person = await tmdb(`/person/${filters.personId}`, { language: "en-US" });
        matchedPerson = { id: person.id, name: person.name };
      } else {
        const people = await searchPeople(filters.personQuery, { page: 1, limit: 10 });
        matchedPerson = selectPerson(people.results || [], filters.personQuery);
      }
      if (!matchedPerson) return { movies: [], totalMatches: 0, matchedPerson: null, matchedEntity: null };
      matchedEntity = { id: matchedPerson.id, name: matchedPerson.name, type: "person" };
      const credits = await tmdb(`/person/${matchedPerson.id}/tv_credits`, { language: "en-US" });
      const byId = new Map();
      function add(credit, role) {
        if (!role || (filters.role !== "any" && filters.role !== role)) return;
        const show = byId.get(credit.id) || { ...credit, reasons: [] };
        const label = role === "cast" ? "Cast" : role === "writer" ? "Writer / creator" : role === "director" ? "Director" : "Producer";
        const reason = `${label}: ${matchedPerson.name}`;
        if (!show.reasons.includes(reason)) show.reasons.push(reason);
        byId.set(credit.id, show);
      }
      (credits.cast || []).forEach((credit) => add(credit, "cast"));
      (credits.crew || []).forEach((credit) => {
        const job = credit.job || "";
        add(credit, /director/i.test(job) ? "director" : /producer/i.test(job) ? "producer"
          : /writ|creat|screenplay|story|teleplay/i.test(job) ? "writer" : null);
      });
      candidates = [...byId.values()].filter((show) => {
        const year = Number((show.first_air_date || "").slice(0, 4));
        return !show.adult && (!genreIds.length || genreIds.some((id) => (show.genre_ids || []).includes(id)))
          && (filters.decade === "all" || (year >= Number(filters.decade) && year < Number(filters.decade) + 10));
      });
      total = candidates.length;
    } else {
      const params = { language: "en-US", include_adult: "false", "vote_count.gte": "50" };
      params.sort_by = { "year-asc": "first_air_date.asc", "year-desc": "first_air_date.desc", imdb: "vote_average.desc", rt: "vote_average.desc" }[filters.sort] || "popularity.desc";
      if (genreIds.length) params.with_genres = genreIds.join("|");
      if (filters.decade !== "all") {
        params["first_air_date.gte"] = `${filters.decade}-01-01`;
        params["first_air_date.lte"] = `${Number(filters.decade) + 9}-12-31`;
      }
      if (filters.searchType === "studio" && filters.personQuery) {
        const studio = filters.personId > 0 ? { id: filters.personId, name: filters.personQuery }
          : selectStudio(await searchStudios(filters.personQuery), filters.personQuery);
        if (!studio) return { movies: [], totalMatches: 0, matchedPerson: null, matchedEntity: null };
        matchedEntity = { ...studio, type: "studio" };
        params.with_companies = String(studio.id);
      }
      const pages = await Promise.all([1, 2, 3].map((page) => tmdb("/discover/tv", { ...params, page })));
      candidates = pages.flatMap((page) => page.results || []).map((show) => ({
        ...show, reasons: matchedEntity ? [`Studio: ${matchedEntity.name}`] : [],
      }));
      total = pages[0]?.total_results || candidates.length;
    }
    const unique = [...new Map(candidates.map((show) => [show.id, show])).values()];
    const base = unique.map((show) => normalizeTv(show)).filter(Boolean)
      .sort((a, b) => sortMovies(a, b, filters.sort)).slice(0, 200);
    const needsDetails = needsHydration(filters);
    const movies = (needsDetails ? await hydrate(base.slice(0, hydrateLimit(filters)).map((show) => ({
      ...show, reasons: [show.matchReason],
    })), filters) : base).filter((show) => passesFilters(show, filters));
    return { movies, totalMatches: needsDetails ? movies.length : total, matchedPerson, matchedEntity };
  }
  return { hydrate, discover };
}

module.exports = { createTvCatalog, normalizeTv, TV_GENRES, genreIdsFor };
