const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
const savedPeopleStorageKey = "wtfcineverfind-saved-people";
const devStatusFlagKey = "wtfcineverfind-debug";
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
  imdbMin: document.querySelector("#imdb-min"),
  rtMin: document.querySelector("#rt-min"),
  imdbValue: document.querySelector("#imdb-value"),
  rtValue: document.querySelector("#rt-value"),
  genreFilter: document.querySelector("#genre-filter"),
  decadeFilter: document.querySelector("#decade-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  resetButton: document.querySelector("#reset-button"),
  resultsGrid: document.querySelector("#results-grid"),
  resultsRail: document.querySelector("#results-grid")?.closest("[data-movie-rail]"),
  resultsSection: document.querySelector("#results-section"),
  resultsSummary: document.querySelector("#results-summary"),
  movieCount: document.querySelector("#movie-count"),
  peopleCount: document.querySelector("#people-count"),
  watchlistCount: document.querySelector("#watchlist-count"),
  resultsTitle: document.querySelector("#results-title"),
  cardTemplate: document.querySelector("#movie-card-template"),
  directorySection: document.querySelector("#discovery-directory"),
  directoryLabel: document.querySelector("#directory-label"),
  directoryHeading: document.querySelector("#directory-heading"),
  directorySummary: document.querySelector("#directory-summary"),
  directoryGrid: document.querySelector("#directory-grid"),
  indexStatus: document.querySelector("#index-status"),
  peopleTemplate: document.querySelector("#person-card-template"),
  watchlistGrid: document.querySelector("#watchlist-grid"),
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
  movies: [],
  entities: [],
  directoryCache: new Map(),
  directoryRequestId: 0,
  suggestionNames: new Set(),
  entitySearch: {
    query: "",
    searchType: "person",
    category: "actors",
    page: 1,
    limit: 25,
    total: 0,
    hasMore: false,
    isLoadingMore: false,
  },
  exactMatch: false,
  imageBaseUrl: "",
  hasOmdb: false,
  lastQueryKey: "",
  requestId: 0,
  enrichRequestId: 0,
  enrichAttempts: new Map(),
  totalMatches: 0,
  placeholderPools: null,
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
  const initialCategory = discoveryCategoryFromParams(new URLSearchParams(window.location.search));
  if (elements.searchType) {
    elements.searchType.value = initialCategory;
  }
  syncSearchModeUi();
  const directoryPromise = loadDiscoveryDirectory(initialCategory);

  const payload = await fetchJson("/api/bootstrap?mode=lite");
  liveState.genres = payload.genres || [];
  liveState.imageBaseUrl = payload.config?.imageBaseUrl || "";
  liveState.hasOmdb = Boolean(payload.config?.hasOmdb);
  liveState.hasLocalPeopleIndex = Boolean(payload.config?.hasLocalPeopleIndex);
  liveState.placeholderPools = payload.config?.placeholderPools || null;
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

  elements.peopleCount.textContent = String(totalPeopleCount || 0);

  populateGenres();
  populateDecades();
  applyStateFromUrl();
  syncSearchModeUi();
  syncMovieFilterState();
  bindEvents();
  if (elements.resultsRail) {
    window.MovieResults.bindRail(elements.resultsRail);
  }
  renderWatchlist();
  renderIdleState();
  const startupTasks = [directoryPromise];
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
    elements.searchType.addEventListener("change", async () => {
      liveState.exactMatch = false;
      liveState.lastQueryKey = "";
      syncSearchModeUi();
      elements.peopleSuggestions.replaceChildren();
      liveState.suggestionNames.clear();
      updateUrlFromState(getFilterState());
      const directoryPromise = loadDiscoveryDirectory(currentDiscoveryCategory());
      if (hasMovieDiscoveryCriteria()) {
        await refreshMovies();
      } else {
        await directoryPromise;
        renderIdleState();
      }
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
    elements.personSearch.addEventListener("change", () => {
      liveState.exactMatch = liveState.suggestionNames.has(normalizeName(elements.personSearch.value));
      refreshMovies();
    });
    elements.personSearch.addEventListener("keydown", handlePersonSearchKeydown);
  }
  elements.directoryGrid?.addEventListener("click", handlePersonSelection);
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
    liveState.suggestionNames.clear();
    return;
  }

  try {
    const endpoint = currentSearchType() === "studio" ? "/api/studios" : "/api/people";
    const params = new URLSearchParams({ query });
    if (currentSearchType() === "person") {
      params.set("department", currentDiscoveryCategory());
    }
    const payload = await fetchJson(`${endpoint}?${params.toString()}`);
    elements.peopleSuggestions.replaceChildren();
    liveState.suggestionNames.clear();
    (payload.results || []).forEach((person) => {
      const option = document.createElement("option");
      option.value = person.name;
      elements.peopleSuggestions.append(option);
      liveState.suggestionNames.add(normalizeName(person.name));
    });
  } catch (error) {
    elements.peopleSuggestions.replaceChildren();
    liveState.suggestionNames.clear();
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
  renderLoadingState(state);

  try {
    if (state.personQuery && !state.exactMatch) {
      const payload = await fetchEntityPage({
        query: state.personQuery,
        searchType: state.searchType,
        category: state.category,
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
        category: state.category,
        page: payload.page || 1,
        limit: payload.limit || liveState.entitySearch.limit,
        total: payload.total || liveState.entities.length,
        hasMore: Boolean(payload.hasMore),
        isLoadingMore: false,
      };
      elements.resultsTitle.textContent =
        state.searchType === "studio"
          ? `Studios matching "${state.personQuery}"`
          : `${categoryCopy(state.category).plural} matching "${state.personQuery}"`;
      renderEntityResults(liveState.entities, state.searchType, state.category);
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

async function fetchEntityPage({ query, searchType, category, page, limit = liveState.entitySearch.limit || 25 }) {
  const cacheKey = `${category || searchType}:${query.toLowerCase()}:${page}:${limit}`;
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
    params.set("department", category || "actors");
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
  const cacheKey = `${entityState.category || entityState.searchType}:${entityState.query.toLowerCase()}:${nextPage}:${entityState.limit}`;
  if (entityPageCache.has(cacheKey)) {
    return;
  }

  try {
    await fetchEntityPage({
      query: entityState.query,
      searchType: entityState.searchType,
      category: entityState.category,
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
  const totalMatches = liveState.totalMatches || movies.length;
  const visibleMatches = movies.length;
  elements.resultsRail?.setAttribute("data-rail-content-kind", "movies");
  elements.resultsGrid.classList.remove("is-entity-results");
  resetEntityPagination();
  window.MovieResults.renderMovieCards({
    container: elements.resultsGrid,
    movies,
    totalMatches,
    summaryElement: elements.resultsSummary,
    summaryText: visibleMatches > 0 && totalMatches > visibleMatches
      ? `Showing the top ${visibleMatches} of ${totalMatches} live movies that match your current filters.`
      : `${totalMatches} live movie${totalMatches === 1 ? "" : "s"} match your current filter stack.`,
    emptyTitle: "No live matches.",
    emptyMessage: "Broaden the filters or switch to a different person, studio, or award search.",
    buildCard: buildMovieCard,
    batchSize: 24,
    setSearchMode,
    isCurrentRender: () => renderToken === liveState.renderToken,
    railRoot: elements.resultsRail,
  });
}

function renderEntityResults(entities, searchType, category) {
  liveState.renderToken += 1;
  setSearchMode(true);
  if (elements.resultsRail) {
    elements.resultsRail.dataset.railContentKind = "entity";
  }
  elements.resultsGrid.classList.add("is-entity-results");
  elements.resultsGrid.replaceChildren();
  const total = liveState.entitySearch.total || entities.length;
  const selectionPrompt = searchType === "studio"
    ? "Choose a studio to apply the movie filters below."
    : `Choose ${categoryCopy(category).article} ${categoryCopy(category).singular.toLowerCase()} to apply the movie filters below.`;
  elements.resultsSummary.textContent = searchType === "studio"
    ? `${entities.length} of ${total} studios matched your search. ${selectionPrompt}`
    : `${entities.length} of ${total} ${categoryCopy(category).plural.toLowerCase()} matched your search. ${selectionPrompt}`;

  if (!entities.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      `<h3>No ${searchType === "studio" ? "studios" : categoryCopy(category).plural.toLowerCase()} matched.</h3><p>Try a broader search or a different name.</p>`;
    elements.resultsGrid.append(emptyState);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "people-grid";
  entities.forEach((entity) => {
    const categoryEntity = { ...entity, department: categoryCopy(category).department };
    grid.append(buildDirectoryPersonCard(
      categoryEntity,
      searchType === "studio" ? "Show studio movies" : `Show ${categoryCopy(category).singular.toLowerCase()} movies`,
    ));
  });
  elements.resultsGrid.append(grid);
}

function renderIdleState() {
  liveState.renderToken += 1;
  setSearchMode(false);
  elements.resultsRail?.setAttribute("data-rail-content-kind", "movies");
  elements.resultsGrid.classList.remove("is-entity-results");
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
    category: currentDiscoveryCategory(),
    page: 1,
    total: 0,
    hasMore: false,
    isLoadingMore: false,
  };
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

async function loadDiscoveryDirectory(category) {
  const copy = categoryCopy(category);
  const cachedPeople = liveState.directoryCache.get(category);
  const requestId = ++liveState.directoryRequestId;
  updateDirectoryCopy(category);

  if (cachedPeople) {
    renderDiscoveryDirectory(cachedPeople, category);
    return;
  }

  elements.directoryGrid?.setAttribute("aria-busy", "true");
  if (elements.directorySummary) {
    elements.directorySummary.textContent = `Loading the ranked ${copy.singular.toLowerCase()} directory.`;
  }

  try {
    const params = new URLSearchParams({ department: category, limit: "50" });
    const payload = await fetchJson(`/api/people-directory?${params.toString()}`);
    if (requestId !== liveState.directoryRequestId || category !== currentDiscoveryCategory()) {
      return;
    }
    const people = (payload.people || []).slice(0, 50);
    liveState.directoryCache.set(category, people);
    renderDiscoveryDirectory(people, category);
  } catch (error) {
    if (requestId !== liveState.directoryRequestId) {
      return;
    }
    elements.directoryGrid?.replaceChildren();
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    appendMessageState(emptyState, `${copy.plural} are unavailable right now.`, error.message);
    elements.directoryGrid?.append(emptyState);
    if (elements.directorySummary) {
      elements.directorySummary.textContent = "The rest of movie discovery is still available.";
    }
  } finally {
    if (requestId === liveState.directoryRequestId) {
      elements.directoryGrid?.removeAttribute("aria-busy");
    }
  }
}

function renderDiscoveryDirectory(people, category) {
  const copy = categoryCopy(category);
  elements.directoryGrid?.replaceChildren();
  if (!people.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    appendMessageState(emptyState, `No ${copy.plural.toLowerCase()} are ranked yet.`, "Try another discovery category.");
    elements.directoryGrid?.append(emptyState);
  } else {
    const fragment = document.createDocumentFragment();
    people.forEach((person) => {
      const categoryPerson = { ...person, department: copy.department };
      fragment.append(buildDirectoryPersonCard(
        categoryPerson,
        category === "studios" ? "Show studio movies" : `Show ${copy.singular.toLowerCase()} movies`,
      ));
    });
    elements.directoryGrid?.append(fragment);
  }
  if (elements.directorySummary) {
    elements.directorySummary.textContent = people.length >= 50
      ? `The top 50 ${copy.plural.toLowerCase()} from the ranked catalog.`
      : `${people.length} ${copy.plural.toLowerCase()} are currently available.`;
  }
}

function updateDirectoryCopy(category) {
  const copy = categoryCopy(category);
  if (elements.directoryLabel) {
    elements.directoryLabel.textContent = copy.plural;
  }
  if (elements.directoryHeading) {
    elements.directoryHeading.textContent = `Top 50 ${copy.plural.toLowerCase()}`;
  }
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

function applyCategoryPlaceholder(input, pools, category) {
  if (!input) {
    return;
  }

  const fallbackNames = {
    actors: ["Cate Blanchett", "Denzel Washington", "Emma Stone"],
    writers: ["Greta Gerwig", "Jordan Peele", "Aaron Sorkin"],
    directors: ["Denis Villeneuve", "Bong Joon Ho", "Sofia Coppola"],
    producers: ["Kevin Feige", "Kathleen Kennedy", "Emma Thomas"],
  };
  const source = Array.isArray(pools?.[category]) && pools[category].length
    ? pools[category]
    : fallbackNames[category] || fallbackNames.actors;
  const uniqueNames = [...new Set(source.filter(Boolean))];
  const start = hashString(`${category}:${window.location.pathname}:${new Date().toISOString().slice(0, 10)}`)
    % Math.max(uniqueNames.length, 1);
  const names = [0, 1, 2]
    .map((offset) => uniqueNames[(start + offset) % uniqueNames.length])
    .filter(Boolean);
  input.placeholder = `Try: ${names.join(", ")}`;
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
    appendTextFallback(portraitFrame, person.name);
  }

  return fragment;
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

function renderLoadingState(state = getFilterState()) {
  liveState.renderToken += 1;
  setSearchMode(true);
  elements.resultsRail?.setAttribute("data-rail-content-kind", "movies");
  elements.resultsGrid.classList.remove("is-entity-results");
  if (elements.resultsRail) {
    window.MovieResults.setRailStatus(elements.resultsRail, "loading");
  }
  elements.resultsGrid.replaceChildren();
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.innerHTML = state.award !== "all"
    ? "<h3>Checking award records...</h3><p>Comparing established films with verified award summaries.</p>"
    : "<h3>Loading live results...</h3><p>Fetching fresh credits and ratings.</p>";
  elements.resultsGrid.append(loadingState);
}

function renderErrorState(message) {
  liveState.renderToken += 1;
  setSearchMode(true);
  elements.resultsRail?.setAttribute("data-rail-content-kind", "movies");
  elements.resultsGrid.classList.remove("is-entity-results");
  if (elements.resultsRail) {
    window.MovieResults.setRailStatus(elements.resultsRail, "error");
  }
  elements.resultsGrid.replaceChildren();
  const errorState = document.createElement("div");
  errorState.className = "empty-state";
  appendMessageState(errorState, "Live fetch failed.", message);
  elements.resultsGrid.append(errorState);
}

function appendTextFallback(container, value) {
  const fallback = document.createElement("span");
  fallback.textContent = value;
  container.replaceChildren(fallback);
}

function appendMessageState(container, title, message) {
  const heading = document.createElement("h3");
  const copy = document.createElement("p");
  heading.textContent = title;
  copy.textContent = message;
  container.append(heading, copy);
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
  liveState.exactMatch = Boolean(elements.personSearch.value.trim());
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
  liveState.suggestionNames.clear();
  if (elements.searchType) {
    elements.searchType.value = "actors";
  }
  if (elements.awardFilter) {
    elements.awardFilter.value = "all";
  }
  elements.imdbMin.value = "0";
  elements.rtMin.value = "0";
  elements.genreFilter.value = "all";
  elements.decadeFilter.value = "all";
  elements.sortFilter.value = "match";
  liveState.exactMatch = false;
  syncSearchModeUi();
  liveState.totalMatches = 0;
  liveState.lastQueryKey = "";
  updateUrlFromState(getFilterState());
  renderIdleState();
  loadDiscoveryDirectory("actors");
}

function getFilterState() {
  const category = currentDiscoveryCategory();
  return {
    personQuery: elements.personSearch.value.trim(),
    category,
    searchType: category === "studios" ? "studio" : "person",
    exactMatch: liveState.exactMatch,
    role: categoryRole(category),
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
    category: state.category,
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
  const category = discoveryCategoryFromParams(params);
  const exactMatch = params.get("exactMatch") === "1";
  const genre = params.get("genre") || "all";
  const decade = params.get("decade") || "all";
  const sort = params.get("sort") || "match";
  const award = params.get("award") || "all";
  const imdbMin = params.get("imdbMin");
  const rtMin = params.get("rtMin");

  elements.personSearch.value = personQuery;
  if (elements.searchType) {
    elements.searchType.value = category;
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
  elements.imdbValue.textContent = `${Number(elements.imdbMin.value).toFixed(1)}+`;
  elements.rtValue.textContent = `${Number(elements.rtMin.value)}%+`;
}

function updateUrlFromState(state) {
  const params = new URLSearchParams();

  if (state.category !== "actors") {
    params.set("category", state.category);
  }
  if (state.personQuery) {
    params.set("query", state.personQuery);
  }
  if (state.exactMatch) {
    params.set("exactMatch", "1");
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
  return hasMovieDiscoveryCriteria();
}

async function handlePopState() {
  liveState.lastQueryKey = "";
  applyStateFromUrl();
  syncSearchModeUi();
  const directoryPromise = loadDiscoveryDirectory(currentDiscoveryCategory());
  if (liveState.movies.length) {
    liveState.movies = sortMoviesClient(liveState.movies, elements.sortFilter.value);
  }
  if (shouldFetchOnLoad()) {
    await refreshMovies();
    return;
  }

  await directoryPromise;
  renderIdleState();
}

function setSearchMode(isSearchMode) {
  document.body.classList.toggle("has-search-results", Boolean(isSearchMode));
  if (elements.resultsSection) {
    elements.resultsSection.hidden = !isSearchMode;
  }
  if (elements.directorySection) {
    elements.directorySection.hidden = Boolean(isSearchMode);
  }
}

function currentSearchType() {
  return currentDiscoveryCategory() === "studios" ? "studio" : "person";
}

function currentDiscoveryCategory() {
  return normalizeDiscoveryCategory(elements.searchType?.value);
}

function normalizeDiscoveryCategory(value) {
  return ["actors", "writers", "directors", "producers", "studios"].includes(value)
    ? value
    : "actors";
}

function discoveryCategoryFromParams(params) {
  return normalizeDiscoveryCategory(
    params.get("category")
      || params.get("department")
      || legacyCategoryFromParams(params),
  );
}

function legacyCategoryFromParams(params) {
  if (params.get("searchType") === "studio") {
    return "studios";
  }
  return {
    cast: "actors",
    writer: "writers",
    director: "directors",
    producer: "producers",
  }[params.get("role")] || "actors";
}

function categoryRole(category) {
  return {
    actors: "cast",
    writers: "writer",
    directors: "director",
    producers: "producer",
    studios: "any",
  }[normalizeDiscoveryCategory(category)];
}

function categoryCopy(category) {
  return {
    actors: { singular: "Actor", plural: "Actors", article: "an", department: "Acting" },
    writers: { singular: "Writer", plural: "Writers", article: "a", department: "Writing" },
    directors: { singular: "Director", plural: "Directors", article: "a", department: "Directing" },
    producers: { singular: "Producer", plural: "Producers", article: "a", department: "Production" },
    studios: { singular: "Studio", plural: "Studios", article: "a", department: "Studio" },
  }[normalizeDiscoveryCategory(category)];
}

function hasMovieDiscoveryCriteria(state = getFilterState()) {
  return Boolean(
    state.personQuery
      || state.genre !== "all"
      || state.decade !== "all"
      || state.imdbMin > 0
      || state.rtMin > 0
      || state.award !== "all",
  );
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function isEntitySelectionMode(state = getFilterState()) {
  return Boolean(state.personQuery) && !state.exactMatch;
}

function syncSearchModeUi() {
  const category = currentDiscoveryCategory();
  const copy = categoryCopy(category);
  const isStudio = category === "studios";

  if (elements.searchLabel) {
    elements.searchLabel.textContent = copy.singular;
  }
  if (isStudio) {
    applyStudioPlaceholder(elements.personSearch);
    syncMovieFilterState();
    updateDirectoryCopy(category);
    return;
  }

  applyCategoryPlaceholder(elements.personSearch, liveState.placeholderPools, category);
  syncMovieFilterState();
  updateDirectoryCopy(category);
}

function syncMovieFilterState(state = getFilterState()) {
  const pendingSelection = isEntitySelectionMode(state);
  const copy = categoryCopy(state.category);
  if (elements.movieFilterGroup) {
    elements.movieFilterGroup.classList.toggle("is-pending", pendingSelection);
  }
  if (elements.movieFilterHelper) {
    elements.movieFilterHelper.textContent = pendingSelection
      ? `These settings are queued and will apply after you choose ${copy.article} ${copy.singular.toLowerCase()}.`
      : "These filters are applied to the movie results below.";
  }
}

function buildResultsTitle(payload) {
  const matchedEntity = payload.matchedEntity || payload.matchedPerson || null;
  if (!matchedEntity) {
    const award = elements.awardFilter?.value || "all";
    if (award !== "all") {
      return awardResultsTitle(award);
    }
    return "Movies selected by the people behind them";
  }
  if (matchedEntity.type === "studio") {
    return `Movies from "${matchedEntity.name}"`;
  }
  return `Movies connected to "${matchedEntity.name}"`;
}

function awardResultsTitle(award) {
  return {
    "winner:any": "Award-winning movies",
    "nominee:any": "Award-nominated movies",
    "winner:oscar": "Oscar-winning movies",
    "nominee:oscar": "Oscar-nominated movies",
    "winner:emmy": "Emmy-winning movies",
    "nominee:emmy": "Emmy-nominated movies",
    "winner:golden-globe": "Golden Globe-winning movies",
    "nominee:golden-globe": "Golden Globe-nominated movies",
    "winner:bafta": "BAFTA-winning movies",
    "nominee:bafta": "BAFTA-nominated movies",
  }[award] || "Award-recognised movies";
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
