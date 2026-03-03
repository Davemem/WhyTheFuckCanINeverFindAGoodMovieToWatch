const decadeOptions = buildDecadeOptions();

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

  const bootstrap = await fetchJson("/api/bootstrap");
  populateGenres(genreSelect, bootstrap.genres || []);
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

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Request failed");
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
