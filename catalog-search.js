const decadeOptions = buildDecadeOptions();
const bootstrapLiteCacheKey = "wtfcineverfind-bootstrap-lite-v1";

document.querySelectorAll("[data-catalog-search]").forEach((form) => {
  setupCatalogSearch(form).catch(() => {
    // Keep the form usable even if bootstrap data fails.
  });
});

async function setupCatalogSearch(form) {
  const personInput = form.querySelector("[data-search-person]");
  const imdbInput = form.querySelector("[data-search-imdb]");
  const rtInput = form.querySelector("[data-search-rt]");
  const imdbValue = form.querySelector("[data-search-imdb-value]");
  const rtValue = form.querySelector("[data-search-rt-value]");
  const genreSelect = form.querySelector("[data-search-genre]");
  const decadeSelect = form.querySelector("[data-search-decade]");
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
    const person = personInput?.value.trim();
    const role = roleInput?.value || "any";
    const imdbMin = Number(imdbInput?.value || 0);
    const rtMin = Number(rtInput?.value || 0);
    const genre = genreSelect?.value || "all";
    const decade = decadeSelect?.value || "all";
    const sort = form.querySelector("[data-search-sort]")?.value || "match";

    if (person) {
      params.set("person", person);
    }
    if (role !== "any") {
      params.set("role", role);
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

    window.location.href = `/${params.toString() ? `?${params.toString()}` : ""}#results-title`;
  });

  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-role-choice]");
    if (!button) {
      return;
    }

    roleInput.value = button.dataset.roleChoice;
    roleLabel.textContent =
      button.dataset.roleChoice === "any" ? "Any role" : `Only ${button.dataset.roleChoice} matches`;
    form.querySelectorAll("[data-role-choice]").forEach((choice) => {
      choice.classList.toggle("is-active", choice === button);
    });
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
      const payload = await fetchJson(`/api/people?query=${encodeURIComponent(query)}`);
      suggestions.replaceChildren();
      (payload.results || []).forEach((person) => {
        const option = document.createElement("option");
        option.value = person.name;
        suggestions.append(option);
      });
    } catch {
      suggestions.replaceChildren();
    }
  }, 250));

  const bootstrap = await fetchBootstrapLite();
  populateGenres(genreSelect, bootstrap.genres || []);
  applyRandomPlaceholder(personInput, bootstrap.config?.placeholderPools || null);
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
          pickRandomName(pools.producers, `producer-b:${window.location.pathname}`, 1),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ]
      : [
          pickRandomName(pools.actors, `actor:${window.location.pathname}`),
          pickRandomName(pools.producers, `producer:${window.location.pathname}`),
          pickRandomName(pools.directors, `director:${window.location.pathname}`),
        ];

  const names = parts.filter(Boolean);
  if (names.length) {
    input.placeholder = `Try: ${names.join(", ")}`;
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
