const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
const savedPeopleStorageKey = "wtfcineverfind-saved-people";
const savedTitleRailCardWidth = 262;
const savedTitleRailGap = 10;
const initialSavedPeopleRenderCount = 6;
const savedPeopleRenderBatch = 4;

const elements = {
  savedStatus: document.querySelector("#saved-status"),
  savedActorCount: document.querySelector("#saved-actor-count"),
  savedFilmmakerCount: document.querySelector("#saved-filmmaker-count"),
  savedActorsGrid: document.querySelector("#saved-actors-grid"),
  savedFilmmakersGrid: document.querySelector("#saved-filmmakers-grid"),
  savedActorsPanel: document.querySelector("#saved-actors-panel"),
  savedFilmmakersPanel: document.querySelector("#saved-filmmakers-panel"),
  savedPersonCatalog: document.querySelector("#saved-person-catalog"),
  savedPersonCatalogName: document.querySelector("#saved-person-catalog-name"),
  savedTabButtons: [...document.querySelectorAll("[data-saved-tab]")],
  movieTemplate: document.querySelector("#movie-card-template"),
  personTemplate: document.querySelector("#saved-person-card-template"),
};

const watchlist = loadWatchlist();
const watchlistMovies = loadWatchlistMovies();
const savedPeople = loadSavedPeople();
const personCatalogCache = new Map();
const personCatalogEnrichment = new Map();
const uiState = {
  activeTab: "actors",
  visiblePeopleCounts: {
    actors: initialSavedPeopleRenderCount,
    filmmakers: initialSavedPeopleRenderCount,
  },
  peopleByTab: {
    actors: [],
    filmmakers: [],
  },
  selectedPeople: {
    actors: "",
    filmmakers: "",
  },
  railScrollLeft: new Map(),
  railEnrichmentTimers: new Map(),
};

elements.savedActorsGrid?.addEventListener("click", handleSavedAction);
elements.savedFilmmakersGrid?.addEventListener("click", handleSavedAction);
elements.savedPersonCatalog?.addEventListener("click", handleSavedAction);
elements.savedPersonCatalog?.addEventListener("scroll", handleRailScroll, true);
elements.savedPersonCatalog?.addEventListener("click", handleRailButtonClick);
elements.savedTabButtons.forEach((button) => {
  button.addEventListener("click", () =>
    setActiveTab(button.dataset.savedTab || "actors", { clearSelection: true }),
  );
});
window.addEventListener("resize", debounce(syncAllRails, 120));
window.addEventListener(
  "resize",
  debounce(() => {
    if (elements.savedPersonCatalog) {
      refreshSynopsisToggles(elements.savedPersonCatalog);
    }
  }, 120),
);
window.addEventListener("scroll", debounce(handleWindowScroll, 80), { passive: true });

renderSavedPage();

function renderSavedPage() {
  captureScrollState();
  const savedActors = [...savedPeople.values()].filter((person) => person.bucket === "actors");
  const savedFilmmakers = [...savedPeople.values()].filter((person) => person.bucket === "filmmakers");
  uiState.peopleByTab.actors = savedActors;
  uiState.peopleByTab.filmmakers = savedFilmmakers;
  uiState.visiblePeopleCounts.actors = Math.min(
    Math.max(uiState.visiblePeopleCounts.actors, initialSavedPeopleRenderCount),
    savedActors.length || initialSavedPeopleRenderCount,
  );
  uiState.visiblePeopleCounts.filmmakers = Math.min(
    Math.max(uiState.visiblePeopleCounts.filmmakers, initialSavedPeopleRenderCount),
    savedFilmmakers.length || initialSavedPeopleRenderCount,
  );
  uiState.selectedPeople.actors = resolveSelectedPersonId("actors", savedActors);
  uiState.selectedPeople.filmmakers = resolveSelectedPersonId("filmmakers", savedFilmmakers);

  if (elements.savedActorCount) {
    elements.savedActorCount.textContent = String(savedActors.length);
  }
  if (elements.savedFilmmakerCount) {
    elements.savedFilmmakerCount.textContent = String(savedFilmmakers.length);
  }

  renderSavedPeopleGrid(
    elements.savedActorsGrid,
    savedActors,
    "actors",
    "Save actors and actresses from the home page or the people directory and they will show up here.",
  );
  renderSavedPeopleGrid(
    elements.savedFilmmakersGrid,
    savedFilmmakers,
    "filmmakers",
    "Save writers, producers, and directors from the home page or the people directory and they will show up here.",
  );

  const preferredTab =
    uiState.activeTab === "filmmakers" && savedFilmmakers.length
      ? "filmmakers"
      : savedActors.length || !savedFilmmakers.length
        ? "actors"
        : "filmmakers";
  setActiveTab(preferredTab);
  window.requestAnimationFrame(() => {
    restoreScrollState();
    syncAllRails();
  });

  if (!savedActors.length && !savedFilmmakers.length) {
    elements.savedStatus.textContent = "No saved people in this browser yet.";
    return;
  }

  elements.savedStatus.textContent = "Saved people loaded. Click a person to open their catalog.";
}

function renderSavedPeopleGrid(container, people, tabKey, emptyMessage) {
  if (!container) {
    return;
  }

  container.replaceChildren();
  const visibleCount = Math.min(uiState.visiblePeopleCounts[tabKey] || initialSavedPeopleRenderCount, people.length);

  if (!people.length) {
    container.append(buildEmptyState("No saved profiles yet.", emptyMessage));
    return;
  }

  people.slice(0, visibleCount).forEach((person) => {
    container.append(buildSavedPersonCard(person, uiState.selectedPeople[tabKey] === String(person.id)));
  });

  if (visibleCount < people.length) {
    const loader = document.createElement("div");
    loader.className = "saved-people-loader";
    loader.innerHTML = `
      <strong>Loading more saved people</strong>
      <span>Keep scrolling and the next batch will render below.</span>
    `;
    container.append(loader);
  }
}

function buildMovieCard(movie, options = {}) {
  const fragment = elements.movieTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".movie-card");
  const poster = fragment.querySelector(".movie-poster");
  const posterFrame = fragment.querySelector(".movie-poster-frame");
  if (options.extraClass) {
    article.classList.add(options.extraClass);
  }
  const cardKey = options.cardKey || `${options.extraClass || "movie"}:${movie.id}`;
  article.dataset.cardKey = cardKey;
  fragment.querySelector("h3").textContent = movie.title;
  fragment.querySelector(".pill-year").textContent = movie.year || "TBA";
  fragment.querySelector(".pill-runtime").textContent = movie.runtime || "Runtime unknown";
  fragment.querySelector(".logline").textContent = movie.logline || "No overview available yet.";
  fragment.querySelector(".rating-imdb").textContent = formatRating(movie.imdb, 1);
  fragment.querySelector(".rating-rt").textContent = formatPercent(movie.rt);
  fragment.querySelector(".rating-meta").textContent = formatInteger(movie.metacritic);
  fragment.querySelector(".rating-tmdb").textContent = formatRating(movie.tmdb, 1);
  fragment.querySelector(".cast").textContent = movie.cast?.length ? movie.cast.join(", ") : "Unknown";
  fragment.querySelector(".director").textContent = movie.director || "Unknown";
  fragment.querySelector(".producer").textContent = movie.producers?.length
    ? movie.producers.join(", ")
    : "Unknown";
  fragment.querySelector(".match-reason").textContent = movie.matchReason || "Saved from the catalog.";
  fragment.querySelector(".genres").textContent = movie.genres?.length
    ? movie.genres.join(" / ")
    : "Unknown";
  if (options.hideMatchReason) {
    fragment.querySelector(".match-reason")?.closest("div")?.remove();
  }

  if (movie.posterUrl) {
    poster.src = movie.posterUrl;
    poster.alt = `${movie.title} poster`;
  } else {
    posterFrame.classList.add("is-empty");
    poster.remove();
    posterFrame.innerHTML = `<span>${movie.title}</span>`;
  }

  const button = fragment.querySelector(".watchlist-button");
  const isSaved = watchlist.has(movie.id);
  button.textContent = options.allowToggleSave ? (isSaved ? "Remove title" : "Save title") : "Remove title";
  button.classList.toggle("is-saved", isSaved || !options.allowToggleSave);
  button.dataset.watchlistId = String(movie.id);
  if (options.allowToggleSave) {
    button.dataset.watchlistMovie = JSON.stringify(movie);
  }

  if (options.expandedByDefault) {
    article.classList.add("is-expanded");
  }
  return fragment;
}

function buildSavedPersonCard(person, isSelected) {
  const fragment = elements.personTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".saved-person-row");
  const portrait = fragment.querySelector(".person-card-portrait");
  const portraitFrame = fragment.querySelector(".person-card-visual");
  if (article) {
    article.dataset.selectPersonId = String(person.id);
    article.classList.toggle("is-selected", Boolean(isSelected));
  }

  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".person-card-role").textContent = person.department;
  fragment.querySelector(".person-card-count").textContent = person.ratingLabel || "Career score unavailable";

  const removeButton = fragment.querySelector("[data-saved-person-id]");
  removeButton.dataset.savedPersonId = String(person.id);

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

function buildSavedPersonTitleCard(movie, personId) {
  return buildMovieCard(movie, {
    extraClass: "saved-person-movie-card",
    allowToggleSave: true,
    hideMatchReason: true,
    cardKey: `person:${personId}:${movie.id}`,
  });
}

function handleRailButtonClick(event) {
  const button = event.target.closest("[data-rail-direction]");
  if (!button) {
    return;
  }

  const rail = button.closest("[data-saved-person-rail]");
  const viewport = rail?.querySelector("[data-saved-person-titles-viewport]");
  if (!viewport) {
    return;
  }

  const direction = button.dataset.railDirection === "prev" ? -1 : 1;
  const visibleCount = getVisibleRailCount(viewport);
  const step = visibleCount * (savedTitleRailCardWidth + savedTitleRailGap);
  viewport.scrollBy({ left: direction * step, behavior: "smooth" });
  window.setTimeout(() => {
    syncRail(rail);
    scheduleRailEnrichment(rail);
  }, 180);
}

function handleRailScroll(event) {
  const viewport = event.target.closest("[data-saved-person-titles-viewport]");
  if (!viewport) {
    return;
  }

  const rail = viewport.closest("[data-saved-person-rail]");
  if (rail) {
    uiState.railScrollLeft.set(rail.dataset.personId || "", viewport.scrollLeft);
    syncRail(rail);
    scheduleRailEnrichment(rail);
  }
}

function syncAllRails() {
  if (elements.savedPersonCatalog && !elements.savedPersonCatalog.hidden) {
    syncRail(elements.savedPersonCatalog);
  }
}

function syncRail(rail) {
  const viewport = rail.querySelector("[data-saved-person-titles-viewport]");
  const track = rail.querySelector("[data-saved-person-titles]");
  const countLabel = rail.querySelector("[data-saved-person-visible-count]");
  const previousButton = rail.querySelector('[data-rail-direction="prev"]');
  const nextButton = rail.querySelector('[data-rail-direction="next"]');
  const status = rail.dataset.catalogStatus || "loaded";
  const cards = [...track.children];
  const total = cards.length;
  const visibleCount = getVisibleRailCount(viewport);
  const step = savedTitleRailCardWidth + savedTitleRailGap;
  const currentIndex = Math.min(total - 1, Math.max(0, Math.round(viewport.scrollLeft / step)));
  const endIndex = Math.min(total, currentIndex + visibleCount);

  if (countLabel) {
    if (status === "loading" || status === "idle") {
      countLabel.textContent = "Loading full catalog...";
    } else if (status === "error") {
      countLabel.textContent = "Catalog unavailable";
    } else {
      countLabel.textContent = `${Math.min(visibleCount, total)} on this row · ${total ? currentIndex + 1 : 0}-${endIndex} of ${total}`;
    }
  }

  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth - 4);
  if (previousButton) {
    previousButton.disabled = status !== "loaded" || viewport.scrollLeft <= 4 || total <= visibleCount;
  }
  if (nextButton) {
    nextButton.disabled = status !== "loaded" || viewport.scrollLeft >= maxScrollLeft || total <= visibleCount;
  }
}

function getVisibleRailCount(viewport) {
  if (!viewport) {
    return 1;
  }

  return Math.max(
    1,
    Math.floor((viewport.clientWidth + savedTitleRailGap) / (savedTitleRailCardWidth + savedTitleRailGap)),
  );
}

function setActiveTab(tab, options = {}) {
  uiState.activeTab = tab === "filmmakers" ? "filmmakers" : "actors";
  if (options.clearSelection) {
    uiState.selectedPeople[uiState.activeTab] = "";
  }
  const actorsActive = uiState.activeTab === "actors";

  elements.savedActorsPanel.hidden = !actorsActive;
  elements.savedFilmmakersPanel.hidden = actorsActive;

  elements.savedTabButtons.forEach((button) => {
    const isActive = button.dataset.savedTab === uiState.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  updateSelectedPersonCards();
  renderActiveCatalogRail();
  window.requestAnimationFrame(syncAllRails);
}

function handleWindowScroll() {
  const activeTab = uiState.activeTab;
  const total = uiState.peopleByTab[activeTab]?.length || 0;
  const visible = uiState.visiblePeopleCounts[activeTab] || 0;
  if (visible >= total) {
    return;
  }

  const activePanel = activeTab === "actors" ? elements.savedActorsPanel : elements.savedFilmmakersPanel;
  if (!activePanel || activePanel.hidden) {
    return;
  }

  const rect = activePanel.getBoundingClientRect();
  if (rect.bottom - window.innerHeight < 500) {
    uiState.visiblePeopleCounts[activeTab] = Math.min(total, visible + savedPeopleRenderBatch);
    renderSavedPage();
  }
}

function handleSavedAction(event) {
  const synopsisButton = event.target.closest("[data-synopsis-toggle]");
  if (synopsisButton) {
    const card = synopsisButton.closest(".movie-card");
    if (!card) {
      return;
    }
    const isExpanded = synopsisButton.dataset.synopsisExpanded === "true";
    card.classList.toggle("is-synopsis-expanded", !isExpanded);
    synopsisButton.dataset.synopsisExpanded = !isExpanded ? "true" : "false";
    synopsisButton.textContent = !isExpanded ? "Show less" : "Show more";
    return;
  }

  const movieButton = event.target.closest("[data-watchlist-id]");
  if (movieButton) {
    const movieId = Number(movieButton.dataset.watchlistId);
    if (watchlist.has(movieId)) {
      watchlist.delete(movieId);
      watchlistMovies.delete(movieId);
    } else {
      const rawMovie = movieButton.dataset.watchlistMovie;
      if (!rawMovie) {
        return;
      }

      let movie;
      try {
        movie = JSON.parse(rawMovie);
      } catch {
        return;
      }
      watchlist.add(movieId);
      watchlistMovies.set(movieId, movie);
    }
    persistWatchlist();
    persistWatchlistMovies();
    renderSavedPage();
    return;
  }

  const personButton = event.target.closest("[data-saved-person-id]");
  if (personButton) {
    const removedPersonId = String(personButton.dataset.savedPersonId);
    const removedPerson = savedPeople.get(removedPersonId);
    savedPeople.delete(removedPersonId);
    if (removedPerson?.bucket) {
      uiState.selectedPeople[removedPerson.bucket] = "";
    }
    persistSavedPeople();
    renderSavedPage();
    return;
  }

  const personCard = event.target.closest("[data-select-person-id]");
  if (personCard) {
    const personId = String(personCard.dataset.selectPersonId || "");
    const activePeople = uiState.peopleByTab[uiState.activeTab] || [];
    const selectedPerson = activePeople.find((person) => String(person.id) === personId);
    if (!selectedPerson) {
      return;
    }
    uiState.selectedPeople[uiState.activeTab] = personId;
    updateSelectedPersonCards();
    renderActiveCatalogRail();
  }
}

function buildEmptyState(title, message) {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>`;
  return emptyState;
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

function loadWatchlist() {
  try {
    const raw = window.localStorage.getItem(watchlistStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(parsed.filter((value) => Number.isFinite(value)));
  } catch {
    return new Set();
  }
}

function loadWatchlistMovies() {
  try {
    const raw = window.localStorage.getItem(watchlistMoviesStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Map(
      parsed
        .filter((entry) => entry && Number.isFinite(entry.id))
        .map((entry) => [entry.id, entry]),
    );
  } catch {
    return new Map();
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

async function ensurePersonCatalog(person) {
  const cacheKey = String(person.id);
  const existing = personCatalogCache.get(cacheKey);
  if (existing?.status === "loading" || existing?.status === "loaded") {
    return;
  }

  personCatalogCache.set(cacheKey, {
    status: "loading",
    movies: existing?.movies || [],
  });

  try {
    const params = new URLSearchParams({
      personId: String(person.id),
      personQuery: person.name,
      role: inferCatalogRole(person),
      genre: "all",
      decade: "all",
      sort: "match",
      imdbMin: "0",
      rtMin: "0",
    });
    const payload = await fetchJson(`/api/discover?${params.toString()}`);
    personCatalogCache.set(cacheKey, {
      status: "loaded",
      movies: Array.isArray(payload.movies) ? payload.movies : [],
    });
  } catch {
    personCatalogCache.set(cacheKey, {
      status: "error",
      movies: [],
    });
  }
  updatePersonRails(cacheKey);
}

async function ensureCatalogEnrichment(personId, startIndex, count) {
  if (!personId) {
    return;
  }

  const catalogState = personCatalogCache.get(String(personId));
  if (!catalogState || catalogState.status !== "loaded" || !catalogState.movies.length) {
    return;
  }

  const pending = personCatalogEnrichment.get(String(personId)) || new Set();
  const targetMovies = catalogState.movies.slice(startIndex, startIndex + count);
  const idsToFetch = targetMovies
    .filter((movie) => movie && Number.isFinite(movie.id) && !movie.isEnriched && !pending.has(movie.id))
    .map((movie) => movie.id)
    .slice(0, 12);

  if (!idsToFetch.length) {
    return;
  }

  idsToFetch.forEach((id) => pending.add(id));
  personCatalogEnrichment.set(String(personId), pending);

  try {
    const payload = await fetchJson(`/api/enrich?ids=${idsToFetch.join(",")}`);
    const enrichedMovies = new Map((payload.movies || []).map((movie) => [movie.id, movie]));
    const nextMovies = catalogState.movies.map((movie) => enrichedMovies.get(movie.id) || movie);
    personCatalogCache.set(String(personId), {
      ...catalogState,
      movies: nextMovies,
    });
  } catch {
    // Keep base catalog cards visible even if enrichment fails.
  } finally {
    idsToFetch.forEach((id) => pending.delete(id));
    if (!pending.size) {
      personCatalogEnrichment.delete(String(personId));
    }
  }
  updatePersonRails(String(personId));
}

function inferCatalogRole(person) {
  const label = String(person.department || "").toLowerCase();
  if (
    label.includes("acting") ||
    label.includes("actor") ||
    label.includes("actress") ||
    label.includes("perform")
  ) {
    return "cast";
  }
  if (label.includes("direct") && !label.includes("produc")) {
    return "director";
  }
  if (label.includes("produc") && !label.includes("direct")) {
    return "producer";
  }
  return "any";
}

function captureScrollState() {
  const rail = elements.savedPersonCatalog;
  const personId = rail?.dataset.personId || "";
  const viewport = rail?.querySelector("[data-saved-person-titles-viewport]");
  if (personId && viewport) {
    uiState.railScrollLeft.set(personId, viewport.scrollLeft);
  }

}

function restoreScrollState() {
  const rail = elements.savedPersonCatalog;
  const personId = rail?.dataset.personId || "";
  const viewport = rail?.querySelector("[data-saved-person-titles-viewport]");
  if (personId && viewport) {
    viewport.scrollLeft = uiState.railScrollLeft.get(personId) || 0;
  }

}

function scheduleRailEnrichment(rail) {
  const personId = rail.dataset.personId || "";
  if (!personId || rail.dataset.catalogStatus !== "loaded") {
    return;
  }

  const existingTimer = uiState.railEnrichmentTimers.get(personId);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timerId = window.setTimeout(() => {
    uiState.railEnrichmentTimers.delete(personId);
    const viewport = rail.querySelector("[data-saved-person-titles-viewport]");
    if (!viewport) {
      return;
    }
    const visibleCount = getVisibleRailCount(viewport);
    const step = savedTitleRailCardWidth + savedTitleRailGap;
    const currentIndex = Math.max(0, Math.round(viewport.scrollLeft / step));
    ensureCatalogEnrichment(
      personId,
      currentIndex,
      Math.max(visibleCount * 2, visibleCount + 2),
    );
  }, 220);

  uiState.railEnrichmentTimers.set(personId, timerId);
}

function updatePersonRails(personId) {
  if (elements.savedPersonCatalog?.dataset.personId === String(personId)) {
    renderPersonRail(elements.savedPersonCatalog, personId);
  }
}

function renderActiveCatalogRail() {
  const activePeople = uiState.peopleByTab[uiState.activeTab] || [];
  const selectedPersonId = resolveSelectedPersonId(uiState.activeTab, activePeople);
  uiState.selectedPeople[uiState.activeTab] = selectedPersonId;

  if (!elements.savedPersonCatalog) {
    return;
  }

  if (!selectedPersonId) {
    elements.savedPersonCatalog.hidden = true;
    elements.savedPersonCatalog.removeAttribute("data-person-id");
    elements.savedPersonCatalog.dataset.catalogStatus = "idle";
    const track = elements.savedPersonCatalog.querySelector("[data-saved-person-titles]");
    track?.replaceChildren();
    if (elements.savedPersonCatalogName) {
      elements.savedPersonCatalogName.textContent = "";
    }
    return;
  }

  const person = activePeople.find((entry) => String(entry.id) === String(selectedPersonId)) || savedPeople.get(String(selectedPersonId));
  if (elements.savedPersonCatalogName) {
    elements.savedPersonCatalogName.textContent = person?.name || "";
  }
  elements.savedPersonCatalog.hidden = false;
  renderPersonRail(elements.savedPersonCatalog, selectedPersonId);
  if (person) {
    ensurePersonCatalog(person);
  }
}

function renderPersonRail(rail, personId) {
  const viewport = rail.querySelector("[data-saved-person-titles-viewport]");
  const titlesTrack = rail.querySelector("[data-saved-person-titles]");
  const railLabel = rail.querySelector(".saved-person-titles-label");
  const previousScrollLeft = viewport?.scrollLeft || uiState.railScrollLeft.get(personId) || 0;
  const person = savedPeople.get(String(personId));
  const catalogState = personCatalogCache.get(String(personId)) || {
    status: "idle",
    movies: [],
  };

  rail.dataset.catalogStatus = catalogState.status;
  rail.dataset.personId = String(personId);
  if (railLabel) {
    railLabel.textContent = catalogState.status === "loaded" ? "Full catalog" : "Loading catalog";
  }
  if (!titlesTrack) {
    return;
  }

  titlesTrack.replaceChildren();
  const row = rail.closest(".saved-person-row");
  row?.classList.toggle("is-empty-rail", catalogState.status !== "loaded" || !catalogState.movies.length);

  if (catalogState.status === "loading" || catalogState.status === "idle") {
    const loading = document.createElement("div");
    loading.className = "saved-person-title-card is-placeholder is-loading-card";
    loading.innerHTML = `
      <p class="saved-person-title-card-label">Loading titles</p>
      <h4>${escapeHtml(person?.name || "Saved person")}</h4>
      <p class="saved-person-title-card-copy">Pulling this person's catalog now.</p>
    `;
    titlesTrack.append(loading);
  } else if (catalogState.status === "error") {
    const error = document.createElement("div");
    error.className = "saved-person-title-card is-placeholder";
    error.innerHTML = `
      <p class="saved-person-title-card-label">Catalog unavailable</p>
      <h4>${escapeHtml(person?.knownFor?.[0] || person?.name || "Saved person")}</h4>
      <p class="saved-person-title-card-copy">We couldn't load titles for this person right now.</p>
    `;
    titlesTrack.append(error);
  } else if (!catalogState.movies.length) {
    const empty = document.createElement("div");
    empty.className = "saved-person-title-card is-placeholder";
    empty.innerHTML = `
      <p class="saved-person-title-card-label">No titles found</p>
      <h4>${escapeHtml(person?.knownFor?.[0] || "Known-for titles unavailable")}</h4>
      <p class="saved-person-title-card-copy">No catalog titles came back for this saved person.</p>
    `;
    titlesTrack.append(empty);
  } else {
    catalogState.movies.forEach((movie) => {
      titlesTrack.append(buildSavedPersonTitleCard(movie, personId));
    });
  }

  if (viewport) {
    viewport.scrollLeft = previousScrollLeft;
    uiState.railScrollLeft.set(String(personId), previousScrollLeft);
  }
  window.requestAnimationFrame(() => refreshSynopsisToggles(rail));
  syncRail(rail);
  scheduleRailEnrichment(rail);
}

function refreshSynopsisToggles(container) {
  container?.querySelectorAll(".movie-card").forEach((card) => {
    const logline = card.querySelector(".logline");
    const button = card.querySelector(".synopsis-toggle");
    if (!logline || !button) {
      return;
    }
    const hasOverflow = logline.scrollHeight - logline.clientHeight > 2;
    if (!hasOverflow) {
      button.hidden = true;
      button.removeAttribute("data-synopsis-toggle");
      button.dataset.synopsisExpanded = "false";
      card.classList.remove("is-synopsis-expanded");
      return;
    }
    button.hidden = false;
    button.dataset.synopsisToggle = "true";
    const isExpanded = card.classList.contains("is-synopsis-expanded");
    button.dataset.synopsisExpanded = isExpanded ? "true" : "false";
    button.textContent = isExpanded ? "Show less" : "Show more";
  });
}

function resolveSelectedPersonId(tabKey, people) {
  const existing = String(uiState.selectedPeople[tabKey] || "");
  if (existing && people.some((person) => String(person.id) === existing)) {
    return existing;
  }
  return "";
}

function updateSelectedPersonCards() {
  document.querySelectorAll("[data-select-person-id]").forEach((card) => {
    const personId = String(card.dataset.selectPersonId || "");
    const tabKey = elements.savedActorsGrid?.contains(card) ? "actors" : "filmmakers";
    card.classList.toggle("is-selected", uiState.selectedPeople[tabKey] === personId);
  });
}
async function fetchJson(url) {
  const response = await window.fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function debounce(callback, delayMs) {
  let timeoutId = 0;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cssEscape(value) {
  return String(value).replaceAll('"', '\\"');
}
