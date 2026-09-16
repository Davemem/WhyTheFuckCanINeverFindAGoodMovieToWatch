const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";

const elements = {
  status: document.querySelector("#saved-titles-status"),
  count: document.querySelector("#saved-titles-count"),
  genres: document.querySelector("#saved-titles-genres"),
  rating: document.querySelector("#saved-titles-rating"),
  watchedCount: document.querySelector("#saved-titles-watched"),
  viewStatus: document.querySelector("#saved-titles-view-status"),
  search: document.querySelector("#saved-titles-search"),
  sort: document.querySelector("#saved-titles-sort"),
  watchedFilter: document.querySelector("#saved-titles-watched-filter"),
  mediaType: document.querySelector("#saved-titles-media-type"),
  grid: document.querySelector("#saved-titles-grid"),
  template: document.querySelector("#movie-card-template"),
  notice: document.querySelector("[data-saved-title-notice]"),
  noticeText: document.querySelector("[data-saved-title-notice-text]"),
  undoButton: document.querySelector("[data-undo-title-removal]"),
};

const savedDataClient = window.savedDataClient || null;
const watchlist = new Set();
const watchlistMovies = new Map();
const watched = new Set();
const watchedMovies = new Map();
const viewState = {
  query: "",
  sort: "recent",
  watchedFilter: "all",
  mediaType: "both",
};
let savedStateSource = "local";
let savedStateError = "";
let lastRemovedMovie = null;
let noticeTimeoutId = 0;
let libraryContext = '';
const enrichmentQueue = new Map();
const enrichmentPending = new Set();
const enrichmentFailed = new Set();
// Public metadata stays separate from account-owned saves and is discarded on account changes.
const libraryDetails = new Map();
let enrichmentRunning = 0;
const ratingSortFields = { rating: 'imdb', rt: 'rt', metacritic: 'metacritic', tmdb: 'tmdb' };
const libraryFilters = window.LibraryFilters?.mount(document.querySelector('#saved-title-filters'), () => {
  enrichmentQueue.clear(); renderSavedTitlesPage();
});
const titleObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).map(entry => {
    titleObserver.unobserve(entry.target);
    const key = window.TitleIdentity.key(entry.target.dataset.movieId);
    return watchlistMovies.get(key) || watchedMovies.get(key);
  }).filter(Boolean);
  queueTitleDetails(visible);
}, { rootMargin: '300px' }) : null;
document.querySelector('#clear-library-view')?.addEventListener('click', clearFilters);
document.querySelector('#retry-library-details')?.addEventListener('click', () => { enrichmentFailed.clear(); renderSavedTitlesPage(); });

elements.grid?.addEventListener("click", handleGridClick);
elements.mediaType?.addEventListener("change", () => {
  viewState.mediaType = elements.mediaType.value;
  renderSavedTitlesPage();
});
elements.search?.addEventListener("input", () => {
  viewState.query = elements.search.value.trim();
  renderSavedTitlesPage();
});
elements.sort?.addEventListener("change", () => {
  viewState.sort = elements.sort.value;
  renderSavedTitlesPage();
});
elements.watchedFilter?.addEventListener("change", () => {
  viewState.watchedFilter = elements.watchedFilter.value;
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
  const detailFilters = libraryFilters?.getFilters();
  const candidates = allMovies.filter(movie => movieMatchesQuery(movie, viewState.query) && movieMatchesWatchedFilter(movie)
    && (viewState.mediaType === 'both' || window.TitleIdentity.identity(movie)?.mediaType === viewState.mediaType));
  const visibleMovies = sortMovies(
    candidates.filter(movie => !detailFilters || libraryTitleStatus(movie, detailFilters) === 'match'),
    viewState.sort,
  );
  const needsCheck = candidates.filter(movie => !movie.isEnriched && (!detailFilters || libraryTitleStatus(movie,detailFilters) !== 'exclude'));
  const pendingMatches = detailFilters ? candidates.filter(movie => libraryTitleStatus(movie,detailFilters) === 'pending') : [];
  const failed = needsCheck.filter(movie => enrichmentFailed.has(String(movie.id)));
  if (libraryFilters) queueTitleDetails(window.DiscoveryFilters.active(detailFilters) || ratingSortFields[viewState.sort] || viewState.query ? needsCheck : candidates.slice(0,8));
  document.querySelector('#clear-library-view').hidden = !viewState.query && viewState.mediaType === 'both' && viewState.watchedFilter === 'all' && viewState.sort === 'recent' && !window.DiscoveryFilters?.active(detailFilters || window.DiscoveryFilters.defaults);
  document.querySelector('#retry-library-details').hidden = !failed.length;

  renderSummary(allMovies);
  renderStatus(allMovies.length, visibleMovies.length);
  if (pendingMatches.length) elements.viewStatus.textContent += ` Checking ${pendingMatches.length} titles against your filters.`;
  if (failed.length) elements.viewStatus.textContent += ` Details unavailable for ${failed.length}; you can retry.`;

  if (!elements.grid) {
    return;
  }

  titleObserver?.disconnect();
  elements.grid.replaceChildren();

  if (!allMovies.length) {
    elements.grid.append(buildEmptyState(
      "No saved titles yet",
      "Search for a movie or TV show on Discover and save it to start your watchlist.",
      { linkHref: "/", linkLabel: "Find something to watch" },
    ));
    return;
  }

  if (!visibleMovies.length) {
    elements.grid.append(buildEmptyState(
      pendingMatches.length ? "Checking your saved titles" : "No matching titles",
      pendingMatches.length ? "Ratings and award details are loading. Verified matches will appear here." : "Try a different search or loosen your filters. Missing scores never count as a match.",
      { clearFilters: true },
    ));
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleMovies.forEach((movie) => {
    fragment.append(buildMovieCard(movie));
  });
  elements.grid.append(fragment);
  elements.grid.querySelectorAll('[data-movie-id]').forEach(card => titleObserver?.observe(card));
  window.requestAnimationFrame(() => refreshSynopsisToggles(elements.grid));
}

function getSavedMovies() {
  const libraryIds = [...new Set([...watchlist, ...watched])];
  return libraryIds
    .map((movieId, index) => {
      const movie = watchlistMovies.get(movieId) || watchedMovies.get(movieId);
      return movie ? { ...movie, __savedOrder: index } : null;
    })
    .filter(Boolean);
}

function libraryTitleStatus(movie, filters) {
  const F = window.DiscoveryFilters;
  const names = (movie.genres || []).map(name => String(name).toLowerCase());
  const inferredGenres = F.genres.filter(genre => names.includes(genre.name.toLowerCase())).flatMap(genre => F.mappedGenres(genre.id, movie.mediaType));
  if (names.includes('action & adventure')) inferredGenres.push(10759);
  if (names.includes('sci-fi & fantasy')) inferredGenres.push(10765);
  if (names.includes('war & politics')) inferredGenres.push(10768);
  const title = { ...movie, genreIds: movie.genreIds?.length ? movie.genreIds : inferredGenres };
  if (filters.genre !== 'all' && !title.genreIds.length && !title.isEnriched) {
    return F.status(title, {...filters,genre:'all'}) === 'exclude' ? 'exclude' : 'pending';
  }
  return F.status(title, filters);
}

function queueTitleDetails(movies) {
  if (!libraryFilters || !savedDataClient) return;
  for (const movie of movies) {
    const key = String(movie.id);
    if (!movie.isEnriched && !enrichmentPending.has(key) && !enrichmentFailed.has(key)) enrichmentQueue.set(key,movie);
  }
  while (enrichmentRunning < 2 && enrichmentQueue.size) {
    const batch = [...enrichmentQueue.entries()].slice(0,2);
    for (const [key] of batch) { enrichmentQueue.delete(key); enrichmentPending.add(key); }
    enrichmentRunning++;
    const context = libraryContext;
    fetchJson('/api/enrich?ids=' + encodeURIComponent(batch.map(([key])=>key).join(','))).then(payload => {
      if (context !== libraryContext) return;
      const enriched = [];
      for (const [key,base] of batch) {
        const title = (payload.movies || []).find(title => String(window.TitleIdentity.key(title)) === key && title.isEnriched);
        if (title) enriched.push({ ...base, ...title, genreIds: title.genreIds?.length ? title.genreIds : base.genreIds });
        else enrichmentFailed.add(key);
      }
      for (const title of enriched) {
        const key = window.TitleIdentity.key(title);
        libraryDetails.set(key, title);
        for (const collection of [watchlistMovies, watchedMovies]) {
          if (collection.has(key)) collection.set(key, { ...collection.get(key), ...title });
        }
      }
      if (enriched.length) savedDataClient.updateMovieDetails(enriched);
    }).catch(() => { if (context === libraryContext) batch.forEach(([key])=>enrichmentFailed.add(key)); })
      .finally(() => {
        batch.forEach(([key])=>enrichmentPending.delete(key)); enrichmentRunning--;
        renderSavedTitlesPage();
        queueTitleDetails([]);
      });
  }
}

function renderSummary(movies) {
  if (elements.count) {
    elements.count.textContent = String(watchlist.size);
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
  if (elements.watchedCount) {
    elements.watchedCount.textContent = String(watched.size);
  }
}

function renderStatus(total, visible) {
  if (elements.status) {
    if (!total) {
      elements.status.textContent = emptySavedTitlesMessage();
    } else {
      elements.status.textContent = savedStateSource === "remote"
        ? "Your watchlist and watched history are synced to your account."
        : "Your watchlist and watched history are saved in this browser.";
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
  elements.viewStatus.textContent = viewState.query || viewState.watchedFilter !== "all" || viewState.mediaType !== "both" || libraryFilters && window.DiscoveryFilters.active(libraryFilters.getFilters())
    ? `Showing ${visible} of ${total} ${noun} in your library.`
    : `${total} ${noun} in your library.`;
}

function buildMovieCard(movie) {
  const fragment = window.MovieResults.buildMovieCard(elements.template, movie, {
    extraClass: "saved-title-card",
    hideMatchReason: true,
    allowToggleSave: true,
    forceSavedButton: watchlist.has(window.TitleIdentity.key(movie.id)),
    isSaved: watchlist.has(window.TitleIdentity.key(movie.id)),
    savedButtonLabel: watchlist.has(window.TitleIdentity.key(movie.id)) ? "Remove title" : "Save title",
    isWatched: watched.has(window.TitleIdentity.key(movie.id)),
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
    const isSaved = watchlist.has(window.TitleIdentity.key(movie.id));
    removeButton.textContent = isSaved ? "Remove" : "Save title";
    removeButton.setAttribute("aria-label", `${isSaved ? "Remove" : "Save"} ${movie.title || "this title"} ${isSaved ? "from" : "to"} your watchlist`);
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

  const watchedButton = event.target.closest("[data-watched-id]");
  if (watchedButton && savedDataClient) {
    const movieId = window.TitleIdentity.key(watchedButton.dataset.watchedId);
    const movie = watchlistMovies.get(movieId) || watchedMovies.get(movieId);
    if (movie) {
      savedDataClient.toggleWatched(movie).catch((error) => {
        elements.status.textContent = error.message;
      });
    }
    return;
  }

  const movieButton = event.target.closest("[data-watchlist-id]");
  if (!movieButton || movieButton.disabled) {
    return;
  }

  const movieId = window.TitleIdentity.key(movieButton.dataset.watchlistId);
  if (watchlist.has(movieId)) {
    removeSavedTitle(movieId, movieButton);
  } else {
    saveTitleFromHistory(movieId, movieButton);
  }
}

async function saveTitleFromHistory(movieId, button) {
  const movie = watchedMovies.get(movieId);
  if (!movie || !savedDataClient) {
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await savedDataClient.toggleTitle(movie);
    if (elements.status) {
      elements.status.textContent = `${movie.title || "Title"} saved to your watchlist.`;
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = "Save title";
    elements.status.textContent = error instanceof Error ? error.message : "Unable to save that title.";
  }
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
      watchlist.add(window.TitleIdentity.key(movie.id));
      watchlistMovies.set(window.TitleIdentity.key(movie.id), movie);
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
  viewState.watchedFilter = "all";
  viewState.mediaType = "both";
  viewState.sort = 'recent';
  if (elements.sort) elements.sort.value = 'recent';
  if (elements.mediaType) elements.mediaType.value = "both";
  if (elements.search) {
    elements.search.value = "";
    elements.search.focus();
  }
  if (elements.watchedFilter) {
    elements.watchedFilter.value = "all";
  }
  if (libraryFilters) libraryFilters.reset(); else renderSavedTitlesPage();
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
    if (ratingSortFields[sortMode]) {
      return compareNumbersDescending(left[ratingSortFields[sortMode]], right[ratingSortFields[sortMode]]) || compareTitles(left, right);
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
    button.textContent = "Clear search & filters";
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
  const context = String(snapshot.user?.id || 'guest') + ':' + (snapshot.source || 'local');
  if (context !== libraryContext) { libraryContext = context; enrichmentQueue.clear(); enrichmentFailed.clear(); libraryDetails.clear(); }
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
      const key = window.TitleIdentity.key(movie.id);
      watchlistMovies.set(key, { ...movie, ...libraryDetails.get(key) });
    }
  });
  watched.clear();
  (snapshot.watchedIds || []).forEach((movieId) => watched.add(window.TitleIdentity.key(movieId)));
  watchedMovies.clear();
  (snapshot.watchedMovies || []).forEach((movie) => {
    const key = window.TitleIdentity.key(movie.id);
    watchedMovies.set(key, { ...movie, ...libraryDetails.get(key) });
  });
}

function movieMatchesWatchedFilter(movie) {
  if (viewState.watchedFilter === "watched") {
    return watched.has(window.TitleIdentity.key(movie.id));
  }
  if (viewState.watchedFilter === "unwatched") {
    return !watched.has(window.TitleIdentity.key(movie.id));
  }
  return true;
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

async function fetchJson(url) {
  const response = await window.fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(30000) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || "Title search request failed.");
  }
  return payload;
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
