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
    formatGenres,
    formatInteger,
    formatPercent,
    formatRating,
    patchMovieCards,
    progressivelyEnrichMovies,
    renderMovieCards,
    setCardField,
  };
})(window);
