(function bootstrapMovieResults(global) {
  const watchProviderGroups = [
    { key: "stream", label: "Stream" },
    { key: "free", label: "Free or ad-supported" },
    { key: "rent", label: "Rent" },
    { key: "buy", label: "Buy" },
  ];
  const watchRegionOptions = [
    "AU", "NZ", "US", "CA", "GB", "IE", "DE", "FR", "ES", "IT", "NL", "BE",
    "SE", "NO", "DK", "FI", "AT", "CH", "BR", "MX", "AR", "IN", "JP", "KR",
    "SG", "HK", "ID", "MY", "PH", "TH", "ZA",
  ];
  const watchProviderCache = new Map();
  const watchProviderState = {
    movieId: null,
    movieTitle: "",
    region: resolveDefaultWatchRegion(),
    requestToken: 0,
    trigger: null,
  };
  let watchProviderDialog = null;
  let personPreviewDialog = null;

  document.addEventListener("click", handleWatchProviderClick);
  document.addEventListener("click", handlePersonCreditClick);

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

  function setCreditLinks(element, names, category, pending) {
    if (!element) {
      return;
    }
    if (pending) {
      setCardField(element, `Loading ${category === "actors" ? "cast" : "credits"}`, true);
      return;
    }
    const values = (Array.isArray(names) ? names : [names]).map(String).map((name) => name.trim()).filter(Boolean);
    if (!values.length || values.every((name) => name === "Unknown")) {
      setCardField(element, "Unknown", false);
      return;
    }
    element.classList.remove("is-pending");
    element.replaceChildren();
    values.forEach((name, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "person-credit-link";
      button.dataset.personCredit = name;
      button.dataset.personCategory = category;
      button.textContent = name;
      button.setAttribute("aria-label", `Open ${name}'s profile and movies`);
      element.append(button);
      if (index < values.length - 1) {
        element.append(document.createTextNode(", "));
      }
    });
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
    setCreditLinks(fragment.querySelector(".cast"), movie.cast || [], "actors", isPending);
    setCreditLinks(fragment.querySelector(".director"), movie.director || "", "directors", isPending);
    setCreditLinks(fragment.querySelector(".producer"), movie.producers || [], "producers", isPending);
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
    if (options.hideCredits) {
      fragment.querySelector(".credit-list")?.remove();
    }
    if (options.hideSynopsisToggle) {
      fragment.querySelector(".synopsis-toggle")?.remove();
    }

    if (movie.posterUrl) {
      poster.src = movie.posterUrl;
      poster.alt = `${movie.title} poster`;
    } else if (posterFrame && poster) {
      posterFrame.classList.add("is-empty");
      poster.remove();
      const fallbackTitle = document.createElement("span");
      fallbackTitle.textContent = movie.title;
      posterFrame.replaceChildren(fallbackTitle);
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

    const watchProvidersButton = fragment.querySelector("[data-watch-providers-button]");
    if (watchProvidersButton) {
      const movieId = Number(movie.id);
      if (Number.isInteger(movieId) && movieId > 0) {
        watchProvidersButton.dataset.watchProviderMovieId = String(movieId);
        watchProvidersButton.dataset.watchProviderMovieTitle = String(movie.title || "This title");
        watchProvidersButton.setAttribute(
          "aria-label",
          `Find where to watch ${movie.title || "this title"}`,
        );
      } else {
        watchProvidersButton.disabled = true;
        watchProvidersButton.title = "Viewing availability is unavailable for this title.";
      }
    }

    const watchedButton = fragment.querySelector(".watched-button");
    if (watchedButton) {
      const isWatched = Boolean(options.isWatched);
      watchedButton.textContent = isWatched ? "Watched ✓" : "Mark watched";
      watchedButton.classList.toggle("is-watched", isWatched);
      watchedButton.setAttribute("aria-pressed", isWatched ? "true" : "false");
      if (Number.isFinite(Number(movie.id))) {
        watchedButton.dataset.watchedId = String(movie.id);
        watchedButton.dataset.watchedMovie = JSON.stringify(movie);
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
      const heading = document.createElement("h3");
      const message = document.createElement("p");
      heading.textContent = emptyTitle;
      message.textContent = emptyMessage;
      emptyState.append(heading, message);
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

  function handleWatchProviderClick(event) {
    const button = event.target.closest("[data-watch-providers-button]");
    if (!button || button.disabled) {
      return;
    }

    const movieId = Number(button.dataset.watchProviderMovieId);
    if (!Number.isInteger(movieId) || movieId <= 0) {
      return;
    }

    watchProviderState.movieId = movieId;
    watchProviderState.movieTitle = button.dataset.watchProviderMovieTitle || "This title";
    watchProviderState.trigger = button;
    openWatchProviderDialog();
  }

  function handlePersonCreditClick(event) {
    const button = event.target.closest("[data-person-credit]");
    if (!button) {
      return;
    }
    event.preventDefault();
    openPersonPreview(button.dataset.personCredit, button.dataset.personCategory || "actors", button);
  }

  async function openPersonPreview(name, category, trigger) {
    const dialog = ensurePersonPreviewDialog();
    dialog.dataset.triggerId = trigger?.id || "";
    renderPersonPreviewState(dialog, "Finding person…", `Looking up ${name} and their movies.`);
    if (!dialog.open) {
      dialog.showModal?.();
    }
    try {
      const response = await global.fetch(`/api/people?query=${encodeURIComponent(name)}&limit=8`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "That person could not be loaded.");
      }
      const people = Array.isArray(payload.results) ? payload.results : [];
      const exactName = String(name || "").trim().toLowerCase();
      const person = people.find((entry) => String(entry.name || "").trim().toLowerCase() === exactName) || people[0];
      if (!person) {
        renderPersonPreviewState(dialog, "No matching person found", "Try searching their name from Home.");
        return;
      }
      renderPersonPreview(dialog, person, categoryFromDepartment(person.department, category));
    } catch (error) {
      renderPersonPreviewState(dialog, "Profile unavailable", error instanceof Error ? error.message : "Try again from Home.");
    }
  }

  function ensurePersonPreviewDialog() {
    if (personPreviewDialog) {
      return personPreviewDialog;
    }
    const dialog = document.createElement("dialog");
    dialog.className = "person-preview-dialog";
    dialog.innerHTML = `<div class="person-preview-shell" data-person-preview-content></div>`;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-person-preview]")) {
        dialog.close?.();
        return;
      }
      const saveButton = event.target.closest("[data-preview-save-person]");
      if (saveButton && global.savedDataClient) {
        const person = JSON.parse(saveButton.dataset.previewSavePerson || "{}");
        global.savedDataClient.togglePerson(person).then(() => {
          const saved = global.savedDataClient.getSnapshot().savedPeople.some((entry) => String(entry.id) === String(person.id));
          saveButton.textContent = saved ? "Saved person ✓" : "Save person";
          saveButton.classList.toggle("is-saved", saved);
        });
      }
    });
    document.body.append(dialog);
    personPreviewDialog = dialog;
    return dialog;
  }

  function renderPersonPreview(dialog, person, category) {
    const content = dialog.querySelector("[data-person-preview-content]");
    const department = person.department || category;
    const saved = global.savedDataClient?.getSnapshot().savedPeople.some((entry) => String(entry.id) === String(person.id));
    const personPayload = JSON.stringify({ ...person, department }).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const params = new URLSearchParams({ category, query: person.name, exactMatch: "1" });
    content.innerHTML = `
      <button type="button" class="person-preview-close" data-close-person-preview aria-label="Close person profile">×</button>
      <div class="person-preview-portrait">${person.profileUrl ? `<img src="${escapeAttribute(person.profileUrl)}" alt="${escapeAttribute(person.name)}" />` : `<span>${escapeHtml(person.name).slice(0, 2)}</span>`}</div>
      <div class="person-preview-copy">
        <p class="section-label">${escapeHtml(department)}</p>
        <h2>${escapeHtml(person.name)}</h2>
        <p>${person.knownFor?.length ? `Known for ${escapeHtml(person.knownFor.join(", "))}` : "Filmography available from Home."}</p>
        <div class="person-preview-actions">
          <button type="button" class="ghost-button ${saved ? "is-saved" : ""}" data-preview-save-person="${personPayload}">${saved ? "Saved person ✓" : "Save person"}</button>
          <a class="watchlist-button" href="/?${params.toString()}">View movies</a>
        </div>
      </div>`;
  }

  function categoryFromDepartment(department, fallback) {
    const label = String(department || "").toLowerCase();
    if (label.includes("direct")) return "directors";
    if (label.includes("produc")) return "producers";
    if (label.includes("writ") || label.includes("story") || label.includes("screenplay")) return "writers";
    if (label.includes("act")) return "actors";
    return fallback || "actors";
  }

  function renderPersonPreviewState(dialog, title, message) {
    dialog.querySelector("[data-person-preview-content]").innerHTML = `
      <button type="button" class="person-preview-close" data-close-person-preview aria-label="Close person profile">×</button>
      <div class="person-preview-copy"><p class="section-label">Person profile</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
  }

  function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function openWatchProviderDialog() {
    const dialog = ensureWatchProviderDialog();
    const title = dialog.querySelector("[data-watch-provider-title]");
    const regionSelect = dialog.querySelector("[data-watch-provider-region]");
    if (title) {
      title.textContent = watchProviderState.movieTitle;
    }
    if (regionSelect) {
      ensureRegionOption(regionSelect, watchProviderState.region);
      regionSelect.value = watchProviderState.region;
    }

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
    loadWatchProviders();
  }

  function ensureWatchProviderDialog() {
    if (watchProviderDialog) {
      return watchProviderDialog;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "watch-provider-dialog";
    dialog.setAttribute("aria-labelledby", "watch-provider-dialog-title");
    dialog.innerHTML = `
      <div class="watch-provider-dialog-shell">
        <header class="watch-provider-dialog-header">
          <div>
            <p class="section-label">Where to watch</p>
            <h2 id="watch-provider-dialog-title" data-watch-provider-title></h2>
          </div>
          <button type="button" class="ghost-button watch-provider-dialog-close" data-watch-provider-close aria-label="Close where to watch">Close</button>
        </header>
        <div class="watch-provider-toolbar">
          <label class="watch-provider-region-control">
            <span>Availability in</span>
            <select data-watch-provider-region aria-label="Viewing availability country"></select>
          </label>
          <p>Choose your country to see current streaming, rental, and purchase options.</p>
        </div>
        <div class="watch-provider-results" data-watch-provider-results aria-live="polite"></div>
        <footer class="watch-provider-attribution">
          Availability data supplied by
          <a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a>
          via
          <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>.
        </footer>
      </div>
    `;

    const regionSelect = dialog.querySelector("[data-watch-provider-region]");
    watchRegionOptions.forEach((region) => ensureRegionOption(regionSelect, region));
    ensureRegionOption(regionSelect, watchProviderState.region);
    regionSelect.value = watchProviderState.region;
    regionSelect.addEventListener("change", () => {
      watchProviderState.region = regionSelect.value;
      loadWatchProviders();
    });

    dialog.querySelector("[data-watch-provider-close]")?.addEventListener("click", () => {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
    });
    dialog.addEventListener("close", () => {
      watchProviderState.requestToken += 1;
      watchProviderState.trigger?.focus();
    });

    document.body.append(dialog);
    watchProviderDialog = dialog;
    return dialog;
  }

  function ensureRegionOption(select, region) {
    if (!select || !/^[A-Z]{2}$/.test(region) || select.querySelector(`option[value="${region}"]`)) {
      return;
    }
    const option = document.createElement("option");
    option.value = region;
    option.textContent = `${getRegionLabel(region)} (${region})`;
    select.append(option);
  }

  async function loadWatchProviders() {
    const dialog = ensureWatchProviderDialog();
    const results = dialog.querySelector("[data-watch-provider-results]");
    const movieId = watchProviderState.movieId;
    const region = watchProviderState.region;
    const movieTitle = watchProviderState.movieTitle;
    const requestToken = ++watchProviderState.requestToken;

    if (!results || !Number.isInteger(movieId)) {
      return;
    }

    renderWatchProviderMessage(
      results,
      `Checking ${getRegionLabel(region)}…`,
      "Looking for current streaming, rental, and purchase options.",
    );
    dialog.setAttribute("aria-busy", "true");

    try {
      const cacheKey = `${movieId}:${region}`;
      let payload = watchProviderCache.get(cacheKey);
      if (!payload) {
        const response = await global.fetch(
          `/api/watch-providers?movieId=${encodeURIComponent(String(movieId))}&region=${encodeURIComponent(region)}&title=${encodeURIComponent(movieTitle)}`,
          { credentials: "same-origin", headers: { Accept: "application/json" } },
        );
        payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Viewing options are unavailable right now.");
        }
        watchProviderCache.set(cacheKey, payload);
      }

      if (requestToken !== watchProviderState.requestToken) {
        return;
      }
      renderWatchProviderResults(results, payload, movieTitle, region);
    } catch (error) {
      if (requestToken !== watchProviderState.requestToken) {
        return;
      }
      renderWatchProviderError(
        results,
        error instanceof Error ? error.message : "Viewing options are unavailable right now.",
      );
    } finally {
      if (requestToken === watchProviderState.requestToken) {
        dialog.removeAttribute("aria-busy");
      }
    }
  }

  function renderWatchProviderResults(container, payload, movieTitle, region) {
    container.replaceChildren();

    const intro = document.createElement("p");
    intro.className = "watch-provider-location";
    intro.textContent = `Current options for ${getRegionLabel(region)}. Select a service to search for this title.`;
    container.append(intro);

    const groups = document.createElement("div");
    groups.className = "watch-provider-groups";
    let renderedProviderCount = 0;
    const watchLink = normalizeExternalWatchLink(payload?.link);

    watchProviderGroups.forEach((groupConfig) => {
      const providers = Array.isArray(payload?.providers?.[groupConfig.key])
        ? payload.providers[groupConfig.key]
        : [];
      if (!providers.length) {
        return;
      }

      const section = document.createElement("section");
      const heading = document.createElement("h3");
      const list = document.createElement("div");
      section.className = "watch-provider-group";
      heading.textContent = groupConfig.label;
      list.className = "watch-provider-list";

      providers.forEach((provider) => {
        const providerLink = normalizeProviderOutboundLink(provider.link);
        const item = providerLink ? document.createElement("a") : document.createElement("span");
        item.className = "watch-provider-item";
        if (providerLink) {
          const usesAvailabilityFallback = provider.linkType === "availability";
          const opensProviderHome = provider.linkType === "provider-home";
          item.href = providerLink;
          item.target = "_blank";
          item.rel = "noopener noreferrer";
          item.setAttribute(
            "aria-label",
            usesAvailabilityFallback
              ? `Find ${movieTitle} from ${provider.name} on JustWatch (opens in a new tab)`
              : opensProviderHome
                ? `Open ${provider.name} to look for ${movieTitle} (opens in a new tab)`
                : `Search for ${movieTitle} on ${provider.name} (opens in a new tab)`,
          );
          item.title = usesAvailabilityFallback
            ? "Check this option on JustWatch"
            : opensProviderHome
              ? `Open ${provider.name}`
              : `Search ${provider.name}`;
        }

        const logoUrl = normalizeProviderLogoUrl(provider.logoUrl);
        if (logoUrl) {
          const logo = document.createElement("img");
          logo.src = logoUrl;
          logo.alt = "";
          logo.loading = "lazy";
          logo.width = 38;
          logo.height = 38;
          logo.addEventListener("error", () => logo.remove(), { once: true });
          item.append(logo);
        }

        const copy = document.createElement("span");
        const name = document.createElement("strong");
        const destination = document.createElement("small");
        copy.className = "watch-provider-item-copy";
        name.textContent = String(provider.name || "Provider");
        destination.textContent = provider.linkType === "availability"
          ? "Check on JustWatch ↗"
          : provider.linkType === "provider-home"
            ? "Open provider ↗"
            : "Search provider ↗";
        copy.append(name, destination);
        item.append(copy);
        list.append(item);
        renderedProviderCount += 1;
      });

      section.append(heading, list);
      groups.append(section);
    });

    if (!renderedProviderCount) {
      renderWatchProviderMessage(
        container,
        `No options found in ${getRegionLabel(region)}`,
        "Availability changes regularly. Try another country or check again later.",
        { preserveExisting: true },
      );
      return;
    }

    container.append(groups);
    if (watchLink) {
      const openAllLink = document.createElement("a");
      openAllLink.className = "ghost-button watch-provider-open-all";
      openAllLink.href = watchLink;
      openAllLink.target = "_blank";
      openAllLink.rel = "noopener noreferrer";
      openAllLink.textContent = "Open all viewing options on TMDB";
      openAllLink.setAttribute("aria-label", `Open all viewing options for ${movieTitle} on TMDB (opens in a new tab)`);
      container.append(openAllLink);
    }
  }

  function renderWatchProviderMessage(container, title, message, options = {}) {
    if (!options.preserveExisting) {
      container.replaceChildren();
    }
    const state = document.createElement("div");
    const heading = document.createElement("strong");
    const copy = document.createElement("p");
    state.className = "watch-provider-state";
    heading.textContent = title;
    copy.textContent = message;
    state.append(heading, copy);
    container.append(state);
  }

  function renderWatchProviderError(container, message) {
    container.replaceChildren();
    const state = document.createElement("div");
    const heading = document.createElement("strong");
    const copy = document.createElement("p");
    const retry = document.createElement("button");
    state.className = "watch-provider-state is-error";
    heading.textContent = "Couldn’t load viewing options";
    copy.textContent = message;
    retry.type = "button";
    retry.className = "ghost-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadWatchProviders);
    state.append(heading, copy, retry);
    container.append(state);
  }

  function resolveDefaultWatchRegion() {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (timeZone.startsWith("Australia/")) {
        return "AU";
      }
      if (timeZone === "Pacific/Auckland" || timeZone === "Pacific/Chatham") {
        return "NZ";
      }
    } catch {
      // Fall back to the browser locale.
    }

    const locales = Array.isArray(global.navigator?.languages) && global.navigator.languages.length
      ? global.navigator.languages
      : [global.navigator?.language || "en-US"];
    for (const locale of locales) {
      try {
        const region = typeof Intl.Locale === "function" ? new Intl.Locale(locale).region : "";
        if (/^[A-Z]{2}$/.test(region || "")) {
          return region;
        }
      } catch {
        // Try the next browser locale.
      }
    }
    return "US";
  }

  function getRegionLabel(region) {
    try {
      if (typeof Intl.DisplayNames === "function") {
        return new Intl.DisplayNames([global.navigator?.language || "en"], { type: "region" }).of(region) || region;
      }
    } catch {
      // Fall back to the two-letter region code.
    }
    return region;
  }

  function normalizeExternalWatchLink(value) {
    try {
      const url = new URL(String(value || ""));
      if (
        url.protocol === "https:"
        && (url.hostname === "www.themoviedb.org" || url.hostname === "themoviedb.org")
      ) {
        return url.toString();
      }
    } catch {
      // Ignore malformed upstream links.
    }
    return "";
  }

  function normalizeProviderOutboundLink(value) {
    const allowedHosts = new Set([
      "binge.com.au",
      "play.google.com",
      "tubitv.com",
      "tv.apple.com",
      "watch.plex.tv",
      "www.crunchyroll.com",
      "www.disneyplus.com",
      "www.fetchtv.com.au",
      "www.foxtel.com.au",
      "www.hulu.com",
      "www.justwatch.com",
      "www.kanopy.com",
      "www.max.com",
      "www.netflix.com",
      "www.paramountplus.com",
      "www.peacocktv.com",
      "www.primevideo.com",
      "www.stan.com.au",
      "www.youtube.com",
    ]);
    try {
      const url = new URL(String(value || ""));
      if (url.protocol === "https:" && allowedHosts.has(url.hostname)) {
        return url.toString();
      }
    } catch {
      // Ignore malformed or untrusted provider links.
    }
    return "";
  }

  function normalizeProviderLogoUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol === "https:" && url.hostname === "image.tmdb.org") {
        return url.toString();
      }
    } catch {
      // Ignore malformed upstream image URLs.
    }
    return "";
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
