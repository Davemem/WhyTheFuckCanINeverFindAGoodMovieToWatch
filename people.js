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
  tabActors: document.querySelector("#tab-actors"),
  tabDirectors: document.querySelector("#tab-directors"),
  tabProducers: document.querySelector("#tab-producers"),
};

const pageState = {
  department: readDepartmentFromUrl(),
  directories: {
    actors: [],
    directors: [],
    producers: [],
  },
};

bootstrap().catch((error) => {
  elements.directoryStatus.textContent = error.message;
});

async function bootstrap() {
  updateActiveTab();
  applyDepartmentCopy();
  applyStateFromUrl();
  bindEvents();

  const [statusPayload, actorsPayload, directorsPayload, producersPayload] = await Promise.all([
    fetchJson("/api/index-status"),
    fetchJson("/api/people-directory?department=actors"),
    fetchJson("/api/people-directory?department=directors"),
    fetchJson("/api/people-directory?department=producers"),
  ]);

  pageState.directories.actors = actorsPayload.people || [];
  pageState.directories.directors = directorsPayload.people || [];
  pageState.directories.producers = producersPayload.people || [];

  if (statusPayload.ready) {
    elements.indexSummary.textContent = `${statusPayload.counts.actors} actors, ${statusPayload.counts.directors} directors, and ${statusPayload.counts.producers} producers are loaded from the local ranked index${statusPayload.generatedAt ? ` (built ${formatDateTime(statusPayload.generatedAt)})` : ""}.`;
  } else {
    elements.indexSummary.textContent =
      "The local index is not available yet, so this page is showing the fallback sample.";
  }

  elements.directoryStatus.textContent = "Local ranked people directory ready.";
  renderDirectory();
}

function bindEvents() {
  elements.directorySearch.addEventListener("input", handleControlChange);
  elements.directorySort.addEventListener("change", handleControlChange);
  elements.directoryGrid.addEventListener("click", handlePersonSelection);
  window.addEventListener("popstate", handlePopState);
}

function renderDirectory() {
  const source = pageState.directories[pageState.department] || [];
  const filtered = filterPeopleDirectory(source, elements.directorySearch.value);
  const sorted = sortPeopleDirectory(filtered, elements.directorySort.value);

  elements.directoryResultsSummary.textContent = `${sorted.length} ${departmentLabelPlural(pageState.department)} in this ranked view.`;
  elements.directoryGrid.replaceChildren();

  if (!sorted.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML = "<h3>No directory matches.</h3><p>Try a broader search or a different sort.</p>";
    elements.directoryGrid.append(emptyState);
    return;
  }

  sorted.forEach((person) => {
    elements.directoryGrid.append(buildPersonCard(person));
  });
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
  updateUrlState();
  renderDirectory();
}

function handlePopState() {
  pageState.department = readDepartmentFromUrl();
  applyStateFromUrl();
  updateActiveTab();
  applyDepartmentCopy();
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
  const tabs = {
    actors: elements.tabActors,
    directors: elements.tabDirectors,
    producers: elements.tabProducers,
  };

  Object.entries(tabs).forEach(([department, link]) => {
    link.classList.toggle("is-active", department === pageState.department);
  });
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

function departmentLabelPlural(department) {
  if (department === "directors") {
    return "directors";
  }
  if (department === "producers") {
    return "producers";
  }
  return "actors and actresses";
}

function filterPeopleDirectory(people, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return [...people];
  }

  return people.filter((person) => {
    const haystack = [person.name, person.department, ...(person.knownFor || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function sortPeopleDirectory(people, sort) {
  const sorted = [...people];
  sorted.sort((left, right) => {
    switch (sort) {
      case "name":
        return left.name.localeCompare(right.name);
      case "popularity":
        return (right.popularity ?? -1) - (left.popularity ?? -1) || left.name.localeCompare(right.name);
      case "score":
      default:
        return (right.score ?? -1) - (left.score ?? -1) || left.name.localeCompare(right.name);
    }
  });
  return sorted;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Request failed");
  }

  return payload;
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
