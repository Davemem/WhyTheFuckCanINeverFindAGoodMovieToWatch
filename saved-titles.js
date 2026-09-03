const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";

const elements = {
  status: document.querySelector("#saved-titles-status"),
  count: document.querySelector("#saved-titles-count"),
  genres: document.querySelector("#saved-titles-genres"),
  rating: document.querySelector("#saved-titles-rating"),
  viewStatus: document.querySelector("#saved-titles-view-status"),
  search: document.querySelector("#saved-titles-search"),
  sort: document.querySelector("#saved-titles-sort"),
  grid: document.querySelector("#saved-titles-grid"),
  template: document.querySelector("#movie-card-template"),
  notice: document.querySelector("[data-saved-title-notice]"),
  noticeText: document.querySelector("[data-saved-title-notice-text]"),
  undoButton: document.querySelector("[data-undo-title-removal]"),
};

const savedDataClient = window.savedDataClient || null;
const watchlist = new Set();
const watchlistMovies = new Map();
const viewState = {
  query: "",
  sort: "recent",
};

let savedStateSource = "local";
let savedStateError = "";
let lastRemovedMovie = null;
let noticeTimeoutId = 0;

elements.grid?.addEventListener("click", handleGridClick);
elements.search?.addEventListener("input", () => {
  viewState.query = elements.search.value.trim();
  renderSavedTitlesPage();
});
elements.sort?.addEventListener("change", () => {
  viewState.sort = elements.sort.value;
  renderSavedTitlesPage();
});
elements.undoButton?.addEventListener("click", handleUndoRemoval);
window.addEventListener("resize", debounce(() => refreshSynopsisToggles(elements.grid), 120));

if (savedDataClient) {
  savedDataClient.subscribe(handleSavedDataUpdate);
} else {
  syncSavedCollections({
    watchlistIds: [...loadWatchlist()],
    watchlistMovies: [...loadWatchlistMovies().values()],
    source: "local",
    error: "",
  });
  renderSavedTitlesPage();
}

function renderSavedTitlesPage() {
  const allMovies = getSavedMovies();
  const visibleMovies = sortMovies(
    allMovies.filter((movie) => movieMatchesQuery(movie, viewState.query)),
    viewState.sort,
  );

  renderSummary(allMovies);
  renderStatus(allMovies.length, visibleMovies.length);

  if (!elements.grid) {
    return;
  }

  elements.grid.replaceChildren();

  if (!allMovies.length) {
    elements.grid.append(buildEmptyState(
      "No saved titles yet",
      "Save a title from the catalog and it will appear here, ready for your next movie night.",
      { linkHref: "/", linkLabel: "Browse the catalog" },
    ));
    return;
  }

  if (!visibleMovies.length) {
    elements.grid.append(buildEmptyState(
      "No titles match your search",
      "Try another title, genre, cast member, or director.",
      { clearFilters: true },
    ));
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleMovies.forEach((movie) => {
    fragment.append(buildMovieCard(movie));
  });
  elements.grid.append(fragment);
  window.requestAnimationFrame(() => refreshSynopsisToggles(elements.grid));
}

function getSavedMovies() {
  return [...watchlist]
    .map((movieId, index) => {
      const movie = watchlistMovies.get(movieId);
      return movie ? { ...movie, __savedOrder: index } : null;
    })
    .filter(Boolean);
}

function renderSummary(movies) {
  if (elements.count) {
    elements.count.textContent = String(movies.length);
  }

  const uniqueGenres = new Set();
  const imdbRatings = [];
  movies.forEach((movie) => {
    (Array.isArray(movie.genres) ? movie.genres : []).forEach((genre) => {
      const label = String(genre || "").trim();
      if (label) {
        uniqueGenres.add(label.toLocaleLowerCase());
      }
    });
    if (hasNumericValue(movie.imdb)) {
      imdbRatings.push(Number(movie.imdb));
    }
  });

  if (elements.genres) {
    elements.genres.textContent = String(uniqueGenres.size);
  }
  if (elements.rating) {
    const average = imdbRatings.length
      ? imdbRatings.reduce((total, rating) => total + rating, 0) / imdbRatings.length
      : null;
    elements.rating.textContent = average === null ? "—" : average.toFixed(1);
  }
}

function renderStatus(total, visible) {
  if (elements.status) {
    if (!total) {
      elements.status.textContent = emptySavedTitlesMessage();
    } else {
      elements.status.textContent = savedStateSource === "remote"
        ? "Your watchlist is synced to your account."
        : "Your watchlist is saved in this browser.";
    }
  }

  if (!elements.viewStatus) {
    return;
  }

  if (!total) {
    elements.viewStatus.textContent = "Your saved titles will appear here.";
    return;
  }

  const noun = total === 1 ? "title" : "titles";
  elements.viewStatus.textContent = viewState.query
    ? `Showing ${visible} of ${total} saved ${noun}.`
    : `${total} saved ${noun}.`;
}

function buildMovieCard(movie) {
  const fragment = window.MovieResults.buildMovieCard(elements.template, movie, {
    extraClass: "saved-title-card",
    hideMatchReason: true,
    forceSavedButton: true,
    isSaved: true,
    savedButtonLabel: "Remove",
  });

  const article = fragment.querySelector(".movie-card");
  const heading = fragment.querySelector("h3");
  const logline = fragment.querySelector(".logline");
  const synopsisButton = fragment.querySelector(".synopsis-toggle");
  const removeButton = fragment.querySelector(".watchlist-button");
  const safeId = String(movie.id).replaceAll(/[^a-zA-Z0-9_-]/g, "-");

  if (article && heading) {
    heading.id = `saved-title-${safeId}`;
    article.setAttribute("aria-labelledby", heading.id);
  }
  if (logline && synopsisButton) {
    logline.id = `saved-title-synopsis-${safeId}`;
    synopsisButton.setAttribute("aria-controls", logline.id);
    synopsisButton.setAttribute("aria-expanded", "false");
  }
  if (removeButton) {
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${movie.title || "this title"} from your watchlist`);
  }

  return fragment;
}

function handleGridClick(event) {
  const clearButton = event.target.closest("[data-clear-saved-filters]");
  if (clearButton) {
    clearFilters();
    return;
  }

  const synopsisButton = event.target.closest("[data-synopsis-toggle]");
  if (synopsisButton) {
    const card = synopsisButton.closest(".movie-card");
    if (!card) {
      return;
    }
    const isExpanded = synopsisButton.dataset.synopsisExpanded === "true";
    card.classList.toggle("is-synopsis-expanded", !isExpanded);
    synopsisButton.dataset.synopsisExpanded = !isExpanded ? "true" : "false";
    synopsisButton.setAttribute("aria-expanded", !isExpanded ? "true" : "false");
    synopsisButton.textContent = !isExpanded ? "Show less" : "Show more";
    return;
  }

  const movieButton = event.target.closest("[data-watchlist-id]");
  if (!movieButton || movieButton.disabled) {
    return;
  }

  removeSavedTitle(Number(movieButton.dataset.watchlistId), movieButton);
}

async function removeSavedTitle(movieId, button) {
  const movie = watchlistMovies.get(movieId);
  if (!movie) {
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Removing…";

  try {
    if (savedDataClient) {
      await savedDataClient.removeTitle(movieId);
    } else {
      watchlist.delete(movieId);
      watchlistMovies.delete(movieId);
      persistWatchlist();
      persistWatchlistMovies();
      renderSavedTitlesPage();
    }
    lastRemovedMovie = movie;
    showUndoNotice(`${movie.title || "Title"} removed from your watchlist.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    if (elements.status) {
      elements.status.textContent = error instanceof Error ? error.message : "Unable to remove that title.";
    }
  }
}

async function handleUndoRemoval() {
  const movie = lastRemovedMovie;
  if (!movie || !elements.undoButton || elements.undoButton.disabled) {
    return;
  }

  elements.undoButton.disabled = true;
  elements.undoButton.textContent = "Restoring…";

  try {
    if (savedDataClient) {
      await savedDataClient.toggleTitle(movie);
    } else {
      watchlist.add(Number(movie.id));
      watchlistMovies.set(Number(movie.id), movie);
      persistWatchlist();
      persistWatchlistMovies();
      renderSavedTitlesPage();
    }
    hideUndoNotice();
    if (elements.status) {
      elements.status.textContent = `${movie.title || "Title"} restored to your watchlist.`;
    }
  } catch (error) {
    elements.undoButton.disabled = false;
    elements.undoButton.textContent = "Undo";
    if (elements.noticeText) {
      elements.noticeText.textContent = error instanceof Error ? error.message : "Unable to restore that title.";
    }
  }
}

function showUndoNotice(message) {
  window.clearTimeout(noticeTimeoutId);
  if (!elements.notice || !elements.noticeText || !elements.undoButton) {
    return;
  }
  elements.noticeText.textContent = message;
  elements.undoButton.disabled = false;
  elements.undoButton.textContent = "Undo";
  elements.notice.hidden = false;
  noticeTimeoutId = window.setTimeout(hideUndoNotice, 8000);
}

function hideUndoNotice() {
  window.clearTimeout(noticeTimeoutId);
  lastRemovedMovie = null;
  if (elements.notice) {
    elements.notice.hidden = true;
  }
}

function clearFilters() {
  viewState.query = "";
  if (elements.search) {
    elements.search.value = "";
    elements.search.focus();
  }
  renderSavedTitlesPage();
}

function movieMatchesQuery(movie, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchableFields = [
    movie.title,
    movie.year,
    movie.runtime,
    ...(Array.isArray(movie.genres) ? movie.genres : []),
    ...(Array.isArray(movie.cast) ? movie.cast : []),
    movie.director,
    ...(Array.isArray(movie.producers) ? movie.producers : []),
  ];
  return normalizeSearchText(searchableFields.filter(Boolean).join(" ")).includes(normalizedQuery);
}

function sortMovies(movies, sortMode) {
  return [...movies].sort((left, right) => {
    if (sortMode === "title") {
      return compareTitles(left, right);
    }
    if (sortMode === "year") {
      return compareNumbersDescending(left.year, right.year) || compareTitles(left, right);
    }
    if (sortMode === "rating") {
      return compareNumbersDescending(left.imdb, right.imdb) || compareTitles(left, right);
    }

    const leftSavedAt = Date.parse(left.savedAt || "");
    const rightSavedAt = Date.parse(right.savedAt || "");
    if (Number.isFinite(leftSavedAt) && Number.isFinite(rightSavedAt) && leftSavedAt !== rightSavedAt) {
      return rightSavedAt - leftSavedAt;
    }
    if (Number.isFinite(leftSavedAt) !== Number.isFinite(rightSavedAt)) {
      return Number.isFinite(rightSavedAt) ? 1 : -1;
    }
    return Number(right.__savedOrder || 0) - Number(left.__savedOrder || 0);
  });
}

function compareTitles(left, right) {
  return String(left.title || "").localeCompare(String(right.title || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareNumbersDescending(left, right) {
  const leftValue = hasNumericValue(left) ? Number(left) : Number.NEGATIVE_INFINITY;
  const rightValue = hasNumericValue(right) ? Number(right) : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function buildEmptyState(title, message, options = {}) {
  const emptyState = document.createElement("div");
  const heading = document.createElement("h3");
  const copy = document.createElement("p");
  emptyState.className = "empty-state saved-title-empty-state";
  heading.textContent = title;
  copy.textContent = message;
  emptyState.append(heading, copy);

  if (options.clearFilters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.dataset.clearSavedFilters = "true";
    button.textContent = "Clear search";
    emptyState.append(button);
  }

  if (options.linkHref && options.linkLabel) {
    const link = document.createElement("a");
    link.className = "ghost-button saved-title-empty-link";
    link.href = options.linkHref;
    link.textContent = options.linkLabel;
    emptyState.append(link);
  }

  return emptyState;
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

function persistWatchlist() {
  window.localStorage.setItem(watchlistStorageKey, JSON.stringify([...watchlist]));
}

function persistWatchlistMovies() {
  window.localStorage.setItem(watchlistMoviesStorageKey, JSON.stringify([...watchlistMovies.values()]));
}

function handleSavedDataUpdate(snapshot) {
  syncSavedCollections(snapshot);
  renderSavedTitlesPage();
}

function syncSavedCollections(snapshot) {
  savedStateSource = snapshot.source || "local";
  savedStateError = snapshot.error || "";

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
}

function emptySavedTitlesMessage() {
  if (savedStateSource === "remote") {
    return "No saved titles in your account yet.";
  }
  if (savedStateSource === "remote-error" && savedStateError) {
    return "Your account saved titles could not load right now.";
  }
  return "No saved titles in this browser yet.";
}

function debounce(callback, delayMs) {
  let timeoutId = 0;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  };
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
      button.setAttribute("aria-expanded", "false");
      card.classList.remove("is-synopsis-expanded");
      return;
    }
    button.hidden = false;
    button.dataset.synopsisToggle = "true";
    const isExpanded = card.classList.contains("is-synopsis-expanded");
    button.dataset.synopsisExpanded = isExpanded ? "true" : "false";
    button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    button.textContent = isExpanded ? "Show less" : "Show more";
  });
}
