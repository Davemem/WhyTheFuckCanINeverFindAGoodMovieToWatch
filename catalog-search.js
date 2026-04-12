const decadeOptions = buildDecadeOptions();
const bootstrapLiteCacheKey = "wtfcineverfind-bootstrap-lite-v1";
const studioPlaceholderPool = [
  "A24",
  "Warner Bros.",
  "Searchlight Pictures",
  "Blumhouse Productions",
  "Paramount Pictures",
];

document.querySelectorAll("[data-catalog-search]").forEach((form) => {
  setupCatalogSearch(form).catch(() => {
    // Keep the form usable even if bootstrap data fails.
  });
});

async function setupCatalogSearch(form) {
  const personInput = form.querySelector("[data-search-person]");
  const searchTypeSelect = form.querySelector("[data-search-type]");
  const searchLabel = form.querySelector("[data-search-label]");
  const awardSelect = form.querySelector("[data-search-award]");
  const imdbInput = form.querySelector("[data-search-imdb]");
  const rtInput = form.querySelector("[data-search-rt]");
  const imdbValue = form.querySelector("[data-search-imdb-value]");
  const rtValue = form.querySelector("[data-search-rt-value]");
  const genreSelect = form.querySelector("[data-search-genre]");
  const decadeSelect = form.querySelector("[data-search-decade]");
  const roleField = form.querySelector("[data-role-field]");
  const roleInput = form.querySelector("[data-role-input]");
  const roleLabel = form.querySelector("[data-role-label]");
  const suggestionListId = personInput?.getAttribute("list");
  const suggestions = suggestionListId ? document.getElementById(suggestionListId) : null;

  populateDecades(decadeSelect);
  syncRangeLabels(imdbInput, rtInput, imdbValue, rtValue);

  form.addEventListener("input", () => {
    syncRangeLabels(imdbInput, rtInput, imdbValue, rtValue);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const query = personInput?.value.trim();
    const searchType = searchTypeSelect?.value || "person";
    const role = roleInput?.value || "any";
    const award = awardSelect?.value || "all";
    const imdbMin = Number(imdbInput?.value || 0);
    const rtMin = Number(rtInput?.value || 0);
    const genre = genreSelect?.value || "all";
    const decade = decadeSelect?.value || "all";
    const sort = form.querySelector("[data-search-sort]")?.value || "match";

    if (query) {
      params.set("query", query);
    }
    if (searchType !== "person") {
      params.set("searchType", searchType);
    }
    if (searchType === "person" && role !== "any") {
      params.set("role", role);
    }
    if (award !== "all") {
      params.set("award", award);
    }
    if (genre !== "all") {
      params.set("genre", genre);
    }
    if (decade !== "all") {
      params.set("decade", decade);
    }
    if (sort !== "match") {
      params.set("sort", sort);
    }
    if (imdbMin > 0) {
      params.set("imdbMin", String(imdbMin));
    }
    if (rtMin > 0) {
      params.set("rtMin", String(rtMin));
    }

    if (form.dataset.inlineResults === "people") {
      const currentParams = new URLSearchParams(window.location.search);
      const department = currentParams.get("department") || "actors";
      params.set("department", department);
      const nextUrl = `/people.html?${params.toString()}#people-results-title`;
      if (window.location.pathname.endsWith("/people.html")) {
        window.history.pushState({}, "", nextUrl);
        window.dispatchEvent(new CustomEvent("catalog:people-search"));
      } else {
        window.location.href = nextUrl;
      }
      return;
    }

    window.location.href = `/${params.toString() ? `?${params.toString()}` : ""}#results-title`;
  });

  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-role-choice]");
    if (!button) {
      return;
    }

    applyRoleChoice(form, button.dataset.roleChoice || "any");
  });

  personInput?.addEventListener("input", debounce(async () => {
    const query = personInput.value.trim();
    if (!suggestions || query.length < 2) {
      if (suggestions) {
        suggestions.replaceChildren();
      }
      return;
    }

    try {
      const endpoint = (searchTypeSelect?.value || "person") === "studio" ? "/api/studios" : "/api/people";
      const payload = await fetchJson(`${endpoint}?query=${encodeURIComponent(query)}`);
      suggestions.replaceChildren();
      (payload.results || []).forEach((result) => {
        const option = document.createElement("option");
        option.value = result.name;
        suggestions.append(option);
      });
    } catch {
      suggestions.replaceChildren();
    }
  }, 250));

  searchTypeSelect?.addEventListener("change", () => {
    if (suggestions) {
      suggestions.replaceChildren();
    }
    syncSearchTypeUi({
      searchTypeSelect,
      searchLabel,
      roleField,
      roleInput,
      roleLabel,
      personInput,
      placeholderPools: form._placeholderPools || null,
      form,
    });
  });

  const bootstrap = await fetchBootstrapLite();
  form._placeholderPools = bootstrap.config?.placeholderPools || null;
  populateGenres(genreSelect, bootstrap.genres || []);
  hydrateFormFromUrl({
    form,
    personInput,
    searchTypeSelect,
    awardSelect,
    roleInput,
    genreSelect,
    decadeSelect,
    imdbInput,
    rtInput,
  });
  syncSearchTypeUi({
    searchTypeSelect,
    searchLabel,
    roleField,
    roleInput,
    roleLabel,
    personInput,
    placeholderPools: form._placeholderPools || null,
    form,
  });
  syncRangeLabels(imdbInput, rtInput, imdbValue, rtValue);
}

function hydrateFormFromUrl({
  form,
  personInput,
  searchTypeSelect,
  awardSelect,
  roleInput,
  genreSelect,
  decadeSelect,
  imdbInput,
  rtInput,
}) {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("query") || params.get("person") || "";
  const searchType = params.get("searchType") || "person";
  const role = params.get("role") || "any";
  const award = params.get("award") || "all";
  const genre = params.get("genre") || "all";
  const decade = params.get("decade") || "all";
  const sort = params.get("sort") || "match";
  const imdbMin = params.get("imdbMin");
  const rtMin = params.get("rtMin");

  if (personInput) {
    personInput.value = query;
  }
  if (searchTypeSelect) {
    searchTypeSelect.value = searchType;
  }
  if (awardSelect) {
    awardSelect.value = award;
  }
  if (roleInput) {
    roleInput.value = role;
  }
  if (genreSelect) {
    genreSelect.value = genre;
  }
  if (decadeSelect) {
    decadeSelect.value = decade;
  }
  if (imdbInput && imdbMin !== null) {
    imdbInput.value = imdbMin;
  }
  if (rtInput && rtMin !== null) {
    rtInput.value = rtMin;
  }

  const sortSelect = form.querySelector("[data-search-sort]");
  if (sortSelect) {
    sortSelect.value = sort;
  }
  applyRoleChoice(form, role);
}

function syncSearchTypeUi({
  searchTypeSelect,
  searchLabel,
  roleField,
  roleInput,
  roleLabel,
  personInput,
  placeholderPools,
  form,
}) {
  const searchType = searchTypeSelect?.value || "person";
  const isStudio = searchType === "studio";

  if (searchLabel) {
    searchLabel.textContent = isStudio ? "Studio" : "Person";
  }
  if (roleField) {
    roleField.hidden = isStudio;
  }
  if (isStudio) {
    if (roleInput) {
      roleInput.value = "any";
    }
    if (roleLabel) {
      roleLabel.textContent = "Studios ignore role matching";
    }
    form.querySelectorAll("[data-role-choice]").forEach((choice) => {
      choice.classList.toggle("is-active", choice.dataset.roleChoice === "any");
    });
    applyStudioPlaceholder(personInput);
    return;
  }

  applyRoleChoice(form, roleInput?.value || "any");
  applyRandomPlaceholder(personInput, placeholderPools);
}

function applyRoleChoice(form, value) {
  const roleInput = form.querySelector("[data-role-input]");
  const roleLabel = form.querySelector("[data-role-label]");
  if (roleInput) {
    roleInput.value = value;
  }
  if (roleLabel) {
    roleLabel.textContent = value === "any" ? "Any role" : `Only ${value} matches`;
  }
  form.querySelectorAll("[data-role-choice]").forEach((choice) => {
    choice.classList.toggle("is-active", choice.dataset.roleChoice === value);
  });
}

function populateGenres(select, genres) {
  genres.forEach((genre) => {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.name;
    select.append(option);
  });
}

function populateDecades(select) {
  decadeOptions.forEach((decade) => {
    const option = document.createElement("option");
    option.value = String(decade);
    option.textContent = `${decade}s`;
    select.append(option);
  });
}

function syncRangeLabels(imdbInput, rtInput, imdbValue, rtValue) {
  imdbValue.textContent = `${Number(imdbInput.value).toFixed(1)}+`;
  rtValue.textContent = `${Number(rtInput.value)}%+`;
}

function buildDecadeOptions() {
  const currentYear = new Date().getFullYear();
  const currentDecade = currentYear - (currentYear % 10);
  const decades = [];
  for (let decade = currentDecade; decade >= 1950; decade -= 10) {
    decades.push(decade);
  }
  return decades;
}

function applyRandomPlaceholder(input, pools) {
  if (!input || !pools) {
    return;
  }

  const profile = input.dataset.placeholderProfile || "mixed";
  const parts =
    profile === "producer"
      ? [
          pickRandomName(pools.producers, `producer-a:${window.location.pathname}`),
          pickRandomName(pools.writers, `writer:${window.location.pathname}`),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ]
      : [
          pickRandomName(pools.actors, `actor:${window.location.pathname}`),
          pickRandomName(pools.writers, `writer:${window.location.pathname}`),
          pickRandomName(pools.producers, `producer:${window.location.pathname}`),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ];

  const names = parts.filter(Boolean);
  if (names.length) {
    input.placeholder = `Try: ${names.join(", ")}`;
  }
}

function applyStudioPlaceholder(input) {
  if (!input) {
    return;
  }

  const picks = [
    pickRandomName(studioPlaceholderPool, `studio-a:${window.location.pathname}`),
    pickRandomName(studioPlaceholderPool, `studio-b:${window.location.pathname}`, 1),
    pickRandomName(studioPlaceholderPool, `studio-c:${window.location.pathname}`, 2),
  ].filter(Boolean);

  if (picks.length) {
    input.placeholder = `Try: ${picks.join(", ")}`;
  }
}

function pickRandomName(list, key, salt = 0) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }

  const seed = `${new Date().toISOString().slice(0, 10)}:${key}:${salt}`;
  const start = hashString(seed) % Math.min(list.length, 500);
  return list[start] || list[0] || "";
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

async function fetchJson(url) {
  const response = await fetch(url);
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

async function fetchBootstrapLite() {
  try {
    const cached = window.sessionStorage.getItem(bootstrapLiteCacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.genres)) {
        return parsed;
      }
    }
  } catch {
    // Ignore session cache parse errors.
  }

  const payload = await fetchJson("/api/bootstrap?mode=lite");
  try {
    window.sessionStorage.setItem(bootstrapLiteCacheKey, JSON.stringify(payload));
  } catch {
    // Ignore storage write failures.
  }
  return payload;
}

function debounce(callback, wait) {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, wait);
  };
}
