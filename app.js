const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
const decadeOptions = buildDecadeOptions();

const elements = {
  apiStatus: document.querySelector("#api-status"),
  dataSource: document.querySelector("#data-source"),
  personSearch: document.querySelector("#person-search"),
  peopleSuggestions: document.querySelector("#people-suggestions"),
  roleFilter: document.querySelector("#role-filter"),
  roleDescription: document.querySelector("#role-description"),
  imdbMin: document.querySelector("#imdb-min"),
  rtMin: document.querySelector("#rt-min"),
  imdbValue: document.querySelector("#imdb-value"),
  rtValue: document.querySelector("#rt-value"),
  genreFilter: document.querySelector("#genre-filter"),
  decadeFilter: document.querySelector("#decade-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  resetButton: document.querySelector("#reset-button"),
  resultsGrid: document.querySelector("#results-grid"),
  resultsSummary: document.querySelector("#results-summary"),
  movieCount: document.querySelector("#movie-count"),
  peopleCount: document.querySelector("#people-count"),
  watchlistCount: document.querySelector("#watchlist-count"),
  resultsTitle: document.querySelector("#results-title"),
  cardTemplate: document.querySelector("#movie-card-template"),
  personChips: document.querySelector("#person-chips"),
  actorsGrid: document.querySelector("#actors-grid"),
  actorsSummary: document.querySelector("#actors-summary"),
  actorsRefresh: document.querySelector("#actors-refresh"),
  producersSummary: document.querySelector("#producers-summary"),
  producersRefresh: document.querySelector("#producers-refresh"),
  indexStatus: document.querySelector("#index-status"),
  peopleTemplate: document.querySelector("#person-card-template"),
  rotatingPersonTemplate: document.querySelector("#rotating-person-template"),
  rankedPersonTemplate: document.querySelector("#ranked-person-template"),
  watchlistGrid: document.querySelector("#watchlist-grid"),
};

const watchlist = loadWatchlist();
const watchlistMovies = loadWatchlistMovies();
const liveState = {
  genres: [],
  featuredActors: [],
  featuredDirectors: [],
  featuredProducers: [],
  movies: [],
  activeRole: "any",
  imageBaseUrl: "",
  hasOmdb: false,
  lastQueryKey: "",
  requestId: 0,
  enrichRequestId: 0,
  enrichAttempts: new Map(),
  totalMatches: 0,
  refreshTokens: {
    actors: 0,
  },
  renderToken: 0,
};

bootstrap().catch((error) => {
  setStatus(error.message, true);
});

async function bootstrap() {
  setStatus("Connecting to TMDb and OMDb...", false);

  const payload = await fetchJson("/api/bootstrap?mode=lite");
  liveState.genres = payload.genres || [];
  liveState.imageBaseUrl = payload.config?.imageBaseUrl || "";
  liveState.hasOmdb = Boolean(payload.config?.hasOmdb);
  const mode = payload.config?.mode || "live";

  elements.imdbMin.value = "0";
  elements.rtMin.value = "0";

  if (mode === "demo") {
    elements.dataSource.textContent =
      "Demo mode is active because API keys are not configured yet. The layout and filters are fully runnable.";
    elements.movieCount.textContent = "Demo";
  } else {
    elements.dataSource.textContent = payload.config?.hasLocalPeopleIndex
      ? "Movies are live from TMDb with OMDb enrichment, and people directories are served from a local ranked index."
      : liveState.hasOmdb
        ? "Live data from TMDb with OMDb ratings enrichment. Start broad, then tighten with the rating sliders."
        : "Live data from TMDb. Add OMDb to unlock IMDb and Rotten Tomatoes filters.";
    elements.movieCount.textContent = "Live";
  }

  elements.peopleCount.textContent = "0";

  populateGenres();
  populateDecades();
  applyStateFromUrl();
  bindEvents();
  renderActorPreview();
  renderWatchlist();
  renderIdleState();
  const startupTasks = [loadIndexStatus(), loadFeaturedPeople()];
  if (shouldFetchOnLoad()) {
    startupTasks.push(refreshMovies());
  }
  setStatus(mode === "demo" ? "Demo catalog connected." : "Live catalog connected.", false);
  Promise.allSettled(startupTasks);
}

async function loadFeaturedPeople() {
  try {
    const payload = await fetchJson("/api/featured-people");
    liveState.featuredActors = payload.featuredActors || payload.featuredPeople || [];
    liveState.featuredDirectors = payload.featuredDirectors || payload.featuredFilmmakers || [];
    liveState.featuredProducers = payload.featuredProducers || [];

    elements.peopleCount.textContent = String(liveState.featuredActors.length);
    renderActorPreview();
  } catch {
    // Keep page usable even when featured people cannot be loaded.
  }
}

function populateGenres() {
  liveState.genres.forEach((genre) => {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.name;
    elements.genreFilter.append(option);
  });
}

function populateDecades() {
  decadeOptions.forEach((decade) => {
    const option = document.createElement("option");
    option.value = String(decade);
    option.textContent = `${decade}s`;
    elements.decadeFilter.append(option);
  });
}

function bindEvents() {
  const debouncedRefreshMovies = debounce(() => {
    refreshMovies();
  }, 220);

  [elements.genreFilter, elements.decadeFilter].forEach((element) => {
    element.addEventListener("change", refreshMovies);
  });

  [elements.imdbMin, elements.rtMin].forEach((element) => {
    element.addEventListener("input", () => {
      syncRangeLabels();
      debouncedRefreshMovies();
    });
    element.addEventListener("change", refreshMovies);
  });
  elements.sortFilter.addEventListener("change", handleSortChange);

  const debouncedPeopleLookup = debounce(async () => {
    await updatePersonSuggestions();
  }, 300);

  elements.personSearch.addEventListener("input", debouncedPeopleLookup);
  elements.personSearch.addEventListener("change", refreshMovies);
  elements.personSearch.addEventListener("keydown", handlePersonSearchKeydown);

  elements.roleFilter.addEventListener("click", async (event) => {
    const button = event.target.closest(".segment");
    if (!button) {
      return;
    }

    setActiveRole(button.dataset.role);
    await refreshMovies();
  });

  if (elements.actorsGrid) {
    elements.actorsGrid.addEventListener("click", handlePersonSelection);
  }
  if (elements.personChips) {
    elements.personChips.addEventListener("click", handlePersonSelection);
  }
  if (elements.actorsRefresh) {
    elements.actorsRefresh.addEventListener("click", () => refreshRotatingSection("actors"));
  }
  if (elements.producersRefresh) {
    elements.producersRefresh.addEventListener("click", () => refreshRotatingSection("producers"));
  }
  elements.resultsGrid.addEventListener("click", handleWatchlistAction);
  if (elements.watchlistGrid) {
    elements.watchlistGrid.addEventListener("click", handleWatchlistAction);
  }
  elements.resetButton.addEventListener("click", resetFilters);
  window.addEventListener("popstate", handlePopState);
}

async function updatePersonSuggestions() {
  const query = elements.personSearch.value.trim();
  if (query.length < 2) {
    elements.peopleSuggestions.replaceChildren();
    return;
  }

  try {
    const payload = await fetchJson(`/api/people?query=${encodeURIComponent(query)}`);
    elements.peopleSuggestions.replaceChildren();
    (payload.results || []).forEach((person) => {
      const option = document.createElement("option");
      option.value = person.name;
      elements.peopleSuggestions.append(option);
    });
  } catch (error) {
    elements.peopleSuggestions.replaceChildren();
  }
}

async function refreshMovies() {
  const state = getFilterState();
  updateUrlFromState(state);
  const queryKey = buildFetchKey(state);
  const requestId = ++liveState.requestId;

  if (queryKey === liveState.lastQueryKey) {
    return;
  }

  liveState.lastQueryKey = queryKey;
  syncRangeLabels();
  elements.roleDescription.textContent =
    state.role === "any" ? "Any role" : `Only ${state.role} matches`;

  renderLoadingState();

  try {
    const params = new URLSearchParams({
      personQuery: state.personQuery,
      role: state.role,
      genre: state.genre,
      decade: state.decade,
      sort: state.sort,
      imdbMin: String(state.imdbMin),
      rtMin: String(state.rtMin),
    });

    const payload = await fetchJson(`/api/discover?${params.toString()}`);
    if (requestId !== liveState.requestId) {
      return;
    }

    liveState.movies = sortMoviesClient(payload.movies || [], state.sort);
    liveState.totalMatches = payload.totalMatches || liveState.movies.length;
    liveState.enrichAttempts = new Map();
    elements.resultsTitle.textContent = payload.matchedPerson
      ? `Movies connected to "${payload.matchedPerson.name}"`
      : "Movies selected by the people behind them";
    renderMovies(liveState.movies);
    renderWatchlist();
    enrichVisibleMovies(requestId);
  } catch (error) {
    if (requestId !== liveState.requestId) {
      return;
    }

    liveState.movies = [];
    liveState.lastQueryKey = "";
    renderErrorState(error.message);
    setStatus(error.message, true);
  }
}

function syncRangeLabels() {
  elements.imdbValue.textContent = `${Number(elements.imdbMin.value).toFixed(1)}+`;
  elements.rtValue.textContent = `${Number(elements.rtMin.value)}%+`;
}

function renderMovies(movies) {
  liveState.renderToken += 1;
  const renderToken = liveState.renderToken;
  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = `${liveState.totalMatches || movies.length} live movie${
    (liveState.totalMatches || movies.length) === 1 ? "" : "s"
  } match your current filter stack.`;

  if (!movies.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>No live matches.</h3><p>Broaden the rating threshold or switch to a different person search.</p>";
    elements.resultsGrid.append(emptyState);
    return;
  }

  const batchSize = 24;
  let index = 0;

  const renderBatch = () => {
    if (renderToken !== liveState.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + batchSize, movies.length);
    for (let cursor = index; cursor < end; cursor += 1) {
      fragment.append(buildMovieCard(movies[cursor]));
    }
    elements.resultsGrid.append(fragment);
    index = end;

    if (index < movies.length) {
      window.requestAnimationFrame(renderBatch);
    }
  };

  window.requestAnimationFrame(renderBatch);
}

function renderIdleState() {
  liveState.renderToken += 1;
  elements.resultsGrid.replaceChildren();
  elements.resultsTitle.textContent = "Movies selected by the people behind them";
  elements.resultsSummary.textContent = "Start with a person, genre, decade, or rating filter.";
  const idleState = document.createElement("div");
  idleState.className = "empty-state";
  idleState.innerHTML =
    "<h3>Catalog is standing by.</h3><p>Type a person, pick a genre or decade, or move the ratings sliders to fetch live results.</p>";
  elements.resultsGrid.append(idleState);
}

function buildMovieCard(movie) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".movie-card");
  const poster = fragment.querySelector(".movie-poster");
  const posterFrame = fragment.querySelector(".movie-poster-frame");
  const imdbValue = fragment.querySelector(".rating-imdb");
  const rtValue = fragment.querySelector(".rating-rt");
  const metaValue = fragment.querySelector(".rating-meta");
  const tmdbValue = fragment.querySelector(".rating-tmdb");
  const castValue = fragment.querySelector(".cast");
  const directorValue = fragment.querySelector(".director");
  const producerValue = fragment.querySelector(".producer");
  const matchReasonValue = fragment.querySelector(".match-reason");
  const genresValue = fragment.querySelector(".genres");
  article.dataset.movieId = String(movie.id);
  article.classList.toggle("is-loading-card", !movie.isEnriched);
  fragment.querySelector("h3").textContent = movie.title;
  fragment.querySelector(".pill-year").textContent = movie.year || "TBA";
  fragment.querySelector(".pill-runtime").textContent = movie.runtime || "Runtime unknown";
  fragment.querySelector(".logline").textContent = movie.logline;
  setCardField(imdbValue, movie.isEnriched ? formatRating(movie.imdb, 1) : "Loading");
  setCardField(rtValue, movie.isEnriched ? formatPercent(movie.rt) : "Loading");
  setCardField(metaValue, movie.isEnriched ? formatInteger(movie.metacritic) : "Loading");
  setCardField(tmdbValue, formatRating(movie.tmdb, 1), !movie.tmdb);
  setCardField(castValue, movie.isEnriched ? (movie.cast.length ? movie.cast.join(", ") : "Unknown") : "Loading cast");
  setCardField(directorValue, movie.isEnriched ? (movie.director || "Unknown") : "Loading director");
  setCardField(
    producerValue,
    movie.isEnriched ? (movie.producers.length ? movie.producers.join(", ") : "Unknown") : "Loading producers",
  );
  setCardField(matchReasonValue, movie.matchReason || "Loading match reason", !movie.matchReason);
  setCardField(genresValue, movie.isEnriched ? formatGenres(movie) : "Loading genres");

  if (movie.posterUrl) {
    poster.src = movie.posterUrl;
    poster.alt = `${movie.title} poster`;
  } else {
    posterFrame.classList.add("is-empty");
    poster.remove();
    posterFrame.innerHTML = `<span>${movie.title}</span>`;
  }

  const button = fragment.querySelector(".watchlist-button");
  const saved = watchlist.has(movie.id);
  button.dataset.watchlistId = String(movie.id);
  button.textContent = saved ? "Saved to watchlist" : "Save to watchlist";
  button.classList.toggle("is-saved", saved);

  return fragment;
}

function setCardField(element, value, pending = false) {
  element.textContent = value;
  element.classList.toggle("is-pending", Boolean(pending));
}

function renderFeaturedPeople() {
  if (!elements.personChips) {
    return;
  }
  elements.personChips.replaceChildren();
  const picks = pickRotatingPeopleForRole("producers");

  picks.forEach((person, index) => {
    elements.personChips.append(buildRotatingPersonCard(person, index + 1));
  });
  elements.producersSummary.textContent = picks.length
    ? `${picks.length} ${producerLabelForCurrentPool()} shown here. Refresh to reshuffle this set for yourself.`
    : "Producer picks unavailable right now.";
}

function renderActorPreview() {
  const preview = pickTopPeopleForRole("actors", 5);
  elements.actorsGrid.replaceChildren();
  preview.forEach((person, index) => {
    elements.actorsGrid.append(buildRotatingPersonCard(person, index + 1));
  });
  elements.actorsSummary.textContent = preview.length
    ? `${preview.length} top actors shown here.`
    : "Actor preview unavailable right now.";
}

function refreshRotatingSection(role) {
  liveState.refreshTokens[role] = Math.floor(Math.random() * 1000000);
  if (role === "actors") {
    renderActorPreview();
    return;
  }

  if (elements.personChips) {
    renderFeaturedPeople();
  }
}

function pickTopPeopleForRole(role, count) {
  const ranked = [...dedupePeopleById(getRotatingPool(role))].sort(compareDiscoveryPeople);
  return ranked.slice(0, count);
}

function buildRotatingPersonCard(person, rank) {
  const fragment = elements.rotatingPersonTemplate.content.cloneNode(true);
  fragment.querySelector(".spotlight-role").textContent = person.department;
  fragment.querySelector(".spotlight-rank").textContent = `Pick ${rank}`;
  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".spotlight-score").textContent = person.ratingLabel || "Career score unavailable";
  fragment.querySelector(".spotlight-credits").textContent = person.knownFor?.length
    ? person.knownFor.join(", ")
    : "Known-for titles unavailable.";
  fragment.querySelector(".spotlight-button").dataset.person = person.name;
  return fragment;
}

function buildRankedPersonRow(person, rank) {
  const fragment = elements.rankedPersonTemplate.content.cloneNode(true);
  fragment.querySelector(".ranked-person-index").textContent = String(rank).padStart(2, "0");
  fragment.querySelector(".ranked-person-role").textContent = person.department;
  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".ranked-person-credits").textContent = person.knownFor?.length
    ? person.knownFor.join(", ")
    : "Known-for titles unavailable.";
  fragment.querySelector(".ranked-person-score").textContent = person.ratingLabel || "Career score unavailable";
  fragment.querySelector(".ranked-person-button").dataset.person = person.name;
  return fragment;
}

function renderPeopleDirectory(container, people) {
  container.replaceChildren();

  people.forEach((person) => {
    const fragment = elements.peopleTemplate.content.cloneNode(true);
    const portrait = fragment.querySelector(".person-card-portrait");
    const portraitFrame = fragment.querySelector(".person-card-visual");

    fragment.querySelector("h3").textContent = person.name;
    fragment.querySelector(".person-card-role").textContent = person.department;
    fragment.querySelector(".person-card-count").textContent =
      person.ratingLabel || (person.knownFor.length ? `Known for ${person.knownFor.length} titles` : "Known for credits not available");
    fragment.querySelector(".person-card-credits").textContent = person.knownFor.length
      ? person.knownFor.join(", ")
      : "No featured titles returned by TMDb.";
    fragment.querySelector(".person-card-button").dataset.person = person.name;

    if (person.profileUrl) {
      portrait.src = person.profileUrl;
      portrait.alt = person.name;
    } else {
      portraitFrame.classList.add("is-empty");
      portrait.remove();
      portraitFrame.innerHTML = `<span>${person.name}</span>`;
    }

    container.append(fragment);
  });
}

async function loadIndexStatus() {
  if (!liveState.hasOmdb) {
    elements.indexStatus.textContent = "Index status unavailable right now.";
    return;
  }

  if (liveState.hasLocalPeopleIndex) {
    elements.indexStatus.textContent = "Local ranked people index is connected.";
  } else {
    elements.indexStatus.textContent = "People index is syncing.";
    return;
  }

  try {
    const payload = await fetchJsonWithTimeout("/api/index-status", 2500);
    if (!payload.ready) {
      elements.indexStatus.textContent = "People index is syncing.";
      return;
    }

    elements.indexStatus.textContent = `${payload.counts.actors} actors, ${payload.counts.directors} directors, and ${payload.counts.producers} producers are available from the local ranked index${payload.generatedAt ? ` (built ${formatDateTime(payload.generatedAt)})` : ""}.`;
  } catch {
    // Keep the optimistic message when status endpoint is slow/unreachable.
  }
}

function renderWatchlist() {
  if (!elements.watchlistGrid) {
    if (elements.watchlistCount) {
      elements.watchlistCount.textContent = String(watchlist.size);
    }
    return;
  }

  const savedMovies = [...watchlist]
    .map((movieId) => watchlistMovies.get(movieId))
    .filter(Boolean);
  elements.watchlistCount.textContent = String(watchlist.size);
  elements.watchlistGrid.replaceChildren();

  if (!savedMovies.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>Your watchlist is empty.</h3><p>Save live results here and they will stay on this browser.</p>";
    elements.watchlistGrid.append(emptyState);
    return;
  }

  savedMovies.forEach((movie) => {
    elements.watchlistGrid.append(buildMovieCard(movie));
  });
}

async function enrichVisibleMovies(parentRequestId) {
  const ids = liveState.movies
    .filter((movie) => !movie.isEnriched && (liveState.enrichAttempts.get(movie.id) || 0) < 2)
    .map((movie) => movie.id)
    .slice(0, 2);

  if (!ids.length) {
    return;
  }

  const enrichRequestId = ++liveState.enrichRequestId;
  ids.forEach((id) => {
    liveState.enrichAttempts.set(id, (liveState.enrichAttempts.get(id) || 0) + 1);
  });

  try {
    const payload = await fetchJson(`/api/enrich?ids=${ids.join(",")}`);
    if (parentRequestId !== liveState.requestId || enrichRequestId !== liveState.enrichRequestId) {
      return;
    }

    const enrichedById = new Map((payload.movies || []).map((movie) => [movie.id, movie]));
    liveState.movies = liveState.movies.map((movie) => {
      const enriched = enrichedById.get(movie.id);
      if (!enriched) {
        return movie;
      }

      return {
        ...movie,
        ...enriched,
        matchReason: movie.matchReason || enriched.matchReason,
      };
    });
    patchMovieCards(enrichedById);
    syncWatchlistMovieDetails(enrichedById);
    renderWatchlist();
    enrichVisibleMovies(parentRequestId);
  } catch {
    window.setTimeout(() => {
      if (parentRequestId === liveState.requestId) {
        enrichVisibleMovies(parentRequestId);
      }
    }, 400);
  }
}

function patchMovieCards(enrichedById) {
  enrichedById.forEach((movie, id) => {
    const currentCard = elements.resultsGrid.querySelector(`[data-movie-id="${id}"]`);
    if (!currentCard) {
      return;
    }

    const replacement = buildMovieCard(movie).firstElementChild;
    if (!replacement) {
      return;
    }

    currentCard.replaceWith(replacement);
  });
}

function syncWatchlistMovieDetails(enrichedById) {
  let changed = false;
  enrichedById.forEach((movie, id) => {
    if (!watchlistMovies.has(id)) {
      return;
    }

    watchlistMovies.set(id, movie);
    changed = true;
  });

  if (changed) {
    persistWatchlistMovies();
  }
}

function renderLoadingState() {
  liveState.renderToken += 1;
  elements.resultsGrid.replaceChildren();
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.innerHTML = "<h3>Loading live results...</h3><p>Fetching fresh credits and ratings.</p>";
  elements.resultsGrid.append(loadingState);
}

function renderErrorState(message) {
  liveState.renderToken += 1;
  elements.resultsGrid.replaceChildren();
  const errorState = document.createElement("div");
  errorState.className = "empty-state";
  errorState.innerHTML = `<h3>Live fetch failed.</h3><p>${message}</p>`;
  elements.resultsGrid.append(errorState);
}

function handlePersonSelection(event) {
  const button = event.target.closest("[data-person]");
  if (!button) {
    return;
  }

  elements.personSearch.value = button.dataset.person;
  updatePersonSuggestions();
  refreshMovies();
}

function handlePersonSearchKeydown(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  refreshMovies();
}

function handleSortChange() {
  const state = getFilterState();
  updateUrlFromState(state);

  if (!liveState.movies.length) {
    return;
  }

  liveState.movies = sortMoviesClient(liveState.movies, state.sort);
  renderMovies(liveState.movies);
  renderWatchlist();
}

function handleWatchlistAction(event) {
  const button = event.target.closest("[data-watchlist-id]");
  if (!button) {
    return;
  }

  const movieId = Number(button.dataset.watchlistId);
  const movie = [...liveState.movies, ...watchlistMovies.values()].find((entry) => entry.id === movieId);
  if (watchlist.has(movieId)) {
    watchlist.delete(movieId);
    watchlistMovies.delete(movieId);
  } else {
    watchlist.add(movieId);
    if (movie) {
      watchlistMovies.set(movieId, movie);
    }
  }

  persistWatchlist();
  persistWatchlistMovies();
  renderMovies(liveState.movies);
  renderWatchlist();
}

function resetFilters() {
  elements.personSearch.value = "";
  elements.peopleSuggestions.replaceChildren();
  elements.imdbMin.value = "0";
  elements.rtMin.value = "0";
  elements.genreFilter.value = "all";
  elements.decadeFilter.value = "all";
  elements.sortFilter.value = "match";
  setActiveRole("any");
  liveState.totalMatches = 0;
  liveState.lastQueryKey = "";
  updateUrlFromState(getFilterState());
  renderIdleState();
}

function setActiveRole(role) {
  liveState.activeRole = role;
  elements.roleFilter.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.role === role);
  });
}

function getFilterState() {
  return {
    personQuery: elements.personSearch.value.trim(),
    role: liveState.activeRole,
    imdbMin: Number(elements.imdbMin.value),
    rtMin: Number(elements.rtMin.value),
    genre: elements.genreFilter.value,
    decade: elements.decadeFilter.value,
    sort: elements.sortFilter.value,
  };
}

function buildFetchKey(state) {
  return JSON.stringify({
    personQuery: state.personQuery,
    role: state.role,
    imdbMin: state.imdbMin,
    rtMin: state.rtMin,
    genre: state.genre,
    decade: state.decade,
  });
}

function applyStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const personQuery = params.get("person") || "";
  const role = params.get("role") || "any";
  const genre = params.get("genre") || "all";
  const decade = params.get("decade") || "all";
  const sort = params.get("sort") || "match";
  const imdbMin = params.get("imdbMin");
  const rtMin = params.get("rtMin");

  elements.personSearch.value = personQuery;
  elements.genreFilter.value = genre;
  elements.decadeFilter.value = decade;
  elements.sortFilter.value = sort;
  if (imdbMin !== null) {
    elements.imdbMin.value = imdbMin;
  }
  if (rtMin !== null) {
    elements.rtMin.value = rtMin;
  }
  setActiveRole(role);
  elements.imdbValue.textContent = `${Number(elements.imdbMin.value).toFixed(1)}+`;
  elements.rtValue.textContent = `${Number(elements.rtMin.value)}%+`;
}

function updateUrlFromState(state) {
  const params = new URLSearchParams();

  if (state.personQuery) {
    params.set("person", state.personQuery);
  }
  if (state.role !== "any") {
    params.set("role", state.role);
  }
  if (state.genre !== "all") {
    params.set("genre", state.genre);
  }
  if (state.decade !== "all") {
    params.set("decade", state.decade);
  }
  if (state.sort !== "match") {
    params.set("sort", state.sort);
  }
  if (state.imdbMin > 0) {
    params.set("imdbMin", String(state.imdbMin));
  }
  if (state.rtMin > 0) {
    params.set("rtMin", String(state.rtMin));
  }

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function shouldFetchOnLoad() {
  return new URLSearchParams(window.location.search).toString().length > 0;
}

function handlePopState() {
  liveState.lastQueryKey = "";
  applyStateFromUrl();
  if (liveState.movies.length) {
    liveState.movies = sortMoviesClient(liveState.movies, elements.sortFilter.value);
  }
  if (shouldFetchOnLoad()) {
    refreshMovies();
    return;
  }

  renderIdleState();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.trim().slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`Unexpected non-JSON response (${response.status}) from ${url}: ${snippet}`);
  }

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Request failed");
  }

  return payload;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function setStatus(message, isError) {
  elements.apiStatus.textContent = message;
  elements.apiStatus.classList.toggle("is-error", Boolean(isError));
}

function formatRating(value, decimals) {
  return value === null || value === undefined ? "N/A" : Number(value).toFixed(decimals);
}

function formatPercent(value) {
  return value === null || value === undefined ? "N/A" : `${Math.round(value)}%`;
}

function formatInteger(value) {
  return value === null || value === undefined ? "N/A" : String(Math.round(value));
}

function formatGenres(movie) {
  if (movie.genres && movie.genres.length) {
    return movie.genres.join(" / ");
  }

  if (movie.genreIds && movie.genreIds.length) {
    const names = movie.genreIds
      .map((genreId) => liveState.genres.find((genre) => genre.id === genreId)?.name)
      .filter(Boolean);
    return names.length ? names.join(" / ") : "Unknown";
  }

  return "Unknown";
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function filterPeopleDirectory(people, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
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
    switch (sort) {
      case "name":
        return left.name.localeCompare(right.name);
      case "popularity":
        return (right.popularity ?? -1) - (left.popularity ?? -1) || left.name.localeCompare(right.name);
      case "score":
      default:
        return (right.score ?? -1) - (left.score ?? -1) || left.name.localeCompare(right.name);
    }
  });
  return sorted;
}

function pickRotatingPeopleForRole(role) {
  const people = getRotatingPool(role);
  const count = 5;
  return pickFromRolePool(people, count, `${role}:${getDailySeed()}:${liveState.refreshTokens[role]}`);
}

function getRotatingPool(role) {
  if (role === "actors") {
    return liveState.featuredActors;
  }

  if (liveState.featuredProducers.length >= 8) {
    return liveState.featuredProducers;
  }

  if (liveState.featuredProducers.length) {
    return dedupePeopleById([
      ...liveState.featuredProducers,
      ...liveState.featuredDirectors,
    ]);
  }

  return liveState.featuredDirectors;
}

function producerLabelForCurrentPool() {
  if (liveState.featuredProducers.length >= 8) {
    return "producers";
  }

  if (liveState.featuredProducers.length) {
    return "producers with director backups";
  }

  return "director fallback picks";
}

function pickFromRolePool(people, count, seedKey) {
  const ranked = [...dedupePeopleById(people)].sort(compareDiscoveryPeople);
  if (ranked.length <= count) {
    return shufflePeople(ranked, seedKey).slice(0, count);
  }

  const candidateWindow = ranked.slice(0, Math.min(ranked.length, 30));
  const start = seededIndex(seedKey, candidateWindow.length);
  const picks = [];

  for (let offset = 0; picks.length < count && offset < candidateWindow.length; offset += 1) {
    picks.push(candidateWindow[(start + offset * 7) % candidateWindow.length]);
  }

  return dedupePeopleById(picks);
}

function shufflePeople(people, seedKey) {
  return [...people].sort((left, right) => {
    const leftHash = hashString(`${seedKey}:${left.id}`);
    const rightHash = hashString(`${seedKey}:${right.id}`);
    if (leftHash !== rightHash) {
      return leftHash - rightHash;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function dedupePeopleById(people) {
  const byId = new Map();
  people.forEach((person) => {
    if (!person || byId.has(person.id)) {
      return;
    }
    byId.set(person.id, person);
  });
  return [...byId.values()];
}

function getDailySeed() {
  return hashString(new Date().toISOString().slice(0, 10));
}

function compareDiscoveryPeople(left, right) {
  const leftScore = discoveryScore(left);
  const rightScore = discoveryScore(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return String(left.name || "").localeCompare(String(right.name || ""));
}

function discoveryScore(person) {
  const score = Number(person.score ?? 0);
  const popularity = Number(person.popularity ?? 0);
  return score * 0.8 + Math.log10(popularity + 10) * 0.7 - popularity * 0.003;
}

function seededIndex(seedKey, size) {
  if (size <= 1) {
    return 0;
  }
  return hashString(`${seedKey}:${new Date().toISOString().slice(0, 10)}`) % size;
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortMoviesClient(movies, sortBy) {
  const sorted = [...movies];
  sorted.sort((left, right) => compareMovies(left, right, sortBy));
  return sorted;
}

function compareMovies(left, right, sortBy) {
  switch (sortBy) {
    case "imdb":
      return compareNumber(right.imdb ?? right.tmdb, left.imdb ?? left.tmdb, right, left);
    case "rt":
      return compareNumber(right.rt ?? right.imdb ?? right.tmdb, left.rt ?? left.imdb ?? left.tmdb, right, left);
    case "year-asc":
      return compareNumber(left.year, right.year, left, right);
    case "year-desc":
      return compareNumber(right.year, left.year, right, left);
    case "match":
    default:
      return compareNumber(
        right.imdb ?? right.rt ?? right.tmdb ?? right.year,
        left.imdb ?? left.rt ?? left.tmdb ?? left.year,
        right,
        left
      );
  }
}

function compareNumber(primaryLeft, primaryRight, left, right) {
  const leftValue = Number.isFinite(Number(primaryLeft)) ? Number(primaryLeft) : -1;
  const rightValue = Number.isFinite(Number(primaryRight)) ? Number(primaryRight) : -1;
  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  const leftYear = Number.isFinite(Number(left.year)) ? Number(left.year) : -1;
  const rightYear = Number.isFinite(Number(right.year)) ? Number(right.year) : -1;
  if (leftYear !== rightYear) {
    return rightYear - leftYear;
  }

  return String(left.title || "").localeCompare(String(right.title || ""));
}

function loadWatchlist() {
  try {
    const raw = window.localStorage.getItem(watchlistStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(parsed.filter((value) => Number.isFinite(value)));
  } catch {
    return new Set();
  }
}

function persistWatchlist() {
  window.localStorage.setItem(watchlistStorageKey, JSON.stringify([...watchlist]));
}

function loadWatchlistMovies() {
  try {
    const raw = window.localStorage.getItem(watchlistMoviesStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Map(parsed.map((movie) => [movie.id, movie]));
  } catch {
    return new Map();
  }
}

function persistWatchlistMovies() {
  window.localStorage.setItem(
    watchlistMoviesStorageKey,
    JSON.stringify([...watchlistMovies.values()]),
  );
}

function debounce(callback, delayMs) {
  let timeoutId = 0;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  };
}

function buildDecadeOptions() {
  const currentYear = new Date().getFullYear();
  const currentDecade = Math.floor(currentYear / 10) * 10;
  const decades = [];

  for (let decade = currentDecade; decade >= 1950; decade -= 10) {
    decades.push(decade);
  }

  return decades;
}
