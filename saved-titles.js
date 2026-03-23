const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";

const elements = {
  status: document.querySelector("#saved-titles-status"),
  count: document.querySelector("#saved-titles-count"),
  grid: document.querySelector("#saved-titles-grid"),
  template: document.querySelector("#movie-card-template"),
};

const watchlist = loadWatchlist();
const watchlistMovies = loadWatchlistMovies();

elements.grid?.addEventListener("click", handleGridClick);
window.addEventListener("resize", debounce(() => refreshSynopsisToggles(elements.grid), 120));

renderSavedTitlesPage();

function renderSavedTitlesPage() {
  const movies = [...watchlist]
    .map((movieId) => watchlistMovies.get(movieId))
    .filter(Boolean);

  if (elements.count) {
    elements.count.textContent = String(movies.length);
  }

  if (!elements.grid) {
    return;
  }

  elements.grid.replaceChildren();

  if (!movies.length) {
    elements.grid.append(buildEmptyState("No saved titles yet.", "Save titles from the catalog and they will show up here."));
    if (elements.status) {
      elements.status.textContent = "No saved titles in this browser yet.";
    }
    return;
  }

  movies.forEach((movie) => {
    elements.grid.append(buildMovieCard(movie));
  });
  window.requestAnimationFrame(() => refreshSynopsisToggles(elements.grid));

  if (elements.status) {
    elements.status.textContent = "Saved titles loaded.";
  }
}

function buildMovieCard(movie) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".movie-card");
  const poster = fragment.querySelector(".movie-poster");
  const posterFrame = fragment.querySelector(".movie-poster-frame");

  article.classList.add("saved-title-card");
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
  fragment.querySelector(".producer").textContent = movie.producers?.length ? movie.producers.join(", ") : "Unknown";
  fragment.querySelector(".genres").textContent = movie.genres?.length ? movie.genres.join(" / ") : "Unknown";
  fragment.querySelector(".match-reason")?.closest("div")?.remove();

  if (movie.posterUrl) {
    poster.src = movie.posterUrl;
    poster.alt = `${movie.title} poster`;
  } else {
    posterFrame.classList.add("is-empty");
    poster.remove();
    posterFrame.innerHTML = `<span>${escapeHtml(movie.title)}</span>`;
  }

  const button = fragment.querySelector(".watchlist-button");
  button.textContent = "Remove title";
  button.classList.add("is-saved");
  button.dataset.watchlistId = String(movie.id);

  return fragment;
}

function handleGridClick(event) {
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
  if (!movieButton) {
    return;
  }

  const movieId = Number(movieButton.dataset.watchlistId);
  watchlist.delete(movieId);
  watchlistMovies.delete(movieId);
  persistWatchlist();
  persistWatchlistMovies();
  renderSavedTitlesPage();
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

function persistWatchlist() {
  window.localStorage.setItem(watchlistStorageKey, JSON.stringify([...watchlist]));
}

function persistWatchlistMovies() {
  window.localStorage.setItem(watchlistMoviesStorageKey, JSON.stringify([...watchlistMovies.values()]));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
