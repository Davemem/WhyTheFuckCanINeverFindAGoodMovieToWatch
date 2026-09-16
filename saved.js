const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
const savedPeopleStorageKey = "wtfcineverfind-saved-people";
const savedTitleRailCardWidth = 280;
const savedTitleRailGap = 10;
const peopleBuckets = ["actors", "writers", "directors", "producers", "studios", "filmmakers"];
const peoplePanels = Object.fromEntries(peopleBuckets.map(key => [key, document.querySelector(`#saved-${key}-panel`)]));
const peopleGrids = Object.fromEntries(peopleBuckets.map(key => [key, document.querySelector(`#saved-${key}-grid`)]));
let peopleQuery = "";

const elements = {
  savedStatus: document.querySelector("#saved-status"),
  savedActorCount: document.querySelector("#saved-actor-count"),
  savedWriterCount: document.querySelector("#saved-writer-count"),
  savedFilmmakerCount: document.querySelector("#saved-filmmaker-count"),
  savedActorsGrid: document.querySelector("#saved-actors-grid"),
  savedWritersGrid: document.querySelector("#saved-writers-grid"),
  savedFilmmakersGrid: document.querySelector("#saved-filmmakers-grid"),
  savedActorsPanel: document.querySelector("#saved-actors-panel"),
  savedWritersPanel: document.querySelector("#saved-writers-panel"),
  savedFilmmakersPanel: document.querySelector("#saved-filmmakers-panel"),
  savedPersonCatalog: document.querySelector("#saved-person-catalog"),
  savedPersonRail: document.querySelector("[data-saved-person-rail]"),
  savedPersonCatalogName: document.querySelector("#saved-person-catalog-name"),
  savedTabButtons: [...document.querySelectorAll("[data-saved-tab]")],
  movieTemplate: document.querySelector("#movie-card-template"),
  personTemplate: document.querySelector("#saved-person-card-template"),
};

const savedDataClient = window.savedDataClient || null;
const watchlist = new Set();
const watchlistMovies = new Map();
const watched = new Set();
const watchedMovies = new Map();
const savedPeople = new Map();
const personCatalogCache = new Map();
const personCatalogEnrichment = new Map();
let savedStateSource = "local";
let savedStateError = "";
let lastCatalogTrigger = null;
const uiState = {
  activeTab: "actors",
  peopleByTab: {
    actors: [],
    writers: [],
    filmmakers: [],
  },
  selectedPeople: {
    actors: "",
    writers: "",
    filmmakers: "",
  },
  railScrollLeft: new Map(),
  railEnrichmentTimers: new Map(),
};

for (const key of peopleBuckets) { uiState.peopleByTab[key] ||= []; uiState.selectedPeople[key] ||= ""; }

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

Object.values(peopleGrids).forEach(grid => {
  grid?.addEventListener("click", handleSavedAction);
  if (!grid) return;
  grid.tabIndex = 0; grid.setAttribute("role", "region"); grid.setAttribute("aria-label", "Saved profiles, horizontally scrollable");
  grid.addEventListener("scroll", syncPeopleArrows, { passive: true });
  grid.addEventListener("keydown", event => {
    if (event.target !== grid || !["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") grid.scrollLeft = 0;
    else if (event.key === "End") grid.scrollLeft = grid.scrollWidth;
    else scrollPeople(event.key === "ArrowLeft" ? -1 : 1);
  });
});
document.querySelector("#saved-people-search")?.addEventListener("input", event => {
  peopleQuery = event.target.value.trim().toLocaleLowerCase();
  document.querySelector("#clear-people-search").hidden = !peopleQuery;
  renderSavedPage();
});
document.querySelector("#clear-people-search")?.addEventListener("click", () => {
  peopleQuery = ""; document.querySelector("#saved-people-search").value = "";
  document.querySelector("#clear-people-search").hidden = true; renderSavedPage();
});
document.querySelector("#saved-people-prev")?.addEventListener("click", () => scrollPeople(-1));
document.querySelector("#saved-people-next")?.addEventListener("click", () => scrollPeople(1));
elements.savedPersonCatalog?.addEventListener("click", handleSavedAction);
elements.savedPersonCatalog?.addEventListener("close", handleCatalogClose);
if (elements.savedPersonRail) {
  window.MovieResults.bindRail(elements.savedPersonRail, {
    cardWidth: savedTitleRailCardWidth,
    gap: savedTitleRailGap,
    statusText: {
      loading: "Loading full catalog...",
      error: "Catalog unavailable",
      empty: "No titles available",
    },
    onScroll: (rail, viewport) => {
      uiState.railScrollLeft.set(rail.dataset.personId || "", viewport.scrollLeft);
      syncRail(rail);
      scheduleRailEnrichment(rail);
    },
  });
}
elements.savedTabButtons.forEach((button) => {
  button.addEventListener("click", () =>
    setActiveTab(button.dataset.savedTab || "actors", { clearSelection: true }),
  );
  button.addEventListener("keydown", handleSavedTabKeydown);
});
window.addEventListener("resize", debounce(syncAllRails, 120));
window.addEventListener(
  "resize",
  debounce(() => {
    if (elements.savedPersonRail) {
      refreshSynopsisToggles(elements.savedPersonRail);
    }
  }, 120),
);
window.addEventListener("resize", debounce(syncPeopleArrows, 120));

renderSavedPage();

function personBucket(person) {
  if (peopleBuckets.includes(person.kind)) return person.kind;
  const label = String(person.department || "").toLowerCase();
  if (String(person.id).startsWith("studio:") || label.includes("studio")) return "studios";
  if (isWriterPerson(person) || person.bucket === "writers") return "writers";
  if (person.bucket === "actors" || /acting|actor|perform/.test(label)) return "actors";
  if (label.includes("direct") && !label.includes("produc")) return "directors";
  if (label.includes("produc") && !label.includes("direct")) return "producers";
  return "filmmakers";
}

function renderSavedPage() {
  captureScrollState();
  const all = [...savedPeople.values()];
  for (const key of peopleBuckets) {
    const group = all.filter(person => personBucket(person) === key);
    uiState.peopleByTab[key] = group.filter(person => !peopleQuery || [person.name, ...(person.knownFor || [])].join(" ").toLocaleLowerCase().includes(peopleQuery));
    uiState.selectedPeople[key] = resolveSelectedPersonId(key, uiState.peopleByTab[key]);
    renderSavedPeopleGrid(peopleGrids[key], uiState.peopleByTab[key], key, peopleQuery ? "Try a different name or known-for title." : "Save profiles from Discover and they will appear here.");
    const tab = elements.savedTabButtons.find(button => button.dataset.savedTab === key);
    if (tab) { tab.textContent = (key === "filmmakers" ? "Other filmmakers" : key[0].toUpperCase() + key.slice(1)) + " (" + group.length + ")"; tab.hidden = key === "filmmakers" && !group.length; }
  }
  elements.savedActorCount.textContent = String(all.filter(p => personBucket(p) === "actors").length);
  elements.savedWriterCount.textContent = String(all.filter(p => personBucket(p) === "writers").length);
  elements.savedFilmmakerCount.textContent = String(all.filter(p => !["actors","writers"].includes(personBucket(p))).length);
  const preferred = uiState.peopleByTab[uiState.activeTab]?.length ? uiState.activeTab : peopleBuckets.find(key => uiState.peopleByTab[key].length) || "actors";
  setActiveTab(preferred);
  window.requestAnimationFrame(() => { restoreScrollState(); syncAllRails(); syncPeopleArrows(); });
  elements.savedStatus.textContent = !all.length ? emptySavedPeopleMessage() : savedStateSource === "remote"
    ? "Saved profiles are synced to your account. Open a profile to browse its movies and TV shows."
    : "Saved profiles stay on this browser. Open a profile to browse its movies and TV shows.";
}

function renderSavedPeopleGrid(container, people, tabKey, emptyMessage) {
  if (!container) return;
  const left = container.scrollLeft;
  container.replaceChildren();
  if (!people.length) container.append(buildEmptyState(peopleQuery ? "No matching profiles." : "No saved profiles yet.", emptyMessage));
  else people.forEach(person => container.append(buildSavedPersonCard(person, uiState.selectedPeople[tabKey] === String(person.id))));
  container.scrollLeft = left;
}

function scrollPeople(direction) {
  const grid = peopleGrids[uiState.activeTab];
  if (!grid) return;
  const left = direction * Math.max(220, grid.clientWidth * .85);
  if (grid.scrollBy) grid.scrollBy({left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
  else grid.scrollLeft += left;
  syncPeopleArrows();
}
function syncPeopleArrows() {
  const grid = peopleGrids[uiState.activeTab];
  const prev = document.querySelector("#saved-people-prev"), next = document.querySelector("#saved-people-next");
  if (!grid || !prev || !next) return;
  prev.disabled = grid.scrollLeft <= 2;
  next.disabled = grid.scrollWidth - grid.clientWidth - grid.scrollLeft <= 2;
}

function buildMovieCard(movie, options = {}) {
  return window.MovieResults.buildMovieCard(elements.movieTemplate, movie, {
    ...options,
    defaultMatchReason: "Saved from the catalog.",
    forceSavedButton: !options.allowToggleSave,
    isSaved: watchlist.has(movie.id),
    isWatched: watched.has(movie.id),
  });
}

function buildSavedPersonCard(person, isSelected) {
  const fragment = elements.personTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".saved-person-row");
  const portrait = fragment.querySelector(".person-card-portrait");
  const portraitFrame = fragment.querySelector(".person-card-visual");
  if (article) {
    article.dataset.selectPersonId = String(person.id);
    article.tabIndex = -1;
    article.classList.toggle("is-selected", Boolean(isSelected));
  }

  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".person-card-role").textContent = person.department;
  fragment.querySelector(".person-card-count").textContent = person.ratingLabel || "Career score unavailable";

  const removeButton = fragment.querySelector("[data-saved-person-id]");
  removeButton.dataset.savedPersonId = String(person.id);
  removeButton.textContent = personBucket(person) === "studios" ? "Remove studio" : "Remove person";
  removeButton.setAttribute("aria-label", `Remove ${person.name} from saved profiles`);
  fragment.querySelector("[data-open-saved-person-catalog]").setAttribute("aria-label", `View titles from ${person.name}`);

  if (person.profileUrl) {
    portrait.src = person.profileUrl;
    portrait.alt = person.name;
  } else {
    portraitFrame.classList.add("is-empty");
    portrait.remove();
    const fallbackName = document.createElement("span");
    fallbackName.textContent = person.name;
    portraitFrame.replaceChildren(fallbackName);
  }
  return fragment;
}

function buildSavedPersonTitleCard(movie, personId) {
  return buildMovieCard(movie, {
    extraClass: "saved-person-movie-card",
    allowToggleSave: true,
    hideMatchReason: true,
    hideCredits: true,
    hideSynopsisToggle: true,
    cardKey: `person:${personId}:${movie.id}`,
  });
}

function syncAllRails() {
  if (elements.savedPersonCatalog?.open && elements.savedPersonRail) {
    syncRail(elements.savedPersonRail);
  }
}

function syncRail(rail) {
  rail.dataset.railStatus = rail.dataset.catalogStatus || "loaded";
  window.MovieResults.syncRail(rail, {
    cardWidth: savedTitleRailCardWidth,
    gap: savedTitleRailGap,
    statusText: {
      loading: "Loading full catalog...",
      error: "Catalog unavailable",
      empty: "No titles available",
    },
  });
}

function getVisibleRailCount(viewport) {
  return window.MovieResults.getVisibleRailCount(viewport, {
    cardWidth: savedTitleRailCardWidth,
    gap: savedTitleRailGap,
  });
}

function setActiveTab(tab, options = {}) {
  uiState.activeTab = peopleBuckets.includes(tab) ? tab : "actors";
  if (options.clearSelection) uiState.selectedPeople[uiState.activeTab] = "";
  for (const key of peopleBuckets) if (peoplePanels[key]) peoplePanels[key].hidden = key !== uiState.activeTab;

  elements.savedTabButtons.forEach((button) => {
    const isActive = button.dataset.savedTab === uiState.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });

  updateSelectedPersonCards();
  renderActiveCatalogRail();
  window.requestAnimationFrame(() => { syncAllRails(); syncPeopleArrows(); });
}

function handleSavedTabKeydown(event) {
  const tabs = elements.savedTabButtons.filter(button => !button.hidden);
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = tabs.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextButton = tabs[nextIndex];
  nextButton.focus();
  setActiveTab(nextButton.dataset.savedTab || "actors", { clearSelection: true });
}

function handleSavedAction(event) {
  if (
    event.target.closest("[data-close-saved-person-catalog]")
    || event.target === elements.savedPersonCatalog
  ) {
    elements.savedPersonCatalog?.close();
    return;
  }

  const watchedButton = event.target.closest("[data-watched-id]");
  if (watchedButton && savedDataClient) {
    const movieId = window.TitleIdentity.key(watchedButton.dataset.watchedId);
    let movie = watchlistMovies.get(movieId) || watchedMovies.get(movieId);
    if (!movie) {
      try {
        movie = JSON.parse(watchedButton.dataset.watchedMovie || "{}");
      } catch {
        return;
      }
    }
    savedDataClient.toggleWatched(movie).catch((error) => {
      elements.savedStatus.textContent = error.message;
    });
    return;
  }

  const movieButton = event.target.closest("[data-watchlist-id]");
  if (movieButton) {
    const movieId = window.TitleIdentity.key(movieButton.dataset.watchlistId);
    if (savedDataClient) {
      let movie = null;
      if (!watchlist.has(movieId)) {
        const rawMovie = movieButton.dataset.watchlistMovie;
        if (!rawMovie) {
          return;
        }
        try {
          movie = JSON.parse(rawMovie);
        } catch {
          return;
        }
      } else {
        movie = { id: movieId };
      }
      savedDataClient.toggleTitle(movie).catch((error) => {
        elements.savedStatus.textContent = error.message;
      });
      return;
    }

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
    if (savedDataClient) {
      savedDataClient.removePerson(removedPersonId).catch((error) => {
        elements.savedStatus.textContent = error.message;
      });
      return;
    }
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
    lastCatalogTrigger = event.target.closest("[data-open-saved-person-catalog]") || personCard;
    updateSelectedPersonCards();
    renderActiveCatalogRail();
    if (elements.savedPersonCatalog && !elements.savedPersonCatalog.open) {
      elements.savedPersonCatalog.showModal();
    }
    window.requestAnimationFrame(syncAllRails);
  }
}

function handleCatalogClose() {
  uiState.selectedPeople[uiState.activeTab] = "";
  updateSelectedPersonCards();
  if (lastCatalogTrigger instanceof HTMLElement && document.contains(lastCatalogTrigger)) {
    lastCatalogTrigger.focus({ preventScroll: true });
  }
  lastCatalogTrigger = null;
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
    return new Set(parsed.map(window.TitleIdentity.key).filter(window.TitleIdentity.valid));
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
        .filter((entry) => entry && window.TitleIdentity.valid(entry))
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

function handleSavedDataUpdate(snapshot) {
  syncSavedCollections(snapshot);
  renderSavedPage();
}

function syncSavedCollections(snapshot) {
  savedStateSource = snapshot.source || "local";
  savedStateError = snapshot.error || "";

  watchlist.clear();
  (snapshot.watchlistIds || []).forEach((movieId) => {
    if (window.TitleIdentity.valid(movieId)) {
      watchlist.add(window.TitleIdentity.key(movieId));
    }
  });

  watchlistMovies.clear();
  (snapshot.watchlistMovies || []).forEach((movie) => {
    if (movie && window.TitleIdentity.valid(movie)) {
      watchlistMovies.set(window.TitleIdentity.key(movie.id), movie);
    }
  });

  savedPeople.clear();
  (snapshot.savedPeople || []).forEach((person) => {
    if (person?.id && person?.name) {
      savedPeople.set(String(person.id), person);
    }
  });

  watched.clear();
  (snapshot.watchedIds || []).forEach((movieId) => watched.add(window.TitleIdentity.key(movieId)));
  watchedMovies.clear();
  (snapshot.watchedMovies || []).forEach((movie) => watchedMovies.set(window.TitleIdentity.key(movie.id), movie));
}

function emptySavedPeopleMessage() {
  if (savedStateSource === "remote") {
    return "No saved people in your account yet.";
  }
  if (savedStateSource === "remote-error" && savedStateError) {
    return "Your account saved people could not load right now.";
  }
  return "No saved people in this browser yet.";
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
      personId: /^\d+$/.test(String(person.id)) ? String(person.id) : "",
      mediaType: "both",
      searchType: personBucket(person) === "studios" ? "studio" : "person",
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
    .filter((movie) => movie && window.TitleIdentity.valid(movie) && !movie.isEnriched && !pending.has(movie.id))
    .map((movie) => movie.id)
    .slice(0, 12);

  if (!idsToFetch.length) {
    return;
  }

  idsToFetch.forEach((id) => pending.add(id));
  personCatalogEnrichment.set(String(personId), pending);

  try {
    for (let offset = 0; offset < idsToFetch.length; offset += 2) {
      const batch = idsToFetch.slice(offset, offset + 2);
      const payload = await fetchJson(`/api/enrich?ids=${batch.join(",")}`);
      const enrichedMovies = new Map((payload.movies || []).map((movie) => [movie.id, movie]));
      const latest = personCatalogCache.get(String(personId));
      if (!latest) return;
      personCatalogCache.set(String(personId), {
        ...latest,
        movies: latest.movies.map((movie) => {
          const enriched = enrichedMovies.get(movie.id);
          return enriched ? { ...movie, ...enriched, matchReason: movie.matchReason || enriched.matchReason } : movie;
        }),
      });
      updatePersonRails(String(personId));
    }
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
  if (label.includes("writ") || label.includes("screenplay") || label.includes("story")) {
    return "writer";
  }
  return "any";
}

function captureScrollState() {
  const rail = elements.savedPersonRail;
  const personId = rail?.dataset.personId || "";
  const viewport = rail?.querySelector("[data-saved-person-titles-viewport]");
  if (personId && viewport) {
    uiState.railScrollLeft.set(personId, viewport.scrollLeft);
  }

}

function restoreScrollState() {
  const rail = elements.savedPersonRail;
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
  if (elements.savedPersonRail?.dataset.personId === String(personId)) {
    renderPersonRail(elements.savedPersonRail, personId);
  }
}

function renderActiveCatalogRail() {
  const activePeople = uiState.peopleByTab[uiState.activeTab] || [];
  const selectedPersonId = resolveSelectedPersonId(uiState.activeTab, activePeople);
  uiState.selectedPeople[uiState.activeTab] = selectedPersonId;

  if (!elements.savedPersonCatalog || !elements.savedPersonRail) {
    return;
  }

  if (!selectedPersonId) {
    if (elements.savedPersonCatalog.open) {
      elements.savedPersonCatalog.close();
    }
    elements.savedPersonRail.removeAttribute("data-person-id");
    elements.savedPersonRail.dataset.catalogStatus = "idle";
    const track = elements.savedPersonRail.querySelector("[data-saved-person-titles]");
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
  renderPersonRail(elements.savedPersonRail, selectedPersonId);
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
  rail.dataset.railStatus = catalogState.status;
  rail.dataset.personId = String(personId);
  if (railLabel) {
    railLabel.textContent = catalogState.status === "loaded" ? "Full catalog" : "Loading catalog";
  }
  if (!titlesTrack) {
    return;
  }

  titlesTrack.replaceChildren();
  delete rail.dataset.renderError;
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
      try {
        titlesTrack.append(buildSavedPersonTitleCard(movie, personId));
      } catch (error) {
        rail.dataset.renderError = error instanceof Error ? error.message : "Unable to render title card";
      }
    });
    if (!titlesTrack.children.length) {
      const error = document.createElement("div");
      error.className = "saved-person-title-card is-placeholder";
      error.innerHTML = `
        <p class="saved-person-title-card-label">Catalog unavailable</p>
        <h4>${escapeHtml(person?.name || "Saved person")}</h4>
        <p class="saved-person-title-card-copy">The title cards could not be displayed right now.</p>
      `;
      titlesTrack.append(error);
    }
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
    const tabKey = peopleBuckets.find(key => peopleGrids[key]?.contains(card));
    card.classList.toggle("is-selected", uiState.selectedPeople[tabKey] === personId);
  });
}

function isWriterPerson(person) {
  const label = String(person?.department || "").toLowerCase();
  return label.includes("writ") || label.includes("screenplay") || label.includes("story");
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
