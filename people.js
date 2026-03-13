const elements = {
  indexSummary: document.querySelector("#index-summary"),
  directoryResultsSummary: document.querySelector("#directory-results-summary"),
  directoryHeading: document.querySelector("#directory-grid-heading"),
  directoryGrid: document.querySelector("#directory-grid"),
  cardTemplate: document.querySelector("#person-card-template"),
  navActors: document.querySelector("#nav-actors"),
  navProducers: document.querySelector("#nav-producers"),
};
const devStatusFlagKey = "wtfcineverfind-debug";

const pageState = {
  department: readDepartmentFromUrl(),
  currentPeople: [],
  currentTotal: 0,
  renderToken: 0,
};

bootstrap().catch((error) => {
  if (elements.directoryResultsSummary) {
    elements.directoryResultsSummary.textContent = error.message;
  }
});

async function bootstrap() {
  applyDevStatusVisibility();
  updateActiveTab();
  applyDepartmentCopy();
  syncCatalogRoleChoices();
  bindEvents();

  const statusPromise = fetchJsonWithTimeout("/api/index-status", 2500);
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
  elements.indexSummary.textContent = "";

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

function applyDevStatusVisibility() {
  const showDevStatus =
    new URLSearchParams(window.location.search).get("debug") === "1" ||
    window.localStorage.getItem(devStatusFlagKey) === "1";

  const strip = elements.indexSummary?.closest(".status-strip");
  if (strip) {
    strip.hidden = !showDevStatus;
  }
}

function bindEvents() {
  elements.directoryGrid.addEventListener("click", handlePersonSelection);
  window.addEventListener("popstate", handlePopState);
}

function renderDirectory() {
  pageState.renderToken += 1;
  const renderToken = pageState.renderToken;
  const sorted = pageState.currentPeople || [];

  elements.directoryResultsSummary.textContent = `${pageState.currentTotal || sorted.length} ${departmentLabelPlural(pageState.department)} in this view.`;
  elements.directoryGrid.replaceChildren();

  if (!sorted.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = "<h3>No suggestions yet.</h3><p>The next snapshot pass should fill this list.</p>";
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

async function refreshDirectory() {
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
}

async function handlePopState() {
  pageState.department = readDepartmentFromUrl();
  updateActiveTab();
  applyDepartmentCopy();
  syncCatalogRoleChoices();
  await loadDirectoryForDepartment(pageState.department, currentDirectoryQuery());
  renderDirectory();
}

function applyDepartmentCopy() {
  const labels = {
    actors: {
      title: "Suggested 50 actors",
    },
    directors: {
      title: "Suggested 50 directors",
    },
    producers: {
      title: "Suggested 50 producers",
    },
  };

  const current = labels[pageState.department];
  if (elements.directoryHeading) {
    elements.directoryHeading.textContent = current.title;
  }
}

function syncCatalogRoleChoices() {
  const roleSegments = document.querySelector("[data-role-segments]");
  const roleInput = document.querySelector("[data-role-input]");
  const roleLabel = document.querySelector("[data-role-label]");
  if (!roleSegments || !roleInput || !roleLabel) {
    return;
  }

  const choices =
    pageState.department === "actors"
      ? [
          ["any", "Any"],
          ["cast", "Cast"],
        ]
      : [
          ["any", "Any"],
          ["director", "Director"],
          ["producer", "Producer"],
        ];

  roleSegments.replaceChildren();
  choices.forEach(([value, label], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment${index === 0 ? " is-active" : ""}`;
    button.dataset.roleChoice = value;
    button.textContent = label;
    roleSegments.append(button);
  });

  roleInput.value = "any";
  roleLabel.textContent = "Any role";
  roleSegments.style.gridTemplateColumns = `repeat(${choices.length}, minmax(0, 1fr))`;
}

function updateActiveTab() {
  elements.navActors.classList.toggle("is-active", pageState.department === "actors");
  elements.navProducers.classList.toggle(
    "is-active",
    pageState.department === "directors" || pageState.department === "producers",
  );
}

function readDepartmentFromUrl() {
  const department = new URLSearchParams(window.location.search).get("department");
  if (department === "directors" || department === "producers") {
    return department;
  }
  return "actors";
}

async function loadDirectoryForDepartment(department, options = {}) {
  const params = new URLSearchParams();
  params.set("department", department);
  params.set("limit", String(options.limit || 10));

  const payload = await fetchJson(`/api/people-directory?${params.toString()}`);
  pageState.currentPeople = payload.people || [];
  pageState.currentTotal = Number(payload.total || pageState.currentPeople.length);
}

function currentDirectoryQuery() {
  return {
    limit: 50,
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
