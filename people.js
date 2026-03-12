const elements = {
  directoryTitle: document.querySelector("#directory-title"),
  directoryCopy: document.querySelector("#directory-copy"),
  directoryStatus: document.querySelector("#directory-status"),
  indexSummary: document.querySelector("#index-summary"),
  directoryResultsSummary: document.querySelector("#directory-results-summary"),
  directorySearch: document.querySelector("#directory-search"),
  directorySort: document.querySelector("#directory-sort"),
  directoryGrid: document.querySelector("#directory-grid"),
  cardTemplate: document.querySelector("#person-card-template"),
  navActors: document.querySelector("#nav-actors"),
  navProducers: document.querySelector("#nav-producers"),
};

const pageState = {
  department: readDepartmentFromUrl(),
  currentPeople: [],
  currentTotal: 0,
  renderToken: 0,
};

bootstrap().catch((error) => {
  elements.directoryStatus.textContent = error.message;
});

async function bootstrap() {
  updateActiveTab();
  applyDepartmentCopy();
  applyStateFromUrl();
  bindEvents();

  const statusPromise = fetchJsonWithTimeout("/api/index-status", 2500);
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
  elements.directoryStatus.textContent = "Local ranked people directory ready.";

  try {
    const statusPayload = await statusPromise;
    if (statusPayload.ready) {
      elements.indexSummary.textContent = `${statusPayload.counts.actors} actors, ${statusPayload.counts.directors} directors, and ${statusPayload.counts.producers} producers are loaded from the local ranked index${statusPayload.generatedAt ? ` (built ${formatDateTime(statusPayload.generatedAt)})` : ""}.`;
    } else {
      elements.indexSummary.textContent = "People index is syncing.";
    }
  } catch {
    elements.indexSummary.textContent = "Index status unavailable right now.";
  }
}

function bindEvents() {
  const debouncedRefresh = debounce(() => {
    void refreshDirectory();
  }, 220);
  elements.directorySearch.addEventListener("input", debouncedRefresh);
  elements.directorySort.addEventListener("change", handleControlChange);
  elements.directoryGrid.addEventListener("click", handlePersonSelection);
  window.addEventListener("popstate", handlePopState);
}

function renderDirectory() {
  pageState.renderToken += 1;
  const renderToken = pageState.renderToken;
  const sorted = pageState.currentPeople || [];

  elements.directoryResultsSummary.textContent = `${pageState.currentTotal || sorted.length} ${departmentLabelPlural(pageState.department)} in this ranked view.`;
  elements.directoryGrid.replaceChildren();

  if (!sorted.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = "<h3>No directory matches.</h3><p>Try a broader search or a different sort.</p>";
    elements.directoryGrid.append(emptyState);
    return;
  }

  const batchSize = 80;
  let index = 0;
  const appendBatch = () => {
    if (renderToken !== pageState.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + batchSize, sorted.length);
    for (let cursor = index; cursor < end; cursor += 1) {
      fragment.append(buildPersonCard(sorted[cursor]));
    }
    elements.directoryGrid.append(fragment);
    index = end;

    if (index < sorted.length) {
      window.requestAnimationFrame(appendBatch);
    }
  };

  window.requestAnimationFrame(appendBatch);
}

function buildPersonCard(person) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const portrait = fragment.querySelector(".person-card-portrait");
  const portraitFrame = fragment.querySelector(".person-card-visual");

  fragment.querySelector("h3").textContent = person.name;
  fragment.querySelector(".person-card-role").textContent = person.department;
  fragment.querySelector(".person-card-count").textContent =
    person.ratingLabel || "Career score unavailable";
  fragment.querySelector(".person-card-credits").textContent = person.knownFor?.length
    ? person.knownFor.join(", ")
    : "Known-for titles unavailable.";
  fragment.querySelector(".person-card-button").textContent = "Open in movie catalog";
  fragment.querySelector(".person-card-button").dataset.person = person.name;

  if (person.profileUrl) {
    portrait.src = person.profileUrl;
    portrait.alt = person.name;
  } else {
    portraitFrame.classList.add("is-empty");
    portrait.remove();
    portraitFrame.innerHTML = `<span>${person.name}</span>`;
  }

  return fragment;
}

function handlePersonSelection(event) {
  const button = event.target.closest("[data-person]");
  if (!button) {
    return;
  }

  const params = new URLSearchParams();
  params.set("person", button.dataset.person);
  window.location.href = `/${params.toString() ? `?${params.toString()}` : ""}`;
}

function handleControlChange() {
  void refreshDirectory();
}

async function refreshDirectory() {
  updateUrlState();
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
}

async function handlePopState() {
  pageState.department = readDepartmentFromUrl();
  applyStateFromUrl();
  updateActiveTab();
  applyDepartmentCopy();
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
}

function applyDepartmentCopy() {
  const labels = {
    actors: {
      title: "Actors",
      copy: "The full ranked actor and actress directory sourced from the local people index.",
    },
    directors: {
      title: "Directors",
      copy: "The full ranked director directory sourced from the local people index.",
    },
    producers: {
      title: "Producers",
      copy: "The full ranked producer directory sourced from the local people index.",
    },
  };

  const current = labels[pageState.department];
  elements.directoryTitle.textContent = current.title;
  elements.directoryCopy.textContent = current.copy;
}

function updateActiveTab() {
  elements.navActors.classList.toggle("is-active", pageState.department === "actors");
  elements.navProducers.classList.toggle("is-active", pageState.department !== "actors");
}

function readDepartmentFromUrl() {
  const department = new URLSearchParams(window.location.search).get("department");
  if (department === "directors" || department === "producers") {
    return department;
  }
  return "actors";
}

function applyStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  elements.directorySearch.value = params.get("q") || "";
  elements.directorySort.value = params.get("sort") || "score";
}

function updateUrlState() {
  const params = new URLSearchParams();
  params.set("department", pageState.department);
  if (elements.directorySearch.value.trim()) {
    params.set("q", elements.directorySearch.value.trim());
  }
  if (elements.directorySort.value !== "score") {
    params.set("sort", elements.directorySort.value);
  }
  window.history.replaceState(null, "", `/people.html?${params.toString()}`);
}

async function loadDirectoryForDepartment(department, options = {}) {
  const params = new URLSearchParams();
  params.set("department", department);
  params.set("sort", options.sort || "score");
  if (options.query) {
    params.set("q", options.query);
  }
  params.set("limit", String(options.limit || 10));

  const payload = await fetchJson(`/api/people-directory?${params.toString()}`);
  pageState.currentPeople = payload.people || [];
  pageState.currentTotal = Number(payload.total || pageState.currentPeople.length);
}

function currentDirectoryQuery() {
  const query = elements.directorySearch.value.trim();
  return {
    query,
    sort: elements.directorySort.value || "score",
    limit: query ? 500 : 10,
  };
}

function departmentLabelPlural(department) {
  if (department === "directors") {
    return "directors";
  }
  if (department === "producers") {
    return "producers";
  }
  return "actors and actresses";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.trim().slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`Unexpected non-JSON response (${response.status}) from ${url}: ${snippet}`);
  }

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Request failed");
  }

  return payload;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function debounce(callback, delayMs) {
  let timeoutId = 0;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delayMs);
  };
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}
