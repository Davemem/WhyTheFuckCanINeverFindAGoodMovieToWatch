"use strict";
const { identity } = require("../title-identity");
const { genreIdsFor, TV_GENRES } = require("./tv-catalog");

function queue(limit = 6) {
  let running = 0;
  const waiting = [];
  function next() {
    while (running < limit && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      running++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { running--; next(); });
    }
  }
  return task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });
}
function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
function shuffle(items, seed) {
  return [...items].sort((a,b) => hash(seed + ":" + a.id) - hash(seed + ":" + b.id));
}
function roleMatches(kind, credit, cast = false) {
  if (kind === "actors") return cast;
  if (cast) return false;
  const job = credit.job || "";
  return kind === "directors" ? /^(?:Director|Co-Director)$/i.test(job)
    : kind === "writers" ? /^(?:Writer|Screenplay|Story|Teleplay|Creator|Original Story|Original Series Creator)$/i.test(job)
    : /^(?:Producer|Executive Producer|Co-Producer|Associate Producer|Co-Executive Producer)$/i.test(job);
}
function createSuggestionCatalog({ tmdb, normalize, cache, directory, live, demo, resolveStudio }) {
  const request = queue(6);
  const call = (endpoint, params) => request(() => tmdb(endpoint, params));
  const movieGenres = new Set([28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,53,10752,37,10770]);
  const tvGenres = new Set(TV_GENRES.map(g => g.id));
  const cached = (key, fn) => cache.getOrLoad("suggestions:v2:" + (live() ? "live:" : "demo:") + key, fn, 1000 * 60 * 60 * 12);

  async function titlePool(type, genre, seed) {
    const genreIds = genre === "all" ? [] : genreIdsFor(genre, type).filter(id => (type === "tv" ? tvGenres : movieGenres).has(id));
    if (genre !== "all" && !genreIds.length) return [];
    const params = { include_adult: "false", include_video: "false", language: "en-US",
      sort_by: "popularity.desc", "vote_count.gte": type === "tv" ? "50" : "100",
      [type === "tv" ? "first_air_date.lte" : "primary_release_date.lte"]: new Date().toISOString().slice(0,10) };
    if (genreIds.length) params.with_genres = genreIds.join("|");
    const first = await call("/discover/" + type, { ...params, page: "1" });
    const pages = Math.min(15, Math.max(1, Number(first.total_pages) || 3));
    const indexes = new Set([1]);
    for (let i = 0; indexes.size < Math.min(3, pages); i++) indexes.add(1 + (seed * 2 + i + 1) % pages);
    const rest = await Promise.all([...indexes].filter(p => p !== 1).map(page => call("/discover/" + type, { ...params, page: String(page) })));
    return [first, ...rest].flatMap(page => page.results || []).filter(item => !item.adult).map(item => normalize(item, type)).filter(Boolean);
  }
  async function suggestions({ kind, genre = "all", seed = 0 }) {
    const day = new Date().toISOString().slice(0,10);
    return cached([day,kind,genre,seed].join(":"), async () => {
      if (!["movie","tv","genre"].includes(kind)) {
        const people = [...new Map((await directory(kind)).filter(p => p?.id != null && p.name).map(p => [String(p.id),p])).values()];
        return { kind, items: shuffle(people, day + ":" + seed).slice(0,50), total: people.length };
      }
      const types = kind === "genre" ? ["movie","tv"] : [kind];
      const pools = live() ? await Promise.all(types.map(type => titlePool(type, genre, seed))) : types.map(type => demo(type));
      const candidates = pools.flat().filter(title => genre === "all" || genreIdsFor(genre, title.mediaType || "movie").some(id => (title.genreIds || []).includes(id)));
      const unique = [...new Map(candidates.filter(item => identity(item)).map(item => [identity(item).id, item])).values()];
      return { kind, genre, items: shuffle(unique, day + ":" + seed).slice(0,50), total: unique.length };
    });
  }
  async function featuredCredits({ kind, id, name = "" }) {
    return cached("credits:" + kind + ":" + id, async () => {
      let candidates = [];
      if (!live()) {
        const people = await directory(kind);
        const person = people.find(p => String(p.id) === String(id));
        const needle = (person?.name || name).toLowerCase();
        candidates = [...demo("movie"), ...demo("tv")].filter(title => {
          const names = kind === "actors" ? title.cast : kind === "writers" ? title.writers
            : kind === "directors" ? [title.director] : kind === "producers" ? title.producers : title.studios;
          return needle && (names || []).some(n => n.toLowerCase() === needle);
        });
      } else if (kind === "studios") {
        const studio = await resolveStudio(id, name);
        if (!studio) return { titles: [], scope: "featured" };
        const pages = await Promise.all(["movie","tv"].map(async type => {
          const page = await call("/discover/" + type, { with_companies: String(studio.id), include_adult: "false", sort_by:"vote_count.desc", page:"1" });
          return (page.results || []).filter(t => !t.adult).map(t => normalize(t, type));
        }));
        candidates = pages.flat().filter(Boolean);
      } else {
        const credits = await call("/person/" + id + "/combined_credits", { language:"en-US" });
        candidates = [...(credits.cast || []).filter(c => roleMatches(kind,c,true)),
          ...(credits.crew || []).filter(c => roleMatches(kind,c))]
          .filter(c => !c.adult && ["movie","tv"].includes(c.media_type))
          .map(c => normalize(c, c.media_type)).filter(Boolean);
      }
      const titles = ["movie","tv"].flatMap(type => [...new Map(candidates.filter(t => (t.mediaType || "movie") === type && t.year && t.year <= new Date().getFullYear()).map(t => [t.id,t])).values()]
        .sort((a,b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0,2));
      return { titles, scope: "featured" };
    });
  }
  return { suggestions, featuredCredits };
}
module.exports = { createSuggestionCatalog, roleMatches, shuffle, queue };
