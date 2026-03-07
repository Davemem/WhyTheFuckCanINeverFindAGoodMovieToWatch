const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");

const projectRoot = path.resolve(__dirname, "../..");

function loadEnv(filePath = path.join(projectRoot, ".env")) {
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getNumberArg(flag, fallback) {
  const match = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (!match) {
    return fallback;
  }

  const value = Number(match.slice(flag.length + 1));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatExportDate(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${month}_${day}_${year}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function execCurl(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile("curl", args, { maxBuffer: 1024 * 1024 * 50, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function curlJson(url, headers = {}) {
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
    "-w",
    "\n%{http_code}",
  ];

  Object.entries(headers).forEach(([key, value]) => {
    args.push("-H", `${key}: ${value}`);
  });
  args.push(url);

  const stdout = await execCurl(args);
  const trimmed = String(stdout).trimEnd();
  const lastNewline = trimmed.lastIndexOf("\n");
  if (lastNewline === -1) {
    throw new Error(`Unexpected curl response for ${url}`);
  }

  const body = trimmed.slice(0, lastNewline);
  const statusCode = Number(trimmed.slice(lastNewline + 1));
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Request failed (${statusCode}) for ${url}`);
  }

  return JSON.parse(body);
}

async function curlBuffer(url) {
  const args = [
    "-sS",
    "-L",
    "--connect-timeout",
    "5",
    "--max-time",
    "45",
    "--retry",
    "2",
    "--retry-delay",
    "1",
    "--retry-all-errors",
    url,
  ];

  const stdout = await execCurl(args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 250 });
  return stdout;
}

function createTmdbClient() {
  const tmdbToken = process.env.TMDB_BEARER_TOKEN || "";
  const tmdbApiKey = process.env.TMDB_API_KEY || "";

  if (!tmdbToken && !tmdbApiKey) {
    throw new Error("TMDb credentials are required. Set TMDB_API_KEY or TMDB_BEARER_TOKEN.");
  }

  async function tmdb(endpoint, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    if (tmdbApiKey) {
      url.searchParams.set("api_key", tmdbApiKey);
    }

    const headers = { Accept: "application/json" };
    if (!tmdbApiKey && tmdbToken) {
      headers.Authorization = `Bearer ${tmdbToken}`;
    }

    return curlJson(url.toString(), headers);
  }

  return tmdb;
}

async function downloadLatestPersonExport(daysBack = 7) {
  const today = new Date();
  const candidates = Array.from({ length: daysBack }, (_, offset) => addDays(today, -offset));

  for (const date of candidates) {
    const stamp = formatExportDate(date);
    const url = `https://files.tmdb.org/p/exports/person_ids_${stamp}.json.gz`;
    try {
      process.stdout.write(`Trying TMDb person export ${stamp}...\n`);
      const buffer = await curlBuffer(url);
      const payload = zlib.gunzipSync(buffer).toString("utf8");
      return {
        stamp,
        rows: payload
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      };
    } catch {
      continue;
    }
  }

  throw new Error("Unable to download a recent TMDb person export.");
}

async function downloadLatestPersonExportTopByPopularity(maxIds, daysBack = 7) {
  if (!Number.isFinite(maxIds) || maxIds < 1) {
    throw new Error("maxIds must be >= 1 for memory-safe export ingestion.");
  }

  const today = new Date();
  const candidates = Array.from({ length: daysBack }, (_, offset) => addDays(today, -offset));

  for (const date of candidates) {
    const stamp = formatExportDate(date);
    const url = `https://files.tmdb.org/p/exports/person_ids_${stamp}.json.gz`;
    try {
      process.stdout.write(`Trying TMDb person export ${stamp}...\n`);
      const rows = await streamTopPeopleFromExport(url, maxIds);
      return { stamp, rows };
    } catch {
      continue;
    }
  }

  throw new Error("Unable to download a recent TMDb person export.");
}

function streamTopPeopleFromExport(url, maxIds) {
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", [
      "-sS",
      "-L",
      "--connect-timeout",
      "5",
      "--max-time",
      "120",
      "--retry",
      "2",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      url,
    ]);

    const gunzip = zlib.createGunzip();
    const rl = readline.createInterface({
      input: curl.stdout.pipe(gunzip),
      crlfDelay: Infinity,
    });

    const heap = [];
    let processed = 0;
    let curlExitCode = null;
    let curlStderr = "";
    let failed = false;

    curl.stderr.on("data", (chunk) => {
      curlStderr += String(chunk);
    });

    const fail = (error) => {
      if (failed) {
        return;
      }
      failed = true;
      try {
        rl.close();
      } catch {
        // ignore
      }
      try {
        curl.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(error);
    };

    curl.on("error", fail);
    gunzip.on("error", fail);
    rl.on("error", fail);

    curl.on("close", (code) => {
      curlExitCode = code;
    });

    rl.on("line", (line) => {
      if (!line) {
        return;
      }

      processed += 1;
      if (processed % 200000 === 0) {
        process.stdout.write(`Scanned ${processed} people rows...\n`);
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      if (!Number.isFinite(parsed.id)) {
        return;
      }

      const candidate = {
        id: Number(parsed.id),
        adult: Boolean(parsed.adult),
        popularity: Number(parsed.popularity || 0),
      };

      if (heap.length < maxIds) {
        minHeapPush(heap, candidate);
        return;
      }

      if (candidate.popularity <= heap[0].popularity) {
        return;
      }

      heap[0] = candidate;
      minHeapifyDown(heap, 0);
    });

    rl.on("close", () => {
      if (failed) {
        return;
      }

      if (curlExitCode !== 0) {
        fail(new Error(curlStderr || `curl exited with code ${curlExitCode}`));
        return;
      }

      const rows = [...heap].sort((left, right) => right.popularity - left.popularity);
      resolve(rows);
    });
  });
}

function minHeapPush(heap, value) {
  heap.push(value);
  minHeapifyUp(heap, heap.length - 1);
}

function minHeapifyUp(heap, index) {
  let current = index;
  while (current > 0) {
    const parent = Math.floor((current - 1) / 2);
    if (heap[parent].popularity <= heap[current].popularity) {
      break;
    }
    const tmp = heap[parent];
    heap[parent] = heap[current];
    heap[current] = tmp;
    current = parent;
  }
}

function minHeapifyDown(heap, index) {
  let current = index;
  while (true) {
    const left = current * 2 + 1;
    const right = current * 2 + 2;
    let smallest = current;

    if (left < heap.length && heap[left].popularity < heap[smallest].popularity) {
      smallest = left;
    }
    if (right < heap.length && heap[right].popularity < heap[smallest].popularity) {
      smallest = right;
    }

    if (smallest === current) {
      return;
    }

    const tmp = heap[current];
    heap[current] = heap[smallest];
    heap[smallest] = tmp;
    current = smallest;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      const result = await mapper(items[current], current);
      results.push(result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
  return results;
}

module.exports = {
  projectRoot,
  loadEnv,
  ensureDir,
  getNumberArg,
  createTmdbClient,
  downloadLatestPersonExport,
  downloadLatestPersonExportTopByPopularity,
  mapWithConcurrency,
};
