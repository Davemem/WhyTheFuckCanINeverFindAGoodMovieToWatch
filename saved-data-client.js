"use strict";

(function savedDataBootstrap() {
  const watchlistStorageKey = "wtfcineverfind-watchlist";
  const watchlistMoviesStorageKey = "wtfcineverfind-watchlist-movies";
  const savedPeopleStorageKey = "wtfcineverfind-saved-people";
  const importDecisionStorageKey = "wtfcineverfind-saved-import";
  const bannerRoots = [...document.querySelectorAll("[data-saved-sync-banner]")];
  const listeners = new Set();

  const state = {
    authResolved: false,
    authenticated: false,
    user: null,
    csrfToken: "",
    source: "local",
    loading: false,
    error: "",
    info: "",
    watchlist: new Set(),
    watchlistMovies: new Map(),
    savedPeople: new Map(),
    localWatchlist: new Set(),
    localWatchlistMovies: new Map(),
    localSavedPeople: new Map(),
    importPrompt: {
      visible: false,
      titleCount: 0,
      personCount: 0,
    },
  };

  loadLocalSnapshot();
  applyLocalSnapshotToActiveState();
  renderBanners();

  window.addEventListener("auth:session", (event) => {
    const session = event.detail?.session || null;
    state.csrfToken = session?.csrfToken || "";
    handleSessionChange(session).catch((error) => {
      state.error = error instanceof Error ? error.message : "Unable to load saved data.";
      state.loading = false;
      state.source = "remote-error";
      emitChange();
    });
  });

  bannerRoots.forEach((root) => {
    root.addEventListener("click", handleBannerClick);
  });

  window.savedDataClient = {
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    async toggleTitle(movie) {
      const normalizedMovie = normalizeMovie(movie);
      if (!normalizedMovie) {
        throw new Error("A valid movie payload is required.");
      }

      if (!state.authenticated) {
        if (state.watchlist.has(normalizedMovie.id)) {
          state.watchlist.delete(normalizedMovie.id);
          state.watchlistMovies.delete(normalizedMovie.id);
        } else {
          state.watchlist.add(normalizedMovie.id);
          state.watchlistMovies.set(normalizedMovie.id, normalizedMovie);
        }
        syncActiveStateToLocalSnapshot();
        persistLocalSnapshot();
        state.info = "";
        emitChange();
        return getSnapshot();
      }

      ensureRemoteWritable();
      if (state.watchlist.has(normalizedMovie.id)) {
        return removeRemoteTitle(normalizedMovie.id);
      }
      return saveRemoteTitle(normalizedMovie);
    },
    async removeTitle(movieId) {
      const normalizedMovieId = Number(movieId);
      if (!Number.isFinite(normalizedMovieId)) {
        throw new Error("A valid movie id is required.");
      }

      if (!state.authenticated) {
        state.watchlist.delete(normalizedMovieId);
        state.watchlistMovies.delete(normalizedMovieId);
        syncActiveStateToLocalSnapshot();
        persistLocalSnapshot();
        state.info = "";
        emitChange();
        return getSnapshot();
      }

      ensureRemoteWritable();
      return removeRemoteTitle(normalizedMovieId);
    },
    async togglePerson(person) {
      const normalizedPerson = normalizePerson(person);
      if (!normalizedPerson) {
        throw new Error("A valid person payload is required.");
      }

      if (!state.authenticated) {
        if (state.savedPeople.has(normalizedPerson.id)) {
          state.savedPeople.delete(normalizedPerson.id);
        } else {
          state.savedPeople.set(normalizedPerson.id, normalizedPerson);
        }
        syncActiveStateToLocalSnapshot();
        persistLocalSnapshot();
        state.info = "";
        emitChange();
        return getSnapshot();
      }

      ensureRemoteWritable();
      if (state.savedPeople.has(normalizedPerson.id)) {
        return removeRemotePerson(normalizedPerson.id);
      }
      return saveRemotePerson(normalizedPerson);
    },
    async removePerson(personId) {
      const normalizedPersonId = String(personId || "").trim();
      if (!normalizedPersonId) {
        throw new Error("A valid person id is required.");
      }

      if (!state.authenticated) {
        state.savedPeople.delete(normalizedPersonId);
        syncActiveStateToLocalSnapshot();
        persistLocalSnapshot();
        state.info = "";
        emitChange();
        return getSnapshot();
      }

      ensureRemoteWritable();
      return removeRemotePerson(normalizedPersonId);
    },
    normalizePerson,
    async refresh() {
      if (!state.authenticated) {
        loadLocalSnapshot();
        applyLocalSnapshotToActiveState();
        emitChange();
        return getSnapshot();
      }

      return loadRemoteState({ preserveInfo: true });
    },
    async importLocalState() {
      if (!state.authenticated || !state.user?.id) {
        throw new Error("Sign in to import local saved data.");
      }

      ensureRemoteWritable();

      const payload = {
        watchlist: [...state.localWatchlist],
        watchlistMovies: [...state.localWatchlistMovies.values()],
        savedPeople: [...state.localSavedPeople.values()],
      };

      const response = await fetchJson("/api/me/saved/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      applyRemotePayload(response);
      markImportDecision("imported");
      state.info = `Imported ${response.imported?.importedTitles || 0} titles and ${response.imported?.importedPeople || 0} people into your account.`;
      state.error = "";
      updateImportPrompt();
      emitChange();
      return getSnapshot();
    },
    dismissImportPrompt() {
      markImportDecision("dismissed");
      updateImportPrompt();
      emitChange();
    },
  };

  async function handleSessionChange(session) {
    const isAuthenticated = Boolean(session?.authenticated && session?.user);
    state.authResolved = true;
    state.authenticated = isAuthenticated;
    state.user = isAuthenticated ? session.user : null;
    state.csrfToken = session?.csrfToken || "";
    state.error = "";

    if (!isAuthenticated) {
      state.loading = false;
      state.source = "local";
      state.info = "";
      applyLocalSnapshotToActiveState();
      updateImportPrompt();
      emitChange();
      return;
    }

    await loadRemoteState({ preserveInfo: false });
  }

  async function loadRemoteState(options = {}) {
    state.loading = true;
    state.source = "remote-loading";
    if (!options.preserveInfo) {
      state.info = "";
    }
    emitChange();

    try {
      const payload = await fetchJson("/api/me/saved");
      applyRemotePayload(payload);
      state.source = "remote";
      state.error = "";
      updateImportPrompt();
    } catch (error) {
      state.source = "remote-error";
      state.error = error instanceof Error ? error.message : "Unable to load account saves.";
      state.watchlist = new Set();
      state.watchlistMovies = new Map();
      state.savedPeople = new Map();
      updateImportPrompt();
    } finally {
      state.loading = false;
      emitChange();
    }

    return getSnapshot();
  }

  async function saveRemoteTitle(movie) {
    const payload = await fetchJson("/api/me/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie }),
    });
    applyRemotePayload(payload);
    state.error = "";
    state.info = "";
    updateImportPrompt();
    emitChange();
    return getSnapshot();
  }

  async function removeRemoteTitle(movieId) {
    const payload = await fetchJson(`/api/me/watchlist/${encodeURIComponent(String(movieId))}`, {
      method: "DELETE",
    });
    applyRemotePayload(payload);
    state.error = "";
    state.info = "";
    updateImportPrompt();
    emitChange();
    return getSnapshot();
  }

  async function saveRemotePerson(person) {
    const payload = await fetchJson("/api/me/saved-people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person }),
    });
    applyRemotePayload(payload);
    state.error = "";
    state.info = "";
    updateImportPrompt();
    emitChange();
    return getSnapshot();
  }

  async function removeRemotePerson(personId) {
    const payload = await fetchJson(`/api/me/saved-people/${encodeURIComponent(String(personId))}`, {
      method: "DELETE",
    });
    applyRemotePayload(payload);
    state.error = "";
    state.info = "";
    updateImportPrompt();
    emitChange();
    return getSnapshot();
  }

  function loadLocalSnapshot() {
    state.localWatchlist = loadLocalWatchlist();
    state.localWatchlistMovies = loadLocalWatchlistMovies();
    state.localSavedPeople = loadLocalSavedPeople();
  }

  function applyLocalSnapshotToActiveState() {
    state.watchlist = new Set(state.localWatchlist);
    state.watchlistMovies = new Map(state.localWatchlistMovies);
    state.savedPeople = new Map(state.localSavedPeople);
  }

  function syncActiveStateToLocalSnapshot() {
    state.localWatchlist = new Set(state.watchlist);
    state.localWatchlistMovies = new Map(state.watchlistMovies);
    state.localSavedPeople = new Map(state.savedPeople);
  }

  function persistLocalSnapshot() {
    window.localStorage.setItem(watchlistStorageKey, JSON.stringify([...state.localWatchlist]));
    window.localStorage.setItem(
      watchlistMoviesStorageKey,
      JSON.stringify([...state.localWatchlistMovies.values()]),
    );
    window.localStorage.setItem(
      savedPeopleStorageKey,
      JSON.stringify([...state.localSavedPeople.values()]),
    );
  }

  function applyRemotePayload(payload) {
    state.watchlist = new Set(
      (Array.isArray(payload.watchlist) ? payload.watchlist : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    );
    state.watchlistMovies = new Map(
      (Array.isArray(payload.watchlistMovies) ? payload.watchlistMovies : [])
        .map(normalizeMovie)
        .filter(Boolean)
        .map((movie) => [movie.id, movie]),
    );
    state.savedPeople = new Map(
      (Array.isArray(payload.savedPeople) ? payload.savedPeople : [])
        .map(normalizePerson)
        .filter(Boolean)
        .map((person) => [person.id, person]),
    );

    for (const movieId of state.watchlist) {
      if (!state.watchlistMovies.has(movieId)) {
        state.watchlistMovies.set(movieId, { id: movieId, title: `Movie ${movieId}` });
      }
    }
  }

  function updateImportPrompt() {
    const pendingTitleCount = countMissingLocalTitles();
    const pendingPersonCount = countMissingLocalPeople();
    const decision = readImportDecision();
    state.importPrompt = {
      visible:
        Boolean(state.authenticated && state.source === "remote")
        && (pendingTitleCount > 0 || pendingPersonCount > 0)
        && decision !== "imported"
        && decision !== "dismissed",
      titleCount: pendingTitleCount,
      personCount: pendingPersonCount,
    };
  }

  function countMissingLocalTitles() {
    let count = 0;
    state.localWatchlist.forEach((movieId) => {
      if (!state.watchlist.has(movieId)) {
        count += 1;
      }
    });
    return count;
  }

  function countMissingLocalPeople() {
    let count = 0;
    state.localSavedPeople.forEach((person, personId) => {
      if (!state.savedPeople.has(personId) && person?.name) {
        count += 1;
      }
    });
    return count;
  }

  function markImportDecision(value) {
    if (!state.user?.id) {
      return;
    }
    const payload = readImportDecisionStore();
    payload[String(state.user.id)] = {
      value,
      fingerprint: localFingerprint(),
    };
    window.localStorage.setItem(importDecisionStorageKey, JSON.stringify(payload));
  }

  function readImportDecision() {
    if (!state.user?.id) {
      return "";
    }
    const payload = readImportDecisionStore();
    const entry = payload[String(state.user.id)];
    if (!entry || entry.fingerprint !== localFingerprint()) {
      return "";
    }
    return entry.value || "";
  }

  function readImportDecisionStore() {
    try {
      const payload = JSON.parse(window.localStorage.getItem(importDecisionStorageKey) || "{}");
      return payload && typeof payload === "object" ? payload : {};
    } catch {
      return {};
    }
  }

  function localFingerprint() {
    return JSON.stringify({
      watchlist: [...state.localWatchlist].sort((left, right) => left - right),
      savedPeople: [...state.localSavedPeople.keys()].sort(),
    });
  }

  function ensureRemoteWritable() {
    if (!state.authenticated) {
      return;
    }
    if (state.source !== "remote") {
      throw new Error(state.error || "Your account saves are unavailable right now. Try again after they reload.");
    }
  }

  function handleBannerClick(event) {
    const action = event.target.closest("[data-saved-sync-action]")?.dataset.savedSyncAction;
    if (!action) {
      return;
    }

    if (action === "import") {
      window.savedDataClient.importLocalState().catch((error) => {
        state.error = error instanceof Error ? error.message : "Unable to import local saved data.";
        emitChange();
      });
      return;
    }

    if (action === "dismiss-import") {
      window.savedDataClient.dismissImportPrompt();
      return;
    }

    if (action === "retry") {
      window.savedDataClient.refresh().catch((error) => {
        state.error = error instanceof Error ? error.message : "Unable to reload saved data.";
        emitChange();
      });
    }
  }

  function emitChange() {
    const snapshot = getSnapshot();
    renderBanners();
    listeners.forEach((listener) => listener(snapshot));
    window.dispatchEvent(new CustomEvent("saved-data:change", { detail: snapshot }));
  }

  function renderBanners() {
    bannerRoots.forEach((root) => {
      if (state.importPrompt.visible) {
        root.hidden = false;
        root.className = "saved-sync-banner is-visible";
        root.innerHTML = `
          <div class="saved-sync-banner-copy">
            <strong>Import saved titles and people from this browser</strong>
            <p>This brings your existing local saves into your account so they follow you across devices.</p>
          </div>
          <div class="saved-sync-banner-meta">
            <span>${state.importPrompt.titleCount} title${state.importPrompt.titleCount === 1 ? "" : "s"} and ${state.importPrompt.personCount} people waiting</span>
          </div>
          <div class="saved-sync-banner-actions">
            <button type="button" class="ghost-button" data-saved-sync-action="import">Import now</button>
            <button type="button" class="ghost-button" data-saved-sync-action="dismiss-import">Not now</button>
          </div>
        `;
        return;
      }

      if (state.authenticated && state.source === "remote-error" && state.error) {
        root.hidden = false;
        root.className = "saved-sync-banner is-visible is-error";
        root.innerHTML = `
          <div class="saved-sync-banner-copy">
            <strong>Account saves could not load</strong>
            <p>${escapeHtml(state.error)}</p>
          </div>
          <div class="saved-sync-banner-actions">
            <button type="button" class="ghost-button" data-saved-sync-action="retry">Retry</button>
          </div>
        `;
        return;
      }

      if (state.info) {
        root.hidden = false;
        root.className = "saved-sync-banner is-visible is-success";
        root.innerHTML = `
          <div class="saved-sync-banner-copy">
            <strong>Saved data updated</strong>
            <p>${escapeHtml(state.info)}</p>
          </div>
        `;
        return;
      }

      root.hidden = true;
      root.className = "saved-sync-banner";
      root.innerHTML = "";
    });
  }

  function getSnapshot() {
    return {
      authResolved: state.authResolved,
      authenticated: state.authenticated,
      user: state.user,
      source: state.source,
      loading: state.loading,
      error: state.error,
      info: state.info,
      watchlistIds: [...state.watchlist],
      watchlistMovies: [...state.watchlistMovies.values()],
      savedPeople: [...state.savedPeople.values()],
      importPrompt: { ...state.importPrompt },
      localState: {
        watchlistIds: [...state.localWatchlist],
        watchlistMovies: [...state.localWatchlistMovies.values()],
        savedPeople: [...state.localSavedPeople.values()],
      },
    };
  }

  function normalizeMovie(movie) {
    if (!movie || !Number.isFinite(Number(movie.id))) {
      return null;
    }
    return {
      ...movie,
      id: Number(movie.id),
    };
  }

  function normalizePerson(person) {
    const id = person?.id;
    if (id === null || id === undefined || String(id).trim() === "" || !person?.name) {
      return null;
    }
    return {
      ...person,
      id: String(id),
      bucket: typeof person.bucket === "string" ? person.bucket : classifySavedPersonBucket(person.department),
    };
  }

  function classifySavedPersonBucket(department) {
    const label = String(department || "").toLowerCase();
    if (label.includes("acting") || label.includes("actor") || label.includes("perform")) {
      return "actors";
    }
    if (label.includes("writ") || label.includes("screenplay") || label.includes("story")) {
      return "writers";
    }
    return "filmmakers";
  }

  function loadLocalWatchlist() {
    try {
      const raw = window.localStorage.getItem(watchlistStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(parsed.filter((value) => Number.isFinite(value)));
    } catch {
      return new Set();
    }
  }

  function loadLocalWatchlistMovies() {
    try {
      const raw = window.localStorage.getItem(watchlistMoviesStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Map(
        parsed
          .map(normalizeMovie)
          .filter(Boolean)
          .map((movie) => [movie.id, movie]),
      );
    } catch {
      return new Map();
    }
  }

  function loadLocalSavedPeople() {
    try {
      const raw = window.localStorage.getItem(savedPeopleStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Map(
        parsed
          .map(normalizePerson)
          .filter(Boolean)
          .map((person) => [person.id, person]),
      );
    } catch {
      return new Map();
    }
  }

  async function fetchJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (state.csrfToken && method !== "GET" && method !== "HEAD") {
      headers.set("X-CSRF-Token", state.csrfToken);
    }

    const response = await window.fetch(url, {
      ...options,
      credentials: "same-origin",
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.detail || "Request failed");
    }
    return payload;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
