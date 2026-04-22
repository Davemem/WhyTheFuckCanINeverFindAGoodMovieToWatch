(function bootstrapMovieResults(global) {
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

  function setCardField(element, value, pending) {
    if (!element) {
      return;
    }
    element.textContent = value;
    element.classList.toggle("is-pending", Boolean(pending));
  }

  function buildMovieCard(template, movie, options = {}) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".movie-card");
    const poster = fragment.querySelector(".movie-poster");
    const posterFrame = fragment.querySelector(".movie-poster-frame");
    const isPending = Boolean(options.progressive && !movie.isEnriched);

    if (options.extraClass && article) {
      article.classList.add(options.extraClass);
    }

    if (article) {
      article.classList.toggle("is-loading-card", isPending);
      if (options.cardKey) {
        article.dataset.cardKey = options.cardKey;
      }
      if (Number.isFinite(movie.id)) {
        article.dataset.movieId = String(movie.id);
      }
    }

    fragment.querySelector("h3").textContent = movie.title;
    fragment.querySelector(".pill-year").textContent = movie.year || "TBA";
    fragment.querySelector(".pill-runtime").textContent = movie.runtime || "Runtime unknown";
    fragment.querySelector(".logline").textContent = movie.logline || options.defaultLogline || "No overview available yet.";

    setCardField(
      fragment.querySelector(".rating-imdb"),
      isPending ? "Loading" : formatRating(movie.imdb, 1),
      isPending,
    );
    setCardField(
      fragment.querySelector(".rating-rt"),
      isPending ? "Loading" : formatPercent(movie.rt),
      isPending,
    );
    setCardField(
      fragment.querySelector(".rating-meta"),
      isPending ? "Loading" : formatInteger(movie.metacritic),
      isPending,
    );
    setCardField(
      fragment.querySelector(".rating-tmdb"),
      formatRating(movie.tmdb, 1),
      !movie.tmdb,
    );
    setCardField(
      fragment.querySelector(".cast"),
      isPending ? "Loading cast" : (movie.cast?.length ? movie.cast.join(", ") : "Unknown"),
      isPending,
    );
    setCardField(
      fragment.querySelector(".director"),
      isPending ? "Loading director" : (movie.director || "Unknown"),
      isPending,
    );
    setCardField(
      fragment.querySelector(".producer"),
      isPending ? "Loading producers" : (movie.producers?.length ? movie.producers.join(", ") : "Unknown"),
      isPending,
    );
    setCardField(
      fragment.querySelector(".match-reason"),
      movie.matchReason || options.defaultMatchReason || "Saved from the catalog.",
      false,
    );
    setCardField(
      fragment.querySelector(".genres"),
      isPending ? "Loading genres" : formatGenres(movie),
      isPending,
    );

    if (options.hideMatchReason) {
      fragment.querySelector(".match-reason")?.closest("div")?.remove();
    }

    if (movie.posterUrl) {
      poster.src = movie.posterUrl;
      poster.alt = `${movie.title} poster`;
    } else if (posterFrame && poster) {
      posterFrame.classList.add("is-empty");
      poster.remove();
      posterFrame.innerHTML = `<span>${movie.title}</span>`;
    }

    const watchlistButton = fragment.querySelector(".watchlist-button");
    if (watchlistButton) {
      const isSaved = Boolean(options.isSaved);
      watchlistButton.textContent = options.allowToggleSave
        ? (isSaved ? "Remove title" : "Save title")
        : (options.savedButtonLabel || "Save to watchlist");
      watchlistButton.classList.toggle("is-saved", isSaved || Boolean(options.forceSavedButton));
      if (Number.isFinite(movie.id)) {
        watchlistButton.dataset.watchlistId = String(movie.id);
      }
      if (options.allowToggleSave) {
        watchlistButton.dataset.watchlistMovie = JSON.stringify(movie);
      }
    }

    if (options.expandedByDefault && article) {
      article.classList.add("is-expanded");
    }

    return fragment;
  }

  function renderMovieCards(config) {
    const {
      container,
      movies,
      totalMatches,
      summaryElement,
      summaryText,
      emptyTitle,
      emptyMessage,
      buildCard,
      batchSize = 24,
      setSearchMode,
      beforeRender,
      isCurrentRender = null,
      railRoot = null,
      railOptions = {},
    } = config;

    if (!container) {
      return;
    }

    if (typeof setSearchMode === "function") {
      setSearchMode(true);
    }
    if (typeof beforeRender === "function") {
      beforeRender();
    }

    if (railRoot) {
      bindRail(railRoot, railOptions);
      setRailStatus(railRoot, movies.length ? "loaded" : "empty", railOptions);
    }

    container.replaceChildren();
    if (summaryElement) {
      summaryElement.textContent = summaryText || `${totalMatches || movies.length} movies match your current filter stack.`;
    }

    if (!movies.length) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.innerHTML = `<h3>${emptyTitle}</h3><p>${emptyMessage}</p>`;
      container.append(emptyState);
      return;
    }

    let index = 0;
    const appendBatch = () => {
      if (typeof isCurrentRender === "function" && !isCurrentRender()) {
        return;
      }

      const fragment = document.createDocumentFragment();
      const end = Math.min(index + batchSize, movies.length);
      for (let cursor = index; cursor < end; cursor += 1) {
        fragment.append(buildCard(movies[cursor]));
      }
      container.append(fragment);
      if (railRoot) {
        syncRail(railRoot, railOptions);
      }
      index = end;

      if (index < movies.length) {
        global.requestAnimationFrame(appendBatch);
      }
    };

    global.requestAnimationFrame(appendBatch);
  }

  function patchMovieCards(container, replacements, buildCard) {
    replacements.forEach((movie, id) => {
      const currentCard = container.querySelector(`[data-movie-id="${id}"]`);
      if (!currentCard) {
        return;
      }

      const replacement = buildCard(movie).firstElementChild;
      if (replacement) {
        currentCard.replaceWith(replacement);
      }
    });
  }

  function resolveRail(rootOrTrack) {
    if (!rootOrTrack) {
      return null;
    }
    if (rootOrTrack.matches?.("[data-movie-rail]")) {
      return rootOrTrack;
    }
    return rootOrTrack.closest?.("[data-movie-rail]") || null;
  }

  function getRailParts(rootOrTrack) {
    const root = resolveRail(rootOrTrack);
    if (!root) {
      return null;
    }
    return {
      root,
      viewport: root.querySelector("[data-movie-rail-viewport]"),
      track: root.querySelector("[data-movie-rail-track]"),
      countLabel: root.querySelector("[data-movie-rail-count]"),
      previousButton: root.querySelector('[data-rail-direction="prev"]'),
      nextButton: root.querySelector('[data-rail-direction="next"]'),
    };
  }

  function getRailStep(parts, options = {}) {
    const firstCard = parts.track?.firstElementChild;
    if (firstCard instanceof HTMLElement) {
      const styles = global.getComputedStyle(parts.track);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || String(options.gap || 8)) || 8;
      return firstCard.getBoundingClientRect().width + gap;
    }
    return (options.cardWidth || 252) + (options.gap || 8);
  }

  function getVisibleRailCount(rootOrTrack, options = {}) {
    const parts = getRailParts(rootOrTrack);
    if (!parts?.viewport) {
      return 1;
    }
    const step = Math.max(1, getRailStep(parts, options));
    return Math.max(1, Math.floor((parts.viewport.clientWidth + (options.gap || 8)) / step));
  }

  function buildRailCountText(parts, options = {}) {
    const total = parts.track?.children.length || 0;
    const status = parts.root.dataset.railStatus || "loaded";
    const visibleCount = getVisibleRailCount(parts.root, options);
    const step = Math.max(1, getRailStep(parts, options));
    const currentIndex = Math.min(total - 1, Math.max(0, Math.round((parts.viewport?.scrollLeft || 0) / step)));
    const endIndex = Math.min(total, currentIndex + visibleCount);
    const statusText = options.statusText || {};

    if (status === "loading" || status === "idle") {
      return statusText.loading || "Loading titles...";
    }
    if (status === "error") {
      return statusText.error || "Titles unavailable";
    }
    if (!total) {
      return statusText.empty || "No titles available";
    }
    if (typeof statusText.loaded === "function") {
      return statusText.loaded({ total, visibleCount, currentIndex, endIndex });
    }
    return `${Math.min(visibleCount, total)} on this row · ${currentIndex + 1}-${endIndex} of ${total}`;
  }

  function syncRail(rootOrTrack, options = {}) {
    const parts = getRailParts(rootOrTrack);
    if (!parts?.viewport || !parts.track) {
      return;
    }

    if (parts.countLabel) {
      parts.countLabel.textContent = buildRailCountText(parts, options);
    }

    const total = parts.track.children.length || 0;
    const visibleCount = getVisibleRailCount(parts.root, options);
    const status = parts.root.dataset.railStatus || "loaded";
    const maxScrollLeft = Math.max(0, parts.viewport.scrollWidth - parts.viewport.clientWidth - 4);

    if (parts.previousButton) {
      parts.previousButton.disabled = status !== "loaded" || parts.viewport.scrollLeft <= 4 || total <= visibleCount;
    }
    if (parts.nextButton) {
      parts.nextButton.disabled = status !== "loaded" || parts.viewport.scrollLeft >= maxScrollLeft || total <= visibleCount;
    }
  }

  function setRailStatus(rootOrTrack, status, options = {}) {
    const parts = getRailParts(rootOrTrack);
    if (!parts?.root) {
      return;
    }
    parts.root.dataset.railStatus = status;
    syncRail(parts.root, options);
  }

  function bindRail(rootOrTrack, options = {}) {
    const parts = getRailParts(rootOrTrack);
    if (!parts?.root || parts.root.dataset.movieRailBound === "1") {
      if (parts?.root) {
        parts.root.__movieRailOptions = { ...(parts.root.__movieRailOptions || {}), ...options };
      }
      return parts?.root || null;
    }

    parts.root.__movieRailOptions = options;

    parts.root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-rail-direction]");
      if (!button || !parts.viewport) {
        return;
      }
      const direction = button.dataset.railDirection === "prev" ? -1 : 1;
      const visibleCount = getVisibleRailCount(parts.root, parts.root.__movieRailOptions || {});
      const step = getRailStep(parts, parts.root.__movieRailOptions || {});
      parts.viewport.scrollBy({ left: direction * visibleCount * step, behavior: "smooth" });
      global.setTimeout(() => {
        syncRail(parts.root, parts.root.__movieRailOptions || {});
      }, 180);
    });

    parts.root.addEventListener("scroll", (event) => {
      const viewport = event.target.closest("[data-movie-rail-viewport]");
      if (!viewport) {
        return;
      }
      const currentOptions = parts.root.__movieRailOptions || {};
      syncRail(parts.root, currentOptions);
      if (typeof currentOptions.onScroll === "function") {
        currentOptions.onScroll(parts.root, viewport);
      }
    }, true);

    parts.root.dataset.movieRailBound = "1";
    syncRail(parts.root, options);
    return parts.root;
  }

  async function progressivelyEnrichMovies(config) {
    const {
      movies,
      getMovies,
      fetchJson,
      enrichUrl,
      enrichAttempts,
      maxAttempts = 2,
      batchSize = 2,
      retryDelayMs = 400,
      isCurrent,
      onUpdate,
    } = config;

    const currentMovies = typeof getMovies === "function" ? getMovies() : movies;

    const ids = currentMovies
      .filter((movie) => !movie.isEnriched && (enrichAttempts.get(movie.id) || 0) < maxAttempts)
      .map((movie) => movie.id)
      .slice(0, batchSize);

    if (!ids.length || (typeof isCurrent === "function" && !isCurrent())) {
      return;
    }

    ids.forEach((id) => {
      enrichAttempts.set(id, (enrichAttempts.get(id) || 0) + 1);
    });

    try {
      const payload = await fetchJson(enrichUrl(ids));
      if (typeof isCurrent === "function" && !isCurrent()) {
        return;
      }
      const enrichedById = new Map((payload.movies || []).map((movie) => [movie.id, movie]));
      if (typeof onUpdate === "function") {
        onUpdate(enrichedById);
      }

      await progressivelyEnrichMovies({
        ...config,
        movies: typeof getMovies === "function" ? getMovies() : currentMovies,
      });
    } catch {
      global.setTimeout(() => {
        if (typeof isCurrent !== "function" || isCurrent()) {
          progressivelyEnrichMovies(config);
        }
      }, retryDelayMs);
    }
  }

  global.MovieResults = {
    buildMovieCard,
    bindRail,
    formatGenres,
    formatInteger,
    formatPercent,
    formatRating,
    getVisibleRailCount,
    patchMovieCards,
    progressivelyEnrichMovies,
    renderMovieCards,
    setRailStatus,
    setCardField,
    syncRail,
  };
})(window);
