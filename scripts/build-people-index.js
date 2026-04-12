const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const projectRoot = path.resolve(__dirname, "..");
const cacheDir = path.join(projectRoot, ".cache");
const fetchCacheDir = path.join(cacheDir, "people-index-fetch");
const outputPath = path.join(cacheDir, "people-index-v1.json");
const defaultMaxIds = Number(process.env.PEOPLE_INDEX_MAX_IDS || 1000);
const defaultConcurrency = Number(process.env.PEOPLE_INDEX_CONCURRENCY || 4);
const fetchTtlMs = 1000 * 60 * 60 * 24 * 7;
const producerJobs = new Set([
  "Producer",
  "Executive Producer",
  "Co-Producer",
  "Associate Producer",
  "Line Producer",
]);
const writerJobs = new Set([
  "Writer",
  "Screenplay",
  "Story",
  "Teleplay",
  "Adaptation",
  "Novel",
  "Characters",
]);

loadEnv(path.join(projectRoot, ".env"));

const tmdbToken = process.env.TMDB_BEARER_TOKEN || "";
const tmdbApiKey = process.env.TMDB_API_KEY || "";

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  if (!tmdbToken && !tmdbApiKey) {
    throw new Error("TMDb credentials are required to build the people index.");
  }

  ensureDir(cacheDir);
  ensureDir(fetchCacheDir);

  const maxIds = getNumberArg("--max-ids", defaultMaxIds);
  const concurrency = getNumberArg("--concurrency", defaultConcurrency);

  process.stdout.write(`Building local people index for top ${maxIds} TMDb people.\n`);
  const exportedPeople = await downloadLatestPersonExport();
  const candidates = exportedPeople
    .filter((person) => Number.isFinite(person.id))
    .sort((left, right) => (right.popularity || 0) - (left.popularity || 0))
    .slice(0, maxIds);

  process.stdout.write(`Hydrating ${candidates.length} people with concurrency ${concurrency}.\n`);
  const hydrated = await mapWithConcurrency(candidates, concurrency, hydratePersonForIndex);
  const entries = hydrated.filter(Boolean);

  const actors = entries
    .filter((entry) => entry.bucket === "actors")
    .map((entry) => entry.person)
    .sort(compareIndexedPeople);
  const directors = entries
    .filter((entry) => entry.bucket === "directors")
    .map((entry) => entry.person)
    .sort(compareIndexedPeople);
  const producers = entries
    .filter((entry) => entry.bucket === "producers")
    .map((entry) => entry.person)
    .sort(compareIndexedPeople);
  const writers = entries
    .filter((entry) => entry.bucket === "writers")
    .map((entry) => entry.person)
    .sort(compareIndexedPeople);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      type: "tmdb-person-export-plus-api",
      candidateCount: candidates.length,
      actorCount: actors.length,
      directorCount: directors.length,
      producerCount: producers.length,
      writerCount: writers.length,
    },
    actors,
    directors,
    producers,
    writers,
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload));
  process.stdout.write(
    `Wrote ${actors.length} actors, ${directors.length} directors, ${producers.length} producers, and ${writers.length} writers to ${outputPath}\n`,
  );
}

async function hydratePersonForIndex(candidate, index) {
  if ((index + 1) % 50 === 0) {
    process.stdout.write(`Processed ${index + 1} people...\n`);
  }

  try {
    const [details, credits] = await Promise.all([
      tmdb(`/person/${candidate.id}`),
      tmdb(`/person/${candidate.id}/movie_credits`),
    ]);

    const buckets = buildIndexEntries(details, credits, candidate.popularity || 0);
    return buckets;
  } catch {
    return null;
  }
}

function buildIndexEntries(details, credits, fallbackPopularity) {
  const entries = [];
  const popularity = Number(details.popularity || fallbackPopularity || 0);
  const base = {
    id: details.id,
    name: details.name,
    profileUrl: details.profile_path ? `https://image.tmdb.org/t/p/w500${details.profile_path}` : "",
    popularity,
  };

  const actorCredits = dedupeCredits((credits.cast || []).filter(isScoredMovieCredit));
  if (actorCredits.length) {
    const actorScore = scoreCredits(actorCredits);
    entries.push({
      bucket: "actors",
      person: {
        ...base,
        department: buildDepartmentLabel(details.known_for_department, false, actorCredits.length > 0, false, false),
        score: actorScore,
        ratingLabel: `Career score ${actorScore.toFixed(1)}`,
        knownFor: topCreditTitles(actorCredits),
      },
    });
  }

  const directorCredits = dedupeCredits(
    (credits.crew || []).filter(
      (credit) => isScoredMovieCredit(credit) && credit.job === "Director",
    ),
  );
  if (directorCredits.length) {
    const directorScore = scoreCredits(directorCredits);
    entries.push({
      bucket: "directors",
      person: {
        ...base,
        department: buildDepartmentLabel(details.known_for_department, true, false, false, false),
        score: directorScore,
        ratingLabel: `Career score ${directorScore.toFixed(1)}`,
        knownFor: topCreditTitles(directorCredits),
      },
    });
  }

  const producerCredits = dedupeCredits(
    (credits.crew || []).filter(
      (credit) => isScoredMovieCredit(credit) && producerJobs.has(credit.job),
    ),
  );
  if (producerCredits.length) {
    const producerScore = scoreCredits(producerCredits);
    entries.push({
      bucket: "producers",
      person: {
        ...base,
        department: buildDepartmentLabel(details.known_for_department, false, false, true, false),
        score: producerScore,
        ratingLabel: `Career score ${producerScore.toFixed(1)}`,
        knownFor: topCreditTitles(producerCredits),
      },
    });
  }

  const writerCredits = dedupeCredits(
    (credits.crew || []).filter(
      (credit) => isScoredMovieCredit(credit) && writerJobs.has(credit.job),
    ),
  );
  if (writerCredits.length) {
    const writerScore = scoreCredits(writerCredits);
    entries.push({
      bucket: "writers",
      person: {
        ...base,
        department: buildDepartmentLabel(details.known_for_department, false, false, false, true),
        score: writerScore,
        ratingLabel: `Career score ${writerScore.toFixed(1)}`,
        knownFor: topCreditTitles(writerCredits),
      },
    });
  }

  return entries;
}

function buildDepartmentLabel(knownForDepartment, hasDirector, hasActing, hasProducer, hasWriter) {
  const parts = [];
  if (hasActing || String(knownForDepartment || "").toLowerCase().includes("acting")) {
    parts.push("Acting");
  }
  if (hasDirector || String(knownForDepartment || "").toLowerCase().includes("direct")) {
    parts.push("Director");
  }
  if (hasProducer || String(knownForDepartment || "").toLowerCase().includes("produc")) {
    parts.push("Producer");
  }
  if (hasWriter || String(knownForDepartment || "").toLowerCase().includes("writ")) {
    parts.push("Writing");
  }
  if (!parts.length && knownForDepartment) {
    parts.push(knownForDepartment);
  }
  return [...new Set(parts)].join(" / ") || "Person";
}

function isScoredMovieCredit(credit) {
  return Boolean(
    credit &&
      credit.id &&
      credit.title &&
      typeof credit.vote_average === "number" &&
      (credit.vote_count || 0) > 0,
  );
}

function dedupeCredits(credits) {
  const byId = new Map();
  for (const credit of credits) {
    if (!byId.has(credit.id)) {
      byId.set(credit.id, credit);
    }
  }
  return [...byId.values()];
}

function scoreCredits(credits) {
  const totalWeight = credits.reduce(
    (sum, credit) => sum + Math.max(Math.sqrt(credit.vote_count || 0), 1),
    0,
  );
  if (!totalWeight) {
    return 0;
  }

  const weighted = credits.reduce(
    (sum, credit) =>
      sum + credit.vote_average * Math.max(Math.sqrt(credit.vote_count || 0), 1),
    0,
  );
  return Number((weighted / totalWeight).toFixed(1));
}

function topCreditTitles(credits) {
  return [...credits]
    .sort((left, right) => scoreKnownForCredit(right) - scoreKnownForCredit(left))
    .slice(0, 3)
    .map((credit) => credit.title);
}

function scoreKnownForCredit(credit) {
  return (credit.vote_average || 0) * Math.log10((credit.vote_count || 1) + 10);
}

function compareIndexedPeople(left, right) {
  if ((right.score ?? -1) !== (left.score ?? -1)) {
    return (right.score ?? -1) - (left.score ?? -1);
  }
  if ((right.popularity ?? -1) !== (left.popularity ?? -1)) {
    return (right.popularity ?? -1) - (left.popularity ?? -1);
  }
  return left.name.localeCompare(right.name);
}

async function downloadLatestPersonExport() {
  const today = new Date();
  const candidates = Array.from({ length: 7 }, (_, offset) => addDays(today, -offset));

  for (const date of candidates) {
    const stamp = formatExportDate(date);
    const url = `https://files.tmdb.org/p/exports/person_ids_${stamp}.json.gz`;
    try {
      process.stdout.write(`Trying TMDb person export ${stamp}...\n`);
      const buffer = await curlBuffer(url);
      const payload = zlib.gunzipSync(buffer).toString("utf8");
      return payload
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      continue;
    }
  }

  throw new Error("Unable to download a recent TMDb person export.");
}

async function tmdb(endpoint) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  if (tmdbApiKey) {
    url.searchParams.set("api_key", tmdbApiKey);
  }

  const cacheKey = `tmdb:${url.pathname}?${url.searchParams.toString()}`;
  const cached = readFetchCache(cacheKey);
  if (cached) {
    return cached;
  }

  const headers = { Accept: "application/json" };
  if (!tmdbApiKey && tmdbToken) {
    headers.Authorization = `Bearer ${tmdbToken}`;
  }

  const response = await curlJson(url.toString(), headers);
  writeFetchCache(cacheKey, response);
  return response;
}

function readFetchCache(key) {
  try {
    const filePath = fetchCacheFile(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.expiresAt <= Date.now()) {
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

function writeFetchCache(key, value) {
  try {
    fs.writeFileSync(
      fetchCacheFile(key),
      JSON.stringify({ expiresAt: Date.now() + fetchTtlMs, value }),
    );
  } catch {
    // Ignore fetch cache write failures.
  }
}

function fetchCacheFile(key) {
  const digest = crypto.createHash("sha1").update(key).digest("hex");
  return path.join(fetchCacheDir, `${digest}.json`);
}

function curlJson(url, headers) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-L",
      "--connect-timeout",
      "5",
      "--max-time",
      "20",
      "--retry",
      "2",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      "-w",
      "\n%{http_code}",
    ];

    Object.entries(headers || {}).forEach(([key, value]) => {
      args.push("-H", `${key}: ${value}`);
    });

    args.push(url);

    execFile("curl", args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      const trimmed = stdout.trimEnd();
      const lastNewline = trimmed.lastIndexOf("\n");
      const body = trimmed.slice(0, lastNewline);
      const statusCode = Number(trimmed.slice(lastNewline + 1));
      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`TMDb request failed for ${url}: ${statusCode}`));
        return;
      }

      resolve(JSON.parse(body));
    });
  });
}

function curlBuffer(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-L",
      "--connect-timeout",
      "5",
      "--max-time",
      "30",
      "--retry",
      "2",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      url,
    ];

    execFile(
      "curl",
      args,
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 200 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr ? String(stderr) : error.message));
          return;
        }

        resolve(stdout);
      },
    );
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const mapped = await mapper(items[currentIndex], currentIndex);
      if (Array.isArray(mapped)) {
        results.push(...mapped);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );

  return results;
}

function getNumberArg(flag, fallback) {
  const match = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (!match) {
    return fallback;
  }

  const value = Number(match.slice(flag.length + 1));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function formatExportDate(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${month}_${day}_${year}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
