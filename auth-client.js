"use strict";

(function authBootstrap() {
  const root = document.querySelector("[data-auth-root]");
  if (!root) {
    return;
  }

  const state = {
    session: null,
    config: null,
    isLoading: true,
    isSigningIn: false,
    isLoggingOut: false,
    error: "",
    info: "",
    googleScriptRequested: false,
    googleReady: false,
  };

  root.addEventListener("click", handleAuthClick);
  window.addEventListener("auth:refresh", () => {
    loadSession({ preserveInfo: false });
  });

  loadSession({ preserveInfo: false });

  async function loadSession(options = {}) {
    state.isLoading = true;
    if (!options.preserveInfo) {
      state.info = "";
    }
    render();

    try {
      const payload = await fetchJson("/api/auth/session");
      state.session = payload.session || { authenticated: false, user: null, expiresAt: null };
      state.config = payload.config || {};
      state.error = "";
      ensureGoogleClientReady();
    } catch (error) {
      state.session = { authenticated: false, user: null, expiresAt: null };
      state.config = {};
      state.error = error instanceof Error ? error.message : "Unable to load account state.";
    } finally {
      state.isLoading = false;
      state.isSigningIn = false;
      state.isLoggingOut = false;
      render();
      dispatchSessionEvent();
      ensureGoogleButtonRendered();
    }
  }

  async function handleAuthClick(event) {
    const trigger = event.target.closest("[data-auth-action]");
    if (!trigger) {
      return;
    }

    const action = trigger.dataset.authAction;
    if (action === "retry-google") {
      event.preventDefault();
      state.error = "";
      state.info = "";
      state.googleReady = false;
      state.googleScriptRequested = false;
      ensureGoogleClientReady();
      render();
      return;
    }

    if (action === "logout") {
      event.preventDefault();
      state.isLoggingOut = true;
      state.error = "";
      state.info = "";
      render();
      try {
        const payload = await fetchJson("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "user_initiated" }),
        });
        state.session = payload.session || { authenticated: false, user: null, expiresAt: null };
        state.info = "Signed out.";
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Unable to sign out right now.";
      } finally {
        state.isLoggingOut = false;
      }
      render();
      dispatchSessionEvent();
      ensureGoogleButtonRendered();
    }
  }

  function ensureGoogleClientReady() {
    const config = state.config || {};
    if (!config.signInEnabled || !config.googleClientId || state.googleScriptRequested) {
      return;
    }

    state.googleScriptRequested = true;

    if (window.google?.accounts?.id) {
      initializeGoogleClient();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      initializeGoogleClient();
      render();
      ensureGoogleButtonRendered();
    };
    script.onerror = () => {
      state.googleScriptRequested = false;
      state.googleReady = false;
      state.error = "Unable to load Google sign-in right now.";
      render();
    };
    document.head.appendChild(script);
  }

  function initializeGoogleClient() {
    const config = state.config || {};
    if (!config.googleClientId || !window.google?.accounts?.id) {
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
      context: "signin",
    });
    state.googleReady = true;
  }

  function ensureGoogleButtonRendered() {
    const session = state.session || { authenticated: false, user: null, expiresAt: null };
    const isAuthenticated = Boolean(session.authenticated && session.user);
    const googleButtonRoot = root.querySelector("[data-google-button]");
    if (!googleButtonRoot || isAuthenticated || !state.googleReady || state.isLoading || state.isSigningIn) {
      return;
    }

    googleButtonRoot.innerHTML = "";
    try {
      window.google.accounts.id.renderButton(googleButtonRoot, {
        type: "standard",
        theme: "outline",
        size: "medium",
        text: "signin_with",
        shape: "pill",
        logo_alignment: "left",
        width: 220,
      });
    } catch {
      state.error = "Unable to render Google sign-in right now.";
      render();
    }
  }

  async function handleGoogleCredential(response) {
    const credential = response?.credential || "";
    if (!credential) {
      state.error = "Google did not return a sign-in credential.";
      render();
      return;
    }

    state.isSigningIn = true;
    state.error = "";
    state.info = "";
    render();

    try {
      const payload = await fetchJson("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      state.session = payload.session || {
        authenticated: true,
        user: payload.user || null,
        expiresAt: null,
      };
      state.info = "Signed in successfully. Saved titles and people now sync to your account after they load.";
      state.error = "";
      await loadSession({ preserveInfo: true });
    } catch (error) {
      state.isSigningIn = false;
      state.error = error instanceof Error ? error.message : "Unable to complete Google sign-in.";
      render();
      ensureGoogleButtonRendered();
    }
  }

  function dispatchSessionEvent() {
    window.moviePickerAuth = {
      session: state.session,
      config: state.config,
    };
    window.dispatchEvent(
      new CustomEvent("auth:session", {
        detail: {
          session: state.session,
          config: state.config,
          error: state.error,
        },
      }),
    );
  }

  function render() {
    const session = state.session || { authenticated: false, user: null, expiresAt: null };
    const isAuthenticated = Boolean(session.authenticated && session.user);

    root.innerHTML = `
      <div class="account-shell">
        <div class="account-panel ${isAuthenticated ? "is-authenticated" : "is-anonymous"}">
          ${
            isAuthenticated
              ? renderSignedIn(session.user)
              : renderSignedOut()
          }
        </div>
        <p
          class="account-hint ${state.error ? "is-error" : state.info ? "is-success" : ""}"
          data-auth-hint
          ${(state.error || state.info) ? "" : "hidden"}
        >
          ${escapeHtml(state.error || state.info || "")}
        </p>
      </div>
    `;
  }

  function renderSignedOut() {
    const config = state.config || {};
    const signInEnabled = Boolean(config.signInEnabled && config.googleClientId);
    const canRenderGoogleButton = signInEnabled && state.googleReady && !state.error;
    const secondary = state.isLoading
      ? "Checking session..."
      : signInEnabled
        ? "Anonymous browsing stays enabled. Sign in with Google when you want an account session."
        : "Anonymous browsing is fully enabled.";
    const statusLabel = state.isSigningIn
      ? "Finishing Google sign-in..."
      : state.isLoading
        ? "Checking session..."
        : signInEnabled
          ? "Sign in with Google"
          : "Sign in unavailable";

    return `
      <div class="account-copy">
        <strong class="account-label">Account</strong>
        <span class="account-subtext">${escapeHtml(secondary)}</span>
      </div>
      <div class="account-actions">
        <span class="account-status-pill">${escapeHtml(statusLabel)}</span>
        ${
          canRenderGoogleButton
            ? `
              <div class="account-google-slot ${state.isSigningIn ? "is-busy" : ""}">
                <div class="account-google-button" data-google-button aria-label="Sign in with Google"></div>
              </div>
            `
            : signInEnabled
              ? `
              <button
                type="button"
                class="ghost-button account-action"
                data-auth-action="retry-google"
                ${state.isLoading ? "disabled" : ""}
              >
                Retry
              </button>
            `
              : `
              <button
                type="button"
                class="ghost-button account-action"
                disabled
              >
                Unavailable
              </button>
            `
        }
      </div>
    `;
  }

  function renderSignedIn(user) {
    const displayName = user.displayName || user.email || "Account";
    const avatar = user.avatarUrl
      ? `<img class="account-avatar-image" src="${escapeAttribute(user.avatarUrl)}" alt="${escapeAttribute(displayName)}" referrerpolicy="no-referrer" />`
      : `<span class="account-avatar-fallback">${escapeHtml(initialsForName(displayName))}</span>`;

    return `
      <div class="account-identity">
        <span class="account-avatar">${avatar}</span>
        <div class="account-copy">
          <strong class="account-label">${escapeHtml(displayName)}</strong>
          <span class="account-subtext">${escapeHtml(user.email || "Signed in")}</span>
        </div>
      </div>
      <div class="account-actions">
        <a
          class="ghost-button account-action"
          href="/account.html"
        >
          Manage
        </a>
        <span class="account-status-pill is-success">Signed in</span>
        <button
          type="button"
          class="ghost-button account-action"
          data-auth-action="logout"
          ${state.isLoggingOut ? "disabled" : ""}
        >
          ${state.isLoggingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    `;
  }

  async function fetchJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    const csrfToken = state.session?.csrfToken || "";
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (csrfToken && method !== "GET" && method !== "HEAD") {
      headers.set("X-CSRF-Token", csrfToken);
    }

    const response = await window.fetch(url, {
      ...options,
      credentials: "same-origin",
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  function initialsForName(value) {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (!parts.length) {
      return "?";
    }

    return parts.map((part) => part.charAt(0).toUpperCase()).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
