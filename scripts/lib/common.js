const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
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
  mapWithConcurrency,
};
