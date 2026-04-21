"use strict";

(function accountPageBootstrap() {
  const elements = {
    status: document.querySelector("#account-status"),
    savedTitlesCount: document.querySelector("#account-saved-titles-count"),
    savedPeopleCount: document.querySelector("#account-saved-people-count"),
    activeSessionsCount: document.querySelector("#account-active-sessions-count"),
    summaryCard: document.querySelector("#account-summary-card"),
    sessionsSummary: document.querySelector("#account-sessions-summary"),
    sessionsList: document.querySelector("#account-sessions-list"),
    revokeOtherSessionsButton: document.querySelector("#revoke-other-sessions-button"),
  };

  if (!elements.status || !elements.summaryCard || !elements.sessionsList) {
    return;
  }

  const state = {
    session: null,
    account: null,
    sessions: [],
    loading: false,
    revokingOthers: false,
    error: "",
    info: "",
  };

  elements.revokeOtherSessionsButton?.addEventListener("click", handleRevokeOtherSessions);
  elements.sessionsList.addEventListener("click", handleSessionClick);
  window.addEventListener("auth:session", handleAuthSession);

  const initialSession = window.moviePickerAuth?.session || null;
  if (initialSession) {
    void handleSessionResolved(initialSession);
  } else {
    render();
  }

  async function handleAuthSession(event) {
    const session = event.detail?.session || null;
    await handleSessionResolved(session);
  }

  async function handleSessionResolved(session) {
    state.session = session;
    state.error = "";
    if (!session?.authenticated || !session.user) {
      state.account = null;
      state.sessions = [];
      state.loading = false;
      state.revokingOthers = false;
      state.info = "";
      render();
      return;
    }

    await loadAccountData();
  }

  async function loadAccountData(options = {}) {
    if (!state.session?.authenticated || !state.session.user) {
      return;
    }

    state.loading = true;
    if (!options.preserveInfo) {
      state.info = "";
    }
    state.error = "";
    render();

    try {
      const [accountPayload, sessionsPayload] = await Promise.all([
        fetchJson("/api/me/account"),
        fetchJson("/api/me/sessions"),
      ]);
      state.account = accountPayload || null;
      state.sessions = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
      state.error = "";
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to load account settings.";
    } finally {
      state.loading = false;
      state.revokingOthers = false;
      render();
    }
  }

  async function handleRevokeOtherSessions() {
    const otherSessionCount = state.sessions.filter((session) => !session.isCurrent).length;
    if (!state.session?.authenticated || !otherSessionCount || state.revokingOthers) {
      return;
    }

    state.revokingOthers = true;
    state.error = "";
    state.info = "";
    render();

    try {
      const payload = await fetchJson("/api/me/sessions/revoke-other", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_requested_revoke_other_sessions" }),
      });
      state.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
      state.info = otherSessionCount === 1 ? "Signed out 1 other session." : `Signed out ${otherSessionCount} other sessions.`;
      await loadAccountData({ preserveInfo: true });
    } catch (error) {
      state.revokingOthers = false;
      state.error = error instanceof Error ? error.message : "Unable to sign out other sessions.";
      render();
    }
  }

  async function handleSessionClick(event) {
    const button = event.target.closest("[data-session-revoke-id]");
    if (!button) {
      return;
    }

    const sessionId = Number(button.dataset.sessionRevokeId);
    if (!Number.isInteger(sessionId) || sessionId <= 0 || button.disabled) {
      return;
    }

    button.disabled = true;
    state.error = "";
    state.info = "";
    render();

    try {
      const payload = await fetchJson(`/api/me/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      state.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
      state.info = "Session signed out.";
      await loadAccountData({ preserveInfo: true });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to sign out that session.";
      button.disabled = false;
      render();
    }
  }

  function render() {
    const session = state.session || { authenticated: false, user: null };
    const isAuthenticated = Boolean(session.authenticated && session.user);
    const overview = state.account?.overview || {};
    const otherSessionCount = state.sessions.filter((entry) => !entry.isCurrent).length;

    elements.savedTitlesCount.textContent = isAuthenticated ? String(overview.savedTitlesCount || 0) : "0";
    elements.savedPeopleCount.textContent = isAuthenticated ? String(overview.savedPeopleCount || 0) : "0";
    elements.activeSessionsCount.textContent = isAuthenticated ? String(overview.activeSessionsCount || 0) : "0";

    if (!isAuthenticated) {
      elements.status.textContent = "Sign in with Google to review your account and active sessions.";
      elements.sessionsSummary.textContent = "Account session controls appear after you sign in.";
      elements.revokeOtherSessionsButton.disabled = true;
      elements.summaryCard.innerHTML = `
        <div class="account-empty-state">
          <h3>No signed-in account in this browser</h3>
          <p>Anonymous browsing and local saves still work. Sign in when you want synced settings and session controls.</p>
        </div>
      `;
      elements.sessionsList.innerHTML = `
        <div class="account-empty-state">
          <h3>No active account sessions to show</h3>
          <p>Your signed-in devices will appear here once you create a session.</p>
        </div>
      `;
      return;
    }

    elements.status.textContent = state.error
      ? state.error
      : state.info
        ? state.info
        : state.loading
          ? "Loading account settings."
          : "Account settings loaded.";
    elements.sessionsSummary.textContent = state.loading
      ? "Loading active sessions."
      : state.sessions.length
        ? `${state.sessions.length} active session${state.sessions.length === 1 ? "" : "s"} across your account.`
        : "No active sessions found.";
    elements.revokeOtherSessionsButton.disabled = state.loading || state.revokingOthers || !otherSessionCount;
    elements.revokeOtherSessionsButton.textContent = state.revokingOthers
      ? "Signing out others..."
      : "Sign out other sessions";

    elements.summaryCard.innerHTML = renderAccountSummaryCard(session.user, state.account?.overview || {});
    elements.sessionsList.innerHTML = state.sessions.length
      ? state.sessions.map(renderSessionCard).join("")
      : `
        <div class="account-empty-state">
          <h3>No active sessions found</h3>
          <p>New sign-ins from other browsers or devices will show up here.</p>
        </div>
      `;
  }

  function renderAccountSummaryCard(user, overview) {
    const displayName = user.displayName || user.email || "Account";
    const joinedAt = formatDate(user.createdAt);
    const lastLoginAt = formatDateTime(user.lastLoginAt);
    const emailStatus = user.emailVerified ? "Verified Google account" : "Google account";
    const avatar = user.avatarUrl
      ? `<img class="account-summary-avatar-image" src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(displayName)}" referrerpolicy="no-referrer" />`
      : `<span class="account-summary-avatar-fallback">${escapeHtml(initialsForName(displayName))}</span>`;

    return `
      <article class="account-summary-shell">
        <div class="account-summary-identity">
          <span class="account-summary-avatar">${avatar}</span>
          <div class="account-summary-copy">
            <p class="account-summary-kicker">${escapeHtml(emailStatus)}</p>
            <h3>${escapeHtml(displayName)}</h3>
            <p>${escapeHtml(user.email || "")}</p>
          </div>
        </div>
        <dl class="account-summary-facts">
          <div>
            <dt>Member since</dt>
            <dd>${escapeHtml(joinedAt)}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>${escapeHtml(lastLoginAt)}</dd>
          </div>
          <div>
            <dt>Synced library</dt>
            <dd>${Number(overview.savedTitlesCount || 0)} titles and ${Number(overview.savedPeopleCount || 0)} people</dd>
          </div>
        </dl>
      </article>
    `;
  }

  function renderSessionCard(sessionEntry) {
    const label = inferSessionLabel(sessionEntry.userAgent);
    const meta = [
      formatRelativeOrAbsolute(sessionEntry.lastSeenAt, "Last seen"),
      formatRelativeOrAbsolute(sessionEntry.createdAt, "Started"),
      sessionEntry.expiresAt ? `Expires ${formatDateTime(sessionEntry.expiresAt)}` : "",
      sessionEntry.ipAddress ? `IP ${sessionEntry.ipAddress}` : "",
    ].filter(Boolean);

    return `
      <article class="account-session-card ${sessionEntry.isCurrent ? "is-current" : ""}">
        <div class="account-session-copy">
          <div class="account-session-header">
            <h3>${escapeHtml(label)}</h3>
            <span class="account-session-pill ${sessionEntry.isCurrent ? "is-current" : ""}">
              ${sessionEntry.isCurrent ? "Current session" : "Active"}
            </span>
          </div>
          <p class="account-session-user-agent">${escapeHtml(sessionEntry.userAgent || "Browser details unavailable")}</p>
          <p class="account-session-meta">${escapeHtml(meta.join(" | "))}</p>
        </div>
        <div class="account-session-actions">
          ${
            sessionEntry.isCurrent
              ? `<span class="ghost-button account-session-static-action" aria-disabled="true">This browser</span>`
              : `
                <button type="button" class="ghost-button" data-session-revoke-id="${sessionEntry.id}">
                  Sign out
                </button>
              `
          }
        </div>
      </article>
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

  function inferSessionLabel(userAgent) {
    const agent = String(userAgent || "");
    if (!agent) {
      return "Browser session";
    }

    if (/iphone|ipad|ios/i.test(agent)) {
      return "iPhone or iPad";
    }
    if (/android/i.test(agent)) {
      return "Android device";
    }
    if (/mac os x|macintosh/i.test(agent)) {
      return "Mac browser";
    }
    if (/windows/i.test(agent)) {
      return "Windows browser";
    }
    if (/linux/i.test(agent)) {
      return "Linux browser";
    }
    return "Browser session";
  }

  function formatRelativeOrAbsolute(value, prefix) {
    if (!value) {
      return "";
    }

    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return `${prefix} recently`;
    }

    const elapsedMs = Date.now() - timestamp;
    const elapsedMinutes = Math.round(elapsedMs / (1000 * 60));
    if (elapsedMinutes >= 0 && elapsedMinutes < 60) {
      return `${prefix} ${elapsedMinutes || 1}m ago`;
    }

    const elapsedHours = Math.round(elapsedMinutes / 60);
    if (elapsedHours > 0 && elapsedHours < 24) {
      return `${prefix} ${elapsedHours}h ago`;
    }

    const elapsedDays = Math.round(elapsedHours / 24);
    if (elapsedDays > 0 && elapsedDays <= 7) {
      return `${prefix} ${elapsedDays}d ago`;
    }

    return `${prefix} ${formatDateTime(value)}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function initialsForName(value) {
    return String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
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
