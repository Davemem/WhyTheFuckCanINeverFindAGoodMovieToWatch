const elements = {
  indexSummary: document.querySelector("#index-summary"),
  resultsSection: document.querySelector("#people-results-section"),
  resultsGrid: document.querySelector("#people-results-grid"),
  resultsSummary: document.querySelector("#people-results-summary"),
  resultsTitle: document.querySelector("#people-results-title"),
  resultsBack: document.querySelector("#people-results-back"),
  directorySection: document.querySelector("#people-directory-section"),
  directoryResultsSummary: document.querySelector("#directory-results-summary"),
  directoryRefresh: document.querySelector("#directory-refresh"),
  directoryHeading: document.querySelector("#directory-grid-heading"),
  directoryGrid: document.querySelector("#directory-grid"),
  cardTemplate: document.querySelector("#person-card-template"),
  movieCardTemplate: document.querySelector("#movie-card-template"),
  navActors: document.querySelector("#nav-actors"),
  navProducers: document.querySelector("#nav-producers"),
};
const devStatusFlagKey = "wtfcineverfind-debug";
const savedPeopleStorageKey = "wtfcineverfind-saved-people";
const savedPeople = loadSavedPeople();

const pageState = {
  department: readDepartmentFromUrl(),
  currentPeople: [],
  visiblePeople: [],
  currentTotal: 0,
  currentMovies: [],
  currentSearchPeople: [],
  refreshCount: 0,
  renderToken: 0,
};

bootstrap().catch((error) => {
  if (elements.directoryResultsSummary) {
    elements.directoryResultsSummary.textContent = error.message;
  }
});

async function bootstrap() {
  applyDevStatusVisibility();
  updateActiveTab();
  applyDepartmentCopy();
  syncCatalogRoleChoices();
  bindEvents();
  setSearchMode(false);

  const statusPromise = fetchJsonWithTimeout("/api/index-status", 2500);
  if (shouldFetchResultsOnLoad()) {
    await refreshResults();
  } else {
    await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
    chooseVisibleDirectoryPeople();
    renderDirectory();
    setSearchMode(false);
  }
  elements.indexSummary.textContent = "";

  try {
    const statusPayload = await statusPromise;
    if (statusPayload.ready) {
      elements.indexSummary.textContent = `${statusPayload.counts.actors} actors, ${statusPayload.counts.directors} directors, and ${statusPayload.counts.producers} producers are loaded from the local ranked index${statusPayload.generatedAt ? ` (built ${formatDateTime(statusPayload.generatedAt)})` : ""}.`;
    } else {
      elements.indexSummary.textContent = "People index is syncing.";
    }
  } catch {
    elements.indexSummary.textContent = "Index status unavailable right now.";
  }
}

function applyDevStatusVisibility() {
  const showDevStatus =
    new URLSearchParams(window.location.search).get("debug") === "1" ||
    window.localStorage.getItem(devStatusFlagKey) === "1";

  const strip = elements.indexSummary?.closest(".status-strip");
  if (strip) {
    strip.hidden = !showDevStatus;
  }
}

function bindEvents() {
  elements.directoryGrid.addEventListener("click", handlePersonSelection);
  elements.resultsGrid?.addEventListener("click", handlePersonSelection);
  elements.resultsBack?.addEventListener("click", handleResultsBack);
  elements.directoryRefresh?.addEventListener("click", refreshDirectorySuggestions);
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("catalog:people-search", handleInlineSearchEvent);
}

function renderDirectory() {
  pageState.renderToken += 1;
  const renderToken = pageState.renderToken;
  const sorted = pageState.visiblePeople || [];

  elements.directoryResultsSummary.textContent = `${sorted.length} ${departmentLabelPlural(pageState.department)} shown here. Refresh to reshuffle this set.`;
  elements.directoryGrid.replaceChildren();

  if (!sorted.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = "<h3>No suggestions yet.</h3><p>The next snapshot pass should fill this list.</p>";
    elements.directoryGrid.append(emptyState);
    return;
  }

  const batchSize = 80;
  let index = 0;
  const appendBatch = () => {
    if (renderToken !== pageState.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + batchSize, sorted.length);
    for (let cursor = index; cursor < end; cursor += 1) {
      fragment.append(buildPersonCard(sorted[cursor]));
    }
    elements.directoryGrid.append(fragment);
    index = end;

    if (index < sorted.length) {
      window.requestAnimationFrame(appendBatch);
    }
  };

  window.requestAnimationFrame(appendBatch);
}

function buildPersonCard(person) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const portrait = fragment.querySelector(".person-card-portrait");
  const portraitFrame = fragment.querySelector(".person-card-visual");

  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".person-card-role").textContent = person.department;
  fragment.querySelector(".person-card-count").textContent =
    person.ratingLabel || "Career score unavailable";
  fragment.querySelector(".person-card-credits").textContent = person.knownFor?.length
    ? person.knownFor.join(", ")
    : "Known-for titles unavailable.";
  applyPersonActionButtons(fragment, person);

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

function handlePersonSelection(event) {
  const saveButton = event.target.closest("[data-save-person]");
  if (saveButton) {
    const currentScrollY = window.scrollY;
    toggleSavedPerson(saveButton.dataset.savedPerson || "");
    renderDirectory();
    if (pageState.currentSearchPeople.length) {
      renderPeopleResults(pageState.currentSearchPeople);
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: currentScrollY, behavior: "auto" });
    });
    return;
  }

  const button = event.target.closest("[data-open-person]");
  if (!button) {
    return;
  }

  const currentState = getSearchStateFromUrl();
  const params = new URLSearchParams();
  params.set("department", pageState.department);
  params.set("person", button.dataset.person);
  params.set("exactPerson", "1");
  if (currentState.role && currentState.role !== "any") {
    params.set("role", currentState.role);
  }
  if (currentState.genre && currentState.genre !== "all") {
    params.set("genre", currentState.genre);
  }
  if (currentState.decade && currentState.decade !== "all") {
    params.set("decade", currentState.decade);
  }
  if (currentState.sort && currentState.sort !== "match") {
    params.set("sort", currentState.sort);
  }
  if (currentState.imdbMin > 0) {
    params.set("imdbMin", String(currentState.imdbMin));
  }
  if (currentState.rtMin > 0) {
    params.set("rtMin", String(currentState.rtMin));
  }
  const nextUrl = `/people.html?${params.toString()}#people-results-title`;
  if (window.location.pathname.endsWith("/people.html")) {
    window.history.pushState({}, "", nextUrl);
    window.dispatchEvent(new CustomEvent("catalog:people-search"));
  } else {
    window.location.href = nextUrl;
  }
}

async function refreshDirectory() {
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  chooseVisibleDirectoryPeople();
  renderDirectory();
}

async function handlePopState() {
  pageState.department = readDepartmentFromUrl();
  updateActiveTab();
  applyDepartmentCopy();
  syncCatalogRoleChoices();
  if (shouldFetchResultsOnLoad()) {
    await refreshResults();
    return;
  }
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  chooseVisibleDirectoryPeople();
  renderDirectory();
  setSearchMode(false);
}

async function handleInlineSearchEvent() {
  pageState.department = readDepartmentFromUrl();
  updateActiveTab();
  applyDepartmentCopy();
  syncCatalogRoleChoices();
  await refreshResults();
}

function applyDepartmentCopy() {
  const labels = {
    actors: {
      title: "Suggested 50 actors",
    },
    directors: {
      title: "Suggested 50 directors",
    },
    producers: {
      title: "Suggested 50 producers",
    },
  };

  const current = labels[pageState.department];
  if (elements.directoryHeading) {
    elements.directoryHeading.textContent = current.title;
  }
}

function syncCatalogRoleChoices() {
  const roleSegments = document.querySelector("[data-role-segments]");
  const roleInput = document.querySelector("[data-role-input]");
  const roleLabel = document.querySelector("[data-role-label]");
  if (!roleSegments || !roleInput || !roleLabel) {
    return;
  }

  const choices =
    pageState.department === "actors"
      ? [
          ["any", "Any"],
          ["cast", "Cast"],
        ]
      : [
          ["any", "Any"],
          ["director", "Director"],
          ["producer", "Producer"],
        ];

  roleSegments.replaceChildren();
  choices.forEach(([value, label], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment${index === 0 ? " is-active" : ""}`;
    button.dataset.roleChoice = value;
    button.textContent = label;
    roleSegments.append(button);
  });

  roleInput.value = "any";
  roleLabel.textContent = "Any role";
  roleSegments.style.gridTemplateColumns = `repeat(${choices.length}, minmax(0, 1fr))`;
}

function updateActiveTab() {
  elements.navActors.classList.toggle("is-active", pageState.department === "actors");
  elements.navProducers.classList.toggle(
    "is-active",
    pageState.department === "directors" || pageState.department === "producers",
  );
}

function readDepartmentFromUrl() {
  const department = new URLSearchParams(window.location.search).get("department");
  if (department === "directors" || department === "producers") {
    return department;
  }
  return "actors";
}

async function loadDirectoryForDepartment(department, options = {}) {
  const params = new URLSearchParams();
  params.set("department", department);
  params.set("limit", String(options.limit || 50));

  const payload = await fetchJson(`/api/people-directory?${params.toString()}`);
  pageState.currentPeople = payload.people || [];
  pageState.currentTotal = Number(payload.total || pageState.currentPeople.length);
}

function currentDirectoryQuery() {
  return {
    limit: 250,
  };
}

function chooseVisibleDirectoryPeople() {
  const source = [...(pageState.currentPeople || [])];
  if (!source.length) {
    pageState.visiblePeople = [];
    return;
  }

  const shuffled = shuffleWithDailyBias(source, `${pageState.department}:${pageState.refreshCount}`);
  pageState.visiblePeople = pickDistinctWindow(shuffled, 50, pageState.department, pageState.refreshCount);
}

function refreshDirectorySuggestions() {
  pageState.refreshCount += 1;
  const currentScrollY = window.scrollY;
  chooseVisibleDirectoryPeople();
  renderDirectory();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: currentScrollY, behavior: "auto" });
  });
}

function getSearchStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    personQuery: params.get("person") || "",
    exactPerson: params.get("exactPerson") === "1",
    role: params.get("role") || "any",
    genre: params.get("genre") || "all",
    decade: params.get("decade") || "all",
    sort: params.get("sort") || "match",
    imdbMin: Number(params.get("imdbMin") || 0),
    rtMin: Number(params.get("rtMin") || 0),
  };
}

function shouldFetchResultsOnLoad() {
  const state = getSearchStateFromUrl();
  return Boolean(
    state.personQuery ||
    state.exactPerson ||
    state.genre !== "all" ||
    state.decade !== "all" ||
    state.sort !== "match" ||
    state.imdbMin > 0 ||
    state.rtMin > 0 ||
    state.role !== "any"
  );
}

async function refreshResults() {
  const state = getSearchStateFromUrl();
  if (state.personQuery && !state.exactPerson) {
    renderPeopleLoadingState();
    try {
      const peoplePayload = await fetchJson(`/api/people?query=${encodeURIComponent(state.personQuery)}`);
      const matches = (peoplePayload.results || []).filter((person) => matchesDepartment(person, pageState.department));
      pageState.currentSearchPeople = matches;
      pageState.currentMovies = [];
      elements.resultsTitle.textContent = `People matching "${state.personQuery}"`;
      renderPeopleResults(matches);
      setSearchMode(true);
      return;
    } catch (error) {
      renderErrorState(error.message);
      setSearchMode(true);
      return;
    }
  }

  renderLoadingState();
  const params = new URLSearchParams({
    personQuery: state.personQuery,
    role: state.role,
    genre: state.genre,
    decade: state.decade,
    sort: state.sort,
    imdbMin: String(state.imdbMin),
    rtMin: String(state.rtMin),
  });

  try {
    const payload = await fetchJson(`/api/discover?${params.toString()}`);
    pageState.currentSearchPeople = [];
    pageState.currentMovies = payload.movies || [];
    elements.resultsTitle.textContent = payload.matchedPerson
      ? `Movies connected to "${payload.matchedPerson.name}"`
      : "Movies selected by the people behind them";
    renderMovies(pageState.currentMovies, payload.totalMatches || pageState.currentMovies.length);
    setSearchMode(true);
  } catch (error) {
    renderErrorState(error.message);
    setSearchMode(true);
  }
}

function renderMovies(movies, totalMatches) {
  if (!elements.resultsGrid || !elements.resultsSummary) {
    return;
  }

  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = `${totalMatches || movies.length} movie${
    (totalMatches || movies.length) === 1 ? "" : "s"
  } match your current filter stack.`;

  if (!movies.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>No live matches.</h3><p>Broaden the filters or try a different person.</p>";
    elements.resultsGrid.append(emptyState);
    return;
  }

  movies.forEach((movie) => {
    elements.resultsGrid.append(buildMovieCard(movie));
  });
}

function renderPeopleResults(people) {
  if (!elements.resultsGrid || !elements.resultsSummary) {
    return;
  }

  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = `${people.length} person${people.length === 1 ? "" : "s"} matched your search.`;

  if (!people.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>No people matched.</h3><p>Try a broader search or a different name.</p>";
    elements.resultsGrid.append(emptyState);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "people-grid";
  people.forEach((person) => {
    grid.append(buildPersonCard(person));
  });
  elements.resultsGrid.append(grid);
}

function buildMovieCard(movie) {
  const fragment = elements.movieCardTemplate.content.cloneNode(true);
  const poster = fragment.querySelector(".movie-poster");
  const posterFrame = fragment.querySelector(".movie-poster-frame");
  fragment.querySelector("h3").textContent = movie.title;
  fragment.querySelector(".pill-year").textContent = movie.year || "TBA";
  fragment.querySelector(".pill-runtime").textContent = movie.runtime || "Runtime unknown";
  fragment.querySelector(".logline").textContent = movie.logline || "Live discovery result.";
  fragment.querySelector(".rating-imdb").textContent = formatRating(movie.imdb, 1);
  fragment.querySelector(".rating-rt").textContent = formatPercent(movie.rt);
  fragment.querySelector(".rating-meta").textContent = formatInteger(movie.metacritic);
  fragment.querySelector(".rating-tmdb").textContent = formatRating(movie.tmdb, 1);
  fragment.querySelector(".cast").textContent = movie.cast?.length ? movie.cast.join(", ") : "Unknown";
  fragment.querySelector(".director").textContent = movie.director || "Unknown";
  fragment.querySelector(".producer").textContent = movie.producers?.length ? movie.producers.join(", ") : "Unknown";
  fragment.querySelector(".match-reason").textContent = movie.matchReason || "Live discovery result.";
  fragment.querySelector(".genres").textContent = formatGenres(movie);

  if (movie.posterUrl) {
    poster.src = movie.posterUrl;
    poster.alt = `${movie.title} poster`;
  } else {
    posterFrame.classList.add("is-empty");
    poster.remove();
    posterFrame.innerHTML = `<span>${movie.title}</span>`;
  }

  return fragment;
}

function renderLoadingState() {
  if (!elements.resultsGrid || !elements.resultsSummary) {
    return;
  }
  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = "Fetching live results.";
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.innerHTML = "<h3>Loading live results...</h3><p>Fetching fresh credits and ratings.</p>";
  elements.resultsGrid.append(loadingState);
}

function renderPeopleLoadingState() {
  if (!elements.resultsGrid || !elements.resultsSummary) {
    return;
  }
  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = "Searching people.";
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.innerHTML = "<h3>Finding people...</h3><p>Looking up matching actors, directors, and producers.</p>";
  elements.resultsGrid.append(loadingState);
}

function renderErrorState(message) {
  if (!elements.resultsGrid || !elements.resultsSummary) {
    return;
  }
  elements.resultsGrid.replaceChildren();
  elements.resultsSummary.textContent = "Search failed.";
  const errorState = document.createElement("div");
  errorState.className = "empty-state";
  errorState.innerHTML = `<h3>Live fetch failed.</h3><p>${message}</p>`;
  elements.resultsGrid.append(errorState);
}

function handleResultsBack() {
  window.location.href = `/people.html?department=${pageState.department}`;
}

function setSearchMode(isSearchMode) {
  document.body.classList.toggle("people-has-search-results", Boolean(isSearchMode));
  if (elements.resultsSection) {
    elements.resultsSection.hidden = !isSearchMode;
  }
  if (elements.resultsBack) {
    elements.resultsBack.hidden = !isSearchMode;
  }
  if (elements.directorySection) {
    elements.directorySection.hidden = isSearchMode;
  }
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
    return movie.genreIds.join(" / ");
  }
  return "Unknown";
}

function departmentLabelPlural(department) {
  if (department === "directors") {
    return "directors";
  }
  if (department === "producers") {
    return "producers";
  }
  return "actors and actresses";
}

function applyPersonActionButtons(fragment, person) {
  const openButton = fragment.querySelector("[data-open-person]");
  if (openButton) {
    openButton.textContent = "Open in movie catalog";
    openButton.dataset.person = person.name;
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
    label.includes("actress") ||
    label.includes("perform")
  ) {
    return "actors";
  }

  return "filmmakers";
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

function persistSavedPeople() {
  window.localStorage.setItem(
    savedPeopleStorageKey,
    JSON.stringify([...savedPeople.values()]),
  );
}

function toggleSavedPerson(rawRecord) {
  if (!rawRecord) {
    return;
  }

  let record;
  try {
    record = JSON.parse(rawRecord);
  } catch {
    return;
  }

  const key = String(record.id);
  if (savedPeople.has(key)) {
    savedPeople.delete(key);
  } else {
    savedPeople.set(key, record);
  }
  persistSavedPeople();
}

function matchesDepartment(person, department) {
  const label = String(person.department || "").toLowerCase();
  if (department === "actors") {
    return label.includes("acting") || label.includes("actor") || label.includes("actress") || label.includes("perform");
  }
  if (department === "directors") {
    return label.includes("direct");
  }
  if (department === "producers") {
    return label.includes("produc");
  }
  return true;
}

function pickDistinctWindow(source, limit, department, refreshCount) {
  if (source.length <= limit) {
    return source.slice();
  }

  const windowSize = Math.min(source.length, Math.max(limit * 3, 120));
  const offset = (refreshCount * 37 + hashString(department)) % Math.max(1, source.length);
  const windowed = [];
  for (let index = 0; index < windowSize; index += 1) {
    windowed.push(source[(offset + index) % source.length]);
  }

  const seen = new Set();
  const result = [];
  for (const person of windowed) {
    if (seen.has(person.id)) {
      continue;
    }
    seen.add(person.id);
    result.push(person);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function shuffleWithDailyBias(list, seedKey) {
  return [...list]
    .map((item, index) => ({
      item,
      key: hashString(`${seedKey}:${index}:${item.id || item.name || ""}`),
    }))
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.item);
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function debounce(callback, delayMs) {
  let timeoutId = 0;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  };
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
