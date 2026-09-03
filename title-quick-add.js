"use strict";

(function titleQuickAddBootstrap() {
  const elements = {
    form: document.querySelector("#title-catalog-search-form"),
    search: document.querySelector("#title-catalog-search"),
    searchButton: document.querySelector("#title-catalog-search-form button[type='submit']"),
    status: document.querySelector("#title-catalog-search-status"),
    results: document.querySelector("#title-catalog-search-results"),
  };

  if (!elements.form || !elements.search || !elements.results) {
    return;
  }

  const savedDataClient = window.savedDataClient || null;
  const watchlist = new Set();
  const state = {
    query: "",
    results: [],
    requestId: 0,
    savingId: null,
  };

  elements.form.addEventListener("submit", handleSearchSubmit);
  elements.results.addEventListener("click", handleResultClick);
  elements.search.addEventListener("input", debounce(() => {
    const query = elements.search.value.trim();
    if (!query) {
      clearSearch();
      return;
    }
    if (query.length >= 2 && query !== state.query) {
      searchTitles(query);
    }
  }, 350));

  if (savedDataClient) {
    savedDataClient.subscribe((snapshot) => {
      watchlist.clear();
      (snapshot.watchlistIds || []).forEach((movieId) => {
        if (Number.isFinite(Number(movieId))) {
          watchlist.add(Number(movieId));
        }
      });
      renderResults();
    });
  } else {
    setStatus("Quick add is unavailable until saved data finishes loading.", true);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    const query = elements.search.value.trim();
    if (!query) {
      clearSearch();
      elements.search.focus();
      return;
    }
    searchTitles(query);
  }

  async function searchTitles(query) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      clearSearch();
      return;
    }

    const requestId = state.requestId + 1;
    state.requestId = requestId;
    state.query = normalizedQuery;
    setLoading(true);
    setStatus(`Searching for “${normalizedQuery}”…`);

    try {
      const payload = await fetchJson(`/api/movie-search?query=${encodeURIComponent(normalizedQuery)}&limit=8`);
      if (requestId !== state.requestId) {
        return;
      }
      state.results = Array.isArray(payload.results) ? payload.results : [];
      renderResults();

      if (!state.results.length) {
        setStatus(`No movies found for “${normalizedQuery}”. Try including the release year.`);
        return;
      }

      setStatus(
        `Found ${state.results.length} ${state.results.length === 1 ? "match" : "matches"} for “${normalizedQuery}”.`,
      );
    } catch (error) {
      if (requestId !== state.requestId) {
        return;
      }
      state.results = [];
      renderResults();
      setStatus(error instanceof Error ? error.message : "Movie search is unavailable right now.", true);
    } finally {
      if (requestId === state.requestId) {
        setLoading(false);
      }
    }
  }

  function clearSearch() {
    state.requestId += 1;
    state.query = "";
    state.results = [];
    state.savingId = null;
    setLoading(false);
    renderResults();
    setStatus("Enter a movie title to add it without building a discovery search.");
  }

  function renderResults() {
    elements.results.replaceChildren();
    elements.results.hidden = !state.results.length;
    if (!state.results.length) {
      return;
    }

    const fragment = document.createDocumentFragment();
    state.results.forEach((movie) => fragment.append(buildResult(movie)));
    elements.results.append(fragment);
  }

  function buildResult(movie) {
    const article = document.createElement("article");
    const posterFrame = document.createElement("div");
    const body = document.createElement("div");
    const headingRow = document.createElement("div");
    const heading = document.createElement("h3");
    const year = document.createElement("span");
    const overview = document.createElement("p");
    const saveButton = document.createElement("button");
    const movieId = Number(movie.id);
    const isSaved = watchlist.has(movieId);
    const isSaving = state.savingId === movieId;

    article.className = "title-search-result";
    posterFrame.className = "title-search-result-poster";
    body.className = "title-search-result-body";
    headingRow.className = "title-search-result-heading";
    year.className = "title-search-result-year";
    overview.className = "title-search-result-overview";
    saveButton.className = "title-search-result-save";

    if (movie.posterUrl) {
      const poster = document.createElement("img");
      poster.src = movie.posterUrl;
      poster.alt = "";
      poster.loading = "lazy";
      poster.width = 148;
      poster.height = 222;
      posterFrame.append(poster);
    } else {
      posterFrame.textContent = String(movie.title || "Movie").slice(0, 2);
      posterFrame.setAttribute("aria-hidden", "true");
    }

    heading.textContent = movie.title || "Untitled movie";
    year.textContent = movie.year || "Year unknown";
    overview.textContent = movie.logline || "No overview available yet.";
    saveButton.type = "button";
    saveButton.dataset.addMovieId = String(movieId);
    saveButton.textContent = isSaved ? "Saved" : isSaving ? "Saving…" : "Save title";
    saveButton.disabled = isSaved || isSaving || !savedDataClient;
    saveButton.classList.toggle("is-saved", isSaved);
    saveButton.setAttribute(
      "aria-label",
      isSaved ? `${movie.title} is already saved` : `Save ${movie.title} to your watchlist`,
    );

    headingRow.append(heading, year);
    body.append(headingRow, overview, saveButton);
    article.append(posterFrame, body);
    return article;
  }

  async function handleResultClick(event) {
    const button = event.target.closest("[data-add-movie-id]");
    if (!button || button.disabled || !savedDataClient) {
      return;
    }

    const movieId = Number(button.dataset.addMovieId);
    const movie = state.results.find((entry) => Number(entry.id) === movieId);
    if (!movie || watchlist.has(movieId)) {
      return;
    }

    state.savingId = movieId;
    renderResults();
    setStatus(`Saving “${movie.title}”…`);

    try {
      let movieToSave = movie;
      if (!movie.isEnriched) {
        const payload = await fetchJson(`/api/enrich?ids=${encodeURIComponent(String(movieId))}`);
        const enrichedMovie = Array.isArray(payload.movies) ? payload.movies[0] : null;
        if (enrichedMovie) {
          movieToSave = { ...movie, ...enrichedMovie };
        }
      }

      if (!watchlist.has(movieId)) {
        await savedDataClient.toggleTitle({ ...movieToSave, savedAt: new Date().toISOString() });
      }
      setStatus(`“${movie.title}” is saved to your watchlist.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save that movie right now.", true);
    } finally {
      state.savingId = null;
      renderResults();
    }
  }

  function setLoading(isLoading) {
    if (!elements.searchButton) {
      return;
    }
    elements.searchButton.disabled = isLoading;
    elements.searchButton.textContent = isLoading ? "Searching…" : "Search";
  }

  function setStatus(message, isError = false) {
    if (!elements.status) {
      return;
    }
    elements.status.textContent = message;
    elements.status.classList.toggle("is-error", isError);
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
}());
