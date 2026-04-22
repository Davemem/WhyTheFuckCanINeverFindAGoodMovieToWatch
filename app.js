const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
const savedPeopleStorageKey = "wtfcineverfind-saved-people";
const devStatusFlagKey = "wtfcineverfind-debug";
const refreshHistoryStorageKey = "wtfcineverfind-refresh-history";
const decadeOptions = buildDecadeOptions();
const studioPlaceholderPool = [
  "A24",
  "Warner Bros.",
  "Searchlight Pictures",
  "Blumhouse Productions",
  "Paramount Pictures",
];

const elements = {
  apiStatus: document.querySelector("#api-status"),
  dataSource: document.querySelector("#data-source"),
  personSearch: document.querySelector("#person-search"),
  searchLabel: document.querySelector("#search-label"),
  searchType: document.querySelector("#search-type"),
  awardFilter: document.querySelector("#award-filter"),
  peopleSuggestions: document.querySelector("#people-suggestions"),
  movieFilterGroup: document.querySelector("#movie-filter-group"),
  movieFilterHelper: document.querySelector("#movie-filter-helper"),
  roleField: document.querySelector("#role-field"),
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
  resultsSection: document.querySelector("#results-section"),
  resultsBack: document.querySelector("#results-back"),
  resultsSummary: document.querySelector("#results-summary"),
  resultsPagination: document.querySelector("#results-pagination"),
  resultsPaginationSummary: document.querySelector("#results-pagination-summary"),
  resultsLoadMore: document.querySelector("#results-load-more"),
  movieCount: document.querySelector("#movie-count"),
  peopleCount: document.querySelector("#people-count"),
  watchlistCount: document.querySelector("#watchlist-count"),
  resultsTitle: document.querySelector("#results-title"),
  cardTemplate: document.querySelector("#movie-card-template"),
  actorsGrid: document.querySelector("#actors-grid"),
  actorsSummary: document.querySelector("#actors-summary"),
  actorsRefresh: document.querySelector("#actors-refresh"),
  writersGrid: document.querySelector("#writers-grid"),
  writersSummary: document.querySelector("#writers-summary"),
  writersRefresh: document.querySelector("#writers-refresh"),
  directorsGrid: document.querySelector("#directors-grid"),
  directorsSummary: document.querySelector("#directors-summary"),
  directorsRefresh: document.querySelector("#directors-refresh"),
  producersGrid: document.querySelector("#producers-grid"),
  producersSummary: document.querySelector("#producers-summary"),
  producersRefresh: document.querySelector("#producers-refresh"),
  studiosGrid: document.querySelector("#studios-grid"),
  studiosSummary: document.querySelector("#studios-summary"),
  studiosRefresh: document.querySelector("#studios-refresh"),
  indexStatus: document.querySelector("#index-status"),
  peopleTemplate: document.querySelector("#person-card-template"),
  rotatingPersonTemplate: document.querySelector("#rotating-person-template"),
  rankedPersonTemplate: document.querySelector("#ranked-person-template"),
  watchlistGrid: document.querySelector("#watchlist-grid"),
  suggestedPanels: document.querySelector("#suggested-panels"),
};

const savedDataClient = window.savedDataClient || null;
const watchlist = new Set();
const watchlistMovies = new Map();
const savedPeople = new Map();
let debouncedMovieRefresh = null;
const entityPageCache = new Map();
let savedStateSource = "local";
let savedStateError = "";
let bootstrapComplete = false;
const liveState = {
  genres: [],
  featuredActors: [],
  featuredWriters: [],
  featuredDirectors: [],
  featuredProducers: [],
  featuredStudios: [],
  movies: [],
  entities: [],
  entitySearch: {
    query: "",
    searchType: "person",
    page: 1,
    limit: 25,
    total: 0,
    hasMore: false,
    isLoadingMore: false,
  },
  activeRole: "any",
  exactMatch: false,
  imageBaseUrl: "",
  hasOmdb: false,
  lastQueryKey: "",
  requestId: 0,
  enrichRequestId: 0,
  enrichAttempts: new Map(),
  totalMatches: 0,
  placeholderPools: null,
  refreshTokens: {
    actors: 0,
    writers: 0,
    directors: 0,
    producers: 0,
    studios: 0,
  },
  renderToken: 0,
};

if (savedDataClient) {
  savedDataClient.subscribe(handleSavedDataUpdate);
} else {
  syncSavedCollections({
    watchlistIds: [...loadWatchlist()],
    watchlistMovies: [...loadWatchlistMovies().values()],
    savedPeople: [...loadSavedPeople().values()],
    source: "local",
    error: "",
  });
}

bootstrap().catch((error) => {
  setStatus(error.message, true);
});

async function bootstrap() {
  applyDevStatusVisibility();
  setStatus("Connecting to TMDb and OMDb...", false);

  const payload = await fetchJson("/api/bootstrap?mode=lite");
  liveState.genres = payload.genres || [];
  liveState.imageBaseUrl = payload.config?.imageBaseUrl || "";
  liveState.hasOmdb = Boolean(payload.config?.hasOmdb);
  liveState.hasLocalPeopleIndex = Boolean(payload.config?.hasLocalPeopleIndex);
  liveState.placeholderPools = payload.config?.placeholderPools || null;
  liveState.featuredActors = payload.featuredActors || [];
  liveState.featuredWriters = payload.featuredWriters || [];
  liveState.featuredDirectors = payload.featuredDirectors || [];
  liveState.featuredProducers = payload.featuredProducers || [];
  liveState.featuredStudios = payload.featuredStudios || [];
  const mode = payload.config?.mode || "live";
  const peopleCounts = payload.config?.peopleCounts || { actors: 0, directors: 0, producers: 0, writers: 0 };
  const totalPeopleCount =
    Number(peopleCounts.actors || 0)
    + Number(peopleCounts.directors || 0)
    + Number(peopleCounts.producers || 0)
    + Number(peopleCounts.writers || 0);

  elements.imdbMin.value = "0";
  elements.rtMin.value = "0";

  if (mode === "demo") {
    elements.dataSource.textContent =
      "Demo mode is active because API keys are not configured yet. The layout and filters are fully runnable.";
    elements.movieCount.textContent = "Demo";
  } else {
    if (liveState.hasOmdb) {
      elements.dataSource.innerHTML =
        'Movies are sourced live from <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDb</a> with <a href="https://www.omdbapi.com/" target="_blank" rel="noreferrer">OMDb</a>.';
    } else {
      elements.dataSource.innerHTML =
        'Movies are sourced live from <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDb</a>. Add <a href="https://www.omdbapi.com/" target="_blank" rel="noreferrer">OMDb</a> to unlock IMDb, Rotten Tomatoes, and award filters.';
    }
    elements.movieCount.textContent = "Live";
  }

  elements.peopleCount.textContent = String(totalPeopleCount || liveState.featuredActors.length || 0);

  populateGenres();
  populateDecades();
  applyStateFromUrl();
  syncSearchModeUi();
  syncMovieFilterState();
  bindEvents();
  renderActorPreview();
  renderRolePreview("writers");
  renderRolePreview("directors");
  renderRolePreview("producers");
  renderRolePreview("studios");
  renderWatchlist();
  renderIdleState();
  const startupTasks = [];
  if (!liveState.featuredActors.length || liveState.featuredActors.length <= 10) {
    startupTasks.push(loadFeaturedPeople());
  }
  startupTasks.push(loadIndexStatus(payload.config));
  if (shouldFetchOnLoad()) {
    startupTasks.push(refreshMovies());
  }
  bootstrapComplete = true;
  renderWatchlist();
  syncRenderedSavedPeopleButtons();
  setStatus(mode === "demo" ? "Demo catalog connected." : "Live catalog connected.", false);
  Promise.allSettled(startupTasks);
}

async function loadFeaturedPeople() {
  try {
    const payload = await fetchJson("/api/featured-people");
    liveState.featuredActors = payload.featuredActors || payload.featuredPeople || [];
    liveState.featuredWriters = payload.featuredWriters || [];
    liveState.featuredDirectors = payload.featuredDirectors || payload.featuredFilmmakers || [];
    liveState.featuredProducers = payload.featuredProducers || [];
    liveState.featuredStudios = payload.featuredStudios || [];

    if (!Number(elements.peopleCount.textContent || "0")) {
      elements.peopleCount.textContent = String(
        dedupePeopleById([
          ...liveState.featuredActors,
          ...liveState.featuredWriters,
          ...liveState.featuredDirectors,
          ...liveState.featuredProducers,
          ...liveState.featuredStudios,
        ]).length,
      );
    }
    renderActorPreview();
    renderRolePreview("writers");
    renderRolePreview("directors");
    renderRolePreview("producers");
    renderRolePreview("studios");
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
  debouncedMovieRefresh = debounce(() => {
    refreshMovies();
  }, 220);

  [elements.genreFilter, elements.decadeFilter].forEach((element) => {
    if (element) {
      element.addEventListener("change", refreshMovies);
    }
  });

  [elements.imdbMin, elements.rtMin].forEach((element) => {
    if (element) {
      element.addEventListener("input", () => {
        syncRangeLabels();
        handleMovieFilterIntent({ debounced: true });
      });
      element.addEventListener("change", () => handleMovieFilterIntent());
    }
  });
  if (elements.sortFilter) {
    elements.sortFilter.addEventListener("change", () => handleMovieFilterIntent({ sortOnly: true }));
  }
  if (elements.searchType) {
    elements.searchType.addEventListener("change", () => {
      syncSearchModeUi();
      elements.peopleSuggestions.replaceChildren();
      refreshMovies();
    });
  }
  if (elements.awardFilter) {
    elements.awardFilter.addEventListener("change", () => handleMovieFilterIntent());
  }

  const debouncedPeopleLookup = debounce(async () => {
    await updatePersonSuggestions();
  }, 300);

  if (elements.personSearch) {
    elements.personSearch.addEventListener("input", debouncedPeopleLookup);
    elements.personSearch.addEventListener("input", () => {
      liveState.exactMatch = false;
      syncMovieFilterState();
    });
    elements.personSearch.addEventListener("change", refreshMovies);
    elements.personSearch.addEventListener("keydown", handlePersonSearchKeydown);
  }

  if (elements.roleFilter) {
    elements.roleFilter.addEventListener("click", async (event) => {
      const button = event.target.closest(".segment");
      if (!button) {
        return;
      }

      setActiveRole(button.dataset.role);
      await handleMovieFilterIntent();
    });
  }

  if (elements.actorsGrid) {
    elements.actorsGrid.addEventListener("click", handlePersonSelection);
  }
  [elements.writersGrid, elements.directorsGrid, elements.producersGrid, elements.studiosGrid].forEach((grid) => {
    grid?.addEventListener("click", handlePersonSelection);
  });
  if (elements.actorsRefresh) {
    elements.actorsRefresh.addEventListener("click", () => refreshRotatingSection("actors"));
  }
  if (elements.writersRefresh) {
    elements.writersRefresh.addEventListener("click", () => refreshRotatingSection("writers"));
  }
  if (elements.directorsRefresh) {
    elements.directorsRefresh.addEventListener("click", () => refreshRotatingSection("directors"));
  }
  if (elements.producersRefresh) {
    elements.producersRefresh.addEventListener("click", () => refreshRotatingSection("producers"));
  }
  if (elements.studiosRefresh) {
    elements.studiosRefresh.addEventListener("click", () => refreshRotatingSection("studios"));
  }
  if (elements.resultsGrid) {
    elements.resultsGrid.addEventListener("click", handlePersonSelection);
    elements.resultsGrid.addEventListener("click", handleWatchlistAction);
  }
  if (elements.watchlistGrid) {
    elements.watchlistGrid.addEventListener("click", handleWatchlistAction);
  }
  if (elements.resetButton) {
    elements.resetButton.addEventListener("click", resetFilters);
  }
  if (elements.resultsBack) {
    elements.resultsBack.addEventListener("click", resetFilters);
  }
  if (elements.resultsLoadMore) {
    elements.resultsLoadMore.addEventListener("click", loadMoreEntityResults);
  }
  window.addEventListener("popstate", handlePopState);
}

async function handleMovieFilterIntent(options = {}) {
  syncMovieFilterState();
  if (isEntitySelectionMode()) {
    updateUrlFromState(getFilterState());
    return;
  }

  if (options.sortOnly) {
    handleSortChange();
    return;
  }

  if (options.debounced) {
    debouncedMovieRefresh?.();
    return;
  }

  await refreshMovies();
}

async function updatePersonSuggestions() {
  const query = elements.personSearch.value.trim();
  if (query.length < 2) {
    elements.peopleSuggestions.replaceChildren();
    return;
  }

  try {
    const endpoint = currentSearchType() === "studio" ? "/api/studios" : "/api/people";
    const payload = await fetchJson(`${endpoint}?query=${encodeURIComponent(query)}`);
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
  syncMovieFilterState(state);
  elements.roleDescription.textContent =
    state.searchType === "studio"
      ? "Studios ignore role matching"
      : state.role === "any"
        ? "Any role"
        : `Only ${state.role} matches`;

  renderLoadingState();

  try {
    if (state.personQuery && !state.exactMatch) {
      const payload = await fetchEntityPage({
        query: state.personQuery,
        searchType: state.searchType,
        page: 1,
      });
      if (requestId !== liveState.requestId) {
        return;
      }

      liveState.entities = payload.results || [];
      liveState.movies = [];
      liveState.totalMatches = payload.total || liveState.entities.length;
      liveState.entitySearch = {
        query: state.personQuery,
        searchType: state.searchType,
        page: payload.page || 1,
        limit: payload.limit || liveState.entitySearch.limit,
        total: payload.total || liveState.entities.length,
        hasMore: Boolean(payload.hasMore),
        isLoadingMore: false,
      };
      elements.resultsTitle.textContent =
        state.searchType === "studio"
          ? `Studios matching "${state.personQuery}"`
          : `People matching "${state.personQuery}"`;
      renderEntityResults(liveState.entities, state.searchType);
      prefetchNextEntityPage();
      renderWatchlist();
      return;
    }

    const params = new URLSearchParams({
      query: state.personQuery,
      searchType: state.searchType,
      exactMatch: state.exactMatch ? "1" : "0",
      role: state.role,
      genre: state.genre,
      decade: state.decade,
      sort: state.sort,
      imdbMin: String(state.imdbMin),
      rtMin: String(state.rtMin),
      award: state.award,
    });

    const payload = await fetchJson(`/api/discover?${params.toString()}`);
    if (requestId !== liveState.requestId) {
      return;
    }

    liveState.movies = sortMoviesClient(payload.movies || [], state.sort);
    liveState.entities = [];
    resetEntityPagination();
    liveState.totalMatches = payload.totalMatches || liveState.movies.length;
    liveState.enrichAttempts = new Map();
    elements.resultsTitle.textContent = buildResultsTitle(payload);
    renderMovies(liveState.movies);
    renderWatchlist();
    enrichVisibleMovies(requestId);
  } catch (error) {
    if (requestId !== liveState.requestId) {
      return;
    }

    liveState.movies = [];
    liveState.lastQueryKey = "";
    resetEntityPagination();
    renderErrorState(error.message);
    setStatus(error.message, true);
  }
}

async function loadMoreEntityResults() {
  const state = getFilterState();
  const entityState = liveState.entitySearch;
  if (!state.personQuery || state.exactMatch || !entityState.hasMore || entityState.isLoadingMore) {
    return;
  }

  liveState.entitySearch = {
    ...entityState,
    isLoadingMore: true,
  };
  syncResultsPagination();

  try {
    const payload = await fetchEntityPage({
      query: state.personQuery,
      searchType: state.searchType,
      page: entityState.page + 1,
      limit: entityState.limit,
    });
    if (state.personQuery !== getFilterState().personQuery || state.searchType !== getFilterState().searchType || liveState.exactMatch) {
      return;
    }

    liveState.entities = dedupePeopleById([
      ...liveState.entities,
      ...(payload.results || []),
    ]);
    liveState.totalMatches = payload.total || liveState.entities.length;
    liveState.entitySearch = {
      ...liveState.entitySearch,
      page: payload.page || entityState.page + 1,
      limit: payload.limit || entityState.limit,
      total: payload.total || liveState.entities.length,
      hasMore: Boolean(payload.hasMore),
      isLoadingMore: false,
    };
    renderEntityResults(liveState.entities, state.searchType);
    syncRenderedSavedPeopleButtons();
    prefetchNextEntityPage();
  } catch (error) {
    liveState.entitySearch = {
      ...liveState.entitySearch,
      isLoadingMore: false,
    };
    syncResultsPagination();
    setStatus(error.message, true);
  }
}

async function fetchEntityPage({ query, searchType, page, limit = liveState.entitySearch.limit || 25 }) {
  const cacheKey = `${searchType}:${query.toLowerCase()}:${page}:${limit}`;
  if (entityPageCache.has(cacheKey)) {
    return entityPageCache.get(cacheKey);
  }
  const endpoint = searchType === "studio" ? "/api/studios" : "/api/people";
  const params = new URLSearchParams({
    query,
  });
  if (searchType !== "studio") {
    params.set("page", String(page));
    params.set("limit", String(limit));
  }
  const payload = await fetchJson(`${endpoint}?${params.toString()}`);
  const result = {
    results: payload.results || [],
    total: payload.total || (payload.results || []).length,
    page: payload.page || page,
    limit: payload.limit || limit,
    hasMore: Boolean(payload.hasMore),
  };
  entityPageCache.set(cacheKey, result);
  return result;
}

async function prefetchNextEntityPage() {
  const entityState = liveState.entitySearch;
  if (entityState.searchType !== "person" || !entityState.hasMore || entityState.isLoadingMore) {
    return;
  }

  const nextPage = entityState.page + 1;
  const cacheKey = `${entityState.searchType}:${entityState.query.toLowerCase()}:${nextPage}:${entityState.limit}`;
  if (entityPageCache.has(cacheKey)) {
    return;
  }

  try {
    await fetchEntityPage({
      query: entityState.query,
      searchType: entityState.searchType,
      page: nextPage,
      limit: entityState.limit,
    });
  } catch {
    // Keep prefetch failures silent.
  }
}

function syncRangeLabels() {
  elements.imdbValue.textContent = `${Number(elements.imdbMin.value).toFixed(1)}+`;
  elements.rtValue.textContent = `${Number(elements.rtMin.value)}%+`;
}

function renderMovies(movies) {
  liveState.renderToken += 1;
  const renderToken = liveState.renderToken;
  resetEntityPagination();
  window.MovieResults.renderMovieCards({
    container: elements.resultsGrid,
    movies,
    totalMatches: liveState.totalMatches || movies.length,
    summaryElement: elements.resultsSummary,
    summaryText: `${liveState.totalMatches || movies.length} live movie${
      (liveState.totalMatches || movies.length) === 1 ? "" : "s"
    } match your current filter stack.`,
    emptyTitle: "No live matches.",
    emptyMessage: "Broaden the filters or switch to a different person, studio, or award search.",
    buildCard: buildMovieCard,
    batchSize: 24,
    setSearchMode,
    isCurrentRender: () => renderToken === liveState.renderToken,
  });
}

function renderEntityResults(entities, searchType) {
  liveState.renderToken += 1;
  setSearchMode(true);
  elements.resultsGrid.replaceChildren();
  const total = liveState.entitySearch.total || entities.length;
  const selectionPrompt = searchType === "studio"
    ? "Choose a studio to apply the movie filters below."
    : "Choose a person to apply the movie filters below.";
  elements.resultsSummary.textContent = searchType === "studio"
    ? `${entities.length} of ${total} studios matched your search. ${selectionPrompt}`
    : `${entities.length} of ${total} people matched your search. ${selectionPrompt}`;

  if (!entities.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      `<h3>No ${searchType === "studio" ? "studios" : "people"} matched.</h3><p>Try a broader search or a different name.</p>`;
    elements.resultsGrid.append(emptyState);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "people-grid";
  entities.forEach((entity) => {
    grid.append(buildDirectoryPersonCard(entity, searchType === "studio" ? "Show studio movies" : "Show matching movies"));
  });
  elements.resultsGrid.append(grid);
  syncResultsPagination();
}

function renderIdleState() {
  liveState.renderToken += 1;
  setSearchMode(false);
  resetEntityPagination();
  elements.resultsGrid.replaceChildren();
  elements.resultsTitle.textContent = "Movies selected by the people behind them";
  elements.resultsSummary.textContent = "Start with a person, studio, award, genre, decade, or rating filter.";
  syncMovieFilterState();
}

function resetEntityPagination() {
  liveState.entitySearch = {
    ...liveState.entitySearch,
    query: "",
    searchType: "person",
    page: 1,
    total: 0,
    hasMore: false,
    isLoadingMore: false,
  };
  syncResultsPagination();
}

function syncResultsPagination() {
  if (!elements.resultsPagination || !elements.resultsPaginationSummary || !elements.resultsLoadMore) {
    return;
  }

  const entityState = liveState.entitySearch;
  const shouldShow = Boolean(entityState.query) && entityState.searchType === "person" && (entityState.hasMore || entityState.total > 0);
  elements.resultsPagination.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  elements.resultsPaginationSummary.textContent = `${liveState.entities.length} of ${entityState.total} people shown.`;
  elements.resultsLoadMore.hidden = !entityState.hasMore;
  elements.resultsLoadMore.disabled = entityState.isLoadingMore;
  elements.resultsLoadMore.textContent = entityState.isLoadingMore ? "Loading more..." : "Load more people";
}

function buildMovieCard(movie) {
  return window.MovieResults.buildMovieCard(elements.cardTemplate, movie, {
    progressive: true,
    defaultLogline: "Live discovery result.",
    defaultMatchReason: "Loading match reason",
    savedButtonLabel: watchlist.has(movie.id) ? "Saved to watchlist" : "Save to watchlist",
    isSaved: watchlist.has(movie.id),
  });
}

function renderRolePreview(role) {
  const config = {
    writers: { grid: elements.writersGrid, summary: elements.writersSummary, label: "writers" },
    directors: { grid: elements.directorsGrid, summary: elements.directorsSummary, label: "directors" },
    producers: { grid: elements.producersGrid, summary: elements.producersSummary, label: "producers" },
    studios: { grid: elements.studiosGrid, summary: elements.studiosSummary, label: "studios" },
  }[role];
  if (!config?.grid || !config.summary) {
    return;
  }
  config.grid.replaceChildren();
  const picks = pickRotatingPeopleForRole(role);

  picks.forEach((person, index) => {
    config.grid.append(buildRotatingPersonCard(person, index + 1));
  });
  config.summary.textContent = picks.length
    ? `${picks.length} ${config.label} shown here. Refresh to reshuffle this set for yourself.`
    : `${config.label.charAt(0).toUpperCase() + config.label.slice(1)} preview unavailable right now.`;
}

function renderActorPreview() {
  if (!elements.actorsGrid || !elements.actorsSummary) {
    return;
  }

  const preview = pickRotatingPeopleForRole("actors", 10);
  elements.actorsGrid.replaceChildren();
  preview.forEach((person, index) => {
    elements.actorsGrid.append(buildRotatingPersonCard(person, index + 1));
  });
  elements.actorsSummary.textContent = preview.length
    ? `${preview.length} actors shown here. Refresh to reshuffle this set for yourself.`
    : "Actor preview unavailable right now.";
}

function applyDevStatusVisibility() {
  const showDevStatus =
    new URLSearchParams(window.location.search).get("debug") === "1" ||
    window.localStorage.getItem(devStatusFlagKey) === "1";

  [elements.apiStatus, elements.indexStatus].forEach((element) => {
    const strip = element?.closest(".status-strip");
    if (!strip) {
      return;
    }
    strip.hidden = !showDevStatus;
  });
}

function applyRandomPlaceholder(input, pools) {
  if (!input || !pools) {
    return;
  }

  const profile = input.dataset.placeholderProfile || "mixed";
  const parts =
    profile === "producer"
      ? [
          pickRandomName(pools.producers, `producer-a:${window.location.pathname}`),
          pickRandomName(pools.writers, `writer:${window.location.pathname}`),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ]
      : [
          pickRandomName(pools.actors, `actor:${window.location.pathname}`),
          pickRandomName(pools.writers, `writer:${window.location.pathname}`),
          pickRandomName(pools.producers, `producer:${window.location.pathname}`),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ];

  const names = parts.filter(Boolean);
  if (names.length) {
    input.placeholder = `Try: ${names.join(", ")}`;
  }
}

function applyStudioPlaceholder(input) {
  if (!input) {
    return;
  }

  const picks = [
    pickRandomName(studioPlaceholderPool, `studio-a:${window.location.pathname}`),
    pickRandomName(studioPlaceholderPool, `studio-b:${window.location.pathname}`, 1),
    pickRandomName(studioPlaceholderPool, `studio-c:${window.location.pathname}`, 2),
  ].filter(Boolean);

  if (picks.length) {
    input.placeholder = `Try: ${picks.join(", ")}`;
  }
}

function pickRandomName(list, key, salt = 0) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }

  const seed = `${new Date().toISOString().slice(0, 10)}:${key}:${salt}`;
  const start = hashString(seed) % Math.min(list.length, 500);
  return list[start] || list[0] || "";
}

function refreshRotatingSection(role) {
  liveState.refreshTokens[role] = Math.floor(Math.random() * 1000000);
  if (role === "actors") {
    renderActorPreview();
    return;
  }
  renderRolePreview(role);
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
  applyPersonActionButtons(fragment, person, "Show matching movies");
  return fragment;
}

function buildDirectoryPersonCard(person, openLabel = "Show matching movies") {
  const fragment = elements.peopleTemplate.content.cloneNode(true);
  const portrait = fragment.querySelector(".person-card-portrait");
  const portraitFrame = fragment.querySelector(".person-card-visual");

  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".person-card-role").textContent = person.department;
  fragment.querySelector(".person-card-count").textContent =
    person.ratingLabel || (person.knownFor?.length ? `Known for ${person.knownFor.length} titles` : "Known for credits not available");
  fragment.querySelector(".person-card-credits").textContent = person.knownFor?.length
    ? person.knownFor.join(", ")
    : "No featured titles returned.";
  applyPersonActionButtons(fragment, person, openLabel);

  if (person.profileUrl) {
    portrait.src = person.profileUrl;
    portrait.alt = person.name;
  } else {
    portraitFrame.classList.add("is-empty");
    portrait.remove();
    portraitFrame.innerHTML = `<span>${person.name}</span>`;
  }

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
  applyPersonActionButtons(fragment, person, "Show matching movies");
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
    applyPersonActionButtons(fragment, person, "Show matching movies");

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

async function loadIndexStatus(config = null) {
  if (!elements.indexStatus) {
    return;
  }

  if (!liveState.hasOmdb) {
    elements.indexStatus.textContent = "Index status unavailable right now.";
    return;
  }

  if (config?.hasLocalPeopleIndex && config?.peopleCounts) {
    elements.indexStatus.textContent = `${config.peopleCounts.actors} actors, ${config.peopleCounts.directors} directors, ${config.peopleCounts.producers} producers, and ${config.peopleCounts.writers || 0} writers are available from the local ranked index${config.peopleGeneratedAt ? ` (built ${formatDateTime(config.peopleGeneratedAt)})` : ""}.`;
    return;
  }

  try {
    const payload = await fetchJsonWithTimeout("/api/index-status", 2500);
    if (!payload.ready) {
      elements.indexStatus.textContent = "People rankings are warming up.";
      return;
    }

    elements.indexStatus.textContent = `${payload.counts.actors} actors, ${payload.counts.directors} directors, ${payload.counts.producers} producers, and ${payload.counts.writers || 0} writers are available from the local ranked index${payload.generatedAt ? ` (built ${formatDateTime(payload.generatedAt)})` : ""}.`;
  } catch {
    elements.indexStatus.textContent = "People rankings are warming up.";
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
      `<h3>Your watchlist is empty.</h3><p>${escapeHtml(emptyWatchlistMessage())}</p>`;
    elements.watchlistGrid.append(emptyState);
    return;
  }

  savedMovies.forEach((movie) => {
    elements.watchlistGrid.append(buildMovieCard(movie));
  });
}

async function enrichVisibleMovies(parentRequestId) {
  const enrichRequestId = ++liveState.enrichRequestId;
  await window.MovieResults.progressivelyEnrichMovies({
    movies: liveState.movies,
    getMovies: () => liveState.movies,
    fetchJson,
    enrichUrl: (ids) => `/api/enrich?ids=${ids.join(",")}`,
    enrichAttempts: liveState.enrichAttempts,
    maxAttempts: 2,
    batchSize: 2,
    retryDelayMs: 400,
    isCurrent: () => parentRequestId === liveState.requestId && enrichRequestId === liveState.enrichRequestId,
    onUpdate: (enrichedById) => {
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
      window.MovieResults.patchMovieCards(elements.resultsGrid, enrichedById, buildMovieCard);
      syncWatchlistMovieDetails(enrichedById);
      renderWatchlist();
    },
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
  setSearchMode(true);
  syncResultsPagination();
  elements.resultsGrid.replaceChildren();
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.innerHTML = "<h3>Loading live results...</h3><p>Fetching fresh credits and ratings.</p>";
  elements.resultsGrid.append(loadingState);
}

function renderErrorState(message) {
  liveState.renderToken += 1;
  setSearchMode(true);
  syncResultsPagination();
  elements.resultsGrid.replaceChildren();
  const errorState = document.createElement("div");
  errorState.className = "empty-state";
  errorState.innerHTML = `<h3>Live fetch failed.</h3><p>${message}</p>`;
  elements.resultsGrid.append(errorState);
}

function handlePersonSelection(event) {
  const saveButton = event.target.closest("[data-save-person]");
  if (saveButton) {
    const currentScrollY = window.scrollY;
    toggleSavedPerson(saveButton.dataset.savedPerson || "").catch((error) => {
      setStatus(error.message, true);
    });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: currentScrollY, behavior: "auto" });
    });
    return;
  }

  const button = event.target.closest("[data-open-person]");
  if (!button) {
    return;
  }

  elements.personSearch.value = button.dataset.person;
  if (elements.searchType && button.dataset.searchType) {
    elements.searchType.value = button.dataset.searchType;
  }
  liveState.exactMatch = true;
  syncSearchModeUi();
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
  if (savedDataClient) {
    savedDataClient.toggleTitle(movie || { id: movieId }).catch((error) => {
      setStatus(error.message, true);
    });
    return;
  }

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
  if (elements.searchType) {
    elements.searchType.value = "person";
  }
  if (elements.awardFilter) {
    elements.awardFilter.value = "all";
  }
  elements.imdbMin.value = "0";
  elements.rtMin.value = "0";
  elements.genreFilter.value = "all";
  elements.decadeFilter.value = "all";
  elements.sortFilter.value = "match";
  setActiveRole("any");
  liveState.exactMatch = false;
  syncSearchModeUi();
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
    searchType: currentSearchType(),
    exactMatch: liveState.exactMatch,
    role: liveState.activeRole,
    imdbMin: Number(elements.imdbMin.value),
    rtMin: Number(elements.rtMin.value),
    genre: elements.genreFilter.value,
    decade: elements.decadeFilter.value,
    sort: elements.sortFilter.value,
    award: elements.awardFilter?.value || "all",
  };
}

function buildFetchKey(state) {
  const entitySelectionMode = isEntitySelectionMode(state);
  return JSON.stringify({
    personQuery: state.personQuery,
    searchType: state.searchType,
    exactMatch: state.exactMatch,
    role: entitySelectionMode ? "pending" : state.role,
    imdbMin: entitySelectionMode ? 0 : state.imdbMin,
    rtMin: entitySelectionMode ? 0 : state.rtMin,
    genre: entitySelectionMode ? "all" : state.genre,
    decade: entitySelectionMode ? "all" : state.decade,
    award: entitySelectionMode ? "all" : state.award,
  });
}

function applyStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const personQuery = params.get("query") || params.get("person") || "";
  const searchType = params.get("searchType") || "person";
  const exactMatch = params.get("exactMatch") === "1";
  const role = params.get("role") || "any";
  const genre = params.get("genre") || "all";
  const decade = params.get("decade") || "all";
  const sort = params.get("sort") || "match";
  const award = params.get("award") || "all";
  const imdbMin = params.get("imdbMin");
  const rtMin = params.get("rtMin");

  elements.personSearch.value = personQuery;
  if (elements.searchType) {
    elements.searchType.value = searchType;
  }
  liveState.exactMatch = exactMatch;
  if (elements.awardFilter) {
    elements.awardFilter.value = award;
  }
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
    params.set("query", state.personQuery);
  }
  if (state.searchType !== "person") {
    params.set("searchType", state.searchType);
  }
  if (state.exactMatch) {
    params.set("exactMatch", "1");
  }
  if (state.searchType === "person" && state.role !== "any") {
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
  if (state.award !== "all") {
    params.set("award", state.award);
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
  syncSearchModeUi();
  if (liveState.movies.length) {
    liveState.movies = sortMoviesClient(liveState.movies, elements.sortFilter.value);
  }
  if (shouldFetchOnLoad()) {
    refreshMovies();
    return;
  }

  renderIdleState();
}

function setSearchMode(isSearchMode) {
  document.body.classList.toggle("has-search-results", Boolean(isSearchMode));
  if (elements.resultsSection) {
    elements.resultsSection.hidden = !isSearchMode;
  }
  if (elements.suggestedPanels) {
    elements.suggestedPanels.hidden = isSearchMode;
  }
}

function currentSearchType() {
  return elements.searchType?.value || "person";
}

function isEntitySelectionMode(state = getFilterState()) {
  return Boolean(state.personQuery) && !state.exactMatch;
}

function syncSearchModeUi() {
  const searchType = currentSearchType();
  const isStudio = searchType === "studio";

  if (elements.searchLabel) {
    elements.searchLabel.textContent = isStudio ? "Studio" : "Person";
  }
  if (elements.roleField) {
    elements.roleField.hidden = isStudio;
  }
  if (elements.roleFilter) {
    elements.roleFilter.style.gridTemplateColumns = "repeat(5, minmax(0, 1fr))";
  }
  if (isStudio) {
    setActiveRole("any");
    applyStudioPlaceholder(elements.personSearch);
    syncMovieFilterState();
    return;
  }

  applyRandomPlaceholder(elements.personSearch, liveState.placeholderPools);
  syncMovieFilterState();
}

function syncMovieFilterState(state = getFilterState()) {
  const pendingSelection = isEntitySelectionMode(state);
  if (elements.movieFilterGroup) {
    elements.movieFilterGroup.classList.toggle("is-pending", pendingSelection);
  }
  if (elements.movieFilterHelper) {
    elements.movieFilterHelper.textContent = pendingSelection
      ? `These settings are queued and will apply after you choose a specific ${state.searchType === "studio" ? "studio" : "person"}.`
      : "These filters are applied to the movie results below.";
  }
}

function buildResultsTitle(payload) {
  const matchedEntity = payload.matchedEntity || payload.matchedPerson || null;
  if (!matchedEntity) {
    return "Movies selected by the people behind them";
  }
  if (matchedEntity.type === "studio") {
    return `Movies from "${matchedEntity.name}"`;
  }
  return `Movies connected to "${matchedEntity.name}"`;
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

function pickRotatingPeopleForRole(role, count = 10) {
  const people = getRotatingPool(role);
  return pickFromRolePool(people, count, `${role}:${getDailySeed()}:${liveState.refreshTokens[role]}`);
}

function getRotatingPool(role) {
  const pools = {
    actors: liveState.featuredActors,
    writers: liveState.featuredWriters,
    directors: liveState.featuredDirectors,
    producers: liveState.featuredProducers,
    studios: liveState.featuredStudios,
  };

  return pools[role] || [];
}

function pickFromRolePool(people, count, seedKey) {
  const ranked = [...dedupePeopleById(people)].sort(compareDiscoveryPeople);
  if (ranked.length <= count) {
    return shufflePeople(ranked, seedKey).slice(0, count);
  }

  const recentIds = loadRecentPickIds(seedKey.split(":")[0]);
  const candidateWindow = ranked.slice(0, Math.min(ranked.length, 140));
  const filteredWindow = candidateWindow.filter((person) => !recentIds.has(person.id));
  const sourceWindow = filteredWindow.length >= count ? filteredWindow : candidateWindow;
  const start = seededIndex(seedKey, sourceWindow.length);
  const picks = [];

  for (let offset = 0; picks.length < count && offset < sourceWindow.length; offset += 1) {
    picks.push(sourceWindow[(start + offset * 11) % sourceWindow.length]);
  }

  const deduped = dedupePeopleById(picks);
  saveRecentPickIds(seedKey.split(":")[0], deduped.map((person) => person.id));
  return deduped;
}

function loadRecentPickIds(role) {
  try {
    const payload = JSON.parse(window.sessionStorage.getItem(refreshHistoryStorageKey) || "{}");
    const ids = Array.isArray(payload?.[role]) ? payload[role] : [];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function saveRecentPickIds(role, ids) {
  try {
    const payload = JSON.parse(window.sessionStorage.getItem(refreshHistoryStorageKey) || "{}");
    const prior = Array.isArray(payload?.[role]) ? payload[role] : [];
    const merged = [...prior, ...ids].slice(-80);
    payload[role] = merged;
    window.sessionStorage.setItem(refreshHistoryStorageKey, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
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
  const recognitionScore = Number(person.recognitionScore ?? 0);
  const creditCount = Number(person.creditCount ?? 0);
  const totalVotes = Number(person.totalVotes ?? 0);
  const inCoreBand =
    score >= 7.4 && score <= 8.8 && creditCount >= 4 && totalVotes >= 5000 && recognitionScore >= 300;
  const inPreferredBand =
    score >= 7.0 && score <= 9.2 && creditCount >= 3 && totalVotes >= 1000 && recognitionScore >= 120;
  const bandDistance = Math.abs(score - 8.1);
  return (
    (inCoreBand ? 220 : 0)
    + (inPreferredBand ? 100 : 0)
    + recognitionScore * 0.6
    + Math.log10(totalVotes + 10) * 18
    + Math.min(creditCount, 12) * 2
    + Math.log10(popularity + 10) * 5
    - bandDistance * 18
    - Math.max(0, score - 9.0) * 36
  );
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

function loadSavedPeople() {
  try {
    const raw = window.localStorage.getItem(savedPeopleStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(parsed) ? parsed : [];
    return new Map(
      entries
        .filter((entry) => entry && entry.id && entry.name)
        .map((entry) => [String(entry.id), entry]),
    );
  } catch {
    return new Map();
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

function persistSavedPeople() {
  window.localStorage.setItem(
    savedPeopleStorageKey,
    JSON.stringify([...savedPeople.values()]),
  );
}

function applyPersonActionButtons(fragment, person, openLabel) {
  const openButton = fragment.querySelector("[data-open-person]");
  if (openButton) {
    openButton.dataset.person = person.name;
    openButton.dataset.searchType = String(person.department || "").toLowerCase().includes("studio")
      ? "studio"
      : "person";
    openButton.textContent = openLabel;
  }

  const saveButton = fragment.querySelector("[data-save-person]");
  if (saveButton) {
    const record = normalizeSavedPerson(person);
    const isSaved = savedPeople.has(String(record.id));
    saveButton.dataset.savePerson = "1";
    saveButton.dataset.savedPerson = JSON.stringify(record);
    saveButton.textContent = isSaved ? "Saved person" : "Save person";
    saveButton.classList.toggle("is-saved", isSaved);
  }
}

function normalizeSavedPerson(person) {
  const department = String(person.department || "Unknown");
  const knownFor = Array.isArray(person.knownFor) ? person.knownFor.slice(0, 4) : [];
  const id =
    person.id !== null && person.id !== undefined && String(person.id).trim()
      ? String(person.id)
      : `local:${hashString(`${person.name}:${department}`)}`;

  return {
    id,
    name: person.name,
    department,
    bucket: classifySavedPersonBucket(department),
    ratingLabel: person.ratingLabel || "Career score unavailable",
    knownFor,
    profileUrl: person.profileUrl || "",
    savedAt: new Date().toISOString(),
  };
}

function classifySavedPersonBucket(department) {
  const label = String(department || "").toLowerCase();
  if (
    label.includes("acting") ||
    label.includes("actor") ||
    label.includes("perform")
  ) {
    return "actors";
  }

  return "filmmakers";
}

function toggleSavedPerson(rawRecord) {
  if (!rawRecord) {
    return Promise.resolve();
  }

  let record;
  try {
    record = JSON.parse(rawRecord);
  } catch {
    return Promise.resolve();
  }

  if (savedDataClient) {
    return savedDataClient.togglePerson(record);
  }

  const key = String(record.id);
  if (savedPeople.has(key)) {
    savedPeople.delete(key);
  } else {
    savedPeople.set(key, record);
  }
  persistSavedPeople();
  return Promise.resolve();
}

function syncRenderedSavedPeopleButtons() {
  document.querySelectorAll("[data-save-person][data-saved-person]").forEach((button) => {
    let record;
    try {
      record = JSON.parse(button.dataset.savedPerson || "");
    } catch {
      return;
    }

    const isSaved = savedPeople.has(String(record.id));
    button.textContent = isSaved ? "Saved person" : "Save person";
    button.classList.toggle("is-saved", isSaved);
  });
}

function handleSavedDataUpdate(snapshot) {
  syncSavedCollections(snapshot);
  savedStateSource = snapshot.source || "local";
  savedStateError = snapshot.error || "";
  if (!bootstrapComplete) {
    return;
  }

  renderWatchlist();
  syncRenderedSavedPeopleButtons();
  if (liveState.movies.length) {
    renderMovies(liveState.movies);
  }
}

function syncSavedCollections(snapshot) {
  watchlist.clear();
  (snapshot.watchlistIds || []).forEach((movieId) => {
    if (Number.isFinite(Number(movieId))) {
      watchlist.add(Number(movieId));
    }
  });

  watchlistMovies.clear();
  (snapshot.watchlistMovies || []).forEach((movie) => {
    if (movie && Number.isFinite(Number(movie.id))) {
      watchlistMovies.set(Number(movie.id), movie);
    }
  });

  savedPeople.clear();
  (snapshot.savedPeople || []).forEach((person) => {
    if (person?.id && person?.name) {
      savedPeople.set(String(person.id), person);
    }
  });
}

function emptyWatchlistMessage() {
  if (savedStateSource === "remote") {
    return "Save live results here and they will stay with your account across refreshes and devices.";
  }
  if (savedStateSource === "remote-error" && savedStateError) {
    return "Your account watchlist could not load right now. Retry after the account state reconnects.";
  }
  return "Save live results here and they will stay on this browser.";
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
