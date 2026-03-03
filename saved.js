const watchlistStorageKey = "wtfcineverfind-watchlist";
const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";

const elements = {
  savedStatus: document.querySelector("#saved-status"),
  savedCount: document.querySelector("#saved-count"),
  savedSummary: document.querySelector("#saved-summary"),
  savedGrid: document.querySelector("#saved-grid"),
  cardTemplate: document.querySelector("#movie-card-template"),
};

const watchlist = loadWatchlist();
const watchlistMovies = loadWatchlistMovies();

elements.savedGrid.addEventListener("click", handleSavedAction);

renderSavedPage();

function renderSavedPage() {
  const savedMovies = [...watchlist]
    .map((movieId) => watchlistMovies.get(movieId))
    .filter(Boolean);

  elements.savedCount.textContent = String(savedMovies.length);
  elements.savedGrid.replaceChildren();

  if (!savedMovies.length) {
    elements.savedStatus.textContent = "No saved movies in this browser yet.";
    elements.savedSummary.textContent = "Save movies from the homepage to build your stack.";
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>Your watchlist is empty.</h3><p>Save movies from the homepage and they will show up here.</p>";
    elements.savedGrid.append(emptyState);
    return;
  }

  elements.savedStatus.textContent = "Local watchlist loaded.";
  elements.savedSummary.textContent = `${savedMovies.length} saved movie${savedMovies.length === 1 ? "" : "s"} in this browser.`;
  savedMovies.forEach((movie) => {
    elements.savedGrid.append(buildMovieCard(movie));
  });
}

function buildMovieCard(movie) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const poster = fragment.querySelector(".movie-poster");
  const posterFrame = fragment.querySelector(".movie-poster-frame");
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

  if (movie.posterUrl) {
    poster.src = movie.posterUrl;
    poster.alt = `${movie.title} poster`;
  } else {
    posterFrame.classList.add("is-empty");
    poster.remove();
    posterFrame.innerHTML = `<span>${movie.title}</span>`;
  }

  const button = fragment.querySelector(".watchlist-button");
  button.textContent = "Remove from saved";
  button.classList.add("is-saved");
  button.dataset.watchlistId = String(movie.id);

  return fragment;
}

function handleSavedAction(event) {
  const button = event.target.closest("[data-watchlist-id]");
  if (!button) {
    return;
  }

  const movieId = Number(button.dataset.watchlistId);
  watchlist.delete(movieId);
  watchlistMovies.delete(movieId);
  persistWatchlist();
  persistWatchlistMovies();
  renderSavedPage();
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
  window.localStorage.setItem(
    watchlistMoviesStorageKey,
    JSON.stringify([...watchlistMovies.values()]),
  );
}
